import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores Prembly credentials separately from provider routing, with application encryption and
 * the existing protected KYC maker/checker evidence. The route proposal table remains the single
 * provider-governance proposal ledger; credential proposals are explicitly typed and projected
 * without ciphertext by the API.
 */
export class PremblyKycCredentialGovernance1785753600507 implements MigrationInterface {
  name = 'PremblyKycCredentialGovernance1785753600507';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE kyc_provider_change_proposals
      DROP CONSTRAINT IF EXISTS kyc_provider_change_proposals_reason_code_check`);
    await q.query(`ALTER TABLE kyc_provider_change_proposals
      ADD CONSTRAINT kyc_provider_change_proposals_reason_code_check
      CHECK(reason_code IN ('INITIAL_SETUP','ROUTING_CHANGE','PROVIDER_DISABLE','CREDENTIAL_CHANGE'))`);
    await q.query(`ALTER TABLE kyc_provider_change_proposals
      ADD COLUMN change_type varchar(32) NOT NULL DEFAULT 'ROUTING',
      ADD COLUMN expected_credential_version integer CHECK(expected_credential_version IS NULL OR expected_credential_version>=0),
      ADD COLUMN credential_change jsonb,
      ADD CONSTRAINT chk_kyc_provider_proposal_change_type CHECK (
        (change_type='ROUTING' AND reason_code<>'CREDENTIAL_CHANGE'
          AND expected_credential_version IS NULL AND credential_change IS NULL)
        OR
        (change_type='PREMBLY_CREDENTIAL' AND reason_code='CREDENTIAL_CHANGE'
          AND expected_credential_version IS NOT NULL AND credential_change IS NOT NULL
          AND credential_change->>'provider'='PREMBLY'
          AND credential_change->>'environment' IN ('sandbox','production')
          AND credential_change->>'operation' IN ('SET','CLEAR')
          AND ((credential_change->>'operation'='SET'
            AND credential_change->>'envelope' LIKE 'MNKPS1:%'
            AND credential_change->>'keyVersion' IS NOT NULL
            AND credential_change->>'fingerprint' ~ '^[*]{4}[A-Za-z0-9_-]{4}$')
            OR (credential_change->>'operation'='CLEAR'
              AND credential_change->>'envelope' IS NULL
              AND credential_change->>'keyVersion' IS NULL
              AND credential_change->>'fingerprint' IS NULL)))
      )`);

    await q.query(`CREATE TABLE kyc_provider_credentials (
      provider varchar(32) NOT NULL CHECK(provider='PREMBLY'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      version integer NOT NULL DEFAULT 0 CHECK(version>=0),
      encrypted_api_key text,
      key_version varchar(64),
      fingerprint varchar(16),
      last_proposal_id uuid REFERENCES kyc_provider_change_proposals(id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(provider,environment),
      CHECK ((encrypted_api_key IS NULL AND key_version IS NULL AND fingerprint IS NULL)
        OR (encrypted_api_key LIKE 'MNKPS1:%' AND key_version ~ '^[A-Za-z0-9._-]{1,64}$'
          AND fingerprint ~ '^[*]{4}[A-Za-z0-9_-]{4}$'))
    )`);
    await q.query(`INSERT INTO kyc_provider_credentials(provider,environment)
      VALUES ('PREMBLY','sandbox'),('PREMBLY','production')`);

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
            'SELECT jsonb_build_object(''id'',id,''request_id'',request_id,''expected_version'',expected_version,''configuration'',configuration,''fingerprint'',fingerprint,''reason_code'',reason_code,''change_type'',change_type,''expected_credential_version'',expected_credential_version,''credential_change'',credential_change,''maker_id'',maker_id,''maker_session_id'',maker_session_id,''created_at'',created_at,''expires_at'',expires_at,''state'',state,''checker_id'',checker_id,''checker_session_id'',checker_session_id,''decided_at'',decided_at) FROM %I.kyc_provider_change_proposals WHERE id=$1',
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
          IF kind='PROVIDER' AND (
            (NEW.change_type='ROUTING' AND (NEW.reason_code='CREDENTIAL_CHANGE' OR NEW.expected_credential_version IS NOT NULL OR NEW.credential_change IS NOT NULL))
            OR (NEW.change_type='PREMBLY_CREDENTIAL' AND (NEW.reason_code<>'CREDENTIAL_CHANGE' OR NEW.expected_credential_version IS NULL OR NEW.credential_change IS NULL))
            OR NEW.change_type NOT IN ('ROUTING','PREMBLY_CREDENTIAL')
          ) THEN
            RAISE EXCEPTION 'KYC provider proposal type is invalid' USING ERRCODE='55000';
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
          IF NEW.configuration IS DISTINCT FROM OLD.configuration
            OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
            OR NEW.change_type IS DISTINCT FROM OLD.change_type
            OR NEW.expected_credential_version IS DISTINCT FROM OLD.expected_credential_version
            OR NEW.credential_change IS DISTINCT FROM OLD.credential_change THEN
            RAISE EXCEPTION 'KYC provider proposal payload is immutable' USING ERRCODE='55000';
          END IF;
          IF NEW.change_type NOT IN ('ROUTING','PREMBLY_CREDENTIAL') THEN
            RAISE EXCEPTION 'KYC provider proposal type is invalid' USING ERRCODE='55000';
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

    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_provider_credential_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE s jsonb; change jsonb;
      BEGIN
        IF TG_OP<>'UPDATE' OR NEW.provider IS DISTINCT FROM OLD.provider
          OR NEW.environment IS DISTINCT FROM OLD.environment
          OR NEW.version<>OLD.version+1
          OR NEW.provider<>'PREMBLY'
          OR NEW.environment NOT IN ('sandbox','production')
          OR NEW.last_proposal_id IS NULL THEN
          RAISE EXCEPTION 'Prembly credential state requires one approved proposal version' USING ERRCODE='55000';
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,'PROVIDER',NEW.last_proposal_id);
        change := s->'credential_change';
        IF s IS NULL OR s->>'state'<>'APPROVED'
          OR s->>'change_type'<>'PREMBLY_CREDENTIAL'
          OR (s->>'expected_credential_version')::integer<>OLD.version
          OR change->>'provider'<>'PREMBLY'
          OR change->>'environment'<>NEW.environment
          OR NOT protected_authority.kyc_governance_decision_matches(
            TG_TABLE_SCHEMA,'PROVIDER',NEW.last_proposal_id,'APPROVED',s->>'checker_id',(s->>'checker_session_id')::uuid,(s->>'decided_at')::timestamptz
          ) THEN
          RAISE EXCEPTION 'Prembly credential update is not bound to an approved independent checker decision' USING ERRCODE='55000';
        END IF;
        IF change->>'operation'='SET' THEN
          IF NEW.encrypted_api_key IS DISTINCT FROM change->>'envelope'
            OR NEW.key_version IS DISTINCT FROM change->>'keyVersion'
            OR NEW.fingerprint IS DISTINCT FROM change->>'fingerprint' THEN
            RAISE EXCEPTION 'Prembly credential ciphertext differs from the approved proposal' USING ERRCODE='55000';
          END IF;
        ELSIF change->>'operation'='CLEAR' THEN
          IF NEW.encrypted_api_key IS NOT NULL OR NEW.key_version IS NOT NULL OR NEW.fingerprint IS NOT NULL THEN
            RAISE EXCEPTION 'Prembly credential removal does not match the approved proposal' USING ERRCODE='55000';
          END IF;
        ELSE
          RAISE EXCEPTION 'Prembly credential operation is invalid' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);

    await q.query(
      `ALTER FUNCTION protected_authority.kyc_governance_snapshot(text,text,uuid) OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `ALTER FUNCTION protected_authority.kyc_proposal_transition_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `ALTER FUNCTION protected_authority.kyc_provider_credential_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.kyc_governance_snapshot(text,text,uuid) FROM PUBLIC`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.kyc_proposal_transition_guard() FROM PUBLIC`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.kyc_provider_credential_guard() FROM PUBLIC`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.kyc_governance_snapshot(text,text,uuid) TO monienaija_authority_core`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.kyc_proposal_transition_guard() TO monienaija_authority_core`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.kyc_provider_credential_guard() TO monienaija_authority_core`,
    );

    await q.query(`CREATE TRIGGER kyc_provider_credentials_authority_guard
      BEFORE INSERT OR UPDATE OR DELETE ON kyc_provider_credentials
      FOR EACH ROW EXECUTE FUNCTION protected_authority.kyc_provider_credential_guard()`);
    await q.query(`GRANT SELECT ON kyc_provider_credentials TO monienaija_runtime`);
    await q.query(
      `REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON kyc_provider_credentials FROM PUBLIC,monienaija_runtime`,
    );
    await q.query(`GRANT SELECT,UPDATE ON kyc_provider_credentials TO monienaija_authority_core`);
    const auditTable = (await q.query(
      `SELECT to_regclass(format('%I.%I',current_schema(),'audit_events')) IS NOT NULL AS present`,
    )) as Array<{ present: boolean }>;
    if (auditTable[0]?.present)
      await q.query(`GRANT SELECT,INSERT ON audit_events TO monienaija_authority_core`);
  }

  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(`SELECT
      EXISTS(SELECT 1 FROM kyc_provider_change_proposals)
      OR EXISTS(SELECT 1 FROM kyc_provider_credentials WHERE version>0 OR encrypted_api_key IS NOT NULL)
      AS has_history`)) as Array<{ has_history: boolean }>;
    if (rows[0]?.has_history)
      throw new Error(
        'Refusing to remove Prembly credential governance history or provider decisions',
      );

    await q.query(
      `DROP TRIGGER kyc_provider_credentials_authority_guard ON kyc_provider_credentials`,
    );
    await q.query(`DROP FUNCTION protected_authority.kyc_provider_credential_guard()`);
    await q.query(`DROP TABLE kyc_provider_credentials`);
    await q.query(`ALTER TABLE kyc_provider_change_proposals
      DROP CONSTRAINT chk_kyc_provider_proposal_change_type,
      DROP COLUMN change_type,
      DROP COLUMN expected_credential_version,
      DROP COLUMN credential_change`);
    await q.query(`ALTER TABLE kyc_provider_change_proposals
      DROP CONSTRAINT kyc_provider_change_proposals_reason_code_check`);
    await q.query(`ALTER TABLE kyc_provider_change_proposals
      ADD CONSTRAINT kyc_provider_change_proposals_reason_code_check
      CHECK(reason_code IN ('INITIAL_SETUP','ROUTING_CHANGE','PROVIDER_DISABLE'))`);

    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_governance_snapshot(
        p_schema text,p_kind text,p_id uuid
      ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority SET timezone='UTC' AS $$
      DECLARE v jsonb;
      BEGIN
        IF p_schema IS NULL OR length(p_schema)>63 OR p_schema !~ '^[a-z_][a-z0-9_]*$' THEN RETURN NULL; END IF;
        IF p_kind='PROVIDER' THEN
          EXECUTE format('SELECT jsonb_build_object(''id'',id,''request_id'',request_id,''expected_version'',expected_version,''configuration'',configuration,''fingerprint'',fingerprint,''reason_code'',reason_code,''maker_id'',maker_id,''maker_session_id'',maker_session_id,''created_at'',created_at,''expires_at'',expires_at,''state'',state,''checker_id'',checker_id,''checker_session_id'',checker_session_id,''decided_at'',decided_at) FROM %I.kyc_provider_change_proposals WHERE id=$1',p_schema) INTO v USING p_id;
        ELSIF p_kind='TIER_POLICY' THEN
          EXECUTE format('SELECT jsonb_build_object(''id'',id,''request_id'',request_id,''expected_version'',expected_version,''definition'',definition,''fingerprint'',fingerprint,''maker_id'',maker_id,''maker_session_id'',maker_session_id,''created_at'',created_at,''expires_at'',expires_at,''state'',state,''checker_id'',checker_id,''checker_session_id'',checker_session_id,''decided_at'',decided_at) FROM %I.kyc_tier_policy_proposals WHERE id=$1',p_schema) INTO v USING p_id;
        ELSE RETURN NULL;
        END IF;
        RETURN v;
      END $$`);
    await q.query(`CREATE OR REPLACE FUNCTION protected_authority.kyc_proposal_transition_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE kind text; s jsonb; expected_state text;
      BEGIN
        kind := CASE WHEN TG_TABLE_NAME='kyc_provider_change_proposals' THEN 'PROVIDER' ELSE 'TIER_POLICY' END;
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'KYC governance proposals are immutable' USING ERRCODE='55000';
        ELSIF TG_OP='INSERT' THEN
          IF NEW.state<>'REQUESTED' OR NEW.checker_id IS NOT NULL OR NEW.checker_session_id IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
            RAISE EXCEPTION 'KYC proposals must begin in REQUESTED state' USING ERRCODE='55000';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.state<>'REQUESTED' OR NEW.state NOT IN ('APPROVED','REJECTED')
          OR NEW.id IS DISTINCT FROM OLD.id OR NEW.request_id IS DISTINCT FROM OLD.request_id
          OR NEW.expected_version IS DISTINCT FROM OLD.expected_version
          OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.maker_id IS DISTINCT FROM OLD.maker_id
          OR NEW.maker_session_id IS DISTINCT FROM OLD.maker_session_id
          OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
          OR NEW.checker_id IS NULL OR NEW.checker_session_id IS NULL OR NEW.decided_at IS NULL THEN
          RAISE EXCEPTION 'KYC proposal payload is immutable and may be decided once' USING ERRCODE='55000';
        END IF;
        IF kind='PROVIDER' THEN
          IF NEW.configuration IS DISTINCT FROM OLD.configuration OR NEW.reason_code IS DISTINCT FROM OLD.reason_code THEN
            RAISE EXCEPTION 'KYC provider proposal payload is immutable' USING ERRCODE='55000';
          END IF;
        ELSIF NEW.definition IS DISTINCT FROM OLD.definition THEN
          RAISE EXCEPTION 'KYC tier-policy proposal payload is immutable' USING ERRCODE='55000';
        END IF;
        s := protected_authority.kyc_governance_snapshot(TG_TABLE_SCHEMA,kind,NEW.id);
        expected_state := NEW.state;
        IF s IS NULL OR s->>'state'<>'REQUESTED'
          OR (s->>'expected_version')::integer IS DISTINCT FROM NEW.expected_version
          OR (s->>'expires_at')::timestamptz<=clock_timestamp()
          OR NOT protected_authority.kyc_governance_decision_matches(TG_TABLE_SCHEMA,kind,NEW.id,expected_state,NEW.checker_id,NEW.checker_session_id,NEW.decided_at) THEN
          RAISE EXCEPTION 'KYC proposal lacks matching immutable checker decision' USING ERRCODE='55000';
        END IF;
        IF protected_authority.kyc_governance_current_version(TG_TABLE_SCHEMA,kind) IS DISTINCT FROM NEW.expected_version THEN
          RAISE EXCEPTION 'KYC proposal version is stale' USING ERRCODE='40001';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.kyc_governance_snapshot(text,text,uuid) OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `ALTER FUNCTION protected_authority.kyc_proposal_transition_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.kyc_governance_snapshot(text,text,uuid) FROM PUBLIC`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.kyc_proposal_transition_guard() FROM PUBLIC`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.kyc_governance_snapshot(text,text,uuid) TO monienaija_authority_core`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.kyc_proposal_transition_guard() TO monienaija_authority_core`,
    );
  }
}
