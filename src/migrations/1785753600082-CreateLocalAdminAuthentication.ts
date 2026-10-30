import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-ADMIN-LOCAL-LOGIN-01 — credential store for the LOCAL DEVELOPMENT ONLY Admin Web
 * username/password login front door.
 *
 * See `src/local-admin-authentication/local-admin-credential.entity.ts` for the full
 * rationale. In short: the real A2 Finance workforce stack
 * (`src/authorization/workforce-*`) intentionally requires an external OIDC provider in
 * production — that design is unchanged by this migration. This table only stores a
 * password hash used to gate the pre-existing, already-reviewed
 * `mock-sandbox-token-*` sandbox bypass that `A2WorkforceOidcService` and
 * `A2WorkforceSessionService` already hard-restrict to
 * `NODE_ENV=development`/`NODE_ENV=test`. The table exists in every environment's
 * schema (consistent with every other migration in this repository) but is only ever
 * populated by `LocalAdminAuthenticationService.seedDefaultAdmin`, which itself refuses
 * to run outside development/test.
 */
export class CreateLocalAdminAuthentication1785753600082 implements MigrationInterface {
  name = 'CreateLocalAdminAuthentication1785753600082';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE local_admin_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_local_admin_credentials_algorithm CHECK (hash_algorithm IN ('PBKDF2')),
        CONSTRAINT chk_local_admin_credentials_email CHECK (email ~ '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_local_admin_credentials_email ON local_admin_credentials (email)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS local_admin_credentials`);
  }
}
