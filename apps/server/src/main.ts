import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { localApiSecurity, localOrigins, LOCAL_CLIENT_HEADER } from './local-api-security';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');
  app.use(localApiSecurity(config.port));
  const origins = localOrigins(config.port);
  app.enableCors({
    origin: (origin, callback) => callback(null, origin !== undefined && origins.has(origin)),
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', LOCAL_CLIENT_HEADER],
  });
  app.useBodyParser('json', { limit: '12mb' });
  app.useBodyParser('urlencoded', { limit: '12mb', extended: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(config.port, '127.0.0.1');

  // eslint-disable-next-line no-console
  console.log(`AI Three.js Studio API listening on http://localhost:${config.port}/api`);
  // eslint-disable-next-line no-console
  console.log('Settings independently controls concept images, background AI modeling and optional live chat.');
}

void bootstrap();
