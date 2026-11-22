import type { SceneAssetRequirement, SceneResource, Vec2, Vec3, WorldGeometry, WorldMaterial, WorldObject, WorldRenderSettings } from '@ai-three-studio/shared';
import { CatmullRomCurve3, Vector3 } from 'three';
import { atField } from './scene-field-error';

export function check(value: unknown): asserts value {
  if (!value) throw new Error('Invalid scene capability');
}
function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  check(Object.keys(value).every((key) => allowed.includes(key)));
}
function num(value: unknown, min: number, max: number, integer = false): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)));
  return value;
}
function vec(value: unknown, dimension: number, min = -100, max = 100): number[] {
  check(Array.isArray(value) && value.length === dimension);
  return value.map((item) => num(item, min, max));
}
function points(value: unknown, dimension: number, min: number, max: number): number[][] {
  check(Array.isArray(value) && value.length >= min && value.length <= max);
  return value.map((point, i) => atField(`[${i}]`, () => vec(point, dimension)));
}
function bool(value: unknown): boolean { check(typeof value === 'boolean'); return value; }
function color(value: unknown): string { check(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)); return value; }
function text(value: unknown, max: number): string { check(typeof value === 'string' && value.trim().length > 0 && value.length <= max); return value.trim(); }

function polygon(value: unknown): Vec2[] {
  const result = points(value, 2, 3, 128) as Vec2[];
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let area = 0;
  for (let i = 0; i < result.length; i++) {
    const a = result[i]!, b = result[(i + 1) % result.length]!;
    check(Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6);
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < result.length; j++) {
      if ((j + 1) % result.length === i) continue;
      const c = result[j]!, d = result[(j + 1) % result.length]!;
      check(!(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0));
    }
  }
  check(Math.abs(area) > 1e-8);
  return result;
}

export function validateGeometry(value: unknown): WorldGeometry {
  const g = record(value);
  switch (g.type) {
    case 'terrain': {
      keys(g, ['type', 'columns', 'rows', 'heights']);
      const columns = num(g.columns, 2, 65, true), rows = num(g.rows, 2, 65, true);
      check(Array.isArray(g.heights) && g.heights.length === columns * rows);
      return { type: g.type, columns, rows, heights: g.heights.map((height) => num(height, -1, 1)) };
    }
    case 'extrude': {
      keys(g, ['type', 'points', 'holes', 'depth', 'bevel']);
      check(g.holes === undefined || (Array.isArray(g.holes) && g.holes.length <= 8));
      const outline = atField('points', () => polygon(g.points));
      const holes = (g.holes as unknown[] | undefined)?.map((hole, i) => atField(`holes[${i}]`, () => polygon(hole)));
      const inside = (point: Vec2) => {
        let result = false;
        for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
          const a = outline[i]!, b = outline[j]!;
          if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
        }
        return result;
      };
      check(!holes || holes.every((hole) => hole.every(inside)));
      return { type: g.type, points: outline, ...(holes ? { holes } : {}), depth: num(g.depth, 0.001, 100), ...(g.bevel === undefined ? {} : { bevel: num(g.bevel, 0, 1) }) };
    }
    case 'lathe': {
      keys(g, ['type', 'points', 'segments']);
      const profile = atField('points', () => points(g.points, 2, 2, 128)) as Vec2[];
      check(profile.every(([radius]) => radius >= 0) && profile.some(([radius]) => radius > 0));
      return { type: g.type, points: profile, segments: num(g.segments, 3, 128, true) };
    }
    case 'tube':
    case 'ribbon': {
      keys(g, g.type === 'tube' ? ['type', 'points', 'radius', 'segments', 'radialSegments', 'closed'] : ['type', 'points', 'width', 'segments']);
      const path = atField('points', () => points(g.points, 3, 2, 128)) as Vec3[];
      check(path.slice(1).every((point, index) => point.some((entry, axis) => Math.abs(entry - path[index]![axis]!) > 1e-6 && (g.type === 'tube' || axis !== 1))));
      const segments = atField('segments', () => num(g.segments, 2, 512, true));
      if (g.type === 'ribbon') return { type: g.type, points: path, segments, width: num(g.width, 0.001, 100) };
      return { type: g.type, points: path, segments, radius: num(g.radius, 0.001, 100), radialSegments: num(g.radialSegments, 3, 64, true), ...(g.closed === undefined ? {} : { closed: bool(g.closed) }) };
    }
    case 'mesh': {
      keys(g, ['type', 'positions', 'indices', 'uvs']);
      check(Array.isArray(g.positions) && g.positions.length >= 9 && g.positions.length <= 150000 && g.positions.length % 3 === 0);
      const positions = g.positions.map((position) => num(position, -100, 100));
      check(Array.isArray(g.indices) && g.indices.length >= 3 && g.indices.length <= 900000 && g.indices.length % 3 === 0);
      const indices = g.indices.map((index) => num(index, 0, positions.length / 3 - 1, true));
      let uvs: number[] | undefined;
      if (g.uvs !== undefined) {
        check(Array.isArray(g.uvs) && g.uvs.length === positions.length / 3 * 2);
        uvs = g.uvs.map((uv) => num(uv, -1000, 1000));
      }
      return { type: g.type, positions, indices, ...(uvs ? { uvs } : {}) };
    }
    default: throw new Error('Unsupported geometry');
  }
}

export const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;
export function textureMaterial(raw: Record<string, unknown>, catalog: readonly SceneResource[]): Partial<WorldMaterial> {
  const result: Partial<WorldMaterial> = {};
  for (const slot of TEXTURE_SLOTS) {
    if (raw[slot] !== undefined) {
      const id = text(raw[slot], 100);
      check(catalog.some((asset) => asset.id === id && asset.kind === 'texture'));
      result[slot] = id;
    }
  }
  if (raw.repeat !== undefined) result.repeat = vec(raw.repeat, 2, 0.01, 100) as Vec2;
  if (raw.normalScale !== undefined) result.normalScale = num(raw.normalScale, 0, 10);
  return result;
}

export function validateRender(value: unknown): WorldRenderSettings | undefined {
  if (value === undefined) return undefined;
  const r = record(value);
  keys(r, ['camera', 'lights', 'ambientColor', 'shadowMapSize', 'sky', 'fog', 'exposure', 'bloom']);
  const result: WorldRenderSettings = {};
  if (r.camera !== undefined) {
    const c = atField('camera', () => record(r.camera));
    keys(c, ['projection', 'position', 'target', 'fov', 'zoom']);
    atField('camera.projection', () => check(c.projection === 'perspective' || c.projection === 'orthographic'));
    const position = atField('camera.position', () => vec(c.position, 3, -500, 500)) as Vec3;
    const target = atField('camera.target', () => vec(c.target, 3, -500, 500)) as Vec3;
    check(position.some((entry, i) => Math.abs(entry - target[i]!) > 0.001));
    result.camera = {
      projection: c.projection as 'perspective' | 'orthographic', position, target,
      fov: atField('camera.fov', () => num(c.fov === undefined ? 48 : c.fov, 10, 120)),
      zoom: atField('camera.zoom', () => num(c.zoom === undefined ? 1 : c.zoom, 0.1, 200)),
    };
  }
  if (r.lights !== undefined) {
    check(Array.isArray(r.lights) && r.lights.length <= 8);
    result.lights = r.lights.map((value, index) => atField(`lights[${index}]`, () => {
      const l = record(value);
      keys(l, ['type', 'color', 'intensity', 'position', 'target', 'castShadow', 'distance', 'angle', 'penumbra']);
      check(l.type === 'directional' || l.type === 'point' || l.type === 'spot');
      return {
        type: l.type, color: color(l.color), intensity: num(l.intensity, 0, 100), position: vec(l.position, 3, -500, 500) as Vec3,
        ...(l.target === undefined ? {} : { target: vec(l.target, 3, -500, 500) as Vec3 }),
        ...(l.castShadow === undefined ? {} : { castShadow: bool(l.castShadow) }),
        ...(l.distance === undefined ? {} : { distance: num(l.distance, 0, 1000) }),
        ...(l.angle === undefined ? {} : { angle: num(l.angle, 0.01, Math.PI / 2) }),
        ...(l.penumbra === undefined ? {} : { penumbra: num(l.penumbra, 0, 1) }),
      };
    }));
    check(result.lights.filter((light) => light.castShadow).length <= 2);
  }
  if (r.ambientColor !== undefined) result.ambientColor = color(r.ambientColor);
  if (r.shadowMapSize !== undefined) { check([512, 1024, 2048].includes(r.shadowMapSize as number)); result.shadowMapSize = r.shadowMapSize as 512 | 1024 | 2048; }
  if (r.sky !== undefined) { const sky = record(r.sky); keys(sky, ['topColor', 'bottomColor']); result.sky = { topColor: color(sky.topColor), bottomColor: color(sky.bottomColor) }; }
  if (r.fog !== undefined) { const fog = record(r.fog); keys(fog, ['color', 'density']); result.fog = { color: color(fog.color), density: num(fog.density, 0, 0.2) }; }
  if (r.exposure !== undefined) result.exposure = num(r.exposure, 0.1, 5);
  if (r.bloom !== undefined) { const b = record(r.bloom); keys(b, ['enabled', 'strength', 'radius', 'threshold']); result.bloom = { enabled: bool(b.enabled), strength: num(b.strength, 0, 3), radius: num(b.radius, 0, 1), threshold: num(b.threshold, 0, 10) }; }
  return result;
}

export function validateRequirements(value: unknown): SceneAssetRequirement[] | undefined {
  if (value === undefined) return undefined;
  check(Array.isArray(value) && value.length <= 100);
  return value.map((entry) => {
    const r = record(entry); keys(r, ['name', 'kind', 'description']);
    check(r.kind === 'model' || r.kind === 'texture');
    return { name: text(r.name, 100), kind: r.kind, description: text(r.description, 2000) };
  });
}

export function modelResource(id: unknown, catalog: readonly SceneResource[]): SceneResource {
  const resource = catalog.find((asset) => asset.id === id && asset.kind === 'model');
  check(resource?.bounds && resource.triangles !== undefined);
  return resource;
}

export function sceneResources(objects: WorldObject[], catalog: readonly SceneResource[]): SceneResource[] {
  const ids = new Set<string>();
  let triangles = 0;
  for (const object of objects) {
    for (const slot of TEXTURE_SLOTS) if (object.material?.[slot]) ids.add(object.material[slot]!);
    const g = object.geometry;
    if (object.kind === 'model') {
      const resource = modelResource(object.params?.assetId, catalog);
      ids.add(resource.id); triangles += resource.triangles!;
    } else if (g?.type === 'terrain') triangles += (g.columns - 1) * (g.rows - 1) * 2;
    else if (g?.type === 'tube') triangles += g.segments * g.radialSegments * 2;
    else if (g?.type === 'ribbon') triangles += g.segments * 2;
    else if (g?.type === 'lathe') triangles += (g.points.length - 1) * g.segments * 2;
    else if (g?.type === 'mesh') triangles += g.indices.length / 3;
    else if (g?.type === 'extrude') triangles += (g.points.length + (g.holes ?? []).reduce((total, hole) => total + hole.length, 0)) * (g.bevel ? 32 : 8);
    else if (object.kind === 'primitive') triangles += ({ box: 12, sphere: 960, cylinder: 128, cone: 96, torus: 768, plane: 2, capsule: 2048, icosahedron: 1280 })[object.params.shape];
    else triangles += object.kind === 'ground' ? 12 : 4096;
  }
  check(triangles <= 300000);
  const resources = [...ids].map((id) => { const resource = catalog.find((asset) => asset.id === id); check(resource); return structuredClone(resource); });
  check(resources.reduce((bytes, asset) => bytes + (asset.width ?? 0) * (asset.height ?? 0) * 4 * 4 / 3, 0) <= 256 * 1024 * 1024);
  return resources;
}

export function localBounds(object: WorldObject, catalog: readonly SceneResource[]): { min: Vec3; max: Vec3 } {
  let vertices: number[][] = [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], padding = 0;
  const g = object.geometry;
  if (object.kind === 'model') {
    const b = modelResource(object.params?.assetId, catalog).bounds!;
    const size = Math.max(...b.max.map((value, index) => value - b.min[index]!)); check(size > 0);
    const half = b.max.map((value, index) => (value - b.min[index]!) / size / 2) as Vec3;
    return { min: half.map((value) => -value) as Vec3, max: half };
  }
  if (object.kind === 'primitive' && object.params.shape === 'plane') vertices = [[-0.5, -0.5, -0.005], [0.5, 0.5, 0.005]];
  if (g?.type === 'terrain') vertices = [[-0.5, Math.min(...g.heights), -0.5], [0.5, Math.max(...g.heights), 0.5]];
  if (g?.type === 'extrude') { vertices = g.points.flatMap(([x, y]) => [[x, y, 0], [x, y, g.depth]]); padding = g.bevel ?? 0; }
  if (g?.type === 'lathe') vertices = g.points.flatMap(([r, y]) => [[-r, y, -r], [r, y, r]]);
  if (g?.type === 'tube' || g?.type === 'ribbon') {
    const curve = new CatmullRomCurve3(g.points.map((p) => new Vector3(...p)), g.type === 'tube' && (g.closed ?? false), 'centripetal');
    // Match the renderer's actual sampling, including interpolation overshoot.
    // TubeGeometry uses arc-length sampling; ribbons use parametric sampling.
    vertices = Array.from({ length: g.segments + 1 }, (_, i) =>
      (g.type === 'tube' ? curve.getPointAt(i / g.segments) : curve.getPoint(i / g.segments)).toArray());
    padding = g.type === 'tube' ? g.radius : g.width / 2;
  }
  if (g?.type === 'mesh') vertices = Array.from({ length: g.positions.length / 3 }, (_, index) => g.positions.slice(index * 3, index * 3 + 3));
  const min = [0, 1, 2].map((axis) => vertices.reduce((value, vertex) => Math.min(value, vertex[axis]!), Infinity)) as Vec3;
  const max = [0, 1, 2].map((axis) => vertices.reduce((value, vertex) => Math.max(value, vertex[axis]!), -Infinity)) as Vec3;
  for (let axis = 0; axis < 3; axis++) {
    const margin = g?.type === 'ribbon' && axis === 1 ? 0 : padding;
    min[axis] -= margin; max[axis] += margin;
  }
  return { min, max };
}

export function transformedBounds(object: WorldObject, catalog: readonly SceneResource[]): { min: Vec3; max: Vec3 } {
  const bounds = localBounds(object, catalog), t = object.transform;
  const [x, y, z] = t.rotation;
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const rows = [[c * e, -c * f, d], [a * f + b * e * d, a * e - b * f * d, -b * c], [b * f - a * e * d, b * e + a * f * d, a * c]];
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2 * t.scale[axis]!);
  const half = bounds.min.map((value, axis) => (bounds.max[axis]! - value) / 2 * t.scale[axis]!);
  const rotatedCenter = rows.map((row, axis) => t.position[axis]! + row.reduce((sum, entry, i) => sum + entry * center[i]!, 0));
  const rotatedHalf = rows.map((row) => row.reduce((sum, entry, i) => sum + Math.abs(entry) * half[i]!, 0));
  return { min: rotatedCenter.map((value, i) => value - rotatedHalf[i]!) as Vec3, max: rotatedCenter.map((value, i) => value + rotatedHalf[i]!) as Vec3 };
}

export function surfaceHeight(surface: WorldObject, x: number, z: number): number {
  const g = surface.geometry;
  if (g?.type !== 'terrain') return 0;
  const p = surface.transform.position, s = surface.transform.scale;
  const u = ((x - p[0]) / s[0] + 0.5) * (g.columns - 1), v = ((z - p[2]) / s[2] + 0.5) * (g.rows - 1);
  check(u >= 0 && u <= g.columns - 1 && v >= 0 && v <= g.rows - 1);
  const col = Math.min(Math.floor(u), g.columns - 2), row = Math.min(Math.floor(v), g.rows - 2), a = u - col, b = v - row;
  const h00 = g.heights[row * g.columns + col]!, h10 = g.heights[row * g.columns + col + 1]!;
  const h01 = g.heights[(row + 1) * g.columns + col]!, h11 = g.heights[(row + 1) * g.columns + col + 1]!;
  return p[1] + s[1] * (a + b <= 1 ? h00 + a * (h10 - h00) + b * (h01 - h00) : h11 + (1 - a) * (h01 - h11) + (1 - b) * (h10 - h11));
}

export function validateLayout(objects: WorldObject[], spawn: Vec3, catalog: readonly SceneResource[]): void {
  const surfaces = objects.filter((object) => object.kind === 'ground' || object.geometry?.type === 'terrain');
  check(surfaces.length === 1 && objects.length > 1);
  const surface = surfaces[0]!, t = surface.transform;
  check(t.rotation.every((angle) => angle === 0) && t.scale[0] >= 10 && t.scale[2] >= 10 && surface.collision !== 'none');
  check(surface.kind !== 'ground' || (t.position[1] === 0 && t.scale[1] === 1));
  const [sx, sy, sz] = spawn;
  check(Math.abs(sx - t.position[0]) <= t.scale[0] / 2 - 1 && Math.abs(sz - t.position[2]) <= t.scale[2] / 2 - 1);
  check(Math.abs(sy - surfaceHeight(surface, sx, sz)) <= 0.05);
  for (const part of objects) {
    if (part === surface) continue;
    const b = transformedBounds(part, catalog);
    check(b.min[0] >= t.position[0] - t.scale[0] / 2 + 0.25 && b.max[0] <= t.position[0] + t.scale[0] / 2 - 0.25);
    check(b.min[2] >= t.position[2] - t.scale[2] / 2 + 0.25 && b.max[2] <= t.position[2] + t.scale[2] / 2 - 0.25);
    if (surface.kind === 'ground') check(b.min[1] >= -0.05);
    if (part.collision !== 'none') check(!(b.min[1] < sy + 1.8 && b.max[1] > sy && sx > b.min[0] - 0.6 && sx < b.max[0] + 0.6 && sz > b.min[2] - 0.6 && sz < b.max[2] + 0.6));
  }
}
