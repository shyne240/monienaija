import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Store only one-way applicant capability hashes; the raw token is returned once at creation. */
export class SecureAgentApplicationAccess1785753600095 implements MigrationInterface {
  name = 'SecureAgentApplicationAccess1785753600095';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_applications
        ADD COLUMN applicant_access_token_hash CHAR(64)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_agent_applications_applicant_access_token_hash
        ON agent_applications (applicant_access_token_hash)
        WHERE applicant_access_token_hash IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX uq_agent_applications_applicant_access_token_hash',
    );
    await queryRunner.query(
      'ALTER TABLE agent_applications DROP COLUMN applicant_access_token_hash',
    );
  }
}
