import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';
import { MockChatProvider } from './mock/mock-chat-provider';
import { MockConceptImageProvider } from './mock/mock-concept-provider';
import { MockImageAnalyzer } from './mock/mock-image-analyzer';
import { MockPromptExpander } from './mock/mock-prompt-expander';
import { MockWorldPlanner } from './mock/mock-world-planner';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import { SettingsService } from '../settings/settings.service';
import { MetaController } from '../meta/meta.controller';
import { completionResponse, planRequest, previewArtifact } from './world-plan.fixture';

const input = { enabled: true, modelingEnabled: false, baseURL: 'https://api.openai.com/v1', model: 'stub-model', apiKey: 'stub-key-never-valid-123' };

describe('AiService settings-based chat selection (no real HTTP)', () => {
  let directory: string;
  let settings: SettingsService;
  let ai: AiService;
  let mock: MockChatProvider;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-ai-chat-spec-'));
    settings = new SettingsService({ port: 4000, aiMode: 'mock', dataDir: directory });
    await settings.onModuleInit();
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Live text' } }] })));
    mock = new MockChatProvider();
    vi.spyOn(mock, 'reply');
    ai = new AiService(new MockPromptExpander(), new MockConceptImageProvider(), new MockImageAnalyzer(), new MockWorldPlanner(), mock, settings, new CompatibleChatService(fetcher));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('uses Mock by default without HTTP, preserving the original five-provider constructor', async () => {
    expect((await ai.chat({ message: 'hello' })).mock).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mock.reply).toHaveBeenCalledOnce();
    expect(ai.describeProviders().every((provider) => provider.mode === 'mock')).toBe(true);
  });

  it('enables real chat only; generation providers remain honestly Mock', async () => {
    await settings.save(input);
    expect(await ai.chat({ message: 'hello' })).toMatchObject({ mock: false, content: 'Live text' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mock.reply).not.toHaveBeenCalled();
    expect(ai.describeProviders().find((provider) => provider.kind === 'chat')?.mode).toBe('live');
    expect(ai.describeProviders().filter((provider) => provider.kind !== 'chat').every((provider) => provider.mode === 'mock')).toBe(true);
    expect((await ai.expandPrompt({ prompt: '林中小屋' })).mock).toBe(true);
  });

  it('uses updated settings on the next call and returns to Mock only when disabled', async () => {
    await settings.save(input);
    await ai.chat({ message: 'one' });
    await settings.save({ ...input, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'different-stub-key' });
    await ai.chat({ message: 'two' });
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.deepseek.com/chat/completions');
    await settings.clearKey();
    expect((await ai.chat({ message: 'three' })).mock).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('selects live planWorld independently of chat and exposes truthful meta/health', async () => {
    const meta = new MetaController(ai);
    expect(meta.getHealth().aiMode).toBe('mock');
    await settings.save({ ...input, enabled: false, modelingEnabled: true });
    fetcher.mockImplementationOnce(async () => completionResponse());
    expect((await ai.planWorld(planRequest(), previewArtifact())).source.provider).toMatchObject({ mode: 'live', planner: 'openai-compatible:stub-model' });
    expect((await ai.chat({ message: 'hello' })).mock).toBe(true);
    expect(meta.getMeta().aiMode).toBe('live');
    expect(meta.getHealth().aiMode).toBe('live');
    expect(meta.getMeta().providers.find((provider) => provider.kind === 'chat')?.mode).toBe('mock');
    expect(meta.getMeta().disclaimers.join(' ')).toContain('先读取所选真实预览图');
    expect(fetcher).toHaveBeenCalledOnce();
    await settings.clearKey();
    expect(meta.getMeta().aiMode).toBe('mock');
  });

  it('forwards the validating-stage callback through a captured live planner', async () => {
    await settings.save({ ...input, enabled: false, modelingEnabled: true });
    fetcher.mockImplementationOnce(async () => completionResponse());
    const onStage = vi.fn();
    await ai.captureWorldPlanner().plan(planRequest(), onStage, previewArtifact());
    expect(onStage).toHaveBeenCalledExactlyOnceWith('validating');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('invalidates world reuse for protocol and generation options without putting secrets in the cache key', async () => {
    const base = { ...input, modelingEnabled: true };
    await settings.save(base);
    const original = ai.captureWorldPlanner();
    expect(JSON.parse(original.key).pipeline).toBe('visual-parametric-scene-v4');
    const keys = [original.key];
    for (const options of [
      { jsonMode: true },
      { tokenParameter: 'max_completion_tokens' as const },
      { maxOutputTokens: 8192 },
      { protocol: 'anthropic' as const },
    ]) {
      await settings.save({ ...base, ...options });
      keys.push(ai.getWorldPlannerKey());
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.join('')).not.toContain(input.apiKey);
    fetcher.mockImplementationOnce(async () => completionResponse());
    await original.plan(planRequest(), undefined, previewArtifact());
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).not.toHaveProperty('response_format');
    expect(ai.describeProviders().find((provider) => provider.kind === 'world-planner')?.id).toBe('anthropic-world-planner');
  });

  it('never silently falls back to Mock after an enabled provider fails', async () => {
    await settings.save(input);
    fetcher.mockRejectedValue(new Error('stub upstream failure'));
    await expect(ai.chat({ message: 'hello' })).rejects.toThrow('未切换为 Mock');
    expect(mock.reply).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
