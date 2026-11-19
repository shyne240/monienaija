import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Extend the existing beneficiary and history model; never fabricate legacy recipient bindings. */
export class ExtendBeneficiaryOwnership1785753600802 implements MigrationInterface {
  name = 'ExtendBeneficiaryOwnership1785753600802';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE customer_beneficiaries ALTER COLUMN customer_id DROP NOT NULL,
      ADD COLUMN agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
      ADD COLUMN wallet_recipient_type varchar(12), ADD COLUMN wallet_recipient_id uuid,
      ADD CONSTRAINT chk_beneficiary_owner_exactly_one CHECK ((customer_id IS NOT NULL) <> (agent_id IS NOT NULL)),
      ADD CONSTRAINT chk_beneficiary_wallet_recipient CHECK (
        (wallet_recipient_type IS NULL AND wallet_recipient_id IS NULL) OR
        (wallet_recipient_type IS NOT NULL AND wallet_recipient_id IS NOT NULL AND ((wallet_recipient_type='CUSTOMER' AND beneficiary_type='INTERNAL_CUSTOMER') OR
         (wallet_recipient_type='AGENT' AND beneficiary_type='INTERNAL_AGENT'))))`);
    await q.query(`ALTER TABLE customer_beneficiaries DROP CONSTRAINT chk_customer_beneficiaries_type,
      ADD CONSTRAINT chk_customer_beneficiaries_type CHECK (beneficiary_type IN ('INTERNAL_CUSTOMER','INTERNAL_AGENT','BANK_ACCOUNT','MOBILE_MONEY','CASH_AGENT'))`);
    await q.query(
      `CREATE UNIQUE INDEX uq_agent_beneficiary_destination ON customer_beneficiaries(agent_id,normalized_destination_identifier) WHERE agent_id IS NOT NULL AND deleted_at IS NULL`,
    );
    await q.query(
      `CREATE INDEX idx_agent_beneficiary_status ON customer_beneficiaries(agent_id,status) WHERE agent_id IS NOT NULL`,
    );
    await q.query(`ALTER TABLE beneficiary_ownerships ALTER COLUMN customer_id DROP NOT NULL,
      ADD COLUMN agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
      ADD CONSTRAINT chk_beneficiary_ownership_owner_exactly_one CHECK ((customer_id IS NOT NULL) <> (agent_id IS NOT NULL))`);
    await q.query(
      `CREATE INDEX idx_beneficiary_ownerships_agent ON beneficiary_ownerships(agent_id) WHERE agent_id IS NOT NULL`,
    );
    await q.query(`CREATE FUNCTION guard_beneficiary_owner_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE b customer_beneficiaries%ROWTYPE;
      BEGIN
        IF TG_TABLE_NAME='customer_beneficiaries' THEN
          IF TG_OP='UPDATE' AND (ROW(NEW.customer_id,NEW.agent_id,NEW.wallet_recipient_type,NEW.wallet_recipient_id)
            IS DISTINCT FROM ROW(OLD.customer_id,OLD.agent_id,OLD.wallet_recipient_type,OLD.wallet_recipient_id)) THEN
            RAISE EXCEPTION 'Beneficiary owner and recipient binding are immutable';
          END IF;
        ELSE
          SELECT * INTO b FROM customer_beneficiaries WHERE id=NEW.beneficiary_id FOR SHARE;
          IF NOT FOUND OR NEW.customer_id IS DISTINCT FROM b.customer_id OR NEW.agent_id IS DISTINCT FROM b.agent_id THEN
            RAISE EXCEPTION 'Beneficiary ownership does not match beneficiary owner';
          END IF;
          IF TG_OP='UPDATE' AND ROW(NEW.beneficiary_id,NEW.customer_id,NEW.agent_id)
            IS DISTINCT FROM ROW(OLD.beneficiary_id,OLD.customer_id,OLD.agent_id) THEN
            RAISE EXCEPTION 'Beneficiary ownership binding is immutable';
          END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER beneficiary_binding_guard BEFORE UPDATE ON customer_beneficiaries FOR EACH ROW EXECUTE FUNCTION guard_beneficiary_owner_binding()`,
    );
    await q.query(
      `CREATE TRIGGER beneficiary_ownership_binding_guard BEFORE INSERT OR UPDATE ON beneficiary_ownerships FOR EACH ROW EXECUTE FUNCTION guard_beneficiary_owner_binding()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard beneficiary ownership evidence'));
  }
}
