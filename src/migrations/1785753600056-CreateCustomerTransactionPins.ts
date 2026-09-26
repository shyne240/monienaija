import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerTransactionPins1785753600056 implements MigrationInterface {
  name = 'CreateCustomerTransactionPins1785753600056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_transaction_pins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        pin_hash VARCHAR(512) NOT NULL,
        hash_algorithm VARCHAR(20) NOT NULL,
        pin_version INTEGER NOT NULL,
        failed_count INTEGER NOT NULL DEFAULT 0,
        account_locked BOOLEAN NOT NULL DEFAULT FALSE,
        locked_at TIMESTAMPTZ,
        lock_reason VARCHAR(500),
        last_changed_at TIMESTAMPTZ NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_transaction_pins_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_transaction_pins_pin_version CHECK (pin_version > 0),
        CONSTRAINT chk_customer_transaction_pins_failed_count CHECK (failed_count >= 0),
        CONSTRAINT chk_customer_transaction_pins_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_transaction_pins_active_customer ON customer_transaction_pins (customer_id) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_transaction_pins_customer ON customer_transaction_pins (customer_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS customer_transaction_pins`);
  }
}
