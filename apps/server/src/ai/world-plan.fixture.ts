import type { ImageArtifact, WorldEnvironment, WorldPlanRequest, WorldTransform } from '@ai-three-studio/shared';

/** Offline test data only, never loaded by application modules. */
export function sceneDraft() {
  const objects: Array<{
    name: string; kind: string; transform: WorldTransform;
    params?: Record<string, unknown>; material?: Record<string, unknown>; tags?: string[];
  }> = [
    { name: 'Ground', kind: 'ground', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [30, 1, 30] }, material: { color: '#dddddd' } },
    { name: 'Rocket body', kind: 'primitive', params: { shape: 'cylinder' }, transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [2, 4, 2] }, material: { color: '#ffffff', metalness: 0.6 } },
    { name: 'Rocket nose', kind: 'primitive', params: { shape: 'cone' }, transform: { position: [0, 4.75, 0], rotation: [0, 0, 0], scale: [2, 1.5, 2] }, material: { color: '#ee3322' } },
    { name: 'Engine', kind: 'primitive', params: { shape: 'cylinder' }, transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1.5, 1, 1.5] }, material: { color: '#555555' } },
  ];
  const environment: WorldEnvironment = { season: 'spring', weather: 'clear', timeOfDay: 'day', sunIntensity: 1.2, ambientIntensity: 0.5, fogDensity: 0 };
  return { title: '火箭', summary: 'A multipart rocket assembled with procedural shapes.', environment, objects, spawnPoint: { position: [0, 0, 10], yawDeg: 180 } };
}

export function previewArtifact(): ImageArtifact {
  return { mimeType: 'image/png', encoding: 'base64', width: 1, height: 1, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=' };
}

export function visionDraft() {
  const report = {
    visualAnalysis: '红白配色火箭竖立在平坦地面上。',
    objectInventory: '机身\n头锥\n引擎\n地面',
    spatialLayout: '火箭居中，机身竖直，发动机位于底部。',
    cameraAndLighting: '低多边形白色金属机身，红色锥形头部和灰色发动机。',
    assetStrategy: '使用程序化几何；白色 #ffffff、红色 #ee3322、灰色 #555555。',
    finalPrompt: '创建居中竖立的红白火箭，以白色圆柱构成机身，高度约四个单位，红色圆锥作为头部；灰色发动机位于底部并与机身同轴。采用金属质感与适中粗糙度，用水平地面承载主体，暖色日光从左上方照射。角色出生点位于火箭前方十个单位，避免与几何体重叠。背面几何采用对称推断而非测量结果。',
    uncertaintyAndValidation: '背面几何按可见轮廓作对称推断；尺寸为建模估算。',
  };
  return {
    report,
    sceneSummary: '红白配色火箭竖立在平坦地面上。',
    composition: '火箭居中，机身竖直，发动机位于底部。',
    styleNotes: '低多边形白色金属机身，红色锥形头部和灰色发动机。',
    detectedElements: ['机身', '头锥', '引擎', '地面'],
    palette: ['#ffffff', '#ee3322', '#555555'],
    assumptions: ['背面几何按可见轮廓作对称推断；尺寸为建模估算。'],
    modelingPrompt: '创建居中竖立的红白火箭，以白色圆柱构成机身，高度约四个单位，红色圆锥作为头部；灰色发动机位于底部并与机身同轴。采用金属质感与适中粗糙度，用水平地面承载主体，暖色日光从左上方照射。角色出生点位于火箭前方十个单位，避免与几何体重叠。背面几何采用对称推断而非测量结果。',
  };
}

export function visionReport(): string {
  const report = visionDraft().report;
  return [
    ['A. Visual Analysis', report.visualAnalysis],
    ['B. Scene Object Inventory', report.objectInventory],
    ['C. Spatial Layout', report.spatialLayout],
    ['D. Camera and Lighting', report.cameraAndLighting],
    ['E. Asset Strategy', report.assetStrategy],
    ['F. Final Three.js Generation Prompt', report.finalPrompt],
    ['G. Uncertainty and Validation', report.uncertaintyAndValidation],
  ].map(([title, content]) => `**${title}**\n${content}`).join('\n\n');
}

export function planRequest(): WorldPlanRequest {
  return {
    projectId: 'project-test', prompt: '一枚有机身、头锥、尾翼和引擎的红白火箭',
    expansion: { interpretedIntent: 'meadow', sceneLabel: 'meadow', expandedPrompt: 'MOCK MEADOW', keyElements: ['meadow'], mood: 'calm', paletteHint: 'green', suggestedStyleIds: ['low-poly'], environmentHints: {}, provider: 'mock-expander', mock: true, notes: [] },
    concept: { id: 'concept-test', projectId: 'project-test', batchId: 'batch', title: 'Mock meadow', description: 'Never use this as the subject', styleId: 'low-poly', styleLabel: 'low poly', styleLabelEn: 'low poly', imageUrl: 'data:image/png;base64,PRIVATE_IMAGE', prompt: 'MOCK IMAGE PROMPT', seed: 1, mock: false, referenceDriven: false, createdAt: '2026-01-01T00:00:00Z' },
    analysis: { ...visionDraft(), provider: 'openai:vision:stub-model', mock: false, disclaimer: 'Offline fixture of validated visual expansion.' },
  };
}

export function completionResponse(value: unknown = sceneDraft(), reason = 'stop'): Response {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  return new Response(JSON.stringify({ choices: [{ finish_reason: reason, message: { content } }] }));
}
