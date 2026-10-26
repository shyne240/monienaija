import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive secure-storage lifecycle metadata for the existing 0093 PoA submission model.
 * The migration does not touch or rewrite 0093 and stores no document bytes or encryption keys.
 * Existing submissions default to QUARANTINED so pre-existing storage references are never
 * treated as clean merely because they predate the scanner lifecycle.
 */
export class AddSecureCustomerProofOfAddressUploads1785753600094 implements MigrationInterface {
  name = 'AddSecureCustomerProofOfAddressUploads1785753600094';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_proof_of_address_submissions
        ADD COLUMN encryption_key_version VARCHAR(64),
        ADD COLUMN document_status VARCHAR(16) NOT NULL DEFAULT 'QUARANTINED',
        ADD COLUMN scanner_result VARCHAR(16),
        ADD COLUMN scanner_checked_at TIMESTAMPTZ,
        ADD COLUMN idempotency_key_hash VARCHAR(64),
        ADD COLUMN withdrawn_by_principal_id VARCHAR(160),
        ADD COLUMN withdrawn_at TIMESTAMPTZ,
        ADD COLUMN withdrawal_reason VARCHAR(1000),
        ADD COLUMN archived_by_principal_id VARCHAR(160),
        ADD COLUMN archived_at TIMESTAMPTZ,
        ADD COLUMN archive_reason VARCHAR(1000),
        ADD CONSTRAINT chk_customer_poa_document_status CHECK (
          document_status IN ('QUARANTINED', 'AVAILABLE', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED')
        ),
        ADD CONSTRAINT chk_customer_poa_scanner_result CHECK (
          scanner_result IS NULL OR scanner_result IN ('CLEAN', 'INFECTED', 'UNAVAILABLE', 'ERROR')
        ),
        ADD CONSTRAINT chk_customer_poa_available_requires_clean_scan CHECK (
          document_status <> 'AVAILABLE' OR
          (storage_object_key IS NOT NULL AND encryption_key_version IS NOT NULL
            AND scanner_result = 'CLEAN' AND scanner_checked_at IS NOT NULL)
        ),
        ADD CONSTRAINT chk_customer_poa_withdrawal_metadata CHECK (
          document_status <> 'WITHDRAWN' OR
          (withdrawn_by_principal_id IS NOT NULL AND withdrawn_at IS NOT NULL
            AND withdrawal_reason IS NOT NULL AND length(btrim(withdrawal_reason)) > 0)
        ),
        ADD CONSTRAINT chk_customer_poa_archive_metadata CHECK (
          document_status <> 'ARCHIVED' OR
          (archived_by_principal_id IS NOT NULL AND archived_at IS NOT NULL
            AND archive_reason IS NOT NULL AND length(btrim(archive_reason)) > 0)
        ),
        ADD CONSTRAINT chk_customer_poa_idempotency_hash CHECK (
          idempotency_key_hash IS NULL OR idempotency_key_hash ~ '^[a-fA-F0-9]{64}$'
        )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_customer_poa_customer_status_created
        ON customer_proof_of_address_submissions (customer_id, document_status, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_poa_submission_customer_idempotency
        ON customer_proof_of_address_submissions (customer_id, idempotency_key_hash)
        WHERE idempotency_key_hash IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE customer_proof_of_address_document_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        action VARCHAR(32) NOT NULL,
        previous_document_status VARCHAR(16),
        new_document_status VARCHAR(16),
        actor_principal_id VARCHAR(160) NOT NULL,
        actor_role_key VARCHAR(100) NOT NULL,
        reason VARCHAR(1000),
        metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_customer_poa_document_history_submission
          FOREIGN KEY (submission_id, customer_id)
          REFERENCES customer_proof_of_address_submissions(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_poa_document_history_action CHECK (
          action IN ('UPLOADED', 'SCAN_CLEAN', 'QUARANTINED', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED')
        ),
        CONSTRAINT chk_customer_poa_document_history_status CHECK (
          (previous_document_status IS NULL OR previous_document_status IN ('QUARANTINED', 'AVAILABLE', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED'))
          AND (new_document_status IS NULL OR new_document_status IN ('QUARANTINED', 'AVAILABLE', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED'))
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_poa_document_history_submission_created
        ON customer_proof_of_address_document_history (submission_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_poa_document_history_customer_created
        ON customer_proof_of_address_document_history (customer_id, created_at)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_customer_poa_document_history_immutable
        BEFORE UPDATE OR DELETE ON customer_proof_of_address_document_history
        FOR EACH ROW EXECUTE FUNCTION prevent_customer_evidence_history_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_customer_poa_document_history_immutable ON customer_proof_of_address_document_history`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS customer_proof_of_address_document_history`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_customer_poa_submission_customer_idempotency`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_customer_poa_customer_status_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_customer_poa_document_history_submission_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_customer_poa_document_history_customer_created`);
    await queryRunner.query(`
      ALTER TABLE customer_proof_of_address_submissions
        DROP CONSTRAINT IF EXISTS chk_customer_poa_document_status,
        DROP CONSTRAINT IF EXISTS chk_customer_poa_scanner_result,
        DROP CONSTRAINT IF EXISTS chk_customer_poa_available_requires_clean_scan,
        DROP CONSTRAINT IF EXISTS chk_customer_poa_withdrawal_metadata,
        DROP CONSTRAINT IF EXISTS chk_customer_poa_archive_metadata,
        DROP CONSTRAINT IF EXISTS chk_customer_poa_idempotency_hash,
        DROP COLUMN IF EXISTS encryption_key_version,
        DROP COLUMN IF EXISTS document_status,
        DROP COLUMN IF EXISTS scanner_result,
        DROP COLUMN IF EXISTS scanner_checked_at,
        DROP COLUMN IF EXISTS idempotency_key_hash,
        DROP COLUMN IF EXISTS withdrawn_by_principal_id,
        DROP COLUMN IF EXISTS withdrawn_at,
        DROP COLUMN IF EXISTS withdrawal_reason,
        DROP COLUMN IF EXISTS archived_by_principal_id,
        DROP COLUMN IF EXISTS archived_at,
        DROP COLUMN IF EXISTS archive_reason
    `);
  }
}
