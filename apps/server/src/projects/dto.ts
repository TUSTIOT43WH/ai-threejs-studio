import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_MODELING_PROMPT_LENGTH } from '@ai-three-studio/shared';

export class CreateProjectDto {
  @IsString()
  @Length(2, 600)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_500_000)
  referenceImageDataUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenceFileName?: string;
}

export class GenerateConceptsDto {
  @IsIn(['more', 'similar'])
  mode!: 'more' | 'similar';

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(5)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  baseConceptId?: string;
}

export class PrepareWorldPromptDto {
  @IsString()
  @Length(1, 100)
  conceptId!: string;
}

export class GenerateWorldDto {
  @IsString()
  @Length(1, 100)
  conceptId!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  regenerate?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  promptDraftId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MODELING_PROMPT_LENGTH)
  modelingPrompt?: string;
}

export class SaveWorldDto {
  @IsObject()
  world!: unknown;
}

export class ChatDto {
  @IsString()
  @Length(1, 500)
  message!: string;
}
