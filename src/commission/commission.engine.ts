import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { commissionAllocated, commissionNone } from '../commercial-decision/commercial-decision.defaults';
import type {
  CommissionAllocationSnapshot,
  CommissionDecisionSnapshot,
} from '../commercial-decision/commercial-decision-snapshot.entity';

import type { CommissionBaseEvidence } from './commission.calculator';
import { CommissionRuleResolverService, type CommissionResolveContext } from './commission-rule-resolver.service';

/**
 * V1-COMMISSION-01 — Commission Engine facade.
 *
 * Produces a commission DECISION REPRESENTATION in the exact shape the existing
 * Commercial Decision Snapshot already supports (`commissionDecision.allocations` +
 * `ruleRefs`). It does NOT charge, post, split or settle anything, and it is NOT called
 * by any financial flow today — every V1 flow still records commission status NONE via
 * `commissionNone()`, exactly as before. When nothing is configured this engine returns
 * the identical NONE shape, so wiring it in later cannot change behavior by accident.
 *
 * Boundary discipline:
 *  - decide/decideWithManager are read-only + pure-calculation; the only transactional
 *    promise they make is "evaluate within the caller's manager" (needed later for the
 *    existing SERIALIZABLE boundaries).
 *  - NOT_CONFIGURED ≠ ZERO; ZERO is an explicit calculated amount from a configured rule.
 *  - Any ambiguity/incoherence fails closed (Conflict/BadRequest) BEFORE any money moves
 *    in a future integration; the engine never silently picks a rule.
 */
@Injectable()
export class CommissionEngine {
  constructor(
    private readonly dataSource: DataSource,
    private readonly resolver: CommissionRuleResolverService,
  ) {}

  /** Evaluate within an existing transaction manager (future SERIALIZABLE-boundary use). */
  async decideWithManager(
    manager: EntityManager,
    context: CommissionResolveContext,
    baseEvidence: CommissionBaseEvidence,
  ): Promise<CommissionDecisionSnapshot> {
    const resolution = await this.resolver.resolveWithManager(manager, context, baseEvidence);
    if (resolution.status === 'NOT_CONFIGURED') return commissionNone();
    const allocations: CommissionAllocationSnapshot[] = resolution.allocations.map((a) => ({
      beneficiaryType: a.recipientType,
      beneficiaryId: a.recipientId,
      amountMinor: a.amountMinor,
      currency: a.currency,
      basis: a.basis,
      ruleId: a.ruleId,
      ruleVersion: a.ruleVersion,
      // Extended explainability fields (JSONB-open snapshot keys, documented):
      calculationModel: a.calculationModel,
      calculationParameters: a.appliedParameters,
      baseAmountMinor: a.baseAmountMinor,
      priority: a.priority,
      effectiveFrom: a.effectiveFrom.toISOString(),
      targeting: a.targeting,
    }));
    return commissionAllocated(allocations, resolution.ruleRefs);
  }

  /** Non-transactional evaluation (workforce diagnostics/tests). Identical mechanics. */
  async decide(context: CommissionResolveContext, baseEvidence: CommissionBaseEvidence): Promise<CommissionDecisionSnapshot> {
    return this.decideWithManager(this.dataSource.manager, context, baseEvidence);
  }
}
