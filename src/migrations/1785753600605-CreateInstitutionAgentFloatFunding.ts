import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Institutional agent operating-float funding.
 *
 * Until now an institution-attributed agent wallet could not be funded at all. `AgentFundingService`
 * refuses it explicitly, with the reason recorded in the code: the platform funding pool
 * (`AGENT_FUNDING_POOL-NGN`) is an unattributed platform liability and posting it into an
 * institution-attributed wallet would silently invent an institution-bound funding rail. That refusal
 * is correct and stays. What was missing is the *other* rail — the one where a verified bank transfer
 * into the institution's own account funds that institution's agent.
 *
 * This migration adds the durable records that rail needs. It adds **no ledger accounts**. Which
 * account receives the debit is a policy decision owned by the institution (its settlement asset),
 * and which account the float liability lands in is the agent's own wallet ledger account, which
 * already exists and is already institution-scoped. Creating accounts here would hard-code an
 * accounting policy this platform has no authority to invent.
 *
 * Three tables:
 *
 *  - `agent_float_funding_policies` — the approved policy that makes a class of inbound payment
 *    eligible to credit agent float. Versioned and explicitly activated; there is no implicit
 *    default, and production activation is a separate, independently authorized decision.
 *  - `agent_float_funding_receipts` — one row per actually-credited verified payment. The unique
 *    constraint on `(provider_key, environment, provider_reference_hash)` is what makes duplicate
 *    webhook delivery and concurrent workers collapse onto a single credit.
 *  - `agent_float_funding_obligations` — verified inbound funds that were *not* credited, kept
 *    durably instead of discarded, so an ineligible agent or a missing policy leaves an auditable
 *    obligation rather than a silently dropped customer payment.
 *
 * Migration identifier is inside Arena 3D's reserved range `1785753600600–1785753600699`.
 */
export class CreateInstitutionAgentFloatFunding1785753600605 implements MigrationInterface {
  name = 'CreateInstitutionAgentFloatFunding1785753600605';

  public async up(q: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------- approved funding policies
    await q.query(`CREATE TABLE agent_float_funding_policies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
      -- The institution's own settlement asset. A verified inbound payment debits this account: the
      -- money arrived in the institution's bank account, so the institution's asset grew. Posting the
      -- debit anywhere else would attribute one institution's cash to another.
      settlement_asset_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','APPROVED','ACTIVE','SUSPENDED','RETIRED')),
      -- Why this policy exists, in words a reviewer can act on. Not a comment column: an approved
      -- policy with no stated basis is not reviewable.
      purpose varchar(64) NOT NULL CHECK(purpose = 'AGENT_OPERATING_FLOAT'),
      terms jsonb NOT NULL DEFAULT '{}'::jsonb,
      approved_by varchar(128),
      approved_at timestamptz,
      activated_by varchar(128),
      activated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- A policy can only reach a later state through a recorded actor. Leaping straight to ACTIVE
      -- with no approver would let a migration or a seed script silently authorize funding.
      CHECK (status = 'DRAFT' OR approved_by IS NOT NULL),
      CHECK (status <> 'ACTIVE' OR (approved_at IS NOT NULL AND activated_at IS NOT NULL))
    )`);
    // At most one ACTIVE policy per institution/provider/environment/currency. Two active policies
    // would leave the receiving account choice to iteration order.
    await q.query(`CREATE UNIQUE INDEX uq_agent_float_policy_active
      ON agent_float_funding_policies (institution_id, provider_key, environment, currency)
      WHERE status = 'ACTIVE'`);
    await q.query(`CREATE INDEX idx_agent_float_policy_lookup
      ON agent_float_funding_policies (institution_id, provider_key, environment, status)`);

    // The settlement asset named by a policy must be that institution's own ledger account. Enforced
    // in the database because the check is cheap and the consequence of skipping it is posting one
    // institution's cash against another's ledger.
    await q.query(`
      CREATE FUNCTION agent_float_policy_asset_guard() RETURNS trigger AS $$
      DECLARE
        acct RECORD;
      BEGIN
        SELECT institutional_scope, institution_id, institutional_purpose, currency, is_active
          INTO acct
          FROM ledger_accounts WHERE id = NEW.settlement_asset_account_id;
        IF acct IS NULL THEN
          RAISE EXCEPTION 'agent float policy settlement asset % does not exist',
            NEW.settlement_asset_account_id;
        END IF;
        IF acct.institutional_scope <> 'INSTITUTION'
           OR acct.institution_id <> NEW.institution_id THEN
          RAISE EXCEPTION 'agent float policy settlement asset must be the same institution''s ledger account';
        END IF;
        IF acct.institutional_purpose IS DISTINCT FROM 'SETTLEMENT' THEN
          RAISE EXCEPTION 'agent float policy settlement asset must be a SETTLEMENT account, got %',
            COALESCE(acct.institutional_purpose, 'NULL');
        END IF;
        IF acct.currency <> NEW.currency THEN
          RAISE EXCEPTION 'agent float policy currency % does not match settlement asset currency %',
            NEW.currency, acct.currency;
        END IF;
        IF NOT acct.is_active THEN
          RAISE EXCEPTION 'agent float policy settlement asset is not active';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`CREATE TRIGGER trg_agent_float_policy_asset_guard
      BEFORE INSERT OR UPDATE OF settlement_asset_account_id, institution_id, currency
      ON agent_float_funding_policies
      FOR EACH ROW EXECUTE FUNCTION agent_float_policy_asset_guard()`);

    // ---------------------------------------------------------------- credited receipts
    await q.query(`CREATE TABLE agent_float_funding_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
      wallet_account_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      policy_id uuid NOT NULL REFERENCES agent_float_funding_policies(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      provider_transaction_reference varchar(128) NOT NULL,
      provider_reference_hash varchar(64) NOT NULL,
      currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
      amount_minor numeric(20,0) NOT NULL CHECK(amount_minor > 0),
      -- Which agent funding account the money arrived in. Part of the identity of the credit: float
      -- that arrived in some other account was not this agent's float.
      funding_account_number varchar(32) NOT NULL,
      settlement_asset_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      float_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
      journal_id uuid NOT NULL REFERENCES ledger_journals(id) ON DELETE RESTRICT,
      provider_observed_at timestamptz,
      credited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- Exactly-once. A replayed webhook, a duplicate verification, two workers racing and a restart
      -- after a partial commit all collide here instead of producing a second credit.
      CONSTRAINT uq_agent_float_receipt UNIQUE (provider_key, environment, provider_reference_hash)
    )`);
    await q.query(`CREATE INDEX idx_agent_float_receipt_wallet
      ON agent_float_funding_receipts (wallet_account_id, credited_at DESC)`);
    await q.query(`CREATE INDEX idx_agent_float_receipt_institution
      ON agent_float_funding_receipts (institution_id, credited_at DESC)`);
    // One journal, one float credit. Two receipts must never share a ledger journal, and the ledger
    // must never be reachable twice for the same receipt.
    await q.query(`CREATE UNIQUE INDEX uq_agent_float_receipt_journal
      ON agent_float_funding_receipts (journal_id)`);

    // Credit receipts are immutable. A financial record that can be edited in place is not evidence.
    await q.query(`
      CREATE FUNCTION agent_float_receipt_immutable() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'agent float funding receipts cannot be deleted';
        END IF;
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'agent float funding receipts cannot be modified';
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`CREATE TRIGGER trg_agent_float_receipt_immutable
      BEFORE UPDATE OR DELETE ON agent_float_funding_receipts
      FOR EACH ROW EXECUTE FUNCTION agent_float_receipt_immutable()`);

    // ---------------------------------------------------------------- uncredited obligations
    await q.query(`CREATE TABLE agent_float_funding_obligations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
      wallet_account_id uuid REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      provider_transaction_reference varchar(128) NOT NULL,
      provider_reference_hash varchar(64) NOT NULL,
      currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
      amount_minor numeric(20,0) NOT NULL CHECK(amount_minor > 0),
      funding_account_number varchar(32),
      -- Why the money is not float. A closed set, because "unresolved" with a free-text reason is
      -- indistinguishable from "nobody looked".
      reason varchar(48) NOT NULL CHECK(reason IN (
        'NO_ACTIVE_POLICY',
        'POLICY_NOT_OPERATIONAL',
        'AGENT_INELIGIBLE',
        'WALLET_NOT_AGENT_OWNED',
        'WALLET_NOT_INSTITUTION_ATTRIBUTED',
        'ACCOUNT_NOT_AGENT_FUNDING_ACCOUNT',
        'EVIDENCE_INSUFFICIENT',
        'PRODUCTION_EXECUTION_WITHHELD')),
      status varchar(24) NOT NULL DEFAULT 'OPEN'
        CHECK(status IN ('OPEN','UNDER_REVIEW','RESOLVED_CREDITED','RESOLVED_REJECTED')),
      review_owner varchar(128),
      resolution_evidence jsonb,
      resolved_at timestamptz,
      first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- Preserved, not discarded: a verified payment must never disappear because the policy was
      -- missing. Idempotent on the provider reference so repeated observations update the existing
      -- obligation rather than piling up duplicates.
      CONSTRAINT uq_agent_float_obligation UNIQUE (provider_key, environment, provider_reference_hash),
      CHECK (status NOT IN ('RESOLVED_CREDITED','RESOLVED_REJECTED')
             OR (resolution_evidence IS NOT NULL AND resolved_at IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX idx_agent_float_obligation_open
      ON agent_float_funding_obligations (institution_id, status, first_observed_at)`);

    // An obligation cannot be closed as credited here. Crediting is proven by a receipt row; closing
    // the obligation is bookkeeping *about* that receipt, and allowing it to imply a credit would give
    // operations a way to declare money moved without money moving.
    await q.query(`
      CREATE FUNCTION agent_float_obligation_resolution_guard() RETURNS trigger AS $$
      DECLARE
        receipt_count integer;
      BEGIN
        IF NEW.status = 'RESOLVED_CREDITED' THEN
          SELECT count(*) INTO receipt_count
            FROM agent_float_funding_receipts
           WHERE provider_key = NEW.provider_key
             AND environment = NEW.environment
             AND provider_reference_hash = NEW.provider_reference_hash;
          IF receipt_count = 0 THEN
            RAISE EXCEPTION 'obligation cannot be resolved as credited without a funding receipt';
          END IF;
        END IF;
        NEW.last_observed_at := clock_timestamp();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`CREATE TRIGGER trg_agent_float_obligation_resolution_guard
      BEFORE UPDATE ON agent_float_funding_obligations
      FOR EACH ROW EXECUTE FUNCTION agent_float_obligation_resolution_guard()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Financial evidence is not rolled back by dropping the tables that hold it. The operator must
    // export and archive first; this migration deliberately makes the destructive path explicit and
    // ordered rather than automatic.
    await q.query(`DROP TRIGGER IF EXISTS trg_agent_float_obligation_resolution_guard
      ON agent_float_funding_obligations`);
    await q.query(`DROP FUNCTION IF EXISTS agent_float_obligation_resolution_guard()`);
    await q.query(`DROP TABLE IF EXISTS agent_float_funding_obligations`);
    await q.query(`DROP TRIGGER IF EXISTS trg_agent_float_receipt_immutable
      ON agent_float_funding_receipts`);
    await q.query(`DROP FUNCTION IF EXISTS agent_float_receipt_immutable()`);
    await q.query(`DROP TABLE IF EXISTS agent_float_funding_receipts`);
    await q.query(`DROP TRIGGER IF EXISTS trg_agent_float_policy_asset_guard
      ON agent_float_funding_policies`);
    await q.query(`DROP FUNCTION IF EXISTS agent_float_policy_asset_guard()`);
    await q.query(`DROP TABLE IF EXISTS agent_float_funding_policies`);
  }
}
