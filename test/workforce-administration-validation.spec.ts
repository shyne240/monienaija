import { APP_GUARD } from '@nestjs/core';
import { ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
// Supertest uses CommonJS callable exports.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');

import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { A2FinanceRoleAdministrationService } from '../src/authorization/finance-role-administration.service';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { A2SecurityRateLimitService } from '../src/authorization/security-rate-limit.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { A2WorkforceAdministrationController } from '../src/authorization/workforce-administration.controller';
import {
  A2_WORKFORCE_CONFIG,
  A2WorkforceOidcService,
} from '../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';

const PRINCIPAL: AuthorizationPrincipal = {
  type: 'PRIVILEGED',
  principalId: 'https://issuer.invalid:validation-spec',
  sessionId: '00000000-0000-4000-8000-000000000001',
  audience: 'workforce-admin',
  roles: ['FINANCE_ADMIN'],
  scopes: ['finance:administer'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const APPROVAL_ID = '00000000-0000-4000-8000-0000000000a1';
const ASSIGNMENT_REFERENCE = 'a2-fin-role-00000000000000000000000000000000';
const SESSION_ID = '00000000-0000-4000-8000-0000000000a2';

const config = {
  enabled: true,
  internalAudience: 'workforce-admin',
  makerCheckerRules: [
    {
      action: 'FINANCE_ROLE_ASSIGN',
      initiatingRoles: ['FINANCE_ADMIN'],
      approvingRoles: ['FINANCE_CONTROLLER'],
      minimumApprovals: 1,
      minimumAssurance: 'MFA',
    },
    {
      action: 'FINANCE_ROLE_REVOKE',
      initiatingRoles: ['FINANCE_ADMIN'],
      approvingRoles: ['FINANCE_CONTROLLER'],
      minimumApprovals: 1,
      minimumAssurance: 'MFA',
    },
  ],
  rateLimits: [
    { category: 'workforce-authentication', capacity: 50, refillRatePerSecond: 5, enabled: true },
    { category: 'workforce-bootstrap', capacity: 50, refillRatePerSecond: 5, enabled: true },
    {
      category: 'finance-role-administration',
      capacity: 50,
      refillRatePerSecond: 5,
      enabled: true,
    },
    { category: 'privileged-approval', capacity: 50, refillRatePerSecond: 5, enabled: true },
  ],
} as unknown as A2WorkforceConfigurationV1;

/**
 * HTTP-level request-validation regression for the workforce administration API.
 *
 * The real controller and the repository's real global `ValidationPipe` configuration
 * (`transform`, `whitelist`, `forbidNonWhitelisted`, exactly as `src/main.ts` installs it) are used,
 * so the assertions describe the deployed HTTP contract. Only the persistence-backed services are
 * replaced, which also lets every malformed-body test prove that the domain operation was never
 * invoked.
 *
 * The trust boundary itself (signature, issuer, audience, expiry, MFA assurance, removed mock
 * assertion) is deliberately *not* re-implemented here: it stays covered by the assertion service
 * contract spec, the real-PostgreSQL integration suite and the live staging probes.
 */
describe('Workforce administration request validation', () => {
  let app: NestFastifyApplication;

  const oidc = { validate: jest.fn() };
  const sessions = { establish: jest.fn(), revoke: jest.fn() };
  const roles = { consumeBootstrap: jest.fn(), assign: jest.fn(), revoke: jest.fn() };
  const approvals = { request: jest.fn(), approve: jest.fn(), getApproval: jest.fn() };
  const authorization = { authorize: jest.fn() };
  const limits = { consume: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    oidc.validate.mockResolvedValue({
      issuer: 'https://issuer.invalid',
      subject: 'validation-spec',
      principalId: PRINCIPAL.principalId,
      audience: ['workforce-admin'],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      authenticatedAt: new Date().toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'mfa'],
      acr: null,
      signingKeyId: 'validation-key',
    });
    sessions.establish.mockResolvedValue({
      accessToken: 'issued-session-token',
      tokenType: 'Bearer',
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      principal: PRINCIPAL,
    });
    sessions.revoke.mockResolvedValue(undefined);
    roles.consumeBootstrap.mockResolvedValue({ roleKey: 'FINANCE_ADMIN' });
    roles.assign.mockResolvedValue({ roleKey: 'FINANCE_AUDITOR' });
    roles.revoke.mockResolvedValue({ roleKey: 'FINANCE_AUDITOR' });
    approvals.request.mockResolvedValue({ approved: false, reason: 'REQUESTED' });
    approvals.approve.mockResolvedValue({ approved: true, reason: 'CONSUMED' });
    approvals.getApproval.mockResolvedValue({
      id: APPROVAL_ID,
      actionType: 'FINANCE_ROLE_ASSIGN',
      resourceType: 'A2_FINANCE_ROLE_ASSIGNMENT',
      resourceId: ASSIGNMENT_REFERENCE,
      status: 'REQUESTED',
    });
    authorization.authorize.mockResolvedValue({ allowed: true });
    limits.consume.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [A2WorkforceAdministrationController],
      providers: [
        { provide: A2WorkforceOidcService, useValue: oidc },
        { provide: A2WorkforceSessionService, useValue: sessions },
        { provide: A2FinanceRoleAdministrationService, useValue: roles },
        { provide: PrivilegedActionApprovalService, useValue: approvals },
        { provide: AuthorizationService, useValue: authorization },
        { provide: A2SecurityRateLimitService, useValue: limits },
        { provide: A2_WORKFORCE_CONFIG, useValue: config },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (context: ExecutionContext) => {
              const http = context
                .switchToHttp()
                .getRequest<{ authorizationPrincipal?: AuthorizationPrincipal }>();
              http.authorizationPrincipal = PRINCIPAL;
              return true;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/v1${path}`).send(body);
  const remove = (path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).delete(`/api/v1${path}`).send(body);

  describe('POST /internal/a2/workforce/sessions', () => {
    it.each([{}, { idToken: 123 }, { idToken: '' }, { idToken: { nested: true } }])(
      'rejects a malformed body with 400 before the assertion service or session service runs',
      async (body) => {
        const response = await post('/internal/a2/workforce/sessions', body);
        expect(response.status).toBe(400);
        expect(oidc.validate).not.toHaveBeenCalled();
        expect(sessions.establish).not.toHaveBeenCalled();
        expect(limits.consume).not.toHaveBeenCalled();
      },
    );

    it('rejects an oversized assertion and never echoes it in the response', async () => {
      const secret = 'assertion-secret-value-that-must-not-be-echoed';
      const response = await post('/internal/a2/workforce/sessions', {
        idToken: `${secret}${'x'.repeat(8192)}`,
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(oidc.validate).not.toHaveBeenCalled();
    });

    it('rejects unknown properties (repository whitelist policy)', async () => {
      const response = await post('/internal/a2/workforce/sessions', {
        idToken: 'header.payload.signature',
        audience: 'workforce-admin',
      });
      expect(response.status).toBe(400);
      expect(oidc.validate).not.toHaveBeenCalled();
    });

    it('passes a well-formed assertion to the existing assertion and session services', async () => {
      const response = await post('/internal/a2/workforce/sessions', {
        idToken: 'header.payload.signature',
      });
      expect(response.status).toBe(201);
      expect(oidc.validate).toHaveBeenCalledTimes(1);
      expect(oidc.validate).toHaveBeenCalledWith('header.payload.signature');
      expect(sessions.establish).toHaveBeenCalledTimes(1);
    });
  });

  describe('DELETE /internal/a2/workforce/sessions/:id', () => {
    it.each([
      {},
      { reason: 5 },
      { reason: '' },
      { reason: { nested: true } },
      { reason: 'x'.repeat(501) },
    ])('rejects a malformed body with 400 and never revokes', async (body) => {
      const response = await remove(`/internal/a2/workforce/sessions/${SESSION_ID}`, body);
      expect(response.status).toBe(400);
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('rejects unknown properties', async () => {
      const response = await remove(`/internal/a2/workforce/sessions/${SESSION_ID}`, {
        reason: 'operator logout',
        principalId: 'spoofed',
      });
      expect(response.status).toBe(400);
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('revokes with a well-formed reason', async () => {
      const response = await remove(`/internal/a2/workforce/sessions/${SESSION_ID}`, {
        reason: 'operator logout',
      });
      expect(response.status).toBe(200);
      expect(sessions.revoke).toHaveBeenCalledWith(SESSION_ID, PRINCIPAL, 'operator logout');
    });
  });

  describe('POST /internal/a2/workforce/bootstrap', () => {
    it.each([{}, { statement: 123 }, { statement: '' }, { statement: ['not', 'a', 'jws'] }])(
      'rejects a malformed body with 400 and never consumes a bootstrap statement',
      async (body) => {
        const response = await post('/internal/a2/workforce/bootstrap', body);
        expect(response.status).toBe(400);
        expect(roles.consumeBootstrap).not.toHaveBeenCalled();
        expect(limits.consume).not.toHaveBeenCalled();
      },
    );

    it('rejects an oversized statement', async () => {
      const response = await post('/internal/a2/workforce/bootstrap', {
        statement: 'x'.repeat(8193),
      });
      expect(response.status).toBe(400);
      expect(roles.consumeBootstrap).not.toHaveBeenCalled();
    });

    it('accepts a well-formed statement and hands it to the existing bootstrap service', async () => {
      const response = await post('/internal/a2/workforce/bootstrap', {
        statement: 'header.payload.signature',
      });
      expect(response.status).toBe(201);
      expect(roles.consumeBootstrap).toHaveBeenCalledWith('header.payload.signature', PRINCIPAL);
    });
  });

  describe('POST /internal/a2/workforce/roles', () => {
    const valid = {
      targetPrincipalId: 'https://issuer.invalid:target',
      roleKey: 'FINANCE_AUDITOR',
      effectiveFrom: '2026-09-15T00:00:00.000Z',
      effectiveTo: '2026-09-16T00:00:00.000Z',
    };

    it.each([
      {},
      { ...valid, targetPrincipalId: undefined },
      { ...valid, targetPrincipalId: 42 },
      { ...valid, roleKey: '' },
      { ...valid, effectiveFrom: 'not-a-date' },
      { ...valid, effectiveTo: 1234 },
      { ...valid, approvalIds: ['not-a-uuid'] },
      { ...valid, approvalIds: 'not-an-array' },
      { ...valid, expectedVersion: '3' },
      { ...valid, expectedVersion: 0 },
    ])('rejects a malformed assignment body with 400 and never assigns', async (body) => {
      const response = await post('/internal/a2/workforce/roles', body as Record<string, unknown>);
      expect(response.status).toBe(400);
      expect(roles.assign).not.toHaveBeenCalled();
      expect(authorization.authorize).not.toHaveBeenCalled();
    });

    it('rejects unknown properties', async () => {
      const response = await post('/internal/a2/workforce/roles', {
        ...valid,
        scopes: ['internal:access'],
      });
      expect(response.status).toBe(400);
      expect(roles.assign).not.toHaveBeenCalled();
    });

    it('accepts a well-formed assignment and leaves the role vocabulary to the domain service', async () => {
      const response = await post('/internal/a2/workforce/roles', valid);
      expect(response.status).toBe(201);
      expect(roles.assign).toHaveBeenCalledTimes(1);
      expect(roles.assign).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPrincipalId: valid.targetPrincipalId,
          roleKey: 'FINANCE_AUDITOR',
          effectiveFrom: valid.effectiveFrom,
          effectiveTo: valid.effectiveTo,
          principal: PRINCIPAL,
        }),
      );
    });

    it('does not take over the configured role vocabulary', async () => {
      const response = await post('/internal/a2/workforce/roles', {
        ...valid,
        roleKey: 'NOT_A_CONFIGURED_ROLE',
      });
      expect(response.status).toBe(201);
      expect(roles.assign).toHaveBeenCalledWith(
        expect.objectContaining({ roleKey: 'NOT_A_CONFIGURED_ROLE' }),
      );
    });
  });

  describe('DELETE /internal/a2/workforce/roles/:principalId/:roleKey', () => {
    const valid = {
      effectiveFrom: '2026-09-15T00:00:00.000Z',
      effectiveTo: '2026-09-16T00:00:00.000Z',
      approvalIds: ['00000000-0000-4000-8000-0000000000c1'],
    };

    it.each([
      {},
      { effectiveFrom: valid.effectiveFrom, effectiveTo: valid.effectiveTo },
      { ...valid, approvalIds: 'not-an-array' },
      { ...valid, approvalIds: ['not-a-uuid'] },
      { ...valid, effectiveTo: 'not-a-date' },
      { ...valid, expectedVersion: '1' },
    ])('rejects a malformed revocation body with 400 and never revokes', async (body) => {
      const response = await remove(
        '/internal/a2/workforce/roles/https%3A%2F%2Fissuer.invalid%3Atarget/FINANCE_AUDITOR',
        body as Record<string, unknown>,
      );
      expect(response.status).toBe(400);
      expect(roles.revoke).not.toHaveBeenCalled();
    });

    it('leaves approval cardinality and distinctness to the maker-checker policy', async () => {
      const response = await remove(
        '/internal/a2/workforce/roles/https%3A%2F%2Fissuer.invalid%3Atarget/FINANCE_AUDITOR',
        { ...valid, approvalIds: [] },
      );
      expect(response.status).toBe(200);
      expect(roles.revoke).toHaveBeenCalledWith(expect.objectContaining({ approvalIds: [] }));
    });

    it('accepts a well-formed revocation', async () => {
      const response = await remove(
        '/internal/a2/workforce/roles/https%3A%2F%2Fissuer.invalid%3Atarget/FINANCE_AUDITOR',
        valid,
      );
      expect(response.status).toBe(200);
      expect(roles.revoke).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPrincipalId: 'https://issuer.invalid:target',
          roleKey: 'FINANCE_AUDITOR',
          approvalIds: valid.approvalIds,
          principal: PRINCIPAL,
        }),
      );
    });
  });

  describe('POST /internal/a2/workforce/approvals/request', () => {
    const valid = {
      action: 'FINANCE_ROLE_ASSIGN',
      resource: { type: 'A2_FINANCE_ROLE_ASSIGNMENT' },
      actionFingerprint: 'a'.repeat(64),
      reason: 'rotate the finance controller assignment',
    };

    it.each([
      {},
      { ...valid, action: 123 },
      { ...valid, action: '' },
      { ...valid, resource: 'A2_FINANCE_ROLE_ASSIGNMENT' },
      { ...valid, resource: {} },
      { ...valid, resource: { type: '' } },
      { ...valid, resource: { type: 'A2_FINANCE_ROLE_ASSIGNMENT', extra: 'not-allowed' } },
      { ...valid, actionFingerprint: 'not-a-sha256' },
      { ...valid, actionFingerprint: undefined },
      { ...valid, reason: '' },
      { ...valid, reason: 7 },
      { ...valid, approvalScope: '' },
    ])(
      'rejects a malformed approval request with 400 and never requests an approval',
      async (body) => {
        const response = await post(
          '/internal/a2/workforce/approvals/request',
          body as Record<string, unknown>,
        );
        expect(response.status).toBe(400);
        expect(approvals.request).not.toHaveBeenCalled();
      },
    );

    it('rejects unknown top-level properties', async () => {
      const response = await post('/internal/a2/workforce/approvals/request', {
        ...valid,
        approvedBy: 'spoofed',
      });
      expect(response.status).toBe(400);
      expect(approvals.request).not.toHaveBeenCalled();
    });

    it('passes a well-formed request to the existing approval service with the caller principal', async () => {
      const response = await post('/internal/a2/workforce/approvals/request', valid);
      expect(response.status).toBe(201);
      expect(approvals.request).toHaveBeenCalledTimes(1);
      const calls = approvals.request.mock.calls as unknown as [Record<string, unknown>][];
      const command = calls[0]?.[0];
      expect(command).toMatchObject({
        actionFingerprint: 'a'.repeat(64),
        reason: valid.reason,
        principal: PRINCIPAL,
      });
      expect((command?.['resource'] as Record<string, unknown>)?.['type']).toBe(
        'A2_FINANCE_ROLE_ASSIGNMENT',
      );
      expect((command?.['policy'] as Record<string, unknown>)?.['action']).toBe(
        'FINANCE_ROLE_ASSIGN',
      );
    });
  });

  describe('POST /internal/a2/workforce/approvals/:id/approve', () => {
    it.each([{ comment: 123 }, { comment: 'x'.repeat(501) }, { comment: { nested: true } }])(
      'rejects a malformed decision body with 400 and never decides',
      async (body) => {
        const response = await post(
          `/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`,
          body,
        );
        expect(response.status).toBe(400);
        expect(approvals.approve).not.toHaveBeenCalled();
      },
    );

    it('rejects unknown properties', async () => {
      const response = await post(`/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`, {
        comment: 'ok',
        approved: true,
      });
      expect(response.status).toBe(400);
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('accepts an omitted comment and a well-formed comment', async () => {
      await post(`/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`, {}).expect(201);
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.objectContaining({ approvalId: APPROVAL_ID, principal: PRINCIPAL }),
      );

      await post(`/internal/a2/workforce/approvals/${APPROVAL_ID}/approve`, {
        comment: 'reviewed',
      }).expect(201);
      expect(approvals.approve).toHaveBeenLastCalledWith(
        expect.objectContaining({ approvalId: APPROVAL_ID, comment: 'reviewed' }),
      );
    });
  });
});
