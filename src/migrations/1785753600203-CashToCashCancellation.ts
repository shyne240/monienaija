import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cancellation is lifecycle containment, not a release or accounting disposition. */
export class CashToCashCancellation1785753600203 implements MigrationInterface {
  name = 'CashToCashCancellation1785753600203';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE cash_to_cash_transfers DROP CONSTRAINT chk_cash_to_cash_status`);
    await q.query(
      `ALTER TABLE cash_to_cash_transfers ADD CONSTRAINT chk_cash_to_cash_status CHECK (status IN ('UNCLAIMED','CLAIMED','EXPIRED','CANCELLED'))`,
    );
    await q.query(`CREATE TABLE cash_to_cash_cancellations (
      transfer_id uuid PRIMARY KEY REFERENCES cash_to_cash_transfers(id),
      agent_id uuid NOT NULL REFERENCES agents(id),
      session_id uuid NOT NULL REFERENCES agent_authentication_sessions(id),
      cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE FUNCTION reject_c2c_cancellation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'cancellation evidence is immutable'; END $$`,
    );
    await q.query(
      `CREATE TRIGGER c2c_cancellation_immutable BEFORE UPDATE OR DELETE ON cash_to_cash_cancellations FOR EACH ROW EXECUTE FUNCTION reject_c2c_cancellation_mutation()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard cash-to-cash cancellation evidence'));
  }
}
