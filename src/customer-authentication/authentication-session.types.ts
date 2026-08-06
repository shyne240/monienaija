import type { AuthenticationExecutionResult } from './authentication-execution.service';
import type { AuthenticationSessionStatus } from './authentication-session.enums';

export interface IssueAuthenticationSessionCommand {
  authentication: AuthenticationExecutionResult;
  actor: string;
  audience?: string;
  ttlSeconds?: number;
  now?: Date;
}

export interface ValidateAuthenticationSessionCommand {
  token: string;
  audience?: string;
  now?: Date;
}

export interface RevokeAuthenticationSessionCommand {
  token: string;
  actor: string;
  reason?: string;
  now?: Date;
}

export interface RotateAuthenticationSessionCommand extends RevokeAuthenticationSessionCommand {
  ttlSeconds?: number;
}

export interface AuthenticatedPrincipal {
  principalType: 'CUSTOMER';
  customerId: string;
  credentialId: string;
  sessionId: string;
  audience: string;
  authenticatedAt: Date;
  expiresAt: Date;
}

export interface AuthenticationSessionToken {
  accessToken: string;
  tokenType: 'Bearer';
  sessionId: string;
  audience: string;
  expiresAt: Date;
  principal: AuthenticatedPrincipal;
}

export interface AuthenticationSessionView {
  id: string;
  customerId: string;
  credentialId: string;
  audience: string;
  status: AuthenticationSessionStatus;
  issuedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  version: number;
}

export interface AuthenticationSessionValidation {
  valid: boolean;
  principal?: AuthenticatedPrincipal;
  reason?:
    | 'MISSING_TOKEN'
    | 'MALFORMED_TOKEN'
    | 'NOT_FOUND'
    | 'REVOKED'
    | 'EXPIRED'
    | 'WRONG_AUDIENCE';
}
