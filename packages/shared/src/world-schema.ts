export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type WorldGeometry =
  | { type: 'terrain'; columns: number; rows: number; heights: number[] }
  | { type: 'extrude'; points: Vec2[]; holes?: Vec2[][]; depth: number; bevel?: number }
  | { type: 'lathe'; points: Vec2[]; segments: number }
  | { type: 'tube'; points: Vec3[]; radius: number; segments: number; radialSegments: number; closed?: boolean }
  | { type: 'ribbon'; points: Vec3[]; width: number; segments: number }
  | { type: 'mesh'; positions: number[]; indices: number[]; uvs?: number[] };

export interface SceneResource {
  id: string;
  kind: 'model' | 'texture';
  name: string;
  mimeType: 'model/gltf-binary' | 'model/gltf+json' | 'image/png' | 'image/jpeg';
  url: string;
  sha256: string;
  bytes: number;
  source: 'user-upload';
  createdAt: string;
  attribution?: string;
  bounds?: { min: Vec3; max: Vec3 };
  triangles?: number;
  width?: number;
  height?: number;
}

export interface SceneAssetRequirement {
  name: string;
  kind: 'model' | 'texture';
  description: string;
}

export interface WorldCamera {
  projection: 'perspective' | 'orthographic';
  position: Vec3;
  target: Vec3;
  fov: number;
  zoom: number;
}

export interface WorldLight {
  type: 'directional' | 'point' | 'spot';
  color: string;
  intensity: number;
  position: Vec3;
  target?: Vec3;
  castShadow?: boolean;
  distance?: number;
  angle?: number;
  penumbra?: number;
}

export interface WorldRenderSettings {
  camera?: WorldCamera;
  lights?: WorldLight[];
  ambientColor?: string;
  shadowMapSize?: 512 | 1024 | 2048;
  sky?: { topColor: string; bottomColor: string };
  fog?: { color: string; density: number };
  exposure?: number;
  bloom?: { enabled: boolean; strength: number; radius: number; threshold: number };
}

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export type WeatherId =
  | 'clear'
  | 'cloudy'
  | 'light-rain'
  | 'heavy-rain'
  | 'windy'
  | 'snow';

export type TimeOfDayId = 'morning' | 'day' | 'dusk' | 'night';

export type ConceptStyleId =
  | 'painterly-dream'
  | 'low-poly'
  | 'cinematic-teal'
  | 'storybook-watercolor'
  | 'neon-noir';

/** Unit geometries; transform.scale supplies dimensions. No geometry subdivisions or code. */
export type PrimitiveShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'capsule' | 'icosahedron';

export type WorldObjectKind =
  | 'primitive'
  | 'procedural'
  | 'model'
  | 'ground'
  | 'water'
  | 'hill'
  | 'path'
  | 'cabin'
  | 'house'
  | 'tower'
  | 'tent'
  | 'sign'
  | 'tree'
  | 'rock'
  | 'lamp'
  | 'campfire'
  | 'boat'
  | 'cloud';

export type AssetSource = 'procedural' | 'generated-model' | 'library-model';

/**
 * Asset reference for a world object. Phase 1 only produces
 * `procedural` primitive groups; generated GLB models plug in here later.
 */
export interface WorldAssetRef {
  id: string;
  source: AssetSource;
  format: 'primitive-group' | 'glb';
  url?: string;
  provider: string;
  mock: boolean;
}

export interface WorldTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface WorldMaterial {
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  flatShading?: boolean;
  map?: string;
  normalMap?: string;
  roughnessMap?: string;
  metalnessMap?: string;
  emissiveMap?: string;
  aoMap?: string;
  repeat?: [number, number];
  normalScale?: number;
}

interface WorldObjectBase {
  id: string;
  name: string;
  asset: WorldAssetRef;
  transform: WorldTransform;
  material?: WorldMaterial;
  tags: string[];
  geometry?: WorldGeometry;
  collision?: 'solid' | 'none';
}

export type WorldObject = WorldObjectBase & (
  | { kind: 'primitive'; params: { shape: PrimitiveShape } }
  | { kind: Exclude<WorldObjectKind, 'primitive'>; params?: Record<string, string | number | boolean> }
);

export interface WorldEnvironment {
  season: SeasonId;
  weather: WeatherId;
  timeOfDay: TimeOfDayId;
  sunIntensity: number;
  ambientIntensity: number;
  fogDensity: number;
}

export interface WorldSource {
  prompt: string;
  conceptId: string;
  conceptTitle: string;
  conceptStyleId: ConceptStyleId;
  provider: {
    name: string;
    mode: 'mock' | 'live';
    vision: string;
    planner: string;
  };
  generatedAt: string;
  disclaimer: string;
}

export interface SpawnPoint {
  position: Vec3;
  yawDeg: number;
}

export interface WorldGameplay {
  mode: 'explore';
  notes?: string;
}

/**
 * The canonical, saveable representation of a generated world.
 * Everything that can be edited in the studio lives here so the world can be
 * persisted, reloaded and incrementally modified later.
 */
export interface WorldSchema {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  source: WorldSource;
  environment: WorldEnvironment;
  objects: WorldObject[];
  spawnPoint: SpawnPoint;
  gameplay: WorldGameplay | null;
  render?: WorldRenderSettings;
  resources?: SceneResource[];
  assetRequirements?: SceneAssetRequirement[];
  meta: {
    createdAt: string;
    updatedAt: string;
    editable: boolean;
    mock: boolean;
    objectCount: number;
  };
}
