import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldEnvironment, WorldRenderSettings } from '@ai-three-studio/shared';
import { createSceneLights, SKY_FRAGMENT, SKY_VERTEX } from './render-settings';
import type { SceneTheme } from '../../lib/environment-visuals';
import { mixHex, windStrength } from '../../lib/environment-visuals';

interface AtmosphereProps {
  environment: WorldEnvironment;
  theme: SceneTheme;
  render?: WorldRenderSettings;
}

function SkyDome({ theme }: { theme: SceneTheme }) {
  const topTarget = useRef(new THREE.Color(theme.skyTop));
  const bottomTarget = useRef(new THREE.Color(theme.skyBottom));
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color(theme.skyTop) },
      bottomColor: { value: new THREE.Color(theme.skyBottom) },
      exponent: { value: 0.62 },
    }),
    [],
  );

  useEffect(() => {
    topTarget.current.set(theme.skyTop);
    bottomTarget.current.set(theme.skyBottom);
  }, [theme.skyTop, theme.skyBottom]);

  useFrame((_, delta) => {
    const factor = 1 - Math.exp(-2.4 * Math.min(delta, 0.1));
    uniforms.topColor.value.lerp(topTarget.current, factor);
    uniforms.bottomColor.value.lerp(bottomTarget.current, factor);
  });

  return (
    <mesh scale={[1, 1, 1]} renderOrder={-10}>
      <sphereGeometry args={[170, 32, 20]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={SKY_VERTEX}
        fragmentShader={SKY_FRAGMENT}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function CelestialBody({ environment, theme }: AtmosphereProps) {
  const night = environment.timeOfDay === 'night';
  const moodOpacity: Record<WorldEnvironment['weather'], number> = {
    clear: 1,
    cloudy: 0.22,
    windy: 0.7,
    'light-rain': 0.08,
    'heavy-rain': 0.03,
    snow: 0.16,
  };
  const opacity = moodOpacity[environment.weather];
  const position: [number, number, number] = night
    ? [-72, 64, -88]
    : theme.sunPosition;

  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[night ? 2.4 : 3.2, 24, 24]} />
        <meshBasicMaterial
          color={night ? '#f1f5ff' : theme.sunColor}
          transparent
          opacity={opacity}
          fog={false}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[night ? 6.5 : 9, 20, 20]} />
        <meshBasicMaterial
          color={night ? '#c6d7ff' : theme.sunColor}
          transparent
          opacity={opacity * 0.12}
          fog={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function SceneLights({ environment, render }: AtmosphereProps) {
  const lights = useMemo(() => createSceneLights(environment, render), [environment, render]);
  useEffect(() => () => {
    lights.traverse((node) => {
      if (node instanceof THREE.DirectionalLight || node instanceof THREE.PointLight || node instanceof THREE.SpotLight) node.dispose();
    });
  }, [lights]);
  return <primitive object={lights} dispose={null} />;
}

function WeatherClouds({ environment, theme }: AtmosphereProps) {
  const group = useRef<THREE.Group>(null);
  const count =
    environment.weather === 'cloudy'
      ? 6
      : environment.weather === 'light-rain'
        ? 7
        : environment.weather === 'heavy-rain'
          ? 8
          : environment.weather === 'snow'
            ? 6
            : environment.weather === 'windy'
              ? 3
              : 0;

  const clusters = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => {
        const angle = (index / Math.max(1, count)) * Math.PI * 2;
        return {
          position: [
            Math.cos(angle) * (16 + (index % 4) * 9),
            21 + (index % 3) * 4,
            Math.sin(angle) * (16 + (index % 3) * 8) - 6,
          ] as [number, number, number],
          scale: 3.2 + (index % 3) * 1.2,
          drift: 0.2 + (index % 4) * 0.08,
        };
      }),
    [count],
  );

  useFrame((state) => {
    if (!group.current) return;
    const time = state.clock.elapsedTime;
    group.current.children.forEach((child, index) => {
      const drift = clusters[index]?.drift ?? 0.2;
      child.position.x += Math.sin(time * drift + index) * 0.0016;
    });
  });

  if (count === 0) return null;

  const color = mixHex(
    theme.cloudColor,
    environment.weather === 'snow' ? '#e7eef2' : '#3f4952',
    environment.weather === 'heavy-rain' ? 0.55 : 0.25,
  );

  return (
    <group ref={group}>
      {clusters.map((cluster, index) => (
        <group
          key={index}
          position={cluster.position}
          scale={cluster.scale}
        >
          {[
            [-0.9, 0, 0, 0.9],
            [0, 0.25, 0.1, 1.15],
            [0.9, -0.08, -0.2, 0.8],
            [0.2, -0.18, 0.65, 0.7],
          ].map(([x, y, z, scale], puff) => (
            <mesh key={puff} position={[x, y, z]} scale={[scale, scale * 0.42, scale]}>
              <sphereGeometry args={[1, 10, 7]} />
              <meshStandardMaterial
                color={color}
                roughness={1}
                transparent
                opacity={environment.weather === 'heavy-rain' ? 0.62 : 0.4}
                depthWrite={false}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function createSoftParticleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Drop {
  x: number;
  y: number;
  z: number;
  speed: number;
  length: number;
}

function Rain({ heavy, environment }: { heavy: boolean; environment: WorldEnvironment }) {
  const count = heavy ? 2200 : 950;
  const wind = windStrength(environment.weather);
  const drops = useMemo<Drop[]>(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 78,
        y: Math.random() * 30 + 2,
        z: (Math.random() - 0.5) * 68,
        speed: 17 + Math.random() * 14,
        length: 0.5 + Math.random() * 0.8,
      })),
    [count],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    const step = Math.min(delta, 0.05);
    const slant = 0.12 + wind * 0.5;
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index]!;
      drop.y -= drop.speed * step;
      if (drop.y < 0.2) {
        drop.y = 28 + Math.random() * 6;
        drop.x = (Math.random() - 0.5) * 78;
        drop.z = (Math.random() - 0.5) * 68;
      }
      const base = index * 6;
      positions[base] = drop.x;
      positions[base + 1] = drop.y;
      positions[base + 2] = drop.z;
      positions[base + 3] = drop.x + slant * drop.length;
      positions[base + 4] = drop.y - drop.length;
      positions[base + 5] = drop.z;
    }
    attribute.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        color={heavy ? '#aabecd' : '#bcd9e8'}
        transparent
        opacity={heavy ? 0.55 : 0.38}
        depthWrite={false}
      />
    </lineSegments>
  );
}

interface Flake {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
}

function Snow({ environment }: { environment: WorldEnvironment }) {
  const count = 1200;
  const texture = useMemo(() => createSoftParticleTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  const flakes = useMemo<Flake[]>(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 74,
        y: Math.random() * 28 + 1,
        z: (Math.random() - 0.5) * 64,
        speed: 0.9 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      })),
    [],
  );
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    flakes.forEach((flake, index) => {
      positions[index * 3] = flake.x;
      positions[index * 3 + 1] = flake.y;
      positions[index * 3 + 2] = flake.z;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [flakes]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const wind = windStrength(environment.weather);

  useFrame((state, delta) => {
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    const time = state.clock.elapsedTime;
    const step = Math.min(delta, 0.05);
    for (let index = 0; index < flakes.length; index += 1) {
      const flake = flakes[index]!;
      flake.y -= flake.speed * step;
      flake.x += Math.sin(time * 0.7 + flake.phase) * 0.008 + wind * 0.01;
      if (flake.y < 0.1) {
        flake.y = 26 + Math.random() * 5;
        flake.x = (Math.random() - 0.5) * 74;
        flake.z = (Math.random() - 0.5) * 64;
      }
      positions[index * 3] = flake.x;
      positions[index * 3 + 1] = flake.y;
      positions[index * 3 + 2] = flake.z;
    }
    attribute.needsUpdate = true;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={texture}
        color="#eef7fc"
        size={0.24}
        sizeAttenuation
        transparent
        opacity={0.88}
        depthWrite={false}
      />
    </points>
  );
}

function SeasonParticles({
  environment,
  theme,
}: AtmosphereProps) {
  const kind =
    environment.season === 'spring'
      ? 'petal'
      : environment.season === 'autumn'
        ? 'leaf'
        : environment.season === 'winter' && environment.weather !== 'snow'
          ? 'snow'
          : null;
  const visible =
    kind !== null &&
    environment.weather !== 'heavy-rain' &&
    environment.weather !== 'light-rain';
  const count = kind === 'snow' ? 240 : kind === 'leaf' ? 130 : 100;
  const texture = useMemo(
    () => (visible ? createSoftParticleTexture() : null),
    [visible],
  );
  useEffect(() => () => texture?.dispose(), [texture]);

  const particles = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 62,
        y: Math.random() * 16 + 0.5,
        z: (Math.random() - 0.5) * 52,
        speed: 0.35 + Math.random() * 0.75,
        phase: Math.random() * Math.PI * 2,
      })),
    [count],
  );

  const geometry = useMemo(() => {
    if (!visible) return null;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    particles.forEach((particle, index) => {
      positions[index * 3] = particle.x;
      positions[index * 3 + 1] = particle.y;
      positions[index * 3 + 2] = particle.z;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [count, particles, visible]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  useFrame((state, delta) => {
    if (!geometry) return;
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    const time = state.clock.elapsedTime;
    const step = Math.min(delta, 0.05);
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index]!;
      particle.y -= particle.speed * step;
      particle.x += Math.sin(time * 0.9 + particle.phase) * 0.012;
      if (particle.y < 0.15) {
        particle.y = 12 + Math.random() * 6;
        particle.x = (Math.random() - 0.5) * 62;
        particle.z = (Math.random() - 0.5) * 52;
      }
      positions[index * 3] = particle.x;
      positions[index * 3 + 1] = particle.y;
      positions[index * 3 + 2] = particle.z;
    }
    attribute.needsUpdate = true;
  });

  if (!visible || !geometry || !texture) return null;

  const color =
    kind === 'petal'
      ? mixHex(theme.accent, '#f9a8d4', 0.5)
      : kind === 'leaf'
        ? mixHex(theme.foliageLight, '#e6a13c', 0.5)
        : '#eaf5fb';

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={texture}
        color={color}
        size={kind === 'leaf' ? 0.24 : 0.18}
        sizeAttenuation
        transparent
        opacity={kind === 'snow' ? 0.7 : 0.82}
        depthWrite={false}
      />
    </points>
  );
}

export function SceneAtmosphere({ environment, theme, render }: AtmosphereProps) {
  const skyTheme = render?.sky ? { ...theme, skyTop: render.sky.topColor, skyBottom: render.sky.bottomColor } : theme;
  const showStars =
    theme.isNight &&
    (environment.weather === 'clear' || environment.weather === 'windy');

  return (
    <>
      <SkyDome theme={skyTheme} />
      <CelestialBody environment={environment} theme={theme} />
      <SceneLights environment={environment} theme={theme} render={render} />
      {showStars ? (
        <Stars
          radius={110}
          depth={45}
          count={1600}
          factor={3.4}
          saturation={0}
          fade
          speed={0.35}
        />
      ) : null}
      <fogExp2
        attach="fog"
        args={[render?.fog?.color ?? theme.fog, render?.fog?.density ?? environment.fogDensity]}
      />
      <WeatherClouds environment={environment} theme={theme} />
      {environment.weather === 'light-rain' || environment.weather === 'heavy-rain' ? (
        <Rain
          heavy={environment.weather === 'heavy-rain'}
          environment={environment}
        />
      ) : null}
      {environment.weather === 'snow' ? (
        <Snow environment={environment} />
      ) : null}
      <SeasonParticles environment={environment} theme={theme} />
    </>
  );
}
