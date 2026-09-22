import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1 customer transaction PIN.
 *
 * Extends the existing customer authentication credential family with
 * credential_type 'PIN' (one ACTIVE PIN credential per customer, alongside
 * the existing exactly-one PASSWORD credential) and extends the security
 * event vocabulary with PIN_* events. Existing credential rows are
 * preserved: the uniqueness exchange is (customer_id) -> (customer_id,
 * credential_type), which is a strict refinement for the only pre-existing
 * type ('PASSWORD'), so password semantics are unchanged.
 */
export class CreateCustomerTransactionPin1785753600054 implements MigrationInterface {
  name = 'CreateCustomerTransactionPin1785753600054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customer_authentication_credentials
         DROP CONSTRAINT chk_customer_authentication_credentials_type`,
    );
    await queryRunner.query(
      `ALTER TABLE customer_authentication_credentials
         ADD CONSTRAINT chk_customer_authentication_credentials_type CHECK (
           credential_type IN ('PASSWORD', 'PIN')
         )`,
    );

    await queryRunner.query(
      `DROP INDEX uq_customer_authentication_credentials_active_customer`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_authentication_credentials_active_customer
         ON customer_authentication_credentials (customer_id, credential_type)
       WHERE deleted_at IS NULL`,
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
            'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED',
            'PIN_CREATED', 'PIN_CHANGED', 'PIN_VERIFICATION_FAILED', 'PIN_VERIFICATION_SUCCEEDED',
            'PIN_LOCKED', 'PIN_UNLOCKED', 'PIN_RESET_REQUESTED', 'PIN_RESET'
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
            'PRIVILEGED_ACTION_REQUESTED', 'PRIVILEGED_ACTION_APPROVED',
            'PRIVILEGED_ACTION_REJECTED', 'PRIVILEGED_ACTION_CANCELLED',
            'PRIVILEGED_ACTION_CONSUMED', 'PRIVILEGED_ACTION_EXPIRED',
            'EMERGENCY_ACCESS_ACTIVATED', 'EMERGENCY_ACCESS_REVOKED',
            'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED'
          )
        )
    `);

    await queryRunner.query(
      `DROP INDEX uq_customer_authentication_credentials_active_customer`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_authentication_credentials_active_customer
         ON customer_authentication_credentials (customer_id)
       WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE customer_authentication_credentials
         DROP CONSTRAINT chk_customer_authentication_credentials_type`,
    );
    await queryRunner.query(
      `ALTER TABLE customer_authentication_credentials
         ADD CONSTRAINT chk_customer_authentication_credentials_type CHECK (
           credential_type IN ('PASSWORD')
         )`,
    );
  }
}
