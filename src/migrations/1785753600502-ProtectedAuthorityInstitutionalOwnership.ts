import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 4 Phase 2 adds two more financially consequential governed actions:
 * `WALLET_INSTITUTION_ATTRIBUTION` and `CUSTOMER_INSTITUTION_ENROLMENT_CHANGE`. They were added
 * after the protected checker authority boundary and must use the same contract; otherwise the
 * newly-added wallet attribution path would reintroduce the exact forgery the boundary closed.
 *
 * This migration extends (never rewrites) 1785753600501: the guard function and the row level
 * security policies are replaced with the six-action list, and runtime is denied direct writes on
 * the new immutable attribution execution evidence. Existing pre-0502 approvals for these actions
 * have no protected decision and are conservatively non-executable; a fresh request is required.
 */
const PROTECTED_ACTIONS = `(
  'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
  'INSTITUTION_AGENT_AFFILIATION_CHANGE',
  'WALLET_OWNERSHIP_RESOLUTION',
  'LEDGER_JOURNAL_REVERSAL',
  'WALLET_INSTITUTION_ATTRIBUTION',
  'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE'
)`;

export class ProtectedAuthorityInstitutionalOwnership1785753600502 implements MigrationInterface {
  name = 'ProtectedAuthorityInstitutionalOwnership1785753600502';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.approval_authority_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, protected_authority
      AS $$
      DECLARE d protected_authority.checker_decisions%ROWTYPE;
              c protected_authority.approval_consumptions%ROWTYPE;
      BEGIN
        IF NEW.action_type NOT IN ${PROTECTED_ACTIONS} THEN
          RETURN NEW;
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.status <> 'REQUESTED' OR NEW.approved_by IS NOT NULL
            OR NEW.consumed_at IS NOT NULL OR NEW.approver_session_id IS NOT NULL THEN
            RAISE EXCEPTION 'Protected approval must be requested through the protected authority'
              USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
          RAISE EXCEPTION 'Protected checker identity is immutable' USING ERRCODE='55000';
        END IF;
        IF NEW.status IN ('APPROVED','CONSUMED') THEN
          SELECT * INTO d FROM protected_authority.checker_decisions WHERE approval_id = NEW.id;
          IF NOT FOUND OR d.decision <> 'APPROVED'
            OR d.checker_principal_id IS DISTINCT FROM NEW.approved_by
            OR d.checker_session_id IS DISTINCT FROM NEW.approver_session_id
            OR d.action_type IS DISTINCT FROM NEW.action_type
            OR d.action_fingerprint IS DISTINCT FROM NEW.action_fingerprint
            OR d.payload_digest IS DISTINCT FROM protected_authority.approval_payload_digest(NEW.id)
            OR d.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'Protected approval lacks a matching checker decision'
              USING ERRCODE='55000';
          END IF;
        END IF;
        IF NEW.status = 'CONSUMED' AND OLD.status IS DISTINCT FROM 'CONSUMED' THEN
          SELECT * INTO c FROM protected_authority.approval_consumptions WHERE approval_id = NEW.id;
          IF NOT FOUND
            OR c.payload_digest IS DISTINCT FROM protected_authority.approval_payload_digest(NEW.id) THEN
            RAISE EXCEPTION 'Protected approval lacks matching protected consumption evidence'
              USING ERRCODE='55000';
          END IF;
        END IF;
        RETURN NEW;
      END $$`);

    for (const policy of [
      'approval_runtime_read',
      'approval_runtime_insert',
      'approval_runtime_update',
      'approval_runtime_delete',
    ]) {
      await q.query(`DROP POLICY IF EXISTS ${policy} ON public.privileged_action_approvals`);
    }
    await q.query(`CREATE POLICY approval_runtime_read ON public.privileged_action_approvals
      FOR SELECT TO monienaija_runtime USING (true)`);
    await q.query(`CREATE POLICY approval_runtime_insert ON public.privileged_action_approvals
      FOR INSERT TO monienaija_runtime WITH CHECK (
        action_type NOT IN ${PROTECTED_ACTIONS} AND status = 'REQUESTED'
        AND approved_by IS NULL AND consumed_at IS NULL)`);
    await q.query(`CREATE POLICY approval_runtime_update ON public.privileged_action_approvals
      FOR UPDATE TO monienaija_runtime USING (action_type NOT IN ${PROTECTED_ACTIONS})
      WITH CHECK (action_type NOT IN ${PROTECTED_ACTIONS})`);
    await q.query(`CREATE POLICY approval_runtime_delete ON public.privileged_action_approvals
      FOR DELETE TO monienaija_runtime USING (action_type NOT IN ${PROTECTED_ACTIONS})`);

    await q.query(`DO $$
      BEGIN
        IF to_regclass('public.governed_wallet_institution_attributions') IS NOT NULL THEN
          EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.governed_wallet_institution_attributions FROM monienaija_runtime';
          EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.governed_wallet_institution_attributions FROM monienaija_runtime';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.governed_wallet_institution_attributions TO monienaija_authority_core';
        END IF;
      END $$`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to remove the protected institutional ownership boundary'),
    );
  }
}
