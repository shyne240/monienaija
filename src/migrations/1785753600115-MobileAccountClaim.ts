import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Records only references to trusted evidence; never stores the submitted identifier. */
export class MobileAccountClaim1785753600115 implements MigrationInterface {
  name = 'MobileAccountClaim1785753600115';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE customer_authentication_credentials ADD COLUMN mobile_otp_required boolean NOT NULL DEFAULT false`,
    );
    await q.query(`CREATE TABLE mobile_account_claims (
      session_id uuid PRIMARY KEY REFERENCES kyc_registration_sessions(id),
      customer_id uuid NOT NULL REFERENCES customers(id),
      ownership_claim_id uuid NOT NULL REFERENCES kyc_identity_claims(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      consumed_at timestamptz
    )`);
    await q.query(`CREATE TABLE mobile_claim_attempt_windows (
      customer_id uuid PRIMARY KEY REFERENCES customers(id),
      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attempts integer NOT NULL CHECK (attempts >= 0)
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT EXISTS(SELECT 1 FROM mobile_account_claims) OR EXISTS(SELECT 1 FROM mobile_claim_attempt_windows) OR EXISTS(SELECT 1 FROM customer_authentication_credentials WHERE mobile_otp_required) AS present`,
    )) as Array<{ present: boolean }>;
    if (rows[0]?.present) throw new Error('Refusing to remove mobile account claim history');
    await q.query('DROP TABLE mobile_claim_attempt_windows');
    await q.query('DROP TABLE mobile_account_claims');
    await q.query(
      'ALTER TABLE customer_authentication_credentials DROP COLUMN mobile_otp_required',
    );
  }
}
