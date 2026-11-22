import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { MetaController } from './meta/meta.controller';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [AiModule, ProjectsModule],
  controllers: [MetaController],
})
export class AppModule {}
