import 'reflect-metadata';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImageArtifact, WorldSchema } from '@ai-three-studio/shared';
import type { Response } from 'express';
import { BadGatewayException, Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ProjectsController } from './projects.controller';
import { AiService } from '../ai/ai.service';
import { ImageGenerationException } from '../ai/live-concept-provider';
import { MockChatProvider } from '../ai/mock/mock-chat-provider';
import { MockConceptImageProvider } from '../ai/mock/mock-concept-provider';
import { MockImageAnalyzer } from '../ai/mock/mock-image-analyzer';
import { MockPromptExpander } from '../ai/mock/mock-prompt-expander';
import { MockWorldPlanner } from '../ai/mock/mock-world-planner';
import { ProjectStore } from './project.store';
import { ProjectsService } from './projects.service';
import { WorldJobStore } from './world-job.store';

describe('ProjectsService', () => {
  let dataDir: string;
  let store: ProjectStore;
  let service: ProjectsService;
  let ai: AiService;
  let jobs: WorldJobStore;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'ai-three-studio-spec-'));
    store = new ProjectStore({ port: 4000, aiMode: 'mock', dataDir });
    await store.onModuleInit();
    ai = new AiService(
      new MockPromptExpander(),
      new MockConceptImageProvider(),
      new MockImageAnalyzer(),
      new MockWorldPlanner(),
      new MockChatProvider(),
    );
    jobs = new WorldJobStore({ port: 4000, aiMode: 'mock', dataDir }, store);
    service = new ProjectsService(store, ai, jobs);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await jobs.flush();
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('runs the full mock chain: prompt → concepts → world → save', async () => {
    const { project } = await service.createProject({ prompt: '林中小屋' });

    expect(project.prompt).toBe('林中小屋');
    expect(project.concepts).toHaveLength(5);
    expect(project.expansion.mock).toBe(true);
    expect(project.concepts.every((concept) => concept.mock)).toBe(true);
    expect(new Set(project.concepts.map((concept) => concept.styleId)).size).toBe(
      5,
    );
    expect(service.listProjects().projects).toHaveLength(1);

    const artifact = service.getConceptArtifact(
      project.id,
      project.concepts[0]!.id,
    );
    expect(artifact.mimeType).toBe('image/svg+xml');
    expect(artifact.data).toContain('<svg');
    expect(artifact.data).toContain('MOCK PREVIEW');

    const chosen = project.concepts[2]!;
    const pending = await service.generateWorld(project.id, { conceptId: chosen.id });
    expect(pending.status).toBe('pending');
    await vi.waitFor(() => expect(service.getWorldJob(project.id, pending.id).status).toBe('succeeded'));
    const generated = service.getWorldJob(project.id, pending.id);
    expect(generated.analysis!.mock).toBe(true);
    expect(generated.world!.meta.objectCount).toBeGreaterThan(8);
    expect(generated.world!.source.conceptId).toBe(chosen.id);

    const reloaded = service.getProject(project.id);
    expect(reloaded.selectedConceptId).toBe(chosen.id);
    expect(reloaded.world?.id).toBe(generated.world!.id);

    const world = generated.world!;
    const edited: WorldSchema = {
      ...world,
      title: '我的林间小屋',
      environment: {
        ...world.environment,
        season: 'autumn',
        weather: 'light-rain',
        timeOfDay: 'dusk',
      },
      objects: world.objects.map((object) =>
        object.kind === 'cabin'
          ? {
              ...object,
              transform: {
                ...object.transform,
                scale: [1.6, 1.6, 1.6] as [number, number, number],
              },
            }
          : object,
      ),
      source: {
        ...world.source,
        provider: { ...world.source.provider, mode: 'live' },
        disclaimer: 'forged',
      },
    };

    const saved = await service.saveWorld(project.id, { world: edited });
    expect(saved.world.title).toBe('我的林间小屋');
    expect(saved.world.environment.season).toBe('autumn');
    expect(saved.world.source.provider.mode).toBe('mock');
    expect(saved.world.source.disclaimer).toBe(world.source.disclaimer);
    expect(saved.world.meta.objectCount).toBe(world.objects.length);

    const storedAfterSave = service.getProject(project.id);
    expect(storedAfterSave.world?.title).toBe('我的林间小屋');
    expect(storedAfterSave.updatedAt).toBe(saved.updatedAt);

    const summary = service.listProjects().projects[0]!;
    expect(summary.title).toBe('我的林间小屋');
    expect(summary.hasWorld).toBe(true);
  });

  it('creates similar variants around the selected concept', async () => {
    const { project } = await service.createProject({ prompt: '海边小镇' });
    const base = project.concepts[1]!;

    const response = await service.generateConcepts(project.id, {
      mode: 'similar',
      baseConceptId: base.id,
    });

    expect(response.concepts).toHaveLength(4);
    expect(response.concepts[0]!.id).toBe(base.id);
    expect(
      response.concepts.slice(1).every((concept) => concept.styleId === base.styleId),
    ).toBe(true);
    const updated = service.getProject(project.id);
    expect(updated.batchIndex).toBe(1);
    expect(updated.selectedConceptId).toBe(base.id);
    expect(updated.world).toBeUndefined();
    expect(service.getConceptArtifact(project.id, base.id).data).toContain('<svg');
  });

  it('rotates to fresh styles when the user asks for another batch', async () => {
    const { project } = await service.createProject({ prompt: '赛博朋克城市' });
    const firstStyles = new Set(
      project.concepts.map((concept) => concept.styleId),
    );

    const response = await service.generateConcepts(project.id, {
      mode: 'more',
    });

    expect(response.concepts).toHaveLength(5);
    expect(new Set(response.concepts.map((concept) => concept.styleId)).size).toBe(
      5,
    );
    expect(firstStyles.size).toBe(5);
    expect(service.getProject(project.id).batchIndex).toBe(1);
  });

  it('validates prompts, references and chat, and rejects unknown ids', async () => {
    await expect(service.createProject({ prompt: '  ' })).rejects.toThrow(
      /至少 2 个字符/,
    );
    await expect(
      service.createProject({
        prompt: '海边小镇',
        referenceImageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        referenceFileName: 'a.gif',
      }),
    ).rejects.toThrow(/PNG/);

    const { project } = await service.createProject({ prompt: '雪山营地' });
    const reply = await service.chat(project.id, { message: '把场景改成冬天' });
    expect(reply.mock).toBe(true);
    expect(reply.environmentSuggestion?.season).toBe('winter');

    await expect(
      service.generateConcepts(project.id, { mode: 'similar' }),
    ).rejects.toThrow(/选择一张概念图/);
    await expect(
      service.generateConcepts(project.id, {
        mode: 'similar',
        baseConceptId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toThrow(/不属于该项目/);
    await expect(
      service.generateWorld(project.id, {
        conceptId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toThrow(/不存在/);
    await expect(service.saveWorld(project.id, { world: {} })).rejects.toThrow(
      /还没有生成/,
    );
    expect(() =>
      service.getProject('11111111-1111-4111-8111-111111111111'),
    ).toThrow(/项目不存在/);
  });

  it.each(['image/png', 'image/jpeg'] as const)('persists and serves real %s bytes with provider flags, not SVG/JSON', async (mimeType) => {
    const artifact: ImageArtifact = {
      mimeType, encoding: 'base64', width: 1, height: 1,
      data: mimeType === 'image/png' ? 'iVBORw0KGgo=' : '/9j/2Q==',
    };
    const generate = ai.generateConcepts.bind(ai);
    const spy = vi.spyOn(ai, 'generateConcepts').mockImplementationOnce(async (request) =>
      (await generate(request)).map((item) => ({ ...item, mock: false, referenceDriven: false, artifact })));
    const { project } = await service.createProject({ prompt: '真实概念图', referenceImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    const concept = project.concepts[0]!;
    expect(concept).toMatchObject({ mock: false, referenceDriven: false });
    expect(concept.imageUrl).toContain(`/concepts/${concept.id}/image?v=`);
    expect(store.getArtifact(project.id, concept.id)).toEqual(artifact);
    const reloaded = new ProjectStore({ port: 4000, aiMode: 'mock', dataDir }); await reloaded.onModuleInit();
    expect(reloaded.getArtifact(project.id, concept.id)).toEqual(artifact);
    const response = { setHeader: vi.fn(), send: vi.fn() };
    const controller = new ProjectsController(service);
    controller.conceptImage(project.id, concept.id, response as unknown as Response);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', mimeType);
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining("default-src 'none'"));
    expect(response.send).toHaveBeenCalledWith(Buffer.from(artifact.data, 'base64'));
    expect(Buffer.isBuffer(response.send.mock.calls[0]![0])).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, controller.conceptImage)).toEqual([
      ':id/concepts/:conceptId/image', ':id/concepts/:conceptId/image.svg',
    ]);
    spy.mockImplementationOnce(async (request) =>
      (await generate(request)).map((item) => ({ ...item, mock: false, referenceDriven: true, artifact })));
    const next = await service.generateConcepts(project.id, { mode: 'more' });
    expect(next.concepts.every((item) => !item.mock && item.referenceDriven)).toBe(true);
    expect(service.getConceptArtifact(project.id, next.concepts[0]!.id)).toEqual(artifact);
    // Old image URLs remain readable even after replacing the displayed batch.
    expect(service.getConceptArtifact(project.id, concept.id)).toEqual(artifact);
    spy.mockRestore();
  });

  it('loads legacy raw SVG without rewriting/deleting it and keeps the old image.svg route', async () => {
    const { project } = await service.createProject({ prompt: '兼容旧概念图' });
    const conceptId = project.concepts[0]!.id;
    const legacySvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Legacy</text></svg>';
    const legacy = structuredClone(store.get(project.id)!);
    legacy.artifacts[conceptId] = legacySvg;
    legacy.project.concepts[0]!.imageUrl = `/api/projects/${project.id}/concepts/${conceptId}/image.svg`;
    await store.save(legacy);
    const file = join(dataDir, 'projects', `${project.id}.json`);
    const raw = await readFile(file, 'utf8');
    const config = { dataDir, port: 4000, aiMode: 'mock' as const };
    const restored = new ProjectStore(config); await restored.onModuleInit();
    const restoredService = new ProjectsService(restored, ai, new WorldJobStore(config, restored));
    await jobs.flush(); await restoredService.onModuleInit();
    expect(restored.getArtifact(project.id, conceptId)).toBe(legacySvg);
    expect(await readFile(file, 'utf8')).toBe(raw);
    const response = { setHeader: vi.fn(), send: vi.fn() };
    new ProjectsController(restoredService).conceptImage(project.id, conceptId, response as unknown as Response);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/svg+xml; charset=utf-8');
    expect(response.send).toHaveBeenCalledWith(legacySvg);
    await service.generateConcepts(project.id, { mode: 'more' });
    expect(store.getArtifact(project.id, conceptId)).toBe(legacySvg);
  });

  it('keeps previous concepts and world on image-provider failures and never logs response secrets', async () => {
    const { project } = await service.createProject({ prompt: '保留旧世界' });
    const job = await service.generateWorld(project.id, { conceptId: project.concepts[0]!.id });
    await vi.waitFor(() => expect(service.getWorldJob(project.id, job.id).status).toBe('succeeded'));
    await jobs.flush();
    const before = service.getProject(project.id);
    const beforeDisk = await readFile(join(dataDir, 'projects', `${project.id}.json`), 'utf8');
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const generate = vi.spyOn(ai, 'generateConcepts');
    for (const error of [new Error('SECRET_PROVIDER_KEY'), new BadGatewayException('SECRET_PROVIDER_KEY')]) {
      generate.mockRejectedValueOnce(error);
      await expect(service.generateConcepts(project.id, { mode: 'more' })).rejects.toThrow('已有概念图和世界已保留');
      expect(service.getProject(project.id)).toEqual(before);
      expect(await readFile(join(dataDir, 'projects', `${project.id}.json`), 'utf8')).toBe(beforeDisk);
    }
    const safeError = new ImageGenerationException('parameters', 400);
    safeError.message = 'SECRET_PROVIDER_KEY';
    generate.mockRejectedValueOnce(safeError);
    const failure = await service.generateConcepts(project.id, { mode: 'more' }).catch((error: Error) => error);
    expect(String(failure)).toContain('HTTP 400');
    expect(String(failure)).toContain('Seedream');
    expect(String(failure)).toContain('已有概念图和世界已保留');
    expect(String(failure)).not.toContain('SECRET_PROVIDER_KEY');
    expect(service.getProject(project.id)).toEqual(before);
    expect(await readFile(join(dataDir, 'projects', `${project.id}.json`), 'utf8')).toBe(beforeDisk);
    expect(JSON.stringify(logger.mock.calls)).toContain('HTTP 400');
    generate.mockResolvedValueOnce([]);
    await expect(service.generateConcepts(project.id, { mode: 'more' })).rejects.toThrow('已有概念图和世界已保留');
    expect(service.getProject(project.id)).toEqual(before);
    expect(JSON.stringify(logger.mock.calls)).not.toContain('SECRET_PROVIDER_KEY');
    expect(service.getWorldJob(project.id, job.id).status).toBe('succeeded');
    generate.mockRestore(); logger.mockRestore();
  });

  it('rejects unsupported artifact metadata without changing the previous batch', async () => {
    const { project } = await service.createProject({ prompt: '拒绝非图片资源' });
    const generate = ai.generateConcepts.bind(ai);
    const spy = vi.spyOn(ai, 'generateConcepts').mockImplementationOnce(async (request) =>
      (await generate(request)).map((item) => ({ ...item, artifact: { ...item.artifact, mimeType: 'text/html' } as unknown as ImageArtifact })));
    await expect(service.generateConcepts(project.id, { mode: 'more' })).rejects.toThrow('格式不支持');
    expect(service.getProject(project.id)).toEqual(project);
    spy.mockRestore();
  });

  it('reloads saved projects from disk', async () => {
    const { project } = await service.createProject({ prompt: '林间空地' });
    expect(project.id).toBeTruthy();

    const secondStore = new ProjectStore({
      port: 4000,
      aiMode: 'mock',
      dataDir,
    });
    await secondStore.onModuleInit();

    const restored = secondStore.get(project.id);
    expect(restored?.project.prompt).toBe('林间空地');
    expect(secondStore.getArtifact(project.id, project.concepts[0]!.id)).toMatchObject({
      mimeType: 'image/svg+xml', encoding: 'utf8', data: expect.stringContaining('<svg'),
    });
    const list = secondStore.listSummaries();
    expect(list.some((summary) => summary.id === project.id)).toBe(true);
  });
});
