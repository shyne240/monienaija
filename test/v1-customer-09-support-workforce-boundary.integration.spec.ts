/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { SupportService } from '../src/support/support.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * V1-CUSTOMER-09 Part C — "do not assume a guard's mere existence means it's
 * correct; test the actual permission boundary".
 *
 * `test/v1-007-support-ticket.integration.spec.ts` already proves support
 * isolation and the SupportService-level workforce checks. What it does NOT
 * exercise is the full, real HTTP chain for `/internal/support/*`: the
 * global RuntimeAccessGuard → AuthorizationService route-policy
 * (`allowedPrincipalTypes`) → `requireWorkforce()` controller guard, driven
 * by a genuinely-issued workforce principal rather than a hand-built object
 * passed directly to the service.
 *
 * Standing up a full OIDC/JWKS workforce session for this would duplicate
 * `test/a2-workforce-session.integration.spec.ts`'s harness for no extra
 * authorization coverage. Instead this reuses the same lightweight,
 * already-established pattern from
 * `test/v1-003-admin-operational-writes.integration.spec.ts`: override
 * `A2WorkforceSessionService.validate()` with a synthetic resolver that maps
 * `Bearer workforce-<TYPE>` to a principal of that type. This keeps the real
 * RuntimeAccessGuard, the real route-policy-registry lookup, and the real
 * support controllers in the loop — only the OIDC/session-store step (which
 * has its own dedicated coverage) is swapped out.
 */
describe('V1-CUSTOMER-09 Part C — /internal/support workforce permission boundary (real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let supportService: SupportService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    environment: 'test',
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    mfaFreshnessSeconds: 300,
    oidcJwksCacheSeconds: 900,
    oidcJwksMaxStalenessSeconds: 3600,
    bootstrapEnabled: false,
    bootstrapIssuer: '',
    bootstrapAudience: '',
    bootstrapKeys: [],
    bootstrapFinanceAdminScopes: [],
    recoveryEnabled: false,
    recoveryAudience: '',
    recoveryKeys: [],
    roles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxyAddresses: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  // Synthetic: `Bearer workforce-<TYPE>` resolves to a real principal of that type via the
  // real RuntimeAccessGuard / route-policy chain. Mirrors the established pattern in
  // test/v1-003-admin-operational-writes.integration.spec.ts.
  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) {
        throw new UnauthorizedException('invalid workforce token');
      }
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  function workforceToken(type: string): string {
    return `workforce-${type}`;
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-customer-09-support-boundary');
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
    supportService = moduleRef.get(SupportService);
  }, 180000);

  afterAll(async () => {
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
  }, 60000);

  async function createOperationalTicket(): Promise<string> {
    const ticket = await supportService.createTicket({
      subject: 'Workforce boundary fixture ticket',
      category: 'OTHER' as any,
      description: 'Created directly via the service for HTTP boundary testing.',
      principal: {
        type: 'OPERATOR',
        principalId: 'fixture-operator',
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
      } as any,
    });
    return ticket.id;
  }

  // The four types the route-policy-registry and requireWorkforce() both call "workforce":
  // SUPPORT, OPERATOR, SERVICE, PRIVILEGED. In production today only OPERATOR and PRIVILEGED
  // are ever actually issued (see test/workforce-session-principal-type.spec.ts), but the
  // route must behave correctly for all four in case a real SUPPORT/SERVICE identity is wired
  // up later — that is the actual contract being tested here.
  const workforceTypes = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'];
  const nonWorkforceTypes = ['CUSTOMER', 'AGENT', 'AGGREGATOR'];

  it.each(workforceTypes)(
    'a real %s workforce session can list internal support tickets over HTTP',
    async (type) => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/internal/support/tickets')
        .set('Authorization', `Bearer ${workforceToken(type)}`)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    },
  );

  it.each(nonWorkforceTypes)(
    '%s cannot list internal support tickets even with a session that passes the guard',
    async (type) => {
      await request(app.getHttpServer())
        .get('/api/v1/internal/support/tickets')
        .set('Authorization', `Bearer ${workforceToken(type)}`)
        .expect(403);
    },
  );

  it.each(workforceTypes)('a real %s workforce session can fetch a single ticket', async (type) => {
    const ticketId = await createOperationalTicket();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/internal/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .expect(200);
    expect(res.body.id).toBe(ticketId);
  });

  it.each(nonWorkforceTypes)('%s cannot fetch a single internal ticket', async (type) => {
    const ticketId = await createOperationalTicket();
    await request(app.getHttpServer())
      .get(`/api/v1/internal/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .expect(403);
  });

  it.each(workforceTypes)('a real %s workforce session can assign a ticket', async (type) => {
    const ticketId = await createOperationalTicket();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .send({ assignedTo: `${type.toLowerCase()}-queue-1` })
      .expect(201);
    expect(res.body.assignedTo).toBe(`${type.toLowerCase()}-queue-1`);
  });

  it.each(nonWorkforceTypes)('%s cannot assign a ticket', async (type) => {
    const ticketId = await createOperationalTicket();
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/assign`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .send({ assignedTo: 'someone' })
      .expect(403);
  });

  it.each(workforceTypes)('a real %s workforce session can change ticket status', async (type) => {
    const ticketId = await createOperationalTicket();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(201);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it.each(nonWorkforceTypes)('%s cannot change ticket status', async (type) => {
    const ticketId = await createOperationalTicket();
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(403);
  });

  it.each(workforceTypes)(
    'a real %s workforce session can add a message, including an internal note',
    async (type) => {
      const ticketId = await createOperationalTicket();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/support/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${workforceToken(type)}`)
        .send({ body: 'Internal triage note', isInternal: true })
        .expect(201);
      expect(res.body.isInternal).toBe(true);
    },
  );

  it.each(nonWorkforceTypes)('%s cannot add a message via the internal route', async (type) => {
    const ticketId = await createOperationalTicket();
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${workforceToken(type)}`)
      .send({ body: 'should not be allowed' })
      .expect(403);
  });

  it('unauthenticated requests are rejected before any principal type is even considered', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/support/tickets').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/internal/support/tickets/00000000-0000-4000-8000-000000000000/assign')
      .send({ assignedTo: 'x' })
      .expect(401);
  });
});
