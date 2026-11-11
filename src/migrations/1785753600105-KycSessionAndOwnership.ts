import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Legacy unbound consents remain historical and cannot authorize new verification. */
export class KycSessionAndOwnership1785753600105 implements MigrationInterface {
  name = 'KycSessionAndOwnership1785753600105';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE kyc_consents ADD COLUMN session_id uuid REFERENCES authentication_sessions(id)`,
    );
    await q.query(`CREATE TABLE kyc_ownership_key_state (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      key_version varchar(64) NOT NULL, key_proof char(64) NOT NULL
    )`);
    await q.query(`CREATE TABLE kyc_identity_claims (
      id uuid PRIMARY KEY, kind varchar(3) NOT NULL CHECK (kind IN ('BVN','NIN')),
      identifier_mac char(64) NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id),
      attempt_id uuid NOT NULL REFERENCES kyc_verification_attempts(id),
      status varchar(12) NOT NULL CHECK (status IN ('PENDING','VERIFIED','UNKNOWN','REVIEW')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (kind,identifier_mac), UNIQUE (attempt_id)
    )`);
    await q.query(
      `CREATE INDEX idx_kyc_identity_claims_customer ON kyc_identity_claims(customer_id,kind)`,
    );
    await q.query(`CREATE TABLE kyc_identity_conflicts (
      id uuid PRIMARY KEY, requester_customer_id uuid NOT NULL REFERENCES customers(id),
      claim_id uuid NOT NULL REFERENCES kyc_identity_claims(id),
      claimed_customer_id uuid NOT NULL REFERENCES customers(id),
      kind varchar(3) NOT NULL CHECK (kind IN ('BVN','NIN')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED_HOLD')),
      UNIQUE(requester_customer_id,claim_id)
    )`);
    await q.query(`CREATE TABLE kyc_exception_reviews (
      id uuid PRIMARY KEY, conflict_id uuid NOT NULL UNIQUE REFERENCES kyc_identity_conflicts(id),
      reviewer_id uuid NOT NULL, disposition varchar(16) NOT NULL CHECK (disposition='HOLD'),
      reason_code varchar(32) NOT NULL CHECK (reason_code IN ('DUPLICATE_UNRESOLVED','OWNERSHIP_DISPUTED','PROVIDER_OUTCOME_UNKNOWN')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`CREATE TABLE kyc_reconciliation_cases (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL UNIQUE REFERENCES kyc_verification_attempts(id),
      customer_id uuid NOT NULL REFERENCES customers(id), reason varchar(16) NOT NULL CHECK (reason IN ('UNKNOWN','INTERRUPTED')),
      status varchar(16) NOT NULL CHECK (status IN ('OPEN','NO_ACTION')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), closed_at timestamptz
    )`);
    await q.query(`CREATE TABLE kyc_evaluation_refresh (
      customer_id uuid PRIMARY KEY REFERENCES customers(id), revision bigint NOT NULL DEFAULT 1,
      requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`ALTER TABLE kyc_private_audit DROP CONSTRAINT kyc_private_audit_action_check`);
    await q.query(
      `ALTER TABLE kyc_private_audit ADD CONSTRAINT kyc_private_audit_action_check CHECK (action IN ('CONSENT_GRANTED','CONSENT_WITHDRAWN','ATTEMPT_RESERVED','ATTEMPT_FINISHED','OWNERSHIP_CONFLICT','RECONCILIATION_OPENED','RECONCILIATION_CLOSED','OWNERSHIP_REVIEWED'))`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT (EXISTS (SELECT 1 FROM kyc_identity_claims) OR EXISTS (SELECT 1 FROM kyc_identity_conflicts) OR EXISTS (SELECT 1 FROM kyc_exception_reviews) OR EXISTS (SELECT 1 FROM kyc_consents WHERE session_id IS NOT NULL) OR EXISTS (SELECT 1 FROM kyc_ownership_key_state) OR EXISTS (SELECT 1 FROM kyc_reconciliation_cases) OR EXISTS (SELECT 1 FROM kyc_evaluation_refresh)) AS has_data`,
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) throw new Error('Refusing to remove KYC ownership or consent history');
    await q.query('ALTER TABLE kyc_private_audit DROP CONSTRAINT kyc_private_audit_action_check');
    await q.query(
      "ALTER TABLE kyc_private_audit ADD CONSTRAINT kyc_private_audit_action_check CHECK (action IN ('CONSENT_GRANTED','CONSENT_WITHDRAWN','ATTEMPT_RESERVED','ATTEMPT_FINISHED'))",
    );
    await q.query('DROP TABLE kyc_evaluation_refresh');
    await q.query('DROP TABLE kyc_reconciliation_cases');
    await q.query('DROP TABLE kyc_exception_reviews');
    await q.query('DROP TABLE kyc_identity_conflicts');
    await q.query('DROP TABLE kyc_identity_claims');
    await q.query('DROP TABLE kyc_ownership_key_state');
    await q.query('ALTER TABLE kyc_consents DROP COLUMN session_id');
  }
}
