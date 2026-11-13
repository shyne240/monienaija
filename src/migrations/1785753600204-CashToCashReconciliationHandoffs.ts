import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CashToCashReconciliationHandoffs1785753600204 implements MigrationInterface {
  name = 'CashToCashReconciliationHandoffs1785753600204';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_to_cash_reconciliation_handoffs (
      id uuid PRIMARY KEY, transfer_id uuid NOT NULL UNIQUE REFERENCES cash_to_cash_transfers(id),
      agent_id uuid NOT NULL REFERENCES agents(id), reason varchar(32) NOT NULL CHECK (reason IN ('UNKNOWN_OUTCOME','RECEIPT_UNAVAILABLE','DISPOSITION_PENDING','EVIDENCE_REVIEW')),
      evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE FUNCTION reject_c2c_reconciliation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'handoff evidence is immutable'; END $$`,
    );
    await q.query(
      `CREATE TRIGGER c2c_reconciliation_immutable BEFORE UPDATE OR DELETE ON cash_to_cash_reconciliation_handoffs FOR EACH ROW EXECUTE FUNCTION reject_c2c_reconciliation_mutation()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard cash-to-cash reconciliation handoffs'));
  }
}
