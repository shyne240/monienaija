import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve every wallet and journal. Ambiguous historical references are explicitly restricted. */
export class WalletOwnerClassification1785753600116 implements MigrationInterface {
  name = 'WalletOwnerClassification1785753600116';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE FUNCTION wallet_owner_class(ref text) RETURNS text LANGUAGE sql STABLE AS $$
      WITH c AS (SELECT id::text AS id FROM customers WHERE id=CASE WHEN ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ref::uuid ELSE NULL END OR reference=ref),
           a AS (SELECT id::text AS id FROM agents WHERE id=CASE WHEN ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ref::uuid ELSE NULL END OR reference=ref)
      SELECT CASE
        WHEN (SELECT count(*) FROM c)=1 AND (SELECT count(*) FROM a)=0 AND (SELECT id FROM c)=lower(ref) THEN 'CUSTOMER'
        WHEN (SELECT count(*) FROM a)=1 AND (SELECT count(*) FROM c)=0 AND (SELECT id FROM a)=lower(ref) THEN 'AGENT'
        ELSE 'REVIEW' END
    $$`);
    await q.query(
      `ALTER TABLE wallet_accounts ADD COLUMN owner_class varchar(12) NOT NULL DEFAULT 'REVIEW', ADD CONSTRAINT chk_wallet_owner_class CHECK(owner_class IN ('CUSTOMER','AGENT','REVIEW'))`,
    );
    await q.query(`UPDATE wallet_accounts SET owner_class=wallet_owner_class(customer_id)`);
    await q.query(`CREATE FUNCTION wallet_enforce_owner_class() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='UPDATE' AND (NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.ledger_account_id IS DISTINCT FROM OLD.ledger_account_id OR NEW.owner_class IS DISTINCT FROM OLD.owner_class) THEN
          RAISE EXCEPTION 'Wallet ownership is immutable';
        END IF;
        IF TG_OP='INSERT' THEN NEW.owner_class := wallet_owner_class(NEW.customer_id); END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `CREATE TRIGGER wallet_owner_class_guard BEFORE INSERT OR UPDATE ON wallet_accounts FOR EACH ROW EXECUTE FUNCTION wallet_enforce_owner_class()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove wallet ownership restrictions'));
  }
}
