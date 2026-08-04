import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerComplianceCases1785753600016 implements MigrationInterface {
  name = 'CreateCustomerComplianceCases1785753600016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_compliance_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        case_number VARCHAR(100) NOT NULL,
        category VARCHAR(30) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
        opened_by VARCHAR(160) NOT NULL,
        assigned_to VARCHAR(160),
        resolution VARCHAR(1000),
        opened_at TIMESTAMPTZ NOT NULL,
        closed_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_compliance_cases_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT uq_customer_compliance_cases_case_number UNIQUE (case_number),
        CONSTRAINT chk_customer_compliance_cases_case_number CHECK (
          case_number ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
        ),
        CONSTRAINT chk_customer_compliance_cases_category CHECK (
          category IN ('KYC', 'AML', 'SANCTIONS', 'FRAUD', 'PEP', 'DOCUMENT', 'ACCOUNT_REVIEW', 'MANUAL_REVIEW', 'OTHER')
        ),
        CONSTRAINT chk_customer_compliance_cases_severity CHECK (
          severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
        ),
        CONSTRAINT chk_customer_compliance_cases_status CHECK (
          status IN ('OPEN', 'UNDER_REVIEW', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')
        ),
        CONSTRAINT chk_customer_compliance_cases_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_compliance_cases_customer_status
         ON customer_compliance_cases (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE compliance_case_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL,
        action VARCHAR(40) NOT NULL,
        previous_status VARCHAR(24),
        new_status VARCHAR(24),
        previous_assignee VARCHAR(160),
        new_assignee VARCHAR(160),
        previous_resolution VARCHAR(1000),
        new_resolution VARCHAR(1000),
        actor VARCHAR(160) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_compliance_case_histories_case
          FOREIGN KEY (case_id) REFERENCES customer_compliance_cases(id) ON DELETE RESTRICT,
        CONSTRAINT chk_compliance_case_histories_action CHECK (
          action IN ('CASE_CREATED', 'STATUS_CHANGED', 'ASSIGNMENT_CHANGED', 'CASE_CLOSED', 'RESOLUTION_UPDATED', 'COMMENT_ADDED', 'EVIDENCE_ADDED')
        ),
        CONSTRAINT chk_compliance_case_histories_previous_status CHECK (
          previous_status IS NULL OR previous_status IN ('OPEN', 'UNDER_REVIEW', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')
        ),
        CONSTRAINT chk_compliance_case_histories_new_status CHECK (
          new_status IS NULL OR new_status IN ('OPEN', 'UNDER_REVIEW', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_compliance_case_histories_case_created
         ON compliance_case_histories (case_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE compliance_case_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        assigned_to VARCHAR(160) NOT NULL,
        assigned_by VARCHAR(160) NOT NULL,
        assigned_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_compliance_case_assignments_case
          FOREIGN KEY (case_id) REFERENCES customer_compliance_cases(id) ON DELETE RESTRICT,
        CONSTRAINT fk_compliance_case_assignments_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_compliance_case_assignments_case_created
         ON compliance_case_assignments (case_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE compliance_case_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        comment VARCHAR(4000) NOT NULL,
        actor VARCHAR(160) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_compliance_case_comments_case
          FOREIGN KEY (case_id) REFERENCES customer_compliance_cases(id) ON DELETE RESTRICT,
        CONSTRAINT fk_compliance_case_comments_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_compliance_case_comments_case_created
         ON compliance_case_comments (case_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE compliance_case_evidence (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        document_name VARCHAR(200) NOT NULL,
        document_type VARCHAR(80) NOT NULL,
        reference VARCHAR(160) NOT NULL,
        uploaded_by VARCHAR(160) NOT NULL,
        uploaded_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_compliance_case_evidence_case
          FOREIGN KEY (case_id) REFERENCES customer_compliance_cases(id) ON DELETE RESTRICT,
        CONSTRAINT fk_compliance_case_evidence_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_compliance_case_evidence_case_created
         ON compliance_case_evidence (case_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS compliance_case_evidence`);
    await queryRunner.query(`DROP TABLE IF EXISTS compliance_case_comments`);
    await queryRunner.query(`DROP TABLE IF EXISTS compliance_case_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS compliance_case_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_compliance_cases`);
  }
}
