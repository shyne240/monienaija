import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

/**
 * Synthetic limit-catalogue fixtures for AGENT admission tests.
 *
 * Agent financial admission (Cash→Wallet, Wallet→Cash, Cash→Cash, Cash→Cash claim, float
 * funding/defunding, external bank transfer, wallet transfer) opts into an *applicable
 * configuration requirement*: an agent transaction may only post when a limit profile and an
 * applicable rule actually resolve for the agent's class. These helpers seed that configuration
 * with explicit, caller-supplied values so a suite can express "configured", "configured but not
 * for this product/direction", and "not configured at all" without inventing operational
 * thresholds.
 *
 * Every value here is acceptance data. Nothing is derived from product policy, and no helper
 * creates a journal, a reservation or a usage row — the seed only writes catalogue rows
 * (`limit_profiles`, `limit_assignments`, `limit_rules`).
 */

export const AGENT_LIMIT_FIXTURE_ACTOR = 'agent-limit-fixtures';

/** Deliberately large per-transaction bound so an unrelated financial test is not constrained. */
export const AGENT_LIMIT_PERMISSIVE_MAX_MINOR = '9000000000000000';

const EFFECTIVE_FROM = '2000-01-01T00:00:00.000Z';

/**
 * Permissive rules for every Agent money-movement product an Agent Class fixture can reach, so a
 * pre-existing financial test keeps testing its own subject now that Agent admission requires a
 * configured limit. Per-test overrides seed tight rules instead.
 *
 * Deliberately covers Cash→Wallet, Wallet→Cash and both Cash→Cash legs: suites like A14 exercise a
 * second product as a regression guard, and a per-product default would make those guards fail for
 * a configuration reason unrelated to what they assert.
 */
export function permissiveAgentLimitRules(): AgentLimitRuleSeed[] {
  const products: Array<[string, 'INCOMING' | 'OUTGOING']> = [
    ['CASH_TO_WALLET', 'OUTGOING'],
    ['WALLET_TO_CASH', 'INCOMING'],
    ['CASH_TO_CASH', 'OUTGOING'],
    ['CASH_TO_CASH', 'INCOMING'],
  ];
  return products.map(([product, direction]) => ({
    product,
    direction,
    dimension: 'MAX_AMOUNT_PER_TX' as const,
    amountMinor: AGENT_LIMIT_PERMISSIVE_MAX_MINOR,
  }));
}

export type AgentLimitDimension =
  | 'MIN_AMOUNT_PER_TX'
  | 'MAX_AMOUNT_PER_TX'
  | 'DAILY_AMOUNT'
  | 'WEEKLY_AMOUNT'
  | 'MONTHLY_AMOUNT'
  | 'YEARLY_AMOUNT'
  | 'WALLET_BALANCE_MAX'
  | 'DAILY_COUNT'
  | 'WEEKLY_COUNT'
  | 'MONTHLY_COUNT'
  | 'YEARLY_COUNT';

export interface AgentLimitRuleSeed {
  product: string;
  direction?: 'INCOMING' | 'OUTGOING' | 'BOTH';
  dimension?: AgentLimitDimension;
  /** Required for amount dimensions. Minor units, bigint string. */
  amountMinor?: string;
  /** Required for count dimensions. */
  count?: number;
  currency?: string;
  channel?: string | null;
  priority?: number;
}

export interface AssignAgentClassLimitOptions {
  agentClassId: string;
  rules: AgentLimitRuleSeed[];
  /** Defaults to a unique per-class profile code. */
  profileCode?: string;
  currency?: string;
  /**
   * Assignment precedence. Deliberately BELOW the common default (0) so a test that seeds its own
   * AGENT/AGENT_CLASS assignment for the same agent always wins: this fixture exists to keep a
   * pre-existing financial suite testing its own subject, never to override an explicit limit the
   * suite is asserting.
   */
  precedence?: number;
}

export interface AgentClassLimitAssignment {
  profileCode: string;
  ruleIds: string[];
}

/**
 * Assigns an AGENT_CLASS limit profile carrying `rules`.
 *
 * Idempotent per profile code. The assignment takes the lowest precedence so that any assignment a
 * test seeds itself — including an intentionally blocking one — takes effect; this fixture only
 * supplies a fallback for suites whose subject is not limits.
 */
export async function assignAgentClassLimitProfile(
  dataSource: DataSource,
  options: AssignAgentClassLimitOptions,
): Promise<AgentClassLimitAssignment> {
  const currency = (options.currency ?? 'NGN').toUpperCase();
  const profileCode =
    options.profileCode?.trim().toUpperCase() ??
    `AGENT_CLASS_TEST_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const precedence = options.precedence ?? -1;

  await dataSource.query(
    `INSERT INTO limit_profiles(code,name,description,kind,status,enabled,configuration_status,created_by)
     VALUES($1,$2,'Synthetic agent-admission fixture profile','AGENT','ACTIVE',true,'CONFIGURED',$3)
     ON CONFLICT(code) DO NOTHING`,
    [profileCode, `Agent admission fixture ${profileCode}`, AGENT_LIMIT_FIXTURE_ACTOR],
  );

  await dataSource.query(
    `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,segment_code,precedence,effective_from,effective_to,is_active,created_by)
     VALUES($1,$2,'AGENT_CLASS',$3,NULL,$4,$5,NULL,true,$6)
     ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      profileCode,
      options.agentClassId,
      precedence,
      EFFECTIVE_FROM,
      AGENT_LIMIT_FIXTURE_ACTOR,
    ],
  );

  const ruleIds: string[] = [];
  for (const rule of options.rules) {
    const dimension = (rule.dimension ?? 'MAX_AMOUNT_PER_TX').toUpperCase() as AgentLimitDimension;
    const isCountDimension = dimension.endsWith('_COUNT');
    if (isCountDimension && rule.count === undefined) {
      throw new Error(`Agent limit fixture rule ${dimension} requires \`count\``);
    }
    if (!isCountDimension && rule.amountMinor === undefined) {
      throw new Error(`Agent limit fixture rule ${dimension} requires \`amountMinor\``);
    }
    const existing = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM limit_rules
        WHERE limit_profile_code=$1 AND product=$2 AND upper(coalesce(direction,'BOTH'))=$3
          AND currency=$4 AND dimension=$5 AND deleted_at IS NULL
        LIMIT 1`,
      [
        profileCode,
        rule.product.trim().toUpperCase(),
        (rule.direction ?? 'BOTH').toUpperCase(),
        (rule.currency ?? currency).toUpperCase(),
        dimension,
      ],
    );
    if (existing.length > 0) {
      ruleIds.push(existing[0]!.id);
      continue;
    }
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,channel,currency,dimension,limit_value_minor,limit_value_count,effective_from,effective_to,is_active,priority,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,true,$11,$12)`,
      [
        id,
        profileCode,
        rule.product.trim().toUpperCase(),
        (rule.direction ?? 'BOTH').toUpperCase(),
        rule.channel ?? null,
        (rule.currency ?? currency).toUpperCase(),
        dimension,
        isCountDimension ? null : rule.amountMinor,
        isCountDimension ? rule.count : null,
        EFFECTIVE_FROM,
        rule.priority ?? 0,
        AGENT_LIMIT_FIXTURE_ACTOR,
      ],
    );
    ruleIds.push(id);
  }

  return { profileCode, ruleIds };
}

export interface AgentAdmissionArtifacts {
  journals: number;
  ledgerLines: number;
  limitReservations: number;
  limitUsages: number;
}

/**
 * Counts every artifact a posted admission would create.
 *
 * Used to prove a blocked or denied agent transaction left *no* financial or limit-side effect,
 * rather than only proving the response status.
 */
export async function countAgentAdmissionArtifacts(
  dataSource: DataSource,
): Promise<AgentAdmissionArtifacts> {
  const rows = await dataSource.query<
    Array<{
      journals: string;
      ledger_lines: string;
      limit_reservations: string;
      limit_usages: string;
    }>
  >(
    `SELECT
       (SELECT count(*) FROM ledger_journals)::text AS journals,
       (SELECT count(*) FROM ledger_lines)::text AS ledger_lines,
       (SELECT count(*) FROM limit_reservations)::text AS limit_reservations,
       (SELECT count(*) FROM limit_usages)::text AS limit_usages`,
  );
  const row = rows[0]!;
  return {
    journals: Number(row.journals),
    ledgerLines: Number(row.ledger_lines),
    limitReservations: Number(row.limit_reservations),
    limitUsages: Number(row.limit_usages),
  };
}

/** The `{status, code, message}` a limit configuration block is expected to return. */
export interface LimitConfigurationErrorShape {
  status: number;
  code: string;
  message: string;
}

/**
 * Normalizes a thrown Nest HttpException into the assertion shape.
 *
 * The blocked-admission contract is deliberately inspected (status + machine code + message), not
 * just `rejects.toThrow()`, because "a clear configuration error" is part of the acceptance
 * criteria.
 */
export function limitErrorShape(error: unknown): LimitConfigurationErrorShape {
  const candidate = error as {
    status?: number;
    getStatus?: () => number;
    getResponse?: () => unknown;
  };
  const status =
    typeof candidate?.getStatus === 'function'
      ? candidate.getStatus()
      : typeof candidate?.status === 'number'
        ? candidate.status
        : 0;
  const raw = typeof candidate?.getResponse === 'function' ? candidate.getResponse() : {};
  const body = (raw ?? {}) as { message?: unknown; error?: unknown; code?: unknown };
  const message = Array.isArray(body.message)
    ? body.message.join(', ')
    : typeof body.message === 'string'
      ? body.message
      : '';
  const code =
    typeof body.error === 'string' ? body.error : typeof body.code === 'string' ? body.code : '';
  return { status, code, message };
}
