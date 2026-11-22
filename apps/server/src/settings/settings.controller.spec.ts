import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { CompatibleChatService } from './compatible-chat.service';

const input = { enabled: false, modelingEnabled: false, baseURL: 'https://api.openai.com/v1', model: 'stub-model', apiKey: 'stub-key-never-valid-123' };

describe('SettingsController', () => {
  let directory: string;
  let settings: SettingsService;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let controller: SettingsController;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-settings-controller-'));
    settings = new SettingsService({ port: 4000, aiMode: 'mock', dataDir: directory });
    await settings.onModuleInit();
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })));
    controller = new SettingsController(settings, new CompatibleChatService(fetcher));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('requires the custom header for every settings endpoint, including explicit tests', async () => {
    expect(() => controller.get(undefined)).toThrow('Missing local');
    expect(() => controller.save('wrong', input)).toThrow('Missing local');
    expect(() => controller.clear(undefined)).toThrow('Missing local');
    await expect(controller.test(undefined)).rejects.toThrow('Missing local');
    expect(fetcher).not.toHaveBeenCalled();
    expect(settings.getSettings().hasApiKey).toBe(false);
  });

  it('never returns keys or calls a provider on read/save/clear', async () => {
    const saved = await controller.save('local-ui', input);
    const read = controller.get('local-ui');
    const cleared = await controller.clear('local-ui');
    for (const response of [saved, read, cleared]) {
      expect(response).not.toHaveProperty('apiKey');
      expect(JSON.stringify(response)).not.toContain(input.apiKey);
    }
    expect(read.hasApiKey).toBe(true);
    expect(cleared.hasApiKey).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('tests only the saved configuration on explicit request, even while disabled', async () => {
    await controller.save('local-ui', input);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await controller.test('local-ui')).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(settings.getSettings().enabled).toBe(false);
    const [, init] = fetcher.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe(input.model);
    expect(body.max_tokens).toBe(16);
    expect(body.messages).toEqual([{ role: 'user', content: 'Reply with OK only.' }]);
    expect(body).not.toHaveProperty('response_format');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${input.apiKey}`);
  });
});
