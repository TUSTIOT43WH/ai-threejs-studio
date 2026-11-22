import { Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SceneResource } from '@ai-three-studio/shared';
import { AssetStore } from './asset-store';
import { validateAssetInput } from './asset-validation';

// Uses the application's existing global localApiSecurity middleware; no guard exemptions.
@Controller('assets')
export class AssetsController {
  constructor(@Inject(AssetStore) private readonly assets: AssetStore) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(): { assets: SceneResource[] } {
    return { assets: this.assets.list() };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  import(@Body() body: unknown): Promise<SceneResource> {
    return this.assets.import(validateAssetInput(body));
  }

  @Get(':id/file')
  async file(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() response: Response): Promise<void> {
    const { resource, data } = await this.assets.read(id);
    response.setHeader('Content-Type', resource.mimeType);
    response.setHeader('Content-Length', data.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('ETag', `"${resource.sha256}"`);
    response.send(data);
  }
}
