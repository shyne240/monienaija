import type { MigrationInterface, QueryRunner } from 'typeorm';

import {
  FINANCIAL_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_ORDINARY_DEFAULTS,
  seedNotificationDefaultsV2,
} from '../notification/notification-defaults-v2';

/**
 * Extends the existing governed registry: EVENT is an event-wide control row, not a delivery
 * channel or a second settings system. Existing SMS/EMAIL choices and audit history survive.
 */
export class ConfigureTransactionNotificationEvents1785753600103 implements MigrationInterface {
  name = 'ConfigureTransactionNotificationEvents1785753600103';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE notification_event_configurations
      DROP CONSTRAINT notification_event_configurations_channel_check`);
    await queryRunner.query(`ALTER TABLE notification_event_configurations
      ADD CONSTRAINT notification_event_configurations_channel_check
      CHECK (channel IN ('SMS','EMAIL','EVENT'))`);

    // A legacy/incorrect locked or SECURITY-class financial row must become configurable,
    // without touching real direct-send security events. Disable only this user trigger while
    // applying the owner-approved migration; the transaction also records the old/new state.
    await queryRunner.query(`ALTER TABLE notification_event_configurations DISABLE TRIGGER notification_configuration_guard`);
    for (const eventType of FINANCIAL_NOTIFICATION_EVENT_TYPES) {
      const definition = NOTIFICATION_ORDINARY_DEFAULTS.find((item) => item.eventType === eventType);
      if (!definition) throw new Error('Financial notification definition unavailable');
      const rows = await queryRunner.query(
        `SELECT id, channel, delivery_class, is_locked, is_enabled, version
           FROM notification_event_configurations
          WHERE event_type=$1 AND (is_locked OR delivery_class <> $2) FOR UPDATE`,
        [eventType, definition.kind],
      ) as Array<{ id: string; channel: string; delivery_class: string; is_locked: boolean; is_enabled: boolean; version: number }>;
      for (const row of rows) {
        await queryRunner.query(
          `UPDATE notification_event_configurations SET delivery_class=$1, is_locked=false,
             version=version+1, updated_by='SYSTEM_MIGRATION_0103', updated_at=now() WHERE id=$2`,
          [definition.kind, row.id],
        );
        await queryRunner.query(
          `INSERT INTO audit_events (entity_type,entity_id,action,actor,previous_values,new_values)
           VALUES ('NOTIFICATION_EVENT_CONFIGURATION',$1,'NOTIFICATION_FINANCIAL_LOCK_REMOVED',
             'SYSTEM_MIGRATION_0103',$2::jsonb,$3::jsonb)`,
          [row.id,
            JSON.stringify({ eventType, channel: row.channel, deliveryClass: row.delivery_class, locked: row.is_locked, enabled: row.is_enabled, version: row.version }),
            JSON.stringify({ eventType, channel: row.channel, deliveryClass: definition.kind, locked: false, enabled: row.is_enabled, version: row.version + 1 })],
        );
      }
      // A wrongly SECURITY-classified row could never have an editable template. Restore a
      // safe frozen default only where no template history exists; never replace a version.
      for (const channel of ['SMS', 'EMAIL'] as const) {
        await queryRunner.query(
          `INSERT INTO notification_templates
             (event_type,channel,locale,version,is_active,subject,body,created_by)
           SELECT $1::varchar,$2::varchar,'en-NG',1,true,$3,$4,'SYSTEM_MIGRATION_0103'
            WHERE EXISTS (SELECT 1 FROM notification_event_configurations WHERE event_type=$1::varchar AND channel=$2::varchar)
              AND NOT EXISTS (SELECT 1 FROM notification_templates WHERE event_type=$1::varchar AND channel=$2::varchar AND locale='en-NG')
           ON CONFLICT (event_type,channel,locale,version) DO NOTHING`,
          [eventType, channel, channel === 'EMAIL' ? 'MonieNaija account update' : null, definition.body],
        );
      }
    }
    await queryRunner.query(`ALTER TABLE notification_event_configurations ENABLE TRIGGER notification_configuration_guard`);
    await seedNotificationDefaultsV2(queryRunner);
  }

  down(): Promise<void> {
    // Older binaries cannot enforce an EVENT-wide disable; erasing rows would discard governed
    // choices and could resume delivery. Rollback requires a separately authorized safe plan.
    return Promise.reject(new Error('Refusing notification event-control rollback; preserve governed configuration and fence old senders'));
  }
}
