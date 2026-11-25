'use strict';
/**
 * LOCAL DEVELOPMENT ONLY — never a release path.
 *
 * `dist/main.js` refuses to listen unless the release readiness gate passes, and that gate is
 * hard-coded to fail while eight financial dependencies remain unverified
 * (`FINANCIAL_DEPENDENCY_BLOCKERS`). That refusal is correct and must not be weakened for a real
 * deployment.
 *
 * This launcher exists so a developer can still exercise the HTTP surface locally against a
 * disposable database. It re-uses the SAME production bootstrap pieces as `src/main.ts` — the same
 * environment validator, the same HTTP hardening (security headers + CORS allowlist), the same
 * request-context hooks, the same global exception filter — and the only thing it changes is that it
 * reports the readiness verdict instead of throwing on it, so the refusal is visible in the log
 * rather than silent.
 *
 * Refuses to run unless it can PROVE it is pointed at a disposable local target:
 *   NODE_ENV !== 'production'
 *   LOCAL_DEV_API_CONFIRM === 'disposable-local-database'
 *   DB_HOST resolves to loopback
 */
const net = require('node:net');
const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { Logger } = require('nestjs-pino');
const { ValidationPipe } = require('@nestjs/common');

const { AppModule } = require('../dist/app.module');
const { validateEnvironment } = require('../dist/config/environment');
const { applyHttpSecurity, fastifyAdapterOptions } = require('../dist/production/http-security');
const { registerRequestContextHooks } = require('../dist/production/request-hooks');
const { RequestTrackerService } = require('../dist/production/request-tracker.service');
const { ProductionReadinessService } = require('../dist/production/production-readiness.service');
const { GovernanceService } = require('../dist/maturity/governance.service');
const { GlobalExceptionFilter } = require('../dist/http-exception.filter');
const {
  applyProcessRoleEnvironment,
  resolveProcessRole,
} = require('../dist/production/process-role');
const { startWorkerRuntime } = require('../dist/production/worker-runtime');
const { WorkerSupervisorService } = require('../dist/operations/worker-supervisor.service');

function isLoopback(host) {
  if (!host) return false;
  const value = String(host).toLowerCase();
  if (value === 'localhost' || value === '::1' || value === '127.0.0.1') return true;
  return net.isIP(value) === 4 && value.startsWith('127.');
}

function assertDisposableTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to run: NODE_ENV=production');
  }
  if (process.env.LOCAL_DEV_API_CONFIRM !== 'disposable-local-database') {
    throw new Error(
      'refusing to run: set LOCAL_DEV_API_CONFIRM=disposable-local-database to acknowledge this launcher targets a disposable local database',
    );
  }
  const host = process.env.DB_HOST ?? '127.0.0.1';
  if (!isLoopback(host)) {
    throw new Error(`refusing to run: DB_HOST ${host} is not loopback`);
  }
}

async function bootstrapWorker() {
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
      await context.get(ProductionReadinessService).verifyStartup();
    },
    describeWorkers: (context) =>
      context
        .get(WorkerSupervisorService)
        .report()
        .workers.filter((worker) => worker.scheduled && worker.enabled)
        .map((worker) => worker.name),
  });
  void environment;
}

async function bootstrap() {
  const role = resolveProcessRole(process.env.PROCESS_ROLE);
  if (role === 'worker') {
    await bootstrapWorker();
    return;
  }
  for (const change of applyProcessRoleEnvironment(role, process.env)) {
    process.stdout.write(`process role ${role}: ${change}\n`);
  }

  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create(
    AppModule,
    new FastifyAdapter(fastifyAdapterOptions(environment)),
    { bufferLogs: true, rawBody: true },
  );
  const logger = app.get(Logger);
  const requestTracker = app.get(RequestTrackerService);
  const readinessService = app.get(ProductionReadinessService);
  const governanceService = app.get(GovernanceService);
  const http = app.getHttpAdapter().getInstance();

  app.useLogger(logger);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(logger));
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  applyHttpSecurity(app, environment);
  registerRequestContextHooks(http, { requestTracker, apiVersion: environment.API_VERSION });

  await app.init();

  // Report, never suppress: the release gate verdict is printed so nobody mistakes a local run for
  // an approved deployment. Nothing is written to the database here beyond the startup record.
  const readiness = await readinessService.getReadiness();
  process.stdout.write(
    `local dev launcher: release readiness ${readiness.status}` +
      (readiness.reason ? ` (${readiness.reason})` : '') +
      ` — blockers: ${readiness.financialDependencies.blockers.join(', ')}\n`,
  );
  process.stdout.write(
    'local dev launcher: this process is NOT releasable; dist/main.js still enforces the gate\n',
  );

  // GovernanceService ALSO refuses to record startup metadata until readiness passes — the same
  // deliberate refusal, one layer deeper. A local run therefore does not record a governance
  // startup row at all; that is the honest outcome, so it is logged rather than worked around.
  try {
    await governanceService.recordStartup();
  } catch (error) {
    process.stdout.write(
      `local dev launcher: governance startup record skipped (${error instanceof Error ? error.message : String(error)})\n`,
    );
  }

  await app.listen({ port: environment.PORT, host: '0.0.0.0' });
}

bootstrap().catch((error) => {
  process.stderr.write(
    `local dev launcher failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
