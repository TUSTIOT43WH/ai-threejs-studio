import type { ChatApiOptions, SaveChatSettingsRequest } from '@ai-three-studio/shared';
import { IsBoolean, IsIn, IsInt, IsString, Length, Matches, Max, MaxLength, Min, ValidateBy, ValidateIf } from 'class-validator';
import { isPublicApiUrl } from './public-api-url';

export class SaveChatSettingsDto implements SaveChatSettingsRequest {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  modelingEnabled!: boolean;

  @IsString()
  @MaxLength(2048)
  @ValidateBy({ name: 'isPublicApiUrl', validator: { validate: (value: unknown) => isPublicApiUrl(value), defaultMessage: () => 'baseURL must be a public HTTPS endpoint without credentials, query or fragment' } })
  baseURL!: string;

  @IsString()
  @Length(1, 160)
  @Matches(/^[^\s\x00-\x1f\x7f]+$/u, { message: 'model must be a non-empty model ID without whitespace' })
  model!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['openai', 'openai-responses', 'anthropic', 'gemini'])
  protocol?: ChatApiOptions['protocol'] = 'openai';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  jsonMode?: boolean = false;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['max_tokens', 'max_completion_tokens', 'omit'])
  tokenParameter?: ChatApiOptions['tokenParameter'] = 'max_tokens';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(65536)
  maxOutputTokens?: number = 10000;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1024)
  @Matches(/^[\x21-\x7e]*$/, { message: 'apiKey must contain only printable non-whitespace characters' })
  apiKey?: string;
}
