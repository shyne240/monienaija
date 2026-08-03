import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairM6UuidDefaults1785753600004 implements MigrationInterface {
  name = 'RepairM6UuidDefaults1785753600004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE virtual_accounts ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    );
    await queryRunner.query(
      `ALTER TABLE beneficiaries ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    );
    await queryRunner.query(`ALTER TABLE banks ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
    await queryRunner.query(
      `ALTER TABLE payment_quotes ALTER COLUMN id SET DEFAULT gen_random_uuid()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payment_quotes ALTER COLUMN id DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE banks ALTER COLUMN id DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE beneficiaries ALTER COLUMN id DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE virtual_accounts ALTER COLUMN id DROP DEFAULT`);
  }
}
