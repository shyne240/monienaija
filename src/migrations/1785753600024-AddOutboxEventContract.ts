import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxEventContract1785753600024 implements MigrationInterface {
  name = 'AddOutboxEventContract1785753600024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE outbox_events
        ADD COLUMN event_key VARCHAR(180),
        ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN classification VARCHAR(80) NOT NULL DEFAULT 'INTERNAL_OPERATIONS',
        ADD COLUMN retention_class VARCHAR(80) NOT NULL DEFAULT 'OPERATIONS_DEFAULT',
        ADD COLUMN occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN correlation_id VARCHAR(255),
        ADD COLUMN causation_id VARCHAR(255),
        ADD CONSTRAINT chk_outbox_events_schema_version CHECK (schema_version > 0)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_outbox_events_event_key
        ON outbox_events (event_key)
       WHERE event_key IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_outbox_payload_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.event_type IS DISTINCT FROM NEW.event_type
           OR OLD.aggregate_type IS DISTINCT FROM NEW.aggregate_type
           OR OLD.aggregate_id IS DISTINCT FROM NEW.aggregate_id
           OR OLD.event_key IS DISTINCT FROM NEW.event_key
           OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
           OR OLD.classification IS DISTINCT FROM NEW.classification
           OR OLD.retention_class IS DISTINCT FROM NEW.retention_class
           OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
           OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id
           OR OLD.causation_id IS DISTINCT FROM NEW.causation_id
           OR OLD.payload IS DISTINCT FROM NEW.payload
        THEN
          RAISE EXCEPTION 'Outbox event identity and facts are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_outbox_events_event_key`);
    await queryRunner.query(`
      ALTER TABLE outbox_events
        DROP CONSTRAINT IF EXISTS chk_outbox_events_schema_version,
        DROP COLUMN IF EXISTS causation_id,
        DROP COLUMN IF EXISTS correlation_id,
        DROP COLUMN IF EXISTS occurred_at,
        DROP COLUMN IF EXISTS retention_class,
        DROP COLUMN IF EXISTS classification,
        DROP COLUMN IF EXISTS schema_version,
        DROP COLUMN IF EXISTS event_key
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION reject_outbox_payload_mutation()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.event_type <> NEW.event_type
           OR OLD.aggregate_type <> NEW.aggregate_type
           OR OLD.aggregate_id <> NEW.aggregate_id
           OR OLD.payload <> NEW.payload THEN
          RAISE EXCEPTION 'Outbox event facts are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
  }
}
