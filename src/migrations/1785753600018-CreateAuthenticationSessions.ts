import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthenticationSessions1785753600018 implements MigrationInterface {
  name = 'CreateAuthenticationSessions1785753600018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE authentication_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        credential_id UUID NOT NULL,
        token_hash CHAR(64) NOT NULL,
        audience VARCHAR(80) NOT NULL DEFAULT 'customer-api',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoke_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_authentication_sessions_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_authentication_sessions_credential
          FOREIGN KEY (credential_id) REFERENCES customer_authentication_credentials(id) ON DELETE RESTRICT,
        CONSTRAINT chk_authentication_sessions_token_hash
          CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_authentication_sessions_status
          CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
        CONSTRAINT chk_authentication_sessions_version
          CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_authentication_sessions_token_hash
         ON authentication_sessions (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_authentication_sessions_customer_status
         ON authentication_sessions (customer_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_authentication_sessions_expires
         ON authentication_sessions (status, expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_authentication_sessions_expires`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_authentication_sessions_customer_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_authentication_sessions_token_hash`);
    await queryRunner.query(`DROP TABLE IF EXISTS authentication_sessions`);
  }
}
