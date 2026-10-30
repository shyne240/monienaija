import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Decision 7 agent-funding maker/checker evidence and one-time request consumption.
 *
 * This is additive: it introduces a request/approval record for existing agent fund and defund
 * movements without changing ledger posting, wallet, or role-catalogue schema.
 */
export class CreateAgentFundingRequests1785753600090 implements MigrationInterface {
  name = 'CreateAgentFundingRequests1785753600090';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agent_funding_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('FUND','DEFUND')),
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        aggregator_id UUID REFERENCES aggregators(id) ON DELETE RESTRICT,
        amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
        currency VARCHAR(3) NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
        idempotency_key VARCHAR(255) NOT NULL,
        reference VARCHAR(255) NOT NULL,
        correlation_id VARCHAR(255),
        description VARCHAR(255) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_aggregator_funding BOOLEAN NOT NULL DEFAULT FALSE,
        request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
        approval_fingerprint CHAR(64) NOT NULL CHECK (approval_fingerprint ~ '^[a-f0-9]{64}$'),
        approval_id UUID NOT NULL REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING','REJECTED','EXECUTED')),
        maker_principal_id VARCHAR(160) NOT NULL,
        maker_role VARCHAR(80) NOT NULL CHECK (maker_role = 'AGENT_NETWORK_MANAGER'),
        maker_type VARCHAR(20) NOT NULL,
        checker_principal_id VARCHAR(160),
        checker_role VARCHAR(80),
        checker_type VARCHAR(20),
        journal_id UUID REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        rejection_reason VARCHAR(500),
        approved_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        executed_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_agent_funding_requests_approval UNIQUE (approval_id),
        CONSTRAINT uq_agent_funding_requests_journal UNIQUE (journal_id),
        CONSTRAINT chk_agent_funding_requests_aggregator CHECK (
          (is_aggregator_funding AND aggregator_id IS NOT NULL)
          OR (NOT is_aggregator_funding AND aggregator_id IS NULL)
        ),
        CONSTRAINT chk_agent_funding_requests_maker_checker CHECK (
          (
            status = 'PENDING' AND checker_principal_id IS NULL AND checker_role IS NULL
              AND checker_type IS NULL AND journal_id IS NULL AND rejected_at IS NULL
              AND executed_at IS NULL AND approved_at IS NULL AND rejection_reason IS NULL
          ) OR (
            status = 'REJECTED' AND checker_principal_id IS NOT NULL
              AND checker_role = 'FINANCE_CONTROLLER' AND checker_type IS NOT NULL
              AND checker_principal_id <> maker_principal_id AND journal_id IS NULL
              AND rejected_at IS NOT NULL AND executed_at IS NULL AND approved_at IS NULL
              AND rejection_reason IS NOT NULL
          ) OR (
            status = 'EXECUTED' AND checker_principal_id IS NOT NULL
              AND checker_role = 'FINANCE_CONTROLLER' AND checker_type IS NOT NULL
              AND checker_principal_id <> maker_principal_id AND journal_id IS NOT NULL
              AND executed_at IS NOT NULL AND rejected_at IS NULL AND approved_at IS NOT NULL
              AND rejection_reason IS NULL
          )
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_agent_funding_requests_idempotency
      ON agent_funding_requests (direction, agent_id, idempotency_key)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_funding_requests_status_created
      ON agent_funding_requests (status, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_funding_requests_aggregator_created
      ON agent_funding_requests (aggregator_id, created_at)
      WHERE aggregator_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_agent_funding_requests_maker_created
      ON agent_funding_requests (maker_principal_id, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE agent_funding_requests');
  }
}
