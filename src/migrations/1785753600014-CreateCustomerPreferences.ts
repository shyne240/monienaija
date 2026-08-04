import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerPreferences1785753600014 implements MigrationInterface {
  name = 'CreateCustomerPreferences1785753600014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        language_code VARCHAR(2) NOT NULL DEFAULT 'EN',
        theme_code VARCHAR(10) NOT NULL DEFAULT 'SYSTEM',
        notification_email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        notification_sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        notification_push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        notification_in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        security_login_alerts BOOLEAN NOT NULL DEFAULT TRUE,
        security_transaction_alerts BOOLEAN NOT NULL DEFAULT TRUE,
        security_device_registration_alerts BOOLEAN NOT NULL DEFAULT TRUE,
        security_biometric_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_preferences_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_preferences_language CHECK (
          language_code IN ('EN', 'FR', 'HA', 'IG', 'YO')
        ),
        CONSTRAINT chk_customer_preferences_theme CHECK (
          theme_code IN ('SYSTEM', 'LIGHT', 'DARK')
        ),
        CONSTRAINT chk_customer_preferences_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_preferences_active_customer
         ON customer_preferences (customer_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_preferences_customer_updated
         ON customer_preferences (customer_id, updated_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE preference_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        preference_id UUID NOT NULL,
        action VARCHAR(20) NOT NULL,
        previous_values JSONB,
        new_values JSONB,
        actor VARCHAR(160) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_preference_histories_preference
          FOREIGN KEY (preference_id) REFERENCES customer_preferences(id) ON DELETE RESTRICT,
        CONSTRAINT chk_preference_histories_action CHECK (action IN ('CREATED', 'UPDATED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_preference_histories_preference_created
         ON preference_histories (preference_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS preference_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_preferences`);
  }
}
