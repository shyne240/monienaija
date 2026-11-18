import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3C — institution-scoped, protected KYC-tier-to-limit policy lifecycle.
 *
 * Runtime logins can read the governed policy history but cannot insert, update, delete, truncate,
 * or attach triggers to it. The separately provisioned protected-authority login is the only
 * application writer. Proposals begin REQUESTED, checker decisions are immutable evidence in the
 * protected schema, approved policy versions are append-only, and each institution has a
 * compare-and-swap policy head. There is intentionally no seeded policy or monetary value.
 */
export class InstitutionKycTierLimitGovernance1785753600504 implements MigrationInterface {
  name = 'InstitutionKycTierLimitGovernance1785753600504';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE institution_kyc_limit_policy_heads (
      institution_id uuid PRIMARY KEY REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
      last_proposal_id uuid,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);

    await q.query(`CREATE TABLE institution_kyc_limit_policy_proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      request_id uuid NOT NULL,
      expected_version integer NOT NULL CHECK(expected_version >= 0),
      definition jsonb NOT NULL,
      fingerprint char(64) NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      reason varchar(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
      maker_id varchar(160) NOT NULL,
      maker_session_id uuid NOT NULL,
      state varchar(16) NOT NULL DEFAULT 'REQUESTED'
        CHECK(state IN ('REQUESTED','APPROVED','REJECTED')),
      checker_id varchar(160),
      checker_session_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL,
      decided_at timestamptz,
      UNIQUE(institution_id,request_id),
      CHECK(expires_at > created_at),
      CHECK((state='REQUESTED' AND checker_id IS NULL AND checker_session_id IS NULL AND decided_at IS NULL)
        OR (state IN ('APPROVED','REJECTED') AND checker_id IS NOT NULL
          AND checker_session_id IS NOT NULL AND decided_at IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX idx_institution_kyc_limit_proposals
      ON institution_kyc_limit_policy_proposals(institution_id,created_at DESC)`);

    await q.query(`CREATE TABLE institution_kyc_limit_policy_versions (
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      version integer NOT NULL CHECK(version > 0),
      proposal_id uuid NOT NULL UNIQUE REFERENCES institution_kyc_limit_policy_proposals(id) ON DELETE RESTRICT,
      definition jsonb NOT NULL,
      maker_id varchar(160) NOT NULL,
      checker_id varchar(160) NOT NULL,
      approved_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(institution_id,version),
      CHECK(maker_id <> checker_id)
    )`);
    await q.query(`ALTER TABLE institution_kyc_limit_policy_heads
      ADD CONSTRAINT fk_institution_kyc_limit_head_proposal
      FOREIGN KEY(last_proposal_id) REFERENCES institution_kyc_limit_policy_proposals(id) ON DELETE RESTRICT`);

    await q.query(`CREATE TABLE protected_authority.institution_kyc_limit_decisions (
      proposal_id uuid PRIMARY KEY REFERENCES public.institution_kyc_limit_policy_proposals(id) ON DELETE RESTRICT,
      institution_id uuid NOT NULL,
      expected_version integer NOT NULL,
      payload_digest char(64) NOT NULL CHECK(payload_digest ~ '^[0-9a-f]{64}$'),
      decision varchar(16) NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
      maker_principal_id varchar(160) NOT NULL,
      maker_session_id uuid NOT NULL,
      checker_principal_id varchar(160) NOT NULL,
      checker_session_id uuid NOT NULL,
      assurance_level varchar(16) NOT NULL CHECK(assurance_level='MFA'),
      decided_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      reference uuid NOT NULL DEFAULT gen_random_uuid(),
      CHECK(maker_principal_id <> checker_principal_id),
      CHECK(expires_at > decided_at)
    )`);
    await q.query(
      `ALTER TABLE protected_authority.institution_kyc_limit_decisions OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON protected_authority.institution_kyc_limit_decisions FROM PUBLIC, monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT,INSERT ON protected_authority.institution_kyc_limit_decisions TO monienaija_authority_core`,
    );

    await q.query(`CREATE FUNCTION protected_authority.institution_kyc_limit_payload_digest(p_id uuid)
      RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority SET timezone='UTC' AS $$
        SELECT encode(sha256(convert_to(jsonb_build_object(
          'id',p.id,'institution_id',p.institution_id,'request_id',p.request_id,
          'expected_version',p.expected_version,'definition',p.definition,
          'fingerprint',p.fingerprint,'reason',p.reason,'maker_id',p.maker_id,
          'maker_session_id',p.maker_session_id,'created_at',p.created_at,'expires_at',p.expires_at
        )::text,'UTF8')),'hex')
        FROM public.institution_kyc_limit_policy_proposals p WHERE p.id=p_id
      $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.institution_kyc_limit_payload_digest(uuid) OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.institution_kyc_limit_payload_digest(uuid) FROM PUBLIC`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.institution_kyc_limit_payload_digest(uuid) TO monienaija_authority_core`,
    );

    await q.query(`CREATE FUNCTION protected_authority.institution_kyc_limit_decision_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE p public.institution_kyc_limit_policy_proposals%ROWTYPE;
              v integer;
      BEGIN
        IF TG_OP<>'INSERT' THEN
          RAISE EXCEPTION 'Institutional KYC limit decisions are immutable' USING ERRCODE='55000';
        END IF;
        IF NOT pg_has_role(session_user,'monienaija_authority_core','MEMBER') THEN
          RAISE EXCEPTION 'Institutional KYC limit governance requires protected authority' USING ERRCODE='42501';
        END IF;
        SELECT * INTO p FROM public.institution_kyc_limit_policy_proposals WHERE id=NEW.proposal_id;
        SELECT version INTO v FROM public.institution_kyc_limit_policy_heads
          WHERE institution_id=NEW.institution_id;
        IF NOT FOUND OR p.id IS NULL OR p.state<>'REQUESTED'
          OR p.institution_id IS DISTINCT FROM NEW.institution_id
          OR p.expected_version IS DISTINCT FROM NEW.expected_version
          OR p.expected_version IS DISTINCT FROM v
          OR p.maker_id IS DISTINCT FROM NEW.maker_principal_id
          OR p.maker_session_id IS DISTINCT FROM NEW.maker_session_id
          OR NEW.checker_principal_id=NEW.maker_principal_id
          OR NEW.assurance_level<>'MFA'
          OR NEW.expires_at IS DISTINCT FROM p.expires_at
          OR NEW.expires_at<=clock_timestamp()
          OR NEW.payload_digest IS DISTINCT FROM protected_authority.institution_kyc_limit_payload_digest(NEW.proposal_id) THEN
          RAISE EXCEPTION 'Institutional KYC limit checker evidence does not bind a live proposal' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.institution_kyc_limit_decision_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.institution_kyc_limit_decision_guard() FROM PUBLIC`,
    );
    await q.query(`CREATE TRIGGER institution_kyc_limit_decision_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON protected_authority.institution_kyc_limit_decisions
      FOR EACH ROW EXECUTE FUNCTION protected_authority.institution_kyc_limit_decision_guard()`);

    await q.query(`CREATE FUNCTION protected_authority.institution_kyc_limit_proposal_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE d protected_authority.institution_kyc_limit_decisions%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'monienaija_authority_core','MEMBER') THEN
          RAISE EXCEPTION 'Institutional KYC limit proposals require protected authority' USING ERRCODE='42501';
        END IF;
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Institutional KYC limit proposals are immutable' USING ERRCODE='55000';
        ELSIF TG_OP='INSERT' THEN
          IF NEW.state<>'REQUESTED' OR NEW.checker_id IS NOT NULL
            OR NEW.checker_session_id IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
            RAISE EXCEPTION 'Institutional KYC limit proposal must begin REQUESTED' USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.state<>'REQUESTED' OR NEW.state NOT IN ('APPROVED','REJECTED')
          OR NEW.id IS DISTINCT FROM OLD.id OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
          OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.expected_version IS DISTINCT FROM OLD.expected_version
          OR NEW.definition IS DISTINCT FROM OLD.definition OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
          OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.maker_id IS DISTINCT FROM OLD.maker_id
          OR NEW.maker_session_id IS DISTINCT FROM OLD.maker_session_id
          OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
          OR NEW.checker_id IS NULL OR NEW.checker_session_id IS NULL OR NEW.decided_at IS NULL
          OR NEW.checker_id=NEW.maker_id THEN
          RAISE EXCEPTION 'Institutional KYC limit proposal payload is immutable and may be decided once' USING ERRCODE='55000';
        END IF;
        SELECT * INTO d FROM protected_authority.institution_kyc_limit_decisions WHERE proposal_id=NEW.id;
        IF NOT FOUND OR d.institution_id IS DISTINCT FROM NEW.institution_id
          OR d.expected_version IS DISTINCT FROM NEW.expected_version
          OR d.decision IS DISTINCT FROM NEW.state
          OR d.maker_principal_id IS DISTINCT FROM NEW.maker_id
          OR d.maker_session_id IS DISTINCT FROM NEW.maker_session_id
          OR d.checker_principal_id IS DISTINCT FROM NEW.checker_id
          OR d.checker_session_id IS DISTINCT FROM NEW.checker_session_id
          OR d.decided_at IS DISTINCT FROM NEW.decided_at
          OR d.payload_digest IS DISTINCT FROM protected_authority.institution_kyc_limit_payload_digest(NEW.id) THEN
          RAISE EXCEPTION 'Institutional KYC limit proposal lacks matching protected checker decision' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.institution_kyc_limit_proposal_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.institution_kyc_limit_proposal_guard() FROM PUBLIC`,
    );
    await q.query(`CREATE TRIGGER institution_kyc_limit_proposal_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON institution_kyc_limit_policy_proposals
      FOR EACH ROW EXECUTE FUNCTION protected_authority.institution_kyc_limit_proposal_guard()`);

    await q.query(`CREATE FUNCTION protected_authority.institution_kyc_limit_version_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE p public.institution_kyc_limit_policy_proposals%ROWTYPE;
              d protected_authority.institution_kyc_limit_decisions%ROWTYPE;
      BEGIN
        IF TG_OP<>'INSERT' THEN
          RAISE EXCEPTION 'Institutional KYC limit policy versions are append-only' USING ERRCODE='55000';
        END IF;
        IF NOT pg_has_role(session_user,'monienaija_authority_core','MEMBER') THEN
          RAISE EXCEPTION 'Institutional KYC limit versions require protected authority' USING ERRCODE='42501';
        END IF;
        SELECT * INTO p FROM public.institution_kyc_limit_policy_proposals WHERE id=NEW.proposal_id;
        SELECT * INTO d FROM protected_authority.institution_kyc_limit_decisions WHERE proposal_id=NEW.proposal_id;
        IF p.id IS NULL OR p.state<>'APPROVED' OR d.decision<>'APPROVED'
          OR p.institution_id IS DISTINCT FROM NEW.institution_id
          OR NEW.version<>p.expected_version+1
          OR NEW.definition IS DISTINCT FROM p.definition
          OR NEW.maker_id IS DISTINCT FROM p.maker_id
          OR NEW.checker_id IS DISTINCT FROM p.checker_id
          OR NEW.approved_at IS DISTINCT FROM p.decided_at THEN
          RAISE EXCEPTION 'Institutional KYC limit version is not bound to an approved proposal' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.institution_kyc_limit_version_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.institution_kyc_limit_version_guard() FROM PUBLIC`,
    );
    await q.query(`CREATE TRIGGER institution_kyc_limit_version_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON institution_kyc_limit_policy_versions
      FOR EACH ROW EXECUTE FUNCTION protected_authority.institution_kyc_limit_version_guard()`);

    await q.query(`CREATE FUNCTION protected_authority.institution_kyc_limit_head_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE v public.institution_kyc_limit_policy_versions%ROWTYPE;
      BEGIN
        IF NOT pg_has_role(session_user,'monienaija_authority_core','MEMBER') THEN
          RAISE EXCEPTION 'Institutional KYC limit policy heads require protected authority' USING ERRCODE='42501';
        END IF;
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Institutional KYC limit policy heads cannot be deleted' USING ERRCODE='55000';
        ELSIF TG_OP='INSERT' THEN
          IF NEW.version<>0 OR NEW.last_proposal_id IS NOT NULL THEN
            RAISE EXCEPTION 'Institutional KYC limit policy head must begin at version zero' USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW.institution_id IS DISTINCT FROM OLD.institution_id OR NEW.version<>OLD.version+1
          OR NEW.last_proposal_id IS NULL THEN
          RAISE EXCEPTION 'Institutional KYC limit policy head must advance exactly one version' USING ERRCODE='55000';
        END IF;
        SELECT * INTO v FROM public.institution_kyc_limit_policy_versions
          WHERE institution_id=NEW.institution_id AND version=NEW.version AND proposal_id=NEW.last_proposal_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Institutional KYC limit policy head must reference its immutable version' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.institution_kyc_limit_head_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.institution_kyc_limit_head_guard() FROM PUBLIC`,
    );
    await q.query(`CREATE TRIGGER institution_kyc_limit_head_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON institution_kyc_limit_policy_heads
      FOR EACH ROW EXECUTE FUNCTION protected_authority.institution_kyc_limit_head_guard()`);

    await q.query(`GRANT USAGE ON SCHEMA public TO monienaija_authority_core`);
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.institution_kyc_limit_policy_heads TO monienaija_authority_core`,
    );
    await q.query(
      `GRANT SELECT,INSERT,UPDATE ON public.institution_kyc_limit_policy_proposals TO monienaija_authority_core`,
    );
    await q.query(
      `GRANT SELECT,INSERT ON public.institution_kyc_limit_policy_versions TO monienaija_authority_core`,
    );
    await q.query(`GRANT SELECT ON public.financial_institutions TO monienaija_authority_core`);
    await q.query(`GRANT SELECT ON public.limit_profiles TO monienaija_authority_core`);
    await q.query(`GRANT SELECT ON public.limit_rules TO monienaija_authority_core`);
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.institution_kyc_limit_payload_digest(uuid) TO monienaija_authority_core`,
    );
    await q.query(`REVOKE ALL ON public.institution_kyc_limit_policy_heads FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.institution_kyc_limit_policy_proposals FROM PUBLIC`);
    await q.query(`REVOKE ALL ON public.institution_kyc_limit_policy_versions FROM PUBLIC`);
    await q.query(
      `GRANT SELECT ON protected_authority.institution_kyc_limit_decisions TO monienaija_authority_core`,
    );
    await q.query(
      `GRANT SELECT ON public.institution_kyc_limit_policy_heads TO monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT ON public.institution_kyc_limit_policy_proposals TO monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT ON public.institution_kyc_limit_policy_versions TO monienaija_runtime`,
    );
    await q.query(
      `REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.institution_kyc_limit_policy_heads FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.institution_kyc_limit_policy_proposals FROM monienaija_runtime`,
    );
    await q.query(
      `REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.institution_kyc_limit_policy_versions FROM monienaija_runtime`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Refusing to remove institution KYC tier-limit governance history'),
    );
  }
}
