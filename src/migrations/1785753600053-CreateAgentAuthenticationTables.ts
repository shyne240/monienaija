import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentAuthenticationTables1785753600053 implements MigrationInterface {
  name = 'CreateAgentAuthenticationTables1785753600053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(160) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_agents_status CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
        CONSTRAINT chk_agents_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agents_reference ON agents (reference)`);
    await queryRunner.query(`CREATE INDEX idx_agents_status ON agents (status)`);

    await queryRunner.query(`
      CREATE TABLE agent_authentication_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        password_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        password_version INTEGER NOT NULL,
        password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        password_expires_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        failed_authentication_count INTEGER NOT NULL DEFAULT 0,
        account_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMPTZ,
        lock_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_authentication_credentials_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_authentication_credentials_status CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
        CONSTRAINT chk_agent_authentication_credentials_algorithm CHECK (hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')),
        CONSTRAINT chk_agent_authentication_credentials_password_version CHECK (password_version > 0),
        CONSTRAINT chk_agent_authentication_credentials_failed_count CHECK (failed_authentication_count >= 0),
        CONSTRAINT chk_agent_authentication_credentials_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_authentication_credentials_active_agent ON agent_authentication_credentials (agent_id) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_agent_authentication_credentials_agent_status ON agent_authentication_credentials (agent_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE agent_transaction_pins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        pin_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        pin_version INTEGER NOT NULL,
        failed_count INTEGER NOT NULL DEFAULT 0,
        account_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMPTZ,
        lock_reason VARCHAR(500),
        last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_transaction_pins_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_transaction_pins_algorithm CHECK (hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')),
        CONSTRAINT chk_agent_transaction_pins_pin_version CHECK (pin_version > 0),
        CONSTRAINT chk_agent_transaction_pins_failed_count CHECK (failed_count >= 0),
        CONSTRAINT chk_agent_transaction_pins_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_transaction_pins_active_agent ON agent_transaction_pins (agent_id) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_agent_transaction_pins_agent ON agent_transaction_pins (agent_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE agent_authentication_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        credential_id UUID NOT NULL,
        token_hash CHAR(64) NOT NULL,
        audience VARCHAR(80) NOT NULL DEFAULT 'agent-api',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoke_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_agent_authentication_sessions_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_agent_authentication_sessions_credential FOREIGN KEY (credential_id) REFERENCES agent_authentication_credentials(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_authentication_sessions_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_agent_authentication_sessions_status CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
        CONSTRAINT chk_agent_authentication_sessions_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_authentication_sessions_token_hash ON agent_authentication_sessions (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_agent_authentication_sessions_agent_status ON agent_authentication_sessions (agent_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_agent_authentication_sessions_expires ON agent_authentication_sessions (status, expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS agent_authentication_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_transaction_pins`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_authentication_credentials`);
    await queryRunner.query(`DROP TABLE IF EXISTS agents`);
  }
}
