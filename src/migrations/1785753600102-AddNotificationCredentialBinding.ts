import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive H-07 metadata only. Existing records are intentionally left unbound: no
 * credential or approval is silently upgraded. Migration 100 is never rewritten.
 */
export class AddNotificationCredentialBinding1785753600102 implements MigrationInterface {
  name = 'AddNotificationCredentialBinding1785753600102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification_provider_configurations
        ADD COLUMN credential_binding_scheme VARCHAR(32),
        ADD COLUMN credential_binding_key_version VARCHAR(64),
        ADD COLUMN credential_binding_mac VARCHAR(64),
        ADD CONSTRAINT chk_notif_provider_cfg_binding CHECK (
          (credential_binding_scheme IS NULL AND credential_binding_key_version IS NULL
            AND credential_binding_mac IS NULL)
          OR (credential_binding_scheme IS NOT NULL
            AND credential_binding_key_version IS NOT NULL AND credential_binding_mac IS NOT NULL
            AND credential_binding_scheme = 'HMAC_SHA256_V1'
            AND credential_binding_key_version ~ '^[A-Za-z0-9._-]{1,64}$'
            AND credential_binding_mac ~ '^[a-f0-9]{64}$'
            AND credential_source IN ('ENV_SECRET', 'ENCRYPTED_DB'))
        )
    `);
    await queryRunner.query(`
      ALTER TABLE notification_provider_config_proposals
        ADD COLUMN action_fingerprint_version SMALLINT,
        ADD COLUMN proposed_credential_source VARCHAR(32),
        ADD COLUMN credential_binding_scheme VARCHAR(32),
        ADD COLUMN credential_binding_key_version VARCHAR(64),
        ADD COLUMN credential_binding_mac VARCHAR(64),
        ADD CONSTRAINT chk_notif_provider_prop_fingerprint_version CHECK (
          action_fingerprint_version IS NULL OR action_fingerprint_version = 2
        ),
        ADD CONSTRAINT chk_notif_provider_prop_binding CHECK (
          (credential_binding_scheme IS NULL AND credential_binding_key_version IS NULL
            AND credential_binding_mac IS NULL
            AND (proposed_credential_source IS NULL OR proposed_credential_source = 'NONE'))
          OR (credential_binding_scheme IS NOT NULL
            AND credential_binding_key_version IS NOT NULL AND credential_binding_mac IS NOT NULL
            AND proposed_credential_source IS NOT NULL
            AND credential_binding_scheme = 'HMAC_SHA256_V1'
            AND credential_binding_key_version ~ '^[A-Za-z0-9._-]{1,64}$'
            AND credential_binding_mac ~ '^[a-f0-9]{64}$'
            AND proposed_credential_source IN ('ENV_SECRET', 'ENCRYPTED_DB'))
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping these checks while provider records exist would restore the old unchecked
    // runtime. Rollback is intentionally refused until a separately governed teardown.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM notification_provider_configurations)
           OR EXISTS (SELECT 1 FROM notification_provider_config_proposals) THEN
          RAISE EXCEPTION 'Refusing credential-binding rollback while provider governance records exist';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE notification_provider_config_proposals
        DROP CONSTRAINT chk_notif_provider_prop_binding,
        DROP CONSTRAINT chk_notif_provider_prop_fingerprint_version,
        DROP COLUMN credential_binding_mac,
        DROP COLUMN credential_binding_key_version,
        DROP COLUMN credential_binding_scheme,
        DROP COLUMN proposed_credential_source,
        DROP COLUMN action_fingerprint_version
    `);
    await queryRunner.query(`
      ALTER TABLE notification_provider_configurations
        DROP CONSTRAINT chk_notif_provider_cfg_binding,
        DROP COLUMN credential_binding_mac,
        DROP COLUMN credential_binding_key_version,
        DROP COLUMN credential_binding_scheme
    `);
  }
}
