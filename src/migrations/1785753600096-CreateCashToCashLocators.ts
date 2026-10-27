import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCashToCashLocators1785753600096 implements MigrationInterface {
  name = 'CreateCashToCashLocators1785753600096';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE cash_to_cash_locators (
      transfer_id uuid PRIMARY KEY REFERENCES cash_to_cash_transfers(id) ON DELETE RESTRICT,
      sender_phone varchar(10) NOT NULL CHECK (sender_phone ~ '^[789][0-9]{9}$'),
      transfer_number varchar(6) NOT NULL CHECK (transfer_number ~ '^[0-9]{6}$'),
      CONSTRAINT uq_cash_to_cash_locator UNIQUE(sender_phone, transfer_number)
    )`);
    // Never recycle a locator, even for claimed/expired transfers. Historical transfers
    // have no alias: inventing a sender phone during backfill would misidentify them.
    await queryRunner.query(`CREATE FUNCTION protect_cash_to_cash_locator() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Cash-to-Cash locators are immutable'; END $$`);
    await queryRunner.query(`CREATE TRIGGER immutable_cash_to_cash_locator BEFORE UPDATE OR DELETE
      ON cash_to_cash_locators FOR EACH ROW EXECUTE FUNCTION protect_cash_to_cash_locator()`);
    await queryRunner.query(`CREATE TABLE cash_to_cash_locator_attempts (
      bucket_key char(64) PRIMARY KEY,
      window_start timestamptz NOT NULL,
      attempts integer NOT NULL CHECK (attempts > 0)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // Forgetting issued aliases would allow stale receipts to identify future transfers.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM cash_to_cash_locators) THEN
        RAISE EXCEPTION 'Cannot remove issued Cash-to-Cash locators';
      END IF;
    END $$`);
    await queryRunner.query(`DROP TABLE cash_to_cash_locator_attempts`);
    await queryRunner.query(`DROP TABLE cash_to_cash_locators`);
    await queryRunner.query(`DROP FUNCTION protect_cash_to_cash_locator()`);
  }
}
