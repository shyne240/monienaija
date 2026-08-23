import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2ApiConsumerTables1785753600043 implements MigrationInterface {
  name = 'CreateB2ApiConsumerTables1785753600043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2_api_consumer (
        id UUID PRIMARY KEY,
        consumer_reference VARCHAR(200) NOT NULL,
        consumer_version INTEGER NOT NULL,
        consumer_id VARCHAR(64) NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        consumer_type VARCHAR(16) NOT NULL,
        owner_customer_id VARCHAR(64),
        owner_merchant_id VARCHAR(64),
        owner_agent_id VARCHAR(64),
        audience JSONB NOT NULL,
        scopes JSONB NOT NULL,
        state VARCHAR(16) NOT NULL,
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
        CONSTRAINT uq_b2_api_consumer_reference UNIQUE (consumer_reference, consumer_version),
        -- consumer_id is the referenced identity for b2_api_credential, b2_api_quota and
        -- b2_rate_limit_bucket. PostgreSQL requires a unique constraint on the referenced
        -- column, so this constraint is what makes those foreign keys creatable at all.
        CONSTRAINT uq_b2_api_consumer_consumer_id UNIQUE (consumer_id),
        CONSTRAINT chk_b2_api_consumer_reference CHECK (consumer_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_api_consumer_version CHECK (consumer_version = 1),
        CONSTRAINT chk_b2_api_consumer_type CHECK (consumer_type IN ('DEVELOPER','MERCHANT','AGENT','PARTNER')),
        CONSTRAINT chk_b2_api_consumer_state CHECK (state IN ('DRAFT','ACTIVE','SUSPENDED','REVOKED')),
        CONSTRAINT chk_b2_api_consumer_cohort_key CHECK (cohort_key = 'b2.activation.cohort.inbound-funding'),
        CONSTRAINT chk_b2_api_consumer_cohort_version CHECK (cohort_version = 1),
        CONSTRAINT chk_b2_api_consumer_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_api_consumer_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_api_consumer_idempotency_scope CHECK (idempotency_scope = 'b2.api-consumer.idempotency.v1'),
        CONSTRAINT chk_b2_api_consumer_correlation CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_api_consumer_ref
        ON b2_api_consumer (consumer_reference, consumer_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_consumer_type
        ON b2_api_consumer (consumer_type)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_consumer_state
        ON b2_api_consumer (state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_consumer_idempotency
        ON b2_api_consumer (idempotency_scope, idempotency_key)
    `);

    await queryRunner.query(`
      CREATE TABLE b2_api_credential (
        id UUID PRIMARY KEY,
        credential_reference VARCHAR(200) NOT NULL,
        credential_version INTEGER NOT NULL,
        credential_id VARCHAR(64) NOT NULL,
        consumer_id VARCHAR(64) NOT NULL,
        kind VARCHAR(24) NOT NULL,
        key_id VARCHAR(80) NOT NULL,
        client_id VARCHAR(80),
        secret_hash VARCHAR(200) NOT NULL,
        scopes JSONB NOT NULL,
        sandbox_type VARCHAR(16) NOT NULL,
        state VARCHAR(16) NOT NULL,
        expiry_at TIMESTAMPTZ NOT NULL,
        rotation_next_key_id VARCHAR(80),
        request_hash VARCHAR(64) NOT NULL,
        decision_hash VARCHAR(64) NOT NULL,
        decision_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_api_credential_reference UNIQUE (credential_reference, credential_version),
        CONSTRAINT chk_b2_api_credential_reference CHECK (credential_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_api_credential_version CHECK (credential_version = 1),
        CONSTRAINT chk_b2_api_credential_consumer CHECK (consumer_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b2_api_credential_kind CHECK (kind IN ('API_KEY','CLIENT_CREDENTIALS')),
        CONSTRAINT chk_b2_api_credential_key_id CHECK (key_id ~ '^[\\x20-\\x7E]{1,80}$'),
        CONSTRAINT chk_b2_api_credential_secret_hash CHECK (secret_hash ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b2_api_credential_sandbox CHECK (sandbox_type IN ('SANDBOX','PRODUCTION')),
        CONSTRAINT chk_b2_api_credential_state CHECK (state IN ('ISSUED','ROTATED','REVOKED','EXPIRED')),
        CONSTRAINT chk_b2_api_credential_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_api_credential_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2_api_credential_idempotency_scope CHECK (idempotency_scope = 'b2.api-consumer.idempotency.v1'),
        CONSTRAINT fk_b2_api_credential_consumer FOREIGN KEY (consumer_id) REFERENCES b2_api_consumer(consumer_id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b2_api_credential_ref
        ON b2_api_credential (credential_reference, credential_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_credential_consumer
        ON b2_api_credential (consumer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_credential_state
        ON b2_api_credential (state)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_credential_idempotency
        ON b2_api_credential (idempotency_scope, idempotency_key)
    `);

    await queryRunner.query(`
      CREATE TABLE b2_api_quota (
        id UUID PRIMARY KEY,
        quota_reference VARCHAR(200) NOT NULL,
        consumer_id VARCHAR(64) NOT NULL,
        quota_group VARCHAR(32) NOT NULL,
        "limit" INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        "window" VARCHAR(32) NOT NULL,
        state VARCHAR(16) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_api_quota_consumer_group UNIQUE (consumer_id, quota_group),
        CONSTRAINT chk_b2_api_quota_group CHECK (quota_group IN ('commercial.read','commercial.write','webhooks.manage')),
        CONSTRAINT chk_b2_api_quota_state CHECK (state IN ('ALLOCATED','EXCEEDED')),
        CONSTRAINT chk_b2_api_quota_limit CHECK ("limit" IN (5000, 500, 100)),
        CONSTRAINT chk_b2_api_quota_window CHECK ("window" = 'UTC_CALENDAR_DAY'),
        CONSTRAINT chk_b2_api_quota_idempotency_scope CHECK (idempotency_scope = 'b2.api-consumer.idempotency.v1'),
        CONSTRAINT fk_b2_api_quota_consumer FOREIGN KEY (consumer_id) REFERENCES b2_api_consumer(consumer_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_api_quota_consumer
        ON b2_api_quota (consumer_id)
    `);

    await queryRunner.query(`
      CREATE TABLE b2_rate_limit_bucket (
        id UUID PRIMARY KEY,
        bucket VARCHAR(64) NOT NULL,
        consumer_id VARCHAR(64) NOT NULL,
        capacity INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        refill_per_second NUMERIC NOT NULL,
        strategy VARCHAR(16) NOT NULL,
        state VARCHAR(16) NOT NULL,
        retry_after_seconds INTEGER,
        last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2_rate_limit_bucket_consumer UNIQUE (consumer_id, bucket),
        CONSTRAINT chk_b2_rate_limit_bucket CHECK (bucket IN ('global','commercial.read','commercial.write','commercial.activations:write','webhooks:delivery')),
        CONSTRAINT chk_b2_rate_limit_strategy CHECK (strategy = 'TOKEN_BUCKET'),
        CONSTRAINT chk_b2_rate_limit_state CHECK (state IN ('ALLOWED','THROTTLED')),
        CONSTRAINT fk_b2_rate_limit_consumer FOREIGN KEY (consumer_id) REFERENCES b2_api_consumer(consumer_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b2_rate_limit_consumer
        ON b2_rate_limit_bucket (consumer_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS b2_rate_limit_bucket`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_api_quota`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_api_credential`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2_api_consumer`);
  }
}
