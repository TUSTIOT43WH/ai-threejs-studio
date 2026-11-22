import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SceneResource, WorldMaterial, WorldObject } from '@ai-three-studio/shared';
import { ensureAmbientOcclusionUVs } from './procedural-geometry';

export const MATERIAL_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;
export type MaterialMap = typeof MATERIAL_MAPS[number];
export type MaterialTextures = Partial<Record<MaterialMap, THREE.Texture>>;
export interface LoadedObjectResources {
  model: THREE.Group | null;
  textures: MaterialTextures;
  dispose: () => void;
}

export function resolveSceneResource(resources: readonly SceneResource[], id: string, kind: SceneResource['kind']): SceneResource {
  const matches = resources.filter((resource) => resource.id === id);
  const resource = matches[0];
  if (matches.length !== 1 || !resource || resource.kind !== kind) throw new Error(`资源 ${id} 不在此世界的已验证资源目录中；请重新关联素材。`);
  if (!/^[a-z\d_-]+$/i.test(id) || resource.url !== `/api/assets/${id}/file`) throw new Error(`资源 ${id} 的本地地址无效；请重新上传素材。`);
  if (kind === 'texture' && !['image/png', 'image/jpeg'].includes(resource.mimeType)) throw new Error('纹理仅支持 PNG/JPEG。');
  if (kind === 'model' && !['model/gltf-binary', 'model/gltf+json'].includes(resource.mimeType)) throw new Error('模型仅支持已验证的 GLB/glTF。');
  return resource;
}

/** No remote decoders, sidecar URLs, network extension resources, or arbitrary asset.url. */
export function createResourceLoadingManager(resource: SceneResource): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url === resource.url || /^(?:data:|blob:)/i.test(url)) return url;
    throw new Error(`已阻止模型的外部资源请求：${url.slice(0, 120)}。请上传完全内嵌的 GLB/glTF。`);
  });
  return manager;
}

export function configureMaterialTexture(source: THREE.Texture, slot: MaterialMap, material?: WorldMaterial): THREE.Texture {
  const texture = source.clone();
  texture.colorSpace = slot === 'map' || slot === 'emissiveMap' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // glTF UV convention and local raster convention must agree when overriding a model.
  texture.flipY = true;
  if (material?.repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.fromArray(material.repeat);
  }
  if (slot === 'aoMap') texture.channel = 1;
  texture.needsUpdate = true;
  return texture;
}

export function applyMaterialOverrides(material: THREE.Material, spec: WorldMaterial | undefined, textures: MaterialTextures, scalars = true): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || !spec) return;
  if (scalars) {
    if (spec.color !== undefined) material.color.set(spec.color);
    if (spec.emissive !== undefined) material.emissive.set(spec.emissive);
    for (const key of ['roughness', 'metalness', 'emissiveIntensity', 'flatShading', 'opacity'] as const) {
      if (spec[key] !== undefined) Object.assign(material, { [key]: spec[key] });
    }
    if (spec.opacity !== undefined) material.transparent = spec.opacity < 1;
  }
  for (const slot of MATERIAL_MAPS) if (textures[slot]) material[slot] = textures[slot]!;
  if (spec.normalScale !== undefined) material.normalScale.setScalar(spec.normalScale);
  material.needsUpdate = true;
}

export function normalizeModel(root: THREE.Object3D): THREE.Group {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (box.isEmpty() || !Number.isFinite(extent) || extent <= 0) throw new Error('模型没有可显示的几何体，请检查并重新上传。');
  // Wrappers preserve authored transforms, skinning, and per-mesh PBR materials.
  const centered = new THREE.Group();
  centered.position.copy(box.getCenter(new THREE.Vector3())).negate();
  centered.add(root);
  const normalized = new THREE.Group();
  normalized.scale.setScalar(1 / extent);
  normalized.add(centered);
  normalized.updateWorldMatrix(true, true);
  return normalized;
}

export function disposeObjectResources(root: THREE.Object3D | null, additionalTextures: Iterable<THREE.Texture> = []): void {
  const textures = new Set(additionalTextures);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root?.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const images = new Set<unknown>();
  textures.forEach((texture) => { images.add(texture.image); texture.dispose(); });
  images.forEach((image) => {
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
  });
}

async function fetchResource(resource: SceneResource, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(resource.url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error(`素材 ${resource.name} 加载失败 (HTTP ${response.status})；请确认文件仍在素材库中。`);
  return response.blob();
}

async function loadTexture(resource: SceneResource, signal: AbortSignal): Promise<THREE.Texture> {
  const blob = await fetchResource(resource, signal);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { image.src = ''; reject(new Error('纹理加载已取消或超时')); };
      image.onload = () => { signal.removeEventListener('abort', abort); resolve(); };
      image.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error(`纹理 ${resource.name} 无法解码；请重新上传 PNG/JPEG。`)); };
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Per-object ownership: never mutate/dispose another editable object's materials or textures. */
export async function loadObjectResources(object: WorldObject, catalog: readonly SceneResource[], signal: AbortSignal): Promise<LoadedObjectResources> {
  let model: THREE.Group | null = null;
  const textures: MaterialTextures = {};
  const sourceTextures = new Map<string, THREE.Texture>();
  const ownedTextures = new Set<THREE.Texture>();
  try {
    if (object.kind === 'model') {
      const resource = resolveSceneResource(catalog, object.asset.id, 'model');
      const manager = createResourceLoadingManager(resource);
      let assetError = '';
      manager.onError = (url) => { assetError = `模型内嵌资源无法加载：${url.slice(0, 100)}；请检查 PNG/JPEG 纹理及内嵌数据。`; };
      const loader = new GLTFLoader(manager);
      const data = await (await fetchResource(resource, signal)).arrayBuffer();
      const gltf = await loader.parseAsync(data, '');
      model = gltf.scene;
      // GLTFLoader tolerates broken optional images; the editor/export must not.
      if (assetError) throw new Error(assetError);
      model = normalizeModel(model);
      model.traverse((node) => {
        if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; }
      });
    }
    for (const slot of MATERIAL_MAPS) {
      const id = object.material?.[slot];
      if (!id) continue;
      let source = sourceTextures.get(id);
      if (!source) {
        source = await loadTexture(resolveSceneResource(catalog, id, 'texture'), signal);
        sourceTextures.set(id, source);
        ownedTextures.add(source);
      }
      const texture = configureMaterialTexture(source, slot, object.material);
      if (model) texture.flipY = false;
      textures[slot] = texture;
      ownedTextures.add(texture);
    }
    if (signal.aborted) throw new Error('素材加载已取消或超时，请重试。');
    if (model) {
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          // Existing materials belong to this load, not a shared loader cache.
          // Keep replaced embedded maps owned until disposal as well.
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) ownedTextures.add(value);
          applyMaterialOverrides(material, object.material, textures);
        }
        if (textures.aoMap) ensureAmbientOcclusionUVs(node.geometry);
      });
    }
    let disposed = false;
    return { model, textures, dispose: () => {
      if (!disposed) { disposed = true; disposeObjectResources(model, ownedTextures); }
    } };
  } catch (error) {
    disposeObjectResources(model, ownedTextures);
    throw error;
  }
}

export function objectNeedsResources(object: WorldObject): boolean {
  return object.kind === 'model' || MATERIAL_MAPS.some((slot) => Boolean(object.material?.[slot]));
}

/** Include resource hashes and requested overrides, so stale loads never count as export-ready. */
export function objectResourceKey(object: WorldObject, resources: readonly SceneResource[] = []): string {
  const ids = new Set(MATERIAL_MAPS.map((slot) => object.material?.[slot]).filter(Boolean));
  if (object.kind === 'model') ids.add(object.asset.id);
  return JSON.stringify([object.kind, object.asset.id, object.material, resources.filter((r) => ids.has(r.id))]);
}
