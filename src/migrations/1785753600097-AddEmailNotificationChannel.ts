import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA3-NOTIFICATION-EMAIL — widen notification_deliveries.channel to accept 'EMAIL'.
 *
 * Additive only: the CHECK constraint is replaced in place (same name), existing SMS/PUSH
 * rows are untouched, and no column/type changes occur. The entity @Check in
 * notification-delivery.entity.ts is kept in sync.
 *
 * Down refuses when EMAIL delivery rows exist — rolling back the constraint would orphan
 * delivery evidence (idempotency keys, provider refs, audit trail). Same discipline as the
 * cash-to-cash locator migration: never destroy delivery history to satisfy a downgrade.
 */
export class AddEmailNotificationChannel1785753600097 implements MigrationInterface {
  name = 'AddEmailNotificationChannel1785753600097';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE notification_deliveries
      DROP CONSTRAINT chk_notification_deliveries_channel`);
    await queryRunner.query(`ALTER TABLE notification_deliveries
      ADD CONSTRAINT chk_notification_deliveries_channel
      CHECK (channel IN ('SMS', 'PUSH', 'EMAIL'))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // EMAIL rows are delivery evidence (unique idempotency identity + provider refs).
    // Restoring the narrower CHECK would either fail on existing rows or require deleting
    // them — refuse instead.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM notification_deliveries WHERE channel = 'EMAIL') THEN
        RAISE EXCEPTION 'Cannot remove EMAIL notification channel while EMAIL delivery rows exist';
      END IF;
    END $$`);
    await queryRunner.query(`ALTER TABLE notification_deliveries
      DROP CONSTRAINT chk_notification_deliveries_channel`);
    await queryRunner.query(`ALTER TABLE notification_deliveries
      ADD CONSTRAINT chk_notification_deliveries_channel
      CHECK (channel IN ('SMS', 'PUSH'))`);
  }
}
