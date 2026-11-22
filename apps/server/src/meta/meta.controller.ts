import { Controller, Get } from '@nestjs/common';
import type { AiMode, MetaResponse } from '@ai-three-studio/shared';
import { AiService } from '../ai/ai.service';

@Controller()
export class MetaController {
  constructor(private readonly ai: AiService) {}

  @Get('meta')
  getMeta(): MetaResponse {
    const providers = this.ai.describeProviders();
    return {
      appName: 'AI Three.js Studio',
      phase: 'Preview generation, visual prompt expansion and structured scene modeling',
      aiMode: providers.some((provider) => provider.mode === 'live') ? 'live' : 'mock',
      providers,
      disclaimers: [
        '概念图使用独立的图片设置与 API Key；AI 建模与文字对话共用另一组配置，由各自开关控制。关闭的功能使用本地 Mock，开启的功能调用真实 API。',
        '真实概念图依据原始文字生成；上传的参考图片暂不进行像素分析，相似图仅延续风格，非图生图。',
        '启用 AI 建模后，同一建模 API 先读取所选真实预览图并扩写精细提示词，再结合该图和提示词生成结构化场景；每次新建模包含两次可能计费的调用，模型须支持图片输入。程序化 Three.js 几何不是精确三维重建或生成式 GLB。',
        'API Key 仅保存在后端，保存设置不调用 API。每张真实概念图单独请求，可能收费；失败不会自动重试或回退 Mock，批次失败前已完成的请求仍可能计费。',
      ],
    };
  }

  @Get('health')
  getHealth(): { status: 'ok'; aiMode: AiMode; timestamp: string } {
    return {
      status: 'ok',
      aiMode: this.ai.describeProviders().some((provider) => provider.mode === 'live') ? 'live' : 'mock',
      timestamp: new Date().toISOString(),
    };
  }
}
