import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  REWARD_BENEFICIARY_TYPES,
  REWARD_CUSTOMER_KYC_LEVELS,
  type RewardCalculationModel,
  type RewardGrantType,
  type RewardBeneficiaryType,
  type RewardCustomerKycLevel,
  type RewardRuleDefinition,
} from './reward-rule.entity';
import { RewardCalculator, type RewardBaseEvidence } from './reward.calculator';
import type { RewardGrantDecision, RewardResolution } from './reward.types';

/**
 * V1-REWARD-01 — Reward Rule RESOLUTION foundation (read-only against flows).
 *
 * Answers ONE question: given (productCode, currency, context, at) — which reward
 * rule row is applicable PER BENEFICIARY TYPE right then, from the authoritative
 * reward_rules registry, and what amount do its mechanics produce from the given
 * base evidence?
 *
 * HARD BOUNDARIES:
 *  - READ-ONLY resolution + pure calculation. Never writes rows, never credits wallets,
 *    never posts journals, never mutates wallets/ledger/limits/transfers/snapshots.
 *  - NOT wired into any financial flow in this task. The engine exists so a later,
 *    explicitly-approved integration can call resolveWithManager inside an existing
 *    SERIALIZABLE boundary and capture the result in the Commercial Decision Snapshot
 *    (whose rewardDecision.grants shape it already matches).
 *  - Zero production reward rules exist; NOT_CONFIGURED (snapshot vocabulary: NONE)
 *    is the normal answer today. NOT_CONFIGURED ≠ ZERO.
 *
 * Matching conditions (ALL required):
 *  - product_code exact match (authoritative catalogue identity; no second product system)
 *  - currency exact match (no conversion — V1 is NGN-only)
 *  - is_active = true AND deleted_at IS NULL
 *  - effective_from <= at AND (effective_to IS NULL OR at < effective_to)
 *  - targeting: rule matches the context iff EVERY targeting column is either NULL or
 *    exactly equals the provided context value (customer_id / customer_kyc_level /
 *    agent_class_id / agent_id / campaign_code; at most one column is non-null per
 *    rule — DB CHECK).
 *
 * Precedence (deterministic, NON-policy):
 *  - Resolution is PER BENEFICIARY TYPE (CUSTOMER/AGENT independent groups) — one rule
 *    grants one beneficiary group; multi-beneficiary outcomes = one winning rule per
 *    group. No split is hardcoded anywhere.
 *  - Among applicable rules in one beneficiary group the HIGHEST priority wins (mirrors
 *    FeeRuleResolverService / LimitProfileResolverService / CommissionRuleResolverService
 *    precedence conventions).
 *  - AMBIGUITY: two or more applicable rules sharing the highest priority in a group ⇒
 *    NO approved tie-break policy exists, so resolution FAILS CLOSED with
 *    REWARD_RULE_AMBIGUOUS listing the conflicting rule ids (never a silent choice).
 *  - Scope hierarchy (customer-specific vs KYC-level vs campaign vs untargeted) is
 *    deliberately NOT hardcoded: overlapping scopes must be disambiguated by explicit
 *    priority until a business precedence policy is decided (documented as unresolved).
 *
 * Base evidence:
 *  - PRINCIPAL: always available from the flow amount.
 *  - FEE / NET: require explicit fee evidence. If a resolved FEE/NET-based rule has no
 *    fee evidence available, resolution FAILS CLOSED with REWARD_BASE_UNAVAILABLE —
 *    a configured rule that cannot be honestly computed is never silently skipped.
 *
 * Version semantics: each decision carries the exact rule row (id + version + window +
 * parameters + campaign identity) captured in the same query — enough for the
 * Commercial Decision Snapshot's reward grants (beneficiaryType/beneficiaryId/
 * rewardType/amountMinor/currency/basis/ruleId/ruleVersion) without a second
 * "current state" lookup. Historical transactions stay explainable via `at`.
 */
export interface RewardResolveContext {
  productCode: string;
  currency: string;
  /** Evaluation timestamp (defaults to now); historical resolution is first-class. */
  at?: Date;
  /** Targeting context — provide the identities the flow knows; null = not applicable. */
  customerId?: string | null;
  customerKycLevel?: RewardCustomerKycLevel | null;
  agentClassId?: string | null;
  agentId?: string | null;
  campaignCode?: string | null;
}

@Injectable()
export class RewardRuleResolverService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calculator: RewardCalculator,
  ) {}

  async resolveWithManager(
    manager: EntityManager,
    context: RewardResolveContext,
    baseEvidence: RewardBaseEvidence,
  ): Promise<RewardResolution> {
    const productCode = this.normalizeProductCode(context.productCode);
    const currency = this.normalizeCurrency(context.currency);
    const customerKycLevel = this.normalizeKycLevel(context.customerKycLevel ?? null);
    const campaignCode = this.normalizeCampaignCode(context.campaignCode ?? null);
    const at = context.at ?? new Date();

    // driver returns untyped rows; the typed binding below re-types them for safe member access
    const candidates: Array<Record<string, unknown>> = await manager.query(
      `SELECT id, product_code, currency, beneficiary_type, reward_type, calculation_model, calculation_basis,
              flat_reward_minor::text AS flat_reward_minor, percentage_bps,
              minimum_reward_minor::text AS minimum_reward_minor,
              maximum_reward_minor::text AS maximum_reward_minor,
              tiers, customer_id, customer_kyc_level, agent_class_id, agent_id, campaign_code,
              effective_from, effective_to, priority, version
         FROM reward_rules
        WHERE product_code = $1
          AND currency = $2
          AND is_active = true
          AND deleted_at IS NULL
          AND effective_from <= $3
          AND (effective_to IS NULL OR $3 < effective_to)
          AND (customer_id IS NULL OR customer_id = $4)
          AND (customer_kyc_level IS NULL OR customer_kyc_level = $5)
          AND (agent_class_id IS NULL OR agent_class_id = $6)
          AND (agent_id IS NULL OR agent_id = $7)
          AND (campaign_code IS NULL OR campaign_code = $8)
        ORDER BY beneficiary_type, priority DESC, id ASC`,
      [
        productCode,
        currency,
        at.toISOString(),
        context.customerId ?? null,
        customerKycLevel,
        context.agentClassId ?? null,
        context.agentId ?? null,
        campaignCode,
      ],
    );

    const grants: RewardGrantDecision[] = [];
    const ruleRefs: RewardResolution['ruleRefs'] = [];

    for (const beneficiaryType of REWARD_BENEFICIARY_TYPES) {
      const group = candidates.filter((row) => row['beneficiary_type'] === beneficiaryType);
      if (group.length === 0) continue;
      const top = Number(group[0]!['priority']);
      const winners = group.filter((row) => Number(row['priority']) === top);
      if (winners.length > 1) {
        throw new ConflictException(
          `REWARD_RULE_AMBIGUOUS: ${winners.length} applicable ${beneficiaryType} rules share priority ${top} for ${productCode}/${currency} — no approved tie-break policy (rule ids: ${winners
            .map((row) => String(row['id']))
            .sort()
            .join(', ')})`,
        );
      }
      const rule = this.toRule(winners[0]!);
      const base = this.calculator.resolveBase(rule, baseEvidence);
      const calculated = this.calculator.calculate(rule, base, base.toString());
      grants.push({
        beneficiaryType,
        beneficiaryId: rule.customerId ?? rule.agentId,
        rewardType: rule.rewardType,
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
        campaignCode: rule.campaignCode,
        targeting: {
          customerId: rule.customerId,
          customerKycLevel: rule.customerKycLevel,
          agentClassId: rule.agentClassId,
          agentId: rule.agentId,
          campaignCode: rule.campaignCode,
        },
      });
      ruleRefs.push({ ruleId: rule.id, ruleVersion: rule.version, ruleType: 'REWARD' });
    }

    if (grants.length === 0) {
      return { status: 'NOT_CONFIGURED', productCode, currency, evaluatedAt: at, grants: [], ruleRefs: [] };
    }

    // No cross-beneficiary sum constraint is imposed: rules may carry different bases
    // and no reward funding/cap ceiling has been decided (documented unresolved policy).
    return { status: 'GRANTED', productCode, currency, evaluatedAt: at, grants, ruleRefs };
  }

  /** Convenience wrapper for non-transactional diagnostics (workforce read-only). */
  async resolve(context: RewardResolveContext, baseEvidence: RewardBaseEvidence): Promise<RewardResolution> {
    return this.resolveWithManager(this.dataSource.manager, context, baseEvidence);
  }

  private toRule(row: Record<string, unknown>): RewardRuleDefinition {
    return {
      id: String(row['id']),
      productCode: String(row['product_code']),
      currency: String(row['currency']),
      beneficiaryType: row['beneficiary_type'] as RewardBeneficiaryType,
      rewardType: row['reward_type'] as RewardGrantType,
      calculationModel: row['calculation_model'] as RewardCalculationModel,
      calculationBasis: row['calculation_basis'] as RewardRuleDefinition['calculationBasis'],
      flatRewardMinor: (row['flat_reward_minor'] as string | null) ?? null,
      percentageBps: (row['percentage_bps'] as number | null) ?? null,
      minimumRewardMinor: (row['minimum_reward_minor'] as string | null) ?? null,
      maximumRewardMinor: (row['maximum_reward_minor'] as string | null) ?? null,
      tiers: (row['tiers'] as RewardRuleDefinition['tiers']) ?? null,
      customerId: (row['customer_id'] as string | null) ?? null,
      customerKycLevel: (row['customer_kyc_level'] as RewardCustomerKycLevel | null) ?? null,
      agentClassId: (row['agent_class_id'] as string | null) ?? null,
      agentId: (row['agent_id'] as string | null) ?? null,
      campaignCode: (row['campaign_code'] as string | null) ?? null,
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
    } as RewardRuleDefinition;
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

  private normalizeKycLevel(level: RewardCustomerKycLevel | null): RewardCustomerKycLevel | null {
    if (level === null || level === undefined) return null;
    if (!REWARD_CUSTOMER_KYC_LEVELS.includes(level)) {
      throw new BadRequestException(`customerKycLevel must be one of: ${REWARD_CUSTOMER_KYC_LEVELS.join(', ')}`);
    }
    return level;
  }

  private normalizeCampaignCode(code: string | null): string | null {
    if (code === null || code === undefined) return null;
    const trimmed = code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(trimmed)) {
      throw new BadRequestException('campaignCode must match ^[A-Z0-9][A-Z0-9_\\-]{0,79}$ (configuration-only promotion identity)');
    }
    return trimmed;
  }
}
