import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLimitUsages1785753600069 implements MigrationInterface {
  name = 'CreateLimitUsages1785753600069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE limit_usages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        principal_type VARCHAR(20) NOT NULL CONSTRAINT chk_limit_usages_principal_type CHECK (principal_type IN ('CUSTOMER','AGENT','AGENT_CLASS','SEGMENT','GLOBAL')),
        principal_id UUID NOT NULL,
        limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
        limit_rule_id UUID REFERENCES limit_rules(id) ON DELETE SET NULL,
        product VARCHAR(80) NOT NULL,
        direction VARCHAR(20) CONSTRAINT chk_limit_usages_direction CHECK (direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')),
        channel VARCHAR(30),
        dimension VARCHAR(40) NOT NULL CONSTRAINT chk_limit_usages_dimension CHECK (dimension IN ('DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')),
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_limit_usages_currency CHECK (currency ~ '^[A-Z]{3}$'),
        window_type VARCHAR(20) NOT NULL CONSTRAINT chk_limit_usages_window_type CHECK (window_type IN ('DAILY','WEEKLY','MONTHLY','YEARLY')),
        window_key VARCHAR(80) NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        window_end TIMESTAMPTZ NOT NULL CONSTRAINT chk_limit_usages_window CHECK (window_end > window_start),
        used_amount_minor BIGINT NOT NULL DEFAULT 0 CONSTRAINT chk_limit_usages_used_amount CHECK (used_amount_minor >= 0),
        used_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_limit_usages_used_count CHECK (used_count >= 0),
        reserved_amount_minor BIGINT NOT NULL DEFAULT 0 CONSTRAINT chk_limit_usages_reserved_amount CHECK (reserved_amount_minor >= 0),
        reserved_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_limit_usages_reserved_count CHECK (reserved_count >= 0),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_limit_usages_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_limit_usages_principal ON limit_usages (principal_type, principal_id)`);
    await queryRunner.query(`CREATE INDEX idx_limit_usages_window_key ON limit_usages (window_key)`);
    await queryRunner.query(`CREATE INDEX idx_limit_usages_window_start ON limit_usages (window_start)`);
    await queryRunner.query(`CREATE INDEX idx_limit_usages_profile_product ON limit_usages (limit_profile_code, product)`);
    await queryRunner.query(`CREATE INDEX idx_limit_usages_dimension ON limit_usages (dimension)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_limit_usages_window
      ON limit_usages (principal_type, principal_id, limit_profile_code, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key)
    `);

    await queryRunner.query(`
      CREATE TABLE limit_reservations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        correlation_id VARCHAR(160),
        principal_type VARCHAR(20) NOT NULL CONSTRAINT chk_limit_reservations_principal_type CHECK (principal_type IN ('CUSTOMER','AGENT','AGENT_CLASS','SEGMENT','GLOBAL')),
        principal_id UUID NOT NULL,
        limit_profile_code VARCHAR(80) NOT NULL,
        limit_rule_id UUID REFERENCES limit_rules(id) ON DELETE SET NULL,
        product VARCHAR(80) NOT NULL,
        direction VARCHAR(20) CONSTRAINT chk_limit_reservations_direction CHECK (direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')),
        channel VARCHAR(30),
        dimension VARCHAR(40) NOT NULL CONSTRAINT chk_limit_reservations_dimension CHECK (dimension IN ('DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')),
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_limit_reservations_currency CHECK (currency ~ '^[A-Z]{3}$'),
        window_type VARCHAR(20) NOT NULL CONSTRAINT chk_limit_reservations_window_type CHECK (window_type IN ('DAILY','WEEKLY','MONTHLY','YEARLY')),
        window_key VARCHAR(80) NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        window_end TIMESTAMPTZ NOT NULL CONSTRAINT chk_limit_reservations_window CHECK (window_end > window_start),
        amount_minor BIGINT CONSTRAINT chk_limit_reservations_amount CHECK (amount_minor IS NULL OR amount_minor >= 0),
        count INTEGER CONSTRAINT chk_limit_reservations_count CHECK (count IS NULL OR count >= 0),
        status VARCHAR(20) NOT NULL CONSTRAINT chk_limit_reservations_status CHECK (status IN ('RESERVED','COMMITTED','RELEASED')),
        limit_usage_id UUID REFERENCES limit_usages(id) ON DELETE SET NULL,
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_limit_reservations_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        committed_at TIMESTAMPTZ,
        released_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_limit_reservations_idempotency ON limit_reservations (idempotency_key)`);
    await queryRunner.query(`CREATE INDEX idx_limit_reservations_principal ON limit_reservations (principal_type, principal_id)`);
    await queryRunner.query(`CREATE INDEX idx_limit_reservations_usage ON limit_reservations (limit_usage_id)`);
    await queryRunner.query(`CREATE INDEX idx_limit_reservations_status ON limit_reservations (status)`);
    await queryRunner.query(`CREATE INDEX idx_limit_reservations_window ON limit_reservations (window_key)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_limit_reservations_idempotent
      ON limit_reservations (idempotency_key, limit_usage_id)
      WHERE limit_usage_id IS NOT NULL
    `);
    // Additional guard: same idempotency_key + same window identity cannot double-create with different usage row (defense in depth)
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_limit_reservations_window_idempotent
      ON limit_reservations (idempotency_key, principal_type, principal_id, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS limit_reservations`);
    await queryRunner.query(`DROP TABLE IF EXISTS limit_usages`);
  }
}
