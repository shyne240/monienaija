import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Immutable proof tying a consumed maker-checker approval to its one reversal. */
export class CreateGovernedLedgerReversalExecutions1785753600117 implements MigrationInterface {
  name = 'CreateGovernedLedgerReversalExecutions1785753600117';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE governed_ledger_reversal_executions (
        approval_id uuid PRIMARY KEY REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        original_journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        reversal_journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        idempotency_key varchar(255) NOT NULL,
        executed_by varchar(160) NOT NULL,
        executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT chk_governed_reversal_idempotency CHECK (length(idempotency_key) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE FUNCTION validate_governed_ledger_reversal_execution() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM ledger_journals j
          JOIN privileged_action_approvals a ON a.id = NEW.approval_id
          WHERE j.id = NEW.reversal_journal_id
            AND j.reversal_of_journal_id = NEW.original_journal_id
            AND j.idempotency_key = NEW.idempotency_key
            AND a.action_type = 'LEDGER_JOURNAL_REVERSAL'
            AND a.resource_type = 'LEDGER_JOURNAL'
            AND lower(a.resource_id) = NEW.original_journal_id::text
            AND a.status = 'CONSUMED'
        ) THEN
          RAISE EXCEPTION 'Governed reversal execution does not match its approval and journal';
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER governed_reversal_execution_validate BEFORE INSERT
      ON governed_ledger_reversal_executions FOR EACH ROW
      EXECUTE FUNCTION validate_governed_ledger_reversal_execution()
    `);
    await queryRunner.query(`
      CREATE TRIGGER governed_reversal_execution_immutable BEFORE UPDATE OR DELETE
      ON governed_ledger_reversal_executions FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()
    `);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove governed ledger reversal evidence'));
  }
}
