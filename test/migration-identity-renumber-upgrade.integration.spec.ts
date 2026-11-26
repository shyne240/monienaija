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
  // The slot's rightful owners, from the transaction-history PR. Named here so the assertions can
  // tell "the other PR's migration is present" (correct once that PR lands) from "this PR claimed
  // the slot" (the defect being prevented).
  const OTHER_0806_NAME = 'DurableInboundIdentity1785753600806';
  const OTHER_0807_NAME = 'CaptureCustomerFundingScope1785753600807';

  it('ships the coordinated identity, and leaves the contested slot to the other PR', () => {
    // The loaded entries expose `name`; the identity suffix is the authoritative timestamp (it is
    // what TypeORM records in `typeorm_migrations`), so read it back off the name rather than
    // relying on instance fields the interface does not guarantee.
    const loaded = (ds.migrations as unknown as Array<{ name?: string }>).map(
      (migration) => migration.name ?? '',
    );
    expect(loaded).toContain(NEW_NAME);
    /*
     * 1785753600806 belongs exclusively to `DurableInboundIdentity` in the transaction-history PR.
     * This branch must never occupy it — not under the superseded name, and not by pulling a copy of
     * the other PR's migration in to make a combined test pass.
     *
     * The assertion is written against the SLOT'S OWNER rather than against emptiness, because
     * emptiness is only true while this branch is measured alone. Once the other PR lands, its
     * migration legitimately occupies 0806 and 0807 in the same tree; asserting "nothing ends with
     * 0806" would then fail on a correct, fully coordinated integration — turning this guard into a
     * merge blocker for the exact end state it exists to allow.
     */
    expect(loaded).not.toContain(OLD_NAME);
    for (const occupant of loaded.filter((entry) => entry.endsWith(String(OLD_TIMESTAMP)))) {
      expect(occupant).toBe(OTHER_0806_NAME);
    }
    for (const occupant of loaded.filter((entry) => entry.endsWith('1785753600807'))) {
      expect(occupant).toBe(OTHER_0807_NAME);
    }
    // 1785753600808 stays empty: the deliberate buffer slot between the two PRs.
    expect(loaded.filter((entry) => entry.endsWith('1785753600808'))).toHaveLength(0);
  });

  it('never loads two identities for the 1785753600806 slot at the same time', () => {
    // The collision this whole coordination exists for: two DIFFERENT migrations under one
    // timestamp. TypeORM records timestamp and name, so a duplicated timestamp can be applied twice
    // and only the name disambiguates them. Scoped to 0806 because it is the one contested slot.
    const occupants = (ds.migrations as unknown as Array<{ name?: string }>)
      .map((migration) => migration.name ?? '')
      .filter((entry) => entry.endsWith(String(OLD_TIMESTAMP)));
    expect(occupants.length).toBeLessThanOrEqual(1);
    if (occupants.length === 1) expect(occupants[0]).toBe(OTHER_0806_NAME);
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
    await ds.query(`DELETE FROM typeorm_migrations WHERE timestamp = $1 AND name = $2`, [
      NEW_TIMESTAMP,
      NEW_NAME,
    ]);
    await ds.query(`INSERT INTO typeorm_migrations (timestamp, name) VALUES ($1, $2)`, [
      OLD_TIMESTAMP,
      OLD_NAME,
    ]);
  }

  it('re-runs cleanly on an installation that applied the superseded identity', async () => {
    await rewindToOldIdentity();
    // Precondition: the stale row is present and the schema does NOT have the column.
    /*
     * Scoped by timestamp AND name. The 0806 slot is legitimately occupied by the transaction-history
     * PR's `DurableInboundIdentity` once that PR lands, so a timestamp-only read returns two rows on a
     * combined tree and this precondition would fail on a correct integration. The subject here is
     * this PR's superseded identity, not whatever else the slot holds.
     */
    const before: Array<{ name: string }> = await ds.query(
      `SELECT name FROM typeorm_migrations WHERE timestamp = $1 AND name = $2`,
      [OLD_TIMESTAMP, OLD_NAME],
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
      `SELECT name FROM typeorm_migrations WHERE timestamp = $1 AND name = $2`,
      [OLD_TIMESTAMP, OLD_NAME],
    );
    expect(stale).toHaveLength(0);
    const fresh: Array<{ name: string }> = await ds.query(
      `SELECT name FROM typeorm_migrations WHERE timestamp = $1 AND name = $2`,
      [NEW_TIMESTAMP, NEW_NAME],
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
      `SELECT count(*)::int AS n FROM typeorm_migrations WHERE timestamp = $1 AND name = $2`,
      [NEW_TIMESTAMP, NEW_NAME],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
