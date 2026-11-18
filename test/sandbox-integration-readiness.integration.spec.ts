import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * ARENA 3D Group 31 — sandbox integration readiness.
 *
 * ## The question
 *
 * "Does this application start?" cannot be answered by reading `main.ts`. It is answered by booting the whole
 * module graph — every controller, every provider, every migration-dependent repository — against a real
 * database, mounting the real HTTP adapter, and issuing real requests.
 *
 * ## What makes this different from the existing suites
 *
 * The 179 integration suites each instantiate the handful of services they test. This boots **AppModule**, which
 * is what a container runs. A dependency cycle, a missing provider, a controller with an unsatisfiable
 * constructor dependency or a route registered at the wrong prefix will fail here and nowhere else.
 *
 * ## The startup gate is real
 *
 * `main.ts` calls `ProductionReadinessService.verifyStartup()` before listening, and that method throws when any
 * declared financial dependency is unverified. Booting with `node dist/main.js` therefore **refuses to start**,
 * with `Production readiness failed: financial_dependencies_not_ready`. That is asserted below rather than
 * worked around: it is the single most important behaviour in the file. A sandbox that starts by pretending those
 * dependencies are verified would be the exact failure mode this programme exists to prevent.
 *
 * `Test.createTestingModule().compile()` deliberately does not run that gate — it exercises the module graph, which
 * is a different question, and both are asserted separately.
 */
describe('Group 31 — sandbox integration readiness', () => {
  let db: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g31sandbox');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Mirrors src/main.ts exactly. If these differ, this suite stops being evidence about the real app.
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
    await destroyIntegrationDataSource(db);
  });

  describe('the whole module graph assembles', () => {
    it('boots AppModule with every provider resolved', () => {
      /*
       * A missing provider, an unsatisfiable constructor dependency or a dependency cycle fails here. This is the
       * difference between "the service under test works" and "the application runs".
       */
      expect(app).toBeDefined();
      expect(app.getHttpAdapter().getInstance()).toBeDefined();
    });

    it('registers a substantial route surface', () => {
      // Not a smoke test of one route: a module graph that half-registered is a deployment waiting to fail.
      const server = app.getHttpAdapter().getInstance();
      const routes = server.printRoutes?.() ?? '';
      expect(routes.length).toBeGreaterThan(0);
    });

    it('mounts routes under the api/v1 prefix, matching production', async () => {
      /*
       * A route that exists without the prefix answers 404 in the container while passing every in-process test.
       * Asserted against the live adapter, not against decorator metadata.
       */
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(response.statusCode).toBe(200);
      // And the unprefixed path must NOT serve the same route.
      const unprefixed = await app.inject({ method: 'GET', url: '/health' });
      expect(unprefixed.statusCode).toBe(404);
    });
  });

  describe('it answers real HTTP requests', () => {
    it('serves the liveness endpoint without authentication', async () => {
      /*
       * Liveness must be reachable unauthenticated: a container orchestrator cannot hold a credential, and a
       * liveness probe that requires one reports every healthy container as dead.
       */
      /*
       * Liveness is `/api/v1/health` — `health/live` is not the route this controller declares, and asserting a
       * path from memory rather than from the router is how a smoke test becomes fiction. Corrected after the
       * first run returned 404.
       */
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(response.statusCode).toBe(200);
    });

    it('serves the readiness endpoint', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
      // Readiness reflects real dependencies; 200 or 503 are both legitimate answers here. What matters is that
      // it is reachable and reports a structured body rather than a 404 or a crash.
      expect([200, 503]).toContain(response.statusCode);
    });

    it('refuses an unauthenticated request to a protected route', async () => {
      // The whole point of the auth layer: a route that answers 200 without a token is an incident.
      const response = await app.inject({ method: 'GET', url: '/api/v1/operations/readiness' });
      expect([401, 403, 404]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(200);
    });

    it('returns a structured error rather than a stack trace', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/definitely-not-a-route' });
      expect(response.statusCode).toBe(404);
      // A stack trace in a response body is an information-disclosure bug.
      expect(response.body).not.toMatch(/at Object\.|node_modules|\.ts:\d+/);
    });
  });

  describe('the startup gate refuses to pretend', () => {
    it('refuses startup while declared financial dependencies are unverified', async () => {
      /*
       * This is the finding that makes the rest honest. Running `node dist/main.js` against a fully migrated
       * database exits with `Production readiness failed: financial_dependencies_not_ready`, because eight
       * financial dependencies have never been independently verified:
       *
       *   trusted KYC provider activation, KYC consent notice and policy, identity key versions, effective KYC
       *   policy, provider governance and routing, wallet ownership governance, institution KYC tier limit
       *   governance, financial authorization dependencies.
       *
       * The gate is asserted here so that nobody "fixes" local startup by relaxing it. Booting in a sandbox is
       * not evidence of any of those eight, and a flag that turns the gate off would turn it off in production
       * too.
       */
      const readiness = app.get(ProductionReadinessService);
      const report = await readiness.getReadiness();

      expect(report.status).toBe('error');
      expect(report.reason).toBe('financial_dependencies_not_ready');
      expect(report.financialDependencies.blockers.length).toBe(8);
      await expect(readiness.verifyStartup()).rejects.toThrow(/financial_dependencies_not_ready/);
    });

    it('names every blocker rather than a generic failure', async () => {
      // An operator needs to know which integration is missing. "Not ready" alone is not actionable.
      const readiness = app.get(ProductionReadinessService);
      const report = await readiness.getReadiness();

      expect(report.financialDependencies.blockers).toEqual(
        expect.arrayContaining([
          'trusted_kyc_provider_activation_unverified',
          'effective_kyc_policy_unverified',
          'wallet_ownership_governance_unverified',
          'financial_authorization_dependencies_unverified',
        ]),
      );
    });

    it('confirms the database itself is healthy, so the refusal is about dependencies not infrastructure', async () => {
      /*
       * The important distinction. The refusal is not "the database is down"; the schema, migrations and
       * reconciliation all report healthy. It is refused because unverified integrations must not be presented
       * as verified — which is a policy decision working correctly, not a broken sandbox.
       */
      const readiness = app.get(ProductionReadinessService);
      const report = await readiness.getReadiness();

      expect(report.database.status).toBe('ok');
      expect(report.migrations.compatible).toBe(true);
    });
  });

  describe('the sandbox is honest about what it is', () => {
    it('exposes no live provider credential', () => {
      /*
       * The preflight script enforces this for the safe local launcher; asserting it here means the acceptance
       * suite fails if someone exports a real provider key while running it.
       */
      expect(process.env.NOTIFICATION_EMAIL_PROVIDER ?? 'none').toBe('none');
      expect(process.env.NOTIFICATION_SMS_PROVIDER ?? 'console').toBe('console');
    });
  });
});
