import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-AGENT-MFA-API-01 — nullable purpose column on mfa_challenges.
 *
 * Purpose-bound issuance is required so a challenge issued for one flow (e.g.
 * Wallet→Cash) cannot be replayed into another (e.g. Cash→Cash claim). NULL keeps
 * every pre-existing challenge purpose-generic: verification behavior for legacy rows
 * is byte-for-byte unchanged; only rows carrying a non-NULL purpose are enforced
 * against the consumer's expectedPurpose.
 *
 * Additive only: no renames, no NOT NULL retrofit, no data rewrite, no index churn
 * (purpose is never queried — it is read together with the challenge row by primary key).
 */
export class AddMfaChallengePurpose1785753600080 implements MigrationInterface {
  name = 'AddMfaChallengePurpose1785753600080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mfa_challenges
        ADD COLUMN IF NOT EXISTS purpose VARCHAR(64) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mfa_challenges
        DROP COLUMN IF EXISTS purpose
    `);
  }
}
