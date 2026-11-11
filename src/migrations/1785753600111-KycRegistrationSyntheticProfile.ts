import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Session-only synthetic profile; it is never customer KYC evidence. */
export class KycRegistrationSyntheticProfile1785753600111 implements MigrationInterface {
  name = 'KycRegistrationSyntheticProfile1785753600111';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE kyc_registration_synthetic_profiles (
      session_id uuid PRIMARY KEY REFERENCES kyc_registration_sessions(id),
      first_name varchar(100) NOT NULL, last_name varchar(100) NOT NULL,
      date_of_birth date NOT NULL, email varchar(254),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT EXISTS(SELECT 1 FROM kyc_registration_synthetic_profiles) AS has_data',
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove registration profiles');
    await q.query('DROP TABLE kyc_registration_synthetic_profiles');
  }
}
