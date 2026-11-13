import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 4 — Phase 1 institutional foundation.
 *
 * Establishes a first-class *financial institution* party, its operational lifecycle, the
 * authoritative agent→institution affiliation, aggregator↔institution organizational links,
 * institution-scoped workforce assignments and read-only attribution visibility.
 *
 * Design constraints encoded structurally (not just in service code):
 *
 *  - An institution is NOT authorized to provide financial services merely because it exists.
 *    `REGISTERED` → `EVIDENCE_SUBMITTED` is administrative (regulatory evidence is *recorded* for
 *    verification, never treated as proof); every transition into `APPROVED`/`SUSPENDED`/`CLOSED`
 *    requires a CONSUMED `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE` approval for that institution.
 *  - An agent affiliation row cannot exist without a CONSUMED
 *    `INSTITUTION_AGENT_AFFILIATION_CHANGE` approval for that agent, and every later status change
 *    needs its own approval. Rows are never deleted; institutions are never soft-deleted; the
 *    governed execution record is immutable.
 *  - At most one ACTIVE affiliation per agent (partial unique index), so financial authorization
 *    always has a single unambiguous institutional context.
 *  - Existing data is untouched: no row is created for any existing agent, wallet, journal or
 *    workforce principal, and no historical record is attributed to an institution.
 *
 * Migration identifier is inside Arena 4's allocated range 1785753600400–1785753600499.
 */
export class CreateInstitutionFoundation1785753600400 implements MigrationInterface {
  name = 'CreateInstitutionFoundation1785753600400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------ financial institutions
    await queryRunner.query(`
      CREATE TABLE financial_institutions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(80) NOT NULL,
        code VARCHAR(40) NOT NULL,
        legal_name VARCHAR(320) NOT NULL,
        display_name VARCHAR(160),
        institution_type VARCHAR(32) NOT NULL,
        regulator_name VARCHAR(160),
        licence_reference VARCHAR(160),
        licence_reference_recorded_at TIMESTAMPTZ,
        licence_reference_recorded_by VARCHAR(160),
        evidence_reference VARCHAR(160),
        evidence_digest CHAR(64),
        evidence_recorded_at TIMESTAMPTZ,
        evidence_recorded_by VARCHAR(160),
        status VARCHAR(24) NOT NULL DEFAULT 'REGISTERED',
        status_reason VARCHAR(500),
        lifecycle_approval_id UUID,
        operational_approved_at TIMESTAMPTZ,
        operational_approved_by VARCHAR(160),
        suspended_at TIMESTAMPTZ,
        suspended_by VARCHAR(160),
        closed_at TIMESTAMPTZ,
        closed_by VARCHAR(160),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_financial_institutions_lifecycle_approval
          FOREIGN KEY (lifecycle_approval_id) REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        CONSTRAINT chk_financial_institutions_type CHECK (
          institution_type IN ('MMO','COMMERCIAL_BANK','MICROFINANCE_BANK','PAYMENT_SERVICE_BANK','PSP','PARTNER')),
        CONSTRAINT chk_financial_institutions_status CHECK (
          status IN ('REGISTERED','EVIDENCE_SUBMITTED','APPROVED','SUSPENDED','CLOSED')),
        CONSTRAINT chk_financial_institutions_reference CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'),
        CONSTRAINT chk_financial_institutions_code CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{2,39}$'),
        CONSTRAINT chk_financial_institutions_version CHECK (version > 0),
        CONSTRAINT chk_financial_institutions_digest CHECK (
          evidence_digest IS NULL OR evidence_digest ~ '^[a-f0-9]{64}$'),
        CONSTRAINT chk_financial_institutions_closed_at CHECK (
          (status = 'CLOSED' AND closed_at IS NOT NULL) OR (status <> 'CLOSED' AND closed_at IS NULL)),
        CONSTRAINT chk_financial_institutions_suspended_at CHECK (
          (status = 'SUSPENDED' AND suspended_at IS NOT NULL) OR (status <> 'SUSPENDED' AND suspended_at IS NULL)),
        CONSTRAINT chk_financial_institutions_operational_approval CHECK (
          status IN ('APPROVED','SUSPENDED') AND operational_approved_at IS NOT NULL
          OR status IN ('REGISTERED','EVIDENCE_SUBMITTED')
          OR status = 'CLOSED')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_financial_institutions_reference
        ON financial_institutions (reference) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_financial_institutions_code
        ON financial_institutions (code) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX idx_financial_institutions_status ON financial_institutions (status)`,
    );

    // ------------------------------------------------------ institution↔agent affiliation
    await queryRunner.query(`
      CREATE TABLE institution_agent_affiliations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institution_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
        effective_to TIMESTAMPTZ,
        affiliation_source VARCHAR(32) NOT NULL DEFAULT 'GOVERNED_CHANGE',
        evidence_type VARCHAR(40) NOT NULL,
        evidence_reference VARCHAR(160) NOT NULL,
        evidence_digest CHAR(64),
        approval_id UUID NOT NULL,
        assigned_by VARCHAR(160) NOT NULL,
        unassigned_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_institution_affiliation_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT fk_institution_affiliation_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_institution_affiliation_approval
          FOREIGN KEY (approval_id) REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        CONSTRAINT chk_institution_affiliation_status CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
        CONSTRAINT chk_institution_affiliation_source CHECK (affiliation_source = 'GOVERNED_CHANGE'),
        CONSTRAINT chk_institution_affiliation_effective CHECK (
          (status = 'TERMINATED' AND effective_to IS NOT NULL)
          OR (status <> 'TERMINATED' AND effective_to IS NULL)),
        CONSTRAINT chk_institution_affiliation_effective_order CHECK (
          effective_to IS NULL OR effective_to > effective_from),
        CONSTRAINT chk_institution_affiliation_version CHECK (version > 0),
        CONSTRAINT chk_institution_affiliation_reference CHECK (
          length(evidence_reference) BETWEEN 1 AND 160),
        CONSTRAINT chk_institution_affiliation_digest CHECK (
          evidence_digest IS NULL OR evidence_digest ~ '^[a-f0-9]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_institution_affiliation_active
        ON institution_agent_affiliations (agent_id) WHERE status = 'ACTIVE'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_institution_affiliation_pair_open
        ON institution_agent_affiliations (institution_id, agent_id) WHERE status <> 'TERMINATED'
    `);
    await queryRunner.query(`
      CREATE INDEX idx_institution_affiliation_institution
        ON institution_agent_affiliations (institution_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_institution_affiliation_approval
        ON institution_agent_affiliations (approval_id)
    `);

    // ------------------------------------------------- aggregator↔institution relationships
    await queryRunner.query(`
      CREATE TABLE aggregator_institution_relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregator_id UUID NOT NULL,
        institution_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
        effective_to TIMESTAMPTZ,
        assigned_by VARCHAR(160) NOT NULL,
        unassigned_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_aggregator_institution_aggregator
          FOREIGN KEY (aggregator_id) REFERENCES aggregators(id) ON DELETE RESTRICT,
        CONSTRAINT fk_aggregator_institution_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT chk_aggregator_institution_status CHECK (status IN ('ACTIVE','TERMINATED')),
        CONSTRAINT chk_aggregator_institution_effective CHECK (
          (status = 'TERMINATED' AND effective_to IS NOT NULL)
          OR (status <> 'TERMINATED' AND effective_to IS NULL)),
        CONSTRAINT chk_aggregator_institution_effective_order CHECK (
          effective_to IS NULL OR effective_to > effective_from),
        CONSTRAINT chk_aggregator_institution_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_aggregator_institution_pair_open
        ON aggregator_institution_relationships (aggregator_id, institution_id) WHERE status <> 'TERMINATED'
    `);
    await queryRunner.query(`
      CREATE INDEX idx_aggregator_institution_institution
        ON aggregator_institution_relationships (institution_id, status)
    `);

    // ------------------------------------------------------- governed execution records
    await queryRunner.query(`
      CREATE TABLE governed_institution_affiliations (
        approval_id UUID PRIMARY KEY,
        affiliation_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        institution_id UUID NOT NULL,
        previous_institution_id UUID,
        change_kind VARCHAR(24) NOT NULL,
        evidence_type VARCHAR(40) NOT NULL,
        evidence_reference VARCHAR(160) NOT NULL,
        evidence_digest CHAR(64) NOT NULL,
        reason VARCHAR(500) NOT NULL,
        executed_by VARCHAR(160) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_governed_institution_affiliation_approval
          FOREIGN KEY (approval_id) REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        CONSTRAINT fk_governed_institution_affiliation_affiliation
          FOREIGN KEY (affiliation_id) REFERENCES institution_agent_affiliations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_governed_institution_affiliation_agent
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_governed_institution_affiliation_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT fk_governed_institution_affiliation_previous
          FOREIGN KEY (previous_institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT chk_governed_institution_affiliation_change CHECK (
          change_kind IN ('ASSIGN','TRANSFER','SUSPEND','REACTIVATE','TERMINATE')),
        CONSTRAINT chk_governed_institution_affiliation_digest CHECK (evidence_digest ~ '^[a-f0-9]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_governed_institution_affiliation_target
        ON governed_institution_affiliations (affiliation_id, executed_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_governed_institution_affiliation_agent
        ON governed_institution_affiliations (agent_id, executed_at)
    `);

    // ------------------------------------------------------- workforce institution scope
    await queryRunner.query(`
      CREATE TABLE workforce_institution_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        principal_id VARCHAR(160) NOT NULL,
        institution_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        granted_by VARCHAR(160) NOT NULL,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_by VARCHAR(160),
        revoked_at TIMESTAMPTZ,
        approval_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_workforce_institution_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT chk_workforce_institution_status CHECK (status IN ('ACTIVE','REVOKED')),
        CONSTRAINT chk_workforce_institution_revoked CHECK (
          (status = 'REVOKED' AND revoked_at IS NOT NULL)
          OR (status <> 'REVOKED' AND revoked_at IS NULL)),
        CONSTRAINT chk_workforce_institution_version CHECK (version > 0),
        CONSTRAINT chk_workforce_institution_principal CHECK (length(principal_id) BETWEEN 3 AND 160)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_workforce_institution_active
        ON workforce_institution_assignments (principal_id, institution_id) WHERE status = 'ACTIVE'
    `);
    await queryRunner.query(`
      CREATE INDEX idx_workforce_institution_principal
        ON workforce_institution_assignments (principal_id, status)
    `);

    // --------------------------------------------------------------- guard functions
    await queryRunner.query(`
      CREATE FUNCTION fn_institution_approval_consumed(
        p_approval UUID, p_action TEXT, p_resource_type TEXT, p_resource_id TEXT
      ) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1
            FROM privileged_action_approvals a
           WHERE a.id = p_approval
             AND a.status = 'CONSUMED'
             AND a.action_type = p_action
             AND a.resource_type = p_resource_type
             AND lower(coalesce(a.resource_id, '')) = lower(coalesce(p_resource_id, ''))
        );
      $$
    `);

    await queryRunner.query(`
      CREATE FUNCTION fn_financial_institution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Financial institutions cannot be deleted; close the institution instead';
        END IF;

        IF TG_OP = 'INSERT' THEN
          IF NEW.status <> 'REGISTERED' THEN
            RAISE EXCEPTION 'A financial institution must be administratively registered first';
          END IF;
          RETURN NEW;
        END IF;

        IF NEW.reference <> OLD.reference
           OR NEW.code <> OLD.code
           OR NEW.legal_name <> OLD.legal_name
           OR NEW.institution_type <> OLD.institution_type
           OR NEW.created_at <> OLD.created_at
           OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
          RAISE EXCEPTION 'Financial institution identity is immutable';
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
          IF NOT (
            (OLD.status = 'REGISTERED' AND NEW.status IN ('EVIDENCE_SUBMITTED','CLOSED'))
            OR (OLD.status = 'EVIDENCE_SUBMITTED' AND NEW.status IN ('APPROVED','CLOSED'))
            OR (OLD.status = 'APPROVED' AND NEW.status IN ('SUSPENDED','CLOSED'))
            OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('APPROVED','CLOSED'))
          ) THEN
            RAISE EXCEPTION 'Institution lifecycle transition % -> % is not allowed', OLD.status, NEW.status;
          END IF;

          IF OLD.status = 'REGISTERED' AND NEW.status = 'EVIDENCE_SUBMITTED' THEN
            -- Administrative step: regulatory evidence is recorded for verification only.
            IF NEW.evidence_reference IS NULL OR NEW.evidence_recorded_at IS NULL THEN
              RAISE EXCEPTION 'Recording regulatory evidence requires a reference and a recording timestamp';
            END IF;
          ELSE
            -- Operational approval, suspension and closure are governed changes.
            IF NEW.lifecycle_approval_id IS NULL
               OR NEW.lifecycle_approval_id IS NOT DISTINCT FROM OLD.lifecycle_approval_id THEN
              RAISE EXCEPTION 'Institution lifecycle change requires its own approved request';
            END IF;
            IF NOT fn_institution_approval_consumed(
              NEW.lifecycle_approval_id, 'FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE',
              'FINANCIAL_INSTITUTION', NEW.id::text) THEN
              RAISE EXCEPTION 'Institution lifecycle change requires a consumed FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE approval for this institution';
            END IF;
          END IF;
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER financial_institution_guard
        BEFORE INSERT OR UPDATE OR DELETE ON financial_institutions
        FOR EACH ROW EXECUTE FUNCTION fn_financial_institution_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION fn_institution_affiliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        v_institution_status TEXT;
        v_institution_deleted TIMESTAMPTZ;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Institution affiliations are immutable; terminate the affiliation instead';
        END IF;

        IF TG_OP = 'INSERT' THEN
          IF NEW.status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'A new institution affiliation must start ACTIVE';
          END IF;
          IF NOT fn_institution_approval_consumed(
            NEW.approval_id, 'INSTITUTION_AGENT_AFFILIATION_CHANGE', 'AGENT', NEW.agent_id::text) THEN
            RAISE EXCEPTION 'Institution affiliation requires a consumed INSTITUTION_AGENT_AFFILIATION_CHANGE approval for this agent';
          END IF;
          NEW.version := 1;
          NEW.created_at := clock_timestamp();
          NEW.updated_at := clock_timestamp();
        ELSE
          IF NEW.institution_id <> OLD.institution_id
             OR NEW.agent_id <> OLD.agent_id
             OR NEW.evidence_type <> OLD.evidence_type
             OR NEW.evidence_reference <> OLD.evidence_reference
             OR NEW.assigned_by <> OLD.assigned_by
             OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'Institution affiliation identity is immutable';
          END IF;
          IF OLD.status = 'TERMINATED' THEN
            RAISE EXCEPTION 'A terminated institution affiliation cannot be changed';
          END IF;
          IF NEW.status = OLD.status THEN
            RAISE EXCEPTION 'Institution affiliation update must be a governed status change';
          END IF;
          IF NOT (
            (OLD.status = 'ACTIVE' AND NEW.status IN ('SUSPENDED','TERMINATED'))
            OR (OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE','TERMINATED'))
          ) THEN
            RAISE EXCEPTION 'Institution affiliation transition % -> % is not allowed', OLD.status, NEW.status;
          END IF;
          IF NEW.approval_id IS NOT DISTINCT FROM OLD.approval_id THEN
            RAISE EXCEPTION 'Institution affiliation change requires its own approved request';
          END IF;
          IF NOT fn_institution_approval_consumed(
            NEW.approval_id, 'INSTITUTION_AGENT_AFFILIATION_CHANGE', 'AGENT', NEW.agent_id::text) THEN
            RAISE EXCEPTION 'Institution affiliation change requires a consumed INSTITUTION_AGENT_AFFILIATION_CHANGE approval for this agent';
          END IF;
          NEW.version := OLD.version + 1;
          NEW.updated_at := clock_timestamp();
        END IF;

        SELECT status, deleted_at INTO v_institution_status, v_institution_deleted
          FROM financial_institutions WHERE id = NEW.institution_id;
        IF v_institution_status IS NULL THEN
          RAISE EXCEPTION 'Institution % does not exist', NEW.institution_id;
        END IF;
        IF v_institution_deleted IS NOT NULL THEN
          RAISE EXCEPTION 'Institution is closed and cannot hold agent affiliations';
        END IF;
        IF NEW.status <> 'TERMINATED' AND v_institution_status <> 'APPROVED' THEN
          RAISE EXCEPTION 'Institution is not operationally approved for financial services';
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER institution_affiliation_guard
        BEFORE INSERT OR UPDATE OR DELETE ON institution_agent_affiliations
        FOR EACH ROW EXECUTE FUNCTION fn_institution_affiliation_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION fn_governed_institution_affiliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'Governed institution affiliation records are immutable';
        END IF;
        IF NOT fn_institution_approval_consumed(
          NEW.approval_id, 'INSTITUTION_AGENT_AFFILIATION_CHANGE', 'AGENT', NEW.agent_id::text) THEN
          RAISE EXCEPTION 'Governed institution affiliation requires a consumed INSTITUTION_AGENT_AFFILIATION_CHANGE approval for this agent';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER governed_institution_affiliation_guard
        BEFORE INSERT OR UPDATE OR DELETE ON governed_institution_affiliations
        FOR EACH ROW EXECUTE FUNCTION fn_governed_institution_affiliation_guard()
    `);

    // -------------------------------------------------------------- read-only visibility
    await queryRunner.query(`
      CREATE VIEW agent_institution_resolution AS
      WITH current_affiliation AS (
        SELECT af.* FROM institution_agent_affiliations af WHERE af.status <> 'TERMINATED'
      ), open_counts AS (
        SELECT agent_id, count(*)::int AS open_count FROM current_affiliation GROUP BY agent_id
      )
      SELECT
        a.id AS agent_id,
        af.id AS affiliation_id,
        af.institution_id,
        af.status AS affiliation_status,
        af.effective_from,
        fi.status AS institution_status,
        fi.deleted_at AS institution_deleted_at,
        COALESCE(c.open_count, 0) AS open_affiliation_count,
        CASE
          WHEN COALESCE(c.open_count, 0) <> 1 THEN 'UNRESOLVED'
          WHEN af.status = 'ACTIVE' AND fi.status = 'APPROVED' AND fi.deleted_at IS NULL THEN 'RESOLVED'
          ELSE 'UNRESOLVED'
        END AS resolution_state,
        CASE
          WHEN COALESCE(c.open_count, 0) = 0 THEN 'NO_AFFILIATION'
          WHEN c.open_count > 1 THEN 'CONFLICTING_AFFILIATION'
          WHEN af.status = 'SUSPENDED' THEN 'AFFILIATION_SUSPENDED'
          WHEN fi.id IS NULL THEN 'INSTITUTION_MISSING'
          WHEN fi.deleted_at IS NOT NULL THEN 'INSTITUTION_CLOSED'
          WHEN fi.status = 'REGISTERED' THEN 'INSTITUTION_REGISTERED'
          WHEN fi.status = 'EVIDENCE_SUBMITTED' THEN 'INSTITUTION_EVIDENCE_SUBMITTED'
          WHEN fi.status = 'SUSPENDED' THEN 'INSTITUTION_SUSPENDED'
          WHEN fi.status = 'CLOSED' THEN 'INSTITUTION_CLOSED'
          ELSE NULL
        END AS unresolved_reason
      FROM agents a
      LEFT JOIN current_affiliation af ON af.agent_id = a.id
      LEFT JOIN financial_institutions fi ON fi.id = af.institution_id
      LEFT JOIN open_counts c ON c.agent_id = a.id
    `);
    await queryRunner.query(`
      CREATE VIEW institution_attribution_gaps AS
      SELECT
        'AGENT'::text AS entity,
        r.agent_id AS entity_id,
        ag.reference AS entity_reference,
        COALESCE(r.unresolved_reason, 'NO_AFFILIATION') AS gap_reason,
        r.institution_id,
        r.affiliation_status,
        r.institution_status
      FROM agent_institution_resolution r
      JOIN agents ag ON ag.id = r.agent_id
      WHERE r.resolution_state = 'UNRESOLVED' AND ag.deleted_at IS NULL
    `);
  }

  /**
   * Removing this foundation would delete the only authoritative record of institutional
   * affiliation and could re-open ungoverned financial context. Refuse if any institution has
   * been registered, mirroring the fail-closed `down()` convention of `1785753600118`.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT count(*)::text AS count FROM financial_institutions`,
    )) as Array<{ count: string }>;
    if (Number(rows[0]?.count ?? '0') > 0) {
      throw new Error(
        'Refusing to drop the institution foundation while financial institutions exist',
      );
    }
    await queryRunner.query(`DROP VIEW IF EXISTS institution_attribution_gaps`);
    await queryRunner.query(`DROP VIEW IF EXISTS agent_institution_resolution`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS governed_institution_affiliation_guard ON governed_institution_affiliations`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_governed_institution_affiliation_guard()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS institution_affiliation_guard ON institution_agent_affiliations`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_institution_affiliation_guard()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS financial_institution_guard ON financial_institutions`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS fn_financial_institution_guard()`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS fn_institution_approval_consumed(uuid, text, text, text)`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS governed_institution_affiliations`);
    await queryRunner.query(`DROP TABLE IF EXISTS workforce_institution_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS aggregator_institution_relationships`);
    await queryRunner.query(`DROP TABLE IF EXISTS institution_agent_affiliations`);
    await queryRunner.query(`DROP TABLE IF EXISTS financial_institutions`);
  }
}
