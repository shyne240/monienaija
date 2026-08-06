import type { DataSource, DeepPartial, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import type {
  AuthenticationExecutionResult,
  AuthenticationExecutionService,
} from '../src/customer-authentication/authentication-execution.service';
import type { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import {
  AuthenticationCredentialStatus,
  PasswordHashAlgorithm,
  PasswordResetRequestStatus,
  PasswordResetTokenStatus,
} from '../src/customer-authentication/customer-authentication.enums';
import { CustomerAuthenticationRuntimeService } from '../src/customer-authentication/customer-authentication-runtime.service';
import { PasswordHistory } from '../src/customer-authentication/password-history.entity';
import { PasswordResetRequest } from '../src/customer-authentication/password-reset-request.entity';
import { PasswordResetToken } from '../src/customer-authentication/password-reset-token.entity';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { Customer } from '../src/customer/customer.entity';
import type { AuditService } from '../src/operations/audit.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000002';
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';
const TOKEN_ID = '00000000-0000-4000-8000-000000000004';

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
    record.createdAt ??= new Date('2026-01-01T00:00:00.000Z');
    record.updatedAt = new Date('2026-01-01T00:00:00.000Z');
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

  find(options?: { where?: Partial<T> }): Promise<T[]> {
    const conditions = options?.where ?? {};
    return Promise.resolve(
      [...this.records.values()].filter((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ),
    );
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: unknown): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected runtime authentication repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

function fixture() {
  const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>();
  const customerRepository = new MemoryRepository<Customer>();
  const credentialRepository = new MemoryRepository<CustomerAuthenticationCredential>();
  const resetRequestRepository = new MemoryRepository<PasswordResetRequest>();
  const resetTokenRepository = new MemoryRepository<PasswordResetToken>();
  const passwordHistoryRepository = new MemoryRepository<PasswordHistory>();
  const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
  repositories.set(Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>);
  repositories.set(
    CustomerAuthenticationCredential,
    credentialRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(
    PasswordResetRequest,
    resetRequestRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(
    PasswordResetToken,
    resetTokenRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(
    PasswordHistory,
    passwordHistoryRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(
    SecurityEventHistory,
    securityEventRepository as unknown as MemoryRepository<ObjectLiteral>,
  );

  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const authenticationExecutionService = {
    authenticate: jest.fn(),
  };
  const authenticationSessionService = {
    issue: jest.fn(),
    revokeAllForCredential: jest.fn().mockResolvedValue(0),
  };
  const service = new CustomerAuthenticationRuntimeService(
    customerRepository as unknown as Repository<Customer>,
    credentialRepository as unknown as Repository<CustomerAuthenticationCredential>,
    resetRequestRepository as unknown as Repository<PasswordResetRequest>,
    resetTokenRepository as unknown as Repository<PasswordResetToken>,
    passwordHistoryRepository as unknown as Repository<PasswordHistory>,
    securityEventRepository as unknown as Repository<SecurityEventHistory>,
    new MemoryDataSource(new MemoryManager(repositories)) as unknown as DataSource,
    auditService as unknown as AuditService,
    authenticationExecutionService as unknown as AuthenticationExecutionService,
    authenticationSessionService as unknown as AuthenticationSessionService,
  );
  return {
    service,
    repositories: {
      customerRepository,
      credentialRepository,
      resetRequestRepository,
      resetTokenRepository,
      passwordHistoryRepository,
      securityEventRepository,
    },
    auditService,
    authenticationExecutionService,
    authenticationSessionService,
  };
}

function seedRecovery(
  testFixture: ReturnType<typeof fixture>,
  overrides: Partial<PasswordResetRequest> = {},
) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  testFixture.repositories.customerRepository.records.set(CUSTOMER_ID, {
    id: CUSTOMER_ID,
    deletedAt: null,
  } as Customer);
  testFixture.repositories.credentialRepository.records.set(CREDENTIAL_ID, {
    id: CREDENTIAL_ID,
    customerId: CUSTOMER_ID,
    passwordHash: '$bcrypt$old-hash',
    hashAlgorithm: PasswordHashAlgorithm.BCRYPT,
    passwordVersion: 1,
    passwordChangedAt: now,
    passwordExpiresAt: null,
    status: AuthenticationCredentialStatus.ACTIVE,
    failedAuthenticationCount: 2,
    accountLocked: false,
    lockedAt: null,
    lockReason: null,
    version: 1,
    deletedAt: null,
  } as CustomerAuthenticationCredential);
  testFixture.repositories.resetRequestRepository.records.set(REQUEST_ID, {
    id: REQUEST_ID,
    customerId: CUSTOMER_ID,
    credentialId: CREDENTIAL_ID,
    status: PasswordResetRequestStatus.IN_PROGRESS,
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    completedAt: null,
    version: 1,
    deletedAt: null,
    ...overrides,
  } as PasswordResetRequest);
  testFixture.repositories.resetTokenRepository.records.set(TOKEN_ID, {
    id: TOKEN_ID,
    requestId: REQUEST_ID,
    tokenHash: 'controlled-token-hash',
    tokenVersion: 1,
    status: PasswordResetTokenStatus.ACTIVE,
    issuedAt: now,
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    usedAt: null,
    version: 1,
    deletedAt: null,
  } as PasswordResetToken);
}

describe('CustomerAuthenticationRuntimeService', () => {
  it('authenticates a customer and issues a session through A2T02/A2T03', async () => {
    const testFixture = fixture();
    const authentication: AuthenticationExecutionResult = {
      authenticated: true,
      customerId: CUSTOMER_ID,
      credentialId: CREDENTIAL_ID,
      passwordVersion: 1,
      accountLocked: false,
    };
    const session = { accessToken: 'opaque-session-token', tokenType: 'Bearer' as const };
    testFixture.authenticationExecutionService.authenticate.mockResolvedValue(authentication);
    testFixture.authenticationSessionService.issue.mockResolvedValue(session);

    const result = await testFixture.service.authenticateCustomer({
      customerId: CUSTOMER_ID,
      password: 'transient-password',
      actor: 'customer-runtime',
    });

    expect(result).toEqual({ authenticated: true, customerId: CUSTOMER_ID, session });
    expect(testFixture.authenticationExecutionService.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER_ID, password: 'transient-password' }),
    );
    expect(testFixture.authenticationSessionService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ authentication, actor: 'customer-runtime' }),
    );
  });

  it('returns a generic authentication failure and does not issue a session', async () => {
    const testFixture = fixture();
    testFixture.authenticationExecutionService.authenticate.mockResolvedValue({
      authenticated: false,
      customerId: CUSTOMER_ID,
      failureReason: 'INVALID_CREDENTIALS',
    });

    const result = await testFixture.service.authenticateCustomer({
      customerId: CUSTOMER_ID,
      password: 'wrong-password',
      actor: 'customer-runtime',
    });

    expect(result).toEqual({
      authenticated: false,
      customerId: CUSTOMER_ID,
      failureReason: 'INVALID_CREDENTIALS',
    });
    expect(testFixture.authenticationSessionService.issue).not.toHaveBeenCalled();
  });

  it('completes a scoped recovery, rotates the credential, and invalidates sessions', async () => {
    const testFixture = fixture();
    seedRecovery(testFixture);
    testFixture.authenticationSessionService.revokeAllForCredential.mockResolvedValue(2);

    const result = await testFixture.service.completePasswordReset({
      customerId: CUSTOMER_ID,
      requestId: REQUEST_ID,
      tokenHash: 'controlled-token-hash',
      passwordHash: '$bcrypt$rotated-hash',
      hashAlgorithm: PasswordHashAlgorithm.BCRYPT,
      passwordVersion: 2,
      actor: 'recovery-runtime',
      now: new Date('2026-01-01T00:30:00.000Z'),
    });

    expect(result).toEqual({
      completed: true,
      customerId: CUSTOMER_ID,
      requestId: REQUEST_ID,
      credentialId: CREDENTIAL_ID,
      sessionsInvalidated: 2,
    });
    const credential = [...testFixture.repositories.credentialRepository.records.values()][0];
    const request = [...testFixture.repositories.resetRequestRepository.records.values()][0];
    const token = [...testFixture.repositories.resetTokenRepository.records.values()][0];
    expect(credential?.passwordHash).toBe('$bcrypt$rotated-hash');
    expect(credential?.passwordVersion).toBe(2);
    expect(request?.status).toBe(PasswordResetRequestStatus.COMPLETED);
    expect(token?.status).toBe(PasswordResetTokenStatus.USED);
    expect(testFixture.repositories.passwordHistoryRepository.records.size).toBe(1);
    expect(testFixture.repositories.securityEventRepository.records.size).toBe(3);
    expect(testFixture.authenticationSessionService.revokeAllForCredential).toHaveBeenCalledWith(
      CREDENTIAL_ID,
      'recovery-runtime',
      'Password reset completed',
      expect.any(Date),
    );
    const auditText = JSON.stringify(testFixture.auditService.record.mock.calls);
    expect(auditText).not.toContain('controlled-token-hash');
  });

  it('rejects wrong-customer, expired, replayed, stale, and locked recovery attempts', async () => {
    const testFixture = fixture();
    seedRecovery(testFixture);
    const base = {
      customerId: CUSTOMER_ID,
      requestId: REQUEST_ID,
      tokenHash: 'wrong-token-hash',
      passwordHash: '$bcrypt$rotated-hash',
      hashAlgorithm: PasswordHashAlgorithm.BCRYPT,
      passwordVersion: 2,
      actor: 'recovery-runtime',
      now: new Date('2026-01-01T00:30:00.000Z'),
    } as const;

    await expect(testFixture.service.completePasswordReset(base)).resolves.toMatchObject({
      completed: false,
      failureReason: 'INVALID_RECOVERY',
    });
    await expect(
      testFixture.service.completePasswordReset({
        ...base,
        customerId: '00000000-0000-4000-8000-000000000099',
      }),
    ).resolves.toMatchObject({ completed: false, failureReason: 'INVALID_RECOVERY' });
    await expect(
      testFixture.service.completePasswordReset({
        ...base,
        requestVersion: 99,
        tokenHash: 'controlled-token-hash',
      }),
    ).resolves.toMatchObject({ completed: false, failureReason: 'STALE_VERSION' });

    seedRecovery(testFixture, { expiresAt: new Date('2020-01-01T00:00:00.000Z') });
    await expect(
      testFixture.service.completePasswordReset({ ...base, tokenHash: 'controlled-token-hash' }),
    ).resolves.toMatchObject({ completed: false, failureReason: 'INVALID_RECOVERY' });

    seedRecovery(testFixture);
    const credential = [...testFixture.repositories.credentialRepository.records.values()][0];
    if (credential) credential.accountLocked = true;
    await expect(
      testFixture.service.completePasswordReset({ ...base, tokenHash: 'controlled-token-hash' }),
    ).resolves.toMatchObject({ completed: false, failureReason: 'CREDENTIAL_UNAVAILABLE' });
  });
});
