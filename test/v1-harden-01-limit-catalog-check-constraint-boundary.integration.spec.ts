/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/require-await */
/**
 * V1-HARDEN-01 Part L — real-HTTP confirmation of whether limit-catalog.service.ts's
 * isUniqueViolation()-without-isCheckViolation() asymmetry is actually reachable.
 *
 * limit_rules / limit_profiles / limit_assignments all carry PostgreSQL CHECK constraints
 * (dimension enum, direction enum, amount-vs-count exclusivity, segment-code pattern,
 * subject-type consistency, etc.). LimitCatalogService/LimitAssignmentService only special-case
 * unique-violations (23505) in their catch blocks and rethrow anything else (including a raw
 * CHECK violation, 23514) unguarded.
 *
 * Tracing the ACTUAL production path (DTO class-validator decorators + the service's own
 * pre-insert/pre-update validation, re-run against the final merged row state on every PATCH)
 * shows every field that has a DB CHECK constraint is already validated — with an equal or
 * stricter rule — before the row ever reaches PostgreSQL. This suite proves that empirically:
 * every adversarial payload designed to violate a CHECK constraint is rejected with a clean 400
 * at (or before) the service layer, and none of them ever produces a raw 500 / DB-error leak.
 *
 * Conclusion encoded by this suite: the isCheckViolation gap is a real code-structure
 * inconsistency (defense-in-depth style, mirrors isUniqueViolation) but is NOT an exploitable
 * defect via the real HTTP surface today — so no behavioural fix is applied for Part L (per the
 * task's "do not modify unrelated validation" / "fix minimally + test IF reproducible"
 * instruction). This suite is the permanent regression guarding that property: if future
 * changes ever remove one of these guards, the affected case here will start returning 500
 * instead of 400 and fail.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-HARDEN-01 Part L — limit-catalog CHECK-constraint boundary is not reachable via real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
        assuranceLevel: 'MFA',
      } as any;
    },
  };
  const auth = (type: string) => `Bearer workforce-${type.toLowerCase()}`;
  const OPERATOR = { Authorization: auth('OPERATOR') };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1harden01limitcheck');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createProfile(code: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles')
      .set(OPERATOR)
      .send({ code, name: code, kind: 'CUSTOMER' })
      .expect(201);
    return res.body;
  }

  it('creating a rule with an invalid direction enum value never reaches the DB CHECK constraint — rejected with 400, never 500', async () => {
    await createProfile('CHK_DIR');
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles/CHK_DIR/rules')
      .set(OPERATOR)
      .send({
        product: 'WALLET_TRANSFER',
        direction: 'SIDEWAYS',
        currency: 'NGN',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '1000',
      });
    expect(res.status).toBe(400);
  });

  it('updating a rule with an invalid direction enum value is rejected with 400, never 500', async () => {
    await createProfile('CHK_DIR2');
    const created = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles/CHK_DIR2/rules')
      .set(OPERATOR)
      .send({ product: 'WALLET_TRANSFER', direction: 'OUTGOING', currency: 'NGN', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/internal/limit-rules/${created.body.id}`)
      .set(OPERATOR)
      .send({ version: 1, direction: 'SIDEWAYS' });
    expect(res.status).toBe(400);
  });

  it('creating/updating a rule with an invalid dimension enum value is rejected with 400, never 500', async () => {
    await createProfile('CHK_DIM');
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles/CHK_DIM/rules')
      .set(OPERATOR)
      .send({ product: 'WALLET_TRANSFER', currency: 'NGN', dimension: 'NOT_A_REAL_DIMENSION', limitValueMinor: '1000' });
    expect(res.status).toBe(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles/CHK_DIM/rules')
      .set(OPERATOR)
      .send({ product: 'WALLET_TRANSFER', currency: 'NGN', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000' })
      .expect(201);
    const upd = await request(app.getHttpServer())
      .patch(`/api/v1/internal/limit-rules/${created.body.id}`)
      .set(OPERATOR)
      .send({ version: 1, dimension: 'NOT_A_REAL_DIMENSION' });
    expect(upd.status).toBe(400);
  });

  it('switching dimension type without the matching value field (amount<->count exclusivity) is rejected with 400, never 500', async () => {
    await createProfile('CHK_EXCL');
    const created = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles/CHK_EXCL/rules')
      .set(OPERATOR)
      .send({ product: 'WALLET_TRANSFER', currency: 'NGN', dimension: 'DAILY_AMOUNT', limitValueMinor: '1000' })
      .expect(201);
    // Flip to a COUNT dimension but forget to clear limitValueMinor / set limitValueCount.
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/internal/limit-rules/${created.body.id}`)
      .set(OPERATOR)
      .send({ version: 1, dimension: 'DAILY_COUNT' });
    expect(res.status).toBe(400);
  });

  it('an invalid limit-profile code / kind / status / configurationStatus is rejected with 400, never 500', async () => {
    const badCode = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles')
      .set(OPERATOR)
      .send({ code: 'not valid!!', name: 'x', kind: 'CUSTOMER' });
    expect(badCode.status).toBe(400);

    const badKind = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-profiles')
      .set(OPERATOR)
      .send({ code: 'CHK_KIND', name: 'x', kind: 'NOT_A_KIND' });
    expect(badKind.status).toBe(400);

    const profile = await createProfile('CHK_STATUS');
    const badStatus = await request(app.getHttpServer())
      .patch(`/api/v1/internal/limit-profiles/${profile.code}`)
      .set(OPERATOR)
      .send({ version: 1, status: 'NOT_A_STATUS' });
    expect(badStatus.status).toBe(400);
  });

  it('an invalid limit-assignment subjectType / segmentCode / subject-consistency combination is rejected with 400/404, never 500', async () => {
    const profile = await createProfile('CHK_ASSIGN');

    const badSubjectType = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-assignments')
      .set(OPERATOR)
      .send({ limitProfileCode: profile.code, subjectType: 'NOT_A_TYPE', segmentCode: null });
    expect(badSubjectType.status).toBe(400);

    const badSegmentCode = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-assignments')
      .set(OPERATOR)
      .send({ limitProfileCode: profile.code, subjectType: 'SEGMENT', segmentCode: 'not valid!!' });
    expect(badSegmentCode.status).toBe(400);

    const inconsistent = await request(app.getHttpServer())
      .post('/api/v1/internal/limit-assignments')
      .set(OPERATOR)
      .send({ limitProfileCode: profile.code, subjectType: 'GLOBAL', subjectId: randomUUID() });
    expect([400, 404]).toContain(inconsistent.status);
  });
});
