import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LimitProfileResolverService } from './limit-profile-resolver.service';
import { getWindowForDimension } from './limit-window.util';

/**
 * V1-CUSTOMER-08 — customer-safe projection of the authoritative V1 limit-catalog
 * architecture (LimitProfileResolverService + LimitEnforcementService, see
 * limit-enforcement.service.ts). This service is READ-ONLY: it never writes
 * limit_usages/limit_reservations and is never part of the transaction-authorization
 * path. Backend authority for *enforcement* remains exclusively in
 * LimitEnforcementService.enforceWithManager(), called inside the same SERIALIZABLE
 * ledger transaction as each financial operation. This view exists only to let a
 * customer see, informationally, what already governs their own transactions.
 *
 * Deliberately narrow (Part B of V1-CUSTOMER-08 — "do not leak internal policy"):
 * only the five product/direction combinations that are actually wired to
 * enforceWithManager with principalType CUSTOMER are reported (see call sites in
 * transfer.service.ts, agent-cash-in.service.ts, agent-cash-out.service.ts,
 * agent-cash-to-cash-claim.service.ts, customer-funding.service.ts). Never exposes
 * limitProfileCode, assignmentId, subjectType/segmentCode, limitRuleId, priority,
 * channel, created/updated-by audit metadata, or ledger account ids.
 */

export interface CustomerLimitWindowView {
  dimension: 'DAILY_AMOUNT' | 'WEEKLY_AMOUNT' | 'MONTHLY_AMOUNT' | 'YEARLY_AMOUNT' | 'DAILY_COUNT' | 'WEEKLY_COUNT' | 'MONTHLY_COUNT' | 'YEARLY_COUNT';
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  kind: 'AMOUNT' | 'COUNT';
  limitMinor: string | null;
  limitCount: number | null;
  usedMinor: string | null;
  usedCount: number | null;
  reservedMinor: string | null;
  reservedCount: number | null;
  remainingMinor: string | null;
  remainingCount: number | null;
  windowResetsAt: string;
}

export interface CustomerLimitProductView {
  product: string;
  direction: 'INCOMING' | 'OUTGOING';
  currency: string;
  configured: boolean;
  perTransactionMinMinor: string | null;
  perTransactionMaxMinor: string | null;
  walletBalanceMaxMinor: string | null;
  windows: CustomerLimitWindowView[];
}

export interface CustomerLimitsView {
  customerId: string;
  currency: string;
  asOf: string;
  products: CustomerLimitProductView[];
}

interface RuleRow {
  id: string;
  product: string;
  direction: string | null;
  channel: string | null;
  currency: string;
  dimension: string;
  limit_value_minor: string | null;
  limit_value_count: number | null;
}

// The only customer-facing product/direction pairs actually wired to
// LimitEnforcementService.enforceWithManager with principalType CUSTOMER.
// Keep in sync with the call sites documented above if a new customer money
// movement is added in a future task.
const CUSTOMER_PRODUCTS: Array<{ product: string; direction: 'INCOMING' | 'OUTGOING' }> = [
  { product: 'WALLET_TRANSFER', direction: 'OUTGOING' }, // transfer.service.ts (W2W send)
  { product: 'CASH_TO_WALLET', direction: 'INCOMING' }, // agent-cash-in.service.ts (agent gives cash, customer wallet credited)
  { product: 'WALLET_TO_CASH', direction: 'OUTGOING' }, // agent-cash-out.service.ts (customer wallet debited for cash withdrawal)
  { product: 'CASH_TO_CASH', direction: 'INCOMING' }, // agent-cash-to-cash-claim.service.ts (customer claims C2C cash)
  { product: 'CUSTOMER_FUNDING', direction: 'INCOMING' }, // customer-funding.service.ts (approved wallet funding)
];

@Injectable()
export class CustomerLimitViewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profileResolver: LimitProfileResolverService,
  ) {}

  async getMyLimits(customerId: string, currency = 'NGN', now: Date = new Date()): Promise<CustomerLimitsView> {
    const upperCurrency = currency.trim().toUpperCase();
    const resolved = await this.profileResolver.resolve(this.dataSource.manager, {
      principalType: 'CUSTOMER',
      principalId: customerId,
      now,
    });

    if (!resolved) {
      return {
        customerId,
        currency: upperCurrency,
        asOf: now.toISOString(),
        products: CUSTOMER_PRODUCTS.map((p) => this.unconfigured(p.product, p.direction, upperCurrency)),
      };
    }

    const profileCode = resolved.limitProfileCode;
    const ruleRows: RuleRow[] = await this.dataSource.query(
      `SELECT id, product, direction, channel, currency, dimension,
              limit_value_minor::text AS limit_value_minor, limit_value_count
         FROM limit_rules
        WHERE limit_profile_code = $1
          AND upper(currency) = upper($2)
          AND is_active = true
          AND deleted_at IS NULL
          AND effective_from <= $3
          AND (effective_to IS NULL OR $3 < effective_to)
          AND channel IS NULL
        ORDER BY priority DESC, created_at ASC`,
      [profileCode, upperCurrency, now],
    );

    const products: CustomerLimitProductView[] = [];
    for (const entry of CUSTOMER_PRODUCTS) {
      const matching = ruleRows.filter((r) => {
        if (r.product.trim().toUpperCase() !== entry.product.toUpperCase()) return false;
        const rd = r.direction ? r.direction.trim().toUpperCase() : null;
        return rd === null || rd === 'BOTH' || rd === entry.direction;
      });
      if (matching.length === 0) {
        products.push(this.unconfigured(entry.product, entry.direction, upperCurrency));
        continue;
      }
      products.push(
        await this.buildProductView(entry.product, entry.direction, upperCurrency, matching, profileCode, customerId, now),
      );
    }

    return { customerId, currency: upperCurrency, asOf: now.toISOString(), products };
  }

  private unconfigured(product: string, direction: 'INCOMING' | 'OUTGOING', currency: string): CustomerLimitProductView {
    return {
      product,
      direction,
      currency,
      configured: false,
      perTransactionMinMinor: null,
      perTransactionMaxMinor: null,
      walletBalanceMaxMinor: null,
      windows: [],
    };
  }

  private async buildProductView(
    product: string,
    direction: 'INCOMING' | 'OUTGOING',
    currency: string,
    rules: RuleRow[],
    profileCode: string,
    customerId: string,
    now: Date,
  ): Promise<CustomerLimitProductView> {
    let perTransactionMinMinor: bigint | null = null;
    let perTransactionMaxMinor: bigint | null = null;
    let walletBalanceMaxMinor: bigint | null = null;
    const windows: CustomerLimitWindowView[] = [];

    for (const rule of rules) {
      const dim = rule.dimension.trim().toUpperCase();
      if (dim === 'MIN_AMOUNT_PER_TX') {
        if (rule.limit_value_minor !== null) {
          const v = BigInt(rule.limit_value_minor);
          // Most restrictive MIN is the HIGHEST floor (matches enforcement: any
          // matching MIN rule can reject, so the binding one is the largest).
          perTransactionMinMinor = perTransactionMinMinor === null || v > perTransactionMinMinor ? v : perTransactionMinMinor;
        }
      } else if (dim === 'MAX_AMOUNT_PER_TX') {
        if (rule.limit_value_minor !== null) {
          const v = BigInt(rule.limit_value_minor);
          // Most restrictive MAX is the LOWEST ceiling.
          perTransactionMaxMinor = perTransactionMaxMinor === null || v < perTransactionMaxMinor ? v : perTransactionMaxMinor;
        }
      } else if (dim === 'WALLET_BALANCE_MAX') {
        // Mirrors LimitEnforcementService: WALLET_BALANCE_MAX is never enforced on
        // OUTGOING (balance only decreases), so it is not meaningful to display there.
        if (direction === 'INCOMING' && rule.limit_value_minor !== null) {
          const v = BigInt(rule.limit_value_minor);
          walletBalanceMaxMinor = walletBalanceMaxMinor === null || v < walletBalanceMaxMinor ? v : walletBalanceMaxMinor;
        }
      } else {
        const window = getWindowForDimension(now, dim);
        if (!window) continue;
        const isCount = dim.endsWith('_COUNT');
        const usage = await this.lookupUsage(customerId, profileCode, product, rule.direction, rule.channel, dim, currency, window.windowKey);
        const limitMinor = !isCount && rule.limit_value_minor !== null ? BigInt(rule.limit_value_minor) : null;
        const limitCount = isCount && rule.limit_value_count !== null ? rule.limit_value_count : null;
        const usedMinor = usage ? BigInt(usage.used_amount_minor) : 0n;
        const reservedMinor = usage ? BigInt(usage.reserved_amount_minor) : 0n;
        const usedCount = usage ? usage.used_count : 0;
        const reservedCount = usage ? usage.reserved_count : 0;
        const remainingMinor = limitMinor !== null ? this.clampNonNegative(limitMinor - usedMinor - reservedMinor) : null;
        const remainingCount = limitCount !== null ? Math.max(0, limitCount - usedCount - reservedCount) : null;

        // If a rule of the same dimension already exists for this product (edge
        // case: overlapping configuration), keep the most restrictive remaining
        // value rather than silently overwriting — never overstate capacity.
        const existingIndex = windows.findIndex((w) => w.dimension === dim);
        const candidate: CustomerLimitWindowView = {
          dimension: dim as CustomerLimitWindowView['dimension'],
          period: window.windowType,
          kind: isCount ? 'COUNT' : 'AMOUNT',
          limitMinor: limitMinor !== null ? limitMinor.toString() : null,
          limitCount,
          usedMinor: !isCount ? usedMinor.toString() : null,
          usedCount: isCount ? usedCount : null,
          reservedMinor: !isCount ? reservedMinor.toString() : null,
          reservedCount: isCount ? reservedCount : null,
          remainingMinor: remainingMinor !== null ? remainingMinor.toString() : null,
          remainingCount,
          windowResetsAt: window.windowEnd.toISOString(),
        };
        if (existingIndex === -1) {
          windows.push(candidate);
        } else {
          const current = windows[existingIndex]!;
          const currentRemaining = isCount ? current.remainingCount : current.remainingMinor ? BigInt(current.remainingMinor) : null;
          const candidateRemaining = isCount ? candidate.remainingCount : candidate.remainingMinor ? BigInt(candidate.remainingMinor) : null;
          const candidateIsMoreRestrictive =
            currentRemaining === null ||
            (candidateRemaining !== null && candidateRemaining < (currentRemaining as any));
          if (candidateIsMoreRestrictive) {
            windows[existingIndex] = candidate;
          }
        }
      }
    }

    return {
      product,
      direction,
      currency,
      configured: true,
      perTransactionMinMinor: perTransactionMinMinor !== null ? perTransactionMinMinor.toString() : null,
      perTransactionMaxMinor: perTransactionMaxMinor !== null ? perTransactionMaxMinor.toString() : null,
      walletBalanceMaxMinor: walletBalanceMaxMinor !== null ? walletBalanceMaxMinor.toString() : null,
      windows,
    };
  }

  private clampNonNegative(v: bigint): bigint {
    return v < 0n ? 0n : v;
  }

  private async lookupUsage(
    customerId: string,
    profileCode: string,
    product: string,
    ruleDirection: string | null,
    ruleChannel: string | null,
    dimension: string,
    currency: string,
    windowKey: string,
  ): Promise<{ used_amount_minor: string; used_count: number; reserved_amount_minor: string; reserved_count: number } | null> {
    const rows: Array<{ used_amount_minor: string; used_count: number; reserved_amount_minor: string; reserved_count: number }> =
      await this.dataSource.query(
        `SELECT used_amount_minor::text AS used_amount_minor, used_count,
                reserved_amount_minor::text AS reserved_amount_minor, reserved_count
           FROM limit_usages
          WHERE principal_type = 'CUSTOMER'
            AND principal_id = $1
            AND limit_profile_code = $2
            AND product = $3
            AND COALESCE(direction, '') = COALESCE($4, '')
            AND COALESCE(channel, '') = COALESCE($5, '')
            AND dimension = $6
            AND currency = $7
            AND window_key = $8`,
        [customerId, profileCode, product, ruleDirection, ruleChannel, dimension, currency, windowKey],
      );
    return rows[0] ?? null;
  }
}
