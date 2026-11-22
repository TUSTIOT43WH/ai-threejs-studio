import 'reflect-metadata';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageSettingsService } from './image-settings.service';
import { SettingsService } from './settings.service';

const key = 'image-stub-key-not-valid';
const defaults = { protocol: 'openai', size: '', responseFormat: 'auto' } as const;
const initial = { enabled: false, baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', ...defaults };

describe('independent ImageSettingsService (temporary storage only)', () => {
  let dataDir: string;
  let settings: ImageSettingsService;
  const create = () => new ImageSettingsService({ port: 4000, aiMode: 'mock', dataDir });

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'studio-images-settings-'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network allowed')));
    settings = create();
    await settings.onModuleInit();
  });
  afterEach(async () => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('defaults to disabled without creating a file or inheriting a chat key', async () => {
    const chat = new SettingsService({ port: 4000, aiMode: 'mock', dataDir });
    await chat.save({ enabled: true, modelingEnabled: true, baseURL: initial.baseURL, model: 'chat-model', apiKey: 'only-chat-key' });
    const original = await readFile(join(dataDir, 'chat-settings.json'), 'utf8');
    expect(settings.getSettings()).toEqual({ ...initial, hasApiKey: false });
    await expect(settings.save({ ...initial, enabled: true })).rejects.toThrow('独立');
    await settings.save({ ...initial, enabled: true, apiKey: key });
    await settings.clearKey();
    expect(await readFile(join(dataDir, 'chat-settings.json'), 'utf8')).toBe(original);
    expect(chat.getSettings()).toMatchObject({ enabled: true, modelingEnabled: true, hasApiKey: true });
  });

  it('persists atomically, restores privately and returns only hasApiKey', async () => {
    expect(await readdir(dataDir)).toEqual([]);
    const saved = await settings.save({ ...initial, enabled: true, apiKey: key });
    expect(saved).toEqual({ ...initial, enabled: true, hasApiKey: true });
    expect(saved).not.toHaveProperty('apiKey');
    expect(JSON.stringify(saved)).not.toContain(key);
    expect(await readdir(dataDir)).toEqual(['images-settings.json']);
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual(saved);
    expect(restored.getImageConfig().apiKey).toBe(key);
    const snapshot = restored.getImageConfig();
    snapshot.apiKey = 'mutated';
    expect(restored.getImageConfig().apiKey).toBe(key);
    if (process.platform !== 'win32') {
      expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(dataDir, 'images-settings.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('retains an omitted/blank key only at the exact unchanged endpoint', async () => {
    await settings.save({ ...initial, enabled: true, apiKey: key });
    await settings.save({ ...initial, apiKey: '', model: 'dall-e-3' });
    expect(settings.getImageConfig()).toMatchObject({ enabled: false, apiKey: key });
    await settings.save({ ...initial, enabled: true });
    const changed = { ...initial, baseURL: `${initial.baseURL}/` };
    await expect(settings.save({ ...changed, enabled: true })).rejects.toThrow('重新输入');
    expect(settings.getSettings()).toMatchObject({ enabled: true, baseURL: initial.baseURL, hasApiKey: true });
    await settings.save(changed);
    expect(settings.getSettings()).toEqual({ ...changed, hasApiKey: false });
    await expect(settings.save({ ...changed, enabled: true, apiKey: '' })).rejects.toThrow();
    await settings.save({ ...changed, enabled: true, apiKey: 'new-image-key' });
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getImageConfig()).toMatchObject({ baseURL: changed.baseURL, apiKey: 'new-image-key' });
  });

  it('migrates legacy options in memory and retains the openai key on the next save', async () => {
    const legacy = { enabled: true, baseURL: 'https://images.custom-provider.com:8443/v2', model: 'arbitrary-image-model', apiKey: key };
    const file = join(dataDir, 'images-settings.json');
    await writeFile(file, JSON.stringify(legacy));
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getImageConfig()).toEqual({ ...legacy, ...defaults });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(legacy);
    await restored.save({ ...legacy, apiKey: '' });
    expect(restored.getImageConfig().apiKey).toBe(key);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject(defaults);
  });

  it.each(['openai', 'seedream', 'gemini', 'dashscope'] as const)('persists %s options independently of chat', async (protocol) => {
    const chat = new SettingsService({ port: 4000, aiMode: 'mock', dataDir });
    await chat.save({ enabled: true, modelingEnabled: true, baseURL: initial.baseURL, model: 'chat-model', apiKey: 'chat-only', protocol: 'anthropic', jsonMode: true });
    const originalChat = await readFile(join(dataDir, 'chat-settings.json'), 'utf8');
    const input = { ...initial, enabled: true, protocol, size: '2048x1152', responseFormat: 'url' as const, apiKey: key };
    const saved = await settings.save(input);
    expect(saved).toEqual({ ...initial, enabled: true, protocol, size: '2048x1152', responseFormat: 'url', hasApiKey: true });
    expect(saved).not.toHaveProperty('apiKey');
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual(saved);
    expect(JSON.parse(await readFile(join(dataDir, 'images-settings.json'), 'utf8'))).toMatchObject(input);
    await restored.save({ ...input, enabled: false, protocol: protocol === 'gemini' ? 'openai' : 'gemini', apiKey: '' });
    expect(restored.getSettings().hasApiKey).toBe(false);
    expect(await readFile(join(dataDir, 'chat-settings.json'), 'utf8')).toBe(originalChat);
  });

  it('requires a new image key when only the protocol changes, even after restart', async () => {
    await settings.save({ ...initial, enabled: true, apiKey: key });
    const changed = { ...initial, enabled: true, protocol: 'seedream' as const };
    await expect(settings.save(changed)).rejects.toThrow('重新输入');
    expect(settings.getImageConfig()).toMatchObject({ protocol: 'openai', apiKey: key });
    await settings.save({ ...changed, apiKey: 'new-key' });
    await settings.save({ ...changed, size: '2K', responseFormat: 'b64_json', apiKey: '' });
    expect(settings.getImageConfig().apiKey).toBe('new-key');
    const restored = create();
    await restored.onModuleInit();
    await expect(restored.save({ ...initial, enabled: true, protocol: undefined })).rejects.toThrow('重新输入');
    await restored.save({ ...initial, protocol: undefined });
    expect(restored.getSettings()).toMatchObject({ protocol: 'openai', hasApiKey: false });
  });

  it('serializes clear and save without resurrecting keys across restart', async () => {
    await Promise.all([
      settings.save({ ...initial, enabled: true, apiKey: key }),
      settings.clearKey(),
      settings.save({ ...initial, model: 'next-model', apiKey: '' }),
    ]);
    expect(settings.getSettings()).toEqual({ ...initial, model: 'next-model', hasApiKey: false });
    expect(await readFile(join(dataDir, 'images-settings.json'), 'utf8')).not.toContain(key);
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual(settings.getSettings());
  });

  it.each([
    'https://api.deepseek.com/v1', 'https://api.openai.com:443/v1', 'https://api.openai.com:444/v1',
    'https://api.openai.com.other-provider.com/v2', 'https://custom-image-provider.com:8443/images/generations',
  ])('accepts arbitrary public endpoint %s without a vendor allowlist', async (baseURL) => {
    await settings.save({ ...initial, baseURL, model: 'custom/model-2.0' });
    expect(settings.getSettings()).toMatchObject({ baseURL, model: 'custom/model-2.0' });
  });

  it.each([
    'http://api.openai.com/v1', 'https://localhost/v1',
    'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://169.254.169.254/latest',
    'https://api.openai.com@127.0.0.1/v1', 'https://api.openai.com/%2f%2f127.0.0.1',
    'https://api.openai.com/\r\nv1', 'https://user:pass@api.openai.com/v1',
    'https://api.openai.com/v1?redirect=evil', 'https://api.openai.com/v1#secret',
    'https://api.openai.com/v1/../private', 'https://api.openai.com/v1//',
  ])('rejects unsupported endpoint %s without writes', async (baseURL) => {
    await expect(settings.save({ ...initial, baseURL, apiKey: key })).rejects.toThrow('图片设置无效');
    expect(await readdir(dataDir)).toEqual([]);
  });

  it.each([
    { enabled: 'true' }, { enabled: null }, { enabled: undefined },
    { model: '' }, { model: 'bad model' }, { model: 'bad\nmodel' }, { model: 'x'.repeat(161) },
    { apiKey: null }, { apiKey: 'bad key' }, { apiKey: '\r\nheader' }, { apiKey: 'x'.repeat(1025) },
    { modelingEnabled: true }, { extra: key },
    { protocol: 'unknown' }, { protocol: null }, { protocol: 1 },
    { size: ' ' }, { size: '1024 1024' }, { size: 'bad\nsize' }, { size: '\u0085' }, { size: 'x'.repeat(81) }, { size: null }, { size: 1024 },
    { responseFormat: 'jpeg' }, { responseFormat: null },
    { baseURL: `https://api.example.com/${'x'.repeat(2048)}` },
  ])('rejects invalid settings without returning secrets', async (invalid) => {
    const error = await settings.save({ ...initial, apiKey: key, ...invalid } as never).catch((value: unknown) => value);
    expect(String(error)).toContain('图片设置无效');
    expect(JSON.stringify(error)).not.toContain(key);
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('fails closed on corrupt contents and enabled settings without a key', async () => {
    const file = join(dataDir, 'images-settings.json');
    await writeFile(file, `corrupt-${key}`);
    await expect(create().onModuleInit()).rejects.toThrow('Cannot load image settings');
    await expect(create().onModuleInit()).rejects.not.toThrow(key);
    await writeFile(file, JSON.stringify({ ...initial, enabled: true }));
    await expect(create().onModuleInit()).rejects.toThrow('Cannot load image settings');
  });

  it('leaves memory unchanged and removes secret temp files after a failed save', async () => {
    await mkdir(join(dataDir, 'images-settings.json'));
    await expect(settings.save({ ...initial, apiKey: key })).rejects.toThrow('无法保存图片设置');
    expect(settings.getSettings()).toEqual({ ...initial, hasApiKey: false });
    expect(await readdir(dataDir)).toEqual(['images-settings.json']);
  });
});
