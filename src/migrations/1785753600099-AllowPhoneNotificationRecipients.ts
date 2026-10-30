import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowPhoneNotificationRecipients1785753600099 implements MigrationInterface {
  name = 'AllowPhoneNotificationRecipients1785753600099';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Phone recipients allow transactional messages to unregistered beneficiaries; UUID-based
    // customer/agent IDs remain unchanged. Keep event/recipient/channel idempotency intact.
    await queryRunner.query(
      `ALTER TABLE notification_deliveries DROP CONSTRAINT chk_notification_deliveries_recipient_type`,
    );
    await queryRunner.query(
      `ALTER TABLE notification_deliveries ALTER COLUMN recipient_id TYPE VARCHAR(255) USING recipient_id::text`,
    );
    await queryRunner.query(`ALTER TABLE notification_deliveries
      ADD CONSTRAINT chk_notification_deliveries_recipient_type
      CHECK (recipient_type IN ('CUSTOMER', 'AGENT', 'PHONE'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM notification_deliveries WHERE recipient_type = 'PHONE') THEN
        RAISE EXCEPTION 'Cannot revert phone notification recipients while phone deliveries exist';
      END IF;
    END $$`);
    await queryRunner.query(
      `ALTER TABLE notification_deliveries DROP CONSTRAINT chk_notification_deliveries_recipient_type`,
    );
    await queryRunner.query(
      `ALTER TABLE notification_deliveries ALTER COLUMN recipient_id TYPE UUID USING recipient_id::uuid`,
    );
    await queryRunner.query(`ALTER TABLE notification_deliveries
      ADD CONSTRAINT chk_notification_deliveries_recipient_type
      CHECK (recipient_type IN ('CUSTOMER', 'AGENT'))`);
  }
}
