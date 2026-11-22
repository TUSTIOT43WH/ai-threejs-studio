import type {
  ChatReply,
  ChatRequest,
  ConceptAnalysis,
  ConceptGenerationMode,
  ConceptImage,
  PromptExpansion,
  ProviderInfo,
  AiMode,
} from './ai-contracts';
import type { WorldSchema } from './world-schema';

export interface ReferenceImage {
  dataUrl: string;
  fileName?: string;
  mimeType: string;
}

export interface Project {
  id: string;
  prompt: string;
  referenceImage?: ReferenceImage;
  expansion: PromptExpansion;
  concepts: ConceptImage[];
  selectedConceptId?: string;
  analysis?: ConceptAnalysis;
  world?: WorldSchema;
  batchIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  prompt: string;
  title: string;
  coverImageUrl?: string;
  conceptCount: number;
  hasWorld: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListProjectsResponse {
  projects: ProjectSummary[];
}

export interface CreateProjectRequest {
  prompt: string;
  referenceImageDataUrl?: string;
  referenceFileName?: string;
}

export interface CreateProjectResponse {
  project: Project;
}

export interface GenerateConceptsRequest {
  mode: Exclude<ConceptGenerationMode, 'initial'>;
  count?: number;
  baseConceptId?: string;
}

export interface GenerateConceptsResponse {
  concepts: ConceptImage[];
}

export interface PrepareWorldPromptRequest {
  conceptId: string;
}

export const MAX_MODELING_PROMPT_LENGTH = 60_000;

export interface PrepareWorldPromptResponse {
  draftId: string;
  conceptId: string;
  preparedAt: string;
  analysis: ConceptAnalysis;
  /** True when an existing draft or saved world analysis was reused without calling the vision API. */
  reused: boolean;
}

export interface GenerateWorldRequest {
  conceptId: string;
  regenerate?: boolean;
  /** Confirmed draft from POST /projects/:id/world-prompt. */
  promptDraftId?: string;
  /** User-edited final modeling prompt; must be sent together with promptDraftId. */
  modelingPrompt?: string;
}

export interface WorldGenerationJob {
  id: string;
  projectId: string;
  projectTitle: string;
  conceptId: string;
  createdAt: string;
  updatedAt: string;
  phase: 'queued' | 'expanding' | 'generating' | 'validating' | 'saving' | 'complete' | 'failed';
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  world?: WorldSchema;
  analysis?: ConceptAnalysis;
  error?: string;
}

export type WorldJobSummary = Omit<WorldGenerationJob, 'world' | 'analysis'>;
export interface ListWorldJobsResponse { jobs: WorldJobSummary[] }

export type GenerateWorldResponse = WorldGenerationJob;

export interface SaveWorldRequest {
  world: WorldSchema;
}

export interface SaveWorldResponse {
  world: WorldSchema;
  updatedAt: string;
}

export interface ChatEndpointRequest extends ChatRequest { }

export type ChatEndpointResponse = ChatReply;

export interface MetaResponse {
  appName: string;
  phase: string;
  aiMode: AiMode;
  providers: ProviderInfo[];
  disclaimers: string[];
}

export type ChatApiProtocol = 'openai' | 'openai-responses' | 'anthropic' | 'gemini';
export type ImageApiProtocol = 'openai' | 'seedream' | 'gemini' | 'dashscope';
export type TokenParameter = 'max_tokens' | 'max_completion_tokens' | 'omit';
export type ImageResponseFormat = 'auto' | 'b64_json' | 'url';

export const CHAT_BASE_URLS = [
  'https://api.openai.com/v1',
  'https://api.deepseek.com/v1',
  'https://api.deepseek.com',
  'https://ark.cn-beijing.volces.com/api/v3',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://api.anthropic.com/v1',
  'https://generativelanguage.googleapis.com/v1beta',
] as const;

export interface ChatApiOptions {
  protocol?: ChatApiProtocol;
  jsonMode?: boolean;
  tokenParameter?: TokenParameter;
  maxOutputTokens?: number;
}

export interface ChatSettings extends ChatApiOptions {
  enabled: boolean;
  modelingEnabled: boolean;
  baseURL: string;
  model: string;
  hasApiKey: boolean;
}

export interface SaveChatSettingsRequest extends ChatApiOptions {
  enabled: boolean;
  modelingEnabled: boolean;
  baseURL: string;
  model: string;
  /** Write-only. Empty/omitted preserves the key only for an unchanged endpoint. */
  apiKey?: string;
}

export interface TestChatSettingsResponse {
  ok: true;
  message: string;
}

export const IMAGE_BASE_URLS = [
  'https://api.openai.com/v1',
  'https://ark.cn-beijing.volces.com/api/v3',
  'https://generativelanguage.googleapis.com/v1beta',
  'https://dashscope.aliyuncs.com/api/v1',
] as const;
export interface ImageApiOptions {
  protocol?: ImageApiProtocol;
  size?: string;
  responseFormat?: ImageResponseFormat;
}

export interface ImageSettings extends ImageApiOptions {
  enabled: boolean;
  baseURL: string;
  model: string;
  hasApiKey: boolean;
}
export interface SaveImageSettingsRequest extends ImageApiOptions {
  enabled: boolean;
  baseURL: string;
  model: string;
  apiKey?: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}
