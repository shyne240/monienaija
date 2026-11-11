import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive governance state; the initial snapshot is disabled and has no routes. */
export class KycProviderGovernance1785753600109 implements MigrationInterface {
  name = 'KycProviderGovernance1785753600109';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE kyc_provider_configuration (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL CHECK(version>=0),
      configuration jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `INSERT INTO kyc_provider_configuration(singleton,version,configuration) VALUES(true,0,'{"providers":{"MONNIFY":{"enabled":false,"capabilities":[]},"SYNTHETIC":{"enabled":false,"capabilities":[]}},"routes":{"BVN":{"primary":null,"fallback":null},"NIN":{"primary":null,"fallback":null}}}'::jsonb)`,
    );
    await q.query(`CREATE TABLE kyc_provider_change_proposals (
      id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE, expected_version integer NOT NULL CHECK(expected_version>=0),
      configuration jsonb NOT NULL, fingerprint char(64) NOT NULL, reason_code varchar(32) NOT NULL CHECK(reason_code IN ('INITIAL_SETUP','ROUTING_CHANGE','PROVIDER_DISABLE')),
      maker_id varchar(160) NOT NULL, maker_session_id uuid NOT NULL,
      checker_id varchar(160), checker_session_id uuid, state varchar(12) NOT NULL CHECK(state IN ('REQUESTED','APPROVED','REJECTED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours', decided_at timestamptz,
      CHECK(checker_id IS NULL OR checker_id<>maker_id)
    )`);
    await q.query(`CREATE TABLE kyc_provider_configuration_history (
      version integer PRIMARY KEY CHECK(version>0), proposal_id uuid NOT NULL UNIQUE REFERENCES kyc_provider_change_proposals(id),
      configuration jsonb NOT NULL, maker_id varchar(160) NOT NULL, checker_id varchar(160) NOT NULL,
      reason_code varchar(32) NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(maker_id<>checker_id)
    )`);
    await q.query(`DO $$ BEGIN
      IF to_regclass('authorization_functions') IS NOT NULL AND to_regclass('authorization_roles') IS NOT NULL AND to_regclass('authorization_role_functions') IS NOT NULL THEN
       IF EXISTS (SELECT 1 FROM authorization_roles WHERE is_system_seeded=TRUE) THEN
        INSERT INTO authorization_functions(function_code,domain,name,description,sensitivity,v1_status,assignable,finance_class_restricted,maker_checker_required,approval_required,super_admin_excluded,auditor_visible,notes)
        VALUES ('kyc.provider.view','COMPLIANCE','View KYC provider configuration','View non-secret KYC provider configuration and history','READ','IMPLEMENTED',TRUE,FALSE,FALSE,FALSE,FALSE,TRUE,NULL),
          ('kyc.provider.propose','COMPLIANCE','Propose KYC provider configuration','Propose KYC provider routing under independent approval','PRIVILEGED','IMPLEMENTED',TRUE,FALSE,TRUE,TRUE,FALSE,TRUE,NULL),
          ('kyc.provider.approve','COMPLIANCE','Approve KYC provider configuration','Independently approve KYC provider routing','PRIVILEGED','IMPLEMENTED',TRUE,FALSE,TRUE,TRUE,FALSE,TRUE,NULL)
        ON CONFLICT(function_code) DO NOTHING;
        INSERT INTO authorization_role_functions(role_id,function_code,access_type,is_active,assigned_by)
        SELECT r.id,v.function_code,v.access_type,TRUE,'SYSTEM_SEED' FROM (VALUES
          ('SUPER_ADMIN','kyc.provider.view','VIEW'),('SUPER_ADMIN','kyc.provider.propose','INITIATE'),
          ('COMPLIANCE','kyc.provider.view','VIEW'),('COMPLIANCE','kyc.provider.approve','APPROVE')) AS v(role_key,function_code,access_type)
        JOIN authorization_roles r ON r.role_key=v.role_key ON CONFLICT(role_id,function_code) DO NOTHING;
       END IF;
      END IF;
    END $$`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      'SELECT (EXISTS(SELECT 1 FROM kyc_provider_change_proposals) OR EXISTS(SELECT 1 FROM kyc_provider_configuration_history)) AS has_data',
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove KYC provider governance history');
    await q.query(
      `DO $$ BEGIN IF to_regclass('authorization_functions') IS NOT NULL THEN DELETE FROM authorization_role_functions WHERE function_code IN ('kyc.provider.view','kyc.provider.propose','kyc.provider.approve'); DELETE FROM authorization_functions WHERE function_code IN ('kyc.provider.view','kyc.provider.propose','kyc.provider.approve'); END IF; END $$`,
    );
    await q.query('DROP TABLE kyc_provider_configuration_history');
    await q.query('DROP TABLE kyc_provider_change_proposals');
    await q.query('DROP TABLE kyc_provider_configuration');
  }
}
