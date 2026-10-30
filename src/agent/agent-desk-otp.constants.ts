/**
 * V1-AGENT-MFA-API-01 — constants for the agent-desk customer OTP challenge surface.
 *
 * Purpose: the existing MfaExecutionService verification canon (single authoritative
 * path, TTL 30–900s, replay/expiry/attempt semantics) is consumed by the already-live
 * Wallet→Cash and Cash→Cash claim flows, which require `mfaChallengeId` + `otp`, but no
 * HTTP surface existed to LEGITIMATELY issue such a challenge. These constants define
 * the purpose vocabulary for the new issuance endpoint — and ONLY issuance. No
 * verification semantics change; no second OTP mechanism is created.
 *
 * Purpose binding: challenges issued here carry exactly one of the purposes below.
 * Legacy challenges (purpose NULL, issued/test-fabricated before this feature) remain
 * purpose-generic and behave exactly as before. A purpose-bound challenge refused by a
 * mismatched consumer fails with WRONG_PURPOSE — it cannot be reused across flows.
 */
export const AGENT_DESK_OTP_PURPOSE_WALLET_TO_CASH = 'WALLET_TO_CASH' as const;
export const AGENT_DESK_OTP_PURPOSE_CASH_TO_CASH_CLAIM = 'CASH_TO_CASH_CLAIM' as const;

export const AGENT_DESK_OTP_PURPOSES = [
  AGENT_DESK_OTP_PURPOSE_WALLET_TO_CASH,
  AGENT_DESK_OTP_PURPOSE_CASH_TO_CASH_CLAIM,
] as const;

export type AgentDeskOtpPurpose = (typeof AGENT_DESK_OTP_PURPOSES)[number];

/** OTP code length — same 6-digit numeric convention as the registration OTP. */
export const AGENT_DESK_OTP_CODE_LENGTH = 6;

/** PBKDF2 iterations for at-rest OTP comparand (same family/bounds as registration). */
export const AGENT_DESK_OTP_PBKDF2_ITERATIONS = 100_000;

/**
 * Notification event type for the desk OTP SMS. Registered in SECURITY_CRITICAL set
 * (notification-security.constants.ts — taxonomy class 1: mandatory, bypasses opt-out,
 * delivered DIRECTLY via provider-neutral SMS abstraction, never dispatcher/outbox,
 * because an outbox delivery record would persist the rendered message containing the OTP).
 */
export const AGENT_DESK_OTP_EVENT_TYPE = 'agent.desk.customer_otp' as const;

/** Audit-safe phone masking (last 4 visible) — mirrors the temporary-credential convention. */
export function maskPhoneForAudit(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const tail = digits.slice(-4);
  return `***${tail}`;
}
