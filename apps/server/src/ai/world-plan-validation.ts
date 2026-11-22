import { randomUUID } from 'node:crypto';
import type { ChatApiProtocol, PrimitiveShape, Vec3, WorldEnvironment, WorldMaterial, WorldObject, WorldPlanRequest, WorldSchema } from '@ai-three-studio/shared';
import { sceneResources, transformedBounds, validateGeometry, validateRender } from './scene-capabilities';
import { atField, SceneFieldError } from './scene-field-error';
import { isSupportedGeometry, normalizeGeometryNotation, normalizeRenderNotation } from './geometry-normalization';

const SHAPES: readonly PrimitiveShape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'icosahedron'];
/** Low surfaces a player can walk over; they do not make a spawn point unsafe. */
const SPAWN_STEP_OVER_HEIGHT = 0.2;

export type WorldPlanIssue = 'fields' | 'ground' | 'spawn' | 'bounds' | 'below-ground' | 'complexity';

/** All validation errors are deliberately independent of provider-controlled values. */
export class WorldPlanValidationError extends Error {
  constructor(readonly issue: WorldPlanIssue, readonly path?: string) {
    super('Invalid structured scene');
    this.name = 'WorldPlanValidationError';
  }
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid structured scene');
}
function stage<T>(issue: WorldPlanIssue, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof WorldPlanValidationError) throw error;
    throw new WorldPlanValidationError(issue, error instanceof SceneFieldError ? error.path : undefined);
  }
}
function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  check(Object.keys(value).every((key) => allowed.includes(key)));
}
function number(value: unknown, min: number, max: number): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
  return value;
}
function text(value: unknown, max: number): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max);
  return value.trim();
}
function vector(value: unknown, min: number, max: number): Vec3 {
  check(Array.isArray(value) && value.length === 3);
  return value.map((entry, index) => atField(`[${index}]`, () => number(entry, min, max))) as Vec3;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  check(typeof value === 'string' && allowed.includes(value as T));
  return value as T;
}
export function primitiveShape(value: unknown): PrimitiveShape {
  return choice(value, SHAPES);
}
function material(value: unknown): WorldMaterial | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  keys(raw, ['color', 'emissive', 'roughness', 'metalness', 'opacity', 'emissiveIntensity', 'flatShading']);
  const result: WorldMaterial = {};
  for (const key of ['color', 'emissive'] as const) {
    if (raw[key] !== undefined) {
      result[key] = atField(key, () => {
        const value = raw[key];
        check(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value));
        return value;
      });
    }
  }
  for (const key of ['roughness', 'metalness', 'opacity', 'emissiveIntensity'] as const) {
    if (raw[key] !== undefined) result[key] = atField(key, () => number(raw[key], 0, key === 'emissiveIntensity' ? 10 : 1));
  }
  if (raw.flatShading !== undefined) {
    check(typeof raw.flatShading === 'boolean');
    result.flatShading = raw.flatShading;
  }
  return result;
}
function environment(value: unknown): WorldEnvironment {
  const raw = record(value);
  keys(raw, ['season', 'weather', 'timeOfDay', 'sunIntensity', 'ambientIntensity', 'fogDensity']);
  return {
    season: atField('season', () => choice(raw.season, ['spring', 'summer', 'autumn', 'winter'])),
    weather: atField('weather', () => choice(raw.weather, ['clear', 'cloudy', 'light-rain', 'heavy-rain', 'windy', 'snow'])),
    timeOfDay: atField('timeOfDay', () => choice(raw.timeOfDay, ['morning', 'day', 'dusk', 'night'])),
    sunIntensity: atField('sunIntensity', () => number(raw.sunIntensity, 0, 10)),
    ambientIntensity: atField('ambientIntensity', () => number(raw.ambientIntensity, 0, 5)),
    fogDensity: atField('fogDensity', () => number(raw.fogDensity, 0, 0.2)),
  };
}

export function validateWorldPlan(raw: unknown, request: WorldPlanRequest, model: string, protocol: ChatApiProtocol = 'openai'): WorldSchema {
  const { draft, title, summary, env } = stage('fields', () => {
    const draft = record(raw);
    keys(draft, ['title', 'summary', 'environment', 'objects', 'spawnPoint', 'render']);
    return {
      draft,
      title: atField('title', () => text(draft.title, 160)),
      summary: atField('summary', () => text(draft.summary, 2000)),
      env: atField('environment', () => environment(draft.environment)),
    };
  });
  stage('fields', () => atField('objects', () => check(Array.isArray(draft.objects) && draft.objects.length >= 1 && draft.objects.length <= 120)));
  const providerName = protocol === 'openai' ? 'openai-compatible' : protocol;
  const provider = `${providerName}:${model}`;
  const objects: WorldObject[] = stage('fields', () => (draft.objects as unknown[]).map((entry, index) => atField(`objects[${index}]`, () => {
    const item = record(entry);
    keys(item, ['name', 'kind', 'transform', 'material', 'params', 'tags', 'geometry', 'collision']);
    const kind = atField('kind', () => choice(item.kind, ['ground', 'primitive', 'procedural'] as const));
    check(item.collision === undefined || item.collision === 'solid' || item.collision === 'none');
    const geometry = kind === 'procedural' ? atField('geometry', () => validateGeometry(item.geometry)) : undefined;
    check(kind === 'procedural' || item.geometry === undefined);
    // One flat ground remains the exploration surface. Terrain authoring is separate.
    check(geometry?.type !== 'terrain');
    const rawTransform = atField('transform', () => record(item.transform));
    keys(rawTransform, ['position', 'rotation', 'scale']);
    const transform = {
      position: atField('transform.position', () => vector(rawTransform.position, -100, 100)),
      rotation: atField('transform.rotation', () => vector(rawTransform.rotation, -Math.PI * 2, Math.PI * 2)),
      scale: atField('transform.scale', () => vector(rawTransform.scale, 0.01, 100)),
    };
    const params = atField('params', () => {
      const params = item.params === undefined ? {} : record(item.params);
      keys(params, kind === 'primitive' ? ['shape'] : []);
      return params;
    });
    check(item.tags === undefined || (Array.isArray(item.tags) && item.tags.length <= 20));
    const common = {
      id: randomUUID(), name: text(item.name, 100), transform, material: atField('material', () => material(item.material)),
      asset: { id: randomUUID(), source: 'procedural' as const, format: 'primitive-group' as const, provider, mock: false },
      tags: (item.tags as unknown[] | undefined)?.map((tag) => text(tag, 60)) ?? [],
      ...(geometry ? { geometry } : {}),
      ...(item.collision !== undefined ? { collision: item.collision as 'solid' | 'none' } : {}),
    };
    return kind === 'primitive'
      ? { ...common, kind, params: { shape: atField('params.shape', () => primitiveShape(params.shape)) } }
      : { ...common, kind };
  })));
  const grounds = objects.filter((object) => object.kind === 'ground');
  const parts = objects.filter((object) => object.kind !== 'ground');
  const render = stage('fields', () => atField('render', () => validateRender(draft.render)));
  stage('complexity', () => sceneResources(objects, []));
  const ground = stage('ground', () => {
    check(grounds.length === 1 && parts.length > 0);
    const ground = grounds[0]!;
    check(ground.collision !== 'none');
    const [gx, gy, gz] = ground.transform.position;
    const [width, height, depth] = ground.transform.scale;
    check(gy === 0 && height === 1 && width >= 10 && depth >= 10 && ground.transform.rotation.every((angle) => angle === 0));
    return ground;
  });
  const [gx, , gz] = ground.transform.position;
  const [width, , depth] = ground.transform.scale;
  const spawnPoint = stage('spawn', () => {
    const spawn = record(draft.spawnPoint);
    keys(spawn, ['position', 'yawDeg']);
    const spawnPoint = { position: vector(spawn.position, -100, 100), yawDeg: number(spawn.yawDeg, -360, 360) };
    const [sx, sy, sz] = spawnPoint.position;
    check(sy === 0 && Math.abs(sx - gx) <= width / 2 - 1 && Math.abs(sz - gz) <= depth / 2 - 1);
    return spawnPoint;
  });
  const [sx, , sz] = spawnPoint.position;
  stage('bounds', () => {
    for (const part of parts) {
      const { min, max } = transformedBounds(part, []);
      // Keep the entire model on the walkable ground and leave a 0.6m spawn clearance.
      if (!(min[0] >= gx - width / 2 + 0.25 && max[0] <= gx + width / 2 - 0.25
        && min[2] >= gz - depth / 2 + 0.25 && max[2] <= gz + depth / 2 - 0.25)) {
        throw new WorldPlanValidationError('bounds');
      }
      if (!(min[1] >= -0.05)) throw new WorldPlanValidationError('below-ground');
      const overlapsPlayer = part.collision !== 'none' && min[1] < 1.8 && max[1] > SPAWN_STEP_OVER_HEIGHT
        && sx > min[0] - 0.6 && sx < max[0] + 0.6 && sz > min[2] - 0.6 && sz < max[2] + 0.6;
      if (overlapsPlayer) throw new WorldPlanValidationError('spawn');
    }
  });
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, id: randomUUID(), title, summary,
    source: {
      prompt: request.prompt, conceptId: request.concept.id, conceptTitle: request.concept.title, conceptStyleId: request.concept.styleId,
      provider: { name: `${providerName}-vision-modeling`, mode: 'live', vision: request.analysis.provider, planner: provider },
      generatedAt: now,
      disclaimer: 'AI 读取所选预览图并扩写建模提示词，再结合原始描述规划结构化场景，由 Three.js 程序化几何组装；尺寸和遮挡部分属于推断，不是精确三维重建或生成式 GLB 模型。',
    },
    environment: env, objects, spawnPoint, gameplay: null, ...(render ? { render } : {}),
    meta: { createdAt: now, updatedAt: now, editable: true, mock: false, objectCount: objects.length },
  };
}

export interface WorldPlanRepairs {
  extraFields: number;
  kindAliases: number;
  materialFixes: number;
  textFixes: number;
  scaleFixes: number;
  positionFixes: number;
  rotationFixes: number;
  normalizedGround: boolean;
  shiftedParts: number;
  liftedParts: number;
  expandedGround: boolean;
  clampedSpawn: boolean;
  relocatedSpawn: boolean;
  trimmedObjects: number;
  extraGrounds: number;
  fallbackEnvironment: boolean;
}

export interface WorldPlanRepairResult {
  draft: unknown;
  repairs: WorldPlanRepairs;
}

interface TransformValues {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}
function tuple3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value;
  return finiteNumber(x) && finiteNumber(y) && finiteNumber(z) ? [x, y, z] : undefined;
}
function transformValues(value: unknown): TransformValues | undefined {
  if (!isRecord(value)) return undefined;
  const position = tuple3(value.position);
  const rotation = tuple3(value.rotation);
  const scale = tuple3(value.scale);
  return position && rotation && scale ? { position, rotation, scale } : undefined;
}
function repairTransform(value: unknown, repairs: WorldPlanRepairs): unknown {
  if (!isRecord(value)) return value;
  const copy = {
    position: Array.isArray(value.position) ? [...value.position] : value.position,
    rotation: Array.isArray(value.rotation) ? [...value.rotation] : value.rotation,
    scale: Array.isArray(value.scale) ? [...value.scale] : value.scale,
  };
  if (Array.isArray(copy.position) && copy.position.length === 3) {
    copy.position = copy.position.map((entry) => {
      if (!finiteNumber(entry)) return entry;
      const fixed = clampNumber(entry, -100, 100);
      if (fixed !== entry) repairs.positionFixes += 1;
      return fixed;
    });
  }
  if (Array.isArray(copy.rotation) && copy.rotation.length === 3) {
    copy.rotation = copy.rotation.map((entry) => {
      if (!finiteNumber(entry)) return entry;
      if (Math.abs(entry) > Math.PI * 2 && Math.abs(entry) <= 360) {
        repairs.rotationFixes += 1;
        return (entry * Math.PI) / 180;
      }
      return entry;
    });
  }
  if (Array.isArray(copy.scale) && copy.scale.length === 3) {
    copy.scale = copy.scale.map((entry) => {
      if (!finiteNumber(entry)) return entry;
      const fixed = clampNumber(Math.abs(entry), 0.01, 100);
      if (fixed !== entry) repairs.scaleFixes += 1;
      return fixed;
    });
  }
  return copy;
}

function repairMaterial(value: unknown, repairs: WorldPlanRepairs): WorldMaterial | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) { repairs.materialFixes += 1; return undefined; }
  const allowed = ['color', 'emissive', 'roughness', 'metalness', 'opacity', 'emissiveIntensity', 'flatShading'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) repairs.extraFields += 1;
  const result: WorldMaterial = {};
  for (const key of ['color', 'emissive'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) result[key] = raw;
    else repairs.materialFixes += 1;
  }
  for (const key of ['roughness', 'metalness', 'opacity', 'emissiveIntensity'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (!finiteNumber(raw)) { repairs.materialFixes += 1; continue; }
    const fixed = clampNumber(raw, 0, key === 'emissiveIntensity' ? 10 : 1);
    result[key] = fixed;
    if (fixed !== raw) repairs.materialFixes += 1;
  }
  if (value.flatShading !== undefined) {
    if (typeof value.flatShading === 'boolean') result.flatShading = value.flatShading;
    else repairs.materialFixes += 1;
  }
  return result;
}

function repairTags(value: unknown, repairs: WorldPlanRepairs): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) { repairs.textFixes += 1; return undefined; }
  const tags: string[] = [];
  for (const entry of value) {
    const tag = cleanText(entry, 60);
    if (tag) tags.push(tag);
    else repairs.textFixes += 1;
  }
  if (tags.length > 20) {
    tags.length = 20;
    repairs.textFixes += 1;
  }
  return tags;
}

function repairObject(value: unknown, index: number, repairs: WorldPlanRepairs): unknown {
  if (!isRecord(value)) return value;
  if (Object.keys(value).some((key) => !['name', 'kind', 'transform', 'material', 'params', 'tags', 'geometry', 'collision'].includes(key))) {
    repairs.extraFields += 1;
  }
  const rawParams = value.params;
  const geometry = normalizeGeometryNotation(value.geometry ?? (isSupportedGeometry(rawParams) ? rawParams : undefined));
  const shape = isRecord(rawParams) && SHAPES.includes(rawParams.shape as PrimitiveShape)
    ? rawParams.shape as PrimitiveShape : undefined;
  let kind: unknown = value.kind;
  if (isSupportedGeometry(geometry) && kind !== 'ground'
    && (kind !== 'primitive' || !shape)) {
    if (kind !== 'procedural') repairs.kindAliases += 1;
    kind = 'procedural';
  }
  if (kind !== 'ground' && kind !== 'primitive' && kind !== 'procedural' && shape) {
    kind = 'primitive';
    repairs.kindAliases += 1;
  }
  let params: unknown;
  if (kind === 'primitive') {
    params = shape ? { shape } : rawParams;
    if (isRecord(rawParams) && Object.keys(rawParams).some((key) => key !== 'shape')) repairs.extraFields += 1;
  } else if (kind === 'ground') {
    params = undefined;
    if (rawParams !== undefined) repairs.extraFields += 1;
  } else if (kind === 'procedural' && (rawParams == null || isSupportedGeometry(rawParams)
    || (isRecord(rawParams) && Object.keys(rawParams).every((key) => key === 'shape') && rawParams.shape === (isRecord(geometry) ? geometry.type : undefined)))) {
    params = undefined;
  } else {
    params = rawParams;
  }
  const material = repairMaterial(value.material, repairs);
  const tags = repairTags(value.tags, repairs);
  const originalName = cleanText(value.name, 100);
  const name = originalName ?? `Part ${index + 1}`;
  if (originalName !== value.name) repairs.textFixes += 1;
  const transform = repairTransform(value.transform, repairs);
  if (isRecord(value.transform) && Object.keys(value.transform).some((key) => !['position', 'rotation', 'scale'].includes(key))) {
    repairs.extraFields += 1;
  }
  return {
    name, kind, transform,
    ...(material !== undefined ? { material } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(geometry !== undefined ? { geometry } : {}),
    ...(value.collision != null ? { collision: value.collision } : {}),
  };
}

function repairEnvironment(value: unknown, repairs: WorldPlanRepairs): WorldEnvironment {
  const fallback = (): WorldEnvironment => {
    repairs.fallbackEnvironment = true;
    return { season: 'spring', weather: 'clear', timeOfDay: 'day', sunIntensity: 2, ambientIntensity: 0.6, fogDensity: 0.008 };
  };
  if (!isRecord(value)) return fallback();
  const allowed = ['season', 'weather', 'timeOfDay', 'sunIntensity', 'ambientIntensity', 'fogDensity'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) repairs.extraFields += 1;
  const pick = <T extends string>(raw: unknown, options: readonly T[], fallbackValue: T): T => {
    if (typeof raw === 'string' && options.includes(raw as T)) return raw as T;
    repairs.fallbackEnvironment = true;
    return fallbackValue;
  };
  const numeric = (raw: unknown, min: number, max: number, fallbackValue: number): number => {
    if (!finiteNumber(raw)) { repairs.fallbackEnvironment = true; return fallbackValue; }
    const fixed = clampNumber(raw, min, max);
    if (fixed !== raw) repairs.fallbackEnvironment = true;
    return fixed;
  };
  return {
    season: pick(value.season, ['spring', 'summer', 'autumn', 'winter'], 'spring'),
    weather: pick(value.weather, ['clear', 'cloudy', 'light-rain', 'heavy-rain', 'windy', 'snow'], 'clear'),
    timeOfDay: pick(value.timeOfDay, ['morning', 'day', 'dusk', 'night'], 'day'),
    sunIntensity: numeric(value.sunIntensity, 0, 10, 2),
    ambientIntensity: numeric(value.ambientIntensity, 0, 5, 0.6),
    fogDensity: numeric(value.fogDensity, 0, 0.2, 0.008),
  };
}

/** Invalid geometry is left untouched so the final strict check rejects it. */
function repairBounds(entry: unknown): ReturnType<typeof transformedBounds> | undefined {
  if (!isRecord(entry) || !transformValues(entry.transform)) return undefined;
  if (entry.kind === 'primitive' && (!isRecord(entry.params) || !SHAPES.includes(entry.params.shape as PrimitiveShape))) return undefined;
  if (entry.kind !== 'primitive' && entry.kind !== 'procedural') return undefined;
  try {
    const geometry = entry.kind === 'procedural' ? validateGeometry(entry.geometry) : undefined;
    return transformedBounds({ ...entry, geometry } as unknown as WorldObject, []);
  } catch { return undefined; }
}

function findSafeSpawn(
  objects: unknown[],
  ground: TransformValues,
  requestedX: number,
  requestedZ: number,
): [number, number] | undefined {
  const parts: Array<ReturnType<typeof transformedBounds>> = [];
  for (const entry of objects) {
    if (isRecord(entry) && entry.collision === 'none') continue;
    const bounds = repairBounds(entry);
    if (bounds) parts.push(bounds);
  }
  const blocked = (x: number, z: number) => parts.some(({ min, max }) => min[1] < 1.8 && max[1] > SPAWN_STEP_OVER_HEIGHT
    && x > min[0] - 0.6 && x < max[0] + 0.6 && z > min[2] - 0.6 && z < max[2] + 0.6);
  if (!blocked(requestedX, requestedZ)) {
    return [requestedX, requestedZ];
  }
  const [gx, , gz] = ground.position;
  const [width, , depth] = ground.scale;
  const minX = Math.max(-100, gx - width / 2 + 1);
  const maxX = Math.min(100, gx + width / 2 - 1);
  const minZ = Math.max(-100, gz - depth / 2 + 1);
  const maxZ = Math.min(100, gz + depth / 2 - 1);
  const step = 0.5;
  const stepsX = Math.floor((maxX - minX) / step + 1e-9);
  const stepsZ = Math.floor((maxZ - minZ) / step + 1e-9);
  let best: [number, number] | undefined;
  let bestDistance = Infinity;
  for (let ix = 0; ix <= stepsX; ix += 1) {
    const x = minX + ix * step;
    for (let iz = 0; iz <= stepsZ; iz += 1) {
      const z = minZ + iz * step;
      if (blocked(x, z)) continue;
      const distance = (x - requestedX) ** 2 + (z - requestedZ) ** 2;
      if (distance < bestDistance - 1e-9
        || (Math.abs(distance - bestDistance) <= 1e-9 && best && (x < best[0] || (x === best[0] && z < best[1])))) {
        best = [x, z];
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Repairs common, safely inferable model mistakes before strict validation.
 * It never invents unsupported geometry: shapes, kinds and values still pass the strict validator.
 */
export function repairWorldPlanDraft(raw: unknown, request: WorldPlanRequest): WorldPlanRepairResult {
  const repairs: WorldPlanRepairs = {
    extraFields: 0, kindAliases: 0, materialFixes: 0, textFixes: 0,
    scaleFixes: 0, positionFixes: 0, rotationFixes: 0, normalizedGround: false,
    shiftedParts: 0, liftedParts: 0, expandedGround: false, clampedSpawn: false, relocatedSpawn: false,
    trimmedObjects: 0, extraGrounds: 0, fallbackEnvironment: false,
  };
  if (!isRecord(raw)) return { draft: raw, repairs };
  if (Object.keys(raw).some((key) => !['title', 'summary', 'environment', 'objects', 'spawnPoint', 'render'].includes(key))) {
    repairs.extraFields += 1;
  }

  let objects: unknown = raw.objects;
  if (Array.isArray(raw.objects)) {
    let repairedObjects: unknown[] = raw.objects.map((entry, index) => repairObject(entry, index, repairs));
    if (repairedObjects.length > 120) {
      const ground = repairedObjects.find((entry) => isRecord(entry) && entry.kind === 'ground');
      const kept: unknown[] = ground ? [ground] : [];
      for (const entry of repairedObjects) {
        if (kept.length >= 120) break;
        if (entry === ground) continue;
        kept.push(entry);
      }
      repairs.trimmedObjects = repairedObjects.length - kept.length;
      repairedObjects = kept;
    }
    const firstGround = repairedObjects.find((entry) => isRecord(entry) && entry.kind === 'ground');
    if (firstGround) {
      repairedObjects = repairedObjects.filter((entry) => {
        if (entry === firstGround) return true;
        if (isRecord(entry) && entry.kind === 'ground') {
          repairs.extraGrounds += 1;
          return false;
        }
        return true;
      });
    }
    objects = repairedObjects;
  }

  const groundEntry = Array.isArray(objects)
    ? objects.find((entry) => isRecord(entry) && entry.kind === 'ground') : undefined;
  const originalGround = isRecord(groundEntry) ? transformValues(groundEntry.transform) : undefined;
  if (isRecord(groundEntry) && originalGround) {
    const normalized: TransformValues = {
      position: [originalGround.position[0], 0, originalGround.position[2]],
      rotation: [0, 0, 0],
      scale: [clampNumber(originalGround.scale[0], 10, 100), 1, clampNumber(originalGround.scale[2], 10, 100)],
    };
    if (JSON.stringify(originalGround) !== JSON.stringify(normalized)) repairs.normalizedGround = true;
    groundEntry.transform = normalized;
  }

  const groundDrop = originalGround?.position[1] ?? 0;
  if (Array.isArray(objects) && groundDrop !== 0) {
    for (const entry of objects) {
      if (!isRecord(entry) || entry.kind === 'ground') continue;
      const values = transformValues(entry.transform);
      if (!values || !isRecord(entry.transform)) continue;
      entry.transform.position = [values.position[0], values.position[1] - groundDrop, values.position[2]];
      repairs.shiftedParts += 1;
    }
  }

  if (Array.isArray(objects)) {
    // Lift connected assemblies together; an independent sunken rock must not lift
    // the whole scene, and a sunken base must not separate its roof or engine.
    const parts = objects.flatMap((entry) => {
      const bounds = repairBounds(entry);
      return bounds && isRecord(entry) ? [{ entry, bounds }] : [];
    });
    const visited = new Set<number>();
    for (let start = 0; start < parts.length; start++) {
      if (visited.has(start)) continue;
      const connected = [start];
      visited.add(start);
      for (let cursor = 0; cursor < connected.length; cursor++) {
        const a = parts[connected[cursor]!]!.bounds;
        for (let next = 0; next < parts.length; next++) {
          if (visited.has(next)) continue;
          const b = parts[next]!.bounds;
          if ([0, 1, 2].every((axis) => a.min[axis]! <= b.max[axis]! + 0.03 && a.max[axis]! >= b.min[axis]! - 0.03)) {
            visited.add(next); connected.push(next);
          }
        }
      }
      const lift = Math.max(0, ...connected.map((index) => -parts[index]!.bounds.min[1]));
      if (lift > 0) for (const index of connected) {
        const entry = parts[index]!.entry;
        const values = transformValues(entry.transform)!;
        (entry.transform as Record<string, unknown>).position = [values.position[0], values.position[1] + lift, values.position[2]];
        repairs.liftedParts += 1;
      }
    }
  }

  if (isRecord(groundEntry) && Array.isArray(objects)) {
    const base = transformValues(groundEntry.transform);
    if (base) {
      let width = base.scale[0];
      let depth = base.scale[2];
      for (const entry of objects) {
        const bounds = repairBounds(entry);
        if (!bounds) continue;
        width = Math.max(width, 2 * (Math.max(Math.abs(bounds.min[0] - base.position[0]), Math.abs(bounds.max[0] - base.position[0])) + 0.25));
        depth = Math.max(depth, 2 * (Math.max(Math.abs(bounds.min[2] - base.position[2]), Math.abs(bounds.max[2] - base.position[2])) + 0.25));
      }
      const fixedWidth = clampNumber(width, 10, 100);
      const fixedDepth = clampNumber(depth, 10, 100);
      if (fixedWidth !== base.scale[0] || fixedDepth !== base.scale[2]) {
        groundEntry.transform = { ...base, scale: [fixedWidth, 1, fixedDepth] };
        repairs.expandedGround = true;
      }
    }
  }

  let spawnPoint: unknown = raw.spawnPoint;
  if (isRecord(raw.spawnPoint)) {
    if (Object.keys(raw.spawnPoint).some((key) => !['position', 'yawDeg'].includes(key))) repairs.extraFields += 1;
    const requested = tuple3(raw.spawnPoint.position);
    const yaw = finiteNumber(raw.spawnPoint.yawDeg) ? clampNumber(raw.spawnPoint.yawDeg, -360, 360) : 0;
    if (yaw !== raw.spawnPoint.yawDeg) repairs.clampedSpawn = true;
    const groundNow = isRecord(groundEntry) ? transformValues(groundEntry.transform) : undefined;
    let position: Vec3;
    if (requested) {
      if (requested[1] !== 0) repairs.clampedSpawn = true;
      if (groundNow) {
        const minX = Math.max(-100, groundNow.position[0] - groundNow.scale[0] / 2 + 1);
        const maxX = Math.min(100, groundNow.position[0] + groundNow.scale[0] / 2 - 1);
        const minZ = Math.max(-100, groundNow.position[2] - groundNow.scale[2] / 2 + 1);
        const maxZ = Math.min(100, groundNow.position[2] + groundNow.scale[2] / 2 - 1);
        const x = clampNumber(requested[0], minX, maxX);
        const z = clampNumber(requested[2], minZ, maxZ);
        if (x !== requested[0] || z !== requested[2]) repairs.clampedSpawn = true;
        const safe = Array.isArray(objects) ? findSafeSpawn(objects, groundNow, x, z) : undefined;
        if (safe) {
          if (safe[0] !== x || safe[1] !== z) repairs.relocatedSpawn = true;
          position = [safe[0], 0, safe[1]];
        } else {
          position = [x, 0, z];
        }
      } else {
        position = [requested[0], 0, requested[2]];
      }
    } else {
      repairs.clampedSpawn = true;
      if (groundNow && Array.isArray(objects)) {
        const [gx, , gz] = groundNow.position;
        const fallbackZ = gz + groundNow.scale[2] / 2 - 2;
        const safe = findSafeSpawn(objects, groundNow, gx, fallbackZ);
        position = [safe?.[0] ?? gx, 0, safe?.[1] ?? fallbackZ];
        if (safe && (safe[0] !== gx || safe[1] !== fallbackZ)) repairs.relocatedSpawn = true;
      } else {
        position = [0, 0, 0];
      }
    }
    spawnPoint = { position, yawDeg: yaw };
  }

  const rawTitle = cleanText(raw.title, 160);
  const title = rawTitle ?? cleanText(request.prompt, 160) ?? 'AI generated scene';
  if (rawTitle !== raw.title) repairs.textFixes += 1;
  const rawSummary = cleanText(raw.summary, 2000);
  const summary = rawSummary ?? cleanText(request.analysis.sceneSummary, 2000)
    ?? cleanText(request.prompt, 2000) ?? 'AI generated scene';
  if (rawSummary !== raw.summary) repairs.textFixes += 1;
  const environment = repairEnvironment(raw.environment, repairs);
  return { draft: { title, summary, environment, objects, spawnPoint, ...(raw.render != null ? { render: normalizeRenderNotation(raw.render) } : {}) }, repairs };
}
