import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive only; no existing customer, KYC, wallet, or financial data is changed. */
export class CreateKycFoundation1785753600104 implements MigrationInterface {
  name = 'CreateKycFoundation1785753600104';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE kyc_provider_locks (provider varchar(32) PRIMARY KEY)`);
    await q.query(`CREATE TABLE kyc_consents (
      id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
      kind varchar(3) NOT NULL CHECK (kind IN ('BVN','NIN')),
      notice_version varchar(64) NOT NULL, actor_id uuid NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      withdrawn_at timestamptz, UNIQUE(id, customer_id, kind),
      CHECK (expires_at > granted_at), CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
    )`);
    await q.query(`CREATE TABLE kyc_verification_attempts (
      id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id), consent_id uuid NOT NULL,
      request_id uuid NOT NULL, kind varchar(3) NOT NULL CHECK (kind IN ('BVN','NIN')),
      provider varchar(32) NOT NULL, policy_version varchar(64) NOT NULL,
      request_mac char(64) NOT NULL, identity_mac char(64) NOT NULL, mac_key_version varchar(64) NOT NULL,
      provider_reference_mac char(64), outcome varchar(24) NOT NULL CHECK (outcome IN ('DISPATCHING','MATCH','REVIEW','UNKNOWN','CONSENT_WITHDRAWN')),
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, expires_at timestamptz,
      UNIQUE(customer_id, request_id), FOREIGN KEY(consent_id, customer_id, kind) REFERENCES kyc_consents(id, customer_id, kind),
      CHECK ((outcome = 'DISPATCHING' AND completed_at IS NULL AND expires_at IS NULL) OR (outcome <> 'DISPATCHING' AND completed_at IS NOT NULL)),
      CHECK (outcome = 'MATCH' OR expires_at IS NULL),
      CHECK (outcome <> 'MATCH' OR expires_at IS NOT NULL)
    )`);
    await q.query(
      `CREATE INDEX idx_kyc_attempts_customer_time ON kyc_verification_attempts(customer_id, created_at DESC)`,
    );
    await q.query(
      `CREATE INDEX idx_kyc_attempts_provider_time ON kyc_verification_attempts(provider, created_at DESC)`,
    );
    await q.query(`CREATE TABLE kyc_private_audit (
      id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id),
      resource_id uuid NOT NULL, action varchar(32) NOT NULL CHECK (action IN ('CONSENT_GRANTED','CONSENT_WITHDRAWN','ATTEMPT_RESERVED','ATTEMPT_FINISHED')),
      actor_id uuid, outcome varchar(24), occurred_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(
      `CREATE INDEX idx_kyc_private_audit_customer ON kyc_private_audit(customer_id, occurred_at DESC)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT (EXISTS (SELECT 1 FROM kyc_consents) OR EXISTS (SELECT 1 FROM kyc_verification_attempts) OR EXISTS (SELECT 1 FROM kyc_private_audit)) AS has_data`,
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove KYC history');
    await q.query('DROP TABLE kyc_private_audit');
    await q.query('DROP TABLE kyc_verification_attempts');
    await q.query('DROP TABLE kyc_consents');
    await q.query('DROP TABLE kyc_provider_locks');
  }
}
