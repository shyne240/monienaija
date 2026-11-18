import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 18 — durable integrity snapshots.
 *
 * ## What already exists, and why it was not enough
 *
 * The ledger is protected at write time by database triggers (`assert_ledger_journal_balanced`,
 * `reject_ledger_mutation`), and `ReconciliationService` runs eleven cross-table integrity checks. That
 * coverage is real. It is also **stateless**: `runReconciliation()` returns a report and persists nothing.
 *
 * Three consequences followed, and they are the reason this migration exists:
 *
 * 1. **No history.** "Was the ledger balanced yesterday, and when did it stop being balanced?" was
 *    unanswerable. A problem noticed today could have begun three weeks ago.
 * 2. **No drift detection.** A check that is `FAIL` today and `FAIL` yesterday is a known, stable problem.
 *    The same check flipping from `PASS` to `FAIL` between two runs is a new incident and is far more
 *    urgent. Without stored results the two are indistinguishable.
 * 3. **No record of *when* it last passed.** A readiness probe runs the checks, but if the probe is not
 *    being called — or the service is restarting — nothing records that integrity went unverified.
 *
 * ## Why a snapshot table and not a log
 *
 * Each run is one row plus one row per check. That makes the common query — "the latest state of every
 * check" and "when did each check last pass" — a single indexed scan, rather than a window function over an
 * unbounded event log. Retention can then delete whole runs.
 *
 * ## Deliberately append-only
 *
 * There is no UPDATE path. A snapshot is evidence of what was observed at a moment; rewriting it would
 * destroy exactly the property that makes drift visible.
 */
export class IntegritySnapshots1785753600607 implements MigrationInterface {
  name = 'IntegritySnapshots1785753600607';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE integrity_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- When the checks were executed. Application clock, recorded at collection time.
      observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- Aggregate outcome across all checks in this run. ERROR is the failing verdict, matching
      -- VerificationStatus in the reconciliation types; there is no separate FAIL value.
      status varchar(16) NOT NULL CHECK (status IN ('PASS', 'WARNING', 'ERROR')),
      -- How long the run took, so a degrading run is visible before it fails outright.
      duration_ms integer NOT NULL CHECK (duration_ms >= 0),
      -- Which process observed it. Nullable because a batch job may have no worker identity.
      observer varchar(160)
    )`);

    await q.query(`CREATE TABLE integrity_check_results (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL,
      check_name varchar(120) NOT NULL,
      status varchar(16) NOT NULL CHECK (status IN ('PASS', 'WARNING', 'ERROR')),
      -- Row/entity counts that drove the verdict. Kept because "3 mismatches" and "3000 mismatches" call for
      -- very different responses, and a bare FAIL loses that.
      finding_count integer NOT NULL DEFAULT 0 CHECK (finding_count >= 0),
      -- Bounded, redacted detail. Never a raw row dump: this table is read by operators and exported to
      -- metrics, and a ledger row can carry an account identifier.
      detail varchar(500),
      CONSTRAINT fk_integrity_check_results_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES integrity_snapshots(id) ON DELETE RESTRICT,
      CONSTRAINT uq_integrity_check_results_name UNIQUE (snapshot_id, check_name)
    )`);

    // "Latest state of every check" and "when did this check last pass".
    await q.query(`CREATE INDEX idx_integrity_check_results_name
      ON integrity_check_results (check_name, status)`);
    await q.query(`CREATE INDEX idx_integrity_snapshots_observed
      ON integrity_snapshots (observed_at DESC)`);

    /*
     * Append-only enforcement at the database, not only by convention.
     *
     * The service has no UPDATE path, but "the code does not do it" is a weaker guarantee than "the database
     * refuses it" — and this table is the evidence used to decide whether a drift is new.
     */
    await q.query(`CREATE OR REPLACE FUNCTION reject_integrity_snapshot_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Integrity snapshots are append-only'
          USING ERRCODE = 'restrict_violation';
      END;
      $$`);
    await q.query(`CREATE TRIGGER integrity_snapshots_append_only
      BEFORE UPDATE OR DELETE ON integrity_snapshots
      FOR EACH ROW EXECUTE FUNCTION reject_integrity_snapshot_mutation()`);
    await q.query(`CREATE TRIGGER integrity_check_results_append_only
      BEFORE UPDATE OR DELETE ON integrity_check_results
      FOR EACH ROW EXECUTE FUNCTION reject_integrity_snapshot_mutation()`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Dropping these tables destroys the integrity history — the only evidence of when each check last
     * passed. That is exactly the data an incident review needs, so the rollback refuses while any snapshot
     * exists rather than silently deleting the audit trail.
     */
    const rows: Array<{ n: string }> = await q.query(
      `SELECT count(*)::text AS n FROM integrity_snapshots`,
    );
    if (Number(rows[0]?.n ?? '0') > 0) {
      throw new Error(
        'Refusing to roll back: integrity snapshots exist. Dropping them would erase the record of when ' +
          'each integrity check last passed. Archive them first.',
      );
    }
    await q.query(
      `DROP TRIGGER IF EXISTS integrity_check_results_append_only ON integrity_check_results`,
    );
    await q.query(`DROP TRIGGER IF EXISTS integrity_snapshots_append_only ON integrity_snapshots`);
    await q.query(`DROP FUNCTION IF EXISTS reject_integrity_snapshot_mutation()`);
    await q.query(`DROP TABLE IF EXISTS integrity_check_results`);
    await q.query(`DROP TABLE IF EXISTS integrity_snapshots`);
  }
}
