import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOperationalResilience1785753600005 implements MigrationInterface {
  name = 'CreateOperationalResilience1785753600005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE idempotency_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope VARCHAR(120) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL,
        response_status_code SMALLINT,
        response_body JSONB,
        resource_type VARCHAR(80),
        resource_id UUID,
        hit_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_idempotency_records_scope_key UNIQUE (scope, idempotency_key),
        CONSTRAINT chk_idempotency_records_status CHECK (
          status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')
        ),
        CONSTRAINT chk_idempotency_records_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_idempotency_records_hits CHECK (hit_count >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_idempotency_records_expires ON idempotency_records (expires_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE audit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type VARCHAR(80) NOT NULL,
        entity_id UUID NOT NULL,
        action VARCHAR(80) NOT NULL,
        actor VARCHAR(160) NOT NULL,
        correlation_id VARCHAR(255),
        request_id VARCHAR(255),
        previous_values JSONB,
        new_values JSONB,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_audit_events_entity_time
         ON audit_events (entity_type, entity_id, occurred_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_events_correlation
         ON audit_events (correlation_id, occurred_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(120) NOT NULL,
        aggregate_type VARCHAR(80) NOT NULL,
        aggregate_id UUID NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(20) NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error VARCHAR(255),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_outbox_events_status CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
        CONSTRAINT chk_outbox_events_attempts CHECK (attempts >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_outbox_events_pending
         ON outbox_events (status, available_at, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_outbox_events_aggregate
         ON outbox_events (aggregate_type, aggregate_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE operational_metrics (
        metric_name VARCHAR(120) PRIMARY KEY,
        value BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_operational_metrics_value CHECK (value >= 0)
      )
    `);

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
    await queryRunner.query(`
      CREATE TRIGGER audit_events_are_immutable
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation()
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
    await queryRunner.query(`
      CREATE TRIGGER outbox_event_facts_are_immutable
      BEFORE UPDATE ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION reject_outbox_payload_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS outbox_event_facts_are_immutable ON outbox_events`,
    );
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_events_are_immutable ON audit_events`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_outbox_payload_mutation()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_audit_event_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS operational_metrics`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_records`);
  }
}
