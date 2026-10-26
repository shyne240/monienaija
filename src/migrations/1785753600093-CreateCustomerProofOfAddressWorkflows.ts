import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Policy-neutral persistence for documentary address evidence and physical-address verification.
 * This migration does not create upload endpoints, storage objects, approvals, or wallet-tier
 * changes. Candidate categories are deliberately stored as configurable strings; accepted evidence
 * policy and freshness rules remain outside this schema.
 */
export class CreateCustomerProofOfAddressWorkflows1785753600093 implements MigrationInterface {
  name = 'CreateCustomerProofOfAddressWorkflows1785753600093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_addresses
        ADD CONSTRAINT uq_customer_addresses_id_customer UNIQUE (id, customer_id)
    `);

    await queryRunner.query(`
      CREATE TABLE customer_proof_of_address_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_group_id UUID NOT NULL,
        revision_number INTEGER NOT NULL DEFAULT 1,
        supersedes_submission_id UUID,
        customer_id UUID NOT NULL,
        residential_address_id UUID NOT NULL,
        category VARCHAR(60) NOT NULL,
        document_type VARCHAR(100) NOT NULL,
        issuer_name VARCHAR(200),
        document_date DATE,
        review_status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        storage_object_key VARCHAR(512),
        original_file_name VARCHAR(255),
        detected_mime_type VARCHAR(120),
        file_size_bytes BIGINT,
        sha256_checksum VARCHAR(64),
        created_by_principal_id VARCHAR(160) NOT NULL,
        created_by_role_key VARCHAR(100) NOT NULL,
        uploaded_by_principal_id VARCHAR(160),
        uploaded_at TIMESTAMPTZ,
        reviewed_by_principal_id VARCHAR(160),
        reviewed_at TIMESTAMPTZ,
        rejection_reason VARCHAR(1000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_customer_poa_submission_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_poa_submission_residential_address
          FOREIGN KEY (residential_address_id, customer_id)
          REFERENCES customer_addresses(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_poa_submission_supersedes
          FOREIGN KEY (supersedes_submission_id, customer_id, submission_group_id)
          REFERENCES customer_proof_of_address_submissions(id, customer_id, submission_group_id)
          ON DELETE RESTRICT,
        CONSTRAINT uq_customer_poa_submission_id_customer UNIQUE (id, customer_id),
        CONSTRAINT uq_customer_poa_submission_group_revision UNIQUE (submission_group_id, revision_number),
        CONSTRAINT uq_customer_poa_submission_id_customer_group UNIQUE (id, customer_id, submission_group_id),
        CONSTRAINT chk_customer_poa_submission_revision_link CHECK (
          (revision_number = 1 AND supersedes_submission_id IS NULL) OR
          (revision_number > 1 AND supersedes_submission_id IS NOT NULL)
        ),
        CONSTRAINT chk_customer_poa_submission_revision_positive CHECK (
          revision_number > 0
        ),
        CONSTRAINT chk_customer_poa_submission_status CHECK (
          review_status IN ('PENDING', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_customer_poa_submission_review_metadata CHECK (
          (review_status = 'PENDING' AND reviewed_by_principal_id IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
          OR (review_status = 'VERIFIED' AND reviewed_by_principal_id IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
          OR (review_status = 'REJECTED' AND reviewed_by_principal_id IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0)
        ),
        CONSTRAINT chk_customer_poa_submission_reviewer_separation CHECK (
          reviewed_by_principal_id IS NULL OR
          (reviewed_by_principal_id <> created_by_principal_id AND
           (uploaded_by_principal_id IS NULL OR reviewed_by_principal_id <> uploaded_by_principal_id))
        ),
        CONSTRAINT chk_customer_poa_submission_review_requires_file CHECK (
          review_status = 'PENDING' OR storage_object_key IS NOT NULL
        ),
        CONSTRAINT chk_customer_poa_submission_file_metadata CHECK (
          (storage_object_key IS NULL AND original_file_name IS NULL AND detected_mime_type IS NULL
            AND file_size_bytes IS NULL AND sha256_checksum IS NULL
            AND uploaded_by_principal_id IS NULL AND uploaded_at IS NULL)
          OR
          (storage_object_key IS NOT NULL AND original_file_name IS NOT NULL
            AND detected_mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
            AND file_size_bytes > 0 AND sha256_checksum ~ '^[a-fA-F0-9]{64}$'
            AND uploaded_by_principal_id IS NOT NULL AND uploaded_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customer_poa_submission_supersedes
        ON customer_proof_of_address_submissions (supersedes_submission_id)
        WHERE supersedes_submission_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_poa_customer_address_created
        ON customer_proof_of_address_submissions (customer_id, residential_address_id, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE customer_proof_of_address_decision_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        action VARCHAR(24) NOT NULL,
        previous_status VARCHAR(16),
        new_status VARCHAR(16) NOT NULL,
        actor_principal_id VARCHAR(160) NOT NULL,
        actor_role_key VARCHAR(100) NOT NULL,
        reason VARCHAR(1000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_customer_poa_decision_history_submission
          FOREIGN KEY (submission_id, customer_id)
          REFERENCES customer_proof_of_address_submissions(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_poa_decision_history_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_poa_decision_history_action CHECK (
          action IN ('SUBMITTED', 'RESUBMITTED', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_customer_poa_decision_history_status CHECK (
          (previous_status IS NULL OR previous_status IN ('PENDING', 'VERIFIED', 'REJECTED'))
          AND new_status IN ('PENDING', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_customer_poa_decision_history_action_status CHECK (
          (action IN ('SUBMITTED', 'RESUBMITTED') AND previous_status IS NULL AND new_status = 'PENDING')
          OR (action = 'VERIFIED' AND previous_status = 'PENDING' AND new_status = 'VERIFIED')
          OR (action = 'REJECTED' AND previous_status = 'PENDING' AND new_status = 'REJECTED')
        ),
        CONSTRAINT chk_customer_poa_decision_history_rejection_reason CHECK (
          action <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_poa_decision_history_submission_created
        ON customer_proof_of_address_decision_history (submission_id, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE customer_physical_address_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        residential_address_id UUID NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
        outcome VARCHAR(24) NOT NULL DEFAULT 'PENDING',
        verification_method VARCHAR(80),
        provider_name VARCHAR(200),
        provider_reference VARCHAR(160),
        assigned_officer_principal_id VARCHAR(160),
        assigned_by_principal_id VARCHAR(160),
        assigned_at TIMESTAMPTZ,
        visit_date DATE,
        findings TEXT,
        evidence_report_reference VARCHAR(500),
        submitted_by_principal_id VARCHAR(160),
        submitted_at TIMESTAMPTZ,
        decided_by_principal_id VARCHAR(160),
        decided_at TIMESTAMPTZ,
        decision_reason VARCHAR(1000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_customer_physical_verification_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_physical_verification_residential_address
          FOREIGN KEY (residential_address_id, customer_id)
          REFERENCES customer_addresses(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT uq_customer_physical_verification_id_customer UNIQUE (id, customer_id),
        CONSTRAINT chk_customer_physical_verification_status CHECK (
          status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED')
        ),
        CONSTRAINT chk_customer_physical_verification_outcome CHECK (
          outcome IN ('PENDING', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_customer_physical_verification_assignment CHECK (
          (assigned_officer_principal_id IS NULL AND assigned_by_principal_id IS NULL AND assigned_at IS NULL)
          OR (assigned_officer_principal_id IS NOT NULL AND assigned_by_principal_id IS NOT NULL AND assigned_at IS NOT NULL)
        ),
        CONSTRAINT chk_customer_physical_verification_assigned_status CHECK (
          status NOT IN ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED')
          OR assigned_officer_principal_id IS NOT NULL
        ),
        CONSTRAINT chk_customer_physical_verification_submission_metadata CHECK (
          status NOT IN ('SUBMITTED', 'DECIDED')
          OR (submitted_by_principal_id IS NOT NULL AND submitted_at IS NOT NULL)
        ),
        CONSTRAINT chk_customer_physical_verification_decision_metadata CHECK (
          (status <> 'DECIDED' AND outcome = 'PENDING' AND decided_by_principal_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
          OR (status = 'DECIDED' AND outcome = 'VERIFIED' AND decided_by_principal_id IS NOT NULL AND decided_at IS NOT NULL AND submitted_by_principal_id IS NOT NULL AND assigned_officer_principal_id IS NOT NULL)
          OR (status = 'DECIDED' AND outcome = 'REJECTED' AND decided_by_principal_id IS NOT NULL AND decided_at IS NOT NULL AND submitted_by_principal_id IS NOT NULL AND assigned_officer_principal_id IS NOT NULL AND decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0)
        ),
        CONSTRAINT chk_customer_physical_verification_separation CHECK (
          decided_by_principal_id IS NULL OR
          (assigned_officer_principal_id IS NOT NULL AND submitted_by_principal_id IS NOT NULL
            AND decided_by_principal_id <> assigned_officer_principal_id
            AND decided_by_principal_id <> submitted_by_principal_id)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_physical_verifications_customer_address_created
        ON customer_physical_address_verifications (customer_id, residential_address_id, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE customer_physical_address_verification_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        verification_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        action VARCHAR(32) NOT NULL,
        previous_status VARCHAR(24),
        new_status VARCHAR(24),
        previous_outcome VARCHAR(24),
        new_outcome VARCHAR(24),
        actor_principal_id VARCHAR(160) NOT NULL,
        actor_role_key VARCHAR(100) NOT NULL,
        reason VARCHAR(1000),
        metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_customer_physical_verification_history_record
          FOREIGN KEY (verification_id, customer_id)
          REFERENCES customer_physical_address_verifications(id, customer_id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_physical_verification_history_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_physical_verification_history_action CHECK (
          action IN ('ASSIGNED', 'VISIT_RECORDED', 'FINDINGS_SUBMITTED', 'VERIFIED', 'REJECTED')
        ),
        CONSTRAINT chk_customer_physical_verification_history_status CHECK (
          (previous_status IS NULL OR previous_status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED'))
          AND (new_status IS NULL OR new_status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DECIDED'))
        ),
        CONSTRAINT chk_customer_physical_verification_history_outcome CHECK (
          (previous_outcome IS NULL OR previous_outcome IN ('PENDING', 'VERIFIED', 'REJECTED'))
          AND (new_outcome IS NULL OR new_outcome IN ('PENDING', 'VERIFIED', 'REJECTED'))
        ),
        CONSTRAINT chk_customer_physical_verification_history_action_state CHECK (
          (action = 'ASSIGNED' AND new_status = 'ASSIGNED' AND new_outcome = 'PENDING')
          OR (action = 'VISIT_RECORDED' AND new_status = 'IN_PROGRESS' AND new_outcome = 'PENDING')
          OR (action = 'FINDINGS_SUBMITTED' AND new_status = 'SUBMITTED' AND new_outcome = 'PENDING')
          OR (action = 'VERIFIED' AND previous_status = 'SUBMITTED' AND new_status = 'DECIDED' AND previous_outcome = 'PENDING' AND new_outcome = 'VERIFIED')
          OR (action = 'REJECTED' AND previous_status = 'SUBMITTED' AND new_status = 'DECIDED' AND previous_outcome = 'PENDING' AND new_outcome = 'REJECTED')
        ),
        CONSTRAINT chk_customer_physical_verification_history_rejection_reason CHECK (
          action <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_customer_physical_verification_history_record_created
        ON customer_physical_address_verification_history (verification_id, created_at)
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_customer_evidence_history_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Customer evidence decision history is append-only'
          USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_customer_poa_decision_history_immutable
        BEFORE UPDATE OR DELETE ON customer_proof_of_address_decision_history
        FOR EACH ROW EXECUTE FUNCTION prevent_customer_evidence_history_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_customer_physical_verification_history_immutable
        BEFORE UPDATE OR DELETE ON customer_physical_address_verification_history
        FOR EACH ROW EXECUTE FUNCTION prevent_customer_evidence_history_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_customer_physical_verification_history_immutable ON customer_physical_address_verification_history`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_customer_poa_decision_history_immutable ON customer_proof_of_address_decision_history`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_customer_evidence_history_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_physical_address_verification_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_physical_address_verifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_proof_of_address_decision_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_proof_of_address_submissions`);
    await queryRunner.query(
      `ALTER TABLE customer_addresses DROP CONSTRAINT IF EXISTS uq_customer_addresses_id_customer`,
    );
  }
}
