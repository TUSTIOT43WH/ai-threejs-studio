import type { ConceptPalette, ConceptStyleDefinition } from './concept-styles';
import type { SceneProfileDefinition } from './scene-profiles';

export interface ConceptArtOptions {
  profile: SceneProfileDefinition;
  style: ConceptStyleDefinition;
  paletteIndex: number;
  seed: number;
}

export interface ConceptArtResult {
  svg: string;
  width: number;
  height: number;
}

const W = 960;
const ART_H = 544;
const TOTAL_H = 600;

type Rng = () => number;

interface ArtContext {
  rng: Rng;
  p: ConceptPalette;
  style: ConceptStyleDefinition;
  profile: SceneProfileDefinition;
  night: boolean;
  sunX: number;
  sunY: number;
  horizonY: number;
}

function createRng(seed: number): Rng {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pick<T>(rng: Rng, values: T[]): T {
  const value = values[Math.floor(rng() * values.length) % values.length];
  return value as T;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function polygon(points: Array<[number, number]>, fill: string, extra = ''): string {
  const attr = points
    .map(([x, y]) => `${round(x)},${round(y)}`)
    .join(' ');
  return `<polygon points="${attr}" fill="${fill}" ${extra}/>`;
}

function buildDefs(p: ConceptPalette, night: boolean): string {
  const scanColor = night ? '#000000' : '#000000';
  return `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.skyTop}"/>
      <stop offset="72%" stop-color="${p.skyBottom}"/>
      <stop offset="100%" stop-color="${p.haze}"/>
    </linearGradient>
    <radialGradient id="sunGlow">
      <stop offset="0%" stop-color="${p.sun}" stop-opacity="0.85"/>
      <stop offset="38%" stop-color="${p.sun}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${p.sun}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warmGlow">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.8"/>
      <stop offset="45%" stop-color="${p.glow}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.skyBottom}" stop-opacity="0.9"/>
      <stop offset="35%" stop-color="${p.water}"/>
      <stop offset="100%" stop-color="${p.groundDeep}"/>
    </linearGradient>
    <linearGradient id="hazeFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.haze}" stop-opacity="0"/>
      <stop offset="55%" stop-color="${p.haze}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="${p.haze}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="42%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="cinemaBottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.75"/>
    </linearGradient>
    <pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1" fill="${scanColor}" opacity="0.35"/>
    </pattern>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <filter id="softSmall" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <filter id="strongGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="9" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" stitchTiles="stitch" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0"/>
    </filter>
    <clipPath id="artClip"><rect width="${W}" height="${ART_H}"/></clipPath>
  </defs>`;
}

function drawStars(ctx: ArtContext): string {
  if (!ctx.night) return '';
  const parts: string[] = ['<g>'];
  for (let i = 0; i < 90; i += 1) {
    const x = round(range(ctx.rng, 12, W - 12));
    const y = round(range(ctx.rng, 16, ctx.horizonY - 60));
    const r = round(range(ctx.rng, 0.5, 1.8));
    const opacity = Math.round(range(ctx.rng, 0.25, 0.95) * 100) / 100;
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#e9f1ff" opacity="${opacity}"/>`,
    );
  }
  for (let i = 0; i < 4; i += 1) {
    const x = round(range(ctx.rng, 40, W - 40));
    const y = round(range(ctx.rng, 30, ctx.horizonY - 100));
    const color = pick(ctx.rng, [ctx.p.neonB ?? ctx.p.accent, ctx.p.accent]);
    parts.push(
      `<circle cx="${x}" cy="${y}" r="2.2" fill="${color}" opacity="0.7" filter="url(#softSmall)"/>`,
    );
  }
  parts.push('</g>');
  return parts.join('');
}

function drawCelestial(ctx: ArtContext): string {
  const p = ctx.p;
  const coreRadius = ctx.night ? 26 : 38;
  const glowRadius = ctx.night ? 150 : 190;
  return `<g>
    <circle cx="${round(ctx.sunX)}" cy="${round(ctx.sunY)}" r="${glowRadius}" fill="url(#sunGlow)"/>
    <circle cx="${round(ctx.sunX)}" cy="${round(ctx.sunY)}" r="${coreRadius}" fill="${p.sun}" opacity="${ctx.night ? 0.82 : 0.92}"/>
    <circle cx="${round(ctx.sunX)}" cy="${round(ctx.sunY)}" r="${coreRadius + 7}" fill="none" stroke="${p.sun}" stroke-opacity="0.25" stroke-width="1.5"/>
    ${ctx.night ? `<circle cx="${round(ctx.sunX + 9)}" cy="${round(ctx.sunY - 6)}" r="6" fill="${p.skyTop}" opacity="0.35"/>` : ''}
  </g>`;
}

function drawCloud(ctx: ArtContext, x: number, y: number, scale: number, opacity: number): string {
  const p = ctx.p;
  const g = [
    `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(64 * scale)}" ry="${round(20 * scale)}" fill="${p.cloud}" opacity="${opacity}"/>`,
    `<ellipse cx="${round(x - 38 * scale)}" cy="${round(y + 4 * scale)}" rx="${round(36 * scale)}" ry="${round(14 * scale)}" fill="${p.cloud}" opacity="${opacity * 0.8}"/>`,
    `<ellipse cx="${round(x + 42 * scale)}" cy="${round(y - 7 * scale)}" rx="${round(30 * scale)}" ry="${round(12 * scale)}" fill="${p.cloud}" opacity="${opacity * 0.7}"/>`,
  ];
  return `<g filter="url(#softSmall)">${g.join('')}</g>`;
}

function drawClouds(ctx: ArtContext): string {
  const parts: string[] = [];
  const count = Math.floor(range(ctx.rng, 2, 5));
  for (let i = 0; i < count; i += 1) {
    const x = range(ctx.rng, 100, W - 100);
    const y = range(ctx.rng, 65, ctx.horizonY - 150);
    parts.push(
      drawCloud(ctx, x, y, range(ctx.rng, 0.55, 1.15), range(ctx.rng, 0.16, 0.34)),
    );
  }
  return parts.join('');
}

function drawRidge(
  ctx: ArtContext,
  baseY: number,
  amplitude: number,
  color: string,
  opacity: number,
  peaks = 8,
): string {
  const points: Array<[number, number]> = [];
  const step = W / peaks;
  for (let i = 0; i <= peaks; i += 1) {
    const x = i * step;
    const y = baseY - (0.2 + ctx.rng() * 0.8) * amplitude;
    points.push([x, y]);
  }
  const path = [
    `M 0 ${ART_H}`,
    ...points.map(([x, y]) => `L ${round(x)} ${round(y)}`),
    `L ${W} ${ART_H}`,
    'Z',
  ].join(' ');
  return `<path d="${path}" fill="${color}" opacity="${opacity}"/>`;
}

function drawHaze(ctx: ArtContext): string {
  return `<rect x="0" y="${round(ctx.horizonY - 105)}" width="${W}" height="170" fill="url(#hazeFade)" opacity="0.8"/>`;
}

function drawRock(ctx: ArtContext, x: number, baseY: number, s: number): string {
  const p = ctx.p;
  const points: Array<[number, number]> = [
    [x - 26 * s, baseY],
    [x - 18 * s, baseY - 22 * s],
    [x - 2 * s, baseY - 32 * s],
    [x + 18 * s, baseY - 20 * s],
    [x + 26 * s, baseY],
  ];
  return `<g>
    ${polygon(points, p.mountainNear, `opacity="0.95"`)}
    ${polygon(
      [
        [x - 16 * s, baseY - 20 * s],
        [x - 2 * s, baseY - 30 * s],
        [x + 8 * s, baseY - 16 * s],
      ],
      p.cloud,
      'opacity="0.16"',
    )}
  </g>`;
}

function drawPine(
  ctx: ArtContext,
  x: number,
  baseY: number,
  height: number,
  snowy: boolean,
): string {
  const p = ctx.p;
  const w = height * 0.4;
  const parts: string[] = [];
  parts.push(
    `<rect x="${round(x - 2.5)}" y="${round(baseY - height * 0.2)}" width="5" height="${round(
      height * 0.2,
    )}" rx="2" fill="${p.trunk}"/>`,
  );
  for (let i = 0; i < 3; i += 1) {
    const apexY = baseY - height + i * height * 0.22;
    const bottomY = baseY - height * 0.48 + i * height * 0.22;
    const halfW = w * (0.28 + i * 0.22);
    parts.push(
      polygon(
        [
          [x, apexY],
          [x - halfW, bottomY],
          [x + halfW, bottomY],
        ],
        i % 2 === 0 ? p.foliage : p.foliageDark,
        'opacity="0.97"',
      ),
    );
    if (snowy) {
      parts.push(
        polygon(
          [
            [x, apexY],
            [x - halfW * 0.55, apexY + (bottomY - apexY) * 0.38],
            [x + halfW * 0.55, apexY + (bottomY - apexY) * 0.38],
          ],
          p.snow,
          'opacity="0.85"',
        ),
      );
    }
  }
  return `<g>${parts.join('')}</g>`;
}

function drawBroadleaf(
  ctx: ArtContext,
  x: number,
  baseY: number,
  height: number,
  showLeaves = true,
): string {
  const p = ctx.p;
  const parts: string[] = [
    `<path d="M ${round(x)} ${round(baseY)} C ${round(x - 6)} ${round(baseY - height * 0.35)}, ${round(
      x + 5,
    )} ${round(baseY - height * 0.5)}, ${round(x)} ${round(baseY - height * 0.62)}" stroke="${
      p.trunk
    }" stroke-width="${round(Math.max(3, height * 0.045))}" fill="none" stroke-linecap="round"/>`,
    `<path d="M ${round(x)} ${round(baseY - height * 0.42)} L ${round(x - height * 0.16)} ${round(
      baseY - height * 0.55,
    )}" stroke="${p.trunk}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    `<path d="M ${round(x)} ${round(baseY - height * 0.5)} L ${round(x + height * 0.13)} ${round(
      baseY - height * 0.6,
    )}" stroke="${p.trunk}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  ];
  if (showLeaves) {
    const blobs: Array<[number, number, number, string]> = [
      [x - height * 0.13, baseY - height * 0.66, height * 0.22, p.foliageDark],
      [x + height * 0.15, baseY - height * 0.7, height * 0.2, p.foliage],
      [x + height * 0.02, baseY - height * 0.82, height * 0.23, p.foliage],
      [x - height * 0.02, baseY - height * 0.63, height * 0.2, p.foliageDark],
    ];
    for (const [cx, cy, r, fill] of blobs) {
      parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}" opacity="0.94"/>`);
    }
    parts.push(
      `<circle cx="${round(x - height * 0.09)}" cy="${round(baseY - height * 0.78)}" r="${round(
        height * 0.1,
      )}" fill="${p.cloud}" opacity="0.12"/>`,
    );
  }
  return `<g>${parts.join('')}</g>`;
}

function drawCabin(
  ctx: ArtContext,
  cx: number,
  baseY: number,
  scale: number,
  wallColor = ctx.p.wall,
  roofColor = ctx.p.roof,
): string {
  const p = ctx.p;
  const w = 220 * scale;
  const h = 126 * scale;
  const roofH = 76 * scale;
  const x = cx - w / 2;
  const lines: string[] = [];
  lines.push(
    `<ellipse cx="${round(cx)}" cy="${round(baseY + 4)}" rx="${round(w * 0.66)}" ry="${round(
      12 * scale,
    )}" fill="${p.ink}" opacity="0.2"/>`,
  );
  lines.push(
    `<rect x="${round(x)}" y="${round(baseY - h)}" width="${round(w)}" height="${round(h)}" rx="${round(
      3 * scale,
    )}" fill="${wallColor}" stroke="${p.ink}" stroke-opacity="0.22" stroke-width="1.5"/>`,
  );
  for (let ly = baseY - h + 16 * scale; ly < baseY - 8; ly += 16 * scale) {
    lines.push(
      `<line x1="${round(x + 4)}" y1="${round(ly)}" x2="${round(x + w - 4)}" y2="${round(
        ly,
      )}" stroke="${p.ink}" stroke-opacity="0.09" stroke-width="1"/>`,
    );
  }
  lines.push(
    polygon(
      [
        [x - 22 * scale, baseY - h],
        [cx, baseY - h - roofH],
        [x + w + 22 * scale, baseY - h],
        [x + w + 10 * scale, baseY - h + 10 * scale],
        [x - 10 * scale, baseY - h + 10 * scale],
      ],
      roofColor,
      `stroke="${p.ink}" stroke-opacity="0.24" stroke-width="1.5"`,
    ),
  );
  for (let i = 1; i < 4; i += 1) {
    const yy = baseY - h + 10 * scale - (roofH - 10 * scale) * (i / 4);
    const half = w * 0.52 * (1 - i / 4.6);
    lines.push(
      `<line x1="${round(cx - half)}" y1="${round(yy)}" x2="${round(cx + half)}" y2="${round(
        yy,
      )}" stroke="${p.ink}" stroke-opacity="0.12" stroke-width="1"/>`,
    );
  }
  lines.push(
    `<rect x="${round(cx + w * 0.24)}" y="${round(baseY - h - roofH * 0.92)}" width="${round(
      16 * scale,
    )}" height="${round(roofH * 0.8)}" fill="${p.groundDeep}" stroke="${p.ink}" stroke-opacity="0.2"/>`,
    `<rect x="${round(cx + w * 0.22)}" y="${round(baseY - h - roofH * 0.98)}" width="${round(
      21 * scale,
    )}" height="${round(5 * scale)}" fill="${p.snow}" opacity="0.7"/>`,
  );
  lines.push(
    `<circle cx="${round(cx)}" cy="${round(baseY - h * 0.48)}" r="${round(58 * scale)}" fill="url(#warmGlow)" opacity="0.55"/>`,
    `<rect x="${round(cx - 22 * scale)}" y="${round(baseY - 70 * scale)}" width="${round(
      44 * scale,
    )}" height="${round(70 * scale)}" rx="${round(2 * scale)}" fill="${p.trunk}"/>`,
    `<circle cx="${round(cx + 11 * scale)}" cy="${round(baseY - 34 * scale)}" r="${round(
      2.2 * scale,
    )}" fill="${p.glow}" opacity="0.9"/>`,
  );
  for (const offset of [-w * 0.3, w * 0.3]) {
    lines.push(
      `<rect x="${round(cx + offset - 17 * scale)}" y="${round(baseY - h * 0.72)}" width="${round(
        34 * scale,
      )}" height="${round(28 * scale)}" rx="2" fill="${p.glow}" opacity="0.92"/>`,
      `<line x1="${round(cx + offset)}" y1="${round(baseY - h * 0.72)}" x2="${round(
        cx + offset,
      )}" y2="${round(baseY - h * 0.72 + 28 * scale)}" stroke="${p.trunk}" stroke-width="2"/>`,
      `<line x1="${round(cx + offset - 17 * scale)}" y1="${round(baseY - h * 0.58)}" x2="${round(
        cx + offset + 17 * scale,
      )}" y2="${round(baseY - h * 0.58)}" stroke="${p.trunk}" stroke-width="2"/>`,
    );
  }
  lines.push(
    `<path d="M ${round(cx + w * 0.24)} ${round(baseY - h - roofH * 1.05)} C ${round(
      cx + w * 0.18,
    )} ${round(baseY - h - roofH * 1.5)}, ${round(cx + w * 0.36)} ${round(
      baseY - h - roofH * 1.85,
    )}, ${round(cx + w * 0.28)} ${round(baseY - h - roofH * 2.3)}" stroke="${
      p.cloud
    }" stroke-opacity="0.3" stroke-width="${round(7 * scale)}" fill="none" stroke-linecap="round"/>`,
    `<rect x="${round(cx - 36 * scale)}" y="${round(baseY)}" width="${round(
      72 * scale,
    )}" height="${round(8 * scale)}" rx="2" fill="${p.groundDeep}" opacity="0.8"/>`,
  );
  return `<g>${lines.join('')}</g>`;
}

function drawTent(ctx: ArtContext, cx: number, baseY: number, scale: number): string {
  const p = ctx.p;
  const w = 130 * scale;
  const h = 100 * scale;
  const color = p.accent;
  return `<g>
    <ellipse cx="${round(cx)}" cy="${round(baseY + 2)}" rx="${round(w * 0.66)}" ry="${round(
      8 * scale,
    )}" fill="${p.ink}" opacity="0.18"/>
    <circle cx="${round(cx)}" cy="${round(baseY - h * 0.35)}" r="${round(80 * scale)}" fill="url(#warmGlow)" opacity="0.3"/>
    ${polygon(
      [
        [cx, baseY - h],
        [cx - w / 2, baseY],
        [cx + w / 2, baseY],
      ],
      color,
      `stroke="${p.ink}" stroke-opacity="0.2"`,
    )}
    ${polygon(
      [
        [cx, baseY - h * 0.92],
        [cx - w * 0.2, baseY - 2],
        [cx + w * 0.2, baseY - 2],
      ],
      p.ink,
      'opacity="0.55"',
    )}
    <circle cx="${round(cx)}" cy="${round(baseY - h * 0.22)}" r="${round(12 * scale)}" fill="${p.glow}" opacity="0.9"/>
    <line x1="${round(cx)}" y1="${round(baseY - h)}" x2="${round(cx)}" y2="${round(
      baseY - h - 26 * scale,
    )}" stroke="${p.trunk}" stroke-width="${round(2 * scale)}"/>
    ${polygon(
      [
        [cx, baseY - h - 26 * scale],
        [cx + 30 * scale, baseY - h - 18 * scale],
        [cx, baseY - h - 10 * scale],
      ],
      p.glow,
      'opacity="0.85"',
    )}
    ${ctx.profile.id === 'snow-camp'
      ? `<path d="M ${round(cx - w / 2)} ${round(baseY)} Q ${round(cx)} ${round(
          baseY + 10 * scale,
        )} ${round(cx + w / 2)} ${round(baseY)}" stroke="${p.snow}" stroke-width="${round(
          5 * scale,
        )}" fill="none" opacity="0.8"/>`
      : ''}
  </g>`;
}

function drawCampfire(ctx: ArtContext, cx: number, baseY: number, scale: number): string {
  const p = ctx.p;
  const logs = [
    `<rect x="${round(cx - 34 * scale)}" y="${round(baseY - 10 * scale)}" width="${round(
      68 * scale,
    )}" height="${round(9 * scale)}" rx="4" fill="${p.trunk}" transform="rotate(-14 ${round(
      cx,
    )} ${round(baseY)})"/>`,
    `<rect x="${round(cx - 34 * scale)}" y="${round(baseY - 10 * scale)}" width="${round(
      68 * scale,
    )}" height="${round(9 * scale)}" rx="4" fill="${p.trunk}" transform="rotate(16 ${round(
      cx,
    )} ${round(baseY)})"/>`,
  ].join('');
  const flame = `<path d="M ${round(cx)} ${round(baseY - 62 * scale)} C ${round(
    cx + 24 * scale,
  )} ${round(baseY - 38 * scale)}, ${round(cx + 18 * scale)} ${round(
    baseY - 8 * scale,
  )}, ${round(cx)} ${round(baseY - 6 * scale)} C ${round(cx - 20 * scale)} ${round(
    baseY - 12 * scale,
  )}, ${round(cx - 22 * scale)} ${round(baseY - 40 * scale)}, ${round(cx)} ${round(
    baseY - 62 * scale,
  )} Z" fill="${p.glow}" opacity="0.95" filter="url(#strongGlow)"/>`;
  const innerFlame = `<path d="M ${round(cx)} ${round(baseY - 40 * scale)} C ${round(
    cx + 10 * scale,
  )} ${round(baseY - 26 * scale)}, ${round(cx + 8 * scale)} ${round(
    baseY - 10 * scale,
  )}, ${round(cx)} ${round(baseY - 8 * scale)} C ${round(cx - 9 * scale)} ${round(
    baseY - 12 * scale,
  )}, ${round(cx - 8 * scale)} ${round(baseY - 28 * scale)}, ${round(cx)} ${round(
    baseY - 40 * scale,
  )} Z" fill="${p.sun}" opacity="0.9"/>`;
  const stones: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = (Math.PI * 2 * i) / 7;
    const sx = cx + Math.cos(angle) * 44 * scale;
    const sy = baseY - 4 + Math.sin(angle) * 12 * scale;
    stones.push(
      `<ellipse cx="${round(sx)}" cy="${round(sy)}" rx="${round(7 * scale)}" ry="${round(
        5 * scale,
      )}" fill="${p.mountainNear}" opacity="0.9"/>`,
    );
  }
  const sparks: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    sparks.push(
      `<circle cx="${round(cx + range(ctx.rng, -22, 22) * scale)}" cy="${round(
        baseY - range(ctx.rng, 64, 130) * scale,
      )}" r="${round(range(ctx.rng, 1, 2.4))}" fill="${p.glow}" opacity="0.7"/>`,
    );
  }
  return `<g>
    <circle cx="${round(cx)}" cy="${round(baseY - 30 * scale)}" r="${round(150 * scale)}" fill="url(#warmGlow)" opacity="0.8"/>
    ${stones.join('')}${logs}${flame}${innerFlame}${sparks.join('')}
  </g>`;
}

function drawPalm(ctx: ArtContext, x: number, baseY: number, height: number): string {
  const p = ctx.p;
  const parts: string[] = [
    `<path d="M ${round(x)} ${round(baseY)} C ${round(x - 10)} ${round(
      baseY - height * 0.4,
    )}, ${round(x + 12)} ${round(baseY - height * 0.72)}, ${round(x + 6)} ${round(
      baseY - height,
    )}" stroke="${p.trunk}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  ];
  for (let i = 0; i < 6; i += 1) {
    const angle = -2.5 + i * 0.62;
    const lx = x + 6 + Math.cos(angle) * height * 0.3;
    const ly = baseY - height - Math.sin(angle) * height * 0.12 + Math.abs(Math.cos(angle)) * 22;
    parts.push(
      `<path d="M ${round(x + 6)} ${round(baseY - height)} Q ${round(
        (x + 6 + lx) / 2,
      )} ${round(ly - 16)}, ${round(lx)} ${round(ly)}" stroke="${
        i % 2 === 0 ? p.foliage : p.foliageDark
      }" stroke-width="9" stroke-linecap="round" fill="none"/>`,
    );
  }
  return `<g>${parts.join('')}</g>`;
}

function drawBoat(ctx: ArtContext, x: number, y: number, scale: number): string {
  const p = ctx.p;
  return `<g>
    <path d="M ${round(x - 38 * scale)} ${round(y)} Q ${round(x)} ${round(y + 22 * scale)} ${round(
      x + 38 * scale,
    )} ${round(y)} L ${round(x + 26 * scale)} ${round(y + 12 * scale)} Q ${round(
      x,
    )} ${round(y + 26 * scale)} ${round(x - 26 * scale)} ${round(y + 12 * scale)} Z" fill="${
      p.trunk
    }" opacity="0.95"/>
    <line x1="${round(x)}" y1="${round(y)}" x2="${round(x)}" y2="${round(y - 62 * scale)}" stroke="${
      p.trunk
    }" stroke-width="2.5"/>
    ${polygon(
      [
        [x + 1, y - 60 * scale],
        [x + 34 * scale, y - 10 * scale],
        [x + 1, y - 10 * scale],
      ],
      p.cloud,
      'opacity="0.9"',
    )}
    ${polygon(
      [
        [x - 1, y - 54 * scale],
        [x - 24 * scale, y - 14 * scale],
        [x - 1, y - 14 * scale],
      ],
      p.haze,
      'opacity="0.7"',
    )}
    <ellipse cx="${round(x)}" cy="${round(y + 30 * scale)}" rx="${round(40 * scale)}" ry="4" fill="${p.cloud}" opacity="0.2"/>
  </g>`;
}

function drawForestScene(ctx: ArtContext): string {
  const p = ctx.p;
  const parts: string[] = [];
  const groundY = 388 + range(ctx.rng, -16, 18);

  parts.push(
    `<path d="M 0 ${round(groundY)} C 130 ${round(groundY - 22)}, 250 ${round(
      groundY + 16,
    )}, 380 ${round(groundY - 4)} C 540 ${round(groundY - 30)}, 690 ${round(
      groundY + 10,
    )}, 960 ${round(groundY - 12)} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${p.ground}"/>`,
    `<path d="M 0 ${round(groundY + 78)} C 220 ${round(groundY + 58)}, 360 ${round(
      groundY + 96,
    )}, 540 ${round(groundY + 72)} C 700 ${round(groundY + 50)}, 830 ${round(
      groundY + 78,
    )}, 960 ${round(groundY + 62)} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${
      p.groundDeep
    }" opacity="0.42"/>`,
  );

  const lakeX = ctx.sunX < W / 2 ? range(ctx.rng, 610, 760) : range(ctx.rng, 170, 320);
  const lakeY = groundY + range(ctx.rng, 44, 70);
  parts.push(
    `<ellipse cx="${round(lakeX)}" cy="${round(lakeY)}" rx="${round(range(ctx.rng, 120, 185))}" ry="${round(
      range(ctx.rng, 28, 40),
    )}" fill="${p.water}" opacity="0.92"/>`,
    `<ellipse cx="${round(lakeX)}" cy="${round(lakeY - 3)}" rx="${round(range(ctx.rng, 70, 120))}" ry="10" fill="${
      p.haze
    }" opacity="0.28"/>`,
    `<ellipse cx="${round(lakeX + 22)}" cy="${round(lakeY + 8)}" rx="${round(range(ctx.rng, 40, 76))}" ry="5" fill="${
      p.cloud
    }" opacity="0.22"/>`,
  );

  const backgroundTrees: Array<[number, number, number]> = [
    [range(ctx.rng, 20, 90), groundY + range(ctx.rng, -4, 16), range(ctx.rng, 70, 120)],
    [range(ctx.rng, 100, 180), groundY + range(ctx.rng, 6, 24), range(ctx.rng, 55, 100)],
    [range(ctx.rng, 760, 860), groundY + range(ctx.rng, -2, 12), range(ctx.rng, 65, 110)],
    [range(ctx.rng, 880, 940), groundY + range(ctx.rng, 10, 30), range(ctx.rng, 80, 130)],
  ];
  for (const [x, base, h] of backgroundTrees) {
    parts.push(drawPine(ctx, x, base, h, false));
  }

  const pathStartX = W * 0.56 + range(ctx.rng, -40, 40);
  const stepCount = 6;
  for (let i = 0; i < stepCount; i += 1) {
    const t = i / (stepCount - 1);
    const sx = pathStartX + (1 - t) * range(ctx.rng, -26, 26) - t * 8;
    const sy = ART_H - 18 - t * (ART_H - groundY - 92);
    const rx = range(ctx.rng, 12, 24) * (1 - t * 0.35);
    parts.push(
      `<ellipse cx="${round(sx)}" cy="${round(sy)}" rx="${round(rx)}" ry="${round(rx * 0.34)}" fill="${
        p.haze
      }" opacity="${round(0.34 + t * 0.24)}"/>`,
    );
  }

  const cabinX = W * 0.54 + range(ctx.rng, -45, 45);
  const cabinBase = groundY + 58;
  parts.push(drawCabin(ctx, cabinX, cabinBase, range(ctx.rng, 0.94, 1.12)));

  const treeSlots = [
    [range(ctx.rng, 10, 110), range(ctx.rng, groundY + 20, ART_H - 22), range(ctx.rng, 110, 190)],
    [range(ctx.rng, 150, 300), range(ctx.rng, groundY + 30, ART_H - 30), range(ctx.rng, 90, 160)],
    [range(ctx.rng, W * 0.79, W * 0.9), range(ctx.rng, groundY + 22, ART_H - 30), range(ctx.rng, 100, 180)],
    [range(ctx.rng, W * 0.93, W - 20), range(ctx.rng, groundY + 34, ART_H - 10), range(ctx.rng, 120, 210)],
  ] as Array<[number, number, number]>;
  for (const [x, base, h] of treeSlots) {
    if (Math.abs(x - cabinX) < 180 && base < cabinBase + 50) continue;
    parts.push(drawPine(ctx, x, base, h, false));
  }

  for (let i = 0; i < 4; i += 1) {
    parts.push(
      drawRock(
        ctx,
        range(ctx.rng, 40, W - 40),
        range(ctx.rng, groundY + 50, ART_H - 8),
        range(ctx.rng, 0.45, 1),
      ),
    );
  }

  if (ctx.night) {
    for (let i = 0; i < 16; i += 1) {
      const x = range(ctx.rng, 80, W - 80);
      const y = range(ctx.rng, groundY - 20, ART_H - 30);
      parts.push(
        `<circle cx="${round(x)}" cy="${round(y)}" r="${round(range(ctx.rng, 1, 2.6))}" fill="${
          ctx.p.glow
        }" opacity="0.55" filter="url(#softSmall)"/>`,
      );
    }
  }

  return parts.join('');
}

function drawBuilding(
  ctx: ArtContext,
  x: number,
  baseY: number,
  width: number,
  height: number,
  depthIndex: number,
): string {
  const p = ctx.p;
  const neonA = p.neonA ?? p.accent;
  const neonB = p.neonB ?? p.glow;
  const fill = depthIndex < 0.45 ? p.mountainNear : p.ink;
  const parts: string[] = [];
  parts.push(
    `<rect x="${round(x)}" y="${round(baseY - height)}" width="${round(width)}" height="${round(
      height,
    )}" fill="${fill}" opacity="${depthIndex < 0.45 ? 0.72 : 0.94}"/>`,
  );
  parts.push(
    `<rect x="${round(x)}" y="${round(baseY - height)}" width="${round(width * 0.16)}" height="${round(
      height,
    )}" fill="${p.mountainFar}" opacity="0.18"/>`,
  );
  const cols = Math.max(2, Math.floor(width / 24));
  const rows = Math.max(4, Math.floor(height / 22));
  for (let c = 0; c < cols; c += 1) {
    for (let r = 1; r < rows - 1; r += 1) {
      if (ctx.rng() < 0.45) continue;
      const wx = x + 8 + c * ((width - 16) / cols);
      const wy = baseY - height + 12 + r * ((height - 20) / rows);
      const lit = pick(ctx.rng, [p.glow, neonA, neonB, p.cloud]);
      parts.push(
        `<rect x="${round(wx)}" y="${round(wy)}" width="${round(
          Math.max(4, (width - 16) / cols - 7),
        )}" height="3.4" fill="${lit}" opacity="${round(range(ctx.rng, 0.24, 0.8))}"/>`,
      );
    }
  }
  if (depthIndex > 0.5) {
    const stripX = ctx.rng() > 0.5 ? x + width - 7 : x + 3;
    parts.push(
      `<rect x="${round(stripX)}" y="${round(baseY - height + 10)}" width="4" height="${round(
        height - 20,
      )}" fill="${ctx.rng() > 0.5 ? neonA : neonB}" opacity="0.8" filter="url(#strongGlow)"/>`,
    );
  }
  if (ctx.rng() > 0.45) {
    parts.push(
      `<line x1="${round(x + width * 0.55)}" y1="${round(baseY - height)}" x2="${round(
        x + width * 0.55,
      )}" y2="${round(baseY - height - range(ctx.rng, 12, 42))}" stroke="${p.cloud}" stroke-width="1.5" opacity="0.45"/>`,
      `<circle cx="${round(x + width * 0.55)}" cy="${round(
        baseY - height - range(ctx.rng, 12, 42),
      )}" r="2" fill="${neonA}" opacity="0.8"/>`,
    );
  }
  return parts.join('');
}

function drawNeonSign(
  ctx: ArtContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): string {
  const p = ctx.p;
  const bars: string[] = [];
  const rows = Math.max(2, Math.floor(height / 16));
  for (let i = 0; i < rows; i += 1) {
    if (ctx.rng() < 0.2) continue;
    bars.push(
      `<rect x="${round(x + 8)}" y="${round(y + 10 + i * 14)}" width="${round(
        width - 16 - ctx.rng() * 14,
      )}" height="4" fill="${i % 2 === 0 ? color : p.cloud}" opacity="${round(range(ctx.rng, 0.4, 0.95))}"/>`,
    );
  }
  return `<g>
    <rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(
      height,
    )}" rx="4" fill="${p.ink}" opacity="0.9" stroke="${color}" stroke-opacity="0.5"/>
    <rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(
      height,
    )}" rx="4" fill="none" stroke="${color}" stroke-width="2" opacity="0.65" filter="url(#strongGlow)"/>
    ${bars.join('')}
  </g>`;
}

function drawCityScene(ctx: ArtContext): string {
  const p = ctx.p;
  const parts: string[] = [];
  const horizon = ctx.horizonY;

  for (let i = 0; i < 14; i += 1) {
    const bw = range(ctx.rng, 34, 74);
    const bh = range(ctx.rng, 40, 140);
    const bx = i * (W / 14) + range(ctx.rng, -10, 10);
    parts.push(
      `<rect x="${round(bx)}" y="${round(horizon - bh + 10)}" width="${round(bw)}" height="${round(
        bh + 10,
      )}" fill="${p.mountainNear}" opacity="0.62"/>`,
    );
  }

  const farBuildings = [
    { x: 300, w: 86, h: 260, baseY: horizon + 62, depth: 0.3 },
    { x: 500, w: 100, h: 310, baseY: horizon + 42, depth: 0.25 },
    { x: 396, w: 72, h: 210, baseY: horizon + 74, depth: 0.22 },
  ];
  for (const building of farBuildings) {
    parts.push(drawBuilding(ctx, building.x, building.baseY, building.w, building.h, building.depth));
  }

  parts.push(
    `<path d="M ${W * 0.42} ${horizon + 4} L ${W * 0.3} ${ART_H} L ${W * 0.76} ${ART_H} L ${
      W * 0.58
    } ${horizon + 4} Z" fill="${p.ink}" opacity="0.92"/>`,
    `<path d="M ${W * 0.42} ${horizon + 4} L ${W * 0.3} ${ART_H} L ${W * 0.36} ${ART_H} L ${
      W * 0.46
    } ${horizon + 4} Z" fill="${p.mountainFar}" opacity="0.16"/>`,
  );

  const laneLines: string[] = [];
  for (let i = 1; i < 6; i += 1) {
    const t = i / 6;
    const y = horizon + 14 + t * (ART_H - horizon - 20);
    laneLines.push(
      `<line x1="${round(W * 0.5 - t * 96)}" y1="${round(y)}" x2="${round(
        W * 0.5 + t * 96,
      )}" y2="${round(y)}" stroke="${p.cloud}" stroke-opacity="0.14" stroke-width="${round(
        1 + t * 2,
      )}" stroke-dasharray="14 22"/>`,
    );
  }
  parts.push(laneLines.join(''));

  const nearBuildings = [
    { x: -18, w: 192, h: 330, baseY: ART_H, depth: 0.95 },
    { x: 182, w: 120, h: 272, baseY: ART_H - 26, depth: 0.8 },
    { x: 292, w: 70, h: 190, baseY: ART_H - 118, depth: 0.6 },
    { x: 792, w: 192, h: 350, baseY: ART_H, depth: 0.95 },
    { x: 654, w: 124, h: 282, baseY: ART_H - 18, depth: 0.8 },
    { x: 590, w: 66, h: 180, baseY: ART_H - 128, depth: 0.6 },
  ].sort((a, b) => a.depth - b.depth);
  for (const building of nearBuildings) {
    parts.push(drawBuilding(ctx, building.x, building.baseY, building.w, building.h, building.depth));
  }

  const neonA = p.neonA ?? p.accent;
  const neonB = p.neonB ?? p.glow;
  parts.push(
    drawNeonSign(ctx, 232, 250, 64, 128, neonA),
    drawNeonSign(ctx, 696, 214, 56, 150, neonB),
  );

  for (let i = 0; i < 6; i += 1) {
    const x = range(ctx.rng, W * 0.35, W * 0.68);
    const y = range(ctx.rng, ART_H - 120, ART_H - 30);
    const color = i % 2 === 0 ? neonA : neonB;
    parts.push(
      `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(range(ctx.rng, 12, 44))}" ry="3" fill="${
        color
      }" opacity="0.3" filter="url(#softSmall)"/>`,
    );
  }

  parts.push(
    `<path d="M 0 196 Q 240 250 480 214 T 960 238" stroke="${p.ink}" stroke-width="2" fill="none" opacity="0.45"/>`,
    `<path d="M 0 178 Q 280 230 560 200 T 960 208" stroke="${p.ink}" stroke-width="1.5" fill="none" opacity="0.3"/>`,
  );

  for (let i = 0; i < 3; i += 1) {
    const y = range(ctx.rng, 210, 320);
    const startX = range(ctx.rng, 80, 320);
    const color = i % 2 === 0 ? neonB : neonA;
    parts.push(
      `<line x1="${round(startX)}" y1="${round(y)}" x2="${round(startX + range(ctx.rng, 60, 120))}" y2="${round(
        y,
      )}" stroke="${color}" stroke-width="2" opacity="0.5" filter="url(#softSmall)"/>`,
    );
  }

  return parts.join('');
}

function drawSeasideScene(ctx: ArtContext): string {
  const p = ctx.p;
  const parts: string[] = [];
  const horizon = ctx.horizonY;

  const coastX = W * 0.58 + range(ctx.rng, -50, 30);
  parts.push(
    drawRidge(ctx, horizon + 6, 58, p.mountainFar, 0.35, 5),
    `<rect x="0" y="${horizon}" width="${W}" height="${ART_H - horizon}" fill="url(#water)"/>`,
    `<path d="M ${round(coastX)} ${round(horizon + 30)} C ${round(coastX + 120)} ${round(
      horizon + 52,
    )}, ${round(W - 200)} ${round(horizon + 120)}, ${round(W)} ${round(horizon + 150)} L ${W} ${ART_H} L ${round(
      coastX + 140,
    )} ${ART_H} C ${round(coastX + 40)} ${round(ART_H - 80)}, ${round(coastX)} ${round(
      horizon + 180,
    )}, ${round(coastX)} ${round(horizon + 30)} Z" fill="${p.ground}"/>`,
    `<path d="M ${round(coastX + 122)} ${round(ART_H)} C ${round(coastX + 210)} ${round(
      ART_H - 48,
    )}, ${round(coastX + 330)} ${round(ART_H - 24)}, ${W} ${round(ART_H - 28)} L ${W} ${ART_H} Z" fill="${
      p.haze
    }" opacity="0.85"/>`,
  );

  const sunX = ctx.sunX;
  for (let i = 0; i < 14; i += 1) {
    const t = i / 13;
    const y = horizon + 16 + t * (ART_H - horizon - 30);
    const width = 20 + t * range(ctx.rng, 80, 190);
    parts.push(
      `<ellipse cx="${round(sunX + range(ctx.rng, -20, 20))}" cy="${round(y)}" rx="${round(
        width,
      )}" ry="${round(1.4 + t * 2.2)}" fill="${p.sun}" opacity="${round(0.1 + (1 - t) * 0.2)}"/>`,
    );
  }

  for (let i = 0; i < 22; i += 1) {
    const y = horizon + range(ctx.rng, 24, ART_H - horizon - 20);
    const x = range(ctx.rng, 20, coastX - 60);
    parts.push(
      `<path d="M ${round(x)} ${round(y)} q ${round(range(ctx.rng, 12, 36))} ${round(
        range(ctx.rng, -4, 4),
      )} ${round(range(ctx.rng, 30, 70))} 0" stroke="${p.cloud}" stroke-opacity="${round(
        range(ctx.rng, 0.12, 0.32),
      )}" stroke-width="1.4" fill="none"/>`,
    );
  }

  parts.push(drawBoat(ctx, range(ctx.rng, 180, 360), horizon + 150, range(ctx.rng, 0.7, 1.05)));
  parts.push(drawBoat(ctx, range(ctx.rng, 430, 540), horizon + 92, range(ctx.rng, 0.5, 0.7)));

  const houseBase = horizon + 92;
  parts.push(
    drawCabin(
      ctx,
      range(ctx.rng, W - 220, W - 130),
      houseBase + 50,
      0.56,
      p.wall,
      p.accent,
    ),
    drawCabin(
      ctx,
      range(ctx.rng, W - 340, W - 260),
      houseBase + 20,
      0.44,
      p.cloud,
      p.roof,
    ),
    drawCabin(ctx, range(ctx.rng, coastX + 26, coastX + 90), houseBase + 96, 0.34, p.wall, p.accent),
  );
  parts.push(
    drawPalm(ctx, coastX + 40, horizon + 145, 150),
    drawPalm(ctx, range(ctx.rng, W - 400, W - 310), horizon + 112, 116),
  );

  for (let i = 0; i < 3; i += 1) {
    const bx = range(ctx.rng, 90, W - 160);
    const by = range(ctx.rng, 90, horizon - 70);
    parts.push(
      `<path d="M ${round(bx)} ${round(by)} q 8 -8 16 0 q 8 -8 16 0" stroke="${p.ink}" stroke-opacity="0.45" stroke-width="1.6" fill="none"/>`,
    );
  }

  for (let i = 0; i < 5; i += 1) {
    parts.push(
      drawRock(
        ctx,
        range(ctx.rng, coastX + 80, W - 20),
        range(ctx.rng, ART_H - 80, ART_H - 16),
        range(ctx.rng, 0.3, 0.8),
      ),
    );
  }

  return parts.join('');
}

function drawSnowScene(ctx: ArtContext): string {
  const p = ctx.p;
  const parts: string[] = [];
  const horizon = ctx.horizonY;
  const groundLine = 394;

  parts.push(
    drawRidge(ctx, horizon + 18, 126, p.mountainFar, 0.7, 7),
    drawRidge(ctx, horizon + 10, 170, p.mountainNear, 0.85, 6),
  );
  for (let i = 0; i < 3; i += 1) {
    const peakX = range(ctx.rng, 80, W - 80);
    const peakY = range(ctx.rng, horizon - 110, horizon - 40);
    parts.push(
      polygon(
        [
          [peakX, peakY],
          [peakX - range(ctx.rng, 30, 60), peakY + range(ctx.rng, 50, 90)],
          [peakX + range(ctx.rng, 30, 60), peakY + range(ctx.rng, 50, 90)],
        ],
        p.snow,
        'opacity="0.5"',
      ),
    );
  }

  parts.push(
    `<path d="M 0 ${groundLine} C 140 ${groundLine - 34}, 280 ${groundLine + 18}, 430 ${
      groundLine - 6
    } C 600 ${groundLine - 32}, 760 ${groundLine + 16}, 960 ${groundLine - 20} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${
      p.snow
    }"/>`,
    `<path d="M 0 ${groundLine + 40} C 180 ${groundLine + 20}, 330 ${groundLine + 64}, 510 ${
      groundLine + 36
    } C 690 ${groundLine + 14}, 810 ${groundLine + 52}, 960 ${groundLine + 26} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${
      p.snow
    }" opacity="0.82"/>`,
    `<path d="M 0 ${groundLine + 92} C 200 ${groundLine + 66}, 420 ${groundLine + 108}, 640 ${
      groundLine + 82
    } C 780 ${groundLine + 66}, 880 ${groundLine + 88}, 960 ${groundLine + 78} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${
      p.mountainFar
    }" opacity="0.14"/>`,
  );

  const trees: Array<[number, number, number]> = [
    [range(ctx.rng, 20, 100), groundLine + 34, range(ctx.rng, 130, 200)],
    [range(ctx.rng, 130, 220), groundLine + 10, range(ctx.rng, 90, 150)],
    [range(ctx.rng, W - 120, W - 20), groundLine + 24, range(ctx.rng, 140, 220)],
    [range(ctx.rng, W - 260, W - 150), groundLine + 4, range(ctx.rng, 90, 140)],
    [range(ctx.rng, 280, 420), groundLine - 12, range(ctx.rng, 60, 100)],
    [range(ctx.rng, W * 0.64, W * 0.76), groundLine - 16, range(ctx.rng, 55, 90)],
  ];
  for (const [x, base, h] of trees) {
    parts.push(drawPine(ctx, x, base, h, true));
  }

  const campX = W * 0.51;
  parts.push(
    `<ellipse cx="${round(campX)}" cy="${round(groundLine + 105)}" rx="290" ry="150" fill="url(#warmGlow)" opacity="0.38"/>`,
    `<ellipse cx="${round(campX)}" cy="${round(groundLine + 104)}" rx="150" ry="32" fill="${p.glow}" opacity="0.14"/>`,
    drawTent(ctx, campX - 175, groundLine + 108, 1.02),
    drawTent(ctx, campX + 172, groundLine + 94, 0.82),
    drawCampfire(ctx, campX, groundLine + 118, 1),
    `<path d="M ${round(campX + 26)} ${round(groundLine + 40)} C ${round(campX + 60)} ${round(
      groundLine - 14,
    )}, ${round(campX + 2)} ${round(groundLine - 70)}, ${round(campX + 44)} ${round(
      groundLine - 130,
    )}" stroke="${p.cloud}" stroke-opacity="0.32" stroke-width="9" fill="none" stroke-linecap="round"/>`,
  );

  for (let i = 0; i < 46; i += 1) {
    parts.push(
      `<circle cx="${round(range(ctx.rng, 20, W - 20))}" cy="${round(
        range(ctx.rng, 40, ART_H - 40),
      )}" r="${round(range(ctx.rng, 0.8, 2.6))}" fill="${p.snow}" opacity="${round(range(ctx.rng, 0.3, 0.9))}"/>`,
    );
  }

  for (let i = 0; i < 4; i += 1) {
    parts.push(
      drawRock(
        ctx,
        range(ctx.rng, 40, W - 40),
        range(ctx.rng, groundLine + 80, ART_H - 12),
        range(ctx.rng, 0.3, 0.7),
      ),
    );
  }

  return parts.join('');
}

function drawMeadowScene(ctx: ArtContext): string {
  const p = ctx.p;
  const parts: string[] = [];
  const horizon = ctx.horizonY;

  parts.push(
    drawRidge(ctx, horizon + 6, 116, p.mountainFar, 0.42, 6),
    `<path d="M 0 ${horizon + 80} C 160 ${horizon + 32}, 320 ${horizon + 110}, 500 ${horizon + 62} C 680 ${
      horizon + 18
    }, 820 ${horizon + 74}, 960 ${horizon + 36} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${p.ground}"/>`,
    `<path d="M 0 ${horizon + 152} C 200 ${horizon + 104}, 380 ${horizon + 186}, 580 ${horizon + 130} C 740 ${
      horizon + 86
    }, 850 ${horizon + 140}, 960 ${horizon + 112} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${
      p.groundDeep
    }" opacity="0.5"/>`,
    `<path d="M 0 ${ART_H - 60} C 220 ${ART_H - 118}, 420 ${ART_H - 34}, 640 ${ART_H - 84} C 780 ${
      ART_H - 118
    }, 880 ${ART_H - 70}, 960 ${ART_H - 92} L 960 ${ART_H} L 0 ${ART_H} Z" fill="${p.groundDeep}" opacity="0.7"/>`,
  );

  parts.push(
    `<path d="M ${W * 0.22} ${ART_H - 20} C ${W * 0.34} ${ART_H - 120}, ${W * 0.46} ${ART_H - 170}, ${
      W * 0.52
    } ${horizon + 118}" stroke="${p.haze}" stroke-width="46" stroke-opacity="0.34" fill="none" stroke-linecap="round"/>`,
  );

  const cabinX = W * 0.55;
  parts.push(drawCabin(ctx, cabinX, horizon + 138, 0.56));
  const trees: Array<[number, number, number]> = [
    [range(ctx.rng, 70, 150), horizon + 182, range(ctx.rng, 150, 210)],
    [range(ctx.rng, 220, 300), horizon + 150, range(ctx.rng, 110, 160)],
    [range(ctx.rng, W - 200, W - 90), horizon + 188, range(ctx.rng, 170, 230)],
    [range(ctx.rng, W - 340, W - 250), horizon + 158, range(ctx.rng, 110, 150)],
    [range(ctx.rng, 360, 420), horizon + 210, range(ctx.rng, 80, 120)],
  ];
  for (const [x, base, h] of trees) {
    parts.push(drawBroadleaf(ctx, x, base, h));
  }

  for (let i = 0; i < 42; i += 1) {
    const x = range(ctx.rng, 20, W - 20);
    const y = range(ctx.rng, horizon + 150, ART_H - 20);
    const color = pick(ctx.rng, [p.accent, p.glow, p.cloud, p.sun]);
    parts.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${round(range(ctx.rng, 1, 3))}" fill="${color}" opacity="0.7"/>`);
  }

  for (let i = 0; i < 3; i += 1) {
    const bx = range(ctx.rng, 100, W - 200);
    const by = range(ctx.rng, 100, horizon - 80);
    parts.push(
      `<path d="M ${round(bx)} ${round(by)} q 8 -8 16 0 q 8 -8 16 0" stroke="${p.ink}" stroke-opacity="0.4" stroke-width="1.6" fill="none"/>`,
    );
  }

  return parts.join('');
}

function drawScene(ctx: ArtContext): string {
  switch (ctx.profile.id) {
    case 'forest-cabin':
      return drawForestScene(ctx);
    case 'cyberpunk-city':
      return drawCityScene(ctx);
    case 'seaside-town':
      return drawSeasideScene(ctx);
    case 'snow-camp':
      return drawSnowScene(ctx);
    default:
      return drawMeadowScene(ctx);
  }
}

function drawStyleOverlay(ctx: ArtContext): string {
  const p = ctx.p;
  const overlays: string[] = [];
  switch (ctx.style.artStyle) {
    case 'painterly': {
      for (let i = 0; i < 5; i += 1) {
        overlays.push(
          `<ellipse cx="${round(range(ctx.rng, 80, W - 80))}" cy="${round(
            range(ctx.rng, 80, ART_H - 80),
          )}" rx="${round(range(ctx.rng, 90, 240))}" ry="${round(
            range(ctx.rng, 30, 90),
          )}" fill="${i % 2 === 0 ? p.cloud : p.accent}" opacity="${round(range(ctx.rng, 0.03, 0.08))}" filter="url(#soft)"/>`,
        );
      }
      for (let i = 0; i < 6; i += 1) {
        const x = range(ctx.rng, 60, W - 60);
        const y = range(ctx.rng, 100, ART_H - 40);
        overlays.push(
          `<path d="M ${round(x)} ${round(y)} q ${round(range(ctx.rng, 30, 90))} ${round(
            range(ctx.rng, -24, 24),
          )} ${round(range(ctx.rng, 70, 160))} ${round(range(ctx.rng, -10, 20))}" stroke="${
            i % 2 === 0 ? p.cloud : p.sun
          }" stroke-opacity="0.08" stroke-width="${round(range(ctx.rng, 6, 16))}" fill="none" stroke-linecap="round"/>`,
        );
      }
      overlays.push(
        `<rect x="0" y="${ART_H - 170}" width="${W}" height="170" fill="url(#cinemaBottom)" opacity="0.22"/>`,
      );
      break;
    }
    case 'low-poly': {
      for (let i = 0; i < 12; i += 1) {
        const x = range(ctx.rng, 0, W);
        const y = range(ctx.rng, 0, ctx.horizonY);
        overlays.push(
          polygon(
            [
              [x, y],
              [x + range(ctx.rng, 60, 180), y + range(ctx.rng, 10, 80)],
              [x + range(ctx.rng, -40, 80), y + range(ctx.rng, 50, 150)],
            ],
            i % 3 === 0 ? p.cloud : i % 3 === 1 ? p.ink : p.accent,
            `opacity="${round(range(ctx.rng, 0.025, 0.06))}"`,
          ),
        );
      }
      overlays.push(
        polygon(
          [
            [0, ART_H],
            [0, ART_H - 200],
            [W * 0.32, ART_H],
          ],
          p.haze,
          'opacity="0.06"',
        ),
        polygon(
          [
            [W, ART_H],
            [W, ART_H - 260],
            [W * 0.66, ART_H],
          ],
          p.ink,
          'opacity="0.08"',
        ),
      );
      break;
    }
    case 'cinematic': {
      overlays.push(
        `<rect x="0" y="0" width="${W}" height="${ART_H}" fill="url(#vignette)"/>`,
        `<rect x="0" y="0" width="${W}" height="18" fill="#040506"/>`,
        `<rect x="0" y="${ART_H - 18}" width="${W}" height="18" fill="#040506"/>`,
        `<rect x="0" y="0" width="${W * 0.24}" height="${ART_H}" fill="${p.water}" opacity="0.05"/>`,
        `<rect x="${W * 0.76}" y="0" width="${W * 0.24}" height="${ART_H}" fill="${p.glow}" opacity="0.05"/>`,
      );
      overlays.push(
        `<line x1="${round(ctx.sunX - 170)}" y1="${round(ctx.sunY)}" x2="${round(
          ctx.sunX + 170,
        )}" y2="${round(ctx.sunY)}" stroke="${p.sun}" stroke-opacity="0.28" stroke-width="2" filter="url(#strongGlow)"/>`,
      );
      break;
    }
    case 'watercolor': {
      overlays.push(
        `<rect width="${W}" height="${ART_H}" filter="url(#paper)" opacity="0.06"/>`,
        `<rect width="${W}" height="${ART_H}" fill="${p.cloud}" opacity="0.05"/>`,
      );
      for (let i = 0; i < 6; i += 1) {
        overlays.push(
          `<ellipse cx="${round(range(ctx.rng, 50, W - 50))}" cy="${round(
            range(ctx.rng, 40, ART_H - 40),
          )}" rx="${round(range(ctx.rng, 60, 180))}" ry="${round(
            range(ctx.rng, 40, 120),
          )}" fill="${pick(ctx.rng, [p.accent, p.foliage, p.haze])}" opacity="${round(
            range(ctx.rng, 0.025, 0.07),
          )}" filter="url(#soft)"/>`,
        );
      }
      break;
    }
    case 'neon': {
      overlays.push(
        `<rect width="${W}" height="${ART_H}" fill="url(#scanlines)" opacity="0.5"/>`,
        `<rect width="${W}" height="${ART_H}" fill="url(#vignette)"/>`,
        `<rect x="12" y="12" width="${W - 24}" height="${ART_H - 24}" fill="none" stroke="${
          p.neonA ?? p.accent
        }" stroke-opacity="0.22" stroke-width="1.5"/>`,
        `<line x1="0" y1="${ctx.horizonY + 40}" x2="${W}" y2="${ctx.horizonY + 40}" stroke="${
          p.neonB ?? p.glow
        }" stroke-opacity="0.25" stroke-width="1.5" filter="url(#strongGlow)"/>`,
      );
      for (let i = 0; i < 3; i += 1) {
        overlays.push(
          `<ellipse cx="${round(range(ctx.rng, 100, W - 100))}" cy="${round(
            range(ctx.rng, 200, ART_H - 60),
          )}" rx="${round(range(ctx.rng, 80, 200))}" ry="${round(
            range(ctx.rng, 4, 16),
          )}" fill="${i % 2 === 0 ? p.neonA ?? p.accent : p.neonB ?? p.glow}" opacity="0.12" filter="url(#soft)"/>`,
        );
      }
      overlays.push(
        `<rect width="${W}" height="${ART_H}" filter="url(#noise)" opacity="0.035"/>`,
      );
      break;
    }
    default:
      break;
  }
  return overlays.join('');
}

function drawChrome(chipLabel: string, ctx: ArtContext): string {
  const p = ctx.p;
  return `<g>
    <g transform="translate(24 22)">
      <rect width="122" height="27" rx="13.5" fill="#07080a" fill-opacity="0.62"/>
      <circle cx="15" cy="13.5" r="3.5" fill="#d8ff4f"/>
      <text x="27" y="18" font-family="'Inter','Segoe UI',sans-serif" font-size="10.5" font-weight="600" letter-spacing="1.4" fill="#e8ecdd">MOCK PREVIEW</text>
    </g>
    <rect x="0" y="${ART_H}" width="${W}" height="${TOTAL_H - ART_H}" fill="#08090b"/>
    <rect x="0" y="${ART_H}" width="${W}" height="1" fill="#ffffff" fill-opacity="0.09"/>
    <text x="24" y="${ART_H + 25}" font-family="'Inter','Segoe UI',sans-serif" font-size="15" font-weight="600" fill="#f2f4ec">${
      escapeXml(ctx.style.titlePrefix)
    } · ${escapeXml(ctx.style.labelEn)}</text>
    <text x="24" y="${ART_H + 43}" font-family="'Inter','Segoe UI','Microsoft YaHei',sans-serif" font-size="10.5" fill="#8f958b" letter-spacing="0.3">${escapeXml(
      chipLabel,
    )} · 程序化占位概念图 · 非真实 AI 生成</text>
    <text x="936" y="${ART_H + 30}" text-anchor="end" font-family="'Inter','Segoe UI',sans-serif" font-size="10.5" font-weight="600" letter-spacing="2.2" fill="#d8ff4f">AI THREE.JS STUDIO</text>
    <text x="936" y="${ART_H + 45}" text-anchor="end" font-family="'Inter','Segoe UI',sans-serif" font-size="9.5" letter-spacing="1.2" fill="${p.cloud}" opacity="0.45">PHASE 1 / MOCK PIPELINE</text>
  </g>`;
}

export function renderConceptArtSvg(options: ConceptArtOptions): ConceptArtResult {
  const style = options.style;
  const palette =
    style.palettes[options.paletteIndex % style.palettes.length] ?? style.palettes[0];
  const rng = createRng(options.seed);
  const horizonByProfile: Record<string, number> = {
    'forest-cabin': 366,
    'cyberpunk-city': 392,
    'seaside-town': 344,
    'snow-camp': 372,
    meadow: 356,
  };
  const horizonY = horizonByProfile[options.profile.id] ?? 366;
  const sunX =
    options.profile.id === 'seaside-town'
      ? range(rng, 250, 690)
      : range(rng, 150, W - 150);
  const sunY =
    options.profile.id === 'seaside-town'
      ? range(rng, 220, 275)
      : style.night
        ? range(rng, 110, 180)
        : range(rng, 105, 245);

  const ctx: ArtContext = {
    rng,
    p: palette,
    style,
    profile: options.profile,
    night: style.night,
    sunX,
    sunY,
    horizonY,
  };

  const art = [
    `<rect width="${W}" height="${ART_H}" fill="url(#sky)"/>`,
    drawStars(ctx),
    drawCelestial(ctx),
    drawClouds(ctx),
    drawRidge(ctx, horizonY + 18, 150, palette.mountainFar, 0.55, 7),
    drawRidge(ctx, horizonY + 12, 100, palette.mountainNear, 0.7, 8),
    drawScene(ctx),
    drawHaze(ctx),
    drawStyleOverlay(ctx),
  ].join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${TOTAL_H}" width="${W}" height="${TOTAL_H}" role="img" aria-label="${escapeXml(
    `${options.profile.sceneLabel} — ${style.label} mock concept preview`,
  )}">
    <title>${escapeXml(options.profile.sceneLabel)} · ${escapeXml(style.label)} · Mock preview</title>
    <desc>Procedurally generated placeholder concept art. Not a real AI-generated image.</desc>
    ${buildDefs(palette, style.night)}
    <g clip-path="url(#artClip)">${art}</g>
    ${drawChrome(`${options.profile.sceneLabel} · ${style.label}`, ctx)}
  </svg>`;

  return { svg, width: W, height: TOTAL_H };
}
