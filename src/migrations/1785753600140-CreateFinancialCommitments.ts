import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Evidence tables only: these records do not themselves authorize a financial command. */
export class CreateFinancialCommitments1785753600140 implements MigrationInterface {
  name = 'CreateFinancialCommitments1785753600140';

  async up(q: QueryRunner): Promise<void> {
    // Separate customer-funds liability: unlike the general suspense account it cannot
    // go negative, and cannot be confused with unrelated suspense balances.
    await q.query(`
      INSERT INTO ledger_accounts
        (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
      VALUES (gen_random_uuid(), 'PAYMENT-WITHDRAWAL_RESERVE-NGN', 'Withdrawal funds reserved NGN',
              'LIABILITY', 'CREDIT', 'NGN', 'CUSTOMER_FUNDS', false, true)
    `);
    await q.query(`
      CREATE TABLE financial_authorizations (
        id uuid PRIMARY KEY,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        session_id uuid NOT NULL REFERENCES authentication_sessions(id) ON DELETE RESTRICT,
        pin_audit_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
        wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        amount_minor bigint NOT NULL CHECK (amount_minor > 0),
        currency varchar(3) NOT NULL CHECK (currency = 'NGN'),
        request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        principal_type varchar(20) NOT NULL CHECK (principal_type = 'CUSTOMER'),
        principal_id varchar(160) NOT NULL CHECK (length(principal_id) > 0),
        institution varchar(160) NOT NULL CHECK (length(institution) > 0),
        authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await q.query(`
      CREATE FUNCTION validate_financial_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM authentication_sessions s
          JOIN customer_transaction_pins p ON p.customer_id = s.customer_id
          JOIN audit_events a ON a.entity_id = p.id
          JOIN wallet_accounts w ON w.id = NEW.wallet_account_id
          WHERE s.id = NEW.session_id AND s.customer_id = NEW.customer_id
            AND s.status = 'ACTIVE' AND s.audience = 'customer-api' AND s.expires_at > clock_timestamp()
            AND p.deleted_at IS NULL AND p.account_locked = false
            AND a.id = NEW.pin_audit_id AND a.entity_type = 'CUSTOMER_TRANSACTION_PIN'
            AND a.action = 'PIN_VERIFIED' AND a.actor = NEW.customer_id::text
            AND a.new_values->>'customerId' = NEW.customer_id::text
            AND a.new_values->>'financialRequestHash' = NEW.request_hash
            AND a.new_values->>'sessionId' = NEW.session_id::text
            AND NEW.principal_id = NEW.customer_id::text
            AND w.customer_id = NEW.customer_id::text AND w.ledger_account_id = NEW.ledger_account_id
            AND w.owner_class = 'CUSTOMER' AND w.currency = NEW.currency
        ) THEN RAISE EXCEPTION 'Financial authorization evidence is not bound to this request'; END IF;
        RETURN NEW;
      END $$
    `);
    await q.query(`CREATE TRIGGER financial_authorization_validate BEFORE INSERT ON financial_authorizations
      FOR EACH ROW EXECUTE FUNCTION validate_financial_authorization()`);
    await q.query(`CREATE TRIGGER financial_authorization_immutable BEFORE UPDATE OR DELETE ON financial_authorizations
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    await q.query(`
      CREATE TABLE financial_commitments (
        id uuid PRIMARY KEY,
        authorization_id uuid NOT NULL UNIQUE REFERENCES financial_authorizations(id) ON DELETE RESTRICT,
        withdrawal_id uuid NOT NULL UNIQUE REFERENCES withdrawals(id) ON DELETE RESTRICT,
        external_operation_id uuid NOT NULL UNIQUE REFERENCES external_operations(id) ON DELETE RESTRICT,
        reservation_journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        reserve_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        idempotency_key varchar(255) NOT NULL UNIQUE CHECK (length(idempotency_key) > 0),
        request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        state varchar(20) NOT NULL CHECK (state IN ('RESERVED', 'SETTLED', 'RELEASED')),
        resolution_journal_id uuid UNIQUE REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        resolved_at timestamptz,
        CONSTRAINT chk_financial_commitment_resolution CHECK (
          (state = 'RESERVED' AND resolution_journal_id IS NULL AND resolved_at IS NULL) OR
          (state IN ('SETTLED', 'RELEASED') AND resolution_journal_id IS NOT NULL AND resolved_at IS NOT NULL)
        )
      )
    `);
    await q.query(`
      CREATE FUNCTION validate_financial_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Financial commitments cannot be deleted'; END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD.state <> 'RESERVED' OR NEW.state NOT IN ('SETTLED','RELEASED') OR
             (to_jsonb(NEW) - ARRAY['state','resolution_journal_id','resolved_at']) <>
             (to_jsonb(OLD) - ARRAY['state','resolution_journal_id','resolved_at']) THEN
            RAISE EXCEPTION 'Invalid financial commitment transition';
          END IF;
          IF NEW.state = 'RELEASED' AND NOT EXISTS (
            SELECT 1 FROM ledger_journals j WHERE j.id=NEW.resolution_journal_id
              AND j.reversal_of_journal_id=NEW.reservation_journal_id
          ) THEN RAISE EXCEPTION 'Release must reverse the reservation'; END IF;
          IF NEW.state = 'SETTLED' AND NOT EXISTS (
            SELECT 1 FROM external_settlements s WHERE s.external_operation_id=NEW.external_operation_id
              AND s.journal_id=NEW.resolution_journal_id AND s.status='POSTED'
          ) THEN RAISE EXCEPTION 'Settlement must match the external settlement'; END IF;
          RETURN NEW;
        END IF;
        IF NEW.state <> 'RESERVED' OR NOT EXISTS (
          SELECT 1 FROM financial_authorizations a
          JOIN withdrawals w ON w.id=NEW.withdrawal_id
          JOIN external_operations o ON o.id=NEW.external_operation_id
          JOIN ledger_journals j ON j.id=NEW.reservation_journal_id
          JOIN ledger_accounts r ON r.id=NEW.reserve_account_id
          WHERE a.id=NEW.authorization_id AND a.request_hash=NEW.request_hash
            AND w.wallet_id=a.wallet_account_id AND w.amount_minor=a.amount_minor AND w.currency=a.currency
            AND o.resource_type='WITHDRAWAL' AND o.resource_id=w.id AND o.customer_id=a.customer_id
            AND o.wallet_account_id=a.wallet_account_id AND o.ledger_account_id=a.ledger_account_id
            AND o.amount_minor=a.amount_minor AND o.currency=a.currency AND o.accounting_unit='CUSTOMER_FUNDS'
            AND j.currency=a.currency AND j.accounting_unit='CUSTOMER_FUNDS' AND j.status='POSTED'
            AND j.reversal_of_journal_id IS NULL
            AND r.code='PAYMENT-WITHDRAWAL_RESERVE-NGN' AND r.allow_negative_balance=false
            AND (SELECT count(*) FROM ledger_lines l WHERE l.journal_id=j.id)=2
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=a.ledger_account_id AND l.direction='DEBIT' AND l.amount_minor=a.amount_minor)
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=r.id AND l.direction='CREDIT' AND l.amount_minor=a.amount_minor)
            AND j.xmin::text::bigint=(txid_current() % 4294967296)
            AND o.xmin::text::bigint=(txid_current() % 4294967296)
            AND a.xmin::text::bigint=(txid_current() % 4294967296)
        ) THEN RAISE EXCEPTION 'Financial commitment does not match its authorization, operation and reservation'; END IF;
        RETURN NEW;
      END $$
    `);
    await q.query(`CREATE TRIGGER financial_commitment_validate BEFORE INSERT OR UPDATE OR DELETE
      ON financial_commitments FOR EACH ROW EXECUTE FUNCTION validate_financial_commitment()`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove financial commitment evidence'));
  }
}
