import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Add structured, optional customer name components without rewriting existing profile data. */
export class AddCustomerProfileNameParts1785753600091 implements MigrationInterface {
  name = 'AddCustomerProfileNameParts1785753600091';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_profiles
        ADD COLUMN first_name VARCHAR(100),
        ADD COLUMN middle_name VARCHAR(100),
        ADD COLUMN last_name VARCHAR(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_profiles
        DROP COLUMN last_name,
        DROP COLUMN middle_name,
        DROP COLUMN first_name
    `);
  }
}
