import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-CUSTOMER-CREDENTIALS-01 — first-login rotation flag for Customer authentication credentials.
 *
 * Adds `rotation_required` to customer_authentication_credentials: a credential issued by the
 * workforce for an ACTIVE customer is created with rotation_required=true and a temporary
 * password expiry; the customer's first successful authentication cannot produce a session
 * until the credential is rotated, at which point the flag is cleared and the expiry is
 * removed. Existing credentials default to FALSE (no behavior change). Mirrors the agent
 * precedent (1785753600077 AddAgentCredentialRotation).
 */
export class AddCustomerCredentialRotation1785753600079 implements MigrationInterface {
  name = 'AddCustomerCredentialRotation1785753600079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customer_authentication_credentials ADD COLUMN rotation_required BOOLEAN NOT NULL DEFAULT FALSE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customer_authentication_credentials DROP COLUMN rotation_required`,
    );
  }
}
