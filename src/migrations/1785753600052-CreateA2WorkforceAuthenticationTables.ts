import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateA2WorkforceAuthenticationTables1785753600052 implements MigrationInterface {
  name = 'CreateA2WorkforceAuthenticationTables1785753600052';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE a2_workforce_sessions(id UUID PRIMARY KEY,principal_id VARCHAR(160) NOT NULL,issuer VARCHAR(2048) NOT NULL,subject VARCHAR(255) NOT NULL,token_hash CHAR(64) NOT NULL UNIQUE,audience VARCHAR(80) NOT NULL,status VARCHAR(16) NOT NULL,assurance_level VARCHAR(16) NOT NULL,roles JSONB NOT NULL,scopes JSONB NOT NULL,assertion_evidence JSONB NOT NULL,authenticated_at TIMESTAMPTZ NOT NULL,issued_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,last_seen_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,revoke_reason VARCHAR(500),version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),CONSTRAINT chk_a2_workforce_session_status CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')))`,
    );
    await q.query(
      `CREATE INDEX idx_a2_workforce_session_principal_status ON a2_workforce_sessions(principal_id,status)`,
    );
    await q.query(
      `CREATE INDEX idx_a2_workforce_session_expiry ON a2_workforce_sessions(status,expires_at)`,
    );
    await q.query(
      `CREATE TABLE a2_finance_role_assignments(id UUID PRIMARY KEY,assignment_reference VARCHAR(160) NOT NULL,assignment_version INTEGER NOT NULL,principal_id VARCHAR(160) NOT NULL,role_key VARCHAR(100) NOT NULL,scopes JSONB NOT NULL,status VARCHAR(16) NOT NULL,interim BOOLEAN NOT NULL DEFAULT true,effective_from TIMESTAMPTZ NOT NULL,effective_to TIMESTAMPTZ NOT NULL,assigned_by VARCHAR(160) NOT NULL,assigned_at TIMESTAMPTZ NOT NULL,revoked_by VARCHAR(160),revoked_at TIMESTAMPTZ,bootstrap_reference VARCHAR(160),approval_ids JSONB NOT NULL,audit_references JSONB NOT NULL,record_version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),CONSTRAINT uq_a2_finance_assignment_reference_version UNIQUE(assignment_reference,assignment_version),CONSTRAINT chk_a2_finance_assignment_status CHECK(status IN ('ACTIVE','REVOKED')),CONSTRAINT chk_a2_finance_assignment_dates CHECK(effective_to>effective_from))`,
    );
    await q.query(
      `CREATE INDEX idx_a2_finance_assignment_principal_status ON a2_finance_role_assignments(principal_id,status)`,
    );
    await q.query(
      `CREATE INDEX idx_a2_finance_assignment_role_status ON a2_finance_role_assignments(role_key,status)`,
    );
    await q.query(
      `CREATE TABLE a2_workforce_bootstrap_consumptions(id UUID PRIMARY KEY,bootstrap_reference VARCHAR(160) NOT NULL,nonce VARCHAR(255) NOT NULL UNIQUE,statement_hash CHAR(64) NOT NULL,principal_id VARCHAR(160) NOT NULL,role_key VARCHAR(100) NOT NULL,scopes JSONB NOT NULL,environment VARCHAR(80) NOT NULL,audience VARCHAR(80) NOT NULL,signing_key_reference VARCHAR(160) NOT NULL,approval_change_reference VARCHAR(160) NOT NULL,consumed_at TIMESTAMPTZ NOT NULL,audit_reference UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CONSTRAINT chk_a2_workforce_bootstrap_role CHECK(role_key='FINANCE_ADMIN'))`,
    );
    await q.query(
      `CREATE INDEX idx_a2_workforce_bootstrap_principal ON a2_workforce_bootstrap_consumptions(principal_id)`,
    );
    await q.query(
      `CREATE TABLE a2_security_rate_buckets(id UUID PRIMARY KEY,bucket_key CHAR(64) NOT NULL UNIQUE,category VARCHAR(80) NOT NULL,tokens DOUBLE PRECISION NOT NULL,last_refill_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),CONSTRAINT chk_a2_security_rate_bucket_tokens CHECK(tokens>=0))`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS a2_security_rate_buckets');
    await q.query('DROP TABLE IF EXISTS a2_workforce_bootstrap_consumptions');
    await q.query('DROP TABLE IF EXISTS a2_finance_role_assignments');
    await q.query('DROP TABLE IF EXISTS a2_workforce_sessions');
  }
}
