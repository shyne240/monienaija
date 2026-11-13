import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Windows are shared across all cash-out challenges for a customer or destination. */
export class CashOutOtpBudgets1785753600131 implements MigrationInterface {
  name = 'CashOutOtpBudgets1785753600131';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_out_otp_budgets (
      budget_key varchar(80) PRIMARY KEY,
      window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      issuance_count integer NOT NULL DEFAULT 0 CHECK (issuance_count >= 0),
      failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0)
    )`);
    await q.query(`CREATE TABLE cash_out_otp_challenge_security (
      challenge_id uuid PRIMARY KEY REFERENCES mfa_challenges(id),
      customer_id uuid NOT NULL REFERENCES customers(id),
      destination_hash varchar(64) NOT NULL CHECK (destination_hash ~ '^[0-9a-f]{64}$')
    )`);
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard cash-out OTP security history'));
  }
}
