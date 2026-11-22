import type {
  ChatEndpointResponse,
  ChatSettings,
  ImageSettings,
  SaveImageSettingsRequest,
  ListWorldJobsResponse,
  SaveChatSettingsRequest,
  TestChatSettingsResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GenerateConceptsRequest,
  GenerateConceptsResponse,
  GenerateWorldRequest,
  WorldGenerationJob,
  ListProjectsResponse,
  MetaResponse,
  PrepareWorldPromptRequest,
  PrepareWorldPromptResponse,
  Project,
  SaveWorldResponse,
  WorldSchema,
} from '@ai-three-studio/shared';

const rawBase = (import.meta.env.VITE_API_BASE_URL ?? '/api').trim();
const API_BASE = rawBase.replace(/\/+$/, '') || '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

interface ErrorBody {
  message?: string | string[];
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (path.startsWith('/settings/')) {
    const destination = new URL(`${API_BASE}${path}`, window.location.origin);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname) ||
      !['http:', 'https:'].includes(destination.protocol) ||
      destination.username || destination.password ||
      !destination.pathname.startsWith('/api/settings/')
    ) {
      throw new ApiError('密钥设置仅允许提交到本机 Studio API，请检查本地 API 地址。');
    }
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'X-Studio-Client': 'local-ui',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      '无法连接后端服务，请确认 API 已在 4000 端口运行（npm run dev:server）。',
    );
  }

  if (!response.ok) {
    let body: ErrorBody | null = null;
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      body = null;
    }
    const raw = body?.message;
    const message = Array.isArray(raw)
      ? raw.join('；')
      : raw || body?.error || `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  getImageSettings(): Promise<ImageSettings> {
    return request('/settings/images');
  },

  saveImageSettings(input: SaveImageSettingsRequest): Promise<ImageSettings> {
    return request('/settings/images', { method: 'PUT', body: JSON.stringify(input) });
  },

  clearImageKey(): Promise<ImageSettings> {
    return request('/settings/images/key', { method: 'DELETE' });
  },

  listWorldJobs(): Promise<ListWorldJobsResponse> {
    return request('/projects/world-jobs', { signal: AbortSignal.timeout(10_000) });
  },

  getChatSettings(): Promise<ChatSettings> {
    return request<ChatSettings>('/settings/chat');
  },

  saveChatSettings(input: SaveChatSettingsRequest): Promise<ChatSettings> {
    return request<ChatSettings>('/settings/chat', { method: 'PUT', body: JSON.stringify(input) });
  },

  clearChatKey(): Promise<ChatSettings> {
    return request<ChatSettings>('/settings/chat/key', { method: 'DELETE' });
  },

  testChatSettings(): Promise<TestChatSettingsResponse> {
    return request<TestChatSettingsResponse>('/settings/chat/test', { method: 'POST' });
  },

  getMeta(): Promise<MetaResponse> {
    return request<MetaResponse>('/meta');
  },

  listProjects(): Promise<ListProjectsResponse> {
    return request<ListProjectsResponse>('/projects');
  },

  getProject(projectId: string): Promise<Project> {
    return request<Project>(`/projects/${projectId}`);
  },

  createProject(input: CreateProjectRequest): Promise<CreateProjectResponse> {
    return request<CreateProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  generateConcepts(
    projectId: string,
    input: GenerateConceptsRequest,
  ): Promise<GenerateConceptsResponse> {
    return request<GenerateConceptsResponse>(`/projects/${projectId}/concepts`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  generateWorld(
    projectId: string,
    input: GenerateWorldRequest,
  ): Promise<WorldGenerationJob> {
    return request<WorldGenerationJob>(`/projects/${projectId}/world`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
  },

  prepareWorldPrompt(
    projectId: string,
    input: PrepareWorldPromptRequest,
    signal?: AbortSignal,
  ): Promise<PrepareWorldPromptResponse> {
    return request<PrepareWorldPromptResponse>(`/projects/${projectId}/world-prompt`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  },

  getWorldJob(projectId: string, jobId: string): Promise<WorldGenerationJob> {
    return request<WorldGenerationJob>(`/projects/${projectId}/world-jobs/${jobId}`, {
      signal: AbortSignal.timeout(10_000),
    });
  },

  saveWorld(
    projectId: string,
    world: WorldSchema,
  ): Promise<SaveWorldResponse> {
    return request<SaveWorldResponse>(`/projects/${projectId}/world`, {
      method: 'PUT',
      body: JSON.stringify({ world }),
    });
  },

  chat(projectId: string, message: string): Promise<ChatEndpointResponse> {
    return request<ChatEndpointResponse>(`/projects/${projectId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },
};

export function resolveMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (API_BASE.startsWith('http') && url.startsWith('/api/')) {
    try {
      return new URL(API_BASE).origin + url;
    } catch {
      return url;
    }
  }
  return url;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '发生未知错误，请稍后重试。';
}
