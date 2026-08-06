import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePrivilegedActionApprovals1785753600020 implements MigrationInterface {
  name = 'CreatePrivilegedActionApprovals1785753600020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE privileged_action_approvals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        action_type VARCHAR(120) NOT NULL,
        resource_type VARCHAR(80) NOT NULL,
        resource_id VARCHAR(255),
        customer_id UUID,
        action_fingerprint CHAR(64) NOT NULL,
        policy JSONB NOT NULL DEFAULT '{}'::jsonb,
        approval_scope VARCHAR(160) NOT NULL,
        required_assurance VARCHAR(20) NOT NULL DEFAULT 'MFA',
        requester_principal_id VARCHAR(160) NOT NULL,
        requester_session_id UUID,
        approved_by VARCHAR(160),
        approver_session_id UUID,
        reason VARCHAR(500) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
        is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
        requested_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        approved_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        consumed_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_privileged_action_approvals_fingerprint
          CHECK (action_fingerprint ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_privileged_action_approvals_status
          CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONSUMED', 'EXPIRED', 'EMERGENCY_ACTIVE', 'EMERGENCY_REVOKED')),
        CONSTRAINT chk_privileged_action_approvals_assurance
          CHECK (required_assurance IN ('PASSWORD', 'MFA')),
        CONSTRAINT chk_privileged_action_approvals_version
          CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_privileged_action_approvals_requester_status
         ON privileged_action_approvals (requester_principal_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_privileged_action_approvals_expires
         ON privileged_action_approvals (status, expires_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_privileged_action_approvals_resource
         ON privileged_action_approvals (resource_type, resource_id)`,
    );

    await queryRunner.query(
      `ALTER TABLE security_event_histories
         DROP CONSTRAINT chk_security_event_histories_type`,
    );
    await queryRunner.query(`
      ALTER TABLE security_event_histories
        ADD CONSTRAINT chk_security_event_histories_type CHECK (
          event_type IN (
            'CREDENTIAL_CREATED', 'CREDENTIAL_UPDATED', 'PASSWORD_ROTATED', 'PASSWORD_EXPIRED',
            'AUTHENTICATION_FAILED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED',
            'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_TOKEN_ISSUED', 'PASSWORD_RESET_TOKEN_UPDATED',
            'PASSWORD_RESET_STATUS_CHANGED', 'MFA_ENROLLMENT_CREATED', 'MFA_ENROLLMENT_UPDATED',
            'MFA_METHOD_ADDED', 'MFA_METHOD_UPDATED', 'MFA_CHALLENGE_ISSUED',
            'MFA_CHALLENGE_FAILED', 'MFA_CHALLENGE_SUCCEEDED', 'TRUSTED_DEVICE_REGISTERED',
            'TRUSTED_DEVICE_UPDATED', 'TRUSTED_DEVICE_CHECKED', 'TRUSTED_DEVICE_REJECTED',
            'PRIVILEGED_ACTION_REQUESTED', 'PRIVILEGED_ACTION_APPROVED',
            'PRIVILEGED_ACTION_REJECTED', 'PRIVILEGED_ACTION_CANCELLED',
            'PRIVILEGED_ACTION_CONSUMED', 'PRIVILEGED_ACTION_EXPIRED',
            'EMERGENCY_ACCESS_ACTIVATED', 'EMERGENCY_ACCESS_REVOKED',
            'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE security_event_histories
         DROP CONSTRAINT chk_security_event_histories_type`,
    );
    await queryRunner.query(`
      ALTER TABLE security_event_histories
        ADD CONSTRAINT chk_security_event_histories_type CHECK (
          event_type IN (
            'CREDENTIAL_CREATED', 'CREDENTIAL_UPDATED', 'PASSWORD_ROTATED', 'PASSWORD_EXPIRED',
            'AUTHENTICATION_FAILED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED',
            'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_TOKEN_ISSUED', 'PASSWORD_RESET_TOKEN_UPDATED',
            'PASSWORD_RESET_STATUS_CHANGED', 'MFA_ENROLLMENT_CREATED', 'MFA_ENROLLMENT_UPDATED',
            'MFA_METHOD_ADDED', 'MFA_METHOD_UPDATED', 'MFA_CHALLENGE_ISSUED',
            'MFA_CHALLENGE_FAILED', 'MFA_CHALLENGE_SUCCEEDED', 'TRUSTED_DEVICE_REGISTERED',
            'TRUSTED_DEVICE_UPDATED', 'TRUSTED_DEVICE_CHECKED', 'TRUSTED_DEVICE_REJECTED',
            'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED'
          )
        )
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_privileged_action_approvals_resource`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_privileged_action_approvals_expires`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_privileged_action_approvals_requester_status`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS privileged_action_approvals`);
  }
}
