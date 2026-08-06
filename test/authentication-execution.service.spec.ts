import { pbkdf2Sync, scryptSync } from 'node:crypto';

import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { Customer } from '../src/customer/customer.entity';
import {
  AuthenticationCredentialStatus,
  PasswordHashAlgorithm,
} from '../src/customer-authentication/customer-authentication.enums';
import { AuthenticationExecutionService } from '../src/customer-authentication/authentication-execution.service';
import type { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import type { CustomerAuthenticationService } from '../src/customer-authentication/customer-authentication.service';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import type { AuditService } from '../src/operations/audit.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CREDENTIAL_ID = '00000000-0000-4000-8000-000000000002';

function encodePbkdf2(password: string): string {
  const salt = Buffer.from('a2-salt');
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function encodeScrypt(password: string): string {
  const salt = Buffer.from('a2-scrypt-salt');
  const digest = scryptSync(password, salt, 32, { N: 1024, r: 8, p: 1 });
  return `SCRYPT$1024$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function credential(overrides: Partial<CustomerAuthenticationCredential> = {}) {
  return {
    id: CREDENTIAL_ID,
    customerId: CUSTOMER_ID,
    type: 'PASSWORD',
    passwordHash: encodePbkdf2('correct-password'),
    hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
    passwordVersion: 1,
    passwordChangedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordExpiresAt: null,
    status: AuthenticationCredentialStatus.ACTIVE,
    failedAuthenticationCount: 0,
    accountLocked: false,
    lockedAt: null,
    lockReason: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerAuthenticationCredential;
}

function fixture(credentialValue = credential()) {
  const customerRepository = {
    findOne: jest.fn().mockResolvedValue({ id: CUSTOMER_ID, deletedAt: null }),
  };
  const credentialRepository = {
    findOne: jest.fn().mockResolvedValue(credentialValue),
  };
  const auditRecord = jest.fn() as jest.MockedFunction<AuditService['record']>;
  auditRecord.mockResolvedValue({} as Awaited<ReturnType<AuditService['record']>>);
  const auditService = { record: auditRecord };
  const recordFailedAuthentication = jest.fn() as jest.MockedFunction<
    CustomerAuthenticationService['recordFailedAuthentication']
  >;
  recordFailedAuthentication.mockResolvedValue(
    {} as Awaited<ReturnType<CustomerAuthenticationService['recordFailedAuthentication']>>,
  );
  const customerAuthenticationService = { recordFailedAuthentication };
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: EntityManager) => Promise<void>) =>
      callback({} as EntityManager),
    ),
  };
  const service = new AuthenticationExecutionService(
    customerRepository as unknown as Repository<Customer>,
    credentialRepository as unknown as Repository<CustomerAuthenticationCredential>,
    dataSource as unknown as DataSource,
    auditService as unknown as AuditService,
    customerAuthenticationService as unknown as CustomerAuthenticationService,
    new PasswordHashVerificationService(),
  );
  return { service, auditService, customerAuthenticationService };
}

describe('PasswordHashVerificationService', () => {
  const service = new PasswordHashVerificationService();

  it('verifies PBKDF2 hashes without exposing hash material', () => {
    expect(
      service.verify(
        'correct-password',
        PasswordHashAlgorithm.PBKDF2,
        encodePbkdf2('correct-password'),
      ),
    ).toEqual({ verified: true });
    expect(
      service.verify(
        'wrong-password',
        PasswordHashAlgorithm.PBKDF2,
        encodePbkdf2('correct-password'),
      ),
    ).toEqual({ verified: false, failure: 'MISMATCH' });
  });

  it('verifies scrypt hashes and rejects unsupported algorithms safely', () => {
    expect(
      service.verify(
        'correct-password',
        PasswordHashAlgorithm.SCRYPT,
        encodeScrypt('correct-password'),
      ),
    ).toEqual({ verified: true });
    expect(
      service.verify('correct-password', PasswordHashAlgorithm.BCRYPT, '$bcrypt$opaque'),
    ).toEqual({ verified: false, failure: 'UNSUPPORTED_ALGORITHM' });
    expect(service.verify('correct-password', PasswordHashAlgorithm.PBKDF2, 'not-a-hash')).toEqual({
      verified: false,
      failure: 'MALFORMED_HASH',
    });
  });
});

describe('AuthenticationExecutionService', () => {
  it('authenticates an active credential and records a safe audit event', async () => {
    const testFixture = fixture();
    const result = await testFixture.service.authenticate({
      customerId: CUSTOMER_ID,
      password: 'correct-password',
      actor: 'a2-authentication',
    });

    expect(result).toEqual({
      authenticated: true,
      customerId: CUSTOMER_ID,
      credentialId: CREDENTIAL_ID,
      passwordVersion: 1,
      accountLocked: false,
    });
    expect(
      testFixture.customerAuthenticationService.recordFailedAuthentication,
    ).not.toHaveBeenCalled();
    expect(testFixture.auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'AUTHENTICATED',
        entityId: CREDENTIAL_ID,
        newValues: expect.objectContaining({
          customerId: CUSTOMER_ID,
          credentialId: CREDENTIAL_ID,
          outcome: 'AUTHENTICATED',
        }) as unknown as Record<string, unknown>,
      }),
    );
    const auditCommand = testFixture.auditService.record.mock.calls[0]?.[1];
    expect(JSON.stringify(auditCommand)).not.toContain('correct-password');
    expect(JSON.stringify(auditCommand)).not.toContain('PBKDF2$');
  });

  it('records a failed authentication without exposing the password or hash', async () => {
    const testFixture = fixture();
    const result = await testFixture.service.authenticate({
      customerId: CUSTOMER_ID,
      password: 'wrong-password',
      actor: 'a2-authentication',
    });

    expect(result).toEqual({
      authenticated: false,
      customerId: CUSTOMER_ID,
      failureReason: 'INVALID_CREDENTIALS',
    });
    expect(
      testFixture.customerAuthenticationService.recordFailedAuthentication,
    ).toHaveBeenCalledWith(
      CUSTOMER_ID,
      CREDENTIAL_ID,
      expect.objectContaining({ actor: 'a2-authentication' }),
    );
    const failureCommand = testFixture.customerAuthenticationService.recordFailedAuthentication.mock
      .calls[0]?.[2] as {
      reason: string;
    };
    expect(failureCommand.reason).not.toContain('wrong-password');
    expect(failureCommand.reason).not.toContain('PBKDF2$');
    expect(testFixture.auditService.record).not.toHaveBeenCalled();
  });

  it('does not verify unavailable credentials or increment failures', async () => {
    const testFixture = fixture(
      credential({
        passwordExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    );
    const result = await testFixture.service.authenticate({
      customerId: CUSTOMER_ID,
      password: 'correct-password',
      actor: 'a2-authentication',
    });

    expect(result.authenticated).toBe(false);
    expect(result.failureReason).toBe('CREDENTIAL_UNAVAILABLE');
    expect(
      testFixture.customerAuthenticationService.recordFailedAuthentication,
    ).not.toHaveBeenCalled();
    expect(testFixture.auditService.record).not.toHaveBeenCalled();
  });
});
