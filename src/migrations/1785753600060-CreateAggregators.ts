import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAggregators1785753600060 implements MigrationInterface {
  name = 'CreateAggregators1785753600060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Aggregators table — first-class corporate participant, distinct from Agent/Customer
    await queryRunner.query(`
      CREATE TABLE aggregators (
        id UUID PRIMARY KEY,
        reference VARCHAR(80) NOT NULL,
        code VARCHAR(80) NOT NULL,
        corporate_name VARCHAR(320) NOT NULL,
        display_name VARCHAR(160),
        contact_email VARCHAR(320),
        contact_phone VARCHAR(20),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT uq_aggregators_reference UNIQUE (reference),
        CONSTRAINT uq_aggregators_code UNIQUE (code),
        CONSTRAINT chk_aggregators_status CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
        CONSTRAINT chk_aggregators_version CHECK (version > 0),
        CONSTRAINT chk_aggregators_reference CHECK (length(reference) >= 3),
        CONSTRAINT chk_aggregators_code CHECK (length(code) >= 3),
        CONSTRAINT chk_aggregators_corporate_name CHECK (length(corporate_name) >= 2)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_aggregators_status ON aggregators (status)
    `);

    // Aggregator ↔ Agent relationship — first-class, auditable, lifecycle-aware
    // Cardinality: one Agent may belong to at most ONE ACTIVE Aggregator (1-to-many, optional)
    await queryRunner.query(`
      CREATE TABLE aggregator_agent_assignments (
        id UUID PRIMARY KEY,
        aggregator_id UUID NOT NULL,
        agent_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unassigned_at TIMESTAMPTZ,
        assigned_by VARCHAR(160) NOT NULL,
        unassigned_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_aggregator_agent_aggregator FOREIGN KEY (aggregator_id) REFERENCES aggregators(id) ON DELETE RESTRICT,
        CONSTRAINT fk_aggregator_agent_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_aggregator_agent_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
        CONSTRAINT chk_aggregator_agent_version CHECK (version > 0),
        CONSTRAINT chk_aggregator_agent_unassigned CHECK (
          (status = 'TERMINATED' AND unassigned_at IS NOT NULL) OR
          (status != 'TERMINATED' AND unassigned_at IS NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_aggregator_agent_aggregator ON aggregator_agent_assignments (aggregator_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_aggregator_agent_agent ON aggregator_agent_assignments (agent_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_aggregator_agent_status ON aggregator_agent_assignments (status)
    `);

    // Enforce single active aggregator per agent via partial unique index
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_aggregator_agent_active
        ON aggregator_agent_assignments (agent_id)
        WHERE status = 'ACTIVE'
    `);

    // Additional index to prevent duplicate exact pairs where not terminated? We allow history via terminated rows, but prevent duplicate active/suspended
    // The partial unique above already covers ACTIVE. For SUSPENDED we also want uniqueness per aggregator+agent where not terminated
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_aggregator_agent_pair_not_terminated
        ON aggregator_agent_assignments (aggregator_id, agent_id)
        WHERE status != 'TERMINATED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_aggregator_agent_pair_not_terminated`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_aggregator_agent_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_aggregator_agent_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_aggregator_agent_agent`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_aggregator_agent_aggregator`);
    await queryRunner.query(`DROP TABLE IF EXISTS aggregator_agent_assignments`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_aggregators_status`);
    await queryRunner.query(`DROP TABLE IF EXISTS aggregators`);
  }
}
