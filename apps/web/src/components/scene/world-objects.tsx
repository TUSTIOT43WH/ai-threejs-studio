import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import { createProceduralGeometry, ensureAmbientOcclusionUVs } from '../../lib/procedural-geometry';
import { applyMaterialOverrides, loadObjectResources, objectNeedsResources, objectResourceKey, type LoadedObjectResources } from '../../lib/scene-resources';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  SceneResource,
  SeasonId,
  WorldEnvironment,
  WorldObject,
} from '@ai-three-studio/shared';
import type { SceneTheme } from '../../lib/environment-visuals';
import {
  mixHex,
  windStrength,
} from '../../lib/environment-visuals';

interface ObjectProps {
  object: WorldObject & { params?: Record<string, string | number | boolean> };
  environment: WorldEnvironment;
  theme: SceneTheme;
}

export interface ObjectAssetStatus {
  state: 'loading' | 'ready' | 'error';
  message?: string;
}

interface WorldObjectViewProps extends ObjectProps {
  selected: boolean;
  onSelect: (objectId: string) => void;
  resources?: SceneResource[];
  retryToken?: number;
  onAssetStatus?: (id: string, status: ObjectAssetStatus) => void;
}

function useSway(
  ref: React.RefObject<THREE.Group | null>,
  phase: number,
  weather: WorldEnvironment['weather'],
) {
  useFrame((state) => {
    if (!ref.current) return;
    const time = state.clock.elapsedTime;
    const wind = windStrength(weather);
    ref.current.rotation.z =
      Math.sin(time * 1.15 + phase) * 0.018 * wind +
      Math.sin(time * 2.4 + phase * 0.6) * 0.005 * wind;
    ref.current.rotation.x =
      Math.cos(time * 0.92 + phase * 1.4) * 0.012 * wind;
  });
}

function usePhase(object: WorldObject): number {
  const seed = object.kind === 'primitive' ? 0 : Number(object.params?.seed ?? 0);
  return (Number.isFinite(seed) ? seed : 0) % (Math.PI * 2);
}

function objectBaseColor(
  object: WorldObject,
  fallback: string,
): string {
  return object.material?.color ?? fallback;
}

function objectRoughness(object: WorldObject, fallback: number): number {
  const value = object.material?.roughness;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function objectMetalness(object: WorldObject, fallback: number): number {
  const value = object.material?.metalness;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function materialOpacity(object: WorldObject): number | undefined {
  return object.material?.opacity;
}

function isWet(environment: WorldEnvironment): boolean {
  return (
    environment.weather === 'light-rain' ||
    environment.weather === 'heavy-rain'
  );
}

function seasonalSurface(
  base: string,
  environment: WorldEnvironment,
  theme: SceneTheme,
): string {
  if (environment.season === 'winter') {
    return mixHex(base, theme.snowCap, 0.72);
  }
  return mixHex(base, theme.groundTint, 0.45);
}

function GroundObject({ object, environment, theme }: ObjectProps) {
  const variant = String(object.params?.variant ?? 'grass');
  const seasonal = Boolean(object.params?.seasonal);
  const base = objectBaseColor(object, theme.groundTint);
  const color = seasonal
    ? variant === 'sand'
      ? mixHex(base, environment.season === 'winter' ? theme.snowCap : '#d9c59a', 0.6)
      : seasonalSurface(base, environment, theme)
    : base;
  const wet = isWet(environment);

  return (
    <mesh receiveShadow position={[0, -0.3, 0]}>
      <boxGeometry args={[1, 0.6, 1]} />
      <meshStandardMaterial
        color={wet ? mixHex(color, '#39434a', 0.22) : color}
        roughness={
          wet
            ? objectRoughness(
                object,
                environment.weather === 'heavy-rain' ? 0.28 : 0.4,
              ) * 0.55
            : objectRoughness(object, 0.96)
        }
        metalness={Math.min(
          1,
          objectMetalness(object, 0) + (wet ? 0.05 : 0),
        )}
      />
    </mesh>
  );
}

function HillsObject({ object, environment, theme }: ObjectProps) {
  const base = objectBaseColor(object, theme.foliage);
  const color =
    environment.season === 'winter'
      ? mixHex(base, theme.snowCap, 0.62)
      : mixHex(base, theme.groundTint, 0.16);

  return (
    <>
      <mesh castShadow receiveShadow position={[0, -0.02, 0]}>
        <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={color}
          roughness={objectRoughness(object, 1)}
          metalness={objectMetalness(object, 0)}
          flatShading
        />
      </mesh>
      {environment.season === 'winter' ? (
        <mesh position={[0, 0.16, 0]} scale={[0.72, 1.02, 0.72]}>
          <sphereGeometry args={[1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2.25]} />
          <meshStandardMaterial
            color={theme.snowCap}
            roughness={0.9}
            flatShading
          />
        </mesh>
      ) : null}
    </>
  );
}

function WaterObject({ object, environment, theme }: ObjectProps) {
  const frozen = Boolean(object.params?.frozen);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const surface = objectBaseColor(object, theme.waterShallow);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(surface) },
      uDeep: { value: new THREE.Color(mixHex(surface, theme.waterDeep, 0.62)) },
      uSky: { value: new THREE.Color(theme.skyBottom) },
    }),
    [surface, theme.waterDeep, theme.skyBottom],
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime!.value = state.clock.elapsedTime;
    }
  });

  if (frozen) {
    return (
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial
          color={surface}
          roughness={objectRoughness(object, 0.5)}
          metalness={objectMetalness(object, 0.06)}
        />
      </mesh>
    );
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        vertexShader={`
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.z += sin(position.x * 7.0 + uTime * 0.75) * 0.012;
            p.z += cos(position.y * 6.0 - uTime * 0.55) * 0.012;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform vec3 uShallow;
          uniform vec3 uDeep;
          uniform vec3 uSky;
          varying vec2 vUv;
          void main() {
            float wave = sin(vUv.x * 18.0 + uTime * 0.6) * cos(vUv.y * 14.0 - uTime * 0.45);
            float shimmer = smoothstep(0.35, 1.0, wave * 0.5 + 0.5);
            vec3 color = mix(uDeep, uShallow, 0.2 + shimmer * 0.66);
            color = mix(color, uSky, 0.16);
            float edge = smoothstep(0.0, 0.08, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
            gl_FragColor = vec4(color, 0.88 * edge + 0.1);
          }
        `}
      />
    </mesh>
  );
}

function PineTree({ object, environment, theme }: ObjectProps) {
  const sway = useRef<THREE.Group>(null);
  const phase = usePhase(object);
  useSway(sway, phase, environment.weather);
  const base = objectBaseColor(object, theme.foliage);
  const foliage =
    environment.season === 'winter'
      ? mixHex(base, theme.foliage, 0.55)
      : mixHex(base, theme.foliage, 0.68);
  const snow = environment.season === 'winter';

  const tiers = [
    { y: 1.45, height: 2.2, radius: 1.25 },
    { y: 2.55, height: 2.0, radius: 1.0 },
    { y: 3.55, height: 1.7, radius: 0.75 },
  ];

  return (
    <group ref={sway}>
      <mesh castShadow position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.18, 0.27, 1.5, 7]} />
        <meshStandardMaterial color="#5b4434" roughness={0.95} />
      </mesh>
      {tiers.map((tier, index) => (
        <mesh key={index} castShadow position={[0, tier.y, 0]}>
          <coneGeometry args={[tier.radius, tier.height, 7]} />
          <meshStandardMaterial
            color={foliage}
            roughness={objectRoughness(object, 0.9)}
            metalness={objectMetalness(object, 0)}
            flatShading
          />
        </mesh>
      ))}
      {snow
        ? tiers.map((tier, index) => (
            <mesh
              key={`snow-${index}`}
              position={[0, tier.y + tier.height * 0.23, 0]}
              castShadow
            >
              <coneGeometry
                args={[tier.radius * 0.7, tier.height * 0.42, 7]}
              />
              <meshStandardMaterial
                color={theme.snowCap}
                roughness={0.88}
                flatShading
              />
            </mesh>
          ))
        : null}
    </group>
  );
}

function BroadleafTree({ object, environment, theme }: ObjectProps) {
  const sway = useRef<THREE.Group>(null);
  const phase = usePhase(object);
  useSway(sway, phase, environment.weather);
  const base = objectBaseColor(object, theme.foliage);
  const foliage =
    environment.season === 'winter'
      ? mixHex(base, theme.foliage, 0.55)
      : mixHex(base, theme.foliage, 0.7);
  const palettes: Record<SeasonId, string[]> = {
    spring: [foliage, mixHex(foliage, theme.accent, 0.42), theme.accent],
    summer: [foliage, mixHex(foliage, '#8ac46c', 0.35), mixHex(foliage, '#2f7046', 0.25)],
    autumn: [
      foliage,
      mixHex(foliage, '#b43e28', 0.5),
      mixHex(foliage, '#e7b13f', 0.45),
    ],
    winter: [foliage, mixHex(foliage, theme.snowCap, 0.2)],
  };
  const colors = palettes[environment.season];
  const clusters = [
    { position: [-0.75, 2.7, 0.2] as const, scale: 0.95, color: 0 },
    { position: [0.72, 2.55, -0.2] as const, scale: 0.85, color: 1 },
    { position: [0.05, 3.35, 0.05] as const, scale: 0.8, color: 2 },
    { position: [0.1, 2.5, 0.75] as const, scale: 0.72, color: 0 },
    { position: [-0.3, 3.1, -0.55] as const, scale: 0.65, color: 1 },
  ];

  return (
    <group ref={sway}>
      <mesh castShadow position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.2, 0.32, 2.2, 7]} />
        <meshStandardMaterial color="#6a4c38" roughness={0.95} />
      </mesh>
      {clusters.map((cluster, index) => (
        <mesh
          key={index}
          castShadow
          position={[...cluster.position]}
          scale={[
            cluster.scale,
            cluster.scale * 0.82,
            cluster.scale,
          ]}
        >
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={colors[cluster.color % colors.length]}
            roughness={objectRoughness(object, 0.92)}
            metalness={objectMetalness(object, 0)}
            flatShading
          />
        </mesh>
      ))}
      {environment.season === 'winter'
        ? clusters.slice(0, 3).map((cluster, index) => (
            <mesh
              key={`cap-${index}`}
              position={[
                cluster.position[0],
                cluster.position[1] + cluster.scale * 0.65,
                cluster.position[2],
              ]}
              scale={[
                cluster.scale * 0.72,
                cluster.scale * 0.28,
                cluster.scale * 0.72,
              ]}
            >
              <icosahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color={theme.snowCap} roughness={0.9} flatShading />
            </mesh>
          ))
        : null}
      {environment.season === 'spring'
        ? clusters.slice(1, 3).map((cluster, index) => (
            <mesh
              key={`bloom-${index}`}
              position={[
                cluster.position[0] + 0.35,
                cluster.position[1] - 0.2,
                cluster.position[2] + 0.45,
              ]}
              scale={0.28}
            >
              <icosahedronGeometry args={[1, 0]} />
              <meshStandardMaterial
                color={theme.accent}
                roughness={0.7}
                flatShading
              />
            </mesh>
          ))
        : null}
    </group>
  );
}

function PalmTree({ object, environment, theme }: ObjectProps) {
  const sway = useRef<THREE.Group>(null);
  const phase = usePhase(object);
  useSway(sway, phase, environment.weather);
  const base = objectBaseColor(object, theme.foliage);
  const foliage =
    environment.season === 'winter'
      ? mixHex(base, theme.foliage, 0.6)
      : mixHex(base, theme.foliage, 0.72);

  return (
    <group ref={sway}>
      <mesh castShadow rotation={[0, 0, 0.06]} position={[0.1, 1.75, 0]}>
        <cylinderGeometry args={[0.17, 0.28, 3.5, 7]} />
        <meshStandardMaterial color="#77583c" roughness={0.92} />
      </mesh>
      {Array.from({ length: 7 }, (_, index) => {
        const angle = (index / 7) * Math.PI * 2;
        return (
          <mesh
            key={index}
            castShadow
            position={[
              Math.cos(angle) * 0.9,
              3.45 + (index % 2) * 0.12,
              Math.sin(angle) * 0.9,
            ]}
            rotation={[Math.sin(angle) * 0.5, -angle, Math.cos(angle) * 0.5 + 0.9]}
          >
            <coneGeometry args={[0.34, 2.8, 4]} />
            <meshStandardMaterial
              color={foliage}
              roughness={objectRoughness(object, 0.9)}
              metalness={objectMetalness(object, 0)}
              flatShading
            />
          </mesh>
        );
      })}
      {environment.season === 'winter' ? (
        <mesh position={[0, 3.65, 0]} scale={[0.55, 0.24, 0.55]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={theme.snowCap} roughness={0.9} flatShading />
        </mesh>
      ) : null}
    </group>
  );
}

function TreeObject(props: ObjectProps) {
  const variant = String(props.object.params?.variant ?? 'broadleaf');
  if (variant === 'pine') return <PineTree {...props} />;
  if (variant === 'palm') return <PalmTree {...props} />;
  return <BroadleafTree {...props} />;
}

function gableGeometry(width: number, depth: number, height: number): THREE.BufferGeometry {
  const w = width / 2;
  const d = depth / 2;
  const positions = new Float32Array([
    -w, 0, -d,
    -w, 0, d,
    0, height, d,
    -w, 0, -d,
    0, height, d,
    0, height, -d,
    w, 0, d,
    w, 0, -d,
    0, height, -d,
    w, 0, d,
    0, height, -d,
    0, height, d,
    -w, 0, d,
    w, 0, d,
    0, height, d,
    w, 0, -d,
    -w, 0, -d,
    0, height, -d,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function GableRoof({
  width,
  depth,
  height,
  color,
  y,
  roughness = 0.86,
  metalness = 0,
}: {
  width: number;
  depth: number;
  height: number;
  color: string;
  y: number;
  roughness?: number;
  metalness?: number;
}) {
  const geometry = useMemo(() => gableGeometry(width, depth, height), [width, depth, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow position={[0, y, 0]}>
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        flatShading
      />
    </mesh>
  );
}

function Window({
  position,
  rotation = [0, 0, 0],
  lit,
  width = 0.62,
  height = 0.72,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  lit: boolean;
  width?: number;
  height?: number;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={[width, height, 0.08]} />
      <meshStandardMaterial
        color={lit ? '#ffd18a' : '#3d5663'}
        emissive={lit ? '#ffb95c' : '#16242c'}
        emissiveIntensity={lit ? 1.5 : 0.2}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  );
}

function Smoke({ position }: { position: [number, number, number] }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current) return;
    const time = state.clock.elapsedTime;
    group.current.children.forEach((child, index) => {
      const cycle = (time * 0.22 + index * 0.24) % 1;
      child.position.y = cycle * 2.2;
      child.position.x = Math.sin(time * 0.5 + index) * 0.28 + cycle * 0.3;
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.opacity = Math.sin(cycle * Math.PI) * 0.32;
      const scale = 0.2 + cycle * 0.55;
      child.scale.setScalar(scale);
    });
  });
  return (
    <group ref={group} position={position}>
      {Array.from({ length: 4 }, (_, index) => (
        <mesh key={index}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial
            color="#dce5ea"
            transparent
            opacity={0.24}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function CabinObject({ object, environment, theme }: ObjectProps) {
  const wall = objectBaseColor(object, '#9b7652');
  const lit = Boolean(object.params?.lit);
  const dark = theme.isNight || theme.isDusk;
  const roofBase = mixHex('#5b3f2f', theme.accent, 0.08);
  const roof =
    environment.season === 'winter'
      ? mixHex(roofBase, theme.snowCap, 0.82)
      : roofBase;

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.45, 0]}>
        <boxGeometry args={[4.2, 2.9, 3.6]} />
        <meshStandardMaterial
          color={wall}
          roughness={objectRoughness(object, 0.88)}
          metalness={objectMetalness(object, 0)}
        />
      </mesh>
      <mesh castShadow position={[0, 1.15, 1.82]}>
        <boxGeometry args={[1.05, 1.85, 0.08]} />
        <meshStandardMaterial color="#34251c" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.4, 1.87]}>
        <boxGeometry args={[0.05, 1.5, 0.03]} />
        <meshStandardMaterial color="#b9a07b" roughness={0.8} />
      </mesh>
      <Window position={[-1.25, 1.75, 1.83]} lit={lit && dark} />
      <Window position={[1.25, 1.75, 1.83]} lit={lit && dark} />
      <Window
        position={[2.12, 1.75, 0]}
        rotation={[0, Math.PI / 2, 0]}
        lit={lit && dark}
      />
      <GableRoof
        width={5.1}
        depth={4.3}
        height={1.85}
        color={roof}
        y={2.9}
        roughness={objectRoughness(object, 0.86)}
        metalness={objectMetalness(object, 0)}
      />
      <mesh castShadow position={[1.35, 3.95, -0.65]}>
        <boxGeometry args={[0.55, 1.7, 0.55]} />
        <meshStandardMaterial color="#5b4b42" roughness={0.95} />
      </mesh>
      <mesh position={[1.35, 4.82, -0.65]}>
        <boxGeometry args={[0.68, 0.12, 0.68]} />
        <meshStandardMaterial color={theme.snowCap} roughness={0.9} />
      </mesh>
      <Smoke position={[1.35, 4.9, -0.65]} />
      {environment.season === 'winter' ? (
        <mesh position={[0, 0.08, 2.2]} scale={[3.8, 0.12, 0.8]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={theme.snowCap} roughness={0.95} />
        </mesh>
      ) : null}
    </group>
  );
}

function HouseObject({ object, environment, theme }: ObjectProps) {
  const wall = objectBaseColor(object, '#d5c5a8');
  const roofColor = String(object.params?.roof ?? '#8f5d47');
  const lit = Boolean(object.params?.lit);
  const dark = theme.isNight || theme.isDusk;
  const roof =
    environment.season === 'winter'
      ? mixHex(roofColor, theme.snowCap, 0.8)
      : roofColor;

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.3, 0]}>
        <boxGeometry args={[3.2, 2.6, 2.9]} />
        <meshStandardMaterial
          color={wall}
          roughness={objectRoughness(object, 0.88)}
          metalness={objectMetalness(object, 0)}
        />
      </mesh>
      <Window position={[-0.8, 1.45, 1.48]} lit={lit && dark} />
      <Window position={[0.8, 1.45, 1.48]} lit={lit && dark} />
      <mesh position={[0, 0.75, 1.48]}>
        <boxGeometry args={[0.82, 1.5, 0.1]} />
        <meshStandardMaterial color="#4a3b32" roughness={0.9} />
      </mesh>
      <GableRoof
        width={3.9}
        depth={3.5}
        height={1.4}
        color={roof}
        y={2.6}
        roughness={objectRoughness(object, 0.86)}
        metalness={objectMetalness(object, 0)}
      />
      {environment.season === 'winter' ? (
        <mesh position={[0, 0.06, 1.9]} scale={[2.8, 0.1, 0.75]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={theme.snowCap} roughness={0.95} />
        </mesh>
      ) : null}
    </group>
  );
}

function TentObject({ object, environment, theme }: ObjectProps) {
  const color = objectBaseColor(object, '#d5a25f');
  const lit = Boolean(object.params?.lit);
  const dark = theme.isNight || theme.isDusk;

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 1.25, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.8, 2.6, 4]} />
        <meshStandardMaterial
          color={color}
          roughness={objectRoughness(object, 0.86)}
          metalness={objectMetalness(object, 0)}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.65, 0.92]} rotation={[0.12, 0, 0]}>
        <planeGeometry args={[0.9, 1.3]} />
        <meshStandardMaterial
          color={lit && dark ? '#ffc878' : '#2b2621'}
          emissive={lit && dark ? '#ffb45d' : '#000000'}
          emissiveIntensity={lit && dark ? 1.2 : 0}
          side={THREE.DoubleSide}
        />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * 0.18, 2.5, 0]}
          rotation={[0, 0, side * 0.13]}
        >
          <cylinderGeometry args={[0.025, 0.025, 1.25, 5]} />
          <meshStandardMaterial color="#6c5540" roughness={0.9} />
        </mesh>
      ))}
      {environment.season === 'winter' ? (
        <mesh position={[0, 2.55, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[0.75, 0.5, 4]} />
          <meshStandardMaterial color={theme.snowCap} roughness={0.9} flatShading />
        </mesh>
      ) : null}
    </group>
  );
}

function TowerObject({ object, environment, theme }: ObjectProps) {
  const height = Math.max(4, Number(object.params?.height ?? 10));
  const neonIndex = Number(object.params?.neon ?? 0);
  const dark = theme.isNight || theme.isDusk;
  const shell = objectBaseColor(object, '#1b2129');
  const neon = neonIndex === 0 ? '#61f4e2' : neonIndex === 1 ? '#f0abfc' : '#ffb86b';
  const windowColor = neonIndex === 1 ? '#ffb7f4' : '#a6e9ff';
  const floors = Math.max(3, Math.floor(height / 2.4));

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[3.6, height, 3.6]} />
        <meshStandardMaterial
          color={shell}
          roughness={objectRoughness(object, 0.45)}
          metalness={objectMetalness(object, 0.55)}
        />
      </mesh>
      <mesh position={[0, height + 0.15, 0]}>
        <boxGeometry args={[3.95, 0.3, 3.95]} />
        <meshStandardMaterial color="#0f141b" roughness={0.6} metalness={0.5} />
      </mesh>
      {Array.from({ length: floors }, (_, index) => {
        const y = 1.6 + index * ((height - 2.2) / floors);
        return (
          <group key={index}>
            <mesh position={[0, y, 1.82]}>
              <boxGeometry args={[2.35, 0.14, 0.05]} />
              <meshStandardMaterial
                color={windowColor}
                emissive={windowColor}
                emissiveIntensity={dark ? 1.8 : 0.4}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0, y, -1.82]}>
              <boxGeometry args={[2.35, 0.14, 0.05]} />
              <meshStandardMaterial
                color={windowColor}
                emissive={windowColor}
                emissiveIntensity={dark ? 1.5 : 0.3}
                roughness={0.4}
              />
            </mesh>
          </group>
        );
      })}
      <mesh position={[1.84, height / 2, 1.84]}>
        <boxGeometry args={[0.05, height - 0.8, 0.05]} />
        <meshStandardMaterial
          color={neon}
          emissive={neon}
          emissiveIntensity={dark ? 2.4 : 0.5}
        />
      </mesh>
      <mesh position={[0, height + 1.1, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 1.8, 5]} />
        <meshStandardMaterial color="#303945" metalness={0.7} roughness={0.4} />
      </mesh>
      {dark ? (
        <pointLight
          position={[neonIndex === 0 ? -1.9 : 1.9, 3.2, 2.2]}
          color={neon}
          intensity={3.2}
          distance={9}
        />
      ) : null}
    </group>
  );
}

function LighthouseObject({ object, environment, theme }: ObjectProps) {
  const height = Math.min(16, Math.max(5, Number(object.params?.height ?? 8.5)));
  const dark = theme.isNight || theme.isDusk;
  const shell = objectBaseColor(object, '#eef2ee');
  const stone = mixHex(shell, '#6f7168', 0.5);
  const cap = '#b64a3f';
  const glow = '#ffd9a0';
  const baseHeight = 0.7;
  const radiusAt = (fraction: number): number =>
    1.3 + (0.78 - 1.3) * Math.min(1, Math.max(0, fraction));
  const galleryY = baseHeight + height + 0.1;
  const lanternY = galleryY + 0.85;
  const capY = lanternY + 0.55;

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[1.55, 1.85, 0.6, 10]} />
        <meshStandardMaterial
          color={environment.season === 'winter' ? mixHex(stone, theme.snowCap, 0.5) : stone}
          roughness={objectRoughness(object, 0.9)}
          metalness={objectMetalness(object, 0.05)}
          flatShading
        />
      </mesh>
      <mesh castShadow receiveShadow position={[0, baseHeight + height / 2, 0]}>
        <cylinderGeometry args={[0.78, 1.3, height, 14]} />
        <meshStandardMaterial
          color={shell}
          roughness={objectRoughness(object, 0.7)}
          metalness={objectMetalness(object, 0.05)}
        />
      </mesh>
      {[0.3, 0.52, 0.74].map((fraction) => {
        const radius = radiusAt(fraction) + 0.012;
        return (
          <mesh key={fraction} position={[0, baseHeight + height * fraction, 0]}>
            <cylinderGeometry args={[radius, radius, 0.34, 14]} />
            <meshStandardMaterial color={cap} roughness={0.62} />
          </mesh>
        );
      })}
      <mesh castShadow position={[0, galleryY, 0]}>
        <cylinderGeometry args={[1.12, 1.02, 0.18, 14]} />
        <meshStandardMaterial color={stone} roughness={0.75} metalness={0.2} />
      </mesh>
      <mesh castShadow position={[0, lanternY - 0.15, 0]}>
        <cylinderGeometry args={[0.58, 0.62, 1.05, 10]} />
        <meshStandardMaterial
          color={glow}
          emissive={glow}
          emissiveIntensity={dark ? 1.9 : 0.4}
          roughness={0.25}
          metalness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh castShadow position={[0, capY, 0]}>
        <coneGeometry args={[0.92, 0.85, 12]} />
        <meshStandardMaterial color={cap} roughness={0.55} />
      </mesh>
      <mesh position={[0, capY + 0.5, 0]}>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshStandardMaterial color={cap} roughness={0.5} metalness={0.35} />
      </mesh>
      <pointLight
        position={[0, lanternY, 0]}
        color={glow}
        intensity={dark ? 5 : 1.2}
        distance={dark ? 26 : 12}
        decay={2}
      />
    </group>
  );
}

function SignObject({ object, environment, theme }: ObjectProps) {
  const neon = objectBaseColor(object, '#61f4e2');
  const emissive = object.material?.emissive ?? neon;
  const dark = theme.isNight || theme.isDusk;

  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.22, 1.8, 2.8]} />
        <meshStandardMaterial
          color="#111820"
          roughness={objectRoughness(object, 0.45)}
          metalness={objectMetalness(object, 0.6)}
        />
      </mesh>
      {[-0.75, 0.75].map((z) => (
        <mesh key={z} position={[0.14, 0, z]}>
          <boxGeometry args={[0.06, 0.14, 1.35]} />
          <meshStandardMaterial
            color={emissive}
            emissive={emissive}
            emissiveIntensity={dark ? 2.6 : 0.8}
          />
        </mesh>
      ))}
      <mesh position={[0.14, 0.35, 0]}>
        <boxGeometry args={[0.04, 0.32, 1.5]} />
        <meshStandardMaterial
          color="#f8fff9"
          emissive={emissive}
          emissiveIntensity={dark ? 1.6 : 0.35}
        />
      </mesh>
      {environment.weather === 'heavy-rain' || environment.weather === 'light-rain' ? null : (
        <mesh position={[0.2, -0.62, 0]}>
          <boxGeometry args={[0.03, 0.02, 2.3]} />
          <meshBasicMaterial color={emissive} transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}

function LampObject({ object, environment, theme }: ObjectProps) {
  const dark = theme.isNight || theme.isDusk;
  const base = objectBaseColor(object, '#2e3a42');
  return (
    <group>
      <mesh castShadow position={[0, 1.9, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 3.8, 6]} />
        <meshStandardMaterial
          color={base}
          roughness={objectRoughness(object, 0.5)}
          metalness={objectMetalness(object, 0.4)}
        />
      </mesh>
      <mesh castShadow position={[0, 3.82, 0]}>
        <cylinderGeometry args={[0.36, 0.24, 0.22, 8]} />
        <meshStandardMaterial color="#26313a" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 3.62, 0]}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial
          color="#ffd599"
          emissive="#ffb95c"
          emissiveIntensity={dark ? 3.2 : 0.35}
        />
      </mesh>
      <pointLight
        position={[0, 3.6, 0]}
        color="#ffd29a"
        intensity={dark ? 7 : 0}
        distance={11}
        decay={2}
      />
    </group>
  );
}

function CampfireObject({ environment }: ObjectProps) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (light.current) {
      light.current.intensity = 10 + Math.sin(time * 9.2) * 2.2 + Math.sin(time * 15.7) * 1.1;
    }
    if (flame.current) {
      flame.current.scale.y = 0.92 + Math.sin(time * 11.3) * 0.1;
      flame.current.rotation.y = time * 0.7;
    }
  });

  return (
    <group>
      {Array.from({ length: 8 }, (_, index) => {
        const angle = (index / 8) * Math.PI * 2;
        return (
          <mesh
            key={index}
            castShadow
            position={[Math.cos(angle) * 0.95, 0.12, Math.sin(angle) * 0.95]}
            rotation={[0, angle, 0]}
          >
            <dodecahedronGeometry args={[0.22, 0]} />
            <meshStandardMaterial color="#5f5a54" roughness={0.95} flatShading />
          </mesh>
        );
      })}
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          castShadow
          position={[0, 0.18, 0]}
          rotation={[Math.PI / 2, (index / 3) * Math.PI, 0]}
        >
          <cylinderGeometry args={[0.11, 0.13, 1.2, 6]} />
          <meshStandardMaterial color="#4c3527" roughness={0.95} />
        </mesh>
      ))}
      <group ref={flame} position={[0, 0.4, 0]}>
        <mesh position={[0, 0.25, 0]}>
          <coneGeometry args={[0.4, 1.15, 8]} />
          <meshBasicMaterial color="#ff8a3d" transparent opacity={0.95} />
        </mesh>
        <mesh position={[0, 0.16, 0]}>
          <coneGeometry args={[0.24, 0.75, 7]} />
          <meshBasicMaterial color="#ffdd88" transparent opacity={0.95} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[1.8, 32]} />
        <meshBasicMaterial color="#ffb36a" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <pointLight
        ref={light}
        position={[0, 1.2, 0]}
        color="#ff9f5d"
        intensity={environment.weather === 'snow' ? 12 : 9}
        distance={13}
        decay={2}
      />
    </group>
  );
}

function BoatObject({ object, environment, theme }: ObjectProps) {
  const inner = useRef<THREE.Group>(null);
  const wind = windStrength(environment.weather);
  useFrame((state) => {
    if (!inner.current) return;
    const time = state.clock.elapsedTime;
    inner.current.position.y = Math.sin(time * 0.9) * 0.07;
    inner.current.rotation.z = Math.sin(time * 0.75) * (0.025 + wind * 0.035);
    inner.current.rotation.x = Math.cos(time * 0.65) * 0.02;
  });
  const hull = objectBaseColor(object, '#6f4d36');
  return (
    <group ref={inner} position={[0, 0.28, 0]}>
      <mesh castShadow scale={[0.55, 0.42, 1.35]}>
        <sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={hull}
          roughness={objectRoughness(object, 0.8)}
          metalness={objectMetalness(object, 0)}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh castShadow position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 2.7, 6]} />
        <meshStandardMaterial color="#47352a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.35, 0]} rotation={[0, 0.12, 0]}>
        <planeGeometry args={[1.35, 1.65]} />
        <meshStandardMaterial color={theme.snowCap} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function RockObject({ object, environment, theme }: ObjectProps) {
  const color = mixHex(
    objectBaseColor(object, '#6a6e6b'),
    environment.season === 'winter' ? theme.snowCap : theme.groundTint,
    environment.season === 'winter' ? 0.5 : 0.08,
  );
  return (
    <>
      <mesh castShadow receiveShadow position={[0, 0.28, 0]} scale={[1.2, 0.72, 0.96]}>
        <dodecahedronGeometry args={[0.72, 0]} />
        <meshStandardMaterial
          color={color}
          roughness={objectRoughness(object, 0.96)}
          metalness={objectMetalness(object, 0)}
          flatShading
        />
      </mesh>
      <mesh castShadow position={[0.6, 0.16, 0.25]} scale={[0.5, 0.3, 0.42]}>
        <dodecahedronGeometry args={[0.72, 0]} />
        <meshStandardMaterial
          color={color}
          roughness={objectRoughness(object, 0.96)}
          metalness={objectMetalness(object, 0)}
          flatShading
        />
      </mesh>
      {environment.season === 'winter' ? (
        <mesh position={[-0.05, 0.66, -0.04]} scale={[0.95, 0.18, 0.74]}>
          <sphereGeometry args={[0.68, 8, 5]} />
          <meshStandardMaterial color={theme.snowCap} roughness={0.92} flatShading />
        </mesh>
      ) : null}
    </>
  );
}

function CloudObject({ object, environment, theme }: ObjectProps) {
  const inner = useRef<THREE.Group>(null);
  const phase = usePhase(object);
  useFrame((state) => {
    if (!inner.current) return;
    const time = state.clock.elapsedTime;
    inner.current.position.x = Math.sin(time * 0.03 + phase) * 2.4;
    inner.current.position.y = Math.cos(time * 0.05 + phase) * 0.3;
  });
  const color = objectBaseColor(object, theme.cloudColor);
  const opacity = environment.weather === 'heavy-rain' ? 0.9 : 0.76;
  const puffs = [
    [-1.3, 0, 0, 1.05],
    [0.1, 0.25, 0.1, 1.35],
    [1.3, -0.05, -0.15, 0.9],
    [0.5, -0.15, 0.7, 0.85],
    [-0.5, -0.1, -0.7, 0.8],
  ];
  return (
    <group ref={inner}>
      {puffs.map(([x, y, z, scale], index) => (
        <mesh key={index} position={[x, y, z]} scale={[scale, scale * 0.62, scale]}>
          <sphereGeometry args={[1, 10, 7]} />
          <meshStandardMaterial
            color={mixHex(color, theme.cloudColor, 0.15)}
            roughness={objectRoughness(object, 1)}
            metalness={objectMetalness(object, 0)}
            transparent
            opacity={opacity}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function PathObject({ object, environment, theme }: ObjectProps) {
  const variant = String(object.params?.variant ?? 'stepping-stones');
  const wet = isWet(environment);
  const base = objectBaseColor(object, theme.groundTint);
  const color = mixHex(
    base,
    environment.season === 'winter'
      ? theme.snowCap
      : theme.groundTint,
    environment.season === 'winter' ? 0.55 : 0.15,
  );
  const materialColor = wet ? mixHex(color, '#2e373d', 0.25) : color;
  const roughness =
    objectRoughness(object, wet ? 0.32 : 0.9) * (wet ? 0.6 : 1);
  const metalness = Math.min(
    1,
    objectMetalness(object, 0) + (wet ? 0.06 : 0),
  );
  const roadColor = objectBaseColor(object, '#1b212b');

  if (variant === 'road') {
    return (
      <group>
        <mesh receiveShadow position={[0, 0.02, 0]}>
          <boxGeometry args={[7, 0.07, 46]} />
          <meshStandardMaterial
            color={roadColor}
            roughness={roughness}
            metalness={metalness}
            emissive={object.material?.emissive ?? theme.accent}
            emissiveIntensity={object.material?.emissiveIntensity ?? (theme.isNight ? 0.45 : 0.18)}
          />
        </mesh>
        {Array.from({ length: 11 }, (_, index) => (
          <mesh key={index} position={[0, 0.061, -20 + index * 4]}>
            <boxGeometry args={[0.12, 0.015, 1.8]} />
            <meshStandardMaterial
              color={theme.accent}
              emissive={theme.accent}
              emissiveIntensity={theme.isNight ? 1.4 : 0.25}
            />
          </mesh>
        ))}
        {wet && environment.weather === 'heavy-rain'
          ? Array.from({ length: 5 }, (_, index) => (
              <mesh
                key={`puddle-${index}`}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[-2 + (index % 3) * 1.8, 0.065, -12 + index * 5]}
              >
                <circleGeometry args={[0.7 + (index % 2) * 0.3, 18]} />
                <meshStandardMaterial
                  color={theme.waterShallow}
                  roughness={0.1}
                  metalness={0.35}
                  transparent
                  opacity={0.5}
                />
              </mesh>
            ))
          : null}
      </group>
    );
  }

  if (variant === 'planks') {
    return (
      <group>
        {Array.from({ length: 12 }, (_, index) => (
          <mesh
            key={index}
            castShadow
            receiveShadow
            position={[0, 0.06, -8 + index * 1.45]}
            rotation={[0, (index % 2 === 0 ? 0.025 : -0.02), 0]}
          >
            <boxGeometry args={[4.1, 0.13, 1.25]} />
            <meshStandardMaterial
              color={materialColor}
              roughness={roughness}
              metalness={metalness}
            />
          </mesh>
        ))}
        {[-1.8, 1.8].map((x) => (
          <mesh key={x} position={[x, 0.02, 0]}>
            <boxGeometry args={[0.16, 0.12, 17.5]} />
            <meshStandardMaterial color="#524437" roughness={0.95} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group>
      {Array.from({ length: 8 }, (_, index) => {
        const offsetX = Math.sin(index * 1.7 + phaseFor(object)) * 0.38;
        return (
          <mesh
            key={index}
            castShadow
            receiveShadow
            position={[offsetX, 0.055, -7 + index * 2]}
            rotation={[0, Math.cos(index) * 0.2, 0]}
          >
            <boxGeometry args={[1.5 + (index % 3) * 0.2, 0.1, 1.15]} />
            <meshStandardMaterial
              color={materialColor}
              roughness={roughness}
              metalness={metalness}
              flatShading
            />
          </mesh>
        );
      })}
    </group>
  );
}

function phaseFor(object: WorldObject): number {
  return object.kind === 'primitive' ? 0 : Number(object.params?.seed ?? 0) % 4;
}

function UnknownObject({ object, theme }: ObjectProps) {
  return (
    <mesh castShadow position={[0, 0.8, 0]}>
      <boxGeometry args={[1.2, 1.6, 1.2]} />
      <meshStandardMaterial
        color={objectBaseColor(object, theme.accent)}
        roughness={objectRoughness(object, 0.8)}
        metalness={objectMetalness(object, 0)}
        flatShading
      />
    </mesh>
  );
}

function PrimitiveObject({ object, theme }: ObjectProps) {
  const shape = object.params?.shape;
  return (
    <mesh castShadow receiveShadow>
      {shape === 'sphere' ? <sphereGeometry args={[0.5, 24, 16]} />
        : shape === 'cylinder' ? <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
          : shape === 'cone' ? <coneGeometry args={[0.5, 1, 24]} />
            : shape === 'torus' ? <torusGeometry args={[0.35, 0.15, 12, 32]} />
              : shape === 'plane' ? <planeGeometry args={[1, 1]} />
                : shape === 'capsule' ? <capsuleGeometry args={[0.25, 0.5, 6, 12]} />
                  : shape === 'icosahedron' ? <icosahedronGeometry args={[0.5, 1]} />
                    : <boxGeometry args={[1, 1, 1]} />}
      <meshStandardMaterial
        color={objectBaseColor(object, theme.accent)}
        roughness={objectRoughness(object, 0.75)}
        metalness={objectMetalness(object, 0)}
        emissive={object.material?.emissive ?? '#000000'}
        emissiveIntensity={object.material?.emissiveIntensity ?? 0}
        transparent={(object.material?.opacity ?? 1) < 1}
        opacity={object.material?.opacity ?? 1}
        flatShading={object.material?.flatShading ?? false}
        side={shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  );
}

function ProceduralObject({ object, theme }: ObjectProps) {
  const geometry = useMemo(() => {
    if (!object.geometry) throw new Error(`程序化物体 ${object.name} 缺少几何定义`);
    return createProceduralGeometry(object.geometry);
  }, [object.geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={object.material?.color ?? theme.accent}
        roughness={object.material?.roughness ?? 0.75}
        metalness={object.material?.metalness ?? 0}
        emissive={object.material?.emissive ?? '#000000'}
        emissiveIntensity={object.material?.emissiveIntensity ?? 0}
        opacity={object.material?.opacity ?? 1}
        transparent={(object.material?.opacity ?? 1) < 1}
        flatShading={object.material?.flatShading ?? false}
        side={object.geometry?.type === 'ribbon' || object.geometry?.type === 'terrain' || object.geometry?.type === 'mesh' ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  );
}

function renderObject(props: ObjectProps) {
  switch (props.object.kind) {
    case 'procedural':
      return <ProceduralObject {...props} />;
    case 'primitive':
      return <PrimitiveObject {...props} />;
    case 'ground':
      return <GroundObject {...props} />;
    case 'hill':
      return <HillsObject {...props} />;
    case 'water':
      return <WaterObject {...props} />;
    case 'tree':
      return <TreeObject {...props} />;
    case 'cabin':
      return <CabinObject {...props} />;
    case 'house':
      return <HouseObject {...props} />;
    case 'tent':
      return <TentObject {...props} />;
    case 'tower':
      return String(props.object.params?.variant) === 'lighthouse' ? (
        <LighthouseObject {...props} />
      ) : (
        <TowerObject {...props} />
      );
    case 'sign':
      return <SignObject {...props} />;
    case 'lamp':
      return <LampObject {...props} />;
    case 'campfire':
      return <CampfireObject {...props} />;
    case 'boat':
      return <BoatObject {...props} />;
    case 'rock':
      return <RockObject {...props} />;
    case 'cloud':
      return <CloudObject {...props} />;
    case 'path':
      return <PathObject {...props} />;
    default:
      return <UnknownObject {...props} />;
  }
}

export function WorldObjectView({
  object,
  environment,
  theme,
  selected,
  onSelect,
  resources = [],
  retryToken = 0,
  onAssetStatus,
}: WorldObjectViewProps) {
  const root = useRef<THREE.Group>(null);
  const resourceKey = objectResourceKey(object, resources);
  const needsResources = objectNeedsResources(object);
  const [loaded, setLoaded] = useState<{ key: string; value: LoadedObjectResources } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const loadKey = `${resourceKey}:${retryToken}`;
  const ready = !needsResources || loaded?.key === loadKey;
  const error = failure?.key === loadKey ? failure.message : undefined;
  const resourceValue = loaded?.key === loadKey ? loaded.value : null;

  useEffect(() => {
    if (!needsResources) return;
    const controller = new AbortController();
    let current = true;
    let result: LoadedObjectResources | undefined;
    setFailure(null);
    const timeout = window.setTimeout(() => {
      if (!current) return;
      current = false;
      controller.abort();
      setFailure({ key: loadKey, message: '素材加载超过 30 秒；请检查本地服务和素材文件后重试。' });
    }, 30000);
    void loadObjectResources(object, resources, controller.signal).then((value) => {
      if (!current) { value.dispose(); return; }
      window.clearTimeout(timeout);
      result = value;
      setLoaded({ key: loadKey, value });
    }).catch((reason: unknown) => {
      if (current) {
        window.clearTimeout(timeout);
        setFailure({ key: loadKey, message: reason instanceof Error ? reason.message : '素材无法加载，请重新上传。' });
      }
    });
    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
      result?.dispose();
    };
    // Key includes every input used for resource loading; transforms do not refetch assets.
  }, [loadKey, needsResources]);

  useEffect(() => {
    onAssetStatus?.(object.id, { state: error ? 'error' : ready ? 'ready' : 'loading', message: error });
  }, [object.id, ready, error, onAssetStatus]);

  useLayoutEffect(() => {
    if (!ready || !root.current || object.kind === 'model' || !resourceValue) return;
    const restore: (() => void)[] = [];
    root.current.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const previous = node.material;
      const originals = Array.isArray(previous) ? previous : [previous];
      const copies = originals.map((material) => {
        const copy = material instanceof THREE.MeshStandardMaterial ? material.clone() : new THREE.MeshStandardMaterial();
        applyMaterialOverrides(copy, object.material, resourceValue.textures, object.kind === 'primitive' || object.kind === 'procedural' || !(material instanceof THREE.MeshStandardMaterial));
        return copy;
      });
      node.material = Array.isArray(previous) ? copies : copies[0];
      const geometry = node.geometry;
      if (resourceValue.textures.aoMap) {
        node.geometry = geometry.clone();
        ensureAmbientOcclusionUVs(node.geometry);
      }
      const copyGeometry = node.geometry;
      restore.push(() => {
        node.material = previous;
        node.geometry = geometry;
        copies.forEach((material) => material.dispose());
        if (copyGeometry !== geometry) copyGeometry.dispose();
      });
    });
    return () => restore.forEach((undo) => undo());
  }, [ready, resourceValue, object, environment, theme]);

  const visual = ready ? (object.kind === 'model'
    ? resourceValue?.model ? <primitive object={resourceValue.model} dispose={null} /> : null
    : renderObject({ object, environment, theme })) : null;
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(object.id);
  };
  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = 'pointer';
  };
  const handleOut = () => {
    document.body.style.cursor = 'auto';
  };

  useEffect(
    () => () => {
      document.body.style.cursor = 'auto';
    },
    [],
  );

  return (
    <group
      ref={root}
      position={object.transform.position}
      rotation={object.transform.rotation}
      scale={object.transform.scale}
      onClick={handleClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      userData={{ worldObjectId: object.id, objectKind: object.kind, selected, assetState: error ? 'error' : ready ? 'ready' : 'loading', assetError: error, resourceKey }}
    >
      {ready ? (object.collision === 'none' ? visual : (
        <RigidBody key={`${JSON.stringify(object.transform)}:${JSON.stringify(object.geometry)}:${JSON.stringify(object.params)}:${loadKey}`} type="fixed" colliders="trimesh">
          {visual}
        </RigidBody>
      )) : (
        <Html center><div role="status" className="max-w-64 rounded bg-black/80 p-2 text-xs text-white">{object.name}：{error ?? '正在加载素材…'}</div></Html>
      )}
    </group>
  );
}

