import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerAuthentication1785753600015 implements MigrationInterface {
  name = 'CreateCustomerAuthentication1785753600015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_authentication_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        credential_type VARCHAR(20) NOT NULL DEFAULT 'PASSWORD',
        password_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        password_version INTEGER NOT NULL,
        password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        password_expires_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        failed_authentication_count INTEGER NOT NULL DEFAULT 0,
        account_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMPTZ,
        lock_reason VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_authentication_credentials_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_authentication_credentials_type CHECK (credential_type IN ('PASSWORD')),
        CONSTRAINT chk_customer_authentication_credentials_status CHECK (
          status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')
        ),
        CONSTRAINT chk_customer_authentication_credentials_algorithm CHECK (
          hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')
        ),
        CONSTRAINT chk_customer_authentication_credentials_password_version CHECK (password_version > 0),
        CONSTRAINT chk_customer_authentication_credentials_failed_count CHECK (failed_authentication_count >= 0),
        CONSTRAINT chk_customer_authentication_credentials_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_authentication_credentials_active_customer
         ON customer_authentication_credentials (customer_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_authentication_credentials_customer_status
         ON customer_authentication_credentials (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE password_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credential_id UUID NOT NULL,
        password_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        password_version INTEGER NOT NULL,
        action VARCHAR(20) NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_password_histories_credential
          FOREIGN KEY (credential_id) REFERENCES customer_authentication_credentials(id) ON DELETE RESTRICT,
        CONSTRAINT chk_password_histories_algorithm CHECK (
          hash_algorithm IN ('ARGON2ID', 'BCRYPT', 'SCRYPT', 'PBKDF2')
        ),
        CONSTRAINT chk_password_histories_password_version CHECK (password_version > 0),
        CONSTRAINT chk_password_histories_action CHECK (action IN ('CREATED', 'ROTATED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_password_histories_credential_created
         ON password_histories (credential_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE password_reset_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        credential_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
        reason VARCHAR(500),
        requested_by VARCHAR(160) NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_password_reset_requests_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_password_reset_requests_credential
          FOREIGN KEY (credential_id) REFERENCES customer_authentication_credentials(id) ON DELETE RESTRICT,
        CONSTRAINT chk_password_reset_requests_status CHECK (
          status IN ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REJECTED')
        ),
        CONSTRAINT chk_password_reset_requests_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_requests_customer_created
         ON password_reset_requests (customer_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_requests_credential_status
         ON password_reset_requests (credential_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id UUID NOT NULL,
        token_hash VARCHAR(512) NOT NULL,
        token_version INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_password_reset_tokens_request
          FOREIGN KEY (request_id) REFERENCES password_reset_requests(id) ON DELETE RESTRICT,
        CONSTRAINT uq_password_reset_tokens_hash UNIQUE (token_hash),
        CONSTRAINT chk_password_reset_tokens_status CHECK (
          status IN ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED')
        ),
        CONSTRAINT chk_password_reset_tokens_version CHECK (token_version > 0 AND version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_tokens_request_created
         ON password_reset_tokens (request_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE mfa_enrollments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        reference VARCHAR(160) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        enabled_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_mfa_enrollments_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT uq_mfa_enrollments_reference UNIQUE (reference),
        CONSTRAINT chk_mfa_enrollments_reference CHECK (
          reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'
        ),
        CONSTRAINT chk_mfa_enrollments_status CHECK (
          status IN ('PENDING', 'ENABLED', 'DISABLED', 'REVOKED')
        ),
        CONSTRAINT chk_mfa_enrollments_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_mfa_enrollments_active_customer
         ON mfa_enrollments (customer_id)
       WHERE deleted_at IS NULL AND status <> 'REVOKED'`,
    );

    await queryRunner.query(`
      CREATE TABLE mfa_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        enrollment_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        method_type VARCHAR(30) NOT NULL,
        label VARCHAR(160) NOT NULL,
        identifier_hash VARCHAR(512),
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_mfa_methods_enrollment
          FOREIGN KEY (enrollment_id) REFERENCES mfa_enrollments(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mfa_methods_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_mfa_methods_type CHECK (
          method_type IN ('TOTP', 'AUTHENTICATOR_APP', 'SECURITY_KEY', 'SMS', 'EMAIL')
        ),
        CONSTRAINT chk_mfa_methods_status CHECK (
          status IN ('PENDING', 'ENABLED', 'DISABLED', 'REVOKED')
        ),
        CONSTRAINT chk_mfa_methods_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_mfa_methods_enrollment_type
         ON mfa_methods (enrollment_id, method_type)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_mfa_methods_customer_status
         ON mfa_methods (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE trusted_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        device_reference VARCHAR(160) NOT NULL,
        device_name VARCHAR(160) NOT NULL,
        platform VARCHAR(80) NOT NULL,
        device_fingerprint_hash VARCHAR(512) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        registered_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_trusted_devices_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_trusted_devices_status CHECK (
          status IN ('PENDING', 'TRUSTED', 'SUSPENDED', 'REVOKED')
        ),
        CONSTRAINT chk_trusted_devices_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_trusted_devices_customer_reference
         ON trusted_devices (customer_id, device_reference)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_trusted_devices_customer_status
         ON trusted_devices (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE recovery_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        enrollment_id UUID,
        code_hash VARCHAR(512) NOT NULL,
        code_version INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
        generated_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_recovery_codes_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recovery_codes_enrollment
          FOREIGN KEY (enrollment_id) REFERENCES mfa_enrollments(id) ON DELETE RESTRICT,
        CONSTRAINT uq_recovery_codes_hash UNIQUE (code_hash),
        CONSTRAINT chk_recovery_codes_status CHECK (status IN ('AVAILABLE', 'USED', 'REVOKED')),
        CONSTRAINT chk_recovery_codes_version CHECK (code_version > 0 AND version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_recovery_codes_customer_status
         ON recovery_codes (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE security_event_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        credential_id UUID,
        event_type VARCHAR(50) NOT NULL,
        actor VARCHAR(160) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_security_event_histories_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_security_event_histories_credential
          FOREIGN KEY (credential_id) REFERENCES customer_authentication_credentials(id) ON DELETE RESTRICT,
        CONSTRAINT chk_security_event_histories_type CHECK (
          event_type IN (
            'CREDENTIAL_CREATED', 'CREDENTIAL_UPDATED', 'PASSWORD_ROTATED', 'PASSWORD_EXPIRED',
            'AUTHENTICATION_FAILED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED',
            'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_TOKEN_ISSUED', 'PASSWORD_RESET_TOKEN_UPDATED',
            'PASSWORD_RESET_STATUS_CHANGED', 'MFA_ENROLLMENT_CREATED', 'MFA_ENROLLMENT_UPDATED',
            'MFA_METHOD_ADDED', 'MFA_METHOD_UPDATED', 'TRUSTED_DEVICE_REGISTERED',
            'TRUSTED_DEVICE_UPDATED', 'RECOVERY_CODE_CREATED', 'RECOVERY_CODE_UPDATED'
          )
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_security_event_histories_customer_occurred
         ON security_event_histories (customer_id, occurred_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS security_event_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS recovery_codes`);
    await queryRunner.query(`DROP TABLE IF EXISTS trusted_devices`);
    await queryRunner.query(`DROP TABLE IF EXISTS mfa_methods`);
    await queryRunner.query(`DROP TABLE IF EXISTS mfa_enrollments`);
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_tokens`);
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_requests`);
    await queryRunner.query(`DROP TABLE IF EXISTS password_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_authentication_credentials`);
  }
}
