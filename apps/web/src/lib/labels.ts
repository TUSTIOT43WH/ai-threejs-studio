import type {
  ConceptStyleId,
  SeasonId,
  TimeOfDayId,
  WeatherId,
  WorldObjectKind,
} from '@ai-three-studio/shared';

export const SEASON_OPTIONS: Array<{ id: SeasonId; label: string; hint: string }> = [
  { id: 'spring', label: '春季', hint: '嫩绿 · 花朵' },
  { id: 'summer', label: '夏季', hint: '浓绿 · 日照' },
  { id: 'autumn', label: '秋季', hint: '红叶 · 落叶' },
  { id: 'winter', label: '冬季', hint: '积雪 · 冷杉' },
];

export const WEATHER_OPTIONS: Array<{
  id: WeatherId;
  label: string;
  hint: string;
}> = [
  { id: 'clear', label: '晴朗', hint: '清透光线' },
  { id: 'cloudy', label: '多云', hint: '云层柔光' },
  { id: 'light-rain', label: '小雨', hint: '细雨湿润' },
  { id: 'heavy-rain', label: '大雨', hint: '浓雾骤雨' },
  { id: 'windy', label: '大风', hint: '树叶摆动' },
  { id: 'snow', label: '降雪', hint: '飘雪寒气' },
];

export const TIME_OPTIONS: Array<{
  id: TimeOfDayId;
  label: string;
  hint: string;
}> = [
  { id: 'morning', label: '清晨', hint: '低角度暖光' },
  { id: 'day', label: '白天', hint: '明亮直射' },
  { id: 'dusk', label: '傍晚', hint: '橙紫暮光' },
  { id: 'night', label: '夜晚', hint: '月光与灯火' },
];

export const SEASON_LABELS: Record<SeasonId, string> = {
  spring: '春季',
  summer: '夏季',
  autumn: '秋季',
  winter: '冬季',
};

export const WEATHER_LABELS: Record<WeatherId, string> = {
  clear: '晴朗',
  cloudy: '多云',
  'light-rain': '小雨',
  'heavy-rain': '大雨',
  windy: '大风',
  snow: '降雪',
};

export const TIME_LABELS: Record<TimeOfDayId, string> = {
  morning: '清晨',
  day: '白天',
  dusk: '傍晚',
  night: '夜晚',
};

export const OBJECT_KIND_LABELS: Record<WorldObjectKind, string> = {
  ground: '地面',
  water: '水面',
  hill: '山丘',
  path: '路径',
  cabin: '木屋',
  house: '房屋',
  tower: '塔楼',
  tent: '帐篷',
  sign: '招牌',
  tree: '树木',
  rock: '岩石',
  lamp: '路灯',
  campfire: '篝火',
  boat: '船只',
  cloud: '云层',
  primitive: '几何部件',
  procedural: '程序化对象',
  model: '模型资产',
};

export const OBJECT_KIND_COLORS: Record<WorldObjectKind, string> = {
  ground: '#8a7f63',
  water: '#4fa3b8',
  hill: '#7c8a63',
  path: '#a49373',
  cabin: '#c08b57',
  house: '#b8a27d',
  tower: '#7c8bd8',
  tent: '#d9a25c',
  sign: '#f0abfc',
  tree: '#6cae6f',
  rock: '#8b8b86',
  lamp: '#ffd18a',
  campfire: '#ff9f5d',
  boat: '#b28a64',
  cloud: '#c8d5df',
  primitive: '#74d6c3',
  procedural: '#a78bfa',
  model: '#fca5a5',
};

export const STYLE_TONES: Record<
  ConceptStyleId,
  { chip: string; dot: string }
> = {
  'painterly-dream': {
    chip: 'border-rose-300/25 bg-rose-300/10 text-rose-100',
    dot: '#f9a8d4',
  },
  'low-poly': {
    chip: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
    dot: '#6ee7b7',
  },
  'cinematic-teal': {
    chip: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
    dot: '#67e8f9',
  },
  'storybook-watercolor': {
    chip: 'border-amber-200/25 bg-amber-200/10 text-amber-100',
    dot: '#fde68a',
  },
  'neon-noir': {
    chip: 'border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100',
    dot: '#f0abfc',
  },
};

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(then));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
