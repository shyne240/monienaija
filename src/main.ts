import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import multipart from '@fastify/multipart';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { validateEnvironment } from './config/environment';
import { GlobalExceptionFilter } from './http-exception.filter';
import { ProductionReadinessService } from './production/production-readiness.service';
import { registerRequestContextHooks } from './production/request-hooks';
import { RequestTrackerService } from './production/request-tracker.service';
import { GovernanceService } from './maturity/governance.service';

async function bootstrap(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  if (environment.POA_UPLOADS_ENABLED) {
    await app.register(multipart, {
      attachFieldsToBody: false,
      throwFileSizeLimit: true,
      limits: {
        files: 1,
        fields: 8,
        parts: 9,
        fileSize: environment.POA_MAX_UPLOAD_BYTES,
      },
    });
  }
  const requestTracker = app.get(RequestTrackerService);
  const readinessService = app.get(ProductionReadinessService);
  const governanceService = app.get(GovernanceService);
  const http = app.getHttpAdapter().getInstance();

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
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  // Report 25: extracted verbatim to src/production/request-hooks.ts so the
  // production hook code is exercised end-to-end from tests; behavior is
  // unchanged (same tracker, same API version header value).
  registerRequestContextHooks(http, {
    requestTracker,
    apiVersion: environment.API_VERSION,
  });

  try {
    app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
    await app.init();
    await readinessService.verifyStartup();
    await governanceService.recordStartup();
    await app.listen({ port: environment.PORT, host: '0.0.0.0' });
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure';
  process.stderr.write(`Application startup failed: ${message}\n`);
  process.exitCode = 1;
});
