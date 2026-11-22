import { BadRequestException, Inject, Injectable, InternalServerErrorException, type OnModuleInit } from '@nestjs/common';
import type { ChatApiOptions, ChatSettings, SaveChatSettingsRequest } from '@ai-three-studio/shared';
import { validateSync } from 'class-validator';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config';
import { SaveChatSettingsDto } from './dto';

/** Server-only snapshot; never serialize this through a controller. */
export interface PrivateChatSettings extends ChatApiOptions {
  enabled: boolean;
  modelingEnabled: boolean;
  baseURL: string;
  model: string;
  apiKey: string;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private current: PrivateChatSettings = {
    enabled: false,
    modelingEnabled: false,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    protocol: 'openai',
    jsonMode: false,
    tokenParameter: 'max_tokens',
    maxOutputTokens: 10000,
    apiKey: '',
  };
  private readonly filePath: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.filePath = join(config.dataDir, 'chat-settings.json');
  }

  async onModuleInit(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      // Supply legacy defaults without rewriting the stored endpoint, key or switches.
      const dto = this.validate({ modelingEnabled: false, ...parsed } as SaveChatSettingsRequest);
      if ((dto.enabled || dto.modelingEnabled) && !dto.apiKey) throw new Error();
      await chmod(this.filePath, 0o600);
      this.current = {
        enabled: dto.enabled, modelingEnabled: dto.modelingEnabled, baseURL: dto.baseURL, model: dto.model, apiKey: dto.apiKey ?? '',
        protocol: dto.protocol, jsonMode: dto.jsonMode, tokenParameter: dto.tokenParameter, maxOutputTokens: dto.maxOutputTokens,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      // Fail closed: do not silently switch to Mock or include file/key contents.
      throw new Error('Cannot load chat settings. Check the local chat-settings.json file and its permissions.');
    }
  }

  getSettings(): ChatSettings {
    return {
      enabled: this.current.enabled,
      modelingEnabled: this.current.modelingEnabled,
      baseURL: this.current.baseURL,
      model: this.current.model,
      protocol: this.current.protocol ?? 'openai',
      jsonMode: this.current.jsonMode ?? false,
      tokenParameter: this.current.tokenParameter ?? 'max_tokens',
      maxOutputTokens: this.current.maxOutputTokens ?? 10000,
      hasApiKey: Boolean(this.current.apiKey),
    };
  }

  getChatConfig(): PrivateChatSettings {
    return { ...this.current };
  }

  save(input: SaveChatSettingsRequest): Promise<ChatSettings> {
    // Serialize read-modify-write operations, including clear, to avoid key resurrection.
    return this.enqueue(async () => {
      const dto = this.validate(input);
      const unchangedEndpoint = dto.baseURL === this.current.baseURL && dto.protocol === (this.current.protocol ?? 'openai');
      const apiKey = dto.apiKey || (unchangedEndpoint ? this.current.apiKey : '');
      if ((dto.enabled || dto.modelingEnabled) && !apiKey) {
        throw new BadRequestException('启用真实对话或 AI 建模需要 API Key；更换地址或协议后请重新输入密钥。');
      }
      await this.persist({
        enabled: dto.enabled, modelingEnabled: dto.modelingEnabled, baseURL: dto.baseURL, model: dto.model, apiKey,
        protocol: dto.protocol, jsonMode: dto.jsonMode, tokenParameter: dto.tokenParameter, maxOutputTokens: dto.maxOutputTokens,
      });
      return this.getSettings();
    });
  }

  clearKey(): Promise<ChatSettings> {
    return this.enqueue(async () => {
      await this.persist({ ...this.current, apiKey: '', enabled: false, modelingEnabled: false });
      return this.getSettings();
    });
  }

  private validate(input: SaveChatSettingsRequest): SaveChatSettingsDto {
    const dto = Object.assign(new SaveChatSettingsDto(), input);
    if (validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }).length) {
      throw new BadRequestException('设置无效。请使用公共 HTTPS 地址，并检查协议、模型、输出参数与密钥。');
    }
    dto.protocol ??= 'openai';
    dto.jsonMode ??= false;
    dto.tokenParameter ??= 'max_tokens';
    dto.maxOutputTokens ??= 10000;
    return dto;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async persist(next: PrivateChatSettings): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
      this.current = next;
    } catch {
      throw new InternalServerErrorException('无法保存对话设置，请检查本地服务数据目录的写入权限。');
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
