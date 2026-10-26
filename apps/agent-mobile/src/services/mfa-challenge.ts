import type { AgentMfaChallenge } from './agent-api';

/**
 * Reusable MFA challenge state model (V1-AGENT-MOBILE-03, spec §5.1 OTP
 * issuance). The challenge identity is ALWAYS the server-issued challengeId;
 * the OTP itself never reaches this app (issue-only API surface).
 *
 * States:
 *  - idle        — no challenge requested yet
 *  - requesting  — POST /agents/me/mfa-challenges in flight
 *  - ready       — server accepted + delivered; entry happens in a later
 *                  transaction flow (no client-side verification exists)
 *  - failed      — request rejected (message already sanitized by describeApiError)
 *  - expired     — server expiresAt has passed (local clock comparison only;
 *                  NO network polling is used for expiration)
 */

export type MfaChallengeStatus = 'idle' | 'requesting' | 'ready' | 'failed' | 'expired';

export interface MfaChallengeState {
  status: MfaChallengeStatus;
  challenge: AgentMfaChallenge | null;
  /** Sanitized, user-facing failure message (never raw backend errors). */
  failureMessage: string | null;
}

export function isChallengeExpired(challenge: AgentMfaChallenge | null, now: number): boolean {
  if (!challenge) return false;
  const expiry = new Date(challenge.expiresAt).getTime();
  return !Number.isNaN(expiry) && now >= expiry;
}

/** Whole seconds a challenge has left (floor at 0). */
export function remainingChallengeSeconds(challenge: AgentMfaChallenge, now: number): number {
  const ms = new Date(challenge.expiresAt).getTime() - now;
  return Math.max(0, Math.floor(ms / 1000));
}

/** "m:ss" countdown rendering; server ttl is the only input. */
export function formatChallengeCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
