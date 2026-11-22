import { BadRequestException } from '@nestjs/common';
import type { WorldObject, WorldSchema } from '@ai-three-studio/shared';
import { describe, expect, it } from 'vitest';
import { normalizeWorldForSave } from './world-validation';

function baseWorld(): WorldSchema {
  const object: WorldObject = {
    id: 'tree-1',
    name: '松树',
    kind: 'tree',
    asset: {
      id: 'tree.procedural',
      source: 'procedural',
      format: 'primitive-group',
      provider: 'phase1-mock',
      mock: true,
    },
    transform: {
      position: [1, 0, -2],
      rotation: [0, 0.5, 0],
      scale: [1, 1.4, 1],
    },
    tags: ['vegetation'],
  };

  return {
    schemaVersion: 1,
    id: 'world-spec',
    title: '测试世界',
    summary: 'spec',
    source: {
      prompt: '林中小屋',
      conceptId: 'concept-1',
      conceptTitle: '梦境柔光 · 林中小屋',
      conceptStyleId: 'painterly-dream',
      provider: {
        name: 'mock-suite',
        mode: 'mock',
        vision: 'mock-vision',
        planner: 'mock-planner',
      },
      generatedAt: '2026-01-01T00:00:00.000Z',
      disclaimer: 'mock',
    },
    environment: {
      season: 'spring',
      weather: 'clear',
      timeOfDay: 'day',
      sunIntensity: 1.4,
      ambientIntensity: 0.55,
      fogDensity: 0.012,
    },
    objects: [object],
    spawnPoint: { position: [0, 0, 6], yawDeg: 180 },
    gameplay: null,
    meta: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      editable: true,
      mock: true,
      objectCount: 1,
    },
  };
}

function editedPayload(base: WorldSchema): Record<string, unknown> {
  return {
    ...base,
    title: '  修改后的世界  ',
    source: {
      ...base.source,
      provider: { ...base.source.provider, mode: 'live', planner: 'forged-live' },
      disclaimer: 'forged',
    },
    objects: [
      {
        ...base.objects[0],
        transform: { ...base.objects[0]!.transform, position: [2, 0, -3] },
        material: { color: '#88aa55', roughness: 0.7, metalness: -4 },
        params: { foliage: 'pine', size: 2, nested: { bad: true } },
        asset: {
          ...base.objects[0]!.asset,
          source: 'library-model',
          url: 'https://evil.example/model.glb',
        },
      },
    ],
  };
}

describe('normalizeWorldForSave', () => {
  it('keeps provenance server-owned and sanitizes client edits', () => {
    const base = baseWorld();
    const saved = normalizeWorldForSave(editedPayload(base), base);

    expect(saved.id).toBe(base.id);
    expect(saved.title).toBe('修改后的世界');
    expect(saved.source).toEqual(base.source);
    expect(saved.source.provider.mode).toBe('mock');
    expect(saved.gameplay).toBeNull();
    expect(saved.objects[0]!.asset.source).toBe('procedural');
    expect(saved.objects[0]!.asset.url).toBeUndefined();
    expect(saved.objects[0]!.transform.position).toEqual([2, 0, -3]);
    expect(saved.objects[0]!.material?.metalness).toBe(0);
    expect(saved.objects[0]!.params).toEqual({ foliage: 'pine', size: 2 });
    expect(saved.meta.mock).toBe(true);
    expect(saved.meta.objectCount).toBe(1);
    expect(saved.meta.createdAt).toBe(base.meta.createdAt);
    expect(saved.meta.updatedAt).not.toBe(base.meta.updatedAt);
  });

  it('preserves live provenance and base assets by id, not client-provided claims', () => {
    const base = baseWorld();
    base.source.provider.mode = 'live';
    base.source.provider.planner = 'openai-compatible:actual-model';
    base.meta.mock = false;
    base.objects[0]!.asset.mock = false;
    base.objects[0]!.asset.provider = 'actual-procedural-provider';
    const payload = editedPayload(base);
    payload.meta = { ...base.meta, mock: true };
    payload.source = { ...base.source, provider: { mode: 'mock' } };
    const result = normalizeWorldForSave(payload, base);
    expect(result.source).toEqual(base.source);
    expect(result.meta.mock).toBe(false);
    expect(result.objects[0]!.asset).toEqual(base.objects[0]!.asset);
  });

  it('binds a trusted procedural source for changed kinds and new ids', () => {
    const base = baseWorld();
    base.meta.mock = false;
    base.source.provider.mode = 'live';
    const payload = editedPayload(base);
    const item = (payload.objects as Record<string, unknown>[])[0]!;
    item.kind = 'primitive';
    item.params = { shape: 'capsule', url: 'https://evil.test', widthSegments: 10000, code: 'eval(1)' };
    const saved = normalizeWorldForSave(payload, base);
    expect(saved.objects[0]!.params).toEqual({ shape: 'capsule' });
    expect(saved.objects[0]!.asset).toMatchObject({ source: 'procedural', provider: 'studio-procedural-edit', mock: false });
    expect(saved.objects[0]!.asset.url).toBeUndefined();
    item.id = 'new-part';
    expect(normalizeWorldForSave(payload, base).objects[0]!.asset.provider).toBe('studio-procedural-edit');
    for (const params of [undefined, {}, { shape: 'extrude' }, { shape: 1 }, { shape: 'BOX' }]) {
      item.params = params;
      expect(() => normalizeWorldForSave(payload, base)).toThrow(/shape/);
    }
  });

  it('rejects duplicate object ids', () => {
    const base = baseWorld();
    const payload = editedPayload(base);
    const object = (payload.objects as unknown[])[0] as Record<
      string,
      unknown
    >;
    payload.objects = [object, { ...object }];

    expect(() => normalizeWorldForSave(payload, base)).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown object kinds and invalid transforms', () => {
    const base = baseWorld();
    const wrongKind = editedPayload(base);
    (wrongKind.objects as Array<Record<string, unknown>>)[0]!.kind = 'dragon';
    expect(() => normalizeWorldForSave(wrongKind, base)).toThrow(
      /kind|对象/,
    );

    const badScale = editedPayload(base);
    const transform = (badScale.objects as Array<Record<string, unknown>>)[0]![
      'transform'
    ] as Record<string, unknown>;
    transform.scale = [1, 0, 1];
    expect(() => normalizeWorldForSave(badScale, base)).toThrow(
      BadRequestException,
    );
  });

  it('rejects empty object lists and invalid environment ids', () => {
    const base = baseWorld();
    const empty = editedPayload(base);
    empty.objects = [];
    expect(() => normalizeWorldForSave(empty, base)).toThrow(
      BadRequestException,
    );

    const wrongSeason = editedPayload(base);
    (wrongSeason.environment as Record<string, unknown>).season = 'monsoon';
    expect(() => normalizeWorldForSave(wrongSeason, base)).toThrow(
      BadRequestException,
    );
  });
});
