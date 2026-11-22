import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CompatibleChatService } from './compatible-chat.service';
import { ModelingDiagnosticsService } from './modeling-diagnostics.service';
import { parseModelingJson } from './modeling-json';

describe('model response notation and local diagnostics', () => {
  it.each([
    '{"color":"#ffffff", "points":[[0,0],[1,1],],}',
    '```json\n{"color":"#ffffff", // model note\n"points":[[0,0],[1,1]]}\n```',
    '```{"color":"#ffffff", "points":[[0,0],[1,1]]}```',
    '<think>Plan the shape carefully.</think>\n{"color":"#ffffff", /* note */ "points":[[0,0],[1,1]]}',
  ])('accepts harmless format wrappers without inventing any geometry', (content) => {
    expect(parseModelingJson(content)).toEqual({ color: '#ffffff', points: [[0, 0], [1, 1]] });
  });

  it('preserves quoted comment markers, braces and escaped quotes exactly', () => {
    const value = { label: 'a // b /* c */ ,} ,] "quoted" \\ end', nested: [{ text: 'https://example.invalid/a' }] };
    expect(parseModelingJson(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    '{"objects":[', 'prefix {"ok":true}', '{} trailing', '{} {}',
    '```json\n{}\n```\n```json\n{}\n```', 'const scene = {"ok":true}',
    '<think>never closed {"ok":true}', '{"x":1/* comment */2}', '{"x":/* never closed',
    '{"x":NaN}', "{'x':1}",
  ])('rejects truncated, ambiguous and executable output', (content) => {
    expect(() => parseModelingJson(content)).toThrow();
  });

  it('retains a bounded local failure response, without storing keys or repeating HTTP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-model-diagnostics-'));
    const diagnostics = new ModelingDiagnosticsService({ dataDir: directory, aiMode: 'mock', port: 4000 });
    const config = { enabled: false, modelingEnabled: true, baseURL: 'https://api.example.com/v1', model: 'offline', apiKey: 'offline-secret-only' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"objects":[' } }] })));
    const client = new CompatibleChatService(fetcher, diagnostics);
    try {
      await expect(client.structuredCompletion(config, 'JSON only', 'a camp')).rejects.toThrow('未返回合法 JSON');
      const files = await readdir(join(directory, 'modeling-diagnostics'));
      expect(files).toHaveLength(1);
      const raw = await readFile(join(directory, 'modeling-diagnostics', files[0]!), 'utf8');
      expect(JSON.parse(raw)).toMatchObject({ stage: '建模', reason: 'json', response: '{"objects":[' });
      expect(raw).not.toContain(config.apiKey);
      expect(fetcher).toHaveBeenCalledOnce();
      const escapedKey = [...config.apiKey].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
      await diagnostics.retain('建模', `{"key":"${escapedKey}"}`, config.apiKey, 'json');
      const saved = await Promise.all((await readdir(join(directory, 'modeling-diagnostics'))).map(async (file) => JSON.parse(await readFile(join(directory, 'modeling-diagnostics', file), 'utf8'))));
      expect(saved.find((entry) => entry.responseOmitted)).toMatchObject({ responseOmitted: 'credential-echo' });
      expect(saved.some((entry) => entry.response?.includes(escapedKey))).toBe(false);
    } finally {
      await client.onModuleDestroy();
      if (!resolve(directory).startsWith(resolve(tmpdir(), 'studio-model-diagnostics-'))) throw new Error('Unexpected temporary directory');
      await rm(directory, { recursive: true, force: true });
    }
  });
});
