import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  aiMode: 'mock';
  dataDir: string;
}

let cachedConfig: AppConfig | null = null;

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  loadEnvFile();

  const requestedMode = (process.env.AI_MODE ?? 'mock').toLowerCase();
  if (requestedMode !== 'mock') {
    throw new Error(
      `AI_MODE="${requestedMode}" is not available in Phase 1. ` +
        'Use AI_MODE=mock for concept art. Configure AI modeling, optional live chat and the API key in the Settings page.',
    );
  }

  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }

  cachedConfig = {
    port,
    aiMode: 'mock',
    dataDir: resolve(process.cwd(), process.env.DATA_DIR ?? '.data'),
  };

  return cachedConfig;
}
