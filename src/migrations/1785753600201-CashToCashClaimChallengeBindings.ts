import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Bind only newly issued claims; historical unbound challenges are never upgraded by inference. */
export class CashToCashClaimChallengeBindings1785753600201 implements MigrationInterface {
  name = 'CashToCashClaimChallengeBindings1785753600201';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_to_cash_claim_challenge_bindings (
      challenge_id uuid PRIMARY KEY REFERENCES mfa_challenges(id),
      transfer_id uuid NOT NULL REFERENCES cash_to_cash_transfers(id),
      customer_id uuid NOT NULL REFERENCES customers(id),
      agent_id uuid NOT NULL REFERENCES agents(id),
      funding_agent_id uuid NOT NULL REFERENCES agents(id),
      agent_session_id uuid NOT NULL REFERENCES agent_authentication_sessions(id),
      beneficiary_phone varchar(10) NOT NULL,
      destination_hash varchar(64) NOT NULL CHECK (destination_hash ~ '^[0-9a-f]{64}$'),
      principal_minor bigint NOT NULL CHECK (principal_minor > 0),
      currency varchar(3) NOT NULL,
      redemption_method varchar(20) NOT NULL CHECK (redemption_method IN ('AGENT_CASH','CUSTOMER_WALLET')),
      funding_journal_id uuid NOT NULL REFERENCES ledger_journals(id),
      institution_id uuid NOT NULL,
      evidence_fingerprint varchar(64) NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE INDEX idx_c2c_claim_binding_transfer ON cash_to_cash_claim_challenge_bindings(transfer_id)`,
    );
    await q.query(
      `CREATE FUNCTION reject_c2c_claim_binding_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'claim binding is immutable'; END $$`,
    );
    await q.query(
      `CREATE TRIGGER c2c_claim_binding_immutable BEFORE UPDATE OR DELETE ON cash_to_cash_claim_challenge_bindings FOR EACH ROW EXECUTE FUNCTION reject_c2c_claim_binding_mutation()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard claim authorization evidence'));
  }
}
