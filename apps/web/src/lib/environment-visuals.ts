import { Color } from 'three';
import type {
  SeasonId,
  TimeOfDayId,
  WeatherId,
  WorldEnvironment,
} from '@ai-three-studio/shared';

export interface SceneTheme {
  skyTop: string;
  skyBottom: string;
  horizon: string;
  fog: string;
  sunColor: string;
  ambientColor: string;
  groundTint: string;
  foliage: string;
  foliageLight: string;
  snowCap: string;
  waterShallow: string;
  waterDeep: string;
  accent: string;
  cloudColor: string;
  lightPosition: [number, number, number];
  sunPosition: [number, number, number];
  isNight: boolean;
  isDusk: boolean;
  bloomLike: boolean;
}

export function mixHex(from: string, to: string, amount: number): string {
  const color = new Color(from).lerp(new Color(to), Math.min(1, Math.max(0, amount)));
  return `#${color.getHexString()}`;
}

export function darkenHex(hex: string, amount: number): string {
  return `#${new Color(hex).multiplyScalar(Math.max(0, 1 - amount)).getHexString()}`;
}

const SKY_BY_TIME: Record<
  TimeOfDayId,
  { top: string; bottom: string; horizon: string }
> = {
  morning: { top: '#7fa6c4', bottom: '#f3dcc1', horizon: '#f7e0c8' },
  day: { top: '#5799c5', bottom: '#cfe5df', horizon: '#dcebe3' },
  dusk: { top: '#4a527c', bottom: '#f09a6c', horizon: '#f7b47e' },
  night: { top: '#050814', bottom: '#17243a', horizon: '#26364e' },
};

const SUN_BY_TIME: Record<TimeOfDayId, string> = {
  morning: '#ffe4bb',
  day: '#fff8e7',
  dusk: '#ffb077',
  night: '#cad8ff',
};

const LIGHT_BY_TIME: Record<TimeOfDayId, [number, number, number]> = {
  morning: [-34, 20, 24],
  day: [26, 46, 20],
  dusk: [-42, 12, -18],
  night: [24, 38, -28],
};

interface WeatherMood {
  skyMix: number;
  skyTint: string;
  darken: number;
  fogMix: number;
}

const WEATHER_MOOD: Record<WeatherId, WeatherMood> = {
  clear: { skyMix: 0, skyTint: '#ffffff', darken: 0, fogMix: 0.1 },
  cloudy: { skyMix: 0.48, skyTint: '#9099a1', darken: 0.08, fogMix: 0.35 },
  windy: { skyMix: 0.16, skyTint: '#b5c0c5', darken: 0.02, fogMix: 0.2 },
  'light-rain': { skyMix: 0.58, skyTint: '#77828b', darken: 0.16, fogMix: 0.55 },
  'heavy-rain': { skyMix: 0.74, skyTint: '#4d5862', darken: 0.3, fogMix: 0.8 },
  snow: { skyMix: 0.5, skyTint: '#c2ccd2', darken: 0.06, fogMix: 0.62 },
};

const SEASONWAY: Record<
  SeasonId,
  {
    ground: string;
    foliage: string;
    foliageLight: string;
    waterShallow: string;
    waterDeep: string;
    accent: string;
  }
> = {
  spring: {
    ground: '#729b55',
    foliage: '#8ccb6b',
    foliageLight: '#c1df85',
    waterShallow: '#79b4a8',
    waterDeep: '#3b7980',
    accent: '#f4b8cd',
  },
  summer: {
    ground: '#4f8247',
    foliage: '#3e8c50',
    foliageLight: '#6fae5e',
    waterShallow: '#4e9aa0',
    waterDeep: '#286878',
    accent: '#ffd37d',
  },
  autumn: {
    ground: '#8d7a42',
    foliage: '#d28736',
    foliageLight: '#e8b45a',
    waterShallow: '#6b8f8a',
    waterDeep: '#355e64',
    accent: '#f5a35b',
  },
  winter: {
    ground: '#d7e2e9',
    foliage: '#789085',
    foliageLight: '#9db1a5',
    waterShallow: '#b7cfd6',
    waterDeep: '#6b8e9a',
    accent: '#dcecf7',
  },
};

export function getSceneTheme(environment: WorldEnvironment): SceneTheme {
  const sky = SKY_BY_TIME[environment.timeOfDay];
  const mood = WEATHER_MOOD[environment.weather];
  const night = environment.timeOfDay === 'night';
  const seasonal = SEASONWAY[environment.season];

  const skyTop = darkenHex(
    mixHex(sky.top, mood.skyTint, mood.skyMix),
    mood.darken,
  );
  const skyBottom = darkenHex(
    mixHex(sky.bottom, mood.skyTint, mood.skyMix * 0.75),
    mood.darken * 0.8,
  );
  const horizon = darkenHex(
    mixHex(sky.horizon, mood.skyTint, mood.skyMix * 0.6),
    mood.darken * 0.6,
  );
  const lightPosition = LIGHT_BY_TIME[environment.timeOfDay];
  const lightScale = night ? 130 : 110;

  return {
    skyTop,
    skyBottom,
    horizon,
    fog: mixHex(horizon, mood.skyTint, mood.fogMix + 0.12),
    sunColor: SUN_BY_TIME[environment.timeOfDay],
    ambientColor: night ? '#8ea4ca' : '#f5ecd9',
    groundTint: seasonal.ground,
    foliage: seasonal.foliage,
    foliageLight: seasonal.foliageLight,
    snowCap: '#eef5f8',
    waterShallow:
      environment.season === 'winter' ? '#b7cfd6' : seasonal.waterShallow,
    waterDeep: seasonal.waterDeep,
    accent: seasonal.accent,
    cloudColor:
      environment.weather === 'heavy-rain'
        ? '#59646d'
        : environment.weather === 'light-rain'
          ? '#7f8a92'
          : night
            ? '#79879c'
            : '#f1f1ec',
    lightPosition,
    sunPosition: [
      (lightPosition[0] / 55) * lightScale,
      (lightPosition[1] / 55) * lightScale,
      (lightPosition[2] / 55) * lightScale,
    ],
    isNight: night,
    isDusk: environment.timeOfDay === 'dusk',
    bloomLike: night || environment.timeOfDay === 'dusk',
  };
}

const SUN_BASE: Record<TimeOfDayId, number> = {
  morning: 2.1,
  day: 2.9,
  dusk: 1.7,
  night: 0.4,
};

const AMBIENT_BASE: Record<TimeOfDayId, number> = {
  morning: 0.55,
  day: 0.65,
  dusk: 0.45,
  night: 0.26,
};

const WEATHER_FOG: Record<WeatherId, number> = {
  clear: 0.007,
  cloudy: 0.011,
  'light-rain': 0.017,
  'heavy-rain': 0.024,
  windy: 0.01,
  snow: 0.02,
};

const WEATHER_SUN_FACTOR: Record<WeatherId, number> = {
  clear: 1,
  cloudy: 0.55,
  'light-rain': 0.35,
  'heavy-rain': 0.2,
  windy: 0.9,
  snow: 0.45,
};

const WEATHER_AMBIENT_BONUS: Record<WeatherId, number> = {
  clear: 0,
  cloudy: 0.06,
  'light-rain': 0.04,
  'heavy-rain': 0.02,
  windy: 0,
  snow: 0.12,
};

export function recommendedLighting(
  weather: WeatherId,
  timeOfDay: TimeOfDayId,
): Pick<WorldEnvironment, 'sunIntensity' | 'ambientIntensity' | 'fogDensity'> {
  const round1 = (value: number) => Math.round(value * 10) / 10;
  return {
    sunIntensity: round1((SUN_BASE[timeOfDay] ?? 2.6) * WEATHER_SUN_FACTOR[weather]),
    ambientIntensity: round1(
      (AMBIENT_BASE[timeOfDay] ?? 0.6) + WEATHER_AMBIENT_BONUS[weather],
    ),
    fogDensity: WEATHER_FOG[weather] ?? 0.008,
  };
}

export function windStrength(weather: WeatherId): number {
  switch (weather) {
    case 'windy':
      return 1;
    case 'heavy-rain':
      return 0.75;
    case 'light-rain':
      return 0.45;
    case 'snow':
      return 0.3;
    case 'cloudy':
      return 0.2;
    default:
      return 0.12;
  }
}
