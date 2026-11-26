import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerRestrictionConfigurationReview1785753600812 implements MigrationInterface {
  name = 'CustomerRestrictionConfigurationReview1785753600812';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customer_restrictions
      DROP CONSTRAINT IF EXISTS chk_customer_restrictions_type
    `);
    await queryRunner.query(`
      ALTER TABLE customer_restrictions
      ADD CONSTRAINT chk_customer_restrictions_type
      CHECK (type IN ('NONE', 'LIMITED', 'MANUAL_REVIEW', 'FROZEN', 'BLACKLISTED', 'CONFIGURATION_REVIEW'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT COUNT(*)::text AS count
      FROM customer_restrictions
      WHERE type = 'CONFIGURATION_REVIEW' AND deleted_at IS NULL
    `)) as Array<{ count: string }>;
    if (Number(rows[0]?.count ?? '0') > 0) {
      throw new Error(
        'Refusing to drop CONFIGURATION_REVIEW restriction type while active rows exist',
      );
    }
    await queryRunner.query(`
      ALTER TABLE customer_restrictions
      DROP CONSTRAINT IF EXISTS chk_customer_restrictions_type
    `);
    await queryRunner.query(`
      ALTER TABLE customer_restrictions
      ADD CONSTRAINT chk_customer_restrictions_type
      CHECK (type IN ('NONE', 'LIMITED', 'MANUAL_REVIEW', 'FROZEN', 'BLACKLISTED'))
    `);
  }
}
