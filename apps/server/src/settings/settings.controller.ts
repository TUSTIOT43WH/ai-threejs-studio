import { Body, Controller, Delete, ForbiddenException, Get, Headers, Header, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { ChatSettings, TestChatSettingsResponse } from '@ai-three-studio/shared';
import { LOCAL_CLIENT_HEADER, LOCAL_CLIENT_VALUE } from '../local-api-security';
import { CompatibleChatService } from './compatible-chat.service';
import { SaveChatSettingsDto } from './dto';
import { SettingsService } from './settings.service';

@Controller('settings/chat')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CompatibleChatService) private readonly chat: CompatibleChatService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined): ChatSettings {
    this.checkClient(client);
    return this.settings.getSettings();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  save(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined, @Body() dto: SaveChatSettingsDto): Promise<ChatSettings> {
    this.checkClient(client);
    return this.settings.save(dto);
  }

  @Delete('key')
  @Header('Cache-Control', 'no-store')
  clear(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined): Promise<ChatSettings> {
    this.checkClient(client);
    return this.settings.clearKey();
  }

  @Post('test')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async test(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined): Promise<TestChatSettingsResponse> {
    this.checkClient(client);
    // Only explicit requests test saved settings; no automatic or startup calls.
    await this.chat.testConnection(this.settings.getChatConfig());
    return { ok: true, message: '连接测试成功。已发送一条真实对话请求，服务商可能收取 token 费用。' };
  }

  private checkClient(client: string | undefined): void {
    if (client !== LOCAL_CLIENT_VALUE) throw new ForbiddenException('Missing local Studio request header.');
  }
}
