import { describe, expect, it, vi } from 'vitest';
import { CompatibleChatService } from '../settings/compatible-chat.service';
import { normalizeWorldForSave } from '../projects/world-validation';
import { planLiveWorld, WorldPlanGenerationException, WORLD_VALIDATION_ERRORS } from './live-world-planner';
import { completionResponse, planRequest, sceneDraft } from './world-plan.fixture';
import { repairWorldPlanDraft, validateWorldPlan, WorldPlanValidationError } from './world-plan-validation';

const config = { enabled: false, modelingEnabled: true, baseURL: 'https://api.example.com/v1', model: 'offline', apiKey: 'offline-key-only' };

/** Synthetic regression for snow-camp notation, not the user's discarded upstream response. */
function snowCampDraft() {
  return {
    title: '雪山营地', summary: '雪地上的三角帐篷、绳索和保温瓶。',
    environment: { season: 'winter', weather: 'snow', timeOfDay: 'day', sunIntensity: 2.6, ambientIntensity: 0.6, fogDensity: 0.007 },
    objects: [
      sceneDraft().objects[0],
      { name: 'Tent', kind: 'extrude', transform: { position: [0, 0, -2], rotation: [0, 0, 0], scale: [1, 1, 1] }, params: null,
        geometry: { type: 'extrude', points: [[-2, 0], [2, 0], [0, 3], [-2, 0]], depth: 4, holes: null, bevel: null }, material: { color: '#EFE6D2' } },
      { name: 'Rope', kind: 'procedural', transform: { position: [0, 0.1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        geometry: { type: 'tube', points: [[-2, 0, 2], [-2, 0, 2], [-1, 2, 0]], radius: 0.025 }, collision: null },
      { name: 'Bottle', kind: 'procedural', transform: { position: [4, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        params: { type: 'lathe', points: [[0, 0], [0.18, 0], [0.18, 0.6], [0.1, 0.75], [0, 0.75]] }, material: { color: '#B92E2A' } },
    ],
    spawnPoint: { position: [10, 0, 10], yawDeg: 180 },
    render: { camera: { projection: 'perspective', position: [11, 7.5, 15.5], target: [0, 1.8, 0], fov: 42 } },
  };
}

describe('model notation compatibility and actionable validation errors', () => {
  it('accepts ordinary perspective and orthographic cameras with renderer defaults', () => {
    for (const projection of ['perspective', 'orthographic']) {
      const draft = { ...sceneDraft(), render: { camera: { projection, position: [10, 8, 12], target: [0, 2, 0] } } };
      expect(validateWorldPlan(draft, planRequest(), 'model').render?.camera).toMatchObject({ fov: 48, zoom: 1 });
    }
  });

  it('normalizes snow-camp notation, preserves geometry through save, and never repeats the paid call', async () => {
    const draft = snowCampDraft();
    const before = JSON.stringify(draft);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse(draft));
    const client = new CompatibleChatService(fetcher);
    try {
      const world = await planLiveWorld(client, config, planRequest());
      expect(world.objects).toHaveLength(4);
      expect(world.objects[1]!.kind).toBe('procedural');
      expect(world.objects[1]!.geometry).toMatchObject({ type: 'extrude', points: [[-2, 0], [2, 0], [0, 3]], depth: 4 });
      expect(world.objects[2]!.geometry).toMatchObject({ type: 'tube', segments: 64, radialSegments: 8, points: [[-2, 0, 2], [-1, 2, 0]] });
      expect(world.objects[3]!.geometry).toMatchObject({ type: 'lathe', segments: 32 });
      expect(world.render?.camera?.zoom).toBe(1);
      const saved = normalizeWorldForSave(JSON.parse(JSON.stringify(world)), world);
      expect(saved.objects.map((part) => part.geometry)).toEqual(world.objects.map((part) => part.geometry));
      expect(saved.render).toEqual(world.render);
      expect(JSON.stringify(draft)).toBe(before);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { await client.onModuleDestroy(); }
  });

  it('retains the exact safe field path and never includes rejected values in errors', async () => {
    const draft = sceneDraft();
    draft.objects[1]!.kind = 'PRIVATE_UPSTREAM_KIND';
    delete draft.objects[1]!.params;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionResponse(draft));
    const client = new CompatibleChatService(fetcher);
    try {
      const error = await planLiveWorld(client, config, planRequest()).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(WorldPlanGenerationException);
      expect((error as Error).message).toContain('objects[1].kind');
      expect(JSON.stringify(error)).not.toMatch(/PRIVATE_UPSTREAM_KIND|offline-key-only/);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { await client.onModuleDestroy(); }
  });

  it('pinpoints invalid camera values instead of hiding them behind a generic fields error', () => {
    const draft = { ...sceneDraft(), render: { camera: { projection: 'perspective', position: [10, 8, 12], target: [0, 2, 0], fov: 0 } } };
    try {
      validateWorldPlan(draft, planRequest(), 'model');
      expect.fail('Invalid fov must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WorldPlanValidationError);
      expect((error as WorldPlanValidationError).path).toBe('render.camera.fov');
    }
  });

  it('treats explicit null optional render values like omissions while retaining invalid required data', () => {
    const draft = { ...sceneDraft(), render: { camera: { projection: 'perspective', position: [10, 8, 12], target: [0, 2, 0], zoom: null, fov: null }, lights: null, bloom: null } };
    const world = validateWorldPlan(repairWorldPlanDraft(draft, planRequest()).draft, planRequest(), 'model');
    expect(world.render?.camera).toMatchObject({ fov: 48, zoom: 1 });
    expect(world.render?.lights).toBeUndefined();
    expect(draft.render.camera.zoom).toBeNull();
  });

  it('still rejects unsupported geometry and degenerate outlines after normalization', () => {
    for (const geometry of [
      { type: 'code', script: 'PRIVATE_UNSUPPORTED' },
      { type: 'extrude', points: [[0, 0], [0, 0], [0, 0]], depth: 2 },
      { type: 'tube', points: [[0, 0, 0], [0, 0, 0]], radius: 1 },
      { type: 'extrude', points: [[-1, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]], depth: 1 },
    ]) {
      const draft = { ...sceneDraft(), objects: [sceneDraft().objects[0], { name: 'Invalid', kind: 'procedural', geometry, transform: sceneDraft().objects[1]!.transform }] };
      expect(() => validateWorldPlan(repairWorldPlanDraft(draft, planRequest()).draft, planRequest(), 'model')).toThrow();
    }
  });

  it('reports excessive geometry as complexity rather than unsupported fields', () => {
    const error = new WorldPlanGenerationException(new WorldPlanValidationError('complexity'));
    expect(error.message).toBe(WORLD_VALIDATION_ERRORS.complexity);
  });
});
