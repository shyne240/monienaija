import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB1BillingDocumentTables1785753600033 implements MigrationInterface {
  name = 'CreateB1BillingDocumentTables1785753600033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b1_billing_documents (
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
        billing_record_reference VARCHAR(200),
        invoice_reference VARCHAR(200),
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
        CONSTRAINT uq_b1_billing_documents_reference UNIQUE (document_reference, document_version),
        CONSTRAINT chk_b1_billing_documents_document_reference CHECK (document_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_billing_documents_document_version CHECK (document_version = 1),
        CONSTRAINT chk_b1_billing_documents_document_kind CHECK (document_kind IN ('BILLING_RECORD', 'INVOICE', 'INVOICE_LINE', 'STATEMENT', 'STATEMENT_LINE', 'BILLING_PERIOD', 'STATEMENT_PERIOD')),
        CONSTRAINT chk_b1_billing_documents_document_hash CHECK (document_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_billing_documents_document_replay_hash CHECK (document_replay_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b1_billing_documents_idempotency_scope CHECK (idempotency_scope IN ('b1.billing-engine.idempotency.v1', 'b1.billing-engine.invoice.idempotency.v1', 'b1.billing-engine.statement.idempotency.v1')),
        CONSTRAINT chk_b1_billing_documents_scope_key CHECK (scope_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_billing_documents_scope_version CHECK (scope_version = 1),
        CONSTRAINT chk_b1_billing_documents_billing_record_reference CHECK (billing_record_reference IS NULL OR billing_record_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_billing_documents_invoice_reference CHECK (invoice_reference IS NULL OR invoice_reference ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_billing_documents_customer_id CHECK (customer_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_billing_documents_merchant_id CHECK (merchant_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_billing_documents_partner_id CHECK (partner_id ~ '^[\\x20-\\x7E]{1,64}$'),
        CONSTRAINT chk_b1_billing_documents_product_key CHECK (product_key = 'VIRTUAL_ACCOUNT'),
        CONSTRAINT chk_b1_billing_documents_product_version CHECK (product_version = 1),
        CONSTRAINT chk_b1_billing_documents_period_key CHECK (period_key ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_b1_billing_documents_period_version CHECK (period_version = 1),
        CONSTRAINT chk_b1_billing_documents_classification_level CHECK (classification_level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')),
        CONSTRAINT chk_b1_billing_documents_retention_days CHECK (retention_days >= 0),
        CONSTRAINT chk_b1_billing_documents_correlation_id CHECK (correlation_id ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_b1_billing_documents_reference
        ON b1_billing_documents (document_reference, document_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_scope
        ON b1_billing_documents (scope_key, scope_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_kind
        ON b1_billing_documents (document_kind)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_hash
        ON b1_billing_documents (document_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_replay_hash
        ON b1_billing_documents (document_replay_hash)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_idempotency
        ON b1_billing_documents (idempotency_scope, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_billing_record_reference
        ON b1_billing_documents (billing_record_reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_invoice_reference
        ON b1_billing_documents (invoice_reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_customer_id
        ON b1_billing_documents (customer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_b1_billing_documents_correlation_id
        ON b1_billing_documents (correlation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_correlation_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_customer_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_invoice_reference`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_b1_billing_documents_billing_record_reference`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_replay_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_hash`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_kind`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b1_billing_documents_scope`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b1_billing_documents_reference`);
    await queryRunner.query(`DROP TABLE IF EXISTS b1_billing_documents`);
  }
}
