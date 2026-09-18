import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2PublicApiAuthenticationTables1785753600045 implements MigrationInterface {
  name = 'CreateB2PublicApiAuthenticationTables1785753600045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2_public_api_authentication (
        id UUID PRIMARY KEY,
        auth_reference VARCHAR(200) NOT NULL,
        auth_version INTEGER NOT NULL,
        method VARCHAR(10) NOT NULL,
        path_template VARCHAR(200) NOT NULL,
        outcome VARCHAR(24) NOT NULL,
        http_status INTEGER NOT NULL,
        cohort_key VARCHAR(200) NOT NULL,
        cohort_version INTEGER NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        decision_hash VARCHAR(64) NOT NULL,
        decision_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_public_api_auth_reference UNIQUE (auth_reference, auth_version),
        CONSTRAINT chk_b2_public_api_auth_reference CHECK (auth_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_public_api_auth_version CHECK (auth_version = 1),
        CONSTRAINT chk_b2_public_api_auth_method CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
        CONSTRAINT chk_b2_public_api_auth_outcome CHECK (outcome IN ('AUTHENTICATED','UNAUTHORIZED','FORBIDDEN','WRONG_AUDIENCE','EXPIRED','WRONG_SCOPE','CONSUMER_NOT_ACTIVE','CREDENTIAL_REVOKED','CONSENT_REQUIRED','ACTIVATION_REQUIRED','QUOTA_EXCEEDED','RATE_LIMITED','NOT_FOUND','REJECTED')),
        CONSTRAINT chk_b2_public_api_auth_cohort_key CHECK (cohort_key = 'b2.activation.cohort.inbound-funding'),
        CONSTRAINT chk_b2_public_api_auth_cohort_version CHECK (cohort_version = 1),
        CONSTRAINT chk_b2_public_api_auth_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_public_api_auth_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_public_api_auth_idempotency_scope CHECK (idempotency_scope = 'b2.public-api-authentication.idempotency.v1'),
        CONSTRAINT chk_b2_public_api_auth_correlation CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_public_api_auth_ref
        ON b2_public_api_authentication (auth_reference, auth_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_public_api_auth_path
        ON b2_public_api_authentication (path_template)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_public_api_auth_outcome
        ON b2_public_api_authentication (outcome)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_public_api_auth_cohort
        ON b2_public_api_authentication (cohort_key, cohort_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_public_api_auth_request_hash
        ON b2_public_api_authentication (request_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_public_api_auth_idempotency
        ON b2_public_api_authentication (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_public_api_auth_correlation
        ON b2_public_api_authentication (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_public_api_auth_correlation`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_public_api_auth_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_public_api_auth_request_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_public_api_auth_cohort`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_public_api_auth_outcome`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_public_api_auth_path`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b2_public_api_auth_ref`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_public_api_authentication`);
  }
}
