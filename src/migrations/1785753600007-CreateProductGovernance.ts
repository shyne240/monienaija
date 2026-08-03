import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductGovernance1785753600007 implements MigrationInterface {
  name = 'CreateProductGovernance1785753600007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE product_governance_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind VARCHAR(40) NOT NULL,
        record_key VARCHAR(160) NOT NULL,
        name VARCHAR(200) NOT NULL,
        status VARCHAR(30) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        parent_id UUID,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        immutable_record BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_product_governance_kind_key_version UNIQUE (kind, record_key, version),
        CONSTRAINT chk_product_governance_kind CHECK (kind IN (
          'PRODUCT_PROFILE', 'PRODUCT_REQUIREMENT', 'PRODUCT_SCOPE', 'LAUNCH_ENVELOPE',
          'SUPPORTED_COUNTRY', 'SUPPORTED_CURRENCY', 'PILOT_COHORT', 'CUSTOMER_SEGMENT',
          'REGULATORY_JURISDICTION', 'REGULATORY_REQUIREMENT', 'BUSINESS_CAPABILITY',
          'FEATURE', 'FEATURE_FLAG', 'LAUNCH_GATE', 'GONO_GO_CRITERION', 'PRODUCT_RISK',
          'OPERATIONAL_OWNER', 'PARTNER', 'PARTNER_EVALUATION', 'SERVICE_LEVEL_OBJECTIVE',
          'SERVICE_LEVEL_INDICATOR', 'ROLLBACK_STRATEGY', 'SUCCESS_METRIC',
          'PRODUCT_CONFIGURATION', 'LAUNCH_CHECKLIST', 'PRODUCT_VERSION_METADATA'
        )),
        CONSTRAINT chk_product_governance_status CHECK (status IN (
          'DRAFT', 'ACTIVE', 'APPROVED', 'BLOCKED', 'COMPLETE', 'DEPRECATED'
        )),
        CONSTRAINT chk_product_governance_version CHECK (version > 0),
        CONSTRAINT chk_product_governance_key CHECK (length(record_key) > 0),
        CONSTRAINT chk_product_governance_actor CHECK (length(created_by) > 0 AND length(updated_by) > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_product_governance_kind_status
         ON product_governance_records (kind, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_product_governance_parent
         ON product_governance_records (parent_id)`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_product_governance_immutability()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR OLD.immutable_record THEN
          RAISE EXCEPTION 'Immutable product governance records cannot be changed'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER product_governance_records_are_immutable
      BEFORE UPDATE OR DELETE ON product_governance_records
      FOR EACH ROW EXECUTE FUNCTION enforce_product_governance_immutability()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS product_governance_records_are_immutable ON product_governance_records`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_product_governance_immutability()`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_governance_records`);
  }
}
