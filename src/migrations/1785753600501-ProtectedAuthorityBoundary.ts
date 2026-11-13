import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3 — shared protected checker authority.
 *
 * 0500 corrected institutional execution integrity but left the *issuance* side of maker-checker
 * in ordinary application tables: anything able to run ordinary runtime SQL could set an approval
 * to APPROVED, rewrite a workforce session token hash, or grant itself a checker role. This
 * migration adds the database half of the boundary:
 *
 *  - `monienaija_authority_core` — NOINHERIT group role that owns the `protected_authority`
 *    schema and the SECURITY DEFINER functions in it. Ordinary runtime credentials are not
 *    members and have no USAGE on the schema, so they cannot read or manufacture a checker
 *    decision or an approval consumption.
 *  - `monienaija_runtime` — NOINHERIT group role intended for the ordinary application login.
 *    Writes to workforce sessions, role assignments, the authorization catalogue and the
 *    protected governance approvals are revoked. Row level security on
 *    `privileged_action_approvals` allows runtime to keep using UNPROTECTED action types while
 *    denying every protected institutional/wallet/ledger action.
 *  - `protected_authority.checker_decisions` / `approval_consumptions` — immutable evidence
 *    written ONLY through the authority credential. A protected approval may not become APPROVED
 *    or CONSUMED without matching protected evidence, even when the writer is the schema owner.
 *
 * A database owner or superuser can still disable triggers, rewrite these tables or take over the
 * authority role. That is an infrastructure compromise, not the ordinary runtime credential
 * boundary this migration establishes; readiness refuses to run production on such a role.
 */
const PROTECTED_ACTIONS = `(
  'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
  'INSTITUTION_AGENT_AFFILIATION_CHANGE',
  'WALLET_OWNERSHIP_RESOLUTION',
  'LEDGER_JOURNAL_REVERSAL'
)`;

export class ProtectedAuthorityBoundary1785753600501 implements MigrationInterface {
  name = 'ProtectedAuthorityBoundary1785753600501';

  async up(q: QueryRunner): Promise<void> {
    // Roles are provisioned before migrations run in a real deployment (see
    // scripts/provision-database-roles.sql). The IF NOT EXISTS branch keeps disposable/local
    // databases usable; it requires CREATEROLE and fails closed with a clear error otherwise.
    await q.query(`SELECT pg_advisory_xact_lock(hashtext('monienaija:protected-authority:roles'))`);
    await q.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='monienaija_authority_core') THEN
          CREATE ROLE monienaija_authority_core NOLOGIN NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='monienaija_runtime') THEN
          CREATE ROLE monienaija_runtime NOLOGIN NOINHERIT;
        END IF;
      END $$`);
    // The migration role must be able to own objects in the protected schema. In production this
    // membership is granted by the provisioning script before migrations run.
    await q.query(`DO $$
      BEGIN
        BEGIN
          EXECUTE format('GRANT monienaija_authority_core TO %I', current_user);
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
      END $$`);

    await q.query(
      `CREATE SCHEMA IF NOT EXISTS protected_authority AUTHORIZATION monienaija_authority_core`,
    );
    await q.query(`REVOKE ALL ON SCHEMA protected_authority FROM PUBLIC`);
    await q.query(`REVOKE ALL ON SCHEMA protected_authority FROM monienaija_runtime`);
    await q.query(`GRANT USAGE ON SCHEMA protected_authority TO monienaija_authority_core`);

    // Privileges used by the SECURITY DEFINER guard/digest functions and by the 0500 evidence
    // triggers (which now execute as the authority role). Provisioning later broadens the
    // authority role's ordinary application access; these grants keep the boundary functional
    // even when migrations are applied without the optional provisioning step.
    await q.query(`GRANT USAGE ON SCHEMA public TO monienaija_authority_core`);
    for (const statement of [
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.privileged_action_approvals TO monienaija_authority_core`,
      `GRANT SELECT ON public.financial_institutions TO monienaija_authority_core`,
      `GRANT SELECT ON public.institution_agent_affiliations TO monienaija_authority_core`,
      `GRANT SELECT ON public.governed_institution_affiliations TO monienaija_authority_core`,
      `GRANT SELECT, INSERT ON public.governed_institution_lifecycle_executions TO monienaija_authority_core`,
      `GRANT SELECT, INSERT ON public.institution_affiliation_transition_evidence TO monienaija_authority_core`,
      `GRANT SELECT, INSERT ON public.governed_institution_affiliation_replay_results TO monienaija_authority_core`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA protected_authority TO monienaija_authority_core`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA protected_authority TO monienaija_authority_core`,
    ]) {
      await q.query(statement);
    }

    // Exact approved-payload digest. Computed server-side from the immutable approval row; never
    // accepted from the caller. Time zone is pinned so the timestamp rendering is stable.
    await q.query(`CREATE FUNCTION protected_authority.approval_payload_digest(p_id uuid)
      RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, protected_authority
      SET timezone = 'UTC'
      AS $$
        SELECT encode(sha256(convert_to(jsonb_build_object(
          'actionType', a.action_type,
          'resourceType', a.resource_type,
          'resourceId', a.resource_id,
          'customerId', a.customer_id,
          'actionFingerprint', a.action_fingerprint,
          'policy', a.policy,
          'approvalScope', a.approval_scope,
          'requiredAssurance', a.required_assurance,
          'requesterPrincipalId', a.requester_principal_id,
          'reason', a.reason,
          'requestedAt', a.requested_at,
          'expiresAt', a.expires_at
        )::text, 'UTF8')), 'hex')
        FROM public.privileged_action_approvals a WHERE a.id = p_id
      $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.approval_payload_digest(uuid) OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.approval_payload_digest(uuid) FROM PUBLIC`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.approval_payload_digest(uuid) TO monienaija_authority_core`,
    );

    await q.query(`CREATE TABLE protected_authority.checker_decisions (
      approval_id uuid PRIMARY KEY REFERENCES public.privileged_action_approvals(id) ON DELETE RESTRICT,
      action_type varchar(80) NOT NULL,
      action_fingerprint varchar(64) NOT NULL,
      payload_digest varchar(64) NOT NULL,
      decision varchar(16) NOT NULL,
      checker_principal_id varchar(160) NOT NULL,
      checker_session_id uuid NOT NULL,
      assurance_level varchar(16) NOT NULL,
      decided_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      reference uuid NOT NULL DEFAULT gen_random_uuid(),
      CONSTRAINT chk_checker_decision_vocabulary CHECK (decision IN ('APPROVED','REJECTED')),
      CONSTRAINT chk_checker_decision_mfa CHECK (assurance_level = 'MFA'),
      CONSTRAINT chk_checker_decision_expiry CHECK (expires_at > decided_at)
    )`);
    await q.query(
      `ALTER TABLE protected_authority.checker_decisions OWNER TO monienaija_authority_core`,
    );
    await q.query(`REVOKE ALL ON protected_authority.checker_decisions FROM PUBLIC`);

    await q.query(`CREATE TABLE protected_authority.approval_consumptions (
      approval_id uuid PRIMARY KEY REFERENCES public.privileged_action_approvals(id) ON DELETE RESTRICT,
      payload_digest varchar(64) NOT NULL,
      executor_principal_id varchar(160) NOT NULL,
      executor_session_id uuid NOT NULL,
      consumed_at timestamptz NOT NULL,
      reference uuid NOT NULL DEFAULT gen_random_uuid()
    )`);
    await q.query(
      `ALTER TABLE protected_authority.approval_consumptions OWNER TO monienaija_authority_core`,
    );
    await q.query(`REVOKE ALL ON protected_authority.approval_consumptions FROM PUBLIC`);

    // Protected evidence is append-only even for the authority role. A superseded decision must be
    // a new approval, never an edited audit trail.
    await q.query(`CREATE FUNCTION protected_authority.protected_evidence_immutable()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, protected_authority
      AS $$
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          RAISE EXCEPTION 'Protected checker evidence is immutable' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.protected_evidence_immutable() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.protected_evidence_immutable() FROM PUBLIC`,
    );
    await q.query(`CREATE TRIGGER checker_decisions_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON protected_authority.checker_decisions
      FOR EACH ROW EXECUTE FUNCTION protected_authority.protected_evidence_immutable()`);
    await q.query(`CREATE TRIGGER approval_consumptions_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON protected_authority.approval_consumptions
      FOR EACH ROW EXECUTE FUNCTION protected_authority.protected_evidence_immutable()`);

    // A protected approval can only reach APPROVED/CONSUMED with protected evidence that matches
    // its exact payload. This holds for every writer, including the schema owner; only a
    // superuser that disables triggers can bypass it, which is explicitly outside the boundary.
    await q.query(`CREATE FUNCTION protected_authority.approval_authority_guard()
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
    await q.query(
      `ALTER FUNCTION protected_authority.approval_authority_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.approval_authority_guard() FROM PUBLIC`,
    );
    await q.query(`CREATE TRIGGER privileged_action_approval_authority_guard
      BEFORE INSERT OR UPDATE ON public.privileged_action_approvals
      FOR EACH ROW EXECUTE FUNCTION protected_authority.approval_authority_guard()`);

    // Runtime keeps ordinary access to unprotected approvals (the rest of the maker-checker
    // estate is unchanged) but cannot touch a protected institutional/wallet/ledger row at all.
    await q.query(`ALTER TABLE public.privileged_action_approvals ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE public.privileged_action_approvals FORCE ROW LEVEL SECURITY`);
    await q.query(`CREATE POLICY approval_authority_full ON public.privileged_action_approvals
      FOR ALL TO monienaija_authority_core USING (true) WITH CHECK (true)`);
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

    // Authentication and authorization evidence: no ordinary runtime writes. Statements are
    // conditional because a historical-upgrade fixture may not contain every later table.
    await q.query(`DO $$
      DECLARE i integer;
      names text[] := ARRAY['a2_workforce_sessions', 'a2_finance_role_assignments', 'a2_workforce_bootstrap_consumptions', 'a2_super_admin_recovery_consumptions', 'local_admin_credentials', 'authorization_roles', 'authorization_functions', 'authorization_role_functions', 'governed_institution_lifecycle_executions', 'institution_affiliation_transition_evidence', 'governed_institution_affiliation_replay_results'];
      privileges text[] := ARRAY['ALL', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE', 'INSERT, UPDATE, DELETE'];
      BEGIN
        FOR i IN 1..array_length(names, 1) LOOP
          IF to_regclass('public.' || names[i]) IS NOT NULL THEN
            EXECUTE format('REVOKE %s ON public.%I FROM monienaija_runtime', privileges[i], names[i]);
          END IF;
        END LOOP;
        IF to_regclass('public.privileged_action_approvals') IS NOT NULL THEN
          EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.privileged_action_approvals FROM monienaija_runtime';
        END IF;
      END $$`);
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.protected_evidence_immutable() TO monienaija_authority_core`,
    );

    // 0500 evidence writers insert rows from inside triggers. Under a least-privilege runtime role
    // triggers run with invoker privileges, so those functions must execute as the authority role.
    // Without this, a correctly provisioned deployment could not record any execution evidence.
    for (const fn of [
      'institution_lifecycle_record_execution',
      'institution_affiliation_transition_integrity',
      'institution_affiliation_record_replay',
    ]) {
      // Move the trigger function into the protected schema (triggers keep referencing it by OID)
      // so it can be owned by the authority role without granting that role DDL rights on public.
      await q.query(`ALTER FUNCTION public.${fn}() SET SCHEMA protected_authority`);
      await q.query(`ALTER FUNCTION protected_authority.${fn}() SECURITY DEFINER`);
      await q.query(
        `ALTER FUNCTION protected_authority.${fn}() SET search_path = pg_catalog, public, protected_authority`,
      );
      await q.query(
        `ALTER FUNCTION protected_authority.${fn}() OWNER TO monienaija_authority_core`,
      );
      await q.query(`REVOKE ALL ON FUNCTION protected_authority.${fn}() FROM PUBLIC`);
      await q.query(
        `GRANT EXECUTE ON FUNCTION protected_authority.${fn}() TO monienaija_authority_core`,
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(new Error('Refusing to remove the protected checker authority boundary'));
  }
}
