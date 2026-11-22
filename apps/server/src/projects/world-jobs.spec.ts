import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSync } from 'class-validator';
import { HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  MAX_MODELING_PROMPT_LENGTH,
  type WorldGenerationJob,
} from '@ai-three-studio/shared';
import { AiService } from '../ai/ai.service';
import { MockChatProvider } from '../ai/mock/mock-chat-provider';
import { MockConceptImageProvider } from '../ai/mock/mock-concept-provider';
import { MockImageAnalyzer } from '../ai/mock/mock-image-analyzer';
import { MockPromptExpander } from '../ai/mock/mock-prompt-expander';
import { MockWorldPlanner } from '../ai/mock/mock-world-planner';
import { completionResponse, previewArtifact, sceneDraft, visionDraft, visionReport } from '../ai/world-plan.fixture';
import { renderThreeJsExpansionTemplate } from '../ai/threejs-expansion-template';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import { SettingsService } from '../settings/settings.service';
import { GenerateWorldDto, PrepareWorldPromptDto } from './dto';
import { ProjectStore } from './project.store';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { INTERRUPTED_WORLD_JOB, WorldJobStore } from './world-job.store';

const input = { enabled: false, modelingEnabled: true, baseURL: 'https://api.openai.com/v1', model: 'stub-model', apiKey: 'stub-key-never-valid-123' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('async world jobs (temporary storage, no real HTTP)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let jobs: WorldJobStore;
  let settings: SettingsService;
  let ai: AiService;
  let service: ProjectsService;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let mockPlanner: MockWorldPlanner;
  let mockAnalyzer: MockImageAnalyzer;
  const wait = async (job: WorldGenerationJob, status: 'succeeded' | 'failed' = 'succeeded') => {
    await vi.waitFor(() => expect(service.getWorldJob(job.projectId, job.id).status).toBe(status), { timeout: 3000, interval: 5 });
    return service.getWorldJob(job.projectId, job.id);
  };
  const project = async () => {
    const { project: created } = await service.createProject({ prompt: '红白火箭' });
    const record = structuredClone(store.get(created.id)!);
    // Stand in for real previews with stored offline PNGs; never call an image API.
    for (const concept of record.project.concepts) {
      concept.mock = false;
      record.artifacts[concept.id] = previewArtifact();
    }
    await store.save(record);
    return service.getProject(created.id);
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'studio-world-jobs-'));
    const config = { dataDir, port: 4000, aiMode: 'mock' as const };
    store = new ProjectStore(config); await store.onModuleInit();
    settings = new SettingsService(config); await settings.onModuleInit();
    fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      const user = body.messages.find((message: { role: string }) => message.role === 'user');
      const text = Array.isArray(user.content) ? user.content[0].text : user.content;
      return text.startsWith('{') ? completionResponse() : completionResponse(visionReport());
    });
    mockPlanner = new MockWorldPlanner(); vi.spyOn(mockPlanner, 'plan');
    mockAnalyzer = new MockImageAnalyzer();
    ai = new AiService(new MockPromptExpander(), new MockConceptImageProvider(), mockAnalyzer, mockPlanner, new MockChatProvider(), settings, new CompatibleChatService(fetcher));
    jobs = new WorldJobStore(config, store);
    service = new ProjectsService(store, ai, jobs);
    await service.onModuleInit();
  });
  afterEach(async () => { await jobs.flush(); vi.useRealTimers(); vi.restoreAllMocks(); await rm(dataDir, { recursive: true, force: true }); });

  it('returns pending immediately, exposes running/succeeded, deduplicates and protects mutations', async () => {
    await settings.save(input);
    const p = await project();
    const pendingResponse = deferred<Response>();
    fetcher.mockReturnValueOnce(pendingResponse.promise);
    const controller = new ProjectsController(service);
    const pending = await controller.generateWorld(p.id, { conceptId: p.concepts[0]!.id });
    expect(pending).toMatchObject({
      status: 'pending', phase: 'queued', projectId: p.id,
      conceptId: p.concepts[0]!.id, projectTitle: p.expansion.sceneLabel,
      createdAt: expect.any(String), updatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(pending.createdAt))).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    const persistedPending = JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8'));
    expect(persistedPending.jobs[0].job).toMatchObject({ id: pending.id, projectId: p.id });
    const duplicatePending = await service.generateWorld(p.id, { conceptId: p.concepts[1]!.id, regenerate: true });
    expect(duplicatePending.id).toBe(pending.id);
    await expect(service.generateConcepts(p.id, { mode: 'more' })).rejects.toMatchObject({ status: 409 });
    await expect(service.saveWorld(p.id, { world: {} })).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 5 });
    expect(controller.getWorldJob(p.id, pending.id).status).toBe('running');
    expect((await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id })).id).toBe(pending.id);
    pendingResponse.resolve(completionResponse(visionReport()));
    const result = await wait(pending);
    expect(result.world?.meta.mock).toBe(false);
    expect(result.analysis?.mock).toBe(false);
    expect(result.world?.source.conceptId).toBe(p.concepts[0]!.id);
    expect(service.getProject(p.id).world?.id).toBe(result.world?.id);
    result.world!.title = 'do not mutate the job';
    expect(service.getWorldJob(p.id, pending.id).world?.title).toBe('火箭');
    expect(pending.status).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('expands the chosen PNG before generating a structured scene from its modeling prompt', async () => {
    await settings.save(input);
    const p = await project(); const chosen = p.concepts[1]!;
    const record = structuredClone(store.get(p.id)!);
    const artifact = previewArtifact();
    // Only the selected preview has pixels: using the first concept or its URL must fail.
    record.artifacts = { [chosen.id]: artifact };
    await store.save(record);
    const expanding = deferred<Response>(); const generating = deferred<Response>();
    fetcher.mockReturnValueOnce(expanding.promise).mockReturnValueOnce(generating.promise);
    const transitions: string[] = [];
    const update = jobs.update.bind(jobs);
    vi.spyOn(jobs, 'update').mockImplementation((job, target) => {
      transitions.push(job.phase);
      return update(job, target);
    });
    const pending = await service.generateWorld(p.id, { conceptId: chosen.id });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 5 });
    expect(service.getWorldJob(p.id, pending.id)).toMatchObject({ status: 'running', phase: 'expanding' });
    expect(JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8')).jobs[0].job.phase).toBe('expanding');
    expect(service.getProject(p.id).world).toBeUndefined();
    const visionBody = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    const expansionUser = visionBody.messages.find((message: { role: string }) => message.role === 'user');
    const templateText = expansionUser.content[0].text as string;
    expect(expansionUser.content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${artifact.data}`, detail: 'high' } });
    expect(templateText).toContain(renderThreeJsExpansionTemplate({
      userPrompt: p.prompt,
      sceneType: '请根据用户描述和预览图自动判断；优先选择构图紧凑、便于观察的三维场景。',
      additionalRequirements: [
        `用户选定的预览图风格：${chosen.styleLabel}（${chosen.styleId}）。`,
        '只输出最终的中文建模提示词，不要输出 A–G 报告、JSON、代码块、模板复述或额外解释。',
      ].join('\n'),
    }));
    expect(templateText).not.toContain('{{');
    expect(JSON.stringify(visionBody)).not.toContain(chosen.imageUrl);
    expanding.resolve(completionResponse(visionReport()));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2), { interval: 5 });
    expect(service.getWorldJob(p.id, pending.id)).toMatchObject({ status: 'running', phase: 'generating' });
    expect(JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8')).jobs[0].job.phase).toBe('generating');
    expect(service.getProject(p.id).world).toBeUndefined();
    const planBody = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    const planParts = planBody.messages.find((message: { role: string }) => message.role === 'user').content;
    expect(planParts[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${artifact.data}`, detail: 'high' } });
    const planContent = planParts[0].text;
    expect(planContent).toBeTypeOf('string');
    const { modelingPrompt, sceneSummary, composition, styleNotes, detectedElements, palette, assumptions } = visionDraft();
    expect(JSON.parse(planContent)).toEqual({ prompt: p.prompt, conceptStyleId: chosen.styleId, modelingPrompt,
      visualAnalysis: { sceneSummary, composition, styleNotes, detectedElements, palette, assumptions } });
    expect(planContent).not.toContain(artifact.data);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/chat/completions',
    ]);
    expect([visionBody.model, planBody.model]).toEqual([input.model, input.model]);
    generating.resolve(completionResponse());
    const complete = await wait(pending); await jobs.flush();
    expect(complete.analysis).toMatchObject({ ...visionDraft(), mock: false, provider: 'openai:vision:stub-model' });
    expect(complete.world).toMatchObject({ title: '火箭', meta: { mock: false, objectCount: 4 },
      source: { conceptId: chosen.id, provider: { mode: 'live' } } });
    expect(complete.world?.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ground' }),
      expect.objectContaining({ name: 'Rocket body', kind: 'primitive', params: { shape: 'cylinder' } }),
    ]));
    expect(service.getProject(p.id)).toMatchObject({ selectedConceptId: chosen.id, analysis: complete.analysis, world: complete.world });
    expect(transitions).toEqual(['expanding', 'generating', 'validating', 'saving', 'complete']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('prepares an expansion, reuses it, and only starts modeling after an edited confirmation', async () => {
    await settings.save(input);
    const p = await project();
    const concept = p.concepts[1]!;
    const prepared = await service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    expect(prepared).toMatchObject({
      conceptId: concept.id,
      reused: false,
      draftId: expect.any(String),
      analysis: { mock: false, modelingPrompt: visionDraft().modelingPrompt },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const visionBody = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(Array.isArray(visionBody.messages.find((message: { role: string }) => message.role === 'user').content)).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(service.listWorldJobs().jobs).toHaveLength(0);
    expect(service.getProject(p.id).world).toBeUndefined();
    expect(store.get(p.id)?.worldPromptDraft).toMatchObject({ id: prepared.draftId, conceptId: concept.id });
    const rawProject = await readFile(join(dataDir, `projects/${p.id}.json`), 'utf8');
    expect(rawProject).toContain(prepared.draftId);
    expect(rawProject).not.toContain(input.apiKey);

    const reused = await service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    expect(reused).toMatchObject({ draftId: prepared.draftId, reused: true });
    expect(fetcher).toHaveBeenCalledOnce();

    const edited = '用户编辑后的火箭建模提示词：主体更瘦长，额外加入四个尾翼。';
    const transitions: string[] = [];
    const update = jobs.update.bind(jobs);
    vi.spyOn(jobs, 'update').mockImplementation((job, target) => {
      transitions.push(job.phase);
      return update(job, target);
    });
    const pending = await service.generateWorld(p.id, {
      conceptId: concept.id,
      promptDraftId: prepared.draftId,
      modelingPrompt: `  ${edited}  `,
    });
    expect(pending).toMatchObject({ status: 'pending', phase: 'queued', conceptId: concept.id });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2), { interval: 5 });
    const planBody = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    const planParts = planBody.messages.find((message: { role: string }) => message.role === 'user').content;
    expect(planParts[1].type).toBe('image_url');
    const planContent = planParts[0].text;
    expect(planContent).toBeTypeOf('string');
    expect(JSON.parse(planContent)).toMatchObject({
      prompt: p.prompt,
      conceptStyleId: concept.styleId,
      modelingPrompt: edited,
      visualAnalysis: {
        sceneSummary: visionDraft().sceneSummary,
        composition: visionDraft().composition,
        styleNotes: visionDraft().styleNotes,
        detectedElements: visionDraft().detectedElements,
        palette: visionDraft().palette,
        assumptions: visionDraft().assumptions,
      },
    });
    expect(planContent).not.toContain(previewArtifact().data);
    const complete = await wait(pending);
    await jobs.flush();
    expect(transitions).toEqual(['generating', 'validating', 'saving', 'complete']);
    expect(complete.analysis).toMatchObject({
      modelingPrompt: edited,
      report: { finalPrompt: edited },
    });
    expect(service.getProject(p.id).analysis).toMatchObject({ modelingPrompt: edited });
    expect(store.get(p.id)?.worldPromptDraft).toBeUndefined();
    expect(await readFile(join(dataDir, `projects/${p.id}.json`), 'utf8')).not.toContain(prepared.draftId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('shares one in-flight expansion for concurrent duplicate prepare requests', async () => {
    await settings.save(input);
    const p = await project();
    const concept = p.concepts[1]!;
    const expanding = deferred<Response>();
    fetcher.mockReturnValueOnce(expanding.promise);

    const first = service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    const duplicate = service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 5 });
    await expect(service.prepareWorldPrompt(p.id, { conceptId: p.concepts[0]!.id }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.generateConcepts(p.id, { mode: 'more' }))
      .rejects.toMatchObject({ status: 409 });

    expanding.resolve(completionResponse(visionReport()));
    const [prepared, shared] = await Promise.all([first, duplicate]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(prepared).toMatchObject({ conceptId: concept.id, reused: false });
    expect(shared).toEqual(prepared);
    expect(shared).not.toBe(prepared);
    expect(store.get(p.id)?.worldPromptDraft?.id).toBe(prepared.draftId);

    const reused = await service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    expect(reused).toMatchObject({ draftId: prepared.draftId, reused: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reuses saved world analysis, keeps edits after failure, and retries without re-expansion', async () => {
    const p = await project();
    await expect(service.prepareWorldPrompt(p.id, { conceptId: p.concepts[0]!.id })).rejects.toThrow(/Mock 建模/);
    expect(fetcher).not.toHaveBeenCalled();
    await settings.save(input);
    const dto = { conceptId: p.concepts[0]!.id };
    const first = await wait(await service.generateWorld(p.id, dto));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const prepared = await service.prepareWorldPrompt(p.id, { conceptId: dto.conceptId });
    expect(prepared).toMatchObject({ reused: true });
    expect(prepared.analysis.modelingPrompt).toBe(first.analysis!.modelingPrompt);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const edited = '失败后应保留的可编辑火箭提示词，包含四个尾翼。';
    fetcher.mockResolvedValueOnce(completionResponse('not JSON'));
    const failed = await wait(await service.generateWorld(p.id, {
      ...dto,
      regenerate: true,
      promptDraftId: prepared.draftId,
      modelingPrompt: edited,
    }), 'failed');
    expect(failed.error).toContain('合法 JSON');
    expect(service.getProject(p.id).world?.id).toBe(first.world!.id);
    expect(store.get(p.id)?.worldPromptDraft).toMatchObject({
      id: prepared.draftId,
      analysis: { modelingPrompt: edited },
    });
    expect(service.getProject(p.id)).not.toHaveProperty('worldPromptDraft');
    expect(fetcher).toHaveBeenCalledTimes(3);

    const retryPrepared = await service.prepareWorldPrompt(p.id, { conceptId: dto.conceptId });
    expect(retryPrepared).toMatchObject({ draftId: prepared.draftId, reused: true, analysis: { modelingPrompt: edited } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const retry = await wait(await service.generateWorld(p.id, {
      ...dto,
      regenerate: true,
      promptDraftId: prepared.draftId,
      modelingPrompt: edited,
    }));
    expect(retry.analysis).toMatchObject({ modelingPrompt: edited, report: { finalPrompt: edited } });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(store.get(p.id)?.worldPromptDraft).toBeUndefined();
  });

  it('rejects incomplete, mismatched and stale prompt confirmations without a provider call', async () => {
    await settings.save(input);
    const p = await project();
    const concept = p.concepts[0]!;
    const prepared = await service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(service.generateWorld(p.id, {
      conceptId: concept.id,
      promptDraftId: prepared.draftId,
    })).rejects.toThrow('同时提供');
    await expect(service.generateWorld(p.id, {
      conceptId: concept.id,
      modelingPrompt: 'edited only',
    })).rejects.toThrow('同时提供');
    await expect(service.generateWorld(p.id, {
      conceptId: concept.id,
      promptDraftId: prepared.draftId,
      modelingPrompt: '   ',
    })).rejects.toThrow('不能为空');
    await expect(service.generateWorld(p.id, {
      conceptId: concept.id,
      promptDraftId: prepared.draftId,
      modelingPrompt: 'x'.repeat(MAX_MODELING_PROMPT_LENGTH + 1),
    })).rejects.toThrow('过长');
    await expect(service.generateWorld(p.id, {
      conceptId: concept.id,
      promptDraftId: randomUUID(),
      modelingPrompt: 'edited',
    })).rejects.toMatchObject({ status: 409 });
    await expect(service.generateWorld(p.id, {
      conceptId: p.concepts[1]!.id,
      promptDraftId: prepared.draftId,
      modelingPrompt: 'edited',
    })).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(service.listWorldJobs().jobs).toHaveLength(0);
    expect(service.getProject(p.id).world).toBeUndefined();

    const nextBatch = await service.generateConcepts(p.id, { mode: 'more' });
    expect(store.get(p.id)?.worldPromptDraft).toBeUndefined();
    expect(nextBatch.concepts.some((entry) => entry.id === concept.id)).toBe(false);
    await expect(service.generateWorld(p.id, {
      conceptId: nextBatch.concepts[0]!.id,
      promptDraftId: prepared.draftId,
      modelingPrompt: 'edited',
    })).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refuses to start planning when the edited prompt cannot be persisted', async () => {
    await settings.save(input);
    const p = await project();
    const concept = p.concepts[0]!;
    const prepared = await service.prepareWorldPrompt(p.id, { conceptId: concept.id });
    expect(fetcher).toHaveBeenCalledOnce();
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error(`PRIVATE storage failure ${input.apiKey}`));
    await expect(service.generateWorld(p.id, {
      conceptId: concept.id,
      promptDraftId: prepared.draftId,
      modelingPrompt: 'edited but unsavable',
    })).rejects.toThrow('保存编辑后的建模提示词失败');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(service.listWorldJobs().jobs).toHaveLength(0);
    expect(store.get(p.id)?.worldPromptDraft?.analysis.modelingPrompt).toBe(visionDraft().modelingPrompt);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not retry or plan when the prepared draft itself cannot be saved', async () => {
    await settings.save(input);
    const p = await project();
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('PRIVATE storage failure'));
    await expect(service.prepareWorldPrompt(p.id, { conceptId: p.concepts[0]!.id }))
      .rejects.toThrow('保存提示词草稿失败');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(service.listWorldJobs().jobs).toHaveLength(0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(mockPlanner.plan).not.toHaveBeenCalled();
  });

  it.each(['mock PNG', 'mock SVG', 'SVG', 'legacy SVG', 'missing raster'] as const)(
    'rejects %s before any paid request or mock fallback', async (invalid) => {
      await settings.save(input);
      const p = await project(); const record = structuredClone(store.get(p.id)!);
      const concept = record.project.concepts[0]!;
      if (invalid.startsWith('mock')) concept.mock = true;
      if (invalid.includes('SVG')) {
        record.artifacts[concept.id] = { mimeType: 'image/svg+xml', encoding: 'utf8',
          data: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 1, height: 1 };
      }
      if (invalid === 'legacy SVG') record.artifacts[concept.id] = '<svg/>';
      if (invalid === 'missing raster') delete record.artifacts[concept.id];
      await store.save(record);
      const failed = await wait(await service.generateWorld(p.id, { conceptId: concept.id }), 'failed');
      expect(failed.error).toContain('需要真实的 PNG / JPEG 概念图');
      expect(failed).not.toHaveProperty('world');
      expect(failed).not.toHaveProperty('analysis');
      expect(service.getProject(p.id).world).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
      expect(mockPlanner.plan).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['malformed report', () => completionResponse('not a report'), '结果校验失败'],
    ['invalid vision schema', () => completionResponse({ ...visionDraft(), modelingPrompt: 'too short' }), '结果校验失败'],
    ['HTTP 400', () => new Response(`PRIVATE provider reply ${input.apiKey}`, { status: 400 }), '拒绝图片输入'],
  ] as const)('stops on %s during expansion and preserves the old world without planning or retrying', async (_label, response, error) => {
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    await wait(await service.generateWorld(p.id, dto));
    const previous = service.getProject(p.id);
    const previousFile = await readFile(join(dataDir, `projects/${p.id}.json`), 'utf8');
    vi.mocked(mockPlanner.plan).mockClear();
    await settings.save(input);
    fetcher.mockResolvedValueOnce(response());
    const failed = await wait(await service.generateWorld(p.id, { ...dto, regenerate: true }), 'failed');
    await jobs.flush();
    expect(failed).toMatchObject({ status: 'failed', phase: 'failed', error: expect.stringContaining(error) });
    expect(failed).not.toHaveProperty('world');
    expect(failed).not.toHaveProperty('analysis');
    expect(JSON.stringify(failed)).not.toMatch(/PRIVATE|stub-key-never/);
    expect(service.getProject(p.id)).toEqual(previous);
    expect(await readFile(join(dataDir, `projects/${p.id}.json`), 'utf8')).toBe(previousFile);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetcher).toHaveBeenCalledOnce();
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(Array.isArray(body.messages.find((message: { role: string }) => message.role === 'user').content)).toBe(true);
    expect(mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('caches compatible scenes, skips cache on regenerate, expires older jobs and restores the newest', async () => {
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    const first = await wait(await service.generateWorld(p.id, dto));
    const cached = await service.generateWorld(p.id, dto);
    expect(cached.status).toBe('succeeded');
    expect(cached.world?.id).toBe(first.world?.id);
    expect(mockPlanner.plan).toHaveBeenCalledOnce();
    expect(() => service.getWorldJob(p.id, first.id)).toThrow('失效');
    const next = await service.generateWorld(p.id, { ...dto, regenerate: true });
    expect(next.status).toBe('pending');
    await wait(next);
    expect(mockPlanner.plan).toHaveBeenCalledTimes(2);
    expect(fetcher).not.toHaveBeenCalled();
    const other = await project();
    expect(() => service.getWorldJob(other.id, next.id)).toThrow('失效');
    await jobs.flush();
    const reloadedJobs = new WorldJobStore({ dataDir, port: 4000, aiMode: 'mock' }, store);
    const restarted = new ProjectsService(store, ai, reloadedJobs);
    await restarted.onModuleInit();
    expect(restarted.getWorldJob(p.id, next.id).status).toBe('succeeded');
    expect((await restarted.generateWorld(p.id, dto)).status).toBe('succeeded');
    expect(mockPlanner.plan).toHaveBeenCalledTimes(2);
  });

  it('does not serve mock cache after modeling is enabled or stale model/endpoint cache', async () => {
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    const mock = await wait(await service.generateWorld(p.id, dto));
    expect(mock.world?.meta.mock).toBe(true);
    await settings.save(input);
    expect(ai.describeProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'world-planner', mode: 'live' }),
      expect.objectContaining({ kind: 'llm', mode: 'live' }),
      expect.objectContaining({ kind: 'vision', mode: 'live' }),
      expect.objectContaining({ kind: 'image', mode: 'mock' }),
      expect.objectContaining({ kind: 'chat', mode: 'mock' }),
    ]));
    const live = await wait(await service.generateWorld(p.id, dto));
    expect(live.world?.source.provider.mode).toBe('live');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await settings.save({ ...input, enabled: true, apiKey: 'new-account-key' });
    expect((await service.generateWorld(p.id, dto)).world?.id).toBe(live.world?.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await settings.save({ ...input, model: 'next-model' });
    const next = await wait(await service.generateWorld(p.id, dto));
    expect(next.world?.source.provider.planner).toBe('openai-compatible:next-model');
    await settings.save({ ...input, baseURL: 'https://api.deepseek.com', apiKey: 'deepseek-stub' });
    await wait(await service.generateWorld(p.id, dto));
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(store.get(p.id))).not.toContain(input.apiKey);
    expect(ai.getWorldPlannerKey()).not.toContain('deepseek-stub');
    await settings.clearKey();
    const backToMock = await wait(await service.generateWorld(p.id, dto));
    expect(backToMock.world?.source.provider.mode).toBe('mock');
    expect(mockPlanner.plan).toHaveBeenCalledTimes(2);
  });

  it('does not reuse incompatible cached concepts, and retains edits on cache hits', async () => {
    const p = await project();
    const first = await wait(await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id }));
    await service.saveWorld(p.id, { world: { ...first.world, title: 'Edited model' } });
    const cached = await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id });
    expect(cached.world?.title).toBe('Edited model');
    const other = await wait(await service.generateWorld(p.id, { conceptId: p.concepts[1]!.id }));
    expect(other.world?.source.conceptId).toBe(p.concepts[1]!.id);
    expect(mockPlanner.plan).toHaveBeenCalledTimes(2);
  });

  it('keeps an old world on failure and allows manual retry without any automatic request', async () => {
    await settings.save(input);
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    const first = await wait(await service.generateWorld(p.id, dto));
    fetcher.mockRejectedValueOnce(new Error(`LEAK RAW ${input.apiKey}`));
    const failed = await wait(await service.generateWorld(p.id, { ...dto, regenerate: true }), 'failed');
    expect(failed).not.toHaveProperty('world');
    expect(failed.error).toContain('手动重试');
    expect(JSON.stringify(failed)).not.toMatch(/LEAK RAW|stub-key-never/);
    expect(service.getProject(p.id).world?.id).toBe(first.world?.id);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(service.getWorldJob(p.id, failed.id).status).toBe('failed');
    // A previous failure bypasses old-world cache even without regenerate on manual retry.
    const retry = await service.generateWorld(p.id, dto);
    expect(retry.status).toBe('pending');
    expect(retry.id).not.toBe(failed.id);
    await wait(retry);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('persists safe validation field paths without leaking rejected values or retrying', async () => {
    await settings.save(input);
    const p = await project();
    const draft = sceneDraft();
    draft.objects[1]!.kind = 'PRIVATE_PROVIDER_KIND';
    delete draft.objects[1]!.params;
    fetcher.mockResolvedValueOnce(completionResponse(visionReport())).mockResolvedValueOnce(completionResponse(draft));
    const failed = await wait(await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id }), 'failed');
    await jobs.flush();
    expect(failed.error).toContain('objects[1].kind');
    const persisted = JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8'));
    expect(persisted.jobs[0].job.error).toBe(failed.error);
    expect(JSON.stringify(persisted)).not.toMatch(/PRIVATE_PROVIDER_KIND|stub-key-never/);
    expect(service.getProject(p.id).world).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('can manually retry an initial failure with no previous world', async () => {
    await settings.save(input); const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    fetcher.mockResolvedValueOnce(completionResponse(visionReport())).mockResolvedValueOnce(completionResponse('not JSON'));
    const failed = await wait(await service.generateWorld(p.id, dto), 'failed');
    expect(failed.error).toContain('合法 JSON');
    expect(service.getProject(p.id).world).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await wait(await service.generateWorld(p.id, dto));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('snapshots settings and input for both requests; changes during expansion affect only the next job', async () => {
    const original = { ...input, protocol: 'openai' as const, jsonMode: true,
      tokenParameter: 'max_completion_tokens' as const, maxOutputTokens: 2345 };
    await settings.save(original); const p = await project();
    const gate = deferred<Response>(); fetcher.mockReturnValueOnce(gate.promise);
    vi.spyOn(ai, 'captureWorldPlanner');
    const dto = { conceptId: p.concepts[0]!.id };
    const pending = await service.generateWorld(p.id, dto);
    dto.conceptId = p.concepts[1]!.id;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 5 });
    expect(service.getWorldJob(p.id, pending.id).phase).toBe('expanding');
    await settings.save({ ...input, baseURL: 'https://api.anthropic.com/v1', protocol: 'anthropic',
      model: 'new-model', apiKey: 'different-key', jsonMode: false, tokenParameter: 'omit', maxOutputTokens: 4321 });
    await settings.clearKey();
    gate.resolve(completionResponse(visionReport()));
    const result = await wait(pending);
    expect(result.world?.source.conceptId).toBe(p.concepts[0]!.id);
    expect(result.world?.source.provider.planner).toBe('openai-compatible:stub-model');
    expect(result.analysis).toMatchObject({ mock: false, provider: 'openai:vision:stub-model' });
    expect(ai.captureWorldPlanner).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [index, [url, init]] of fetcher.mock.calls.entries()) {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${original.apiKey}` });
      const body = JSON.parse(init!.body as string);
      expect(body).toMatchObject({ model: original.model, max_completion_tokens: original.maxOutputTokens });
      // Expansion reads the image without JSON mode; only the structured scene request is JSON.
      if (index === 0) expect(body).not.toHaveProperty('response_format');
      else expect(body).toHaveProperty('response_format', { type: 'json_object' });
      expect(body).not.toHaveProperty('max_tokens');
    }
    expect(settings.getSettings().modelingEnabled).toBe(false);
    await wait(await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id }));
    expect(mockPlanner.plan).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refuses jobs while a concept mutation or world save is already in progress', async () => {
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    const first = await wait(await service.generateWorld(p.id, dto));
    const gate = deferred<void>(); const originalSave = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementationOnce(async (record) => { await gate.promise; return originalSave(record); });
    const saving = service.saveWorld(p.id, { world: first.world });
    await expect(service.generateWorld(p.id, dto)).rejects.toMatchObject({ status: 409 });
    gate.resolve(); await saving;
    const conceptsGate = deferred<void>(); const originalGenerate = ai.generateConcepts.bind(ai);
    vi.spyOn(ai, 'generateConcepts').mockImplementationOnce(async (request) => { await conceptsGate.promise; return originalGenerate(request); });
    const generating = service.generateConcepts(p.id, { mode: 'more' });
    await expect(service.generateWorld(p.id, dto)).rejects.toMatchObject({ status: 409 });
    conceptsGate.resolve(); await generating;
    expect(service.getProject(p.id).world).toBeUndefined();
    expect(() => service.getWorldJob(p.id, first.id)).toThrow('失效');
  });

  it('revalidates current project/concept before committing and never overwrites a changed batch', async () => {
    await settings.save(input); const p = await project();
    const gate = deferred<Response>(); fetcher.mockReturnValueOnce(gate.promise);
    const pending = await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 5 });
    const changed = structuredClone(store.get(p.id)!);
    changed.project.concepts = []; changed.project.batchIndex++;
    await store.save(changed);
    gate.resolve(completionResponse(visionReport()));
    const failed = await wait(pending, 'failed');
    expect(failed.error).toContain('已变更');
    expect(service.getProject(p.id).concepts).toEqual([]);
    expect(service.getProject(p.id).world).toBeUndefined();
  });

  it('retains the previous in-memory and persisted world if the final disk save fails', async () => {
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    const first = await wait(await service.generateWorld(p.id, dto));
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk failure with PRIVATE DATA'));
    const failed = await wait(await service.generateWorld(p.id, { ...dto, regenerate: true }), 'failed');
    expect(failed.error).not.toContain('PRIVATE DATA');
    expect(service.getProject(p.id).world?.id).toBe(first.world?.id);
    const restored = new ProjectStore({ port: 4000, aiMode: 'mock', dataDir }); await restored.onModuleInit();
    expect(restored.get(p.id)?.project.world?.id).toBe(first.world?.id);
  });

  it('bounds retained jobs to 100 globally as well as one per project', async () => {
    const p = await project();
    const first = await wait(await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id }));
    const template = structuredClone(store.get(p.id)!);
    for (let index = 0; index < 100; index++) {
      const record = structuredClone(template); record.project.id = randomUUID();
      await store.save(record);
      expect((await service.generateWorld(record.project.id, { conceptId: p.concepts[0]!.id })).status).toBe('succeeded');
    }
    expect(() => service.getWorldJob(p.id, first.id)).toThrow('失效');
    await jobs.flush();
    const restarted = new WorldJobStore({ dataDir, port: 4000, aiMode: 'mock' }, store);
    await restarted.initialize();
    expect(restarted.list()).toHaveLength(100);
    expect(new Set(restarted.list().map((entry) => entry.projectId)).size).toBe(100);
    expect(restarted.get(p.id)).toBeUndefined();
  });

  it('lists retained summaries without result payloads, request snapshots, credentials or private metadata', async () => {
    await settings.save(input);
    const p = await project();
    const complete = await wait(await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id }));
    await jobs.flush();
    const controller = new ProjectsController(service);
    const list = controller.listWorldJobs();
    expect(list.jobs).toHaveLength(1);
    expect(list.jobs[0]).toMatchObject({ id: complete.id, phase: 'complete', status: 'succeeded' });
    expect(list.jobs[0]).not.toHaveProperty('world');
    expect(list.jobs[0]).not.toHaveProperty('analysis');
    expect(list.jobs[0]).not.toHaveProperty('targetWorldId');
    list.jobs[0]!.projectTitle = 'mutated';
    expect(controller.listWorldJobs().jobs[0]!.projectTitle).toBe(complete.projectTitle);
    const raw = await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8');
    expect(raw).not.toMatch(/stub-key-never|apiKey|Authorization|worldPlannerKey|baseURL|"request"|"key"/);
    expect(await readdir(join(dataDir, 'world-jobs'))).toEqual(['jobs.json']);
    expect(Reflect.getMetadata(PATH_METADATA, controller.listWorldJobs)).toBe('world-jobs');
    expect(Reflect.getMetadata(HEADERS_METADATA, controller.listWorldJobs)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    expect(Reflect.getMetadata(HEADERS_METADATA, controller.getWorldJob)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    expect(Reflect.getMetadata(PATH_METADATA, controller.prepareWorldPrompt)).toBe(':id/world-prompt');
    expect(Reflect.getMetadata(HEADERS_METADATA, controller.prepareWorldPrompt)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    const methods = Object.getOwnPropertyNames(ProjectsController.prototype);
    expect(methods.indexOf('listWorldJobs')).toBeLessThan(methods.indexOf('get'));
  });

  it('restores completed and failed jobs and interrupts queued/expanding/generating jobs without resubmitting', async () => {
    const completeProject = await project();
    const complete = await wait(await service.generateWorld(completeProject.id, { conceptId: completeProject.concepts[0]!.id }));
    const failedProject = await project();
    const failure = new Error('PRIVATE provider reply');
    vi.spyOn(mockAnalyzer, 'analyze').mockRejectedValueOnce(failure);
    const failed = await wait(await service.generateWorld(failedProject.id, { conceptId: failedProject.concepts[0]!.id }), 'failed');
    const interrupted: WorldGenerationJob[] = [];
    for (const phase of ['queued', 'expanding', 'generating'] as const) {
      const p = await project();
      const now = new Date().toISOString();
      const job: WorldGenerationJob = { id: randomUUID(), projectId: p.id, projectTitle: 'Restart test', conceptId: p.concepts[0]!.id,
        status: phase === 'queued' ? 'pending' : 'running', phase, createdAt: now, updatedAt: now };
      await jobs.retain(job);
      interrupted.push(job);
    }
    await jobs.flush();
    await settings.save(input); // Restart with modeling enabled: interrupted work must never resume.
    const originalCalls = vi.mocked(mockPlanner.plan).mock.calls.length;
    const config = { dataDir, port: 4000, aiMode: 'mock' as const };
    const restoredProjects = new ProjectStore(config); await restoredProjects.onModuleInit();
    const restoredJobs = new WorldJobStore(config, restoredProjects);
    const restarted = new ProjectsService(restoredProjects, ai, restoredJobs); await restarted.onModuleInit();
    expect(restarted.getWorldJob(complete.projectId, complete.id)).toMatchObject({ status: 'succeeded', phase: 'complete', world: { id: complete.world!.id } });
    expect(restarted.getWorldJob(failed.projectId, failed.id)).toMatchObject({ status: 'failed', phase: 'failed', error: failed.error });
    for (const job of interrupted) {
      expect(restarted.getWorldJob(job.projectId, job.id)).toMatchObject({ status: 'failed', phase: 'failed', error: INTERRUPTED_WORLD_JOB });
    }
    expect(restarted.listWorldJobs().jobs).toHaveLength(5);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockPlanner.plan).toHaveBeenCalledTimes(originalCalls);
    // A second restart sees durable failed jobs rather than retrying or reviving HTTP requests.
    const twice = new WorldJobStore(config, restoredProjects);
    const restartedTwice = new ProjectsService(restoredProjects, ai, twice); await restartedTwice.onModuleInit();
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const job of interrupted) {
      expect(restartedTwice.getWorldJob(job.projectId, job.id)).toMatchObject({ status: 'failed', phase: 'failed', error: INTERRUPTED_WORLD_JOB });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockPlanner.plan).toHaveBeenCalledTimes(originalCalls);
  });

  it('reconciles saving intent with the disk world id on both sides of the project commit', async () => {
    const p = await project(); const dto = { conceptId: p.concepts[0]!.id };
    const complete = await wait(await service.generateWorld(p.id, dto)); await jobs.flush();
    const config = { dataDir, port: 4000, aiMode: 'mock' as const };
    const interrupted = { ...complete, id: randomUUID(), status: 'running' as const, phase: 'saving' as const };
    delete interrupted.world; delete interrupted.analysis;
    await jobs.retain(interrupted);
    await jobs.update(interrupted, randomUUID()); // New world was never atomically committed.
    const beforeCommit = new WorldJobStore(config, store); await beforeCommit.initialize();
    expect(beforeCommit.get(p.id)).toMatchObject({ status: 'failed', error: INTERRUPTED_WORLD_JOB });
    expect(store.get(p.id)?.project.world?.id).toBe(complete.world!.id);
    // Model a crash after project rename but before the final job-file rename.
    await jobs.update(interrupted, complete.world!.id);
    const afterCommit = new WorldJobStore(config, store); await afterCommit.initialize();
    expect(afterCommit.get(p.id)).toMatchObject({ status: 'succeeded', phase: 'complete', world: { id: complete.world!.id } });
    expect(mockPlanner.plan).toHaveBeenCalledOnce();
    // Even an allegedly succeeded task cannot report success if the disk result is missing.
    const withoutWorld = structuredClone(store.get(p.id)!); delete withoutWorld.project.world;
    await store.save(withoutWorld);
    const missing = new WorldJobStore(config, store); await missing.initialize();
    expect(missing.get(p.id)).toMatchObject({ status: 'failed', phase: 'failed', error: expect.stringContaining('缺失') });
    expect(missing.get(p.id)).not.toHaveProperty('world');
  });

  it('persists genuine phases in order, awaits validation writes, and ignores a late callback after completion', async () => {
    const p = await project();
    const validation = deferred<void>(); const planned = deferred<void>(); const save = deferred<void>();
    let stage!: () => void;
    const transitions: string[] = [];
    const originalUpdate = jobs.update.bind(jobs);
    vi.spyOn(jobs, 'update').mockImplementation(async (job, target) => {
      transitions.push(job.phase);
      if (job.phase === 'validating') await validation.promise;
      return originalUpdate(job, target);
    });
    vi.spyOn(ai, 'captureWorldPlanner').mockReturnValue({
      key: 'test', mode: 'mock', analyze: (request) => new MockImageAnalyzer().analyze(request),
      plan: async (request, onStage) => {
        stage = () => onStage?.('validating');
        await planned.promise;
        return mockPlanner.plan(request);
      },
    });
    const originalSave = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementationOnce(async (record) => { await save.promise; return originalSave(record); });
    const job = await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id });
    await vi.waitFor(() => expect(stage).toBeTypeOf('function'), { interval: 5 });
    expect(service.getWorldJob(p.id, job.id).phase).toBe('generating');
    stage(); stage();
    expect(service.getWorldJob(p.id, job.id).phase).toBe('validating');
    planned.resolve();
    await vi.waitFor(() => expect(mockPlanner.plan).toHaveBeenCalledOnce(), { interval: 5 });
    expect(store.save).not.toHaveBeenCalled();
    validation.resolve();
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce(), { interval: 5 });
    const saving = JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8')).jobs[0];
    expect(saving.job).toMatchObject({ status: 'running', phase: 'saving' });
    expect(saving.targetWorldId).toBeTypeOf('string');
    expect(saving.job).not.toHaveProperty('world');
    expect(store.get(p.id)?.project.world).toBeUndefined();
    save.resolve(); await wait(job); await jobs.flush();
    stage(); await jobs.flush();
    expect(transitions).toEqual(['generating', 'validating', 'saving', 'complete']);
    const disk = JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8')).jobs[0];
    expect(disk.job).toMatchObject({ phase: 'complete', status: 'succeeded' });
    expect(disk.job.world.id).toBe(disk.targetWorldId);
  });

  it.each(['expanding', 'generating'] as const)('does not impose a deadline or retry a two-hour %s request', async (phase) => {
    await settings.save(input); const p = await project();
    const gate = deferred<Response>();
    if (phase === 'generating') fetcher.mockResolvedValueOnce(completionResponse(visionReport()));
    fetcher.mockReturnValueOnce(gate.promise);
    const calls = phase === 'expanding' ? 1 : 2;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const job = await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(calls), { interval: 5 });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 60_000);
    expect(service.getWorldJob(p.id, job.id)).toMatchObject({ status: 'running', phase });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect((fetcher.mock.calls[calls - 1]![1]?.signal)?.aborted).not.toBe(true);
    vi.useRealTimers(); gate.resolve(phase === 'expanding' ? completionResponse(visionReport()) : completionResponse());
    await wait(job);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('recovers a committed world when writing the final completion record fails', async () => {
    const p = await project();
    const update = jobs.update.bind(jobs);
    vi.spyOn(jobs, 'update').mockImplementation((job, target) => job.phase === 'complete'
      ? Promise.reject(new Error('PRIVATE filesystem failure')) : update(job, target));
    const job = await wait(await service.generateWorld(p.id, { conceptId: p.concepts[0]!.id }));
    await jobs.flush();
    const disk = JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8')).jobs[0];
    expect(disk.job.phase).toBe('saving');
    expect(disk.targetWorldId).toBe(job.world!.id);
    expect(store.get(p.id)?.project.world?.id).toBe(job.world!.id);
    const restored = new WorldJobStore({ dataDir, port: 4000, aiMode: 'mock' }, store);
    await restored.initialize();
    expect(restored.get(p.id)).toMatchObject({ status: 'succeeded', phase: 'complete', world: { id: job.world!.id } });
    expect(mockPlanner.plan).toHaveBeenCalledOnce();
  });

  it('serializes rapid phase writes and ignores an incomplete temporary file on restart', async () => {
    const p = await project();
    const now = new Date().toISOString();
    const job: WorldGenerationJob = { id: randomUUID(), projectId: p.id, projectTitle: 'Atomic test', conceptId: p.concepts[0]!.id,
      status: 'pending', phase: 'queued', createdAt: now, updatedAt: now };
    const queued = jobs.retain(job);
    job.status = 'running'; job.phase = 'generating'; const generating = jobs.update(job);
    job.phase = 'validating'; const validating = jobs.update(job);
    job.status = 'failed'; job.phase = 'failed'; job.error = 'Safe failure'; const failed = jobs.update(job);
    await Promise.all([queued, generating, validating, failed]);
    const raw = JSON.parse(await readFile(join(dataDir, 'world-jobs/jobs.json'), 'utf8'));
    expect(raw.jobs[0].job).toMatchObject({ status: 'failed', phase: 'failed' });
    await writeFile(join(dataDir, 'world-jobs/jobs.json.tmp'), '{unfinished write', 'utf8');
    const restored = new WorldJobStore({ dataDir, port: 4000, aiMode: 'mock' }, store); await restored.initialize();
    expect(restored.get(p.id)).toMatchObject({ status: 'failed', phase: 'failed', error: 'Safe failure' });
    expect(mockPlanner.plan).not.toHaveBeenCalled();
  });

  it('refuses to call a provider if the queued task cannot be persisted', async () => {
    const p = await project();
    vi.spyOn(jobs, 'retain').mockRejectedValueOnce(new Error('disk is full with PRIVATE DETAILS'));
    await expect(service.generateWorld(p.id, { conceptId: p.concepts[0]!.id })).rejects.toThrow('无法保存');
    expect(mockPlanner.plan).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates optional regenerate without coercing strings or null', () => {
    for (const regenerate of [undefined, true, false]) {
      expect(validateSync(Object.assign(new GenerateWorldDto(), { conceptId: 'concept', regenerate }))).toHaveLength(0);
    }
    for (const regenerate of [null, 'true', 1]) {
      expect(validateSync(Object.assign(new GenerateWorldDto(), { conceptId: 'concept', regenerate })).length).toBeGreaterThan(0);
    }
  });

  it('validates prompt confirmation fields and the prepare request', () => {
    expect(validateSync(Object.assign(new GenerateWorldDto(), {
      conceptId: 'concept',
      promptDraftId: 'draft',
      modelingPrompt: 'edited prompt',
    }))).toHaveLength(0);
    for (const promptDraftId of ['', 'x'.repeat(101), 1, true, {}]) {
      expect(validateSync(Object.assign(new GenerateWorldDto(), {
        conceptId: 'concept',
        promptDraftId,
        modelingPrompt: 'edited prompt',
      })).length).toBeGreaterThan(0);
    }
    for (const modelingPrompt of [1, true, {}, 'x'.repeat(MAX_MODELING_PROMPT_LENGTH + 1)]) {
      expect(validateSync(Object.assign(new GenerateWorldDto(), {
        conceptId: 'concept',
        promptDraftId: 'draft',
        modelingPrompt,
      })).length).toBeGreaterThan(0);
    }
    expect(validateSync(Object.assign(new PrepareWorldPromptDto(), { conceptId: 'concept' }))).toHaveLength(0);
    for (const conceptId of ['', 'x'.repeat(101), 1, true, {}]) {
      expect(validateSync(Object.assign(new PrepareWorldPromptDto(), { conceptId })).length).toBeGreaterThan(0);
    }
  });
});
