/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
/**
 * V1-ADMIN-LOCAL-LOGIN-01 — fast unit coverage (mocked repository / OIDC / session / audit)
 * for `LocalAdminAuthenticationService`.
 *
 * Covers deliverable items:
 *   A. deterministic seed creates exactly one admin
 *   B. repeated seed is idempotent
 *   D. wrong password is rejected
 *   F. production mode refuses to seed or authenticate the local credential
 *
 * Real-PostgreSQL + real-HTTP coverage of C/E lives in
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

describe('V1-ADMIN-LOCAL-LOGIN-01 — LocalAdminAuthenticationService (unit, mocked)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    jest.restoreAllMocks();
  });

  function buildService(rows: Array<{ id: string; email: string; passwordHash: string }>) {
    const repository: any = {
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.email === where.email) ?? null),
      create: jest.fn((row: any) => row),
      save: jest.fn(async (row: any) => {
        rows.push(row);
        return row;
      }),
      manager: {},
    };
    const oidc: any = { validate: jest.fn(async () => ({ subject: 'mock-sandbox-subject' })) };
    const sessions: any = {
      establish: jest.fn(async () => ({
        accessToken: 'test-token',
        tokenType: 'Bearer',
        sessionId: 'test-session',
        expiresAt: new Date().toISOString(),
        principal: { type: 'PRIVILEGED', roles: ['FINANCE_ADMIN'] },
      })),
    };
    const auditService: any = { record: jest.fn(async () => undefined) };
    const workforceConfig: any = {
      rateLimits: [{ category: 'workforce-authentication', limit: 10, windowSeconds: 60 }],
    };
    const service = new LocalAdminAuthenticationService(
      repository,
      oidc,
      sessions,
      auditService,
      workforceConfig,
    );
    return { service, repository, oidc, sessions, auditService };
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

      expect(result).toEqual({ created: true, email: 'admin@monienaija.local' });
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
      expect(second).toEqual({ created: false, email: 'admin@monienaija.local' });
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
  });

  describe('login', () => {
    it('C. correct credentials authenticate and return the real workforce session shape', async () => {
      process.env.NODE_ENV = 'test';
      const rows = [
        { id: 'admin-1', email: 'admin@monienaija.local', passwordHash: hashPassword('MonieNaijaAdmin123!') },
      ];
      const { service, oidc, sessions } = buildService(rows);

      const session = await service.login('admin@monienaija.local', 'MonieNaijaAdmin123!');

      expect(oidc.validate).toHaveBeenCalledWith('mock-sandbox-token-ADMIN');
      expect(sessions.establish).toHaveBeenCalledTimes(1);
      expect(session).toMatchObject({ accessToken: 'test-token', tokenType: 'Bearer' });
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
  });

  describe('rateLimitRule', () => {
    it('resolves the workforce-authentication rate-limit category from the real A2 config', () => {
      process.env.NODE_ENV = 'test';
      const { service } = buildService([]);
      expect(service.rateLimitRule()).toMatchObject({ category: 'workforce-authentication' });
    });
  });
});
