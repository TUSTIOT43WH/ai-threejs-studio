import { create } from 'zustand';
import type {
  ChatReply,
  Project,
  WorldEnvironment,
  WorldMaterial,
  WorldObject,
  WorldSchema,
  WorldJobSummary,
  WorldGenerationJob,
} from '@ai-three-studio/shared';
import { api, errorMessage } from '../lib/api';
import {
  recommendedLighting,
} from '../lib/environment-visuals';
import {
  SEASON_LABELS,
  TIME_LABELS,
  WEATHER_LABELS,
} from '../lib/labels';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  mock?: boolean;
  suggestion?: ChatReply['environmentSuggestion'];
}

export interface ActionLogEntry {
  id: string;
  label: string;
  detail?: string;
  at: string;
}

export type VectorField = 'position' | 'rotation' | 'scale';

export interface StudioState {
  project: Project | null;
  world: WorldSchema | null;
  selectedObjectId: string | null;
  projectLoading: boolean;
  conceptsLoading: boolean;
  worldGenerating: boolean;
  worldJobStatus: 'pending' | 'running' | 'succeeded' | 'failed' | null;
  worldJobs: WorldJobSummary[];
  jobNotifications: WorldJobSummary[];
  jobsConnectionError: string | null;
  refreshWorldJobs: () => Promise<void>;
  dismissJobNotification: (id: string) => void;
  openWorldJob: (job: WorldJobSummary) => Promise<boolean>;
  chatLoading: boolean;
  saveState: SaveState;
  error: string | null;
  actionLog: ActionLogEntry[];
  chatMessages: ChatMessage[];
  cameraToken: number;
  gridVisible: boolean;

  setProject: (project: Project) => void;
  loadProject: (projectId: string) => Promise<boolean>;
  chooseConcept: (conceptId: string) => void;
  generateConcepts: (
    mode: 'more' | 'similar',
    baseConceptId?: string,
  ) => Promise<boolean>;
  generateWorld: (
    conceptId: string,
    regenerate?: boolean,
    promptDraft?: { promptDraftId: string; modelingPrompt: string },
  ) => Promise<boolean>;
  saveWorld: () => Promise<boolean>;
  selectObject: (objectId: string | null) => void;
  updateObjectName: (objectId: string, name: string) => void;
  updateObjectVector: (
    objectId: string,
    field: VectorField,
    axis: 0 | 1 | 2,
    value: number,
  ) => void;
  updateObjectMaterial: (
    objectId: string,
    patch: Partial<WorldMaterial>,
  ) => void;
  setEnvironmentPreset: (
    patch: Partial<Pick<WorldEnvironment, 'season' | 'weather' | 'timeOfDay'>>,
  ) => void;
  setEnvironmentNumber: (
    key: 'sunIntensity' | 'ambientIntensity' | 'fogDensity',
    value: number,
  ) => void;
  sendChat: (message: string) => Promise<void>;
  applyChatSuggestion: (
    suggestion: ChatReply['environmentSuggestion'],
  ) => void;
  logAction: (label: string, detail?: string) => void;
  clearError: () => void;
  resetCamera: () => void;
  toggleGrid: () => void;
}

function uid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeEntry(label: string, detail?: string): ActionLogEntry {
  return { id: uid(), label, detail, at: nowIso() };
}

function makeWelcome(project?: Project | null): ChatMessage[] {
  const scene = project?.world?.title;
  return [
    {
      id: uid(),
      role: 'assistant',
      content: scene
        ? `欢迎来到「${scene}」。${project?.world?.meta.mock ? '当前为 Mock 世界，可在 API 设置启用 AI 建模，再返回概念页重新生成。' : '当前场景结构由 AI 生成并经校验，基础几何部件可独立编辑。'} 顶部可导出 Three.js 文件；进入第三人称漫游可操控小人。文字对话由独立开关控制，不会直接修改模型。`
        : '欢迎来到工作室。在 API 设置中分别配置图片与建模服务，可生成概念预览及可编辑 Three.js 场景。',
      at: nowIso(),
      mock: true,
    },
  ];
}

function applyObjectPatch(
  world: WorldSchema,
  objectId: string,
  updater: (object: WorldObject) => WorldObject,
): WorldSchema {
  return {
    ...world,
    objects: world.objects.map((object) =>
      object.id === objectId ? updater(object) : object,
    ),
    meta: { ...world.meta, updatedAt: nowIso() },
  };
}

const dismissedJobIds = new Set<string>();
try {
  const ids: unknown = JSON.parse(sessionStorage.getItem('studio-dismissed-jobs') ?? '[]');
  if (Array.isArray(ids)) ids.filter((id): id is string => typeof id === 'string').slice(-100).forEach((id) => dismissedJobIds.add(id));
} catch { /* Browser storage may be disabled. */ }
let jobsRefreshing = false;
let submittingWorldProject: string | null = null;

function jobSummary({ world: _world, analysis: _analysis, ...summary }: WorldGenerationJob): WorldJobSummary {
  return summary;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  project: null,
  world: null,
  selectedObjectId: null,
  projectLoading: false,
  conceptsLoading: false,
  worldGenerating: false,
  worldJobStatus: null,
  worldJobs: [],
  jobNotifications: [],
  jobsConnectionError: null,
  refreshWorldJobs: async () => {
    if (jobsRefreshing) return;
    jobsRefreshing = true;
    try {
      const { jobs } = await api.listWorldJobs();
      const current = jobs.find((job) => job.projectId === get().project?.id);
      set({
        worldJobs: jobs,
        worldGenerating: submittingWorldProject === get().project?.id || current?.status === 'pending' || current?.status === 'running',
        worldJobStatus: current?.status ?? null,
        jobsConnectionError: null,
        jobNotifications: jobs.filter((job) => (job.status === 'succeeded' || job.status === 'failed') && !dismissedJobIds.has(job.id)),
      });
    } catch {
      set({ jobsConnectionError: '暂时无法查询任务，正在自动恢复连接；不会重新提交建模请求。' });
    } finally {
      jobsRefreshing = false;
    }
  },
  dismissJobNotification: (id) => {
    dismissedJobIds.add(id);
    try { sessionStorage.setItem('studio-dismissed-jobs', JSON.stringify([...dismissedJobIds].slice(-100))); } catch { /* Keep dismissal in memory when storage is disabled. */ }
    set((state) => ({ jobNotifications: state.jobNotifications.filter((job) => job.id !== id) }));
  },
  openWorldJob: async (job) => {
    try {
      const result = await api.getWorldJob(job.projectId, job.id);
      if (result.status !== 'succeeded' || !result.world) throw new Error('任务尚未完成，或结果已被后续任务替换。');
      const loaded = await get().loadProject(job.projectId);
      if (loaded) get().dismissJobNotification(job.id);
      return loaded;
    } catch (error) {
      set({ error: errorMessage(error) });
      return false;
    }
  },
  chatLoading: false,
  saveState: 'idle',
  error: null,
  actionLog: [],
  chatMessages: [],
  cameraToken: 0,
  gridVisible: false,

  setProject: (project) =>
    set({
      project,
      world: project.world ?? null,
      selectedObjectId: null,
      projectLoading: false,
      worldGenerating: get().worldJobs.some((job) => job.projectId === project.id && (job.status === 'pending' || job.status === 'running')),
      worldJobStatus: get().worldJobs.find((job) => job.projectId === project.id)?.status ?? null,
      error: null,
      saveState: 'idle',
      chatMessages: makeWelcome(project),
      actionLog: project.world
        ? [makeEntry('载入世界', project.world.title)]
        : [],
    }),

  loadProject: async (projectId) => {
    const previous = get().project;
    set({ projectLoading: true, error: null });
    try {
      const project = await api.getProject(projectId);
      const sameProject = previous?.id === project.id;
      set((state) => ({
        projectLoading: false,
        worldGenerating: state.worldJobs.some((job) => job.projectId === project.id && (job.status === 'pending' || job.status === 'running')),
        worldJobStatus: state.worldJobs.find((job) => job.projectId === project.id)?.status ?? null,
        project,
        world: project.world ?? null,
        selectedObjectId: null,
        saveState: 'idle',
        chatMessages:
          sameProject && state.chatMessages.length > 0
            ? state.chatMessages
            : makeWelcome(project),
        actionLog: project.world
          ? [
              makeEntry('载入世界', project.world.title),
              ...(sameProject ? state.actionLog : []),
            ].slice(0, 40)
          : [],
      }));
      return true;
    } catch (error) {
      set({ projectLoading: false, error: errorMessage(error) });
      return false;
    }
  },

  chooseConcept: (conceptId) =>
    set((state) =>
      state.project
        ? { project: { ...state.project, selectedConceptId: conceptId } }
        : {},
    ),

  generateConcepts: async (mode, baseConceptId) => {
    const project = get().project;
    if (!project) return false;
    set({ conceptsLoading: true, error: null });
    try {
      const response = await api.generateConcepts(project.id, {
        mode,
        baseConceptId,
      });
      set((state) => {
        if (!state.project || state.project.id !== project.id) {
          return { conceptsLoading: false };
        }
        return {
          conceptsLoading: false,
          worldJobStatus: null,
          world: null,
          selectedObjectId: null,
          saveState: 'idle',
          project: {
            ...state.project,
            concepts: response.concepts,
            selectedConceptId:
              mode === 'similar' ? baseConceptId : undefined,
            analysis: undefined,
            world: undefined,
            batchIndex: state.project.batchIndex + 1,
            updatedAt: nowIso(),
          },
        };
      });
      return true;
    } catch (error) {
      set({ conceptsLoading: false, error: errorMessage(error) });
      return false;
    }
  },

  generateWorld: async (conceptId, regenerate = false, promptDraft) => {
    const project = get().project;
    if (!project || submittingWorldProject || get().worldJobs.some((job) => job.projectId === project.id && (job.status === 'pending' || job.status === 'running'))) return false;
    submittingWorldProject = project.id;
    set({ worldGenerating: true, worldJobStatus: 'pending', error: null });
    try {
      const result = await api.generateWorld(project.id, {
        conceptId,
        regenerate,
        ...(promptDraft ?? {}),
      });
      const job = jobSummary(result);
      dismissedJobIds.delete(job.id);
      set((state) => ({
        worldJobs: [job, ...state.worldJobs.filter((entry) => entry.projectId !== project.id)],
        worldGenerating: state.project?.id === project.id && (job.status === 'pending' || job.status === 'running'),
        worldJobStatus: state.project?.id === project.id ? job.status : state.worldJobStatus,
        jobNotifications: job.status === 'succeeded' || job.status === 'failed'
          ? [job, ...state.jobNotifications.filter((entry) => entry.projectId !== project.id)]
          : state.jobNotifications.filter((entry) => entry.projectId !== project.id),
        actionLog: [makeEntry('后台建模已提交', '可切换页面或刷新；完成后会通知，不会自动打开或覆盖当前编辑预览'), ...state.actionLog].slice(0, 40),
      }));
      return true;
    } catch (error) {
      set({ worldGenerating: false, error: `${errorMessage(error)} 将继续查询后台任务，请勿连续重复提交。` });
      return false;
    } finally {
      submittingWorldProject = null;
      void get().refreshWorldJobs();
    }
  },

  saveWorld: async () => {
    const { world, project, saveState } = get();
    if (!world || !project || saveState === 'saving') return false;
    set({ saveState: 'saving', error: null });
    try {
      const response = await api.saveWorld(project.id, world);
      set((state) => ({
        saveState: 'saved',
        world: response.world,
        project: state.project
          ? {
              ...state.project,
              world: response.world,
              updatedAt: response.updatedAt,
            }
          : state.project,
        actionLog: [
          makeEntry('保存世界', 'World Schema 已写入服务端本地存储'),
          ...state.actionLog,
        ].slice(0, 40),
      }));
      return true;
    } catch (error) {
      set({ saveState: 'error', error: errorMessage(error) });
      return false;
    }
  },

  selectObject: (objectId) => set({ selectedObjectId: objectId }),

  updateObjectName: (objectId, name) =>
    set((state) => {
      if (!state.world) return {};
      return {
        world: applyObjectPatch(state.world, objectId, (object) => ({
          ...object,
          name: name.slice(0, 100),
        })),
        saveState: 'dirty',
      };
    }),

  updateObjectVector: (objectId, field, axis, value) =>
    set((state) => {
      if (!state.world || !Number.isFinite(value)) return {};
      let next = value;
      if (field === 'scale') {
        next = Math.min(200, Math.max(0.05, value));
      } else {
        next = Math.min(5000, Math.max(-5000, value));
      }
      return {
        world: applyObjectPatch(state.world, objectId, (object) => {
          const vector = [...object.transform[field]] as [
            number,
            number,
            number,
          ];
          vector[axis] = Math.round(next * 100) / 100;
          return {
            ...object,
            transform: { ...object.transform, [field]: vector },
          };
        }),
        saveState: 'dirty',
      };
    }),

  updateObjectMaterial: (objectId, patch) =>
    set((state) => {
      if (!state.world) return {};
      return {
        world: applyObjectPatch(state.world, objectId, (object) => ({
          ...object,
          material: { ...object.material, ...patch },
        })),
        saveState: 'dirty',
      };
    }),

  setEnvironmentPreset: (patch) =>
    set((state) => {
      if (!state.world) return {};
      const merged = { ...state.world.environment, ...patch };
      const lighting = recommendedLighting(
        merged.weather,
        merged.timeOfDay,
      );
      const details = [
        patch.season ? SEASON_LABELS[patch.season] : null,
        patch.weather ? WEATHER_LABELS[patch.weather] : null,
        patch.timeOfDay ? TIME_LABELS[patch.timeOfDay] : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' · ');
      return {
        world: {
          ...state.world,
          environment: { ...merged, ...lighting },
          meta: { ...state.world.meta, updatedAt: nowIso() },
        },
        saveState: 'dirty',
        actionLog: [
          makeEntry('调整环境预设', details || '更新光照参数'),
          ...state.actionLog,
        ].slice(0, 40),
      };
    }),

  setEnvironmentNumber: (key, value) =>
    set((state) => {
      if (!state.world || !Number.isFinite(value)) return {};
      const max = key === 'fogDensity' ? 0.08 : 10;
      return {
        world: {
          ...state.world,
          environment: {
            ...state.world.environment,
            [key]: Math.min(max, Math.max(0, value)),
          },
          meta: { ...state.world.meta, updatedAt: nowIso() },
        },
        saveState: 'dirty',
      };
    }),

  sendChat: async (message) => {
    const trimmed = message.trim();
    if (!trimmed || get().chatLoading) return;
    const project = get().project;
    if (!project) return;
    const userMessage: ChatMessage = {
      id: uid(),
      role: 'user',
      content: trimmed,
      at: nowIso(),
    };
    set((state) => ({
      chatLoading: true,
      error: null,
      chatMessages: [...state.chatMessages, userMessage],
    }));
    try {
      const reply = await api.chat(project.id, trimmed);
      set((state) => ({
        chatLoading: false,
        chatMessages: [
          ...state.chatMessages,
          {
            id: uid(),
            role: 'assistant',
            content: reply.content,
            at: nowIso(),
            mock: reply.mock,
            suggestion: reply.environmentSuggestion,
          },
        ],
      }));
    } catch (error) {
      set({ chatLoading: false, error: errorMessage(error) });
    }
  },

  applyChatSuggestion: (suggestion) => {
    if (!suggestion) return;
    const patch: Partial<
      Pick<WorldEnvironment, 'season' | 'weather' | 'timeOfDay'>
    > = {};
    if (suggestion.season) patch.season = suggestion.season;
    if (suggestion.weather) patch.weather = suggestion.weather;
    if (suggestion.timeOfDay) patch.timeOfDay = suggestion.timeOfDay;
    if (Object.keys(patch).length === 0) return;
    get().setEnvironmentPreset(patch);
  },

  logAction: (label, detail) =>
    set((state) => ({
      actionLog: [makeEntry(label, detail), ...state.actionLog].slice(0, 40),
    })),

  clearError: () => set({ error: null }),

  resetCamera: () =>
    set((state) => ({ cameraToken: state.cameraToken + 1 })),

  toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
}));
