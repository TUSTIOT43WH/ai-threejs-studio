import { BadRequestException } from '@nestjs/common';
import type { SceneResource, Vec3 } from '@ai-three-studio/shared';
import { rasterArtifact } from '../ai/live-concept-provider';

export const MAX_ASSET_BYTES = 6 * 1024 * 1024;
export const MAX_MODEL_TRIANGLES = 300_000;
export const MAX_MODEL_NODES = 4096;
const MAX_BASE64 = 4 * Math.ceil(MAX_ASSET_BYTES / 3);
const EXPORT_HELP = 'Export an uncompressed, embedded GLB with static triangle meshes and PNG/JPEG textures (no skins, morph targets, sparse accessors or extensions).';
const MIME_TYPES = ['model/gltf-binary', 'model/gltf+json', 'image/png', 'image/jpeg'] as const;
type JsonObject = Record<string, unknown>;
export interface AssetImportInput { name: string; mimeType: string; data: string; attribution?: string }
export interface ValidatedAsset {
  data: Buffer;
  metadata: Pick<SceneResource, 'kind' | 'mimeType' | 'bounds' | 'triangles' | 'width' | 'height'>;
}

function fail(message: string): never { throw new BadRequestException(message); }
function check(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }
function record(value: unknown, label: string): JsonObject {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}.`);
  const proto = Object.getPrototypeOf(value);
  check(proto === Object.prototype || proto === null, `Invalid ${label}.`);
  return value as JsonObject;
}
function object(value: unknown, fields: string, label: string): JsonObject {
  const result = record(value, label);
  const allowed = new Set([...fields.split(' '), 'name', 'extras', 'extensions']);
  check(Object.keys(result).every((key) => allowed.has(key)), `Unsupported field in ${label}. ${EXPORT_HELP}`);
  if (result.name !== undefined) check(typeof result.name === 'string' && result.name.length <= 1024, `Invalid ${label} name.`);
  return result;
}
function array(value: unknown, max: number, label: string, optional = true): unknown[] {
  if (value === undefined && optional) return [];
  check(Array.isArray(value) && value.length <= max, `Invalid or excessive ${label}.`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${label}.`);
  return value;
}
function number(value: unknown, min: number, max: number, label: string): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `Invalid ${label}.`);
  return value;
}
function vector(value: unknown, size: number, min: number, max: number, label: string): number[] {
  const items = array(value, size, label, false);
  check(items.length === size, `Invalid ${label}.`);
  return items.map((item) => number(item, min, max, label));
}
function index(value: unknown, length: number, label: string): number { return integer(value, 0, length - 1, label); }
function optionalEnum(value: unknown, choices: readonly unknown[], label: string): void {
  if (value !== undefined) check(choices.includes(value), `Invalid ${label}.`);
}

export function validateAssetInput(value: unknown): AssetImportInput {
  const input = record(value, 'asset import body');
  check(Object.keys(input).every((key) => ['name', 'mimeType', 'data', 'attribution'].includes(key)), 'Unknown asset import field.');
  check(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 160 &&
    !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(input.name) && !input.name.includes('..'), 'Asset name must be a plain display name, not a path (1–160 characters).');
  check(typeof input.mimeType === 'string' && MIME_TYPES.includes(input.mimeType as typeof MIME_TYPES[number]), 'Only GLB, embedded glTF, PNG and JPEG assets are supported.');
  check(typeof input.data === 'string' && input.data.length > 0 && input.data.length <= MAX_BASE64, 'Asset data must be base64, at most 6 MiB decoded.');
  if (input.attribution !== undefined) check(typeof input.attribution === 'string' && input.attribution.trim().length > 0 &&
    input.attribution.length <= 2000 && !/[\x00-\x1f\x7f]/.test(input.attribution), 'Invalid attribution (1–2000 characters).');
  return { name: input.name.trim(), mimeType: input.mimeType, data: input.data,
    ...(input.attribution !== undefined ? { attribution: (input.attribution as string).trim() } : {}) };
}

function base64(value: string): Buffer {
  check(value.length > 0 && value.length <= MAX_BASE64 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'Invalid canonical base64 asset data.');
  const data = Buffer.from(value, 'base64');
  check(data.length > 0 && data.length <= MAX_ASSET_BYTES && data.toString('base64') === value, 'Invalid base64 or asset exceeds 6 MiB.');
  return data;
}
function dataUri(value: unknown, types: readonly string[]): { data: Buffer; mimeType: string } {
  check(typeof value === 'string', 'Only embedded data URIs are allowed; external files and URLs are forbidden.');
  const comma = value.indexOf(',');
  const prefix = value.slice(0, comma);
  const mimeType = types.find((type) => prefix === `data:${type};base64`);
  check(comma > 0 && mimeType, 'Only embedded base64 buffers and PNG/JPEG images are allowed; external files and URLs are forbidden.');
  return { data: base64(value.slice(comma + 1)), mimeType };
}
function raster(data: Buffer, mimeType: string): { width: number; height: number } {
  try {
    const artifact = rasterArtifact(data.toString('base64'));
    check(artifact.mimeType === mimeType, 'Raster MIME type does not match its bytes.');
    return { width: artifact.width, height: artifact.height };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    return fail('Invalid PNG/JPEG image; use a static raster up to 4096 pixels per side.');
  }
}

// Bound all JSON, including unused metadata, before following references or recursing through nodes.
function checkJson(root: unknown): void {
  const pending: [unknown, number][] = [[root, 0]];
  let entries = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    check(++entries <= 200_000 && depth <= 64, 'glTF JSON is too large or deeply nested.');
    if (typeof value === 'number') check(Number.isFinite(value), 'glTF numbers must be finite.');
    if (value && typeof value === 'object') {
      const children = Object.entries(value);
      check(entries + pending.length + children.length <= 200_000, 'glTF JSON entry budget exceeded.');
      for (const [key, child] of children) {
        check(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe glTF JSON key.');
        if (key === 'extensions') {
          check(Object.keys(record(child, 'extensions')).length === 0, `Unsupported glTF extension (including Draco, Meshopt and KTX/Basis). ${EXPORT_HELP}`);
        }
        pending.push([child, depth + 1]);
      }
    }
  }
}
function parseModel(data: Buffer, binary: boolean): { root: JsonObject; bin?: Buffer } {
  let json = data;
  let bin: Buffer | undefined;
  if (binary) {
    check(data.length >= 20 && data.readUInt32LE(0) === 0x46546c67 && data.readUInt32LE(4) === 2 && data.readUInt32LE(8) === data.length,
      'Invalid GLB v2 header or total length.');
    let offset = 12;
    let chunks = 0;
    while (offset < data.length) {
      check(offset + 8 <= data.length, 'Truncated GLB chunk header.');
      const length = data.readUInt32LE(offset);
      const type = data.readUInt32LE(offset + 4);
      check(length > 0 && length % 4 === 0 && offset + 8 + length <= data.length, 'Invalid GLB chunk length or alignment.');
      const payload = data.subarray(offset + 8, offset + 8 + length);
      if (chunks === 0) { check(type === 0x4e4f534a, 'GLB must start with its JSON chunk.'); json = payload; }
      else { check(chunks === 1 && type === 0x004e4942, 'GLB permits only one JSON chunk and one optional BIN chunk.'); bin = payload; }
      chunks++;
      offset += 8 + length;
    }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(json)); }
  catch { return fail('Invalid UTF-8 glTF JSON.'); }
  checkJson(parsed);
  const root = object(parsed, 'asset scene scenes nodes meshes buffers bufferViews accessors images textures samplers materials cameras animations skins extensionsUsed extensionsRequired', 'glTF');
  const asset = object(root.asset, 'version minVersion generator copyright', 'glTF asset');
  check(asset.version === '2.0' && (asset.minVersion === undefined || asset.minVersion === '2.0'), 'Only glTF 2.0 is supported.');
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    check(array(root[key], 128, key).length === 0, `Unsupported glTF extensions (including Draco, Meshopt and KTX/Basis). ${EXPORT_HELP}`);
  }
  check(array(root.skins, MAX_MODEL_NODES, 'skins').length === 0, `Skinned meshes are not supported. ${EXPORT_HELP}`);
  return { root, bin };
}

interface View { data: Buffer; offset: number; length: number; stride?: number; target?: number }
interface Accessor {
  count: number; type: string; component: number; normalized: boolean; view: View;
  offset: number; stride: number; size: number; offsets: number[];
  read: (element: number, component?: number) => number;
}
function accessors(root: JsonObject, bin?: Buffer): { views: View[]; accessors: Accessor[] } {
  let embeddedBytes = 0;
  let binUsed = false;
  const buffers = array(root.buffers, 64, 'buffers', false).map((value, i) => {
    const item = object(value, 'uri byteLength', 'buffer');
    const length = integer(item.byteLength, 1, MAX_ASSET_BYTES, 'buffer byteLength');
    let data: Buffer;
    if (item.uri === undefined) {
      check(i === 0 && bin, 'A buffer without a URI must be the first GLB BIN buffer.');
      check(bin.length >= length && bin.length - length <= 3 && bin.subarray(length).every((byte) => byte === 0), 'Invalid GLB BIN length or padding.');
      data = bin.subarray(0, length); binUsed = true;
    } else {
      check(!(i === 0 && bin), 'GLB BIN buffer must not also have a URI.');
      data = dataUri(item.uri, ['application/octet-stream', 'application/gltf-buffer']).data;
      check(data.length === length, 'Embedded buffer byteLength mismatch.');
    }
    embeddedBytes += data.length;
    check(embeddedBytes <= MAX_ASSET_BYTES, 'Embedded buffers exceed 6 MiB.');
    return data;
  });
  check(!bin || binUsed, 'Unreferenced GLB BIN chunk.');
  const views = array(root.bufferViews, 16384, 'bufferViews').map((value): View => {
    const item = object(value, 'buffer byteOffset byteLength byteStride target', 'bufferView');
    const data = buffers[index(item.buffer, buffers.length, 'bufferView buffer')];
    const offset = integer(item.byteOffset ?? 0, 0, data.length, 'bufferView offset');
    const length = integer(item.byteLength, 1, data.length - offset, 'bufferView length');
    const stride = item.byteStride === undefined ? undefined : integer(item.byteStride, 4, 252, 'bufferView stride');
    check(stride === undefined || stride % 4 === 0, 'Vertex stride must be a multiple of four.');
    optionalEnum(item.target, [34962, 34963], 'bufferView target');
    return { data, offset, length, stride, target: item.target as number | undefined };
  });
  let componentsRead = 0;
  const result = array(root.accessors, 16384, 'accessors', false).map((value): Accessor => {
    const item = object(value, 'bufferView byteOffset componentType normalized count type min max sparse', 'accessor');
    check(item.sparse === undefined, `Sparse accessors are not supported. ${EXPORT_HELP}`);
    const view = views[index(item.bufferView, views.length, 'accessor bufferView')];
    const component = integer(item.componentType, 5120, 5126, 'accessor componentType');
    const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const size = sizes[component];
    check(size, 'Unsupported accessor component type.');
    const shapes: Record<string, [number, number]> = { SCALAR: [1, 1], VEC2: [1, 2], VEC3: [1, 3], VEC4: [1, 4], MAT2: [2, 2], MAT3: [3, 3], MAT4: [4, 4] };
    check(typeof item.type === 'string' && Object.hasOwn(shapes, item.type), 'Invalid accessor type.');
    const [columns, rows] = shapes[item.type];
    const columnBytes = columns === 1 ? rows * size : Math.ceil(rows * size / 4) * 4;
    const elementBytes = columns * columnBytes;
    const offsets = Array.from({ length: columns * rows }, (_, i) => Math.floor(i / rows) * columnBytes + (i % rows) * size);
    const count = integer(item.count, 1, 900_000, 'accessor count');
    const offset = integer(item.byteOffset ?? 0, 0, view.length, 'accessor byteOffset');
    const stride = view.stride ?? elementBytes;
    check(offset % size === 0 && (view.offset + offset) % size === 0 && stride >= elementBytes &&
      (columns === 1 || (view.offset + offset) % 4 === 0) && offset + (count - 1) * stride + elementBytes <= view.length, 'Accessor alignment, stride or range is invalid.');
    optionalEnum(item.normalized, [true, false], 'accessor normalized');
    const normalized = item.normalized === true;
    check(!normalized || [5120, 5121, 5122, 5123].includes(component), 'Only byte/short accessors may be normalized.');
    for (const key of ['min', 'max']) if (item[key] !== undefined) vector(item[key], offsets.length, -3.403e38, 3.403e38, `accessor ${key}`);
    if (item.min !== undefined && item.max !== undefined) check((item.min as number[]).every((min, i) => min <= (item.max as number[])[i]), 'Accessor min exceeds max.');
    const read = (element: number, part = 0): number => {
      const at = view.offset + offset + element * stride + offsets[part];
      switch (component) {
        case 5120: return view.data.readInt8(at);
        case 5121: return view.data.readUInt8(at);
        case 5122: return view.data.readInt16LE(at);
        case 5123: return view.data.readUInt16LE(at);
        case 5125: return view.data.readUInt32LE(at);
        default: return view.data.readFloatLE(at);
      }
    };
    componentsRead += count * offsets.length;
    check(componentsRead <= 8_000_000, 'Accessor validation budget exceeded; simplify the model.');
    for (let i = 0; i < count; i++) for (let c = 0; c < offsets.length; c++) check(Number.isFinite(read(i, c)), 'Accessor contains non-finite values.');
    return { count, type: item.type, component, normalized, view, offset, stride, size, offsets, read };
  });
  return { views, accessors: result };
}

function materials(root: JsonObject, views: View[]): Set<number>[] {
  let pixels = 0;
  const images = array(root.images, 128, 'images').map((value) => {
    const item = object(value, 'uri mimeType bufferView', 'image');
    check((item.uri !== undefined) !== (item.bufferView !== undefined), 'Image must have exactly one embedded URI or bufferView.');
    let data: Buffer;
    let mimeType: string;
    if (item.uri !== undefined) {
      const embedded = dataUri(item.uri, ['image/png', 'image/jpeg']);
      data = embedded.data; mimeType = embedded.mimeType;
      check(item.mimeType === undefined || item.mimeType === mimeType, 'Image MIME type mismatch.');
    } else {
      const view = views[index(item.bufferView, views.length, 'image bufferView')];
      check(view.stride === undefined && view.target === undefined, 'Image bufferView cannot have a vertex stride or target.');
      check(item.mimeType === 'image/png' || item.mimeType === 'image/jpeg', 'Embedded images must be PNG or JPEG.');
      data = view.data.subarray(view.offset, view.offset + view.length); mimeType = item.mimeType;
    }
    const dimensions = raster(data, mimeType);
    pixels += dimensions.width * dimensions.height;
    check(pixels <= 32 * 1024 * 1024, 'Embedded texture pixel budget exceeded (32 megapixels).');
    return dimensions;
  });
  const samplers = array(root.samplers, 256, 'samplers').map((value) => {
    const item = object(value, 'magFilter minFilter wrapS wrapT', 'sampler');
    optionalEnum(item.magFilter, [9728, 9729], 'magnification filter');
    optionalEnum(item.minFilter, [9728, 9729, 9984, 9985, 9986, 9987], 'minification filter');
    optionalEnum(item.wrapS, [33071, 33648, 10497], 'wrapS');
    optionalEnum(item.wrapT, [33071, 33648, 10497], 'wrapT');
    return item;
  });
  const textures = array(root.textures, 256, 'textures').map((value) => {
    const item = object(value, 'source sampler', 'texture');
    index(item.source, images.length, 'texture source');
    if (item.sampler !== undefined) index(item.sampler, samplers.length, 'texture sampler');
    return item;
  });
  return array(root.materials, 4096, 'materials').map((value) => {
    const item = object(value, 'pbrMetallicRoughness normalTexture occlusionTexture emissiveTexture emissiveFactor alphaMode alphaCutoff doubleSided', 'material');
    const coords = new Set<number>();
    const textureInfo = (value: unknown, kind: 'normal' | 'occlusion' | 'color') => {
      if (value === undefined) return;
      const info = object(value, `index texCoord ${kind === 'normal' ? 'scale' : kind === 'occlusion' ? 'strength' : ''}`, 'textureInfo');
      index(info.index, textures.length, 'material texture');
      coords.add(integer(info.texCoord ?? 0, 0, 7, 'texture coordinate set'));
      if (kind === 'normal' && info.scale !== undefined) number(info.scale, -1e6, 1e6, 'normal scale');
      if (kind === 'occlusion' && info.strength !== undefined) number(info.strength, 0, 1, 'occlusion strength');
    };
    if (item.pbrMetallicRoughness !== undefined) {
      const pbr = object(item.pbrMetallicRoughness, 'baseColorFactor baseColorTexture metallicFactor roughnessFactor metallicRoughnessTexture', 'PBR material');
      if (pbr.baseColorFactor !== undefined) vector(pbr.baseColorFactor, 4, 0, 1, 'base color');
      if (pbr.metallicFactor !== undefined) number(pbr.metallicFactor, 0, 1, 'metallic factor');
      if (pbr.roughnessFactor !== undefined) number(pbr.roughnessFactor, 0, 1, 'roughness factor');
      textureInfo(pbr.baseColorTexture, 'color'); textureInfo(pbr.metallicRoughnessTexture, 'color');
    }
    textureInfo(item.normalTexture, 'normal'); textureInfo(item.occlusionTexture, 'occlusion'); textureInfo(item.emissiveTexture, 'color');
    if (item.emissiveFactor !== undefined) vector(item.emissiveFactor, 3, 0, 1, 'emissive factor');
    if (item.alphaCutoff !== undefined) number(item.alphaCutoff, 0, 1e6, 'alpha cutoff');
    optionalEnum(item.alphaMode, ['OPAQUE', 'MASK', 'BLEND'], 'alpha mode');
    optionalEnum(item.doubleSided, [true, false], 'double sided');
    return coords;
  });
}

interface Mesh { positions: Accessor[]; triangles: number }
function meshes(root: JsonObject, all: Accessor[], materialCoords: Set<number>[]): Mesh[] {
  let primitiveCount = 0;
  let totalTriangles = 0;
  let attributeWork = 0;
  return array(root.meshes, 4096, 'meshes', false).map((value) => {
    const item = object(value, 'primitives weights', 'mesh');
    check(item.weights === undefined, `Morph targets are not supported. ${EXPORT_HELP}`);
    const primitives = array(item.primitives, 8192, 'primitives', false);
    check(primitives.length > 0 && (primitiveCount += primitives.length) <= 8192, 'Empty mesh or primitive budget exceeded.');
    const positions = new Set<Accessor>();
    let triangles = 0;
    for (const value of primitives) {
      const primitive = object(value, 'attributes indices material mode targets', 'primitive');
      check(primitive.targets === undefined, `Morph targets are not supported. ${EXPORT_HELP}`);
      const attributes = record(primitive.attributes, 'primitive attributes');
      const position = all[index(attributes.POSITION, all.length, 'POSITION accessor')];
      check(position.type === 'VEC3' && position.component === 5126 && !position.normalized, 'POSITION must be a float VEC3 accessor.');
      for (const [semantic, value] of Object.entries(attributes)) {
        const accessor = all[index(value, all.length, 'attribute accessor')];
        attributeWork += accessor.count * accessor.offsets.length;
        check(attributeWork <= 8_000_000, 'Vertex attribute validation budget exceeded; simplify the model.');
        check(accessor.count === position.count && accessor.view.target !== 34963 && accessor.offset % 4 === 0 &&
          (accessor.view.offset + accessor.offset) % 4 === 0 && accessor.stride % 4 === 0, 'Invalid vertex attribute count, alignment or target.');
        const float = accessor.component === 5126 && !accessor.normalized;
        const colorOrUv = float || ([5121, 5123].includes(accessor.component) && accessor.normalized);
        if (semantic === 'POSITION' || semantic === 'NORMAL') check(accessor.type === 'VEC3' && float, `${semantic} must be float VEC3.`);
        else if (semantic === 'TANGENT') check(accessor.type === 'VEC4' && float, 'TANGENT must be float VEC4.');
        else if (/^TEXCOORD_[0-7]$/.test(semantic)) check(accessor.type === 'VEC2' && colorOrUv, 'Invalid texture coordinate accessor.');
        else if (/^COLOR_[0-7]$/.test(semantic)) check(['VEC3', 'VEC4'].includes(accessor.type) && colorOrUv, 'Invalid color accessor.');
        else fail(`Unsupported vertex attribute; skinning and custom attributes are not supported. ${EXPORT_HELP}`);
        if (semantic === 'NORMAL' || semantic === 'TANGENT') {
          for (let i = 0; i < accessor.count; i++) {
            const length = Math.hypot(accessor.read(i, 0), accessor.read(i, 1), accessor.read(i, 2));
            check(Math.abs(length - 1) < 0.01 && (semantic !== 'TANGENT' || Math.abs(accessor.read(i, 3)) === 1), 'Invalid normal or tangent vector.');
          }
        }
        if (semantic.startsWith('COLOR_') && float) for (let i = 0; i < accessor.count; i++) for (let c = 0; c < accessor.offsets.length; c++) number(accessor.read(i, c), 0, 1, 'vertex color');
      }
      const mode = primitive.mode ?? 4;
      check(mode === 4 || mode === 5 || mode === 6, 'Only triangle lists, strips and fans are supported.');
      let count = position.count;
      if (primitive.indices !== undefined) {
        const indices = all[index(primitive.indices, all.length, 'indices accessor')];
        check(indices.type === 'SCALAR' && [5121, 5123, 5125].includes(indices.component) && !indices.normalized && indices.view.stride === undefined && indices.view.target !== 34962, 'Invalid index accessor.');
        const restart = 2 ** (indices.size * 8) - 1;
        for (let i = 0; i < indices.count; i++) check(indices.read(i) < position.count && indices.read(i) !== restart, 'Index exceeds POSITION count or uses forbidden primitive restart.');
        count = indices.count;
      }
      check(count >= 3 && (mode !== 4 || count % 3 === 0), 'Invalid triangle index/vertex count.');
      const amount = mode === 4 ? count / 3 : count - 2;
      triangles += amount; totalTriangles += amount;
      check(totalTriangles <= MAX_MODEL_TRIANGLES, 'Model exceeds 300,000 triangles.');
      if (primitive.material !== undefined) {
        const coords = materialCoords[index(primitive.material, materialCoords.length, 'primitive material')];
        for (const coord of coords) check(attributes[`TEXCOORD_${coord}`] !== undefined, 'Material refers to a missing texture coordinate attribute.');
      }
      positions.add(position);
    }
    return { positions: [...positions], triangles };
  });
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: number[], b: number[]): number[] {
  const result = Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) result[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    number(result[c * 4 + r], -1e12, 1e12, 'composed node transform');
  }
  return result;
}
function quaternion(value: unknown): number[] {
  const q = vector(value, 4, -1, 1, 'rotation quaternion');
  check(Math.abs(Math.hypot(...q) - 1) <= 1e-4, 'Rotation quaternion must have unit length.');
  return q;
}
function transform(node: JsonObject): number[] {
  if (node.matrix !== undefined) {
    check(node.translation === undefined && node.rotation === undefined && node.scale === undefined, 'Node cannot contain both matrix and TRS transforms.');
    const m = vector(node.matrix, 16, -1e9, 1e9, 'node matrix');
    check(m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1, 'Node matrix must be affine.');
    const lengths = [0, 4, 8].map((c) => Math.hypot(m[c], m[c + 1], m[c + 2]));
    check(lengths.every((v) => v >= 1e-9), 'Singular node matrix is not supported.');
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) check(Math.abs(m[a * 4] * m[b * 4] + m[a * 4 + 1] * m[b * 4 + 1] + m[a * 4 + 2] * m[b * 4 + 2]) <= 1e-5 * lengths[a] * lengths[b], 'Sheared node matrix is not supported.');
    return m;
  }
  const t = vector(node.translation ?? [0, 0, 0], 3, -1e9, 1e9, 'node translation');
  const s = vector(node.scale ?? [1, 1, 1], 3, -1e9, 1e9, 'node scale');
  check(s.every((v) => Math.abs(v) >= 1e-9), 'Zero or near-zero node scale is not supported.');
  const [x, y, z, w] = quaternion(node.rotation ?? [0, 0, 0, 1]);
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, ...t, 1];
}
function cameras(root: JsonObject): number {
  return array(root.cameras, 256, 'cameras').map((value) => {
    const item = object(value, 'type perspective orthographic', 'camera');
    check(item.type === 'perspective' || item.type === 'orthographic', 'Invalid camera type.');
    if (item.type === 'perspective') {
      check(item.orthographic === undefined, 'Invalid camera projection.');
      const p = object(item.perspective, 'aspectRatio yfov zfar znear', 'perspective camera');
      number(p.yfov, 1e-9, Math.PI - 1e-9, 'camera yfov');
      const near = number(p.znear, 1e-9, 1e12, 'camera near');
      if (p.zfar !== undefined) check(number(p.zfar, 1e-9, 1e12, 'camera far') > near, 'Camera far must exceed near.');
      if (p.aspectRatio !== undefined) number(p.aspectRatio, 1e-9, 1e9, 'camera aspect ratio');
    } else {
      check(item.perspective === undefined, 'Invalid camera projection.');
      const p = object(item.orthographic, 'xmag ymag zfar znear', 'orthographic camera');
      number(p.xmag, 1e-9, 1e12, 'camera xmag'); number(p.ymag, 1e-9, 1e12, 'camera ymag');
      check(number(p.zfar, 0, 1e12, 'camera far') > number(p.znear, 0, 1e12, 'camera near'), 'Camera far must exceed near.');
    }
  }).length;
}
function animations(root: JsonObject, nodes: JsonObject[], all: Accessor[]): void {
  let channels = 0;
  let samples = 0;
  let channelSamples = 0;
  for (const value of array(root.animations, 64, 'animations')) {
    const animation = object(value, 'channels samplers', 'animation');
    const samplers = array(animation.samplers, 4096, 'animation samplers', false).map((value) => {
      const sampler = object(value, 'input output interpolation', 'animation sampler');
      const input = all[index(sampler.input, all.length, 'animation input')];
      const output = all[index(sampler.output, all.length, 'animation output')];
      const interpolation = sampler.interpolation ?? 'LINEAR';
      optionalEnum(interpolation, ['LINEAR', 'STEP', 'CUBICSPLINE'], 'animation interpolation');
      check(input.type === 'SCALAR' && input.component === 5126 && !input.normalized && input.view.target === undefined && input.view.stride === undefined &&
        output.component === 5126 && !output.normalized && output.view.target === undefined && output.view.stride === undefined, 'Invalid animation accessor.');
      const factor = interpolation === 'CUBICSPLINE' ? 3 : 1;
      check(output.count === input.count * factor && ['VEC3', 'VEC4'].includes(output.type), 'Invalid animation sample count or type.');
      samples += input.count + output.count;
      check(samples <= 1_000_000, 'Animation sample budget exceeded.');
      let previous = -1;
      for (let i = 0; i < input.count; i++) {
        const time = number(input.read(i), 0, 1e9, 'animation time');
        check(time > previous, 'Animation times must strictly increase.'); previous = time;
      }
      return { input, output, factor };
    });
    const seen = new Set<string>();
    const items = array(animation.channels, 4096, 'animation channels', false);
    check(items.length > 0 && (channels += items.length) <= 4096, 'Empty animation or animation channel budget exceeded.');
    for (const value of items) {
      const channel = object(value, 'sampler target', 'animation channel');
      const sampler = samplers[index(channel.sampler, samplers.length, 'channel sampler')];
      channelSamples += sampler.output.count;
      check(channelSamples <= 1_000_000, 'Animation channel sample budget exceeded.');
      const target = object(channel.target, 'node path', 'animation target');
      const node = index(target.node, nodes.length, 'animation target node');
      check(nodes[node].matrix === undefined, 'Animated nodes must use TRS, not matrix.');
      check(['translation', 'rotation', 'scale'].includes(target.path as string), `Only TRS animation metadata is supported. ${EXPORT_HELP}`);
      const key = `${node}:${target.path}`;
      check(!seen.has(key), 'Duplicate animation target.'); seen.add(key);
      check(sampler.output.type === (target.path === 'rotation' ? 'VEC4' : 'VEC3'), 'Animation output shape does not match target.');
      if (target.path === 'rotation') for (let i = 0; i < sampler.input.count; i++) {
        const sample = i * sampler.factor + (sampler.factor === 3 ? 1 : 0);
        quaternion([0, 1, 2, 3].map((c) => sampler.output.read(sample, c)));
      }
    }
  }
}
function scene(root: JsonObject, meshList: Mesh[], all: Accessor[]): { bounds: { min: Vec3; max: Vec3 }; triangles: number } {
  const cameraCount = cameras(root);
  const nodes = array(root.nodes, MAX_MODEL_NODES, 'nodes', false).map((value) => object(value, 'camera children skin matrix mesh rotation scale translation weights', 'node'));
  const parents = Array<number>(nodes.length).fill(-1);
  const local = nodes.map(transform);
  const children = nodes.map((node, i) => {
    check(node.skin === undefined && node.weights === undefined, `Skins and morph weights are not supported. ${EXPORT_HELP}`);
    if (node.mesh !== undefined) index(node.mesh, meshList.length, 'node mesh');
    if (node.camera !== undefined) index(node.camera, cameraCount, 'node camera');
    const list = array(node.children, MAX_MODEL_NODES, 'node children').map((v) => index(v, nodes.length, 'child node'));
    for (const child of list) { check(parents[child] === -1 && child !== i, 'Node graph has a cycle, duplicate child or multiple parents.'); parents[child] = i; }
    return list;
  });
  const world: number[][] = [];
  let visited = 0;
  let instancedTriangles = 0;
  const visit = (node: number, parent: number[], depth: number): void => {
    check(depth <= 64 && !world[node], 'Node graph cycle or depth limit (64) exceeded.');
    visited++;
    world[node] = multiply(parent, local[node]);
    if (nodes[node].mesh !== undefined) instancedTriangles += meshList[nodes[node].mesh as number].triangles;
    check(instancedTriangles <= MAX_MODEL_TRIANGLES, 'Instanced model exceeds 300,000 triangles.');
    for (const child of children[node]) visit(child, world[node], depth + 1);
  };
  for (let i = 0; i < nodes.length; i++) if (parents[i] === -1) visit(i, IDENTITY, 1);
  check(visited === nodes.length, 'Node graph contains a cycle.');
  const scenes = array(root.scenes, 128, 'scenes', false).map((value) => {
    const item = object(value, 'nodes', 'scene');
    const roots = array(item.nodes, MAX_MODEL_NODES, 'scene roots').map((v) => index(v, nodes.length, 'scene node'));
    check(new Set(roots).size === roots.length && roots.every((node) => parents[node] === -1), 'Scene nodes must be distinct graph roots.');
    return roots;
  });
  const selected = index(root.scene ?? 0, scenes.length, 'default scene');
  animations(root, nodes, all); // Validated and retained as metadata; this service never plays animations.
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let vertices = 0;
  const bounds = (node: number, active: boolean): void => {
    const mesh = nodes[node].mesh === undefined ? undefined : meshList[nodes[node].mesh as number];
    if (mesh) {
      if (active) triangles += mesh.triangles;
      for (const position of mesh.positions) {
        vertices += position.count;
        check(vertices <= 3_000_000, 'Transformed vertex validation budget exceeded; simplify the model.');
        const m = world[node];
        for (let i = 0; i < position.count; i++) {
          const x = position.read(i, 0), y = position.read(i, 1), z = position.read(i, 2);
          for (let c = 0; c < 3; c++) {
            const value = number(m[c] * x + m[4 + c] * y + m[8 + c] * z + m[12 + c], -1e12, 1e12, 'transformed POSITION');
            if (active) { min[c] = Math.min(min[c], value); max[c] = Math.max(max[c], value); }
          }
        }
      }
    }
    for (const child of children[node]) bounds(child, active);
  };
  const activeRoots = new Set(scenes[selected]);
  // Check even unused nodes, but derive normalization bounds only from the default rendered scene.
  for (let i = 0; i < nodes.length; i++) if (parents[i] === -1) bounds(i, activeRoots.has(i));
  check(triangles > 0 && min.every(Number.isFinite) && max.every(Number.isFinite), 'Default scene must contain a triangle mesh.');
  check(Math.max(...max.map((v, i) => v - min[i])) > 1e-9, 'Model has zero or near-zero bounds and cannot be normalized.');
  return { bounds: { min, max }, triangles };
}

export function validateAsset(value: unknown): ValidatedAsset {
  const input = validateAssetInput(value);
  const data = base64(input.data);
  if (input.mimeType === 'image/png' || input.mimeType === 'image/jpeg') {
    return { data, metadata: { kind: 'texture', mimeType: input.mimeType, ...raster(data, input.mimeType) } };
  }
  const { root, bin } = parseModel(data, input.mimeType === 'model/gltf-binary');
  const parsed = accessors(root, bin);
  const materialCoords = materials(root, parsed.views);
  const meshList = meshes(root, parsed.accessors, materialCoords);
  return { data, metadata: { kind: 'model', mimeType: input.mimeType as 'model/gltf-binary' | 'model/gltf+json', ...scene(root, meshList, parsed.accessors) } };
}
