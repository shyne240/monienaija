import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Evidence and execution for inbound credits; the existing ledger remains the value authority. */
export class CreateInboundFundingReceipts1785753600142 implements MigrationInterface {
  name = 'CreateInboundFundingReceipts1785753600142';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE inbound_funding_receipts (
      id uuid PRIMARY KEY,
      provider_key varchar(80) NOT NULL,
      provider_reference_hash char(64) NOT NULL CHECK (provider_reference_hash ~ '^[a-f0-9]{64}$'),
      evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
      virtual_account_id uuid REFERENCES virtual_accounts(id) ON DELETE RESTRICT,
      wallet_account_id uuid REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      currency varchar(3) NOT NULL CHECK (currency='NGN'),
      status varchar(16) NOT NULL CHECK (status IN ('CREDITED','SUSPENSE')),
      asset_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      credit_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id) ON DELETE RESTRICT,
      provider_observed_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(provider_key,provider_reference_hash)
    )`);
    await q.query(`CREATE FUNCTION validate_inbound_funding_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM ledger_journals j JOIN ledger_accounts asset ON asset.id=NEW.asset_account_id
          JOIN ledger_accounts credit ON credit.id=NEW.credit_account_id
          WHERE j.id=NEW.journal_id AND j.status='POSTED' AND j.currency=NEW.currency
            AND j.accounting_unit='CUSTOMER_FUNDS' AND j.reversal_of_journal_id IS NULL
            AND j.xmin::text::bigint=(txid_current() % 4294967296)
            AND asset.code='PAYMENT-SETTLEMENT_ASSET-NGN' AND asset.account_type='ASSET'
            AND (SELECT count(*) FROM ledger_lines l WHERE l.journal_id=j.id)=2
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=asset.id AND l.direction='DEBIT' AND l.amount_minor=NEW.amount_minor)
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=credit.id AND l.direction='CREDIT' AND l.amount_minor=NEW.amount_minor)
            AND ((NEW.status='SUSPENSE' AND credit.code='PAYMENT-SYSTEM_SUSPENSE-NGN') OR
              (NEW.status='CREDITED' AND EXISTS (SELECT 1 FROM virtual_accounts v JOIN wallet_accounts w ON w.id=v.wallet_id
                WHERE v.id=NEW.virtual_account_id AND w.id=NEW.wallet_account_id AND w.ledger_account_id=credit.id AND w.currency=NEW.currency)))
        ) THEN RAISE EXCEPTION 'Inbound receipt does not match its ledger journal and destination'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER inbound_funding_receipt_validate BEFORE INSERT ON inbound_funding_receipts
      FOR EACH ROW EXECUTE FUNCTION validate_inbound_funding_receipt()`);
    await q.query(`CREATE TRIGGER inbound_funding_receipt_immutable BEFORE UPDATE OR DELETE ON inbound_funding_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    // Generic reversal has no inbound receipt state transition or independently verified
    // return. Keep the original receipt and its value in sync until a governed inbound
    // recovery contract exists; this does not affect unrelated governed journals.
    await q.query(`CREATE FUNCTION guard_inbound_funding_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.reversal_of_journal_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM inbound_funding_receipts WHERE journal_id=NEW.reversal_of_journal_id
        ) THEN RAISE EXCEPTION 'Inbound funding reversal requires a governed receipt recovery'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER inbound_funding_reversal_guard BEFORE INSERT ON ledger_journals
      FOR EACH ROW EXECUTE FUNCTION guard_inbound_funding_reversal()`);
    await q.query(`CREATE TABLE inbound_funding_reviews (
      id uuid PRIMARY KEY,
      provider_key varchar(80) NOT NULL,
      provider_reference_hash char(64) NOT NULL CHECK (provider_reference_hash ~ '^[a-f0-9]{64}$'),
      evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
      reason varchar(40) NOT NULL CHECK (reason IN ('OUTCOME_UNKNOWN','EVIDENCE_CONFLICT')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(provider_key,provider_reference_hash,evidence_hash,reason)
    )`);
    await q.query(`CREATE TRIGGER inbound_funding_review_immutable BEFORE UPDATE OR DELETE ON inbound_funding_reviews
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove inbound funding evidence'));
  }
}
