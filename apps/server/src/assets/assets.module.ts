import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config';
import { AssetStore } from './asset-store';
import { AssetsController } from './assets.controller';

@Module({
  controllers: [AssetsController],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }, AssetStore],
  exports: [AssetStore],
})
export class AssetsModule {}
