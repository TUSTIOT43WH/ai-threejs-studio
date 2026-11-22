import type {
  ConceptStyleId,
  EnvironmentHints,
  SeasonId,
  TimeOfDayId,
  WeatherId,
} from '@ai-three-studio/shared';

export type SceneProfileId =
  | 'forest-cabin'
  | 'cyberpunk-city'
  | 'seaside-town'
  | 'snow-camp'
  | 'meadow';

export interface SceneProfileDefinition {
  id: SceneProfileId;
  sceneLabel: string;
  summary: string;
  keyElements: string[];
  mood: string;
  paletteHint: string;
  basePromptEn: string;
  keywords: string[];
  defaultEnvironment: {
    season: SeasonId;
    weather: WeatherId;
    timeOfDay: TimeOfDayId;
  };
  preferredStyles: ConceptStyleId[];
}

export const SCENE_PROFILES: SceneProfileDefinition[] = [
  {
    id: 'forest-cabin',
    sceneLabel: '林间小屋',
    summary:
      '松林深处的一间木屋，门前铺着碎石小径，暖黄的窗光落在苔藓上，远处湖水映着天光。',
    keyElements: ['木质小屋', '针叶林', '林间小径', '静谧湖泊', '散落岩石'],
    mood: '温暖、静谧、带一点童话感',
    paletteHint: '森林绿 · 原木色 · 琥珀灯光',
    basePromptEn:
      'a cozy wooden cabin in a pine forest, stepping-stone path, warm glowing windows, a quiet lake in the distance, scattered mossy rocks',
    keywords: [
      '林中小屋',
      '林间小屋',
      '小木屋',
      '木屋',
      '木屋旁',
      '森林',
      '松林',
      '树林',
      'cabin',
      'forest',
      'woods',
    ],
    defaultEnvironment: { season: 'summer', weather: 'clear', timeOfDay: 'day' },
    preferredStyles: [
      'painterly-dream',
      'cinematic-teal',
      'storybook-watercolor',
      'low-poly',
      'neon-noir',
    ],
  },
  {
    id: 'cyberpunk-city',
    sceneLabel: '赛博朋克都市',
    summary:
      '高耸的塔楼夹出狭窄街道，霓虹竖牌与窗光层层叠叠，湿亮的路面倒映着紫青色天幕。',
    keyElements: ['霓虹招牌', '高层塔楼', '发光路网', '湿润街道', '夜色云层'],
    mood: '锋利、迷幻、张力十足',
    paletteHint: '电光青 · 品红霓虹 · 深紫夜色',
    basePromptEn:
      'a cyberpunk city street between towering skyscrapers, vertical neon signs, glowing windows, wet reflective asphalt, dramatic night sky',
    keywords: [
      '赛博',
      '朋克',
      '霓虹',
      '未来城市',
      '未来都市',
      'cyberpunk',
      'neon city',
      'futuristic city',
      '科幻城市',
    ],
    defaultEnvironment: { season: 'summer', weather: 'clear', timeOfDay: 'night' },
    preferredStyles: [
      'neon-noir',
      'cinematic-teal',
      'low-poly',
      'painterly-dream',
      'storybook-watercolor',
    ],
  },
  {
    id: 'seaside-town',
    sceneLabel: '海边小镇',
    summary:
      '浅色房子沿着海岸排开，棕榈与帆船浸在明亮的海风里，浪花把阳光揉成细碎的金色。',
    keyElements: ['彩色小屋', '海岸线', '帆船', '棕榈树', '贝壳与礁石'],
    mood: '清透、松弛、充满夏日呼吸感',
    paletteHint: '海盐白 · 珊瑚粉 · 浅海蓝',
    basePromptEn:
      'a pastel seaside town along a gentle coastline, small colorful houses, palm trees, sailboats on turquoise water, bright summer light',
    keywords: [
      '海边',
      '海滨',
      '海岸',
      '海岸线',
      '沙滩',
      '海边小镇',
      '港口',
      '码头',
      '海湾',
      '海岛',
      '海面',
      '灯塔',
      '小船',
      '帆船',
      'seaside',
      'beach',
      'coast',
      'harbor',
      'lighthouse',
      'sailboat',
      'island',
    ],
    defaultEnvironment: { season: 'summer', weather: 'clear', timeOfDay: 'day' },
    preferredStyles: [
      'storybook-watercolor',
      'painterly-dream',
      'low-poly',
      'cinematic-teal',
      'neon-noir',
    ],
  },
  {
    id: 'snow-camp',
    sceneLabel: '雪山营地',
    summary:
      '雪松围出一块安静的营地，帐篷前篝火噼啪作响，暖光融开一小圈雪地，远山隐在暮色中。',
    keyElements: ['雪地', '帐篷', '篝火', '雪松', '远山'],
    mood: '凛冽、安静、篝火带来安全感',
    paletteHint: '雪白 · 冷蓝 · 篝火橙',
    basePromptEn:
      'a small camp in a snowy mountain valley, warm glowing tents, a campfire, frosted pine trees, distant mountains at blue hour',
    keywords: [
      '雪山',
      '雪地',
      '雪原',
      '雪中',
      '冰雪',
      '营地',
      '篝火',
      '滑雪',
      'snow camp',
      'snowy',
      'winter camp',
      'ski',
      'ice',
      '雪',
    ],
    defaultEnvironment: { season: 'winter', weather: 'clear', timeOfDay: 'dusk' },
    preferredStyles: [
      'cinematic-teal',
      'painterly-dream',
      'storybook-watercolor',
      'low-poly',
      'neon-noir',
    ],
  },
  {
    id: 'meadow',
    sceneLabel: '山谷草甸',
    summary:
      '开阔草甸铺向远山，阔叶树投下柔软的阴影，野花与小径一起延伸进金色的空气里。',
    keyElements: ['开阔草甸', '阔叶树', '野花', '远方山丘', '林间小径'],
    mood: '开阔、明亮、自然舒展',
    paletteHint: '嫩绿草甸 · 暖阳 · 远山蓝',
    basePromptEn:
      'a wide green meadow in a gentle valley, broadleaf trees, wildflowers, a winding footpath, soft rolling hills in the distance',
    keywords: [
      '草原',
      '草甸',
      '山谷',
      '花海',
      '草原小屋',
      'meadow',
      'valley',
      'grassland',
      'field',
    ],
    defaultEnvironment: { season: 'spring', weather: 'clear', timeOfDay: 'day' },
    preferredStyles: [
      'painterly-dream',
      'low-poly',
      'storybook-watercolor',
      'cinematic-teal',
      'neon-noir',
    ],
  },
];

const TIE_BREAK_ORDER: SceneProfileId[] = [
  'cyberpunk-city',
  'snow-camp',
  'seaside-town',
  'forest-cabin',
  'meadow',
];

export function detectSceneProfile(prompt: string): SceneProfileDefinition {
  const normalized = prompt.toLowerCase();
  let best: SceneProfileDefinition | null = null;
  let bestScore = 0;

  for (const profile of SCENE_PROFILES) {
    let score = 0;
    for (const keyword of profile.keywords) {
      if (normalized.includes(keyword)) {
        score += keyword.length >= 2 ? 2 : 1;
      }
    }
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    } else if (score > 0 && score === bestScore && best) {
      const currentRank = TIE_BREAK_ORDER.indexOf(profile.id);
      const bestRank = TIE_BREAK_ORDER.indexOf(best.id);
      if (currentRank < bestRank) {
        best = profile;
      }
    }
  }

  return best ?? (SCENE_PROFILES.find((p) => p.id === 'meadow') as SceneProfileDefinition);
}

export function getSceneProfile(id: SceneProfileId): SceneProfileDefinition {
  const profile = SCENE_PROFILES.find((entry) => entry.id === id);
  if (!profile) {
    throw new Error(`Unknown scene profile: ${id}`);
  }
  return profile;
}

export function detectEnvironmentHints(prompt: string): EnvironmentHints {
  const text = prompt.toLowerCase();
  const hints: EnvironmentHints = {};

  if (/(冬|雪|冰|winter)/i.test(text)) hints.season = 'winter';
  else if (/(秋|枫|落叶|autumn)/i.test(text)) hints.season = 'autumn';
  else if (/(春|spring)/i.test(text)) hints.season = 'spring';
  else if (/(夏|炎热|summer)/i.test(text)) hints.season = 'summer';

  if (/(暴雨|大雨|雷雨|暴风雨|storm|downpour)/i.test(text)) hints.weather = 'heavy-rain';
  else if (/(小雨|细雨|下雨|雨天|雨|rain|drizzle)/i.test(text)) hints.weather = 'light-rain';
  else if (/(下雪|飘雪|降雪|雪天|snowing|snowfall)/i.test(text)) hints.weather = 'snow';
  else if (/(大风|狂风|风大|windy|gale)/i.test(text)) hints.weather = 'windy';
  else if (/(多云|阴天|雾|cloudy|overcast|foggy)/i.test(text)) hints.weather = 'cloudy';
  else if (/(晴朗|晴天|阳光|sunny|clear)/i.test(text)) hints.weather = 'clear';

  if (/(夜晚|夜里|夜间|星空|深夜|night)/i.test(text)) hints.timeOfDay = 'night';
  else if (/(傍晚|黄昏|夕阳|日落|暮色|dusk|sunset|golden hour)/i.test(text)) {
    hints.timeOfDay = 'dusk';
  } else if (/(清晨|早晨|黎明|日出|morning|sunrise|dawn)/i.test(text)) {
    hints.timeOfDay = 'morning';
  } else if (/(白天|正午|daytime|noon)/i.test(text)) {
    hints.timeOfDay = 'day';
  }

  return hints;
}

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
  dusk: '黄昏',
  night: '夜晚',
};
