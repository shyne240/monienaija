import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2ConsentTables1785753600042 implements MigrationInterface {
  name = 'CreateB2ConsentTables1785753600042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2_consent (
        id UUID PRIMARY KEY,
        consent_reference VARCHAR(200) NOT NULL,
        consent_version INTEGER NOT NULL,
        subject_customer_id VARCHAR(64) NOT NULL,
        purpose VARCHAR(40) NOT NULL,
        channel VARCHAR(16),
        cohort_key VARCHAR(200) NOT NULL,
        cohort_version INTEGER NOT NULL,
        state VARCHAR(16) NOT NULL,
        outcome VARCHAR(16) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        decision_hash VARCHAR(64) NOT NULL,
        decision_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_consent_reference UNIQUE (consent_reference, consent_version),
        CONSTRAINT chk_b2_consent_reference CHECK (consent_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_consent_version CHECK (consent_version = 1),
        CONSTRAINT chk_b2_consent_subject CHECK (subject_customer_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b2_consent_purpose CHECK (purpose IN ('B2_ACTIVATION','B2_COMMERCIAL','B2_SELF_SERVICE','MARKETING_COMMERCIAL_OFFER')),
        CONSTRAINT chk_b2_consent_channel CHECK (channel IS NULL OR channel IN ('email','sms','push','inApp')),
        CONSTRAINT chk_b2_consent_cohort_key CHECK (cohort_key = 'b2.activation.cohort.inbound-funding'),
        CONSTRAINT chk_b2_consent_cohort_version CHECK (cohort_version = 1),
        CONSTRAINT chk_b2_consent_state CHECK (state IN ('PENDING','GRANTED','REVOKED','EXPIRED')),
        CONSTRAINT chk_b2_consent_outcome CHECK (outcome IN ('PENDING','GRANTED','REVOKED','EXPIRED','REJECTED')),
        CONSTRAINT chk_b2_consent_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_consent_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_consent_decision_replay_hash CHECK (decision_replay_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_consent_idempotency_scope CHECK (idempotency_scope = 'b2.consent.idempotency.v1'),
        CONSTRAINT chk_b2_consent_correlation CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_consent_ref
        ON b2_consent (consent_reference, consent_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_subject
        ON b2_consent (subject_customer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_purpose
        ON b2_consent (purpose)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_state
        ON b2_consent (state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_cohort
        ON b2_consent (cohort_key, cohort_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_request_hash
        ON b2_consent (request_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_idempotency
        ON b2_consent (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_consent_correlation
        ON b2_consent (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_correlation`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_request_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_cohort`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_state`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_purpose`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_consent_subject`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b2_consent_ref`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_consent`);
  }
}
