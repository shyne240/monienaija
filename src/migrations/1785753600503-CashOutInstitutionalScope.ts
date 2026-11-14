import type { MigrationInterface, QueryRunner } from 'typeorm';

const SCOPE_CHECK = 'cash_out_intents_institution_scope_check';
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

/**
 * ARENA 3 — Arena 2 consolidation: Cash-Out institutional scope.
 *
 * Migration `1785753600132-CashOutIntents` was accepted on the Arena 2 branch with a test-only
 * sentinel constraint, `CHECK (institution_scope = 'MONIENAIJA')`, because the authoritative
 * institutional resolver had not been integrated at that point. The sentinel is not an institution
 * and must not survive into the consolidated application.
 *
 * This corrective migration replaces the constraint in place. It does not renumber, rewrite or
 * fabricate migration history: `1785753600132` keeps its published identifier and its original
 * content, and the correction is a separate, forward-only migration inside the user-authorized
 * `1785753600500`–`1785753600599` correction range.
 *
 * After this migration an intent's scope is any syntactically valid UUID, which the application
 * only ever obtains from `requireCashOutInstitutionScope()` (the authoritative
 * `AGENT_INSTITUTION_RESOLVER`). A foreign key to `financial_institutions` is deliberately not
 * added: the resolver, not a constraint, is the authority on whether the institution is live, and
 * the intent is written inside the same transaction that just resolved it.
 *
 * Historical intent rows written under the sentinel cannot be replayed, because their scope can
 * never match a resolved institution again. No institution is inferred for them and no financial
 * record is rewritten.
 */
export class CashOutInstitutionalScope1785753600503 implements MigrationInterface {
  name = 'CashOutInstitutionalScope1785753600503';

  async up(q: QueryRunner): Promise<void> {
    const table = (await q.query(
      `SELECT to_regclass('public.cash_out_intents')::text AS n`,
    )) as Array<{ n: string | null }>;
    if (!table[0]?.n) return;

    // Drop only constraints that actually encode the sentinel. Any other check on the column (for
    // example a future stronger invariant) is left untouched, so this migration never silently
    // loosens an unrelated guarantee.
    const constraints = (await q.query(
      `SELECT conname AS name, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'public.cash_out_intents'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%MONIENAIJA%'`,
    )) as Array<{ name: string; def: string }>;
    for (const constraint of constraints) {
      await q.query(
        `ALTER TABLE public.cash_out_intents DROP CONSTRAINT "${constraint.name.replace(/"/g, '""')}"`,
      );
    }

    const named = (await q.query(
      `SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.cash_out_intents'::regclass AND conname = $1 LIMIT 1`,
      [SCOPE_CHECK],
    )) as unknown[];
    if (named.length === 0) {
      await q.query(
        `ALTER TABLE public.cash_out_intents ADD CONSTRAINT ${SCOPE_CHECK} CHECK (institution_scope ~ '${UUID_PATTERN}')`,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async down(): Promise<void> {
    // Forward-only correction: restoring the sentinel would silently invalidate every intent
    // written against a real institution, so the rollback is refused rather than applied.
    throw new Error('CashOutInstitutionalScope1785753600503 is forward-only');
  }
}
