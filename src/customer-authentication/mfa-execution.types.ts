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
}

export interface VerifyMfaChallengeCommand {
  principal: AuthenticatedPrincipal;
  challengeId: string;
  providedHash: string;
  actor: string;
  now?: Date;
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
