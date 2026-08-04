import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerRiskAssessments1785753600017 implements MigrationInterface {
  name = 'CreateCustomerRiskAssessments1785753600017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_risk_assessments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        assessment_date TIMESTAMPTZ NOT NULL,
        assessed_by VARCHAR(160) NOT NULL,
        assessment_method VARCHAR(120) NOT NULL,
        overall_risk_level VARCHAR(20) NOT NULL,
        review_due_date TIMESTAMPTZ NOT NULL,
        notes VARCHAR(2000),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_risk_assessments_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_risk_assessments_status CHECK (status IN ('ACTIVE', 'CLOSED')),
        CONSTRAINT chk_customer_risk_assessments_risk_level CHECK (
          overall_risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
        ),
        CONSTRAINT chk_customer_risk_assessments_review_due CHECK (review_due_date >= assessment_date),
        CONSTRAINT chk_customer_risk_assessments_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_risk_assessments_active_customer
         ON customer_risk_assessments (customer_id)
       WHERE deleted_at IS NULL AND status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_risk_assessments_customer_updated
         ON customer_risk_assessments (customer_id, updated_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_risk_assessment_factors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        category VARCHAR(80) NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        weight DOUBLE PRECISION NOT NULL,
        remarks VARCHAR(1000),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_risk_assessment_factors_profile
          FOREIGN KEY (profile_id) REFERENCES customer_risk_assessments(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_risk_assessment_factors_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_risk_assessment_factors_score CHECK (score >= 0),
        CONSTRAINT chk_customer_risk_assessment_factors_weight CHECK (weight > 0),
        CONSTRAINT chk_customer_risk_assessment_factors_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_risk_assessment_factors_profile_created
         ON customer_risk_assessment_factors (profile_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE risk_assessment_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        action VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        version INTEGER NOT NULL,
        assessment_date TIMESTAMPTZ NOT NULL,
        assessed_by VARCHAR(160) NOT NULL,
        assessment_method VARCHAR(120) NOT NULL,
        overall_risk_level VARCHAR(20) NOT NULL,
        review_due_date TIMESTAMPTZ NOT NULL,
        notes VARCHAR(2000),
        actor VARCHAR(160) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_risk_assessment_histories_profile
          FOREIGN KEY (profile_id) REFERENCES customer_risk_assessments(id) ON DELETE RESTRICT,
        CONSTRAINT fk_risk_assessment_histories_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_risk_assessment_histories_action CHECK (action IN ('CREATED', 'REASSESSED', 'CLOSED')),
        CONSTRAINT chk_risk_assessment_histories_status CHECK (status IN ('ACTIVE', 'CLOSED')),
        CONSTRAINT chk_risk_assessment_histories_risk_level CHECK (
          overall_risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
        ),
        CONSTRAINT chk_risk_assessment_histories_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_risk_assessment_histories_profile_created
         ON risk_assessment_histories (profile_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE risk_assessment_factor_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        profile_version INTEGER NOT NULL,
        action VARCHAR(30) NOT NULL,
        category VARCHAR(80) NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        weight DOUBLE PRECISION NOT NULL,
        remarks VARCHAR(1000),
        actor VARCHAR(160) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_risk_assessment_factor_histories_profile
          FOREIGN KEY (profile_id) REFERENCES customer_risk_assessments(id) ON DELETE RESTRICT,
        CONSTRAINT fk_risk_assessment_factor_histories_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_risk_assessment_factor_histories_action CHECK (action = 'ASSESSMENT_RECORDED'),
        CONSTRAINT chk_risk_assessment_factor_histories_score CHECK (score >= 0),
        CONSTRAINT chk_risk_assessment_factor_histories_weight CHECK (weight > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_risk_assessment_factor_histories_profile_created
         ON risk_assessment_factor_histories (profile_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS risk_assessment_factor_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS risk_assessment_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_risk_assessment_factors`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_risk_assessments`);
  }
}
