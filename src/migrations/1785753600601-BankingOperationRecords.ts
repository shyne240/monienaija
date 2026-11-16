import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D banking — durable provider-facing operation records.
 *
 * Three record families, one principle: the database must be able to answer "what did we ask the
 * provider to do, and what do we actually know" without consulting application memory. Every table
 * here therefore separates what we *sent* from what we *learned*, and none of them has a column that
 * lets a caller assert an outcome the provider never reported.
 *
 * 1. `banking_virtual_account_reservations` — the provisioning attempt against a provider. The
 *    existing `virtual_accounts` table stays authoritative for wallet-visible accounts; this table
 *    records the provider conversation that produced them, including attempts that produced nothing.
 *    `outcome = 'UNKNOWN'` is a normal, expected state: it means we asked and cannot tell.
 * 2. `banking_inbound_payments` — verified incoming credits, keyed by the provider's own reference so
 *    a replayed webhook cannot double-credit. Gross amount, provider fee and the credited amount are
 *    three distinct columns because collapsing them is how fee reconciliation silently loses money.
 * 3. `banking_outbound_operations` — the durable dispatch state for a transfer. This is the table
 *    that makes "never generate a fresh provider reference to retry an uncertain submission"
 *    enforceable: the provider reference is written once and a trigger refuses to change it.
 *
 * Deliberate omissions: there is no `marked_successful_by` column, no arbitrary balance adjustment,
 * and no path that lets a human write a provider outcome. Recovery moves uncertain records into
 * `MANUAL_REVIEW` for a human to *investigate*; it does not let them assert what happened.
 */
export class BankingOperationRecords1785753600601 implements MigrationInterface {
  name = 'BankingOperationRecords1785753600601';

  async up(q: QueryRunner): Promise<void> {
    // ------------------------------------------------- virtual account provisioning
    await q.query(`CREATE TABLE banking_virtual_account_reservations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      wallet_id uuid NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      -- Our reference, generated once. Reused for every status enquiry so the provider sees the same
      -- operation, never a fresh one.
      account_reference varchar(64) NOT NULL CHECK(account_reference ~ '^[A-Za-z0-9_-]{6,64}$'),
      currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
      -- Our own outcome vocabulary, not the provider's. 'UNKNOWN' is legitimate and expected.
      outcome varchar(16) NOT NULL DEFAULT 'REQUESTED'
        CHECK(outcome IN ('REQUESTED','PROVISIONED','PENDING','UNKNOWN','REJECTED')),
      provider_status varchar(64),
      provider_reservation_reference varchar(128),
      request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      -- Timestamps of the last attempt, not of success. A record can be attempted and still unknown.
      last_attempted_at timestamptz,
      last_failure_code varchar(64),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- One attempt record per (wallet, provider, reference): a second row under the same reference
      -- would mean we asked twice for the same thing, which the provider reference discipline forbids.
      UNIQUE(institution_id,provider_key,environment,account_reference)
    )`);
    await q.query(`CREATE INDEX idx_banking_var_wallet
      ON banking_virtual_account_reservations(wallet_id,created_at DESC)`);
    // At most one UNKNOWN reservation per wallet/provider/environment may exist at a time. Two
    // unknowns mean two possible accounts at the provider, which is exactly the ambiguity that must
    // be resolved by enquiry rather than by another submission.
    await q.query(`CREATE UNIQUE INDEX uq_banking_var_open_unknown
      ON banking_virtual_account_reservations(institution_id,provider_key,environment,wallet_id)
      WHERE outcome='UNKNOWN'`);

    // ---------------------------------------------------------- inbound payments
    await q.query(`CREATE TABLE banking_inbound_payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      -- The provider's transaction reference. This is the dedupe key: a replayed webhook collides
      -- here rather than producing a second credit.
      provider_transaction_reference varchar(128) NOT NULL,
      provider_payment_reference varchar(128),
      reservation_id uuid REFERENCES banking_virtual_account_reservations(id) ON DELETE RESTRICT,
      receiving_account_number varchar(32),
      receiving_bank_code varchar(20),
      currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
      -- Three separate amounts on purpose. gross = fee + credited is a reconciliation invariant, not
      -- something to infer at reporting time.
      gross_amount_minor numeric(20,0) NOT NULL CHECK(gross_amount_minor > 0),
      provider_fee_minor numeric(20,0) NOT NULL DEFAULT 0 CHECK(provider_fee_minor >= 0),
      credited_amount_minor numeric(20,0) NOT NULL CHECK(credited_amount_minor >= 0),
      paid_at timestamptz,
      verification_state varchar(16) NOT NULL DEFAULT 'UNVERIFIED'
        CHECK(verification_state IN ('UNVERIFIED','VERIFIED','REJECTED','UNKNOWN')),
      -- Where the money went internally, if anywhere. Nullable on purpose: a verified payment whose
      -- posting has not happened yet is a real state, not an error.
      ledger_transaction_id uuid,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(institution_id,provider_key,environment,provider_transaction_reference),
      CHECK(provider_fee_minor <= gross_amount_minor),
      CHECK(credited_amount_minor = gross_amount_minor - provider_fee_minor)
    )`);
    await q.query(`CREATE INDEX idx_banking_inbound_reservation
      ON banking_inbound_payments(reservation_id,paid_at DESC)`);
    await q.query(`CREATE INDEX idx_banking_inbound_unposted
      ON banking_inbound_payments(institution_id,recorded_at)
      WHERE ledger_transaction_id IS NULL AND verification_state='VERIFIED'`);

    // --------------------------------------------------------- outbound operations
    // The provider reference is immutable once written. This is the mechanism, not a convention: a
    // retry that generated a new reference would be a second transfer, and the trigger makes that
    // impossible for every code path including a future one nobody has written yet.
    await q.query(`CREATE TABLE banking_outbound_operations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      -- Our operation reference. Generated once at CREATED and never regenerated.
      operation_reference varchar(64) NOT NULL CHECK(operation_reference ~ '^[A-Za-z0-9_-]{6,64}$'),
      external_operation_id uuid,
      wallet_id uuid REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
      currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
      amount_minor numeric(20,0) NOT NULL CHECK(amount_minor > 0),
      destination_bank_code varchar(20) NOT NULL,
      destination_account_number varchar(32) NOT NULL CHECK(destination_account_number ~ '^[0-9]{4,32}$'),
      destination_account_name varchar(160),
      state varchar(24) NOT NULL DEFAULT 'CREATED'
        CHECK(state IN ('CREATED','SUBMITTING','PENDING_PROVIDER','PENDING_VERIFICATION','UNKNOWN',
                        'MANUAL_REVIEW','SUCCESSFUL','REVERSED','FAILED','CANCELLED')),
      provider_status varchar(64),
      provider_transaction_reference varchar(128),
      -- Distinct from the transaction reference: an OTP challenge is not an accepted transfer.
      requires_additional_authorization boolean NOT NULL DEFAULT false,
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      last_attempted_at timestamptz,
      last_failure_code varchar(64),
      submitted_at timestamptz,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(institution_id,provider_key,environment,operation_reference),
      -- A resolved record must say what the provider said. An outcome with no evidence is a guess.
      CHECK((state IN ('SUCCESSFUL','REVERSED','FAILED')) <= (resolved_at IS NOT NULL)),
      -- Terminal states are mutually exclusive with the unknown family by construction.
      CHECK(NOT (state='UNKNOWN' AND resolved_at IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX idx_banking_outbound_state
      ON banking_outbound_operations(institution_id,state,updated_at DESC)`);
    // The recovery worklist: uncertain operations that nobody has picked up. A transfer must never sit
    // in UNKNOWN without being visible to an operator.
    await q.query(`CREATE INDEX idx_banking_outbound_unknown
      ON banking_outbound_operations(institution_id,updated_at)
      WHERE state IN ('UNKNOWN','MANUAL_REVIEW')`);

    // ---------------------------------------------- provider reference immutability
    await q.query(`CREATE FUNCTION public.banking_outbound_reference_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        -- DELETE is handled first: on DELETE, NEW is NULL, so any comparison against NEW in this
        -- branch would silently evaluate to NULL and let the delete through.
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Banking outbound operations are never deleted' USING ERRCODE='55000';
        END IF;
        -- The reference identifies one attempt at the provider. Changing it would silently turn a
        -- retry of an uncertain submission into a second, distinct transfer.
        IF OLD.operation_reference IS DISTINCT FROM NEW.operation_reference THEN
          RAISE EXCEPTION 'Banking operation reference is immutable' USING ERRCODE='55000';
        END IF;
        -- Nor may a provider transaction reference be rewritten once recorded, or two attempts could
        -- be made to look like one.
        IF OLD.provider_transaction_reference IS NOT NULL
           AND OLD.provider_transaction_reference IS DISTINCT FROM NEW.provider_transaction_reference THEN
          RAISE EXCEPTION 'Provider transaction reference is immutable once recorded' USING ERRCODE='55000';
        END IF;
        NEW.updated_at := clock_timestamp();
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_outbound_reference_immutable
      BEFORE UPDATE OR DELETE ON banking_outbound_operations
      FOR EACH ROW EXECUTE FUNCTION public.banking_outbound_reference_immutable()`);

    // ------------------------------------------------ inbound evidence immutability
    await q.query(`CREATE FUNCTION public.banking_inbound_evidence_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Verified inbound payments are never deleted' USING ERRCODE='55000';
        END IF;
        -- Amounts and the provider reference are evidence about what a customer actually paid.
        -- Restating them later would rewrite history; a correction is a new record, not an edit.
        IF OLD.gross_amount_minor IS DISTINCT FROM NEW.gross_amount_minor
           OR OLD.provider_fee_minor IS DISTINCT FROM NEW.provider_fee_minor
           OR OLD.credited_amount_minor IS DISTINCT FROM NEW.credited_amount_minor
           OR OLD.provider_transaction_reference IS DISTINCT FROM NEW.provider_transaction_reference
           OR OLD.currency IS DISTINCT FROM NEW.currency THEN
          RAISE EXCEPTION 'Inbound payment evidence is immutable' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_inbound_evidence_immutable
      BEFORE UPDATE OR DELETE ON banking_inbound_payments
      FOR EACH ROW EXECUTE FUNCTION public.banking_inbound_evidence_immutable()`);

    // ---------------------------------------------------------------- privileges
    // These tables are written by ordinary application code on the runtime connection, so unlike the
    // governance tables they are granted to the runtime role directly. They are still never writable
    // by PUBLIC, and the triggers above constrain what a write may do.
    await q.query(`REVOKE ALL ON public.banking_virtual_account_reservations FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.banking_inbound_payments FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.banking_outbound_operations FROM PUBLIC`);
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.banking_virtual_account_reservations TO monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.banking_inbound_payments TO monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.banking_outbound_operations TO monienaija_runtime`,
    );
    // No DELETE for anyone: financial evidence is never removed.
    await q.query(
      `REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_virtual_account_reservations FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_inbound_payments FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_outbound_operations FROM monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT ON public.banking_virtual_account_reservations, public.banking_inbound_payments,
        public.banking_outbound_operations TO monienaija_authority_core`,
    );
  }

  async down(): Promise<void> {
    // Refusing on purpose. These tables hold records of what was asked of a bank; dropping them would
    // destroy the only evidence of whether an uncertain transfer was ever submitted.
    return Promise.reject(
      new Error('Refusing to remove banking operation records: they are financial evidence'),
    );
  }
}
