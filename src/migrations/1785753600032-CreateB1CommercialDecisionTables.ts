import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB1CommercialDecisionTables1785753600032 implements MigrationInterface {
  name = 'CreateB1CommercialDecisionTables1785753600032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b1_commercial_decisions (
        id UUID PRIMARY KEY,
        decision_reference VARCHAR(200) NOT NULL,
        decision_version INTEGER NOT NULL,
        decision_kind VARCHAR(24) NOT NULL,
        scope_key VARCHAR(200) NOT NULL,
        scope_version INTEGER NOT NULL,
        decision_outcome VARCHAR(40) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        decision_hash VARCHAR(64) NOT NULL,
        decision_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        base_amount_minor VARCHAR(80) NOT NULL,
        base_currency VARCHAR(8) NOT NULL,
        currency VARCHAR(8) NOT NULL,
        accounting_unit VARCHAR(40) NOT NULL,
        customer_id VARCHAR(64) NOT NULL,
        customer_tier_key VARCHAR(200) NOT NULL,
        customer_tier_version INTEGER NOT NULL,
        merchant_id VARCHAR(64) NOT NULL,
        merchant_tier_key VARCHAR(200) NOT NULL,
        merchant_tier_version INTEGER NOT NULL,
        partner_id VARCHAR(64) NOT NULL,
        partner_tier_key VARCHAR(200) NOT NULL,
        partner_tier_version INTEGER NOT NULL,
        product_key VARCHAR(80) NOT NULL,
        product_version INTEGER NOT NULL,
        capability_key VARCHAR(200) NOT NULL,
        capability_version INTEGER NOT NULL,
        plan_key VARCHAR(200) NOT NULL,
        plan_version INTEGER NOT NULL,
        subscription_key VARCHAR(200) NOT NULL,
        subscription_version INTEGER NOT NULL,
        package_key VARCHAR(200) NOT NULL,
        package_version INTEGER NOT NULL,
        bundle_key VARCHAR(200) NOT NULL,
        bundle_version INTEGER NOT NULL,
        product_entitlement_key VARCHAR(200) NOT NULL,
        product_entitlement_version INTEGER NOT NULL,
        feature_flag_key VARCHAR(200),
        dynamic_limit_key VARCHAR(200),
        classification_level VARCHAR(24) NOT NULL,
        retention_days INTEGER NOT NULL,
        effective_from TIMESTAMPTZ,
        effective_to TIMESTAMPTZ,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b1_commercial_decisions_reference UNIQUE (decision_reference, decision_version),
        CONSTRAINT chk_b1_commercial_decisions_decision_reference CHECK (decision_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_decision_version CHECK (decision_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_decision_kind CHECK (decision_kind IN ('FEE', 'COMMISSION', 'REVENUE_SHARING')),
        CONSTRAINT chk_b1_commercial_decisions_scope_key CHECK (scope_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_scope_version CHECK (scope_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_decision_outcome CHECK (decision_outcome IN ('COMMERCIAL_DECISION_ADMITTED', 'COMMERCIAL_DECISION_SUPPRESSED', 'COMMERCIAL_DECISION_DISABLED', 'COMMERCIAL_DECISION_FAILED')),
        CONSTRAINT chk_b1_commercial_decisions_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_commercial_decisions_decision_hash CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_commercial_decisions_decision_replay_hash CHECK (decision_replay_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_commercial_decisions_idempotency_scope CHECK (idempotency_scope = 'b1.commercial-decision.idempotency.v1'),
        CONSTRAINT chk_b1_commercial_decisions_base_amount_minor CHECK (base_amount_minor ~ '^[0-9]{1,80}$'),
        CONSTRAINT chk_b1_commercial_decisions_base_currency CHECK (base_currency IN ('NGN')),
        CONSTRAINT chk_b1_commercial_decisions_currency CHECK (currency IN ('NGN')),
        CONSTRAINT chk_b1_commercial_decisions_accounting_unit CHECK (accounting_unit = 'CUSTOMER_FUNDS'),
        CONSTRAINT chk_b1_commercial_decisions_customer_id CHECK (customer_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_commercial_decisions_customer_tier_key CHECK (customer_tier_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_customer_tier_version CHECK (customer_tier_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_merchant_id CHECK (merchant_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_commercial_decisions_merchant_tier_key CHECK (merchant_tier_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_merchant_tier_version CHECK (merchant_tier_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_partner_id CHECK (partner_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_commercial_decisions_partner_tier_key CHECK (partner_tier_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_partner_tier_version CHECK (partner_tier_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_product_key CHECK (product_key ~ '^[\\x20-\\x7E]{1,80}$'),
        CONSTRAINT chk_b1_commercial_decisions_product_version CHECK (product_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_capability_key CHECK (capability_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_capability_version CHECK (capability_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_plan_key CHECK (plan_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_plan_version CHECK (plan_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_subscription_key CHECK (subscription_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_subscription_version CHECK (subscription_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_package_key CHECK (package_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_package_version CHECK (package_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_bundle_key CHECK (bundle_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_bundle_version CHECK (bundle_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_product_entitlement_key CHECK (product_entitlement_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_product_entitlement_version CHECK (product_entitlement_version = 1),
        CONSTRAINT chk_b1_commercial_decisions_feature_flag_key CHECK (feature_flag_key IS NULL OR feature_flag_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_dynamic_limit_key CHECK (dynamic_limit_key IS NULL OR dynamic_limit_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_commercial_decisions_classification_level CHECK (classification_level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')),
        CONSTRAINT chk_b1_commercial_decisions_retention_days CHECK (retention_days >= 0),
        CONSTRAINT chk_b1_commercial_decisions_correlation_id CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b1_commercial_decisions_reference
        ON b1_commercial_decisions (decision_reference, decision_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_scope
        ON b1_commercial_decisions (scope_key, scope_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_kind
        ON b1_commercial_decisions (decision_kind)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_outcome
        ON b1_commercial_decisions (decision_outcome)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_request_hash
        ON b1_commercial_decisions (request_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_decision_hash
        ON b1_commercial_decisions (decision_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_idempotency
        ON b1_commercial_decisions (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_plan
        ON b1_commercial_decisions (plan_key, plan_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_subscription
        ON b1_commercial_decisions (subscription_key, subscription_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_package
        ON b1_commercial_decisions (package_key, package_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_bundle
        ON b1_commercial_decisions (bundle_key, bundle_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_product_entitlement
        ON b1_commercial_decisions (product_entitlement_key, product_entitlement_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_customer_tier
        ON b1_commercial_decisions (customer_tier_key, customer_tier_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_merchant_tier
        ON b1_commercial_decisions (merchant_tier_key, merchant_tier_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_partner_tier
        ON b1_commercial_decisions (partner_tier_key, partner_tier_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_feature_flag
        ON b1_commercial_decisions (feature_flag_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_dynamic_limit
        ON b1_commercial_decisions (dynamic_limit_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_commercial_decisions_correlation
        ON b1_commercial_decisions (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_correlation`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_dynamic_limit`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_feature_flag`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_partner_tier`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_merchant_tier`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_customer_tier`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_product_entitlement`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_bundle`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_package`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_subscription`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_plan`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_decision_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_request_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_outcome`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_kind`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_commercial_decisions_scope`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b1_commercial_decisions_reference`);
    await queryRunner.query(`DROP TABLE IF EXISTS b1_commercial_decisions`);
  }
}
