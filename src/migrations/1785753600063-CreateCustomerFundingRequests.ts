import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerFundingRequests1785753600063 implements MigrationInterface {
  name = 'CreateCustomerFundingRequests1785753600063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // In-house Operations→Customer Wallet funding (maker/checker)
    // Money has been paid into a MonieNaija-designated funding account/channel and the
    // customer's wallet is credited after authorized review.
    // This does NOT create a second ledger, balance column, or external provider integration.
    // The authoritative financial engine remains LedgerService.postJournalInTransaction.
    // Funding posts a balanced double-entry journal:
    //   DEBIT  PAYMENT-SETTLEMENT_ASSET-NGN (existing ASSET, CUSTOMER_FUNDS, from 0002)
    //   CREDIT customer wallet ledger_account (LIABILITY, CUSTOMER_FUNDS, non-negative)
    // The settlement asset is the existing customer funding control account evidenced by
    // src/migrations/1785753600002-CreatePaymentCapabilities.ts and reused by
    // src/payment/settlement-account.service.ts and src/deposit/deposit.service.ts
    // (completeDeposit DEBIT settlementAsset CREDIT wallet). No new ledger account is
    // introduced; this migration is additive and contains only the funding-request workflow table.

    await queryRunner.query(`
      CREATE TABLE customer_funding_requests (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL,
        amount_minor BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        external_reference VARCHAR(255),
        channel VARCHAR(64),
        description VARCHAR(255),
        maker_id VARCHAR(160) NOT NULL,
        maker_type VARCHAR(20) NOT NULL,
        checker_id VARCHAR(160),
        checker_type VARCHAR(20),
        journal_id UUID,
        reference VARCHAR(64) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        correlation_id VARCHAR(255),
        rejection_reason VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        approved_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT fk_customer_funding_requests_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_funding_requests_journal
          FOREIGN KEY (journal_id) REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_funding_amount_positive CHECK (amount_minor > 0),
        CONSTRAINT chk_customer_funding_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_customer_funding_status CHECK (status IN ('PENDING','APPROVED','REJECTED')),
        CONSTRAINT chk_customer_funding_idempotency_non_empty CHECK (length(idempotency_key) > 0),
        CONSTRAINT chk_customer_funding_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_customer_funding_maker_non_empty CHECK (length(maker_id) > 0),
        CONSTRAINT chk_customer_funding_maker_type CHECK (maker_type IN ('SUPPORT','OPERATOR','SERVICE','PRIVILEGED')),
        CONSTRAINT chk_customer_funding_checker_type CHECK (checker_type IS NULL OR checker_type IN ('SUPPORT','OPERATOR','SERVICE','PRIVILEGED')),
        CONSTRAINT chk_customer_funding_journal_for_approved CHECK (status <> 'APPROVED' OR journal_id IS NOT NULL),
        CONSTRAINT chk_customer_funding_version CHECK (version > 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_funding_requests_idempotency_key
        ON customer_funding_requests (idempotency_key)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_funding_requests_journal_id
        ON customer_funding_requests (journal_id)
        WHERE journal_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_funding_requests_reference
        ON customer_funding_requests (reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_funding_requests_customer_created
        ON customer_funding_requests (customer_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_funding_requests_status
        ON customer_funding_requests (status, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS customer_funding_requests`);
  }
}
