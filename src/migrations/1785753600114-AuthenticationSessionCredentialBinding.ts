import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Onboarding sessions bind to a credential version without changing existing session semantics. */
export class AuthenticationSessionCredentialBinding1785753600114 implements MigrationInterface {
  name = 'AuthenticationSessionCredentialBinding1785753600114';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE authentication_sessions ADD COLUMN onboarding_password_version integer,
      ADD CONSTRAINT chk_onboarding_session_credential_version CHECK (audience <> 'customer-onboarding' OR (onboarding_password_version IS NOT NULL AND onboarding_password_version > 0))`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT EXISTS(SELECT 1 FROM authentication_sessions WHERE audience='customer-onboarding') AS present`,
    )) as Array<{ present: boolean }>;
    if (rows[0]?.present)
      throw new Error('Refusing to remove onboarding session credential binding');
    await q.query(
      'ALTER TABLE authentication_sessions DROP CONSTRAINT chk_onboarding_session_credential_version, DROP COLUMN onboarding_password_version',
    );
  }
}
