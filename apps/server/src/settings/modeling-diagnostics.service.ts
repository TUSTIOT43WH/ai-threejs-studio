import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config';

@Injectable()
export class ModelingDiagnosticsService {
  private readonly logger = new Logger('ModelingDiagnostics');
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async retain(stage: '建模' | '看图扩写', response: string, apiKey: string, reason: 'json' | 'schema', path?: string): Promise<void> {
    try {
      const decoded = response.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      const credentialEcho = Boolean(apiKey && (response.includes(apiKey) || decoded.includes(apiKey)));
      const id = randomUUID();
      const directory = join(this.config.dataDir, 'modeling-diagnostics');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${id}.json`), JSON.stringify({
        version: 1, id, createdAt: new Date().toISOString(), stage, reason,
        ...(path ? { path } : {}),
        // Do not retain credential echoes, requests, settings or image inputs.
        ...(credentialEcho ? { responseOmitted: 'credential-echo' } : { response: response.slice(0, 1024 * 1024) }),
      }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      this.logger.warn(`Retained local ${reason} diagnostic ${id}`);
    } catch { this.logger.warn('Could not retain local modeling diagnostic.'); }
  }
}
