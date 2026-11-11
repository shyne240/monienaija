import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Synthetic fixture provenance, separate from genuine customer KYC evidence. */
export class KycSyntheticAttemptBinding1785753600112 implements MigrationInterface {
  name = 'KycSyntheticAttemptBinding1785753600112';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE kyc_registration_synthetic_attempt_bindings (
      attempt_id uuid PRIMARY KEY REFERENCES kyc_registration_attempts(id),
      identity_mac char(64) NOT NULL, fixture_hash char(64) NOT NULL
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT EXISTS(SELECT 1 FROM kyc_registration_synthetic_attempt_bindings) AS has_data',
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove synthetic verification bindings');
    await q.query('DROP TABLE kyc_registration_synthetic_attempt_bindings');
  }
}
