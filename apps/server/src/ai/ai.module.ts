import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { LiveConceptImageProvider } from './live-concept-provider';
import { SettingsModule } from '../settings/settings.module';
import { MockChatProvider } from './mock/mock-chat-provider';
import { MockConceptImageProvider } from './mock/mock-concept-provider';
import { MockImageAnalyzer } from './mock/mock-image-analyzer';
import { MockPromptExpander } from './mock/mock-prompt-expander';
import { MockWorldPlanner } from './mock/mock-world-planner';
import {
  CHAT_PROVIDER,
  CONCEPT_IMAGE_PROVIDER,
  IMAGE_ANALYZER,
  PROMPT_EXPANDER,
  WORLD_PLANNER,
} from './providers/provider.tokens';

@Module({
  imports: [SettingsModule],
  providers: [
    MockPromptExpander,
    MockConceptImageProvider,
    LiveConceptImageProvider,
    MockImageAnalyzer,
    MockWorldPlanner,
    MockChatProvider,
    { provide: PROMPT_EXPANDER, useExisting: MockPromptExpander },
    { provide: CONCEPT_IMAGE_PROVIDER, useExisting: MockConceptImageProvider },
    { provide: IMAGE_ANALYZER, useExisting: MockImageAnalyzer },
    { provide: WORLD_PLANNER, useExisting: MockWorldPlanner },
    { provide: CHAT_PROVIDER, useExisting: MockChatProvider },
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
