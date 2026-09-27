import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLimitProfileCatalogue1785753600067 implements MigrationInterface {
  name = 'CreateLimitProfileCatalogue1785753600067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE limit_profiles (
        code VARCHAR(80) PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500),
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('CUSTOMER','AGENT','SYSTEM','UNIVERSAL')),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','DEPRECATED')),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        configuration_status VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_limit_profiles_code CHECK (code ~ '^[A-Z0-9_]{3,80}$')
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX uq_limit_profiles_code_active ON limit_profiles (code) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE INDEX idx_limit_profiles_kind ON limit_profiles (kind)`);
    await queryRunner.query(`CREATE INDEX idx_limit_profiles_status ON limit_profiles (status)`);
    await queryRunner.query(`CREATE INDEX idx_limit_profiles_enabled ON limit_profiles (enabled)`);

    await queryRunner.query(`
      CREATE TABLE limit_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
        product VARCHAR(80) NOT NULL CONSTRAINT chk_limit_rules_product CHECK (product ~ '^[A-Z0-9_][A-Z0-9_.-]{1,79}$'),
        direction VARCHAR(20) CONSTRAINT chk_limit_rules_direction CHECK (direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')),
        channel VARCHAR(30),
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_limit_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
        dimension VARCHAR(40) NOT NULL CONSTRAINT chk_limit_rules_dimension CHECK (dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT','WALLET_BALANCE_MAX')),
        limit_value_minor BIGINT CONSTRAINT chk_limit_rules_minor CHECK (limit_value_minor IS NULL OR limit_value_minor >= 0),
        limit_value_count INTEGER CONSTRAINT chk_limit_rules_count CHECK (limit_value_count IS NULL OR limit_value_count >= 0),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_limit_rules_version CHECK (version > 0),
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ CONSTRAINT chk_limit_rules_effective CHECK (effective_to IS NULL OR effective_to > effective_from),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        priority INTEGER NOT NULL DEFAULT 0,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_limit_rules_amount_count_exclusive CHECK (
          (
            dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','WALLET_BALANCE_MAX')
            AND limit_value_minor IS NOT NULL AND limit_value_count IS NULL
          )
          OR
          (
            dimension IN ('DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')
            AND limit_value_count IS NOT NULL AND limit_value_minor IS NULL
          )
        )
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_limit_rules_profile ON limit_rules (limit_profile_code)`);
    await queryRunner.query(`CREATE INDEX idx_limit_rules_profile_product ON limit_rules (limit_profile_code, product)`);
    await queryRunner.query(`CREATE INDEX idx_limit_rules_dimension ON limit_rules (dimension)`);
    await queryRunner.query(`CREATE INDEX idx_limit_rules_effective ON limit_rules (effective_from, effective_to)`);
    await queryRunner.query(`CREATE INDEX idx_limit_rules_currency ON limit_rules (currency)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_limit_rules_active_key ON limit_rules (limit_profile_code, product, COALESCE(direction,'BOTH'), COALESCE(channel,''), currency, dimension, effective_from) WHERE deleted_at IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS limit_rules`);
    await queryRunner.query(`DROP TABLE IF EXISTS limit_profiles`);
  }
}
