import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerFinancialAccountBindings1785753600021 implements MigrationInterface {
  name = 'CreateCustomerFinancialAccountBindings1785753600021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_wallets
        ADD CONSTRAINT uq_customer_wallets_id_customer UNIQUE (id, customer_id)
    `);
    await queryRunner.query(`
      ALTER TABLE wallet_accounts
        ADD CONSTRAINT uq_wallet_accounts_id_ledger_account UNIQUE (id, ledger_account_id)
    `);

    await queryRunner.query(`
      CREATE TABLE customer_financial_account_bindings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        customer_wallet_id UUID NOT NULL,
        wallet_account_id UUID NOT NULL,
        ledger_account_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL DEFAULT 'CUSTOMER_FUNDS',
        state VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        source_customer_version INTEGER NOT NULL,
        source_customer_wallet_version INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160) NOT NULL,
        last_correlation_id VARCHAR(255),
        last_request_id VARCHAR(255),
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_customer_financial_account_bindings_state CHECK (
          state IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REPAIR_REQUIRED', 'CLOSED')
        ),
        CONSTRAINT chk_customer_financial_account_bindings_currency CHECK (
          currency ~ '^[A-Z]{3}$'
        ),
        CONSTRAINT chk_customer_financial_account_bindings_accounting_unit CHECK (
          accounting_unit = 'CUSTOMER_FUNDS'
        ),
        CONSTRAINT chk_customer_financial_account_bindings_source_customer_version CHECK (
          source_customer_version > 0
        ),
        CONSTRAINT chk_customer_financial_account_bindings_source_wallet_version CHECK (
          source_customer_wallet_version > 0
        ),
        CONSTRAINT chk_customer_financial_account_bindings_version CHECK (version > 0),
        CONSTRAINT chk_customer_financial_account_bindings_created_by CHECK (length(created_by) > 0),
        CONSTRAINT chk_customer_financial_account_bindings_updated_by CHECK (length(updated_by) > 0),
        CONSTRAINT chk_customer_financial_account_bindings_closed_at CHECK (
          (state = 'CLOSED' AND closed_at IS NOT NULL)
          OR (state <> 'CLOSED' AND closed_at IS NULL)
        ),
        CONSTRAINT uq_customer_financial_account_bindings_customer_wallet
          UNIQUE (customer_wallet_id),
        CONSTRAINT uq_customer_financial_account_bindings_wallet_account
          UNIQUE (wallet_account_id),
        CONSTRAINT uq_customer_financial_account_bindings_ledger_account
          UNIQUE (ledger_account_id),
        CONSTRAINT fk_customer_financial_account_bindings_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_financial_account_bindings_customer_wallet
          FOREIGN KEY (customer_wallet_id, customer_id)
          REFERENCES customer_wallets(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_financial_account_bindings_wallet_account
          FOREIGN KEY (wallet_account_id, ledger_account_id)
          REFERENCES wallet_accounts(id, ledger_account_id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_financial_account_bindings_ledger_account
          FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_financial_account_bindings_active_customer_currency
        ON customer_financial_account_bindings (customer_id, currency)
       WHERE state = 'ACTIVE'
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_financial_account_bindings_customer_state
         ON customer_financial_account_bindings (customer_id, state)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_financial_account_bindings_state_updated
         ON customer_financial_account_bindings (state, updated_at)`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION assert_customer_financial_account_binding()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      DECLARE
        customer_status_value VARCHAR(20);
        customer_deleted_at TIMESTAMPTZ;
        customer_version_value INTEGER;
        customer_wallet_status_value VARCHAR(20);
        customer_wallet_currency VARCHAR(3);
        customer_wallet_deleted_at TIMESTAMPTZ;
        customer_wallet_version_value INTEGER;
        wallet_status_value VARCHAR(20);
        wallet_currency VARCHAR(3);
        wallet_ledger_account_id UUID;
        ledger_currency VARCHAR(3);
        ledger_accounting_unit VARCHAR(64);
        ledger_account_type VARCHAR(20);
        ledger_normal_balance VARCHAR(6);
        ledger_allow_negative_balance BOOLEAN;
        ledger_is_active BOOLEAN;
      BEGIN
        SELECT c.status, c.deleted_at, c.version
          INTO customer_status_value, customer_deleted_at, customer_version_value
          FROM customers c
         WHERE c.id = NEW.customer_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Binding customer % does not exist', NEW.customer_id
            USING ERRCODE = '23503';
        END IF;

        SELECT cw.status, cw.currency, cw.deleted_at, cw.version
          INTO customer_wallet_status_value,
               customer_wallet_currency,
               customer_wallet_deleted_at,
               customer_wallet_version_value
          FROM customer_wallets cw
         WHERE cw.id = NEW.customer_wallet_id
           AND cw.customer_id = NEW.customer_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Binding customer wallet % is not owned by customer %',
            NEW.customer_wallet_id, NEW.customer_id
            USING ERRCODE = '23503';
        END IF;

        SELECT wa.status, wa.currency, wa.ledger_account_id
          INTO wallet_status_value, wallet_currency, wallet_ledger_account_id
          FROM wallet_accounts wa
         WHERE wa.id = NEW.wallet_account_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Binding wallet account % does not exist', NEW.wallet_account_id
            USING ERRCODE = '23503';
        END IF;

        SELECT la.currency,
               la.accounting_unit,
               la.account_type,
               la.normal_balance,
               la.allow_negative_balance,
               la.is_active
          INTO ledger_currency,
               ledger_accounting_unit,
               ledger_account_type,
               ledger_normal_balance,
               ledger_allow_negative_balance,
               ledger_is_active
          FROM ledger_accounts la
         WHERE la.id = NEW.ledger_account_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Binding ledger account % does not exist', NEW.ledger_account_id
            USING ERRCODE = '23503';
        END IF;

        IF wallet_ledger_account_id IS DISTINCT FROM NEW.ledger_account_id THEN
          RAISE EXCEPTION 'Binding ledger account does not match wallet account %', NEW.wallet_account_id
            USING ERRCODE = '23514';
        END IF;

        IF customer_version_value <> NEW.source_customer_version
           OR customer_wallet_version_value <> NEW.source_customer_wallet_version THEN
          RAISE EXCEPTION 'Binding source version is stale'
            USING ERRCODE = '23514';
        END IF;

        IF customer_wallet_currency <> NEW.currency
           OR wallet_currency <> NEW.currency
           OR ledger_currency <> NEW.currency
           OR NEW.accounting_unit <> 'CUSTOMER_FUNDS'
           OR ledger_accounting_unit <> NEW.accounting_unit
           OR ledger_account_type <> 'LIABILITY'
           OR ledger_normal_balance <> 'CREDIT'
           OR ledger_allow_negative_balance
        THEN
          RAISE EXCEPTION 'Binding currency, accounting unit, or ledger account is incompatible'
            USING ERRCODE = '23514';
        END IF;

        IF NEW.state = 'ACTIVE'
           AND (
             customer_status_value <> 'ACTIVE'
             OR customer_deleted_at IS NOT NULL
             OR customer_wallet_status_value <> 'ACTIVE'
             OR customer_wallet_deleted_at IS NOT NULL
             OR wallet_status_value <> 'ACTIVE'
             OR NOT ledger_is_active
           )
        THEN
          RAISE EXCEPTION 'Active binding sources are not all active'
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER customer_financial_account_bindings_are_consistent
      BEFORE INSERT OR UPDATE ON customer_financial_account_bindings
      FOR EACH ROW EXECUTE FUNCTION assert_customer_financial_account_binding()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS customer_financial_account_bindings_are_consistent
         ON customer_financial_account_bindings`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS assert_customer_financial_account_binding()`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_financial_account_bindings`);
    await queryRunner.query(
      `ALTER TABLE wallet_accounts
         DROP CONSTRAINT IF EXISTS uq_wallet_accounts_id_ledger_account`,
    );
    await queryRunner.query(
      `ALTER TABLE customer_wallets
         DROP CONSTRAINT IF EXISTS uq_customer_wallets_id_customer`,
    );
  }
}
