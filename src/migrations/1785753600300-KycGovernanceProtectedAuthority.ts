import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extend the existing credential-separated protected-authority boundary to the existing KYC
 * provider and tier-policy proposal systems. It creates no second proposal/workflow model: the
 * existing KYC proposal and history tables remain authoritative, while the protected schema holds
 * the immutable checker evidence and database triggers enforce the exact proposal binding.
 *
 * This migration is in Arena 3's 0300 allocation. The shared protected_authority schema is created
 * here when needed (0501 later uses CREATE SCHEMA IF NOT EXISTS), so this protection is installed
 * before the separately allocated institutional correction migrations without rewriting them.
 */
export class KycGovernanceProtectedAuthority1785753600300 implements MigrationInterface {
  name = 'KycGovernanceProtectedAuthority1785753600300';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`SELECT pg_advisory_xact_lock(hashtext('monienaija:protected-authority:roles'))`);
    await q.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='monienaija_authority_core') THEN
        CREATE ROLE monienaija_authority_core NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='monienaija_runtime') THEN
        CREATE ROLE monienaija_runtime NOLOGIN NOINHERIT;
      END IF;
      BEGIN
        EXECUTE format('GRANT monienaija_authority_core TO %I', current_user);
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END $$`);
    await q.query(
      `CREATE SCHEMA IF NOT EXISTS protected_authority AUTHORIZATION monienaija_authority_core`,
    );
    await q.query('REVOKE ALL ON SCHEMA protected_authority FROM PUBLIC');
    await q.query('REVOKE ALL ON SCHEMA protected_authority FROM monienaija_runtime');
    await q.query('GRANT USAGE ON SCHEMA protected_authority TO monienaija_authority_core');
    await q.query('GRANT USAGE ON SCHEMA public TO monienaija_authority_core');

    await q.query(
      'ALTER TABLE kyc_provider_configuration ADD COLUMN IF NOT EXISTS last_proposal_id uuid',
    );
    await q.query(
      'ALTER TABLE kyc_tier_policy_head ADD COLUMN IF NOT EXISTS last_proposal_id uuid',
    );
    await q.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='kyc_provider_configuration'::regclass AND conname='fk_kyc_provider_configuration_last_proposal') THEN
        ALTER TABLE kyc_provider_configuration ADD CONSTRAINT fk_kyc_provider_configuration_last_proposal FOREIGN KEY(last_proposal_id) REFERENCES kyc_provider_change_proposals(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='kyc_tier_policy_head'::regclass AND conname='fk_kyc_tier_policy_head_last_proposal') THEN
        ALTER TABLE kyc_tier_policy_head ADD CONSTRAINT fk_kyc_tier_policy_head_last_proposal FOREIGN KEY(last_proposal_id) REFERENCES kyc_tier_policy_proposals(id) ON DELETE RESTRICT;
      END IF;
    END $$`);

    await q.query(`CREATE TABLE IF NOT EXISTS protected_authority.kyc_governance_decisions (
      proposal_schema varchar(63) NOT NULL CHECK (proposal_schema ~ '^[a-z_][a-z0-9_]*$'),
      proposal_kind varchar(16) NOT NULL CHECK (proposal_kind IN ('PROVIDER','TIER_POLICY')),
      proposal_id uuid NOT NULL,
      payload_digest varchar(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
      decision varchar(16) NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
      maker_principal_id varchar(160) NOT NULL,
      maker_session_id uuid NOT NULL,
      checker_principal_id varchar(160) NOT NULL,
      checker_session_id uuid NOT NULL,
      assurance_level varchar(16) NOT NULL CHECK (assurance_level='MFA'),
      decided_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (proposal_schema,proposal_kind,proposal_id),
      CHECK (maker_principal_id <> checker_principal_id),
      CHECK (expires_at > decided_at)
    )`);
    await q.query(
      'ALTER TABLE protected_authority.kyc_governance_decisions OWNER TO monienaija_authority_core',
    );
    await q.query(
      'REVOKE ALL ON protected_authority.kyc_governance_decisions FROM PUBLIC, monienaija_runtime',
    );
    await q.query(
      'GRANT SELECT,INSERT ON protected_authority.kyc_governance_decisions TO monienaija_authority_core',
    );

    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_governance_snapshot(
        p_schema text,p_kind text,p_id uuid
      ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority SET timezone='UTC' AS $$
      DECLARE v jsonb;
      BEGIN
        IF p_schema IS NULL OR length(p_schema)>63 OR p_schema !~ '^[a-z_][a-z0-9_]*$' THEN
          RETURN NULL;
        END IF;
        IF p_kind='PROVIDER' THEN
          EXECUTE format(
            'SELECT jsonb_build_object(''id'',id,''request_id'',request_id,''expected_version'',expected_version,''configuration'',configuration,''fingerprint'',fingerprint,''reason_code'',reason_code,''maker_id'',maker_id,''maker_session_id'',maker_session_id,''created_at'',created_at,''expires_at'',expires_at,''state'',state,''checker_id'',checker_id,''checker_session_id'',checker_session_id,''decided_at'',decided_at) FROM %I.kyc_provider_change_proposals WHERE id=$1',
            p_schema
          ) INTO v USING p_id;
        ELSIF p_kind='TIER_POLICY' THEN
          EXECUTE format(
            'SELECT jsonb_build_object(''id'',id,''request_id'',request_id,''expected_version'',expected_version,''definition'',definition,''fingerprint'',fingerprint,''maker_id'',maker_id,''maker_session_id'',maker_session_id,''created_at'',created_at,''expires_at'',expires_at,''state'',state,''checker_id'',checker_id,''checker_session_id'',checker_session_id,''decided_at'',decided_at) FROM %I.kyc_tier_policy_proposals WHERE id=$1',
            p_schema
          ) INTO v USING p_id;
        ELSE
          RETURN NULL;
        END IF;
        RETURN v;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_governance_payload_digest(
        p_schema text,p_kind text,p_id uuid
      ) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority SET timezone='UTC' AS $$
      DECLARE v jsonb;
      BEGIN
        v := protected_authority.kyc_governance_snapshot(p_schema,p_kind,p_id);
        IF v IS NULL THEN RETURN NULL; END IF;
        RETURN encode(sha256(convert_to((v - ARRAY['state','checker_id','checker_session_id','decided_at'])::text,'UTF8')),'hex');
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_governance_current_version(
        p_schema text,p_kind text
      ) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE v integer;
      BEGIN
        IF p_schema IS NULL OR length(p_schema)>63 OR p_schema !~ '^[a-z_][a-z0-9_]*$' THEN RETURN NULL; END IF;
        IF p_kind='PROVIDER' THEN
          EXECUTE format('SELECT version FROM %I.kyc_provider_configuration WHERE singleton=true',p_schema) INTO v;
        ELSIF p_kind='TIER_POLICY' THEN
          EXECUTE format('SELECT version FROM %I.kyc_tier_policy_head WHERE singleton=true',p_schema) INTO v;
        ELSE
          RETURN NULL;
        END IF;
        RETURN v;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_governance_decision_matches(
        p_schema text,p_kind text,p_id uuid,p_decision text,p_checker text,p_checker_session uuid,p_decided_at timestamptz
      ) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb; d protected_authority.kyc_governance_decisions%ROWTYPE;
      BEGIN
        s := protected_authority.kyc_governance_snapshot(p_schema,p_kind,p_id);
        IF s IS NULL THEN RETURN false; END IF;
        SELECT * INTO d FROM protected_authority.kyc_governance_decisions
         WHERE proposal_schema=p_schema AND proposal_kind=p_kind AND proposal_id=p_id;
        RETURN FOUND
          AND d.payload_digest=protected_authority.kyc_governance_payload_digest(p_schema,p_kind,p_id)
          AND d.decision=p_decision
          AND d.maker_principal_id=s->>'maker_id'
          AND d.maker_session_id=(s->>'maker_session_id')::uuid
          AND d.checker_principal_id=p_checker
          AND d.checker_session_id=p_checker_session
          AND d.assurance_level='MFA'
          AND d.decided_at=p_decided_at
          AND d.expires_at=(s->>'expires_at')::timestamptz
          AND d.expires_at>clock_timestamp();
      END $$`);

    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_governance_decision_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb; current_version integer;
      BEGIN
        IF TG_OP<>'INSERT' THEN
          RAISE EXCEPTION 'KYC governance decisions are immutable' USING ERRCODE='55000';
        END IF;
        IF NOT pg_has_role(session_user,'monienaija_authority_core','MEMBER') THEN
          RAISE EXCEPTION 'KYC checker decisions require the protected authority credential' USING ERRCODE='42501';
        END IF;
        s := protected_authority.kyc_governance_snapshot(NEW.proposal_schema,NEW.proposal_kind,NEW.proposal_id);
        IF s IS NULL OR s->>'state'<>'REQUESTED'
          OR s->>'maker_id' IS DISTINCT FROM NEW.maker_principal_id
          OR s->>'maker_session_id' IS DISTINCT FROM NEW.maker_session_id::text
          OR s->>'expires_at' IS NULL
          OR (s->>'expires_at')::timestamptz<=clock_timestamp()
          OR NEW.expires_at IS DISTINCT FROM (s->>'expires_at')::timestamptz
          OR NEW.payload_digest IS DISTINCT FROM protected_authority.kyc_governance_payload_digest(NEW.proposal_schema,NEW.proposal_kind,NEW.proposal_id)
          OR NEW.checker_principal_id=NEW.maker_principal_id
          OR NEW.assurance_level<>'MFA'
          OR NEW.expires_at<=NEW.decided_at THEN
          RAISE EXCEPTION 'KYC checker evidence does not bind a live requested proposal' USING ERRCODE='55000';
        END IF;
        current_version := protected_authority.kyc_governance_current_version(NEW.proposal_schema,NEW.proposal_kind);
        IF current_version IS DISTINCT FROM (s->>'expected_version')::integer THEN
          RAISE EXCEPTION 'KYC proposal version is stale' USING ERRCODE='40001';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      'DROP TRIGGER IF EXISTS kyc_governance_decisions_immutable ON protected_authority.kyc_governance_decisions',
    );
    await q.query(`CREATE TRIGGER kyc_governance_decisions_immutable
      BEFORE INSERT OR UPDATE OR DELETE ON protected_authority.kyc_governance_decisions
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_governance_decision_guard()`);

    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_proposal_transition_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE kind text; s jsonb; expected_state text;
      BEGIN
        kind := CASE WHEN TG_TABLE_NAME='kyc_provider_change_proposals' THEN 'PROVIDER' ELSE 'TIER_POLICY' END;
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'KYC governance proposals are immutable' USING ERRCODE='55000';
        ELSIF TG_OP='INSERT' THEN
          IF NEW.state<>'REQUESTED' OR NEW.checker_id IS NOT NULL OR NEW.checker_session_id IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
            RAISE EXCEPTION 'KYC proposals must begin in REQUESTED state' USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.state<>'REQUESTED' OR NEW.state NOT IN ('APPROVED','REJECTED')
          OR NEW.id IS DISTINCT FROM OLD.id
          OR NEW.request_id IS DISTINCT FROM OLD.request_id
          OR NEW.expected_version IS DISTINCT FROM OLD.expected_version
          OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
          OR NEW.maker_id IS DISTINCT FROM OLD.maker_id
          OR NEW.maker_session_id IS DISTINCT FROM OLD.maker_session_id
          OR NEW.created_at IS DISTINCT FROM OLD.created_at
          OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
          OR NEW.checker_id IS NULL OR NEW.checker_session_id IS NULL OR NEW.decided_at IS NULL THEN
          RAISE EXCEPTION 'KYC proposal payload is immutable and may be decided once' USING ERRCODE='55000';
        END IF;
        IF kind='PROVIDER' THEN
          IF NEW.configuration IS DISTINCT FROM OLD.configuration OR NEW.reason_code IS DISTINCT FROM OLD.reason_code THEN
            RAISE EXCEPTION 'KYC provider proposal payload is immutable' USING ERRCODE='55000';
          END IF;
        ELSE
          IF NEW.definition IS DISTINCT FROM OLD.definition THEN
            RAISE EXCEPTION 'KYC tier-policy proposal payload is immutable' USING ERRCODE='55000';
          END IF;
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,kind,NEW.id);
        expected_state := NEW.state;
        IF s IS NULL OR s->>'state'<>'REQUESTED'
          OR (s->>'expected_version')::integer IS DISTINCT FROM NEW.expected_version
          OR (s->>'expires_at')::timestamptz<=clock_timestamp()
          OR NOT protected_authority.kyc_governance_decision_matches(
            TG_TABLE_SCHEMA,kind,NEW.id,expected_state,NEW.checker_id,NEW.checker_session_id,NEW.decided_at
          ) THEN
          RAISE EXCEPTION 'KYC proposal lacks matching immutable checker decision' USING ERRCODE='55000';
        END IF;
        IF protected_authority.kyc_governance_current_version(TG_TABLE_SCHEMA,kind) IS DISTINCT FROM NEW.expected_version THEN
          RAISE EXCEPTION 'KYC proposal version is stale' USING ERRCODE='40001';
        END IF;
        RETURN NEW;
      END $$`);

    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_provider_configuration_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb;
      BEGIN
        IF TG_OP<>'UPDATE' OR NEW.last_proposal_id IS NULL
          OR NEW.version<>OLD.version+1
          OR NEW.singleton IS DISTINCT FROM OLD.singleton THEN
          RAISE EXCEPTION 'Provider configuration requires one approved proposal version' USING ERRCODE='55000';
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,'PROVIDER',NEW.last_proposal_id);
        IF s IS NULL OR s->>'state'<>'APPROVED'
          OR (s->>'expected_version')::integer<>OLD.version
          OR NEW.configuration IS DISTINCT FROM s->'configuration'
          OR NOT protected_authority.kyc_governance_decision_matches(
            TG_TABLE_SCHEMA,'PROVIDER',NEW.last_proposal_id,'APPROVED',s->>'checker_id',(s->>'checker_session_id')::uuid,(s->>'decided_at')::timestamptz
          ) THEN
          RAISE EXCEPTION 'Provider configuration is not bound to the approved proposal' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_provider_history_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb; c jsonb;
      BEGIN
        IF TG_OP<>'INSERT' THEN
          RAISE EXCEPTION 'Provider configuration history is immutable' USING ERRCODE='55000';
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,'PROVIDER',NEW.proposal_id);
        EXECUTE format('SELECT jsonb_build_object(''version'',version,''configuration'',configuration,''last_proposal_id'',last_proposal_id) FROM %I.kyc_provider_configuration WHERE singleton=true',TG_TABLE_SCHEMA) INTO c;
        IF s IS NULL OR s->>'state'<>'APPROVED'
          OR NEW.version<>(s->>'expected_version')::integer+1
          OR NEW.configuration IS DISTINCT FROM s->'configuration'
          OR (c->>'version')::integer<>NEW.version
          OR (c->>'last_proposal_id')::uuid<>NEW.proposal_id
          OR c->'configuration' IS DISTINCT FROM NEW.configuration
          OR NOT protected_authority.kyc_governance_decision_matches(
            TG_TABLE_SCHEMA,'PROVIDER',NEW.proposal_id,'APPROVED',s->>'checker_id',(s->>'checker_session_id')::uuid,(s->>'decided_at')::timestamptz
          ) THEN
          RAISE EXCEPTION 'Provider history does not match the protected approved configuration' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_tier_version_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb;
      BEGIN
        IF TG_OP<>'INSERT' THEN
          RAISE EXCEPTION 'Tier-policy history is immutable' USING ERRCODE='55000';
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,'TIER_POLICY',NEW.proposal_id);
        IF s IS NULL OR s->>'state'<>'APPROVED'
          OR NEW.version<>(s->>'expected_version')::integer+1
          OR NEW.definition IS DISTINCT FROM s->'definition'
          OR NEW.maker_id IS DISTINCT FROM s->>'maker_id'
          OR NEW.checker_id IS DISTINCT FROM s->>'checker_id'
          OR protected_authority.kyc_governance_current_version(TG_TABLE_SCHEMA,'TIER_POLICY') IS DISTINCT FROM (s->>'expected_version')::integer
          OR NOT protected_authority.kyc_governance_decision_matches(
            TG_TABLE_SCHEMA,'TIER_POLICY',NEW.proposal_id,'APPROVED',s->>'checker_id',(s->>'checker_session_id')::uuid,(s->>'decided_at')::timestamptz
          ) THEN
          RAISE EXCEPTION 'Tier-policy version does not match the protected approved proposal' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_tier_head_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb; published boolean;
      BEGIN
        IF TG_OP<>'UPDATE' OR NEW.last_proposal_id IS NULL
          OR NEW.version<>OLD.version+1
          OR NEW.singleton IS DISTINCT FROM OLD.singleton THEN
          RAISE EXCEPTION 'Tier policy head requires one approved policy version' USING ERRCODE='55000';
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,'TIER_POLICY',NEW.last_proposal_id);
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.kyc_tier_policy_versions WHERE proposal_id=$1 AND version=$2 AND definition=$3::jsonb)',TG_TABLE_SCHEMA)
          INTO published USING NEW.last_proposal_id,NEW.version,s->'definition';
        IF s IS NULL OR s->>'state'<>'APPROVED'
          OR (s->>'expected_version')::integer<>OLD.version
          OR NEW.version<>(s->>'expected_version')::integer+1
          OR NOT published
          OR NOT protected_authority.kyc_governance_decision_matches(
            TG_TABLE_SCHEMA,'TIER_POLICY',NEW.last_proposal_id,'APPROVED',s->>'checker_id',(s->>'checker_session_id')::uuid,(s->>'decided_at')::timestamptz
          ) THEN
          RAISE EXCEPTION 'Tier policy head does not match the protected approved proposal' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);

    const protectedFunctions = [
      'kyc_governance_snapshot(text,text,uuid)',
      'kyc_governance_payload_digest(text,text,uuid)',
      'kyc_governance_current_version(text,text)',
      'kyc_governance_decision_matches(text,text,uuid,text,text,uuid,timestamp with time zone)',
      'kyc_governance_decision_guard()',
      'kyc_proposal_transition_guard()',
      'kyc_provider_configuration_guard()',
      'kyc_provider_history_guard()',
      'kyc_tier_version_guard()',
      'kyc_tier_head_guard()',
    ];
    for (const signature of protectedFunctions) {
      await q.query(
        `ALTER FUNCTION protected_authority.${signature} OWNER TO monienaija_authority_core`,
      );
      await q.query(`REVOKE ALL ON FUNCTION protected_authority.${signature} FROM PUBLIC`);
      await q.query(
        `GRANT EXECUTE ON FUNCTION protected_authority.${signature} TO monienaija_authority_core`,
      );
    }

    await q.query(
      'DROP TRIGGER IF EXISTS kyc_provider_proposal_authority_guard ON kyc_provider_change_proposals',
    );
    await q.query(`CREATE TRIGGER kyc_provider_proposal_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_provider_change_proposals
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_proposal_transition_guard()`);
    await q.query(
      'DROP TRIGGER IF EXISTS kyc_tier_proposal_authority_guard ON kyc_tier_policy_proposals',
    );
    await q.query(`CREATE TRIGGER kyc_tier_proposal_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_tier_policy_proposals
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_proposal_transition_guard()`);
    await q.query(
      'DROP TRIGGER IF EXISTS kyc_provider_configuration_authority_guard ON kyc_provider_configuration',
    );
    await q.query(`CREATE TRIGGER kyc_provider_configuration_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_provider_configuration
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_provider_configuration_guard()`);
    await q.query(
      'DROP TRIGGER IF EXISTS kyc_provider_history_authority_guard ON kyc_provider_configuration_history',
    );
    await q.query(`CREATE TRIGGER kyc_provider_history_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_provider_configuration_history
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_provider_history_guard()`);
    await q.query(
      'DROP TRIGGER IF EXISTS kyc_tier_version_authority_guard ON kyc_tier_policy_versions',
    );
    await q.query(`CREATE TRIGGER kyc_tier_version_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_tier_policy_versions
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_tier_version_guard()`);
    await q.query('DROP TRIGGER IF EXISTS kyc_tier_head_authority_guard ON kyc_tier_policy_head');
    await q.query(`CREATE TRIGGER kyc_tier_head_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_tier_policy_head
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_tier_head_guard()`);

    await q.query('GRANT SELECT ON kyc_tier_evaluations TO monienaija_authority_core');
    await q.query(
      'GRANT SELECT,INSERT,UPDATE ON kyc_evaluation_refresh TO monienaija_authority_core',
    );
    for (const table of [
      'kyc_provider_configuration',
      'kyc_provider_change_proposals',
      'kyc_provider_configuration_history',
      'kyc_tier_policy_head',
      'kyc_tier_policy_proposals',
      'kyc_tier_policy_versions',
    ]) {
      await q.query(`GRANT SELECT ON ${table} TO monienaija_runtime`);
      await q.query(
        `REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON ${table} FROM PUBLIC,monienaija_runtime`,
      );
      await q.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO monienaija_authority_core`);
    }
    await q.query(`DO $$ BEGIN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO monienaija_authority_core,monienaija_runtime',current_schema());
    END $$`);
  }

  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(`SELECT
      EXISTS(SELECT 1 FROM kyc_provider_change_proposals) OR
      EXISTS(SELECT 1 FROM kyc_provider_configuration_history) OR
      EXISTS(SELECT 1 FROM kyc_tier_policy_proposals) OR
      EXISTS(SELECT 1 FROM kyc_tier_policy_versions) OR
      EXISTS(SELECT 1 FROM protected_authority.kyc_governance_decisions) AS has_history`)) as Array<{
      has_history: boolean;
    }>;
    if (rows[0]?.has_history)
      throw new Error('Refusing to remove protected KYC governance history');

    for (const [table, trigger] of [
      ['kyc_provider_change_proposals', 'kyc_provider_proposal_authority_guard'],
      ['kyc_tier_policy_proposals', 'kyc_tier_proposal_authority_guard'],
      ['kyc_provider_configuration', 'kyc_provider_configuration_authority_guard'],
      ['kyc_provider_configuration_history', 'kyc_provider_history_authority_guard'],
      ['kyc_tier_policy_versions', 'kyc_tier_version_authority_guard'],
      ['kyc_tier_policy_head', 'kyc_tier_head_authority_guard'],
    ]) {
      await q.query(`DROP TRIGGER ${trigger} ON ${table}`);
    }
    const functions = [
      'kyc_governance_snapshot(text,text,uuid)',
      'kyc_governance_payload_digest(text,text,uuid)',
      'kyc_governance_current_version(text,text)',
      'kyc_governance_decision_matches(text,text,uuid,text,text,uuid,timestamp with time zone)',
      'kyc_governance_decision_guard()',
      'kyc_proposal_transition_guard()',
      'kyc_provider_configuration_guard()',
      'kyc_provider_history_guard()',
      'kyc_tier_version_guard()',
      'kyc_tier_head_guard()',
    ];
    await q.query('DROP TABLE protected_authority.kyc_governance_decisions');
    for (const signature of functions)
      await q.query(`DROP FUNCTION protected_authority.${signature}`);
    await q.query(`ALTER TABLE kyc_provider_configuration
      DROP CONSTRAINT fk_kyc_provider_configuration_last_proposal,
      DROP COLUMN last_proposal_id`);
    await q.query(`ALTER TABLE kyc_tier_policy_head
      DROP CONSTRAINT fk_kyc_tier_policy_head_last_proposal,
      DROP COLUMN last_proposal_id`);
  }
}
