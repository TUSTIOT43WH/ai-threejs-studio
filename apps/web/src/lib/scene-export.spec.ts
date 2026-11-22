import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import * as THREE from 'three';
import type { WorldGeometry, WorldObject, WorldSchema } from '@ai-three-studio/shared';
import { createProceduralGeometry } from './procedural-geometry';
import { buildSceneModule, downloadSceneModule } from './scene-export';
import { getSceneTheme } from './environment-visuals';

// Generated modules are imported verbatim from memory; no test artifacts are written.
const threeURL = import.meta.resolve('three');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three' && context.parentURL?.startsWith('data:')) {
      return { url: threeURL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function loadModule(source: string): Promise<{
  worldSchema: WorldSchema;
  createWorld: () => THREE.Scene;
}> {
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function fixture() {
  const objects: WorldObject[] = ['__proto__', 'water', 'rock'].map((id, index) => ({
    id, name: `Object ${index}`, kind: index === 1 ? 'water' : 'rock',
    asset: { id: `asset-${index}`, source: 'procedural', format: 'primitive-group', provider: 'test', mock: true },
    transform: { position: [index, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tags: [],
  }));
  const world: WorldSchema = {
    schemaVersion: 1, id: 'world-test', title: 'Test world', summary: 'A static snapshot',
    source: {
      prompt: 'test', conceptId: 'concept', conceptTitle: 'test', conceptStyleId: 'low-poly',
      provider: { name: 'test', mode: 'mock', vision: 'test', planner: 'test' },
      generatedAt: '', disclaimer: '',
    },
    environment: { season: 'summer', weather: 'clear', timeOfDay: 'day', sunIntensity: 2, ambientIntensity: 0.6, fogDensity: 0.01 },
    objects, spawnPoint: { position: [0, 0, 0], yawDeg: 0 }, gameplay: null,
    meta: { createdAt: '', updatedAt: '', editable: true, mock: true, objectCount: objects.length },
  };
  const scene = new THREE.Scene();
  scene.position.set(3, -2, 5);
  scene.background = new THREE.Color('#123456');
  const physics = new THREE.Group();
  physics.name = 'Physics wrapper';
  physics.position.set(10, 2, -4);
  physics.rotation.set(0.2, 0.6, -0.15);
  physics.scale.set(2, 3, 0.5);
  scene.add(physics);
  const roots = objects.map((object, i) => {
    const root = new THREE.Group();
    root.userData = { worldObjectId: object.id, objectKind: object.kind, selected: true };
    root.position.set(i * 4, 1, -2);
    root.rotation.set(0.1, 0.3 + i, 0.2);
    root.scale.set(0.5, 1.2, 2);
    physics.add(root);
    return root;
  });
  const material = new THREE.MeshStandardMaterial({ color: '#c08030', roughness: 0.31, metalness: 0.25 });
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  geometry.getAttribute('position').setX(0, 1.75); // Constructor parameters cannot reproduce this.
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `body-${i}`;
    mesh.position.set(i + 0.3, 2, -0.7);
    mesh.castShadow = true;
    roots[0].add(mesh);
    meshes.push(mesh);
  }
  const shader = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 37.5 }, uColor: { value: new THREE.Color('#abcdef') } },
    vertexShader: 'uniform float uTime; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 0.8); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), shader);
  water.name = 'water-mesh';
  water.rotation.x = -Math.PI / 2;
  roots[1].add(water);
  meshes.push(water);
  const custom = new THREE.BufferGeometry();
  custom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 1, 0], 3));
  custom.setIndex([0, 1, 2]);
  custom.addGroup(0, 3, 1);
  const rock = new THREE.Mesh(custom, [material, new THREE.MeshBasicMaterial({ color: 'red' })]);
  rock.name = 'custom-mesh';
  roots[2].add(rock);
  meshes.push(rock);
  for (const name of ['Grid', 'SelectionMarker', 'CharacterExplorer', 'Sky particles', 'Unknown world object']) {
    const overlay = new THREE.Mesh(new THREE.SphereGeometry(), material);
    overlay.name = name;
    overlay.userData = { worldObjectId: 'not-in-schema' };
    scene.add(overlay);
  }
  scene.add(new THREE.PerspectiveCamera());
  scene.updateWorldMatrix(false, true);
  // Deliberately leave world matrices stale; physics may also disable local updates.
  physics.rotation.y += 0.25;
  roots[0].position.y += 2;
  roots[2].matrixAutoUpdate = false;
  roots[2].matrix.makeTranslation(8, 6, -5);
  return { world, scene, roots, meshes, geometry, material, shader };
}

function expectedWorldMatrix(node: THREE.Object3D): THREE.Matrix4 {
  const local = node.matrixAutoUpdate
    ? new THREE.Matrix4().compose(node.position, node.quaternion, node.scale)
    : node.matrix.clone();
  return node.parent ? expectedWorldMatrix(node.parent).multiply(local) : local;
}

function assertMatrix(actual: THREE.Matrix4, expected: THREE.Matrix4) {
  actual.elements.forEach((value, index) => assert.ok(Math.abs(value - expected.elements[index]) < 1e-9));
}

function snapshot(scene: THREE.Scene) {
  const nodes: unknown[] = [];
  scene.traverse((node) => nodes.push({
    uuid: node.uuid, parent: node.parent?.uuid, children: node.children.map((child) => child.uuid),
    position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
    matrix: node.matrix.toArray(), matrixWorld: node.matrixWorld.toArray(),
    matrixAutoUpdate: node.matrixAutoUpdate, matrixWorldAutoUpdate: node.matrixWorldAutoUpdate,
    dirty: node.matrixWorldNeedsUpdate, userData: JSON.stringify(node.userData),
    name: node.name, visible: node.visible,
  }));
  return nodes;
}

test('exports every modeled object, exact world transforms and current complete geometry/materials', async () => {
  const { scene, world, meshes, geometry, material, shader } = fixture();
  const before = snapshot(scene);
  const schemaBefore = JSON.stringify(world);
  const vertices = Array.from(geometry.getAttribute('position').array);
  const module = await loadModule(buildSceneModule(scene, world));
  assert.deepEqual(snapshot(scene), before);
  assert.equal(JSON.stringify(world), schemaBefore);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), vertices);
  assert.equal(meshes[0].geometry, geometry);
  assert.equal(meshes[0].material, material);
  assert.equal(shader.uniforms.uTime.value, 37.5);
  const result = module.createWorld();
  assert.ok(result instanceof THREE.Scene);
  result.updateWorldMatrix(false, true);
  const roots = result.children.filter((child) => Object.hasOwn(child.userData, 'worldObjectId'));
  assert.deepEqual(roots.map((root) => root.userData.worldObjectId), world.objects.map((object) => object.id));
  assert.deepEqual(roots.map((root) => root.name), world.objects.map((object) => object.name));
  let meshCount = 0;
  result.traverse((node) => {
    assert.equal(Object.hasOwn(node.userData, 'selected'), false);
    assert.equal(node.animations.length, 0);
    if (node instanceof THREE.Mesh) meshCount++;
  });
  assert.equal(meshCount, meshes.length);
  for (const source of meshes) {
    const copy = result.getObjectByName(source.name) as THREE.Mesh;
    assert.ok(copy);
    assertMatrix(copy.matrixWorld, expectedWorldMatrix(source));
    assert.deepEqual(Array.from(copy.geometry.getAttribute('position').array), Array.from(source.geometry.getAttribute('position').array));
    assert.deepEqual(copy.geometry.groups, source.geometry.groups);
    assert.equal(copy.castShadow, source.castShadow);
  }
  const water = result.getObjectByName('water-mesh') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  assert.equal(water.material.vertexShader, shader.vertexShader);
  assert.equal(water.material.fragmentShader, shader.fragmentShader);
  assert.equal(water.material.uniforms.uTime.value, 37.5);
  assert.equal(water.material.depthWrite, false);
  const body = result.getObjectByName('body-0') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  assert.equal(body.material.roughness, material.roughness);
  assert.equal(body.material.color.getHex(), material.color.getHex());
  assert.ok(Array.isArray((result.getObjectByName('custom-mesh') as THREE.Mesh).material));
  const theme = getSceneTheme(world.environment);
  assert.equal((result.background as THREE.Color).getHex(), new THREE.Color(theme.skyBottom).getHex());
  assert.equal((result.fog as THREE.FogExp2).density, world.environment.fogDensity);
  assert.ok(result.children.some((node) => node instanceof THREE.HemisphereLight));
  assert.ok(result.children.some((node) => node instanceof THREE.DirectionalLight));
  const another = module.createWorld();
  body.material.color.set('black');
  body.geometry.getAttribute('position').setX(0, 99);
  water.material.uniforms.uTime.value = 0;
  assert.equal(material.color.getHexString(), 'c08030');
  assert.equal(geometry.getAttribute('position').getX(0), vertices[0]);
  assert.equal(shader.uniforms.uTime.value, 37.5);
  assert.equal(((another.getObjectByName('body-0') as THREE.Mesh).geometry.getAttribute('position').getX(0)), vertices[0]);
  assert.deepEqual(snapshot(scene), before);
});

test('exports native parametric geometry, reference camera and selected lighting without reverting to defaults', async () => {
  const { world } = fixture();
  const specs: WorldGeometry[] = [
    { type: 'lathe', points: [[0, 0], [1, 0], [1.2, 1], [0.4, 2], [0, 3]], segments: 32 },
    { type: 'extrude', points: [[-1, 0], [1, 0], [0, 2]], depth: 0.5, bevel: 0.05 },
    { type: 'tube', points: [[0, 0, 0], [1, 2, 0], [2, 1, 1]], radius: 0.1, segments: 32, radialSegments: 8 },
    { type: 'ribbon', points: [[-2, 0, 0], [0, 0, 1], [2, 0, 0]], width: 0.8, segments: 24 },
    { type: 'mesh', positions: [-1, 0, 0, 1, 0, 0, 0, 2, 0], indices: [0, 1, 2] },
  ];
  const scene = new THREE.Scene();
  const expected: number[][] = [];
  world.objects = specs.map((geometry, i) => {
    const object: WorldObject = { ...world.objects[0], id: `curve-${i}`, name: `curve-${i}`, kind: 'procedural', geometry };
    const root = new THREE.Group();
    root.userData.worldObjectId = object.id;
    const mesh = new THREE.Mesh(createProceduralGeometry(geometry), new THREE.MeshStandardMaterial());
    mesh.name = `mesh-${i}`;
    const positions = Array.from(mesh.geometry.getAttribute('position').array);
    assert.ok(positions.every(Number.isFinite));
    expected.push(positions.map((value) => value === 0 ? 0 : value)); // JSON canonicalizes signed zero.
    root.add(mesh); scene.add(root);
    return object;
  });
  world.meta.objectCount = world.objects.length;
  world.render = {
    camera: { projection: 'orthographic', position: [10, 8, 12], target: [0, 2, 0], fov: 48, zoom: 1.4 },
    lights: [{ type: 'directional', color: '#ffcc88', intensity: 2.5, position: [-8, 10, 6], target: [0, 2, 0], castShadow: true }],
    fog: { color: '#778899', density: 0.002 }, exposure: 1.2,
  };
  const module = await loadModule(buildSceneModule(scene, world));
  const exported = module.createWorld();
  assert.deepEqual(module.worldSchema.render, world.render);
  assert.ok(exported.getObjectByName('reference-camera') instanceof THREE.OrthographicCamera);
  assert.equal((exported.getObjectByName('reference-camera') as THREE.OrthographicCamera).zoom, 1.4);
  const light = exported.children.find((node) => node instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
  assert.deepEqual(light.position.toArray(), [-8, 10, 6]);
  assert.deepEqual(light.target.position.toArray(), [0, 2, 0]);
  assert.equal(light.intensity, 2.5);
  assert.equal((exported.fog as THREE.FogExp2).density, 0.002);
  for (let i = 0; i < specs.length; i++) {
    const mesh = exported.getObjectByName(`mesh-${i}`) as THREE.Mesh;
    assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array), expected[i]);
    mesh.geometry.dispose();
  }
  scene.traverse((node) => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
});

test('malicious names, descriptions and __proto__ remain inert data during Node import', async () => {
  const { scene, world, roots } = fixture();
  const attack = '`; globalThis.__sceneExportExecuted = true; // ${globalThis.__sceneExportExecuted = true}</script>\u2028\u2029\\\"\n';
  world.title = attack;
  world.summary = attack;
  world.source.prompt = attack;
  world.objects[0].name = attack;
  const poison = JSON.parse('{"__proto__":{"sceneExportPolluted":true},"constructor":{"prototype":{"sceneExportPolluted":true}}}');
  world.objects[0].params = poison;
  roots[0].userData.payload = poison;
  const source = buildSceneModule(scene, world);
  assert.equal(source.includes('</script>'), false);
  assert.equal(source.includes('\u2028'), false);
  assert.equal(source.includes('\u2029'), false);
  const module = await loadModule(source);
  assert.deepEqual(module.worldSchema, world);
  assert.ok(Object.hasOwn(module.worldSchema.objects[0].params!, '__proto__'));
  const result = module.createWorld();
  assert.equal(result.name, attack);
  assert.ok(result.getObjectByName(attack));
  assert.equal(Reflect.get(globalThis, '__sceneExportExecuted'), undefined);
  assert.equal(Reflect.get(Object.prototype, 'sceneExportPolluted'), undefined);
});

test('missing, empty and ambiguous objects fail rather than producing partial files', () => {
  const { scene, world, roots } = fixture();
  const before = snapshot(scene);
  assert.throws(() => buildSceneModule(new THREE.Scene(), world), /场景仍在加载，请稍后导出/);
  assert.throws(() => buildSceneModule(scene, { ...world, objects: [] }), /场景仍在加载，请稍后导出/);
  assert.throws(() => buildSceneModule(scene, { ...world, objects: [...world.objects, world.objects[0]] }), /ID 重复/);
  const duplicate = roots[0].clone();
  scene.add(duplicate);
  assert.throws(() => buildSceneModule(scene, world), /场景仍在加载，请稍后导出/);
  scene.remove(duplicate);
  assert.deepEqual(snapshot(scene), before);
  roots[2].clear();
  assert.throws(() => buildSceneModule(scene, world), /场景仍在加载，请稍后导出/);
});

test('nested world roots are exported once and retain world-space placement', async () => {
  const { scene, world, roots, meshes } = fixture();
  roots[0].add(roots[2]);
  const module = await loadModule(buildSceneModule(scene, world));
  const result = module.createWorld();
  result.updateWorldMatrix(false, true);
  for (const object of world.objects) {
    let count = 0;
    result.traverse((node) => { if (node.userData.worldObjectId === object.id) count++; });
    assert.equal(count, 1);
  }
  assertMatrix(result.getObjectByName('custom-mesh')!.matrixWorld, expectedWorldMatrix(meshes[3]));
});

test('embedded DataTextures work without a DOM; non-embedded image URLs are rejected', async () => {
  const { scene, world, material, shader } = fixture();
  const pixels = new Uint8Array([255, 128, 32, 255]);
  const texture = new THREE.DataTexture(pixels, 1, 1);
  material.map = texture;
  shader.uniforms.uTexture = { value: texture };
  const sourceVersion = texture.source.version;
  const module = await loadModule(buildSceneModule(scene, world));
  assert.equal(texture.source.version, sourceVersion);
  assert.equal(shader.uniforms.uTexture.value, texture);
  const body = module.createWorld().getObjectByName('body-0') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const image = body.material.map!.image as { data: ArrayLike<number> };
  assert.deepEqual(Array.from(image.data), Array.from(pixels));
  for (const url of ['https://example.invalid/texture.png', '../texture.png', 'blob:test', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    const external = new THREE.Texture();
    external.source.toJSON = (meta) => {
      const json = { uuid: external.source.uuid, url };
      if (meta && typeof meta === 'object') {
        (meta as { images: Record<string, THREE.TextureSourceJSON> }).images[json.uuid] = json;
      }
      return json;
    };
    material.map = external;
    assert.throws(() => buildSceneModule(scene, world), /无法安全导出/);
    assert.equal(material.map, external);
  }
});

test('download uses a JavaScript Blob, world ID filename and releases the object URL', async (t) => {
  const { scene, world } = fixture();
  let downloaded: Blob | undefined;
  let clicked = false;
  let removed = false;
  const revoked: string[] = [];
  const callbacks: (() => void)[] = [];
  const link = { href: '', download: '', click: () => { clicked = true; }, remove: () => { removed = true; } };
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag: string) => { assert.equal(tag, 'a'); return link; },
    body: { appendChild: (node: unknown) => { assert.equal(node, link); } },
  } });
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { downloaded = blob; return 'blob:scene-export-test'; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { callbacks.push(callback); return 0; });
  try {
    downloadSceneModule(scene, world);
    assert.ok(downloaded);
    assert.equal(downloaded.type, 'text/javascript');
    assert.equal(link.download, 'world-test.three.js');
    assert.equal(link.href, 'blob:scene-export-test');
    assert.equal(clicked, true);
    assert.equal(removed, true);
    assert.deepEqual(revoked, []);
    callbacks.forEach((callback) => callback());
    assert.deepEqual(revoked, ['blob:scene-export-test']);
    const module = await loadModule(await downloaded.text());
    assert.equal(module.createWorld().userData.worldId, world.id);
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
