import type { ImageApiOptions, SaveImageSettingsRequest } from '@ai-three-studio/shared';
import { IsBoolean, IsIn, IsString, Length, Matches, MaxLength, ValidateBy, ValidateIf } from 'class-validator';
import { isPublicApiUrl } from './public-api-url';

export class SaveImageSettingsDto implements SaveImageSettingsRequest {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MaxLength(2048)
  @ValidateBy({ name: 'isPublicApiUrl', validator: { validate: (value: unknown) => isPublicApiUrl(value), defaultMessage: () => 'baseURL must be a public HTTPS endpoint without credentials, query or fragment' } })
  baseURL!: string;

  @IsString()
  @Length(1, 160)
  @Matches(/^[^\s\x00-\x1f\x7f]+$/u, { message: 'model must be a non-empty model ID without whitespace' })
  model!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['openai', 'seedream', 'gemini', 'dashscope'])
  protocol?: ImageApiOptions['protocol'] = 'openai';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(80)
  @Matches(/^[^\s\x00-\x1f\x7f-\x9f]*$/u, { message: 'size must be empty or a non-whitespace size string' })
  size?: string = '';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['auto', 'b64_json', 'url'])
  responseFormat?: ImageApiOptions['responseFormat'] = 'auto';

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1024)
  @Matches(/^[\x21-\x7e]*$/, { message: 'apiKey must contain only printable non-whitespace characters' })
  apiKey?: string;
}
