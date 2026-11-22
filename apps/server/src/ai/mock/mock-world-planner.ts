import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  WorldEnvironment,
  WorldObject,
  WorldObjectKind,
  WorldPlanRequest,
  WorldPlannerProvider,
  WorldSchema,
  Vec3,
  ProviderInfo,
  SpawnPoint,
} from '@ai-three-studio/shared';
import type { ConceptPalette, ConceptStyleDefinition } from './concept-styles';
import { getConceptStyle } from './concept-styles';
import {
  detectSceneProfile,
  SEASON_LABELS,
  TIME_LABELS,
  WEATHER_LABELS,
  type SceneProfileDefinition,
} from './scene-profiles';

type Rand = () => number;

interface LayoutDraft {
  objects: WorldObject[];
  spawnPoint: SpawnPoint;
}

interface CreateObjectOptions {
  rotation?: Vec3;
  scale?: Vec3;
  material?: WorldObject['material'];
  params?: Record<string, string | number | boolean>;
  tags?: string[];
  variant?: string;
}

interface Segment {
  x: number;
  z: number;
}

function createRng(seed: number): Rand {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function range(rand: Rand, min: number, max: number): number {
  return min + rand() * (max - min);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function p3(x: number, y: number, z: number): Vec3 {
  return [round1(x), round1(y), round1(z)];
}

function makeLabeller(): (base: string) => string {
  const counts = new Map<string, number>();
  return (base: string) => {
    const next = (counts.get(base) ?? 0) + 1;
    counts.set(base, next);
    return `${base} ${String(next).padStart(2, '0')}`;
  };
}

class WorldObjectFactory {
  private counter = 0;

  create(
    kind: Exclude<WorldObjectKind, 'primitive'>,
    name: string,
    position: Vec3,
    options: CreateObjectOptions = {},
  ): WorldObject {
    this.counter += 1;
    const variant = options.variant ?? 'default';
    return {
      id: `${kind}-${String(this.counter).padStart(2, '0')}`,
      name,
      kind,
      asset: {
        id: `procedural.${kind}.${variant}`,
        source: 'procedural',
        format: 'primitive-group',
        provider: 'mock-world-planner',
        mock: true,
      },
      transform: {
        position,
        rotation: options.rotation ?? [0, 0, 0],
        scale: options.scale ?? [1, 1, 1],
      },
      material: options.material,
      params: { variant, ...(options.params ?? {}) },
      tags: options.tags ?? [],
    };
  }
}

function createGround(
  factory: WorldObjectFactory,
  variant: 'grass' | 'sand' | 'snow' | 'asphalt',
  color: string,
  seasonal: boolean,
): WorldObject {
  return factory.create('ground', '地面', p3(0, 0, 0), {
    scale: [62, 1, 62],
    material: { color, roughness: 0.96, metalness: 0 },
    params: { variant, seasonal },
    tags: ['terrain', 'seasonal-ground'],
  });
}

function addHills(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  count: number,
): WorldObject[] {
  const objects: WorldObject[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = range(rand, Math.PI * 1.05, Math.PI * 1.95);
    const radius = range(rand, 26, 42);
    objects.push(
      factory.create('hill', label('远山'), p3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), {
        rotation: [0, range(rand, 0, Math.PI), 0],
        scale: [range(rand, 14, 28), range(rand, 5, 12), range(rand, 12, 20)],
        material: { color: palette.mountainFar, roughness: 1, flatShading: true },
        params: { seed: Math.floor(rand() * 10000) },
        tags: ['terrain', 'background'],
      }),
    );
  }
  return objects;
}

function addClouds(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  count: number,
): WorldObject[] {
  const objects: WorldObject[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = range(rand, 2.2, 4.2);
    objects.push(
      factory.create('cloud', label('云层'), p3(range(rand, -28, 28), range(rand, 13, 20), range(rand, -28, -6)), {
        rotation: [0, range(rand, 0, Math.PI), 0],
        scale: [size, size * range(rand, 0.45, 0.65), size],
        material: { color: palette.cloud, roughness: 1, opacity: 0.8 },
        params: { seed: Math.floor(rand() * 10000) },
        tags: ['sky'],
      }),
    );
  }
  return objects;
}

function addPine(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  x: number,
  z: number,
  scale = range(rand, 0.9, 1.55),
): WorldObject {
  return factory.create('tree', label('松树'), p3(x, 0, z), {
    rotation: [0, range(rand, 0, Math.PI * 2), 0],
    scale: [scale, scale * range(rand, 0.95, 1.25), scale],
    material: { color: palette.foliage, roughness: 0.92 },
    params: { variant: 'pine', seed: Math.floor(rand() * 10000) },
    tags: ['vegetation', 'seasonal'],
  });
}

function addBroadleaf(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  x: number,
  z: number,
  scale = range(rand, 0.85, 1.35),
): WorldObject {
  return factory.create('tree', label('阔叶树'), p3(x, 0, z), {
    rotation: [0, range(rand, 0, Math.PI * 2), 0],
    scale: [scale, scale * range(rand, 1.0, 1.35), scale],
    material: { color: palette.foliage, roughness: 0.92 },
    params: { variant: 'broadleaf', seed: Math.floor(rand() * 10000) },
    tags: ['vegetation', 'seasonal'],
  });
}

function addRocks(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  count: number,
  area: { minX: number; maxX: number; minZ: number; maxZ: number },
): WorldObject[] {
  const objects: WorldObject[] = [];
  for (let i = 0; i < count; i += 1) {
    const scale = range(rand, 0.5, 1.4);
    objects.push(
      factory.create('rock', label('岩石'), p3(range(rand, area.minX, area.maxX), 0, range(rand, area.minZ, area.maxZ)), {
        rotation: [0, range(rand, 0, Math.PI * 2), 0],
        scale: [scale * range(rand, 0.8, 1.4), scale, scale * range(rand, 0.8, 1.4)],
        material: { color: palette.mountainNear, roughness: 0.95, flatShading: true },
        params: { seed: Math.floor(rand() * 10000) },
        tags: ['nature'],
      }),
    );
  }
  return objects;
}

function createPath(
  factory: WorldObjectFactory,
  variant: 'stepping-stones' | 'road' | 'planks',
  position: Vec3,
  palette: ConceptPalette,
  rotationY = 0,
): WorldObject {
  return factory.create('path', variant === 'road' ? '街道路面' : variant === 'planks' ? '海岸栈道' : '碎石小径', position, {
    rotation: [0, rotationY, 0],
    material: {
      color: variant === 'planks' ? palette.wall : palette.haze,
      roughness: 0.9,
      emissive: variant === 'road' ? palette.accent : undefined,
      emissiveIntensity: variant === 'road' ? 0.35 : undefined,
    },
    params: { variant, seed: 7 },
    tags: ['navigation'],
  });
}

function createWater(
  factory: WorldObjectFactory,
  position: Vec3,
  scale: Vec3,
  palette: ConceptPalette,
  frozen = false,
): WorldObject {
  return factory.create('water', frozen ? '冰封湖面' : '水面', position, {
    scale,
    material: {
      color: frozen ? palette.snow : palette.water,
      roughness: frozen ? 0.45 : 0.15,
      metalness: frozen ? 0.05 : 0.25,
      opacity: 0.88,
    },
    params: { frozen },
    tags: ['water'],
  });
}

function createLamp(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  x: number,
  z: number,
): WorldObject {
  return factory.create('lamp', label('路灯'), p3(x, 0, z), {
    rotation: [0, range(rand, 0, Math.PI * 2), 0],
    material: { color: palette.trunk, roughness: 0.6, metalness: 0.4 },
    params: { seed: Math.floor(rand() * 10000) },
    tags: ['structure', 'light'],
  });
}

function createCabin(
  factory: WorldObjectFactory,
  palette: ConceptPalette,
  x: number,
  z: number,
  scale: number,
  rotationY = 0,
): WorldObject {
  return factory.create('cabin', '林间木屋', p3(x, 0, z), {
    rotation: [0, rotationY, 0],
    scale: [scale, scale, scale],
    material: { color: palette.wall, roughness: 0.85 },
    params: { lit: true },
    tags: ['structure', 'hero'],
  });
}

function addLamps(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  positions: Array<[number, number]>,
): WorldObject[] {
  return positions.map(([x, z]) => createLamp(factory, label, rand, palette, x, z));
}

function addBoundaryRocks(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  count: number,
): WorldObject[] {
  return addRocks(factory, label, rand, palette, count, {
    minX: -22,
    maxX: 22,
    minZ: -16,
    maxZ: 12,
  });
}

function isNear(x: number, z: number, cx: number, cz: number, radius: number): boolean {
  return Math.hypot(x - cx, z - cz) < radius;
}

function scatter(
  rand: Rand,
  count: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  isBlocked: (x: number, z: number) => boolean,
): Segment[] {
  const results: Segment[] = [];
  let attempts = 0;
  while (results.length < count && attempts < 400) {
    attempts += 1;
    const x = range(rand, bounds.minX, bounds.maxX);
    const z = range(rand, bounds.minZ, bounds.maxZ);
    if (isBlocked(x, z)) continue;
    if (results.some((entry) => isNear(x, z, entry.x, entry.z, 1.8))) continue;
    results.push({ x, z });
  }
  return results;
}

function buildForest(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
): LayoutDraft {
  const objects: WorldObject[] = [
    createGround(factory, 'grass', palette.ground, true),
    ...addHills(factory, label, rand, palette, 3),
    createWater(factory, p3(-11, 0.02, 5.5), [6, 1, 4.2], palette),
    createCabin(factory, palette, 0.4, 0.5, 1.08, 0.16),
    createPath(factory, 'stepping-stones', p3(1.5, 0.03, 2.2), palette, 0.05),
  ];

  const trees = scatter(
    rand,
    11,
    { minX: -20, maxX: 20, minZ: -18, maxZ: 12 },
    (x, z) =>
      isNear(x, z, 0.4, 0.5, 4.6) ||
      (Math.abs(x - 1.5) < 2.6 && z > 1.5 && z < 9) ||
      (x < -4.5 && x > -18 && z > 1 && z < 10),
  );
  for (const tree of trees) {
    objects.push(addPine(factory, label, rand, palette, tree.x, tree.z));
  }
  objects.push(
    addBroadleaf(factory, label, rand, palette, 6.4, -1.6, 1.1),
    addBroadleaf(factory, label, rand, palette, -6.8, -3.4, 0.95),
  );
  objects.push(...addBoundaryRocks(factory, label, rand, palette, 5));
  objects.push(
    ...addLamps(factory, label, rand, palette, [
      [2.8, 2.9],
      [-2.4, 2.6],
    ]),
    ...addClouds(factory, label, rand, palette, 3),
  );

  return {
    objects,
    spawnPoint: { position: [0, 0, 11], yawDeg: 180 },
  };
}

function buildCity(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
): LayoutDraft {
  const objects: WorldObject[] = [
    createGround(factory, 'asphalt', '#141821', false),
    ...addHills(factory, label, rand, palette, 2),
    createPath(factory, 'road', p3(0, 0.03, 0), palette),
  ];

  const towerPositions: Array<[number, number]> = [];
  for (let i = 0; i < 9; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * range(rand, 5.5, 17);
    const z = range(rand, -14, 8);
    towerPositions.push([x, z]);
    const height = range(rand, 8, 22);
    objects.push(
      factory.create('tower', label('霓虹塔楼'), p3(x, 0, z), {
        rotation: [0, range(rand, -0.12, 0.12), 0],
        scale: [range(rand, 1.1, 1.9), 1, range(rand, 1.1, 1.9)],
        material: {
          color: i % 3 === 0 ? palette.mountainNear : palette.ink,
          roughness: 0.38,
          metalness: 0.55,
        },
        params: {
          height: round1(height),
          neon: i % 3,
          seed: Math.floor(rand() * 10000),
        },
        tags: ['urban', 'structure'],
      }),
    );
  }

  const signs: Array<[number, number, number]> = [
    [-4.8, -1.5, 0],
    [5.6, -5.5, 1],
    [-7.2, 4.5, 2],
  ];
  for (const [x, z, neon] of signs) {
    objects.push(
      factory.create('sign', label('霓虹招牌'), p3(x, 2.2, z), {
        rotation: [0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0],
        material: {
          color: palette.ink,
          emissive: neon === 0 ? palette.neonA : palette.neonB ?? palette.accent,
          emissiveIntensity: 2.2,
          roughness: 0.4,
        },
        params: { neon, height: round1(range(rand, 2.8, 4.4)) },
        tags: ['urban', 'light'],
      }),
    );
  }

  objects.push(
    ...addLamps(factory, label, rand, palette, [
      [-3.6, 4],
      [3.8, 2.4],
      [-6.5, -7],
      [7.2, -9],
    ]),
    ...addClouds(factory, label, rand, palette, 3),
  );

  return {
    objects,
    spawnPoint: { position: [towerPositions[0]?.[0] ?? 0, 0, 13], yawDeg: 210 },
  };
}

function buildSeaside(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
  includeLighthouse: boolean,
): LayoutDraft {
  const objects: WorldObject[] = [
    createGround(factory, 'sand', palette.haze, true),
    ...addHills(factory, label, rand, palette, 2),
    createWater(factory, p3(0, 0.02, -16), [54, 1, 32], palette),
    createPath(factory, 'planks', p3(0, 0.04, 4.6), palette),
  ];

  const houseColors = [palette.wall, palette.cloud, palette.accent, palette.haze];
  const houseSpots: Array<[number, number, number]> = [
    [-11.5, 2.5, 0.85],
    [-4.5, 6.2, 0.7],
    [4.8, 3.4, 0.9],
    [12.4, 7.2, 0.75],
  ];
  houseSpots.forEach(([x, z, scale], index) => {
    objects.push(
      factory.create('house', label('海边小屋'), p3(x, 0, z), {
        rotation: [0, index % 2 === 0 ? 0.2 : -0.3, 0],
        scale: [scale, scale, scale],
        material: { color: houseColors[index % houseColors.length], roughness: 0.85 },
        params: { lit: true, roof: index % 2 === 0 ? palette.roof : palette.accent },
        tags: ['structure', 'seaside'],
      }),
    );
  });

  const palmSpots: Array<[number, number]> = [
    [-8, -0.5],
    [8.6, 0.8],
    [15.5, 4],
    [-14.5, 6],
  ];
  for (const [x, z] of palmSpots) {
    objects.push(
      factory.create('tree', label('棕榈树'), p3(x, 0, z), {
        rotation: [0, range(rand, 0, Math.PI * 2), 0],
        scale: [range(rand, 0.9, 1.25), range(rand, 1.0, 1.3), range(rand, 0.9, 1.25)],
        material: { color: palette.foliage, roughness: 0.9 },
        params: { variant: 'palm', seed: Math.floor(rand() * 10000) },
        tags: ['vegetation', 'seasonal'],
      }),
    );
  }

  objects.push(
    factory.create('boat', label('帆船'), p3(-5, 0.02, -11), {
      rotation: [0, 0.2, 0],
      scale: [1.2, 1.2, 1.2],
      material: { color: palette.trunk, roughness: 0.8 },
      params: { sail: true },
      tags: ['boat'],
    }),
    factory.create('boat', label('帆船'), p3(8, 0.02, -17), {
      rotation: [0, -0.35, 0],
      scale: [0.9, 0.9, 0.9],
      material: { color: palette.trunk, roughness: 0.8 },
      params: { sail: true },
      tags: ['boat'],
    }),
  );

  if (includeLighthouse) {
    objects.push(
      factory.create('tower', '白色灯塔', p3(-15, 0, 0.5), {
        variant: 'lighthouse',
        scale: [1.1, 1.1, 1.1],
        material: { color: '#eef2ee', roughness: 0.7, metalness: 0.05 },
        params: { height: 8.5, lit: true },
        tags: ['structure', 'seaside', 'landmark'],
      }),
    );
  }

  objects.push(
    ...addBoundaryRocks(factory, label, rand, palette, 4),
    ...addLamps(factory, label, rand, palette, [
      [-6, 5],
      [6.5, 5.8],
    ]),
    ...addClouds(factory, label, rand, palette, 3),
  );

  return {
    objects,
    spawnPoint: { position: [0, 0, 13], yawDeg: 180 },
  };
}

function buildSnowCamp(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
): LayoutDraft {
  const objects: WorldObject[] = [
    createGround(factory, 'snow', palette.snow, true),
    ...addHills(factory, label, rand, palette, 3),
    createWater(factory, p3(-10, 0.02, -5), [4.8, 1, 3.4], palette, true),
    factory.create('campfire', '营地篝火', p3(0, 0.02, 0), {
      scale: [1, 1, 1],
      params: { seed: 11 },
      tags: ['heat', 'hero'],
    }),
  ];

  const tents: Array<[number, number, number]> = [
    [-4.2, -0.8, 0.9],
    [4.4, 1.4, 0.8],
    [0.6, -5.2, 0.7],
  ];
  tents.forEach(([x, z, scale], index) => {
    objects.push(
      factory.create('tent', label('营地帐篷'), p3(x, 0, z), {
        rotation: [0, index * 1.4, 0],
        scale: [scale, scale, scale],
        material: {
          color: index === 0 ? palette.accent : index === 1 ? palette.wall : palette.haze,
          roughness: 0.85,
        },
        params: { lit: true },
        tags: ['structure', 'camp'],
      }),
    );
  });

  const pineSpots = scatter(
    rand,
    10,
    { minX: -20, maxX: 20, minZ: -18, maxZ: 12 },
    (x, z) =>
      isNear(x, z, 0, 0, 5.2) ||
      tents.some(([tx, tz]) => isNear(x, z, tx, tz, 2.8)) ||
      (x < -4 && x > -16 && z < 0 && z > -10),
  );
  for (const pine of pineSpots) {
    objects.push(addPine(factory, label, rand, palette, pine.x, pine.z, range(rand, 1.0, 1.6)));
  }

  objects.push(
    ...addBoundaryRocks(factory, label, rand, palette, 5),
    ...addLamps(factory, label, rand, palette, [[-2.8, 4.6]]),
    ...addClouds(factory, label, rand, palette, 2),
  );

  return {
    objects,
    spawnPoint: { position: [0, 0, 10], yawDeg: 180 },
  };
}

function buildMeadow(
  factory: WorldObjectFactory,
  label: (base: string) => string,
  rand: Rand,
  palette: ConceptPalette,
): LayoutDraft {
  const objects: WorldObject[] = [
    createGround(factory, 'grass', palette.ground, true),
    ...addHills(factory, label, rand, palette, 3),
    createCabin(factory, palette, -1.5, -3, 0.95, 0.3),
    createPath(factory, 'stepping-stones', p3(0.2, 0.03, 1), palette, -0.15),
  ];

  const treeSpots = scatter(
    rand,
    7,
    { minX: -20, maxX: 20, minZ: -16, maxZ: 10 },
    (x, z) => isNear(x, z, -1.5, -3, 4.4) || (Math.abs(x) < 3 && z > 0 && z < 8),
  );
  for (const spot of treeSpots) {
    objects.push(addBroadleaf(factory, label, rand, palette, spot.x, spot.z));
  }
  objects.push(
    addPine(factory, label, rand, palette, 10, -6, 1.2),
    addPine(factory, label, rand, palette, -12, -8, 1.05),
    ...addBoundaryRocks(factory, label, rand, palette, 4),
    ...addLamps(factory, label, rand, palette, [
      [2.4, 1.8],
      [-4.5, 0.5],
    ]),
    ...addClouds(factory, label, rand, palette, 3),
  );

  return {
    objects,
    spawnPoint: { position: [0, 0, 12], yawDeg: 180 },
  };
}

function resolveEnvironment(
  profile: SceneProfileDefinition,
  style: ConceptStyleDefinition,
  hints: WorldPlanRequest['expansion']['environmentHints'],
): WorldEnvironment {
  const weather = hints.weather ?? profile.defaultEnvironment.weather;
  const season =
    hints.season ??
    (!hints.season && weather === 'snow'
      ? 'winter'
      : profile.defaultEnvironment.season);
  const timeOfDay =
    hints.timeOfDay ??
    (profile.id === 'cyberpunk-city' && style.id === 'neon-noir'
      ? 'night'
      : style.timeHint);

  const baseSun: Record<string, number> = {
    morning: 2.1,
    day: 2.9,
    dusk: 1.7,
    night: 0.4,
  };
  const baseAmbient: Record<string, number> = {
    morning: 0.55,
    day: 0.65,
    dusk: 0.45,
    night: 0.26,
  };
  const weatherFog: Record<string, number> = {
    clear: 0.007,
    cloudy: 0.011,
    'light-rain': 0.017,
    'heavy-rain': 0.024,
    windy: 0.01,
    snow: 0.02,
  };
  const weatherSunFactor: Record<string, number> = {
    clear: 1,
    cloudy: 0.55,
    'light-rain': 0.35,
    'heavy-rain': 0.2,
    windy: 0.9,
    snow: 0.45,
  };
  const weatherAmbientBonus: Record<string, number> = {
    clear: 0,
    cloudy: 0.06,
    'light-rain': 0.04,
    'heavy-rain': 0.02,
    windy: 0,
    snow: 0.12,
  };

  return {
    season,
    weather,
    timeOfDay,
    sunIntensity: round1(
      (baseSun[timeOfDay] ?? 2.6) * (weatherSunFactor[weather] ?? 1),
    ),
    ambientIntensity: round1(
      (baseAmbient[timeOfDay] ?? 0.6) + (weatherAmbientBonus[weather] ?? 0),
    ),
    fogDensity: round1((weatherFog[weather] ?? 0.008) * 10000) / 10000,
  };
}

@Injectable()
export class MockWorldPlanner implements WorldPlannerProvider {
  readonly info: ProviderInfo = {
    id: 'mock-world-planner',
    displayName: 'Mock World Planner',
    kind: 'world-planner',
    mode: 'mock',
    description:
      'Turns concept metadata into an editable World Schema assembled from procedural primitive groups. Not a real image-to-3D pipeline.',
  };

  async plan(request: WorldPlanRequest): Promise<WorldSchema> {
    const profile = detectSceneProfile(request.prompt);
    const style = getConceptStyle(request.concept.styleId);
    const palette = style.palettes[0] as ConceptPalette;
    const rand = createRng(request.concept.seed ^ 0x5f3759df);
    const factory = new WorldObjectFactory();
    const label = makeLabeller();

    let draft: LayoutDraft;
    switch (profile.id) {
      case 'forest-cabin':
        draft = buildForest(factory, label, rand, palette);
        break;
      case 'cyberpunk-city':
        draft = buildCity(factory, label, rand, palette);
        break;
      case 'seaside-town':
        draft = buildSeaside(
          factory,
          label,
          rand,
          palette,
          /灯塔|lighthouse/i.test(request.prompt),
        );
        break;
      case 'snow-camp':
        draft = buildSnowCamp(factory, label, rand, palette);
        break;
      default:
        draft = buildMeadow(factory, label, rand, palette);
        break;
    }

    const environment = resolveEnvironment(
      profile,
      style,
      request.expansion.environmentHints,
    );
    const now = new Date().toISOString();
    const summary =
      `${request.concept.description} 世界环境预设：${SEASON_LABELS[environment.season]} · ` +
      `${WEATHER_LABELS[environment.weather]} · ${TIME_LABELS[environment.timeOfDay]}。`;

    return {
      schemaVersion: 1,
      id: `world-${randomUUID()}`,
      title: `${style.titlePrefix} · ${profile.sceneLabel}`,
      summary,
      source: {
        prompt: request.prompt,
        conceptId: request.concept.id,
        conceptTitle: request.concept.title,
        conceptStyleId: request.concept.styleId,
        provider: {
          name: 'Phase 1 Mock Pipeline',
          mode: 'mock',
          vision: request.analysis.provider,
          planner: this.info.id,
        },
        generatedAt: now,
        disclaimer:
          'Phase 1 Mock 世界：所有对象均为可独立编辑的程序化占位几何体，由本地规则规划，不是真实图像理解或图生 3D 模型的产出。',
      },
      environment,
      objects: draft.objects,
      spawnPoint: draft.spawnPoint,
      gameplay: {
        mode: 'explore',
        notes: '支持程序化角色、WASD 移动、奔跑跳跃、静态碰撞与第三人称跟随漫游；水体暂不支持游泳。',
      },
      meta: {
        createdAt: now,
        updatedAt: now,
        editable: true,
        mock: true,
        objectCount: draft.objects.length,
      },
    };
  }
}
