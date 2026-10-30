import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentOutletsAndTerminals1785753600062 implements MigrationInterface {
  name = 'CreateAgentOutletsAndTerminals1785753600062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Agent outlets — physical/service location for an Agent
    // Minimal V1 foundation: Agent ownership, unique reference/code, name, status, optional address, audit, soft delete
    // No geospatial, regulatory, or financial fields; Aggregator context is via AggregatorAgentRelationship, not outlet column
    await queryRunner.query(`
      CREATE TABLE agent_outlets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        reference VARCHAR(80) NOT NULL,
        code VARCHAR(80),
        name VARCHAR(320) NOT NULL,
        display_name VARCHAR(160),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        address_line VARCHAR(500),
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100) DEFAULT 'NG',
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_outlets_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_outlets_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
        CONSTRAINT chk_agent_outlets_version CHECK (version > 0),
        CONSTRAINT chk_agent_outlets_reference CHECK (length(reference) >= 3),
        CONSTRAINT chk_agent_outlets_name CHECK (length(name) >= 2)
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_outlets_reference ON agent_outlets (reference) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_outlets_code ON agent_outlets (code) WHERE deleted_at IS NULL AND code IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_agent_outlets_agent ON agent_outlets (agent_id)`);
    await queryRunner.query(`CREATE INDEX idx_agent_outlets_status ON agent_outlets (status)`);

    // Agent terminals — device/terminal associated with an Agent and its Outlet
    // Minimal V1: Agent ownership + Outlet association, unique terminal reference, status, optional label/serial
    // No NIBSS, bank, SIM, crypto, settlement, or hardware attestation fields
    await queryRunner.query(`
      CREATE TABLE agent_terminals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL,
        outlet_id UUID NOT NULL,
        reference VARCHAR(80) NOT NULL,
        code VARCHAR(80),
        label VARCHAR(160),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        serial_number VARCHAR(100),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_terminals_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT fk_agent_terminals_outlet FOREIGN KEY (outlet_id) REFERENCES agent_outlets(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_terminals_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
        CONSTRAINT chk_agent_terminals_version CHECK (version > 0),
        CONSTRAINT chk_agent_terminals_reference CHECK (length(reference) >= 3)
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_terminals_reference ON agent_terminals (reference) WHERE deleted_at IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_terminals_code ON agent_terminals (code) WHERE deleted_at IS NULL AND code IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_agent_terminals_agent ON agent_terminals (agent_id)`);
    await queryRunner.query(`CREATE INDEX idx_agent_terminals_outlet ON agent_terminals (outlet_id)`);
    await queryRunner.query(`CREATE INDEX idx_agent_terminals_status ON agent_terminals (status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS agent_terminals`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_outlets`);
  }
}
