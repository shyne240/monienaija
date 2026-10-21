import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { rewardGranted, rewardNone } from '../commercial-decision/commercial-decision.defaults';
import type {
  RewardDecisionSnapshot,
  RewardGrantSnapshot,
} from '../commercial-decision/commercial-decision-snapshot.entity';

import type { RewardBaseEvidence } from './reward.calculator';
import { RewardRuleResolverService, type RewardResolveContext } from './reward-rule-resolver.service';

/**
 * V1-REWARD-01 — Reward Engine facade.
 *
 * Produces a reward DECISION REPRESENTATION in the exact shape the existing Commercial
 * Decision Snapshot already supports (`rewardDecision.grants` + `ruleRefs`). It does
 * NOT credit, post, fund or settle anything, and it is NOT called by any financial
 * flow today — every V1 flow still records reward status NONE via `rewardNone()`,
 * exactly as before. When nothing is configured this engine returns the identical
 * NONE shape, so wiring it in later cannot change behavior by accident.
 *
 * Boundary discipline:
 *  - decide/decideWithManager are read-only + pure-calculation; the only transactional
 *    promise they make is "evaluate within the caller's manager" (needed later for the
 *    existing SERIALIZABLE boundaries — the intended ATOMIC relationship so a reward
 *    can never be decided for a transaction that ultimately rolls back).
 *  - NOT_CONFIGURED ≠ ZERO; ZERO is an explicit calculated amount from a configured rule.
 *  - Any ambiguity/incoherence fails closed (Conflict/BadRequest) BEFORE any money moves
 *    in a future integration; the engine never silently picks a rule.
 *  - Reward never depends on commission outcomes: the only shared inputs are the flow's
 *    own base evidence (principal/fee). Fee-as-base is a supported mechanic, not policy.
 */
@Injectable()
export class RewardEngine {
  constructor(
    private readonly dataSource: DataSource,
    private readonly resolver: RewardRuleResolverService,
  ) {}

  /** Evaluate within an existing transaction manager (future SERIALIZABLE-boundary use). */
  async decideWithManager(
    manager: EntityManager,
    context: RewardResolveContext,
    baseEvidence: RewardBaseEvidence,
  ): Promise<RewardDecisionSnapshot> {
    const resolution = await this.resolver.resolveWithManager(manager, context, baseEvidence);
    if (resolution.status === 'NOT_CONFIGURED') return rewardNone();
    const grants: RewardGrantSnapshot[] = resolution.grants.map((g) => ({
      beneficiaryType: g.beneficiaryType,
      beneficiaryId: g.beneficiaryId,
      rewardType: g.rewardType,
      amountMinor: g.amountMinor,
      currency: g.currency,
      basis: g.basis,
      ruleId: g.ruleId,
      ruleVersion: g.ruleVersion,
      // Extended explainability fields (JSONB-open snapshot keys, documented):
      calculationModel: g.calculationModel,
      calculationParameters: g.appliedParameters,
      baseAmountMinor: g.baseAmountMinor,
      campaignCode: g.campaignCode,
      priority: g.priority,
      effectiveFrom: g.effectiveFrom.toISOString(),
      targeting: g.targeting,
    }));
    return rewardGranted(grants, resolution.ruleRefs);
  }

  /** Non-transactional evaluation (workforce diagnostics/tests). Identical mechanics. */
  async decide(context: RewardResolveContext, baseEvidence: RewardBaseEvidence): Promise<RewardDecisionSnapshot> {
    return this.decideWithManager(this.dataSource.manager, context, baseEvidence);
  }
}
