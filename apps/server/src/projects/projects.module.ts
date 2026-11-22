import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { APP_CONFIG, loadConfig } from '../config';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectStore } from './project.store';
import { WorldJobStore } from './world-job.store';

@Module({
  imports: [AiModule],
  controllers: [ProjectsController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    ProjectStore,
    WorldJobStore,
    ProjectsService,
  ],
})
export class ProjectsModule {}
