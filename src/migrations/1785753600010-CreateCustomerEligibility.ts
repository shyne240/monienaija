import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerEligibility1785753600010 implements MigrationInterface {
  name = 'CreateCustomerEligibility1785753600010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_eligibilities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        onboarding_id UUID,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reason VARCHAR(500),
        reviewed_by VARCHAR(160) NOT NULL,
        status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_eligibilities_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_eligibilities_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES customer_onboardings(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_eligibilities_status CHECK (
          status IN ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SUSPENDED', 'REVOKED')
        ),
        CONSTRAINT chk_customer_eligibilities_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_eligibilities_active_customer
         ON customer_eligibilities (customer_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_eligibilities_status
         ON customer_eligibilities (status)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_limit_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        daily_transaction_count INTEGER NOT NULL,
        daily_transaction_amount_minor BIGINT NOT NULL,
        single_transaction_amount_minor BIGINT NOT NULL,
        monthly_transaction_amount_minor BIGINT NOT NULL,
        wallet_balance_minor BIGINT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_limit_profiles_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_limit_profiles_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_customer_limit_profiles_daily_count CHECK (daily_transaction_count >= 0),
        CONSTRAINT chk_customer_limit_profiles_amounts_non_negative CHECK (
          daily_transaction_amount_minor >= 0 AND
          single_transaction_amount_minor >= 0 AND
          monthly_transaction_amount_minor >= 0 AND
          wallet_balance_minor >= 0
        ),
        CONSTRAINT chk_customer_limit_profiles_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_limit_profiles_active_customer
         ON customer_limit_profiles (customer_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_limit_profiles_currency
         ON customer_limit_profiles (currency)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_product_enrollments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        product VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reason VARCHAR(500),
        status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_product_enrollments_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_product_enrollments_product CHECK (
          product ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'
        ),
        CONSTRAINT chk_customer_product_enrollments_status CHECK (
          status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')
        ),
        CONSTRAINT chk_customer_product_enrollments_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_product_enrollments_customer_product
         ON customer_product_enrollments (customer_id, product)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_product_enrollments_customer_status
         ON customer_product_enrollments (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_operating_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        type VARCHAR(30) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_operating_permissions_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_operating_permissions_type CHECK (
          type IN (
            'DEPOSIT', 'WITHDRAW', 'TRANSFER', 'PAYMENT', 'BILL_PAYMENT',
            'AIRTIME', 'CARD', 'VIRTUAL_ACCOUNT', 'QR_PAYMENT', 'USSD', 'API'
          )
        ),
        CONSTRAINT chk_customer_operating_permissions_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_operating_permissions_customer_type
         ON customer_operating_permissions (customer_id, type)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_operating_permissions_customer
         ON customer_operating_permissions (customer_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_restrictions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        type VARCHAR(20) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_restrictions_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_restrictions_type CHECK (
          type IN ('NONE', 'LIMITED', 'MANUAL_REVIEW', 'FROZEN', 'BLACKLISTED')
        ),
        CONSTRAINT chk_customer_restrictions_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_restrictions_customer_type
         ON customer_restrictions (customer_id, type)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_restrictions_customer_active
         ON customer_restrictions (customer_id, is_active)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS customer_restrictions`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_operating_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_product_enrollments`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_limit_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_eligibilities`);
  }
}
