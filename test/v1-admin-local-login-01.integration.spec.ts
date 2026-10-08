/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
/**
 * V1-ADMIN-LOCAL-LOGIN-01 — real PostgreSQL + real HTTP coverage for the local administrator
 * login path used by Admin Web.
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
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
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
    expect(result).toEqual({ created: true, email: 'admin@monienaija.local' });

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
});
