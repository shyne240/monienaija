import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2CustomerActivationReadinessTables1785753600039 implements MigrationInterface {
  name = 'CreateB2CustomerActivationReadinessTables1785753600039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2_customer_activation_readiness (
        id UUID PRIMARY KEY,
        attestation_reference VARCHAR(200) NOT NULL,
        attestation_version INTEGER NOT NULL,
        customer_id VARCHAR(64) NOT NULL,
        cohort_key VARCHAR(200) NOT NULL,
        cohort_version INTEGER NOT NULL,
        verification_state VARCHAR(24) NOT NULL,
        activation_eligibility VARCHAR(24) NOT NULL,
        activation_ready BOOLEAN NOT NULL,
        outcome VARCHAR(40) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        decision_hash VARCHAR(64) NOT NULL,
        decision_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_customer_activation_readiness_reference UNIQUE (attestation_reference, attestation_version),
        CONSTRAINT chk_b2_customer_activation_readiness_reference CHECK (attestation_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_customer_activation_readiness_version CHECK (attestation_version = 1),
        CONSTRAINT chk_b2_customer_activation_readiness_customer CHECK (customer_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b2_customer_activation_readiness_cohort_key CHECK (cohort_key = 'b2.activation.cohort.inbound-funding'),
        CONSTRAINT chk_b2_customer_activation_readiness_cohort_version CHECK (cohort_version = 1),
        CONSTRAINT chk_b2_customer_activation_readiness_verification CHECK (verification_state IN ('UNVERIFIED','PENDING','VERIFIED','SUSPENDED','BLOCKED')),
        CONSTRAINT chk_b2_customer_activation_readiness_eligibility CHECK (activation_eligibility IN ('ELIGIBLE','INELIGIBLE','REQUIRES_CONSENT')),
        CONSTRAINT chk_b2_customer_activation_readiness_outcome CHECK (outcome IN ('ATTESTED_READY','ATTESTED_NOT_READY','ATTESTED_REQUIRES_CONSENT','REJECTED')),
        CONSTRAINT chk_b2_customer_activation_readiness_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_customer_activation_readiness_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_customer_activation_readiness_decision_replay_hash CHECK (decision_replay_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_customer_activation_readiness_idempotency_scope CHECK (idempotency_scope = 'b2.customer-activation-readiness.idempotency.v1'),
        CONSTRAINT chk_b2_customer_activation_readiness_correlation CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_customer_activation_readiness_ref
        ON b2_customer_activation_readiness (attestation_reference, attestation_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_customer
        ON b2_customer_activation_readiness (customer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_cohort
        ON b2_customer_activation_readiness (cohort_key, cohort_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_request_hash
        ON b2_customer_activation_readiness (request_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_decision_hash
        ON b2_customer_activation_readiness (decision_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_idempotency
        ON b2_customer_activation_readiness (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_eligibility
        ON b2_customer_activation_readiness (activation_eligibility)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_customer_activation_readiness_correlation
        ON b2_customer_activation_readiness (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_correlation`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_eligibility`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_idempotency`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_decision_hash`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_request_hash`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_cohort`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_customer_activation_readiness_customer`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b2_customer_activation_readiness_ref`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_customer_activation_readiness`);
  }
}
