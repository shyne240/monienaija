import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CashOutIntents1785753600132 implements MigrationInterface {
  name = 'CashOutIntents1785753600132';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_out_intents (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL REFERENCES customers(id),
      credential_id uuid NOT NULL REFERENCES customer_authentication_credentials(id),
      credential_version integer NOT NULL CHECK (credential_version > 0),
      source_wallet_id uuid NOT NULL REFERENCES wallet_accounts(id),
      source_ledger_id uuid NOT NULL REFERENCES ledger_accounts(id),
      agent_id uuid NOT NULL REFERENCES agents(id),
      agent_session_id uuid NOT NULL,
      institution_scope text NOT NULL CHECK (institution_scope='MONIENAIJA'),
      operation_key varchar(255) NOT NULL,
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      currency varchar(3) NOT NULL CHECK (currency='NGN'),
      purpose text NOT NULL CHECK (purpose='WALLET_TO_CASH'),
      status text NOT NULL CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(agent_id, operation_key)
    )`);
    await q.query(`CREATE FUNCTION protect_cash_out_intent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ROW(NEW.id, NEW.customer_id, NEW.credential_id, NEW.credential_version, NEW.source_wallet_id,
               NEW.source_ledger_id, NEW.agent_id, NEW.agent_session_id, NEW.institution_scope,
               NEW.operation_key, NEW.amount_minor, NEW.currency, NEW.purpose, NEW.expires_at, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.id, OLD.customer_id, OLD.credential_id, OLD.credential_version, OLD.source_wallet_id,
               OLD.source_ledger_id, OLD.agent_id, OLD.agent_session_id, OLD.institution_scope,
               OLD.operation_key, OLD.amount_minor, OLD.currency, OLD.purpose, OLD.expires_at, OLD.created_at)
           OR OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('COMPLETED','CANCELLED') THEN
          RAISE EXCEPTION 'Cash-out intent is immutable';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER cash_out_intent_immutable BEFORE UPDATE ON cash_out_intents FOR EACH ROW EXECUTE FUNCTION protect_cash_out_intent()`,
    );
    await q.query(
      `ALTER TABLE mfa_challenges ALTER COLUMN session_id DROP NOT NULL, ADD COLUMN cash_out_intent_id uuid REFERENCES cash_out_intents(id), ADD CONSTRAINT chk_mfa_challenge_context CHECK ((session_id IS NOT NULL) <> (cash_out_intent_id IS NOT NULL))`,
    );
    await q.query(
      `ALTER TABLE cash_out_otp_challenge_security ADD COLUMN intent_id uuid REFERENCES cash_out_intents(id)`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard cash-out intents'));
  }
}
