import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separates "who submitted this application" from "what created the row".
 *
 * `created_by` cannot answer the approval question. Workforce drafts are created through the public
 * applicant endpoint, which attributes the row to the application itself
 * (`agent-application:<id>`) because the console has no field to declare a submitter. So every
 * pre-existing row is unattributed with respect to review, and independence cannot be inferred from
 * it without guessing.
 *
 * `submitted_by` is the workforce principal that submitted (or, for genuine public applicants, the
 * public applicant principal). It is written on submission and is immutable thereafter, so an
 * approver can always be compared against the person whose submission is being decided.
 *
 * Deliberately NO backfill: inferring a submitter for historical rows would invent exactly the
 * evidence the guard exists to check. Historical rows stay NULL and are handled explicitly.
 *
 * IDENTITY COORDINATION. This migration originally shipped as 1785753600806 in this PR, which
 * collided with `1785753600806-DurableInboundIdentity` in the transaction-history PR. Both PRs are
 * open against the same integration branch and neither identity had been published to a real
 * environment, so EXACTLY ONE of them had to move.
 *
 * This one moved, for two reasons:
 *   1. Ordering. This PR is already the successor of 1785753600807 (CaptureCustomerFundingScope, in
 *      the other PR). Landing later means landing AFTER 0807, never before it. Renumbering upward
 *      keeps this PR's migration last in the chain; renumbering the other PR downward would not
 *      solve the collision at all, only invert it.
 *   2. Published state. See docs/migrations/MIGRATION-IDENTITY-COORDINATION.md for the upgrade path
 *      an installation that already applied the old 0806 identity needs to follow — it is not a
 *      no-op and must not be handled by hand.
 *
 * The identity is otherwise unchanged: same column, same trigger, same no-backfill rule.
 */
export class AgentApplicationSubmitterAttribution1785753600809 implements MigrationInterface {
  name = 'AgentApplicationSubmitterAttribution1785753600809';

  /**
   * Concurrency guard. Readiness and the migration runner both take this lock, and two application
   * instances starting at once must not race the column/index/trigger creation below.
   */
  private static readonly LOCK_KEY = 4874200919;

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `SELECT pg_advisory_xact_lock(${AgentApplicationSubmitterAttribution1785753600809.LOCK_KEY})`,
    );

    /*
     * IDEMPOTENT BY NECESSITY, not by habit.
     *
     * TypeORM decides what is pending by matching migration NAME, not timestamp. An installation
     * that already applied this migration under its former identity
     * (`AgentApplicationSubmitterAttribution1785753600806`) therefore looks like it has never run
     * this one, and TypeORM will execute it again. A bare ADD COLUMN would abort that upgrade.
     *
     * So every step is conditional on the object not already existing. On a database that took the
     * old identity these are all no-ops, and the schema ends up identical either way.
     */
    await q.query(
      `ALTER TABLE agent_applications ADD COLUMN IF NOT EXISTS submitted_by varchar(160)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_agent_applications_submitted_by ON agent_applications (submitted_by)`,
    );
    // Immutability: whichever principal submitted the application is the one an approver must
    // differ from. Rewriting it after the fact would launder a self-approval.
    await q.query(
      `CREATE OR REPLACE FUNCTION reject_agent_application_submitter_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF OLD.submitted_by IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
           RAISE EXCEPTION 'agent application submitter attribution is immutable';
         END IF;
         RETURN NEW;
       END $$`,
    );
    // `CREATE TRIGGER IF NOT EXISTS` needs PG14+; test the catalogue so the upgrade is version-safe.
    await q.query(
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_trigger
            WHERE tgname = 'agent_application_submitter_immutable'
              AND tgrelid = 'agent_applications'::regclass
         ) THEN
           CREATE TRIGGER agent_application_submitter_immutable
           BEFORE UPDATE ON agent_applications FOR EACH ROW
           EXECUTE FUNCTION reject_agent_application_submitter_mutation();
         END IF;
       END $$`,
    );

    /*
     * Retire the superseded ledger row. Leaving it would fail the readiness inventory twice over:
     * `AgentApplicationSubmitterAttribution1785753600806` is no longer a loaded migration
     * (reported as `unexpected`) while this identity would appear to be at the wrong timestamp.
     * Only the collision's own row is touched — no other identity is modified.
     */
    await q.query(
      `DELETE FROM typeorm_migrations
        WHERE timestamp = 1785753600806
          AND name = 'AgentApplicationSubmitterAttribution1785753600806'`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard Agent application submitter attribution'));
  }
}
