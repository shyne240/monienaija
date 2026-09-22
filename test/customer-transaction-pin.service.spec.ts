import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import { Customer } from '../src/customer/customer.entity';
import type { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import {
  AuthenticationCredentialStatus,
  AuthenticationCredentialType,
  PasswordHashAlgorithm,
  SecurityEventType,
} from '../src/customer-authentication/customer-authentication.enums';
import { CustomerTransactionPinService } from '../src/customer-authentication/customer-transaction-pin.service';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { PinHashService } from '../src/customer-authentication/pin-hash.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import type { TransactionPinSecurityPolicy } from '../src/customer-authentication/transaction-pin-policy';
import { encodePbkdf2Sha512 } from './support/transaction-pin-harness';
import type { AuditService } from '../src/operations/audit.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const ACTOR = 'pin-ops';

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
      record.id = `00000000-0000-4000-8000-000000000${String(this.sequence).padStart(3, '0')}`;
    }
    record.createdAt ??= new Date(1_000 + this.sequence);
    record.updatedAt = new Date(2_000 + this.sequence);
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(
          ([key, expected]) => (entity as Record<string, unknown>)[key] === expected,
        ),
      ) ?? null,
    );
  }

  find(options?: { where?: Partial<T> }): Promise<T[]> {
    const conditions = options?.where ?? {};
    return Promise.resolve(
      [...this.records.values()].filter((entity) =>
        Object.entries(conditions).every(
          ([key, expected]) => (entity as Record<string, unknown>)[key] === expected,
        ),
      ),
    );
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected repository in pin unit test');
    return repository as unknown as Repository<T>;
  }
}

function fixture(options?: { pinPolicy?: TransactionPinSecurityPolicy }) {
  const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>();
  const customerRepository = new MemoryRepository<Customer>();
  const credentialRepository = new MemoryRepository<CustomerAuthenticationCredential>();
  const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
  repositories.set(Customer, customerRepository);
  repositories.set(CustomerAuthenticationCredential, credentialRepository);
  repositories.set(SecurityEventHistory, securityEventRepository);

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const manager = new MemoryManager(repositories);
  const dataSource = {
    transaction: (work: (entityManager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
  };
  const authenticationExecution = {
    authenticate: jest.fn().mockResolvedValue({ authenticated: true, customerId: CUSTOMER_ID }),
  };
  const service = new CustomerTransactionPinService(
    customerRepository as unknown as Repository<Customer>,
    credentialRepository as unknown as Repository<CustomerAuthenticationCredential>,
    securityEventRepository as unknown as Repository<SecurityEventHistory>,
    dataSource as unknown as DataSource,
    auditService as unknown as AuditService,
    new PinHashService(options?.pinPolicy),
    new PasswordHashVerificationService(),
    authenticationExecution as unknown as AuthenticationExecutionService,
    options?.pinPolicy,
  );

  return {
    service,
    customerRepository,
    credentialRepository,
    securityEventRepository,
    auditService,
    authenticationExecution,
  };
}

async function seedCustomer(testFixture: ReturnType<typeof fixture>, id = CUSTOMER_ID) {
  const customer = await testFixture.customerRepository.save(
    testFixture.customerRepository.create({ id, deletedAt: null }),
  );
  return customer;
}

function securityEvents(testFixture: ReturnType<typeof fixture>) {
  return [...testFixture.securityEventRepository.records.values()].map((event) => event.eventType);
}

function passwordCredential(
  overrides: Partial<CustomerAuthenticationCredential> = {},
): CustomerAuthenticationCredential {
  return {
    id: '00000000-0000-4000-8000-0000000000d9',
    customerId: CUSTOMER_ID,
    type: AuthenticationCredentialType.PASSWORD,
    passwordHash: encodePbkdf2Sha512('correct horse battery staple'),
    hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
    passwordVersion: 1,
    passwordChangedAt: new Date(),
    passwordExpiresAt: null,
    status: AuthenticationCredentialStatus.ACTIVE,
    failedAuthenticationCount: 0,
    accountLocked: false,
    lockedAt: null,
    lockReason: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('CustomerTransactionPinService', () => {
  it('creates a PIN credential: hashed server-side, never returned, exactly one per customer', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);

    const created = await testFixture.service.createPin(CUSTOMER_ID, {
      pin: '13579',
      actor: ACTOR,
    });
    expect(created.configured).toBe(true);
    expect(created.accountLocked).toBe(false);
    expect(created).not.toHaveProperty('pin');
    expect(created).not.toHaveProperty('passwordHash');

    const stored = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(stored.passwordHash).not.toContain('13579');
    expect(stored.passwordHash.startsWith('PBKDF2$sha512$')).toBe(true);
    expect(stored.status).toBe(AuthenticationCredentialStatus.ACTIVE);
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_CREATED);

    const auditCalls = (
      testFixture.auditService.record.mock.calls as Array<[unknown, Record<string, unknown>]>
    ).map((call) => call[1]);
    for (const call of auditCalls) {
      expect(JSON.stringify(call)).not.toContain('13579');
    }
  });

  it('rejects duplicate PIN creation', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    await expect(
      testFixture.service.createPin(CUSTOMER_ID, { pin: '24680', actor: ACTOR }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects malformed PINs at creation and change', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await expect(
      testFixture.service.createPin(CUSTOMER_ID, { pin: '12ab', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    await expect(
      testFixture.service.changePin(CUSTOMER_ID, {
        currentPin: '13579',
        newPin: '1234567',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifies a correct PIN without touching the password credential', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    const password = passwordCredential();
    await testFixture.credentialRepository.save(password);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });

    const verdict = await testFixture.service.verifyTransactionPin(CUSTOMER_ID, {
      pin: '13579',
      actor: ACTOR,
    });
    expect(verdict.configured).toBe(true);
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_VERIFICATION_SUCCEEDED);
    expect(password.failedAuthenticationCount).toBe(0);
    expect(password.accountLocked).toBe(false);
  });

  it('counts failed PIN attempts, locks at the threshold, rejects while locked, NEVER locks the password', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    const password = passwordCredential();
    await testFixture.credentialRepository.save(password);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '99999', actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    const pinCredential = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(pinCredential.failedAuthenticationCount).toBe(5);
    expect(pinCredential.accountLocked).toBe(true);
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_LOCKED);
    expect(
      securityEvents(testFixture).filter(
        (event) => event === SecurityEventType.PIN_VERIFICATION_FAILED,
      ),
    ).toHaveLength(5);
    // PIN lockout is credential-scoped: the login credential is untouched.
    expect(password.accountLocked).toBe(false);
    expect(password.failedAuthenticationCount).toBe(0);

    // Even the correct PIN is rejected while locked.
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The lock does not consume further attempts.
    expect(pinCredential.failedAuthenticationCount).toBe(5);
  });

  it('the lockout threshold follows the configured policy (internal V1 default stays 5 when unconfigured)', async () => {
    // A stricter configured policy of 2 attempts: locks on the SECOND failure,
    // proving the threshold flows from configuration, not a magic number.
    const policy: TransactionPinSecurityPolicy = {
      maxFailedAttempts: 2,
      minPinLength: 4,
      maxPinLength: 6,
    };
    const strict = fixture({ pinPolicy: policy });
    await seedCustomer(strict);
    const password = passwordCredential();
    await strict.credentialRepository.save(password);
    await strict.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });

    await expect(
      strict.service.verifyTransactionPin(CUSTOMER_ID, { pin: '99999', actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    let pinCredential = [...strict.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    // With the V1 default (5) one failure would NOT lock; with the configured
    // policy a single failure is still below the configured threshold.
    expect(pinCredential.accountLocked).toBe(false);
    expect(pinCredential.failedAuthenticationCount).toBe(1);

    await expect(
      strict.service.verifyTransactionPin(CUSTOMER_ID, { pin: '99999', actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    pinCredential = [...strict.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(pinCredential.failedAuthenticationCount).toBe(2);
    expect(pinCredential.accountLocked).toBe(true);
    expect(securityEvents(strict)).toContain(SecurityEventType.PIN_LOCKED);
    await expect(
      strict.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // PIN lockout is still credential-scoped under the configured threshold:
    // the PASSWORD credential is untouched, and password-authenticated reset
    // remains the recovery path.
    expect(password.accountLocked).toBe(false);
    expect(password.failedAuthenticationCount).toBe(0);

    // A looser configured policy of 10 attempts: the default-5 boundary
    // stops locking too, i.e. the same code obeys configuration both ways.
    const loosePolicy: TransactionPinSecurityPolicy = {
      maxFailedAttempts: 10,
      minPinLength: 4,
      maxPinLength: 6,
    };
    const loose = fixture({ pinPolicy: loosePolicy });
    await seedCustomer(loose);
    await loose.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await expect(
        loose.service.verifyTransactionPin(CUSTOMER_ID, { pin: '99999', actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const loosePinCredential = [...loose.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(loosePinCredential.failedAuthenticationCount).toBe(7);
    expect(loosePinCredential.accountLocked).toBe(false);
  });

  it('PIN-scoped lockout under a custom policy never leaks into the password credential', async () => {
    const policy: TransactionPinSecurityPolicy = {
      maxFailedAttempts: 2,
      minPinLength: 4,
      maxPinLength: 6,
    };
    const testFixture = fixture({ pinPolicy: policy });
    await seedCustomer(testFixture);
    const password = passwordCredential();
    await testFixture.credentialRepository.save(password);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });

    // Lock the PIN credential with the configured threshold.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '00000', actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const pinCredential = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(pinCredential.accountLocked).toBe(true);

    // Password authentication is decided ONLY by the password credential:
    // password-authenticated PIN recovery still succeeds while the PIN is
    // locked, and it leaves the password credential's counters untouched.
    expect(testFixture.authenticationExecution.authenticate).not.toHaveBeenCalled();
    const reset = await testFixture.service.resetPin(CUSTOMER_ID, {
      password: 'correct horse battery staple',
      newPin: '24681',
      actor: ACTOR,
    });
    expect(reset.configured).toBe(true);
    expect(reset.accountLocked).toBe(false);
    expect(testFixture.authenticationExecution.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER_ID }),
    );
    expect(password.accountLocked).toBe(false);
    expect(password.failedAuthenticationCount).toBe(0);

    // The new PIN verifies immediately after recovery.
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '24681', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true, accountLocked: false });
  });

  it('enrollment rejects PIN lengths outside the CONFIGURED policy while defaults keep 4-6', async () => {
    // Defaults (no policy injected): the V1 4-6 digit behavior is unchanged.
    const defaults = fixture();
    await seedCustomer(defaults);
    await expect(
      defaults.service.createPin(CUSTOMER_ID, { pin: '123', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      defaults.service.createPin(CUSTOMER_ID, { pin: '1234567', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      defaults.service.createPin(CUSTOMER_ID, { pin: '123456', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });

    // Configured 8-10 digit policy: previously-legal 6-digit enrollment is
    // rejected and the configured window is honored end to end.
    const configured = fixture({
      pinPolicy: { maxFailedAttempts: 5, minPinLength: 8, maxPinLength: 10 },
    });
    await seedCustomer(configured);
    await expect(
      configured.service.createPin(CUSTOMER_ID, { pin: '123456', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      configured.service.createPin(CUSTOMER_ID, { pin: '12345678901', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const created = await configured.service.createPin(CUSTOMER_ID, {
      pin: '12345678',
      actor: ACTOR,
    });
    expect(created.configured).toBe(true);
    await expect(
      configured.service.verifyTransactionPin(CUSTOMER_ID, { pin: '12345678', actor: ACTOR }),
    ).resolves.toMatchObject({ accountLocked: false });
  });

  it('successful verification resets the failed PIN attempt counter', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '00000', actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    const pinCredential = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(pinCredential.failedAuthenticationCount).toBe(0);
    expect(pinCredential.accountLocked).toBe(false);
  });

  it('unlock clears the lock and restores verification', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '00000', actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const unlocked = await testFixture.service.unlockPin(CUSTOMER_ID, {
      actor: 'security-ops',
      reason: 'verified owner',
    });
    expect(unlocked.accountLocked).toBe(false);
    expect(unlocked.failedPinAttemptCount).toBe(0);
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_UNLOCKED);

    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true, accountLocked: false });
  });

  it('change requires the current PIN and rotates the hash', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });

    await expect(
      testFixture.service.changePin(CUSTOMER_ID, {
        currentPin: '99999',
        newPin: '86420',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    let pinCredential = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    // Wrong current PIN is counted like any verification failure.
    expect(pinCredential.failedAuthenticationCount).toBe(1);

    const previousHash = pinCredential.passwordHash;
    const changed = await testFixture.service.changePin(CUSTOMER_ID, {
      currentPin: '13579',
      newPin: '86420',
      actor: ACTOR,
    });
    expect(changed.configured).toBe(true);
    pinCredential = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(pinCredential.passwordHash).not.toBe(previousHash);
    expect(pinCredential.passwordHash).not.toContain('86420');
    expect(pinCredential.passwordVersion).toBe(2);
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_CHANGED);

    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '86420', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });
  });

  it('reset requires recovery authorization and never works off the customer ID alone', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });

    testFixture.authenticationExecution.authenticate.mockResolvedValueOnce({
      authenticated: false,
      customerId: CUSTOMER_ID,
      failureReason: 'INVALID_CREDENTIALS',
    });
    await expect(
      testFixture.service.resetPin(CUSTOMER_ID, {
        password: 'wrong-password',
        newPin: '86420',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // The PIN is unchanged.
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_RESET_REQUESTED);
    expect(securityEvents(testFixture)).not.toContain(SecurityEventType.PIN_RESET);

    const reset = await testFixture.service.resetPin(CUSTOMER_ID, {
      password: 'correct password',
      newPin: '86420',
      actor: ACTOR,
    });
    expect(reset.configured).toBe(true);
    expect(securityEvents(testFixture)).toContain(SecurityEventType.PIN_RESET);
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '86420', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });
  });

  it('reset recovers a locked PIN', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '00000', actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const pinCredential = [...testFixture.credentialRepository.records.values()].find(
      (record) => record.type === AuthenticationCredentialType.PIN,
    )!;
    expect(pinCredential.accountLocked).toBe(true);

    const reset = await testFixture.service.resetPin(CUSTOMER_ID, {
      password: 'correct password',
      newPin: '77777',
      actor: ACTOR,
    });
    expect(reset.accountLocked).toBe(false);
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '77777', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true, accountLocked: false });
  });

  it('reports status without ever exposing PIN material', async () => {
    const testFixture = fixture();
    await seedCustomer(testFixture);
    const empty = await testFixture.service.getPinStatus(CUSTOMER_ID);
    expect(empty).toEqual({
      configured: false,
      accountLocked: false,
      failedPinAttemptCount: 0,
      pinVersion: null,
      lockedAt: null,
      changedAt: null,
    });
    await testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR });
    const status = await testFixture.service.getPinStatus(CUSTOMER_ID);
    expect(JSON.stringify(status)).not.toContain('13579');
    expect(status).not.toHaveProperty('passwordHash');
    expect(status.configured).toBe(true);
  });

  it('rejects operations on unknown customers and missing PINs with safe errors', async () => {
    const testFixture = fixture();
    await expect(
      testFixture.service.createPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await seedCustomer(testFixture);
    await expect(
      testFixture.service.verifyTransactionPin(CUSTOMER_ID, { pin: '13579', actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      testFixture.service.changePin(CUSTOMER_ID, {
        currentPin: '13579',
        newPin: '97531',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      testFixture.service.createPin('not-a-uuid', { pin: '13579', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
