import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB1CommercialCatalogTables1785753600031 implements MigrationInterface {
  name = 'CreateB1CommercialCatalogTables1785753600031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b1_commercial_catalog_registrations (
        id UUID PRIMARY KEY,
        catalog_key VARCHAR(200) NOT NULL,
        catalog_version INTEGER NOT NULL,
        scope_key VARCHAR(200) NOT NULL,
        scope_version INTEGER NOT NULL,
        plan_key VARCHAR(200),
        plan_version INTEGER,
        customer_tier_key VARCHAR(200),
        merchant_tier_key VARCHAR(200),
        partner_tier_key VARCHAR(200),
        product_entitlement_key VARCHAR(200),
        package_key VARCHAR(200),
        package_version INTEGER,
        bundle_key VARCHAR(200),
        bundle_version INTEGER,
        subscription_key VARCHAR(200),
        subscription_version INTEGER,
        feature_flag_key VARCHAR(200),
        dynamic_limit_key VARCHAR(200),
        pricing_key VARCHAR(200),
        effective_from TIMESTAMPTZ,
        effective_to TIMESTAMPTZ,
        classification_level VARCHAR(24) NOT NULL,
        retention_days INTEGER NOT NULL,
        registration JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b1_commercial_catalog_registrations_key UNIQUE (catalog_key, catalog_version),
        CONSTRAINT chk_b1_commercial_catalog_registrations_catalog_key CHECK (catalog_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_catalog_version CHECK (catalog_version = 1),
        CONSTRAINT chk_b1_commercial_catalog_registrations_scope_key CHECK (scope_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_scope_version CHECK (scope_version = 1),
        CONSTRAINT chk_b1_commercial_catalog_registrations_plan_key CHECK (plan_key IS NULL OR plan_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_plan_version CHECK (plan_version IS NULL OR plan_version = 1),
        CONSTRAINT chk_b1_commercial_catalog_registrations_customer_tier_key CHECK (customer_tier_key IS NULL OR customer_tier_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_merchant_tier_key CHECK (merchant_tier_key IS NULL OR merchant_tier_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_partner_tier_key CHECK (partner_tier_key IS NULL OR partner_tier_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_product_entitlement_key CHECK (product_entitlement_key IS NULL OR product_entitlement_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_package_key CHECK (package_key IS NULL OR package_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_package_version CHECK (package_version IS NULL OR package_version = 1),
        CONSTRAINT chk_b1_commercial_catalog_registrations_bundle_key CHECK (bundle_key IS NULL OR bundle_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_bundle_version CHECK (bundle_version IS NULL OR bundle_version = 1),
        CONSTRAINT chk_b1_commercial_catalog_registrations_subscription_key CHECK (subscription_key IS NULL OR subscription_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_subscription_version CHECK (subscription_version IS NULL OR subscription_version = 1),
        CONSTRAINT chk_b1_commercial_catalog_registrations_feature_flag_key CHECK (feature_flag_key IS NULL OR feature_flag_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_dynamic_limit_key CHECK (dynamic_limit_key IS NULL OR dynamic_limit_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_pricing_key CHECK (pricing_key IS NULL OR pricing_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_catalog_registrations_classification_level CHECK (classification_level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')),
        CONSTRAINT chk_b1_commercial_catalog_registrations_retention_days CHECK (retention_days >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b1_commercial_catalog_registrations_key
        ON b1_commercial_catalog_registrations (catalog_key, catalog_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_scope
        ON b1_commercial_catalog_registrations (scope_key, scope_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_plan
        ON b1_commercial_catalog_registrations (plan_key, plan_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_customer_tier
        ON b1_commercial_catalog_registrations (customer_tier_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_merchant_tier
        ON b1_commercial_catalog_registrations (merchant_tier_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_partner_tier
        ON b1_commercial_catalog_registrations (partner_tier_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_entitlement
        ON b1_commercial_catalog_registrations (product_entitlement_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_package
        ON b1_commercial_catalog_registrations (package_key, package_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_bundle
        ON b1_commercial_catalog_registrations (bundle_key, bundle_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_subscription
        ON b1_commercial_catalog_registrations (subscription_key, subscription_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_feature_flag
        ON b1_commercial_catalog_registrations (feature_flag_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_dynamic_limit
        ON b1_commercial_catalog_registrations (dynamic_limit_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_catalog_registrations_pricing
        ON b1_commercial_catalog_registrations (pricing_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_pricing`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_dynamic_limit`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_feature_flag`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_subscription`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_bundle`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_package`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_entitlement`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_partner_tier`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_merchant_tier`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_customer_tier`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_plan`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_catalog_registrations_scope`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b1_commercial_catalog_registrations_key`);
    await queryRunner.query(`DROP TABLE IF EXISTS b1_commercial_catalog_registrations`);
  }
}
