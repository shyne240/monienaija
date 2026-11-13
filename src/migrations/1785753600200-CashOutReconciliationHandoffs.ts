import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable non-financial handoff. No adjudication or ledger mutation. */
export class CashOutReconciliationHandoffs1785753600200 implements MigrationInterface {
  name = 'CashOutReconciliationHandoffs1785753600200';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_out_reconciliation_handoffs (
      id uuid PRIMARY KEY,
      agent_id uuid NOT NULL REFERENCES agents(id),
      operation_key varchar(255) NOT NULL,
      customer_id uuid REFERENCES customers(id),
      reason varchar(32) NOT NULL CHECK (reason IN ('UNKNOWN_OUTCOME','REPLACEMENT_UNKNOWN','RECEIPT_UNAVAILABLE')),
      evidence jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(agent_id,operation_key)
    )`);
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard reconciliation handoffs'));
  }
}
