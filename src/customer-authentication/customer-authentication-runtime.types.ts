import type { PasswordHashAlgorithm } from './customer-authentication.enums';
import type { AuthenticationSessionToken } from './authentication-session.types';

export interface CustomerAuthenticationCommand {
  customerId: string;
  password: string;
  actor: string;
  audience?: string;
  ttlSeconds?: number;
  now?: Date;
}

export interface CustomerAuthenticationResult {
  authenticated: boolean;
  customerId: string;
  session?: AuthenticationSessionToken;
  failureReason?: 'INVALID_CREDENTIALS';
}

export interface CompletePasswordResetCommand {
  customerId: string;
  requestId: string;
  tokenHash: string;
  passwordHash: string;
  hashAlgorithm: PasswordHashAlgorithm;
  passwordVersion: number;
  actor: string;
  passwordExpiresAt?: string;
  requestVersion?: number;
  tokenVersion?: number;
  now?: Date;
}

export interface PasswordResetCompletionResult {
  completed: boolean;
  customerId: string;
  requestId: string;
  credentialId?: string;
  sessionsInvalidated: number;
  failureReason?: 'INVALID_RECOVERY' | 'STALE_VERSION' | 'CREDENTIAL_UNAVAILABLE';
}
