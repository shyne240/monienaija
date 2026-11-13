import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 4 — credential recovery challenges.
 *
 * Purpose-bound, single-use OTP challenges for SELF-SERVICE customer credential recovery. This is
 * not a second credential store: the login passcode remains a row in
 * `customer_authentication_credentials` (rotated through `CustomerAuthenticationService`) and the
 * transaction PIN remains a row in `customer_transaction_pins` (rotated through
 * `CustomerTransactionPinService`). This table only records the recovery *evidence* journey:
 *
 * - `purpose` binds a challenge to one credential class, so a login-passcode challenge can never be
 *   replayed against the transaction PIN or vice versa.
 * - the OTP itself is never stored (salted PBKDF2 digest + salt only).
 * - `status` moves ACTIVE → CONSUMED | EXPIRED | REVOKED; `consumed_at` makes replacement exactly
 *   once (replay-safe), and the partial unique index allows at most one live challenge per
 *   (customer, purpose).
 * - `token_hash` is the SHA-256 of the one-time recovery token handed back only after the OTP and
 *   the identity-evidence gate both succeed; it is never rendered into an audit entry or log.
 */
export class CreateCustomerCredentialRecoveryChallenges1785753600402 implements MigrationInterface {
  name = 'CreateCustomerCredentialRecoveryChallenges1785753600402';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE customer_credential_recovery_challenges (
      id uuid PRIMARY KEY,
      customer_id uuid NOT NULL REFERENCES customers(id),
      purpose varchar(32) NOT NULL,
      normalized_phone varchar(32) NOT NULL,
      destination_phone varchar(32) NOT NULL,
      code_salt varchar(64) NOT NULL,
      code_hash varchar(256) NOT NULL,
      token_hash char(64),
      attempt_count integer NOT NULL DEFAULT 0,
      status varchar(16) NOT NULL DEFAULT 'ACTIVE',
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      verified_at timestamptz,
      token_expires_at timestamptz,
      consumed_at timestamptz,
      revoked_at timestamptz,
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT chk_ccrc_purpose CHECK (purpose IN ('LOGIN_PASSCODE','TRANSACTION_PIN')),
      CONSTRAINT chk_ccrc_status CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','REVOKED')),
      CONSTRAINT chk_ccrc_attempts CHECK (attempt_count >= 0),
      CONSTRAINT chk_ccrc_version CHECK (version > 0),
      CONSTRAINT chk_ccrc_token_hash CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT chk_ccrc_verified_requires_token CHECK (\n        verified_at IS NULL\n        OR token_hash IS NOT NULL\n        OR status IN ('CONSUMED','EXPIRED','REVOKED')\n      )
    )`);
    await q.query(
      `CREATE INDEX idx_ccrc_customer_purpose ON customer_credential_recovery_challenges(customer_id, purpose, created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX idx_ccrc_status_expires ON customer_credential_recovery_challenges(status, expires_at)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_ccrc_token_hash ON customer_credential_recovery_challenges(token_hash) WHERE token_hash IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX uq_ccrc_live_per_purpose ON customer_credential_recovery_challenges(customer_id, purpose) WHERE status = 'ACTIVE'`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE customer_credential_recovery_challenges');
  }
}
