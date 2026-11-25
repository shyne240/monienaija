import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Capture request-time target custody, never current affiliation at read time. No backfill. */
export class CaptureCustomerFundingScope1785753600807 implements MigrationInterface {
  name = 'CaptureCustomerFundingScope1785753600807';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE customer_funding_scope_evidence (
      request_id uuid PRIMARY KEY REFERENCES customer_funding_requests(id) ON DELETE RESTRICT,
      wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      attribution_id uuid NOT NULL REFERENCES governed_wallet_institution_attributions(id) ON DELETE RESTRICT,
      captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE INDEX customer_funding_scope_institution ON customer_funding_scope_evidence(institution_id,request_id)`,
    );
    await q.query(`CREATE FUNCTION validate_customer_funding_scope() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog,public AS $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM customer_funding_requests r
        JOIN wallet_accounts w ON w.customer_id=r.customer_id::text AND w.currency=r.currency
        JOIN governed_wallet_institution_attributions a ON a.id=w.institution_attribution_id
        JOIN ledger_accounts l ON l.id=w.ledger_account_id
        WHERE r.id=NEW.request_id AND r.status='PENDING' AND r.journal_id IS NULL
          AND r.xmin::text::bigint=txid_current() % 4294967296
          AND w.id=NEW.wallet_id AND w.owner_class='CUSTOMER'
          AND w.institution_id=NEW.institution_id AND w.ledger_account_id=NEW.ledger_account_id
          AND a.id=NEW.attribution_id AND a.wallet_id=w.id AND a.ledger_account_id=l.id
          AND a.institution_id=w.institution_id AND a.owner_reference=r.customer_id::text
          AND l.institutional_scope='INSTITUTION' AND l.institution_id=a.institution_id
      ) THEN RAISE EXCEPTION 'Funding scope requires same-transaction request and governed wallet custody evidence'; END IF;
      RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER customer_funding_scope_validate BEFORE INSERT ON customer_funding_scope_evidence
      FOR EACH ROW EXECUTE FUNCTION validate_customer_funding_scope()`);
    await q.query(`CREATE TRIGGER customer_funding_scope_immutable BEFORE UPDATE OR DELETE ON customer_funding_scope_evidence
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    await q.query(`CREATE FUNCTION capture_customer_funding_scope() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
      INSERT INTO customer_funding_scope_evidence(request_id,wallet_id,ledger_account_id,institution_id,attribution_id)
      SELECT NEW.id,w.id,w.ledger_account_id,a.institution_id,a.id
        FROM wallet_accounts w
        JOIN governed_wallet_institution_attributions a ON a.id=w.institution_attribution_id
          AND a.wallet_id=w.id AND a.ledger_account_id=w.ledger_account_id AND a.institution_id=w.institution_id
        JOIN ledger_accounts l ON l.id=w.ledger_account_id AND l.institution_id=a.institution_id AND l.institutional_scope='INSTITUTION'
        WHERE NEW.status='PENDING' AND NEW.journal_id IS NULL
          AND w.customer_id=NEW.customer_id::text AND w.currency=NEW.currency AND w.owner_class='CUSTOMER'
          AND a.owner_reference=NEW.customer_id::text
        FOR SHARE OF w,l;
      RETURN NEW;
      END $$`);
    await q.query(`REVOKE ALL ON FUNCTION capture_customer_funding_scope() FROM PUBLIC`);
    await q.query(`CREATE TRIGGER customer_funding_scope_capture AFTER INSERT ON customer_funding_requests
      FOR EACH ROW EXECUTE FUNCTION capture_customer_funding_scope()`);
    await q.query(`CREATE FUNCTION guard_customer_funding_scope() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog,public AS $$ DECLARE e RECORD; BEGIN
      SELECT * INTO e FROM customer_funding_scope_evidence WHERE request_id=OLD.id;
      IF FOUND THEN
        IF ROW(OLD.id,OLD.customer_id,OLD.currency,OLD.amount_minor,OLD.request_hash,OLD.reference)
          IS DISTINCT FROM ROW(NEW.id,NEW.customer_id,NEW.currency,NEW.amount_minor,NEW.request_hash,NEW.reference)
          THEN RAISE EXCEPTION 'Captured funding request identity and terms are immutable'; END IF;
        IF NEW.journal_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ledger_journals j WHERE j.id=NEW.journal_id AND j.status='POSTED'
            AND j.institution_id=e.institution_id
            AND EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id
              AND l.ledger_account_id=e.ledger_account_id AND l.direction='CREDIT' AND l.amount_minor=NEW.amount_minor)
        ) THEN RAISE EXCEPTION 'Funding journal does not match captured request custody'; END IF;
      END IF;
      RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER customer_funding_scope_guard BEFORE UPDATE ON customer_funding_requests
      FOR EACH ROW EXECUTE FUNCTION guard_customer_funding_scope()`);
    await q.query(`REVOKE ALL ON customer_funding_scope_evidence FROM PUBLIC,monienaija_runtime`);
    await q.query(`GRANT SELECT ON customer_funding_scope_evidence TO monienaija_runtime`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove captured funding institution evidence'));
  }
}
