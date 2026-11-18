import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 23 — compliance register and audit evidence export.
 *
 * ## What already exists, and why it was not enough
 *
 * Compliance case management is substantive: `CustomerComplianceService` creates cases with severity,
 * category and assignment, records comments, evidence, per-field history and assignments, and the case
 * tables are guarded. `AuditService` writes an immutable trail — `audit_events` already has a
 * `BEFORE UPDATE OR DELETE` trigger, so the trail cannot be rewritten through the application or through
 * SQL.
 *
 * Three things were nonetheless missing, and each is a compliance-readiness question rather than a
 * feature request:
 *
 * 1. **No time-range evidence export.** `AuditService.list()` accepts `entityType`, `entityId`,
 *    `correlationId` and a row limit. It has **no date bound at all**. A regulator, auditor or dispute
 *    handler asking "show me everything that happened between these two dates" could not be answered
 *    through any interface, and `limit` caps at 1,000 rows, so the answer could not be assembled by
 *    widening a filter either. There is also no index on `occurred_at` alone — the existing indexes are
 *    `(entity_type, entity_id, occurred_at)`, `(correlation_id, occurred_at)` and `(created_at)` — so
 *    even a hand-written range query would seq-scan a table that grows without bound.
 * 2. **No record that an export happened.** Exporting the audit trail is itself a security-relevant act:
 *    it removes a copy of the trail from the system's control, often to someone outside it. There was no
 *    register of who took what, over what range, and when.
 * 3. **No case SLA or age visibility.** A case has `opened_at` and `closed_at` and nothing else. Whether
 *    cases are being resolved, or quietly ageing in `OPEN` forever, was not observable.
 *
 * ## The export is a bounded page, and the register is what makes it auditable
 *
 * An export over an unbounded range cannot be one response: the trail is append-only and large. The
 * design is a **keyset page** over `(occurred_at, id)`, with a cursor, and a hard row cap. That is not a
 * limitation to be worked around — it is what makes the export reproducible, resumable and impossible to
 * silently truncate. Each page request is recorded.
 *
 * ## What is deliberately NOT decided here
 *
 * - **No retention period.** Deleting audit rows is a policy decision with legal consequences and the
 *   table is deliberately immutable. Nothing in this migration permits deletion.
 * - **No legal hold flag.** A hold that the system does not enforce is worse than none; a hold that it
 *   *does* enforce would silently block a future retention job nobody asked for yet.
 * - **No statutory deadline.** `COMPLIANCE_CASE_SLA_HOURS` below is configuration with no default value.
 *   What the correct resolution deadline is for each category is a regulatory and product decision; the
 *   system reports age and breach against a configured number rather than inventing one.
 */
export class ComplianceRegister1785753600610 implements MigrationInterface {
  name = 'ComplianceRegister1785753600610';

  async up(q: QueryRunner): Promise<void> {
    /*
     * ---------------------------------------------------------------------------------------------
     * 1. Range-query support for the audit trail.
     * ---------------------------------------------------------------------------------------------
     * `occurred_at` is the event's business time; `created_at` is when the row landed. They are usually
     * within milliseconds, but an event backdated by a replay or a recovery can differ, and an evidence
     * query must be able to use the time the event *represents* while still being a single index scan.
     *
     * A DESC index because every query is "most recent first" or a bounded range read forward; DESC also
     * makes `ORDER BY occurred_at DESC, id DESC` a straight index walk, which is what the keyset pagination
     * needs to be able to resume from an arbitrary cursor.
     */
    await q.query(`CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
      ON audit_events (occurred_at DESC, id DESC)`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 2. Export register.
     * ---------------------------------------------------------------------------------------------
     * One row per page request. Not one row per export session: a session that stopped after page 3 must
     * not look like a complete export, and recording pages is the only way to see that it stopped.
     */
    await q.query(`CREATE TABLE compliance_audit_exports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Who asked. The principal that authorized the request, recorded as a string rather than a foreign
      -- key because workforce identities are not all rows in one table (operator, support, service).
      requested_by varchar(160) NOT NULL,
      -- The principal type, so "a SERVICE exported 40 pages at 3am" is distinguishable from a person.
      requester_type varchar(30) NOT NULL,
      -- The range asked for. Both bounds are required: an export with an open start would scan the whole
      -- table, and "give me everything ever" is an infrastructure request, not an evidence page.
      range_start timestamptz NOT NULL,
      range_end timestamptz NOT NULL,
      -- Optional narrowing that was actually applied, so the register describes the query rather than the
      -- intent. Null means unfiltered.
      entity_type varchar(120),
      entity_id varchar(200),
      -- The keyset cursor used for this page. Null on the first page. Keeping it makes a page reproducible:
      -- the same cursor over the same range yields the same rows, because the trail is append-only.
      cursor_occurred_at timestamptz,
      cursor_id uuid,
      -- What the page contained. Partial rows because a page may be the last one.
      row_count integer NOT NULL CHECK (row_count >= 0),
      first_occurred_at timestamptz,
      last_occurred_at timestamptz,
      -- The business reason. Required: an export with no stated purpose is exactly the act this register
      -- exists to make accountable, and "n/a" is a legitimate answer that a blank field is not.
      purpose varchar(500) NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(),
      CHECK (range_end > range_start),
      CHECK (length(btrim(purpose)) > 0),
      -- A cursor is an ordered pair; half a cursor cannot resume anything and must not be recorded as if it
      -- could. This also stops a caller from supplying an id-only cursor and silently re-exporting a page.
      CHECK ((cursor_occurred_at IS NULL) = (cursor_id IS NULL)),
      -- The page's reported bounds must lie inside the requested range. An export that reports rows outside
      -- the range it was asked for is a correctness failure, not a formatting one.
      CHECK (first_occurred_at IS NULL OR first_occurred_at >= range_start),
      CHECK (last_occurred_at IS NULL OR last_occurred_at <= range_end)
    )`);

    await q.query(`CREATE INDEX idx_compliance_audit_exports_recent
      ON compliance_audit_exports (requested_at DESC)`);
    /*
     * "Who has exported this customer's evidence" is the question an investigation actually asks. The
     * entity index makes it answerable without scanning every export ever made.
     */
    await q.query(`CREATE INDEX idx_compliance_audit_exports_subject
      ON compliance_audit_exports (entity_type, entity_id, requested_at DESC)
      WHERE entity_id IS NOT NULL`);

    /*
     * The register is itself evidence and must not be rewritten. Same reasoning as the audit trail: the
     * record of who exported what is worthless if it can be edited after the fact.
     */
    await q.query(`CREATE OR REPLACE FUNCTION reject_compliance_export_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'compliance_audit_exports is append-only; an export record cannot be altered or removed';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER compliance_audit_exports_immutable
      BEFORE UPDATE OR DELETE ON compliance_audit_exports
      FOR EACH ROW EXECUTE FUNCTION reject_compliance_export_mutation()`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 3. Case SLA configuration.
     * ---------------------------------------------------------------------------------------------
     * Hours per case category. **No rows are seeded**: the correct deadline for an AML case versus a
     * document case is a regulatory decision, and seeding a plausible-looking number would present an
     * invented policy as an implemented one. With no row, the system reports age and no breach, and says
     * which categories have no configured deadline.
     */
    await q.query(`CREATE TABLE compliance_case_sla (
      category varchar(30) PRIMARY KEY,
      -- Hours from open to resolution. Must be positive: a zero deadline would mark every case breached on
      -- creation and train everyone to ignore the signal.
      resolution_hours integer NOT NULL CHECK (resolution_hours > 0),
      -- Who set it and when. A deadline without an attributable owner is not a policy.
      configured_by varchar(160) NOT NULL,
      configured_at timestamptz NOT NULL DEFAULT now(),
      notes varchar(500)
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while export evidence exists.
     *
     * An export record proves that a copy of the audit trail left the system and who took it. Dropping the
     * register while such records exist would destroy the only evidence that the export happened — the same
     * reasoning as the break-glass and fraud rollbacks.
     */
    const rows = (await q.query(
      `SELECT count(*)::int AS n FROM compliance_audit_exports`,
    )) as Array<{ n: number }>;
    const exports = rows[0]?.n ?? 0;
    if (exports > 0) {
      throw new Error(
        `Refusing to roll back ComplianceRegister1785753600610: ${exports} audit export record(s) exist. ` +
          'Dropping this table would destroy the evidence that a copy of the audit trail was taken and by whom.',
      );
    }

    await q.query(
      `DROP TRIGGER IF EXISTS compliance_audit_exports_immutable ON compliance_audit_exports`,
    );
    await q.query(`DROP FUNCTION IF EXISTS reject_compliance_export_mutation()`);
    await q.query(`DROP TABLE IF EXISTS compliance_case_sla`);
    await q.query(`DROP TABLE IF EXISTS compliance_audit_exports`);
    await q.query(`DROP INDEX IF EXISTS idx_audit_events_occurred_at`);
  }
}
