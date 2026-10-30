import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P0-CH actor-column correction — widen authorization actor columns to VARCHAR(160)
 * to match the platform's principal-ID convention (see workforce principal_id
 * VARCHAR(160) throughout the codebase). Preserves nullability and defaults.
 *
 * Down refuses to truncate any value longer than 100 characters.
 */
export class WidenAuthorizationActorColumns1785753600089 implements MigrationInterface {
  name = 'WidenAuthorizationActorColumns1785753600089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE authorization_roles ALTER COLUMN created_by TYPE VARCHAR(160)`);
    await queryRunner.query(`ALTER TABLE authorization_roles ALTER COLUMN updated_by TYPE VARCHAR(160)`);
    await queryRunner.query(
      `ALTER TABLE authorization_role_functions ALTER COLUMN assigned_by TYPE VARCHAR(160)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse to truncate any value longer than 100 characters.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM authorization_roles WHERE length(created_by) > 100) THEN
          RAISE EXCEPTION 'Cannot downgrade authorization_roles.created_by: at least one value exceeds 100 characters';
        END IF;
        IF EXISTS (SELECT 1 FROM authorization_roles WHERE updated_by IS NOT NULL AND length(updated_by) > 100) THEN
          RAISE EXCEPTION 'Cannot downgrade authorization_roles.updated_by: at least one value exceeds 100 characters';
        END IF;
        IF EXISTS (SELECT 1 FROM authorization_role_functions WHERE length(assigned_by) > 100) THEN
          RAISE EXCEPTION 'Cannot downgrade authorization_role_functions.assigned_by: at least one value exceeds 100 characters';
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE authorization_roles ALTER COLUMN created_by TYPE VARCHAR(100)`);
    await queryRunner.query(`ALTER TABLE authorization_roles ALTER COLUMN updated_by TYPE VARCHAR(100)`);
    await queryRunner.query(
      `ALTER TABLE authorization_role_functions ALTER COLUMN assigned_by TYPE VARCHAR(100)`,
    );
  }
}
