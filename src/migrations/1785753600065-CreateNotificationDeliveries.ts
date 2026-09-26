import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationDeliveries1785753600065 implements MigrationInterface {
  name = 'CreateNotificationDeliveries1785753600065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // V1-005 Notification Delivery Foundation — provider-neutral dispatch
    // Do NOT create a second event bus/outbox. Reuse existing outbox_events for business events;
    // this table persists per-recipient, per-channel dispatch state (redacted payload, no secrets).
    // Push device-token dependency: destination holds token when available; if no token model exists, status SKIPPED.
    // Customer SMS authoritative source: customer_contact_methods PHONE normalized_value (is_primary).
    // Agent contact: no authoritative phone yet — Agent SMS marked dependency/SKIPPED with documented fallback.

    await queryRunner.query(`
      CREATE TABLE notification_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(180) NOT NULL,
        event_key VARCHAR(180) NOT NULL,
        aggregate_type VARCHAR(80),
        aggregate_id UUID,
        recipient_type VARCHAR(20) NOT NULL,
        recipient_id UUID NOT NULL,
        channel VARCHAR(20) NOT NULL,
        destination VARCHAR(320) NOT NULL,
        payload JSONB NOT NULL,
        message VARCHAR(1000),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        provider_ref VARCHAR(320),
        correlation_id VARCHAR(255),
        causation_id VARCHAR(255),
        last_error VARCHAR(1000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        CONSTRAINT chk_notification_deliveries_channel CHECK (channel IN ('SMS', 'PUSH')),
        CONSTRAINT chk_notification_deliveries_recipient_type CHECK (recipient_type IN ('CUSTOMER', 'AGENT')),
        CONSTRAINT chk_notification_deliveries_status CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
        CONSTRAINT chk_notification_deliveries_attempts CHECK (attempts >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_notification_deliveries_event_recipient_channel
        ON notification_deliveries (event_key, recipient_id, channel)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notification_deliveries_recipient
        ON notification_deliveries (recipient_type, recipient_id, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notification_deliveries_status
        ON notification_deliveries (status, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notification_deliveries_event_type
        ON notification_deliveries (event_type, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notification_deliveries_aggregate
        ON notification_deliveries (aggregate_type, aggregate_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notification_deliveries`);
  }
}
