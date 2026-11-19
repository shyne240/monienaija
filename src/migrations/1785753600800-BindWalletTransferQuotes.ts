import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Bind existing payment quotes to authenticated wallet-transfer participants; no fee is seeded. */
export class BindWalletTransferQuotes1785753600800 implements MigrationInterface {
  name = 'BindWalletTransferQuotes1785753600800';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE wallet_transfer_quote_bindings (
      quote_id uuid PRIMARY KEY REFERENCES payment_quotes(id) ON DELETE RESTRICT,
      principal_type varchar(12) NOT NULL CHECK (principal_type IN ('CUSTOMER','AGENT')),
      principal_id uuid NOT NULL,
      session_id uuid NOT NULL,
      source_wallet_id uuid NOT NULL,
      source_ledger_id uuid NOT NULL,
      destination_wallet_id uuid NOT NULL,
      destination_ledger_id uuid NOT NULL,
      recipient_type varchar(12) NOT NULL CHECK (recipient_type IN ('CUSTOMER','AGENT')),
      recipient_id uuid NOT NULL,
      institution_id uuid REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      pricing_hash char(64) NOT NULL CHECK (pricing_hash ~ '^[a-f0-9]{64}$'),
      transfer_id uuid UNIQUE REFERENCES transfers(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY (source_wallet_id, source_ledger_id) REFERENCES wallet_accounts(id,ledger_account_id) ON DELETE RESTRICT,
      FOREIGN KEY (destination_wallet_id, destination_ledger_id) REFERENCES wallet_accounts(id,ledger_account_id) ON DELETE RESTRICT,
      CHECK (source_wallet_id <> destination_wallet_id)
    )`);
    await q.query(`CREATE FUNCTION validate_wallet_transfer_quote_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE qrow payment_quotes%ROWTYPE; src wallet_accounts%ROWTYPE; dst wallet_accounts%ROWTYPE; tr transfers%ROWTYPE;
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Transfer quote binding cannot be deleted'; END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.transfer_id IS NOT NULL THEN RAISE EXCEPTION 'New quote binding cannot already be consumed'; END IF;
          SELECT * INTO qrow FROM payment_quotes WHERE id=NEW.quote_id FOR UPDATE;
          IF NOT FOUND OR qrow.payment_type <> 'TRANSFER' OR qrow.status <> 'ACTIVE' OR qrow.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'Transfer quote is not active';
          END IF;
          SELECT * INTO src FROM wallet_accounts WHERE id=NEW.source_wallet_id FOR SHARE;
          SELECT * INTO dst FROM wallet_accounts WHERE id=NEW.destination_wallet_id FOR SHARE;
          IF src.id IS NULL OR dst.id IS NULL OR src.ledger_account_id <> NEW.source_ledger_id OR dst.ledger_account_id <> NEW.destination_ledger_id
             OR src.owner_class <> NEW.principal_type OR dst.owner_class <> NEW.recipient_type
             OR lower(src.customer_id) <> NEW.principal_id::text OR lower(dst.customer_id) <> NEW.recipient_id::text
             OR wallet_owner_class(src.customer_id) <> src.owner_class OR wallet_owner_class(dst.customer_id) <> dst.owner_class
             OR src.institution_id IS DISTINCT FROM NEW.institution_id OR dst.institution_id IS DISTINCT FROM NEW.institution_id
             OR src.currency <> qrow.currency OR dst.currency <> qrow.currency THEN
            RAISE EXCEPTION 'Transfer quote participant mismatch';
          END IF;
          RETURN NEW;
        END IF;
        IF ROW(NEW.quote_id, NEW.principal_type, NEW.principal_id, NEW.session_id, NEW.source_wallet_id,
               NEW.source_ledger_id, NEW.destination_wallet_id, NEW.destination_ledger_id, NEW.recipient_type,
               NEW.recipient_id, NEW.institution_id, NEW.pricing_hash, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.quote_id, OLD.principal_type, OLD.principal_id, OLD.session_id, OLD.source_wallet_id,
               OLD.source_ledger_id, OLD.destination_wallet_id, OLD.destination_ledger_id, OLD.recipient_type,
               OLD.recipient_id, OLD.institution_id, OLD.pricing_hash, OLD.created_at)
           OR OLD.transfer_id IS NOT NULL OR NEW.transfer_id IS NULL THEN
          RAISE EXCEPTION 'Transfer quote binding is immutable';
        END IF;
        SELECT * INTO qrow FROM payment_quotes WHERE id=OLD.quote_id FOR UPDATE;
        SELECT * INTO tr FROM transfers WHERE id=NEW.transfer_id;
        IF qrow.status <> 'ACTIVE' OR qrow.expires_at <= clock_timestamp() OR tr.id IS NULL
           OR tr.status <> 'COMPLETED' OR tr.source_wallet_id <> OLD.source_wallet_id
           OR tr.destination_wallet_id <> OLD.destination_wallet_id OR tr.amount_minor <> qrow.amount_minor
           OR tr.currency <> qrow.currency OR tr.fee_minor <> qrow.fee_minor OR tr.vat_minor <> qrow.vat_minor THEN
          RAISE EXCEPTION 'Completed transfer does not match the active quote';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER wallet_transfer_quote_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON wallet_transfer_quote_bindings
      FOR EACH ROW EXECUTE FUNCTION validate_wallet_transfer_quote_binding()`);
    await q.query(`CREATE FUNCTION protect_bound_wallet_transfer_quote() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE bound_transfer uuid;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM wallet_transfer_quote_bindings WHERE quote_id=OLD.id) THEN RETURN NEW; END IF;
        IF ROW(NEW.id,NEW.quote_reference,NEW.payment_type,NEW.amount_minor,NEW.fee_minor,NEW.vat_minor,NEW.total_minor,
               NEW.currency,NEW.idempotency_key,NEW.request_hash,NEW.expires_at,NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.id,OLD.quote_reference,OLD.payment_type,OLD.amount_minor,OLD.fee_minor,OLD.vat_minor,OLD.total_minor,
               OLD.currency,OLD.idempotency_key,OLD.request_hash,OLD.expires_at,OLD.created_at) THEN
          RAISE EXCEPTION 'Bound transfer quote economics are immutable';
        END IF;
        SELECT transfer_id INTO bound_transfer FROM wallet_transfer_quote_bindings WHERE quote_id=OLD.id;
        IF OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('USED','EXPIRED') OR
           (NEW.status = 'USED' AND (bound_transfer IS NULL OR NEW.used_at IS NULL)) OR
           (NEW.status = 'EXPIRED' AND (NEW.used_at IS NOT NULL OR OLD.expires_at > clock_timestamp())) THEN
          RAISE EXCEPTION 'Invalid bound transfer quote transition';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER bound_wallet_transfer_quote_guard BEFORE UPDATE ON payment_quotes
      FOR EACH ROW EXECUTE FUNCTION protect_bound_wallet_transfer_quote()`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard wallet transfer confirmation evidence'));
  }
}
