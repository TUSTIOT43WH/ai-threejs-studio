import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatibleChatService, MODELING_MAX_RESPONSE_BYTES } from '../settings/compatible-chat.service';
import { planLiveWorld } from './live-world-planner';
import { validateWorldPlan } from './world-plan-validation';
import { completionResponse, planRequest, sceneDraft } from './world-plan.fixture';

const config = { enabled: false, modelingEnabled: true, baseURL: 'https://api.openai.com/v1', model: 'stub-model', apiKey: 'stub-not-a-real-key-123' };

function repairableDraft(): ReturnType<typeof sceneDraft> {
  const draft = sceneDraft();
  draft.title = '林中小屋';
  draft.summary = '水彩森林中的木屋、树木、岩石和小径。';
  draft.environment = { ...draft.environment, season: 'summer', fogDensity: 0.01 };
  draft.objects = [
    { name: 'Ground', kind: 'ground', transform: { position: [0, 0.4, 0], rotation: [0.15, 0, 0], scale: [16, 0.2, 16] }, material: { color: '#7a8f5a' } },
    { name: 'Pond ground', kind: 'ground', transform: { position: [4, 0, 4], rotation: [0, 0, 0], scale: [8, 1, 8] }, material: { color: '#4a7f9a' } },
    { name: 'Cabin body', kind: 'cabin', params: { shape: 'box', widthSegments: 100000 }, transform: { position: [0, 1.5, 0], rotation: [0, 0, 0], scale: [6, 3, 4] }, material: { color: '#8b6b4a', map: 'https://evil.test', opacity: 2 } },
    { name: 'Roof', kind: 'primitive', params: { shape: 'cone', extra: 'strip' }, transform: { position: [0, 3.8, 0], rotation: [0, 45, 0], scale: [8, 3, 6] }, material: { color: '#7b3f2a' } },
    { name: 'Tree far', kind: 'tree', params: { shape: 'cone' }, transform: { position: [12, 3, 0], rotation: [0, 0, 0], scale: [3, 6, 3] }, material: { color: '#2f6b3a' } },
    { name: 'Rock sunken', kind: 'rock', params: { shape: 'icosahedron' }, transform: { position: [3, 0.1, 3], rotation: [0, 0, 0], scale: [2, 2, 2] } },
    { name: 'Path', kind: 'path', params: { shape: 'plane' }, transform: { position: [0, 0.05, 6], rotation: [-90, 0, 0], scale: [2, 8, 0] }, material: { color: '#aa8855' } },
  ];
  Object.assign(draft.objects[0]!, { extra: 'strip-me' });
  draft.spawnPoint = { position: [0, 0, 2], yawDeg: 180 };
  return draft;
}

describe('live world planning (injected fetch only)', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the original subject and validated visual brief, generating honest procedural provenance and UUIDs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse());
    const request = planRequest();
    const world = await planLiveWorld(new CompatibleChatService(fetcher), config, request);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${config.apiKey}` });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: config.model, max_tokens: 10000, stream: false });
    expect(body).not.toHaveProperty('response_format');
    expect(body.messages).toHaveLength(2);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      prompt: request.prompt, conceptStyleId: 'low-poly', modelingPrompt: request.analysis.modelingPrompt,
      visualAnalysis: {
        sceneSummary: request.analysis.sceneSummary, composition: request.analysis.composition,
        styleNotes: request.analysis.styleNotes, detectedElements: request.analysis.detectedElements,
        palette: request.analysis.palette, assumptions: request.analysis.assumptions,
      },
    });
    for (const forbidden of ['PRIVATE_IMAGE', 'MOCK MEADOW', 'MOCK IMAGE PROMPT', config.apiKey]) expect(JSON.stringify(body)).not.toContain(forbidden);
    expect(world.title).toBe('火箭');
    expect(world.source).toMatchObject({ prompt: request.prompt, conceptId: request.concept.id, provider: { mode: 'live', planner: 'openai-compatible:stub-model' } });
    expect(world.source.provider.vision).toBe(request.analysis.provider);
    expect(world.source.disclaimer).toContain('读取所选预览图');
    expect(world.source.disclaimer).toContain('不是精确三维重建');
    expect(world.source.disclaimer).toContain('GLB');
    expect(world.meta).toMatchObject({ mock: false, objectCount: 4 });
    expect(world.objects.every((object) => object.asset.source === 'procedural' && !object.asset.mock && object.asset.format === 'primitive-group' && !object.asset.url)).toBe(true);
    expect(world.objects.every((object) => ['ground', 'primitive'].includes(object.kind))).toBe(true);
    expect(world.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(world.objects.map((object) => object.id)).size).toBe(4);
  });

  it.each(['anthropic', 'gemini', 'openai-responses'] as const)('records %s provenance instead of labeling every provider OpenAI', (protocol) => {
    const world = validateWorldPlan(sceneDraft(), planRequest(), 'custom-model', protocol);
    expect(world.source.provider.name).toBe(`${protocol}-vision-modeling`);
    expect(world.source.provider.planner).toBe(`${protocol}:custom-model`);
    expect(world.objects.every((object) => object.asset.provider === `${protocol}:custom-model`)).toBe(true);
    expect(JSON.stringify(world)).not.toContain(config.apiKey);
  });

  it.each(['mock', 'missing'] as const)('refuses %s visual expansion before requesting a scene', async (failure) => {
    const fetcher = vi.fn<typeof fetch>();
    const request = planRequest();
    if (failure === 'mock') request.analysis.mock = true;
    else delete request.analysis.modelingPrompt;
    await expect(planLiveWorld(new CompatibleChatService(fetcher), config, request)).rejects.toThrow('缺少真实预览图的建模提示词');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts exactly one JSON fence but not prose, multiple fences, malformed or secret output', async () => {
    const client = (content: string) => new CompatibleChatService(vi.fn<typeof fetch>().mockResolvedValue(completionResponse(content)));
    await expect(planLiveWorld(client(`\`\`\`json\n${JSON.stringify(sceneDraft())}\n\`\`\``), config, planRequest())).resolves.toMatchObject({ title: '火箭' });
    for (const content of ['not JSON', '{} trailing', 'prefix ```json\n{}\n```', '```json\n{}\n```\n```json\n{}\n```', `{"title":"${config.apiKey}"}`]) {
      const error = await planLiveWorld(client(content), config, planRequest()).catch((reason: unknown) => reason);
      expect((error as Error).message).toContain('合法 JSON');
      expect(JSON.stringify(error)).not.toContain(config.apiKey);
      expect(JSON.stringify(error)).not.toContain(content);
    }
  });

  it.each([401, 403, 429, 400, 500, 302])('fails safely for HTTP %s with no fallback or retry', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`SECRET RAW ${config.apiKey}`, { status }));
    const error = await planLiveWorld(new CompatibleChatService(fetcher), config, planRequest()).catch((reason: unknown) => reason);
    expect((error as Error).message).toContain('未切换为 Mock');
    expect(JSON.stringify(error)).not.toMatch(/SECRET RAW|stub-not-a-real-key/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['length', 'empty', 'network', 'invalid-envelope', 'too-large', 'declared-too-large'])('handles %s without exposing provider output or retrying', async (failure) => {
    const fetcher = vi.fn<typeof fetch>();
    if (failure === 'network') fetcher.mockRejectedValue(new Error(config.apiKey));
    else if (failure === 'length') fetcher.mockResolvedValue(completionResponse(sceneDraft(), 'length'));
    else if (failure === 'empty') fetcher.mockResolvedValue(completionResponse(''));
    else if (failure === 'invalid-envelope') fetcher.mockResolvedValue(new Response(`SECRET RAW ${config.apiKey}`));
    else if (failure === 'too-large') fetcher.mockResolvedValue(new Response('x'.repeat(MODELING_MAX_RESPONSE_BYTES + 1)));
    else fetcher.mockResolvedValue(new Response('{}', { headers: { 'content-length': `${MODELING_MAX_RESPONSE_BYTES + 1}` } }));
    const error = await planLiveWorld(new CompatibleChatService(fetcher), config, planRequest()).catch((reason: unknown) => reason);
    expect((error as Error).message).toContain(failure === 'length' ? '长度上限' : '未切换为 Mock');
    expect(JSON.stringify(error)).not.toMatch(/SECRET RAW|stub-not-a-real-key/);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['headers', 'body'])('waits beyond 120s, 30m and two hours for %s, then succeeds without a deadline', async (waitingFor) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const bytes = new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: JSON.stringify(sceneDraft()) } }] }));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller; controller.enqueue(bytes.slice(0, 1)); },
      cancel,
    }));
    let sendHeaders!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => waitingFor === 'body'
      ? Promise.resolve(response)
      : new Promise((resolve) => { sendHeaders = resolve; }));
    const client = new CompatibleChatService(fetcher);
    const onStage = vi.fn();
    const settled = vi.fn();
    const task = planLiveWorld(client, config, planRequest(), onStage);
    void task.then(settled, settled);
    let elapsed = 0;
    try {
      for (const milestone of [120_001, 300_001, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000 + 1]) {
        await vi.advanceTimersByTimeAsync(milestone - elapsed);
        elapsed = milestone;
        expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(false);
        expect(settled).not.toHaveBeenCalled();
        expect(onStage).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
      if (waitingFor === 'headers') sendHeaders(response);
      bodyController.enqueue(bytes.slice(1));
      bodyController.close();
      await expect(task).resolves.toMatchObject({ title: '火箭', meta: { mock: false } });
      expect(onStage).toHaveBeenCalledExactlyOnceWith('validating');
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      await client.onModuleDestroy();
    }
  });

  it('announces validating only after completion and before accessing the draft for validation', async () => {
    const draft = sceneDraft();
    const title = draft.title;
    const onStage = vi.fn();
    Object.defineProperty(draft, 'title', { get() {
      expect(onStage).toHaveBeenCalledExactlyOnceWith('validating');
      return title;
    } });
    const client = new CompatibleChatService(vi.fn<typeof fetch>());
    let finish!: (value: unknown) => void;
    vi.spyOn(client, 'structuredCompletion').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const task = planLiveWorld(client, config, planRequest(), onStage);
    expect(onStage).not.toHaveBeenCalled();
    finish(draft);
    await expect(task).resolves.toMatchObject({ title });
    expect(onStage).toHaveBeenCalledExactlyOnceWith('validating');
  });

  it('announces validation failures but never announces validating after HTTP or JSON failures', async () => {
    for (const content of ['not JSON', '{}']) {
      const onStage = vi.fn();
      const client = new CompatibleChatService(vi.fn<typeof fetch>().mockResolvedValue(completionResponse(content)));
      await expect(planLiveWorld(client, config, planRequest(), onStage)).rejects.toThrow('未切换为 Mock');
      if (content === '{}') expect(onStage).toHaveBeenCalledExactlyOnceWith('validating');
      else expect(onStage).not.toHaveBeenCalled();
      await client.onModuleDestroy();
    }
    const onStage = vi.fn();
    const client = new CompatibleChatService(vi.fn<typeof fetch>().mockRejectedValue(new Error('network')));
    await expect(planLiveWorld(client, config, planRequest(), onStage)).rejects.toThrow('未切换为 Mock');
    expect(onStage).not.toHaveBeenCalled();
    await client.onModuleDestroy();
  });

  it('rejects escaped credentials and enforces the streaming byte limit without trusting headers', async () => {
    const escaped = [...config.apiKey].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    const content = `{"title":"${escaped}"}`;
    const secretClient = new CompatibleChatService(vi.fn<typeof fetch>().mockResolvedValue(completionResponse(content)));
    const secretError = await planLiveWorld(secretClient, config, planRequest()).catch((reason: unknown) => reason);
    expect((secretError as Error).message).toContain('合法 JSON');
    expect(JSON.stringify(secretError)).not.toContain(config.apiKey);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MODELING_MAX_RESPONSE_BYTES / 2));
        controller.enqueue(new Uint8Array(MODELING_MAX_RESPONSE_BYTES / 2 + 1));
      },
      cancel,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { 'content-length': '1' } }));
    await expect(planLiveWorld(new CompatibleChatService(fetcher), config, planRequest())).rejects.toThrow('未切换为 Mock');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refuses unapproved URLs or missing keys before HTTP', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const override of [{ baseURL: 'https://127.0.0.1/v1' }, { baseURL: 'https://api.openai.com.evil.test/v1' }, { apiKey: '' }]) {
      await expect(planLiveWorld(new CompatibleChatService(fetcher), { ...config, ...override }, planRequest())).rejects.toThrow('请先');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('repairs safely inferable structural mistakes without a Mock fallback or value leakage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse(repairableDraft()));
    const onStage = vi.fn();
    const world = await planLiveWorld(new CompatibleChatService(fetcher), config, planRequest(), onStage);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onStage).toHaveBeenCalledExactlyOnceWith('validating');
    expect(world).toMatchObject({ title: '林中小屋', meta: { mock: false, objectCount: 6 } });
    expect(world.objects.map((object) => object.kind).sort()).toEqual([
      'ground', 'primitive', 'primitive', 'primitive', 'primitive', 'primitive',
    ]);
    expect(world.objects.some((object) => object.name === 'Pond ground')).toBe(false);
    expect(world.objects.every((object) => object.asset.source === 'procedural' && !object.asset.mock)).toBe(true);
    expect(world.environment).toMatchObject({ season: 'summer', timeOfDay: 'day', fogDensity: 0.01 });
    expect(world.objects.find((object) => object.name === 'Cabin body')?.material).toEqual({ color: '#8b6b4a', opacity: 1 });
    expect(world.objects.find((object) => object.name === 'Tree far')?.params).toEqual({ shape: 'cone' });
    expect(world.objects.find((object) => object.name === 'Path')?.transform.rotation[0]).toBeCloseTo(-Math.PI / 2);
    expect(world.objects.find((object) => object.name === 'Path')?.transform.scale[2]).toBe(0.01);
    expect(world.objects.find((object) => object.name === 'Roof')?.transform.rotation[1]).toBeCloseTo(Math.PI / 4);
    expect(world.spawnPoint.position[1]).toBe(0);
    expect(world.spawnPoint.position).not.toEqual([0, 0, 2]);
    expect(JSON.stringify(world)).not.toMatch(/evil\.test|widthSegments|strip-me/);
  });

  it('trims an over-budget scene to the 120-object ceiling while keeping the ground', async () => {
    const draft = sceneDraft();
    const body = draft.objects[1]!;
    draft.objects = [
      draft.objects[0]!,
      ...Array.from({ length: 124 }, (_, index) => ({ ...body, name: `Part ${index + 1}` })),
    ];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse(draft));
    const world = await planLiveWorld(new CompatibleChatService(fetcher), config, planRequest());
    expect(world.objects).toHaveLength(120);
    expect(world.objects.filter((object) => object.kind === 'ground')).toHaveLength(1);
    expect(world.meta.objectCount).toBe(120);
  });

  it('returns rule-specific safe failures without exposing model values', async () => {
    const unsupported = sceneDraft();
    unsupported.objects[1]!.kind = 'tree';
    delete unsupported.objects[1]!.params;
    const fieldsError = await planLiveWorld(
      new CompatibleChatService(vi.fn<typeof fetch>().mockResolvedValue(completionResponse(unsupported))),
      config, planRequest(),
    ).catch((reason: unknown) => reason);
    expect((fieldsError as Error).message).toContain('不支持的对象类型');
    expect((fieldsError as Error).message).toContain('未切换为 Mock');
    expect(JSON.stringify(fieldsError)).not.toContain(config.apiKey);

    const blocked = sceneDraft();
    blocked.objects[0]!.transform.scale = [10, 1, 10];
    blocked.objects = [
      blocked.objects[0]!,
      { name: 'Block', kind: 'primitive', params: { shape: 'box' }, transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [10, 2, 10] }, material: { color: '#333333' } },
    ];
    blocked.spawnPoint = { position: [0, 0, 0], yawDeg: 180 };
    const spawnError = await planLiveWorld(
      new CompatibleChatService(vi.fn<typeof fetch>().mockResolvedValue(completionResponse(blocked))),
      config, planRequest(),
    ).catch((reason: unknown) => reason);
    expect((spawnError as Error).message).toContain('出生点被物体占用');
    expect(JSON.stringify(spawnError)).not.toContain(config.apiKey);
  });
});

describe('strict scene draft validation', () => {
  it.each(['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'icosahedron'])('accepts the supported unit %s', (shape) => {
    const draft = sceneDraft();
    draft.objects[1]!.params = { shape };
    expect(validateWorldPlan(draft, planRequest(), 'model').objects[1]!.params).toEqual({ shape });
  });

  it('accepts low walkable surfaces under the spawn but rejects taller obstacles there', () => {
    const low = sceneDraft();
    low.objects.push({ name: 'Path', kind: 'primitive', params: { shape: 'plane' }, transform: { position: [0, 0.01, 10], rotation: [-Math.PI / 2, 0, 0], scale: [2, 4, 1] }, material: { color: '#aa8855' } });
    expect(validateWorldPlan(low, planRequest(), 'model').spawnPoint.position).toEqual([0, 0, 10]);
    const tall = sceneDraft();
    tall.objects.push({ name: 'Bollard', kind: 'primitive', params: { shape: 'box' }, transform: { position: [0, 0.5, 10], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { color: '#555555' } });
    expect(() => validateWorldPlan(tall, planRequest(), 'model')).toThrow('Invalid structured scene');
  });

  const invalid: Array<[string, (draft: ReturnType<typeof sceneDraft>) => void]> = [
    ['empty', (d) => { d.objects = []; }],
    ['too many', (d) => { d.objects = Array.from({ length: 121 }, () => d.objects[0]!); }],
    ['no ground', (d) => { d.objects.shift(); }],
    ['ground only', (d) => { d.objects = [d.objects[0]!]; }],
    ['two grounds', (d) => { d.objects.push(d.objects[0]!); }],
    ['small ground', (d) => { d.objects[0]!.transform.scale[0] = 2; }],
    ['tilted ground', (d) => { d.objects[0]!.transform.rotation[0] = 1; }],
    ['unknown kind', (d) => { d.objects[1]!.kind = 'cabin'; }],
    ['shape missing', (d) => { delete d.objects[1]!.params; }],
    ['unknown shape', (d) => { d.objects[1]!.params = { shape: 'eval' }; }],
    ['geometry code', (d) => { d.objects[1]!.params = { shape: 'box', code: 'eval(1)' }; }],
    ['subdivisions', (d) => { d.objects[1]!.params = { shape: 'sphere', widthSegments: 100000 }; }],
    ['ground params', (d) => { d.objects[0]!.params = { url: 'https://evil.test' }; }],
    ['asset URL', (d) => { Object.assign(d.objects[1]!, { asset: { url: 'https://evil.test' } }); }],
    ['forged source', (d) => { Object.assign(d, { source: { mode: 'live' } }); }],
    ['forged id', (d) => { Object.assign(d.objects[1]!, { id: 'fake-id' }); }],
    ['large position', (d) => { d.objects[1]!.transform.position[0] = 101; }],
    ['infinite position', (d) => { d.objects[1]!.transform.position[0] = Infinity; }],
    ['nan', (d) => { d.objects[1]!.transform.rotation[0] = NaN; }],
    ['small scale', (d) => { d.objects[1]!.transform.scale[0] = 0.001; }],
    ['large scale', (d) => { d.objects[1]!.transform.scale[0] = 101; }],
    ['negative scale', (d) => { d.objects[1]!.transform.scale[0] = -1; }],
    ['nonhex', (d) => { d.objects[1]!.material = { color: 'red' }; }],
    ['material out of range', (d) => { d.objects[1]!.material = { opacity: 2 }; }],
    ['material URL', (d) => { d.objects[1]!.material = { map: 'https://evil.test' }; }],
    ['infinite material', (d) => { d.objects[1]!.material = { roughness: Infinity }; }],
    ['infinite environment', (d) => { d.environment.fogDensity = Infinity; }],
    ['outside ground', (d) => { d.objects[1]!.transform.position[0] = 15; }],
    ['below ground', (d) => { d.objects[1]!.transform.position[1] = -10; }],
    ['spawn outside', (d) => { d.spawnPoint.position[0] = 15; }],
    ['spawn airborne', (d) => { d.spawnPoint.position[1] = 2; }],
    ['spawn collision', (d) => { d.spawnPoint.position = [0, 0, 0]; }],
    ['rotated spawn collision', (d) => {
      d.objects[1]!.transform = { position: [0, 0.5, 0], rotation: [0, Math.PI / 2, 0], scale: [8, 1, 1] };
      d.spawnPoint.position = [0, 0, 3];
    }],
  ];
  it.each(invalid)('rejects %s with no controlled values in the error', (_name, mutate) => {
    const draft = sceneDraft(); mutate(draft);
    expect(() => validateWorldPlan(draft, planRequest(), 'model')).toThrow('Invalid structured scene');
  });

  it('returns only a safe validation failure via the live planner', async () => {
    const draft = sceneDraft(); draft.objects[1]!.params = { shape: config.apiKey };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse({ ...draft, title: 'PRIVATE RAW RESPONSE' }));
    const error = await planLiveWorld(new CompatibleChatService(fetcher), config, planRequest()).catch((reason: unknown) => reason);
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE RAW RESPONSE|stub-not-a-real-key/);
    expect(fetcher).toHaveBeenCalledOnce();
    const bad = sceneDraft(); bad.objects[1]!.params = { shape: 'invalid' };
    await expect(planLiveWorld(new CompatibleChatService(vi.fn<typeof fetch>().mockResolvedValue(completionResponse(bad))), config, planRequest())).rejects.toThrow('校验失败');
  });
});
