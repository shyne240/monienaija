import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-ADMIN-AUTHORIZATION-RUNTIME-01
 *
 * The legacy A2 workforce bootstrap table (1785753600052-CreateA2WorkforceAuthenticationTables)
 * hard-codes a DB-level CHECK constraint restricting `a2_workforce_bootstrap_consumptions
 * .role_key` to the single literal value 'FINANCE_ADMIN'. This task renames the legacy
 * admin-slot role key from FINANCE_ADMIN to SUPER_ADMIN across the live runtime
 * (workforce-configuration.ts, finance-role-administration.service.ts,
 * local-admin-authentication.service.ts, etc.) — see
 * docs/V1/V1-ADMIN-AUTHORIZATION-RUNTIME-01-REPORT.md for the full rationale.
 *
 * Without this migration, every bootstrap consumption (the one-time offline admin-bootstrap
 * flow and the local-admin-authentication seeding path, both of which now mint a
 * 'SUPER_ADMIN' role-assignment row) would violate `chk_a2_workforce_bootstrap_role` and fail
 * closed with a DB error instead of succeeding as intended.
 *
 * This migration ONLY swaps the literal value enforced by the CHECK constraint. It does not
 * touch table shape, columns, indexes, triggers, or any other table (in particular it does
 * NOT touch the Foundation-01 authorization-catalogue tables created in
 * 1785753600083-CreateAuthorizationCatalogue, nor any financial/ledger table). It is
 * reversible: `down()` restores the original FINANCE_ADMIN-only constraint exactly.
 *
 * Data safety: at the time this migration is expected to run, no environment has yet
 * consumed a real bootstrap statement with this schema in a way that would be broken by
 * tightening the constraint back to a single literal (the constraint's shape — exactly one
 * allowed literal — is unchanged, only the literal itself changes), so no existing row can
 * violate the new constraint after this migration completes. If a future rollback ever needs
 * to run `down()` against an environment that already has a 'SUPER_ADMIN' row, that `down()`
 * will itself correctly fail closed (CHECK violation) rather than silently reinterpreting the
 * data — this is intentional: a true rollback of this rename must be handled operationally
 * with equal care, not papered over by a permissive migration.
 */
export class RenameWorkforceBootstrapRoleToSuperAdmin1785753600084 implements MigrationInterface {
  name = 'RenameWorkforceBootstrapRoleToSuperAdmin1785753600084';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE a2_workforce_bootstrap_consumptions DROP CONSTRAINT chk_a2_workforce_bootstrap_role`,
    );
    await q.query(
      `ALTER TABLE a2_workforce_bootstrap_consumptions ADD CONSTRAINT chk_a2_workforce_bootstrap_role CHECK(role_key='SUPER_ADMIN')`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE a2_workforce_bootstrap_consumptions DROP CONSTRAINT chk_a2_workforce_bootstrap_role`,
    );
    await q.query(
      `ALTER TABLE a2_workforce_bootstrap_consumptions ADD CONSTRAINT chk_a2_workforce_bootstrap_role CHECK(role_key='FINANCE_ADMIN')`,
    );
  }
}
