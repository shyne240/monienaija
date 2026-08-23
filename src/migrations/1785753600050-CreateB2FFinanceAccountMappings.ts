import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateB2FFinanceAccountMappings1785753600050 implements MigrationInterface {
  name = 'CreateB2FFinanceAccountMappings1785753600050';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE b2f_finance_account_mappings (
 id UUID PRIMARY KEY,mapping_reference VARCHAR(100) NOT NULL,mapping_version INTEGER NOT NULL,status VARCHAR(24) NOT NULL,
 book_key VARCHAR(100) NOT NULL,book_version INTEGER NOT NULL,classification_key VARCHAR(160) NOT NULL,classification_version INTEGER NOT NULL,
 a5_ledger_account_id UUID NOT NULL,observed_a5_code VARCHAR(100) NOT NULL,observed_a5_name VARCHAR(160) NOT NULL,
 observed_a5_account_type VARCHAR(20) NOT NULL,observed_a5_normal_balance VARCHAR(6) NOT NULL,observed_a5_active BOOLEAN NOT NULL,
 observed_a5_allow_negative_balance BOOLEAN NOT NULL,currency VARCHAR(3) NOT NULL,accounting_unit VARCHAR(64) NOT NULL,
 effective_from TIMESTAMPTZ NOT NULL,effective_to TIMESTAMPTZ,idempotency_scope VARCHAR(120) NOT NULL,idempotency_key VARCHAR(255) NOT NULL,
 request_hash CHAR(64) NOT NULL,decision_hash CHAR(64) NOT NULL,a5_snapshot_hash CHAR(64) NOT NULL,control_decision_reference VARCHAR(100),
 created_by VARCHAR(160) NOT NULL,created_roles JSONB NOT NULL,approved_by VARCHAR(160),last_reason VARCHAR(500),correlation_id VARCHAR(255) NOT NULL,
 causation_id VARCHAR(255),record_version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT uq_b2f_account_mapping_reference_version UNIQUE(mapping_reference,mapping_version),
 CONSTRAINT uq_b2f_account_mapping_semantic_version UNIQUE(book_key,classification_key,a5_ledger_account_id,mapping_version),
 CONSTRAINT fk_b2f_account_mapping_a5 FOREIGN KEY(a5_ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
 CONSTRAINT chk_b2f_account_mapping_status CHECK(status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','EXPIRED','REVOKED','REJECTED')),
 CONSTRAINT chk_b2f_account_mapping_scope CHECK(book_key='finance.book.ng.primary' AND book_version=1 AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'),
 CONSTRAINT chk_b2f_account_mapping_hashes CHECK(request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$' AND a5_snapshot_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT chk_b2f_account_mapping_idempotency CHECK(idempotency_scope='b2.finance.account-mapping.idempotency.v1'),
 CONSTRAINT chk_b2f_account_mapping_dates CHECK(effective_to IS NULL OR effective_to > effective_from)
 )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_b2f_account_mapping_active_a5 ON b2f_finance_account_mappings(book_key,a5_ledger_account_id) WHERE status='ACTIVE'`,
    );
    await q.query(
      `CREATE INDEX idx_b2f_account_mapping_classification ON b2f_finance_account_mappings(book_key,classification_key,status)`,
    );
    await q.query(
      `CREATE INDEX idx_b2f_account_mapping_effective ON b2f_finance_account_mappings(status,effective_from,effective_to)`,
    );
    await q.query(
      `CREATE INDEX idx_b2f_account_mapping_idempotency ON b2f_finance_account_mappings(idempotency_scope,idempotency_key)`,
    );
    await q.query(
      `CREATE INDEX idx_b2f_account_mapping_correlation ON b2f_finance_account_mappings(correlation_id)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_b2f_account_mapping_correlation`);
    await q.query(`DROP INDEX IF EXISTS idx_b2f_account_mapping_idempotency`);
    await q.query(`DROP INDEX IF EXISTS idx_b2f_account_mapping_effective`);
    await q.query(`DROP INDEX IF EXISTS idx_b2f_account_mapping_classification`);
    await q.query(`DROP INDEX IF EXISTS uq_b2f_account_mapping_active_a5`);
    await q.query(`DROP TABLE IF EXISTS b2f_finance_account_mappings`);
  }
}
