import 'reflect-metadata';
import { BadRequestException, Module, NotFoundException, RequestMethod } from '@nestjs/common';
import { HEADERS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config';
import { localApiSecurity } from '../local-api-security';
import { AssetStore } from './asset-store';
import { AssetsController } from './assets.controller';
import { AssetsModule } from './assets.module';
import { MAX_ASSET_BYTES, validateAsset, validateAssetInput, type AssetImportInput } from './asset-validation';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=';
const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==';
const texture = (data = PNG, mimeType = 'image/png'): AssetImportInput => ({ name: 'User texture', mimeType, data });

// A real indexed triangle, constructed locally. Broad JSON typing deliberately lets
// rejection tests construct invalid input without fighting the fixture's TS type.
type Document = Record<string, any>;
function triangle(): { root: Document; bin: Buffer } {
  const bin = Buffer.alloc(42);
  [0, 0, 0, 2, 0, 0, 0, 1, 0].forEach((value, i) => bin.writeFloatLE(value, i * 4));
  [0, 1, 2].forEach((value, i) => bin.writeUInt16LE(value, 36 + i * 2));
  return { bin, root: {
    asset: { version: '2.0', generator: 'Local test fixture' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
    // Intentionally inaccurate (but structurally valid) min/max must not dictate bounds.
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-999, -999, -999], max: [999, 999, 999] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  } };
}
function chunk(type: number, payload: Buffer, padding: number): Buffer {
  const length = Math.ceil(payload.length / 4) * 4;
  const result = Buffer.alloc(8 + length, padding);
  result.writeUInt32LE(length, 0); result.writeUInt32LE(type, 4); payload.copy(result, 8);
  return result;
}
function glb(root: Document, bin?: Buffer): Buffer {
  const json = chunk(0x4e4f534a, Buffer.from(JSON.stringify(root)), 0x20);
  const binary = bin ? chunk(0x004e4942, bin, 0) : Buffer.alloc(0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + json.length + binary.length, 8);
  return Buffer.concat([header, json, binary]);
}
function modelInput(fixture = triangle(), binary = true): AssetImportInput {
  const root = structuredClone(fixture.root);
  if (!binary && root.buffers[0].uri === undefined) root.buffers[0].uri = `data:application/octet-stream;base64,${fixture.bin.toString('base64')}`;
  const data = binary ? glb(root, fixture.bin) : Buffer.from(JSON.stringify(root));
  return { name: binary ? 'Triangle.glb' : 'Triangle.gltf', mimeType: binary ? 'model/gltf-binary' : 'model/gltf+json', data: data.toString('base64') };
}
function append(fixture: ReturnType<typeof triangle>, data: Buffer, view: Document = {}): number {
  const offset = Math.ceil(fixture.bin.length / 4) * 4;
  fixture.bin = Buffer.concat([fixture.bin, Buffer.alloc(offset - fixture.bin.length), data]);
  fixture.root.buffers[0].byteLength = fixture.bin.length;
  fixture.root.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...view });
  return fixture.root.bufferViews.length - 1;
}
function floats(values: number[]): Buffer {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => data.writeFloatLE(value, i * 4));
  return data;
}
function addPbr(fixture: ReturnType<typeof triangle>, embeddedView = false): void {
  const { root } = fixture;
  const uvView = append(fixture, floats([0, 0, 1, 0, 0, 1]), { target: 34962 });
  root.accessors.push({ bufferView: uvView, componentType: 5126, count: 3, type: 'VEC2' });
  root.meshes[0].primitives[0].attributes.TEXCOORD_0 = 2;
  root.meshes[0].primitives[0].material = 0;
  root.images = embeddedView ? [{ bufferView: append(fixture, Buffer.from(PNG, 'base64')), mimeType: 'image/png' }]
    : [{ uri: `data:image/png;base64,${PNG}` }];
  root.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 }];
  root.textures = [{ source: 0, sampler: 0 }];
  root.materials = [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.6, 0.7, 1], metallicFactor: 0.4, roughnessFactor: 0.5,
    baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } },
    normalTexture: { index: 0, scale: 0.6 }, occlusionTexture: { index: 0, strength: 0.8 }, emissiveTexture: { index: 0 },
    emissiveFactor: [0.1, 0.1, 0.1], alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true }];
}
function addAnimation(fixture: ReturnType<typeof triangle>, interpolation = 'LINEAR'): void {
  const { root } = fixture;
  const inputView = append(fixture, floats([0, 1]));
  const values = interpolation === 'CUBICSPLINE' ? Array<number>(18).fill(0) : [0, 0, 0, 1, 0, 0];
  const outputView = append(fixture, floats(values));
  root.accessors.push({ bufferView: inputView, componentType: 5126, count: 2, type: 'SCALAR' },
    { bufferView: outputView, componentType: 5126, count: values.length / 3, type: 'VEC3' });
  root.animations = [{ samplers: [{ input: 2, output: 3, interpolation }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }];
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('External network is forbidden'))); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('asset format validation', () => {
  it.each([true, false])('validates a real triangle and computes actual bounds (binary=%s)', (binary) => {
    const input = modelInput(triangle(), binary);
    const result = validateAsset(input);
    expect(result.data).toEqual(Buffer.from(input.data, 'base64'));
    expect(result.metadata).toEqual({ kind: 'model', mimeType: input.mimeType, triangles: 1, bounds: { min: [0, 0, 0], max: [2, 1, 0] } });
  });
  it.each([[PNG, 'image/png'], [JPEG, 'image/jpeg']])('accepts real PNG/JPEG raster bytes', (data, mimeType) => {
    expect(validateAsset(texture(data, mimeType)).metadata).toEqual({ kind: 'texture', mimeType, width: 1, height: 1 });
  });
  it.each([true, false])('accepts all common PBR slots with embedded images (bufferView=%s)', (embeddedView) => {
    const fixture = triangle(); addPbr(fixture, embeddedView);
    expect(validateAsset(modelInput(fixture)).metadata.triangles).toBe(1);
  });
  it('supports transformed hierarchy, quaternion rotation, mirroring and matrix transforms', () => {
    const fixture = triangle();
    fixture.root.nodes = [{ translation: [10, -2, 3], children: [1] },
      { rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], scale: [2, 3, 1], children: [2] },
      { mesh: 0, matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1] }];
    const bounds = validateAsset(modelInput(fixture)).metadata.bounds!;
    [7, -4, 3].forEach((v, i) => expect(bounds.min[i]).toBeCloseTo(v));
    [10, 0, 3].forEach((v, i) => expect(bounds.max[i]).toBeCloseTo(v));
  });
  it('uses the selected scene for bounds and counts actual mesh instances', () => {
    const fixture = triangle();
    fixture.root.nodes = [{ mesh: 0, translation: [1000, 0, 0] }, { children: [2, 3] }, { mesh: 0 }, { mesh: 0, translation: [-5, 0, 0] }];
    fixture.root.scenes = [{ nodes: [0] }, { nodes: [1] }]; fixture.root.scene = 1;
    expect(validateAsset(modelInput(fixture)).metadata).toMatchObject({ triangles: 2, bounds: { min: [-5, 0, 0], max: [2, 1, 0] } });
  });
  it.each([4, 5, 6])('supports indexed and nonindexed triangle mode %s', (mode) => {
    const fixture = triangle(); fixture.root.meshes[0].primitives[0].mode = mode;
    expect(validateAsset(modelInput(fixture)).metadata.triangles).toBe(1);
    delete fixture.root.meshes[0].primitives[0].indices;
    expect(validateAsset(modelInput(fixture)).metadata.triangles).toBe(1);
  });
  it('supports interleaved attributes and nonzero accessor offsets', () => {
    const fixture = triangle();
    const data = floats([99, 0, 0, 0, 99, 2, 0, 0, 99, 0, 1, 0]);
    const view = append(fixture, data, { byteStride: 16, target: 34962 });
    fixture.root.accessors[0].bufferView = view; fixture.root.accessors[0].byteOffset = 4;
    expect(validateAsset(modelInput(fixture)).metadata.bounds).toEqual({ min: [0, 0, 0], max: [2, 1, 0] });
  });
  it.each([5121, 5123, 5125])('supports unsigned index component type %s', (componentType) => {
    const fixture = triangle();
    const size = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
    const data = Buffer.alloc(size * 3);
    [0, 1, 2].forEach((value, i) => data.writeUIntLE(value, i * size, size));
    fixture.root.accessors[1].componentType = componentType;
    fixture.root.accessors[1].bufferView = append(fixture, data, { target: 34963 });
    expect(validateAsset(modelInput(fixture)).metadata.triangles).toBe(1);
  });
  it.each(['LINEAR', 'STEP', 'CUBICSPLINE'])('preserves bounded %s animation metadata without executing it', (interpolation) => {
    const fixture = triangle(); addAnimation(fixture, interpolation);
    const input = modelInput(fixture);
    expect(validateAsset(input)).toMatchObject({ data: Buffer.from(input.data, 'base64'), metadata: { bounds: { min: [0, 0, 0], max: [2, 1, 0] } } });
  });
  it.each(['https://example.com/model.bin', 'http://127.0.0.1/secret', '//example.com/x', '../secret.bin', '..%2fsecret.bin', 'C:\\secret.bin', '/etc/passwd', 'file:///secret', 'data:text/html;base64,PHNjcmlwdD4=', 'data:application/octet-stream,raw'])('rejects external or unsafe buffer URI %s', (uri) => {
    const fixture = triangle(); fixture.root.buffers[0].uri = uri;
    expect(() => validateAsset(modelInput(fixture, false))).toThrow(BadRequestException);
  });
  it.each(['https://example.com/texture.png', '../texture.png', 'file:///texture.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGh0bWw+'])('rejects unsafe image URI %s', (uri) => {
    const fixture = triangle(); fixture.root.images = [{ uri }];
    expect(() => validateAsset(modelInput(fixture))).toThrow(BadRequestException);
  });
  it.each(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'EXT_texture_webp', 'UNKNOWN_remote_decoder'])('rejects %s with actionable export guidance', (extension) => {
    const fixture = triangle(); fixture.root.extensionsUsed = [extension];
    expect(() => validateAsset(modelInput(fixture))).toThrow(/uncompressed, embedded GLB/);
    delete fixture.root.extensionsUsed;
    fixture.root.meshes[0].primitives[0].extensions = { [extension]: {} };
    expect(() => validateAsset(modelInput(fixture))).toThrow(/uncompressed, embedded GLB/);
  });
  it.each([
    ['out of range view', (f: ReturnType<typeof triangle>) => { f.root.bufferViews[0].byteLength = 1000; }],
    ['negative offset', (f: ReturnType<typeof triangle>) => { f.root.bufferViews[0].byteOffset = -1; }],
    ['fractional offset', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].byteOffset = 0.5; }],
    ['misaligned offset', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].byteOffset = 1; }],
    ['unsafe integer offset', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].byteOffset = 1e20; }],
    ['oversized accessor', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].count = 4; }],
    ['negative accessor count', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].count = -3; }],
    ['unknown component', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].componentType = 5124; }],
    ['normalized float', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].normalized = true; }],
    ['wrong position type', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].type = 'SCALAR'; }],
    ['wrong position component', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].componentType = 5123; }],
    ['unknown shape', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].type = 'toString'; }],
    ['missing view', (f: ReturnType<typeof triangle>) => { delete f.root.accessors[0].bufferView; }],
    ['invalid view reference', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].bufferView = 42; }],
    ['stride too small', (f: ReturnType<typeof triangle>) => { f.root.bufferViews[0].byteStride = 4; }],
    ['stride misaligned', (f: ReturnType<typeof triangle>) => { f.root.bufferViews[0].byteStride = 13; }],
    ['sparse accessor', (f: ReturnType<typeof triangle>) => { f.root.accessors[0].sparse = {}; }],
    ['out of bounds index', (f: ReturnType<typeof triangle>) => { f.bin.writeUInt16LE(3, 36); }],
    ['primitive restart index', (f: ReturnType<typeof triangle>) => { f.bin.writeUInt16LE(65535, 36); }],
    ['signed index', (f: ReturnType<typeof triangle>) => { f.root.accessors[1].componentType = 5122; }],
    ['normalized index', (f: ReturnType<typeof triangle>) => { f.root.accessors[1].normalized = true; }],
    ['strided index', (f: ReturnType<typeof triangle>) => { f.root.bufferViews[1].byteStride = 4; }],
    ['missing POSITION', (f: ReturnType<typeof triangle>) => { f.root.meshes[0].primitives[0].attributes = {}; }],
    ['attribute count mismatch', (f: ReturnType<typeof triangle>) => { f.root.meshes[0].primitives[0].attributes.NORMAL = 1; }],
    ['non-finite position', (f: ReturnType<typeof triangle>) => { f.bin.writeFloatLE(NaN, 0); }],
    ['infinite position', (f: ReturnType<typeof triangle>) => { f.bin.writeFloatLE(Infinity, 0); }],
    ['degenerate bounds', (f: ReturnType<typeof triangle>) => { f.bin.fill(0, 0, 36); }],
    ['line mode', (f: ReturnType<typeof triangle>) => { f.root.meshes[0].primitives[0].mode = 1; }],
    ['invalid primitive count', (f: ReturnType<typeof triangle>) => { f.root.accessors[1].count = 2; }],
    ['non-PBR field', (f: ReturnType<typeof triangle>) => { f.root.materials = [{ url: 'https://example.com' }]; }],
    ['skin', (f: ReturnType<typeof triangle>) => { f.root.skins = [{}]; }],
    ['node skin', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].skin = 0; }],
    ['morph target', (f: ReturnType<typeof triangle>) => { f.root.meshes[0].primitives[0].targets = []; }],
    ['self cycle', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].children = [0]; }],
    ['disconnected cycle', (f: ReturnType<typeof triangle>) => { f.root.nodes.push({ children: [2] }, { children: [1] }); }],
    ['duplicate child', (f: ReturnType<typeof triangle>) => { f.root.nodes.push({ children: [0, 0] }); }],
    ['multiple parents', (f: ReturnType<typeof triangle>) => { f.root.nodes.push({ children: [0] }, { children: [0] }); }],
    ['scene child instead of root', (f: ReturnType<typeof triangle>) => { f.root.nodes.push({ children: [0] }); }],
    ['missing scene node', (f: ReturnType<typeof triangle>) => { f.root.scenes[0].nodes = [99]; }],
    ['duplicate scene root', (f: ReturnType<typeof triangle>) => { f.root.scenes[0].nodes = [0, 0]; }],
    ['missing selected scene', (f: ReturnType<typeof triangle>) => { f.root.scene = 1; }],
    ['bad mesh index', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].mesh = 99; }],
    ['invalid quaternion', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].rotation = [0, 0, 0, 0]; }],
    ['huge transform', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].translation = [1e30, 0, 0]; }],
    ['singular scale', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].scale = [0, 1, 1]; }],
    ['projective matrix', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].matrix = [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }],
    ['sheared matrix', (f: ReturnType<typeof triangle>) => { f.root.nodes[0].matrix = [1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }],
    ['bad version', (f: ReturnType<typeof triangle>) => { f.root.asset.version = '1.0'; }],
  ] as const)('rejects %s', (_label, mutate) => {
    const fixture = triangle(); mutate(fixture);
    expect(() => validateAsset(modelInput(fixture))).toThrow(BadRequestException);
  });
  it('bounds graph depth and node count', () => {
    const fixture = triangle();
    fixture.root.nodes = Array.from({ length: 65 }, (_, i) => i === 64 ? { mesh: 0 } : { children: [i + 1] });
    expect(() => validateAsset(modelInput(fixture))).toThrow(/depth limit/);
    fixture.root.nodes = Array.from({ length: 4097 }, () => ({}));
    expect(() => validateAsset(modelInput(fixture))).toThrow(/nodes/);
  });
  it('enforces 300k triangle budget including node instancing', () => {
    const fixture = triangle();
    fixture.root.meshes[0].primitives = Array.from({ length: 100 }, () => structuredClone(fixture.root.meshes[0].primitives[0]));
    fixture.root.nodes = Array.from({ length: 3000 }, () => ({ mesh: 0 }));
    fixture.root.scenes[0].nodes = Array.from({ length: 3000 }, (_, i) => i);
    expect(validateAsset(modelInput(fixture)).metadata.triangles).toBe(300_000);
    fixture.root.nodes.push({ mesh: 0 }); fixture.root.scenes[0].nodes.push(3000);
    expect(() => validateAsset(modelInput(fixture))).toThrow(/300,000/);
  });
  it('rejects oversized imports before decoding', () => {
    expect(() => validateAsset(texture(Buffer.alloc(MAX_ASSET_BYTES + 1).toString('base64')))).toThrow(/6 MiB/);
  });
  it.each([
    ['magic', (data: Buffer) => { data.writeUInt32LE(0, 0); return data; }],
    ['version', (data: Buffer) => { data.writeUInt32LE(1, 4); return data; }],
    ['total length', (data: Buffer) => { data.writeUInt32LE(data.length + 4, 8); return data; }],
    ['chunk alignment', (data: Buffer) => { data.writeUInt32LE(1, 12); return data; }],
    ['chunk overflow', (data: Buffer) => { data.writeUInt32LE(0xfffffffc, 12); return data; }],
    ['chunk ordering', (data: Buffer) => { data.writeUInt32LE(0x004e4942, 16); return data; }],
    ['unknown chunk', (data: Buffer) => { data.writeUInt32LE(0, 12 + 8 + data.readUInt32LE(12) + 4); return data; }],
    ['BIN padding', (data: Buffer) => { data[data.length - 1] = 1; return data; }],
    ['truncated chunk header', (data: Buffer) => { const result = Buffer.concat([data, Buffer.alloc(4)]); result.writeUInt32LE(result.length, 8); return result; }],
    ['extra BIN chunk', (data: Buffer) => { const result = Buffer.concat([data, chunk(0x004e4942, Buffer.alloc(4), 0)]); result.writeUInt32LE(result.length, 8); return result; }],
  ] as const)('rejects invalid GLB %s', (_label, mutate) => {
    const fixture = triangle(); const data = mutate(glb(fixture.root, fixture.bin));
    expect(() => validateAsset({ ...modelInput(), data: data.toString('base64') })).toThrow(BadRequestException);
  });
  it.each(['<html>not a model</html>', '{"asset":{"version":"2.0"},"extras":{"n":1e999}}', '{"__proto__":{"polluted":true}}'])('rejects malformed/unsafe glTF JSON', (text) => {
    expect(() => validateAsset({ ...modelInput(triangle(), false), data: Buffer.from(text).toString('base64') })).toThrow(BadRequestException);
  });
  it('rejects invalid UTF-8 and deep JSON metadata', () => {
    expect(() => validateAsset({ ...modelInput(triangle(), false), data: Buffer.from([0xff]).toString('base64') })).toThrow(/UTF-8/);
    const fixture = triangle(); let extras: Document = {}; fixture.root.extras = extras;
    for (let i = 0; i < 70; i++) { extras.child = {}; extras = extras.child; }
    expect(() => validateAsset(modelInput(fixture))).toThrow(/deeply nested/);
  });
  it.each(['<html>bad</html>', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'https://example.com/image.png'])('rejects non-raster payload %s', (value) => {
    expect(() => validateAsset(texture(Buffer.from(value).toString('base64')))).toThrow(BadRequestException);
  });
  it('checks raster MIME/signature/dimensions and forbids trailing bytes', () => {
    expect(() => validateAsset(texture(PNG, 'image/jpeg'))).toThrow(/MIME/);
    const data = Buffer.from(PNG, 'base64'); data.writeUInt32BE(4097, 16);
    expect(() => validateAsset(texture(data.toString('base64')))).toThrow(/4096/);
    expect(() => validateAsset(texture(Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from('<html>')]).toString('base64')))).toThrow(BadRequestException);
  });
  it.each([PNG + '\n', PNG.slice(0, -1), `data:image/png;base64,${PNG}`, 'AB==', '====', 'a b='])('requires canonical base64', (data) => {
    expect(() => validateAsset(texture(data))).toThrow(BadRequestException);
  });
  it.each([
    (f: ReturnType<typeof triangle>) => { f.root.textures[0].source = 99; },
    (f: ReturnType<typeof triangle>) => { f.root.textures[0].sampler = 99; },
    (f: ReturnType<typeof triangle>) => { f.root.samplers[0].wrapS = 42; },
    (f: ReturnType<typeof triangle>) => { f.root.materials[0].pbrMetallicRoughness.roughnessFactor = 2; },
    (f: ReturnType<typeof triangle>) => { f.root.materials[0].normalTexture.index = 99; },
    (f: ReturnType<typeof triangle>) => { f.root.materials[0].normalTexture.texCoord = 1; },
    (f: ReturnType<typeof triangle>) => { f.root.images[0].mimeType = 'image/jpeg'; },
    (f: ReturnType<typeof triangle>) => { f.root.images[0].bufferView = 0; },
  ])('validates PBR/texture references and values', (mutate) => {
    const fixture = triangle(); addPbr(fixture); mutate(fixture);
    expect(() => validateAsset(modelInput(fixture))).toThrow(BadRequestException);
  });
  it.each([
    (f: ReturnType<typeof triangle>) => { f.root.animations[0].channels[0].target.node = 99; },
    (f: ReturnType<typeof triangle>) => { f.root.animations[0].channels[0].target.path = 'weights'; },
    (f: ReturnType<typeof triangle>) => { f.root.animations[0].channels[0].target.path = 'rotation'; },
    (f: ReturnType<typeof triangle>) => { f.root.animations[0].samplers[0].interpolation = 'UNKNOWN'; },
    (f: ReturnType<typeof triangle>) => { f.root.accessors[3].count = 1; },
    (f: ReturnType<typeof triangle>) => { f.root.animations[0].channels.push(f.root.animations[0].channels[0]); },
    (f: ReturnType<typeof triangle>) => { f.bin.writeFloatLE(0, f.root.bufferViews[2].byteOffset + 4); },
  ])('validates retained animation metadata', (mutate) => {
    const fixture = triangle(); addAnimation(fixture); mutate(fixture);
    expect(() => validateAsset(modelInput(fixture))).toThrow(BadRequestException);
  });
});

describe('strict asset import boundary', () => {
  it.each([null, [], 42, {}, { ...texture(), name: '' }, { ...texture(), name: '../x.png' }, { ...texture(), name: 'C:\\x.png' },
    { ...texture(), name: '<html>' }, { ...texture(), name: 'a\r\nb' }, { ...texture(), name: 'a'.repeat(161) },
    { ...texture(), attribution: '' }, { ...texture(), attribution: 'a'.repeat(2001) }, { ...texture(), attribution: 42 },
    { ...texture(), mimeType: 'image/svg+xml' }, { ...texture(), mimeType: 'image/png; charset=utf-8' },
    { ...texture(), data: { base64: PNG } }, { ...texture(), source: 'generated' }, { ...texture(), id: randomUUID() },
    { ...texture(), url: 'https://example.com' }, { ...texture(), bounds: {} }, { ...texture(), sha256: 'client-issued' }])('rejects invalid or unrecognized body fields', (value) => {
    expect(() => validateAssetInput(value)).toThrow(BadRequestException);
  });
  it('trims display metadata without inventing attribution', () => {
    expect(validateAssetInput({ ...texture(), name: ' texture.png ', attribution: ' Artist ' })).toMatchObject({ name: 'texture.png', attribution: 'Artist' });
    expect(validateAssetInput(texture())).not.toHaveProperty('attribution');
  });
});

describe('immutable AssetStore and HTTP controller', () => {
  let directory: string;
  let config: AppConfig;
  let store: AssetStore;
  let app: NestExpressApplication | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-assets-'));
    config = { port: 4000, aiMode: 'mock', dataDir: directory };
    store = new AssetStore(config); await store.onModuleInit();
  });
  afterEach(async () => { await app?.close(); app = undefined; await rm(directory, { recursive: true, force: true }); });

  it.each([true, false])('imports, serves identical bytes and survives restart (GLB=%s)', async (binary) => {
    const input = { ...modelInput(triangle(), binary), attribution: 'Model supplied by local user' };
    const resource = await store.import(input);
    expect(resource).toMatchObject({ name: input.name, kind: 'model', mimeType: input.mimeType, bytes: Buffer.from(input.data, 'base64').length,
      source: 'user-upload', attribution: input.attribution, triangles: 1, bounds: { min: [0, 0, 0], max: [2, 1, 0] } });
    expect(resource.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(resource.url).toBe(`/api/assets/${resource.id}/file`);
    expect(resource.sha256).toBe(createHash('sha256').update(Buffer.from(input.data, 'base64')).digest('hex'));
    expect(resource).not.toHaveProperty('data');
    expect(await store.read(resource.id)).toEqual({ resource, data: Buffer.from(input.data, 'base64') });
    const restarted = new AssetStore(config); await restarted.onModuleInit();
    expect(restarted.list()).toEqual([resource]);
    expect(await restarted.read(resource.id)).toEqual({ resource, data: Buffer.from(input.data, 'base64') });
    expect(await readdir(join(directory, 'assets'))).toEqual([`${resource.id}.json`]);
  });
  it('imports PNG/JPEG textures and never exposes binary in metadata', async () => {
    const png = await store.import(texture()); const jpeg = await store.import(texture(JPEG, 'image/jpeg'));
    expect(png).toMatchObject({ kind: 'texture', width: 1, height: 1, source: 'user-upload' });
    expect(png).not.toHaveProperty('bounds'); expect(png).not.toHaveProperty('attribution');
    expect((await store.read(jpeg.id)).data).toEqual(Buffer.from(JPEG, 'base64'));
    expect(JSON.stringify(new AssetsController(store).list())).not.toContain(PNG);
    const restarted = new AssetStore(config); await restarted.onModuleInit();
    expect(restarted.get(png.id)).toEqual(png); expect(restarted.get(jpeg.id)).toEqual(jpeg);
  });
  it('isolates catalog entries from projects and caller mutation', async () => {
    await mkdir(join(directory, 'projects')); await writeFile(join(directory, 'projects', 'sentinel.json'), 'project data');
    const first = await store.import(modelInput());
    const original = structuredClone(first);
    first.name = 'mutated'; first.bounds!.min[0] = -99;
    store.get(first.id)!.bounds!.max[0] = 99;
    store.list()[0].source = 'not-uploaded' as never;
    const read = await store.read(first.id); read.resource.name = 'changed'; read.data.fill(0);
    expect(store.get(first.id)).toEqual(original);
    expect((await store.read(first.id)).data).toEqual(Buffer.from(modelInput().data, 'base64'));
    const second = await store.import(modelInput());
    expect(second.id).not.toBe(first.id); expect(second.sha256).toBe(first.sha256);
    expect(await readFile(join(directory, 'projects', 'sentinel.json'), 'utf8')).toBe('project data');
  });
  it('serializes concurrent writes and keeps queue usable after validation failure', async () => {
    const results = await Promise.allSettled([store.import(texture()), store.import(texture('abcd')), ...Array.from({ length: 8 }, () => store.import(modelInput()))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(9);
    expect(results[1].status).toBe('rejected');
    expect(store.list()).toHaveLength(9);
    const restarted = new AssetStore(config); await restarted.onModuleInit();
    expect(restarted.list()).toEqual(store.list());
    expect((await readdir(join(directory, 'assets'))).every((name) => name.endsWith('.json'))).toBe(true);
  });
  it('does not publish failed disk writes and recovers the queue', async () => {
    const assets = join(directory, 'assets'); const moved = join(directory, 'assets-backup');
    await rename(assets, moved); await writeFile(assets, 'not a directory');
    await expect(store.import(texture())).rejects.toThrow(); expect(store.list()).toEqual([]);
    await rm(assets); await rename(moved, assets);
    await expect(store.import(texture())).resolves.toMatchObject({ kind: 'texture' });
  });
  it('rejects unsafe imports without persisting any file', async () => {
    const fixture = triangle(); fixture.root.buffers[0].uri = '../secret.bin';
    for (const input of [modelInput(fixture, false), texture(Buffer.from('<html>').toString('base64')), { ...texture(), name: '../escape.png' }]) {
      await expect(store.import(input)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(store.list()).toEqual([]); expect(await readdir(join(directory, 'assets'))).toEqual([]);
  });
  it('does not use ids or display names as caller-controlled file paths', async () => {
    for (const id of ['../config', '..\\config', '/etc/passwd', randomUUID()]) {
      expect(store.get(id)).toBeUndefined(); await expect(store.read(id)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
  it('ignores interrupted/corrupt records and checks content integrity on read and restart', async () => {
    const resource = await store.import(texture());
    const path = join(directory, 'assets', `${resource.id}.json`);
    const raw = await readFile(path, 'utf8');
    const record = JSON.parse(raw); record.data = JPEG;
    await writeFile(path, JSON.stringify(record));
    await writeFile(join(directory, 'assets', `${randomUUID()}.json`), '{broken');
    await writeFile(join(directory, 'assets', `${randomUUID()}.tmp`), raw);
    await writeFile(join(directory, 'assets', 'not-an-id.json'), raw);
    await expect(store.read(resource.id)).rejects.toThrow(/integrity/);
    const restarted = new AssetStore(config); await restarted.onModuleInit(); expect(restarted.list()).toEqual([]);
  });
  it('recomputes trusted metadata on restart instead of trusting modified bounds or URLs', async () => {
    const resource = await store.import(modelInput());
    const path = join(directory, 'assets', `${resource.id}.json`);
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.resource.bounds = { min: [-1e9, -1e9, -1e9], max: [1e9, 1e9, 1e9] };
    record.resource.url = 'https://example.com/remote'; record.resource.source = 'generated'; record.resource.triangles = 0;
    await writeFile(path, JSON.stringify(record));
    const restarted = new AssetStore(config); await restarted.onModuleInit();
    expect(restarted.get(resource.id)).toEqual(resource);
  });
  it('exposes only the intended routes and a self-contained module provider/export', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AssetsController)).toBe('assets');
    for (const [method, verb, path] of [['list', RequestMethod.GET, '/'], ['import', RequestMethod.POST, '/'], ['file', RequestMethod.GET, ':id/file']] as const) {
      expect(Reflect.getMetadata(METHOD_METADATA, AssetsController.prototype[method])).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, AssetsController.prototype[method])).toBe(path);
    }
    for (const method of ['list', 'import'] as const) expect(Reflect.getMetadata(HEADERS_METADATA, AssetsController.prototype[method])).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AssetsModule)).toEqual([AssetStore]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AssetsModule)).toContainEqual({ provide: APP_CONFIG, useFactory: loadConfig });
  });
  it('serves actual binary with safe headers and respects existing global local-client security', async () => {
    @Module({}) class TestModule {}
    app = await NestFactory.create<NestExpressApplication>({ module: TestModule, controllers: [AssetsController], providers: [{ provide: AssetStore, useValue: store }] }, { logger: false });
    app.setGlobalPrefix('api'); app.useBodyParser('json', { limit: '12mb' }); app.use(localApiSecurity(4000));
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const http = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; data: Buffer }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, path, headers: { host: 'localhost:4000', 'content-type': 'application/json', ...headers } }, (res) => {
        const chunks: Buffer[] = []; res.on('data', (data: Buffer) => chunks.push(data));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, data: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    expect((await http('POST', '/api/assets', texture())).status).toBe(403);
    expect((await http('POST', '/api/assets', texture(), { 'x-studio-client': 'wrong' })).status).toBe(403);
    expect((await http('POST', '/api/assets', texture(), { 'x-studio-client': 'local-ui', origin: 'https://attacker.example' })).status).toBe(403);
    expect((await http('POST', '/api/assets', { ...texture(), url: 'https://example.com' }, { 'x-studio-client': 'local-ui' })).status).toBe(400);
    for (const input of [texture(), texture(JPEG, 'image/jpeg'), modelInput(), modelInput(triangle(), false)]) {
      const imported = await http('POST', '/api/assets', input, { 'x-studio-client': 'local-ui' });
      expect(imported.status).toBe(201); expect(imported.headers['cache-control']).toBe('no-store');
      const resource = JSON.parse(imported.data.toString()); expect(resource).not.toHaveProperty('data');
      const file = await http('GET', resource.url);
      expect(file.status).toBe(200); expect(file.data).toEqual(Buffer.from(input.data, 'base64'));
      expect(file.headers['content-type']).toBe(input.mimeType);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      expect(file.headers.etag).toBe(`"${resource.sha256}"`);
      expect(Number(file.headers['content-length'])).toBe(file.data.length);
    }
    const list = await http('GET', '/api/assets'); expect(JSON.parse(list.data.toString()).assets).toHaveLength(4);
    expect((await http('GET', `/api/assets/${randomUUID()}/file`)).status).toBe(404);
    expect((await http('GET', '/api/assets/not-a-uuid/file')).status).toBe(400);
    expect((await http('GET', '/api/assets', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});
