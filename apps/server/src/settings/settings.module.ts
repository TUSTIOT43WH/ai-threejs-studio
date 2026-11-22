import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config';
import { CompatibleChatService } from './compatible-chat.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ImageSettingsController } from './image-settings.controller';
import { ImageSettingsService } from './image-settings.service';
import { ModelingDiagnosticsService } from './modeling-diagnostics.service';

@Module({
  controllers: [SettingsController, ImageSettingsController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    SettingsService,
    ImageSettingsService,
    CompatibleChatService,
    ModelingDiagnosticsService,
  ],
  exports: [SettingsService, ImageSettingsService, CompatibleChatService],
})
export class SettingsModule {}
