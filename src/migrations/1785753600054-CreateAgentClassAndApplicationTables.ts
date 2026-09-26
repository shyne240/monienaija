import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentClassAndApplicationTables1785753600054 implements MigrationInterface {
  name = 'CreateAgentClassAndApplicationTables1785753600054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agent_classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(80) NOT NULL,
        code VARCHAR(80) NOT NULL,
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        requirements JSONB,
        required_information JSONB,
        required_document_categories JSONB,
        applicable_services JSONB,
        applicable_limits JSONB,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_agent_classes_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_classes_reference ON agent_classes (reference)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_classes_code ON agent_classes (code)`);
    await queryRunner.query(`CREATE INDEX idx_agent_classes_active ON agent_classes (is_active)`);

    await queryRunner.query(`
      CREATE TABLE agent_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(80) NOT NULL,
        agent_class_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        applicant_reference VARCHAR(160) NOT NULL,
        business_name VARCHAR(320),
        contact_email VARCHAR(320),
        payload JSONB,
        agent_id UUID,
        submitted_at TIMESTAMPTZ,
        reviewed_at TIMESTAMPTZ,
        approved_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        rejection_reason VARCHAR(500),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_agent_applications_class FOREIGN KEY (agent_class_id) REFERENCES agent_classes(id) ON DELETE RESTRICT,
        CONSTRAINT fk_agent_applications_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
        CONSTRAINT chk_agent_applications_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
        CONSTRAINT chk_agent_applications_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_agent_applications_reference ON agent_applications (reference)`);
    await queryRunner.query(`CREATE INDEX idx_agent_applications_class_status ON agent_applications (agent_class_id, status)`);
    await queryRunner.query(`CREATE INDEX idx_agent_applications_agent ON agent_applications (agent_id)`);
    await queryRunner.query(`CREATE INDEX idx_agent_applications_applicant ON agent_applications (applicant_reference)`);

    await queryRunner.query(`ALTER TABLE agents ADD COLUMN agent_class_id UUID`);
    await queryRunner.query(`ALTER TABLE agents ADD COLUMN origin_application_id UUID`);
    await queryRunner.query(`ALTER TABLE agents ADD CONSTRAINT fk_agents_class FOREIGN KEY (agent_class_id) REFERENCES agent_classes(id) ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE agents ADD CONSTRAINT fk_agents_origin_application FOREIGN KEY (origin_application_id) REFERENCES agent_applications(id) ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX idx_agents_class ON agents (agent_class_id)`);
    await queryRunner.query(`CREATE INDEX idx_agents_origin_application ON agents (origin_application_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE agents DROP CONSTRAINT IF EXISTS fk_agents_origin_application`);
    await queryRunner.query(`ALTER TABLE agents DROP CONSTRAINT IF EXISTS fk_agents_class`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_agents_origin_application`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_agents_class`);
    await queryRunner.query(`ALTER TABLE agents DROP COLUMN IF EXISTS origin_application_id`);
    await queryRunner.query(`ALTER TABLE agents DROP COLUMN IF EXISTS agent_class_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_applications`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_classes`);
  }
}
