import { describe, expect, it, vi } from 'vitest';
import type { WorldGeometry, WorldTransform } from '@ai-three-studio/shared';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import { normalizeWorldForSave } from '../projects/world-validation';
import { transformedBounds } from './scene-capabilities';
import { planLiveWorld } from './live-world-planner';
import { repairWorldPlanDraft, validateWorldPlan } from './world-plan-validation';
import { completionResponse, planRequest, previewArtifact, sceneDraft } from './world-plan.fixture';

const transform: WorldTransform = { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const geometries: WorldGeometry[] = [
  { type: 'extrude', points: [[-2, 0], [2, 0], [0, 2]], depth: 2, bevel: 0.05 },
  { type: 'lathe', points: [[0, 0], [1, 0], [1.2, 1], [0.7, 2], [0, 3]], segments: 32 },
  { type: 'tube', points: [[-2, 0, 0], [0, 2, 0], [2, 0, 0]], radius: 0.1, segments: 32, radialSegments: 8 },
  { type: 'ribbon', points: [[-2, 0, -2], [0, 0, 0], [2, 0, 2]], width: 1, segments: 24 },
  { type: 'mesh', positions: [-1, 0, 0, 1, 0, 0, 0, 2, 0], indices: [0, 1, 2] },
];

function parametricDraft(geometry: WorldGeometry) {
  return {
    ...sceneDraft(),
    objects: [sceneDraft().objects[0]!, { name: 'Curved subject', kind: 'procedural', geometry, transform: structuredClone(transform), material: { color: '#c96838', roughness: 0.4 } }],
    render: {
      camera: { projection: 'orthographic', position: [12, 8, 12], target: [0, 2, 0], fov: 48, zoom: 1.5 },
      lights: [{ type: 'directional', color: '#ffe5c0', intensity: 2, position: [-8, 12, 6], castShadow: true }],
      exposure: 1.1,
    },
  };
}

describe('parametric scene pipeline', () => {
  it.each(geometries.map((geometry) => [geometry.type, geometry] as const))('validates, saves and reloads %s without losing shape or reference rendering', (_type, geometry) => {
    const draft = parametricDraft(geometry);
    const world = validateWorldPlan(draft, planRequest(), 'offline-model');
    const saved = normalizeWorldForSave(JSON.parse(JSON.stringify(world)), world);
    expect(saved.objects[1]!.geometry).toEqual(geometry);
    expect(saved.render).toEqual(draft.render);
    expect(saved.source).toEqual(world.source);
    expect(saved.objects[1]!.kind).toBe('procedural');
  });

  it('checks native extrusion origins and rotated bounds, including bevel', () => {
    const draft = parametricDraft(geometries[0]!);
    draft.objects[1]!.transform = { position: [0, 2.1, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 1] };
    const world = validateWorldPlan(draft, planRequest(), 'model');
    expect(transformedBounds(world.objects[1]!, []).min[1]).toBeCloseTo(0.05);
    draft.objects[1]!.transform.position[1] = 0;
    expect(() => validateWorldPlan(draft, planRequest(), 'model')).toThrow();
  });

  it('repairs native geometry layout and spawn without discarding geometry, camera or lights', () => {
    const draft = parametricDraft(geometries[1]!);
    draft.objects[1]!.transform.position = [14, -1, 0];
    draft.spawnPoint.position = [14, 0, 0];
    const repaired = repairWorldPlanDraft(draft, planRequest());
    const world = validateWorldPlan(repaired.draft, planRequest(), 'model');
    expect(world.objects[1]!.geometry).toEqual(geometries[1]);
    expect(world.render).toEqual(draft.render);
    expect(repaired.repairs.expandedGround).toBe(true);
    expect(repaired.repairs.relocatedSpawn).toBe(true);
    expect(transformedBounds(world.objects[1]!, []).min[1]).toBeCloseTo(0);
    expect(draft.objects[1]!.transform.position).toEqual([14, -1, 0]);
  });

  it('lifts connected rocket parts together while leaving independent scenery grounded', () => {
    const draft = sceneDraft();
    for (const part of draft.objects.slice(1)) part.transform.position[1] -= 0.8;
    draft.objects.push({ name: 'Separate marker', kind: 'primitive', params: { shape: 'box' }, transform: { position: [8, 1, 0], rotation: [0, 0, 0], scale: [1, 2, 1] } });
    const before = draft.objects[2]!.transform.position[1] - draft.objects[1]!.transform.position[1];
    const repaired = repairWorldPlanDraft(draft, planRequest());
    const world = validateWorldPlan(repaired.draft, planRequest(), 'model');
    expect(world.objects[2]!.transform.position[1] - world.objects[1]!.transform.position[1]).toBeCloseTo(before);
    expect(world.objects[3]!.transform.position[1]).toBeCloseTo(0.5);
    expect(world.objects[4]!.transform.position[1]).toBe(1);
  });

  it.each([
    { type: 'lathe', points: [[-1, 0], [1, 2]], segments: 32 },
    { type: 'tube', points: [[0, 0, 0], [0, 0, 0]], radius: 1, segments: 10, radialSegments: 8 },
    { type: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 99] },
    { type: 'extrude', points: [[-1, -1], [1, 1], [-1, 1], [1, -1]], depth: 1 },
    { type: 'eval', code: 'malicious' },
  ])('rejects malformed geometry even after a repair attempt', (geometry) => {
    const draft = parametricDraft(geometry as WorldGeometry);
    const repaired = repairWorldPlanDraft(draft, planRequest());
    expect(() => validateWorldPlan(repaired.draft, planRequest(), 'model')).toThrow();
  });

  it('enforces the triangle budget for generated and edited scenes', () => {
    const draft = parametricDraft({ type: 'tube', points: [[0, 0, 0], [0, 1, 0]], radius: 0.1, segments: 512, radialSegments: 64 });
    draft.objects.push(...Array.from({ length: 5 }, () => structuredClone(draft.objects[1]!)));
    expect(() => validateWorldPlan(draft, planRequest(), 'model')).toThrow();
    const world = validateWorldPlan(parametricDraft(geometries[1]!), planRequest(), 'model');
    const raw = { ...world, objects: [world.objects[0], ...Array.from({ length: 6 }, (_, i) => ({ ...world.objects[1], id: `tube-${i}`, geometry: { type: 'tube', points: [[0, 0, 0], [0, 1, 0]], radius: 0.1, segments: 512, radialSegments: 64 } }))] };
    expect(() => normalizeWorldForSave(raw, world)).toThrow('复杂度');
  });

  it('keeps the selected image in the modeling request and reports modeling errors with the correct stage', async () => {
    const config = { enabled: false, modelingEnabled: true, baseURL: 'https://api.example.com/v1', model: 'offline', apiKey: 'offline-secret-123' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse(parametricDraft(geometries[1]!)));
    const client = new CompatibleChatService(fetcher);
    try {
      const artifact = previewArtifact();
      const image = { mimeType: 'image/png' as const, data: artifact.data };
      const world = await planLiveWorld(client, config, planRequest(), undefined, image);
      const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
      expect(body.messages[1].content[1].image_url.url).toBe(`data:image/png;base64,${artifact.data}`);
      expect(world.objects[1]!.geometry?.type).toBe('lathe');
      fetcher.mockResolvedValueOnce(completionResponse('invalid JSON'));
      await expect(planLiveWorld(client, config, planRequest(), undefined, image)).rejects.toThrow('建模服务未返回合法 JSON');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { await client.onModuleDestroy(); }
  });
});
