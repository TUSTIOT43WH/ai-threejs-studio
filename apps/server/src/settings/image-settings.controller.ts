import { Body, Controller, Delete, ForbiddenException, Get, Headers, Header, Inject, Put } from '@nestjs/common';
import type { ImageSettings } from '@ai-three-studio/shared';
import { LOCAL_CLIENT_HEADER, LOCAL_CLIENT_VALUE } from '../local-api-security';
import { SaveImageSettingsDto } from './image-settings.dto';
import { ImageSettingsService } from './image-settings.service';

@Controller('settings/images')
export class ImageSettingsController {
  constructor(@Inject(ImageSettingsService) private readonly settings: ImageSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined): ImageSettings {
    this.checkClient(client);
    return this.settings.getSettings();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  save(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined, @Body() dto: SaveImageSettingsDto): Promise<ImageSettings> {
    this.checkClient(client);
    // Saving is local only; it must never trigger a billable image request.
    return this.settings.save(dto);
  }

  @Delete('key')
  @Header('Cache-Control', 'no-store')
  clear(@Headers(LOCAL_CLIENT_HEADER) client: string | undefined): Promise<ImageSettings> {
    this.checkClient(client);
    return this.settings.clearKey();
  }

  private checkClient(client: string | undefined): void {
    if (client !== LOCAL_CLIENT_VALUE) throw new ForbiddenException('Missing local Studio request header.');
  }
}
