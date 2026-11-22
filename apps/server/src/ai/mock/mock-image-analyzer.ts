import { Injectable } from '@nestjs/common';
import type {
  ConceptAnalysis,
  ConceptAnalysisRequest,
  ImageAnalyzerProvider,
  ProviderInfo,
} from '@ai-three-studio/shared';
import { getConceptStyle } from './concept-styles';
import { detectSceneProfile } from './scene-profiles';

const COMPOSITION_BY_STYLE: Record<string, string> = {
  painterly: '柔焦的广角建立镜头，前中后景以雾光分层，主体位于视觉中心偏右。',
  'low-poly': '清晰的几何分区构图，地景与主体以大面积色块切分，轮廓利落。',
  cinematic: '电影宽画幅构图，青橙对比背光，地平线压低并保留大面积天空。',
  watercolor: '绘本式三分构图，留白较多，视觉重心落在中景主体与柔和前景。',
  neon: '高对比纵深构图，街道与建筑形成峡谷式透视，霓虹形成多个视觉锚点。',
};

@Injectable()
export class MockImageAnalyzer implements ImageAnalyzerProvider {
  readonly info: ProviderInfo = {
    id: 'mock-vision-analyzer',
    displayName: 'Mock Vision Metadata Analyzer',
    kind: 'vision',
    mode: 'mock',
    description:
      'Derives an analysis from concept generation metadata instead of reading image pixels. Labelled as mock in every response.',
  };

  async analyze(request: ConceptAnalysisRequest): Promise<ConceptAnalysis> {
    const profile = detectSceneProfile(request.prompt);
    const style = getConceptStyle(request.concept.styleId);
    const palette = style.palettes[0];

    return {
      sceneSummary: `${profile.sceneLabel}：${profile.summary}`,
      composition:
        COMPOSITION_BY_STYLE[style.artStyle] ??
        '以主体为锚点的分层构图，地景向远处自然过渡。',
      styleNotes: `${style.label}：${style.tagline} 光线倾向：${style.timeHint}。`,
      detectedElements: profile.keyElements,
      palette: [
        palette.skyTop,
        palette.mountainFar,
        palette.foliage,
        palette.wall,
        palette.water,
        palette.glow,
        palette.accent,
      ],
      provider: this.info.id,
      mock: true,
      disclaimer:
        'Mock 演示：该分析根据概念图元数据与提示词规则推导，并未读取图像像素；启用建模 API 并选择真实 PNG / JPEG 预览图后才会进行看图扩写。',
    };
  }
}
