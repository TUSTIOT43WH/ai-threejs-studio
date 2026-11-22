import * as THREE from 'three';
import type { WorldGeometry } from '@ai-three-studio/shared';

/** Trusted factories only. Coordinates are native; object.scale supplies world dimensions. */
export function createProceduralGeometry(spec: WorldGeometry): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  switch (spec.type) {
    case 'terrain': {
      const { columns, rows, heights } = spec;
      if (columns < 2 || rows < 2 || heights.length !== columns * rows) {
        throw new Error('地形网格尺寸与高度数量不一致');
      }
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      for (let z = 0; z < rows; z++) {
        for (let x = 0; x < columns; x++) {
          positions.push(x / (columns - 1) - 0.5, heights[z * columns + x], z / (rows - 1) - 0.5);
          uvs.push(x / (columns - 1), z / (rows - 1));
          if (x < columns - 1 && z < rows - 1) {
            const a = z * columns + x;
            // Upward winding. Server height sampling must use the b-c diagonal.
            indices.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1);
          }
        }
      }
      geometry = indexedGeometry(positions, indices, uvs);
      break;
    }
    case 'extrude': {
      const shape = new THREE.Shape(spec.points.map(([x, y]) => new THREE.Vector2(x, y)));
      shape.holes = (spec.holes ?? []).map((points) => new THREE.Path(points.map(([x, y]) => new THREE.Vector2(x, y))));
      geometry = new THREE.ExtrudeGeometry(shape, {
        depth: spec.depth, steps: 1, curveSegments: 1,
        bevelEnabled: (spec.bevel ?? 0) > 0, bevelSize: spec.bevel ?? 0,
        bevelThickness: spec.bevel ?? 0, bevelSegments: 2,
      });
      break;
    }
    case 'lathe':
      geometry = new THREE.LatheGeometry(spec.points.map(([r, y]) => new THREE.Vector2(r, y)), spec.segments);
      break;
    case 'tube':
      geometry = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(spec.points.map((p) => new THREE.Vector3(...p)), spec.closed ?? false, 'centripetal'),
        spec.segments, spec.radius, spec.radialSegments, spec.closed ?? false,
      );
      break;
    case 'ribbon': {
      const curve = new THREE.CatmullRomCurve3(spec.points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const side = new THREE.Vector3(1, 0, 0);
      for (let i = 0; i <= spec.segments; i++) {
        const t = i / spec.segments;
        const point = curve.getPoint(t);
        const tangent = curve.getTangent(t);
        // The cross-section remains horizontal, including sloping paths.
        if (Math.hypot(tangent.x, tangent.z) > 1e-8) side.set(tangent.z, 0, -tangent.x).normalize();
        for (const sign of [-1, 1]) {
          positions.push(point.x + side.x * spec.width * sign / 2, point.y, point.z + side.z * spec.width * sign / 2);
          uvs.push(sign < 0 ? 0 : 1, t);
        }
        if (i < spec.segments) {
          const a = i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      geometry = indexedGeometry(positions, indices, uvs);
      break;
    }
    case 'mesh':
      geometry = indexedGeometry(spec.positions, spec.indices, spec.uvs);
      break;
    default:
      throw new Error('不支持的程序化几何类型');
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function indexedGeometry(positions: number[], indices: number[], uvs?: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Three r187 calls the second UV set uv1; retain uv2 for portable AO exports too. */
export function ensureAmbientOcclusionUVs(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (uv && !geometry.hasAttribute('uv1')) geometry.setAttribute('uv1', uv.clone());
  if (uv && !geometry.hasAttribute('uv2')) geometry.setAttribute('uv2', uv.clone());
}
