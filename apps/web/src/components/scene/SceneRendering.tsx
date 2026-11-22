import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { WorldRenderSettings, WorldSchema } from '@ai-three-studio/shared';
import type { ViewMode } from './CharacterExplorer';
import { createReferenceCamera } from './render-settings';

/** Separate cameras preserve the manually orbited editor view across exploration toggles. */
export function ViewportCamera({ world, mode, restoreToken }: { world: WorldSchema; mode: ViewMode; restoreToken: number }) {
  const { set, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const configKey = JSON.stringify(world.render?.camera);
  const reference = useMemo(() => createReferenceCamera(world), [world.id, configKey]);
  const target = useMemo(() => new THREE.Vector3(...(world.render?.camera?.target ?? [0, 1.7, 0])), [world.id, configKey]);
  const explorer = useMemo(() => new THREE.PerspectiveCamera(48, 1, 0.1, 420), []);
  useLayoutEffect(() => {
    set({ camera: mode === 'edit' ? reference : explorer });
  }, [set, mode, reference, explorer]);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    explorer.aspect = aspect;
    explorer.updateProjectionMatrix();
    if (reference instanceof THREE.PerspectiveCamera) reference.aspect = aspect;
    else Object.assign(reference, { left: -10 * aspect, right: 10 * aspect, top: 10, bottom: -10 });
    reference.updateProjectionMatrix();
  }, [size.width, size.height, reference, explorer]);
  useEffect(() => {
    const initial = createReferenceCamera(world, size.width / Math.max(1, size.height));
    reference.position.copy(initial.position);
    reference.quaternion.copy(initial.quaternion);
    reference.zoom = initial.zoom;
    reference.updateProjectionMatrix();
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
      controls.current.saveState();
    }
  }, [reference, restoreToken]);
  return (
    <OrbitControls ref={controls} camera={reference} makeDefault enabled={mode === 'edit'}
      target={target} enableDamping dampingFactor={0.065} minDistance={0.2} maxDistance={400}
      minZoom={0.02} maxZoom={100} minPolarAngle={0.001} maxPolarAngle={Math.PI - 0.001} />
  );
}

/** Priority 1 owns the frame only when bloom is enabled; ordinary R3F rendering otherwise. */
export function SceneRendering({ render }: { render?: WorldRenderSettings }) {
  const { gl, scene, camera, size, viewport } = useThree();
  const enabled = render?.bloom?.enabled === true;
  const pipeline = useRef<{ composer: EffectComposer; pass: RenderPass; bloom: UnrealBloomPass; output: OutputPass } | null>(null);
  useEffect(() => {
    const toneMapping = gl.toneMapping;
    const exposure = gl.toneMappingExposure;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = render?.exposure ?? 1.02;
    return () => { gl.toneMapping = toneMapping; gl.toneMappingExposure = exposure; };
  }, [gl, render?.exposure]);
  useEffect(() => {
    if (!enabled) return;
    const composer = new EffectComposer(gl);
    const pass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1, 0.4, 0.85);
    const output = new OutputPass();
    composer.addPass(pass);
    composer.addPass(bloom);
    composer.addPass(output);
    pipeline.current = { composer, pass, bloom, output };
    return () => {
      pipeline.current = null;
      pass.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
    };
  }, [gl, scene, enabled]);
  useEffect(() => {
    pipeline.current?.composer.setPixelRatio(viewport.dpr);
    pipeline.current?.composer.setSize(size.width, size.height);
  }, [enabled, size.width, size.height, viewport.dpr]);
  useEffect(() => {
    if (!pipeline.current || !render?.bloom) return;
    Object.assign(pipeline.current.bloom, {
      strength: render.bloom.strength, radius: render.bloom.radius, threshold: render.bloom.threshold,
    });
  }, [enabled, render?.bloom]);
  useFrame((state, delta) => {
    if (!enabled) return;
    const current = pipeline.current;
    if (!current) { state.gl.render(state.scene, state.camera); return; }
    current.pass.camera = state.camera;
    current.composer.render(delta);
  }, enabled ? 1 : 0);
  return null;
}
