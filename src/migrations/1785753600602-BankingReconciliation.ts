import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D banking — reconciliation observations and exceptions.
 *
 * Reconciliation is where financial systems usually acquire the ability to quietly rewrite money.
 * This schema is shaped to remove that ability:
 *
 * - an observation is an **evidentiary record** of what the provider said at a moment in time. It is
 *   append-only. Correcting a previous observation means writing a new one, which is why
 *   `supersedes_observation_id` exists and why UPDATE is refused;
 * - a reconciliation exception is a **question**, not an answer. It records a difference and its
 *   evidence, and its resolution vocabulary has no "adjusted" value: an exception can be resolved as
 *   matched, accepted-with-reason, or escalated to a human investigation. There is no code path here
 *   that writes a ledger balance, because that is not reconciliation's job;
 * - every exception carries the observation that raised it, so a human can always see the evidence
 *   rather than a summary of it.
 */
export class BankingReconciliation1785753600602 implements MigrationInterface {
  name = 'BankingReconciliation1785753600602';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE banking_reconciliation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      -- Counts only. Deliberately no 'balance_adjustment_minor' column: a reconciliation run may not
      -- carry a money-movement amount, because reconciliation must never move money.
      observations integer NOT NULL DEFAULT 0 CHECK(observations >= 0),
      exceptions_raised integer NOT NULL DEFAULT 0 CHECK(exceptions_raised >= 0),
      state varchar(16) NOT NULL DEFAULT 'RUNNING'
        CHECK(state IN ('RUNNING','COMPLETED','FAILED','ABANDONED')),
      failure_code varchar(64),
      CHECK((state='RUNNING' AND completed_at IS NULL)
        OR (state<>'RUNNING' AND completed_at IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX idx_banking_recon_runs
      ON banking_reconciliation_runs(institution_id,started_at DESC)`);

    // ------------------------------------------------------- observations
    await q.query(`CREATE TABLE banking_provider_observations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      run_id uuid REFERENCES banking_reconciliation_runs(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL,
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      subject_type varchar(24) NOT NULL
        CHECK(subject_type IN ('INBOUND_PAYMENT','OUTBOUND_OPERATION','VIRTUAL_ACCOUNT','SETTLEMENT')),
      subject_reference varchar(128) NOT NULL,
      -- What the provider said. Not what we think it means.
      provider_status varchar(64),
      provider_amount_minor numeric(20,0),
      provider_reference varchar(128),
      observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      -- Corrections are new rows pointing at the old one; the old row is never edited.
      supersedes_observation_id uuid REFERENCES banking_provider_observations(id) ON DELETE RESTRICT,
      UNIQUE(id)
    )`);
    await q.query(`CREATE INDEX idx_banking_observations_subject
      ON banking_provider_observations(institution_id,subject_type,subject_reference,observed_at DESC)`);

    // --------------------------------------------------------- exceptions
    await q.query(`CREATE TABLE banking_reconciliation_exceptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      run_id uuid REFERENCES banking_reconciliation_runs(id) ON DELETE RESTRICT,
      observation_id uuid NOT NULL REFERENCES banking_provider_observations(id) ON DELETE RESTRICT,
      subject_type varchar(24) NOT NULL,
      subject_reference varchar(128) NOT NULL,
      kind varchar(32) NOT NULL CHECK(kind IN (
        'AMOUNT_MISMATCH','STATUS_MISMATCH','MISSING_AT_PROVIDER','MISSING_INTERNALLY',
        'DUPLICATE_AT_PROVIDER','UNVERIFIABLE')),
      -- The difference, recorded as observed. Never used to post anything.
      internal_amount_minor numeric(20,0),
      provider_amount_minor numeric(20,0),
      detail varchar(500) NOT NULL,
      severity varchar(16) NOT NULL DEFAULT 'REVIEW'
        CHECK(severity IN ('INFO','REVIEW','CRITICAL')),
      state varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','INVESTIGATING','RESOLVED')),
      -- Resolution vocabulary, deliberately without an 'ADJUSTED' option.
      resolution varchar(32)
        CHECK(resolution IS NULL OR resolution IN ('MATCHED','ACCEPTED_DIFFERENCE','ESCALATED')),
      resolved_by varchar(160),
      resolved_at timestamptz,
      resolution_note varchar(500),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK((state='OPEN' AND resolution IS NULL AND resolved_at IS NULL)
        OR (state IN ('INVESTIGATING','RESOLVED')
          AND (state='INVESTIGATING' OR (resolution IS NOT NULL AND resolved_at IS NOT NULL))))
    )`);
    await q.query(`CREATE INDEX idx_banking_exceptions_open
      ON banking_reconciliation_exceptions(institution_id,severity,created_at)
      WHERE state <> 'RESOLVED'`);
    // One open exception per subject per kind: a difference raises ONE question, no matter how many
    // times a run observes it. Repeated runs must not bury a real problem in duplicates.
    await q.query(`CREATE UNIQUE INDEX uq_banking_exception_open_subject
      ON banking_reconciliation_exceptions(institution_id,subject_type,subject_reference,kind)
      WHERE state <> 'RESOLVED'`);

    // ---------------------------------------------------- append-only guard
    await q.query(`CREATE FUNCTION public.banking_observation_append_only()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        -- An observation is evidence of what the provider said. Editing it later would let a
        -- reconciliation run manufacture agreement that never existed.
        IF TG_OP='UPDATE' THEN
          RAISE EXCEPTION 'Provider observations are append-only' USING ERRCODE='55000';
        END IF;
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Provider observations are never deleted' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_observation_append_only
      BEFORE UPDATE OR DELETE ON banking_provider_observations
      FOR EACH ROW EXECUTE FUNCTION public.banking_observation_append_only()`);

    await q.query(`CREATE FUNCTION public.banking_exception_guard()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Reconciliation exceptions are never deleted' USING ERRCODE='55000';
        END IF;
        -- The facts that raised the exception are immutable. A resolution may be recorded; the
        -- difference it was raised about may not be rewritten to look smaller.
        IF OLD.kind IS DISTINCT FROM NEW.kind
           OR OLD.subject_reference IS DISTINCT FROM NEW.subject_reference
           OR OLD.observation_id IS DISTINCT FROM NEW.observation_id
           OR OLD.internal_amount_minor IS DISTINCT FROM NEW.internal_amount_minor
           OR OLD.provider_amount_minor IS DISTINCT FROM NEW.provider_amount_minor THEN
          RAISE EXCEPTION 'Reconciliation exception evidence is immutable' USING ERRCODE='55000';
        END IF;
        -- A resolved exception stays resolved: reopening is a new exception, not an edit.
        IF OLD.state='RESOLVED' AND NEW.state<>'RESOLVED' THEN
          RAISE EXCEPTION 'A resolved reconciliation exception cannot be reopened' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_exception_guard
      BEFORE UPDATE OR DELETE ON banking_reconciliation_exceptions
      FOR EACH ROW EXECUTE FUNCTION public.banking_exception_guard()`);

    // ---------------------------------------------------------------- privileges
    await q.query(`REVOKE ALL ON public.banking_reconciliation_runs FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.banking_provider_observations FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.banking_reconciliation_exceptions FROM PUBLIC`);
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.banking_reconciliation_runs TO monienaija_runtime`,
    );
    // INSERT and SELECT only on observations: the trigger refuses the rest, the grant refuses it first.
    await q.query(
      `GRANT SELECT,INSERT ON public.banking_provider_observations TO monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.banking_reconciliation_exceptions TO monienaija_runtime`,
    );
    await q.query(
      `REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_reconciliation_runs FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_provider_observations FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.banking_reconciliation_exceptions FROM monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT ON public.banking_reconciliation_runs, public.banking_provider_observations,
        public.banking_reconciliation_exceptions TO monienaija_authority_core`,
    );
  }

  async down(): Promise<void> {
    // Refusing on purpose: this is the audit trail of what the provider reported versus what we
    // recorded. Dropping it would erase the only evidence of a difference that was investigated.
    return Promise.reject(
      new Error('Refusing to remove banking reconciliation history: it is financial evidence'),
    );
  }
}
