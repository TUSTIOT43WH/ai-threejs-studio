import { BadRequestException } from '@nestjs/common';
import { primitiveShape } from '../ai/world-plan-validation';
import { sceneResources, validateGeometry, validateRender } from '../ai/scene-capabilities';
import type {
  WorldEnvironment,
  WorldMaterial,
  WorldObject,
  WorldObjectKind,
  WorldSchema,
  Vec3,
} from '@ai-three-studio/shared';

const OBJECT_KINDS = new Set<WorldObjectKind>([
  'ground',
  'primitive',
  'procedural',
  'water',
  'hill',
  'path',
  'cabin',
  'house',
  'tower',
  'tent',
  'sign',
  'tree',
  'rock',
  'lamp',
  'campfire',
  'boat',
  'cloud',
]);

const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);
const WEATHERS = new Set([
  'clear',
  'cloudy',
  'light-rain',
  'heavy-rain',
  'windy',
  'snow',
]);
const TIMES = new Set(['morning', 'day', 'dusk', 'night']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new BadRequestException(message);
  }
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        typeof component === 'number' && Number.isFinite(component),
    )
  );
}

function readVec3(value: unknown, label: string): Vec3 {
  assert(isVec3(value), `${label} 必须是 3 个有限数字组成的数组`);
  assert(
    value.every((component) => Math.abs(component) <= 5000),
    `${label} 超出允许范围`,
  );
  return [value[0], value[1], value[2]];
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function optionalNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function sanitizeMaterial(raw: unknown): WorldMaterial | undefined {
  if (!isRecord(raw)) return undefined;
  const material: WorldMaterial = {};
  if (isHexColor(raw.color)) material.color = raw.color;
  if (isHexColor(raw.emissive)) material.emissive = raw.emissive;
  const roughness = optionalNumber(raw.roughness, 0, 1);
  if (roughness !== undefined) material.roughness = roughness;
  const metalness = optionalNumber(raw.metalness, 0, 1);
  if (metalness !== undefined) material.metalness = metalness;
  const opacity = optionalNumber(raw.opacity, 0, 1);
  if (opacity !== undefined) material.opacity = opacity;
  const emissiveIntensity = optionalNumber(raw.emissiveIntensity, 0, 10);
  if (emissiveIntensity !== undefined) {
    material.emissiveIntensity = emissiveIntensity;
  }
  if (typeof raw.flatShading === 'boolean') {
    material.flatShading = raw.flatShading;
  }
  return material;
}

function sanitizeParams(
  raw: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!isRecord(raw)) return undefined;
  const result: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 30) break;
    if (key.length > 60) continue;
    if (typeof value === 'string') {
      result[key] = value.slice(0, 200);
      count += 1;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
      count += 1;
    } else if (typeof value === 'boolean') {
      result[key] = value;
      count += 1;
    }
  }
  return result;
}

function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((tag): tag is string => typeof tag === 'string')
    .slice(0, 20)
    .map((tag) => tag.slice(0, 60));
}

function sanitizeEnvironment(raw: unknown): WorldEnvironment {
  assert(isRecord(raw), 'world.environment 缺失或格式错误');
  assert(
    typeof raw.season === 'string' && SEASONS.has(raw.season),
    'world.environment.season 无效',
  );
  assert(
    typeof raw.weather === 'string' && WEATHERS.has(raw.weather),
    'world.environment.weather 无效',
  );
  assert(
    typeof raw.timeOfDay === 'string' && TIMES.has(raw.timeOfDay),
    'world.environment.timeOfDay 无效',
  );
  const sunIntensity = optionalNumber(raw.sunIntensity, 0, 10);
  const ambientIntensity = optionalNumber(raw.ambientIntensity, 0, 5);
  const fogDensity = optionalNumber(raw.fogDensity, 0, 0.2);
  assert(
    sunIntensity !== undefined &&
      ambientIntensity !== undefined &&
      fogDensity !== undefined,
    'world.environment 数值字段无效',
  );
  return {
    season: raw.season as WorldEnvironment['season'],
    weather: raw.weather as WorldEnvironment['weather'],
    timeOfDay: raw.timeOfDay as WorldEnvironment['timeOfDay'],
    sunIntensity,
    ambientIntensity,
    fogDensity,
  };
}

/**
 * Validates a client-edited world and pins provenance fields to the server
 * record, so a saved payload can never overwrite the mock/live provenance.
 */
export function normalizeWorldForSave(
  raw: unknown,
  base: WorldSchema,
): WorldSchema {
  assert(isRecord(raw), 'world 必须是对象');
  assert(raw.schemaVersion === 1, 'world.schemaVersion 必须为 1');
  assert(
    typeof raw.title === 'string' &&
      raw.title.trim().length > 0 &&
      raw.title.length <= 160,
    'world.title 无效',
  );
  assert(
    typeof raw.summary === 'string' && raw.summary.length <= 2000,
    'world.summary 无效',
  );

  const environment = sanitizeEnvironment(raw.environment);
  assert(Array.isArray(raw.objects), 'world.objects 必须是数组');
  assert(
    raw.objects.length > 0 && raw.objects.length <= 200,
    'world.objects 数量必须在 1–200 之间',
  );

  const seenIds = new Set<string>();
  const baseObjects = new Map(base.objects.map((object) => [object.id, object]));
  const objects: WorldObject[] = raw.objects.map((item, index) => {
    assert(isRecord(item), `objects[${index}] 不是对象`);
    const { id, name, kind, transform } = item;
    assert(
      typeof id === 'string' && id.length > 0 && id.length <= 100,
      `objects[${index}].id 无效`,
    );
    assert(!seenIds.has(id), `对象 id 重复: ${id}`);
    seenIds.add(id);
    assert(
      typeof kind === 'string' && OBJECT_KINDS.has(kind as WorldObjectKind),
      `objects[${index}].kind 无效`,
    );
    assert(
      typeof name === 'string' && name.length > 0 && name.length <= 100,
      `objects[${index}].name 无效`,
    );
    assert(isRecord(transform), `objects[${index}].transform 无效`);
    const scale = readVec3(transform.scale, `objects[${index}].transform.scale`);
    assert(
      scale.every((component) => component > 0 && component <= 200),
      `objects[${index}].transform.scale 超出允许范围`,
    );
    const original = baseObjects.get(id);
    let geometry: WorldObject['geometry'];
    try {
      if (kind === 'procedural') geometry = validateGeometry(item.geometry);
      else assert(item.geometry === undefined, `objects[${index}].geometry 仅用于程序化几何`);
    } catch {
      throw new BadRequestException(`objects[${index}].geometry 无效`);
    }
    assert(item.collision === undefined || item.collision === 'solid' || item.collision === 'none', `objects[${index}].collision 无效`);
    const asset: WorldObject['asset'] = original?.kind === kind
      ? { ...original.asset }
      : {
          id: `saved.${id}.${kind}`,
          source: 'procedural',
          format: 'primitive-group',
          provider: 'studio-procedural-edit',
          mock: base.meta.mock,
        };
    const common = {
      id,
      name,
      asset,
      transform: {
        position: readVec3(
          transform.position,
          `objects[${index}].transform.position`,
        ),
        rotation: readVec3(
          transform.rotation,
          `objects[${index}].transform.rotation`,
        ),
        scale,
      },
      material: sanitizeMaterial(item.material),
      tags: sanitizeTags(item.tags),
      ...(geometry ? { geometry } : {}),
      ...(item.collision !== undefined ? { collision: item.collision as 'solid' | 'none' } : {}),
    };
    if (kind === 'primitive') {
      assert(isRecord(item.params), `objects[${index}].params.shape 缺失`);
      try {
        return { ...common, kind, params: { shape: primitiveShape(item.params.shape) } };
      } catch {
        throw new BadRequestException(`objects[${index}].params.shape 无效`);
      }
    }
    return { ...common, kind: kind as Exclude<WorldObjectKind, 'primitive'>, params: sanitizeParams(item.params) };
  });

  const spawnRaw = isRecord(raw.spawnPoint) ? raw.spawnPoint : null;
  let spawnPoint = base.spawnPoint;
  if (spawnRaw && isVec3(spawnRaw.position)) {
    const yaw =
      typeof spawnRaw.yawDeg === 'number' && Number.isFinite(spawnRaw.yawDeg)
        ? spawnRaw.yawDeg
        : base.spawnPoint.yawDeg;
    spawnPoint = {
      position: readVec3(spawnRaw.position, 'world.spawnPoint.position'),
      yawDeg: yaw,
    };
  }

  const now = new Date().toISOString();
  let render: WorldSchema['render'];
  try {
    render = validateRender(raw.render);
    sceneResources(objects, []);
  } catch {
    throw new BadRequestException('场景渲染配置无效或几何复杂度超过上限');
  }
  return {
    schemaVersion: 1,
    id: base.id,
    title: raw.title.trim(),
    summary: raw.summary,
    source: base.source,
    environment,
    objects,
    spawnPoint,
    gameplay: base.gameplay,
    ...(render ? { render } : {}),
    meta: {
      createdAt: base.meta.createdAt,
      updatedAt: now,
      editable: true,
      mock: base.meta.mock,
      objectCount: objects.length,
    },
  };
}
