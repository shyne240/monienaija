import type { AuthenticatedPrincipal } from './authentication-session.types';
import type { MfaChallengeStatus } from './mfa-challenge.enums';
import type { MfaMethodType } from './customer-authentication.enums';

export interface IssueMfaChallengeCommand {
  principal: AuthenticatedPrincipal;
  enrollmentId: string;
  methodId: string;
  challengeHash: string;
  actor: string;
  ttlSeconds?: number;
  now?: Date;
  /** V1-AGENT-MFA-API-01 — optional purpose bound at issuance (max 64 chars, no
   *  whitespace). Omitted → NULL (legacy purpose-generic). */
  purpose?: string;
}

export interface VerifyMfaChallengeCommand {
  principal: AuthenticatedPrincipal;
  challengeId: string;
  providedHash: string;
  actor: string;
  now?: Date;
  /** V1-AGENT-MFA-API-01 — consumer declares the purpose it is verifying for.
   *  If the challenge carries a purpose and it differs → WRONG_PURPOSE.
   *  If the challenge purpose is NULL (legacy), verification is unchanged. */
  expectedPurpose?: string;
}

export interface CheckTrustedDeviceCommand {
  principal: AuthenticatedPrincipal;
  deviceId: string;
  fingerprintHash: string;
  actor: string;
  now?: Date;
}

export interface MfaChallengeView {
  id: string;
  customerId: string;
  enrollmentId: string;
  methodId: string;
  sessionId: string;
  methodType: MfaMethodType;
  status: MfaChallengeStatus;
  /** V1-AGENT-MFA-API-01 — purpose bound at issuance; null for legacy generic challenges. */
  purpose?: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

export interface MfaChallengeResult {
  verified: boolean;
  customerId: string;
  sessionId: string;
  challengeId: string;
  enrollmentId: string;
  methodId: string;
  methodType?: MfaMethodType;
  assurance: 'MFA';
  verifiedAt?: Date;
  expiresAt?: Date;
  failureReason?:
    | 'INVALID_CHALLENGE'
    | 'WRONG_CUSTOMER'
    | 'WRONG_SESSION'
    | 'MFA_UNAVAILABLE'
    | 'EXPIRED'
    | 'REPLAYED'
    | 'WRONG_PURPOSE'
    | 'MISMATCH';
}

export interface TrustedDeviceResult {
  trusted: boolean;
  customerId: string;
  sessionId: string;
  deviceId: string;
  checkedAt: Date;
  failureReason?: 'NOT_FOUND' | 'WRONG_CUSTOMER' | 'NOT_TRUSTED' | 'MISMATCH';
}
