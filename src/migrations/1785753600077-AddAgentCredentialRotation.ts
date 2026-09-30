import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-AGENT-CREDENTIALS-01 — first-login rotation flag for Agent authentication credentials.
 *
 * Adds `rotation_required` to agent_authentication_credentials: a credential issued by the
 * workforce at/after activation is created with rotation_required=true and a temporary
 * password expiry; the Agent's first successful authentication cannot produce a session
 * until the credential is rotated, at which point the flag is cleared and the expiry is
 * removed. Existing credentials default to FALSE (no behavior change).
 */
export class AddAgentCredentialRotation1785753600077 implements MigrationInterface {
  name = 'AddAgentCredentialRotation1785753600077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE agent_authentication_credentials ADD COLUMN rotation_required BOOLEAN NOT NULL DEFAULT FALSE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE agent_authentication_credentials DROP COLUMN rotation_required`,
    );
  }
}
