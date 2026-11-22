import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import { planLiveWorld } from './live-world-planner';
import { ImageSettingsService } from '../settings/image-settings.service';
import { LiveConceptImageProvider } from './live-concept-provider';
import { expandFromConceptImage, selectedConceptPixels } from './live-image-analyzer';

/** Holds a private settings snapshot in a closure, never in API or stored project data. */
export interface WorldPlannerSnapshot {
  key: string;
  mode: 'mock' | 'live';
  analyze(request: ConceptAnalysisRequest, artifact?: ImageArtifact): Promise<ConceptAnalysis>;
  plan(request: WorldPlanRequest, onStage?: (phase: 'validating') => void, artifact?: ImageArtifact): Promise<WorldSchema>;
}
import type {
  ChatReply,
  ChatRequest,
  ChatProvider,
  ConceptAnalysis,
  ConceptAnalysisRequest,
  ConceptGenerationRequest,
  ConceptImageProvider,
  GeneratedConceptImage,
  ImageAnalyzerProvider,
  ImageArtifact,
  PromptExpansion,
  PromptExpansionRequest,
  PromptExpanderProvider,
  ProviderInfo,
  WorldPlanRequest,
  WorldPlannerProvider,
  WorldSchema,
} from '@ai-three-studio/shared';
import {
  CHAT_PROVIDER,
  CONCEPT_IMAGE_PROVIDER,
  IMAGE_ANALYZER,
  PROMPT_EXPANDER,
  WORLD_PLANNER,
} from './providers/provider.tokens';

@Injectable()
export class AiService {
  constructor(
    @Inject(PROMPT_EXPANDER)
    private readonly promptExpander: PromptExpanderProvider,
    @Inject(CONCEPT_IMAGE_PROVIDER)
    private readonly conceptImages: ConceptImageProvider,
    @Inject(IMAGE_ANALYZER)
    private readonly imageAnalyzer: ImageAnalyzerProvider,
    @Inject(WORLD_PLANNER)
    private readonly worldPlanner: WorldPlannerProvider,
    @Inject(CHAT_PROVIDER)
    private readonly chatProvider: ChatProvider,
    @Optional() @Inject(SettingsService)
    private readonly settings?: SettingsService,
    @Optional() @Inject(CompatibleChatService)
    private readonly liveChat?: CompatibleChatService,
    @Optional() @Inject(ImageSettingsService)
    private readonly imageSettings?: ImageSettingsService,
    @Optional() @Inject(LiveConceptImageProvider)
    private readonly liveImages?: LiveConceptImageProvider,
  ) {}

  describeProviders(): ProviderInfo[] {
    return [
      this.settings?.getSettings().modelingEnabled
        ? { id: 'vision-modeling-prompt', displayName: 'AI preview-to-modeling prompt', kind: 'llm', mode: 'live', description: '选图后使用建模 API 读取真实预览图并扩写精细建模提示词；要求模型支持图片输入。' }
        : this.promptExpander.info,
      this.imageSettings?.getSettings().enabled
        ? {
            id: `${this.imageSettings.getSettings().protocol ?? 'openai'}-concept-images`,
            displayName: `AI text-to-image (${this.imageSettings.getSettings().model})`,
            kind: 'image',
            mode: 'live',
            description: '按原始描述生成真实概念图；图片地址、模型与密钥独立于建模设置，不上传参考图片像素，相似图仅延续风格。',
          }
        : this.conceptImages.info,
      this.settings?.getSettings().modelingEnabled
        ? { id: 'live-preview-vision', displayName: 'AI preview analysis', kind: 'vision', mode: 'live', description: '将所选 PNG / JPEG 概念图发送至同一建模模型；可见细节与建模推断分别记录。' }
        : this.imageAnalyzer.info,
      this.settings?.getSettings().modelingEnabled
        ? {
            id: `${this.settings.getSettings().protocol ?? 'openai'}-world-planner`,
            displayName: `AI visual modeling (${this.settings.getSettings().model})`,
            kind: 'world-planner',
            mode: 'live',
            description: '所选预览图 → 看图扩写 → 预览图与提示词共同生成场景 JSON → 几何与渲染校验 → Three.js；支持轮廓拉伸、旋转体、曲线与相机光照，非精确三维重建或 GLB。',
          }
        : this.worldPlanner.info,
      this.settings?.getSettings().enabled
        ? {
            id: `${this.settings.getSettings().protocol ?? 'openai'}-chat`,
            displayName: `AI text chat (${this.settings.getSettings().model})`,
            kind: 'chat',
            mode: 'live',
            description: '真实文字对话；不修改场景，也不向聊天发送图片。看图扩写与 AI 建模由建模开关控制，概念图生成使用独立图片配置与密钥。',
          }
        : this.chatProvider.info,
    ];
  }

  expandPrompt(request: PromptExpansionRequest): Promise<PromptExpansion> {
    if (this.imageSettings?.getSettings().enabled) {
      return Promise.resolve({
        interpretedIntent: request.prompt, sceneLabel: request.prompt.slice(0, 60), expandedPrompt: request.prompt,
        keyElements: [], mood: '', paletteHint: '', suggestedStyleIds: [], environmentHints: {},
        provider: 'user-description', mock: false,
        notes: ['预览图直接使用原始描述；选图后由建模 API 看图扩写，不在生图前进行模板扩写。'],
      });
    }
    return this.promptExpander.expand(request);
  }

  async generateConcepts(
    request: ConceptGenerationRequest,
  ): Promise<GeneratedConceptImage[]> {
    const config = this.imageSettings?.getImageConfig();
    if (!config?.enabled) return this.conceptImages.generate(request);
    if (!this.liveImages) throw new ServiceUnavailableException('真实图片服务不可用。未切换为 Mock。');
    return this.liveImages.generate(config, request);
  }

  analyzeConcept(request: ConceptAnalysisRequest): Promise<ConceptAnalysis> {
    return this.imageAnalyzer.analyze(request);
  }

  getWorldPlannerKey(): string {
    return this.captureWorldPlanner().key;
  }

  captureWorldPlanner(): WorldPlannerSnapshot {
    const config = this.settings?.getChatConfig();
    if (!config?.modelingEnabled) {
      return {
        key: `mock:${this.worldPlanner.info.id}`, mode: 'mock',
        analyze: (request) => this.imageAnalyzer.analyze(request),
        plan: (request) => this.worldPlanner.plan(request),
      };
    }
    return {
      mode: 'live',
      key: JSON.stringify({
        pipeline: 'visual-parametric-scene-v4', mode: 'live', model: config.model, baseURL: config.baseURL.replace(/\/$/, ''),
        protocol: config.protocol ?? 'openai', jsonMode: config.jsonMode ?? false,
        tokenParameter: config.tokenParameter ?? 'max_tokens', maxOutputTokens: config.maxOutputTokens ?? 10000,
      }),
      analyze: async (request, artifact) => {
        if (!this.liveChat) throw new ServiceUnavailableException('看图扩写服务不可用。未切换为 Mock。');
        return expandFromConceptImage(this.liveChat, config, request, artifact);
      },
      plan: async (request, onStage, artifact) => {
        if (!this.liveChat) throw new ServiceUnavailableException('AI 建模服务不可用。未切换为 Mock。');
        return planLiveWorld(this.liveChat, config, request, onStage, selectedConceptPixels(request.concept, artifact));
      },
    };
  }

  planWorld(request: WorldPlanRequest, artifact?: ImageArtifact): Promise<WorldSchema> {
    return this.captureWorldPlanner().plan(request, undefined, artifact);
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    const config = this.settings?.getChatConfig();
    if (!config?.enabled) return this.chatProvider.reply(request);
    if (!this.liveChat) throw new ServiceUnavailableException('真实对话服务不可用。未切换为 Mock。');
    return this.liveChat.reply(config, request);
  }
}
