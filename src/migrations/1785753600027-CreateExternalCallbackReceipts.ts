import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalCallbackReceipts1785753600027 implements MigrationInterface {
  name = 'CreateExternalCallbackReceipts1785753600027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE external_callback_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_operation_id UUID,
        partner_key VARCHAR(64) NOT NULL,
        callback_event_id VARCHAR(255) NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        signature_hash CHAR(64) NOT NULL,
        provider_reference_type VARCHAR(32) NOT NULL,
        provider_reference_value VARCHAR(255) NOT NULL,
        provider_reference_namespace VARCHAR(120) NOT NULL,
        provider_status VARCHAR(80) NOT NULL,
        provider_occurred_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        correlation_id VARCHAR(255) NOT NULL,
        status VARCHAR(24) NOT NULL,
        rejection_code VARCHAR(80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_external_callback_receipts_partner_event
          UNIQUE (partner_key, callback_event_id),
        CONSTRAINT fk_external_callback_receipts_operation
          FOREIGN KEY (external_operation_id) REFERENCES external_operations(id) ON DELETE RESTRICT,
        CONSTRAINT chk_external_callback_receipts_partner CHECK (partner_key = 'NIBSS_NIP'),
        CONSTRAINT chk_external_callback_receipts_event_id
          CHECK (callback_event_id ~ '^[\\x20-\\x7E]{1,255}$'),
        CONSTRAINT chk_external_callback_receipts_payload_hash
          CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_external_callback_receipts_signature_hash
          CHECK (signature_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_external_callback_receipts_reference_type CHECK (
          provider_reference_type IN ('OPERATION', 'TRANSACTION', 'SETTLEMENT')
        ),
        CONSTRAINT chk_external_callback_receipts_reference_value
          CHECK (provider_reference_value ~ '^[\\x20-\\x7E]{1,255}$'),
        CONSTRAINT chk_external_callback_receipts_namespace
          CHECK (provider_reference_namespace ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'),
        CONSTRAINT chk_external_callback_receipts_status
          CHECK (status IN ('RECEIVED', 'REJECTED')),
        CONSTRAINT chk_external_callback_receipts_rejection
          CHECK (
            (status = 'RECEIVED' AND rejection_code IS NULL)
            OR (status = 'REJECTED' AND rejection_code IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_callback_receipts_operation
        ON external_callback_receipts (external_operation_id, received_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_callback_receipts_provider_reference
        ON external_callback_receipts (
          partner_key,
          provider_reference_type,
          provider_reference_value
        )
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_external_callback_receipt_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.external_operation_id IS DISTINCT FROM NEW.external_operation_id
           OR OLD.partner_key IS DISTINCT FROM NEW.partner_key
           OR OLD.callback_event_id IS DISTINCT FROM NEW.callback_event_id
           OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
           OR OLD.signature_hash IS DISTINCT FROM NEW.signature_hash
           OR OLD.provider_reference_type IS DISTINCT FROM NEW.provider_reference_type
           OR OLD.provider_reference_value IS DISTINCT FROM NEW.provider_reference_value
           OR OLD.provider_reference_namespace IS DISTINCT FROM NEW.provider_reference_namespace
           OR OLD.provider_status IS DISTINCT FROM NEW.provider_status
           OR OLD.provider_occurred_at IS DISTINCT FROM NEW.provider_occurred_at
           OR OLD.received_at IS DISTINCT FROM NEW.received_at
           OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
           OR OLD.status IS DISTINCT FROM NEW.status
           OR OLD.rejection_code IS DISTINCT FROM NEW.rejection_code
        THEN
          RAISE EXCEPTION 'External callback receipt facts are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER external_callback_receipts_reject_mutation
      BEFORE UPDATE ON external_callback_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_external_callback_receipt_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS external_callback_receipts_reject_mutation ON external_callback_receipts`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_external_callback_receipt_mutation()`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_external_callback_receipts_provider_reference`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_callback_receipts_operation`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_callback_receipts`);
  }
}
