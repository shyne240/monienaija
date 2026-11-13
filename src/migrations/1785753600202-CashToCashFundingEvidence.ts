import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Evidence for new transfers only. Existing liabilities are never backfilled by inference. */
export class CashToCashFundingEvidence1785753600202 implements MigrationInterface {
  name = 'CashToCashFundingEvidence1785753600202';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_to_cash_funding_evidence (
      transfer_id uuid PRIMARY KEY REFERENCES cash_to_cash_transfers(id),
      funding_agent_id uuid NOT NULL REFERENCES agents(id),
      funding_wallet_id uuid NOT NULL REFERENCES wallet_accounts(id),
      funding_ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id),
      unclaimed_ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id),
      funding_journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id),
      institution_id uuid NOT NULL,
      request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      sender_identity_fingerprint varchar(64) NOT NULL CHECK (sender_identity_fingerprint ~ '^[0-9a-f]{64}$'),
      sender_policy_fingerprint varchar(64) NOT NULL CHECK (sender_policy_fingerprint ~ '^[0-9a-f]{64}$'),
      funding_authorization_fingerprint varchar(64) NOT NULL CHECK (funding_authorization_fingerprint ~ '^[0-9a-f]{64}$'),
      institution_evidence_fingerprint varchar(64) NOT NULL CHECK (institution_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE FUNCTION reject_c2c_funding_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'funding evidence is immutable'; END $$`,
    );
    await q.query(
      `CREATE TRIGGER c2c_funding_evidence_immutable BEFORE UPDATE OR DELETE ON cash_to_cash_funding_evidence FOR EACH ROW EXECUTE FUNCTION reject_c2c_funding_evidence_mutation()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard cash-to-cash funding evidence'));
  }
}
