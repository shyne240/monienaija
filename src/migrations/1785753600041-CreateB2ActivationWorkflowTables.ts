import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2ActivationWorkflowTables1785753600041 implements MigrationInterface {
  name = 'CreateB2ActivationWorkflowTables1785753600041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2_activation (
        id UUID PRIMARY KEY,
        activation_reference VARCHAR(200) NOT NULL,
        activation_version INTEGER NOT NULL,
        kind VARCHAR(16) NOT NULL,
        principal_id VARCHAR(64) NOT NULL,
        beneficial_owner_customer_id VARCHAR(64),
        cohort_key VARCHAR(200) NOT NULL,
        cohort_version INTEGER NOT NULL,
        state VARCHAR(24) NOT NULL,
        outcome VARCHAR(24) NOT NULL,
        readiness_reference VARCHAR(200) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        decision_hash VARCHAR(64) NOT NULL,
        decision_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_activation_reference UNIQUE (activation_reference, activation_version),
        CONSTRAINT chk_b2_activation_reference CHECK (activation_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_activation_version CHECK (activation_version = 1),
        CONSTRAINT chk_b2_activation_kind CHECK (kind IN ('CUSTOMER','MERCHANT','AGENT')),
        CONSTRAINT chk_b2_activation_principal CHECK (principal_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b2_activation_cohort_key CHECK (cohort_key = 'b2.activation.cohort.inbound-funding'),
        CONSTRAINT chk_b2_activation_cohort_version CHECK (cohort_version = 1),
        CONSTRAINT chk_b2_activation_state CHECK (state IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
        CONSTRAINT chk_b2_activation_outcome CHECK (outcome IN ('PENDING','ACTIVATED','SUSPENDED','REVOKED','REJECTED')),
        CONSTRAINT chk_b2_activation_readiness_reference CHECK (readiness_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_activation_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_activation_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_activation_decision_replay_hash CHECK (decision_replay_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_activation_idempotency_scope CHECK (idempotency_scope = 'b2.activation-workflow.idempotency.v1'),
        CONSTRAINT chk_b2_activation_correlation CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_activation_ref
        ON b2_activation (activation_reference, activation_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_principal
        ON b2_activation (principal_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_kind
        ON b2_activation (kind)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_cohort
        ON b2_activation (cohort_key, cohort_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_state
        ON b2_activation (state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_request_hash
        ON b2_activation (request_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_idempotency
        ON b2_activation (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_activation_correlation
        ON b2_activation (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_correlation`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_request_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_state`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_cohort`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_kind`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2_activation_principal`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b2_activation_ref`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_activation`);
  }
}
