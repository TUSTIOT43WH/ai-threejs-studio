import { randomInt, randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  ChatEndpointResponse,
  ConceptAnalysis,
  ConceptImage,
  CreateProjectResponse,
  GenerateConceptsResponse,
  ImageArtifact,
  ListWorldJobsResponse,
  WorldGenerationJob,
  ListProjectsResponse,
  PrepareWorldPromptResponse,
  Project,
  ReferenceImage,
  SaveWorldResponse,
} from '@ai-three-studio/shared';
import { MAX_MODELING_PROMPT_LENGTH } from '@ai-three-studio/shared';
import { AiService, type WorldPlannerSnapshot } from '../ai/ai.service';
import { ImageGenerationException } from '../ai/live-concept-provider';
import { VISION_EXPANSION_ERRORS } from '../ai/live-image-analyzer';
import { WORLD_VALIDATION_ERRORS, WorldPlanGenerationException } from '../ai/live-world-planner';
import type {
  ChatDto,
  CreateProjectDto,
  GenerateConceptsDto,
  GenerateWorldDto,
  PrepareWorldPromptDto,
  SaveWorldDto,
} from './dto';
import { ProjectStore, type StoredProjectRecord, type StoredWorldPromptDraft } from './project.store';
import { normalizeWorldForSave } from './world-validation';
import { isActiveWorldJob, WorldJobStore } from './world-job.store';

const MAX_REFERENCE_DATA_URL_LENGTH = 4_500_000;

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly projectMutations = new Set<string>();
  // React StrictMode can request the same preparation twice; share one paid expansion.
  private readonly promptPreparations = new Map<
    string,
    { conceptId: string; promise: Promise<PrepareWorldPromptResponse> }
  >();

  constructor(
    private readonly store: ProjectStore,
    private readonly ai: AiService,
    private readonly worldJobs: WorldJobStore,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.worldJobs.initialize();
  }

  async createProject(dto: CreateProjectDto): Promise<CreateProjectResponse> {
    const prompt = dto.prompt.trim();
    if (prompt.length < 2) {
      throw new BadRequestException('请输入至少 2 个字符的场景描述。');
    }
    const referenceImage = this.normalizeReference(dto);
    const projectId = randomUUID();
    const createdAt = new Date().toISOString();

    const expansion = await this.providerStep('提示词扩展', () =>
      this.ai.expandPrompt({
        prompt,
        referenceImageDataUrl: referenceImage?.dataUrl,
      }),
    );

    const batchSeed = randomInt(1, 2_147_483_646);
    const generated = await this.providerStep('概念图生成', () =>
      this.ai.generateConcepts({
        projectId,
        prompt,
        expansion,
        count: 5,
        mode: 'initial',
        batchSeed,
        existingStyleIds: [],
        referenceImageDataUrl: referenceImage?.dataUrl,
      }),
    );

    if (!Array.isArray(generated) || generated.length === 0) {
      throw new BadGatewayException('概念图生成未返回有效图片，请手动重试；已有概念图和世界已保留。');
    }
    const batchId = randomUUID();
    const artifacts: StoredProjectRecord['artifacts'] = {};
    const concepts: ConceptImage[] = generated.map((item) => {
      const conceptId = randomUUID();
      artifacts[conceptId] = this.normalizeArtifact(item.artifact);
      return {
        id: conceptId,
        projectId,
        batchId,
        title: item.title,
        description: item.description,
        styleId: item.styleId,
        styleLabel: item.styleLabel,
        styleLabelEn: item.styleLabelEn,
        imageUrl: this.conceptImageUrl(projectId, conceptId, item.seed),
        prompt: item.prompt,
        seed: item.seed,
        mock: item.mock,
        referenceDriven: item.referenceDriven,
        createdAt,
      };
    });

    const project: Project = {
      id: projectId,
      prompt,
      referenceImage,
      expansion,
      concepts,
      batchIndex: 0,
      createdAt,
      updatedAt: createdAt,
    };

    await this.store.save({ project, artifacts });
    return { project };
  }

  listProjects(): ListProjectsResponse {
    return { projects: this.store.listSummaries() };
  }

  getProject(projectId: string): Project {
    return this.getRecord(projectId).project;
  }

  getConceptArtifact(projectId: string, conceptId: string): ImageArtifact {
    const artifact = this.store.getArtifact(projectId, conceptId);
    if (!artifact) throw new NotFoundException('概念图资源不存在。');
    return this.normalizeArtifact(typeof artifact === 'string'
      ? { mimeType: 'image/svg+xml', encoding: 'utf8', data: artifact, width: 0, height: 0 }
      : artifact);
  }

  async prepareWorldPrompt(
    projectId: string,
    dto: PrepareWorldPromptDto,
  ): Promise<PrepareWorldPromptResponse> {
    const active = this.promptPreparations.get(projectId);
    if (active) {
      if (active.conceptId !== dto.conceptId) {
        throw new ConflictException('正在为另一张概念图准备提示词，请完成后再试。');
      }
      return active.promise.then((response) => structuredClone(response));
    }

    this.lockMutation(projectId);
    const promise = this.prepareWorldPromptUnlocked(projectId, dto);
    this.promptPreparations.set(projectId, { conceptId: dto.conceptId, promise });
    try {
      return await promise;
    } finally {
      this.promptPreparations.delete(projectId);
      this.projectMutations.delete(projectId);
    }
  }

  private async prepareWorldPromptUnlocked(
    projectId: string,
    dto: PrepareWorldPromptDto,
  ): Promise<PrepareWorldPromptResponse> {
    const record = this.getRecord(projectId);
    const project = record.project;
    const concept = project.concepts.find((entry) => entry.id === dto.conceptId);
    if (!concept) throw new NotFoundException('所选概念图不存在，请重新选择。');

    const planner = this.ai.captureWorldPlanner();
    if (planner.mode !== 'live') {
      throw new BadRequestException('当前为 Mock 建模模式，不进行真实看图扩写。请先在设置中启用 AI 建模；不会自动切换或调用付费 API。');
    }

    const existingDraft = record.worldPromptDraft;
    if (existingDraft?.conceptId === concept.id && this.isUsableAnalysis(existingDraft.analysis)) {
      return this.preparedResponse(existingDraft, true);
    }

    const savedAnalysis = project.world?.source.conceptId === concept.id
      ? project.analysis
      : undefined;
    if (savedAnalysis && this.isUsableAnalysis(savedAnalysis)) {
      const draft = this.createWorldPromptDraft(concept.id, savedAnalysis);
      record.worldPromptDraft = draft;
      try {
        await this.store.save(record);
      } catch {
        throw new BadGatewayException('保存建模提示词草稿失败，请检查数据目录后手动重试；未调用付费建模服务。');
      }
      return this.preparedResponse(draft, true);
    }

    const artifact = record.artifacts[concept.id];
    const analysis = await this.providerStep('看图扩写', () =>
      planner.analyze(
        { concept, prompt: project.prompt, expansion: project.expansion },
        typeof artifact === 'string' ? undefined : artifact,
      ),
    );
    if (!this.isUsableAnalysis(analysis)) {
      throw new BadGatewayException('看图扩写未返回可用的建模提示词，请手动重试；未开始建模，未切换为 Mock。');
    }

    const draft = this.createWorldPromptDraft(concept.id, analysis);
    record.worldPromptDraft = draft;
    try {
      await this.store.save(record);
    } catch {
      throw new BadGatewayException('看图扩写已完成，但保存提示词草稿失败，请检查数据目录后手动重试；不会自动重试或切换为 Mock。');
    }
    return this.preparedResponse(draft, false);
  }

  private isUsableAnalysis(analysis: ConceptAnalysis | undefined): analysis is ConceptAnalysis {
    return Boolean(analysis && !analysis.mock && analysis.modelingPrompt?.trim());
  }

  private createWorldPromptDraft(
    conceptId: string,
    analysis: ConceptAnalysis,
  ): StoredWorldPromptDraft {
    return {
      id: randomUUID(),
      conceptId,
      preparedAt: new Date().toISOString(),
      analysis: structuredClone(analysis),
    };
  }

  private preparedResponse(
    draft: StoredWorldPromptDraft,
    reused: boolean,
  ): PrepareWorldPromptResponse {
    return {
      draftId: draft.id,
      conceptId: draft.conceptId,
      preparedAt: draft.preparedAt,
      analysis: structuredClone(draft.analysis),
      reused,
    };
  }

  private normalizeArtifact(artifact: ImageArtifact): ImageArtifact {
    if (!artifact || typeof artifact.data !== 'string' || !artifact.data ||
        !((artifact.mimeType === 'image/svg+xml' && artifact.encoding === 'utf8') ||
          (['image/png', 'image/jpeg'].includes(artifact.mimeType) && artifact.encoding === 'base64'))) {
      throw new BadGatewayException('概念图资源格式不支持，请手动重试。');
    }
    // Copy only the public artifact contract, never provider response metadata.
    return { mimeType: artifact.mimeType, encoding: artifact.encoding, data: artifact.data,
      width: artifact.width, height: artifact.height };
  }

  async generateConcepts(projectId: string, dto: GenerateConceptsDto): Promise<GenerateConceptsResponse> {
    this.lockMutation(projectId);
    try {
      return await this.generateConceptsUnlocked(projectId, dto);
    } finally {
      this.projectMutations.delete(projectId);
    }
  }

  private async generateConceptsUnlocked(
    projectId: string,
    dto: GenerateConceptsDto,
  ): Promise<GenerateConceptsResponse> {
    const record = this.getRecord(projectId);
    const project = record.project;
    let baseConcept: ConceptImage | undefined;

    if (dto.mode === 'similar') {
      if (!dto.baseConceptId) {
        throw new BadRequestException('请先选择一张概念图，再生成相似方案。');
      }
      baseConcept = project.concepts.find(
        (concept) => concept.id === dto.baseConceptId,
      );
      if (!baseConcept) {
        throw new BadRequestException('所选概念图不属于该项目当前批次。');
      }
    }

    const count =
      dto.mode === 'similar' ? 3 : Math.min(5, Math.max(3, dto.count ?? 5));
    const batchSeed = randomInt(1, 2_147_483_646);
    const generated = await this.providerStep('概念图生成', () =>
      this.ai.generateConcepts({
        projectId,
        prompt: project.prompt,
        expansion: project.expansion,
        count,
        mode: dto.mode,
        batchSeed,
        existingStyleIds: project.concepts.map((concept) => concept.styleId),
        baseConcept,
        referenceImageDataUrl: project.referenceImage?.dataUrl,
      }),
    );

    if (!Array.isArray(generated) || generated.length === 0) {
      throw new BadGatewayException('概念图生成未返回有效图片，请手动重试；已有概念图和世界已保留。');
    }
    const batchId = randomUUID();
    const createdAt = new Date().toISOString();
    const artifacts: StoredProjectRecord['artifacts'] = { ...record.artifacts };

    if (baseConcept) {
      const baseArtifact = this.store.getArtifact(projectId, baseConcept.id);
      if (!baseArtifact) {
        throw new NotFoundException('基础概念图资源缺失，请换一批后重试。');
      }
      artifacts[baseConcept.id] = baseArtifact;
    }

    const newConcepts: ConceptImage[] = generated.map((item) => {
      const conceptId = randomUUID();
      artifacts[conceptId] = this.normalizeArtifact(item.artifact);
      return {
        id: conceptId,
        projectId,
        batchId,
        title: item.title,
        description: item.description,
        styleId: item.styleId,
        styleLabel: item.styleLabel,
        styleLabelEn: item.styleLabelEn,
        imageUrl: this.conceptImageUrl(projectId, conceptId, item.seed),
        prompt: item.prompt,
        seed: item.seed,
        mock: item.mock,
        referenceDriven: item.referenceDriven,
        createdAt,
      };
    });

    const concepts = baseConcept ? [baseConcept, ...newConcepts] : newConcepts;
    project.concepts = concepts;
    project.selectedConceptId = baseConcept?.id;
    project.batchIndex += 1;
    project.analysis = undefined;
    project.world = undefined;
    project.updatedAt = createdAt;

    // Omitting worldPlannerKey and worldPromptDraft also clears stale cache/preparation.
    await this.store.save({ project, artifacts });
    try {
      await this.worldJobs.remove(projectId);
    } catch {
      // The new batch is already committed; do not report a failed image request.
      this.logger.error('概念图已保存，但旧建模任务清理失败。');
    }
    return { concepts };
  }

  async generateWorld(projectId: string, dto: GenerateWorldDto): Promise<WorldGenerationJob> {
    const previous = this.worldJobs.get(projectId);
    if (previous && isActiveWorldJob(previous)) return structuredClone(previous);
    if (this.projectMutations.has(projectId)) throw new ConflictException('项目正在更新，请完成后再生成世界。');
    this.projectMutations.add(projectId);
    try {
      return await this.generateWorldUnlocked(projectId, dto);
    } finally {
      this.projectMutations.delete(projectId);
    }
  }

  private async generateWorldUnlocked(
    projectId: string,
    dto: GenerateWorldDto,
  ): Promise<WorldGenerationJob> {
    const record = this.getRecord(projectId);
    const previous = this.worldJobs.get(projectId);
    if (previous && isActiveWorldJob(previous)) return structuredClone(previous);
    const project = record.project;
    const concept = project.concepts.find((entry) => entry.id === dto.conceptId);
    if (!concept) throw new NotFoundException('所选概念图不存在，请重新选择。');

    // Capture request and ALL settings before the first async boundary. Keys live only
    // inside the planner closure; changing/clearing settings affects the next job only.
    const planner = this.ai.captureWorldPlanner();
    const preparedAnalysis = this.resolvePreparedAnalysis(dto, record, concept);
    if (preparedAnalysis && planner.mode !== 'live') {
      throw new BadRequestException('建模设置已关闭，无法使用看图扩写提示词。请重新启用 AI 建模或切换回 Mock 后重试。');
    }
    if (preparedAnalysis) {
      try {
        await this.store.save(record);
      } catch {
        throw new BadGatewayException('保存编辑后的建模提示词失败，请检查数据目录后手动重试；未开始建模。');
      }
    }

    const cached = !preparedAnalysis && !dto.regenerate && previous?.status !== 'failed' && project.world && project.analysis &&
      project.world.source.conceptId === concept.id && record.worldPlannerKey === planner.key;
    const now = new Date().toISOString();
    const job: WorldGenerationJob = {
      id: randomUUID(), projectId, projectTitle: project.world?.title ?? project.expansion.sceneLabel,
      conceptId: concept.id, createdAt: now, updatedAt: now,
      ...(cached
        ? { status: 'succeeded' as const, phase: 'complete' as const, world: project.world, analysis: project.analysis }
        : { status: 'pending' as const, phase: 'queued' as const }),
    };
    try {
      await this.worldJobs.retain(job);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.failWorldJob(job, new Error('Task storage unavailable'));
      throw new BadGatewayException('无法保存建模任务，请稍后手动重试。');
    }
    if (!cached) {
      // No deadline, timer-based progress, retry, or request-scoped cancellation.
      setImmediate(() => { void this.runWorldJob(job, record, concept, planner, preparedAnalysis); });
    }
    return structuredClone(job);
  }

  private resolvePreparedAnalysis(
    dto: GenerateWorldDto,
    record: StoredProjectRecord,
    concept: ConceptImage,
  ): ConceptAnalysis | undefined {
    if (dto.promptDraftId === undefined && dto.modelingPrompt === undefined) return undefined;
    if (dto.promptDraftId === undefined || dto.modelingPrompt === undefined) {
      throw new BadRequestException('确认生成时必须同时提供提示词草稿和编辑后的提示词。');
    }
    const modelingPrompt = dto.modelingPrompt.trim();
    if (!modelingPrompt) {
      throw new BadRequestException('建模提示词不能为空，请补充后再确认生成。');
    }
    if (modelingPrompt.length > MAX_MODELING_PROMPT_LENGTH) {
      throw new BadRequestException('建模提示词过长，请精简后再确认生成。');
    }
    const draft = record.worldPromptDraft;
    if (!draft || draft.id !== dto.promptDraftId || draft.conceptId !== concept.id ||
        !this.isUsableAnalysis(draft.analysis)) {
      throw new ConflictException('提示词草稿已失效，请重新看图扩写后再确认生成。');
    }
    const analysis: ConceptAnalysis = {
      ...draft.analysis,
      modelingPrompt,
      ...(draft.analysis.report
        ? { report: { ...draft.analysis.report, finalPrompt: modelingPrompt } }
        : {}),
    };
    draft.analysis = analysis;
    return analysis;
  }

  getWorldJob(projectId: string, jobId: string): WorldGenerationJob {
    this.getRecord(projectId);
    const job = this.worldJobs.get(projectId);
    if (!job || job.id !== jobId) throw new NotFoundException('生成任务已失效，请重新生成。');
    return structuredClone(job);
  }

  listWorldJobs(): ListWorldJobsResponse {
    return { jobs: this.worldJobs.list() };
  }

  private async runWorldJob(
    job: WorldGenerationJob,
    snapshot: StoredProjectRecord,
    concept: ConceptImage,
    planner: WorldPlannerSnapshot,
    preparedAnalysis?: ConceptAnalysis,
  ): Promise<void> {
    try {
      job.status = 'running';
      await this.setJobPhase(job, preparedAnalysis || planner.mode === 'mock' ? 'generating' : 'expanding');
      const project = snapshot.project;
      const artifact = snapshot.artifacts[concept.id];
      let analysis = preparedAnalysis;
      if (!analysis) {
        analysis = await planner.analyze(
          { concept, prompt: project.prompt, expansion: project.expansion },
          typeof artifact === 'string' ? undefined : artifact,
        );
        if (planner.mode === 'live') await this.setJobPhase(job, 'generating');
      }
      let validationWrite: Promise<void> | undefined;
      const world = await planner.plan(
        { projectId: project.id, concept, prompt: project.prompt, expansion: project.expansion, analysis },
        () => {
          // Ignore repeated or late callbacks, including callbacks after a failure.
          if (!isActiveWorldJob(job) || job.phase !== 'generating') return;
          validationWrite = this.setJobPhase(job, 'validating');
          // Callback is intentionally synchronous; observe any disk error below.
          void validationWrite.catch(() => {});
        },
        typeof artifact === 'string' ? undefined : artifact,
      );
      await (validationWrite ?? this.setJobPhase(job, 'validating'));
      const current = this.getRecord(project.id);
      if (current.project.updatedAt !== project.updatedAt || current.project.prompt !== project.prompt ||
          current.project.batchIndex !== project.batchIndex ||
          !current.project.concepts.some((entry) => entry.id === concept.id && JSON.stringify(entry) === JSON.stringify(concept))) {
        throw new ConflictException('项目或概念图已变更，请重新生成。');
      }
      current.project.selectedConceptId = concept.id;
      current.project.analysis = analysis;
      current.project.world = world;
      current.project.updatedAt = new Date().toISOString();
      current.worldPlannerKey = planner.key;
      current.worldPromptDraft = undefined;
      // Persist commit intent first. A restart between the two atomic file renames
      // can reconcile this exact id, without assuming an older world is the result.
      await this.setJobPhase(job, 'saving', world.id);
      await this.store.save(current);
      job.world = world;
      job.analysis = analysis;
      job.status = 'succeeded';
      await this.setJobPhase(job, 'complete');
    } catch (error) {
      // If only final task persistence failed, the world has already committed.
      // Retain success in memory; the durable saving intent recovers it at restart.
      if (job.status === 'succeeded') {
        this.logger.error('建模结果已保存，但任务完成记录写入失败。');
        return;
      }
      await this.failWorldJob(job, error);
    }
  }

  private setJobPhase(job: WorldGenerationJob, phase: WorldGenerationJob['phase'], targetWorldId?: string): Promise<void> {
    job.phase = phase;
    job.updatedAt = new Date().toISOString();
    return this.worldJobs.update(job, targetWorldId);
  }

  private async failWorldJob(job: WorldGenerationJob, error: unknown): Promise<void> {
    // Never publish/log provider-controlled error text (including injected errors).
    // Only fixed, local messages from our transport/validator are eligible for detail.
    const safeMessages = [
      '建模服务响应超时，请手动重试。未切换为 Mock。',
      '建模输出达到长度上限，结果被截断；请检查最大输出 Token 和服务商限制后手动重试。未切换为 Mock。',
      '建模服务未返回合法 JSON，请手动重试。未切换为 Mock。',
      ...Object.values(WORLD_VALIDATION_ERRORS),
      '建模服务拒绝认证，请检查设置中的 API Key 和账号权限。未切换为 Mock。',
      '建模服务额度不足或请求过于频繁，请检查余额并稍后重试。未切换为 Mock。',
      '建模服务拒绝图片输入或请求参数，请确认建模模型和所选协议支持图片理解。未切换为 Mock。',
      '项目或概念图已变更，请重新生成。',
      ...Object.values(VISION_EXPANSION_ERRORS),
      '看图扩写服务响应校验失败，请手动重试。未切换为 Mock。',
      '看图扩写服务未返回合法 JSON，请手动重试。未切换为 Mock。',
      '看图扩写输出达到长度上限，结果被截断；请检查最大输出 Token 和服务商限制后手动重试。未切换为 Mock。',
      '看图扩写服务拒绝认证，请检查设置中的 API Key 和账号权限。未切换为 Mock。',
      '看图扩写服务额度不足或请求过于频繁，请检查余额并稍后重试。未切换为 Mock。',
      '看图扩写服务拒绝图片输入或请求参数，请确认建模模型和所选协议支持图片理解。未切换为 Mock。',
    ];
    job.error = error instanceof WorldPlanGenerationException || (error instanceof Error && safeMessages.includes(error.message))
      ? error.message : job.phase === 'expanding'
        ? '看图扩写失败，请确认建模 API 支持图片理解并检查网络后手动重试；未开始建模，原有世界已保留，未切换为 Mock。'
        : '世界生成失败，请检查设置或网络后手动重试；原有世界已保留，未切换为 Mock。';
    job.status = 'failed';
    delete job.world;
    delete job.analysis;
    try {
      await this.setJobPhase(job, 'failed');
    } catch {
      this.logger.error('建模任务失败状态无法写入；请检查数据目录。');
    }
  }

  private lockMutation(projectId: string): void {
    const job = this.worldJobs.get(projectId);
    if (this.projectMutations.has(projectId) || (job && isActiveWorldJob(job))) {
      throw new ConflictException('世界正在生成或项目正在更新，请完成后再修改。');
    }
    this.projectMutations.add(projectId);
  }

  async saveWorld(projectId: string, dto: SaveWorldDto): Promise<SaveWorldResponse> {
    this.lockMutation(projectId);
    try {
      return await this.saveWorldUnlocked(projectId, dto);
    } finally {
      this.projectMutations.delete(projectId);
    }
  }

  private async saveWorldUnlocked(
    projectId: string,
    dto: SaveWorldDto,
  ): Promise<SaveWorldResponse> {
    const record = this.getRecord(projectId);
    const project = record.project;
    if (!project.world) {
      throw new BadRequestException('当前项目还没有生成 3D 世界。');
    }
    const world = normalizeWorldForSave(dto.world, project.world);
    project.world = world;
    project.updatedAt = world.meta.updatedAt;
    await this.store.save(record);
    return { world, updatedAt: world.meta.updatedAt };
  }

  async chat(projectId: string, dto: ChatDto): Promise<ChatEndpointResponse> {
    const record = this.getRecord(projectId);
    const project = record.project;
    const worldSummary = project.world
      ? `${project.world.title} · ${project.world.meta.objectCount} 个对象 · ` +
        `${project.world.environment.season}/${project.world.environment.weather}/${project.world.environment.timeOfDay}`
      : undefined;
    return this.providerStep('对话助手', () =>
      this.ai.chat({ message: dto.message, worldSummary }),
    );
  }

  private getRecord(projectId: string): StoredProjectRecord {
    const record = this.store.get(projectId);
    if (!record) {
      throw new NotFoundException('项目不存在或已被清理。');
    }
    return structuredClone(record);
  }

  private conceptImageUrl(
    projectId: string,
    conceptId: string,
    seed: number,
  ): string {
    return `/api/projects/${projectId}/concepts/${conceptId}/image?v=${seed}`;
  }

  private normalizeReference(dto: CreateProjectDto): ReferenceImage | undefined {
    const dataUrl = dto.referenceImageDataUrl?.trim();
    if (!dataUrl) return undefined;
    if (dataUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) {
      throw new BadRequestException(
        '参考图过大，请使用 3MB 以内的 PNG / JPEG / WebP 图片。',
      );
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(dataUrl);
    if (!match) {
      throw new BadRequestException(
        '参考图格式不支持，请上传 PNG / JPEG / WebP 图片。',
      );
    }
    const fileName = dto.referenceFileName?.trim().slice(0, 200);
    return {
      dataUrl,
      mimeType: (match[1] ?? 'image/png').toLowerCase(),
      fileName: fileName || undefined,
    };
  }

  private async providerStep<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpException && label !== '概念图生成') {
        throw error;
      }
      if (label === '概念图生成' && error instanceof ImageGenerationException) {
        this.logger.error(`${label}失败：${error.safeDetail}`);
        throw new BadGatewayException(`概念图生成失败：${error.safeDetail}已有概念图和世界已保留；未切换为 Mock，未自动重试。`);
      }
      this.logger.error(`${label}失败。`);
      throw new BadGatewayException(label === '概念图生成'
        ? '概念图生成失败，请检查图片设置或网络后手动重试；已有概念图和世界已保留。'
        : `${label}失败，请稍后重试。`);
    }
  }
}
