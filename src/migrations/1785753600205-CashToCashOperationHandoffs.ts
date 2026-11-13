import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Non-financial support evidence keyed by the authenticated agent and original operation. */
export class CashToCashOperationHandoffs1785753600205 implements MigrationInterface {
  name = 'CashToCashOperationHandoffs1785753600205';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cash_to_cash_operation_handoffs (
      id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES agents(id), institution_id uuid NOT NULL,
      operation_key varchar(255) NOT NULL, reason varchar(32) NOT NULL CHECK (reason IN ('UNKNOWN_OUTCOME','LOST_TRANSFER_CODE','EVIDENCE_REVIEW')),
      evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(agent_id,operation_key)
    )`);
    await q.query(
      `CREATE FUNCTION reject_c2c_operation_handoff_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'operation handoff is immutable'; END $$`,
    );
    await q.query(
      `CREATE TRIGGER c2c_operation_handoff_immutable BEFORE UPDATE OR DELETE ON cash_to_cash_operation_handoffs FOR EACH ROW EXECUTE FUNCTION reject_c2c_operation_handoff_mutation()`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard cash-to-cash operation handoffs'));
  }
}
