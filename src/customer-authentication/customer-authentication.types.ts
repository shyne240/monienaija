import type {
  AuthenticationCredentialStatus,
  MfaEnrollmentStatus,
  MfaMethodStatus,
  MfaMethodType,
  PasswordHashAlgorithm,
  PasswordResetRequestStatus,
  PasswordResetTokenStatus,
  RecoveryCodeStatus,
  TrustedDeviceStatus,
} from './customer-authentication.enums';

export interface CreateAuthenticationCredentialCommand {
  passwordHash: string;
  hashAlgorithm: PasswordHashAlgorithm;
  passwordVersion: number;
  passwordExpiresAt?: string;
  actor: string;
}

export interface UpdateAuthenticationCredentialCommand {
  status?: AuthenticationCredentialStatus;
  passwordExpiresAt?: string;
  actor: string;
  version?: number;
}

export interface RotatePasswordCommand {
  passwordHash: string;
  hashAlgorithm: PasswordHashAlgorithm;
  passwordVersion: number;
  passwordExpiresAt?: string;
  actor: string;
}

export interface RecordFailedAuthenticationCommand {
  actor: string;
  reason?: string;
}

export interface UnlockCredentialCommand {
  actor: string;
  reason?: string;
}

export interface CreatePasswordResetRequestCommand {
  credentialId: string;
  expiresAt?: string;
  reason?: string;
  actor: string;
}

export interface UpdatePasswordResetRequestCommand {
  status: PasswordResetRequestStatus;
  actor: string;
  version?: number;
}

export interface IssuePasswordResetTokenCommand {
  tokenHash: string;
  tokenVersion: number;
  expiresAt: string;
  actor: string;
}

export interface UpdatePasswordResetTokenCommand {
  status: PasswordResetTokenStatus;
  actor: string;
  version?: number;
}

export interface CreateMfaEnrollmentCommand {
  reference: string;
  actor: string;
}

export interface UpdateMfaEnrollmentCommand {
  status: MfaEnrollmentStatus;
  actor: string;
  version?: number;
}

export interface CreateMfaMethodCommand {
  type: MfaMethodType;
  label: string;
  identifierHash?: string;
  isPrimary: boolean;
  actor: string;
}

export interface UpdateMfaMethodCommand {
  status: MfaMethodStatus;
  actor: string;
  version?: number;
}

export interface CreateTrustedDeviceCommand {
  deviceReference: string;
  deviceName: string;
  platform: string;
  deviceFingerprintHash: string;
  actor: string;
}

export interface UpdateTrustedDeviceCommand {
  status: TrustedDeviceStatus;
  actor: string;
  version?: number;
}

export interface CreateRecoveryCodeCommand {
  codeHash: string;
  codeVersion: number;
  enrollmentId?: string;
  actor: string;
}

export interface UpdateRecoveryCodeCommand {
  status: RecoveryCodeStatus;
  actor: string;
  version?: number;
}

export interface AuthenticationCredentialView {
  id: string;
  customerId: string;
  type: string;
  status: AuthenticationCredentialStatus;
  hashAlgorithm: PasswordHashAlgorithm;
  passwordVersion: number;
  passwordChangedAt: Date;
  passwordExpiresAt: Date | null;
  passwordExpired: boolean;
  failedAuthenticationCount: number;
  accountLocked: boolean;
  lockedAt: Date | null;
  lockReason: string | null;
  rotationRequired: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** V1-CUSTOMER-CREDENTIALS-01 — workforce issuance of a temporary, rotation-required
 *  first credential. The plaintext exists only at the delivery boundary; the service
 *  receives the already-computed hash (same split as the Agent precedent: the controller
 *  generates/hashes, the service persists/audits). */
export interface IssueInitialCustomerCredentialCommand {
  passwordHash: string;
  hashAlgorithm: PasswordHashAlgorithm;
  passwordExpiresAt: string;
  actor: string;
}

/** V1-CUSTOMER-CREDENTIALS-01 — mandatory first-login rotation of a workforce-issued
 *  temporary credential. The caller must have verified the current password through
 *  AuthenticationExecutionService first. */
export interface RotateInitialCustomerPasswordCommand {
  passwordHash: string;
  hashAlgorithm: PasswordHashAlgorithm;
  actor: string;
}
