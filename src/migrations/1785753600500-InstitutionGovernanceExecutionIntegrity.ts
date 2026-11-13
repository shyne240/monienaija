import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correct the published 0400 guards without rewriting them. Legacy institutional approvals are
 * conservatively tombstoned: 0400 had no trustworthy immutable lifecycle execution snapshot.
 */
export class InstitutionGovernanceExecutionIntegrity1785753600500 implements MigrationInterface {
  name = 'InstitutionGovernanceExecutionIntegrity1785753600500';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE FUNCTION institution_approval_payload_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.action_type IN ('FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE','INSTITUTION_AGENT_AFFILIATION_CHANGE') THEN
          IF NEW.action_type IS DISTINCT FROM OLD.action_type OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
            OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
            OR NEW.action_fingerprint IS DISTINCT FROM OLD.action_fingerprint OR NEW.policy IS DISTINCT FROM OLD.policy
            OR NEW.approval_scope IS DISTINCT FROM OLD.approval_scope OR NEW.required_assurance IS DISTINCT FROM OLD.required_assurance
            OR NEW.requester_principal_id IS DISTINCT FROM OLD.requester_principal_id
            OR NEW.requester_session_id IS DISTINCT FROM OLD.requester_session_id OR NEW.reason IS DISTINCT FROM OLD.reason
            OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
            OR (OLD.status='CONSUMED' AND NEW IS DISTINCT FROM OLD) THEN
            RAISE EXCEPTION 'Institution approval payload is immutable' USING ERRCODE='55000';
          END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_approval_payload_immutable
      BEFORE UPDATE ON privileged_action_approvals FOR EACH ROW EXECUTE FUNCTION institution_approval_payload_immutable()`);

    await q.query(`CREATE TABLE governed_institution_lifecycle_executions (
      approval_id uuid PRIMARY KEY REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
      institution_id uuid REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      previous_status varchar(24), target_status varchar(24), reason varchar(500),
      result_snapshot jsonb, legacy_reserved boolean NOT NULL DEFAULT false,
      executed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK ((legacy_reserved AND institution_id IS NULL AND result_snapshot IS NULL)
         OR (NOT legacy_reserved AND institution_id IS NOT NULL AND result_snapshot IS NOT NULL
             AND previous_status IS NOT NULL AND target_status IS NOT NULL AND reason IS NOT NULL))
    )`);
    // Pre-0500 approval metadata has no immutable binding to its fingerprint; reserve all such
    // approvals and require a fresh request. Never invent an execution or silently reopen one.
    await q.query(`INSERT INTO governed_institution_lifecycle_executions (approval_id, legacy_reserved)
      SELECT id, true FROM privileged_action_approvals
       WHERE action_type='FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE'
         AND resource_type='FINANCIAL_INSTITUTION'`);

    await q.query(`CREATE FUNCTION institution_lifecycle_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE a privileged_action_approvals%ROWTYPE;
      BEGIN
        IF NEW.status IS NOT DISTINCT FROM OLD.status OR
          (OLD.status = 'REGISTERED' AND NEW.status = 'EVIDENCE_SUBMITTED') THEN RETURN NEW; END IF;
        SELECT * INTO a FROM privileged_action_approvals WHERE id=NEW.lifecycle_approval_id FOR SHARE;
        IF NOT FOUND OR a.status <> 'CONSUMED' OR a.action_type <> 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE'
          OR a.resource_type <> 'FINANCIAL_INSTITUTION' OR lower(coalesce(a.resource_id,'')) <> NEW.id::text
          OR a.customer_id IS NOT NULL OR a.approved_by IS NULL OR a.approved_by = a.requester_principal_id
          OR a.required_assurance <> 'MFA'
          OR a.policy->'requestDetails'->>'institutionId' IS DISTINCT FROM NEW.id::text
          OR a.policy->'requestDetails'->>'currentStatus' IS DISTINCT FROM OLD.status
          OR a.policy->'requestDetails'->>'targetStatus' IS DISTINCT FROM NEW.status
          OR a.reason IS DISTINCT FROM NEW.status_reason THEN
          RAISE EXCEPTION 'Institution lifecycle transition does not match consumed approval' USING ERRCODE='55000';
        END IF;
        IF EXISTS (SELECT 1 FROM governed_institution_lifecycle_executions WHERE approval_id=a.id) THEN
          RAISE EXCEPTION 'Institution lifecycle approval already used or reserved' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_lifecycle_integrity_guard
      BEFORE UPDATE ON financial_institutions FOR EACH ROW EXECUTE FUNCTION institution_lifecycle_integrity_guard()`);
    await q.query(`CREATE FUNCTION institution_lifecycle_record_execution() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT
          (OLD.status='REGISTERED' AND NEW.status='EVIDENCE_SUBMITTED') THEN
          INSERT INTO governed_institution_lifecycle_executions
            (approval_id, institution_id, previous_status, target_status, reason, result_snapshot)
          VALUES (NEW.lifecycle_approval_id, NEW.id, OLD.status, NEW.status, NEW.status_reason, to_jsonb(NEW));
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_lifecycle_record_execution
      AFTER UPDATE ON financial_institutions FOR EACH ROW EXECUTE FUNCTION institution_lifecycle_record_execution()`);
    await q.query(`CREATE FUNCTION institution_execution_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP <> 'INSERT' OR pg_trigger_depth() < 2 THEN
          RAISE EXCEPTION 'Institution execution evidence is immutable and trigger-generated' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_lifecycle_execution_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON governed_institution_lifecycle_executions
      FOR EACH ROW EXECUTE FUNCTION institution_execution_evidence_guard()`);

    await q.query(`CREATE TABLE institution_affiliation_transition_evidence (
      approval_id uuid NOT NULL REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
      step varchar(16) NOT NULL, affiliation_id uuid REFERENCES institution_agent_affiliations(id) ON DELETE RESTRICT,
      before_state jsonb, after_state jsonb,
      PRIMARY KEY (approval_id, step),
      CHECK (step IN ('LEGACY','OLD','NEW'))
    )`);
    await q.query(`INSERT INTO institution_affiliation_transition_evidence (approval_id,step)
      SELECT id,'LEGACY' FROM privileged_action_approvals
      WHERE action_type='INSTITUTION_AGENT_AFFILIATION_CHANGE' AND resource_type='AGENT'`);
    await q.query(`CREATE TRIGGER institution_affiliation_transition_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON institution_affiliation_transition_evidence
      FOR EACH ROW EXECUTE FUNCTION institution_execution_evidence_guard()`);
    await q.query(`CREATE FUNCTION institution_affiliation_transition_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE a privileged_action_approvals%ROWTYPE; d jsonb; k text; step_name text;
      BEGIN
        SELECT * INTO a FROM privileged_action_approvals WHERE id=NEW.approval_id FOR SHARE;
        d := a.policy->'requestDetails'; k := d->>'changeKind';
        IF NOT FOUND OR a.status <> 'CONSUMED' OR a.action_type <> 'INSTITUTION_AGENT_AFFILIATION_CHANGE'
          OR a.resource_type <> 'AGENT' OR lower(coalesce(a.resource_id,'')) <> NEW.agent_id::text
          OR a.customer_id IS NOT NULL OR a.approved_by IS NULL OR a.approved_by = a.requester_principal_id
          OR a.required_assurance <> 'MFA' OR d->>'agentId' IS DISTINCT FROM NEW.agent_id::text
          OR EXISTS (SELECT 1 FROM governed_institution_affiliations WHERE approval_id=a.id)
          OR EXISTS (SELECT 1 FROM institution_affiliation_transition_evidence WHERE approval_id=a.id AND step='LEGACY') THEN
          RAISE EXCEPTION 'Affiliation approval invalid or already used' USING ERRCODE='55000';
        END IF;
        IF TG_OP='INSERT' THEN
          step_name := 'NEW';
          IF k NOT IN ('ASSIGN','TRANSFER') OR d->>'institutionId' IS DISTINCT FROM NEW.institution_id::text
            OR d->>'evidenceType' IS DISTINCT FROM NEW.evidence_type
            OR d->>'evidenceReference' IS DISTINCT FROM NEW.evidence_reference OR NEW.status <> 'ACTIVE'
            OR (k='ASSIGN' AND (d->>'currentAffiliationId' IS NOT NULL OR d->>'currentStatus' IS NOT NULL)) THEN
            RAISE EXCEPTION 'Affiliation insertion does not match approved payload' USING ERRCODE='55000';
          END IF;
        ELSE
          step_name := 'OLD';
          IF d->>'currentAffiliationId' IS DISTINCT FROM OLD.id::text
            OR d->>'currentInstitutionId' IS DISTINCT FROM OLD.institution_id::text
            OR d->>'currentStatus' IS DISTINCT FROM OLD.status
            OR (k <> 'TRANSFER' AND d->>'institutionId' IS DISTINCT FROM OLD.institution_id::text)
            OR NOT ((k='TRANSFER' AND OLD.status='ACTIVE' AND NEW.status='TERMINATED')
              OR (k='SUSPEND' AND OLD.status='ACTIVE' AND NEW.status='SUSPENDED')
              OR (k='REACTIVATE' AND OLD.status='SUSPENDED' AND NEW.status='ACTIVE')
              OR (k='TERMINATE' AND NEW.status='TERMINATED')) THEN
            RAISE EXCEPTION 'Affiliation transition does not match approved payload' USING ERRCODE='55000';
          END IF;
        END IF;
        INSERT INTO institution_affiliation_transition_evidence (approval_id,step,affiliation_id,before_state,after_state)
          VALUES (NEW.approval_id,step_name,NEW.id,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_affiliation_transition_integrity
      AFTER INSERT OR UPDATE ON institution_agent_affiliations FOR EACH ROW EXECUTE FUNCTION institution_affiliation_transition_integrity()`);
    await q.query(`CREATE FUNCTION institution_affiliation_verify_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE g governed_institution_affiliations%ROWTYPE; a privileged_action_approvals%ROWTYPE; d jsonb; k text; n integer;
      BEGIN
        SELECT * INTO g FROM governed_institution_affiliations WHERE approval_id=NEW.approval_id;
        SELECT * INTO a FROM privileged_action_approvals WHERE id=NEW.approval_id;
        d := a.policy->'requestDetails'; k := d->>'changeKind';
        SELECT count(*) INTO n FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id;
        IF g.approval_id IS NULL OR g.agent_id::text IS DISTINCT FROM d->>'agentId'
          OR g.institution_id::text IS DISTINCT FROM d->>'institutionId'
          OR g.previous_institution_id::text IS DISTINCT FROM d->>'currentInstitutionId'
          OR g.change_kind IS DISTINCT FROM k OR g.evidence_type IS DISTINCT FROM d->>'evidenceType'
          OR g.evidence_reference IS DISTINCT FROM d->>'evidenceReference' OR g.reason IS DISTINCT FROM a.reason
          OR g.affiliation_id IS DISTINCT FROM (SELECT affiliation_id FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id AND step=CASE WHEN k IN ('ASSIGN','TRANSFER') THEN 'NEW' ELSE 'OLD' END)
          OR n <> (CASE WHEN k='TRANSFER' THEN 2 ELSE 1 END)
          OR (k='TRANSFER' AND NOT EXISTS (SELECT 1 FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id AND step='OLD')) THEN
          RAISE EXCEPTION 'Affiliation transition requires matching immutable execution evidence' USING ERRCODE='55000';
        END IF;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER institution_affiliation_verify_commit
      AFTER INSERT ON institution_affiliation_transition_evidence DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION institution_affiliation_verify_commit()`);

    await q.query(`CREATE FUNCTION institution_affiliation_execution_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE a privileged_action_approvals%ROWTYPE; d jsonb; k text; n integer;
      BEGIN
        SELECT * INTO a FROM privileged_action_approvals WHERE id=NEW.approval_id FOR SHARE;
        d := a.policy->'requestDetails'; k := d->>'changeKind';
        SELECT count(*) INTO n FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id;
        IF a.status <> 'CONSUMED' OR NEW.agent_id::text IS DISTINCT FROM d->>'agentId'
          OR NEW.institution_id::text IS DISTINCT FROM d->>'institutionId'
          OR NEW.previous_institution_id::text IS DISTINCT FROM d->>'currentInstitutionId'
          OR NEW.change_kind IS DISTINCT FROM k OR NEW.evidence_type IS DISTINCT FROM d->>'evidenceType'
          OR NEW.evidence_reference IS DISTINCT FROM d->>'evidenceReference' OR NEW.reason IS DISTINCT FROM a.reason
          OR NEW.evidence_digest IS DISTINCT FROM encode(sha256(convert_to(
            '{"agentId":' || to_json(d->>'agentId')::text ||
            ',"changeKind":' || to_json(d->>'changeKind')::text ||
            ',"evidenceReference":' || to_json(d->>'evidenceReference')::text ||
            ',"evidenceType":' || to_json(d->>'evidenceType')::text ||
            ',"institutionId":' || to_json(d->>'institutionId')::text ||
            ',"reason":' || to_json(a.reason)::text || '}', 'UTF8')), 'hex')
          OR (k IN ('ASSIGN','TRANSFER') AND NEW.evidence_digest IS DISTINCT FROM
            (SELECT after_state->>'evidence_digest' FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id AND step='NEW'))
          OR NEW.affiliation_id IS DISTINCT FROM (SELECT affiliation_id FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id AND step=CASE WHEN k IN ('ASSIGN','TRANSFER') THEN 'NEW' ELSE 'OLD' END)
          OR n <> (CASE WHEN k='TRANSFER' THEN 2 ELSE 1 END)
          OR (k='TRANSFER' AND NOT EXISTS (SELECT 1 FROM institution_affiliation_transition_evidence WHERE approval_id=NEW.approval_id AND step='OLD')) THEN
          RAISE EXCEPTION 'Affiliation execution requires matching approved transition' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_affiliation_execution_integrity
      BEFORE INSERT ON governed_institution_affiliations FOR EACH ROW EXECUTE FUNCTION institution_affiliation_execution_integrity()`);

    await q.query(`CREATE TABLE governed_institution_affiliation_replay_results (
      approval_id uuid PRIMARY KEY REFERENCES governed_institution_affiliations(approval_id) ON DELETE RESTRICT,
      affiliation_status varchar(16) NOT NULL, effective_from timestamptz NOT NULL, effective_to timestamptz,
      CHECK (affiliation_status IN ('ACTIVE','SUSPENDED','TERMINATED'))
    )`);
    // Do not invent snapshots for pre-existing executions. Old approvals remain non-replayable.
    await q.query(`CREATE FUNCTION institution_affiliation_record_replay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO governed_institution_affiliation_replay_results
          (approval_id, affiliation_status, effective_from, effective_to)
        SELECT NEW.approval_id, a.status, a.effective_from, a.effective_to
          FROM institution_agent_affiliations a WHERE a.id=NEW.affiliation_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Missing affiliation for execution snapshot'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER institution_affiliation_record_replay
      AFTER INSERT ON governed_institution_affiliations FOR EACH ROW EXECUTE FUNCTION institution_affiliation_record_replay()`);
    await q.query(`CREATE TRIGGER institution_affiliation_replay_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON governed_institution_affiliation_replay_results
      FOR EACH ROW EXECUTE FUNCTION institution_execution_evidence_guard()`);
    await q.query(`CREATE FUNCTION institution_approval_consumption_complete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status='CONSUMED' AND OLD.status IS DISTINCT FROM NEW.status THEN
          IF NEW.action_type='FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE' AND NOT EXISTS
            (SELECT 1 FROM governed_institution_lifecycle_executions WHERE approval_id=NEW.id AND NOT legacy_reserved) THEN
            RAISE EXCEPTION 'Institution lifecycle consumption requires execution evidence' USING ERRCODE='55000';
          END IF;
          IF NEW.action_type='INSTITUTION_AGENT_AFFILIATION_CHANGE' AND NOT EXISTS
            (SELECT 1 FROM governed_institution_affiliations WHERE approval_id=NEW.id) THEN
            RAISE EXCEPTION 'Institution affiliation consumption requires execution evidence' USING ERRCODE='55000';
          END IF;
        END IF;
        RETURN NULL;
      END $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER institution_approval_consumption_complete
      AFTER UPDATE ON privileged_action_approvals DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION institution_approval_consumption_complete()`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to remove institution governance execution integrity'),
    );
  }
}
