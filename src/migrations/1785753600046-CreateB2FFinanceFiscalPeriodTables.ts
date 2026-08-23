import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB2FFinanceFiscalPeriodTables1785753600046 implements MigrationInterface {
  name = 'CreateB2FFinanceFiscalPeriodTables1785753600046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE b2f_finance_fiscal_years (
        id UUID PRIMARY KEY,
        fiscal_year_reference VARCHAR(100) NOT NULL,
        fiscal_year_key VARCHAR(100) NOT NULL,
        fiscal_year_version INTEGER NOT NULL,
        fiscal_year INTEGER NOT NULL,
        state VARCHAR(20) NOT NULL,
        book_key VARCHAR(100) NOT NULL,
        book_version INTEGER NOT NULL,
        legal_entity_reference VARCHAR(120) NOT NULL,
        jurisdiction VARCHAR(2) NOT NULL,
        accounting_basis VARCHAR(20) NOT NULL,
        functional_currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL,
        calendar_key VARCHAR(120) NOT NULL,
        calendar_version INTEGER NOT NULL,
        start_date DATE NOT NULL,
        end_date_exclusive DATE NOT NULL,
        definition_hash CHAR(64) NOT NULL,
        created_by VARCHAR(160) NOT NULL,
        last_correlation_id VARCHAR(255) NOT NULL,
        record_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2f_finance_fiscal_year_reference UNIQUE (fiscal_year_reference),
        CONSTRAINT uq_b2f_finance_fiscal_year_key_version UNIQUE (fiscal_year_key, fiscal_year_version),
        CONSTRAINT chk_b2f_finance_fiscal_year_value CHECK (fiscal_year BETWEEN 2000 AND 9999),
        CONSTRAINT chk_b2f_finance_fiscal_year_state CHECK (state IN ('PLANNED','ACTIVE','CLOSED','RETIRED')),
        CONSTRAINT chk_b2f_finance_fiscal_year_scope CHECK (
          book_key = 'finance.book.ng.primary' AND book_version = 1
          AND legal_entity_reference = 'finance.legal-entity.ng.primary'
          AND jurisdiction = 'NG' AND accounting_basis = 'ACCRUAL'
          AND functional_currency = 'NGN' AND accounting_unit = 'CUSTOMER_FUNDS'
          AND calendar_key = 'finance.calendar.ng.gregorian' AND calendar_version = 1
        ),
        CONSTRAINT chk_b2f_finance_fiscal_year_hash CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2f_finance_fiscal_year_dates CHECK (end_date_exclusive > start_date),
        CONSTRAINT chk_b2f_finance_fiscal_year_record_version CHECK (record_version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_b2f_finance_fiscal_year_state ON b2f_finance_fiscal_years (state)`,
    );

    await queryRunner.query(`
      CREATE TABLE b2f_finance_accounting_periods (
        id UUID PRIMARY KEY,
        period_reference VARCHAR(100) NOT NULL,
        period_key VARCHAR(100) NOT NULL,
        period_version INTEGER NOT NULL,
        fiscal_year_id UUID NOT NULL,
        fiscal_year_reference VARCHAR(100) NOT NULL,
        period_number SMALLINT NOT NULL,
        period_label VARCHAR(7) NOT NULL,
        start_date DATE NOT NULL,
        end_date_exclusive DATE NOT NULL,
        cutoff_at TIMESTAMPTZ NOT NULL,
        state VARCHAR(20) NOT NULL,
        state_version INTEGER NOT NULL DEFAULT 1,
        definition_hash CHAR(64) NOT NULL,
        last_decision_hash CHAR(64),
        opened_at TIMESTAMPTZ,
        soft_closed_at TIMESTAMPTZ,
        hard_closed_at TIMESTAMPTZ,
        reopened_at TIMESTAMPTZ,
        reopen_expires_at TIMESTAMPTZ,
        retired_at TIMESTAMPTZ,
        last_approval_id UUID,
        last_reason VARCHAR(500),
        last_control_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_correlation_id VARCHAR(255),
        last_request_id VARCHAR(255),
        record_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_b2f_finance_period_reference UNIQUE (period_reference),
        CONSTRAINT uq_b2f_finance_period_key_version UNIQUE (period_key, period_version),
        CONSTRAINT uq_b2f_finance_period_year_number UNIQUE (fiscal_year_id, period_number),
        CONSTRAINT fk_b2f_finance_period_fiscal_year FOREIGN KEY (fiscal_year_id)
          REFERENCES b2f_finance_fiscal_years(id) ON DELETE RESTRICT,
        CONSTRAINT chk_b2f_finance_period_number CHECK (period_number BETWEEN 1 AND 12),
        CONSTRAINT chk_b2f_finance_period_state CHECK (state IN ('PLANNED','OPEN','SOFT_CLOSED','HARD_CLOSED','REOPENED','RETIRED')),
        CONSTRAINT chk_b2f_finance_period_hash CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2f_finance_period_last_decision_hash CHECK (last_decision_hash IS NULL OR last_decision_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_b2f_finance_period_dates CHECK (end_date_exclusive > start_date),
        CONSTRAINT chk_b2f_finance_period_state_version CHECK (state_version > 0),
        CONSTRAINT chk_b2f_finance_period_record_version CHECK (record_version > 0),
        CONSTRAINT chk_b2f_finance_period_reopen CHECK (
          state <> 'REOPENED' OR (reopened_at IS NOT NULL AND reopen_expires_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_b2f_finance_period_state ON b2f_finance_accounting_periods (state, start_date)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_b2f_finance_period_year ON b2f_finance_accounting_periods (fiscal_year_id, period_number)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2f_finance_period_year`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2f_finance_period_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2f_finance_accounting_periods`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_b2f_finance_fiscal_year_state`);
    await queryRunner.query(`DROP TABLE IF EXISTS b2f_finance_fiscal_years`);
  }
}
