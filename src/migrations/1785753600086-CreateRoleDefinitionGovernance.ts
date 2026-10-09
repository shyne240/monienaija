import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01
 *
 * Adds a governed, configuration-driven workflow for creating and modifying
 * `authorization_roles` rows and their `authorization_role_functions` grants
 * without a source-code change, per:
 *   - docs/V1/V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-01.md (if present)
 *   - docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md
 *   - docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md
 *
 * This migration is purely additive:
 *   1. `authorization_roles.definition_version` — an optimistic-concurrency
 *      token, incremented on every successful MODIFY apply, so a proposal
 *      created against a stale snapshot of a role can be detected and
 *      refused at apply time (see RoleDefinitionGovernanceService).
 *   2. A structural CHECK constraint on `authorization_roles`: any role that
 *      is NOT `is_system_seeded = TRUE` may never hold
 *      `administrative_capability = TRUE` or `finance_role_class = TRUE`.
 *      This is enforced at the database layer regardless of application
 *      code correctness — the governed role-definition workflow never sets
 *      either flag, and this constraint makes that a structural guarantee,
 *      not merely an application-level promise. The eleven V1-seeded roles
 *      (is_system_seeded = TRUE) are completely unaffected.
 *   3. `role_definition_proposals` — the maker/checker proposal ledger for
 *      the new workflow. A proposal never mutates `authorization_roles` /
 *      `authorization_role_functions` directly; only an atomic "apply" step
 *      taken after independent approval does that (application-layer
 *      concern, not expressed here).
 *
 * This migration creates schema only — no seed data, consistent with the
 * 1785753600083 convention.
 */
export class CreateRoleDefinitionGovernance1785753600086 implements MigrationInterface {
  name = 'CreateRoleDefinitionGovernance1785753600086';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `workforce.role.create`/`workforce.role.modify` already exist as catalogue rows (seeded by
    // V1-ADMIN-AUTHORIZATION-FOUNDATION-01 as FUTURE/non-assignable, per Decision 10). This
    // governance implementation turns them into real, assignable, IMPLEMENTED functions.
    // `AuthorizationCatalogueSeedService` only INSERTS missing rows — it never updates an existing
    // row's columns — so on any environment where the catalogue has already been seeded (every
    // environment this has previously run in, including this one), flipping the TypeScript seed
    // values alone would not change the already-persisted rows. This explicit UPDATE is the
    // migration-layer half of that change; it is a safe no-op on a brand-new database where the
    // seed has not run yet (zero rows match), and the authoritative fix on any database where it
    // already has.
    await queryRunner.query(`
      UPDATE authorization_functions
      SET
        v1_status = 'IMPLEMENTED',
        assignable = TRUE,
        notes = CASE function_code
          WHEN 'workforce.role.create' THEN 'Decision 10: dual-control governance. Implemented by V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 via RoleDefinitionGovernanceService: SUPER_ADMIN holds this as INITIATE, FINANCE_CONTROLLER holds it as APPROVE. Not assigned to ADMINISTRATOR or any other role.'
          WHEN 'workforce.role.modify' THEN 'Decision 10: dual-control governance. Implemented by V1-ADMIN-ROLE-DEFINITION-GOVERNANCE-IMPLEMENTATION-01 via RoleDefinitionGovernanceService; only ever targets roles created through that same workflow (is_system_seeded = FALSE) — the eleven V1-seeded roles are immutable through this path. SUPER_ADMIN holds this as INITIATE, FINANCE_CONTROLLER holds it as APPROVE. Not assigned to ADMINISTRATOR or any other role.'
        END
      WHERE function_code IN ('workforce.role.create', 'workforce.role.modify')
    `);

    await queryRunner.query(`
      ALTER TABLE authorization_roles
      ADD COLUMN definition_version INTEGER NOT NULL DEFAULT 1
    `);

    // Structural backstop: a role created/modified through the governed
    // workflow (is_system_seeded = FALSE) can never acquire SUPER_ADMIN's
    // administrative-capability classification or Finance-role-class
    // membership, regardless of what the application layer does or fails to
    // validate. The eleven existing seeded rows are all is_system_seeded =
    // TRUE, so this is backward-compatible with no data changes required.
    await queryRunner.query(`
      ALTER TABLE authorization_roles
      ADD CONSTRAINT chk_authorization_roles_non_seeded_no_elevated_class
      CHECK (is_system_seeded = TRUE OR (administrative_capability = FALSE AND finance_role_class = FALSE))
    `);

    await queryRunner.query(`
      CREATE TABLE role_definition_proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_type VARCHAR(10) NOT NULL CHECK (proposal_type IN ('CREATE','MODIFY')),
        target_role_key VARCHAR(100) NOT NULL,
        proposed_display_name VARCHAR(160) NOT NULL,
        proposed_description VARCHAR(500) NOT NULL,
        proposed_read_only BOOLEAN NOT NULL DEFAULT FALSE,
        proposed_function_grants JSONB NOT NULL,
        deactivate BOOLEAN NOT NULL DEFAULT FALSE,
        expected_definition_version INTEGER,
        prior_snapshot JSONB,
        action_fingerprint CHAR(64) NOT NULL,
        approval_id UUID REFERENCES privileged_action_approvals (id) ON DELETE RESTRICT,
        applied_role_id UUID REFERENCES authorization_roles (id) ON DELETE RESTRICT,
        proposer_principal_id VARCHAR(160) NOT NULL,
        proposer_session_id UUID,
        reason VARCHAR(500) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','EXPIRED','CANCELLED','APPLIED','APPLY_FAILED')),
        decided_by VARCHAR(160),
        decided_at TIMESTAMPTZ,
        decision_reason VARCHAR(500),
        applied_by VARCHAR(160),
        applied_at TIMESTAMPTZ,
        apply_failure_reason VARCHAR(500),
        correlation_id VARCHAR(100),
        requested_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_role_definition_proposals_expected_version
          CHECK (
            (proposal_type = 'CREATE' AND expected_definition_version IS NULL)
            OR (proposal_type = 'MODIFY' AND expected_definition_version IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_role_definition_proposals_target_role_key ON role_definition_proposals (target_role_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_role_definition_proposals_status ON role_definition_proposals (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_role_definition_proposals_proposer ON role_definition_proposals (proposer_principal_id)`,
    );
    // At most one proposal may be "in flight" (REQUESTED or APPROVED, i.e.
    // not yet applied/rejected/expired/cancelled/failed) per target role key
    // at a time. This is the DB-enforced half of "duplicate/concurrent
    // proposals for the same role cannot both exist" — the other half
    // (expected_definition_version optimistic-concurrency check at apply
    // time) is enforced in the application layer because it depends on
    // comparing against the live `authorization_roles.definition_version`.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_role_definition_proposals_in_flight
      ON role_definition_proposals (target_role_key)
      WHERE status IN ('REQUESTED','APPROVED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS role_definition_proposals`);
    await queryRunner.query(
      `ALTER TABLE authorization_roles DROP CONSTRAINT IF EXISTS chk_authorization_roles_non_seeded_no_elevated_class`,
    );
    await queryRunner.query(`ALTER TABLE authorization_roles DROP COLUMN IF EXISTS definition_version`);
  }
}
