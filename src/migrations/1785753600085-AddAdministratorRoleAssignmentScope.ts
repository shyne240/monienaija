import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01
 *
 * Implements the structural (database-enforced) half of
 * `docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md` Decision 2.
 *
 * `a2_finance_role_assignments.role_key` (migration 1785753600052) has no foreign key to
 * `authorization_roles` — the two tables are structurally disconnected, so the existing
 * `fn_authorization_enforce_finance_class_restriction()` trigger pattern (which governs
 * `authorization_role_functions`, a different table entirely) cannot be reused unmodified here.
 * This migration reproduces the same class of guarantee — "a role-class allow-list enforced by
 * PostgreSQL itself, not merely by application code" — in a simpler, self-contained form: a new
 * `initiated_scope` column plus a `CHECK` constraint, both confined to this one table.
 *
 * `initiated_scope` is set once at INSERT time by `A2FinanceRoleAdministrationService` and never
 * updated afterwards:
 *   - `'SUPER_ADMIN_SCOPE'` — every assignment made through the existing, unchanged
 *     SUPER_ADMIN-initiated paths (the one-time bootstrap ceremony, the local-dev-only grant
 *     helper, and the existing FINANCE_ROLE_ASSIGN/REVOKE maker/checker flow, which now also
 *     covers the ADMINISTRATOR role itself). No new restriction applies to these rows — SUPER_ADMIN
 *     "retains unrestricted use of all role-assignment actions" per the approved decision.
 *   - `'ADMINISTRATOR_SCOPE'` — every assignment made through the new, dedicated
 *     ADMINISTRATOR-initiated operational-role action. The `chk_administrator_scope_role_allowlist`
 *     constraint below makes it physically impossible for a row tagged this way to ever name
 *     `SUPER_ADMIN` or any `FINANCE_*` role, regardless of maker/checker-rule misconfiguration,
 *     an application bug, or direct SQL access — the same structural guarantee class as the
 *     existing `finance_class_restricted` trigger, just self-contained to one table.
 *
 * Existing rows (none in a fresh deployment; any pre-existing rows in an already-running
 * deployment were all written by a SUPER_ADMIN-initiated path, since no other path existed before
 * this task) backfill to `'SUPER_ADMIN_SCOPE'` via the column default — a safe, truthful default
 * that changes no existing behavior.
 */
export class AddAdministratorRoleAssignmentScope1785753600085 implements MigrationInterface {
  name = 'AddAdministratorRoleAssignmentScope1785753600085';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE a2_finance_role_assignments ADD COLUMN initiated_scope VARCHAR(32) NOT NULL DEFAULT 'SUPER_ADMIN_SCOPE'`,
    );
    await queryRunner.query(`
      ALTER TABLE a2_finance_role_assignments
        ADD CONSTRAINT chk_a2_finance_assignment_initiated_scope
        CHECK (initiated_scope IN ('SUPER_ADMIN_SCOPE','ADMINISTRATOR_SCOPE'))
    `);
    await queryRunner.query(`
      ALTER TABLE a2_finance_role_assignments
        ADD CONSTRAINT chk_administrator_scope_role_allowlist
        CHECK (
          initiated_scope <> 'ADMINISTRATOR_SCOPE'
          OR role_key IN ('OPERATIONS', 'AGENT_NETWORK_MANAGER', 'COMPLIANCE', 'RISK_FRAUD', 'CUSTOMER_SERVICE', 'TREASURY')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE a2_finance_role_assignments DROP CONSTRAINT IF EXISTS chk_administrator_scope_role_allowlist`,
    );
    await queryRunner.query(
      `ALTER TABLE a2_finance_role_assignments DROP CONSTRAINT IF EXISTS chk_a2_finance_assignment_initiated_scope`,
    );
    await queryRunner.query(
      `ALTER TABLE a2_finance_role_assignments DROP COLUMN IF EXISTS initiated_scope`,
    );
  }
}
