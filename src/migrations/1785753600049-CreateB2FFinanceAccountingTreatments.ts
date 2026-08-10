import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateB2FFinanceAccountingTreatments1785753600049 implements MigrationInterface {
  name = 'CreateB2FFinanceAccountingTreatments1785753600049';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE b2f_finance_accounting_treatments (
 id UUID PRIMARY KEY,treatment_reference VARCHAR(100) NOT NULL UNIQUE,treatment_version INTEGER NOT NULL,state VARCHAR(24) NOT NULL,
 source_category VARCHAR(48) NOT NULL,source_owner VARCHAR(8) NOT NULL,source_reference VARCHAR(200) NOT NULL,source_version INTEGER NOT NULL,
 source_hash CHAR(64) NOT NULL,source_effective_at TIMESTAMPTZ NOT NULL,book_key VARCHAR(100) NOT NULL,book_version INTEGER NOT NULL,
 legal_entity_reference VARCHAR(120) NOT NULL,accounting_basis VARCHAR(20) NOT NULL,currency VARCHAR(3) NOT NULL,accounting_unit VARCHAR(64) NOT NULL,
 period_key VARCHAR(100) NOT NULL,period_version INTEGER NOT NULL,accounting_date DATE NOT NULL,request_hash CHAR(64) NOT NULL,
 decision_hash CHAR(64) NOT NULL,control_decision_reference VARCHAR(100),finance_journal_reference VARCHAR(100),decision JSONB NOT NULL,
 correlation_id VARCHAR(255) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT uq_b2f_finance_treatment_source UNIQUE(source_category,source_reference,source_version,treatment_version),
 CONSTRAINT chk_b2f_finance_treatment_state CHECK(state IN ('ADOPTED','JOURNAL_DRAFT_CREATED','REJECTED')),
 CONSTRAINT chk_b2f_finance_treatment_owner CHECK(source_owner IN ('B1','A6','A7')),
 CONSTRAINT chk_b2f_finance_treatment_hashes CHECK(request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$' AND source_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT chk_b2f_finance_treatment_scope CHECK(book_key='finance.book.ng.primary' AND book_version=1 AND legal_entity_reference='finance.legal-entity.ng.primary' AND accounting_basis='ACCRUAL' AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'),
 CONSTRAINT fk_b2f_finance_treatment_period FOREIGN KEY(period_key,period_version) REFERENCES b2f_finance_accounting_periods(period_key,period_version) ON DELETE RESTRICT,
 CONSTRAINT fk_b2f_finance_treatment_journal FOREIGN KEY(finance_journal_reference) REFERENCES b2f_finance_journal_governance(finance_journal_reference) ON DELETE RESTRICT
 )`);
    await q.query(
      `CREATE INDEX idx_b2f_finance_treatment_state ON b2f_finance_accounting_treatments(state,created_at)`,
    );
    await q.query(
      `CREATE INDEX idx_b2f_finance_treatment_period ON b2f_finance_accounting_treatments(period_key,accounting_date)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_b2f_finance_treatment_period`);
    await q.query(`DROP INDEX IF EXISTS idx_b2f_finance_treatment_state`);
    await q.query(`DROP TABLE IF EXISTS b2f_finance_accounting_treatments`);
  }
}
