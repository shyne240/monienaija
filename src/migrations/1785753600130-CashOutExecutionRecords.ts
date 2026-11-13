import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable authorization-to-journal binding, independent of API idempotency retention. */
export class CashOutExecutionRecords1785753600130 implements MigrationInterface {
  name = 'CashOutExecutionRecords1785753600130';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE cash_out_execution_records (
      agent_id uuid NOT NULL REFERENCES agents(id),
      idempotency_key varchar(255) NOT NULL,
      customer_id uuid NOT NULL REFERENCES customers(id),
      challenge_id uuid NOT NULL UNIQUE REFERENCES mfa_challenges(id),
      request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      journal_id uuid NOT NULL UNIQUE REFERENCES ledger_journals(id),
      response_body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (agent_id, idempotency_key)
    )`);
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to discard durable cash-out execution records'));
  }
}
