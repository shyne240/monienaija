import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-SECURITY-SUPER-ADMIN-RECOVERY-01
 *
 * Creates the one-time consumption ledger for the protected SUPER_ADMIN recovery/revocation
 * ceremony (docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md §3). Structural twin of
 * `a2_workforce_bootstrap_consumptions` (migration 1785753600052): a unique `nonce` column is
 * the DB-enforced replay/concurrency guard — two attempts to consume the same signed statement,
 * sequential or concurrent, can never both succeed, because the second INSERT into this table
 * fails the unique constraint and the whole enclosing transaction (including any assignment/
 * session mutation already staged in it) rolls back.
 *
 * This table does NOT modify `a2_finance_role_assignments` or `a2_workforce_sessions` in any way
 * — SuperAdminRecoveryService updates those existing tables' existing columns (`status`,
 * `revoked_by`, `revoked_at` / `status`, `revoked_at`, `revoke_reason`) exactly as the existing
 * `revokeOperational()`/`revoke()` paths already do, so no new migration is needed for them.
 */
export class CreateSuperAdminRecoveryConsumptions1785753600088 implements MigrationInterface {
  name = 'CreateSuperAdminRecoveryConsumptions1785753600088';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE a2_super_admin_recovery_consumptions(` +
        `id UUID PRIMARY KEY,` +
        `recovery_reference VARCHAR(160) NOT NULL,` +
        `nonce VARCHAR(255) NOT NULL UNIQUE,` +
        `statement_hash CHAR(64) NOT NULL,` +
        `operation VARCHAR(40) NOT NULL,` +
        `target_assignment_reference VARCHAR(160) NOT NULL,` +
        `target_principal_id VARCHAR(160) NOT NULL,` +
        `reason VARCHAR(500) NOT NULL,` +
        `environment VARCHAR(80) NOT NULL,` +
        `audience VARCHAR(80) NOT NULL,` +
        `signing_key_reference VARCHAR(160) NOT NULL,` +
        `approval_change_reference VARCHAR(160) NOT NULL,` +
        `consumed_by VARCHAR(160) NOT NULL,` +
        `consumed_at TIMESTAMPTZ NOT NULL,` +
        `audit_reference UUID NOT NULL,` +
        `created_at TIMESTAMPTZ NOT NULL DEFAULT now(),` +
        `CONSTRAINT chk_a2_super_admin_recovery_operation CHECK(operation = 'REVOKE_SUPER_ADMIN')` +
        `)`,
    );
    await q.query(
      `CREATE INDEX idx_a2_super_admin_recovery_target ON a2_super_admin_recovery_consumptions(target_principal_id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS a2_super_admin_recovery_consumptions');
  }
}
