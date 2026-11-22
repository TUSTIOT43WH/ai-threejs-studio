import type {
  ConceptStyleId,
  SceneResource,
  WorldEnvironment,
  WorldSchema,
} from './world-schema';

export type AiMode = 'mock' | 'live';

export type ProviderKind =
  | 'llm'
  | 'image'
  | 'vision'
  | 'world-planner'
  | 'model-3d'
  | 'chat';

export interface ProviderInfo {
  id: string;
  displayName: string;
  kind: ProviderKind;
  mode: AiMode;
  description: string;
}

export interface ImageArtifact {
  mimeType: 'image/svg+xml' | 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** Raw SVG markup, or a base64 payload for raster images. */
  data: string;
  encoding: 'utf8' | 'base64';
}

export interface PromptExpansionRequest {
  prompt: string;
  referenceImageDataUrl?: string;
}

export interface EnvironmentHints {
  season?: WorldEnvironment['season'];
  weather?: WorldEnvironment['weather'];
  timeOfDay?: WorldEnvironment['timeOfDay'];
}

export interface PromptExpansion {
  interpretedIntent: string;
  sceneLabel: string;
  expandedPrompt: string;
  keyElements: string[];
  mood: string;
  paletteHint: string;
  suggestedStyleIds: ConceptStyleId[];
  environmentHints: EnvironmentHints;
  provider: string;
  mock: boolean;
  notes: string[];
}

export interface ConceptImage {
  id: string;
  projectId: string;
  batchId: string;
  title: string;
  description: string;
  styleId: ConceptStyleId;
  styleLabel: string;
  styleLabelEn: string;
  imageUrl: string;
  /** Prompt that would be sent to a real text-to-image provider. */
  prompt: string;
  seed: number;
  mock: boolean;
  referenceDriven: boolean;
  createdAt: string;
}

export type ConceptGenerationMode = 'initial' | 'more' | 'similar';

export interface ConceptGenerationRequest {
  projectId: string;
  prompt: string;
  expansion: PromptExpansion;
  count: number;
  mode: ConceptGenerationMode;
  batchSeed: number;
  existingStyleIds: ConceptStyleId[];
  baseConcept?: ConceptImage;
  referenceImageDataUrl?: string;
}

export interface GeneratedConceptImage {
  title: string;
  description: string;
  styleId: ConceptStyleId;
  styleLabel: string;
  styleLabelEn: string;
  prompt: string;
  seed: number;
  mock: boolean;
  referenceDriven: boolean;
  artifact: ImageArtifact;
}

export interface PromptExpanderProvider {
  readonly info: ProviderInfo;
  expand(request: PromptExpansionRequest): Promise<PromptExpansion>;
}

export interface ConceptImageProvider {
  readonly info: ProviderInfo;
  generate(request: ConceptGenerationRequest): Promise<GeneratedConceptImage[]>;
}

export interface ConceptAnalysisRequest {
  concept: ConceptImage;
  prompt: string;
  expansion: PromptExpansion;
}

export interface ConceptAnalysis {
  sceneSummary: string;
  composition: string;
  styleNotes: string;
  detectedElements: string[];
  palette: string[];
  provider: string;
  mock: boolean;
  disclaimer: string;
  modelingPrompt?: string;
  assumptions?: string[];
  report?: {
    visualAnalysis: string;
    objectInventory: string;
    spatialLayout: string;
    cameraAndLighting: string;
    assetStrategy: string;
    finalPrompt: string;
    uncertaintyAndValidation: string;
  };
}

export interface ImageAnalyzerProvider {
  readonly info: ProviderInfo;
  analyze(request: ConceptAnalysisRequest): Promise<ConceptAnalysis>;
}

export interface WorldPlanRequest {
  projectId: string;
  prompt: string;
  expansion: PromptExpansion;
  concept: ConceptImage;
  analysis: ConceptAnalysis;
  assetCatalog?: SceneResource[];
}

export interface WorldPlannerProvider {
  readonly info: ProviderInfo;
  plan(request: WorldPlanRequest): Promise<WorldSchema>;
}

export interface ModelAssetRequest {
  worldId: string;
  description: string;
  objectKind: string;
}

export interface ModelAssetResult {
  assetId: string;
  url?: string;
  provider: string;
  mock: boolean;
  status: 'planned' | 'ready' | 'failed';
  message: string;
}

/**
 * Phase 2 seam for text/image-to-3D model generation. Phase 1 intentionally
 * ships no implementation and only uses procedural placeholder assets.
 */
export interface ModelAssetProvider {
  readonly info: ProviderInfo;
  generate(request: ModelAssetRequest): Promise<ModelAssetResult>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatTurn[];
  worldSummary?: string;
}

export interface ChatReply {
  content: string;
  mock: boolean;
  provider: string;
  environmentSuggestion?: Partial<
    Pick<WorldEnvironment, 'season' | 'weather' | 'timeOfDay'>
  >;
}

export interface ChatProvider {
  readonly info: ProviderInfo;
  reply(request: ChatRequest): Promise<ChatReply>;
}

export interface AiProviderSuite {
  mode: AiMode;
  promptExpander: PromptExpanderProvider;
  conceptImages: ConceptImageProvider;
  imageAnalyzer: ImageAnalyzerProvider;
  worldPlanner: WorldPlannerProvider;
  modelAssets: ModelAssetProvider | null;
  chat: ChatProvider;
  describe(): ProviderInfo[];
}
