import { BadGatewayException, BadRequestException, Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { ConceptGenerationRequest, GeneratedConceptImage, ImageApiOptions, ImageArtifact, ProviderInfo } from '@ai-three-studio/shared';
import { validateSync } from 'class-validator';
import { SaveImageSettingsDto } from '../settings/image-settings.dto';
import type { PrivateImageSettings } from '../settings/image-settings.service';
import { LongHttpAgent, type LongHttpRequestInit } from '../settings/long-http.agent';
import { isPublicApiUrl } from '../settings/public-api-url';
import { CONCEPT_STYLES, type ConceptStyleDefinition } from './mock/concept-styles';

export const IMAGE_HTTP_FETCH = Symbol('IMAGE_HTTP_FETCH');
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
// Includes base64 overhead and JSON metadata. Enforced on the decoded HTTP stream too.
export const IMAGE_MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 4096;
export const IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(IMAGE_MAX_BYTES / 3);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COMPOSITIONS = [
  'wide three-quarter view showing the complete subject and its supporting ground',
  'three-quarter view emphasizing the main subject',
  'elevated view showing the complete spatial layout',
  'eye-level three-quarter view with clear separation between structural parts',
  'slightly elevated view with a complete, unobscured silhouette',
];

function checkDimensions(width: number, height: number): void {
  if (!width || !height || width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION || width * height > IMAGE_MAX_PIXELS) {
    throw new Error('Invalid raster dimensions');
  }
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error();
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  checkDimensions(width, height);
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]!]?.includes(bytes[24]!) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28]! > 1) throw new Error();
  let offset = 8;
  let hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(kind)) throw new Error();
    if (kind === 'IHDR' && offset !== 8) throw new Error();
    // Do not accept animation containers as a single generated raster.
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') throw new Error();
    if (kind === 'IDAT' && length > 0) hasData = true;
    if (kind === 'IEND') {
      if (length !== 0 || end !== bytes.length || !hasData) throw new Error();
      return { width, height };
    }
    offset = end;
  }
  throw new Error();
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  let dimensions: { width: number; height: number } | undefined;
  let hasScan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!dimensions || !hasScan || offset !== bytes.length) throw new Error();
      return dimensions;
    }
    if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) throw new Error();
    if (offset + 2 > bytes.length) throw new Error();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error();
    // Baseline, extended sequential and progressive JPEG only.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (dimensions || length < 8 || bytes[offset + 2] !== 8) throw new Error();
      const channels = bytes[offset + 7]!;
      if (![1, 3, 4].includes(channels) || length !== 8 + 3 * channels) throw new Error();
      dimensions = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      checkDimensions(dimensions.width, dimensions.height);
    }
    offset += length;
    if (marker === 0xda) {
      if (!dimensions || length < 6) throw new Error();
      hasScan = true;
      // Skip entropy data, byte stuffing and restart markers. Stop at the next real marker.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
    }
  }
  throw new Error();
}

export function rasterArtifact(value: unknown): ImageArtifact {
  if (typeof value !== 'string' || !value.length || value.length > MAX_BASE64_LENGTH || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error();
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > IMAGE_MAX_BYTES || bytes.toString('base64') !== value) throw new Error();
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mimeType: 'image/png', ...pngDimensions(bytes), data: value, encoding: 'base64' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { mimeType: 'image/jpeg', ...jpegDimensions(bytes), data: value, encoding: 'base64' };
  }
  // In particular, never turn HTML, SVG, URLs or arbitrary bytes into an image file.
  throw new Error();
}

function selectStyles(request: ConceptGenerationRequest): ConceptStyleDefinition[] {
  if (request.mode === 'similar') {
    const style = CONCEPT_STYLES.find((entry) => entry.id === request.baseConcept?.styleId);
    if (!style) throw new BadRequestException('生成相似概念图需要有效的基础风格。');
    return Array.from({ length: request.count }, () => style);
  }
  const offset = (request.batchSeed >>> 0) % CONCEPT_STYLES.length;
  const rotated = [...CONCEPT_STYLES.slice(offset), ...CONCEPT_STYLES.slice(0, offset)];
  const ordered = request.mode === 'more'
    ? [...rotated.filter((style) => !request.existingStyleIds.includes(style.id)), ...rotated.filter((style) => request.existingStyleIds.includes(style.id))]
    : rotated;
  return ordered.slice(0, request.count);
}

function buildPrompt(request: ConceptGenerationRequest, style: ConceptStyleDefinition, index: number): string {
  const composition = COMPOSITIONS[((request.batchSeed >>> 0) + index) % COMPOSITIONS.length];
  return [
    `Original user description (the subject to depict): ${request.prompt}`,
    'Create a concept image faithful to that original subject and its specific objects. Do not replace it with a stock landscape.',
    `Art direction: ${style.labelEn}. ${style.tagline}`,
    `Composition variation: ${composition}.`,
    'This image will guide procedural 3D modeling. Show coherent, buildable volumes, clear connections, readable silhouettes and distinguishable materials. Keep the complete main subject in frame with margin; avoid foreground occlusion, extreme perspective, heavy depth-of-field blur and tiny decorative clutter. Use a compact scene extent where compatible with the request. Preserve the requested art style.',
    'Apply this art direction only where it does not contradict the original subject, requested time, colors or composition. No text or watermark.',
  ].join('\n');
}

const IMAGE_FAILURE_DETAILS = {
  configuration: '请先保存并启用独立的图片服务地址、协议、模型和 API Key。',
  endpoint: '独立图片服务地址与所选协议或模型不匹配，请检查根地址或完整接口地址。',
  authentication: '图片服务拒绝认证，请检查独立图片 API Key、模型开通情况和账号权限。',
  quota: '图片服务限流或额度不足，请检查余额与调用频率。',
  parameters: '图片服务拒绝请求参数，请检查协议、模型、图片尺寸与返回格式；豆包生图应选择 Seedream / 火山方舟协议。',
  notFound: '图片服务找不到接口或模型，请检查 Base URL 路径、模型 ID 和模型开通情况。',
  modelNotOpen: '方舟返回 ModelNotOpen：当前账号尚未开通此模型，请在火山方舟控制台开通对应图片模型。',
  modelIdAccessDisabled: '方舟返回 InvalidEndpointOrModel.ModelIDAccessDisabled：当前账号不允许直接使用 Model ID，请将图片模型填写为该账号下对应图片模型的 ep-... 推理接入点 ID。',
  modelNotFound: '方舟返回 InvalidEndpointOrModel.NotFound：模型或推理接入点不存在，或当前 API Key 无权访问；请核对同一账号、地域下的模型开通情况与接入点 ID。',
  pathNotFound: '图片服务返回 PathNotFound：网关未识别 API 路径，请核对 Base URL 和服务商要求的完整图片生成接口地址。',
  upstream: '图片服务返回错误，请检查服务商状态。',
  download: '生图服务已返回图片链接，但下载失败；链接可能失效或不可访问，请勿立即重复生图以免再次计费。',
  network: '连接图片服务或读取响应失败，请检查网络或代理；本次请求是否已计费需以服务商记录为准。',
  dns: '图片服务 DNS 解析失败，请检查域名和本机 DNS。',
  blocked: '图片地址解析到内网或保留 IP，已被安全策略拦截；使用代理 Fake-IP 时请为该域名配置真实 DNS 解析。',
  tls: '图片服务 TLS 证书校验失败，请检查代理证书或系统时间，不要关闭证书校验。',
  redirect: '图片接口或下载地址发生重定向，已为保护密钥阻止访问；请填写最终 HTTPS 接口地址。',
  response: '图片服务返回格式与所选协议不匹配，或返回了不安全的图片数据；请检查协议，当前支持 PNG / JPEG。',
  raster: '图片服务返回了不安全的图片数据或不支持的格式、尺寸；当前仅支持最大 4096 边长的 PNG / JPEG。',
  tooLarge: '图片响应超过本地大小限制，已停止接收不安全的图片数据；请降低图片尺寸后手动重试。',
} as const;

type ImageFailureReason = keyof typeof IMAGE_FAILURE_DETAILS;
const IMAGE_NOT_FOUND_CODES: Readonly<Record<string, ImageFailureReason>> = {
  ModelNotOpen: 'modelNotOpen',
  'InvalidEndpointOrModel.ModelIDAccessDisabled': 'modelIdAccessDisabled',
  'InvalidEndpointOrModel.NotFound': 'modelNotFound',
  PathNotFound: 'pathNotFound',
};
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;

export class ImageGenerationException extends BadGatewayException {
  constructor(readonly reason: ImageFailureReason, readonly upstreamStatus?: number) {
    super(`${ImageGenerationException.detail(reason, upstreamStatus)}未切换为 Mock；未自动重试。`);
  }

  get safeDetail(): string {
    return ImageGenerationException.detail(this.reason, this.upstreamStatus);
  }

  private static detail(reason: ImageFailureReason, status?: number): string {
    const detail = Object.hasOwn(IMAGE_FAILURE_DETAILS, reason) ? IMAGE_FAILURE_DETAILS[reason] : IMAGE_FAILURE_DETAILS.response;
    return `${detail}${Number.isInteger(status) && status! >= 100 && status! <= 599 ? `（HTTP ${status}）` : ''}`;
  }
}

function transportFailure(error: unknown): ImageGenerationException {
  const codes = new Set<string>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const item = current as { code?: unknown; cause?: unknown };
    if (typeof item.code === 'string') codes.add(item.code);
    current = item.cause;
  }
  const reason = codes.has('EACCES') ? 'blocked'
    : codes.has('ENOTFOUND') || codes.has('EAI_AGAIN') ? 'dns'
      : ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].some((code) => codes.has(code)) ? 'tls' : 'network';
  return new ImageGenerationException(reason);
}

type ImageConfig = PrivateImageSettings & ImageApiOptions;
type ImageSource = { base64?: unknown; url?: unknown; mimeType?: unknown };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

function exactlyOne(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) throw new Error();
  return value[0];
}

function imageEndpoint(config: ImageConfig): string {
  // Validate before normalization as URL parsing can hide credentials, whitespace and ports.
  if (!isPublicApiUrl(config.baseURL)) throw new Error();
  const base = config.baseURL.replace(/\/+$/, '');
  let endpoint: string;
  if (config.protocol === 'gemini') {
    const model = config.model.replace(/^models\//, '');
    const operation = /\/models\/([^/]+):generateContent$/.exec(base);
    if (!model || (operation && decodeURIComponent(operation[1]!) !== model)) throw new Error();
    endpoint = operation ? base : `${base}${base.endsWith('/models') ? '' : '/models'}/${encodeURIComponent(model)}:generateContent`;
  } else {
    const suffix = config.protocol === 'dashscope'
      ? '/services/aigc/multimodal-generation/generation' : '/images/generations';
    endpoint = base.endsWith(suffix) ? base : `${base}${suffix}`;
  }
  if (!isPublicApiUrl(endpoint)) throw new Error();
  return new URL(endpoint).href;
}

function imageRequest(config: ImageConfig, prompt: string): Pick<RequestInit, 'headers' | 'body'> {
  const size = config.size?.trim();
  const format = config.responseFormat ?? 'auto';
  let body: object;
  switch (config.protocol ?? 'openai') {
    case 'seedream':
      body = {
        model: config.model, prompt, size: size || '2K',
        response_format: format === 'auto' ? 'b64_json' : format,
        // Ark defaults to disabled. Explicitly disable for known batch-capable families;
        // opaque endpoint IDs and single-image-only models use that documented default.
        // No n, quality or GPT Image output parameters (nor Jimeng AK/SK/async calls).
        ...(/seedream[-_](?:4[-_.]|5[-_.]0[-_]lite)/i.test(config.model)
          ? { sequential_image_generation: 'disabled' } : {}),
      };
      break;
    case 'gemini':
      body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          candidateCount: 1, responseModalities: ['TEXT', 'IMAGE'],
          ...(size ? { imageConfig: { imageSize: size } } : {}),
        },
      };
      break;
    case 'dashscope':
      body = {
        model: config.model,
        input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
        parameters: { n: 1, ...(size ? { size: size.replace(/^(\d+)x(\d+)$/, '$1*$2') } : {}) },
      };
      break;
    case 'openai':
      body = {
        model: config.model, prompt, n: 1,
        ...(size ? { size } : {}),
        // GPT Image auto omits unsupported response_format; custom gateways may opt in.
        ...(format !== 'auto' ? { response_format: format }
          : /^dall-e-/i.test(config.model) ? { response_format: 'b64_json' } : {}),
      };
      break;
    default: throw new Error();
  }
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(config.protocol === 'gemini'
        ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify(body),
  };
}

function imageSource(payload: unknown, protocol: ImageApiOptions['protocol']): ImageSource {
  const root = object(payload);
  if (root.error || root.code) throw new Error();
  if (protocol === 'gemini') {
    const feedback = root.promptFeedback === undefined ? {} : object(root.promptFeedback);
    const candidate = object(exactlyOne(root.candidates));
    if ((feedback.blockReason && feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED')
      || (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP')) throw new Error();
    const parts = object(candidate.content).parts;
    if (!Array.isArray(parts)) throw new Error();
    const sources: ImageSource[] = [];
    for (const value of parts) {
      const part = object(value);
      if (part.thought === true) continue;
      if (part.inlineData !== undefined) {
        const data = object(part.inlineData);
        sources.push({ base64: data.data, mimeType: data.mimeType });
      }
      if (part.fileData !== undefined) {
        const data = object(part.fileData);
        sources.push({ url: data.fileUri, mimeType: data.mimeType });
      }
    }
    const source = exactlyOne(sources) as ImageSource;
    if (source.mimeType !== 'image/png' && source.mimeType !== 'image/jpeg') throw new Error();
    return source;
  }
  if (protocol === 'dashscope') {
    const choice = object(exactlyOne(object(root.output).choices));
    const content = object(choice.message).content;
    if (!Array.isArray(content)) throw new Error();
    const images = content.map(object).filter((part) => 'image' in part);
    if (root.usage !== undefined) {
      const count = object(root.usage).image_count;
      if (count !== undefined && count !== 1) throw new Error();
    }
    return { url: object(exactlyOne(images)).image };
  }
  const image = object(exactlyOne(root.data));
  if (image.error) throw new Error();
  // Some compatible APIs supply both representations of the same image. Prefer base64.
  return { base64: image.b64_json, url: image.url };
}

@Injectable()
export class LiveConceptImageProvider implements OnModuleDestroy {
  private agent?: LongHttpAgent;
  private readonly requests = new Set<AbortController>();
  private destroyed = false;

  readonly info: ProviderInfo = {
    id: 'live-concept-images',
    displayName: 'Configured text-to-image concepts',
    kind: 'image',
    mode: 'live',
    description: '使用独立图片设置和密钥按原始描述生成多风格概念图；不上传参考图片像素，相似图仅延续风格，非图生图。',
  };

  constructor(
    @Optional() @Inject(IMAGE_HTTP_FETCH)
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    for (const controller of this.requests) controller.abort();
    // destroy(), unlike close(), also releases stalled connections.
    await this.agent?.destroy();
  }

  async generate(config: ImageConfig, request: ConceptGenerationRequest): Promise<GeneratedConceptImage[]> {
    const snapshot = { ...config };
    if (!snapshot.enabled || !snapshot.apiKey || validateSync(Object.assign(new SaveImageSettingsDto(), snapshot), {
      whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false },
    }).length) {
      throw new ImageGenerationException('configuration');
    }
    try { imageEndpoint(snapshot); } catch {
      throw new ImageGenerationException('endpoint');
    }
    // Never silently increase a billable count, or permit an unbounded batch.
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > 5 || !request.prompt?.trim()) {
      throw new BadRequestException('请提供原始图片描述，每批生成 1 至 5 张概念图。');
    }
    const styles = selectStyles(request);
    const generated: GeneratedConceptImage[] = [];
    // Sequential requests stop on the first failure. No retries, repairs or Mock fallback.
    for (const [index, style] of styles.entries()) {
      const prompt = buildPrompt(request, style, index);
      const artifact = await this.generateOne(snapshot, prompt);
      generated.push({
        title: `${style.titlePrefix} · ${request.mode === 'similar' ? '风格变体' : '概念图'} ${index + 1}`,
        description: `${style.tagline} 由原始文字描述真实生成；未上传或分析参考图片像素，相似图仅延续风格，非图生图。`,
        styleId: style.id,
        styleLabel: style.label,
        styleLabelEn: style.labelEn,
        prompt,
        // Local batch metadata only; no provider seed/reproducibility is promised.
        seed: ((request.batchSeed >>> 0) + index) >>> 0,
        mock: false,
        referenceDriven: false,
        artifact,
      });
    }
    return generated;
  }

  private async generateOne(config: ImageConfig, prompt: string): Promise<ImageArtifact> {
    if (this.destroyed) throw new BadGatewayException('服务正在关闭，请求已取消。未切换为 Mock；未自动重试。');
    // No business deadline and no retries (including after a successful paid POST).
    const controller = new AbortController();
    this.requests.add(controller);
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error());
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([this.complete(config, prompt, controller.signal), cancelled]);
    } catch (error) {
      if (error instanceof ImageGenerationException) throw error;
      throw new ImageGenerationException('response');
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      controller.abort();
      this.requests.delete(controller);
    }
  }

  private async complete(config: ImageConfig, prompt: string, signal: AbortSignal): Promise<ImageArtifact> {
    const response = await this.fetchBytes(imageEndpoint(config), {
      method: 'POST', ...imageRequest(config, prompt),
    }, signal, IMAGE_MAX_RESPONSE_BYTES, ['application/json']);
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
    const source = imageSource(payload, config.protocol);
    let artifact: ImageArtifact;
    if (source.base64 !== undefined && source.base64 !== null) {
      try { artifact = rasterArtifact(source.base64); }
      catch { throw new ImageGenerationException('raster'); }
    } else {
      if (!isPublicApiUrl(source.url, true)) throw new Error();
      let decoded = source.url as string;
      for (;;) {
        if (decoded.includes(config.apiKey)) throw new Error();
        let next: string;
        try { next = decodeURIComponent(decoded); } catch { break; }
        if (next === decoded) break;
        decoded = next;
      }
      const url = new URL(source.url as string).href;
      // A signed provider URL is its own credential. Never copy POST auth, cookies or keys.
      const image = await this.fetchBytes(url, {
        method: 'GET', headers: { Accept: 'image/png, image/jpeg' }, credentials: 'omit', referrerPolicy: 'no-referrer',
      }, signal, IMAGE_MAX_BYTES, ['image/png', 'image/jpeg', 'application/octet-stream']);
      try { artifact = rasterArtifact(image.bytes.toString('base64')); }
      catch { throw new ImageGenerationException('raster'); }
      if (image.mimeType !== 'application/octet-stream' && artifact.mimeType !== image.mimeType) throw new Error();
    }
    if (source.mimeType !== undefined && artifact.mimeType !== source.mimeType) throw new Error();
    return artifact;
  }

  private async fetchBytes(
    url: string, init: RequestInit, signal: AbortSignal, maxBytes: number, mimeTypes: string[],
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    // Syntax validation on BOTH legs; LongHttpAgent guards the actual socket DNS lookup.
    if (!isPublicApiUrl(url, init.method === 'GET')) throw new Error();
    signal.throwIfAborted();
    const options: LongHttpRequestInit = {
      ...init, redirect: 'error', signal, dispatcher: this.agent ??= new LongHttpAgent(),
    };
    let response: Response;
    try { response = await this.fetcher(url, options); }
    catch (error) { throw transportFailure(error); }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void (reader ? reader.cancel() : response.body?.cancel())?.catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      if (response.redirected || (response.url && response.url !== url)) throw new ImageGenerationException('redirect');
      if (!response.ok) {
        const status = response.status;
        let reason: ImageFailureReason = init.method === 'GET' ? 'download'
          : status >= 300 && status < 400 ? 'redirect'
            : status === 401 || status === 403 ? 'authentication'
              : status === 429 ? 'quota'
                : status === 400 || status === 422 ? 'parameters'
                  : status === 404 ? 'notFound' : 'upstream';
        if (reason === 'notFound' && response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json'
          && !(Number(response.headers.get('content-length')) > MAX_ERROR_RESPONSE_BYTES)) {
          try {
            reader = response.body?.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (reader) {
              const chunk = await reader.read();
              signal.throwIfAborted();
              if (chunk.done) {
                const payload: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
                const code = object(object(payload).error).code;
                if (typeof code === 'string' && Object.hasOwn(IMAGE_NOT_FOUND_CODES, code)) reason = IMAGE_NOT_FOUND_CODES[code]!;
                break;
              }
              size += chunk.value.byteLength;
              if (size > MAX_ERROR_RESPONSE_BYTES) break;
              chunks.push(chunk.value);
            }
          } catch {
            // A malformed error body must not replace the known HTTP failure or expose provider text.
          }
        }
        throw new ImageGenerationException(reason, status);
      }
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!mimeTypes.includes(mimeType)) throw new ImageGenerationException('response');
      if (Number(response.headers.get('content-length')) > maxBytes) throw new ImageGenerationException('tooLarge');
      reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch (error) { throw transportFailure(error); }
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new ImageGenerationException('tooLarge');
        chunks.push(chunk.value);
      }
      return { bytes: Buffer.concat(chunks, size), mimeType };
    } finally {
      signal.removeEventListener('abort', cancel);
      // Also cancel on header errors, redirected replies, read errors and late shutdown replies.
      if (reader) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    }
  }
}
