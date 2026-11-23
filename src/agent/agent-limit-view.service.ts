import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LimitProfileResolverService } from '../limit-catalog/limit-profile-resolver.service';
import {
  fetchApplicableLimitRuleCandidates,
  narrowApplicableLimitRules,
  type ApplicableLimitRuleCandidateRow,
} from '../limit-catalog/limit-rule-applicability';
import { getWindowForDimension } from '../limit-catalog/limit-window.util';

/**
 * Agent-safe read-only projection of the authoritative V1 limit-catalog architecture
 * (LimitProfileResolverService + LimitEnforcementService), mirroring the established
 * customer precedent (V1-CUSTOMER-08, `limit-catalog/customer-limit-view.service.ts`).
 *
 * This service NEVER writes limit_usages/limit_reservations and is never part of the
 * transaction-authorization path. Enforcement authority remains exclusively in
 * LimitEnforcementService.enforceWithManager(), called inside the same SERIALIZABLE
 * ledger transaction as each financial operation. This view exists only so an Agent can
 * see, informationally, what already governs their own float operations — the Agent
 * Mobile operating surface must display configured limits (mission: agent operating
 * environment) without inventing a second limit engine.
 *
 * Deliberately narrow: only the product/direction combinations actually wired to
 * enforceWithManager with principalType AGENT are reported (call sites documented on
 * AGENT_PRODUCTS below). Never exposes limitProfileCode, assignmentId, subjectType,
 * limitRuleId, priority, channel, or audit metadata — the same projection contract as
 * the customer view.
 *
 * Rule *selection* is not re-derived here: it calls `limit-catalog/limit-rule-applicability.ts`,
 * the single authoritative expression shared with LimitEnforcementService and the commercial
 * effective-configuration preview (Arena 3 Phase 2). Displayed limits and enforced limits
 * therefore read the same rows in the same precedence order by construction.
 */

export interface AgentLimitWindowView {
  dimension:
    | 'DAILY_AMOUNT'
    | 'WEEKLY_AMOUNT'
    | 'MONTHLY_AMOUNT'
    | 'YEARLY_AMOUNT'
    | 'DAILY_COUNT'
    | 'WEEKLY_COUNT'
    | 'MONTHLY_COUNT'
    | 'YEARLY_COUNT';
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

export interface AgentLimitProductView {
  product: string;
  direction: 'INCOMING' | 'OUTGOING';
  currency: string;
  configured: boolean;
  perTransactionMinMinor: string | null;
  perTransactionMaxMinor: string | null;
  walletBalanceMaxMinor: string | null;
  windows: AgentLimitWindowView[];
}

export interface AgentLimitsView {
  agentId: string;
  currency: string;
  asOf: string;
  products: AgentLimitProductView[];
}

/**
 * Rule selection is delegated to `limit-catalog/limit-rule-applicability.ts` — the single
 * authoritative expression of which `limit_rules` rows govern an operation, shared with
 * `LimitEnforcementService` (financial admission) and the commercial effective-configuration
 * preview. This projection therefore cannot drift from enforcement by construction, and is not
 * a second limits engine.
 */
type RuleRow = ApplicableLimitRuleCandidateRow;

// The only agent-facing product/direction pairs actually wired to
// LimitEnforcementService.enforceWithManager with principalType AGENT.
// Keep in sync with those call sites if a new agent money movement is added.
const AGENT_PRODUCTS: Array<{ product: string; direction: 'INCOMING' | 'OUTGOING' }> = [
  // agent-financial-execution.service.ts — cash-in debits the agent float (customer-side
  // CASH_TO_WALLET enforcement is projected by the customer view, not here).
  { product: 'CASH_TO_WALLET', direction: 'OUTGOING' },
  // agent-financial-execution.service.ts — cash-out credits the agent float.
  { product: 'WALLET_TO_CASH', direction: 'INCOMING' },
  // agent-cash-to-cash.service.ts — initiation spends agent float.
  { product: 'CASH_TO_CASH', direction: 'OUTGOING' },
  // agent-cash-to-cash-claim.service.ts — AGENT_CASH redemption credits the claiming agent.
  { product: 'CASH_TO_CASH', direction: 'INCOMING' },
  // transfer/transfer-participant-limit.ts — agent wallet-to-wallet transfers, both sides.
  { product: 'WALLET_TRANSFER', direction: 'OUTGOING' },
  { product: 'WALLET_TRANSFER', direction: 'INCOMING' },
  // agent-funding.service.ts — maker-checker float funding/defunding.
  { product: 'AGENT_FUNDING', direction: 'INCOMING' },
  { product: 'AGENT_DEFUNDING', direction: 'OUTGOING' },
  // financial-commitment/financial-commitment.service.ts — agent-initiated bank transfer.
  { product: 'EXTERNAL_BANK_TRANSFER', direction: 'OUTGOING' },
];

@Injectable()
export class AgentLimitViewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly profileResolver: LimitProfileResolverService,
  ) {}

  async getMyLimits(
    agentId: string,
    currency = 'NGN',
    now: Date = new Date(),
  ): Promise<AgentLimitsView> {
    const upperCurrency = currency.trim().toUpperCase();
    // The agent row supplies the class id so AGENT_CLASS-subject assignments resolve
    // exactly as they do at enforcement time. Deleted agents get no projection.
    const agentRows: Array<{ agent_class_id: string | null }> = await this.dataSource.query(
      `SELECT agent_class_id FROM agents WHERE id=$1 AND deleted_at IS NULL`,
      [agentId],
    );
    if (agentRows.length !== 1) throw new UnauthorizedException('Agent unavailable');
    const agentClassId = agentRows[0]!.agent_class_id;

    const resolved = await this.profileResolver.resolve(this.dataSource.manager, {
      principalType: 'AGENT',
      principalId: agentId,
      agentClassId,
      now,
    });

    if (!resolved) {
      return {
        agentId,
        currency: upperCurrency,
        asOf: now.toISOString(),
        products: AGENT_PRODUCTS.map((p) =>
          this.unconfigured(p.product, p.direction, upperCurrency),
        ),
      };
    }

    const profileCode = resolved.limitProfileCode;
    // Candidates are fetched per product through the shared applicability module (the same
    // call LimitEnforcementService makes), so precedence ordering (`priority DESC,
    // created_at ASC`) and the effective window come from one place. Enforcement resolves an
    // institution KYC tier profile for CUSTOMER principals only (`principalType !== 'CUSTOMER'`
    // guard in LimitEnforcementService), so for an AGENT the resolved assignment profile is the
    // complete candidate set — no second profile to union here.
    const candidatesByProduct = new Map<string, RuleRow[]>();
    for (const product of [...new Set(AGENT_PRODUCTS.map((entry) => entry.product))]) {
      candidatesByProduct.set(
        product,
        await fetchApplicableLimitRuleCandidates(this.dataSource.manager, {
          profileCodes: [profileCode],
          product,
          currency: upperCurrency,
          now,
        }),
      );
    }

    const products: AgentLimitProductView[] = [];
    for (const entry of AGENT_PRODUCTS) {
      // Agent money movements carry no channel, so a channel-scoped rule must not surface:
      // narrowing with `channel: null` keeps exactly the rules enforcement would apply.
      const matching = narrowApplicableLimitRules(candidatesByProduct.get(entry.product) ?? [], {
        direction: entry.direction,
        channel: null,
      });
      if (matching.length === 0) {
        products.push(this.unconfigured(entry.product, entry.direction, upperCurrency));
        continue;
      }
      products.push(
        await this.buildProductView(
          entry.product,
          entry.direction,
          upperCurrency,
          matching,
          profileCode,
          agentId,
          now,
        ),
      );
    }

    return { agentId, currency: upperCurrency, asOf: now.toISOString(), products };
  }

  private unconfigured(
    product: string,
    direction: 'INCOMING' | 'OUTGOING',
    currency: string,
  ): AgentLimitProductView {
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
    agentId: string,
    now: Date,
  ): Promise<AgentLimitProductView> {
    let perTransactionMinMinor: bigint | null = null;
    let perTransactionMaxMinor: bigint | null = null;
    let walletBalanceMaxMinor: bigint | null = null;
    const windows: AgentLimitWindowView[] = [];

    for (const rule of rules) {
      const dim = rule.dimension.trim().toUpperCase();
      if (dim === 'MIN_AMOUNT_PER_TX') {
        if (rule.limit_value_minor !== null) {
          const v = BigInt(rule.limit_value_minor);
          // Most restrictive MIN is the HIGHEST floor (matches enforcement semantics).
          perTransactionMinMinor =
            perTransactionMinMinor === null || v > perTransactionMinMinor
              ? v
              : perTransactionMinMinor;
        }
      } else if (dim === 'MAX_AMOUNT_PER_TX') {
        if (rule.limit_value_minor !== null) {
          const v = BigInt(rule.limit_value_minor);
          // Most restrictive MAX is the LOWEST ceiling.
          perTransactionMaxMinor =
            perTransactionMaxMinor === null || v < perTransactionMaxMinor
              ? v
              : perTransactionMaxMinor;
        }
      } else if (dim === 'WALLET_BALANCE_MAX') {
        // Mirrors LimitEnforcementService: WALLET_BALANCE_MAX is never enforced on
        // OUTGOING (balance only decreases), so it is not meaningful to display there.
        if (direction === 'INCOMING' && rule.limit_value_minor !== null) {
          const v = BigInt(rule.limit_value_minor);
          walletBalanceMaxMinor =
            walletBalanceMaxMinor === null || v < walletBalanceMaxMinor ? v : walletBalanceMaxMinor;
        }
      } else {
        const window = getWindowForDimension(now, dim);
        if (!window) continue;
        const isCount = dim.endsWith('_COUNT');
        const usage = await this.lookupUsage(
          agentId,
          profileCode,
          product,
          rule.direction,
          rule.channel,
          dim,
          currency,
          window.windowKey,
        );
        const limitMinor =
          !isCount && rule.limit_value_minor !== null ? BigInt(rule.limit_value_minor) : null;
        const limitCount =
          isCount && rule.limit_value_count !== null ? rule.limit_value_count : null;
        const usedMinor = usage ? BigInt(usage.used_amount_minor) : 0n;
        const reservedMinor = usage ? BigInt(usage.reserved_amount_minor) : 0n;
        const usedCount = usage ? usage.used_count : 0;
        const reservedCount = usage ? usage.reserved_count : 0;
        const remainingMinor =
          limitMinor !== null
            ? this.clampNonNegative(limitMinor - usedMinor - reservedMinor)
            : null;
        const remainingCount =
          limitCount !== null ? Math.max(0, limitCount - usedCount - reservedCount) : null;

        // Overlapping configuration for one dimension: keep the most restrictive
        // remaining value rather than silently overwriting — never overstate capacity.
        const existingIndex = windows.findIndex((w) => w.dimension === dim);
        const candidate: AgentLimitWindowView = {
          dimension: dim as AgentLimitWindowView['dimension'],
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
          const currentRemaining = isCount
            ? current.remainingCount
            : current.remainingMinor
              ? BigInt(current.remainingMinor)
              : null;
          const candidateRemaining = isCount
            ? candidate.remainingCount
            : candidate.remainingMinor
              ? BigInt(candidate.remainingMinor)
              : null;
          const candidateIsMoreRestrictive =
            currentRemaining === null ||
            (candidateRemaining !== null && candidateRemaining < currentRemaining);
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
      perTransactionMinMinor:
        perTransactionMinMinor !== null ? perTransactionMinMinor.toString() : null,
      perTransactionMaxMinor:
        perTransactionMaxMinor !== null ? perTransactionMaxMinor.toString() : null,
      walletBalanceMaxMinor:
        walletBalanceMaxMinor !== null ? walletBalanceMaxMinor.toString() : null,
      windows,
    };
  }

  private clampNonNegative(v: bigint): bigint {
    return v < 0n ? 0n : v;
  }

  private async lookupUsage(
    agentId: string,
    profileCode: string,
    product: string,
    ruleDirection: string | null,
    ruleChannel: string | null,
    dimension: string,
    currency: string,
    windowKey: string,
  ): Promise<{
    used_amount_minor: string;
    used_count: number;
    reserved_amount_minor: string;
    reserved_count: number;
  } | null> {
    const rows: Array<{
      used_amount_minor: string;
      used_count: number;
      reserved_amount_minor: string;
      reserved_count: number;
    }> = await this.dataSource.query(
      `SELECT used_amount_minor::text AS used_amount_minor, used_count,
                reserved_amount_minor::text AS reserved_amount_minor, reserved_count
           FROM limit_usages
          WHERE principal_type = 'AGENT'
            AND principal_id = $1
            AND limit_profile_code = $2
            AND product = $3
            AND COALESCE(direction, '') = COALESCE($4, '')
            AND COALESCE(channel, '') = COALESCE($5, '')
            AND dimension = $6
            AND currency = $7
            AND window_key = $8`,
      [agentId, profileCode, product, ruleDirection, ruleChannel, dimension, currency, windowKey],
    );
    return rows[0] ?? null;
  }
}
