import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Destination evidence only. Does not supply a financial-institution authority. */
export class BindWithdrawalDestination1785753600141 implements MigrationInterface {
  name = 'BindWithdrawalDestination1785753600141';

  async up(q: QueryRunner): Promise<void> {
    // The old value was a product/operator label, not an authoritative institution.
    // Preserve existing evidence unchanged; NULL means institutional context is unavailable.
    await q.query(`ALTER TABLE financial_authorizations ALTER COLUMN institution DROP NOT NULL`);
    await q.query(`CREATE TABLE financial_commitment_destinations (
      commitment_id uuid PRIMARY KEY REFERENCES financial_commitments(id) ON DELETE RESTRICT,
      beneficiary_id uuid NOT NULL REFERENCES customer_beneficiaries(id) ON DELETE RESTRICT,
      beneficiary_version integer NOT NULL CHECK (beneficiary_version > 0),
      bank_id uuid NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
      bank_code varchar(20) NOT NULL,
      target_reference varchar(180) NOT NULL CHECK (target_reference ~ '^a6-target:[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE FUNCTION validate_financial_commitment_destination() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM financial_commitments c
          JOIN financial_authorizations a ON a.id=c.authorization_id
          JOIN external_operations o ON o.id=c.external_operation_id
          JOIN customer_beneficiaries b ON b.id=NEW.beneficiary_id AND b.customer_id=a.customer_id
          JOIN beneficiary_ownerships bo ON bo.beneficiary_id=b.id AND bo.customer_id=a.customer_id AND bo.deleted_at IS NULL
          JOIN banks k ON k.id=NEW.bank_id AND k.bank_code=NEW.bank_code
          WHERE c.id=NEW.commitment_id AND c.state='RESERVED'
            AND c.xmin::text::bigint=(txid_current() % 4294967296)
            AND b.version=NEW.beneficiary_version AND b.status='ACTIVE' AND b.verified
            AND b.deleted_at IS NULL AND b.beneficiary_type='BANK_ACCOUNT'
            AND b.destination_identifier ~ '^[0-9]{4,32}$' AND b.destination_institution=k.bank_code
            AND k.status='ACTIVE' AND k.nip_supported
            AND NEW.target_reference='a6-target:' || encode(sha256(convert_to(
              'v1|' || b.id::text || '|' || b.customer_id::text || '|' || b.version::text || '|' || k.bank_code || '|' || b.destination_identifier, 'UTF8')), 'hex')
            AND o.target_mapping_reference=NEW.target_reference
        ) THEN RAISE EXCEPTION 'Destination does not match the committed beneficiary and operation'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER financial_commitment_destination_validate BEFORE INSERT ON financial_commitment_destinations
      FOR EACH ROW EXECUTE FUNCTION validate_financial_commitment_destination()`);
    await q.query(`CREATE TRIGGER financial_commitment_destination_immutable BEFORE UPDATE OR DELETE ON financial_commitment_destinations
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()`);
    await q.query(`CREATE FUNCTION require_financial_commitment_destination() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM financial_commitment_destinations d WHERE d.commitment_id=NEW.id) THEN
          RAISE EXCEPTION 'New financial commitment requires bound destination evidence';
        END IF;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER financial_commitment_destination_required
      AFTER INSERT ON financial_commitments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION require_financial_commitment_destination()`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to remove financial commitment destination evidence'),
    );
  }
}
