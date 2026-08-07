import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePilotControls1785753600025 implements MigrationInterface {
  name = 'CreatePilotControls1785753600025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pilot_controls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        control_key VARCHAR(160) NOT NULL,
        capability VARCHAR(128) NOT NULL,
        action VARCHAR(64) NOT NULL,
        scope VARCHAR(80) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        cohort_customer_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        currency VARCHAR(3) NOT NULL,
        min_transaction_amount_minor BIGINT NOT NULL,
        max_transaction_amount_minor BIGINT NOT NULL,
        daily_transaction_count_limit INTEGER,
        daily_transaction_amount_minor BIGINT,
        safety_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by VARCHAR(160) NOT NULL,
        last_correlation_id VARCHAR(255),
        last_request_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT uq_pilot_controls_control_key UNIQUE (control_key),
        CONSTRAINT chk_pilot_controls_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_pilot_controls_min_amount CHECK (min_transaction_amount_minor > 0),
        CONSTRAINT chk_pilot_controls_amount_range CHECK (
          max_transaction_amount_minor >= min_transaction_amount_minor
        ),
        CONSTRAINT chk_pilot_controls_daily_count CHECK (
          daily_transaction_count_limit IS NULL OR daily_transaction_count_limit > 0
        ),
        CONSTRAINT chk_pilot_controls_daily_amount CHECK (
          daily_transaction_amount_minor IS NULL OR daily_transaction_amount_minor > 0
        ),
        CONSTRAINT chk_pilot_controls_version CHECK (version > 0),
        CONSTRAINT chk_pilot_controls_updated_by CHECK (length(updated_by) > 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO pilot_controls (
        control_key,
        capability,
        action,
        scope,
        enabled,
        cohort_customer_ids,
        currency,
        min_transaction_amount_minor,
        max_transaction_amount_minor,
        daily_transaction_count_limit,
        daily_transaction_amount_minor,
        safety_thresholds,
        updated_by
      ) VALUES (
        'wallet.transfer.create.internal.v1',
        'wallet.transfer',
        'create',
        'INTERNAL_CUSTOMER_TO_CUSTOMER',
        FALSE,
        '[]'::jsonb,
        'NGN',
        1,
        1000000,
        10,
        1000000,
        '{}'::jsonb,
        'migration'
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_pilot_controls_enabled
        ON pilot_controls (enabled, control_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pilot_controls_enabled`);
    await queryRunner.query(`DROP TABLE IF EXISTS pilot_controls`);
  }
}
