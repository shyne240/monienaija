/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
/**
 * V1-ADMIN-LOCAL-LOGIN-01 / V1-ADMIN-UAT-IDENTITY-01 — fast unit coverage (mocked repository /
 * session / finance-role-administration / audit) for `LocalAdminAuthenticationService`.
 *
 * Covers deliverable items:
 *   A. deterministic seed creates exactly one admin
 *   B. repeated seed is idempotent
 *   D. wrong password is rejected
 *   F. production mode refuses to seed or authenticate the local credential
 *
 * V1-ADMIN-UAT-IDENTITY-01 additions:
 *   I1. login builds its OWN evidence (no longer delegates to A2WorkforceOidcService at all)
 *       with a principalId deterministically derived from the credential's email, NOT the
 *       shared 'mock-sandbox-subject'.
 *   I2. seedDefaultAdmin grants SUPER_ADMIN through A2FinanceRoleAdministrationService's real
 *       persisted-assignment mechanism, keyed to that exact deterministic principalId, and this
 *       is idempotent across repeated seed calls.
 *   I3. login refuses when A2_WORKFORCE_ENABLED=false (the gate this service used to inherit
 *       transitively via A2WorkforceOidcService.validate(), now enforced directly).
 *
 * Real-PostgreSQL + real-HTTP coverage of C/E/the real persisted role-assignment row lives in
 * test/v1-admin-local-login-01.integration.spec.ts.
 */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('V1-ADMIN-LOCAL-LOGIN-01 / V1-ADMIN-UAT-IDENTITY-01 — LocalAdminAuthenticationService (unit, mocked)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    jest.restoreAllMocks();
  });

  function buildService(
    rows: Array<{ id: string; email: string; passwordHash: string }>,
    opts: { workforceEnabled?: boolean } = {},
  ) {
    const repository: any = {
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.email === where.email) ?? null),
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => {
        rows.push(row);
        return row;
      }),
      manager: {},
    };
    const sessions: any = {
      establish: jest.fn(async (evidence: any) => ({
        accessToken: 'test-token',
        tokenType: 'Bearer',
        sessionId: 'test-session',
        expiresAt: new Date().toISOString(),
        principal: {
          type: 'PRIVILEGED',
          principalId: evidence.principalId,
          roles: ['SUPER_ADMIN'],
        },
      })),
    };
    const financeRoles: any = {
      grantLocalAdministratorSuperAdmin: jest.fn(async (principalId: string) => ({
        assignmentReference: `a2-fin-role-test-${principalId}`,
        assignmentVersion: 1,
        principalId,
        roleKey: 'SUPER_ADMIN',
        scopes: ['privileged:execute'],
        status: 'ACTIVE',
        interim: true,
        effectiveFrom: new Date(0).toISOString(),
        effectiveTo: new Date(Date.now() + 1_000_000_000).toISOString(),
        assignedBy: 'local-dev-seed-admin-script',
        assignedAt: new Date().toISOString(),
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      })),
    };
    const auditService: any = { record: jest.fn(async () => undefined) };
    const workforceConfig: any = {
      enabled: opts.workforceEnabled ?? true,
      oidcIssuer: 'https://local-dev-identity.monienaija.invalid',
      oidcAudience: 'workforce-admin',
      rateLimits: [{ category: 'workforce-authentication', limit: 10, windowSeconds: 60 }],
    };
    const service = new LocalAdminAuthenticationService(
      repository,
      sessions,
      financeRoles,
      auditService,
      workforceConfig,
    );
    return { service, repository, sessions, financeRoles, auditService, workforceConfig };
  }

  describe('seedDefaultAdmin', () => {
    it('A. creates exactly one administrator row on first call', async () => {
      process.env.NODE_ENV = 'test';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service, auditService } = buildService(rows);

      const result = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });

      expect(result.created).toBe(true);
      expect(result.email).toBe('admin@monienaija.local');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.email).toBe('admin@monienaija.local');
      // the plaintext password is never persisted
      expect(rows[0]!.passwordHash).not.toContain('MonieNaijaAdmin123!');
      expect(rows[0]!.passwordHash.startsWith('PBKDF2$sha256$')).toBe(true);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'LOCAL_ADMIN_CREDENTIAL_SEEDED' }),
      );
    });

    it('B. a second call for the same email is idempotent (no duplicate row, created:false)', async () => {
      process.env.NODE_ENV = 'test';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service } = buildService(rows);

      const first = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });
      const second = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.email).toBe('admin@monienaija.local');
      expect(rows).toHaveLength(1);
    });

    it('B2. email comparison is case-insensitive for idempotency', async () => {
      process.env.NODE_ENV = 'test';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service } = buildService(rows);

      await service.seedDefaultAdmin({ email: 'Admin@MonieNaija.Local', password: 'MonieNaijaAdmin123!' });
      const second = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'SomeOtherPassword123!',
      });

      expect(second.created).toBe(false);
      expect(rows).toHaveLength(1);
    });

    it('F. refuses to seed outside NODE_ENV=development/test', async () => {
      process.env.NODE_ENV = 'production';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service } = buildService(rows);

      await expect(
        service.seedDefaultAdmin({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' }),
      ).rejects.toThrow(/refuses to run outside/i);
      expect(rows).toHaveLength(0);
    });

    it('F2. refuses to seed when NODE_ENV is unset (treated as production-like)', async () => {
      delete (process.env as any).NODE_ENV;
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service } = buildService(rows);

      await expect(
        service.seedDefaultAdmin({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' }),
      ).rejects.toThrow(/refuses to run outside/i);
      expect(rows).toHaveLength(0);
    });

    it('I2. grants SUPER_ADMIN through A2FinanceRoleAdministrationService, keyed to a deterministic principalId (NOT mock-sandbox-subject)', async () => {
      process.env.NODE_ENV = 'test';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service, financeRoles } = buildService(rows);

      const result = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });

      expect(financeRoles.grantLocalAdministratorSuperAdmin).toHaveBeenCalledTimes(1);
      const [calledPrincipalId, calledAssignedBy] =
        financeRoles.grantLocalAdministratorSuperAdmin.mock.calls[0];
      expect(calledPrincipalId).not.toContain('mock-sandbox-subject');
      expect(calledPrincipalId).toContain('https://local-dev-identity.monienaija.invalid:');
      expect(calledAssignedBy).toBe('local-dev-seed-admin-script');
      expect(result.role).toMatchObject({ roleKey: 'SUPER_ADMIN', status: 'ACTIVE' });
      expect(result.role.principalId).toBe(calledPrincipalId);
    });

    it('I2b. the same email always resolves to the same principalId across repeated seed calls (deterministic + idempotent)', async () => {
      process.env.NODE_ENV = 'test';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service, financeRoles } = buildService(rows);

      const first = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });
      const second = await service.seedDefaultAdmin({
        email: 'admin@monienaija.local',
        password: 'MonieNaijaAdmin123!',
      });

      expect(financeRoles.grantLocalAdministratorSuperAdmin).toHaveBeenCalledTimes(2);
      expect(first.role.principalId).toBe(second.role.principalId);
    });
  });

  describe('login', () => {
    it('C. correct credentials authenticate and return the real workforce session shape, with a principal tied to the credential (not mock-sandbox-subject)', async () => {
      process.env.NODE_ENV = 'test';
      const rows = [
        { id: 'admin-1', email: 'admin@monienaija.local', passwordHash: hashPassword('MonieNaijaAdmin123!') },
      ];
      const { service, sessions } = buildService(rows);

      const session = await service.login('admin@monienaija.local', 'MonieNaijaAdmin123!');

      expect(sessions.establish).toHaveBeenCalledTimes(1);
      const evidence = sessions.establish.mock.calls[0][0];
      expect(evidence.assuranceLevel).toBe('MFA');
      expect(evidence.principalId).not.toContain('mock-sandbox-subject');
      expect(evidence.principalId).toContain('https://local-dev-identity.monienaija.invalid:');
      expect(session).toMatchObject({ accessToken: 'test-token', tokenType: 'Bearer' });
    });

    it('C2. the same email always produces the same principalId across separate logins (deterministic)', async () => {
      process.env.NODE_ENV = 'test';
      const rows = [
        { id: 'admin-1', email: 'admin@monienaija.local', passwordHash: hashPassword('MonieNaijaAdmin123!') },
      ];
      const { service, sessions } = buildService(rows);

      await service.login('admin@monienaija.local', 'MonieNaijaAdmin123!');
      await service.login('admin@monienaija.local', 'MonieNaijaAdmin123!');

      const first = sessions.establish.mock.calls[0][0].principalId;
      const second = sessions.establish.mock.calls[1][0].principalId;
      expect(first).toBe(second);
    });

    it('D. wrong password is rejected with 401 and does not reach session issuance', async () => {
      process.env.NODE_ENV = 'test';
      const rows = [
        { id: 'admin-1', email: 'admin@monienaija.local', passwordHash: hashPassword('MonieNaijaAdmin123!') },
      ];
      const { service, sessions, auditService } = buildService(rows);

      await expect(service.login('admin@monienaija.local', 'totally-wrong-password')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.establish).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'LOCAL_ADMIN_LOGIN_FAILED' }),
      );
    });

    it('D2. unknown email is rejected with 401 (same error as wrong password)', async () => {
      process.env.NODE_ENV = 'test';
      const rows: Array<{ id: string; email: string; passwordHash: string }> = [];
      const { service, sessions } = buildService(rows);

      await expect(service.login('nobody@monienaija.local', 'whatever12345')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('F. refuses to authenticate outside NODE_ENV=development/test (hidden as 404, not 401)', async () => {
      process.env.NODE_ENV = 'production';
      const rows = [
        { id: 'admin-1', email: 'admin@monienaija.local', passwordHash: hashPassword('MonieNaijaAdmin123!') },
      ];
      const { service, sessions } = buildService(rows);

      await expect(service.login('admin@monienaija.local', 'MonieNaijaAdmin123!')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('I3. refuses to authenticate when A2_WORKFORCE_ENABLED=false, even in development/test', async () => {
      process.env.NODE_ENV = 'test';
      const rows = [
        { id: 'admin-1', email: 'admin@monienaija.local', passwordHash: hashPassword('MonieNaijaAdmin123!') },
      ];
      const { service, sessions } = buildService(rows, { workforceEnabled: false });

      await expect(service.login('admin@monienaija.local', 'MonieNaijaAdmin123!')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.establish).not.toHaveBeenCalled();
    });
  });

  describe('rateLimitRule', () => {
    it('resolves the workforce-authentication rate-limit category from the real A2 config', () => {
      process.env.NODE_ENV = 'test';
      const { service } = buildService([]);
      expect(service.rateLimitRule()).toMatchObject({ category: 'workforce-authentication' });
    });
  });
});
