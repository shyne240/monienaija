import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentCapabilities1785753600002 implements MigrationInterface {
  name = 'CreatePaymentCapabilities1785753600002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE payment_reference_sequence AS BIGINT START WITH 1 INCREMENT BY 1
    `);

    await queryRunner.query(`
      CREATE TABLE payment_references (
        reference VARCHAR(64) PRIMARY KEY,
        payment_type VARCHAR(20) NOT NULL,
        payment_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_payment_references_payment UNIQUE (payment_type, payment_id),
        CONSTRAINT chk_payment_references_type CHECK (payment_type IN ('DEPOSIT', 'WITHDRAWAL')),
        CONSTRAINT chk_payment_references_format CHECK (reference ~ '^MN[0-9]+$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE deposits (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL,
        journal_id UUID,
        payment_reference VARCHAR(64) NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        reference VARCHAR(255),
        narration VARCHAR(255),
        failure_code VARCHAR(64),
        failure_message VARCHAR(255),
        failure_status_code SMALLINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT uq_deposits_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_deposits_payment_reference UNIQUE (payment_reference),
        CONSTRAINT chk_deposits_amount_positive CHECK (amount_minor > 0),
        CONSTRAINT chk_deposits_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_deposits_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
        CONSTRAINT chk_deposits_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_deposits_completion_has_journal CHECK (
          status <> 'COMPLETED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)
        ),
        CONSTRAINT fk_deposits_wallet
          FOREIGN KEY (wallet_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_deposits_journal
          FOREIGN KEY (journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE withdrawals (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL,
        journal_id UUID,
        payment_reference VARCHAR(64) NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        reference VARCHAR(255),
        narration VARCHAR(255),
        failure_code VARCHAR(64),
        failure_message VARCHAR(255),
        failure_status_code SMALLINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT uq_withdrawals_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_withdrawals_payment_reference UNIQUE (payment_reference),
        CONSTRAINT chk_withdrawals_amount_positive CHECK (amount_minor > 0),
        CONSTRAINT chk_withdrawals_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_withdrawals_status CHECK (
          status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')
        ),
        CONSTRAINT chk_withdrawals_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_withdrawals_completion_has_journal CHECK (
          status <> 'COMPLETED' OR (journal_id IS NOT NULL AND completed_at IS NOT NULL)
        ),
        CONSTRAINT fk_withdrawals_wallet
          FOREIGN KEY (wallet_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_withdrawals_journal
          FOREIGN KEY (journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_deposits_wallet_created ON deposits (wallet_id, created_at, id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_withdrawals_wallet_created ON withdrawals (wallet_id, created_at, id)`,
    );

    await queryRunner.query(`
      INSERT INTO ledger_accounts (
        id, code, name, account_type, normal_balance, currency,
        accounting_unit, allow_negative_balance, is_active
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000201',
          'PAYMENT-SETTLEMENT_ASSET-NGN',
          'Payment settlement asset NGN',
          'ASSET', 'DEBIT', 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE
        ),
        (
          '00000000-0000-4000-8000-000000000202',
          'PAYMENT-SETTLEMENT_CLEARING-NGN',
          'Payment settlement clearing NGN',
          'ASSET', 'DEBIT', 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE
        ),
        (
          '00000000-0000-4000-8000-000000000203',
          'PAYMENT-SYSTEM_SUSPENSE-NGN',
          'Payment system suspense NGN',
          'LIABILITY', 'CREDIT', 'NGN', 'CUSTOMER_FUNDS', TRUE, TRUE
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS withdrawals`);
    await queryRunner.query(`DROP TABLE IF EXISTS deposits`);
    await queryRunner.query(`DROP TABLE IF EXISTS payment_references`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS payment_reference_sequence`);
    await queryRunner.query(
      `DELETE FROM ledger_accounts
        WHERE code IN (
          'PAYMENT-SETTLEMENT_ASSET-NGN',
          'PAYMENT-SETTLEMENT_CLEARING-NGN',
          'PAYMENT-SYSTEM_SUSPENSE-NGN'
        )`,
    );
  }
}
