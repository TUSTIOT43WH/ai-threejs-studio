import 'reflect-metadata';
import { BadGatewayException } from '@nestjs/common';
import type { ConceptGenerationRequest, ImageApiOptions } from '@ai-three-studio/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongHttpAgent, type LongHttpRequestInit } from '../settings/long-http.agent';
import { IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION, IMAGE_MAX_RESPONSE_BYTES, ImageGenerationException, LiveConceptImageProvider } from './live-concept-provider';
import { MockPromptExpander } from './mock/mock-prompt-expander';
import { CONCEPT_STYLES } from './mock/concept-styles';

const config = { enabled: true, baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'only-image-key-stub' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=';
// A real 1x1 JPEG fixture, encoded locally without an API call.
const realJpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==';
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function imageResponse(data = png): Response { return jsonResponse({ data: [{ b64_json: data }] }); }
const signedUrl = 'https://images.vendor.example/result.png?Expires=123&Signature=a%2Bb%2Fc%3D';
function rasterResponse(data = png, mimeType = 'image/png'): Response {
  return new Response(Uint8Array.from(Buffer.from(data, 'base64')), { headers: { 'content-type': mimeType } });
}
function geminiResponse(parts: unknown[] = [{ inlineData: { mimeType: 'image/png', data: png } }]): Response {
  return jsonResponse({ candidates: [{ content: { parts, role: 'model' } }] });
}
function dashscopeResponse(content: unknown[] = [{ image: signedUrl }]): Response {
  return jsonResponse({ output: { choices: [{ message: { content, role: 'assistant' } }] }, usage: { image_count: 1 } });
}

describe('LiveConceptImageProvider (fake transport, never billable)', () => {
  let request: ConceptGenerationRequest;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let provider: LiveConceptImageProvider;

  beforeEach(async () => {
    request = {
      projectId: 'image-spec', prompt: '一只戴红色围巾的蓝色机械鲸鱼，漂浮在土星环旁',
      expansion: await new MockPromptExpander().expand({ prompt: '林中小屋' }),
      count: 1, mode: 'initial', batchSeed: 41, existingStyleIds: [],
      referenceImageDataUrl: 'data:image/png;base64,REFERENCE_PIXELS_NOT_TO_SEND',
    };
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => imageResponse());
    provider = new LiveConceptImageProvider(fetcher);
  });

  afterEach(async () => {
    await provider.onModuleDestroy();
    vi.restoreAllMocks();
  });

  it('uses the original subject and five styles, with one request per image and only the image key', async () => {
    request.count = 5;
    const generated = await provider.generate(config, request);
    expect(generated).toHaveLength(5);
    expect(new Set(generated.map((image) => image.styleId)).size).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const [index, image] of generated.entries()) {
      const [url, init] = fetcher.mock.calls[index]!;
      expect(url).toBe(`${config.baseURL}/images/generations`);
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${config.apiKey}` });
      const body = JSON.parse(init!.body as string);
      expect(body).toEqual({ model: config.model, n: 1, prompt: image.prompt });
      expect((init as LongHttpRequestInit).dispatcher).toBeInstanceOf(LongHttpAgent);
      expect(body.prompt).toContain(request.prompt);
      expect(body.prompt).toContain(image.styleLabelEn);
      expect(body.prompt).not.toContain(request.expansion.expandedPrompt);
      expect(body.prompt).not.toContain(request.expansion.sceneLabel);
      expect(init!.body).not.toContain('REFERENCE_PIXELS');
      expect(image).toMatchObject({ mock: false, referenceDriven: false, artifact: { mimeType: 'image/png', encoding: 'base64', width: 1, height: 1, data: png } });
      expect(image.description).toContain('未上传');
      expect(JSON.stringify(image)).not.toContain(config.apiKey);
    }
  });

  it.each(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5'])('does not send response_format to %s', async (model) => {
    await provider.generate({ ...config, model }, request);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).not.toHaveProperty('response_format');
  });

  it.each(['dall-e-2', 'dall-e-3'])('requests b64_json for %s and accepts signed JPEG raster', async (model) => {
    fetcher.mockImplementation(async () => imageResponse(realJpeg));
    const [image] = await provider.generate({ ...config, model, baseURL: `${config.baseURL}/` }, request);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ response_format: 'b64_json', n: 1 });
    expect(fetcher.mock.calls[0]![0]).toBe(`${config.baseURL}/images/generations`);
    expect(image?.artifact).toMatchObject({ mimeType: 'image/jpeg', width: 1, height: 1, encoding: 'base64' });
  });

  it.each(['https://api.deepseek.com/v1', 'https://custom.vendor.example:8443/proxy/v9', 'https://api.openai.com:443/v1'])
    ('accepts public custom hosts and arbitrary model IDs: %s', async (baseURL) => {
      await provider.generate({ ...config, baseURL, model: 'vendor/future-image:model-777' }, request);
      expect(fetcher.mock.calls[0]![0]).toBe(new URL(`${baseURL}/images/generations`).href);
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).model).toBe('vendor/future-image:model-777');
      expect(provider.info.id).not.toContain('openai');
      expect(provider.info.displayName).not.toContain('OpenAI');
    });

  it.each(['b64_json', 'url'] as const)('passes explicit OpenAI response format %s and optional size', async (responseFormat) => {
    await provider.generate({ ...config, model: 'custom-model', responseFormat, size: '1792x1024' }, request);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ size: '1792x1024', response_format: responseFormat });
  });

  it('lets the user override the DALL-E base64 default', async () => {
    await provider.generate({ ...config, model: 'dall-e-3', responseFormat: 'url' }, request);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).response_format).toBe('url');
  });

  it.each(['doubao-seedream-4-0-250828', 'doubao-seedream-4-5-251128', 'doubao-seedream-5-0-lite'])
    ('maps Seedream %s without unsupported OpenAI parameters or batches', async (model) => {
      await provider.generate({ ...config, protocol: 'seedream', model, baseURL: 'https://ark.cn-beijing.volces.com/api/v3' }, request);
      expect(fetcher.mock.calls[0]![0]).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
        model, prompt: expect.stringContaining(request.prompt), size: '2K', response_format: 'b64_json', sequential_image_generation: 'disabled',
      });
    });

  it.each(['ep-20261120-custom', 'doubao-seedream-3-0-t2i-250415', 'doubao-seedream-5-0-pro', 'doubao-seedream-5-5'])
    ('uses documented single-image defaults without capability guessing for Seedream %s', async (model) => {
      await provider.generate({ ...config, protocol: 'seedream', model, size: '2048x2048', responseFormat: 'url' }, request);
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
        model, prompt: expect.stringContaining(request.prompt), size: '2048x2048', response_format: 'url',
      });
    });

  it('maps Gemini generateContent with separate authentication and only text input', async () => {
    fetcher.mockImplementation(async () => geminiResponse([{ text: 'UNTRUSTED_PROVIDER_TEXT' }, { inlineData: { mimeType: 'image/jpeg', data: realJpeg } }]));
    const [result] = await provider.generate({ ...config, protocol: 'gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'models/custom-image', size: '2K' }, request);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/custom-image:generateContent');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey });
    expect(JSON.parse(init!.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: expect.stringContaining(request.prompt) }] }],
      generationConfig: { candidateCount: 1, responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '2K' } },
    });
    expect(result?.artifact.mimeType).toBe('image/jpeg');
    expect(JSON.stringify(result)).not.toContain('UNTRUSTED_PROVIDER_TEXT');
    expect(init!.body).not.toContain('REFERENCE_PIXELS');
  });

  it('maps native synchronous Dashscope, not OpenAI-compatible or async image synthesis', async () => {
    fetcher.mockImplementationOnce(async () => dashscopeResponse()).mockImplementationOnce(async () => rasterResponse());
    const [image] = await provider.generate({ ...config, protocol: 'dashscope', baseURL: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-future-image', size: '1328x1328' }, request);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` });
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'qwen-future-image', input: { messages: [{ role: 'user', content: [{ text: expect.stringContaining(request.prompt) }] }] },
      parameters: { n: 1, size: '1328*1328' },
    });
    expect(image?.artifact.data).toBe(png);
    expect(fetcher.mock.calls[1]![1]?.headers).toEqual({ Accept: 'image/png, image/jpeg' });
  });

  it.each([
    ['openai', 'https://gateway.example/v1/images/generations/', 'https://gateway.example/v1/images/generations'],
    ['seedream', 'https://gateway.example/api/v3/images/generations', 'https://gateway.example/api/v3/images/generations'],
    ['gemini', 'https://gateway.example/v1beta/models/custom:generateContent/', 'https://gateway.example/v1beta/models/custom:generateContent'],
    ['gemini', 'https://gateway.example/v1beta/models', 'https://gateway.example/v1beta/models/custom:generateContent'],
    ['dashscope', 'https://gateway.example/api/v1/services/aigc/multimodal-generation/generation/', 'https://gateway.example/api/v1/services/aigc/multimodal-generation/generation'],
  ] as const)('joins %s full endpoints without duplicate suffixes', async (protocol, baseURL, endpoint) => {
    fetcher.mockImplementation(async (_url, init) => init?.method === 'GET' ? rasterResponse()
      : protocol === 'gemini' ? geminiResponse() : protocol === 'dashscope' ? dashscopeResponse() : imageResponse());
    await provider.generate({ ...config, protocol, model: 'custom', baseURL }, request);
    expect(fetcher.mock.calls[0]![0]).toBe(endpoint);
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    if (protocol === 'gemini') expect(body.generationConfig).not.toHaveProperty('imageConfig');
    if (protocol === 'dashscope') expect(body.parameters).toEqual({ n: 1 });
  });

  it('rejects a Gemini full endpoint naming a different model before any paid request', async () => {
    await expect(provider.generate({ ...config, protocol: 'gemini', model: 'chosen-model', baseURL: 'https://gateway.example/v1beta/models/other-model:generateContent' }, request)).rejects.toThrow('独立');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the final Gemini image, not intermediate thought images', async () => {
    fetcher.mockImplementation(async () => geminiResponse([
      { thought: true, inlineData: { mimeType: 'image/png', data: png } },
      { inlineData: { mimeType: 'image/jpeg', data: realJpeg } },
    ]));
    const [result] = await provider.generate({ ...config, protocol: 'gemini' }, request);
    expect(result?.artifact.mimeType).toBe('image/jpeg');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not serve a Gemini thought-only image as the final result', async () => {
    fetcher.mockImplementation(async () => geminiResponse([{ thought: true, inlineData: { mimeType: 'image/png', data: png } }]));
    await expect(provider.generate({ ...config, protocol: 'gemini' }, request)).rejects.toThrow('未切换为 Mock');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['MAX_TOKENS', 'SAFETY', 'IMAGE_SAFETY', 'RECITATION'])('rejects Gemini %s even if an image was returned', async (finishReason) => {
    fetcher.mockImplementation(async () => jsonResponse({ candidates: [{ finishReason, content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }));
    await expect(provider.generate({ ...config, protocol: 'gemini' }, request)).rejects.toThrow('未切换为 Mock');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2])('never forwards API keys echoed in a returned URL with %s layers of encoding', async (layers) => {
    let secret = config.apiKey;
    for (let index = 0; index < layers; index++) secret = [...secret].map((letter) => `%${letter.charCodeAt(0).toString(16)}`).join('');
    fetcher.mockImplementation(async () => jsonResponse({ data: [{ url: `https://images.vendor.example/image.png?key=${secret}` }] }));
    await expect(provider.generate(config, request)).rejects.toThrow('未切换为 Mock');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('validates the final model-derived URL before any paid request', async () => {
    await expect(provider.generate({ ...config, protocol: 'gemini', model: 'models/../private' }, request)).rejects.toThrow('独立');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prioritizes unseen styles for more and keeps only the style for similar, without uploading pixels', async () => {
    request.mode = 'more';
    request.existingStyleIds = CONCEPT_STYLES.slice(0, 4).map((style) => style.id);
    expect((await provider.generate(config, request))[0]?.styleId).toBe(CONCEPT_STYLES[4]!.id);
    request.mode = 'similar';
    request.count = 3;
    request.baseConcept = {
      id: 'base', projectId: 'image-spec', batchId: 'batch', title: 'base title', description: 'DO_NOT_SEND_BASE_DESCRIPTION',
      styleId: 'low-poly', styleLabel: '低多边形', styleLabelEn: 'Low Poly', imageUrl: 'https://private.example/reference.png',
      prompt: 'DO_NOT_SEND_BASE_PROMPT', seed: 1, mock: false, referenceDriven: false, createdAt: '',
    };
    const generated = await provider.generate(config, request);
    expect(generated.every((image) => image.styleId === 'low-poly' && !image.referenceDriven)).toBe(true);
    expect(new Set(generated.map((image) => image.prompt)).size).toBe(3);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('DO_NOT_SEND');
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('private.example');
  });

  it('takes a private configuration snapshot for the whole batch', async () => {
    const mutable = { ...config };
    request.count = 2;
    fetcher.mockImplementation(async () => {
      mutable.apiKey = 'later-key';
      mutable.model = 'later-model';
      return imageResponse();
    });
    await provider.generate(mutable, request);
    expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({ Authorization: `Bearer ${config.apiKey}` });
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).model).toBe(config.model);
  });

  it.each([
    { enabled: false }, { apiKey: '' }, { apiKey: 'invalid\r\nkey' }, { model: '' },
    { baseURL: 'http://api.openai.com/v1' }, { baseURL: 'https://localhost/v1' },
    { baseURL: 'https://127.0.0.1/v1' }, { baseURL: 'https://api.openai.com/v1?x=1' },
    { baseURL: 'https://user:password@api.openai.com/v1' }, { baseURL: 'https://api.openai.com/v1#fragment' },
  ])('rejects invalid private config before network %j', async (invalid) => {
    await expect(provider.generate({ ...config, ...invalid }, request)).rejects.toThrow('独立');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 6, NaN, Infinity])('does not round or inflate a billable count %s', async (count) => {
    await expect(provider.generate(config, { ...request, count })).rejects.toThrow('1 至 5');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([301, 302, 401, 403, 429, 500])('rejects HTTP %s, hides the response and never follows URLs/retries', async (status) => {
    const cancel = vi.fn();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({ cancel }), {
      status, headers: { location: 'https://evil.example/key', 'content-type': 'text/html' },
    }));
    request.count = 5;
    const error = await provider.generate(config, request).catch((value: unknown) => value);
    expect(String(error)).toContain('未切换为 Mock');
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(JSON.stringify(error)).not.toContain('evil.example');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [400, 'parameters'], [422, 'parameters'], [401, 'authentication'], [403, 'authentication'],
    [404, 'notFound'], [429, 'quota'], [503, 'upstream'],
  ] as const)('preserves safe diagnostics for HTTP %s without provider response text', async (status, reason) => {
    fetcher.mockImplementation(async () => new Response(`UPSTREAM_SECRET_${config.apiKey}`, { status }));
    const error = await provider.generate(config, request).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ImageGenerationException);
    expect(error).toMatchObject({ reason, upstreamStatus: status });
    expect(String(error)).toContain(`HTTP ${status}`);
    expect(JSON.stringify(error)).not.toMatch(/UPSTREAM_SECRET|only-image-key-stub/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['ModelNotOpen', 'modelNotOpen', '尚未开通'],
    ['InvalidEndpointOrModel.ModelIDAccessDisabled', 'modelIdAccessDisabled', 'ep-...'],
    ['InvalidEndpointOrModel.NotFound', 'modelNotFound', '无权访问'],
    ['PathNotFound', 'pathNotFound', 'API 路径'],
  ] as const)('distinguishes Ark 404 %s without exposing provider-controlled messages', async (code, reason, detail) => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: { code, message: `SECRET_${config.apiKey}`, request_id: 'SECRET_ID' } }), {
      status: 404, headers: { 'content-type': 'application/json; charset=utf-8' },
    }));
    const error = await provider.generate({ ...config, protocol: 'seedream' }, { ...request, count: 5 }).catch((value: unknown) => value);
    expect(error).toMatchObject({ reason, upstreamStatus: 404 });
    expect(String(error)).toContain(detail);
    expect(String(error)).toContain(code);
    expect(String(error)).toContain('HTTP 404');
    expect(JSON.stringify(error)).not.toMatch(/SECRET|only-image-key-stub/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    JSON.stringify({ error: { code: 'SECRET_UNKNOWN_CODE', message: config.apiKey } }),
    JSON.stringify({ error: { code: 'constructor', message: config.apiKey } }),
    JSON.stringify({ error: { code: '__proto__', message: config.apiKey } }),
    JSON.stringify({ code: 'ModelNotOpen', error: config.apiKey }),
    'SECRET_INVALID_JSON',
    'null',
  ])('keeps generic 404 for unrecognized or malformed error JSON: %s', async (body) => {
    fetcher.mockImplementation(async () => new Response(body, { status: 404, headers: { 'content-type': 'application/json' } }));
    const error = await provider.generate(config, request).catch((value: unknown) => value);
    expect(error).toMatchObject({ reason: 'notFound', upstreamStatus: 404 });
    expect(JSON.stringify(error)).not.toMatch(/SECRET|only-image-key-stub|constructor|__proto__/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['header', 'stream'] as const)('bounds 404 diagnostics by %s and cancels oversized bodies', async (mode) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { if (mode === 'stream') controller.enqueue(new Uint8Array(16 * 1024 + 1)); },
      cancel,
    }), { status: 404, headers: { 'content-type': 'application/json', ...(mode === 'header' ? { 'content-length': '16385' } : {}) } });
    fetcher.mockResolvedValue(response);
    await expect(provider.generate(config, request)).rejects.toMatchObject({ reason: 'notFound', upstreamStatus: 404 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('preserves HTTP 404 if reading its diagnostic body fails', async () => {
    fetcher.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error(`SECRET_${config.apiKey}`)); },
    }), { status: 404, headers: { 'content-type': 'application/json' } }));
    await expect(provider.generate(config, request)).rejects.toMatchObject({ reason: 'notFound', upstreamStatus: 404 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not interpret image-download 404 codes as model activation failures', async () => {
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 'ModelNotOpen' } }), {
        status: 404, headers: { 'content-type': 'application/json' },
      }));
    await expect(provider.generate(config, request)).rejects.toMatchObject({ reason: 'download', upstreamStatus: 404 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'], ['EACCES', 'blocked'],
    ['CERT_HAS_EXPIRED', 'tls'], ['ECONNRESET', 'network'], ['UND_ERR_CONNECT_TIMEOUT', 'network'],
  ] as const)('reports safe transport diagnosis for %s', async (code, reason) => {
    fetcher.mockRejectedValue(new TypeError(`SECRET ${config.apiKey}`, { cause: Object.assign(new Error('SECRET_HOST'), { code }) }));
    const error = await provider.generate(config, request).catch((value: unknown) => value);
    expect(error).toMatchObject({ reason });
    expect(String(error)).not.toMatch(/SECRET|only-image-key-stub/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('distinguishes a failed image download from API authentication', async () => {
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(async () => new Response('PRIVATE_CDN_MESSAGE', { status: 403 }));
    const error = await provider.generate(config, request).catch((value: unknown) => value);
    expect(error).toMatchObject({ reason: 'download', upstreamStatus: 403 });
    expect(String(error)).toContain('请勿立即重复生图');
    expect(String(error)).not.toContain('PRIVATE_CDN_MESSAGE');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reproduces the saved Seedream protocol mismatch without a paid request', async () => {
    const current = { ...config, protocol: 'openai' as const, baseURL: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', model: 'doubao-seedream-5-5-261028', size: '', responseFormat: 'auto' as const };
    await provider.generate(current, request);
    const openaiBody = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(openaiBody).toHaveProperty('n', 1);
    expect(openaiBody).not.toHaveProperty('response_format');
    await provider.generate({ ...current, protocol: 'seedream' }, request);
    const seedreamBody = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    expect(seedreamBody).toMatchObject({ model: current.model, size: '2K', response_format: 'b64_json' });
    expect(seedreamBody).not.toHaveProperty('n');
    expect(seedreamBody).not.toHaveProperty('sequential_image_generation');
    expect(fetcher.mock.calls[1]![0]).toBe(current.baseURL);
  });

  it('stops after a partial batch failure and never regenerates successful or failed images', async () => {
    request.count = 5;
    fetcher.mockImplementationOnce(async () => imageResponse())
      .mockRejectedValueOnce(new BadGatewayException(`UPSTREAM_SECRET_${config.apiKey}`));
    const error = await provider.generate(config, request).catch((value: unknown) => value);
    expect(String(error)).toContain('未自动重试');
    expect(JSON.stringify(error)).not.toContain('UPSTREAM_SECRET');
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { data: [{ url: 'https://127.0.0.1/private' }] },
    { data: [{ b64_json: null, url: 'http://images.example/image.png' }] },
    { data: [] }, { data: [{ b64_json: png }, { b64_json: png }] }, { data: {} }, null,
    { data: [{ b64_json: 7 }] }, { data: [{ b64_json: '' }] },
    { data: [{ b64_json: `data:image/png;base64,${png}` }] },
    { data: [{ b64_json: `${png}\n` }] },
    { data: [{ b64_json: Buffer.from('<html>not a raster</html>').toString('base64') }] },
    { data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] },
    { data: [{ b64_json: Buffer.from('GIF89a').toString('base64') }] },
    { data: [{ b64_json: png.slice(0, 32) }] },
    { data: [{ b64_json: realJpeg.slice(0, 300) }] },
    { data: [{ b64_json: realJpeg.slice(0, -4) }] },
  ])('rejects private URLs, malformed and non-raster responses %#', async (payload) => {
    fetcher.mockImplementation(async () => jsonResponse(payload));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全的图片数据');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['openai', 'seedream', 'gemini', 'dashscope'] as const)
    ('downloads a signed %s URL without leaking POST authentication or metadata', async (protocol) => {
      fetcher.mockImplementationOnce(async () => protocol === 'gemini'
        ? geminiResponse([{ fileData: { mimeType: 'image/png', fileUri: signedUrl } }])
        : protocol === 'dashscope' ? dashscopeResponse() : jsonResponse({ data: [{ url: signedUrl }] }))
        .mockImplementationOnce(async () => rasterResponse());
      const generated = await provider.generate({ ...config, protocol, model: 'custom-image' }, request);
      expect(generated[0]?.artifact).toMatchObject({ data: png, encoding: 'base64', mimeType: 'image/png' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [url, init] = fetcher.mock.calls[1]!;
      expect(url).toBe(signedUrl);
      expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
      expect(init?.headers).toEqual({ Accept: 'image/png, image/jpeg' });
      expect(init?.body).toBeUndefined();
      expect(JSON.stringify(init)).not.toContain(config.apiKey);
      const dispatcher = (init as LongHttpRequestInit).dispatcher;
      expect(dispatcher).toBeInstanceOf(LongHttpAgent);
      expect(dispatcher).toBe((fetcher.mock.calls[0]![1] as LongHttpRequestInit).dispatcher);
      expect(JSON.stringify(generated)).not.toContain('Signature');
    });

  it('prefers validated base64 when one image supplies both representations', async () => {
    fetcher.mockImplementation(async () => jsonResponse({ data: [{ b64_json: png, url: signedUrl }] }));
    const generated = await provider.generate(config, request);
    expect(generated[0]?.artifact.data).toBe(png);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    'http://images.example/image.png', 'file:///etc/passwd', 'data:image/png;base64,AAA=',
    'https://127.0.0.1/private', 'https://2130706433/private', 'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/private', 'https://[::1]/private', 'https://[::ffff:127.0.0.1]/private',
    'https://localhost/image.png', 'https://service.internal/image.png', 'https://storage.local/image.png',
    'https://key:secret@images.example/image.png', 'https://images.example/image.png#fragment',
    'https://images.example/%2e%2e/private', 'https://images.example/image.png?x=%0d%0aHEADER',
    '//images.example/image.png', '', 9, null,
  ])('blocks unsafe returned URL %s before a GET, without billed retries', async (url) => {
    fetcher.mockImplementation(async () => jsonResponse({ data: [{ url }] }));
    await expect(provider.generate(config, { ...request, count: 5 })).rejects.toThrow('不安全');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['POST', 'GET'] as const)('rejects redirected and mismatched %s responses and cancels their bodies', async (method) => {
    for (const properties of [{ redirected: true }, { url: 'https://different.example/image.png' }]) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': method === 'POST' ? 'application/json' : 'image/png' } });
      Object.defineProperties(response, Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { value }])));
      fetcher.mockReset().mockImplementationOnce(async () => method === 'POST' ? response : jsonResponse({ data: [{ url: signedUrl }] }));
      if (method === 'GET') fetcher.mockImplementationOnce(async () => response);
      await expect(provider.generate(config, { ...request, count: 5 })).rejects.toMatchObject({ reason: 'redirect' });
      expect(fetcher).toHaveBeenCalledTimes(method === 'POST' ? 1 : 2);
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it.each([301, 302, 307, 308, 403, 500])('rejects image download HTTP %s and never retries the paid POST', async (status) => {
    const cancel = vi.fn();
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(async () => new Response(new ReadableStream({ cancel }), { status, headers: { location: 'https://127.0.0.1/private' } }));
    await expect(provider.generate(config, { ...request, count: 5 })).rejects.toThrow('未自动重试');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'misleading', 'oversized'] as const)('bounds downloaded rasters with %s content-length and cancels', async (length) => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => { controller.enqueue(new Uint8Array(1024 * 1024)); });
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(async () => new Response(new ReadableStream({ pull, cancel }), {
        headers: { 'content-type': 'image/png', ...(length === 'missing' ? {} : { 'content-length': length === 'misleading' ? '1' : String(IMAGE_MAX_BYTES + 1) }) },
      }));
    await expect(provider.generate(config, { ...request, count: 5 })).rejects.toThrow('不安全');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull.mock.calls.length).toBeLessThanOrEqual(length === 'oversized' ? 1 : 12);
  });

  it.each([
    ['text/html', png], ['image/svg+xml', Buffer.from('<svg/>').toString('base64')],
    ['image/png', Buffer.from('<html>forged image</html>').toString('base64')],
    ['image/jpeg', png], ['image/png', realJpeg], ['application/octet-stream', Buffer.from('GIF89a').toString('base64')],
  ])('rejects non-raster or mismatched download type %s', async (mimeType, data) => {
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(async () => rasterResponse(data, mimeType));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('accepts binary download MIME only after validating JPEG structure', async () => {
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(async () => rasterResponse(realJpeg, 'application/octet-stream'));
    expect((await provider.generate(config, request))[0]?.artifact.mimeType).toBe('image/jpeg');
  });

  it.each([
    { protocol: 'gemini', payload: { candidates: [] } },
    { protocol: 'gemini', payload: { candidates: [{ content: { parts: [{ text: 'no image' }] } }] } },
    { protocol: 'gemini', payload: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: png } }] } }] } },
    { protocol: 'gemini', payload: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/svg+xml', data: png } }] } }] } },
    { protocol: 'gemini', payload: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }, { inlineData: { mimeType: 'image/png', data: png } }] } }] } },
    { protocol: 'gemini', payload: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }, { content: { parts: [{ text: 'extra candidate' }] } }] } },
    { protocol: 'dashscope', payload: { output: { task_id: 'unsupported-async-task', task_status: 'PENDING' } } },
    { protocol: 'dashscope', payload: { output: { choices: [{ message: { content: [{ image: signedUrl }, { image: signedUrl }] } }] } } },
    { protocol: 'dashscope', payload: { output: { choices: [{ message: { content: [{ image: signedUrl }] } }] }, usage: { image_count: 2 } } },
    { protocol: 'dashscope', payload: { output: { choices: [{ message: { content: [] } }, { message: { content: [{ image: signedUrl }] } }] } } },
    { protocol: 'seedream', payload: { data: [{ b64_json: png }, { url: signedUrl }] } },
  ] satisfies Array<{ protocol: ImageApiOptions['protocol']; payload: unknown }>)('rejects malformed/multiple/async images before any download %#', async ({ protocol, payload }) => {
    fetcher.mockImplementation(async () => jsonResponse(payload));
    await expect(provider.generate({ ...config, protocol }, { ...request, count: 5 })).rejects.toThrow('不安全');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not start the next paid generation until the first image download completes', async () => {
    let downloaded!: (response: Response) => void;
    let downloading!: () => void;
    const started = new Promise<void>((resolve) => { downloading = resolve; });
    const pending = new Promise<Response>((resolve) => { downloaded = resolve; });
    fetcher.mockImplementationOnce(async () => jsonResponse({ data: [{ url: signedUrl }] }))
      .mockImplementationOnce(() => { downloading(); return pending; })
      .mockImplementationOnce(async () => imageResponse());
    const generation = provider.generate(config, { ...request, count: 2 });
    await started;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
    downloaded(rasterResponse());
    expect(await generation).toHaveLength(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'POST']);
  });

  it('ignores upstream revised prompts rather than persisting untrusted response metadata', async () => {
    fetcher.mockImplementation(async () => jsonResponse({ data: [{ b64_json: png, revised_prompt: `SECRET-${config.apiKey}` }] }));
    const result = await provider.generate(config, request);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result[0]?.prompt).toContain(request.prompt);
  });

  it.each([0, IMAGE_MAX_DIMENSION + 1, 0xffffffff])('rejects excessive or zero PNG dimensions %s', async (width) => {
    const bytes = Buffer.from(png, 'base64');
    bytes.writeUInt32BE(width, 16);
    fetcher.mockImplementation(async () => imageResponse(bytes.toString('base64')));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
  });

  it('rejects excessive JPEG dimensions', async () => {
    const bytes = Buffer.from(realJpeg, 'base64');
    const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    bytes.writeUInt16BE(IMAGE_MAX_DIMENSION + 1, sof + 7);
    fetcher.mockImplementation(async () => imageResponse(bytes.toString('base64')));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
  });

  it('rejects a raster above 10 MiB before accepting its signature', async () => {
    const bytes = Buffer.alloc(IMAGE_MAX_BYTES + 1);
    Buffer.from(png, 'base64').copy(bytes);
    fetcher.mockImplementation(async () => imageResponse(bytes.toString('base64')));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('bounds content-length without reading any oversized body', async () => {
    const cancel = vi.fn();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'application/json', 'content-length': String(IMAGE_MAX_RESPONSE_BYTES + 1) },
    }));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, '1'])('bounds chunked/decompressed JSON with content-length %s', async (contentLength) => {
    const cancel = vi.fn();
    fetcher.mockImplementation(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel,
    }), { headers: { 'content-type': 'application/json', ...(contentLength ? { 'content-length': contentLength } : {}) } }));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['text/html', 'image/png'])('rejects successful HTTP responses with content type %s', async (type) => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: png }] }), { headers: { 'content-type': type } }));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
  });

  it('rejects PNG animation containers even when their signature and dimensions are valid', async () => {
    const bytes = Buffer.from(png, 'base64');
    const animation = Buffer.alloc(20);
    animation.writeUInt32BE(8, 0);
    animation.write('acTL', 4, 'ascii');
    animation.writeUInt32BE(2, 8);
    const apng = Buffer.concat([bytes.subarray(0, 33), animation, bytes.subarray(33)]).toString('base64');
    fetcher.mockImplementation(async () => imageResponse(apng));
    await expect(provider.generate(config, request)).rejects.toThrow('不安全');
  });

  it.each(['POST', 'GET'] as const)('shutdown aborts a stalled %s body and destroys its shared dispatcher', async (method) => {
    const cancel = vi.fn();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const stalled = () => new Response(new ReadableStream({ pull() { reading(); }, cancel }, { highWaterMark: 0 }), {
      headers: { 'content-type': method === 'POST' ? 'application/json' : 'image/png' },
    });
    fetcher.mockImplementationOnce(async () => method === 'POST' ? stalled() : jsonResponse({ data: [{ url: signedUrl }] }));
    if (method === 'GET') fetcher.mockImplementationOnce(async () => stalled());
    const generation = provider.generate(config, { ...request, count: 5 });
    const rejection = expect(generation).rejects.toThrow('未自动重试');
    await started;
    const options = fetcher.mock.calls.at(-1)![1] as LongHttpRequestInit;
    const dispatcher = options.dispatcher as LongHttpAgent;
    const destroy = vi.spyOn(dispatcher, 'destroy');
    await provider.onModuleDestroy();
    await rejection;
    expect(options.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    // Undici's Promise overload delegates to its callback overload internally.
    expect(destroy).toHaveBeenCalled();
    expect(dispatcher.destroyed).toBe(true);
    await expect(provider.generate(config, request)).rejects.toThrow('服务正在关闭');
    expect(fetcher).toHaveBeenCalledTimes(method === 'POST' ? 1 : 2);
  });

  it('settles uncooperative transport on shutdown and cancels a late response', async () => {
    let finish!: (response: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const generation = provider.generate(config, { ...request, count: 5 });
    const rejection = expect(generation).rejects.toThrow('未自动重试');
    await provider.onModuleDestroy();
    await rejection;
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledOnce();
    expect((fetcher.mock.calls[0]![1] as LongHttpRequestInit).signal?.aborted).toBe(true);
  });

  it('reuses and releases one dispatcher across completed batches', async () => {
    await provider.generate(config, request);
    await provider.generate(config, request);
    const first = fetcher.mock.calls[0]![1] as LongHttpRequestInit;
    const second = fetcher.mock.calls[1]![1] as LongHttpRequestInit;
    expect(first.dispatcher).toBe(second.dispatcher);
    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(true);
    await provider.onModuleDestroy();
    expect((first.dispatcher as LongHttpAgent).destroyed).toBe(true);
  });

  it('redacts malformed JSON and stream/transport errors', async () => {
    for (const response of [
      () => new Response(`not JSON ${config.apiKey}`, { headers: { 'content-type': 'application/json' } }),
      () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(config.apiKey)); } }), { headers: { 'content-type': 'application/json' } }),
    ]) {
      fetcher.mockImplementation(async () => response());
      const error = await provider.generate(config, request).catch((value: unknown) => value);
      expect(String(error)).toContain('未切换为 Mock');
      expect(JSON.stringify(error)).not.toContain(config.apiKey);
    }
  });
});
