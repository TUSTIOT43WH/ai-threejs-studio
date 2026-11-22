import { BadGatewayException, Logger } from '@nestjs/common';
import {
  MAX_MODELING_PROMPT_LENGTH,
  type ConceptAnalysis,
  type ConceptAnalysisRequest,
  type ImageArtifact,
} from '@ai-three-studio/shared';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import type { PrivateChatSettings } from '../settings/settings.service';
import { rasterArtifact } from './live-concept-provider';
import {
  renderThreeJsExpansionTemplate,
  THREEJS_EXPANSION_SYSTEM,
} from './threejs-expansion-template';

export const VISION_EXPANSION_ERRORS = {
  image: '看图扩写需要真实的 PNG / JPEG 概念图，请先启用图片 API 并生成预览图；未使用 Mock 图片或文字推测替代。',
  response: '看图扩写结果校验失败：未返回可用的中文建模提示词，请检查模型输出后手动重试；未开始建模，未切换为 Mock。',
  length: '看图扩写结果超过提示词长度上限，请精简描述或换用支持更长输出的模型后手动重试；未开始建模，未切换为 Mock。',
} as const;

const MIN_MODELING_PROMPT_LENGTH = 40;
const REPORT_HEADING = /(^|[\r\n])\s*(?:[#>*_\-]+\s*)?[A-GＡ-Ｇ]\s*[.．、,，:：)）\-—–]\s*\S/u;

const logger = new Logger('VisionExpansion');

interface ReportSection {
  letter: string;
  number: string;
  titles: readonly string[];
}

/** Tolerates localized titles and Markdown decoration, but requires A–G order and content. */
const SECTIONS: readonly ReportSection[] = [
  { letter: 'A', number: '1', titles: ['Visual Analysis', '视觉分析', '图像视觉分析', '画面视觉分析', '场景视觉分析'] },
  { letter: 'B', number: '2', titles: ['Scene Object Inventory', 'Scene Object List', 'Object Inventory', '场景物体清单', '场景对象清单', '物体清单', '物体清单与外观', '对象清单'] },
  { letter: 'C', number: '3', titles: ['Spatial Layout', '空间布局', '空间结构', '三维空间布局', '空间布局规划'] },
  { letter: 'D', number: '4', titles: ['Camera and Lighting', 'Camera & Lighting', '相机与光照', '相机和光照', '摄像机与光照', '摄影机与光照', '相机与灯光', '镜头与光照', '相机与光影'] },
  { letter: 'E', number: '5', titles: ['Asset Strategy', '资产策略', '资源策略', '资产与资源策略'] },
  { letter: 'F', number: '6', titles: ['Final Three.js Generation Prompt', 'Final ThreeJS Generation Prompt', '最终 Three.js 生成提示词', '最终的 Three.js 生成提示词', '最终 Three.js 场景生成提示词', '最终的 Three.js 场景生成提示词', 'Three.js 最终生成提示词', '最终生成提示词'] },
  { letter: 'G', number: '7', titles: ['Uncertainty and Validation', 'Uncertainty & Validation', '不确定性与验证', '不确定性和验证', '不确定性与校验', '不确定性与验证方法', '不确定性验证'] },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Length of a known title at the start of the text, allowing flexible spacing and case. */
function titleLength(text: string, titles: readonly string[]): number | undefined {
  let best: number | undefined;
  for (const title of titles) {
    const pattern = new RegExp(`^${title.split(/\s+/).map(escapeRegExp).join('\\s*')}`, 'i');
    const match = pattern.exec(text);
    if (!match) continue;
    const next = text[match[0].length];
    if (next !== undefined && /[a-z0-9]/i.test(next)) continue;
    if (best === undefined || match[0].length > best) best = match[0].length;
  }
  return best;
}

// Markdown headings, bullets, blockquotes and emoji are all stripped as leading non-word symbols.
const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u;
const TRANSLATION = /^[（(【\[［][^）)】\]］]{0,80}[）)】\]］]/;
const CHINESE_DIGITS: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7' };

/** Removes closing decoration, translations and separators that follow the section title. */
function cleanHeadingTail(value: string, titles: readonly string[]): string {
  let tail = value;
  for (let round = 0; round < 8; round += 1) {
    const before = tail;
    tail = tail.replace(LEADING_SYMBOLS, '');
    tail = tail.replace(TRANSLATION, '');
    const alias = titleLength(tail, titles);
    if (alias !== undefined) tail = tail.slice(alias);
    if (tail === before) break;
  }
  return tail.trim();
}

function headingAt(rawLine: string): { index: number; inline: string } | undefined {
  // Full-width letters and digits are common in Chinese model output.
  let rest = rawLine.replace(/[Ａ-Ｇａ-ｇ１-７]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).trim();
  rest = rest.replace(LEADING_SYMBOLS, '');
  const identifier = /^([A-Za-z1-7一二三四五六七])\s*[.．、,，:：)）\-—–]\s*/.exec(rest);
  if (!identifier) return undefined;
  const rawId = identifier[1]!;
  const id = CHINESE_DIGITS[rawId] ?? rawId.toUpperCase();
  rest = rest.slice(identifier[0].length).replace(LEADING_SYMBOLS, '');
  for (let index = 0; index < SECTIONS.length; index += 1) {
    const section = SECTIONS[index]!;
    if (id !== section.letter && id !== section.number) continue;
    const length = titleLength(rest, section.titles);
    if (length === undefined) continue;
    return { index, inline: cleanHeadingTail(rest.slice(length), section.titles) };
  }
  return undefined;
}

export function parseVisualReport(output: string): NonNullable<ConceptAnalysis['report']> {
  const lines = output.split(/\r?\n/);
  const headings: Array<{ index: number; line: number; inline: string }> = [];
  for (let line = 0; line < lines.length; line += 1) {
    const heading = headingAt(lines[line]!);
    if (heading) headings.push({ ...heading, line });
  }
  if (headings.length !== SECTIONS.length) throw new Error(`Incomplete visual report (${headings.length}/${SECTIONS.length} sections)`);
  const content = headings.map((heading, position) => {
    if (heading.index !== position) throw new Error(`Invalid visual report section at ${SECTIONS[position]!.letter}`);
    const next = headings[position + 1]?.line ?? lines.length;
    const body = lines.slice(heading.line + 1, next).join('\n').trim();
    const section = [heading.inline, body].filter(Boolean).join('\n');
    if (!section) throw new Error(`Empty visual report section ${SECTIONS[position]!.letter}`);
    return section;
  });
  return {
    visualAnalysis: content[0]!,
    objectInventory: content[1]!,
    spatialLayout: content[2]!,
    cameraAndLighting: content[3]!,
    assetStrategy: content[4]!,
    finalPrompt: content[5]!,
    uncertaintyAndValidation: content[6]!,
  };
}

function unwrapCodeFence(output: string): string {
  const trimmed = output.trim();
  const fenced = /^```[a-z0-9_-]*\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function providerName(config: PrivateChatSettings): string {
  return `${config.protocol ?? 'openai'}:vision:${config.model}`.split(config.apiKey).join('[redacted]');
}

function reportAnalysis(
  report: NonNullable<ConceptAnalysis['report']>,
  output: string,
  config: PrivateChatSettings,
  disclaimer: string,
): ConceptAnalysis {
  return {
    report,
    modelingPrompt: report.finalPrompt,
    sceneSummary: report.visualAnalysis.slice(0, 1000),
    composition: report.spatialLayout.slice(0, 2000),
    styleNotes: report.cameraAndLighting.slice(0, 2000),
    detectedElements: report.objectInventory.split(/\r?\n/).filter((line) => line.trim()).slice(0, 60).map((line) => line.slice(0, 300)),
    palette: [...new Set(output.match(/#[0-9a-f]{6}\b/gi) ?? [])].slice(0, 16),
    assumptions: [report.uncertaintyAndValidation],
    provider: providerName(config),
    mock: false,
    disclaimer,
  };
}

function directPromptAnalysis(
  modelingPrompt: string,
  config: PrivateChatSettings,
): ConceptAnalysis {
  const paragraphs = modelingPrompt.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  const first = paragraphs[0] ?? modelingPrompt;
  return {
    modelingPrompt,
    sceneSummary: first.slice(0, 1000),
    composition: (paragraphs[1] ?? first).slice(0, 2000),
    styleNotes: (paragraphs.slice(2, 4).join('\n\n') || first).slice(0, 2000),
    detectedElements: modelingPrompt.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+\S/.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').slice(0, 300))
      .slice(0, 60),
    palette: [...new Set(modelingPrompt.match(/#[0-9a-f]{6}\b/gi) ?? [])].slice(0, 16),
    assumptions: ['扩写仅依据用户的原始描述与所选预览图；不可见部分与精确尺寸属于模型合理推断。'],
    provider: providerName(config),
    mock: false,
    disclaimer: '已将所选概念图的真实像素发送至建模 API，并按照扩写模板生成最终提示词；尺寸和遮挡部分属于建模推断，不是精确三维重建。',
  };
}

export function selectedConceptPixels(
  concept: ConceptAnalysisRequest['concept'], artifact: ImageArtifact | undefined,
): { mimeType: 'image/png' | 'image/jpeg'; data: string } {
  try {
    if (concept.mock || !artifact || artifact.encoding !== 'base64' || !['image/png', 'image/jpeg'].includes(artifact.mimeType)) throw new Error();
    const decoded = rasterArtifact(artifact.data);
    if (decoded.mimeType !== artifact.mimeType) throw new Error();
    return { mimeType: artifact.mimeType as 'image/png' | 'image/jpeg', data: decoded.data };
  } catch {
    throw new BadGatewayException(VISION_EXPANSION_ERRORS.image);
  }
}

export async function expandFromConceptImage(
  client: CompatibleChatService,
  config: PrivateChatSettings,
  request: ConceptAnalysisRequest,
  artifact: ImageArtifact | undefined,
): Promise<ConceptAnalysis> {
  const image = selectedConceptPixels(request.concept, artifact);

  const template = renderThreeJsExpansionTemplate({
    userPrompt: request.prompt,
    sceneType: '请根据用户描述和预览图自动判断；优先选择构图紧凑、便于观察的三维场景。',
    additionalRequirements: [
      `用户选定的预览图风格：${request.concept.styleLabel}（${request.concept.styleId}）。`,
      '只输出最终的中文建模提示词，不要输出 A–G 报告、JSON、代码块、模板复述或额外解释。',
    ].join('\n'),
  });
  const output = await client.visualCompletion(config, THREEJS_EXPANSION_SYSTEM, template, image);
  const content = unwrapCodeFence(output);
  const disclaimer = '已将所选概念图的真实像素发送至建模 API，并结合扩写模板生成最终提示词；尺寸和遮挡部分属于建模推断，不是精确三维重建。';

  let report: NonNullable<ConceptAnalysis['report']> | undefined;
  try {
    report = parseVisualReport(content);
  } catch (error) {
    if (REPORT_HEADING.test(content)) {
      // Parser messages contain only fixed text and section counts, never provider output.
      logger.warn(error instanceof Error ? error.message : 'Incomplete visual report');
      throw new BadGatewayException(VISION_EXPANSION_ERRORS.response);
    }
  }

  if (report) {
    if (report.finalPrompt.length > MAX_MODELING_PROMPT_LENGTH) {
      throw new BadGatewayException(VISION_EXPANSION_ERRORS.length);
    }
    return reportAnalysis(report, content, config, disclaimer);
  }

  if (content.length < MIN_MODELING_PROMPT_LENGTH || /^[[{]/.test(content)) {
    logger.warn('Unusable direct expansion output');
    throw new BadGatewayException(VISION_EXPANSION_ERRORS.response);
  }
  if (content.length > MAX_MODELING_PROMPT_LENGTH) {
    throw new BadGatewayException(VISION_EXPANSION_ERRORS.length);
  }
  return directPromptAnalysis(content, config);
}
