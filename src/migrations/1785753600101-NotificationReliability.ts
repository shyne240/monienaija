import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Independent notification subscription and fenced delivery attempts; no shared outbox state is changed. */
export class NotificationReliability1785753600101 implements MigrationInterface {
  name = 'NotificationReliability1785753600101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Receipts deliberately have no cascading FK: a shared-outbox retention operation must not
    // silently erase the notification consumer's independent acknowledgement/diagnostic record.
    await queryRunner.query(`
      CREATE TABLE notification_outbox_receipts (
        consumer_name VARCHAR(80) NOT NULL,
        outbox_event_id UUID NOT NULL,
        status VARCHAR(24) NOT NULL,
        reason VARCHAR(80),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (consumer_name, outbox_event_id),
        CONSTRAINT chk_notification_outbox_receipt_status CHECK
          (status IN ('MATERIALIZED', 'SUPPRESSED', 'UNSUPPORTED', 'QUARANTINED', 'FAILED'))
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_notification_outbox_receipts_retry
      ON notification_outbox_receipts (consumer_name, status, next_attempt_at)`);

    await queryRunner.query(`ALTER TABLE notification_deliveries DROP CONSTRAINT chk_notification_deliveries_status`);
    await queryRunner.query(`ALTER TABLE notification_deliveries ADD CONSTRAINT chk_notification_deliveries_status
      CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'DEAD'))`);
    await queryRunner.query(`ALTER TABLE notification_deliveries
      ALTER COLUMN message TYPE VARCHAR(4000),
      ADD COLUMN rendered_subject VARCHAR(200),
      ADD COLUMN rendered_html TEXT,
      ADD COLUMN lease_token UUID,
      ADD COLUMN lease_expires_at TIMESTAMPTZ,
      ADD COLUMN next_attempt_at TIMESTAMPTZ`);
    await queryRunner.query(`CREATE INDEX idx_notification_delivery_recovery
      ON notification_deliveries (status, next_attempt_at, lease_expires_at, created_at)
      WHERE status IN ('PENDING', 'FAILED')`);
    await queryRunner.query(`
      CREATE TABLE notification_delivery_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_id UUID NOT NULL REFERENCES notification_deliveries(id) ON DELETE RESTRICT,
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        lease_token UUID NOT NULL,
        status VARCHAR(24) NOT NULL CHECK
          (status IN ('CLAIMED', 'STARTED', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'SUPPRESSED')),
        reason VARCHAR(80),
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        UNIQUE (delivery_id, attempt_number),
        UNIQUE (lease_token)
      )
    `);

    // A pre-upgrade PENDING row might already have reached a provider before the old status
    // write failed; a legacy FAILED row might represent an ambiguous timeout. Do not replay
    // either automatically. Likewise, old PUBLISHED outbox events cannot be assumed to have
    // been correctly materialized by the former shared-status consumer. Preserve them as
    // explicit, operator-reconcilable quarantines instead of silently resending or discarding.
    await queryRunner.query(`UPDATE notification_deliveries
      SET status='UNKNOWN', last_error='LEGACY_DELIVERY_OUTCOME_UNKNOWN', updated_at=NOW()
      WHERE status IN ('PENDING', 'FAILED')`);
    await queryRunner.query(`INSERT INTO notification_outbox_receipts
      (consumer_name, outbox_event_id, status, reason, attempts)
      SELECT 'notification.v1', id, 'QUARANTINED', 'LEGACY_PUBLISHED_UNVERIFIED', 0
      FROM outbox_events WHERE status='PUBLISHED'`);
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    // Reverting would discard durable acknowledgements/attempt evidence and reinterpret UNKNOWN
    // sends under unsafe legacy semantics. Recovery requires a forward migration, not a rollback.
    void queryRunner;
    return Promise.reject(new Error('Notification reliability migration is forward-only'));
  }
}
