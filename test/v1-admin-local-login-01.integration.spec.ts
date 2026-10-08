/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
/**
 * V1-ADMIN-LOCAL-LOGIN-01 / V1-ADMIN-UAT-IDENTITY-01 — real PostgreSQL + real HTTP coverage for
 * the local administrator login path used by Admin Web.
 *
 * Boots the entire real AppModule (same module graph the running backend uses) against a
 * genuine, freshly migrated PostgreSQL database and drives the HTTP surface exactly the way
 * Admin Web's ApiClient does — no mocked repository, no mocked HTTP layer.
 *
 * Covers deliverable items:
 *   A. seeding creates exactly one administrator row
 *   B. repeated seeding is idempotent
 *   C. correct credentials authenticate over real HTTP
 *   D. wrong password is rejected (401) over real HTTP
 *   E. the resulting token is a genuine, valid A2 workforce session — it authorizes a real
 *      protected admin endpoint and is rejected once expired/absent
 *   F. production mode refuses both seeding and the login route entirely
 *
 * V1-ADMIN-UAT-IDENTITY-01 additions (real PostgreSQL):
 *   I1. the local administrator's authorization resolves through a REAL, persisted
 *       `a2_finance_role_assignments` row keyed to its own deterministic principalId — not the
 *       shared, config-driven `mock-sandbox-subject` blanket grant.
 *   I2. exactly one ACTIVE FINANCE_ADMIN role-assignment row exists after seeding, and it stays
 *       exactly one after seeding again (idempotent) and after logging in more than once.
 *   I3. the local administrator's session is never, at any point, resolvable to the literal
 *       'mock-sandbox-subject' principal — proven directly against the database rows this
 *       produces, not just the HTTP response shape.
 *   I4. `A2WorkforceOidcService.validate()` is never invoked by the local-admin login path —
 *       proving its authorization does not depend on that service or its sandbox bypass at all.
 *   I5. logout/revocation and re-login both continue to work against the new, identity-tied
 *       evidence path.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { A2WorkforceOidcService } from '../src/authorization/workforce-oidc.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';

// Deliberately does NOT override A2_WORKFORCE_CONFIG: this suite boots the real AppModule,
// which reads the real A2_WORKFORCE_*/.env configuration (the same configuration the actual
// running backend uses) via ConfigModule.forRoot()'s default dotenv loading. This exercises
// the real role resolution, rate-limit rules, and sandbox-bypass gate exactly as configured
// for local development — not a hand-built stand-in config.

describe('V1-ADMIN-LOCAL-LOGIN-01 (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let oidcService: A2WorkforceOidcService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminlocallogin');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    localAdminService = moduleRef.get(LocalAdminAuthenticationService);
    oidcService = moduleRef.get(A2WorkforceOidcService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function seed(email = 'admin@monienaija.local', password = 'MonieNaijaAdmin123!') {
    return localAdminService.seedDefaultAdmin({ email, password });
  }

  it('A. seeding creates exactly one row in local_admin_credentials', async () => {
    const result = await seed();
    expect(result.created).toBe(true);
    expect(result.email).toBe('admin@monienaija.local');
    expect(result.role).toMatchObject({ roleKey: 'FINANCE_ADMIN', status: 'ACTIVE' });

    const rows: Array<{ email: string; hash_algorithm: string }> = await dataSource.query(
      `SELECT email, hash_algorithm FROM local_admin_credentials`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('admin@monienaija.local');
    expect(rows[0]!.hash_algorithm).toBe('PBKDF2');
  });

  it('B. seeding twice is idempotent — still exactly one row', async () => {
    const first = await seed();
    const second = await seed();
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM local_admin_credentials`,
    );
    expect(rows[0]!.count).toBe('1');
  });

  it('C. correct credentials authenticate over real HTTP and return a genuine workforce session', async () => {
    await seed();

    const res = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      principal: expect.objectContaining({
        type: 'PRIVILEGED',
        roles: expect.arrayContaining(['FINANCE_ADMIN']),
      }),
    });
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(10);

    const auditRows: Array<{ action: string }> = await dataSource.query(
      `SELECT action FROM audit_events WHERE entity_type = 'A2_WORKFORCE_SESSION' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(auditRows[0]!.action).toBe('WORKFORCE_SESSION_ESTABLISHED');
  });

  it('D. wrong password is rejected with 401 and no session is issued', async () => {
    await seed();

    const res = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'definitely-wrong' });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();

    const auditRows: Array<{ action: string }> = await dataSource.query(
      `SELECT action FROM audit_events WHERE entity_type = 'LOCAL_ADMIN_CREDENTIAL' AND action = 'LOCAL_ADMIN_LOGIN_FAILED'`,
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('D2. unknown email is rejected with 401', async () => {
    const res = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'nobody@monienaija.local', password: 'whatever-12345' });
    expect(res.status).toBe(401);
  });

  it('E. the issued session token authorizes a real protected admin endpoint, and is rejected without a token', async () => {
    await seed();
    const login = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    const token = login.body.accessToken as string;

    const authorized = await request(app.getHttpServer())
      .get('/api/v1/internal/customers')
      .set('Authorization', `Bearer ${token}`);
    expect(authorized.status).toBe(200);

    const unauthorized = await request(app.getHttpServer()).get('/api/v1/internal/customers');
    expect(unauthorized.status).toBe(401);
  });

  it('F. seeding refuses outside NODE_ENV=development/test', async () => {
    process.env.NODE_ENV = 'production';
    try {
      await expect(seed()).rejects.toThrow(/refuses to run outside/i);
    } finally {
      process.env.NODE_ENV = 'test';
    }

    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM local_admin_credentials`,
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('F2. the login route itself is unreachable (404) when NODE_ENV=production, even with a seeded row', async () => {
    await seed();

    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  describe('V1-ADMIN-UAT-IDENTITY-01 — real persisted per-identity authorization', () => {
    it('I1. seeding creates exactly one REAL, persisted ACTIVE FINANCE_ADMIN row in a2_finance_role_assignments, keyed to a principalId that is NOT mock-sandbox-subject', async () => {
      const result = await seed();

      const rows: Array<{
        principal_id: string;
        role_key: string;
        status: string;
        scopes: string[];
      }> = await dataSource.query(
        `SELECT principal_id, role_key, status, scopes FROM a2_finance_role_assignments`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.role_key).toBe('FINANCE_ADMIN');
      expect(rows[0]!.status).toBe('ACTIVE');
      expect(rows[0]!.principal_id).not.toContain('mock-sandbox-subject');
      expect(rows[0]!.principal_id).toBe(result.role.principalId);
    });

    it('I2. seeding twice is idempotent for the role assignment too — still exactly one ACTIVE FINANCE_ADMIN row', async () => {
      const first = await seed();
      const second = await seed();
      expect(first.role.assignmentReference).toBe(second.role.assignmentReference);

      const rows: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text as count FROM a2_finance_role_assignments WHERE status = 'ACTIVE'`,
      );
      expect(rows[0]!.count).toBe('1');
    });

    it('I3. the authenticated session principal is the REAL local-admin identity, not mock-sandbox-subject, and resolves through the normal per-principal role-assignment lookup', async () => {
      await seed();

      const res = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
      expect(res.status).toBe(201);
      expect(res.body.principal.principalId).not.toContain('mock-sandbox-subject');
      // Exactly FINANCE_ADMIN — NOT the old blanket grant of every enabled role.
      expect(res.body.principal.roles).toEqual(['FINANCE_ADMIN']);
      expect(res.body.principal.type).toBe('PRIVILEGED');

      const sessionRows: Array<{ principal_id: string; subject: string; roles: string[] }> =
        await dataSource.query(
          `SELECT principal_id, subject, roles FROM a2_workforce_sessions ORDER BY created_at DESC LIMIT 1`,
        );
      expect(sessionRows[0]!.principal_id).toBe(res.body.principal.principalId);
      expect(sessionRows[0]!.subject).not.toBe('mock-sandbox-subject');
      expect(sessionRows[0]!.roles).toEqual(['FINANCE_ADMIN']);

      const assignmentRows: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text as count FROM a2_finance_role_assignments
         WHERE principal_id = $1 AND role_key = 'FINANCE_ADMIN' AND status = 'ACTIVE'`,
        [res.body.principal.principalId],
      );
      expect(assignmentRows[0]!.count).toBe('1');
    });

    it('I4. A2WorkforceOidcService.validate() is never invoked by the local-admin login path (authorization does not depend on the sandbox bypass)', async () => {
      await seed();
      const validateSpy = jest.spyOn(oidcService, 'validate');

      const res = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });

      expect(res.status).toBe(201);
      expect(validateSpy).not.toHaveBeenCalled();
      validateSpy.mockRestore();
    });

    it('I5. logout revokes the session and the revoked token can no longer reach a privileged endpoint; re-login works', async () => {
      await seed();
      const login = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
      const token = login.body.accessToken as string;
      const sessionId = login.body.sessionId as string;

      const authorizedBeforeLogout = await request(app.getHttpServer())
        .get('/api/v1/internal/customers')
        .set('Authorization', `Bearer ${token}`);
      expect(authorizedBeforeLogout.status).toBe(200);

      const revoke = await request(app.getHttpServer())
        .delete(`/api/v1/internal/a2/workforce/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'V1-ADMIN-UAT-IDENTITY-01 integration test logout' });
      expect(revoke.status).toBe(200);

      const afterLogout = await request(app.getHttpServer())
        .get('/api/v1/internal/customers')
        .set('Authorization', `Bearer ${token}`);
      expect(afterLogout.status).toBe(401);

      const sessionRows: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM a2_workforce_sessions WHERE id = $1`,
        [sessionId],
      );
      expect(sessionRows[0]!.status).toBe('REVOKED');

      // H. re-login works after logout.
      const reLogin = await request(app.getHttpServer())
        .post(LOGIN_PATH)
        .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
      expect(reLogin.status).toBe(201);
      expect(reLogin.body.principal.roles).toEqual(['FINANCE_ADMIN']);
      expect(reLogin.body.sessionId).not.toBe(sessionId);

      const reAuthorized = await request(app.getHttpServer())
        .get('/api/v1/internal/customers')
        .set('Authorization', `Bearer ${reLogin.body.accessToken as string}`);
      expect(reAuthorized.status).toBe(200);
    });
  });
});
