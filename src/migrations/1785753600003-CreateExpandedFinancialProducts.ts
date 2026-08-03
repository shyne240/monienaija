import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExpandedFinancialProducts1785753600003 implements MigrationInterface {
  name = 'CreateExpandedFinancialProducts1785753600003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payment_references
        DROP CONSTRAINT chk_payment_references_type,
        ADD CONSTRAINT chk_payment_references_type
          CHECK (payment_type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'QUOTE', 'VIRTUAL_ACCOUNT'))
    `);

    await queryRunner.query(`ALTER TABLE transfers ADD COLUMN payment_reference VARCHAR(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_transfers_payment_reference
         ON transfers (payment_reference)
       WHERE payment_reference IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE virtual_accounts (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL,
        bank_code VARCHAR(20) NOT NULL,
        account_number VARCHAR(32) NOT NULL,
        account_name VARCHAR(160) NOT NULL,
        provider VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL,
        reference VARCHAR(64) NOT NULL,
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deactivated_at TIMESTAMPTZ,
        CONSTRAINT uq_virtual_accounts_provider_number UNIQUE (provider, account_number),
        CONSTRAINT chk_virtual_accounts_bank_code CHECK (bank_code ~ '^[A-Z0-9]{3,20}$'),
        CONSTRAINT chk_virtual_accounts_number CHECK (account_number ~ '^[0-9]{4,32}$'),
        CONSTRAINT chk_virtual_accounts_status CHECK (status IN ('ACTIVE', 'DEACTIVATED')),
        CONSTRAINT chk_virtual_accounts_reference CHECK (reference ~ '^MN[0-9]+$'),
        CONSTRAINT fk_virtual_accounts_wallet
          FOREIGN KEY (wallet_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_virtual_accounts_wallet_provider_active
         ON virtual_accounts (wallet_id, provider)
       WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_virtual_accounts_wallet ON virtual_accounts (wallet_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE beneficiaries (
        id UUID PRIMARY KEY,
        customer_id VARCHAR(160) NOT NULL,
        nickname VARCHAR(100) NOT NULL,
        bank_code VARCHAR(20) NOT NULL,
        account_number VARCHAR(32) NOT NULL,
        account_name VARCHAR(160) NOT NULL,
        type VARCHAR(30) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_beneficiaries_duplicate UNIQUE (customer_id, bank_code, account_number, type),
        CONSTRAINT chk_beneficiaries_customer CHECK (length(customer_id) > 0),
        CONSTRAINT chk_beneficiaries_bank_code CHECK (bank_code ~ '^[A-Z0-9]{3,20}$'),
        CONSTRAINT chk_beneficiaries_number CHECK (account_number ~ '^[0-9]{4,32}$'),
        CONSTRAINT chk_beneficiaries_type CHECK (type IN ('BANK_ACCOUNT'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_beneficiaries_customer ON beneficiaries (customer_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE banks (
        id UUID PRIMARY KEY,
        bank_code VARCHAR(20) NOT NULL,
        bank_name VARCHAR(160) NOT NULL,
        short_name VARCHAR(80) NOT NULL,
        nip_supported BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_banks_bank_code UNIQUE (bank_code),
        CONSTRAINT chk_banks_code CHECK (bank_code ~ '^[A-Z0-9]{3,20}$'),
        CONSTRAINT chk_banks_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_banks_status ON banks (status)`);

    await queryRunner.query(`
      CREATE TABLE payment_quotes (
        id UUID PRIMARY KEY,
        quote_reference VARCHAR(64) NOT NULL,
        payment_type VARCHAR(20) NOT NULL,
        amount_minor BIGINT NOT NULL,
        fee_minor BIGINT NOT NULL,
        vat_minor BIGINT NOT NULL,
        total_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_payment_quotes_reference UNIQUE (quote_reference),
        CONSTRAINT uq_payment_quotes_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT chk_payment_quotes_type CHECK (payment_type IN ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL')),
        CONSTRAINT chk_payment_quotes_amount_positive CHECK (amount_minor > 0),
        CONSTRAINT chk_payment_quotes_fees_non_negative CHECK (fee_minor >= 0 AND vat_minor >= 0),
        CONSTRAINT chk_payment_quotes_total CHECK (total_minor = amount_minor + fee_minor + vat_minor),
        CONSTRAINT chk_payment_quotes_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_payment_quotes_status CHECK (status IN ('ACTIVE', 'EXPIRED', 'USED')),
        CONSTRAINT chk_payment_quotes_hash CHECK (request_hash ~ '^[a-f0-9]{64}$')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_payment_quotes_status_expiry ON payment_quotes (status, expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS payment_quotes`);
    await queryRunner.query(`DROP TABLE IF EXISTS banks`);
    await queryRunner.query(`DROP TABLE IF EXISTS beneficiaries`);
    await queryRunner.query(`DROP TABLE IF EXISTS virtual_accounts`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_transfers_payment_reference`);
    await queryRunner.query(`ALTER TABLE transfers DROP COLUMN IF EXISTS payment_reference`);
    await queryRunner.query(`
      ALTER TABLE payment_references
        DROP CONSTRAINT chk_payment_references_type,
        ADD CONSTRAINT chk_payment_references_type
          CHECK (payment_type IN ('DEPOSIT', 'WITHDRAWAL'))
    `);
  }
}
