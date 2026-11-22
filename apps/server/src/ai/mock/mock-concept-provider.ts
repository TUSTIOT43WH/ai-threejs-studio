import { Injectable } from '@nestjs/common';
import type {
  ConceptGenerationRequest,
  ConceptImageProvider,
  ConceptStyleId,
  GeneratedConceptImage,
  ProviderInfo,
} from '@ai-three-studio/shared';
import { renderConceptArtSvg } from './concept-art';
import { CONCEPT_STYLES, getConceptStyle } from './concept-styles';
import {
  detectSceneProfile,
  TIME_LABELS,
  type SceneProfileDefinition,
} from './scene-profiles';
import type { ConceptStyleDefinition } from './concept-styles';

const TITLE_VARIANTS: Record<ConceptStyleId, [string, string]> = {
  'painterly-dream': ['梦境柔光', '雾中晨光'],
  'low-poly': ['低多边国度', '折面晴空'],
  'cinematic-teal': ['电影暮色', '青橙时刻'],
  'storybook-watercolor': ['水彩童话', '纸间微风'],
  'neon-noir': ['霓虹夜行', '电光回路'],
};

const STYLE_PROMPTS: Record<ConceptStyleId, string> = {
  'painterly-dream':
    'soft painterly brushwork, dreamy atmospheric haze, floating light particles, pastel color grading, storybook environments',
  'low-poly':
    'stylized low-poly 3D illustration, faceted geometry, bold flat color blocks, crisp silhouettes, game-art concept',
  'cinematic-teal':
    'cinematic teal and orange color grade, dramatic backlight, atmospheric depth, film still composition, anamorphic flare',
  'storybook-watercolor':
    'gentle watercolor storybook illustration, paper grain, soft pigment blooms, pastel palette, hand-painted texture',
  'neon-noir':
    'neon noir concept art, high contrast night palette, glowing neon accents, scanlines, cyberpunk atmosphere, cinematic framing',
};

const COMPOSITIONS = [
  'wide establishing shot with strong foreground framing',
  'low camera angle with a hero object dominating the midground',
  'elevated three-quarter view revealing the full layout',
  'layered composition with a luminous path leading the eye inward',
];

function mixSeed(...values: number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  }
  hash ^= hash >>> 16;
  return hash >>> 0 || 1;
}

function rotateStyles(
  styles: ConceptStyleId[],
  offset: number,
): ConceptStyleId[] {
  if (styles.length === 0) return styles;
  const start = offset % styles.length;
  return [...styles.slice(start), ...styles.slice(0, start)];
}

function buildStylePrompt(
  style: ConceptStyleDefinition,
  profile: SceneProfileDefinition,
  request: ConceptGenerationRequest,
  composition: string,
): string {
  const envParts = [
    request.expansion.environmentHints.season === 'winter' ? 'snowy winter environment' : null,
    request.expansion.environmentHints.weather === 'light-rain'
      ? 'light rain and wet surfaces'
      : request.expansion.environmentHints.weather === 'heavy-rain'
        ? 'heavy rain and dramatic clouds'
        : request.expansion.environmentHints.weather === 'snow'
          ? 'falling snow'
          : null,
    TIME_LABELS[style.timeHint],
  ].filter((part): part is string => Boolean(part));

  return [
    `Environment concept art of ${profile.basePromptEn}.`,
    `Art direction: ${STYLE_PROMPTS[style.id]}.`,
    `Composition: ${composition}.`,
    envParts.length > 0 ? `Atmosphere: ${envParts.join(', ')}.` : '',
    'A single coherent world, rich environmental storytelling, no characters in focus, no text, no watermark.',
  ]
    .filter(Boolean)
    .join(' ');
}

function buildDescription(
  style: ConceptStyleDefinition,
  profile: SceneProfileDefinition,
  composition: string,
): string {
  const highlights = profile.keyElements.slice(0, 3).join('、');
  return `${style.tagline} 构图采用${composition}，重点呈现${highlights}。`;
}

@Injectable()
export class MockConceptImageProvider implements ConceptImageProvider {
  readonly info: ProviderInfo = {
    id: 'mock-concept-art',
    displayName: 'Mock Procedural Concept Art',
    kind: 'image',
    mode: 'mock',
    description:
      'Renders deterministic SVG concept art placeholders with five visually distinct art directions. Not a text-to-image model.',
  };

  async generate(
    request: ConceptGenerationRequest,
  ): Promise<GeneratedConceptImage[]> {
    const profile = detectSceneProfile(request.prompt);
    const count = Math.min(5, Math.max(3, request.count));

    if (request.mode === 'similar' && request.baseConcept) {
      const style = getConceptStyle(request.baseConcept.styleId);
      const variants = Array.from({ length: count }, (_, index) =>
        this.renderConcept(
          profile,
          style,
          request,
          index,
          index,
          true,
        ),
      );
      return variants;
    }

    const rotated = rotateStyles(profile.preferredStyles, request.batchSeed);
    let ordered = rotated;
    if (request.mode === 'more') {
      const unseen = rotated.filter(
        (styleId) => !request.existingStyleIds.includes(styleId),
      );
      ordered = [...unseen, ...rotated.filter((styleId) => unseen.includes(styleId) === false)];
    }
    const styles = ordered
      .slice(0, count)
      .map((styleId) => getConceptStyle(styleId));

    return styles.map((style, index) =>
      this.renderConcept(profile, style, request, index, index, false),
    );
  }

  private renderConcept(
    profile: SceneProfileDefinition,
    style: ConceptStyleDefinition,
    request: ConceptGenerationRequest,
    index: number,
    salt: number,
    isSimilar: boolean,
  ): GeneratedConceptImage {
    const styleIndex = CONCEPT_STYLES.findIndex((entry) => entry.id === style.id);
    const seed = mixSeed(
      request.batchSeed,
      styleIndex + 1,
      index + 1,
      salt + 7,
      request.mode === 'similar' ? 1543 : 0,
    );
    const paletteIndex = (seed >>> 4) % 2;
    const composition = COMPOSITIONS[seed % COMPOSITIONS.length] as string;
    const artifact = renderConceptArtSvg({
      profile,
      style,
      paletteIndex,
      seed,
    });

    const titleBase = `${TITLE_VARIANTS[style.id][paletteIndex]} · ${profile.sceneLabel}`;
    const title = isSimilar
      ? `${titleBase} · 变体 ${String.fromCharCode(65 + index)}`
      : titleBase;

    return {
      title,
      description: buildDescription(style, profile, composition),
      styleId: style.id,
      styleLabel: style.label,
      styleLabelEn: style.labelEn,
      prompt: buildStylePrompt(style, profile, request, composition),
      seed,
      mock: true,
      referenceDriven: false,
      artifact: {
        mimeType: 'image/svg+xml',
        width: artifact.width,
        height: artifact.height,
        data: artifact.svg,
        encoding: 'utf8',
      },
    };
  }
}
