import { BadRequestException, Inject, Injectable, InternalServerErrorException, type OnModuleInit } from '@nestjs/common';
import type { ImageApiOptions, ImageSettings, SaveImageSettingsRequest } from '@ai-three-studio/shared';
import { validateSync } from 'class-validator';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config';
import { SaveImageSettingsDto } from './image-settings.dto';

/** Server-only snapshot. Never return this from an endpoint or store it in a project. */
export interface PrivateImageSettings extends ImageApiOptions {
  enabled: boolean;
  baseURL: string;
  model: string;
  apiKey: string;
}

@Injectable()
export class ImageSettingsService implements OnModuleInit {
  private current: PrivateImageSettings = {
    enabled: false,
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
    protocol: 'openai',
    size: '',
    responseFormat: 'auto',
    apiKey: '',
  };
  private readonly filePath: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.filePath = join(config.dataDir, 'images-settings.json');
  }

  async onModuleInit(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      const dto = this.validate(parsed as SaveImageSettingsRequest);
      if (dto.enabled && !dto.apiKey) throw new Error();
      await chmod(this.config.dataDir, 0o700);
      await chmod(this.filePath, 0o600);
      this.current = {
        enabled: dto.enabled, baseURL: dto.baseURL, model: dto.model, apiKey: dto.apiKey ?? '',
        protocol: dto.protocol, size: dto.size, responseFormat: dto.responseFormat,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw new Error('Cannot load image settings. Check the local images-settings.json file and its permissions.');
    }
  }

  getSettings(): ImageSettings {
    return {
      enabled: this.current.enabled,
      baseURL: this.current.baseURL,
      model: this.current.model,
      protocol: this.current.protocol ?? 'openai',
      size: this.current.size ?? '',
      responseFormat: this.current.responseFormat ?? 'auto',
      hasApiKey: Boolean(this.current.apiKey),
    };
  }

  getImageConfig(): PrivateImageSettings {
    return { ...this.current };
  }

  save(input: SaveImageSettingsRequest): Promise<ImageSettings> {
    return this.enqueue(async () => {
      const dto = this.validate(input);
      // Even accepted spelling or protocol changes require re-entering the image key.
      const unchangedEndpoint = dto.baseURL === this.current.baseURL && dto.protocol === (this.current.protocol ?? 'openai');
      const apiKey = dto.apiKey || (unchangedEndpoint ? this.current.apiKey : '');
      if (dto.enabled && !apiKey) {
        throw new BadRequestException('启用真实概念图需要独立的图片 API Key；更换地址或协议后请重新输入密钥。不会使用建模密钥。');
      }
      await this.persist({
        enabled: dto.enabled, baseURL: dto.baseURL, model: dto.model, apiKey,
        protocol: dto.protocol, size: dto.size, responseFormat: dto.responseFormat,
      });
      return this.getSettings();
    });
  }

  clearKey(): Promise<ImageSettings> {
    return this.enqueue(async () => {
      await this.persist({ ...this.current, apiKey: '', enabled: false });
      return this.getSettings();
    });
  }

  private validate(input: SaveImageSettingsRequest): SaveImageSettingsDto {
    const dto = Object.assign(new SaveImageSettingsDto(), input);
    if (validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }).length) {
      throw new BadRequestException('图片设置无效。请使用公共 HTTPS 地址，并检查协议、模型、尺寸、返回格式与密钥。');
    }
    dto.protocol ??= 'openai';
    dto.size ??= '';
    dto.responseFormat ??= 'auto';
    return dto;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async persist(next: PrivateImageSettings): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      await chmod(this.config.dataDir, 0o700);
      await writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, this.filePath);
      this.current = next;
    } catch {
      throw new InternalServerErrorException('无法保存图片设置，请检查本地服务数据目录的写入权限。');
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
