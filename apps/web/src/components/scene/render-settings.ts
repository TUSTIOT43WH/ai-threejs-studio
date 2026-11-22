import * as THREE from 'three';
import type { WorldLight, WorldRenderSettings, WorldSchema } from '@ai-three-studio/shared';
import { getSceneTheme } from '../../lib/environment-visuals';

export const SKY_VERTEX = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const SKY_FRAGMENT = `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float exponent;
  varying vec3 vWorldPosition;
  void main() {
    float h = normalize(vWorldPosition + vec3(0.0, 30.0, 0.0)).y;
    gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), exponent)), 1.0);
  }
`;

export function createReferenceCamera(world: WorldSchema, aspect = 1): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const config = world.render?.camera;
  const camera = config?.projection === 'orthographic'
    ? new THREE.OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, 0.1, 420)
    : new THREE.PerspectiveCamera(config?.fov ?? 48, aspect, 0.1, 420);
  const [x, y, z] = world.spawnPoint.position;
  camera.position.fromArray(config?.position ?? [x + 11, y + 8.4, z + 13]);
  camera.zoom = config?.zoom ?? 1;
  camera.lookAt(new THREE.Vector3(...(config?.target ?? [0, 1.7, 0])));
  camera.name = 'reference-camera';
  camera.userData.referenceCamera = true;
  camera.updateProjectionMatrix();
  return camera;
}

/** Same trusted lighting factory is used by preview and snapshot export. */
export function createSceneLights(environment: WorldSchema['environment'], render?: WorldRenderSettings): THREE.Group {
  const theme = getSceneTheme(environment);
  const group = new THREE.Group();
  group.name = 'world-lighting';
  group.add(new THREE.HemisphereLight(render?.sky?.topColor ?? theme.skyTop, theme.groundTint, environment.ambientIntensity));
  group.add(new THREE.AmbientLight(render?.ambientColor ?? theme.ambientColor, environment.ambientIntensity * (theme.isNight ? 0.4 : 0.24)));
  const configs: WorldLight[] = render?.lights ?? [{
    type: 'directional' as const, color: theme.sunColor, intensity: environment.sunIntensity,
    position: theme.lightPosition, castShadow: true,
  }, ...(theme.isNight ? [{
    type: 'directional' as const, color: '#93a9d8', intensity: 0.35,
    position: [-40, 32, -52] as [number, number, number], castShadow: false,
  }] : [])];
  for (const config of configs) {
    const light = config.type === 'point'
      ? new THREE.PointLight(config.color, config.intensity, config.distance ?? 0)
      : config.type === 'spot'
        ? new THREE.SpotLight(config.color, config.intensity, config.distance ?? 0, config.angle ?? Math.PI / 3, config.penumbra ?? 0)
        : new THREE.DirectionalLight(config.color, config.intensity);
    light.position.fromArray(config.position);
    light.castShadow = config.castShadow ?? false;
    light.shadow.mapSize.setScalar(render?.shadowMapSize ?? 2048);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.035;
    if (light instanceof THREE.DirectionalLight) {
      Object.assign(light.shadow.camera, { near: 1, far: 420, left: -48, right: 48, top: 48, bottom: -48 });
    } else {
      light.shadow.camera.near = 0.1;
      light.shadow.camera.far = config.distance || 420;
    }
    light.shadow.camera.updateProjectionMatrix();
    if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
      light.target.position.fromArray(config.target ?? [0, 0, 0]);
      group.add(light.target);
    }
    group.add(light);
  }
  return group;
}

export function createStaticSky(sky: NonNullable<WorldRenderSettings['sky']>): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(170, 32, 20), new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(sky.topColor) },
      bottomColor: { value: new THREE.Color(sky.bottomColor) },
      exponent: { value: 0.62 },
    }, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false,
  }));
  mesh.name = 'world-sky';
  mesh.renderOrder = -10;
  return mesh;
}
