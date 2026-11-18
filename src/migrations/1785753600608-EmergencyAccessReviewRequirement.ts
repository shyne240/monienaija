import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 21 — operational security: mandatory post-incident review for emergency access.
 *
 * ## What already exists, and why it was not enough
 *
 * Break-glass is well built in this codebase. `PrivilegedActionApprovalService.activateEmergencyAccess`
 * requires a `PRIVILEGED` principal at `MFA` assurance holding `privileged:break-glass`; the TTL is bounded
 * between `MIN_EMERGENCY_TTL_SECONDS` and `MAX_EMERGENCY_TTL_SECONDS`; expiry is enforced lazily on read
 * (`requiresExpiry` → `applyExpiry`); revocation is supported; and every transition writes both an audit row
 * and a security event.
 *
 * What was missing is the step after. Once an emergency window closed — by expiry or by revocation — **nothing
 * required anyone to look at what happened during it**. That is the single most common way a temporary
 * emergency grant becomes a permanent one: not by failing to expire, but by nobody ever asking what it was
 * used for.
 *
 * Concretely, before this migration these questions had no answer:
 *
 *   - Which emergency accesses were used to do anything, and what?
 *   - Which emergency accesses have never been reviewed?
 *   - How long did it take from window close to review?
 *
 * ## Why the database and not a dashboard flag
 *
 * A review requirement that lives only in a UI is advisory. Making it a column with a NOT NULL-on-close
 * rule means an unreviewed emergency access is a queryable fact, and the operations centre (Group 20) can
 * count it.
 *
 * ## Deliberately not a new authority
 *
 * This adds no new permission, no new principal type and no new grant path. Review is a **record-keeping
 * obligation attached to an existing privileged action**, not a capability. Inventing a `break-glass:review`
 * scope would be a security decision that is the product owner's to make.
 */
export class EmergencyAccessReviewRequirement1785753600608 implements MigrationInterface {
  name = 'EmergencyAccessReviewRequirement1785753600608';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE privileged_action_approvals
      ADD COLUMN IF NOT EXISTS emergency_review_status varchar(16),
      ADD COLUMN IF NOT EXISTS emergency_reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS emergency_reviewed_by varchar(160),
      ADD COLUMN IF NOT EXISTS emergency_review_notes varchar(1000),
      ADD COLUMN IF NOT EXISTS emergency_window_closed_at timestamptz`);

    /*
     * Only emergency rows carry review state. A non-emergency approval having a review status would be
     * meaningless and would make "unreviewed" queries ambiguous.
     */
    await q.query(`ALTER TABLE privileged_action_approvals
      ADD CONSTRAINT chk_emergency_review_only_for_emergency
      CHECK (
        (is_emergency = true)
        OR (
          emergency_review_status IS NULL
          AND emergency_reviewed_at IS NULL
          AND emergency_reviewed_by IS NULL
          AND emergency_review_notes IS NULL
          AND emergency_window_closed_at IS NULL
        )
      )`);

    await q.query(`ALTER TABLE privileged_action_approvals
      ADD CONSTRAINT chk_emergency_review_status
      CHECK (
        emergency_review_status IS NULL
        OR emergency_review_status IN ('PENDING_REVIEW', 'REVIEWED')
      )`);

    /*
     * A review is either absent or complete. A row marked REVIEWED with no reviewer and no timestamp would
     * let a review requirement be satisfied by setting a flag, which is exactly the failure mode this
     * column exists to prevent.
     */
    await q.query(`ALTER TABLE privileged_action_approvals
      ADD CONSTRAINT chk_emergency_review_complete
      CHECK (
        emergency_review_status IS DISTINCT FROM 'REVIEWED'
        OR (
          emergency_reviewed_at IS NOT NULL
          AND emergency_reviewed_by IS NOT NULL
          AND length(btrim(coalesce(emergency_review_notes, ''))) > 0
        )
      )`);

    /*
     * A review cannot precede the window it reviews. Without this, backdating a review is a one-line UPDATE,
     * and "reviewed within 24 hours" becomes unverifiable.
     */
    await q.query(`ALTER TABLE privileged_action_approvals
      ADD CONSTRAINT chk_emergency_review_after_window
      CHECK (
        emergency_reviewed_at IS NULL
        OR emergency_window_closed_at IS NULL
        OR emergency_reviewed_at >= emergency_window_closed_at
      )`);

    // The query the operations centre and any review report both need: unreviewed emergency access, oldest
    // window first. Partial, because reviewed and non-emergency rows are the overwhelming majority.
    await q.query(`CREATE INDEX idx_privileged_action_approvals_unreviewed_emergency
      ON privileged_action_approvals (emergency_window_closed_at)
      WHERE is_emergency = true AND emergency_review_status = 'PENDING_REVIEW'`);

    /*
     * Backfill: every emergency row whose window has already closed becomes PENDING_REVIEW.
     *
     * Existing rows are not silently marked reviewed — that would assert reviews that never happened. They
     * are marked as owing a review, which is the truthful state.
     */
    await q.query(`UPDATE privileged_action_approvals
        SET emergency_review_status = 'PENDING_REVIEW',
            emergency_window_closed_at = COALESCE(expires_at, cancelled_at, NOW())
      WHERE is_emergency = true
        AND emergency_review_status IS NULL
        AND status IN ('EMERGENCY_REVOKED', 'EXPIRED', 'CANCELLED', 'REJECTED')`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while any review record exists. Dropping the columns would erase the evidence of which
     * emergency accesses were reviewed, and — worse — a rollback followed by re-applying would mark
     * previously-reviewed incidents as owing review again, or previously-unreviewed ones as beyond scrutiny.
     * Review records are part of the security audit trail.
     */
    const rows: Array<{ n: string }> = await q.query(
      `SELECT count(*)::text AS n FROM privileged_action_approvals
        WHERE emergency_review_status IS NOT NULL OR emergency_reviewed_at IS NOT NULL`,
    );
    if (Number(rows[0]?.n ?? '0') > 0) {
      throw new Error(
        'Refusing to roll back: emergency access review records exist. They are part of the security audit ' +
          'trail and cannot be dropped by a schema rollback.',
      );
    }
    await q.query(`DROP INDEX IF EXISTS idx_privileged_action_approvals_unreviewed_emergency`);
    await q.query(
      `ALTER TABLE privileged_action_approvals DROP CONSTRAINT IF EXISTS chk_emergency_review_after_window`,
    );
    await q.query(
      `ALTER TABLE privileged_action_approvals DROP CONSTRAINT IF EXISTS chk_emergency_review_complete`,
    );
    await q.query(
      `ALTER TABLE privileged_action_approvals DROP CONSTRAINT IF EXISTS chk_emergency_review_status`,
    );
    await q.query(
      `ALTER TABLE privileged_action_approvals DROP CONSTRAINT IF EXISTS chk_emergency_review_only_for_emergency`,
    );
    await q.query(`ALTER TABLE privileged_action_approvals
      DROP COLUMN IF EXISTS emergency_review_status,
      DROP COLUMN IF EXISTS emergency_reviewed_at,
      DROP COLUMN IF EXISTS emergency_reviewed_by,
      DROP COLUMN IF EXISTS emergency_review_notes,
      DROP COLUMN IF EXISTS emergency_window_closed_at`);
  }
}
