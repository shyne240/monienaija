import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  validateTierPolicyDefinition,
  type TierPolicyDefinition,
} from '../kyc-verification/kyc-tier-policy.service';
import type { TierRequirements } from '../kyc-verification/kyc-tier-decision';

/**
 * ARENA 4 (customer app) — customer-safe KYC projection.
 *
 * Read-only. It answers, for the authenticated customer only:
 *   - what tier MonieNaija's own customer record currently says (`customers.kyc_level/kyc_status`),
 *   - which assessment backs that tier (if any),
 *   - what the *approved* tier policy currently requires for the next tier,
 *   - and whether the platform can actually assess the customer's evidence yet.
 *
 * Two honesty rules are encoded here rather than in the mobile client:
 *   1. No regulatory threshold is duplicated: the requirements are read from the newest approved
 *      policy version whose effective window covers now, exactly as the tier decision does.
 *   2. `KycTierEvidenceReader` currently has no confirmed provider adapter, so the platform cannot
 *      assess trusted evidence. It returns `null`, which is *not* an empty evidence set. This
 *      projection therefore reports `EVIDENCE_UNAVAILABLE` and never claims that a specific
 *      requirement is unmet. The mobile app consequently cannot compute eligibility or imply a
 *      rejection.
 */
export interface CustomerKycRequirementView {
  level: 'LEVEL_1' | 'LEVEL_2';
  regulatory: TierRequirements;
  operator: TierRequirements;
}

export interface CustomerKycView {
  customerId: string;
  kycLevel: string;
  kycStatus: string;
  assessment: {
    level: string;
    status: string;
    reason: string | null;
    expiresAt: string | null;
  } | null;
  policy: { configured: boolean; version: number | null };
  requirements: CustomerKycRequirementView | null;
  evidenceAssessment: {
    status: 'UNAVAILABLE';
    reason: 'TRUSTED_EVIDENCE_UNAVAILABLE';
    note: string;
  };
  lastEvaluation: {
    outcome: string;
    reason: string;
    newLevel: string | null;
    policyVersion: number | null;
    decidedAt: string;
  } | null;
  manualHold: { reason: string; since: string } | null;
  upgradePathway: {
    status: 'TOP_TIER' | 'POLICY_NOT_CONFIGURED' | 'MANUAL_REVIEW' | 'EVIDENCE_UNAVAILABLE';
    nextLevel: 'LEVEL_1' | 'LEVEL_2' | null;
  };
  asOf: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_UNAVAILABLE_NOTE =
  'MonieNaija cannot yet assess verified identity evidence for tier upgrades. Your current tier is unchanged, and this summary does not judge any requirement satisfied or otherwise.';

function nextLevelFor(level: string): 'LEVEL_1' | 'LEVEL_2' | null {
  switch (level.toUpperCase()) {
    case 'NONE':
      return 'LEVEL_1';
    case 'LEVEL_1':
      return 'LEVEL_2';
    // LEVEL_2 is the highest tier in the managed tier model and LEVEL_3 is outside it, so neither
    // has a managed upgrade path to offer here.
    default:
      return null;
  }
}

function effectivePolicy(
  versions: Array<{ version: number; definition: TierPolicyDefinition }>,
  now: Date,
): { version: number; definition: TierPolicyDefinition } | null {
  for (const entry of versions) {
    const { definition } = entry;
    const from = new Date(definition.effectiveFrom).getTime();
    const until = definition.effectiveUntil ? new Date(definition.effectiveUntil).getTime() : null;
    if (from <= now.getTime() && (until === null || until > now.getTime())) return entry;
  }
  return null;
}

@Injectable()
export class CustomerKycViewService {
  constructor(private readonly db: DataSource) {}

  async view(customerId: string, now: Date = new Date()): Promise<CustomerKycView> {
    if (!UUID.test(customerId)) throw new NotFoundException('Customer not found');
    const customers: Array<{ id: string; kyc_level: string; kyc_status: string }> =
      await this.db.query(
        'SELECT id,kyc_level,kyc_status FROM customers WHERE id=$1 AND deleted_at IS NULL',
        [customerId],
      );
    const customer = customers[0];
    if (!customer) throw new NotFoundException('Customer not found');

    const assessments: Array<{
      kyc_level: string;
      kyc_status: string;
      reason: string | null;
      expires_at: Date | null;
    }> = await this.db.query(
      'SELECT kyc_level,kyc_status,reason,expires_at FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=true ORDER BY updated_at DESC LIMIT 1',
      [customerId],
    );

    const heads: Array<{ version: number }> = await this.db.query(
      'SELECT version FROM kyc_tier_policy_head WHERE singleton=true',
    );
    const headVersion = Number(heads[0]?.version ?? 0);
    const policyRows: Array<{ version: number; definition: unknown }> = await this.db.query(
      'SELECT version,definition FROM kyc_tier_policy_versions ORDER BY version DESC LIMIT 24',
    );
    const definitions: Array<{ version: number; definition: TierPolicyDefinition }> = [];
    for (const row of policyRows) {
      try {
        definitions.push({
          version: row.version,
          definition: validateTierPolicyDefinition(row.definition),
        });
      } catch {
        // A stored definition that no longer validates is not an applicable policy; it is skipped
        // rather than being approximated into requirements the platform cannot stand behind.
      }
    }

    const nextLevel = nextLevelFor(customer.kyc_level);
    const effective = effectivePolicy(definitions, now);

    const evaluations: Array<{
      outcome: string;
      reason: string;
      new_level: string | null;
      policy_version: number | null;
      created_at: Date;
    }> = await this.db.query(
      'SELECT outcome,reason,new_level,policy_version,created_at FROM kyc_tier_evaluations WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1',
      [customerId],
    );

    const holds: Array<{ reason: string; created_at: Date }> = await this.db.query(
      'SELECT reason,created_at FROM kyc_tier_manual_holds WHERE customer_id=$1',
      [customerId],
    );

    const policyConfigured = headVersion > 0 && definitions.length > 0;
    const requirements: CustomerKycRequirementView | null =
      effective && nextLevel
        ? {
            level: nextLevel,
            regulatory: effective.definition.regulatory[nextLevel],
            operator: effective.definition.operator[nextLevel],
          }
        : null;

    const upgradePathway: CustomerKycView['upgradePathway'] = !nextLevel
      ? { status: 'TOP_TIER', nextLevel: null }
      : holds[0]
        ? { status: 'MANUAL_REVIEW', nextLevel }
        : !policyConfigured || !requirements
          ? { status: 'POLICY_NOT_CONFIGURED', nextLevel }
          : { status: 'EVIDENCE_UNAVAILABLE', nextLevel };

    return {
      customerId: customer.id,
      kycLevel: customer.kyc_level,
      kycStatus: customer.kyc_status,
      assessment: assessments[0]
        ? {
            level: assessments[0].kyc_level,
            status: assessments[0].kyc_status,
            reason: assessments[0].reason,
            expiresAt: assessments[0].expires_at?.toISOString() ?? null,
          }
        : null,
      policy: {
        configured: policyConfigured,
        version: policyConfigured ? (effective?.version ?? null) : headVersion || null,
      },
      requirements,
      evidenceAssessment: {
        status: 'UNAVAILABLE',
        reason: 'TRUSTED_EVIDENCE_UNAVAILABLE',
        note: EVIDENCE_UNAVAILABLE_NOTE,
      },
      lastEvaluation: evaluations[0]
        ? {
            outcome: evaluations[0].outcome,
            reason: evaluations[0].reason,
            newLevel: evaluations[0].new_level,
            policyVersion: evaluations[0].policy_version,
            decidedAt: evaluations[0].created_at.toISOString(),
          }
        : null,
      manualHold: holds[0]
        ? { reason: holds[0].reason, since: holds[0].created_at.toISOString() }
        : null,
      upgradePathway,
      asOf: now.toISOString(),
    };
  }
}
