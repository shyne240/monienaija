import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCashToCashTransfers1785753600057 implements MigrationInterface {
  name = 'CreateCashToCashTransfers1785753600057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cash_to_cash_transfers (
        id UUID PRIMARY KEY,
        agent_id UUID NOT NULL,
        beneficiary_phone VARCHAR(10) NOT NULL,
        principal_minor BIGINT NOT NULL,
        fee_minor BIGINT NOT NULL DEFAULT 0,
        vat_minor BIGINT NOT NULL DEFAULT 0,
        total_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'UNCLAIMED',
        transfer_code_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        transfer_code_version INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        is_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMPTZ,
        lock_reason VARCHAR(500),
        journal_id UUID NOT NULL,
        reference VARCHAR(255),
        idempotency_key VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_cash_to_cash_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cash_to_cash_journal
          FOREIGN KEY (journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        CONSTRAINT chk_cash_to_cash_phone CHECK (beneficiary_phone ~ '^[789][0-9]{9}$'),
        CONSTRAINT chk_cash_to_cash_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_cash_to_cash_status CHECK (status = 'UNCLAIMED'),
        CONSTRAINT chk_cash_to_cash_amount CHECK (
          principal_minor > 0
          AND fee_minor >= 0
          AND vat_minor >= 0
          AND total_minor = principal_minor + fee_minor + vat_minor
        ),
        CONSTRAINT chk_cash_to_cash_version CHECK (transfer_code_version > 0),
        CONSTRAINT chk_cash_to_cash_failed CHECK (failed_attempts >= 0),
        CONSTRAINT chk_cash_to_cash_idempotency CHECK (length(idempotency_key) > 0),
        CONSTRAINT chk_cash_to_cash_hash CHECK (length(transfer_code_hash) > 0),
        CONSTRAINT chk_cash_to_cash_algorithm CHECK (hash_algorithm IN ('PBKDF2', 'SCRYPT', 'ARGON2ID', 'BCRYPT'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cash_to_cash_agent_idempotency
        ON cash_to_cash_transfers (agent_id, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cash_to_cash_journal
        ON cash_to_cash_transfers (journal_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cash_to_cash_beneficiary
        ON cash_to_cash_transfers (beneficiary_phone)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cash_to_cash_agent
        ON cash_to_cash_transfers (agent_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cash_to_cash_status
        ON cash_to_cash_transfers (status)
    `);

    // Seed unclaimed liability ledger account for Cash→Cash
    await queryRunner.query(`
      INSERT INTO ledger_accounts (
        id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active
      )
      VALUES (
        gen_random_uuid(),
        'CASH_TO_CASH-UNCLAIMED-NGN',
        'Cash-to-Cash Unclaimed NGN',
        'LIABILITY',
        'CREDIT',
        'NGN',
        'CUSTOMER_FUNDS',
        FALSE,
        TRUE
      )
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM ledger_accounts WHERE code = 'CASH_TO_CASH-UNCLAIMED-NGN'`);
    await queryRunner.query(`DROP TABLE IF EXISTS cash_to_cash_transfers`);
  }
}
