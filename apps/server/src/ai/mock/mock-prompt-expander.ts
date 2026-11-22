import { Injectable } from '@nestjs/common';
import type {
  PromptExpansion,
  PromptExpansionRequest,
  PromptExpanderProvider,
  ProviderInfo,
} from '@ai-three-studio/shared';
import {
  detectEnvironmentHints,
  detectSceneProfile,
  SEASON_LABELS,
  TIME_LABELS,
  WEATHER_LABELS,
} from './scene-profiles';

@Injectable()
export class MockPromptExpander implements PromptExpanderProvider {
  readonly info: ProviderInfo = {
    id: 'mock-prompt-expander',
    displayName: 'Mock Prompt Expander',
    kind: 'llm',
    mode: 'mock',
    description:
      'Keyword-based prompt understanding and creative expansion. Deterministic, local and clearly labelled as a mock.',
  };

  async expand(request: PromptExpansionRequest): Promise<PromptExpansion> {
    const profile = detectSceneProfile(request.prompt);
    const environmentHints = detectEnvironmentHints(request.prompt);

    const environmentWords = [
      environmentHints.season ? SEASON_LABELS[environmentHints.season] : null,
      environmentHints.weather ? WEATHER_LABELS[environmentHints.weather] : null,
      environmentHints.timeOfDay ? TIME_LABELS[environmentHints.timeOfDay] : null,
    ].filter((word): word is string => Boolean(word));

    const environmentLabel =
      environmentWords.length > 0 ? environmentWords.join(' · ') : '由所选视觉风格决定光线氛围';

    const expandedPrompt =
      `Environment concept art of ${profile.basePromptEn}. ` +
      `Mood: ${profile.mood}. Atmosphere: ${environmentLabel}. ` +
      'Wide establishing composition with a clear foreground, midground and background. ' +
      'Use a distinct art direction per style rather than near-identical variations.';

    return {
      interpretedIntent: `一句话「${request.prompt.trim()}」→ ${profile.sceneLabel}（${environmentLabel}）`,
      sceneLabel: profile.sceneLabel,
      expandedPrompt,
      keyElements: profile.keyElements,
      mood: profile.mood,
      paletteHint: profile.paletteHint,
      suggestedStyleIds: profile.preferredStyles,
      environmentHints,
      provider: this.info.id,
      mock: true,
      notes: [
        'Phase 1 Mock：提示词扩展由本地关键词规则生成，并非大语言模型输出。',
        '5 张概念图为程序化 SVG 占位插画，用于验证链路，不代表真实文生图能力。',
        ...(request.referenceImageDataUrl
          ? [
              '参考图已记录在项目数据中，但 Mock 扩展不会理解图片像素；真实多模态视觉分析将在 Phase 2 接入。',
            ]
          : []),
      ],
    };
  }
}
