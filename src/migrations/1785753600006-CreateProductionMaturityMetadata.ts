import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductionMaturityMetadata1785753600006 implements MigrationInterface {
  name = 'CreateProductionMaturityMetadata1785753600006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE governance_metadata (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        application_version VARCHAR(64) NOT NULL,
        migration_head VARCHAR(160) NOT NULL,
        configuration_fingerprint CHAR(64) NOT NULL,
        build_timestamp TIMESTAMPTZ,
        startup_timestamp TIMESTAMPTZ NOT NULL,
        environment VARCHAR(20) NOT NULL,
        api_version VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_governance_metadata_hash CHECK (
          configuration_fingerprint ~ '^[a-f0-9]{64}$'
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_governance_metadata_startup
         ON governance_metadata (startup_timestamp DESC)`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_governance_metadata_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Governance metadata is immutable'
          USING ERRCODE = '55000';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER governance_metadata_is_immutable
      BEFORE UPDATE OR DELETE ON governance_metadata
      FOR EACH ROW EXECUTE FUNCTION reject_governance_metadata_mutation()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND current_setting('app.audit_retention_delete', true) = 'on' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Audit events are immutable outside retention maintenance'
          USING ERRCODE = '55000';
      END;
      $$
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events (created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS governance_metadata_is_immutable ON governance_metadata`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_governance_metadata_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS governance_metadata`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'Audit events are immutable'
          USING ERRCODE = '55000';
      END;
      $$
    `);
  }
}
