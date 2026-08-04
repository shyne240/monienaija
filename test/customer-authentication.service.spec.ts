import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import { Customer } from '../src/customer/customer.entity';
import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from '../src/customer/customer.enums';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import {
  AuthenticationCredentialStatus,
  MfaEnrollmentStatus,
  MfaMethodStatus,
  MfaMethodType,
  PasswordHashAlgorithm,
  PasswordResetRequestStatus,
  PasswordResetTokenStatus,
  RecoveryCodeStatus,
  TrustedDeviceStatus,
} from '../src/customer-authentication/customer-authentication.enums';
import { CustomerAuthenticationService } from '../src/customer-authentication/customer-authentication.service';
import { CreateAuthenticationCredentialDto } from '../src/customer-authentication/dto/create-authentication-credential.dto';
import { CreateMfaMethodDto } from '../src/customer-authentication/dto/create-mfa-method.dto';
import { CreateTrustedDeviceDto } from '../src/customer-authentication/dto/create-trusted-device.dto';
import { RotatePasswordDto } from '../src/customer-authentication/dto/rotate-password.dto';
import { MfaEnrollment } from '../src/customer-authentication/mfa-enrollment.entity';
import { MfaMethod } from '../src/customer-authentication/mfa-method.entity';
import { PasswordHistory } from '../src/customer-authentication/password-history.entity';
import { PasswordResetRequest } from '../src/customer-authentication/password-reset-request.entity';
import { PasswordResetToken } from '../src/customer-authentication/password-reset-token.entity';
import { RecoveryCode } from '../src/customer-authentication/recovery-code.entity';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { TrustedDevice } from '../src/customer-authentication/trusted-device.entity';
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

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected authentication repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  readonly manager: EntityManager;

  constructor(private readonly memoryManager: MemoryManager) {
    this.manager = memoryManager as unknown as EntityManager;
  }

  transaction<T>(
    _isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof _isolationOrCallback === 'function' ? _isolationOrCallback : maybeCallback;
    if (!callback) throw new Error('Missing transaction callback');
    return callback(this.manager);
  }
}

describe('CustomerAuthenticationService', () => {
  function fixture() {
    const credentialRepository = new MemoryRepository<CustomerAuthenticationCredential>();
    const passwordHistoryRepository = new MemoryRepository<PasswordHistory>();
    const resetRequestRepository = new MemoryRepository<PasswordResetRequest>();
    const resetTokenRepository = new MemoryRepository<PasswordResetToken>();
    const mfaEnrollmentRepository = new MemoryRepository<MfaEnrollment>();
    const mfaMethodRepository = new MemoryRepository<MfaMethod>();
    const trustedDeviceRepository = new MemoryRepository<TrustedDevice>();
    const recoveryCodeRepository = new MemoryRepository<RecoveryCode>();
    const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
    const customerRepository = new MemoryRepository<Customer>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [
        CustomerAuthenticationCredential,
        credentialRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [PasswordHistory, passwordHistoryRepository as unknown as MemoryRepository<ObjectLiteral>],
      [PasswordResetRequest, resetRequestRepository as unknown as MemoryRepository<ObjectLiteral>],
      [PasswordResetToken, resetTokenRepository as unknown as MemoryRepository<ObjectLiteral>],
      [MfaEnrollment, mfaEnrollmentRepository as unknown as MemoryRepository<ObjectLiteral>],
      [MfaMethod, mfaMethodRepository as unknown as MemoryRepository<ObjectLiteral>],
      [TrustedDevice, trustedDeviceRepository as unknown as MemoryRepository<ObjectLiteral>],
      [RecoveryCode, recoveryCodeRepository as unknown as MemoryRepository<ObjectLiteral>],
      [SecurityEventHistory, securityEventRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerAuthenticationService(
      credentialRepository as unknown as Repository<CustomerAuthenticationCredential>,
      passwordHistoryRepository as unknown as Repository<PasswordHistory>,
      resetRequestRepository as unknown as Repository<PasswordResetRequest>,
      resetTokenRepository as unknown as Repository<PasswordResetToken>,
      mfaEnrollmentRepository as unknown as Repository<MfaEnrollment>,
      mfaMethodRepository as unknown as Repository<MfaMethod>,
      trustedDeviceRepository as unknown as Repository<TrustedDevice>,
      recoveryCodeRepository as unknown as Repository<RecoveryCode>,
      securityEventRepository as unknown as Repository<SecurityEventHistory>,
      customerRepository as unknown as Repository<Customer>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        credentialRepository,
        passwordHistoryRepository,
        resetRequestRepository,
        resetTokenRepository,
        mfaEnrollmentRepository,
        mfaMethodRepository,
        trustedDeviceRepository,
        recoveryCodeRepository,
        securityEventRepository,
        customerRepository,
      },
    };
  }

  async function createCustomer(testFixture: ReturnType<typeof fixture>): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        reference: 'auth-customer',
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  async function createCredential(testFixture: ReturnType<typeof fixture>, customerId: string) {
    return testFixture.service.createCredential(customerId, {
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$stored-hash',
      hashAlgorithm: PasswordHashAlgorithm.ARGON2ID,
      passwordVersion: 1,
      actor: 'auth-ops',
    });
  }

  it('creates one password credential with password history and no plaintext field', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const credential = await createCredential(testFixture, customer.id);

    expect(credential.status).toBe(AuthenticationCredentialStatus.ACTIVE);
    expect(credential.hashAlgorithm).toBe(PasswordHashAlgorithm.ARGON2ID);
    expect(credential.passwordVersion).toBe(1);
    expect(credential).not.toHaveProperty('password');
    expect(testFixture.repositories.passwordHistoryRepository.records.size).toBe(1);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL' }),
    );
    await expect(createCredential(testFixture, customer.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rotates passwords, preserves only hash metadata in views, and enforces expiry metadata', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const credential = await createCredential(testFixture, customer.id);
    const rotated = await testFixture.service.rotatePassword(customer.id, credential.id, {
      passwordHash: '$bcrypt$stored-new-hash',
      hashAlgorithm: PasswordHashAlgorithm.BCRYPT,
      passwordVersion: 2,
      passwordExpiresAt: '2099-01-01T00:00:00.000Z',
      actor: 'auth-ops',
    });

    expect(rotated.hashAlgorithm).toBe(PasswordHashAlgorithm.BCRYPT);
    expect(rotated.passwordVersion).toBe(2);
    expect(rotated.passwordExpired).toBe(false);
    expect(rotated).not.toHaveProperty('password');
    expect(testFixture.repositories.passwordHistoryRepository.records.size).toBe(2);
  });

  it('tracks failed authentication metadata, locks, and unlocks credentials', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const credential = await createCredential(testFixture, customer.id);
    let current = credential;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      current = await testFixture.service.recordFailedAuthentication(customer.id, credential.id, {
        reason: 'metadata-only test failure',
        actor: 'auth-ops',
      });
    }
    expect(current.failedAuthenticationCount).toBe(5);
    expect(current.accountLocked).toBe(true);
    const unlocked = await testFixture.service.unlockCredential(customer.id, credential.id, {
      reason: 'Manual unlock workflow',
      actor: 'security-ops',
    });
    expect(unlocked.accountLocked).toBe(false);
    expect(unlocked.failedAuthenticationCount).toBe(0);
    expect(testFixture.repositories.securityEventRepository.records.size).toBeGreaterThanOrEqual(7);
  });

  it('supports password recovery request and token lifecycle metadata', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const credential = await createCredential(testFixture, customer.id);
    const request = await testFixture.service.createPasswordResetRequest(customer.id, {
      credentialId: credential.id,
      reason: 'Customer recovery request',
      actor: 'recovery-ops',
    });
    const token = await testFixture.service.issuePasswordResetToken(customer.id, request.id, {
      tokenHash: 'token-hash-only',
      tokenVersion: 1,
      expiresAt: '2099-01-01T00:00:00.000Z',
      actor: 'recovery-ops',
    });
    expect(token.status).toBe(PasswordResetTokenStatus.ACTIVE);
    expect(token).not.toHaveProperty('token');
    expect((await testFixture.service.listPasswordResetRequests(customer.id))[0]?.status).toBe(
      PasswordResetRequestStatus.IN_PROGRESS,
    );
    const used = await testFixture.service.updatePasswordResetToken(
      customer.id,
      request.id,
      token.id,
      {
        status: PasswordResetTokenStatus.USED,
        actor: 'recovery-ops',
      },
    );
    expect(used.usedAt).toBeDefined();
    const completed = await testFixture.service.updatePasswordResetRequest(
      customer.id,
      request.id,
      {
        status: PasswordResetRequestStatus.COMPLETED,
        actor: 'recovery-ops',
      },
    );
    expect(completed.status).toBe(PasswordResetRequestStatus.COMPLETED);
  });

  it('stores MFA, trusted device, recovery-code, and security metadata', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const enrollment = await testFixture.service.createMfaEnrollment(customer.id, {
      reference: 'mfa-enrollment-1',
      actor: 'security-ops',
    });
    const method = await testFixture.service.createMfaMethod(customer.id, enrollment.id, {
      type: MfaMethodType.AUTHENTICATOR_APP,
      label: 'Authenticator',
      identifierHash: 'method-identifier-hash',
      isPrimary: true,
      actor: 'security-ops',
    });
    await testFixture.service.updateMfaEnrollment(customer.id, enrollment.id, {
      status: MfaEnrollmentStatus.ENABLED,
      actor: 'security-ops',
    });
    const enabledMethod = await testFixture.service.updateMfaMethod(customer.id, method.id, {
      status: MfaMethodStatus.ENABLED,
      actor: 'security-ops',
    });
    const device = await testFixture.service.createTrustedDevice(customer.id, {
      deviceReference: 'device-1',
      deviceName: 'Test device',
      platform: 'web',
      deviceFingerprintHash: 'fingerprint-hash',
      actor: 'security-ops',
    });
    const trustedDevice = await testFixture.service.updateTrustedDevice(customer.id, device.id, {
      status: TrustedDeviceStatus.TRUSTED,
      actor: 'security-ops',
    });
    const code = await testFixture.service.createRecoveryCode(customer.id, {
      codeHash: 'recovery-code-hash',
      codeVersion: 1,
      enrollmentId: enrollment.id,
      actor: 'security-ops',
    });

    expect(enabledMethod.status).toBe(MfaMethodStatus.ENABLED);
    expect(trustedDevice.status).toBe(TrustedDeviceStatus.TRUSTED);
    expect(code.status).toBe(RecoveryCodeStatus.AVAILABLE);
    expect(testFixture.repositories.mfaEnrollmentRepository.records.size).toBe(1);
    expect(testFixture.repositories.mfaMethodRepository.records.size).toBe(1);
    expect(testFixture.repositories.trustedDeviceRepository.records.size).toBe(1);
    expect(testFixture.repositories.recoveryCodeRepository.records.size).toBe(1);
  });

  it('validates hash-only DTOs, enums, and UUIDs', async () => {
    const credentialErrors = await validate(
      plainToInstance(CreateAuthenticationCredentialDto, {
        password: 'plaintext-must-not-be-accepted',
        passwordHash: 'hash-value',
        hashAlgorithm: 'UNSUPPORTED',
        passwordVersion: 0,
        actor: 'auth-ops',
      }),
    );
    expect(credentialErrors.some((error) => error.property === 'hashAlgorithm')).toBe(true);
    expect(credentialErrors.some((error) => error.property === 'passwordVersion')).toBe(true);

    const rotateErrors = await validate(
      plainToInstance(RotatePasswordDto, {
        password: 'plaintext',
        passwordHash: 'hash value with spaces',
        hashAlgorithm: PasswordHashAlgorithm.BCRYPT,
        passwordVersion: 1,
        actor: 'auth-ops',
      }),
    );
    expect(rotateErrors.some((error) => error.property === 'passwordHash')).toBe(true);

    const methodErrors = await validate(
      plainToInstance(CreateMfaMethodDto, {
        type: 'UNKNOWN',
        label: 'MFA',
        isPrimary: true,
        actor: 'security-ops',
      }),
    );
    expect(methodErrors.some((error) => error.property === 'type')).toBe(true);

    const deviceErrors = await validate(
      plainToInstance(CreateTrustedDeviceDto, {
        deviceReference: 'device-1',
        deviceName: 'Device',
        platform: 'web',
        deviceFingerprintHash: 'finger print',
        actor: 'security-ops',
      }),
    );
    expect(deviceErrors.some((error) => error.property === 'deviceFingerprintHash')).toBe(true);

    const testFixture = fixture();
    await expect(testFixture.service.getCredential('not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
