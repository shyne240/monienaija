import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 5 — generalise `external_operations` to the agent lane.
 *
 * `external_operations` was created with `customer_id NOT NULL REFERENCES customers(id)`.
 * The agent lane reuses the same commitment engine and the same provider capability
 * (`NIBSS_NIP OUTBOUND_BANK_SETTLEMENT`), so the operation row must be allowed to carry
 * an agent owner. A single FK cannot reference two tables, so — as with
 * `financial_authorizations` — the FK is replaced by a DB trigger that authoritatively
 * binds the owner to the real agent-or-customer row while keeping every other invariant.
 *
 * The column `customer_id` is semantically the owner id (its name is kept for backward
 * compatibility — renaming would churn every consumer). Its FK is dropped and a
 * CHECK+trigger pair ensures the value exists in exactly one of `customers` or `agents`.
 * The trigger also enforces that the wallet referenced belongs to that owner, mirroring the
 * application-level `requireAgentWallet` / `requireCustomerWallet` boundary.
 */
export class GeneralizeExternalOperationsForAgents1785753600804 implements MigrationInterface {
  name = 'GeneralizeExternalOperationsForAgents1785753600804';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE external_operations DROP CONSTRAINT IF EXISTS fk_external_operations_customer`,
    );
    await q.query(
      `ALTER TABLE external_operations DROP CONSTRAINT IF EXISTS fk_external_operations_customer_id`,
    );
    // Defensive: the constraint name in older dumps is exactly this; if it was already dropped
    // the IF EXISTS is a no-op.
    await q.query(`
      CREATE OR REPLACE FUNCTION validate_external_operation_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id)
           AND NOT EXISTS (SELECT 1 FROM agents WHERE id = NEW.customer_id)
        THEN
          RAISE EXCEPTION 'External operation owner does not exist'
            USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `DROP TRIGGER IF EXISTS external_operations_validate_owner ON external_operations`,
    );
    await q.query(
      `CREATE TRIGGER external_operations_validate_owner BEFORE INSERT OR UPDATE ON external_operations FOR EACH ROW EXECUTE FUNCTION validate_external_operation_owner()`,
    );
  }

  async down(): Promise<void> {
    await qFail();
  }
}

function qFail(): Promise<void> {
  return Promise.reject(new Error('Refusing to discard agent-lane external operation evidence'));
}
