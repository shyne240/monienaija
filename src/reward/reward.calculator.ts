import { BadRequestException } from '@nestjs/common';

import {
  MAX_POSTGRES_BIGINT,
  parseMinorUnits,
} from '../common/money';

import type {
  RewardCalculationBasis,
  RewardCalculationModel,
  RewardRuleDefinition,
  RewardTier,
} from './reward-rule.entity';

const BASIS_POINTS = 10_000n;

/** Bases the resolver can feed the calculator from explicit evidence. */
export interface RewardBaseEvidence {
  /** Transaction principal (minor). Always available to any flow that passes an amount. */
  principalMinor: string;
  /**
   * Fee amount (minor) for this transaction — only available when fee evidence exists
   * (today: no V1 flow produces configured fees, so FEE/NET bases only resolve when the
   * caller hands explicit fee evidence, e.g. TEST-ONLY synthetic fee rules).
   */
  feeMinor?: string | null;
}

export interface RewardCalculatedAmount {
  amountMinor: string;
  baseAmountMinor: string;
  basis: RewardCalculationBasis;
  /** Human/explainable parameter echo used for the applied calculation. */
  calculationModel: RewardCalculationModel;
  appliedParameters: Record<string, unknown>;
}

/**
 * V1-REWARD-01 — deterministic reward MECHANICS (no policy).
 *
 * Semantics per calculation_model (mechanics only, deliberately documented here and in
 * docs/V1-REWARD-01-REWARD-ENGINE-ARCHITECTURE.md so nothing is implicit):
 *  - FIXED                → flat_reward_minor
 *  - PERCENTAGE           → (base * bps) / 10000  [integer-divided, floor]
 *  - PERCENTAGE_MIN       → max(raw, minimum)
 *  - PERCENTAGE_MAX       → min(raw, maximum) — also the ONLY per-transaction reward
 *                           cap mechanism this foundation supports
 *  - PERCENTAGE_MIN_MAX   → min(max(raw, minimum), maximum) — minimum applied first
 *    (same clamp order and floor-division as FeeEngine/CommissionCalculator)
 *  - FLAT_PLUS_PERCENTAGE → flat + (base * bps) / 10000
 *  - TIERED               → marginal brackets: for each bracket [lo, upToMinor), the slice
 *    of base inside the bracket accrues bps% (floor per bracket), plus the bracket's
 *    flatMinor ONCE if the base reaches the bracket at all. Brackets must ascend
 *    contiguously from 0; the last bracket may be open-ended (upToMinor = null).
 *
 * Bases:
 *  - PRINCIPAL → evidence.principalMinor
 *  - FEE       → evidence.feeMinor (UNAVAILABLE → explicit error; never fabricated)
 *  - NET       → principalMinor − feeMinor (requires fee evidence; mechanics only)
 *
 * The calculator never consults policy, never invents an amount, and never throws on
 * zero — zero is a legitimate computed amount.
 */
export class RewardCalculator {
  /** Resolve the base amount for a rule from explicit evidence. Throws when unavailable. */
  resolveBase(rule: RewardRuleDefinition, evidence: RewardBaseEvidence): bigint {
    const principalMinor = parseMinorUnits(evidence.principalMinor, 'principalMinor');
    switch (rule.calculationBasis) {
      case 'PRINCIPAL':
        return principalMinor;
      case 'FEE': {
        if (evidence.feeMinor === null || evidence.feeMinor === undefined) {
          throw new BadRequestException(
            'REWARD_BASE_UNAVAILABLE: rule is FEE-based but no fee evidence was provided (fees are NOT_CONFIGURED today)',
          );
        }
        return parseMinorUnits(evidence.feeMinor, 'feeMinor');
      }
      case 'NET': {
        if (evidence.feeMinor === null || evidence.feeMinor === undefined) {
          throw new BadRequestException(
            'REWARD_BASE_UNAVAILABLE: rule is NET-based but no fee evidence was provided (fees are NOT_CONFIGURED today)',
          );
        }
        const fee = parseMinorUnits(evidence.feeMinor, 'feeMinor');
        if (fee > principalMinor) {
          throw new BadRequestException('REWARD_BASE_INVALID: NET base would be negative (fee exceeds principal)');
        }
        return principalMinor - fee;
      }
      default:
        throw new BadRequestException(`Unsupported calculation basis: ${String(rule.calculationBasis)}`);
    }
  }

  /** Apply the rule's calculation model to an already-resolved base. */
  calculate(rule: RewardRuleDefinition, base: bigint, baseAmountMinor: string): RewardCalculatedAmount {
    const bps = (value: number | null | undefined): bigint =>
      value === null || value === undefined ? 0n : parseMinorUnits(value, 'percentageBps');
    const pct = (b: bigint, p: bigint): bigint => (b * p) / BASIS_POINTS;

    let amount: bigint;
    const appliedParameters: Record<string, unknown> = {};
    switch (rule.calculationModel) {
      case 'FIXED': {
        amount = parseMinorUnits(rule.flatRewardMinor!, 'flatRewardMinor');
        appliedParameters['flatRewardMinor'] = rule.flatRewardMinor;
        break;
      }
      case 'PERCENTAGE': {
        amount = pct(base, bps(rule.percentageBps));
        appliedParameters['percentageBps'] = rule.percentageBps;
        break;
      }
      case 'PERCENTAGE_MIN': {
        const raw = pct(base, bps(rule.percentageBps));
        const min = parseMinorUnits(rule.minimumRewardMinor!, 'minimumRewardMinor');
        amount = raw < min ? min : raw;
        appliedParameters['percentageBps'] = rule.percentageBps;
        appliedParameters['minimumRewardMinor'] = rule.minimumRewardMinor;
        break;
      }
      case 'PERCENTAGE_MAX': {
        const raw = pct(base, bps(rule.percentageBps));
        const max = parseMinorUnits(rule.maximumRewardMinor!, 'maximumRewardMinor');
        amount = raw > max ? max : raw;
        appliedParameters['percentageBps'] = rule.percentageBps;
        appliedParameters['maximumRewardMinor'] = rule.maximumRewardMinor;
        break;
      }
      case 'PERCENTAGE_MIN_MAX': {
        const raw = pct(base, bps(rule.percentageBps));
        const min = parseMinorUnits(rule.minimumRewardMinor!, 'minimumRewardMinor');
        const max = parseMinorUnits(rule.maximumRewardMinor!, 'maximumRewardMinor');
        amount = (raw < min ? min : raw) > max ? max : raw < min ? min : raw;
        appliedParameters['percentageBps'] = rule.percentageBps;
        appliedParameters['minimumRewardMinor'] = rule.minimumRewardMinor;
        appliedParameters['maximumRewardMinor'] = rule.maximumRewardMinor;
        break;
      }
      case 'FLAT_PLUS_PERCENTAGE': {
        amount = parseMinorUnits(rule.flatRewardMinor!, 'flatRewardMinor') + pct(base, bps(rule.percentageBps));
        appliedParameters['flatRewardMinor'] = rule.flatRewardMinor;
        appliedParameters['percentageBps'] = rule.percentageBps;
        break;
      }
      case 'TIERED': {
        const { total, brackets } = this.calculateTiered(base, rule.tiers!);
        amount = total;
        appliedParameters['tiers'] = brackets;
        break;
      }
      default:
        throw new BadRequestException(`Unsupported calculation model: ${String(rule.calculationModel)}`);
    }
    if (amount > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException('Reward calculation amount must fit in a PostgreSQL BIGINT');
    }
    return {
      amountMinor: amount.toString(),
      baseAmountMinor,
      basis: rule.calculationBasis,
      calculationModel: rule.calculationModel,
      appliedParameters,
    };
  }

  /** Marginal bracket traversal with strict structural validation (fail closed). */
  calculateTiered(base: bigint, tiers: RewardTier[]): { total: bigint; brackets: Array<Record<string, unknown>> } {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new BadRequestException('REWARD_RULE_INCOHERENT: TIERED rule requires a non-empty tiers array');
    }
    let total = 0n;
    let cursor = 0n; // marginal brackets ascend contiguously from 0
    const brackets: Array<Record<string, unknown>> = [];
    tiers.forEach((tier, index) => {
      const upTo = tier.upToMinor === null ? null : parseMinorUnits(tier.upToMinor, `tiers[${index}].upToMinor`);
      const hasFlat = tier.flatMinor !== null && tier.flatMinor !== undefined;
      const hasBps = tier.bps !== null && tier.bps !== undefined;
      if (!hasFlat && !hasBps) {
        throw new BadRequestException(`REWARD_RULE_INCOHERENT: tiers[${index}] requires bps and/or flatMinor`);
      }
      if (hasBps) {
        const parsed = parseMinorUnits(tier.bps!, `tiers[${index}].bps`);
        if (parsed > 10000n) throw new BadRequestException(`REWARD_RULE_INCOHERENT: tiers[${index}].bps exceeds 10000`);
      }
      if (upTo !== null && upTo <= cursor) {
        throw new BadRequestException(
          `REWARD_RULE_INCOHERENT: tiers[${index}].upToMinor (${upTo.toString()}) must exceed the previous bracket bound (${cursor.toString()})`,
        );
      }
      if (upTo === null && index !== tiers.length - 1) {
        throw new BadRequestException('REWARD_RULE_INCOHERENT: only the last bracket may be open-ended (upToMinor = null)');
      }
      const flat = hasFlat ? parseMinorUnits(tier.flatMinor!, `tiers[${index}].flatMinor`) : 0n;
      const pctBps = hasBps ? parseMinorUnits(tier.bps!, `tiers[${index}].bps`) : 0n;
      // slice of base inside [cursor, upTo) — marginal application; floor per bracket
      let bracketAmount = 0n;
      let slice = 0n;
      if (base > cursor) {
        const top = upTo === null || base < upTo ? base : upTo;
        slice = top - cursor;
        bracketAmount = flat + (slice * pctBps) / BASIS_POINTS;
        total += bracketAmount;
      }
      brackets.push({
        index,
        fromMinor: cursor.toString(),
        upToMinor: upTo === null ? null : upTo.toString(),
        sliceMinor: slice.toString(),
        flatMinor: flat.toString(),
        bps: hasBps ? tier.bps! : null,
        bracketRewardMinor: bracketAmount.toString(),
      });
      if (upTo !== null) cursor = upTo;
    });
    return { total, brackets };
  }
}
