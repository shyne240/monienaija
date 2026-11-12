import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Separate pre-customer state; never changes the existing registration challenges. */
export class KycRegistrationSessions1785753600107 implements MigrationInterface {
  name = 'KycRegistrationSessions1785753600107';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE kyc_registration_rate_buckets (
      bucket_key char(64) PRIMARY KEY, window_started_at timestamptz NOT NULL,
      count integer NOT NULL CHECK(count >= 0)
    )`);
    await q.query(`CREATE TABLE kyc_registration_phone_locks (
      phone varchar(10) PRIMARY KEY, last_issued_at timestamptz
    )`);
    await q.query(`CREATE TABLE kyc_registration_sessions (
      id uuid PRIMARY KEY, phone varchar(10) NOT NULL,
      pending_token_hash char(64), authorization_hash char(64),
      status varchar(12) NOT NULL CHECK(status IN ('PENDING','VERIFIED','REVOKED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
      verified_at timestamptz, revoked_at timestamptz,
      CHECK(expires_at > created_at),
      CHECK((status='PENDING' AND pending_token_hash IS NOT NULL AND authorization_hash IS NULL AND verified_at IS NULL AND revoked_at IS NULL)
        OR (status='VERIFIED' AND pending_token_hash IS NULL AND authorization_hash IS NOT NULL AND verified_at IS NOT NULL AND revoked_at IS NULL)
        OR (status='REVOKED' AND pending_token_hash IS NULL AND authorization_hash IS NULL AND revoked_at IS NOT NULL))
    )`);
    await q.query(`CREATE TABLE kyc_registration_otps (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES kyc_registration_sessions(id),
      request_id uuid NOT NULL, salt varchar(32) NOT NULL, code_hash varchar(64) NOT NULL,
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
      issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
      used_at timestamptz, superseded_at timestamptz,
      UNIQUE(session_id,request_id), CHECK(expires_at > issued_at)
    )`);
    await q.query(
      `CREATE UNIQUE INDEX kyc_registration_one_active_otp ON kyc_registration_otps(session_id) WHERE used_at IS NULL AND superseded_at IS NULL`,
    );
    await q.query(`CREATE TABLE kyc_registration_consents (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES kyc_registration_sessions(id),
      request_id uuid NOT NULL, kind varchar(3) NOT NULL CHECK(kind IN ('BVN','NIN')),
      notice_version varchar(64) NOT NULL, granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL, withdrawn_at timestamptz,
      UNIQUE(session_id,request_id), CHECK(expires_at > granted_at)
    )`);
    await q.query(`CREATE TABLE kyc_registration_private_audit (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES kyc_registration_sessions(id),
      resource_id uuid NOT NULL, action varchar(32) NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT EXISTS(SELECT 1 FROM kyc_registration_sessions) AS has_data',
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove registration session history');
    await q.query('DROP TABLE kyc_registration_private_audit');
    await q.query('DROP TABLE kyc_registration_consents');
    await q.query('DROP TABLE kyc_registration_otps');
    await q.query('DROP TABLE kyc_registration_sessions');
    await q.query('DROP TABLE kyc_registration_phone_locks');
    await q.query('DROP TABLE kyc_registration_rate_buckets');
  }
}
