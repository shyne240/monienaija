import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A6 — Agent authentication credentials, transaction PIN and sessions.
 *
 * Agent is a first-class participant, so its credentials are owned by the
 * Agent domain and are FK-bound to `agents`. They are deliberately NOT stored
 * in `customer_authentication_credentials`: an Agent must never be represented
 * as, or reachable through, a Customer identity.
 *
 * The SECURITY PRIMITIVES are reused rather than reinvented - the same PBKDF2
 * hashing, the same configurable transaction-PIN policy, the same
 * failed-attempt/lockout shape the customer credential uses. What is not
 * reused is customer OWNERSHIP.
 *
 * Login credential and transaction PIN are separate rows discriminated by
 * `credential_type`, mirroring the customer model, so a login secret can never
 * be used as a transaction PIN or vice versa.
 *
 * Additive only: no customer table, constraint, index or row is touched, and
 * no financial table is involved. No balance is introduced anywhere.
 */
export class CreateAgentAuthentication1785753600059 implements MigrationInterface {
  name = 'CreateAgentAuthentication1785753600059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agent_authentication_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        credential_type VARCHAR(20) NOT NULL,
        secret_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        failed_authentication_count INTEGER NOT NULL DEFAULT 0,
        account_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMPTZ,
        lock_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_agent_auth_credentials_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_auth_credentials_type
          CHECK (credential_type IN ('PASSWORD', 'PIN')),
        CONSTRAINT chk_agent_auth_credentials_status
          CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
        CONSTRAINT chk_agent_auth_credentials_algorithm
          CHECK (hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')),
        CONSTRAINT chk_agent_auth_credentials_failed_count
          CHECK (failed_authentication_count >= 0),
        CONSTRAINT chk_agent_auth_credentials_version CHECK (version > 0),
        CONSTRAINT chk_agent_auth_credentials_locked_at CHECK (
          (account_locked AND locked_at IS NOT NULL)
          OR (NOT account_locked AND locked_at IS NULL)
        )
      )
    `);
    // At most one ACTIVE credential of each type per agent.
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_auth_credentials_active_type
         ON agent_authentication_credentials (agent_id, credential_type)
       WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_agent_auth_credentials_agent
         ON agent_authentication_credentials (agent_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE agent_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        -- Only a hash of the bearer token is stored; the token itself is
        -- returned once to the caller and never persisted.
        token_hash CHAR(64) NOT NULL,
        audience VARCHAR(120) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_reason VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_agent_sessions_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT uq_agent_sessions_token_hash UNIQUE (token_hash),
        CONSTRAINT chk_agent_sessions_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_agent_sessions_status CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
        CONSTRAINT chk_agent_sessions_revoked_at CHECK (
          (status = 'REVOKED' AND revoked_at IS NOT NULL)
          OR (status <> 'REVOKED' AND revoked_at IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_agent_sessions_agent_status ON agent_sessions (agent_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE agent_sessions`);
    await queryRunner.query(`DROP TABLE agent_authentication_credentials`);
  }
}
