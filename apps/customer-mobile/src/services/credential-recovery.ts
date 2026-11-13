import { ApiClient, ApiError, NetworkError } from './api-client';

/**
 * ARENA 4 (C-9) — customer self-service credential recovery client.
 *
 * Wired to the accepted backend contract (`src/customer-recovery/*`):
 *
 *   GET  /customers/credential-recovery/policy
 *   POST /customers/credential-recovery/challenges          -> 202 { status, challengeId, ... }
 *   POST /customers/credential-recovery/challenges/verify   -> 200 { status, recoveryToken, ... }
 *   POST /customers/credential-recovery/complete            -> 200 { status, purpose, sessionsRevoked }
 *
 * Every request is unauthenticated by design: the caller has no session yet. Authority comes from
 * the phone OTP **plus** trusted identity evidence evaluated server-side. This client therefore
 * never decides eligibility, never fabricates a success state, and never stores an OTP, a recovery
 * token (beyond in-memory screen state) or a passcode/PIN.
 */

export type RecoveryPurpose = 'LOGIN_PASSCODE' | 'TRANSACTION_PIN';

export interface RecoveryPolicyView {
  policyVersion: string;
  enabled: boolean;
  purposes: RecoveryPurpose[];
  authority: {
    requiresVerifiedPhoneOtp: boolean;
    requiresTrustedIdentityEvidence: boolean;
    requiresActiveCustomer: boolean;
    /** Always false in V1 — documented so the UI cannot imply phone possession is enough. */
    phoneNumberAloneIsSufficient: boolean;
  };
  otp: { expiresInSeconds: number; maxVerifyAttempts: number; resendAfterSeconds: number };
  recoveryToken: { expiresInSeconds: number };
  fallback: { status: 'SUPPORT_REQUIRED'; contact: 'SUPPORT_TICKET' };
}

export interface RequestRecoveryChallengeView {
  status: 'ACCEPTED';
  purpose: RecoveryPurpose;
  /** Opaque reference required by `verify`. Present even for unusable numbers (no enumeration). */
  challengeId: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export interface VerifyRecoveryChallengeView {
  status: 'VERIFIED';
  purpose: RecoveryPurpose;
  recoveryToken: string;
  expiresInSeconds: number;
  deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE';
}

export interface CompleteRecoveryView {
  status: 'COMPLETED';
  purpose: RecoveryPurpose;
  sessionsRevoked: number;
  deviceVerification: 'OTP_AND_IDENTITY_EVIDENCE';
}

export type RecoveryStep = 'PHONE' | 'OTP' | 'SECRET' | 'DONE';

export interface RecoveryFeedback {
  title: string;
  body: string;
  tone: 'error' | 'warning';
  /**
   * True when the backend (or the policy itself) says this customer must finish through Support.
   * The screen then shows the support pathway instead of retrying the form — recovery fails closed.
   */
  supportRequired: boolean;
}

export const CredentialRecoveryApi = {
  policy: () => ApiClient.get<RecoveryPolicyView>('/customers/credential-recovery/policy'),

  requestChallenge: (phone: string, purpose: RecoveryPurpose, deviceId?: string) =>
    ApiClient.post<RequestRecoveryChallengeView>('/customers/credential-recovery/challenges', {
      phone,
      purpose,
      ...(deviceId ? { deviceId } : {}),
    }),

  verifyChallenge: (challengeId: string, code: string, deviceId?: string) =>
    ApiClient.post<VerifyRecoveryChallengeView>(
      '/customers/credential-recovery/challenges/verify',
      { challengeId, code, ...(deviceId ? { deviceId } : {}) },
      // A rejected OTP must never look like an expired customer session.
      { preserveSessionOn401: true },
    ),

  complete: (recoveryToken: string, newSecret: string, confirmation: string, deviceId?: string) =>
    ApiClient.post<CompleteRecoveryView>('/customers/credential-recovery/complete', {
      recoveryToken,
      newSecret,
      confirmation,
      ...(deviceId ? { deviceId } : {}),
    }),
};

const SUPPORT_BODY =
  'MonieNaija could not confirm enough evidence to reset this credential from the app, so nothing was changed. Contact Support to finish — a phone number on its own is never enough to reset a passcode or transaction PIN.';

/**
 * Maps a real backend outcome to honest copy. No branch invents success, and every uncertain state
 * (policy off, evidence unavailable, service down) fails closed onto the support pathway.
 */
export function describeRecoveryFailure(error: unknown, step: RecoveryStep): RecoveryFeedback {
  if (error instanceof NetworkError) {
    return {
      title: 'No connection',
      body: 'MonieNaija could not be reached, so nothing was verified or changed. Check your connection and try again.',
      tone: 'warning',
      supportRequired: false,
    };
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return {
          title: 'Check what you entered',
          body:
            step === 'SECRET'
              ? 'Enter two matching six-digit values: a login passcode and its confirmation, or a transaction PIN and its confirmation.'
              : 'That entry was not accepted. Check it and try again.',
          tone: 'error',
          supportRequired: false,
        };
      case 401:
        return {
          title:
            step === 'OTP' ? 'That code did not match' : 'This recovery link is no longer valid',
          body:
            step === 'OTP'
              ? 'Check the six-digit code in the SMS and enter it again. After repeated failures the request is locked and you will need to start a new one.'
              : 'This recovery request expired or was already used. Start again — nothing was changed.',
          tone: 'error',
          supportRequired: false,
        };
      case 409:
        return {
          title: 'Support is required to finish this',
          body: SUPPORT_BODY,
          tone: 'warning',
          supportRequired: true,
        };
      case 423:
        return {
          title: 'Recovery locked',
          body: 'Too many incorrect codes for this recovery request. It is now closed and nothing was changed. Start again later or contact Support.',
          tone: 'warning',
          supportRequired: true,
        };
      case 429:
        return {
          title: 'Too many attempts',
          body: 'Please wait before requesting another recovery code. No credential has been changed.',
          tone: 'warning',
          supportRequired: false,
        };
      case 503:
        return {
          title: 'Recovery is unavailable',
          body: 'Credential recovery is not available right now, so no code was sent and nothing was changed. Try again later or contact Support.',
          tone: 'warning',
          supportRequired: true,
        };
      default:
        return {
          title: 'Recovery not completed',
          body:
            error.message ||
            'MonieNaija could not complete the recovery. No credential was changed.',
          tone: 'error',
          supportRequired: false,
        };
    }
  }
  return {
    title: 'Recovery not completed',
    body: 'MonieNaija could not complete the recovery. No credential was changed.',
    tone: 'error',
    supportRequired: false,
  };
}

/** Local shape check only — the backend is the authority on whether a number is recoverable. */
export function isPlausibleRecoveryPhone(value: string): boolean {
  const compact = value.replace(/[\s()-]/g, '');
  return /^\+?234\d{10}$/.test(compact) || /^0\d{10}$/.test(compact) || /^\d{10}$/.test(compact);
}

export function isValidNewSecret(value: string): boolean {
  return /^\d{6}$/.test(value);
}
