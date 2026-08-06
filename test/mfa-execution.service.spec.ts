import type { DataSource, DeepPartial, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import type { AuthenticatedPrincipal } from '../src/customer-authentication/authentication-session.types';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import { MfaChallenge } from '../src/customer-authentication/mfa-challenge.entity';
import { MfaChallengeStatus } from '../src/customer-authentication/mfa-challenge.enums';
import { MfaEnrollment } from '../src/customer-authentication/mfa-enrollment.entity';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { MfaMethod } from '../src/customer-authentication/mfa-method.entity';
import {
  MfaEnrollmentStatus,
  MfaMethodStatus,
  MfaMethodType,
  TrustedDeviceStatus,
} from '../src/customer-authentication/customer-authentication.enums';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { TrustedDevice } from '../src/customer-authentication/trusted-device.entity';
import { Customer } from '../src/customer/customer.entity';
import type { AuditService } from '../src/operations/audit.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000003';
const ENROLLMENT_ID = '00000000-0000-4000-8000-000000000004';
const METHOD_ID = '00000000-0000-4000-8000-000000000005';
const DEVICE_ID = '00000000-0000-4000-8000-000000000006';

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
    if (!repository) throw new Error('Unexpected MFA repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

const principal: AuthenticatedPrincipal = {
  principalType: 'CUSTOMER',
  customerId: CUSTOMER_ID,
  credentialId: CREDENTIAL_ID,
  sessionId: SESSION_ID,
  audience: 'customer-api',
  authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T01:00:00.000Z'),
};

function fixture() {
  const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>();
  const customerRepository = new MemoryRepository<Customer>();
  const enrollmentRepository = new MemoryRepository<MfaEnrollment>();
  const methodRepository = new MemoryRepository<MfaMethod>();
  const challengeRepository = new MemoryRepository<MfaChallenge>();
  const trustedDeviceRepository = new MemoryRepository<TrustedDevice>();
  const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
  repositories.set(Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>);
  repositories.set(
    MfaEnrollment,
    enrollmentRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(MfaMethod, methodRepository as unknown as MemoryRepository<ObjectLiteral>);
  repositories.set(MfaChallenge, challengeRepository as unknown as MemoryRepository<ObjectLiteral>);
  repositories.set(
    TrustedDevice,
    trustedDeviceRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(
    SecurityEventHistory,
    securityEventRepository as unknown as MemoryRepository<ObjectLiteral>,
  );
  repositories.set(
    CustomerAuthenticationCredential,
    new MemoryRepository<CustomerAuthenticationCredential>() as unknown as MemoryRepository<ObjectLiteral>,
  );

  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const service = new MfaExecutionService(
    customerRepository as unknown as Repository<Customer>,
    enrollmentRepository as unknown as Repository<MfaEnrollment>,
    methodRepository as unknown as Repository<MfaMethod>,
    challengeRepository as unknown as Repository<MfaChallenge>,
    trustedDeviceRepository as unknown as Repository<TrustedDevice>,
    securityEventRepository as unknown as Repository<SecurityEventHistory>,
    new MemoryDataSource(new MemoryManager(repositories)) as unknown as DataSource,
    auditService as unknown as AuditService,
  );
  return {
    service,
    repositories: {
      customerRepository,
      enrollmentRepository,
      methodRepository,
      challengeRepository,
      trustedDeviceRepository,
      securityEventRepository,
    },
    auditService,
  };
}

function seedActiveMfa(testFixture: ReturnType<typeof fixture>) {
  testFixture.repositories.customerRepository.records.set(CUSTOMER_ID, {
    id: CUSTOMER_ID,
    deletedAt: null,
  } as Customer);
  testFixture.repositories.enrollmentRepository.records.set(ENROLLMENT_ID, {
    id: ENROLLMENT_ID,
    customerId: CUSTOMER_ID,
    reference: 'mfa-enrollment',
    status: MfaEnrollmentStatus.ENABLED,
    deletedAt: null,
  } as MfaEnrollment);
  testFixture.repositories.methodRepository.records.set(METHOD_ID, {
    id: METHOD_ID,
    enrollmentId: ENROLLMENT_ID,
    customerId: CUSTOMER_ID,
    type: MfaMethodType.TOTP,
    label: 'Authenticator',
    status: MfaMethodStatus.ENABLED,
    deletedAt: null,
  } as MfaMethod);
  testFixture.repositories.trustedDeviceRepository.records.set(DEVICE_ID, {
    id: DEVICE_ID,
    customerId: CUSTOMER_ID,
    deviceReference: 'device-1',
    deviceFingerprintHash: 'device-fingerprint-hash',
    status: TrustedDeviceStatus.TRUSTED,
    lastSeenAt: null,
    deletedAt: null,
  } as TrustedDevice);
}

describe('MfaExecutionService', () => {
  it('issues and verifies an in-process MFA challenge without persisting raw challenge data', async () => {
    const testFixture = fixture();
    seedActiveMfa(testFixture);
    const issued = await testFixture.service.issueChallenge({
      principal,
      enrollmentId: ENROLLMENT_ID,
      methodId: METHOD_ID,
      challengeHash: 'challenge-digest',
      actor: 'mfa-runtime',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlSeconds: 60,
    });

    expect(issued).toMatchObject({
      customerId: CUSTOMER_ID,
      enrollmentId: ENROLLMENT_ID,
      methodId: METHOD_ID,
      sessionId: SESSION_ID,
      methodType: MfaMethodType.TOTP,
      status: MfaChallengeStatus.ACTIVE,
    });
    expect(issued).not.toHaveProperty('challengeHash');
    const verified = await testFixture.service.verifyChallenge({
      principal,
      challengeId: issued.id,
      providedHash: 'challenge-digest',
      actor: 'mfa-runtime',
      now: new Date('2026-01-01T00:00:30.000Z'),
    });
    expect(verified).toMatchObject({
      verified: true,
      customerId: CUSTOMER_ID,
      sessionId: SESSION_ID,
      challengeId: issued.id,
      assurance: 'MFA',
      methodType: MfaMethodType.TOTP,
    });
    const auditText = JSON.stringify(testFixture.auditService.record.mock.calls);
    expect(auditText).not.toContain('challenge-digest');
    expect(testFixture.repositories.securityEventRepository.records.size).toBe(2);
  });

  it('rejects mismatches, replay, expiry, wrong customer, wrong session, and unavailable metadata', async () => {
    const testFixture = fixture();
    seedActiveMfa(testFixture);
    const issued = await testFixture.service.issueChallenge({
      principal,
      enrollmentId: ENROLLMENT_ID,
      methodId: METHOD_ID,
      challengeHash: 'challenge-digest',
      actor: 'mfa-runtime',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlSeconds: 60,
    });
    await expect(
      testFixture.service.verifyChallenge({
        principal,
        challengeId: issued.id,
        providedHash: 'wrong-digest',
        actor: 'mfa-runtime',
        now: new Date('2026-01-01T00:00:10.000Z'),
      }),
    ).resolves.toMatchObject({ verified: false, failureReason: 'MISMATCH' });
    await expect(
      testFixture.service.verifyChallenge({
        principal,
        challengeId: issued.id,
        providedHash: 'challenge-digest',
        actor: 'mfa-runtime',
        now: new Date('2026-01-01T00:00:20.000Z'),
      }),
    ).resolves.toMatchObject({ verified: true });
    await expect(
      testFixture.service.verifyChallenge({
        principal,
        challengeId: issued.id,
        providedHash: 'challenge-digest',
        actor: 'mfa-runtime',
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ verified: false, failureReason: 'REPLAYED' });

    const expired = await testFixture.service.issueChallenge({
      principal,
      enrollmentId: ENROLLMENT_ID,
      methodId: METHOD_ID,
      challengeHash: 'expired-digest',
      actor: 'mfa-runtime',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlSeconds: 60,
    });
    await expect(
      testFixture.service.verifyChallenge({
        principal,
        challengeId: expired.id,
        providedHash: 'expired-digest',
        actor: 'mfa-runtime',
        now: new Date('2026-01-01T00:01:01.000Z'),
      }),
    ).resolves.toMatchObject({ verified: false, failureReason: 'EXPIRED' });

    const scoped = await testFixture.service.issueChallenge({
      principal,
      enrollmentId: ENROLLMENT_ID,
      methodId: METHOD_ID,
      challengeHash: 'scoped-digest',
      actor: 'mfa-runtime',
      now: new Date('2026-01-01T00:00:00.000Z'),
      ttlSeconds: 60,
    });
    const wrongCustomer: AuthenticatedPrincipal = {
      ...principal,
      customerId: '00000000-0000-4000-8000-000000000099',
    };
    await expect(
      testFixture.service.verifyChallenge({
        principal: wrongCustomer,
        challengeId: scoped.id,
        providedHash: 'scoped-digest',
        actor: 'mfa-runtime',
      }),
    ).resolves.toMatchObject({ verified: false, failureReason: 'WRONG_CUSTOMER' });

    const wrongSession: AuthenticatedPrincipal = {
      ...principal,
      sessionId: '00000000-0000-4000-8000-000000000099',
    };
    await expect(
      testFixture.service.verifyChallenge({
        principal: wrongSession,
        challengeId: scoped.id,
        providedHash: 'scoped-digest',
        actor: 'mfa-runtime',
      }),
    ).resolves.toMatchObject({ verified: false, failureReason: 'WRONG_SESSION' });

    const method = [...testFixture.repositories.methodRepository.records.values()][0];
    if (method) method.status = MfaMethodStatus.DISABLED;
    const unavailable = await testFixture.service
      .issueChallenge({
        principal,
        enrollmentId: ENROLLMENT_ID,
        methodId: METHOD_ID,
        challengeHash: 'unavailable-digest',
        actor: 'mfa-runtime',
      })
      .catch(() => null);
    expect(unavailable).toBeNull();
  });

  it('checks trusted devices with a purpose-bound fingerprint hash', async () => {
    const testFixture = fixture();
    seedActiveMfa(testFixture);
    await expect(
      testFixture.service.checkTrustedDevice({
        principal,
        deviceId: DEVICE_ID,
        fingerprintHash: 'device-fingerprint-hash',
        actor: 'mfa-runtime',
        now: new Date('2026-01-01T00:00:30.000Z'),
      }),
    ).resolves.toMatchObject({ trusted: true, customerId: CUSTOMER_ID, deviceId: DEVICE_ID });
    await expect(
      testFixture.service.checkTrustedDevice({
        principal,
        deviceId: DEVICE_ID,
        fingerprintHash: 'wrong-device-hash',
        actor: 'mfa-runtime',
      }),
    ).resolves.toMatchObject({ trusted: false, failureReason: 'MISMATCH' });
    const device = [...testFixture.repositories.trustedDeviceRepository.records.values()][0];
    if (device) device.status = TrustedDeviceStatus.SUSPENDED;
    await expect(
      testFixture.service.checkTrustedDevice({
        principal,
        deviceId: DEVICE_ID,
        fingerprintHash: 'device-fingerprint-hash',
        actor: 'mfa-runtime',
      }),
    ).resolves.toMatchObject({ trusted: false, failureReason: 'NOT_TRUSTED' });
    const auditText = JSON.stringify(testFixture.auditService.record.mock.calls);
    expect(auditText).not.toContain('device-fingerprint-hash');
  });
});
