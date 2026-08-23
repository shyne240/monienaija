import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateB2FFinanceControlTables1785753600048 implements MigrationInterface {
  name = 'CreateB2FFinanceControlTables1785753600048';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE b2f_finance_control_policies (
    id UUID PRIMARY KEY, policy_reference VARCHAR(100) NOT NULL UNIQUE, policy_key VARCHAR(100) NOT NULL, policy_version INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL, definition_hash CHAR(64) NOT NULL, definition JSONB NOT NULL, effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ, created_by VARCHAR(160) NOT NULL, approval_id UUID, record_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_b2f_finance_control_policy_key_version UNIQUE(policy_key,policy_version),
    CONSTRAINT chk_b2f_finance_control_policy_status CHECK(status IN ('DRAFT','ACTIVE','RETIRED','REJECTED')),
    CONSTRAINT chk_b2f_finance_control_policy_hash CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT chk_b2f_finance_control_policy_dates CHECK(effective_to IS NULL OR effective_to > effective_from)
  )`);
    await q.query(
      `CREATE UNIQUE INDEX uq_b2f_finance_control_policy_active ON b2f_finance_control_policies(policy_key) WHERE status='ACTIVE'`,
    );
    await q.query(`CREATE TABLE b2f_finance_control_decisions (
    id UUID PRIMARY KEY, decision_reference VARCHAR(100) NOT NULL UNIQUE, outcome VARCHAR(8) NOT NULL, action VARCHAR(80) NOT NULL,
    materiality_band VARCHAR(20), policy_key VARCHAR(100) NOT NULL, policy_version INTEGER NOT NULL, resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL, request_hash CHAR(64) NOT NULL, decision_hash CHAR(64) NOT NULL, decision JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CONSTRAINT chk_b2f_finance_control_decision_outcome CHECK(outcome IN ('ALLOW','DENY')),
    CONSTRAINT chk_b2f_finance_control_decision_hashes CHECK(request_hash ~ '^[a-f0-9]{64}$' AND decision_hash ~ '^[a-f0-9]{64}$')
  )`);
    await q.query(
      `CREATE INDEX idx_b2f_finance_control_decision_resource ON b2f_finance_control_decisions(resource_type,resource_id)`,
    );
    await q.query(
      `CREATE INDEX idx_b2f_finance_control_decision_outcome ON b2f_finance_control_decisions(outcome,created_at)`,
    );
    await q.query(
      `ALTER TABLE b2f_finance_journal_governance ADD COLUMN prepared_by VARCHAR(160), ADD COLUMN prepared_roles JSONB NOT NULL DEFAULT '[]'::jsonb, ADD COLUMN control_decision_reference VARCHAR(100)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE b2f_finance_journal_governance DROP COLUMN IF EXISTS control_decision_reference, DROP COLUMN IF EXISTS prepared_roles, DROP COLUMN IF EXISTS prepared_by`,
    );
    await q.query(`DROP TABLE IF EXISTS b2f_finance_control_decisions`);
    await q.query(`DROP INDEX IF EXISTS uq_b2f_finance_control_policy_active`);
    await q.query(`DROP TABLE IF EXISTS b2f_finance_control_policies`);
  }
}
