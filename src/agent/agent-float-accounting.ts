import { z } from 'zod';

/**
 * F-1 / F-2 — Finance-owned general-ledger classification for Agent e-float.
 *
 * WHY THIS IS CONFIGURATION AND NOT CODE
 *
 * The accounting unit and liability classification of Agent electronic float
 * are Finance decisions, not platform decisions (ADR-0093 §10 and §20 F-1/F-2).
 * The Agent domain therefore holds NO default and infers nothing: it refuses to
 * provision a float account until Finance supplies the classification.
 *
 * Defaulting to `CUSTOMER_FUNDS` — because it is the column default, or the
 * only unit that exists, or what the historical trigger demanded — would be an
 * engineer asserting that agent float is customer money. ADR-0093 §22 rejects
 * exactly that. Hence: fail closed, mirroring the A2 workforce configuration.
 *
 * DEFENCE IN DEPTH: this configuration governs the APPLICATION. The database
 * independently enforces the same decision through the
 * `agent_float_accounting_classifications` registry consulted by the
 * owner-aware wallet-account trigger, so a misconfigured deployment cannot
 * create a mis-classified Agent account.
 */
export const AGENT_FLOAT_ACCOUNTING = 'AGENT_FLOAT_ACCOUNTING';

const disabled = z.object({ enabled: z.literal(false) });

const enabled = z.object({
  enabled: z.literal(true),
  /** Finance-approved accounting unit for Agent e-float. Never defaulted. */
  accountingUnit: z.string().regex(/^[A-Z][A-Z0-9_:-]{1,63}$/),
  /** Finance-approved ledger account type. */
  accountType: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  /** Finance-approved normal balance. */
  normalBalance: z.enum(['DEBIT', 'CREDIT']),
  /** Prefix for the generated ledger account code. */
  accountCodePrefix: z.string().regex(/^[A-Z][A-Z0-9-]{1,32}$/),
});

export const agentFloatAccountingSchema = z.discriminatedUnion('enabled', [disabled, enabled]);

export type AgentFloatAccountingConfiguration = z.infer<typeof agentFloatAccountingSchema>;
export type EnabledAgentFloatAccounting = z.infer<typeof enabled>;

/**
 * Builds the configuration from the environment. Absent or malformed
 * configuration yields `{ enabled: false }`, making provisioning fail closed
 * rather than guessing a classification.
 *
 * `allowNegativeBalance` is deliberately NOT configurable: Agent e-float may
 * never be negative. That is a product invariant, not a Finance preference, so
 * it is pinned to `false` at the point of use and enforced by the database.
 */
export function agentFloatAccountingConfiguration(
  env: Record<string, string | undefined>,
): AgentFloatAccountingConfiguration {
  if (env.AGENT_FLOAT_ACCOUNTING_ENABLED !== 'true') {
    return { enabled: false };
  }
  const parsed = agentFloatAccountingSchema.safeParse({
    enabled: true,
    accountingUnit: env.AGENT_FLOAT_ACCOUNTING_UNIT,
    accountType: env.AGENT_FLOAT_ACCOUNT_TYPE,
    normalBalance: env.AGENT_FLOAT_NORMAL_BALANCE,
    accountCodePrefix: env.AGENT_FLOAT_ACCOUNT_CODE_PREFIX,
  });
  return parsed.success ? parsed.data : { enabled: false };
}
