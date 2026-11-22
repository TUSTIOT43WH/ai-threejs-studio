import type { ConceptStyleId, TimeOfDayId } from '@ai-three-studio/shared';

export type ConceptArtStyle =
  | 'painterly'
  | 'low-poly'
  | 'cinematic'
  | 'watercolor'
  | 'neon';

export interface ConceptPalette {
  skyTop: string;
  skyBottom: string;
  haze: string;
  sun: string;
  cloud: string;
  mountainFar: string;
  mountainNear: string;
  ground: string;
  groundDeep: string;
  water: string;
  foliage: string;
  foliageDark: string;
  trunk: string;
  wall: string;
  roof: string;
  glow: string;
  accent: string;
  ink: string;
  snow: string;
  neonA?: string;
  neonB?: string;
}

export interface ConceptStyleDefinition {
  id: ConceptStyleId;
  label: string;
  labelEn: string;
  titlePrefix: string;
  tagline: string;
  artStyle: ConceptArtStyle;
  timeHint: TimeOfDayId;
  night: boolean;
  palettes: [ConceptPalette, ConceptPalette];
}

const painterlyDreamA: ConceptPalette = {
  skyTop: '#bfd8f6',
  skyBottom: '#ffe4d2',
  haze: '#ffe9dc',
  sun: '#fff1c9',
  cloud: '#fff7ef',
  mountainFar: '#a9b9d6',
  mountainNear: '#788ba6',
  ground: '#82976c',
  groundDeep: '#5e7457',
  water: '#a7c8da',
  foliage: '#6d8f6d',
  foliageDark: '#4f6f58',
  trunk: '#6d4f3f',
  wall: '#e6c49a',
  roof: '#8a6150',
  glow: '#ffd79a',
  accent: '#f3aebe',
  ink: '#2c3646',
  snow: '#f5f7f8',
};

const painterlyDreamB: ConceptPalette = {
  skyTop: '#9fb2e2',
  skyBottom: '#ffcbb0',
  haze: '#ffdcc8',
  sun: '#ffdda6',
  cloud: '#ffe8d9',
  mountainFar: '#8b8fc0',
  mountainNear: '#66679a',
  ground: '#6f7f66',
  groundDeep: '#4f5d51',
  water: '#8fa6c9',
  foliage: '#5d7b63',
  foliageDark: '#3f5a4a',
  trunk: '#5c463a',
  wall: '#d8a986',
  roof: '#74504b',
  glow: '#ffc98b',
  accent: '#ee9fb4',
  ink: '#262c44',
  snow: '#eef2f7',
};

const lowPolyA: ConceptPalette = {
  skyTop: '#2c6a9b',
  skyBottom: '#ffb067',
  haze: '#ffc98f',
  sun: '#ffe28a',
  cloud: '#f8f4e6',
  mountainFar: '#3f6f7e',
  mountainNear: '#29505d',
  ground: '#4f7f4b',
  groundDeep: '#355c3a',
  water: '#2596be',
  foliage: '#2f7d4f',
  foliageDark: '#1e5a3c',
  trunk: '#6b4b32',
  wall: '#f0c96c',
  roof: '#c0683a',
  glow: '#ffd166',
  accent: '#ff7755',
  ink: '#101d22',
  snow: '#eef4f7',
};

const lowPolyB: ConceptPalette = {
  skyTop: '#1d4e79',
  skyBottom: '#f4976b',
  haze: '#efa07a',
  sun: '#ffd27f',
  cloud: '#f3eee0',
  mountainFar: '#335f73',
  mountainNear: '#1e4552',
  ground: '#3d6e46',
  groundDeep: '#2a5236',
  water: '#1f88ad',
  foliage: '#2a6e46',
  foliageDark: '#1b5236',
  trunk: '#5d422e',
  wall: '#e9b85a',
  roof: '#a95532',
  glow: '#ffc35c',
  accent: '#f0654c',
  ink: '#0d191f',
  snow: '#e9f1f5',
};

const cinematicTealA: ConceptPalette = {
  skyTop: '#0e2733',
  skyBottom: '#d58a52',
  haze: '#f0b577',
  sun: '#ffd9a0',
  cloud: '#d9b08c',
  mountainFar: '#1e4a54',
  mountainNear: '#102f36',
  ground: '#1f3b31',
  groundDeep: '#152a23',
  water: '#17424b',
  foliage: '#24503e',
  foliageDark: '#173a2d',
  trunk: '#2e2119',
  wall: '#b98357',
  roof: '#3f2b1f',
  glow: '#ffb85c',
  accent: '#e67352',
  ink: '#060d10',
  snow: '#e8eef0',
};

const cinematicTealB: ConceptPalette = {
  skyTop: '#0a1c2b',
  skyBottom: '#b76f55',
  haze: '#c9946e',
  sun: '#ffc98f',
  cloud: '#b89f8b',
  mountainFar: '#163c4a',
  mountainNear: '#0a252e',
  ground: '#1a342d',
  groundDeep: '#11241e',
  water: '#12404c',
  foliage: '#1f4636',
  foliageDark: '#123326',
  trunk: '#291d16',
  wall: '#a8744e',
  roof: '#36241b',
  glow: '#ffb05a',
  accent: '#d95f48',
  ink: '#050b0e',
  snow: '#e2e9ed',
};

const watercolorA: ConceptPalette = {
  skyTop: '#dceff6',
  skyBottom: '#fdf3df',
  haze: '#fbf5e8',
  sun: '#ffe7b3',
  cloud: '#fffdf6',
  mountainFar: '#bfd1c7',
  mountainNear: '#94a89a',
  ground: '#c3d3a0',
  groundDeep: '#a4b784',
  water: '#b5d2dc',
  foliage: '#8fb17d',
  foliageDark: '#6d9268',
  trunk: '#9d7a5d',
  wall: '#f0d9b8',
  roof: '#c49077',
  glow: '#ffe6a8',
  accent: '#e9a6a0',
  ink: '#4b5760',
  snow: '#f7f7f2',
};

const watercolorB: ConceptPalette = {
  skyTop: '#e4e6f2',
  skyBottom: '#fbe7db',
  haze: '#f8efe6',
  sun: '#ffe2ad',
  cloud: '#fffaf3',
  mountainFar: '#c4c6d7',
  mountainNear: '#9b9fb1',
  ground: '#ccd0a8',
  groundDeep: '#adb68e',
  water: '#c3d3dd',
  foliage: '#9aae85',
  foliageDark: '#7d9271',
  trunk: '#9a7a63',
  wall: '#efd4b9',
  roof: '#c08f80',
  glow: '#ffe4b0',
  accent: '#dfa6ad',
  ink: '#54515d',
  snow: '#f8f6f1',
};

const neonNoirA: ConceptPalette = {
  skyTop: '#04030d',
  skyBottom: '#2a0b3d',
  haze: '#3d1350',
  sun: '#ff4fd8',
  cloud: '#2f1a3e',
  mountainFar: '#180b29',
  mountainNear: '#0b0615',
  ground: '#0b0a14',
  groundDeep: '#06050c',
  water: '#0a1a2f',
  foliage: '#123c3b',
  foliageDark: '#0a2729',
  trunk: '#1a1222',
  wall: '#221a33',
  roof: '#0d0a15',
  glow: '#23e6ff',
  accent: '#ff2fd0',
  ink: '#000000',
  snow: '#dfe9ff',
  neonA: '#ff2fd0',
  neonB: '#23e6ff',
};

const neonNoirB: ConceptPalette = {
  skyTop: '#03050d',
  skyBottom: '#101c3d',
  haze: '#1b2a4f',
  sun: '#b9ff3c',
  cloud: '#1d2740',
  mountainFar: '#0e1226',
  mountainNear: '#070912',
  ground: '#080a10',
  groundDeep: '#04050a',
  water: '#081624',
  foliage: '#14332f',
  foliageDark: '#0b211f',
  trunk: '#15121d',
  wall: '#1b2030',
  roof: '#0a0c13',
  glow: '#b9ff3c',
  accent: '#7a5cff',
  ink: '#000000',
  snow: '#e6edff',
  neonA: '#b9ff3c',
  neonB: '#7a5cff',
};

export const CONCEPT_STYLES: ConceptStyleDefinition[] = [
  {
    id: 'painterly-dream',
    label: '梦境笔触',
    labelEn: 'Painterly Dream',
    titlePrefix: '梦境柔光',
    tagline: '柔焦笔触与漂浮光尘，把场景包进层叠的雾光里。',
    artStyle: 'painterly',
    timeHint: 'day',
    night: false,
    palettes: [painterlyDreamA, painterlyDreamB],
  },
  {
    id: 'low-poly',
    label: '低多边形',
    labelEn: 'Low Poly',
    titlePrefix: '低多边国度',
    tagline: '利落的几何切面和大胆色块，天生适合实时 3D 重建。',
    artStyle: 'low-poly',
    timeHint: 'dusk',
    night: false,
    palettes: [lowPolyA, lowPolyB],
  },
  {
    id: 'cinematic-teal',
    label: '电影暮色',
    labelEn: 'Cinematic Teal',
    titlePrefix: '电影暮色',
    tagline: '青橙对撞与戏剧性光束，像一帧被定格的电影画面。',
    artStyle: 'cinematic',
    timeHint: 'dusk',
    night: false,
    palettes: [cinematicTealA, cinematicTealB],
  },
  {
    id: 'storybook-watercolor',
    label: '水彩绘本',
    labelEn: 'Storybook Watercolor',
    titlePrefix: '水彩童话',
    tagline: '纸张颗粒与柔和晕染，让世界像一本摊开的绘本。',
    artStyle: 'watercolor',
    timeHint: 'morning',
    night: false,
    palettes: [watercolorA, watercolorB],
  },
  {
    id: 'neon-noir',
    label: '霓虹夜行',
    labelEn: 'Neon Noir',
    titlePrefix: '霓虹夜行',
    tagline: '高对比夜色调、霓虹边框与扫描线，锋利而迷幻。',
    artStyle: 'neon',
    timeHint: 'night',
    night: true,
    palettes: [neonNoirA, neonNoirB],
  },
];

export function getConceptStyle(id: ConceptStyleId): ConceptStyleDefinition {
  const style = CONCEPT_STYLES.find((entry) => entry.id === id);
  if (!style) {
    throw new Error(`Unknown concept style: ${id}`);
  }
  return style;
}
