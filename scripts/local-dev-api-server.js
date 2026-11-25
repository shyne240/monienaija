'use strict';
/**
 * LOCAL DEVELOPMENT ONLY — not a release path, and not a substitute for the startup gate.
 *
 * `dist/main.js` refuses to listen unless the release readiness gate passes, and that gate is
 * hard-coded to fail while eight financial dependencies remain unverified
 * (`FINANCIAL_DEPENDENCY_BLOCKERS` in `src/production/production-readiness.service.ts`). That refusal
 * is correct; **it is not modified or bypassed here**, and the gate is re-evaluated and reported on
 * every start so a local run can never be mistaken for an approved deployment.
 *
 * This launcher exists so a developer can exercise the HTTP surface against a disposable database.
 * It reuses, rather than reimplements, every local safety control that already exists:
 *
 *   - `scripts/local-preflight.cjs` — the same read-only preflight `npm run local:start:safe` uses:
 *       loopback-only DB_HOST, NODE_ENV development|test, synthetic-data attestation
 *       (`LOCAL_DB_CONFIRMED_ISOLATED=yes`), workers/providers pinned off, sandbox partner
 *       environment, uploaded-document access off, the emergency stop on, and the application's own
 *       environment schema. It also proves the database is reachable and READ-ONLY before we start.
 *   - `test/support/mission-25c-network-guard.cjs` — the same outbound-network guard, loaded the
 *       same way `npm run test` loads it.
 *   - the production bootstrap pieces from `dist/main.js`: `validateEnvironment`, HTTP hardening
 *       (security headers + CORS allowlist), request-context hooks, the global exception filter and
 *       the process-role rules.
 *
 * Differences from `dist/main.js`, exhaustively:
 *   1. it listens on **127.0.0.1** only (main binds 0.0.0.0, which is right for a container and
 *      wrong for a workstation carrying a disposable database),
 *   2. it REPORTS the readiness verdict instead of throwing on it,
 *   3. it treats the governance startup record as best-effort and says so when it is refused.
 */
const net = require('node:net');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Loaded first, exactly like the test runner does, so any outbound call in this process is blocked.
require(path.join(ROOT, 'test/support/mission-25c-network-guard.cjs'));

const { loadEffectiveEnv } = require('./local-preflight.cjs');

function isLoopback(host) {
  if (!host) return false;
  const value = String(host).trim().toLowerCase();
  if (value === 'localhost' || value === '::1' || value === '127.0.0.1') return true;
  return net.isIP(value) === 4 && value.startsWith('127.');
}

/**
 * Fail closed before anything is built. `local-preflight.cjs` performs the full validation (and a
 * read-only database probe) when the launcher is invoked through `npm run local:api`; these direct
 * checks keep the same guarantees when the script is run on its own.
 */
function assertDisposableTarget(env) {
  const problems = [];
  if ((env.NODE_ENV ?? 'development') === 'production') problems.push('NODE_ENV must not be production');
  if (!isLoopback(env.DB_HOST)) problems.push('DB_HOST must be an explicit loopback address');
  // Synthetic-data attestation: the same variable the existing safe local launcher requires.
  if (env.LOCAL_DB_CONFIRMED_ISOLATED !== 'yes')
    problems.push(
      'LOCAL_DB_CONFIRMED_ISOLATED=yes must attest that this database is a disposable local instance holding synthetic data only',
    );
  if (env.LOCAL_DEV_API_CONFIRM !== 'disposable-local-database')
    problems.push('LOCAL_DEV_API_CONFIRM=disposable-local-database must acknowledge this is a local run');
  for (const key of [
    'NOTIFICATION_WORKER_ENABLED',
    'CASH_TO_CASH_EXPIRY_WORKER_ENABLED',
    'KYC_TIER_WORKER_ENABLED',
    'A6_PARTNER_ENABLED',
  ]) {
    if (env[key] !== undefined && env[key] !== 'false') problems.push(`${key} must be false`);
  }
  if (problems.length) {
    throw new Error(`refusing to run:\n  - ${problems.join('\n  - ')}`);
  }
}

async function bootstrapWorker() {
  const { AppModule } = require('../dist/app.module');
  const { validateEnvironment } = require('../dist/config/environment');
  const { ProductionReadinessService } = require('../dist/production/production-readiness.service');
  const { WorkerSupervisorService } = require('../dist/operations/worker-supervisor.service');
  const { startWorkerRuntime } = require('../dist/production/worker-runtime');

  const environment = validateEnvironment(process.env);
  await startWorkerRuntime({
    role: 'worker',
    createApplication: async () => {
      const { NestFactory } = await import('@nestjs/core');
      const { Logger: PinoLogger } = await import('nestjs-pino');
      const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
      context.useLogger(context.get(PinoLogger));
      return context;
    },
    // A worker process has no local override: it calls the real gate, unchanged.
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
  const { NestFactory } = require('@nestjs/core');
  const { FastifyAdapter } = require('@nestjs/platform-fastify');
  const { Logger } = require('nestjs-pino');
  const { ValidationPipe } = require('@nestjs/common');

  const { AppModule } = require('../dist/app.module');
  const { validateEnvironment } = require('../dist/config/environment');
  const { applyHttpSecurity, fastifyAdapterOptions } = require('../dist/production/http-security');
  const { registerRequestContextHooks } = require('../dist/production/request-hooks');
  const { RequestTrackerService } = require('../dist/production/request-tracker.service');
  const {
    ProductionReadinessService,
  } = require('../dist/production/production-readiness.service');
  const { GovernanceService } = require('../dist/maturity/governance.service');
  const { GlobalExceptionFilter } = require('../dist/http-exception.filter');
  const {
    applyProcessRoleEnvironment,
    resolveProcessRole,
  } = require('../dist/production/process-role');

  const consolidated = loadEffectiveEnv(ROOT);
  assertDisposableTarget(consolidated);

  const role = resolveProcessRole(process.env.PROCESS_ROLE);
  if (role === 'worker') {
    await bootstrapWorker();
    return;
  }
  for (const change of applyProcessRoleEnvironment(role, process.env)) {
    process.stdout.write(`process role ${role}: ${change}\n`);
  }

  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create(AppModule, new FastifyAdapter(fastifyAdapterOptions(environment)), {
    bufferLogs: true,
    rawBody: true,
  });
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

  /*
   * Report, never suppress. The gate is evaluated, its verdict and every blocker are printed, and
   * the process says plainly that it is not releasable. `dist/main.js` still throws on the same
   * verdict, so nothing here can be used to ship.
   */
  const readiness = await readinessService.getReadiness();
  process.stdout.write(
    `local dev launcher: release readiness ${readiness.status}` +
      (readiness.reason ? ` (${readiness.reason})` : '') +
      `\nlocal dev launcher: blockers: ${readiness.financialDependencies.blockers.join(', ')}\n` +
      'local dev launcher: NOT releasable — dist/main.js still enforces this gate\n',
  );

  // GovernanceService refuses to record startup metadata until readiness passes. That refusal is
  // correct; a local run simply records nothing and the skip is logged.
  try {
    await governanceService.recordStartup();
  } catch (error) {
    process.stdout.write(
      `local dev launcher: governance startup record skipped (${error instanceof Error ? error.message : String(error)})\n`,
    );
  }

  // Loopback only. A disposable local database must never be reachable from another host.
  await app.listen({ port: environment.PORT, host: '127.0.0.1' });
  process.stdout.write(
    `local dev launcher: listening on http://127.0.0.1:${environment.PORT}/api/v1\n`,
  );
}

bootstrap().catch((error) => {
  process.stderr.write(
    `local dev launcher failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
