import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatibleChatService, CHAT_TIMEOUT_MS, MODELING_MAX_RESPONSE_BYTES, type ModelingImageInput } from './compatible-chat.service';
import { BadGatewayException } from '@nestjs/common';
import type { ChatApiProtocol } from '@ai-three-studio/shared';
import type { PrivateChatSettings } from './settings.service';
import { Agent } from 'undici';
import { LongHttpAgent, type LongHttpRequestInit } from './long-http.agent';

const config = { enabled: true, modelingEnabled: false, baseURL: 'https://api.openai.com/v1', model: 'stub-model', apiKey: 'stub-key-never-valid-123' };
const completion = (content: unknown = 'A text-only suggestion') => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
const protocols: ChatApiProtocol[] = ['openai', 'openai-responses', 'anthropic', 'gemini'];
// Local 1x1 raster fixtures; decoding/validation belongs to the caller, not this transport.
const modelingImages: ModelingImageInput[] = [
  { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=' },
  { mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==' },
];
const modelingPhases = [
  { label: '建模', image: undefined },
  { label: '看图扩写', image: modelingImages[0]! },
];
const protocolPhases = protocols.flatMap((protocol) => modelingPhases.map((phase) => ({ protocol, ...phase })));
const payloadFor = (protocol: ChatApiProtocol, content = '{"ok":true}') => {
  switch (protocol) {
    case 'openai': return { choices: [{ finish_reason: 'stop', message: { content } }] };
    case 'openai-responses': return { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content }] }] };
    case 'anthropic': return { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: content }] };
    case 'gemini': return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: content }] } }] };
  }
};
const responseFor = (protocol: ChatApiProtocol, content?: string) => new Response(JSON.stringify(payloadFor(protocol, content)));
const requestBody = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) => JSON.parse(fetcher.mock.calls[index]![1]!.body as string);

describe('CompatibleChatService (stub HTTP only)', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(['https://api.openai.com/v1', 'https://api.deepseek.com/v1/', 'https://api.deepseek.com', 'https://api.customvendor.com/gateway/v42'])('calls chat/completions at %s and labels real replies', async (baseURL) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion());
    const client = new CompatibleChatService(fetcher);
    const reply = await client.reply({ ...config, baseURL }, {
      message: 'Suggest a season', worldSummary: 'Forest · 20 objects',
      history: [{ role: 'user', content: 'Hello' }],
    });
    expect(reply).toEqual({ content: 'A text-only suggestion', mock: false, provider: 'openai-compatible:stub-model' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${baseURL.replace(/\/$/, '')}/chat/completions`);
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({ Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: 'stub-model', stream: false, max_tokens: 512 });
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Suggest a season' });
    expect(body.messages[0].content).toContain('概念图可由 AI 或 Mock 生成');
    expect(body.messages[0].content).toContain('本对话仅接收文字，未接收或分析图片');
    expect(body.messages[0].content).toContain('看图扩写是独立功能');
    expect(body.messages[0].content).not.toContain('视觉分析未进行');
    expect(body.messages[0].content).not.toContain('参考图未被分析');
    expect((init as LongHttpRequestInit).dispatcher).toBeInstanceOf(LongHttpAgent);
    expect(body).not.toHaveProperty('response_format');
    expect(body.messages[1].content).toContain('Forest');
    expect(JSON.stringify(body)).not.toContain(config.apiKey);
    expect(reply).not.toHaveProperty('environmentSuggestion');
  });

  it.each([401, 403, 429, 400, 500, 302])('returns safe errors for upstream status %s without fallback, retries or response leakage', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`error ${config.apiKey}`, { status }));
    const client = new CompatibleChatService(fetcher);
    const error = await client.reply(config, { message: 'hello' }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('未切换为 Mock');
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('redacts even network errors containing the key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`network failed ${config.apiKey}`));
    await expect(new CompatibleChatService(fetcher).reply(config, { message: 'hello' })).rejects.toThrow('真实对话请求失败');
    await expect(new CompatibleChatService(fetcher).reply(config, { message: 'hello' })).rejects.not.toThrow(config.apiKey);
  });

  it.each([null, '', [], { text: 'bad' }])('rejects malformed or empty completions: %j', async (content) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion(content));
    await expect(new CompatibleChatService(fetcher).reply(config, { message: 'hello' })).rejects.toThrow('真实对话请求失败');
  });

  it('rejects non-JSON and over-sized provider output safely', async () => {
    for (const text of ['not-json', 'x'.repeat(513 * 1024)]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(text));
      await expect(new CompatibleChatService(fetcher).reply(config, { message: 'hello' })).rejects.toThrow('真实对话请求失败');
    }
  });

  it('never returns an echoed credential as reply content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion(`echo ${config.apiKey}`));
    const result = await new CompatibleChatService(fetcher).reply(config, { message: 'hello' });
    expect(result.content).toBe('echo [redacted]');
  });

  it.each([
    'https://127.0.0.1/v1', 'https://localhost/v1', 'https://[::1]/v1', 'https://10.0.0.1/v1',
    'http://api.customvendor.com/v1', 'https://user:pass@api.customvendor.com/v1',
    `https://api.customvendor.com/v1?key=${config.apiKey}`, 'https://api.customvendor.com/v1#fragment',
  ])('never sends secrets to unsafe endpoint %s', async (baseURL) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new CompatibleChatService(fetcher).reply({ ...config, baseURL }, { message: 'hello' })).rejects.toThrow('请先');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not make a network request without a saved key', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new CompatibleChatService(fetcher).reply({ ...config, apiKey: '' }, { message: 'hello' })).rejects.toThrow('请先');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('times out and aborts a stalled request with a safe message', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const request = new CompatibleChatService(fetcher).reply(config, { message: 'hello' });
    const assertion = expect(request).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
    await assertion;
    expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('retains the 30s deadline for explicit connection tests, including the response body', async () => {
    vi.useFakeTimers();
    for (const waitingForBody of [false, true]) {
      const cancel = vi.fn();
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => waitingForBody
        ? Promise.resolve(new Response(new ReadableStream({ start() {}, cancel })))
        : new Promise(() => undefined));
      const client = new CompatibleChatService(fetcher);
      const task = client.testConnection(config);
      const assertion = expect(task).rejects.toThrow('对话服务响应超时');
      await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS - 1);
      expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
      expect((fetcher.mock.calls[0]![1] as LongHttpRequestInit).dispatcher).toBeInstanceOf(LongHttpAgent);
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).max_tokens).toBe(16);
      expect(fetcher).toHaveBeenCalledOnce();
      if (waitingForBody) expect(cancel).toHaveBeenCalledOnce();
      await client.onModuleDestroy();
    }
  });

  it('reuses one safe agent for modeling, replies and tests, and destroys it on shutdown', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => completion('{}'));
    const client = new CompatibleChatService(fetcher);
    await client.structuredCompletion(config, 'JSON only', 'a rocket');
    await client.structuredCompletion(config, 'JSON only', 'a tree');
    await client.reply(config, { message: 'hello' });
    await client.testConnection(config);
    const first = fetcher.mock.calls[0]![1] as LongHttpRequestInit;
    const second = fetcher.mock.calls[1]![1] as LongHttpRequestInit;
    expect(first.dispatcher).toBeInstanceOf(LongHttpAgent);
    expect(first.dispatcher).toBe(second.dispatcher);
    expect((fetcher.mock.calls[2]![1] as LongHttpRequestInit).dispatcher).toBe(first.dispatcher);
    expect((fetcher.mock.calls[3]![1] as LongHttpRequestInit).dispatcher).toBe(first.dispatcher);
    const destroy = vi.spyOn(first.dispatcher!, 'destroy');
    await client.onModuleDestroy();
    // Undici's Promise overload internally calls its callback overload again.
    expect(destroy).toHaveBeenCalled();
    expect((first.dispatcher as LongHttpAgent).destroyed).toBe(true);
    await expect(client.structuredCompletion(config, 'JSON only', 'another')).rejects.toThrow('服务正在关闭');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(['headers', 'body'])('shutdown cancels all pending modeling requests waiting for %s without misreporting a timeout', async (waitingFor) => {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => waitingFor === 'body'
      ? Promise.resolve(new Response(new ReadableStream({ start() {}, cancel })))
      : new Promise(() => undefined));
    const client = new CompatibleChatService(fetcher);
    const tasks = [client.structuredCompletion(config, 'JSON only', 'one'), client.structuredCompletion(config, 'JSON only', 'two', modelingImages[0])];
    const assertions = tasks.map((task) => expect(task).rejects.toThrow('服务正在关闭，请求已取消'));
    // Allow the resolved response to enter its reader before shutdown.
    await Promise.resolve();
    const dispatcher = (fetcher.mock.calls[0]![1] as LongHttpRequestInit).dispatcher as LongHttpAgent;
    await client.onModuleDestroy();
    await Promise.all(assertions);
    expect(fetcher.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
    expect(dispatcher.destroyed).toBe(true);
    if (waitingFor === 'body') expect(cancel).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('overrides even fetch-supplied 300s header/body limits at the underlying dispatcher', async () => {
    const dispatch = vi.spyOn(Agent.prototype, 'dispatch').mockReturnValue(true);
    const agent = new LongHttpAgent();
    const options = { origin: 'https://api.openai.com', path: '/v1/chat/completions', method: 'POST' as const, headersTimeout: 300_000, bodyTimeout: 300_000 };
    const handler = {};
    try {
      expect(agent.dispatch(options, handler)).toBe(true);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
      expect(options).toMatchObject({ headersTimeout: 300_000, bodyTimeout: 300_000 });
    } finally {
      await agent.destroy();
    }
  });

  it('routes the production global fetch through the no-timeout dispatcher without real HTTP', async () => {
    // Stub below global fetch: exercise its real dispatcher integration without sockets or API charges.
    const dispatch = vi.spyOn(Agent.prototype, 'dispatch').mockImplementation((_options, handler) => {
      handler.onConnect?.(() => undefined);
      handler.onHeaders?.(200, [Buffer.from('content-type'), Buffer.from('application/json')], () => undefined, 'OK');
      handler.onData?.(Buffer.from(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
      handler.onComplete?.([]);
      return true;
    });
    const client = new CompatibleChatService();
    try {
      await expect(client.structuredCompletion(config, 'JSON only', 'a rocket')).resolves.toEqual({ ok: true });
      expect(dispatch).toHaveBeenCalledOnce();
      expect(dispatch.mock.calls[0]![0]).toMatchObject({ headersTimeout: 0, bodyTimeout: 0, method: 'POST', path: '/v1/chat/completions' });
    } finally {
      await client.onModuleDestroy();
    }
  });

  it.each(protocols)('sends native %s requests and labels arbitrary models without leaking credentials', async (protocol) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responseFor(protocol, 'first second'));
    const client = new CompatibleChatService(fetcher);
    const model = protocol === 'gemini' ? 'custom.model + preview?#' : 'custom/model + preview?#';
    const result = await client.reply({ ...config, protocol, model, baseURL: 'https://api.customvendor.com/proxy/v42/' }, {
      message: 'new question', worldSummary: 'Forest', history: [{ role: 'user', content: 'old question' }, { role: 'assistant', content: 'old answer' }],
    });
    const [url, init] = fetcher.mock.calls[0]!;
    const suffix = { openai: 'chat/completions', 'openai-responses': 'responses', anthropic: 'messages', gemini: `models/${encodeURIComponent(model)}:generateContent` }[protocol];
    expect(url).toBe(`https://api.customvendor.com/proxy/v42/${suffix}`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', dispatcher: expect.any(LongHttpAgent) });
    const body = requestBody(fetcher);
    expect(result).toEqual({ content: 'first second', mock: false, provider: `${protocol === 'openai' ? 'openai-compatible' : protocol}:${model}` });
    expect(JSON.stringify(body)).not.toContain(config.apiKey);
    expect(String(url)).not.toContain(config.apiKey);
    if (protocol === 'openai' || protocol === 'openai-responses') {
      expect(init!.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` });
      expect(body.model).toBe(model);
      const messages = body.messages ?? body.input;
      expect(messages.map((message: { role: string }) => message.role)).toEqual(['system', 'system', 'user', 'assistant', 'user']);
      expect(messages.at(-1)).toEqual({ role: 'user', content: 'new question' });
      if (protocol === 'openai-responses') {
        expect(body.max_output_tokens).toBe(512);
        expect(body).not.toHaveProperty('messages');
        expect(body).not.toHaveProperty('max_tokens');
      }
    } else if (protocol === 'anthropic') {
      expect(init!.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' });
      expect(body).toMatchObject({ model, max_tokens: 512, stream: false });
      expect(body.system).toContain('Forest');
      expect(body.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'old question' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'new question' }] },
      ]);
    } else {
      expect(init!.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey });
      expect(body.systemInstruction.parts[0].text).toContain('Forest');
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'old question' }] },
        { role: 'model', parts: [{ text: 'old answer' }] },
        { role: 'user', parts: [{ text: 'new question' }] },
      ]);
      expect(body.generationConfig).toEqual({ maxOutputTokens: 512 });
      expect(body).not.toHaveProperty('model');
      expect(body).not.toHaveProperty('stream');
    }
    await client.onModuleDestroy();
  });

  it.each(protocols.flatMap((protocol) => modelingImages.map((image) => ({ protocol, image }))))('sends $image.mimeType once in the native $protocol image field, then returns to text-only calls', async ({ protocol, image }) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responseFor(protocol));
    const client = new CompatibleChatService(fetcher);
    const settings = { ...config, protocol, model: 'custom-visual-model', maxOutputTokens: 23000 };
    const prompt = '原始要求：参考选定预览图，扩写 Three.js 场景的形状、材质、布局和灯光。';
    const system = 'Return a detailed modeling prompt.';
    const systemContent = `${system}\n\nReturn only valid JSON, without Markdown fences or explanatory text.`;
    const scenePrompt = 'Generate the JSON scene from the expanded text.';
    try {
      await expect(client.structuredCompletion(settings, system, prompt, image)).resolves.toEqual({ ok: true });
      const body = requestBody(fetcher);
      const dataURL = `data:${image.mimeType};base64,${image.data}`;
      expect(JSON.stringify(body).split(image.data)).toHaveLength(2);
      expect(JSON.stringify(body)).not.toContain('"image":');
      expect(JSON.stringify(body)).not.toContain(config.apiKey);
      const systemMessage = { role: 'system', content: systemContent };
      let textOnlyBody: Record<string, unknown>;
      if (protocol === 'openai') {
        expect(body).toEqual({
          model: settings.model, stream: false, max_tokens: 23000,
          messages: [systemMessage, { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataURL, detail: 'high' } },
          ] }],
        });
        textOnlyBody = { ...body, messages: [systemMessage, { role: 'user', content: scenePrompt }] };
      } else if (protocol === 'openai-responses') {
        expect(body).toEqual({
          model: settings.model, stream: false, max_output_tokens: 23000,
          input: [systemMessage, { role: 'user', content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataURL, detail: 'high' },
          ] }],
        });
        textOnlyBody = { ...body, input: [systemMessage, { role: 'user', content: scenePrompt }] };
      } else if (protocol === 'anthropic') {
        expect(body).toEqual({
          model: settings.model, stream: false, max_tokens: 23000, system: systemContent,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
          ] }],
        });
        textOnlyBody = { ...body, messages: [{ role: 'user', content: [{ type: 'text', text: scenePrompt }] }] };
      } else {
        expect(body).toEqual({
          systemInstruction: { parts: [{ text: systemContent }] },
          contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] }],
          generationConfig: { maxOutputTokens: 23000 },
        });
        textOnlyBody = { ...body, contents: [{ role: 'user', parts: [{ text: scenePrompt }] }] };
      }
      await expect(client.structuredCompletion(settings, system, scenePrompt)).resolves.toEqual({ ok: true });
      expect(requestBody(fetcher, 1)).toEqual(textOnlyBody);
      await client.reply(settings, { message: 'hello' });
      await client.testConnection(settings);
      for (const [, init] of fetcher.mock.calls.slice(1)) {
        expect(init!.body).not.toContain(image.data);
        expect(init!.body).not.toMatch(/"(?:image|image_url|inlineData|mimeType|media_type)":/);
        expect(init!.body).not.toContain('input_image');
      }
      expect(fetcher.mock.calls.every(([url]) => url === fetcher.mock.calls[0]![0])).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      await client.onModuleDestroy();
    }
  });

  it.each(protocolPhases)('returns fixed, safe HTTP errors for $protocol $label without retries or text fallback', async ({ protocol, label, image }) => {
    const upstreamDetail = `UNTRUSTED_PROVIDER_ERROR https://secret-url.example/?key=${config.apiKey}`;
    for (const status of [400, 422, 401, 403, 429, 500]) {
      const response = new Response(upstreamDetail, { status });
      const cancel = vi.spyOn(response.body!, 'cancel');
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const client = new CompatibleChatService(fetcher);
      try {
        const error = await client.structuredCompletion({ ...config, protocol }, 'JSON only', 'world', image).catch((reason: unknown) => reason);
        const detail = (status === 400 || status === 422) && image
          ? '服务拒绝图片输入或请求参数，请确认建模模型和所选协议支持图片理解。'
          : status === 401 || status === 403 ? '服务拒绝认证，请检查设置中的 API Key 和账号权限。'
          : status === 429 ? '服务额度不足或请求过于频繁，请检查余额并稍后重试。'
          : '服务返回错误，请检查模型名称、账号权限和服务状态。';
        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as Error).message).toBe(`${label}${detail}未切换为 Mock。`);
        expect(JSON.stringify(error)).not.toContain(config.apiKey);
        expect(JSON.stringify(error)).not.toContain('secret-url');
        expect(JSON.stringify(error)).not.toContain('UNTRUSTED_PROVIDER_ERROR');
        expect(cancel).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledOnce();
      } finally {
        await client.onModuleDestroy();
      }
    }
  });

  it.each(protocolPhases)('sanitizes transport exceptions for $protocol $label', async ({ protocol, label, image }) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new BadGatewayException(`UNTRUSTED_NETWORK_ERROR https://secret-url.example/${config.apiKey}`));
    const client = new CompatibleChatService(fetcher);
    try {
      const error = await client.structuredCompletion({ ...config, protocol }, 'JSON only', 'world', image).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as Error).message).toBe(`真实${label}请求失败，请检查网络和设置。未切换为 Mock。`);
      expect(JSON.stringify(error)).not.toContain(config.apiKey);
      expect(JSON.stringify(error)).not.toContain('secret-url');
      expect(JSON.stringify(error)).not.toContain('UNTRUSTED_NETWORK_ERROR');
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      await client.onModuleDestroy();
    }
  });

  it.each(protocols)('accepts a matching full %s endpoint without appending twice', async (protocol) => {
    const suffix = { openai: 'chat/completions', 'openai-responses': 'responses', anthropic: 'messages', gemini: 'models/custom%20model:generateContent' }[protocol];
    const baseURL = `https://api.customvendor.com/custom/api/${suffix}`;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responseFor(protocol));
    const client = new CompatibleChatService(fetcher);
    for (const trailing of ['', '/']) {
      await client.testConnection({ ...config, protocol, model: protocol === 'gemini' ? 'models/custom model' : 'custom/model', baseURL: baseURL + trailing });
    }
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([baseURL, baseURL]);
    await client.onModuleDestroy();
  });

  it.each(['models/custom.model', 'other?key=bad#fragment', '..', 'custom:preview', 'custom model + 测试'])('encodes Gemini model %s as one segment, never a query or fragment', async (model) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responseFor('gemini'));
    const client = new CompatibleChatService(fetcher);
    await client.testConnection({ ...config, protocol: 'gemini', model });
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/v1/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    await client.onModuleDestroy();
  });

  it.each(['../other?key=bad#fragment', 'models/a/b', '%2F%3Fkey=bad', 'custom\\model', 'custom\nmodel'])('does not bypass final URL validation for Gemini model %s', async (model) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new CompatibleChatService(fetcher).testConnection({ ...config, protocol: 'gemini', model })).rejects.toThrow('请先');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', '/responses'], ['openai-responses', '/chat/completions'], ['anthropic', '/responses'],
    ['gemini', '/messages'], ['gemini', '/models/different-model:generateContent'],
  ] as const)('rejects a mismatching %s operation %s without sending credentials', async (protocol, path) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new CompatibleChatService(fetcher).testConnection({ ...config, protocol, baseURL: `https://api.customvendor.com/v1${path}` })).rejects.toThrow('请先');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(protocols)('only enables protocol-specific JSON hints when configured: %s', async (protocol) => {
    for (const jsonMode of [undefined, false, true]) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responseFor(protocol));
      const client = new CompatibleChatService(fetcher);
      await client.structuredCompletion({ ...config, protocol, jsonMode }, 'Build a world', 'a rocket');
      const body = requestBody(fetcher);
      if (protocol === 'openai') expect(body.response_format).toEqual(jsonMode ? { type: 'json_object' } : undefined);
      else if (protocol === 'openai-responses') expect(body.text).toEqual(jsonMode ? { format: { type: 'json_object' } } : undefined);
      else if (protocol === 'gemini') expect(body.generationConfig.responseMimeType).toBe(jsonMode ? 'application/json' : undefined);
      else {
        expect(body.system).toContain('Return only valid JSON');
        expect(body).not.toHaveProperty('output_config');
      }
      if (protocol !== 'openai') expect(body).not.toHaveProperty('response_format');
      await client.testConnection({ ...config, protocol, jsonMode });
      const testBody = requestBody(fetcher, 1);
      if (protocol === 'anthropic') expect(testBody.system).toBe(jsonMode ? 'Return only valid JSON, without Markdown fences or explanatory text.' : undefined);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await client.onModuleDestroy();
    }
  });

  it.each(['max_tokens', 'max_completion_tokens', 'omit'] as const)('uses only the selected OpenAI token parameter: %s', async (tokenParameter) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion('{}'));
    const client = new CompatibleChatService(fetcher);
    await client.structuredCompletion({ ...config, tokenParameter, maxOutputTokens: 23000 }, 'JSON only', 'rocket');
    const body = requestBody(fetcher);
    for (const name of ['max_tokens', 'max_completion_tokens']) expect(body[name]).toBe(name === tokenParameter ? 23000 : undefined);
    expect(body).not.toHaveProperty('max_output_tokens');
    await client.onModuleDestroy();
  });

  it.each(protocols)('applies configured/default modeling budget and short-request ceilings: %s', async (protocol) => {
    for (const maxOutputTokens of [undefined, 8, 256, 23000]) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responseFor(protocol));
      const client = new CompatibleChatService(fetcher);
      const settings = { ...config, protocol, maxOutputTokens, tokenParameter: 'max_completion_tokens' as const };
      await client.structuredCompletion(settings, 'JSON only', 'rocket');
      await client.reply(settings, { message: 'hello' });
      await client.testConnection(settings);
      const budgets = fetcher.mock.calls.map((_, index) => {
        const body = requestBody(fetcher, index);
        return protocol === 'openai' ? body.max_completion_tokens : protocol === 'openai-responses' ? body.max_output_tokens : protocol === 'anthropic' ? body.max_tokens : body.generationConfig.maxOutputTokens;
      });
      const budget = maxOutputTokens ?? 10000;
      expect(budgets).toEqual([budget, Math.min(512, budget), Math.min(16, budget)]);
      await client.onModuleDestroy();
    }
  });

  it.each(['openai-responses', 'anthropic', 'gemini'] as const)('does not omit the native %s output budget for an OpenAI-only token option', async (protocol) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responseFor(protocol));
    const client = new CompatibleChatService(fetcher);
    await client.testConnection({ ...config, protocol, tokenParameter: 'omit', maxOutputTokens: 7 });
    const body = requestBody(fetcher);
    expect(body.max_output_tokens ?? body.max_tokens ?? body.generationConfig?.maxOutputTokens).toBe(7);
    await client.onModuleDestroy();
  });

  it.each([
    { maxOutputTokens: 0 }, { maxOutputTokens: -1 }, { maxOutputTokens: 2.5 }, { maxOutputTokens: Infinity },
    { protocol: 'unknown' }, { tokenParameter: 'untrusted_field' }, { jsonMode: 'yes' }, { apiKey: 'key\r\ninjected: bad' }, { model: '' },
  ])('rejects malformed runtime options before transport: %j', async (invalid) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new CompatibleChatService(fetcher).testConnection({ ...config, ...invalid } as PrivateChatSettings)).rejects.toThrow('请先');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['openai-responses', { status: 'completed', output: [{ type: 'reasoning', summary: [{ text: 'hidden' }] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'first ' }, { type: 'output_text', text: 'second' }] }] }],
    ['anthropic', { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'first ' }, { type: 'redacted_thinking', data: 'hidden' }, { type: 'text', text: 'second' }] }],
    ['gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden' }, { text: 'first ' }, { text: 'second' }] } }] }],
  ] as const)('joins only visible text blocks for %s', async (protocol, payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
    const client = new CompatibleChatService(fetcher);
    await expect(client.reply({ ...config, protocol }, { message: 'hello' })).resolves.toMatchObject({ content: 'first second' });
    await client.onModuleDestroy();
  });

  it.each([
    ...['length', 'content_filter', 'tool_calls', 'function_call', null, 'unknown'].map((finish_reason) => ['openai', { choices: [{ finish_reason, message: { content: '{}' } }] }] as const),
    ['openai', { choices: [{ finish_reason: 'stop', message: { content: '{}', refusal: 'refused' } }] }],
    ['openai', { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } }] }],
    ...['incomplete', 'failed', 'cancelled', 'queued', 'in_progress', undefined].map((status) => ['openai-responses', { ...payloadFor('openai-responses'), status }] as const),
    ['openai-responses', { ...payloadFor('openai-responses'), incomplete_details: { reason: 'max_output_tokens' } }],
    ['openai-responses', { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: '{}' }] }] }],
    ['openai-responses', { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }, { type: 'output_text', text: '{}' }] }] }],
    ['openai-responses', { status: 'completed', output: [{ type: 'function_call' }] }],
    ...['max_tokens', 'model_context_window_exceeded', 'refusal', 'tool_use', 'pause_turn', null, 'unknown'].map((stop_reason) => ['anthropic', { ...payloadFor('anthropic'), stop_reason }] as const),
    ['anthropic', { stop_reason: 'end_turn', content: [{ type: 'tool_use' }, { type: 'text', text: '{}' }] }],
    ...['MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'OTHER', 'MALFORMED_FUNCTION_CALL', 'FINISH_REASON_UNSPECIFIED', undefined].map((finishReason) => ['gemini', { candidates: [{ finishReason, content: { parts: [{ text: '{}' }] } }] }] as const),
    ['gemini', { ...payloadFor('gemini'), promptFeedback: { blockReason: 'SAFETY' } }],
    ['gemini', { candidates: [{ finishReason: 'STOP', safetyRatings: [{ blocked: true }], content: { parts: [{ text: '{}' }] } }] }],
    ['gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}', functionCall: {} }] } }] }],
  ] as const)('rejects truncated, refused, blocked or unfinished %s output: %j', async (protocol, payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
    const client = new CompatibleChatService(fetcher);
    await expect(client.structuredCompletion({ ...config, protocol }, 'JSON only', 'world')).rejects.toThrow('未切换为 Mock');
    expect(fetcher).toHaveBeenCalledOnce();
    await client.onModuleDestroy();
  });

  it.each(protocolPhases)('enforces strict structured output and credential protection for $protocol $label', async ({ protocol, label, image }) => {
    for (const content of ['Prose before {"ok":true}', '{}\n{}', `{"key":"${config.apiKey}"}`, `{"key":"${config.apiKey.replace(/./g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)}"}`]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responseFor(protocol, content));
      const client = new CompatibleChatService(fetcher);
      try {
        const error = await client.structuredCompletion({ ...config, protocol }, 'JSON only', 'world', image).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(BadGatewayException);
        expect((error as Error).message).toBe(`${label}服务未返回合法 JSON，请手动重试。未切换为 Mock。`);
        expect(JSON.stringify(error)).not.toContain(config.apiKey);
        expect(fetcher).toHaveBeenCalledOnce();
      } finally {
        await client.onModuleDestroy();
      }
    }
  });

  it.each(protocols)('redacts echoed credentials from %s chat content and provider labels', async (protocol) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responseFor(protocol, `echo ${config.apiKey}`));
    const client = new CompatibleChatService(fetcher);
    await expect(client.reply({ ...config, protocol, model: config.apiKey }, { message: 'hello' })).resolves.toMatchObject({ content: 'echo [redacted]', provider: expect.not.stringContaining(config.apiKey) });
    await client.onModuleDestroy();
  });

  it.each(protocols)('rejects empty/malformed %s payloads without retries', async (protocol) => {
    for (const payload of [null, {}, [], { error: { message: config.apiKey } }, payloadFor(protocol, '')]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
      const client = new CompatibleChatService(fetcher);
      const error = await client.reply({ ...config, protocol }, { message: 'hello' }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect(JSON.stringify(error)).not.toContain(config.apiKey);
      expect(fetcher).toHaveBeenCalledOnce();
      await client.onModuleDestroy();
    }
  });

  it.each(protocols)('rejects redirected or mismatching %s responses and cancels their bodies', async (protocol) => {
    for (const properties of [{ redirected: true }, { url: 'https://other-vendor.com/operation' }]) {
      const response = responseFor(protocol);
      for (const [name, value] of Object.entries(properties)) Object.defineProperty(response, name, { value });
      const cancel = vi.spyOn(response.body!, 'cancel');
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const client = new CompatibleChatService(fetcher);
      await expect(client.testConnection({ ...config, protocol })).rejects.toThrow('真实对话请求失败');
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
      await client.onModuleDestroy();
    }
  });

  it('sanitizes even framework transport exceptions and a changing config snapshot', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new BadGatewayException(`https://secret-url.com ${config.apiKey}`));
    await expect(new CompatibleChatService(fetcher).testConnection(config)).rejects.toThrow('真实对话请求失败');
    let resolve!: (response: Response) => void;
    const mutable = { ...config };
    const pendingFetch = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const client = new CompatibleChatService(pendingFetch);
    const task = client.reply(mutable, { message: 'hello' });
    mutable.apiKey = 'new-key';
    mutable.model = 'new-model';
    resolve(completion(config.apiKey));
    await expect(task).resolves.toMatchObject({ content: '[redacted]', provider: 'openai-compatible:stub-model' });
    await client.onModuleDestroy();
  });

  it.each([false, true])('bounds modeling response bytes with advertised length=%s and cancels oversized streams', async (advertised) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { if (!advertised) controller.enqueue(new Uint8Array(MODELING_MAX_RESPONSE_BYTES + 1)); }, cancel,
    }), { headers: advertised ? { 'content-length': String(MODELING_MAX_RESPONSE_BYTES + 1) } : {} });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = new CompatibleChatService(fetcher);
    await expect(client.structuredCompletion(config, 'JSON only', 'world')).rejects.toThrow('真实建模请求失败');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    await client.onModuleDestroy();
  });

  it.each(protocolPhases)('keeps $protocol $label free of total deadlines for both headers and body', async ({ protocol, image }) => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((done) => { resolve = done; }));
    const client = new CompatibleChatService(fetcher);
    const task = client.structuredCompletion({ ...config, protocol }, 'JSON only', 'world', image);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    resolve(new Response(new ReadableStream({ start(controller) { writer = controller; } })));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    writer.enqueue(new TextEncoder().encode(JSON.stringify(payloadFor(protocol))));
    writer.close();
    await expect(task).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    await client.onModuleDestroy();
  });

  it.each(protocols)('retains 30s reply/test deadlines and shutdown cancellation for %s', async (protocol) => {
    vi.useFakeTimers();
    for (const operation of ['reply', 'test', 'shutdown'] as const) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
      const client = new CompatibleChatService(fetcher);
      const task = operation === 'test' ? client.testConnection({ ...config, protocol }) : client.reply({ ...config, protocol }, { message: 'hello' });
      const assertion = expect(task).rejects.toThrow(operation === 'shutdown' ? '服务正在关闭' : '对话服务响应超时');
      if (operation === 'shutdown') await client.onModuleDestroy();
      else await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
      await assertion;
      expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      await client.onModuleDestroy();
    }
  });

  it('also applies the deadline while reading the response body', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const request = new CompatibleChatService(fetcher).reply(config, { message: 'hello' });
    const assertion = expect(request).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(CHAT_TIMEOUT_MS);
    await assertion;
  });
});
