import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import multipart from '@fastify/multipart';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { validateEnvironment } from './config/environment';
import { applyProcessRoleEnvironment, resolveProcessRole } from './production/process-role';
import { startWorkerRuntime } from './production/worker-runtime';
import { WorkerSupervisorService } from './operations/worker-supervisor.service';
import { applyHttpSecurity, fastifyAdapterOptions } from './production/http-security';
import { GlobalExceptionFilter } from './http-exception.filter';
import { ProductionReadinessService } from './production/production-readiness.service';
import { registerRequestContextHooks } from './production/request-hooks';
import { RequestTrackerService } from './production/request-tracker.service';
import { GovernanceService } from './maturity/governance.service';

/**
 * ARENA 3D Group 37 — the worker role.
 *
 * Same image, different entry behaviour: `PROCESS_ROLE=worker` boots the dependency graph with no
 * HTTP listener and the same production readiness gate. Deliberately a separate function rather than
 * a branch inside the HTTP bootstrap, so reading `main.ts` shows that a worker process can never
 * reach `NestFactory.create<NestFastifyApplication>` or `app.listen`.
 */
async function bootstrapWorker(): Promise<void> {
  const environment = validateEnvironment(process.env);
  await startWorkerRuntime({
    role: 'worker',
    createApplication: async () => {
      const { NestFactory: factory } = await import('@nestjs/core');
      const { Logger: PinoLogger } = await import('nestjs-pino');
      const context = await factory.createApplicationContext(AppModule, { bufferLogs: true });
      context.useLogger(context.get(PinoLogger));
      return context;
    },
    verifyReadiness: async (context) => {
      await context.get<ProductionReadinessService>(ProductionReadinessService).verifyStartup();
    },
    describeWorkers: (context) =>
      context
        .get<WorkerSupervisorService>(WorkerSupervisorService)
        .report()
        .workers.filter((worker) => worker.scheduled && worker.enabled)
        .map((worker) => worker.name),
  });
  // The environment is validated before the context is built, so a misconfigured worker process
  // fails on configuration rather than on a half-built dependency graph.
  void environment;
}

async function bootstrap(): Promise<void> {
  const role = resolveProcessRole(process.env.PROCESS_ROLE);
  if (role === 'worker') {
    await bootstrapWorker();
    return;
  }
  // An API process starts no background worker timers; a contradiction is refused, not resolved.
  for (const change of applyProcessRoleEnvironment(role, process.env)) {
    process.stdout.write(`process role ${role}: ${change}\n`);
  }

  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(fastifyAdapterOptions(environment)),
    {
      bufferLogs: true,
      // Provider webhooks are authenticated by an HMAC over the exact received bytes. Fastify's JSON
      // parser keeps only the parsed object, and re-serializing it changes key order, whitespace and
      // unicode escaping — so a valid signature would fail verification and a "fix" would tempt
      // someone to stop checking it. Preserving the raw buffer keeps the signature check possible.
      rawBody: true,
    },
  );
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

  // INTEGRATION: main's HTTP surface hardening (security headers on every response plus an
  // explicit-origin CORS allowlist when configured) is new since the merge base and Lineage A has
  // no equivalent, so it is preserved. Lineage A's extracted hook registration replaces main's
  // inline copy of the same hooks (Report 25 moved them verbatim into src/production/request-hooks.ts
  // so the production hook code is exercised end-to-end from tests); keeping both would register
  // the request-context hooks twice.
  applyHttpSecurity(app, environment);

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
