import * as THREE from 'three';
import type { WorldSchema } from '@ai-three-studio/shared';
import { getSceneTheme } from './environment-visuals';
import { createReferenceCamera, createSceneLights, createStaticSky } from '../components/scene/render-settings';

const LOADING_MESSAGE = '场景仍在加载，请稍后导出';

// Emit a JSON string literal, never an object literal or executable user text.
// Escaping '<' also makes the module safe to embed without closing a script tag.
function jsonStringLiteral(value: unknown): string {
  return JSON.stringify(JSON.stringify(value))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function transformProxy(source: THREE.Object3D): THREE.Object3D {
  const proxy = new THREE.Object3D();
  proxy.position.copy(source.position);
  proxy.quaternion.copy(source.quaternion);
  proxy.scale.copy(source.scale);
  proxy.pivot = source.pivot?.clone() ?? null;
  proxy.matrix.copy(source.matrix);
  proxy.matrixWorld.copy(source.matrixWorld);
  proxy.matrixAutoUpdate = source.matrixAutoUpdate;
  proxy.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
  proxy.matrixWorldNeedsUpdate = true;
  return proxy;
}

// Update only copies: even the live scene's cached matrices/dirty flags stay intact.
function detachInWorldSpace(source: THREE.Object3D, clone: THREE.Object3D): void {
  let branch = clone;
  for (let parent = source.parent; parent; parent = parent.parent) {
    const proxy = transformProxy(parent);
    proxy.add(branch);
    branch = proxy;
    clone.visible = clone.visible && parent.visible;
  }
  clone.matrixWorldNeedsUpdate = true;
  clone.updateWorldMatrix(true, true);
  clone.removeFromParent();
  clone.matrix.copy(clone.matrixWorld);
  clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
  clone.pivot = null;
  // Keep the full matrix, including shear from rotated, non-uniformly scaled parents.
  clone.matrixAutoUpdate = false;
  clone.matrixWorldAutoUpdate = true;
  clone.matrixWorldNeedsUpdate = true;
}

function assertEmbeddedImages(json: THREE.Object3DJSON): void {
  const { images } = json as THREE.Object3DJSON & { images?: { url: unknown }[] };
  const embedded = (image: unknown): boolean => {
    if (Array.isArray(image)) return image.every(embedded);
    if (typeof image === 'string') {
      // Raster data only; reject remote/relative URLs, blob URLs and SVG references.
      return /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(image);
    }
    return image !== null && typeof image === 'object' &&
      'data' in image && Array.isArray(image.data) &&
      'width' in image && typeof image.width === 'number' &&
      'height' in image && typeof image.height === 'number' &&
      'type' in image && typeof image.type === 'string';
  };
  if (images?.some((image) => !embedded(image.url))) {
    throw new Error('场景包含无法内嵌的纹理，无法安全导出');
  }
}

/** Export the rendered model, not AI-generated code or the editor's scene graph. */
export function buildSceneModule(scene: THREE.Scene, world: WorldSchema): string {
  const ids = new Set(world.objects.map((object) => object.id));
  if (ids.size === 0) throw new Error(LOADING_MESSAGE);
  if (ids.size !== world.objects.length) {
    throw new Error('场景物体 ID 重复，无法导出');
  }

  const roots = new Map<string, THREE.Object3D>();
  scene.traverse((node) => {
    const id: unknown = node.userData.worldObjectId;
    if (!(node instanceof THREE.Group) || typeof id !== 'string' || !ids.has(id)) return;
    if (roots.has(id)) throw new Error(LOADING_MESSAGE);
    roots.set(id, node);
  });
  if (roots.size !== ids.size) throw new Error(LOADING_MESSAGE);

  const rootSet = new Set(roots.values());
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const copyModel = (source: THREE.Object3D): THREE.Object3D => {
    const clone = source.clone(false);
    delete clone.userData.selected;
    clone.animations = [];
    if (clone instanceof THREE.Mesh || clone instanceof THREE.Line || clone instanceof THREE.Points) {
      let geometry = geometries.get(clone.geometry);
      if (!geometry) {
        // Serialize current attributes, not constructor parameters that may be stale.
        geometry = new THREE.BufferGeometry().copy(clone.geometry);
        geometries.set(clone.geometry, geometry);
      }
      clone.geometry = geometry;
      // Materials/textures are read-only until synchronous toJSON below. Do not
      // clone ShaderMaterial uniforms: Texture.clone dirties its shared source.
      // ObjectLoader creates independent resources from the serialized snapshot.
    }
    for (const child of source.children) {
      // A nested world object is exported separately, once, in world space.
      if (!rootSet.has(child)) clone.add(copyModel(child));
    }
    return clone;
  };

  const theme = getSceneTheme(world.environment);
  const exported = new THREE.Scene();
  exported.name = world.title;
  exported.userData = { worldId: world.id };
  exported.background = new THREE.Color(world.render?.sky?.bottomColor ?? theme.skyBottom);
  exported.fog = new THREE.FogExp2(world.render?.fog?.color ?? theme.fog, world.render?.fog?.density ?? world.environment.fogDensity);
  const lighting = createSceneLights(world.environment, world.render);
  exported.add(...lighting.children);
  if (world.render?.sky) exported.add(createStaticSky(world.render.sky));
  if (world.render?.camera) exported.add(createReferenceCamera(world));

  for (const object of world.objects) {
    const root = roots.get(object.id)!;
    let hasGeometry = false;
    root.traverse((node) => {
      if ((node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points) &&
        node.geometry.getAttribute('position')?.count > 0) hasGeometry = true;
    });
    if (!hasGeometry) throw new Error(LOADING_MESSAGE);
    const clone = copyModel(root);
    detachInWorldSpace(root, clone);
    clone.name = object.name;
    clone.userData.worldObjectId = object.id;
    clone.userData.objectKind = object.kind;
    exported.add(clone);
  }
  exported.updateWorldMatrix(false, true);
  const json = exported.toJSON();
  assertEmbeddedImages(json);

  return [
    "import * as THREE from 'three';",
    '// 静态模型快照：保留导出时的几何、材质及本地可信 Shader 状态，不含角色、编辑器或天气动画。',
    `export const worldSchema = JSON.parse(${jsonStringLiteral(world)});`,
    `const serializedJSON = ${jsonStringLiteral(json)};`,
    'export function createWorld() {',
    '  return new THREE.ObjectLoader().parse(JSON.parse(serializedJSON));',
    '}',
    '',
  ].join('\n');
}

export function downloadSceneModule(scene: THREE.Scene, world: WorldSchema): void {
  const module = buildSceneModule(scene, world);
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([module], { type: 'text/javascript' }));
  link.href = url;
  link.download = `${world.id.replace(/[^a-z\d_-]/gi, '_').slice(0, 120) || 'world'}.three.js`;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser consume the download before releasing its backing Blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
