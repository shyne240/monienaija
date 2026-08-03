import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWalletAndLedger1785753600000 implements MigrationInterface {
  name = 'CreateWalletAndLedger1785753600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ledger_accounts (
        id UUID PRIMARY KEY,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(160) NOT NULL,
        account_type VARCHAR(20) NOT NULL,
        normal_balance VARCHAR(6) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL DEFAULT 'CUSTOMER_FUNDS',
        allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_ledger_accounts_code UNIQUE (code),
        CONSTRAINT chk_ledger_accounts_code_non_empty CHECK (length(code) >= 2),
        CONSTRAINT chk_ledger_accounts_type CHECK (
          account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')
        ),
        CONSTRAINT chk_ledger_accounts_normal_balance CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
        CONSTRAINT chk_ledger_accounts_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_ledger_accounts_unit CHECK (accounting_unit ~ '^[A-Z][A-Z0-9_:-]{1,63}$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ledger_journals (
        id UUID PRIMARY KEY,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL DEFAULT 'CUSTOMER_FUNDS',
        status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
        reference VARCHAR(255),
        description VARCHAR(255),
        correlation_id VARCHAR(255),
        reversal_of_journal_id UUID,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        total_minor BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_ledger_journals_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT chk_ledger_journals_idempotency_non_empty CHECK (length(idempotency_key) > 0),
        CONSTRAINT chk_ledger_journals_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_ledger_journals_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_ledger_journals_unit CHECK (accounting_unit ~ '^[A-Z][A-Z0-9_:-]{1,63}$'),
        CONSTRAINT chk_ledger_journals_status CHECK (status = 'POSTED'),
        CONSTRAINT chk_ledger_journals_total_positive CHECK (total_minor > 0),
        CONSTRAINT fk_ledger_journals_reversal
          FOREIGN KEY (reversal_of_journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE ledger_lines (
        id UUID PRIMARY KEY,
        journal_id UUID NOT NULL,
        ledger_account_id UUID NOT NULL,
        line_number SMALLINT NOT NULL,
        direction VARCHAR(6) NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_ledger_lines_journal_line_number UNIQUE (journal_id, line_number),
        CONSTRAINT chk_ledger_lines_line_number CHECK (line_number > 0),
        CONSTRAINT chk_ledger_lines_direction CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT chk_ledger_lines_amount_positive CHECK (amount_minor > 0),
        CONSTRAINT chk_ledger_lines_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_ledger_lines_unit CHECK (accounting_unit ~ '^[A-Z][A-Z0-9_:-]{1,63}$'),
        CONSTRAINT fk_ledger_lines_journal
          FOREIGN KEY (journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        CONSTRAINT fk_ledger_lines_account
          FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE wallet_accounts (
        id UUID PRIMARY KEY,
        customer_id VARCHAR(160) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        ledger_account_id UUID NOT NULL,
        creation_idempotency_key VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wallet_accounts_customer_currency UNIQUE (customer_id, currency),
        CONSTRAINT uq_wallet_accounts_ledger_account UNIQUE (ledger_account_id),
        CONSTRAINT chk_wallet_accounts_customer_non_empty CHECK (length(customer_id) > 0),
        CONSTRAINT chk_wallet_accounts_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_wallet_accounts_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
        CONSTRAINT chk_wallet_accounts_idempotency_non_empty CHECK (
          creation_idempotency_key IS NULL OR length(creation_idempotency_key) > 0
        ),
        CONSTRAINT fk_wallet_accounts_ledger_account
          FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_wallet_accounts_creation_idempotency_key
         ON wallet_accounts (creation_idempotency_key)
       WHERE creation_idempotency_key IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_ledger_journals_reversal_of
         ON ledger_journals (reversal_of_journal_id)
       WHERE reversal_of_journal_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ledger_accounts_currency_unit
         ON ledger_accounts (currency, accounting_unit)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_ledger_lines_account_created
         ON ledger_lines (ledger_account_id, created_at)`,
    );
    await queryRunner.query(`CREATE INDEX idx_ledger_lines_journal ON ledger_lines (journal_id)`);
    await queryRunner.query(
      `CREATE INDEX idx_wallet_accounts_customer ON wallet_accounts (customer_id)`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION assert_wallet_ledger_account()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      DECLARE
        account_type_value VARCHAR(20);
        normal_balance_value VARCHAR(6);
        account_currency VARCHAR(3);
        account_unit VARCHAR(64);
        negative_balance_allowed BOOLEAN;
      BEGIN
        SELECT a.account_type, a.normal_balance, a.currency, a.accounting_unit, a.allow_negative_balance
          INTO account_type_value, normal_balance_value, account_currency, account_unit, negative_balance_allowed
          FROM ledger_accounts a
         WHERE a.id = NEW.ledger_account_id;

        IF NOT FOUND
           OR account_type_value <> 'LIABILITY'
           OR normal_balance_value <> 'CREDIT'
           OR account_currency <> NEW.currency
           OR account_unit <> 'CUSTOMER_FUNDS'
           OR negative_balance_allowed THEN
          RAISE EXCEPTION 'Wallet % must reference a non-negative customer-funds liability account', NEW.id
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER wallet_account_ledger_account_is_valid
      BEFORE INSERT OR UPDATE ON wallet_accounts
      FOR EACH ROW EXECUTE FUNCTION assert_wallet_ledger_account()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION assert_ledger_journal_balanced()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      DECLARE
        target_journal_id UUID;
        journal_currency VARCHAR(3);
        journal_unit VARCHAR(64);
        journal_total BIGINT;
        line_count BIGINT;
        debit_total NUMERIC;
        credit_total NUMERIC;
        mismatch_count BIGINT;
        negative_account_count BIGINT;
      BEGIN
        IF TG_TABLE_NAME = 'ledger_lines' THEN
          IF TG_OP = 'DELETE' THEN
            target_journal_id := OLD.journal_id;
          ELSE
            target_journal_id := NEW.journal_id;
          END IF;
        ELSE
          IF TG_OP = 'DELETE' THEN
            target_journal_id := OLD.id;
          ELSE
            target_journal_id := NEW.id;
          END IF;
        END IF;

        SELECT j.currency, j.accounting_unit, j.total_minor
          INTO journal_currency, journal_unit, journal_total
          FROM ledger_journals j
         WHERE j.id = target_journal_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Ledger journal % does not exist', target_journal_id
            USING ERRCODE = '23503';
        END IF;

        SELECT COUNT(*),
               COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)
          INTO line_count, debit_total, credit_total
          FROM ledger_lines l
         WHERE l.journal_id = target_journal_id;

        SELECT COUNT(*)
          INTO mismatch_count
          FROM ledger_lines l
          JOIN ledger_accounts a ON a.id = l.ledger_account_id
         WHERE l.journal_id = target_journal_id
           AND (l.currency <> journal_currency
             OR l.accounting_unit <> journal_unit
             OR a.currency <> l.currency
             OR a.accounting_unit <> l.accounting_unit
             OR NOT a.is_active);

        SELECT COUNT(*)
          INTO negative_account_count
          FROM ledger_accounts a
         WHERE NOT a.allow_negative_balance
           AND EXISTS (
             SELECT 1
               FROM ledger_lines l
              WHERE l.journal_id = target_journal_id
                AND l.ledger_account_id = a.id
           )
           AND (
             SELECT COALESCE(
               SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),
               0
             )
               FROM ledger_lines l
              WHERE l.ledger_account_id = a.id
           ) < 0;

        IF line_count < 2
           OR debit_total <> credit_total
           OR debit_total <> journal_total
           OR mismatch_count > 0
           OR negative_account_count > 0 THEN
          RAISE EXCEPTION 'Ledger journal % is not balanced, complete, and currency-consistent', target_journal_id
            USING ERRCODE = '23514';
        END IF;

        RETURN NULL;
      END;
      $$
    `);

    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER ledger_journal_must_balance
      AFTER INSERT OR UPDATE ON ledger_journals
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION assert_ledger_journal_balanced()
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER ledger_lines_must_balance_journal
      AFTER INSERT OR UPDATE OR DELETE ON ledger_lines
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION assert_ledger_journal_balanced()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_ledger_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Posted ledger records are immutable'
          USING ERRCODE = '55000';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER ledger_journals_are_immutable
      BEFORE UPDATE OR DELETE ON ledger_journals
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER ledger_lines_are_immutable
      BEFORE UPDATE OR DELETE ON ledger_lines
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS ledger_lines_are_immutable ON ledger_lines`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS ledger_journals_are_immutable ON ledger_journals`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS ledger_lines_must_balance_journal ON ledger_lines`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS ledger_journal_must_balance ON ledger_journals`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_ledger_mutation()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS wallet_account_ledger_account_is_valid ON wallet_accounts`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS assert_wallet_ledger_account()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS assert_ledger_journal_balanced()`);
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_accounts`);
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_lines`);
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_journals`);
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_accounts`);
  }
}
