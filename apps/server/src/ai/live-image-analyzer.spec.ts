import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MODELING_PROMPT_LENGTH, type ImageArtifact } from '@ai-three-studio/shared';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import { expandFromConceptImage, VISION_EXPANSION_ERRORS, parseVisualReport } from './live-image-analyzer';
import {
  renderThreeJsExpansionTemplate,
  THREEJS_EXPANSION_SYSTEM,
  THREEJS_EXPANSION_TEMPLATE,
} from './threejs-expansion-template';
import { completionResponse, planRequest, previewArtifact, visionDraft, visionReport } from './world-plan.fixture';

const config = { enabled: false, modelingEnabled: true, baseURL: 'https://api.openai.com/v1', model: 'stub-vision', apiKey: 'vision-secret-test-only', jsonMode: true };

describe('original prompt visual expansion (offline responses)', () => {
  const clients: CompatibleChatService[] = [];
  const create = (value: unknown = visionReport()) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse(value));
    const client = new CompatibleChatService(fetcher);
    clients.push(client);
    return { client, fetcher };
  };
  afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.onModuleDestroy())); });

  it('sends the rendered expansion template and selected pixels without JSON instructions', async () => {
    const { client, fetcher } = create();
    const request = planRequest();
    const analysis = await expandFromConceptImage(client, config, request, previewArtifact());
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    const template = renderThreeJsExpansionTemplate({
      userPrompt: request.prompt,
      sceneType: '请根据用户描述和预览图自动判断；优先选择构图紧凑、便于观察的三维场景。',
      additionalRequirements: [
        `用户选定的预览图风格：${request.concept.styleLabel}（${request.concept.styleId}）。`,
        '只输出最终的中文建模提示词，不要输出 A–G 报告、JSON、代码块、模板复述或额外解释。',
      ].join('\n'),
    });
    expect(body.messages[0].content).toBe(THREEJS_EXPANSION_SYSTEM);
    expect(body).not.toHaveProperty('response_format');
    expect(config.jsonMode).toBe(true);
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: template },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${previewArtifact().data}`, detail: 'high' } },
    ]);
    expect(template).toContain(request.prompt);
    expect(template).toContain(request.concept.styleLabel);
    expect(template).not.toContain('{{');
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_IMAGE|MOCK MEADOW|MOCK IMAGE PROMPT|vision-secret-test-only/);
    expect(analysis).toMatchObject({ ...visionDraft(), mock: false, provider: 'openai:vision:stub-vision' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('accepts legacy unabridged reports while briefing only supported modeling capabilities', () => {
    const report = visionReport().replace(visionDraft().modelingPrompt, '长篇建模说明。'.repeat(5000));
    expect(parseVisualReport(report).finalPrompt).toBe('长篇建模说明。'.repeat(5000));
    expect(parseVisualReport(visionReport().replace(/\*\*/g, '').replace(/^([A-G])\./gm, '## $1.'))).toEqual(visionDraft().report);
    expect(THREEJS_EXPANSION_TEMPLATE).toContain('现在，请根据用户输入和选定的预览图，完成场景提示词扩写。');
    expect(THREEJS_EXPANSION_TEMPLATE).toContain('{{USER_PROMPT}}');
    expect(THREEJS_EXPANSION_TEMPLATE).toContain('{{SELECTED_IMAGE}}');
    expect(THREEJS_EXPANSION_TEMPLATE).toContain('尺寸与空间');
    expect(THREEJS_EXPANSION_TEMPLATE).toContain('type:"lathe"');
    expect(THREEJS_EXPANSION_TEMPLATE).toContain('连接面');
    expect(renderThreeJsExpansionTemplate({ userPrompt: 'Literal {{SCENE_TYPE}}', sceneType: 'house', additionalRequirements: '' })).toContain('Literal {{SCENE_TYPE}}');
  });

  it('uses the direct Chinese modeling prompt returned from the template, with optional fences', async () => {
    const prompt = [
      '场景主题与整体视觉目标：一座水彩童话风格的林间小屋，黄昏暖光，微缩景观置于圆形木底座。',
      '',
      '场景构图和空间布局：小屋位于中央偏后，前景是石板小径和低矮花丛，左侧有老树与木栅栏。',
      '',
      '- 屋顶使用 #8b5a2b 暖木色，墙面使用 #f3d19c 奶油色。',
      '- 窗内可见桌椅与暖黄灯光，避免透明空壳。',
      '',
      '基础动态效果：枝叶缓慢摇摆，窗光轻微呼吸。初始不生成人物，并保留天气、季节和角色视角接口。',
    ].join('\n');
    const { client, fetcher } = create(`\`\`\`markdown\n${prompt}\n\`\`\``);
    const analysis = await expandFromConceptImage(client, config, planRequest(), previewArtifact());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(analysis.report).toBeUndefined();
    expect(analysis.modelingPrompt).toBe(prompt);
    expect(analysis.sceneSummary).toBe('场景主题与整体视觉目标：一座水彩童话风格的林间小屋，黄昏暖光，微缩景观置于圆形木底座。');
    expect(analysis.detectedElements).toHaveLength(2);
    expect(analysis.palette).toEqual(['#8b5a2b', '#f3d19c']);
    expect(analysis).toMatchObject({ mock: false, provider: 'openai:vision:stub-vision' });
    expect(analysis.disclaimer).toContain('扩写模板');
  });

  it('rejects an overlong direct prompt without retrying', async () => {
    const { client, fetcher } = create('长'.repeat(MAX_MODELING_PROMPT_LENGTH + 1));
    const error = await expandFromConceptImage(client, config, planRequest(), previewArtifact()).catch((reason: unknown) => reason);
    expect((error as Error).message).toContain('超过提示词长度上限');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('accepts localized titles, parenthetical translations and flexible decoration', () => {
    const localized = visionReport()
      .replace('A. Visual Analysis', 'A. 视觉分析（Visual Analysis）')
      .replace('B. Scene Object Inventory', 'B. 场景物体清单')
      .replace('C. Spatial Layout', 'C. 空间布局')
      .replace('D. Camera and Lighting', 'D. 相机与光照')
      .replace('E. Asset Strategy', 'E. 资产策略')
      .replace('F. Final Three.js Generation Prompt', 'F. 最终的 Three.js 生成提示词')
      .replace('G. Uncertainty and Validation', 'G. 不确定性与验证');
    expect(parseVisualReport(localized)).toEqual(visionDraft().report);
  });

  it('accepts headings with inline section content and mixed Markdown styles', () => {
    const inline = [
      '**A. 视觉分析（Visual Analysis）：** alpha',
      '### B. **场景物体清单：** bravo',
      'C) **空间布局**：charlie',
      '**D. 相机与光照：** delta',
      'E、资产策略 - echo',
      '**F. 最终的 Three.js 生成提示词：** foxtrot',
      '### G. **不确定性与验证：** golf',
    ].join('\n\n');
    expect(parseVisualReport(inline)).toEqual({
      visualAnalysis: 'alpha',
      objectInventory: 'bravo',
      spatialLayout: 'charlie',
      cameraAndLighting: 'delta',
      assetStrategy: 'echo',
      finalPrompt: 'foxtrot',
      uncertaintyAndValidation: 'golf',
    });
  });

  it('accepts bulleted, emoji-decorated and Chinese-numeral headings', () => {
    const decorated = [
      '- 🌲 **A. 视觉分析**', 'alpha',
      '> 📦 **B. 场景物体清单**', 'bravo',
      '**三、空间布局**', 'charlie',
      '四、**相机与光照**', 'delta',
      '* **五、资产策略**', 'echo',
      '六、最终 Three.js 生成提示词', 'foxtrot',
      '**七、不确定性与验证**', 'golf',
    ].join('\n\n');
    expect(parseVisualReport(decorated)).toEqual({
      visualAnalysis: 'alpha',
      objectInventory: 'bravo',
      spatialLayout: 'charlie',
      cameraAndLighting: 'delta',
      assetStrategy: 'echo',
      finalPrompt: 'foxtrot',
      uncertaintyAndValidation: 'golf',
    });
  });

  it('accepts numeric section markers in order', () => {
    const numbered = [
      ['1. 视觉分析', 'alpha'],
      ['2. 场景物体清单', 'bravo'],
      ['3. 空间布局', 'charlie'],
      ['4. 相机与光照', 'delta'],
      ['5. 资产策略', 'echo'],
      ['6. 最终 Three.js 生成提示词', 'foxtrot'],
      ['7. 不确定性与验证', 'golf'],
    ].map(([title, content]) => `## ${title}\n${content}`).join('\n\n');
    expect(parseVisualReport(numbered)).toEqual({
      visualAnalysis: 'alpha',
      objectInventory: 'bravo',
      spatialLayout: 'charlie',
      cameraAndLighting: 'delta',
      assetStrategy: 'echo',
      finalPrompt: 'foxtrot',
      uncertaintyAndValidation: 'golf',
    });
  });

  it.each(['missing', 'mock', 'svg', 'utf8', 'invalid', 'mismatch'] as const)('rejects %s preview before any request', async (failure) => {
    const { client, fetcher } = create();
    const request = planRequest();
    let artifact: ImageArtifact | undefined = previewArtifact();
    if (failure === 'missing') artifact = undefined;
    if (failure === 'mock') request.concept.mock = true;
    if (failure === 'svg') artifact!.mimeType = 'image/svg+xml';
    if (failure === 'utf8') artifact!.encoding = 'utf8';
    if (failure === 'invalid') artifact!.data = Buffer.from('<svg>not a real image</svg>').toString('base64');
    if (failure === 'mismatch') artifact!.mimeType = 'image/jpeg';
    await expect(expandFromConceptImage(client, config, request, artifact)).rejects.toThrow(VISION_EXPANSION_ERRORS.image);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    '', 'not a report', JSON.stringify(visionDraft()),
    visionReport().replace('**G. Uncertainty and Validation**', '**F. Uncertainty and Validation**'),
    visionReport().replace(visionDraft().report.assetStrategy, ''),
    visionReport().slice(0, visionReport().indexOf('**G.')),
    `${visionReport()}\n**A. Visual Analysis**\nDuplicate`,
  ])('rejects incomplete or malformed reports without retry', async (value) => {
    const { client, fetcher } = create(value);
    await expect(expandFromConceptImage(client, config, planRequest(), previewArtifact())).rejects.toThrow('看图扩写');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([config.apiKey, [...config.apiKey].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')])('rejects credential echoes', async (secret) => {
    const { client } = create(visionReport() + secret);
    const error = await expandFromConceptImage(client, config, planRequest(), previewArtifact()).catch((reason: unknown) => reason);
    expect((error as Error).message).toContain('校验失败');
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('preserves unsupported-image errors without claiming success or using Mock', async () => {
    const { client, fetcher } = create();
    fetcher.mockResolvedValue(new Response(config.apiKey, { status: 400 }));
    await expect(expandFromConceptImage(client, config, planRequest(), previewArtifact())).rejects.toThrow('请确认建模模型和所选协议支持图片理解');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
