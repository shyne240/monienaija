import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D banking — protected banking-provider configuration governance.
 *
 * Milestone marker so a partially migrated database is unambiguous.
 *
 * Shape mirrors the accepted KYC tier-policy governance (`1785753600504`) deliberately: the same
 * maker/checker lifecycle, the same append-only version history, the same protected schema for the
 * decision, and the same separation of the runtime role from the authority role. Reusing the proven
 * shape means one governance mental model for the whole system rather than two.
 *
 * What is different, and why: a banking provider configuration is not a monetary policy, so there
 * is no definition JSON to normalise into rules. It is a set of *enablement* facts — which provider,
 * which environment, which capabilities, whether approved routing is live. Those are still
 * decision-bearing (they can move money) so they still require independent approval, but they are
 * validated by the service rather than by a rules engine.
 *
 * Critically, **no provider configuration is seeded**. Approving a configuration cannot manufacture
 * commercial entitlement, an institution arrangement, or credentials; those are external facts the
 * row merely records an operator's assertion about.
 */
export class BankingProviderGovernance1785753600600 implements MigrationInterface {
  name = 'BankingProviderGovernance1785753600600';

  async up(q: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------- heads
    await q.query(`CREATE TABLE banking_provider_configuration_heads (
      institution_id uuid PRIMARY KEY REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
      last_proposal_id uuid,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);

    // ------------------------------------------------------------ proposals
    await q.query(`CREATE TABLE banking_provider_configuration_proposals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      request_id uuid NOT NULL,
      expected_version integer NOT NULL CHECK(expected_version >= 0),
      provider_key varchar(32) NOT NULL CHECK(provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      capabilities jsonb NOT NULL,
      routing_approved boolean NOT NULL DEFAULT false,
      operational_ready boolean NOT NULL DEFAULT false,
      -- Never a credential. A fingerprint proves the operator referenced a real secret bundle
      -- without this row ever holding material that could be replayed.
      credential_bundle_fingerprint char(64)
        CHECK(credential_bundle_fingerprint IS NULL
          OR credential_bundle_fingerprint ~ '^[0-9a-f]{64}$'),
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
    await q.query(`CREATE INDEX idx_banking_provider_proposals
      ON banking_provider_configuration_proposals(institution_id,created_at DESC)`);

    // ------------------------------------------------------------- versions
    await q.query(`CREATE TABLE banking_provider_configuration_versions (
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      version integer NOT NULL CHECK(version > 0),
      proposal_id uuid NOT NULL UNIQUE
        REFERENCES banking_provider_configuration_proposals(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL,
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      capabilities jsonb NOT NULL,
      routing_approved boolean NOT NULL,
      operational_ready boolean NOT NULL,
      definition jsonb NOT NULL,
      maker_id varchar(160) NOT NULL,
      checker_id varchar(160) NOT NULL,
      approved_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(institution_id,version),
      -- The control that makes "independent approval" real rather than a label on a form.
      CHECK(maker_id <> checker_id)
    )`);
    await q.query(`ALTER TABLE banking_provider_configuration_heads
      ADD CONSTRAINT fk_banking_provider_head_proposal
      FOREIGN KEY(last_proposal_id)
      REFERENCES banking_provider_configuration_proposals(id) ON DELETE RESTRICT`);

    // ------------------------------------------ protected authority decisions
    await q.query(`CREATE TABLE protected_authority.banking_provider_decisions (
      proposal_id uuid PRIMARY KEY
        REFERENCES public.banking_provider_configuration_proposals(id) ON DELETE RESTRICT,
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
      `ALTER TABLE protected_authority.banking_provider_decisions OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON protected_authority.banking_provider_decisions FROM PUBLIC, monienaija_runtime`,
    );
    await q.query(
      `GRANT SELECT,INSERT ON protected_authority.banking_provider_decisions TO monienaija_authority_core`,
    );

    // ----------------------------------------------------------------- digest
    await q.query(`CREATE FUNCTION protected_authority.banking_provider_payload_digest(p_id uuid)
      RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority SET timezone='UTC' AS $$
        SELECT encode(sha256(convert_to(jsonb_build_object(
          'id',p.id,'institution_id',p.institution_id,'request_id',p.request_id,
          'expected_version',p.expected_version,'provider_key',p.provider_key,
          'environment',p.environment,'capabilities',p.capabilities,
          'routing_approved',p.routing_approved,'operational_ready',p.operational_ready,
          'credential_bundle_fingerprint',p.credential_bundle_fingerprint,
          'definition',p.definition,'fingerprint',p.fingerprint,'reason',p.reason,
          'maker_id',p.maker_id,'maker_session_id',p.maker_session_id,
          'created_at',p.created_at,'expires_at',p.expires_at
        )::text,'UTF8')),'hex')
        FROM public.banking_provider_configuration_proposals p WHERE p.id=p_id
      $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.banking_provider_payload_digest(uuid) OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.banking_provider_payload_digest(uuid) FROM PUBLIC`,
    );
    await q.query(
      `GRANT EXECUTE ON FUNCTION protected_authority.banking_provider_payload_digest(uuid) TO monienaija_authority_core`,
    );

    // ------------------------------------------------------------ decision guard
    await q.query(`CREATE FUNCTION protected_authority.banking_provider_decision_guard()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,protected_authority AS $$
      DECLARE p public.banking_provider_configuration_proposals%ROWTYPE;
              v integer;
      BEGIN
        IF TG_OP<>'INSERT' THEN
          RAISE EXCEPTION 'Banking provider decisions are immutable' USING ERRCODE='55000';
        END IF;
        IF NOT pg_has_role(session_user,'monienaija_authority_core','MEMBER') THEN
          RAISE EXCEPTION 'Banking provider governance requires protected authority' USING ERRCODE='42501';
        END IF;
        SELECT * INTO p FROM public.banking_provider_configuration_proposals WHERE id=NEW.proposal_id;
        SELECT version INTO v FROM public.banking_provider_configuration_heads
          WHERE institution_id=NEW.institution_id;
        IF NOT FOUND OR p.id IS NULL OR p.state<>'REQUESTED'
          OR p.institution_id IS DISTINCT FROM NEW.institution_id
          OR p.expected_version IS DISTINCT FROM NEW.expected_version
          OR p.expected_version IS DISTINCT FROM v
          OR p.maker_id IS DISTINCT FROM NEW.maker_principal_id
          OR p.maker_session_id IS DISTINCT FROM NEW.maker_session_id
          OR p.fingerprint IS DISTINCT FROM NEW.payload_digest
          OR NEW.maker_principal_id = NEW.checker_principal_id
        THEN
          RAISE EXCEPTION 'Banking provider decision does not match its proposal'
            USING ERRCODE='55000';
        END IF;
        RETURN NEW;
      END $$`);
    await q.query(
      `ALTER FUNCTION protected_authority.banking_provider_decision_guard() OWNER TO monienaija_authority_core`,
    );
    await q.query(
      `REVOKE ALL ON FUNCTION protected_authority.banking_provider_decision_guard() FROM PUBLIC`,
    );
    await q.query(
      `CREATE TRIGGER trg_banking_provider_decision_guard
        BEFORE INSERT ON protected_authority.banking_provider_decisions
        FOR EACH ROW EXECUTE FUNCTION protected_authority.banking_provider_decision_guard()`,
    );

    // ------------------------------------------------ immutability of approved versions
    await q.query(`CREATE FUNCTION public.banking_provider_version_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        IF TG_OP='UPDATE' THEN
          RAISE EXCEPTION 'Approved banking provider versions are immutable' USING ERRCODE='55000';
        END IF;
        RAISE EXCEPTION 'Approved banking provider versions are append-only' USING ERRCODE='55000';
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_provider_version_immutable
      BEFORE UPDATE OR DELETE ON banking_provider_configuration_versions
      FOR EACH ROW EXECUTE FUNCTION public.banking_provider_version_immutable()`);

    // A decision, once recorded, must not be rewritten either.
    await q.query(`CREATE FUNCTION public.banking_provider_decision_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
      BEGIN
        RAISE EXCEPTION 'Banking provider decisions are immutable' USING ERRCODE='55000';
      END $$`);
    await q.query(`CREATE TRIGGER trg_banking_provider_decision_immutable
      BEFORE UPDATE OR DELETE ON banking_provider_configuration_proposals
      FOR EACH ROW WHEN (OLD.state <> 'REQUESTED')
      EXECUTE FUNCTION public.banking_provider_decision_immutable()`);

    // ------------------------------------------- emergency operational disablement
    // Separate from configuration on purpose. Disabling must be possible immediately, under approved
    // authority, WITHOUT publishing a new configuration -- a financial safety control that requires
    // a full maker/checker round trip is one nobody uses during an incident.
    await q.query(`CREATE TABLE banking_provider_disengagements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      institution_id uuid NOT NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
      provider_key varchar(32) NOT NULL,
      environment varchar(16) NOT NULL CHECK(environment IN ('sandbox','production')),
      reason varchar(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
      engaged_by varchar(160) NOT NULL,
      engaged_by_session_id uuid NOT NULL,
      engaged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      reengaged_at timestamptz,
      reengaged_by varchar(160),
      reengaged_by_session_id uuid,
      CHECK((reengaged_at IS NULL AND reengaged_by IS NULL AND reengaged_by_session_id IS NULL)
        OR (reengaged_at IS NOT NULL AND reengaged_by IS NOT NULL
          AND reengaged_by_session_id IS NOT NULL))
    )`);
    // At most one OPEN disengagement per institution/provider/environment: the partial index is the
    // constraint, so two operators racing to disable cannot both "win" and leave an ambiguous state.
    await q.query(`CREATE UNIQUE INDEX uq_banking_provider_open_disengagement
      ON banking_provider_disengagements(institution_id,provider_key,environment)
      WHERE reengaged_at IS NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS banking_provider_disengagements`);
    await q.query(`DROP TRIGGER IF EXISTS trg_banking_provider_decision_immutable
      ON banking_provider_configuration_proposals`);
    await q.query(`DROP FUNCTION IF EXISTS public.banking_provider_decision_immutable()`);
    await q.query(`DROP TRIGGER IF EXISTS trg_banking_provider_version_immutable
      ON banking_provider_configuration_versions`);
    await q.query(`DROP FUNCTION IF EXISTS public.banking_provider_version_immutable()`);
    await q.query(`DROP TRIGGER IF EXISTS trg_banking_provider_decision_guard
      ON protected_authority.banking_provider_decisions`);
    await q.query(`DROP FUNCTION IF EXISTS protected_authority.banking_provider_decision_guard()`);
    await q.query(
      `DROP FUNCTION IF EXISTS protected_authority.banking_provider_payload_digest(uuid)`,
    );
    await q.query(`DROP TABLE IF EXISTS protected_authority.banking_provider_decisions`);
    await q.query(`ALTER TABLE banking_provider_configuration_heads
      DROP CONSTRAINT IF EXISTS fk_banking_provider_head_proposal`);
    await q.query(`DROP TABLE IF EXISTS banking_provider_configuration_versions`);
    await q.query(`DROP TABLE IF EXISTS banking_provider_configuration_proposals`);
    await q.query(`DROP TABLE IF EXISTS banking_provider_configuration_heads`);
  }
}
