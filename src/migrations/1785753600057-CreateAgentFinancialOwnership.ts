import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F-1 / F-2 — Agent financial identity, dedicated e-float wallet, and an
 * owner-aware wallet-account money-safety invariant (PATH B).
 *
 * Designed to support the CBN Agent Banking requirement that agent-banking
 * transactions run through a dedicated account/wallet held with the Principal.
 * No compliance certification is claimed, and CBN is NOT asserted to prescribe
 * any internal accounting-unit name: the internal classification stays a
 * Finance decision. Final regulatory/accounting validation remains subject to
 * MonieNaija's licensed Principal arrangement and Finance/Compliance approval.
 *
 * WHAT CHANGES, AND WHY IT IS SAFE
 *
 * `assert_wallet_ledger_account` (migration 1785753600000) required EVERY
 * wallet account to reference a `CUSTOMER_FUNDS` liability account. That
 * invariant was written when Customer was the only owner. It becomes
 * owner-aware here:
 *
 *   owner_type = CUSTOMER -> byte-equivalent to the historical rule:
 *                            LIABILITY + CREDIT + currency match +
 *                            CUSTOMER_FUNDS + negative balance prohibited.
 *   owner_type = AGENT    -> LIABILITY + CREDIT + currency match +
 *                            negative balance prohibited, and the accounting
 *                            classification must match an ACTIVE row in the
 *                            Finance-owned registry below.
 *   anything else         -> rejected.
 *
 * The control remains a database-level trigger. It is not removed, bypassed or
 * downgraded to application validation, and the Customer branch is not
 * weakened in any way. Historical migration 1785753600000 is NOT edited; the
 * function is replaced additively here and restored on `down`.
 *
 * FAIL CLOSED BY CONSTRUCTION: `agent_float_accounting_classifications` is
 * created EMPTY. This migration invents no accounting unit, so until Finance
 * registers an approved classification the database itself refuses every Agent
 * wallet account. Production cannot silently default to CUSTOMER_FUNDS.
 *
 * NO MONEY: no journal, no ledger line, no balance is created here.
 */
export class CreateAgentFinancialOwnership1785753600057 implements MigrationInterface {
  name = 'CreateAgentFinancialOwnership1785753600057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Typed ownership on the shared financial substrate (ADR-0093 §6.4).
    //    Defaulted, so every pre-existing row is correct with no backfill, and
    //    `uq_wallet_accounts_customer_currency` is deliberately not redefined.
    await queryRunner.query(
      `ALTER TABLE wallet_accounts
         ADD COLUMN owner_type VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER'`,
    );
    await queryRunner.query(
      `ALTER TABLE wallet_accounts
         ADD CONSTRAINT chk_wallet_accounts_owner_type CHECK (owner_type IN ('CUSTOMER', 'AGENT'))`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_wallet_accounts_owner_type ON wallet_accounts (owner_type)`,
    );

    // 2. Finance-owned registry of approved Agent-float classifications.
    //    Intentionally created EMPTY: the value is a Finance decision and is
    //    never invented by engineering. The trigger reads this table, so the
    //    database enforces "configured and approved", not merely "not
    //    CUSTOMER_FUNDS".
    await queryRunner.query(`
      CREATE TABLE agent_float_accounting_classifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        accounting_unit VARCHAR(64) NOT NULL,
        account_type VARCHAR(20) NOT NULL,
        normal_balance VARCHAR(6) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        approved_by VARCHAR(160) NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        note VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_agent_float_classification_unit UNIQUE (accounting_unit),
        CONSTRAINT chk_agent_float_classification_unit CHECK (
          accounting_unit ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
        ),
        CONSTRAINT chk_agent_float_classification_type CHECK (
          account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')
        ),
        CONSTRAINT chk_agent_float_classification_normal_balance CHECK (
          normal_balance IN ('DEBIT', 'CREDIT')
        ),
        CONSTRAINT chk_agent_float_classification_approved_by CHECK (length(approved_by) > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_float_classification_active
         ON agent_float_accounting_classifications (is_active)
       WHERE is_active`,
    );

    // 3. Agent-domain wallet registry. One open wallet per Agent per currency;
    //    NGN only for V1. Holds NO balance: the ledger remains the sole
    //    balance authority, so there is no second balance system and no
    //    numeric float column on Agent. Physical cash is never represented.
    await queryRunner.query(`
      CREATE TABLE agent_wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_wallets_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_wallets_currency CHECK (currency = 'NGN'),
        CONSTRAINT chk_agent_wallets_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
        CONSTRAINT chk_agent_wallets_version CHECK (version > 0),
        CONSTRAINT chk_agent_wallets_closed_at CHECK (
          (status = 'CLOSED' AND closed_at IS NOT NULL)
          OR (status <> 'CLOSED' AND closed_at IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_wallets_agent_currency_open
         ON agent_wallets (agent_id, currency)
       WHERE status <> 'CLOSED'`,
    );

    // 4. The explicit, persisted answer to "which financial account holds this
    //    Agent's e-float?". Never inferred from a UUID or an account name.
    await queryRunner.query(`
      CREATE TABLE agent_financial_account_bindings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        agent_wallet_id UUID NOT NULL,
        wallet_account_id UUID NOT NULL,
        ledger_account_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        accounting_unit VARCHAR(64) NOT NULL,
        state VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        version INTEGER NOT NULL DEFAULT 1,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160) NOT NULL,
        last_correlation_id VARCHAR(255),
        last_request_id VARCHAR(255),
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_agent_bindings_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_agent_bindings_agent_wallet
          FOREIGN KEY (agent_wallet_id) REFERENCES agent_wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_agent_bindings_wallet_account
          FOREIGN KEY (wallet_account_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_agent_bindings_ledger_account
          FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT uq_agent_bindings_agent_wallet UNIQUE (agent_wallet_id),
        CONSTRAINT uq_agent_bindings_wallet_account UNIQUE (wallet_account_id),
        CONSTRAINT uq_agent_bindings_ledger_account UNIQUE (ledger_account_id),
        CONSTRAINT chk_agent_bindings_currency CHECK (currency = 'NGN'),
        -- Shape only. The VALUE is Finance-owned; the trigger enforces that it
        -- matches an approved, active registry classification.
        CONSTRAINT chk_agent_bindings_accounting_unit CHECK (
          accounting_unit ~ '^[A-Z][A-Z0-9_:-]{1,63}$'
        ),
        CONSTRAINT chk_agent_bindings_state CHECK (state IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
        CONSTRAINT chk_agent_bindings_version CHECK (version > 0),
        CONSTRAINT chk_agent_bindings_created_by CHECK (length(created_by) > 0),
        CONSTRAINT chk_agent_bindings_updated_by CHECK (length(updated_by) > 0),
        CONSTRAINT chk_agent_bindings_closed_at CHECK (
          (state = 'CLOSED' AND closed_at IS NOT NULL)
          OR (state <> 'CLOSED' AND closed_at IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_agent_bindings_agent_currency_open
         ON agent_financial_account_bindings (agent_id, currency)
       WHERE state <> 'CLOSED'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_agent_bindings_state ON agent_financial_account_bindings (state)`,
    );

    // 5. Owner-aware money-safety invariant. Same trigger, same table, same
    //    fail-closed posture; the Customer branch is semantically unchanged.
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
        approved_classification INTEGER;
      BEGIN
        SELECT a.account_type, a.normal_balance, a.currency, a.accounting_unit, a.allow_negative_balance
          INTO account_type_value, normal_balance_value, account_currency, account_unit, negative_balance_allowed
          FROM ledger_accounts a
         WHERE a.id = NEW.ledger_account_id;

        -- Structural requirements shared by every wallet owner type.
        IF NOT FOUND
           OR account_type_value <> 'LIABILITY'
           OR normal_balance_value <> 'CREDIT'
           OR account_currency <> NEW.currency
           OR negative_balance_allowed THEN
          RAISE EXCEPTION 'Wallet % must reference a non-negative matching-currency liability account', NEW.id
            USING ERRCODE = '23514';
        END IF;

        IF NEW.owner_type = 'CUSTOMER' THEN
          -- Unchanged historical rule for customer wallets.
          IF account_unit <> 'CUSTOMER_FUNDS' THEN
            RAISE EXCEPTION 'Wallet % must reference a non-negative customer-funds liability account', NEW.id
              USING ERRCODE = '23514';
          END IF;
        ELSIF NEW.owner_type = 'AGENT' THEN
          -- Agent float must match a Finance-approved, active classification.
          SELECT COUNT(*) INTO approved_classification
            FROM agent_float_accounting_classifications c
           WHERE c.is_active
             AND c.accounting_unit = account_unit
             AND c.account_type = account_type_value
             AND c.normal_balance = normal_balance_value;

          IF approved_classification = 0 THEN
            RAISE EXCEPTION 'Wallet % must reference a Finance-approved agent-float liability account; accounting unit % is not an approved active agent-float classification', NEW.id, account_unit
              USING ERRCODE = '23514';
          END IF;
        ELSE
          RAISE EXCEPTION 'Wallet % has unsupported owner_type %', NEW.id, NEW.owner_type
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the historical customer-only invariant verbatim.
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

    await queryRunner.query(`DROP TABLE agent_financial_account_bindings`);
    await queryRunner.query(`DROP TABLE agent_wallets`);
    await queryRunner.query(`DROP TABLE agent_float_accounting_classifications`);
    await queryRunner.query(`DROP INDEX idx_wallet_accounts_owner_type`);
    await queryRunner.query(
      `ALTER TABLE wallet_accounts DROP CONSTRAINT chk_wallet_accounts_owner_type`,
    );
    await queryRunner.query(`ALTER TABLE wallet_accounts DROP COLUMN owner_type`);
  }
}
