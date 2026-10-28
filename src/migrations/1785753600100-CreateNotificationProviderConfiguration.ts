import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Governed SMS (Robase) and Transactional Email (Brevo / Resend) Provider Configuration.
 *
 * Additive schema only:
 *   1. `notification_provider_configurations` — active non-secret runtime settings + AES-256-GCM
 *      encrypted credential envelope (`MNNPS1:<version>:<ivB64>:<tagB64>:<ciphertextB64>`),
 *      structural DB CHECK constraints preventing plaintext secret persistence, masked 4-char
 *      key fingerprint (`****xxxx`), and distinct readiness tracking (`verified_at`,
 *      `delivery_tested_at`, domain SPF/DKIM/DMARC attestations).
 *   2. `notification_provider_config_proposals` — maker-checker proposal ledger linked to
 *      `privileged_action_approvals(id)` with a structural DB CHECK constraint prohibiting
 *      self-approval (`decided_by <> proposer_principal_id`).
 *
 * Financial tables, outbox, and `notification_deliveries` are untouched.
 */
export class CreateNotificationProviderConfiguration1785753600100
  implements MigrationInterface
{
  name = 'CreateNotificationProviderConfiguration1785753600100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_provider_configurations (
        channel VARCHAR(16) PRIMARY KEY,
        provider VARCHAR(32) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        base_url VARCHAR(2048),
        request_timeout_ms INTEGER NOT NULL DEFAULT 10000,
        sender_id VARCHAR(64),
        from_email VARCHAR(320),
        from_name VARCHAR(120),
        reply_to_email VARCHAR(320),
        credential_source VARCHAR(32) NOT NULL DEFAULT 'NONE',
        encrypted_api_key TEXT,
        encryption_key_version VARCHAR(64),
        key_fingerprint VARCHAR(16),
        spf_configured BOOLEAN NOT NULL DEFAULT FALSE,
        dkim_configured BOOLEAN NOT NULL DEFAULT FALSE,
        dmarc_configured BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        verified_by VARCHAR(320),
        verification_method VARCHAR(64),
        last_verification_error VARCHAR(128),
        delivery_tested_at TIMESTAMPTZ,
        delivery_tested_by VARCHAR(320),
        last_test_status VARCHAR(32),
        last_test_destination_masked VARCHAR(128),
        last_test_provider_ref VARCHAR(255),
        last_test_error_code VARCHAR(128),
        last_test_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        active_proposal_id UUID,
        updated_by VARCHAR(320) NOT NULL,
        approved_by VARCHAR(320) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_notif_provider_cfg_channel_provider CHECK (
          (channel = 'SMS' AND provider IN ('console', 'robase'))
          OR (channel = 'EMAIL' AND provider IN ('none', 'console', 'brevo', 'resend'))
        ),
        CONSTRAINT chk_notif_provider_cfg_timeout CHECK (
          request_timeout_ms >= 1000 AND request_timeout_ms <= 60000
        ),
        CONSTRAINT chk_notif_provider_cfg_cred_source CHECK (
          credential_source IN ('NONE', 'ENCRYPTED_DB', 'ENV_SECRET')
        ),
        CONSTRAINT chk_notif_provider_cfg_encrypted_envelope CHECK (
          encrypted_api_key IS NULL
          OR encrypted_api_key ~ '^MNNPS1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/=]{8,}$'
        ),
        CONSTRAINT chk_notif_provider_cfg_fingerprint CHECK (
          key_fingerprint IS NULL OR key_fingerprint ~ '^\\*{4}[A-Za-z0-9_-]{4}$'
        ),
        CONSTRAINT chk_notif_provider_cfg_cred_consistency CHECK (
          (credential_source = 'ENCRYPTED_DB'
            AND encrypted_api_key IS NOT NULL
            AND encryption_key_version IS NOT NULL
            AND key_fingerprint IS NOT NULL)
          OR (credential_source IN ('NONE', 'ENV_SECRET')
            AND encrypted_api_key IS NULL
            AND encryption_key_version IS NULL)
        ),
        CONSTRAINT chk_notif_provider_cfg_last_test_status CHECK (
          last_test_status IS NULL
          OR last_test_status IN ('SENT', 'FAILED', 'CONSOLE_SIMULATED')
        ),
        CONSTRAINT chk_notif_provider_cfg_version CHECK (version >= 1)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE notification_provider_config_proposals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel VARCHAR(16) NOT NULL,
        expected_version INTEGER NOT NULL,
        proposed_provider VARCHAR(32) NOT NULL,
        proposed_enabled BOOLEAN NOT NULL,
        proposed_base_url VARCHAR(2048),
        proposed_request_timeout_ms INTEGER NOT NULL DEFAULT 10000,
        proposed_sender_id VARCHAR(64),
        proposed_from_email VARCHAR(320),
        proposed_from_name VARCHAR(120),
        proposed_reply_to_email VARCHAR(320),
        credential_action VARCHAR(32) NOT NULL,
        proposed_encrypted_api_key TEXT,
        proposed_encryption_key_version VARCHAR(64),
        proposed_key_fingerprint VARCHAR(16),
        proposed_spf_configured BOOLEAN NOT NULL DEFAULT FALSE,
        proposed_dkim_configured BOOLEAN NOT NULL DEFAULT FALSE,
        proposed_dmarc_configured BOOLEAN NOT NULL DEFAULT FALSE,
        reason VARCHAR(500) NOT NULL,
        status VARCHAR(24) NOT NULL,
        proposer_principal_id VARCHAR(320) NOT NULL,
        approval_id UUID NOT NULL UNIQUE REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        action_fingerprint VARCHAR(128) NOT NULL,
        decided_by VARCHAR(320),
        decided_at TIMESTAMPTZ,
        decision_reason VARCHAR(500),
        activated_by VARCHAR(320),
        activated_at TIMESTAMPTZ,
        resulting_version INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_notif_provider_prop_channel_provider CHECK (
          (channel = 'SMS' AND proposed_provider IN ('console', 'robase'))
          OR (channel = 'EMAIL' AND proposed_provider IN ('none', 'console', 'brevo', 'resend'))
        ),
        CONSTRAINT chk_notif_provider_prop_expected_version CHECK (expected_version >= 0),
        CONSTRAINT chk_notif_provider_prop_timeout CHECK (
          proposed_request_timeout_ms >= 1000 AND proposed_request_timeout_ms <= 60000
        ),
        CONSTRAINT chk_notif_provider_prop_cred_action CHECK (
          credential_action IN ('KEEP_EXISTING', 'SET_ENCRYPTED', 'USE_ENV_SECRET', 'CLEAR')
        ),
        CONSTRAINT chk_notif_provider_prop_encrypted_envelope CHECK (
          proposed_encrypted_api_key IS NULL
          OR proposed_encrypted_api_key ~ '^MNNPS1:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/=]{8,}$'
        ),
        CONSTRAINT chk_notif_provider_prop_fingerprint CHECK (
          proposed_key_fingerprint IS NULL
          OR proposed_key_fingerprint ~ '^\\*{4}[A-Za-z0-9_-]{4}$'
        ),
        CONSTRAINT chk_notif_provider_prop_cred_consistency CHECK (
          (credential_action = 'SET_ENCRYPTED'
            AND proposed_encrypted_api_key IS NOT NULL
            AND proposed_encryption_key_version IS NOT NULL
            AND proposed_key_fingerprint IS NOT NULL)
          OR (credential_action IN ('KEEP_EXISTING', 'USE_ENV_SECRET', 'CLEAR')
            AND proposed_encrypted_api_key IS NULL
            AND proposed_encryption_key_version IS NULL)
        ),
        CONSTRAINT chk_notif_provider_prop_status CHECK (
          status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'ACTIVATED')
        ),
        CONSTRAINT chk_notif_provider_prop_no_self_approval CHECK (
          decided_by IS NULL OR decided_by <> proposer_principal_id
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_notif_provider_proposals_channel_created
        ON notification_provider_config_proposals (channel, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_notif_provider_proposals_status_created
        ON notification_provider_config_proposals (status, created_at DESC)
    `);

    // Backfill catalogue functions + role assignments on already-seeded databases; no-op on
    // brand-new databases where AuthorizationCatalogueSeedService has not run yet.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM authorization_roles WHERE is_system_seeded = TRUE) THEN
          INSERT INTO authorization_functions
            (function_code, domain, name, description, sensitivity, v1_status, assignable,
             finance_class_restricted, maker_checker_required, approval_required,
             super_admin_excluded, auditor_visible, notes)
          VALUES
            ('notification.provider.view', 'OPERATIONS',
             'View notification provider configuration',
             'View non-secret SMS and Email provider configuration, masked credential fingerprints, readiness gates, and governed proposals.',
             'READ', 'IMPLEMENTED', TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, NULL),
            ('notification.provider.configure', 'OPERATIONS',
             'Configure notification providers',
             'Propose, independently approve, and activate SMS and Email provider settings, credential rotations, and enablement under maker-checker and MFA.',
             'PRIVILEGED', 'IMPLEMENTED', TRUE, FALSE, TRUE, TRUE, FALSE, TRUE, NULL)
          ON CONFLICT (function_code) DO NOTHING;

          INSERT INTO authorization_role_functions (role_id, function_code, access_type, is_active, assigned_by)
          SELECT r.id, v.function_code, v.access_type, TRUE, 'SYSTEM_SEED'
          FROM (
            VALUES
              ('SUPER_ADMIN', 'notification.provider.view', 'VIEW'),
              ('SUPER_ADMIN', 'notification.provider.configure', 'INITIATE'),
              ('FINANCE_CONTROLLER', 'notification.provider.view', 'VIEW'),
              ('FINANCE_CONTROLLER', 'notification.provider.configure', 'APPROVE'),
              ('FINANCE_AUDITOR', 'notification.provider.view', 'VIEW'),
              ('OPERATIONS', 'notification.provider.view', 'VIEW')
          ) AS v(role_key, function_code, access_type)
          JOIN authorization_roles r ON r.role_key = v.role_key
          ON CONFLICT (role_id, function_code) DO NOTHING;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM notification_provider_configurations)
           OR EXISTS (SELECT 1 FROM notification_provider_config_proposals) THEN
          RAISE EXCEPTION 'Refusing to drop notification provider configuration tables: governed provider records exist';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DELETE FROM authorization_role_functions
      WHERE function_code IN ('notification.provider.view', 'notification.provider.configure')
    `);
    await queryRunner.query(`
      DELETE FROM authorization_functions
      WHERE function_code IN ('notification.provider.view', 'notification.provider.configure')
    `);

    await queryRunner.query(`DROP TABLE notification_provider_config_proposals`);
    await queryRunner.query(`DROP TABLE notification_provider_configurations`);
  }
}
