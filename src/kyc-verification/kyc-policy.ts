import { KycFoundationError, type KycPolicy } from './kyc.types';

/** Configuration must be explicit; no regulatory tiers, limits, or commercial defaults are assumed. */
export function assertPolicy(p: KycPolicy): void {
  if (!p || !/^[A-Za-z0-9._-]{1,64}$/.test(p.version) || typeof p.enabled !== 'boolean')
    throw new KycFoundationError('INVALID');
  const ranges: Array<[number, number, number]> = [
    [p.maxAttemptsPerConsent, 1, 20],
    [p.cooldownSeconds, 1, 2592000],
    [p.customerWindowSeconds, 1, 2592000],
    [p.customerWindowLimit, 1, 100],
    [p.providerWindowSeconds, 1, 2592000],
    [p.providerWindowLimit, 1, 100000],
    [p.timeoutMs, 100, 30000],
    [p.evidenceValiditySeconds, 1, 31536000],
  ];
  if (ranges.some(([v, min, max]) => !Number.isSafeInteger(v) || v < min || v > max))
    throw new KycFoundationError('INVALID');
}

export type Evidence = 'PHONE' | 'BVN' | 'NIN' | 'BIOMETRIC' | 'ADDRESS' | 'UTILITY_BILL' | 'GPS';
export interface EligibilityPolicy {
  version: string;
  all: Evidence[];
  any: Evidence[][];
}
export interface EvidenceState {
  type: Evidence;
  verified: boolean;
  expiresAt: Date | null;
  revoked: boolean;
}
/** Advisory only: no mutation of existing KYC assessments, wallets, permissions, or limits. */
export function evaluateEligibility(
  policy: EligibilityPolicy | null,
  evidence: EvidenceState[],
  now: Date,
): 'NOT_CONFIGURED' | 'PENDING' | 'SATISFIED' {
  const known: Evidence[] = ['PHONE', 'BVN', 'NIN', 'BIOMETRIC', 'ADDRESS', 'UTILITY_BILL', 'GPS'];
  if (
    !policy ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(policy.version) ||
    !Array.isArray(policy.all) ||
    !Array.isArray(policy.any) ||
    policy.all.length + policy.any.length === 0 ||
    policy.all.some((x) => !known.includes(x)) ||
    policy.any.some(
      (group) => !Array.isArray(group) || !group.length || group.some((x) => !known.includes(x)),
    )
  )
    return 'NOT_CONFIGURED';
  if (!Number.isFinite(now.getTime())) return 'PENDING';
  const has = (kind: Evidence) =>
    evidence.some(
      (e) =>
        e.type === kind &&
        e.verified === true &&
        e.revoked === false &&
        e.expiresAt instanceof Date &&
        Number.isFinite(e.expiresAt.getTime()) &&
        e.expiresAt > now,
    );
  return policy.all.every(has) && policy.any.every((group) => group.some(has))
    ? 'SATISFIED'
    : 'PENDING';
}
