import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-OPS-01 — minimal, dedicated identity/session store for the SUPPORT workforce
 * principal type.
 *
 * Prior to this migration, `AuthorizationPrincipalType` declared `'SUPPORT'` and
 * every `/internal/*` route policy already allowed it, but no production code path
 * ever constructed a principal of that type: `A2WorkforceSessionService` (the only
 * workforce session issuer in the codebase) resolves exclusively to `'OPERATOR'` or
 * `'PRIVILEGED'`, and `A2_FINANCE_ROLES_JSON` is schema-locked to exactly the four
 * A2T11 finance governance roles (FINANCE_ADMIN/PREPARER/CONTROLLER/AUDITOR) — it
 * structurally cannot accept a fifth "SUPPORT" role key. That system is a purpose-built
 * Finance maker/checker governance stack (external OIDC + mandatory MFA + maker/checker
 * approvals) and is intentionally out of scope to extend for a Support ticket-queue
 * identity.
 *
 * This migration adds a small, separate identity/session pair — mirroring the existing
 * per-domain pattern already used for AGENT (`agent_authentication_credentials` /
 * `agent_authentication_sessions`) and CUSTOMER (`customer_authentication_credentials` /
 * sessions) — scoped to exactly the SUPPORT principal type. Provisioning a Support
 * workforce user is restricted to an already-authenticated OPERATOR/SERVICE/PRIVILEGED
 * (A2) workforce session (see AdminSupportCredentialsController); Support cannot
 * provision itself or any other identity.
 */
export class CreateSupportWorkforceAuthentication1785753600081 implements MigrationInterface {
  name = 'CreateSupportWorkforceAuthentication1785753600081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE support_workforce_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(160) NOT NULL,
        password_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        password_expires_at TIMESTAMPTZ,
        created_by VARCHAR(160) NOT NULL,
        disabled_by VARCHAR(160),
        disabled_at TIMESTAMPTZ,
        disable_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_support_workforce_users_status CHECK (status IN ('ACTIVE', 'DISABLED')),
        CONSTRAINT chk_support_workforce_users_algorithm CHECK (hash_algorithm IN ('PBKDF2')),
        CONSTRAINT chk_support_workforce_users_version CHECK (version > 0),
        CONSTRAINT chk_support_workforce_users_username CHECK (username ~ '^[a-z0-9._-]{3,160}$')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_support_workforce_users_username_active ON support_workforce_users (username) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_support_workforce_users_status ON support_workforce_users (status)`,
    );

    await queryRunner.query(`
      CREATE TABLE support_workforce_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        support_user_id UUID NOT NULL,
        token_hash CHAR(64) NOT NULL,
        audience VARCHAR(80) NOT NULL DEFAULT 'support-workforce',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoke_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_support_workforce_sessions_user
          FOREIGN KEY (support_user_id) REFERENCES support_workforce_users(id) ON DELETE RESTRICT,
        CONSTRAINT chk_support_workforce_sessions_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_support_workforce_sessions_status CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
        CONSTRAINT chk_support_workforce_sessions_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_support_workforce_sessions_token_hash ON support_workforce_sessions (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_support_workforce_sessions_user_status ON support_workforce_sessions (support_user_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_support_workforce_sessions_expires ON support_workforce_sessions (status, expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS support_workforce_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS support_workforce_users`);
  }
}
