import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ImageSettingsController } from './image-settings.controller';
import { ImageSettingsService } from './image-settings.service';

const input = { enabled: true, baseURL: 'https://api.openai.com/v1', model: 'gpt-image-1', apiKey: 'image-stub-key' };

describe('ImageSettingsController', () => {
  let directory: string;
  let settings: ImageSettingsService;
  let controller: ImageSettingsController;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'studio-image-settings-controller-'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network forbidden')));
    settings = new ImageSettingsService({ port: 4000, aiMode: 'mock', dataDir: directory });
    await settings.onModuleInit();
    controller = new ImageSettingsController(settings);
  });
  afterEach(async () => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it('requires the local client header on every image settings operation', () => {
    expect(() => controller.get(undefined)).toThrow('Missing local');
    expect(() => controller.save('wrong', input)).toThrow('Missing local');
    expect(() => controller.clear(undefined)).toThrow('Missing local');
    expect(settings.getSettings().hasApiKey).toBe(false);
  });

  it('read/save/clear never call a provider or return a secret', async () => {
    const saved = await controller.save('local-ui', input);
    const read = controller.get('local-ui');
    const cleared = await controller.clear('local-ui');
    expect(saved.hasApiKey).toBe(true);
    expect(read).toEqual(saved);
    expect(cleared).toMatchObject({ enabled: false, hasApiKey: false });
    for (const response of [saved, read, cleared]) {
      expect(response).not.toHaveProperty('apiKey');
      expect(JSON.stringify(response)).not.toContain(input.apiKey);
    }
  });

  it('exposes GET/PUT settings/images and DELETE settings/images/key with no-store', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ImageSettingsController)).toBe('settings/images');
    for (const [method, verb, path] of [
      ['get', RequestMethod.GET, '/'], ['save', RequestMethod.PUT, '/'], ['clear', RequestMethod.DELETE, 'key'],
    ] as const) {
      const handler = ImageSettingsController.prototype[method];
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });
});
