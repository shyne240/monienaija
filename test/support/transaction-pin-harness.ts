import { pbkdf2Sync, randomBytes } from 'node:crypto';

import type { DataSource } from 'typeorm';

import { Customer } from '../../src/customer/customer.entity';
import { AuthenticationExecutionService } from '../../src/customer-authentication/authentication-execution.service';
import { CustomerAuthenticationCredential } from '../../src/customer-authentication/customer-authentication-credential.entity';
import { CustomerAuthenticationService } from '../../src/customer-authentication/customer-authentication.service';
import {
  PasswordHashAlgorithm,
} from '../../src/customer-authentication/customer-authentication.enums';
import { CustomerTransactionPinService } from '../../src/customer-authentication/customer-transaction-pin.service';
import { MfaEnrollment } from '../../src/customer-authentication/mfa-enrollment.entity';
import { MfaMethod } from '../../src/customer-authentication/mfa-method.entity';
import { PasswordHashVerificationService } from '../../src/customer-authentication/password-hash-verification.service';
import { PasswordHistory } from '../../src/customer-authentication/password-history.entity';
import { PasswordResetRequest } from '../../src/customer-authentication/password-reset-request.entity';
import { PasswordResetToken } from '../../src/customer-authentication/password-reset-token.entity';
import { PinHashService } from '../../src/customer-authentication/pin-hash.service';
import { RecoveryCode } from '../../src/customer-authentication/recovery-code.entity';
import { SecurityEventHistory } from '../../src/customer-authentication/security-event-history.entity';
import { TrustedDevice } from '../../src/customer-authentication/trusted-device.entity';
import type { AuditService } from '../../src/operations/audit.service';
import { CustomerTransactionAuthorizationService } from '../../src/customer-financial-operations/customer-transaction-authorization.service';

/** Well-formed test PIN used by integration suites (never stored plaintext). */
export const TEST_TRANSACTION_PIN = '13579';

export interface TransactionPinStack {
  pinService: CustomerTransactionPinService;
  authorization: CustomerTransactionAuthorizationService;
  authenticationService: CustomerAuthenticationService;
  execution: AuthenticationExecutionService;
  hashVerification: PasswordHashVerificationService;
}

/**
 * Real PIN management/verification stack (real services, real repositories,
 * real PostgreSQL) composed the same way the Nest module composes it at
 * runtime. Used by integration suites that execute customer-facing financial
 * operations, which now require a verified transaction PIN.
 */
export function createTransactionPinStack(
  dataSource: DataSource,
  audit: AuditService,
): TransactionPinStack {
  const repository = <T extends object>(entity: new () => T) => dataSource.getRepository(entity);
  const hashVerification = new PasswordHashVerificationService();
  const authenticationService = new CustomerAuthenticationService(
    repository(CustomerAuthenticationCredential),
    repository(PasswordHistory),
    repository(PasswordResetRequest),
    repository(PasswordResetToken),
    repository(MfaEnrollment),
    repository(MfaMethod),
    repository(TrustedDevice),
    repository(RecoveryCode),
    repository(SecurityEventHistory),
    repository(Customer),
    dataSource,
    audit,
  );
  const execution = new AuthenticationExecutionService(
    repository(Customer),
    repository(CustomerAuthenticationCredential),
    dataSource,
    audit,
    authenticationService,
    hashVerification,
  );
  const pinService = new CustomerTransactionPinService(
    repository(Customer),
    repository(CustomerAuthenticationCredential),
    repository(SecurityEventHistory),
    dataSource,
    audit,
    new PinHashService(),
    hashVerification,
    execution,
  );
  return {
    pinService,
    authorization: new CustomerTransactionAuthorizationService(pinService),
    authenticationService,
    execution,
    hashVerification,
  };
}

/** Seeds an ACTIVE transaction PIN for a customer through the real service. */
export async function seedTransactionPin(
  stack: TransactionPinStack,
  customerId: string,
  pin: string = TEST_TRANSACTION_PIN,
): Promise<void> {
  await stack.pinService.createPin(customerId, {
    pin,
    actor: 'integration-harness',
  });
}

/** PBKDF2-SHA512 encoded hash, the exact domain the verifier enforces. */
export function encodePbkdf2Sha512(secret: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(secret, salt, 210_000, 32, 'sha512');
  return [
    'PBKDF2',
    'sha512',
    '210000',
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Seeds a PASSWORD credential usable as the PIN-reset recovery factor,
 * through the real credential service (client-supplied hash convention).
 */
export async function seedPasswordCredential(
  stack: TransactionPinStack,
  customerId: string,
  password: string,
): Promise<void> {
  await stack.authenticationService.createCredential(customerId, {
    passwordHash: encodePbkdf2Sha512(password),
    hashAlgorithm: PasswordHashAlgorithm.PBKDF2,
    passwordVersion: 1,
    actor: 'integration-harness',
  });
}
