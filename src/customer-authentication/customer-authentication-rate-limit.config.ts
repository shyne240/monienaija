import { z } from 'zod';

import type { A2RateLimitRuleV1 } from '../authorization/workforce-authentication.types';

/**
 * Security rate limits for the customer credential exchange
 * (`POST /api/v1/customers/:id/authenticate`).
 *
 * These are abuse controls (brute-force and credential-stuffing protection) and are deliberately
 * separate from financial limits: they never restrict money movement and they never change the
 * authentication outcome for a correctly authenticated customer. They reuse the platform's
 * existing DB-backed token bucket (`A2SecurityRateLimitService`, table created by the A2 workforce
 * authentication migration), so no new storage or dependency is introduced.
 *
 * The values below are the default security parameters, not a product or regulatory rule. They are
 * configuration-driven: provide `CUSTOMER_AUTH_RATE_LIMITS_JSON` to tune or explicitly disable a
 * category for an environment. Both categories must always be present in the resolved rule set;
 * to turn one off it must be present with `enabled: false`, so a misconfiguration fails closed
 * instead of silently removing abuse protection.
 */
export const CUSTOMER_AUTH_RATE_LIMIT_RULES = 'CUSTOMER_AUTH_RATE_LIMIT_RULES';

/** Per client address: bounds credential guessing from a single source. */
export const CUSTOMER_AUTH_IP_CATEGORY = 'customer-authentication';
/** Per customer account: bounds distributed guessing against one account. */
export const CUSTOMER_AUTH_ACCOUNT_CATEGORY = 'customer-authentication-account';

export const CUSTOMER_AUTH_REQUIRED_CATEGORIES = [
  CUSTOMER_AUTH_IP_CATEGORY,
  CUSTOMER_AUTH_ACCOUNT_CATEGORY,
] as const;

export const CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS: readonly A2RateLimitRuleV1[] = [
  {
    category: CUSTOMER_AUTH_IP_CATEGORY,
    capacity: 20,
    refillRatePerSecond: 0.5,
    enabled: true,
  },
  {
    category: CUSTOMER_AUTH_ACCOUNT_CATEGORY,
    capacity: 30,
    refillRatePerSecond: 0.5,
    enabled: true,
  },
];

const ruleSchema = z
  .object({
    category: z.string().trim().min(1).max(100),
    capacity: z.number().int().min(1).max(1_000_000),
    refillRatePerSecond: z.number().min(0.000_001).max(1_000_000),
    enabled: z.boolean(),
  })
  .strict();

const rulesSchema = z.array(ruleSchema).min(1).max(10);

/**
 * Resolves the customer-authentication rate-limit rules from the optional environment JSON.
 *
 * Throws on malformed configuration, on duplicate categories and on a missing required category:
 * an unreadable security control must not degrade into "no rate limit".
 */
export function customerAuthenticationRateLimits(
  value: string | undefined | null,
): readonly A2RateLimitRuleV1[] {
  if (value === undefined || value === null || value.trim() === '') {
    return CUSTOMER_AUTH_RATE_LIMIT_DEFAULTS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('CUSTOMER_AUTH_RATE_LIMITS_JSON: malformed JSON');
  }

  const result = rulesSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`CUSTOMER_AUTH_RATE_LIMITS_JSON: ${details}`);
  }

  const rules = result.data as readonly A2RateLimitRuleV1[];
  const categories = rules.map((rule) => rule.category);
  if (new Set(categories).size !== categories.length) {
    throw new Error('CUSTOMER_AUTH_RATE_LIMITS_JSON: duplicate category');
  }
  for (const required of CUSTOMER_AUTH_REQUIRED_CATEGORIES) {
    if (!categories.includes(required)) {
      throw new Error(
        `CUSTOMER_AUTH_RATE_LIMITS_JSON: required category missing: ${required} ` +
          '(set it explicitly with enabled: false to disable it)',
      );
    }
  }

  return rules;
}

/** Returns the resolved rule for a category. A missing rule is a configuration failure. */
export function customerAuthenticationRateLimitRule(
  rules: readonly A2RateLimitRuleV1[],
  category: string,
): A2RateLimitRuleV1 {
  const rule = rules.find((candidate) => candidate.category === category);
  if (!rule) {
    throw new Error(`Customer authentication rate-limit policy missing: ${category}`);
  }
  return rule;
}
