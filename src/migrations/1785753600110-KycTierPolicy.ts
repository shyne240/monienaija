import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive and initially unconfigured: no customer or assessment data is changed. */
export class KycTierPolicy1785753600110 implements MigrationInterface {
  name = 'KycTierPolicy1785753600110';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE kyc_tier_policy_head (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL CHECK(version>=0))`,
    );
    await q.query('INSERT INTO kyc_tier_policy_head(singleton,version) VALUES(true,0)');
    await q.query(`CREATE TABLE kyc_tier_policy_proposals (
      id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE, expected_version integer NOT NULL CHECK(expected_version>=0),
      definition jsonb NOT NULL, fingerprint char(64) NOT NULL,
      maker_id varchar(160) NOT NULL, maker_session_id uuid NOT NULL, checker_id varchar(160), checker_session_id uuid,
      state varchar(12) NOT NULL CHECK(state IN ('REQUESTED','APPROVED','REJECTED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours', decided_at timestamptz,
      CHECK(checker_id IS NULL OR checker_id<>maker_id)
    )`);
    await q.query(`CREATE TABLE kyc_tier_policy_versions (
      version integer PRIMARY KEY CHECK(version>0), proposal_id uuid NOT NULL UNIQUE REFERENCES kyc_tier_policy_proposals(id),
      definition jsonb NOT NULL, maker_id varchar(160) NOT NULL, checker_id varchar(160) NOT NULL, approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK(maker_id<>checker_id)
    )`);
    await q.query(
      'ALTER TABLE kyc_evaluation_refresh ADD COLUMN processed_revision bigint NOT NULL DEFAULT 0, ADD COLUMN retry_after timestamptz NOT NULL DEFAULT clock_timestamp()',
    );
    await q.query(`CREATE TABLE kyc_tier_evaluations (
      id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), revision bigint NOT NULL,
      policy_version integer, outcome varchar(24) NOT NULL, reason varchar(80) NOT NULL,
      old_level varchar(20) NOT NULL, new_level varchar(20), evidence_ids uuid[] NOT NULL DEFAULT '{}',
      assessment_id uuid REFERENCES customer_kyc_assessments(id), actor varchar(160) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(customer_id,revision)
    )`);
    await q.query(
      `CREATE TABLE kyc_tier_manual_holds(customer_id uuid PRIMARY KEY REFERENCES customers(id),actor varchar(160) NOT NULL,reason varchar(40) NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
    );
    await q.query(
      `CREATE TABLE kyc_tier_expiry_events(source varchar(8) NOT NULL CHECK(source IN ('ATTEMPT','CONSENT','ASSESS')),source_id uuid NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(source,source_id,expires_at))`,
    );
    await q.query(
      `CREATE INDEX idx_kyc_tier_evaluations_customer ON kyc_tier_evaluations(customer_id,created_at DESC)`,
    );
    await q.query(`CREATE FUNCTION kyc_tier_enqueue_evidence_change() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE subject uuid; BEGIN
        subject := CASE WHEN TG_OP='DELETE' THEN OLD.customer_id ELSE NEW.customer_id END;
        INSERT INTO kyc_evaluation_refresh(customer_id) VALUES(subject)
        ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp();
        IF TG_OP='UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
          INSERT INTO kyc_evaluation_refresh(customer_id) VALUES(OLD.customer_id)
          ON CONFLICT(customer_id) DO UPDATE SET revision=kyc_evaluation_refresh.revision+1,requested_at=clock_timestamp(),retry_after=clock_timestamp();
        END IF;
        RETURN NULL;
      END $$`);
    for (const table of [
      'kyc_verification_attempts',
      'kyc_consents',
      'kyc_identity_claims',
      'customer_contact_methods',
    ]) {
      await q.query(
        `CREATE TRIGGER kyc_tier_evidence_changed AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION kyc_tier_enqueue_evidence_change()`,
      );
    }
    await q.query(
      `CREATE TRIGGER kyc_tier_evidence_changed AFTER INSERT OR DELETE OR UPDATE OF first_name,last_name,date_of_birth,is_active,deleted_at,customer_id ON customer_profiles FOR EACH ROW EXECUTE FUNCTION kyc_tier_enqueue_evidence_change()`,
    );
    await q.query(`DO $$ BEGIN
      IF to_regclass('authorization_functions') IS NOT NULL AND to_regclass('authorization_roles') IS NOT NULL AND to_regclass('authorization_role_functions') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM authorization_roles WHERE is_system_seeded=TRUE) THEN
          INSERT INTO authorization_functions(function_code,domain,name,description,sensitivity,v1_status,assignable,finance_class_restricted,maker_checker_required,approval_required,super_admin_excluded,auditor_visible,notes)
          VALUES ('kyc.policy.view','COMPLIANCE','View KYC tier policies','View KYC requirements policy and history','READ','IMPLEMENTED',TRUE,FALSE,FALSE,FALSE,FALSE,TRUE,NULL),
          ('kyc.policy.propose','COMPLIANCE','Propose KYC tier policies','Propose KYC requirements for independent approval','PRIVILEGED','IMPLEMENTED',TRUE,FALSE,TRUE,TRUE,FALSE,TRUE,NULL),
          ('kyc.policy.approve','COMPLIANCE','Approve KYC tier policies','Independently approve KYC requirements','PRIVILEGED','IMPLEMENTED',TRUE,FALSE,TRUE,TRUE,FALSE,TRUE,NULL)
          ON CONFLICT(function_code) DO NOTHING;
          INSERT INTO authorization_role_functions(role_id,function_code,access_type,is_active,assigned_by)
          SELECT r.id,v.function_code,v.access_type,TRUE,'SYSTEM_SEED' FROM (VALUES
            ('SUPER_ADMIN','kyc.policy.view','VIEW'),('SUPER_ADMIN','kyc.policy.propose','INITIATE'),
            ('COMPLIANCE','kyc.policy.view','VIEW'),('COMPLIANCE','kyc.policy.approve','APPROVE')) AS v(role_key,function_code,access_type)
          JOIN authorization_roles r ON r.role_key=v.role_key ON CONFLICT(role_id,function_code) DO NOTHING;
        END IF;
      END IF;
    END $$`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT (EXISTS (SELECT 1 FROM kyc_tier_policy_proposals) OR EXISTS (SELECT 1 FROM kyc_tier_policy_versions) OR EXISTS (SELECT 1 FROM kyc_tier_evaluations) OR EXISTS (SELECT 1 FROM kyc_tier_manual_holds)) AS has_data',
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove KYC tier policy history');
    await q.query(
      `DO $$ BEGIN IF to_regclass('authorization_functions') IS NOT NULL THEN DELETE FROM authorization_role_functions WHERE function_code IN ('kyc.policy.view','kyc.policy.propose','kyc.policy.approve'); DELETE FROM authorization_functions WHERE function_code IN ('kyc.policy.view','kyc.policy.propose','kyc.policy.approve'); END IF; END $$`,
    );
    for (const table of [
      'kyc_verification_attempts',
      'kyc_consents',
      'kyc_identity_claims',
      'customer_contact_methods',
    ]) {
      await q.query(`DROP TRIGGER kyc_tier_evidence_changed ON ${table}`);
    }
    await q.query('DROP TRIGGER kyc_tier_evidence_changed ON customer_profiles');
    await q.query('DROP FUNCTION kyc_tier_enqueue_evidence_change()');
    await q.query('DROP TABLE kyc_tier_manual_holds');
    await q.query('DROP TABLE kyc_tier_expiry_events');
    await q.query('DROP TABLE kyc_tier_evaluations');
    await q.query(
      'ALTER TABLE kyc_evaluation_refresh DROP COLUMN processed_revision, DROP COLUMN retry_after',
    );
    await q.query('DROP TABLE kyc_tier_policy_versions');
    await q.query('DROP TABLE kyc_tier_policy_proposals');
    await q.query('DROP TABLE kyc_tier_policy_head');
  }
}
