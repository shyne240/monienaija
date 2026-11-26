import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank → Wallet Monnify reserved-account journey.
 *
 * The durable identity is OUR business reference, generated once at intake and carried through
 * posting, customer history, Finance exceptions and Admin Web lookup. The provider transaction
 * reference remains the provider's own identity and is never used as the platform's reference.
 *
 * Money figures are deliberately kept separate:
 *   gross (payer sent) − Monnify deduction = merchant settlement
 *   merchant settlement − MonieNaija charge = customer wallet credit
 * Provider deductions and platform charges are never merged into one "fee".
 *
 * No policy, rate, settlement destination or enablement flag is seeded here. All 11 workforce
 * accounts and their credentials are untouched.
 */
export class BankToWalletMonnifyJourney1785753600900 implements MigrationInterface {
  name = 'BankToWalletMonnifyJourney1785753600900';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE banking_virtual_account_reservations
        ADD COLUMN provider_account_reference varchar(128),
        ADD COLUMN bvn_mac char(64),
        ADD COLUMN nin_mac char(64),
        ADD COLUMN identity_revision varchar(32)
    `);
    await q.query(`
      ALTER TABLE banking_inbound_payments
        ADD COLUMN business_reference varchar(96),
        ADD COLUMN settlement_amount_minor numeric(20,0),
        ADD COLUMN monienaija_fee_minor numeric(20,0) NOT NULL DEFAULT 0,
        ADD COLUMN customer_credit_minor numeric(20,0),
        ADD COLUMN fee_rule_ref jsonb,
        ADD COLUMN limit_ref jsonb,
        ADD COLUMN wallet_id uuid REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        ADD COLUMN virtual_account_id uuid REFERENCES virtual_accounts(id) ON DELETE RESTRICT,
        ADD COLUMN credit_journal_id uuid REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        ADD COLUMN exception_id uuid,
        ADD COLUMN resolution_state varchar(24) NOT NULL DEFAULT 'PENDING'
          CHECK (resolution_state IN ('PENDING','CREDITED','EXCEPTION','REJECTED','UNVERIFIABLE')),
        ADD COLUMN processed_at timestamptz
    `);
    await q.query(
      `CREATE UNIQUE INDEX uq_banking_inbound_business_reference
         ON banking_inbound_payments(business_reference) WHERE business_reference IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX idx_banking_inbound_business_lookup
         ON banking_inbound_payments(institution_id,business_reference)`,
    );

    await q.query(`
      CREATE TABLE bank_to_wallet_exceptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_reference varchar(96) NOT NULL UNIQUE,
        -- Null until the receiving account identifies an institution. An unattributed payment is
        -- still traceable; inventing an institution to satisfy a NOT NULL constraint is forbidden.
        institution_id uuid REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL,
        environment varchar(16) NOT NULL CHECK (environment IN ('sandbox','production')),
        provider_transaction_reference varchar(128) NOT NULL,
        provider_payment_reference varchar(128),
        receiving_account_number varchar(32),
        wallet_id uuid REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        gross_amount_minor numeric(20,0) NOT NULL CHECK (gross_amount_minor > 0),
        provider_fee_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
        settlement_amount_minor numeric(20,0),
        monienaija_fee_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (monienaija_fee_minor >= 0),
        customer_credit_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (customer_credit_minor >= 0),
        reason varchar(40) NOT NULL CHECK (reason IN (
          'UNMATCHED_RECEIVING_ACCOUNT','UNVERIFIABLE_PAYMENT','REFERENCE_MISMATCH',
          'AMOUNT_MISMATCH','IDENTITY_BLOCKED','ELIGIBILITY_BLOCKED','LIMIT_BLOCKED',
          'POSTING_RESTRICTION'
        )),
        state varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (state IN (
          'OPEN','APPROVED_FOR_RELEASE','RELEASED','APPROVED_FOR_RETURN','RETURNED','CANCELLED'
        )),
        permitted_next_action varchar(80) NOT NULL,
        evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        approval_id uuid,
        decision_by varchar(160),
        decision_at timestamptz,
        resolution_journal_id uuid REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        notes varchar(500),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await q.query(
      `CREATE INDEX idx_b2w_exception_institution_state
         ON bank_to_wallet_exceptions(institution_id,state,created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX idx_b2w_exception_provider_reference
         ON bank_to_wallet_exceptions(provider_key,environment,provider_transaction_reference)`,
    );

    await q.query(`
      CREATE TABLE bank_to_wallet_credits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_reference varchar(96) NOT NULL UNIQUE,
        inbound_payment_id uuid NOT NULL UNIQUE REFERENCES banking_inbound_payments(id) ON DELETE RESTRICT,
        institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL,
        environment varchar(16) NOT NULL CHECK (environment IN ('sandbox','production')),
        provider_transaction_reference varchar(128) NOT NULL,
        provider_payment_reference varchar(128),
        wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        virtual_account_id uuid NOT NULL REFERENCES virtual_accounts(id) ON DELETE RESTRICT,
        currency char(3) NOT NULL CHECK (currency = 'NGN'),
        gross_amount_minor numeric(20,0) NOT NULL CHECK (gross_amount_minor > 0),
        provider_fee_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
        settlement_amount_minor numeric(20,0) NOT NULL,
        monienaija_fee_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (monienaija_fee_minor >= 0),
        amount_minor numeric(20,0) NOT NULL CHECK (amount_minor > 0),
        journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        fee_ref jsonb,
        limit_ref jsonb,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    await q.query(`
      CREATE TABLE bank_to_wallet_settlements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_reference varchar(96) NOT NULL UNIQUE,
        institution_id uuid REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL,
        environment varchar(16) NOT NULL CHECK (environment IN ('sandbox','production')),
        provider_transaction_reference varchar(128) NOT NULL,
        settlement_reference varchar(128),
        currency char(3) NOT NULL CHECK (currency = 'NGN'),
        gross_amount_minor numeric(20,0) NOT NULL CHECK (gross_amount_minor > 0),
        provider_deduction_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (provider_deduction_minor >= 0),
        settlement_amount_minor numeric(20,0) NOT NULL,
        monienaija_charge_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (monienaija_charge_minor >= 0),
        customer_credit_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (customer_credit_minor >= 0),
        settlement_state varchar(32) NOT NULL DEFAULT 'PENDING_PROVIDER_SETTLEMENT'
          CHECK (settlement_state IN ('PENDING_PROVIDER_SETTLEMENT','RECONCILED','OUTSTANDING','RETURN_REQUIRED')),
        evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await q.query(
      `CREATE INDEX idx_b2w_settlement_institution_state
         ON bank_to_wallet_settlements(institution_id,settlement_state,created_at DESC)`,
    );

    await q.query(`
      CREATE TABLE bank_to_wallet_resolutions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        exception_id uuid NOT NULL UNIQUE REFERENCES bank_to_wallet_exceptions(id) ON DELETE RESTRICT,
        decision varchar(16) NOT NULL CHECK (decision IN ('RELEASE','RETURN')),
        approval_id uuid NOT NULL UNIQUE,
        performed_by varchar(160) NOT NULL,
        resolution_journal_id uuid REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        external_reference varchar(160),
        decision_binding jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    await q.query(`
      ALTER TABLE banking_inbound_payments
        ADD CONSTRAINT fk_b2w_inbound_exception
        FOREIGN KEY (exception_id) REFERENCES bank_to_wallet_exceptions(id) ON DELETE RESTRICT
    `);
    await q.query(`
      ALTER TABLE banking_inbound_payments
        ADD CONSTRAINT chk_b2w_amount_chain
        CHECK (monienaija_fee_minor <= (gross_amount_minor - provider_fee_minor))
    `);
    // The legacy CHECK still governs gross - provider deduction. The new columns add a distinct
    // platform charge and customer credit without rewriting historical records.
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE banking_inbound_payments DROP CONSTRAINT IF EXISTS chk_b2w_amount_chain`,
    );
    await q.query(
      `ALTER TABLE banking_inbound_payments DROP CONSTRAINT IF EXISTS fk_b2w_inbound_exception`,
    );
    await q.query(`DROP TABLE IF EXISTS bank_to_wallet_resolutions`);
    await q.query(`DROP TABLE IF EXISTS bank_to_wallet_settlements`);
    await q.query(`DROP TABLE IF EXISTS bank_to_wallet_credits`);
    await q.query(`DROP TABLE IF EXISTS bank_to_wallet_exceptions`);
    await q.query(`DROP INDEX IF EXISTS idx_banking_inbound_business_lookup`);
    await q.query(`DROP INDEX IF EXISTS uq_banking_inbound_business_reference`);
    await q.query(`
      ALTER TABLE banking_inbound_payments
        DROP COLUMN IF EXISTS resolution_state,
        DROP COLUMN IF EXISTS processed_at,
        DROP COLUMN IF EXISTS exception_id,
        DROP COLUMN IF EXISTS credit_journal_id,
        DROP COLUMN IF EXISTS virtual_account_id,
        DROP COLUMN IF EXISTS wallet_id,
        DROP COLUMN IF EXISTS limit_ref,
        DROP COLUMN IF EXISTS fee_rule_ref,
        DROP COLUMN IF EXISTS customer_credit_minor,
        DROP COLUMN IF EXISTS monienaija_fee_minor,
        DROP COLUMN IF EXISTS settlement_amount_minor,
        DROP COLUMN IF EXISTS business_reference
    `);
    await q.query(`
      ALTER TABLE banking_virtual_account_reservations
        DROP COLUMN IF EXISTS identity_revision,
        DROP COLUMN IF EXISTS nin_mac,
        DROP COLUMN IF EXISTS bvn_mac,
        DROP COLUMN IF EXISTS provider_account_reference
    `);
  }
}
