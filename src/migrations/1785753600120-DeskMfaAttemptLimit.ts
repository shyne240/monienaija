import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist per-challenge desk OTP failures under the challenge row lock. */
export class DeskMfaAttemptLimit1785753600120 implements MigrationInterface {
  name = 'DeskMfaAttemptLimit1785753600120';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mfa_challenges
      ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0,
      ADD CONSTRAINT chk_mfa_challenge_failed_attempts CHECK (failed_attempts >= 0)`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard persisted MFA attempt history'));
  }
}
