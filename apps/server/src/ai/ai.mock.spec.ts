import { describe, expect, it } from 'vitest';
import type { ConceptGenerationRequest, WorldSchema } from '@ai-three-studio/shared';
import { AiService } from './ai.service';
import { MockChatProvider } from './mock/mock-chat-provider';
import { MockConceptImageProvider } from './mock/mock-concept-provider';
import { MockImageAnalyzer } from './mock/mock-image-analyzer';
import { MockPromptExpander } from './mock/mock-prompt-expander';
import { MockWorldPlanner } from './mock/mock-world-planner';

function createAiService(): AiService {
  return new AiService(
    new MockPromptExpander(),
    new MockConceptImageProvider(),
    new MockImageAnalyzer(),
    new MockWorldPlanner(),
    new MockChatProvider(),
  );
}

describe('mock AI pipeline', () => {
  const ai = createAiService();

  it('expands a short prompt into a clearly marked mock plan', async () => {
    const expansion = await ai.expandPrompt({ prompt: '林中小屋' });

    expect(expansion.mock).toBe(true);
    expect(expansion.sceneLabel.length).toBeGreaterThan(0);
    expect(expansion.expandedPrompt.length).toBeGreaterThan(20);
    expect(expansion.suggestedStyleIds.length).toBeGreaterThanOrEqual(3);
    expect(expansion.notes.join(' ')).toContain('规则');
  });

  it('produces five distinct concept styles with mock-labelled SVG art', async () => {
    const expansion = await ai.expandPrompt({ prompt: '赛博朋克城市' });
    const request: ConceptGenerationRequest = {
      projectId: 'spec-project',
      prompt: '赛博朋克城市',
      expansion,
      count: 5,
      mode: 'initial',
      batchSeed: 12345,
      existingStyleIds: [],
    };

    const concepts = await ai.generateConcepts(request);

    expect(concepts).toHaveLength(5);
    expect(new Set(concepts.map((concept) => concept.styleId)).size).toBe(5);
    for (const concept of concepts) {
      expect(concept.artifact.mimeType).toBe('image/svg+xml');
      expect(concept.artifact.data).toContain('<svg');
      expect(concept.artifact.data).toContain('MOCK PREVIEW');
      expect(concept.artifact.data).toContain('非真实 AI 生成');
      expect(concept.prompt.length).toBeGreaterThan(30);
    }
    expect(new Set(concepts.map((concept) => concept.artifact.data)).size).toBe(5);
  });

  it('keeps the base style when generating similar variants', async () => {
    const expansion = await ai.expandPrompt({ prompt: '海边小镇' });
    const baseConcepts = await ai.generateConcepts({
      projectId: 'spec-project',
      prompt: '海边小镇',
      expansion,
      count: 5,
      mode: 'initial',
      batchSeed: 77,
      existingStyleIds: [],
    });
    const base = baseConcepts[0];
    expect(base).toBeDefined();

    const variants = await ai.generateConcepts({
      projectId: 'spec-project',
      prompt: '海边小镇',
      expansion,
      count: 3,
      mode: 'similar',
      batchSeed: 88,
      existingStyleIds: baseConcepts.map((concept) => concept.styleId),
      baseConcept: {
        id: 'base-concept',
        projectId: 'spec-project',
        batchId: 'batch',
        title: base!.title,
        description: base!.description,
        styleId: base!.styleId,
        styleLabel: base!.styleLabel,
        styleLabelEn: base!.styleLabelEn,
        imageUrl: '/api/mock.svg',
        prompt: base!.prompt,
        seed: base!.seed,
        mock: true,
        referenceDriven: false,
        createdAt: new Date().toISOString(),
      },
    });

    expect(variants).toHaveLength(3);
    expect(variants.every((concept) => concept.styleId === base!.styleId)).toBe(
      true,
    );
    expect(new Set(variants.map((concept) => concept.seed)).size).toBe(3);
  });

  it('plans an editable world with independent procedural objects', async () => {
    const expansion = await ai.expandPrompt({ prompt: '雪山营地 黄昏' });
    const [concept] = await ai.generateConcepts({
      projectId: 'spec-project',
      prompt: '雪山营地 黄昏',
      expansion,
      count: 5,
      mode: 'initial',
      batchSeed: 99,
      existingStyleIds: [],
    });
    expect(concept).toBeDefined();

    const analysis = await ai.analyzeConcept({
      concept: {
        id: 'concept-analysis',
        projectId: 'spec-project',
        batchId: 'batch',
        title: concept!.title,
        description: concept!.description,
        styleId: concept!.styleId,
        styleLabel: concept!.styleLabel,
        styleLabelEn: concept!.styleLabelEn,
        imageUrl: '/api/mock.svg',
        prompt: concept!.prompt,
        seed: concept!.seed,
        mock: true,
        referenceDriven: false,
        createdAt: new Date().toISOString(),
      },
      prompt: '雪山营地 黄昏',
      expansion,
    });
    expect(analysis.mock).toBe(true);
    expect(analysis.palette.length).toBeGreaterThan(0);

    const world: WorldSchema = await ai.planWorld({
      projectId: 'spec-project',
      prompt: '雪山营地 黄昏',
      expansion,
      concept: {
        id: 'concept-analysis',
        projectId: 'spec-project',
        batchId: 'batch',
        title: concept!.title,
        description: concept!.description,
        styleId: concept!.styleId,
        styleLabel: concept!.styleLabel,
        styleLabelEn: concept!.styleLabelEn,
        imageUrl: '/api/mock.svg',
        prompt: concept!.prompt,
        seed: concept!.seed,
        mock: true,
        referenceDriven: false,
        createdAt: new Date().toISOString(),
      },
      analysis,
    });

    expect(world.schemaVersion).toBe(1);
    expect(world.source.provider.mode).toBe('mock');
    expect(world.meta.mock).toBe(true);
    expect(world.meta.objectCount).toBe(world.objects.length);
    expect(world.objects.length).toBeGreaterThanOrEqual(10);
    expect(world.objects.length).toBeLessThanOrEqual(200);
    expect(new Set(world.objects.map((object) => object.id)).size).toBe(
      world.objects.length,
    );
    expect(world.objects.every((object) => object.asset.mock)).toBe(true);
    expect(world.objects.some((object) => object.kind === 'tent')).toBe(true);
    expect(world.spawnPoint.position).toHaveLength(3);
  });

  it('recognises coastal landmarks and plans a lighthouse landmark', async () => {
    const prompt = '雾中的白色灯塔，海面平静，一艘小船停靠在岸边';
    const expansion = await ai.expandPrompt({ prompt });
    expect(expansion.sceneLabel).toBe('海边小镇');

    const [generated] = await ai.generateConcepts({
      projectId: 'spec-project',
      prompt,
      expansion,
      count: 5,
      mode: 'initial',
      batchSeed: 21,
      existingStyleIds: [],
    });
    expect(generated).toBeDefined();
    const concept = {
      id: 'concept-lighthouse',
      projectId: 'spec-project',
      batchId: 'batch',
      title: generated!.title,
      description: generated!.description,
      styleId: generated!.styleId,
      styleLabel: generated!.styleLabel,
      styleLabelEn: generated!.styleLabelEn,
      imageUrl: '/api/mock.svg',
      prompt: generated!.prompt,
      seed: generated!.seed,
      mock: true,
      referenceDriven: false,
      createdAt: new Date().toISOString(),
    };
    const analysis = await ai.analyzeConcept({ concept, prompt, expansion });
    const world = await ai.planWorld({
      projectId: 'spec-project',
      prompt,
      expansion,
      concept,
      analysis,
    });

    const lighthouse = world.objects.find(
      (object) => object.kind !== 'primitive' && object.params?.variant === 'lighthouse',
    );
    expect(lighthouse?.kind).toBe('tower');
    expect(world.objects.some((object) => object.kind === 'boat')).toBe(true);
    expect(world.objects.some((object) => object.kind === 'water')).toBe(true);
  });

  it('answers chat without pretending to edit the world schema', async () => {
    const reply = await ai.chat({ message: '把场景改成冬天' });

    expect(reply.mock).toBe(true);
    expect(reply.content.length).toBeGreaterThan(0);
    expect(reply.environmentSuggestion?.season).toBe('winter');
  });
});
