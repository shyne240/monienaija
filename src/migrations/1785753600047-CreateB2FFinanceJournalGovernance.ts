import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateB2FFinanceJournalGovernance1785753600047 implements MigrationInterface {
  name = 'CreateB2FFinanceJournalGovernance1785753600047';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE b2f_finance_journal_governance (
    id UUID PRIMARY KEY, finance_journal_reference VARCHAR(100) NOT NULL UNIQUE, finance_journal_version INTEGER NOT NULL,
    state VARCHAR(24) NOT NULL, classification VARCHAR(24) NOT NULL, book_key VARCHAR(100) NOT NULL, book_version INTEGER NOT NULL,
    legal_entity_reference VARCHAR(120) NOT NULL, accounting_basis VARCHAR(20) NOT NULL, period_key VARCHAR(100) NOT NULL, period_version INTEGER NOT NULL,
    accounting_date DATE NOT NULL, currency VARCHAR(3) NOT NULL, accounting_unit VARCHAR(64) NOT NULL, description VARCHAR(500) NOT NULL,
    source_document JSONB NOT NULL, lines JSONB NOT NULL, total_debit_minor VARCHAR(80) NOT NULL, total_credit_minor VARCHAR(80) NOT NULL,
    request_hash CHAR(64) NOT NULL, decision_hash CHAR(64) NOT NULL, replay_hash CHAR(64) NOT NULL, approval_id UUID,
    a5_idempotency_key VARCHAR(255) NOT NULL, a5_journal_id UUID, a5_posted_at TIMESTAMPTZ, posting_failure_code VARCHAR(100),
    posting_failure_message VARCHAR(500), correlation_id VARCHAR(255) NOT NULL, causation_id VARCHAR(255), record_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_b2f_finance_journal_state CHECK (state IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','POSTING_REQUESTED','POSTED','FAILED','POSTING_UNKNOWN')),
    CONSTRAINT chk_b2f_finance_journal_scope CHECK (book_key='finance.book.ng.primary' AND book_version=1 AND legal_entity_reference='finance.legal-entity.ng.primary' AND accounting_basis='ACCRUAL' AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'),
    CONSTRAINT chk_b2f_finance_journal_hashes CHECK (request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$' AND replay_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT chk_b2f_finance_journal_totals CHECK (total_debit_minor::numeric > 0 AND total_debit_minor::numeric=total_credit_minor::numeric),
    CONSTRAINT chk_b2f_finance_journal_posted CHECK (state <> 'POSTED' OR (a5_journal_id IS NOT NULL AND a5_posted_at IS NOT NULL)),
    CONSTRAINT fk_b2f_finance_journal_period FOREIGN KEY (period_key, period_version) REFERENCES b2f_finance_accounting_periods(period_key, period_version) ON DELETE RESTRICT,
    CONSTRAINT fk_b2f_finance_journal_a5 FOREIGN KEY (a5_journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT
  )`);
    await queryRunner.query(
      `CREATE INDEX idx_b2f_finance_journal_state ON b2f_finance_journal_governance(state,updated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_b2f_finance_journal_period ON b2f_finance_journal_governance(period_key,accounting_date)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_b2f_finance_journal_a5 ON b2f_finance_journal_governance(a5_journal_id) WHERE a5_journal_id IS NOT NULL`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_b2f_finance_journal_a5`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2f_finance_journal_period`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2f_finance_journal_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2f_finance_journal_governance`);
  }
}
