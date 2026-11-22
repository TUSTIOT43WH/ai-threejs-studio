const TYPES = new Set(['extrude', 'lathe', 'tube', 'ribbon', 'mesh']);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function samePoint(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((value, i) => typeof value === 'number' && Number.isFinite(value) && value === b[i]);
}
function openOutline(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const result = [...value];
  // Explicitly repeating the first vertex is conventional polygon notation.
  // Three.Shape closes the outline itself; this vertex must not become a zero edge.
  while (result.length > 3 && samePoint(result[0], result[result.length - 1])) result.pop();
  return result;
}

export function isSupportedGeometry(value: unknown): value is Record<string, unknown> {
  return record(value) && typeof value.type === 'string' && TYPES.has(value.type);
}

/** Normalize notation only; invalid shapes, unknown fields and unsafe counts still fail validation. */
export function normalizeGeometryNotation(value: unknown): unknown {
  if (!isSupportedGeometry(value)) return value;
  const geometry = { ...value };
  if (geometry.type === 'extrude') {
    geometry.points = openOutline(geometry.points);
    if (geometry.holes === null) delete geometry.holes;
    else if (Array.isArray(geometry.holes)) geometry.holes = geometry.holes.map(openOutline);
    if (geometry.bevel === null) delete geometry.bevel;
  }
  if (geometry.type === 'tube' || geometry.type === 'ribbon') {
    if (Array.isArray(geometry.points)) {
      geometry.points = geometry.points.filter((point, i, all) => i === 0 || !samePoint(point, all[i - 1]));
    }
    if (geometry.type === 'tube' && geometry.closed === null) delete geometry.closed;
  }
  const defaultSegments = geometry.type === 'lathe' ? 32 : geometry.type === 'tube' ? 64 : geometry.type === 'ribbon' ? 32 : undefined;
  if (defaultSegments !== undefined && geometry.segments == null) geometry.segments = defaultSegments;
  if (geometry.type === 'tube' && geometry.radialSegments == null) geometry.radialSegments = 8;
  if (geometry.type === 'mesh' && geometry.uvs === null) delete geometry.uvs;
  return geometry;
}

export function normalizeRenderNotation(value: unknown): unknown {
  if (!record(value)) return value;
  const render = { ...value };
  for (const key of ['camera', 'lights', 'ambientColor', 'shadowMapSize', 'sky', 'fog', 'exposure', 'bloom']) {
    if (render[key] === null) delete render[key];
  }
  if (record(render.camera)) {
    render.camera = { ...render.camera };
    const camera = render.camera as Record<string, unknown>;
    for (const key of ['fov', 'zoom']) if (camera[key] === null) delete camera[key];
  }
  if (Array.isArray(render.lights)) render.lights = render.lights.map((value) => {
    if (!record(value)) return value;
    const light = { ...value };
    for (const key of ['target', 'castShadow', 'distance', 'angle', 'penumbra']) if (light[key] === null) delete light[key];
    return light;
  });
  return render;
}
