import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D banking — the fee, tax and settlement amounts bound to an authorized operation.
 *
 * The rule this table exists to enforce: **a fee that was part of an authorization can never change
 * afterwards.** Between the moment a customer approves a transfer and the moment it settles, three
 * things can move under our feet — the fee rule is superseded, the VAT rate is revised, or a provider
 * changes its pricing. If any of those re-computations happened at settlement time, the customer
 * would be charged an amount different from the one they authorized, and no audit could tell which
 * figure they actually agreed to.
 *
 * So the amounts are computed once, under the authorization transaction, and written here. Settlement
 * reads these columns. It never re-quotes.
 *
 * Two further distinctions are load-bearing and are modelled as separate columns rather than derived:
 *
 * - the **beneficiary amount** (what the recipient's bank receives) is not the **customer debit**
 *   (what leaves the wallet). Conflating them is how a customer ends up paying a fee out of the
 *   recipient's money;
 * - the **provider fee** is what the payment provider charges us, and the **service fee** is what we
 *   charge the customer. They are usually different numbers and both are real; deriving either from
 *   the other would invent revenue or loss.
 *
 * Deliberate omissions: there is no column a human can write to change a fee after the fact, no
 * "adjustment" path, and no default fee. A row with no approved rule behind it cannot be created by
 * the application, because the service refuses rather than inventing a number.
 */
export class BankingFeeBinding1785753600604 implements MigrationInterface {
  name = 'BankingFeeBinding1785753600604';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE banking_operation_fee_bindings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- One binding per operation. The unique constraint is the idempotency guarantee: a retried
      -- authorization cannot create a second, differently-priced binding for the same operation.
      external_operation_id uuid NOT NULL UNIQUE,
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

      -- What the destination institution is credited.
      beneficiary_amount_minor numeric(20,0) NOT NULL CHECK (beneficiary_amount_minor > 0),
      -- What leaves the customer's wallet: beneficiary + service fee + tax. Enforced below.
      customer_debit_minor numeric(20,0) NOT NULL CHECK (customer_debit_minor > 0),
      -- What we charge the customer for this operation.
      service_fee_minor numeric(20,0) NOT NULL CHECK (service_fee_minor >= 0),
      -- Tax on the service fee. Zero is legitimate and must be distinguishable from absent.
      tax_minor numeric(20,0) NOT NULL CHECK (tax_minor >= 0),
      -- What the payment provider charges us. Recorded for margin, never added to the debit.
      provider_fee_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
      -- What an agent earns on this operation, if any. Zero when no agent is involved.
      agent_commission_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK (agent_commission_minor >= 0),
      -- What we expect to settle with the institution/provider after all of the above.
      settlement_amount_minor numeric(20,0) NOT NULL CHECK (settlement_amount_minor > 0),

      -- Provenance. A fee with no approved rule behind it is not a fee, it is a guess.
      fee_rule_id uuid REFERENCES fee_rules(id) ON DELETE RESTRICT,
      fee_rule_version integer CHECK (fee_rule_version IS NULL OR fee_rule_version > 0),
      -- The rule's parameters at binding time, so the arithmetic can be re-derived years later even
      -- after the rule row is superseded.
      rule_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rule_snapshot) = 'object'),
      -- Distinguishes an operator-approved test policy from a production-priced rule. Never inferred.
      pricing_source varchar(24) NOT NULL
        CHECK (pricing_source IN ('APPROVED_RULE','TEST_POLICY')),

      computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

      -- The customer is debited exactly what the components say. This is the arithmetic invariant
      -- that stops a later code change from quietly mis-charging.
      CONSTRAINT chk_banking_fee_binding_arithmetic
        CHECK (customer_debit_minor = beneficiary_amount_minor + service_fee_minor + tax_minor),
      -- A fee rule's parameter snapshot must identify the rule shape, not merely be an object.
      CONSTRAINT chk_banking_fee_binding_snapshot
        CHECK (rule_snapshot ? 'flatFeeMinor' AND rule_snapshot ? 'percentageBps' AND rule_snapshot ? 'vatBps')
    )`);
    await q.query(`CREATE INDEX idx_banking_fee_binding_institution
      ON banking_operation_fee_bindings(institution_id, computed_at DESC)`);

    // ------------------------------------------------------------ immutability
    // A binding is written once, under authorization. Every column is immutable afterwards: there is
    // no legitimate reason to change a priced, authorized transaction, and permitting a "correction"
    // would erase the evidence of what the customer approved.
    await q.query(`CREATE FUNCTION public.banking_fee_binding_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Fee bindings are never deleted' USING ERRCODE='55000';
        END IF;
        IF ROW(OLD.*) IS DISTINCT FROM ROW(NEW.*) THEN
          RAISE EXCEPTION 'Fee bindings are immutable once written' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_fee_binding_immutable
      BEFORE UPDATE OR DELETE ON banking_operation_fee_bindings
      FOR EACH ROW EXECUTE FUNCTION public.banking_fee_binding_immutable()`);

    // ------------------------------------------------------------ privileges
    await q.query(`REVOKE ALL ON public.banking_operation_fee_bindings FROM PUBLIC`);
    await q.query(
      `GRANT SELECT,INSERT ON public.banking_operation_fee_bindings TO monienaija_runtime`,
    );
    // No UPDATE and no DELETE: the trigger already refuses both, and withholding the privilege means
    // an attacker does not even reach the trigger.
    await q.query(
      `REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_operation_fee_bindings FROM monienaija_runtime`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Refuses by design. Dropping this table would destroy the only record of what customers were
    // charged and on what basis, so a rollback would itself be a financial-evidence loss.
    await q.query(`SELECT 1 FROM banking_operation_fee_bindings LIMIT 1`);
    throw new Error(
      'BankingFeeBinding1785753600604 is irreversible: it holds the authorized pricing evidence for financial operations',
    );
  }
}
