import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentReceivingNumbers1785753600055 implements MigrationInterface {
  name = 'CreateAgentReceivingNumbers1785753600055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agent_receiving_numbers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        receiving_number VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_receiving_numbers_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_receiving_numbers_status CHECK (status IN ('ACTIVE', 'REVOKED')),
        CONSTRAINT chk_agent_receiving_numbers_number CHECK (receiving_number ~ '^[0-9]{10}$'),
        CONSTRAINT chk_agent_receiving_numbers_number_prefix CHECK (receiving_number ~ '^[789][0-9]{9}$'),
        CONSTRAINT chk_agent_receiving_numbers_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_receiving_numbers_agent_id ON agent_receiving_numbers (agent_id) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_receiving_numbers_number ON agent_receiving_numbers (receiving_number) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE INDEX idx_agent_receiving_numbers_agent ON agent_receiving_numbers (agent_id)`);
    await queryRunner.query(`CREATE INDEX idx_agent_receiving_numbers_number ON agent_receiving_numbers (receiving_number)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS agent_receiving_numbers`);
  }
}
