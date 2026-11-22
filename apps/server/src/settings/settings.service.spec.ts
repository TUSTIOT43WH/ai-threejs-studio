import 'reflect-metadata';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateSync } from 'class-validator';
import { SaveChatSettingsDto } from './dto';
import { SettingsService } from './settings.service';

const key = 'stub-key-never-valid-123';
const defaults = { protocol: 'openai', jsonMode: false, tokenParameter: 'max_tokens', maxOutputTokens: 10000 } as const;
const initial = { enabled: false, modelingEnabled: false, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', ...defaults };

describe('SettingsService (isolated temporary storage, no network)', () => {
  let dataDir: string;
  let settings: SettingsService;
  const create = () => new SettingsService({ port: 4000, aiMode: 'mock', dataDir });

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'studio-settings-spec-'));
    settings = create();
    await settings.onModuleInit();
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it('defaults to disabled Mock without creating a settings file', async () => {
    expect(settings.getSettings()).toEqual({ ...initial, hasApiKey: false });
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('persists in its own file, restores after restart, and never serializes the key in API settings', async () => {
    const result = await settings.save({ ...initial, enabled: true, apiKey: key, model: 'custom-model-ID' });
    expect(result).toEqual({ ...initial, enabled: true, model: 'custom-model-ID', hasApiKey: true });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(result).not.toHaveProperty('apiKey');
    expect(await readdir(dataDir)).toEqual(['chat-settings.json']);
    const disk = JSON.parse(await readFile(join(dataDir, 'chat-settings.json'), 'utf8'));
    expect(disk.apiKey).toBe(key);
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual(result);
    expect(restored.getChatConfig().apiKey).toBe(key);
    if (process.platform !== 'win32') {
      expect((await stat(join(dataDir, 'chat-settings.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps a blank or omitted key only when the URL is unchanged and supports disable/re-enable', async () => {
    await settings.save({ ...initial, enabled: true, apiKey: key });
    await settings.save({ ...initial, apiKey: '', model: 'edited-model' });
    expect(settings.getSettings()).toMatchObject({ enabled: false, hasApiKey: true, model: 'edited-model' });
    await settings.save({ ...initial, enabled: true });
    expect(settings.getChatConfig().apiKey).toBe(key);
  });

  it('clears the old key on a disabled endpoint change and requires a new key to enable', async () => {
    await settings.save({ ...initial, enabled: true, apiKey: key });
    const changed = { ...initial, baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
    await expect(settings.save({ ...changed, enabled: true, apiKey: '' })).rejects.toThrow('重新输入');
    expect(settings.getSettings()).toMatchObject({ baseURL: initial.baseURL, enabled: true, hasApiKey: true });
    await settings.save({ ...changed, apiKey: '' });
    expect(settings.getSettings()).toEqual({ ...changed, hasApiKey: false });
    await expect(settings.save({ ...changed, enabled: true })).rejects.toThrow();
    await settings.save({ ...changed, enabled: true, apiKey: 'different-stub-key' });
    expect(settings.getChatConfig().apiKey).toBe('different-stub-key');
  });

  it('preserves the exact accepted URL and model without silent rewriting', async () => {
    const input = { ...initial, baseURL: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: key };
    await settings.save(input);
    expect(settings.getSettings()).toMatchObject({ baseURL: input.baseURL, model: input.model });
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual(settings.getSettings());
  });

  it.each(['openai', 'openai-responses', 'anthropic', 'gemini'] as const)('persists %s and all chat options without returning the key', async (protocol) => {
    const input = { ...initial, enabled: true, baseURL: 'https://api.custom-provider.com:8443/custom/v2', model: 'vendor/model-version', protocol, jsonMode: true, tokenParameter: 'max_completion_tokens' as const, maxOutputTokens: 65536, apiKey: key };
    const saved = await settings.save(input);
    expect(saved).toMatchObject({ protocol, jsonMode: true, tokenParameter: 'max_completion_tokens', maxOutputTokens: 65536, hasApiKey: true });
    expect(saved).not.toHaveProperty('apiKey');
    expect(JSON.stringify(saved)).not.toContain(key);
    expect(JSON.parse(await readFile(join(dataDir, 'chat-settings.json'), 'utf8'))).toEqual(input);
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual(saved);
    await restored.save({ ...input, tokenParameter: 'omit', maxOutputTokens: 1, model: 'new-model', apiKey: '' });
    expect(restored.getChatConfig()).toMatchObject({ apiKey: key, tokenParameter: 'omit', maxOutputTokens: 1 });
  });

  it.each(['enabled', 'modelingEnabled'] as const)('requires reentry on protocol-only changes while %s', async (switchName) => {
    await settings.save({ ...initial, [switchName]: true, apiKey: key });
    const changed = { ...initial, [switchName]: true, protocol: 'anthropic' as const };
    await expect(settings.save(changed)).rejects.toThrow('重新输入');
    expect(settings.getChatConfig()).toMatchObject({ protocol: 'openai', apiKey: key });
    await settings.save({ ...changed, apiKey: 'new-key' });
    const restored = create();
    await restored.onModuleInit();
    await expect(restored.save({ ...initial, [switchName]: true, protocol: undefined })).rejects.toThrow('重新输入');
    await restored.save({ ...initial, protocol: undefined });
    expect(restored.getSettings()).toMatchObject({ protocol: 'openai', hasApiKey: false });
    expect(await readFile(join(dataDir, 'chat-settings.json'), 'utf8')).not.toContain('new-key');
  });

  it('clears and disables explicitly, including after a restart', async () => {
    await settings.save({ ...initial, enabled: true, apiKey: key });
    expect(await settings.clearKey()).toEqual({ ...initial, hasApiKey: false });
    expect(await readFile(join(dataDir, 'chat-settings.json'), 'utf8')).not.toContain(key);
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings()).toEqual({ ...initial, hasApiKey: false });
  });

  it('serializes saves and clear without resurrecting a cleared key', async () => {
    await Promise.all([
      settings.save({ ...initial, apiKey: key }),
      settings.clearKey(),
      settings.save({ ...initial, model: 'next-model', apiKey: '' }),
    ]);
    expect(settings.getSettings()).toEqual({ ...initial, model: 'next-model', hasApiKey: false });
  });

  it('fails closed and redacts corrupted persisted contents', async () => {
    await writeFile(join(dataDir, 'chat-settings.json'), `not-json-${key}`);
    await expect(create().onModuleInit()).rejects.toThrow('Cannot load chat settings');
    await expect(create().onModuleInit()).rejects.not.toThrow(key);
  });

  it('does not change memory or leave a secret temp file when saving fails', async () => {
    await mkdir(join(dataDir, 'chat-settings.json'));
    await expect(settings.save({ ...initial, apiKey: key })).rejects.toThrow('无法保存');
    expect(settings.getSettings()).toEqual({ ...initial, hasApiKey: false });
    expect(await readdir(dataDir)).toEqual(['chat-settings.json']);
  });

  it.each([
    'https://api.openai.com:444/v1', 'https://api.openai.com.other-provider.com/v1',
    'https://custom-chat-provider.com:8443/api/v2',
  ])('accepts arbitrary public endpoint %s without a vendor allowlist', async (baseURL) => {
    await settings.save({ ...initial, baseURL, model: 'vendor/custom-model' });
    expect(settings.getSettings()).toMatchObject({ baseURL, model: 'vendor/custom-model' });
  });

  it.each([
    'http://api.openai.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://169.254.169.254/latest',
    'https://10.0.0.1/v1',
    'https://api.openai.com@127.0.0.1/v1',
    'https://api.openai.com/%2f%2f127.0.0.1',
    'https://api.openai.com/\r\nv1',
    'https://user:password@api.openai.com/v1',
    'https://api.openai.com/v1?redirect=evil',
    'https://api.openai.com/v1#fragment',
    'https://api.openai.com/v1/../private',
    'https://api.openai.com/v1//',
  ])('rejects unsupported URL %s before persisting', async (baseURL) => {
    await expect(settings.save({ ...initial, baseURL, apiKey: key })).rejects.toThrow('设置无效');
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('migrates an old file without losing the key, endpoint, model or chat switch', async () => {
    const legacy = { enabled: true, baseURL: 'https://api.deepseek.com', model: 'legacy-model', apiKey: key };
    const file = join(dataDir, 'chat-settings.json');
    await writeFile(file, JSON.stringify(legacy));
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getChatConfig()).toEqual({ ...legacy, modelingEnabled: false, ...defaults });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(legacy);
    await restored.save({ ...legacy, modelingEnabled: true, apiKey: undefined });
    expect(restored.getChatConfig().apiKey).toBe(key);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject(defaults);
  });

  it('requires a key for modeling alone and clears both independent switches', async () => {
    await expect(settings.save({ ...initial, modelingEnabled: true })).rejects.toThrow('API Key');
    await settings.save({ ...initial, modelingEnabled: true, apiKey: key });
    expect(settings.getSettings()).toMatchObject({ enabled: false, modelingEnabled: true, hasApiKey: true });
    const snapshot = settings.getChatConfig();
    snapshot.apiKey = 'not-the-stored-key';
    expect(settings.getChatConfig().apiKey).toBe(key);
    const restored = create();
    await restored.onModuleInit();
    expect(restored.getSettings().modelingEnabled).toBe(true);
    await restored.save({ ...initial, modelingEnabled: true, enabled: true });
    expect(await restored.clearKey()).toMatchObject({ enabled: false, modelingEnabled: false, hasApiKey: false });
  });

  it('rejects invalid DTO values without including input secrets in errors', async () => {
    const invalid = [
      { ...initial, modelingEnabled: 'true' }, { ...initial, modelingEnabled: null },
      { ...initial, modelingEnabled: undefined }, { ...initial, enabled: 'false' }, { ...initial, model: '' },
      { ...initial, model: '  ' }, { ...initial, model: 'bad\nmodel' },
      { ...initial, apiKey: null }, { ...initial, apiKey: `bad key ${key}` },
      { ...initial, apiKey: '\r\nheader' }, { ...initial, extra: key },
      ...[
        { protocol: 'unknown' }, { protocol: null }, { jsonMode: 'false' }, { jsonMode: null },
        { tokenParameter: 'tokens' }, { tokenParameter: null },
        { maxOutputTokens: 0 }, { maxOutputTokens: 65537 }, { maxOutputTokens: 1.5 },
        { maxOutputTokens: '10000' }, { maxOutputTokens: null }, { maxOutputTokens: NaN },
        { baseURL: `https://api.example.com/${'x'.repeat(2048)}` },
      ].map((invalid) => ({ ...initial, ...invalid })),
    ];
    for (const input of invalid) {
      expect(validateSync(Object.assign(new SaveChatSettingsDto(), input), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
      await expect(settings.save(input as never)).rejects.toThrow('设置无效');
      await expect(settings.save(input as never)).rejects.not.toThrow(key);
    }
  });
});
