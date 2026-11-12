import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Simulation-only pre-customer attempts: not KYC evidence and not a customer record. */
export class KycRegistrationAttempts1785753600108 implements MigrationInterface {
  name = 'KycRegistrationAttempts1785753600108';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE kyc_registration_synthetic_provider_lock (provider varchar(16) PRIMARY KEY)`,
    );
    await q.query(
      `INSERT INTO kyc_registration_synthetic_provider_lock(provider) VALUES('SYNTHETIC')`,
    );
    await q.query(`CREATE TABLE kyc_registration_attempts (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES kyc_registration_sessions(id),
      consent_id uuid NOT NULL REFERENCES kyc_registration_consents(id), request_id uuid NOT NULL,
      kind varchar(3) NOT NULL CHECK(kind IN ('BVN','NIN')), provider varchar(16) NOT NULL CHECK(provider='SYNTHETIC'),
      request_mac char(64) NOT NULL, state varchar(24) NOT NULL CHECK(state IN ('RESERVED','DISPATCHING','MATCH','REVIEW','UNKNOWN','CONSENT_WITHDRAWN','CANCELLED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz, completed_at timestamptz,
      UNIQUE(session_id,request_id)
    )`);
    await q.query(
      `CREATE INDEX idx_kyc_registration_attempts_session ON kyc_registration_attempts(session_id,created_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT EXISTS(SELECT 1 FROM kyc_registration_attempts) AS has_data',
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove registration verification history');
    await q.query('DROP TABLE kyc_registration_attempts');
    await q.query('DROP TABLE kyc_registration_synthetic_provider_lock');
  }
}
