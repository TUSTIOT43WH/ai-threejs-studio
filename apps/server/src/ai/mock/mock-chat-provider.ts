import { Injectable } from '@nestjs/common';
import type {
  ChatProvider,
  ChatReply,
  ChatRequest,
  EnvironmentHints,
  ProviderInfo,
} from '@ai-three-studio/shared';
import {
  detectEnvironmentHints,
  SEASON_LABELS,
  TIME_LABELS,
  WEATHER_LABELS,
} from './scene-profiles';

function describeHints(hints: EnvironmentHints): string {
  return [
    hints.season ? SEASON_LABELS[hints.season] : null,
    hints.weather ? WEATHER_LABELS[hints.weather] : null,
    hints.timeOfDay ? TIME_LABELS[hints.timeOfDay] : null,
  ]
    .filter((word): word is string => Boolean(word))
    .join(' · ');
}

@Injectable()
export class MockChatProvider implements ChatProvider {
  readonly info: ProviderInfo = {
    id: 'mock-chat-assistant',
    displayName: 'Mock Studio Assistant',
    kind: 'chat',
    mode: 'mock',
    description:
      'Keyword-based studio assistant. Suggests environment previews; does not edit the World Schema in Phase 1.',
  };

  async reply(request: ChatRequest): Promise<ChatReply> {
    const message = request.message.trim();
    const hints = detectEnvironmentHints(message);
    const hintText = describeHints(hints);

    if (hintText) {
      return {
        content:
          `我从描述里识别到「${hintText}」。\n\n` +
          'Phase 1 的 Mock 助手还不会改写场景结构，但你可以点击下方按钮，把当前预览的四季 / 天气 / 时间一键切到对应状态。' +
          '你也能在右侧「环境」面板手动调整。真正的自然语言增量编辑（加河流、放大木屋、增加玩法）会在 Phase 4 接入。',
        mock: true,
        provider: this.info.id,
        environmentSuggestion: hints,
      };
    }

    if (/(加|添加|新增|删除|移除|变大|变小|移动|金币|河流|角色|游戏)/.test(message)) {
      return {
        content:
          '这个需求需要真正修改 World Schema。Phase 1 只验证「一句话 → 概念图 → 可交互 3D 预览」链路，' +
          '当前助手是关键词匹配的 Mock，不会假装已经完成修改。\n\n' +
          '右侧属性面板已支持调整对象的位置 / 旋转 / 缩放与颜色；自然语言增量编辑和游戏生成会在 Phase 3–4 接入。',
        mock: true,
        provider: this.info.id,
      };
    }

    if (/(季节|春|夏|秋|冬|天气|雨|雪|晴|夜|黄昏|光)/.test(message)) {
      return {
        content:
          '当前场景已经支持季节、天气与一天中光线的实时预览，都由 World Schema 的 environment 驱动。' +
          '季节会改变植被与地面材质，天气会叠加雨雪粒子、雾气与湿润感。试试右侧的「环境」面板。',
        mock: true,
        provider: this.info.id,
      };
    }

    return {
      content:
        '我是 Phase 1 的 Mock 工作室助手，用本地关键词规则运行，不是大语言模型，也不会冒充已完成的操作。\n\n' +
        '目前你可以：\n' +
        '· 在左侧对象树中选择独立对象，在右侧修改变换与颜色\n' +
        '· 在右侧切换季节、天气、时间，实时查看环境变化\n' +
        '· 点击顶部保存，把编辑后的 World Schema 写回演示存储\n\n' +
        '试试对我说「改成冬天」或「下点小雨」，我会给出可直接应用的环境建议。',
      mock: true,
      provider: this.info.id,
    };
  }
}
