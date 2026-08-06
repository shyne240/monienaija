import type { DataSource, DeepPartial, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import type { AuthenticationExecutionResult } from '../src/customer-authentication/authentication-execution.service';
import type { AuthenticationSession } from '../src/customer-authentication/authentication-session.entity';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { AuthenticationSessionStatus } from '../src/customer-authentication/authentication-session.enums';
import type { AuditService } from '../src/operations/audit.service';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input?: DeepPartial<T>): T {
    return (input ?? {}) as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
    }
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ) ?? null,
    );
  }
}

class MemoryManager {
  constructor(private readonly repository: MemoryRepository<AuthenticationSession>) {}

  getRepository<T extends ObjectLiteral>(...targets: unknown[]): Repository<T> {
    if (targets.length === 0) {
      throw new Error('Repository target is required');
    }
    return this.repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

const authentication: AuthenticationExecutionResult = {
  authenticated: true,
  customerId: '00000000-0000-4000-8000-000000000001',
  credentialId: '00000000-0000-4000-8000-000000000002',
  passwordVersion: 3,
  accountLocked: false,
};

function fixture() {
  const repository = new MemoryRepository<AuthenticationSession>();
  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const service = new AuthenticationSessionService(
    repository as unknown as Repository<AuthenticationSession>,
    new MemoryDataSource(new MemoryManager(repository)) as unknown as DataSource,
    auditService as unknown as AuditService,
  );
  return { service, repository, auditService };
}

describe('AuthenticationSessionService', () => {
  it('issues a hashed opaque token and returns an authenticated principal', async () => {
    const testFixture = fixture();
    const issued = await testFixture.service.issue({
      authentication,
      actor: 'a2-session',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlSeconds: 600,
    });

    expect(issued.tokenType).toBe('Bearer');
    expect(issued.accessToken).toHaveLength(43);
    expect(issued.principal.customerId).toBe(authentication.customerId);
    expect(issued.expiresAt.toISOString()).toBe('2026-01-01T00:10:00.000Z');
    const session = [...testFixture.repository.records.values()][0];
    expect(session?.tokenHash).toHaveLength(64);
    expect(session?.tokenHash).not.toBe(issued.accessToken);
    expect(testFixture.auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'AUTHENTICATION_SESSION',
        action: 'SESSION_ISSUED',
      }),
    );
  });

  it('validates the token, updates principal context, and rejects wrong audiences', async () => {
    const testFixture = fixture();
    const issued = await testFixture.service.issue({ authentication, actor: 'a2-session' });

    await expect(
      testFixture.service.validate({ token: issued.accessToken }),
    ).resolves.toMatchObject({
      valid: true,
      principal: expect.objectContaining({
        customerId: authentication.customerId,
        sessionId: issued.sessionId,
        audience: 'customer-api',
      }) as unknown as Record<string, unknown>,
    });
    await expect(
      testFixture.service.validate({ token: issued.accessToken, audience: 'operator-api' }),
    ).resolves.toEqual({ valid: false, reason: 'WRONG_AUDIENCE' });
    await expect(testFixture.service.validate({ token: 'not a token' })).resolves.toEqual({
      valid: false,
      reason: 'MALFORMED_TOKEN',
    });
  });

  it('revokes tokens and rejects replay after logout', async () => {
    const testFixture = fixture();
    const issued = await testFixture.service.issue({ authentication, actor: 'a2-session' });

    await expect(
      testFixture.service.revoke({
        token: issued.accessToken,
        actor: 'a2-session',
        reason: 'logout',
      }),
    ).resolves.toMatchObject({ valid: false, reason: 'REVOKED' });
    await expect(testFixture.service.validate({ token: issued.accessToken })).resolves.toEqual({
      valid: false,
      reason: 'REVOKED',
    });
    const session = [...testFixture.repository.records.values()][0];
    expect(session?.status).toBe(AuthenticationSessionStatus.REVOKED);
  });

  it('expires sessions and records expiry without accepting the token', async () => {
    const testFixture = fixture();
    const issued = await testFixture.service.issue({
      authentication,
      actor: 'a2-session',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlSeconds: 60,
    });

    await expect(
      testFixture.service.validate({
        token: issued.accessToken,
        now: new Date('2026-01-01T00:01:01.000Z'),
      }),
    ).resolves.toEqual({ valid: false, reason: 'EXPIRED' });
    expect(testFixture.auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'SESSION_EXPIRED' }),
    );
  });

  it('rotates a token atomically and invalidates the previous token', async () => {
    const testFixture = fixture();
    const issued = await testFixture.service.issue({ authentication, actor: 'a2-session' });
    const rotated = await testFixture.service.rotate({
      token: issued.accessToken,
      actor: 'a2-session',
      reason: 'rotation',
    });

    expect(rotated).not.toBeNull();
    if (!rotated) {
      throw new Error('Session rotation did not issue a replacement token');
    }
    expect(rotated.accessToken).not.toBe(issued.accessToken);
    await expect(testFixture.service.validate({ token: issued.accessToken })).resolves.toEqual({
      valid: false,
      reason: 'REVOKED',
    });
    await expect(
      testFixture.service.validate({ token: rotated.accessToken }),
    ).resolves.toMatchObject({ valid: true });
  });
});
