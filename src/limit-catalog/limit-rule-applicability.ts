import type { EntityManager } from 'typeorm';

/**
 * Shared limit-rule applicability (Arena 3 Phase 2).
 *
 * WHY THIS EXISTS
 *   The effective-configuration preview must explain *which* limit rules would govern an
 *   operation. If the preview re-derived that selection it would become a second limits engine and
 *   could disagree with enforcement — the exact failure the Studio exists to prevent. So the
 *   runtime selection is expressed once here, and both `LimitEnforcementService` (financial
 *   admission) and the preview call it.
 *
 * WHAT IT IS NOT
 *   This module selects *candidate* rules only. It performs no evaluation, no reservation, no
 *   threshold comparison and no balance lookup. Every one of those stays in
 *   `LimitEnforcementService`, untouched, so runtime behaviour cannot change by construction.
 *
 * PRECEDENCE (unchanged, mirrored from the SQL that already shipped)
 *   `ORDER BY priority DESC, created_at ASC` — highest priority first, oldest rule breaking a tie.
 *   The order is returned as the database produced it; callers must not re-sort, because doing so
 *   silently changes which rule a tie resolves to.
 *
 * WINDOWS
 *   `effective_from <= now` (inclusive) and `effective_to IS NULL OR now < effective_to`
 *   (exclusive). A rule is never applied outside its window.
 *
 * MISSING
 *   An empty candidate list means "no applicable configuration". It never means "unlimited";
 *   interpreting emptiness is a policy decision that belongs to each caller (enforcement throws
 *   for strict callers, the preview reports MISSING).
 */

/** Raw `limit_rules` row as selected below. Column names are snake_case on purpose. */
export interface ApplicableLimitRuleCandidateRow {
  id: string;
  limit_profile_code: string;
  product: string;
  direction: string | null;
  channel: string | null;
  currency: string;
  dimension: string;
  limit_value_minor: string | null;
  limit_value_count: number | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  priority: number;
  created_at: string;
}

/** Narrowing context: the transaction as the caller describes it. */
export interface LimitRuleApplicabilityContext {
  /** Already normalised (upper-case, trimmed) by the caller. */
  product: string;
  currency: string;
  /** `INCOMING` | `OUTGOING`; anything else matches only `null`/`BOTH` rules. */
  direction: string;
  /** Upper-case channel, or null/undefined when the transaction has none. */
  channel: string | null | undefined;
  /** Evaluation instant; must already be resolved (no clock read in here). */
  now: Date;
}

const upper = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
};

/**
 * Select every active, in-window rule for the given profiles, product and currency.
 *
 * Returns raw rows ordered by precedence. No direction/channel narrowing yet — that is
 * `narrowApplicableLimitRules`, kept separate because the tier-profile check in enforcement needs
 * to distinguish "this profile contributed nothing" from "nothing narrowed in".
 */
export async function fetchApplicableLimitRuleCandidates(
  manager: EntityManager,
  input: { profileCodes: readonly string[]; product: string; currency: string; now: Date },
): Promise<ApplicableLimitRuleCandidateRow[]> {
  const profileCodes = [...new Set(input.profileCodes.map((code) => code.trim()).filter(Boolean))];
  if (profileCodes.length === 0) return [];
  return manager.query(
    `SELECT id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor::text AS limit_value_minor, limit_value_count, effective_from, effective_to, is_active, priority, created_at
       FROM limit_rules
      WHERE limit_profile_code = ANY($1::varchar[])
        AND upper(product) = upper($2)
        AND upper(currency) = upper($3)
        AND is_active = true
        AND deleted_at IS NULL
        AND effective_from <= $4
        AND (effective_to IS NULL OR $4 < effective_to)
      ORDER BY priority DESC, created_at ASC`,
    [profileCodes, input.product, input.currency, input.now],
  );
}

/**
 * Direction/channel narrowing.
 *
 * A rule matches when the transaction's direction and channel satisfy it:
 *  - direction: rule `null` or `BOTH` matches any direction, otherwise it must equal the
 *    transaction direction exactly.
 *  - channel: rule `null` matches any channel, otherwise it must equal the transaction channel.
 *    A rule with a channel therefore never matches a channel-less transaction.
 *
 * Preserves input order (precedence) — filtering, never sorting.
 */
export function narrowApplicableLimitRules<
  T extends { direction: string | null; channel: string | null },
>(rules: readonly T[], context: Pick<LimitRuleApplicabilityContext, 'direction' | 'channel'>): T[] {
  const direction = upper(context.direction);
  const channel = upper(context.channel);

  return rules.filter((rule) => {
    const ruleDirection = upper(rule.direction);
    if (ruleDirection !== null && ruleDirection !== 'BOTH' && ruleDirection !== direction)
      return false;
    const ruleChannel = upper(rule.channel);
    if (ruleChannel !== null && ruleChannel !== channel) return false;
    return true;
  });
}
