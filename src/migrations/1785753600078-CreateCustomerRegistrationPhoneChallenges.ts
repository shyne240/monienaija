import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-CUSTOMER-ONBOARDING-01 — pre-customer phone-verification challenge store.
 *
 * Narrow, purpose-built table backing the customer-facing registration flow
 * (OTP issuance → verification → one-time registration token → DRAFT creation). The
 * existing mfa_challenges model cannot be reused because it requires an existing,
 * session-bound customer (customer_id/enrollment_id/method_id/session_id NOT NULL).
 *
 * Key constraints:
 * - at most one ACTIVE challenge per normalized phone (partial unique index);
 * - at most one VERIFIED-but-unconsumed challenge per normalized phone (partial unique
 *   index) → exactly one outstanding registration token per phone;
 * - no plaintext OTP storage (salted PBKDF2 digest only).
 */
export class CreateCustomerRegistrationPhoneChallenges1785753600078 implements MigrationInterface {
  name = 'CreateCustomerRegistrationPhoneChallenges1785753600078';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_registration_phone_challenges (
        id UUID PRIMARY KEY,
        normalized_phone VARCHAR(32) NOT NULL,
        destination_phone VARCHAR(32) NOT NULL,
        code_salt VARCHAR(64) NOT NULL,
        code_hash VARCHAR(256) NOT NULL,
        verification_token_hash VARCHAR(64),
        status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
          CONSTRAINT chk_reg_phone_challenges_status
            CHECK (status IN ('ACTIVE', 'VERIFIED', 'EXPIRED', 'REVOKED')),
        attempt_count INTEGER NOT NULL DEFAULT 0
          CONSTRAINT chk_reg_phone_challenges_attempts CHECK (attempt_count >= 0),
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        verified_at TIMESTAMPTZ,
        consumed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1
          CONSTRAINT chk_reg_phone_challenges_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_reg_phone_challenges_active_phone
         ON customer_registration_phone_challenges (normalized_phone)
         WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_reg_phone_challenges_verified_unconsumed_phone
         ON customer_registration_phone_challenges (normalized_phone)
         WHERE status = 'VERIFIED' AND consumed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_reg_phone_challenges_phone_created
         ON customer_registration_phone_challenges (normalized_phone, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_reg_phone_challenges_status_expires
         ON customer_registration_phone_challenges (status, expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE customer_registration_phone_challenges`);
  }
}
