import type { DataSource } from 'typeorm';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

/**
 * MIGRATION IDENTITY COORDINATION — the upgrade path for a database that already applied this PR's
 * attribution migration under its superseded identity.
 *
 * `AgentApplicationSubmitterAttribution` first shipped as timestamp 1785753600806, colliding with
 * `DurableInboundIdentity1785753600806` in the concurrent transaction-history PR. This PR's migration
 * moved; the other did not.
 *
 * The danger is NOT a duplicate key in `typeorm_migrations` — TypeORM decides what is pending by
 * migration NAME, not timestamp (see `MigrationExecutor.executePendingMigrations`). A database that
 * recorded the old name therefore looks to TypeORM like it has never run the new one, and TypeORM
 * WILL re-execute it. A non-idempotent `ADD COLUMN` would then abort every such upgrade. These
 * tests pin both halves of the fix: the migration is re-runnable, and it retires the stale ledger
 * row so the readiness inventory can come back clean.
 */
describe('Agent application submitter attribution — identity renumber upgrade (real PostgreSQL)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createIntegrationDataSourceFromScratch('migrenum');
    if (ds.options.type !== 'postgres') throw new Error('Expected PostgreSQL');
  }, 180_000);

  afterAll(async () => {
    if (ds) await destroyIntegrationDataSource(ds);
  }, 60_000);

  const OLD_TIMESTAMP = 1785753600806;
  const OLD_NAME = 'AgentApplicationSubmitterAttribution1785753600806';
  const NEW_TIMESTAMP = 1785753600809;
  const NEW_NAME = 'AgentApplicationSubmitterAttribution1785753600809';

  it('ships the coordinated identity, and leaves the contested slot to the other PR', () => {
    // The loaded entries expose `name`; the identity suffix is the authoritative timestamp (it is
    // what TypeORM records in `typeorm_migrations`), so read it back off the name rather than
    // relying on instance fields the interface does not guarantee.
    const loaded = (ds.migrations as unknown as Array<{ name?: string }>).map(
      (migration) => migration.name ?? '',
    );
    expect(loaded).toContain(NEW_NAME);
    // 1785753600806 belongs exclusively to DurableInboundIdentity in the other PR. Nothing loaded
    // here — not this PR's migration under its superseded name, and not a copy of the other PR's
    // migration pulled in to make a combined test pass — may occupy that slot.
    expect(loaded).not.toContain(OLD_NAME);
    expect(loaded.filter((entry) => entry.endsWith(String(OLD_TIMESTAMP)))).toHaveLength(0);
    // 1785753600807 is the other PR's funding-scope capture, and 1785753600808 is the deliberate
    // buffer slot. Neither may be claimed here either.
    for (const reserved of [1785753600807, 1785753600808]) {
      expect(loaded.filter((entry) => entry.endsWith(String(reserved)))).toHaveLength(0);
    }
  });

  /**
   * Rewind the database to look exactly like an install that took the old identity: the column,
   * index and trigger are absent, and the ledger records only the superseded name.
   */
  async function rewindToOldIdentity(): Promise<void> {
    await ds.query(
      `DROP TRIGGER IF EXISTS agent_application_submitter_immutable ON agent_applications`,
    );
    await ds.query(`DROP FUNCTION IF EXISTS reject_agent_application_submitter_mutation()`);
    await ds.query(`DROP INDEX IF EXISTS idx_agent_applications_submitted_by`);
    await ds.query(`ALTER TABLE agent_applications DROP COLUMN IF EXISTS submitted_by`);
    await ds.query(`DELETE FROM typeorm_migrations WHERE timestamp = $1`, [NEW_TIMESTAMP]);
    await ds.query(`INSERT INTO typeorm_migrations (timestamp, name) VALUES ($1, $2)`, [
      OLD_TIMESTAMP,
      OLD_NAME,
    ]);
  }

  it('re-runs cleanly on an installation that applied the superseded identity', async () => {
    await rewindToOldIdentity();
    // Precondition: the stale row is present and the schema does NOT have the column.
    const before: Array<{ name: string }> = await ds.query(
      `SELECT name FROM typeorm_migrations WHERE timestamp = $1`,
      [OLD_TIMESTAMP],
    );
    expect(before.map((row) => row.name)).toEqual([OLD_NAME]);
    const columnBefore: Array<{ n: number }> = await ds.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name='agent_applications' AND column_name='submitted_by'`,
    );
    expect(columnBefore[0]!.n).toBe(0);

    // TypeORM sees the NEW name as pending (it matches on name) and executes it.
    const executed = await ds.runMigrations({ transaction: 'all' });
    expect(executed.map((migration) => migration.name)).toContain(NEW_NAME);

    const columnAfter: Array<{ n: number }> = await ds.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name='agent_applications' AND column_name='submitted_by'`,
    );
    expect(columnAfter[0]!.n).toBe(1);
    const indexAfter: Array<{ n: number }> = await ds.query(
      `SELECT count(*)::int AS n FROM pg_indexes
        WHERE tablename='agent_applications' AND indexname='idx_agent_applications_submitted_by'`,
    );
    expect(indexAfter[0]!.n).toBe(1);
    const triggerAfter: Array<{ n: number }> = await ds.query(
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgname='agent_application_submitter_immutable'
          AND tgrelid='agent_applications'::regclass`,
    );
    expect(triggerAfter[0]!.n).toBe(1);

    // The superseded ledger row is retired: leaving it would report a loaded-inventory mismatch.
    const stale: Array<{ name: string }> = await ds.query(
      `SELECT name FROM typeorm_migrations WHERE timestamp = $1`,
      [OLD_TIMESTAMP],
    );
    expect(stale).toHaveLength(0);
    const fresh: Array<{ name: string }> = await ds.query(
      `SELECT name FROM typeorm_migrations WHERE timestamp = $1`,
      [NEW_TIMESTAMP],
    );
    expect(fresh.map((row) => row.name)).toEqual([NEW_NAME]);
  });

  it('leaves the immutability guard working after the re-run', async () => {
    // Attribution must still be write-once, or a self-approval could be laundered post-upgrade.
    // A class is required by the FK, and the database is empty of business rows by design.
    const classes: Array<{ id: string }> = await ds.query(
      `INSERT INTO agent_classes (reference, code, name, description, is_active, requirements,
                                  required_document_categories, applicable_services, applicable_limits)
       VALUES ('CLS-RENUM', 'RENUM_1', 'Renumber fixture', 'identity upgrade fixture', TRUE,
               '{}'::jsonb, '[]'::jsonb, '["CASH_IN"]'::jsonb, '{}'::jsonb)
       RETURNING id`,
    );
    await ds.query(
      `INSERT INTO agent_applications
         (id, reference, agent_class_id, status, applicant_reference, created_by, submitted_by, submitted_at)
       VALUES (gen_random_uuid(), 'AGENT-APP-RENUM-1', $2, 'SUBMITTED', 'renum-fixture',
               'agent-application:renum', $1, NOW())`,
      ['https://idp.example.com:submitter-renum', classes[0]!.id],
    );
    await expect(
      ds.query(
        `UPDATE agent_applications SET submitted_by = 'someone-else' WHERE reference = 'AGENT-APP-RENUM-1'`,
      ),
    ).rejects.toThrow(/immutable/i);
    // A NULL -> value transition stays allowed: that is how a legacy row is honestly re-attributed
    // by resubmission, never by an in-place edit of an existing value.
    await expect(
      ds.query(
        `UPDATE agent_applications SET submitted_by = NULL WHERE reference = 'AGENT-APP-RENUM-1'`,
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('is a no-op on a clean install that never saw the old identity', async () => {
    // Fresh database: applying the full chain already succeeded in beforeAll. Re-running with
    // nothing pending must execute nothing and leave exactly one identity for this migration.
    const pending = await ds.runMigrations({ transaction: 'all' });
    expect(pending).toHaveLength(0);
    const rows: Array<{ n: number }> = await ds.query(
      `SELECT count(*)::int AS n FROM typeorm_migrations WHERE timestamp = $1`,
      [NEW_TIMESTAMP],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
