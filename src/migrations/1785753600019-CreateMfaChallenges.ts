import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMfaChallenges1785753600019 implements MigrationInterface {
  name = 'CreateMfaChallenges1785753600019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mfa_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        enrollment_id UUID NOT NULL,
        method_id UUID NOT NULL,
        session_id UUID NOT NULL,
        challenge_hash VARCHAR(512) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        verified_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_mfa_challenges_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mfa_challenges_enrollment
          FOREIGN KEY (enrollment_id) REFERENCES mfa_enrollments(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mfa_challenges_method
          FOREIGN KEY (method_id) REFERENCES mfa_methods(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mfa_challenges_session
          FOREIGN KEY (session_id) REFERENCES authentication_sessions(id) ON DELETE RESTRICT,
        CONSTRAINT chk_mfa_challenges_status
          CHECK (status IN ('ACTIVE', 'VERIFIED', 'EXPIRED', 'REVOKED')),
        CONSTRAINT chk_mfa_challenges_version
          CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_mfa_challenges_customer_status
         ON mfa_challenges (customer_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_mfa_challenges_expires
         ON mfa_challenges (status, expires_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_mfa_challenges_method
         ON mfa_challenges (method_id, created_at)`,
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
            'MFA_METHOD_ADDED', 'MFA_METHOD_UPDATED', 'TRUSTED_DEVICE_REGISTERED',
            'TRUSTED_DEVICE_UPDATED', 'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED'
          )
        )
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mfa_challenges_method`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mfa_challenges_expires`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mfa_challenges_customer_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS mfa_challenges`);
  }
}
