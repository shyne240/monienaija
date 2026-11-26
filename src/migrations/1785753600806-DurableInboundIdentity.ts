import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Bank intake UUID is the permanent payment key. Float receipts are immutable aliases, not
 * replacement transactions. Legacy wallet receipts have no environment and are NOT hash-joined. */
export class DurableInboundIdentity1785753600806 implements MigrationInterface {
  name = 'DurableInboundIdentity1785753600806';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE banking_inbound_float_links (
      payment_id uuid PRIMARY KEY REFERENCES banking_inbound_payments(id) ON DELETE RESTRICT,
      float_receipt_id uuid NOT NULL UNIQUE REFERENCES agent_float_funding_receipts(id) ON DELETE RESTRICT,
      evidence_kind text NOT NULL DEFAULT 'VERIFIED_PROVIDER_ENV_REFERENCE_ACCOUNT_AMOUNT'
        CHECK(evidence_kind='VERIFIED_PROVIDER_ENV_REFERENCE_ACCOUNT_AMOUNT'),
      linked_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    // Validate even direct inserts. Never accept merely a matching reference or a journal UUID.
    await q.query(`CREATE FUNCTION validate_banking_inbound_float_link() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM banking_inbound_payments b
        JOIN agent_float_funding_receipts r ON r.id=NEW.float_receipt_id
        JOIN ledger_journals j ON j.id=r.journal_id
        WHERE b.id=NEW.payment_id AND b.verification_state='VERIFIED'
          AND b.institution_id=r.institution_id AND b.provider_key=r.provider_key
          AND b.environment=r.environment
          AND b.provider_transaction_reference=r.provider_transaction_reference
          AND b.receiving_account_number=r.funding_account_number
          AND b.currency=r.currency AND b.credited_amount_minor=r.amount_minor
          AND j.institution_id=r.institution_id AND j.status='POSTED'
          AND (b.ledger_transaction_id IS NULL OR b.ledger_transaction_id=r.journal_id)
      ) THEN RAISE EXCEPTION 'Inbound identity requires matching verified institution/provider/environment/reference/account/amount and posted receipt'; END IF;
      RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER banking_inbound_float_link_validate BEFORE INSERT ON banking_inbound_float_links
      FOR EACH ROW EXECUTE FUNCTION validate_banking_inbound_float_link()`);
    await q.query(`CREATE TRIGGER banking_inbound_float_link_immutable BEFORE UPDATE OR DELETE ON banking_inbound_float_links
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    // Existing bank evidence guarded amounts/reference, but not its scope/provider/environment.
    // Freeze all identity inputs and the original URL UUID before using them as linkage evidence.
    await q.query(`CREATE FUNCTION guard_banking_inbound_identity() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
      IF ROW(OLD.id,OLD.institution_id,OLD.provider_key,OLD.environment,OLD.receiving_account_number,OLD.recorded_at)
        IS DISTINCT FROM ROW(NEW.id,NEW.institution_id,NEW.provider_key,NEW.environment,NEW.receiving_account_number,NEW.recorded_at)
        THEN RAISE EXCEPTION 'Inbound business identity is immutable'; END IF;
      IF EXISTS (SELECT 1 FROM banking_inbound_float_links WHERE payment_id=OLD.id)
        AND (NEW.verification_state <> 'VERIFIED' OR NEW.ledger_transaction_id IS DISTINCT FROM OLD.ledger_transaction_id)
        THEN RAISE EXCEPTION 'Linked inbound payment evidence is immutable'; END IF;
      RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER banking_inbound_identity_guard BEFORE UPDATE ON banking_inbound_payments
      FOR EACH ROW EXECUTE FUNCTION guard_banking_inbound_identity()`);
    await q.query(`CREATE FUNCTION link_banking_inbound_float() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
      -- Bounded stripes: a bulk intake must not retain one advisory lock per payment.
      PERFORM pg_advisory_xact_lock(1785753606, hashtext(
        NEW.institution_id::text || ':' || NEW.provider_key || ':' || NEW.environment || ':' || NEW.provider_transaction_reference) & 63);
      INSERT INTO banking_inbound_float_links(payment_id,float_receipt_id)
        SELECT b.id,r.id FROM banking_inbound_payments b
        JOIN agent_float_funding_receipts r ON r.institution_id=b.institution_id
          AND r.provider_key=b.provider_key AND r.environment=b.environment
          AND r.provider_transaction_reference=b.provider_transaction_reference
          AND r.funding_account_number=b.receiving_account_number
          AND r.currency=b.currency AND r.amount_minor=b.credited_amount_minor
        JOIN ledger_journals j ON j.id=r.journal_id AND j.institution_id=r.institution_id AND j.status='POSTED'
        WHERE b.institution_id=NEW.institution_id AND b.provider_key=NEW.provider_key
          AND b.environment=NEW.environment AND b.provider_transaction_reference=NEW.provider_transaction_reference
          AND b.verification_state='VERIFIED'
          AND (b.ledger_transaction_id IS NULL OR b.ledger_transaction_id=r.journal_id)
        ON CONFLICT DO NOTHING;
      RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER banking_inbound_float_from_bank AFTER INSERT OR UPDATE OF verification_state ON banking_inbound_payments
      FOR EACH ROW EXECUTE FUNCTION link_banking_inbound_float()`);
    await q.query(`CREATE TRIGGER banking_inbound_float_from_receipt AFTER INSERT ON agent_float_funding_receipts
      FOR EACH ROW EXECUTE FUNCTION link_banking_inbound_float()`);
    // No inferred historical backfill. Only new insert/verification events bind these records.
    await q.query(`REVOKE ALL ON banking_inbound_float_links FROM PUBLIC`);
    await q.query(
      `REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON banking_inbound_float_links FROM monienaija_runtime`,
    );
    await q.query(`GRANT SELECT,INSERT ON banking_inbound_float_links TO monienaija_runtime`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove durable inbound identity aliases'));
  }
}
