import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Synthetic drafts are unmistakable and cannot acquire active wallet or customer status. */
export class KycSyntheticDraft1785753600113 implements MigrationInterface {
  name = 'KycSyntheticDraft1785753600113';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE customers ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT chk_synthetic_customer_nonfinancial CHECK (NOT is_synthetic OR (status <> 'ACTIVE' AND kyc_level='NONE' AND kyc_status <> 'APPROVED'))`);
    await q.query(`CREATE FUNCTION kyc_synthetic_immutable_marker() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.is_synthetic IS DISTINCT FROM OLD.is_synthetic THEN RAISE EXCEPTION 'Customer synthetic marker is immutable'; END IF; RETURN NEW; END $$`);
    await q.query(
      `CREATE TRIGGER synthetic_customer_marker BEFORE UPDATE OF is_synthetic ON customers FOR EACH ROW EXECUTE FUNCTION kyc_synthetic_immutable_marker()`,
    );
    await q.query(`CREATE TABLE kyc_registration_synthetic_customer_links (
      session_id uuid PRIMARY KEY REFERENCES kyc_registration_sessions(id),
      attempt_id uuid NOT NULL UNIQUE REFERENCES kyc_registration_attempts(id),
      customer_id uuid NOT NULL UNIQUE REFERENCES customers(id),
      kind varchar(3) NOT NULL CHECK(kind IN ('BVN','NIN')),
      fixture_hash char(64) NOT NULL, provider varchar(16) NOT NULL CHECK(provider='SYNTHETIC'),
      match_outcome varchar(12) NOT NULL CHECK(match_outcome='MATCH'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(kind,fixture_hash)
    )`);
    await q.query(`CREATE FUNCTION kyc_reject_synthetic_financial_row() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE synthetic boolean; BEGIN
        IF replace(trim(both '{}' from lower(NEW.customer_id::text)), '-', '') ~ '^[0-9a-f]{32}$' THEN
          SELECT is_synthetic INTO synthetic FROM customers WHERE id=replace(trim(both '{}' from lower(NEW.customer_id::text)), '-', '')::uuid;
          IF synthetic THEN RAISE EXCEPTION 'Synthetic customer cannot hold financial privileges'; END IF;
        END IF;
        IF TG_TABLE_NAME = 'wallet_accounts' AND EXISTS (SELECT 1 FROM customers WHERE is_synthetic AND reference=NEW.customer_id::text) THEN
          RAISE EXCEPTION 'Synthetic customer cannot hold financial privileges';
        END IF;
        RETURN NEW;
      END $$`);
    for (const table of [
      'wallet_accounts',
      'customer_wallets',
      'wallet_ownerships',
      'customer_limit_profiles',
      'customer_eligibilities',
      'customer_operating_permissions',
      'customer_product_enrollments',
    ]) {
      await q.query(
        `CREATE TRIGGER reject_synthetic_financial BEFORE INSERT OR UPDATE OF customer_id ON ${table} FOR EACH ROW EXECUTE FUNCTION kyc_reject_synthetic_financial_row()`,
      );
    }
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT (EXISTS(SELECT 1 FROM customers WHERE is_synthetic) OR EXISTS(SELECT 1 FROM kyc_registration_synthetic_customer_links)) AS has_data`,
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove synthetic customer isolation');
    for (const table of [
      'wallet_accounts',
      'customer_wallets',
      'wallet_ownerships',
      'customer_limit_profiles',
      'customer_eligibilities',
      'customer_operating_permissions',
      'customer_product_enrollments',
    ])
      await q.query(`DROP TRIGGER reject_synthetic_financial ON ${table}`);
    await q.query('DROP FUNCTION kyc_reject_synthetic_financial_row()');
    await q.query('DROP TABLE kyc_registration_synthetic_customer_links');
    await q.query('DROP TRIGGER synthetic_customer_marker ON customers');
    await q.query('DROP FUNCTION kyc_synthetic_immutable_marker()');
    await q.query(
      'ALTER TABLE customers DROP CONSTRAINT chk_synthetic_customer_nonfinancial, DROP COLUMN is_synthetic',
    );
  }
}
