import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCapabilityPolicyPersistence1785753600022 implements MigrationInterface {
  name = 'CreateCapabilityPolicyPersistence1785753600022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE policy_profile_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_reference VARCHAR(160) NOT NULL,
        profile_key VARCHAR(160) NOT NULL,
        profile_version INTEGER NOT NULL,
        policy_version VARCHAR(160) NOT NULL,
        definition_hash CHAR(64) NOT NULL,
        capability VARCHAR(128) NOT NULL,
        actions JSONB NOT NULL,
        subject_type VARCHAR(20) NOT NULL,
        contract_name VARCHAR(80) NOT NULL,
        contract_version INTEGER NOT NULL,
        profile_contract_version INTEGER NOT NULL,
        record_version INTEGER NOT NULL DEFAULT 1,
        definition_payload JSONB NOT NULL,
        effective_from TIMESTAMPTZ NOT NULL,
        effective_to TIMESTAMPTZ,
        lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        created_by VARCHAR(160) NOT NULL,
        published_at TIMESTAMPTZ,
        published_by VARCHAR(160),
        retired_at TIMESTAMPTZ,
        retired_by VARCHAR(160),
        last_correlation_id VARCHAR(255),
        last_request_id VARCHAR(255),
        retention_class VARCHAR(64) NOT NULL DEFAULT 'A4_POLICY_HISTORY',
        legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
        retention_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_policy_profile_versions_profile_version CHECK (profile_version > 0),
        CONSTRAINT chk_policy_profile_versions_definition_hash CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_policy_profile_versions_effective_interval CHECK (
          effective_to IS NULL OR effective_to > effective_from
        ),
        CONSTRAINT chk_policy_profile_versions_lifecycle CHECK (
          lifecycle_state IN ('DRAFT', 'ACTIVE', 'RETIRED', 'REJECTED', 'ABANDONED')
        ),
        CONSTRAINT chk_policy_profile_versions_subject CHECK (subject_type = 'CUSTOMER'),
        CONSTRAINT chk_policy_profile_versions_record_version CHECK (record_version > 0),
        CONSTRAINT chk_policy_profile_versions_created_by CHECK (length(created_by) > 0)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE policy_profile_versions
        ADD CONSTRAINT uq_policy_profile_versions_reference UNIQUE (profile_reference),
        ADD CONSTRAINT uq_policy_profile_versions_key_version UNIQUE (profile_key, profile_version),
        ADD CONSTRAINT uq_policy_profile_versions_policy_version UNIQUE (policy_version)
    `);
    await queryRunner.query(
      `CREATE INDEX idx_policy_profile_versions_capability_action_effective
         ON policy_profile_versions (capability, effective_from, effective_to)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_policy_profile_versions_lifecycle
         ON policy_profile_versions (lifecycle_state, effective_from)`,
    );

    await queryRunner.query(`
      CREATE TABLE immutable_evidence_snapshot_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_reference VARCHAR(180) NOT NULL,
        snapshot_contract_name VARCHAR(80) NOT NULL,
        snapshot_contract_version INTEGER NOT NULL,
        customer_id UUID NOT NULL,
        capability VARCHAR(128) NOT NULL,
        action VARCHAR(64) NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL,
        as_of TIMESTAMPTZ NOT NULL,
        evidence_profile VARCHAR(160) NOT NULL,
        policy_version_hint VARCHAR(160),
        collected_at TIMESTAMPTZ NOT NULL,
        collection_status VARCHAR(20) NOT NULL,
        required_source_classes JSONB NOT NULL,
        freshness_summary JSONB NOT NULL,
        normalized_input_hash CHAR(64) NOT NULL,
        canonicalization_version INTEGER NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        snapshot_payload JSONB NOT NULL,
        retention_class VARCHAR(64) NOT NULL DEFAULT 'A4_EVIDENCE_SNAPSHOT',
        legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
        retention_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_immutable_evidence_snapshots_reference UNIQUE (snapshot_reference),
        CONSTRAINT chk_immutable_evidence_snapshots_input_hash CHECK (
          normalized_input_hash ~ '^[a-f0-9]{64}$'
        ),
        CONSTRAINT chk_immutable_evidence_snapshots_collection_status CHECK (
          collection_status IN ('COMPLETE', 'INCOMPLETE', 'UNAVAILABLE')
        ),
        CONSTRAINT chk_immutable_evidence_snapshots_hash_algorithm CHECK (hash_algorithm = 'SHA-256'),
        CONSTRAINT fk_immutable_evidence_snapshots_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_immutable_evidence_snapshots_hash
         ON immutable_evidence_snapshot_attachments (normalized_input_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_immutable_evidence_snapshots_subject_scope
         ON immutable_evidence_snapshot_attachments (customer_id, capability, action, collected_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE policy_decision_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        decision_reference VARCHAR(180) NOT NULL,
        customer_id UUID NOT NULL,
        capability VARCHAR(128) NOT NULL,
        action VARCHAR(64) NOT NULL,
        profile_reference VARCHAR(160) NOT NULL,
        profile_key VARCHAR(160) NOT NULL,
        profile_version INTEGER NOT NULL,
        policy_version VARCHAR(160) NOT NULL,
        contract_name VARCHAR(80) NOT NULL,
        contract_version INTEGER NOT NULL,
        definition_hash CHAR(64) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        snapshot_reference VARCHAR(180) NOT NULL,
        snapshot_contract_version INTEGER NOT NULL,
        normalized_input_hash CHAR(64) NOT NULL,
        result_hash CHAR(64) NOT NULL,
        decision VARCHAR(20) NOT NULL,
        reason_codes JSONB NOT NULL,
        explanation JSONB NOT NULL,
        obligations JSONB NOT NULL,
        limits JSONB NOT NULL,
        source_references JSONB NOT NULL,
        freshness_summary JSONB NOT NULL,
        collection_status VARCHAR(20) NOT NULL,
        authorization_context_reference VARCHAR(180) NOT NULL,
        target_binding_reference VARCHAR(180),
        requested_at TIMESTAMPTZ NOT NULL,
        evaluated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        review_at TIMESTAMPTZ,
        supersedes_decision_reference VARCHAR(180),
        request_context JSONB NOT NULL,
        created_by VARCHAR(160) NOT NULL,
        retention_class VARCHAR(64) NOT NULL DEFAULT 'A4_POLICY_HISTORY',
        legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
        retention_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_policy_decision_records_reference UNIQUE (decision_reference),
        CONSTRAINT chk_policy_decision_records_definition_hash CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_policy_decision_records_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_policy_decision_records_input_hash CHECK (normalized_input_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_policy_decision_records_result_hash CHECK (result_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_policy_decision_records_decision CHECK (
          decision IN ('ALLOW', 'ALLOW_WITH_LIMITS', 'PENDING_REVIEW', 'DENY', 'SUSPEND')
        ),
        CONSTRAINT chk_policy_decision_records_collection_status CHECK (
          collection_status IN ('COMPLETE', 'INCOMPLETE', 'UNAVAILABLE')
        ),
        CONSTRAINT chk_policy_decision_records_created_by CHECK (length(created_by) > 0),
        CONSTRAINT fk_policy_decision_records_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_policy_decision_records_scope_time
         ON policy_decision_records (customer_id, capability, action, evaluated_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_policy_decision_records_request_hash
         ON policy_decision_records (request_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_policy_decision_records_snapshot_hash
         ON policy_decision_records (normalized_input_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_policy_decision_records_policy_version
         ON policy_decision_records (policy_version, profile_version)`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_immutable_a4_history_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Immutable A4 history cannot be updated or deleted'
          USING ERRCODE = '55000';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER immutable_evidence_snapshot_attachments_are_immutable
      BEFORE UPDATE OR DELETE ON immutable_evidence_snapshot_attachments
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_a4_history_mutation()
    `);
    await queryRunner.query(`
      CREATE TRIGGER policy_decision_records_are_immutable
      BEFORE UPDATE OR DELETE ON policy_decision_records
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_a4_history_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS policy_decision_records_are_immutable ON policy_decision_records`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS immutable_evidence_snapshot_attachments_are_immutable
         ON immutable_evidence_snapshot_attachments`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_immutable_a4_history_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS policy_decision_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS immutable_evidence_snapshot_attachments`);
    await queryRunner.query(`DROP TABLE IF EXISTS policy_profile_versions`);
  }
}
