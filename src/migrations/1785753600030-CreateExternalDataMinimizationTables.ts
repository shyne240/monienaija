import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExternalDataMinimizationTables1785753600030 implements MigrationInterface {
  name = 'CreateExternalDataMinimizationTables1785753600030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE external_data_classifications (
        id UUID PRIMARY KEY,
        field_name VARCHAR(200) NOT NULL,
        source_domain VARCHAR(80) NOT NULL,
        level VARCHAR(24) NOT NULL,
        owner VARCHAR(160) NOT NULL,
        secret_category VARCHAR(80),
        retention_days INTEGER NOT NULL DEFAULT 365,
        hold_support BOOLEAN NOT NULL DEFAULT TRUE,
        audience_maximums JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_external_data_classifications_field UNIQUE (field_name),
        CONSTRAINT chk_external_data_classifications_field CHECK (field_name ~ '^[\\x20-\\x7E]{1,200}$'),
        CONSTRAINT chk_external_data_classifications_source_domain CHECK (source_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,79}$'),
        CONSTRAINT chk_external_data_classifications_owner CHECK (owner ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_data_classifications_secret_none CHECK (secret_category IS NULL OR level = 'HIGHLY_RESTRICTED'),
        CONSTRAINT chk_external_data_classifications_level CHECK (level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')),
        CONSTRAINT chk_external_data_classifications_retention_days CHECK (retention_days >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_data_classifications_level
        ON external_data_classifications (level)
    `);

    await queryRunner.query(`
      CREATE TABLE external_consent_assertions (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL,
        source VARCHAR(40) NOT NULL,
        target_id UUID NOT NULL,
        target_version INTEGER NOT NULL,
        purpose VARCHAR(80) NOT NULL,
        jurisdiction VARCHAR(2) NOT NULL,
        mandate_reference VARCHAR(160) NOT NULL,
        mandate_version INTEGER NOT NULL,
        granted_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        granted_by VARCHAR(160) NOT NULL,
        revocable BOOLEAN NOT NULL DEFAULT TRUE,
        revoked_at TIMESTAMPTZ,
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_external_consent_assertions_source CHECK (source IN ('CUSTOMER_BENEFICIARY', 'CUSTOMER_FUNDING_INSTRUMENT', 'EXTERNAL_TARGET', 'DERIVED')),
        CONSTRAINT chk_external_consent_assertions_status CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'INVALID')),
        CONSTRAINT chk_external_consent_assertions_purpose CHECK (purpose ~ '^[A-Z_]{3,80}$'),
        CONSTRAINT chk_external_consent_assertions_jurisdiction CHECK (jurisdiction ~ '^[A-Z]{2}$'),
        CONSTRAINT chk_external_consent_assertions_mandate CHECK (mandate_reference ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_consent_assertions_granted_by CHECK (granted_by ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_consent_assertions_target_version CHECK (target_version > 0),
        CONSTRAINT chk_external_consent_assertions_mandate_version CHECK (mandate_version > 0),
        CONSTRAINT chk_external_consent_assertions_revocable CHECK (revocable IN (true, false)),
        CONSTRAINT chk_external_consent_assertions_revoke_state CHECK ((revoked_at IS NULL) OR (revoked_at IS NOT NULL AND status = 'REVOKED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_consent_assertions_customer
        ON external_consent_assertions (customer_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_consent_assertions_target
        ON external_consent_assertions (source, target_id, target_version)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_consent_assertions_status
        ON external_consent_assertions (status)
    `);

    await queryRunner.query(`
      CREATE TABLE external_retention_classifications (
        id UUID PRIMARY KEY,
        dataset VARCHAR(120) NOT NULL,
        level VARCHAR(24) NOT NULL,
        owner VARCHAR(160) NOT NULL,
        retention_days INTEGER NOT NULL,
        hold_support BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_external_retention_classifications_dataset UNIQUE (dataset),
        CONSTRAINT chk_external_retention_classifications_dataset CHECK (dataset ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$'),
        CONSTRAINT chk_external_retention_classifications_owner CHECK (owner ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_retention_classifications_level CHECK (level IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED')),
        CONSTRAINT chk_external_retention_classifications_retention_days CHECK (retention_days >= 0),
        CONSTRAINT chk_external_retention_classifications_secret_retention CHECK (level <> 'HIGHLY_RESTRICTED' OR retention_days >= 365),
        CONSTRAINT chk_external_retention_classifications_hold_support CHECK (level IN ('RESTRICTED', 'HIGHLY_RESTRICTED') OR hold_support = true)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE external_legal_hold_records (
        id UUID PRIMARY KEY,
        scope VARCHAR(40) NOT NULL,
        reference_id UUID NOT NULL,
        owner VARCHAR(160) NOT NULL,
        authority VARCHAR(24) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        imposed_at TIMESTAMPTZ NOT NULL,
        imposed_by VARCHAR(160) NOT NULL,
        released_at TIMESTAMPTZ,
        released_by VARCHAR(160),
        notes VARCHAR(255),
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_external_legal_hold_scope CHECK (scope IN ('EXTERNAL_OPERATION', 'EXTERNAL_REFERENCE', 'EXTERNAL_CALLBACK', 'EXTERNAL_SETTLEMENT', 'EXTERNAL_SUSPENSE', 'EXTERNAL_AUDIT', 'EXTERNAL_OUTBOX', 'EXTERNAL_IDEMPOTENCY', 'EXTERNAL_DATA_CLASSIFICATION', 'EXTERNAL_CONSENT', 'EXTERNAL_DISCLOSURE', 'EXTERNAL_SUPPORT_TRACE', 'EXTERNAL_SECRET')),
        CONSTRAINT chk_external_legal_hold_authority CHECK (authority IN ('LEGAL', 'REGULATORY', 'INVESTIGATION', 'SECURITY', 'FRAUD', 'DISPUTE', 'FINANCIAL_CONTROL')),
        CONSTRAINT chk_external_legal_hold_status CHECK (status IN ('ACTIVE', 'RELEASED')),
        CONSTRAINT chk_external_legal_hold_owner CHECK (owner ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_legal_hold_reason CHECK (reason ~ '^[\\x20-\\x7E]{1,255}$'),
        CONSTRAINT chk_external_legal_hold_imposed_by CHECK (imposed_by ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_legal_hold_released_by CHECK (released_by IS NULL OR released_by ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_legal_hold_release_state CHECK ((status = 'ACTIVE' AND released_at IS NULL AND released_by IS NULL) OR (status = 'RELEASED' AND released_at IS NOT NULL AND released_by IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_legal_hold_scope_reference
        ON external_legal_hold_records (scope, reference_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_legal_hold_status
        ON external_legal_hold_records (status)
    `);

    await queryRunner.query(`
      CREATE TABLE external_secret_classifications (
        id UUID PRIMARY KEY,
        category VARCHAR(40) NOT NULL,
        owner VARCHAR(160) NOT NULL,
        reference VARCHAR(160) NOT NULL,
        notes VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_external_secret_classifications_category CHECK (category IN ('PARTNER_CLIENT_AUTHENTICATION', 'PARTNER_REQUEST_SIGNING_KEY', 'CALLBACK_SECRET', 'CALLBACK_SIGNATURE', 'PRIVATE_KEY', 'CUSTOMER_PIN', 'CUSTOMER_OTP', 'DEVICE_FINGERPRINT_RAW', 'RISK_NARRATIVE_RAW', 'COMPLIANCE_CASE_RAW')),
        CONSTRAINT chk_external_secret_classifications_owner CHECK (owner ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_secret_classifications_reference CHECK (reference ~ '^[\\x20-\\x7E]{1,160}$'),
        CONSTRAINT chk_external_secret_classifications_notes CHECK (notes IS NULL OR notes ~ '^[\\x20-\\x7E]{1,255}$')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_external_secret_classifications_category
        ON external_secret_classifications (category)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_secret_classifications_category`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_secret_classifications`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_legal_hold_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_legal_hold_scope_reference`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_legal_hold_records`);

    await queryRunner.query(`DROP TABLE IF EXISTS external_retention_classifications`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_consent_assertions_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_consent_assertions_target`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_consent_assertions_customer`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_consent_assertions`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_external_data_classifications_level`);
    await queryRunner.query(`DROP TABLE IF EXISTS external_data_classifications`);
  }
}
