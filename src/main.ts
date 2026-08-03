import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { validateEnvironment } from './config/environment';
import { GlobalExceptionFilter } from './http-exception.filter';

async function bootstrap(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(logger));
  app.enableShutdownHooks();

  await app.listen({ port: environment.PORT, host: '0.0.0.0' });
}

void bootstrap();
