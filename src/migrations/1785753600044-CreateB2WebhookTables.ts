import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2WebhookTables1785753600044 implements MigrationInterface {
  name = 'CreateB2WebhookTables1785753600044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2_webhook_registration (
        id UUID PRIMARY KEY,
        registration_reference VARCHAR(200) NOT NULL,
        registration_version INTEGER NOT NULL,
        registration_id VARCHAR(64) NOT NULL,
        consumer_id VARCHAR(64) NOT NULL,
        url VARCHAR(500) NOT NULL,
        events JSONB NOT NULL,
        hmac_algorithm VARCHAR(20) NOT NULL,
        secret_hash VARCHAR(200) NOT NULL,
        challenge_nonce VARCHAR(80) NOT NULL,
        state VARCHAR(24) NOT NULL,
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
        CONSTRAINT uq_b2_webhook_registration_reference UNIQUE (registration_reference, registration_version),
        CONSTRAINT chk_b2_webhook_registration_reference CHECK (registration_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_webhook_registration_version CHECK (registration_version = 1),
        CONSTRAINT chk_b2_webhook_registration_url CHECK (url ~ '^https://'),
        CONSTRAINT chk_b2_webhook_registration_hmac CHECK (hmac_algorithm = 'HMAC_SHA256'),
        CONSTRAINT chk_b2_webhook_registration_secret_hash CHECK (secret_hash ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_webhook_registration_state CHECK (state IN ('PENDING_VERIFICATION','VERIFIED','SUSPENDED','REVOKED')),
        CONSTRAINT chk_b2_webhook_registration_cohort_key CHECK (cohort_key = 'b2.activation.cohort.inbound-funding'),
        CONSTRAINT chk_b2_webhook_registration_cohort_version CHECK (cohort_version = 1),
        CONSTRAINT chk_b2_webhook_registration_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_webhook_registration_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_webhook_registration_idempotency_scope CHECK (idempotency_scope = 'b2.webhook.idempotency.v1'),
        CONSTRAINT chk_b2_webhook_registration_correlation CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_webhook_registration_ref
        ON b2_webhook_registration (registration_reference, registration_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_registration_consumer
        ON b2_webhook_registration (consumer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_registration_state
        ON b2_webhook_registration (state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_registration_idempotency
        ON b2_webhook_registration (idempotency_scope, idempotency_key)
    `);

    await queryRunner.query(`
      CREATE TABLE b2_webhook_delivery (
        id UUID PRIMARY KEY,
        delivery_reference VARCHAR(200) NOT NULL,
        delivery_version INTEGER NOT NULL,
        delivery_id VARCHAR(64) NOT NULL,
        registration_id VARCHAR(64) NOT NULL,
        consumer_id VARCHAR(64) NOT NULL,
        event VARCHAR(40) NOT NULL,
        url VARCHAR(500) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        signature VARCHAR(200) NOT NULL,
        timestamp BIGINT NOT NULL,
        attempt INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        state VARCHAR(24) NOT NULL,
        next_attempt_at TIMESTAMPTZ,
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
        CONSTRAINT uq_b2_webhook_delivery_reference UNIQUE (delivery_reference, delivery_version),
        CONSTRAINT chk_b2_webhook_delivery_reference CHECK (delivery_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_webhook_delivery_version CHECK (delivery_version = 1),
        CONSTRAINT chk_b2_webhook_delivery_delivery_id CHECK (delivery_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b2_webhook_delivery_event CHECK (event IN ('b2.activation.succeeded','b2.activation.suspended','b2.webhook.test','b1.commercial.invoice.created')),
        CONSTRAINT chk_b2_webhook_delivery_state CHECK (state IN ('ENQUEUED','DELIVERED','FAILED_RETRYABLE','FAILED_PERMANENT','DEAD_LETTER')),
        CONSTRAINT chk_b2_webhook_delivery_attempt CHECK (attempt >= 1 AND attempt <= 5),
        CONSTRAINT chk_b2_webhook_delivery_max_attempts CHECK (max_attempts = 5),
        CONSTRAINT chk_b2_webhook_delivery_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_webhook_delivery_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_webhook_delivery_idempotency_scope CHECK (idempotency_scope = 'b2.webhook.idempotency.v1'),
        CONSTRAINT fk_b2_webhook_delivery_registration FOREIGN KEY (registration_id) REFERENCES b2_webhook_registration(registration_id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_webhook_delivery_ref
        ON b2_webhook_delivery (delivery_reference, delivery_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_delivery_registration
        ON b2_webhook_delivery (registration_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_delivery_state
        ON b2_webhook_delivery (state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_delivery_delivery_id
        ON b2_webhook_delivery (delivery_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_webhook_delivery_idempotency
        ON b2_webhook_delivery (idempotency_scope, idempotency_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS b2_webhook_delivery`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_webhook_registration`);
  }
}
