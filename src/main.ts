import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import type { FastifyRequest } from 'fastify';

import { AppModule } from './app.module';
import { validateEnvironment } from './config/environment';
import { GlobalExceptionFilter } from './http-exception.filter';
import {
  createRequestContext,
  getRequestContext,
  type RequestWithContext,
} from './production/request-context';
import { ProductionReadinessService } from './production/production-readiness.service';
import { RequestTrackerService } from './production/request-tracker.service';
import { GovernanceService } from './maturity/governance.service';

async function bootstrap(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
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

  http.addHook('onRequest', (request, reply, done) => {
    const context = createRequestContext(
      request.headers as Record<string, string | string[] | undefined>,
      request.id,
    );
    const requestWithContext = request as unknown as RequestWithContext;
    requestWithContext.requestStartedAt = Date.now();
    requestWithContext.requestContext = context;
    reply.header('X-Request-Id', context.requestId);
    reply.header('X-Correlation-Id', context.correlationId);
    reply.header('X-Trace-Id', context.traceId);
    reply.header('X-API-Version', environment.API_VERSION);

    if (!requestTracker.start()) {
      reply.code(503).send({
        statusCode: 503,
        code: 'SERVICE_DRAINING',
        message: 'Service is shutting down',
        requestId: context.requestId,
        correlationId: context.correlationId,
        traceId: context.traceId,
      });
      done();
      return;
    }
    requestWithContext.requestTracked = true;
    done();
  });
  http.addHook('onResponse', (request, reply, done) => {
    const requestWithContext = request as unknown as RequestWithContext;
    if (requestWithContext.requestTracked) {
      requestTracker.finish();
    }
    const context = getRequestContext(request as unknown as FastifyRequest);
    request.log.info(
      {
        ...context,
        operationName: request.routeOptions?.url ?? request.url,
        method: request.method,
        statusCode: reply.statusCode,
        latencyMs: Date.now() - (requestWithContext.requestStartedAt ?? Date.now()),
      },
      'request completed',
    );
    done();
  });

  try {
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
