import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { canonical, sha256 } from '../authorization/workforce-crypto';

/** DI token: the funding authority depends on this contract, never on a policy table. */
export const CASH_TO_CASH_FUNDING_POLICY_AUTHORITY = Symbol(
  'CASH_TO_CASH_FUNDING_POLICY_AUTHORITY',
);

/**
 * The approved funding policy that governs agent-funded Cash-to-Cash.
 *
 * ARENA 3B Stage 2: the four funding-evidence fingerprints must each bind the authoritative
 * evidence of their own semantic category. `senderPolicyFingerprint` previously hashed the
 * funding agent's affiliation and institution status — that is *institutional ownership*
 * evidence, which is already carried by `institutionEvidenceFingerprint`. Institutional
 * ownership does not establish an approved funding policy, so it must not be presented as one.
 *
 * The policy record is deliberately explicit and minimal: an approved policy reference, the
 * institution it applies to, who approved it and the window it is effective for. No regulatory
 * threshold, eligibility rule or product term is invented here — those belong to the approved
 * policy document, which this contract only identifies.
 */
export interface CashToCashFundingPolicy {
  /** Stable identifier of the approved policy record (never a caller-supplied value). */
  policyId: string;
  /** Human-readable approved policy reference. */
  policyReference: string;
  /** The institution whose funding this policy authorizes. */
  institutionId: string;
  /** Principal that approved the policy. */
  approvedBy: string;
  /** ISO-8601 approval instant. */
  approvedAt: string;
  /** ISO-8601 instant the policy becomes effective. */
  effectiveFrom: string;
  /** ISO-8601 instant the policy stops being effective, or null for open-ended. */
  effectiveUntil: string | null;
}

export interface FundingPolicyResolutionRequest {
  agentId: string;
  institutionId: string;
  currency: string;
  at: Date;
}

export type FundingPolicyUnavailableReason =
  | 'NO_APPROVED_FUNDING_POLICY'
  | 'POLICY_NOT_YET_EFFECTIVE'
  | 'POLICY_EXPIRED'
  | 'POLICY_INSTITUTION_MISMATCH'
  | 'POLICY_AUTHORITY_UNAVAILABLE';

export type FundingPolicyResolution =
  | {
      outcome: 'RESOLVED';
      policy: CashToCashFundingPolicy;
      fingerprint: string;
    }
  | { outcome: 'UNAVAILABLE'; reason: FundingPolicyUnavailableReason };

/**
 * Deterministic digest of the approved policy plus the institutional scope it is applied to.
 * It binds the policy identity, its approval and its effective window, so a different or
 * superseded policy cannot reproduce the same evidence fingerprint.
 */
export function fundingPolicyFingerprint(
  policy: CashToCashFundingPolicy,
  scope: { agentId: string; institutionId: string; currency: string },
): string {
  return sha256(
    canonical({
      kind: 'AGENT_FUNDED_CASH_TO_CASH_FUNDING_POLICY',
      policyId: policy.policyId,
      policyReference: policy.policyReference,
      institutionId: policy.institutionId,
      approvedBy: policy.approvedBy,
      approvedAt: policy.approvedAt,
      effectiveFrom: policy.effectiveFrom,
      effectiveUntil: policy.effectiveUntil,
      agentId: scope.agentId,
      scopeInstitutionId: scope.institutionId,
      currency: scope.currency,
    }),
  );
}

export interface CashToCashFundingPolicyAuthority {
  resolve(
    manager: EntityManager,
    request: FundingPolicyResolutionRequest,
  ): Promise<FundingPolicyResolution>;
}

/**
 * Production binding: no approved Cash-to-Cash funding policy exists for any institution yet,
 * so funding authorization stays fail-closed (503) until an approved policy source is
 * provisioned. This is intentionally *not* an environment flag and cannot be satisfied by a
 * caller-supplied identifier.
 */
@Injectable()
export class UnavailableCashToCashFundingPolicyAuthority
  implements CashToCashFundingPolicyAuthority
{
  resolve(): Promise<FundingPolicyResolution> {
    return Promise.resolve({ outcome: 'UNAVAILABLE', reason: 'NO_APPROVED_FUNDING_POLICY' });
  }
}

/**
 * Evaluates an explicitly supplied approved policy against the request. Used by controlled
 * (test/acceptance) policy sources so the same effective-window and institution rules apply as
 * a production authority would apply.
 */
export function evaluateFundingPolicy(
  policy: CashToCashFundingPolicy | null,
  request: FundingPolicyResolutionRequest,
): FundingPolicyResolution {
  if (!policy) return { outcome: 'UNAVAILABLE', reason: 'NO_APPROVED_FUNDING_POLICY' };
  if (policy.institutionId !== request.institutionId)
    return { outcome: 'UNAVAILABLE', reason: 'POLICY_INSTITUTION_MISMATCH' };
  const at = request.at.getTime();
  if (Date.parse(policy.effectiveFrom) > at)
    return { outcome: 'UNAVAILABLE', reason: 'POLICY_NOT_YET_EFFECTIVE' };
  if (policy.effectiveUntil !== null && Date.parse(policy.effectiveUntil) <= at)
    return { outcome: 'UNAVAILABLE', reason: 'POLICY_EXPIRED' };
  return {
    outcome: 'RESOLVED',
    policy,
    fingerprint: fundingPolicyFingerprint(policy, {
      agentId: request.agentId,
      institutionId: request.institutionId,
      currency: request.currency,
    }),
  };
}
