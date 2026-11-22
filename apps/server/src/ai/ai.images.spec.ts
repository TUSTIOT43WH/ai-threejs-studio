import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConceptGenerationRequest } from '@ai-three-studio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';
import { LiveConceptImageProvider } from './live-concept-provider';
import { MockChatProvider } from './mock/mock-chat-provider';
import { MockConceptImageProvider } from './mock/mock-concept-provider';
import { MockImageAnalyzer } from './mock/mock-image-analyzer';
import { MockPromptExpander } from './mock/mock-prompt-expander';
import { MockWorldPlanner } from './mock/mock-world-planner';
import { ImageSettingsService } from '../settings/image-settings.service';
import { SettingsService } from '../settings/settings.service';
import { MetaController } from '../meta/meta.controller';

const input = { enabled: true, baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'image-only-key' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=';

describe('AiService independent image routing (fake transport)', () => {
  let directory: string;
  let chat: SettingsService;
  let images: ImageSettingsService;
  let ai: AiService;
  let mock: MockConceptImageProvider;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let request: ConceptGenerationRequest;
  const create = (live?: LiveConceptImageProvider) => new AiService(
    new MockPromptExpander(), mock, new MockImageAnalyzer(), new MockWorldPlanner(), new MockChatProvider(),
    chat, undefined, images, live,
  );

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-ai-images-'));
    const config = { port: 4000, aiMode: 'mock' as const, dataDir: directory };
    chat = new SettingsService(config);
    images = new ImageSettingsService(config);
    await Promise.all([chat.onModuleInit(), images.onModuleInit()]);
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: png }] }), { headers: { 'content-type': 'application/json' } }));
    mock = new MockConceptImageProvider();
    vi.spyOn(mock, 'generate');
    ai = create(new LiveConceptImageProvider(fetcher));
    request = { projectId: 'spec', prompt: '一艘太空飞船', expansion: await ai.expandPrompt({ prompt: '林中小屋' }), count: 3, mode: 'initial', batchSeed: 24, existingStyleIds: [], referenceImageDataUrl: 'data:image/png;base64,UNUSED' };
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('uses honestly marked Mock images by default even when modeling and chat are live', async () => {
    await chat.save({ ...input, apiKey: 'chat-only-key', modelingEnabled: true });
    const generated = await ai.generateConcepts(request);
    expect(generated.every((image) => image.mock && !image.referenceDriven)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mock.generate).toHaveBeenCalledOnce();
    expect(ai.describeProviders().find((provider) => provider.kind === 'image')?.mode).toBe('mock');
    expect(images.getSettings()).toMatchObject({ enabled: false, hasApiKey: false });
    await expect(images.save({ ...input, apiKey: undefined })).rejects.toThrow('独立');
  });

  it('enables only real images with independent meta/health reporting', async () => {
    const meta = new MetaController(ai);
    expect(meta.getHealth().aiMode).toBe('mock');
    await images.save(input);
    const generated = await ai.generateConcepts(request);
    expect(generated.every((image) => !image.mock && !image.referenceDriven)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(mock.generate).not.toHaveBeenCalled();
    expect(ai.describeProviders().find((provider) => provider.kind === 'image')?.mode).toBe('live');
    expect(ai.describeProviders().filter((provider) => provider.kind !== 'image').every((provider) => provider.mode === 'mock')).toBe(true);
    expect(meta.getMeta().aiMode).toBe('live');
    expect(meta.getHealth().aiMode).toBe('live');
    expect(meta.getMeta().disclaimers.join(' ')).toContain('独立的图片设置');
    expect(meta.getMeta().disclaimers.join(' ')).toContain('先读取所选真实预览图');
    expect((await ai.chat({ message: 'hello' })).mock).toBe(true);
  });

  it('keeps real preview input as the original description without template expansion or an early modeling call', async () => {
    await images.save(input);
    const prompt = '精致的红白火箭';
    expect(await ai.expandPrompt({ prompt })).toMatchObject({
      expandedPrompt: prompt, interpretedIntent: prompt, sceneLabel: prompt,
      keyElements: [], provider: 'user-description', mock: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses saved changes on the next generation without changing or using the chat key', async () => {
    await chat.save({ ...input, modelingEnabled: true, apiKey: 'chat-only-key', model: 'chat-model' });
    await images.save(input);
    await ai.generateConcepts({ ...request, count: 1 });
    await images.save({ ...input, model: 'dall-e-3', apiKey: 'next-image-key' });
    await ai.generateConcepts({ ...request, count: 1 });
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).model).toBe('dall-e-3');
    expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({ Authorization: 'Bearer next-image-key' });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('chat-only-key');
    await images.clearKey();
    expect((await ai.generateConcepts(request)).every((image) => image.mock)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(chat.getChatConfig()).toMatchObject({ enabled: true, modelingEnabled: true, apiKey: 'chat-only-key', model: 'chat-model' });
  });

  it('clearing chat keys cannot disable or clear real image settings', async () => {
    await images.save(input);
    await chat.save({ ...input, modelingEnabled: true, apiKey: 'chat-key' });
    await chat.clearKey();
    await ai.generateConcepts({ ...request, count: 1 });
    expect(images.getImageConfig()).toEqual({ ...input, protocol: 'openai', size: '', responseFormat: 'auto' });
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: `Bearer ${input.apiKey}` });
  });

  it('never falls back to Mock if enabled transport or provider is unavailable', async () => {
    await images.save(input);
    fetcher.mockRejectedValue(new Error(`sensitive-${input.apiKey}`));
    await expect(ai.generateConcepts(request)).rejects.toThrow('未切换为 Mock');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mock.generate).not.toHaveBeenCalled();
    await expect(create().generateConcepts(request)).rejects.toThrow('未切换为 Mock');
    expect(mock.generate).not.toHaveBeenCalled();
  });
});
