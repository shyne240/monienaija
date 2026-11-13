import type { MigrationInterface, QueryRunner } from 'typeorm';

/** An authenticated customer's intended amount is not evidence of a received payment. */
export class AddA7InboundIntendedAmount1785753600145 implements MigrationInterface {
  name = 'AddA7InboundIntendedAmount1785753600145';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE a7_product_commands ADD COLUMN intended_amount_minor bigint,
      ADD CONSTRAINT chk_a7_intended_amount CHECK (intended_amount_minor IS NULL OR (operation_type='INBOUND_FUNDING' AND intended_amount_minor>0))`);
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove A7 command evidence'));
  }
}
