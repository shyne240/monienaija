import { BadRequestException } from '@nestjs/common';

import {
  MAX_POSTGRES_BIGINT,
  parseMinorUnits,
} from '../common/money';

import type {
  CommissionCalculationBasis,
  CommissionCalculationModel,
  CommissionRuleDefinition,
  CommissionTier,
} from './commission-rule.entity';

const BASIS_POINTS = 10_000n;

/** Bases the resolver can feed the calculator from explicit evidence. */
export interface CommissionBaseEvidence {
  /** Transaction principal (minor). Always available to any flow that passes an amount. */
  principalMinor: string;
  /**
   * Fee amount (minor) for this transaction — only available when fee evidence exists
   * (today: no V1 flow produces configured fees, so FEE/NET bases only resolve when the
   * caller hands explicit fee evidence, e.g. TEST-ONLY synthetic fee rules).
   */
  feeMinor?: string | null;
}

export interface CommissionCalculationInput {
  rule: CommissionRuleDefinition;
  base: bigint;
  baseAmountMinor: string;
}

export interface CommissionCalculatedAmount {
  amountMinor: string;
  baseAmountMinor: string;
  basis: CommissionCalculationBasis;
  /** Human/explainable parameter echo used for the applied calculation. */
  calculationModel: CommissionCalculationModel;
  appliedParameters: Record<string, unknown>;
}

/**
 * V1-COMMISSION-01 — deterministic commission MECHANICS (no policy).
 *
 * Semantics per calculation_model (mechanics only, deliberately documented here and in
 * docs/V1-COMMISSION-01-COMMISSION-ENGINE-ARCHITECTURE.md so nothing is implicit):
 *  - FIXED                → flat_commission_minor
 *  - PERCENTAGE           → (base * bps) / 10000  [integer-divided, floor]
 *  - PERCENTAGE_MIN       → max(raw, minimum)
 *  - PERCENTAGE_MAX       → min(raw, maximum)
 *  - PERCENTAGE_MIN_MAX   → min(max(raw, minimum), maximum) — minimum applied first
 *    (same clamp order and floor-division as FeeEngine)
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
export class CommissionCalculator {
  /** Resolve the base amount for a rule from explicit evidence. Throws when unavailable. */
  resolveBase(rule: CommissionRuleDefinition, evidence: CommissionBaseEvidence): bigint {
    const principalMinor = parseMinorUnits(evidence.principalMinor, 'principalMinor');
    switch (rule.calculationBasis) {
      case 'PRINCIPAL':
        return principalMinor;
      case 'FEE': {
        if (evidence.feeMinor === null || evidence.feeMinor === undefined) {
          throw new BadRequestException(
            'COMMISSION_BASE_UNAVAILABLE: rule is FEE-based but no fee evidence was provided (fees are NOT_CONFIGURED today)',
          );
        }
        return parseMinorUnits(evidence.feeMinor, 'feeMinor');
      }
      case 'NET': {
        if (evidence.feeMinor === null || evidence.feeMinor === undefined) {
          throw new BadRequestException(
            'COMMISSION_BASE_UNAVAILABLE: rule is NET-based but no fee evidence was provided (fees are NOT_CONFIGURED today)',
          );
        }
        const fee = parseMinorUnits(evidence.feeMinor, 'feeMinor');
        if (fee > principalMinor) {
          throw new BadRequestException('COMMISSION_BASE_INVALID: NET base would be negative (fee exceeds principal)');
        }
        return principalMinor - fee;
      }
      default:
        throw new BadRequestException(`Unsupported calculation basis: ${String(rule.calculationBasis)}`);
    }
  }

  /** Apply the rule's calculation model to an already-resolved base. */
  calculate(rule: CommissionRuleDefinition, base: bigint, baseAmountMinor: string): CommissionCalculatedAmount {
    const bps = (value: number | null | undefined): bigint =>
      value === null || value === undefined ? 0n : parseMinorUnits(value, 'percentageBps');
    const pct = (b: bigint, p: bigint): bigint => (b * p) / BASIS_POINTS;

    let amount: bigint;
    const appliedParameters: Record<string, unknown> = {};
    switch (rule.calculationModel) {
      case 'FIXED': {
        amount = parseMinorUnits(rule.flatCommissionMinor!, 'flatCommissionMinor');
        appliedParameters['flatCommissionMinor'] = rule.flatCommissionMinor;
        break;
      }
      case 'PERCENTAGE': {
        amount = pct(base, bps(rule.percentageBps));
        appliedParameters['percentageBps'] = rule.percentageBps;
        break;
      }
      case 'PERCENTAGE_MIN': {
        const raw = pct(base, bps(rule.percentageBps));
        const min = parseMinorUnits(rule.minimumCommissionMinor!, 'minimumCommissionMinor');
        amount = raw < min ? min : raw;
        appliedParameters['percentageBps'] = rule.percentageBps;
        appliedParameters['minimumCommissionMinor'] = rule.minimumCommissionMinor;
        break;
      }
      case 'PERCENTAGE_MAX': {
        const raw = pct(base, bps(rule.percentageBps));
        const max = parseMinorUnits(rule.maximumCommissionMinor!, 'maximumCommissionMinor');
        amount = raw > max ? max : raw;
        appliedParameters['percentageBps'] = rule.percentageBps;
        appliedParameters['maximumCommissionMinor'] = rule.maximumCommissionMinor;
        break;
      }
      case 'PERCENTAGE_MIN_MAX': {
        const raw = pct(base, bps(rule.percentageBps));
        const min = parseMinorUnits(rule.minimumCommissionMinor!, 'minimumCommissionMinor');
        const max = parseMinorUnits(rule.maximumCommissionMinor!, 'maximumCommissionMinor');
        amount = (raw < min ? min : raw) > max ? max : raw < min ? min : raw;
        appliedParameters['percentageBps'] = rule.percentageBps;
        appliedParameters['minimumCommissionMinor'] = rule.minimumCommissionMinor;
        appliedParameters['maximumCommissionMinor'] = rule.maximumCommissionMinor;
        break;
      }
      case 'FLAT_PLUS_PERCENTAGE': {
        amount = parseMinorUnits(rule.flatCommissionMinor!, 'flatCommissionMinor') + pct(base, bps(rule.percentageBps));
        appliedParameters['flatCommissionMinor'] = rule.flatCommissionMinor;
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
      throw new BadRequestException('Commission calculation amount must fit in a PostgreSQL BIGINT');
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
  calculateTiered(base: bigint, tiers: CommissionTier[]): { total: bigint; brackets: Array<Record<string, unknown>> } {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new BadRequestException('COMMISSION_RULE_INCOHERENT: TIERED rule requires a non-empty tiers array');
    }
    let total = 0n;
    let cursor = 0n; // marginal brackets ascend contiguously from 0
    const brackets: Array<Record<string, unknown>> = [];
    tiers.forEach((tier, index) => {
      const upTo = tier.upToMinor === null ? null : parseMinorUnits(tier.upToMinor, `tiers[${index}].upToMinor`);
      const hasFlat = tier.flatMinor !== null && tier.flatMinor !== undefined;
      const hasBps = tier.bps !== null && tier.bps !== undefined;
      if (!hasFlat && !hasBps) {
        throw new BadRequestException(`COMMISSION_RULE_INCOHERENT: tiers[${index}] requires bps and/or flatMinor`);
      }
      if (hasBps) {
        const parsed = parseMinorUnits(tier.bps!, `tiers[${index}].bps`);
        if (parsed > 10000n) throw new BadRequestException(`COMMISSION_RULE_INCOHERENT: tiers[${index}].bps exceeds 10000`);
      }
      if (upTo !== null && upTo <= cursor) {
        throw new BadRequestException(
          `COMMISSION_RULE_INCOHERENT: tiers[${index}].upToMinor (${upTo.toString()}) must exceed the previous bracket bound (${cursor.toString()})`,
        );
      }
      if (upTo === null && index !== tiers.length - 1) {
        throw new BadRequestException('COMMISSION_RULE_INCOHERENT: only the last bracket may be open-ended (upToMinor = null)');
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
        bracketCommissionMinor: bracketAmount.toString(),
      });
      if (upTo !== null) cursor = upTo;
    });
    return { total, brackets };
  }
}
