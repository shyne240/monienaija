import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  COMMISSION_RECIPIENT_TYPES,
  type CommissionCalculationModel,
  type CommissionRecipientType,
  type CommissionRuleDefinition,
} from './commission-rule.entity';
import { CommissionCalculator, type CommissionBaseEvidence } from './commission.calculator';

/**
 * V1-COMMISSION-01 — Commission Rule RESOLUTION foundation (read-only against flows).
 *
 * Answers ONE question: given (productCode, currency, context, at) — which commission
 * rule row is applicable PER RECIPIENT right then, from the authoritative
 * commission_rules registry, and what amount do its mechanics produce from the given
 * base evidence?
 *
 * HARD BOUNDARIES:
 *  - READ-ONLY resolution + pure calculation. Never writes rows, never posts journals,
 *    never mutates wallets/ledger/limits/transfers/snapshots.
 *  - NOT wired into any financial flow in this task. The engine exists so a later,
 *    explicitly-approved integration can call resolveWithManager inside an existing
 *    SERIALIZABLE boundary and capture the result in the Commercial Decision Snapshot.
 *  - Zero production commission rules exist; NOT_CONFIGURED (snapshot vocabulary: NONE)
 *    is the normal answer today. NOT_CONFIGURED ≠ ZERO.
 *
 * Matching conditions (ALL required):
 *  - product_code exact match (authoritative catalogue identity; no second product system)
 *  - currency exact match (no conversion — V1 is NGN-only)
 *  - is_active = true AND deleted_at IS NULL
 *  - effective_from <= at AND (effective_to IS NULL OR at < effective_to)
 *  - targeting: rule matches the context iff EVERY targeting column is either NULL or
 *    exactly equals the provided context value (agent_class_id/agent_id/aggregator_id;
 *    at most one column is non-null per rule — DB CHECK).
 *
 * Precedence (deterministic, NON-policy):
 *  - Resolution is PER RECIPIENT TYPE (AGENT/AGGREGATOR/PLATFORM independent groups) —
 *    one rule pays one recipient; multi-recipient allocation = one winning rule per
 *    recipient group. No split is hardcoded.
 *  - Among applicable rules in one recipient group the HIGHEST priority wins (mirrors
 *    FeeRuleResolverService / LimitProfileResolverService precedence conventions).
 *  - AMBIGUITY: two or more applicable rules sharing the highest priority in a group ⇒
 *    NO approved tie-break policy exists, so resolution FAILS CLOSED with
 *    COMMISSION_RULE_AMBIGUOUS listing the conflicting rule ids (never a silent choice).
 *  - Scope hierarchy (agent-specific vs agent-class vs untargeted) is deliberately NOT
 *    hardcoded: overlapping scopes must be disambiguated by explicit priority until a
 *    business precedence policy is decided (documented as unresolved).
 *
 * Base evidence:
 *  - PRINCIPAL: always available from the flow amount.
 *  - FEE / NET: require explicit fee evidence. If a resolved FEE/NET-based rule has no
 *    fee evidence available, resolution FAILS CLOSED with COMMISSION_BASE_UNAVAILABLE —
 *    a configured rule that cannot be honestly computed is never silently skipped.
 *
 * Version semantics: each decision carries the exact rule row (id + version + window +
 * parameters) captured in the same query — enough for the Commercial Decision
 * Snapshot's commission allocations (beneficiaryType/beneficiaryId/amountMinor/
 * currency/basis/ruleId/ruleVersion) without a second "current state" lookup.
 */

export interface CommissionResolveContext {
  productCode: string;
  currency: string;
  /** Evaluation timestamp (defaults to now); historical resolution is first-class. */
  at?: Date;
  /** Targeting context — provide the identities the flow knows; null = not applicable. */
  agentId?: string | null;
  agentClassId?: string | null;
  aggregatorId?: string | null;
}

export interface CommissionResolvedAllocation {
  recipientType: CommissionRecipientType;
  /** Recipient identity when the rule targets one identity; otherwise null (resolved by the future flow wiring from its principal/participants). */
  recipientId: string | null;
  amountMinor: string;
  currency: string;
  basis: string;
  baseAmountMinor: string;
  calculationModel: CommissionCalculationModel;
  appliedParameters: Record<string, unknown>;
  ruleId: string;
  ruleVersion: number;
  priority: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  targeting: {
    agentClassId: string | null;
    agentId: string | null;
    aggregatorId: string | null;
  };
}

export type CommissionResolutionStatus = 'NOT_CONFIGURED' | 'ALLOCATED';

export interface CommissionResolution {
  status: CommissionResolutionStatus;
  productCode: string;
  currency: string;
  evaluatedAt: Date;
  allocations: CommissionResolvedAllocation[];
  /** One entry per winning rule (same rows as allocations). */
  ruleRefs: Array<{ ruleId: string; ruleVersion: number; ruleType: 'COMMISSION' }>;
}

@Injectable()
export class CommissionRuleResolverService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calculator: CommissionCalculator,
  ) {}

  async resolveWithManager(
    manager: EntityManager,
    context: CommissionResolveContext,
    baseEvidence: CommissionBaseEvidence,
  ): Promise<CommissionResolution> {
    const productCode = this.normalizeProductCode(context.productCode);
    const currency = this.normalizeCurrency(context.currency);
    const at = context.at ?? new Date();

    // driver returns untyped rows; the typed binding below re-types them for safe member access
    const candidates: Array<Record<string, unknown>> = await manager.query(
      `SELECT id, product_code, currency, recipient_type, calculation_model, calculation_basis,
              flat_commission_minor::text AS flat_commission_minor, percentage_bps,
              minimum_commission_minor::text AS minimum_commission_minor,
              maximum_commission_minor::text AS maximum_commission_minor,
              tiers, agent_class_id, agent_id, aggregator_id,
              effective_from, effective_to, priority, version
         FROM commission_rules
        WHERE product_code = $1
          AND currency = $2
          AND is_active = true
          AND deleted_at IS NULL
          AND effective_from <= $3
          AND (effective_to IS NULL OR $3 < effective_to)
          AND (agent_class_id IS NULL OR agent_class_id = $4)
          AND (agent_id IS NULL OR agent_id = $5)
          AND (aggregator_id IS NULL OR aggregator_id = $6)
        ORDER BY recipient_type, priority DESC, id ASC`,
      [
        productCode,
        currency,
        at.toISOString(),
        context.agentClassId ?? null,
        context.agentId ?? null,
        context.aggregatorId ?? null,
      ],
    );

    const allocations: CommissionResolvedAllocation[] = [];
    const ruleRefs: CommissionResolution['ruleRefs'] = [];

    for (const recipientType of COMMISSION_RECIPIENT_TYPES) {
      const group = candidates.filter((row) => row['recipient_type'] === recipientType);
      if (group.length === 0) continue;
      const top = Number(group[0]!['priority']);
      const winners = group.filter((row) => Number(row['priority']) === top);
      if (winners.length > 1) {
        throw new ConflictException(
          `COMMISSION_RULE_AMBIGUOUS: ${winners.length} applicable ${recipientType} rules share priority ${top} for ${productCode}/${currency} — no approved tie-break policy (rule ids: ${winners
            .map((row) => String(row['id']))
            .sort()
            .join(', ')})`,
        );
      }
      const rule = this.toRule(winners[0]!);
      const base = this.calculator.resolveBase(rule, baseEvidence);
      const calculated = this.calculator.calculate(rule, base, base.toString());
      allocations.push({
        recipientType,
        recipientId: rule.agentId ?? rule.aggregatorId,
        amountMinor: calculated.amountMinor,
        currency,
        basis: calculated.basis,
        baseAmountMinor: calculated.baseAmountMinor,
        calculationModel: calculated.calculationModel,
        appliedParameters: calculated.appliedParameters,
        ruleId: rule.id,
        ruleVersion: rule.version,
        priority: rule.priority,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        targeting: {
          agentClassId: rule.agentClassId,
          agentId: rule.agentId,
          aggregatorId: rule.aggregatorId,
        },
      });
      ruleRefs.push({ ruleId: rule.id, ruleVersion: rule.version, ruleType: 'COMMISSION' });
    }

    if (allocations.length === 0) {
      return { status: 'NOT_CONFIGURED', productCode, currency, evaluatedAt: at, allocations: [], ruleRefs: [] };
    }

    // No cross-recipient sum constraint is imposed: rules may carry different bases
    // and no allocation ceiling has been decided (documented unresolved policy).
    return { status: 'ALLOCATED', productCode, currency, evaluatedAt: at, allocations, ruleRefs };
  }

  /** Convenience wrapper for non-transactional diagnostics (workforce read-only). */
  async resolve(context: CommissionResolveContext, baseEvidence: CommissionBaseEvidence): Promise<CommissionResolution> {
    return this.resolveWithManager(this.dataSource.manager, context, baseEvidence);
  }

  private toRule(row: Record<string, unknown>): CommissionRuleDefinition {
    return {
      id: String(row['id']),
      productCode: String(row['product_code']),
      currency: String(row['currency']),
      recipientType: row['recipient_type'] as CommissionRecipientType,
      calculationModel: row['calculation_model'] as CommissionCalculationModel,
      calculationBasis: row['calculation_basis'] as CommissionRuleDefinition['calculationBasis'],
      flatCommissionMinor: (row['flat_commission_minor'] as string | null) ?? null,
      percentageBps: (row['percentage_bps'] as number | null) ?? null,
      minimumCommissionMinor: (row['minimum_commission_minor'] as string | null) ?? null,
      maximumCommissionMinor: (row['maximum_commission_minor'] as string | null) ?? null,
      tiers: (row['tiers'] as CommissionRuleDefinition['tiers']) ?? null,
      agentClassId: (row['agent_class_id'] as string | null) ?? null,
      agentId: (row['agent_id'] as string | null) ?? null,
      aggregatorId: (row['aggregator_id'] as string | null) ?? null,
      effectiveFrom: new Date(row['effective_from'] as string),
      effectiveTo: row['effective_to'] === null || row['effective_to'] === undefined ? null : new Date(row['effective_to'] as string),
      priority: Number(row['priority']),
      isActive: true,
      createdBy: '',
      updatedBy: null,
      version: Number(row['version']),
      createdAt: new Date(0),
      updatedAt: new Date(0),
      deletedAt: null,
    } as CommissionRuleDefinition;
  }

  private normalizeProductCode(code: string): string {
    if (typeof code !== 'string' || !/^[A-Z0-9_]{3,80}$/.test(code.trim().toUpperCase())) {
      throw new BadRequestException('productCode must match ^[A-Z0-9_]{3,80}$');
    }
    return code.trim().toUpperCase();
  }

  private normalizeCurrency(currency: string): string {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      throw new BadRequestException('currency must be a 3-letter uppercase ISO code');
    }
    return currency.trim().toUpperCase();
  }
}
