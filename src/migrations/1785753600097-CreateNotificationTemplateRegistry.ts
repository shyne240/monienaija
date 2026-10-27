import type { MigrationInterface, QueryRunner } from 'typeorm';
import { seedNotificationDefaultsV1 } from '../notification/notification-defaults-v1';

/** Additive registry only: notification_deliveries, outbox and financial tables are unchanged. */
export class CreateNotificationTemplateRegistry1785753600097 implements MigrationInterface {
  name = 'CreateNotificationTemplateRegistry1785753600097';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_event_configurations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type varchar(180) NOT NULL,
        channel varchar(10) NOT NULL CHECK (channel IN ('SMS','EMAIL')),
        delivery_class varchar(20) NOT NULL CHECK (delivery_class IN ('SECURITY','TRANSACTIONAL','INFORMATIONAL')),
        is_enabled boolean NOT NULL,
        is_locked boolean NOT NULL,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_by varchar(160) NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(event_type, channel),
        CHECK (delivery_class <> 'SECURITY' OR is_locked)
      )`);
    await queryRunner.query(`
      CREATE TABLE notification_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type varchar(180) NOT NULL,
        channel varchar(10) NOT NULL CHECK (channel IN ('SMS','EMAIL')),
        locale varchar(20) NOT NULL CHECK (locale = 'en-NG'),
        version integer NOT NULL CHECK (version > 0),
        is_active boolean NOT NULL DEFAULT true,
        subject varchar(200),
        body text NOT NULL,
        created_by varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (event_type, channel) REFERENCES notification_event_configurations(event_type, channel),
        UNIQUE(event_type, channel, locale, version),
        CHECK ((channel = 'SMS' AND subject IS NULL AND length(body) BETWEEN 1 AND 1000)
            OR (channel = 'EMAIL' AND subject IS NOT NULL AND length(subject) BETWEEN 1 AND 200
                                  AND length(body) BETWEEN 1 AND 4000))
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_notification_template_active
      ON notification_templates(event_type, channel, locale) WHERE is_active`);
    await queryRunner.query(`
      CREATE TABLE notification_change_requests (
        approval_id uuid PRIMARY KEY REFERENCES privileged_action_approvals(id),
        change_type varchar(30) NOT NULL CHECK (change_type IN ('TEMPLATE','TEMPLATE_ROLLBACK','CONFIGURATION')),
        payload jsonb NOT NULL,
        created_by varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`
      CREATE FUNCTION notification_protect_template() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE cls varchar(20);
      BEGIN
        IF TG_OP = 'INSERT' THEN
          SELECT delivery_class INTO cls FROM notification_event_configurations
           WHERE event_type=NEW.event_type AND channel=NEW.channel;
          IF cls IS NULL OR cls = 'SECURITY' THEN
            RAISE EXCEPTION 'Security and unknown events cannot have editable templates';
          END IF;
          RETURN NEW;
        END IF;
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Template history is immutable'; END IF;
        IF OLD.is_active AND NOT NEW.is_active AND
           (NEW.id, NEW.event_type, NEW.channel, NEW.locale, NEW.version, NEW.subject, NEW.body, NEW.created_by, NEW.created_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.event_type, OLD.channel, OLD.locale, OLD.version, OLD.subject, OLD.body, OLD.created_by, OLD.created_at)
        THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Template history is immutable; create a new version';
      END $$`);
    await queryRunner.query(`CREATE TRIGGER notification_template_guard BEFORE INSERT OR UPDATE OR DELETE
      ON notification_templates FOR EACH ROW EXECUTE FUNCTION notification_protect_template()`);
    await queryRunner.query(`
      CREATE FUNCTION notification_protect_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Notification configurations cannot be deleted'; END IF;
        IF OLD.is_locked THEN RAISE EXCEPTION 'Notification configuration is locked'; END IF;
        IF (NEW.id, NEW.event_type, NEW.channel, NEW.delivery_class, NEW.is_locked)
           IS DISTINCT FROM (OLD.id, OLD.event_type, OLD.channel, OLD.delivery_class, OLD.is_locked)
           OR NEW.version <> OLD.version + 1 THEN
          RAISE EXCEPTION 'Invalid notification configuration change';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER notification_configuration_guard BEFORE UPDATE OR DELETE
      ON notification_event_configurations FOR EACH ROW EXECUTE FUNCTION notification_protect_configuration()`);
    await queryRunner.query(`
      CREATE FUNCTION notification_protect_request() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Notification change requests are immutable'; END $$`);
    await queryRunner.query(`CREATE TRIGGER notification_request_guard BEFORE UPDATE OR DELETE
      ON notification_change_requests FOR EACH ROW EXECUTE FUNCTION notification_protect_request()`);
    await seedNotificationDefaultsV1(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Never silently erase live versions, approvals or configuration decisions.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM notification_templates WHERE version > 1)
         OR EXISTS (SELECT 1 FROM notification_event_configurations WHERE version > 1)
         OR EXISTS (SELECT 1 FROM notification_change_requests) THEN
        RAISE EXCEPTION 'Cannot remove notification registry containing governed changes';
      END IF;
    END $$`);
    await queryRunner.query(`DROP TABLE notification_change_requests`);
    await queryRunner.query(`DROP TABLE notification_templates`);
    await queryRunner.query(`DROP TABLE notification_event_configurations`);
    await queryRunner.query(`DROP FUNCTION notification_protect_request()`);
    await queryRunner.query(`DROP FUNCTION notification_protect_template()`);
    await queryRunner.query(`DROP FUNCTION notification_protect_configuration()`);
  }
}
