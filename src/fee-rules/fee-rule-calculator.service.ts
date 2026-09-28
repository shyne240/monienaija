import { Injectable } from '@nestjs/common';

import type { FeeDecisionSnapshot } from '../commercial-decision/commercial-decision-snapshot.entity';
import { feeNotConfigured } from '../commercial-decision/commercial-decision.defaults';
import type { FeeRuleResolution, ResolvedFeeRule } from './fee-rule-resolver.service';

export interface FeeCalculationInput {
  /** Authoritative read-only resolution result (evidence layer, already in-transaction). */
  resolution: FeeRuleResolution;
  /** Principal amount in minor units (bigint string, e.g. '90000'). */
  principalAmountMinor: string;
  /** 3-letter uppercase ISO currency (V1: NGN). */
  currency: string;
}

export type FeeCalculationModel = 'FLAT' | 'PERCENTAGE' | 'FLAT_PLUS_PERCENTAGE' | 'ZERO';

/**
 * V1-COMMERCIAL-IMPLEMENTATION-01 — the single fee computation authority.
 *
 * HARD BOUNDARIES (unchanged from the resolver/defaults contract):
 *  - PURE + DETERMINISTIC: BigInt minor-unit arithmetic only, no I/O, no clock, no randomness.
 *    Everything it needs comes from the already-authoritative FeeRuleResolution.
 *  - NOT a parallel engine: it consumes `FeeRuleResolverService` results. Services must never
 *    re-derive rules or re-implement this math.
 *  - Rounding: percentage components are FLOORed (integer division on minor units) — the exact
 *    clamp discipline the commission/reward calculators already exhibit; the mode is emitted as
 *    explicit evidence (`roundingApplied: 'FLOOR'`) because the final rounding-family policy is
 *    still a pending human decision.
 *  - Clamp discipline: raw fee = flat + percentage components; a configured minimum lifts,
 *    a configured maximum caps; min/max application is emitted as explicit booleans.
 *  - VAT: when a rule carries vat_bps the VAT amount is computed on the CLAMPED fee (floor),
 *    with full evidence. Provisional test rules carry no VAT, so VAT is 0 in practice today.
 *  - Status vocabulary stays authoritative: NOT_CONFIGURED (no rule), ZERO (rule resolves but
 *    computes to 0), APPLIED (rule resolves and computes > 0). AMBIGUUS keeps the existing
 *    evidence shape (never silently selects a winner).
 *
 * ACCOUNTING BOUNDARY (authoritative): this service computes the commercial fee only. Every
 * APPLIED/ZERO decision carries `posting: { journalLegsPosted: false, reason:
 * 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED' }` because no authoritative fee-revenue ledger
 * account family exists to post the fee side of any double-entry (we do not invent account
 * codes). Flows therefore keep journals principal-only; the computed values are the immutable
 * commercial decision awaiting provisioning.
 */
@Injectable()
export class FeeRuleCalculatorService {
  compute(input: FeeCalculationInput): FeeDecisionSnapshot {
    const { resolution, currency } = input;
    const principal = this.parseMinor(input.principalAmountMinor, 'principalAmountMinor');

    if (resolution.status === 'NOT_CONFIGURED') {
      return feeNotConfigured(currency, input.principalAmountMinor);
    }

    if (resolution.status === 'AMBIGUOUS') {
      // Preserves the pre-wiring evidence shape exactly (byte-compatible with existing suites).
      return {
        ...feeNotConfigured(currency, input.principalAmountMinor),
        resolutionStatus: 'AMBIGUOUS',
        ambiguousRuleIds: resolution.ambiguousRuleIds ?? [],
      };
    }

    const rule = resolution.rule as ResolvedFeeRule;
    const flat =
      rule.flatFeeMinor === null ? 0n : this.parseMinor(rule.flatFeeMinor, 'flatFeeMinor');
    const percentage =
      rule.percentageBps === null ? 0n : (principal * BigInt(rule.percentageBps)) / 10_000n;
    const usesPercentage = rule.percentageBps !== null;

    const rawFee = flat + percentage;
    let fee = rawFee;

    let minimumApplied = false;
    let maximumApplied = false;
    if (rule.minimumFeeMinor !== null) {
      const minimum = this.parseMinor(rule.minimumFeeMinor, 'minimumFeeMinor');
      if (fee < minimum) {
        fee = minimum;
        minimumApplied = true;
      }
    }
    if (rule.maximumFeeMinor !== null) {
      const maximum = this.parseMinor(rule.maximumFeeMinor, 'maximumFeeMinor');
      if (fee > maximum) {
        fee = maximum;
        maximumApplied = true;
      }
    }

    // VAT on the CLAMPED fee, floor-rounded, full evidence; 0 when the rule carries no rate.
    const vatBps = rule.vatBps ?? 0;
    const vat = vatBps === 0 ? 0n : (fee * BigInt(vatBps)) / 10_000n;

    const model: FeeCalculationModel =
      flat > 0n && usesPercentage
        ? 'FLAT_PLUS_PERCENTAGE'
        : flat > 0n
          ? 'FLAT'
          : usesPercentage
            ? 'PERCENTAGE'
            : 'ZERO';

    const total = principal + fee + vat;

    const decision: FeeDecisionSnapshot = {
      status: fee > 0n ? 'APPLIED' : 'ZERO',
      currency,
      amountMinor: input.principalAmountMinor,
      feeMinor: fee.toString(),
      vatMinor: vat.toString(),
      totalMinor: total.toString(),
      // Calculation inputs + construction evidence (deterministic replay — no rule re-resolution
      // is ever needed to explain this decision).
      calculationModel: model,
      flatFeeComponentMinor: flat.toString(),
      percentageFeeComponentMinor: percentage.toString(),
      rawFeeMinor: rawFee.toString(),
      minimumApplied,
      maximumApplied,
      roundingApplied: usesPercentage ? 'FLOOR' : null,
      vatApplied: vat > 0n,
      vatRateBps: vatBps,
      vatBasisMinor: vatBps === 0 ? null : fee.toString(),
      // Accounting boundary — see class header. Journal legs stay principal-only until the
      // authoritative fee-revenue account family is provisioned (no codes invented).
      posting: {
        journalLegsPosted: false,
        reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
      },
      ruleRefs: [
        {
          ruleId: rule.ruleId,
          ruleVersion: rule.ruleVersion,
          flatFeeMinor: rule.flatFeeMinor,
          percentageBps: rule.percentageBps,
          minimumFeeMinor: rule.minimumFeeMinor,
          maximumFeeMinor: rule.maximumFeeMinor,
          vatBps: rule.vatBps,
          effectiveFrom: rule.effectiveFrom.toISOString(),
          effectiveTo: rule.effectiveTo === null ? null : rule.effectiveTo.toISOString(),
          priority: rule.priority,
        },
      ],
    };
    return decision;
  }

  private parseMinor(value: string, field: string): bigint {
    const trimmed = String(value ?? '').trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `FeeRuleCalculatorService: ${field} must be a non-negative minor-unit integer string`,
      );
    }
    const parsed = BigInt(trimmed);
    if (parsed < 0n) throw new Error(`FeeRuleCalculatorService: ${field} must be non-negative`);
    return parsed;
  }
}
