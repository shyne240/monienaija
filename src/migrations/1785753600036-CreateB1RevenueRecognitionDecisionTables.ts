import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB1RevenueRecognitionDecisionTables1785753600036 implements MigrationInterface {
  name = 'CreateB1RevenueRecognitionDecisionTables1785753600036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b1_revenue_recognition_decisions (
        id UUID PRIMARY KEY,
        document_reference VARCHAR(200) NOT NULL,
        document_version INTEGER NOT NULL,
        document_kind VARCHAR(40) NOT NULL,
        document_hash VARCHAR(64) NOT NULL,
        document_replay_hash VARCHAR(64) NOT NULL,
        idempotency_scope VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        scope_key VARCHAR(200) NOT NULL,
        scope_version INTEGER NOT NULL,
        commercial_decision_reference VARCHAR(200),
        billing_document_reference VARCHAR(200),
        campaign_decision_reference VARCHAR(200),
        referral_decision_reference VARCHAR(200),
        customer_id VARCHAR(64) NOT NULL,
        merchant_id VARCHAR(64) NOT NULL,
        partner_id VARCHAR(64) NOT NULL,
        product_key VARCHAR(80) NOT NULL,
        product_version INTEGER NOT NULL,
        period_key VARCHAR(200) NOT NULL,
        period_version INTEGER NOT NULL,
        classification_level VARCHAR(24) NOT NULL,
        retention_days INTEGER NOT NULL,
        effective_from TIMESTAMPTZ,
        effective_to TIMESTAMPTZ,
        correlation_id VARCHAR(255) NOT NULL,
        record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b1_revenue_recognition_decisions_reference UNIQUE (document_reference, document_version),
        CONSTRAINT chk_b1_revenue_recognition_decisions_document_reference CHECK (document_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_document_version CHECK (document_version = 1),
        CONSTRAINT chk_b1_revenue_recognition_decisions_document_kind CHECK (document_kind IN ('REVENUE_RECOGNITION', 'REVENUE_RECOGNITION_POLICY', 'REVENUE_RECOGNITION_SCHEDULE', 'REVENUE_RECOGNITION_EVENT', 'DEFERRED_REVENUE', 'RECOGNIZED_REVENUE', 'TAX_VAT', 'TAX_VAT_POLICY', 'TAX_JURISDICTION', 'TAX_CATEGORY', 'TAX_EXEMPTION', 'TAX_DECISION', 'TAX_EVIDENCE', 'COST_ACCOUNTING', 'COST_ACCOUNTING_POLICY', 'DIRECT_COST', 'INDIRECT_COST', 'ACQUISITION_COST', 'OPERATIONAL_COST', 'ALLOCATED_COST', 'COST_CATEGORY', 'COST_DECISION')),
        CONSTRAINT chk_b1_revenue_recognition_decisions_document_hash CHECK (document_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_document_replay_hash CHECK (document_replay_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_idempotency_scope CHECK (idempotency_scope IN ('b1.revenue-recognition-engine.revenue-recognition.idempotency.v1', 'b1.revenue-recognition-engine.tax-vat.idempotency.v1', 'b1.revenue-recognition-engine.cost-accounting.idempotency.v1')),
        CONSTRAINT chk_b1_revenue_recognition_decisions_scope_key CHECK (scope_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_scope_version CHECK (scope_version = 1),
        CONSTRAINT chk_b1_revenue_recognition_decisions_commercial_decision_reference CHECK (commercial_decision_reference IS NULL OR commercial_decision_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_billing_document_reference CHECK (billing_document_reference IS NULL OR billing_document_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_campaign_decision_reference CHECK (campaign_decision_reference IS NULL OR campaign_decision_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_referral_decision_reference CHECK (referral_decision_reference IS NULL OR referral_decision_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_customer_id CHECK (customer_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_merchant_id CHECK (merchant_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_partner_id CHECK (partner_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_product_key CHECK (product_key = 'VIRTUAL_ACCOUNT'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_product_version CHECK (product_version = 1),
        CONSTRAINT chk_b1_revenue_recognition_decisions_period_key CHECK (period_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_revenue_recognition_decisions_period_version CHECK (period_version = 1),
        CONSTRAINT chk_b1_revenue_recognition_decisions_classification_level CHECK (classification_level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')),
        CONSTRAINT chk_b1_revenue_recognition_decisions_retention_days CHECK (retention_days >= 0),
        CONSTRAINT chk_b1_revenue_recognition_decisions_correlation_id CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    // The UNIQUE table constraint of the same name already provides the backing
    // unique index (PostgreSQL creates it implicitly), so declaring it again here
    // collides with SQLSTATE 42P07. Uniqueness remains enforced by the constraint.
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_scope
        ON b1_revenue_recognition_decisions (scope_key, scope_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_kind
        ON b1_revenue_recognition_decisions (document_kind)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_hash
        ON b1_revenue_recognition_decisions (document_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_replay_hash
        ON b1_revenue_recognition_decisions (document_replay_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_idempotency
        ON b1_revenue_recognition_decisions (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_commercial_decision_reference
        ON b1_revenue_recognition_decisions (commercial_decision_reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_billing_document_reference
        ON b1_revenue_recognition_decisions (billing_document_reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_campaign_decision_reference
        ON b1_revenue_recognition_decisions (campaign_decision_reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_referral_decision_reference
        ON b1_revenue_recognition_decisions (referral_decision_reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_customer_id
        ON b1_revenue_recognition_decisions (customer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_revenue_recognition_decisions_correlation_id
        ON b1_revenue_recognition_decisions (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_correlation_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_customer_id`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_referral_decision_reference`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_campaign_decision_reference`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_billing_document_reference`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_commercial_decision_reference`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_idempotency`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_replay_hash`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_kind`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_revenue_recognition_decisions_scope`);
    await queryRunner.query(`DROP TABLE IF EXISTS b1_revenue_recognition_decisions`);
  }
}
