import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerOnboarding1785753600009 implements MigrationInterface {
  name = 'CreateCustomerOnboarding1785753600009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_onboardings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
        version INTEGER NOT NULL DEFAULT 1,
        started_at TIMESTAMPTZ,
        approved_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_onboardings_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_onboardings_status CHECK (
          status IN ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED')
        ),
        CONSTRAINT chk_customer_onboardings_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_onboardings_active_customer
         ON customer_onboardings (customer_id)
       WHERE deleted_at IS NULL AND status NOT IN ('REJECTED', 'COMPLETED')`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_onboardings_customer_created
         ON customer_onboardings (customer_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_agreements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        onboarding_id UUID NOT NULL,
        agreement_type VARCHAR(40) NOT NULL,
        agreement_version VARCHAR(40) NOT NULL,
        is_required BOOLEAN NOT NULL DEFAULT TRUE,
        accepted BOOLEAN NOT NULL DEFAULT FALSE,
        accepted_at TIMESTAMPTZ,
        accepted_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_agreements_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_agreements_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES customer_onboardings(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_agreements_type CHECK (
          agreement_type IN (
            'TERMS_AND_CONDITIONS', 'PRIVACY_POLICY', 'KYC_CONSENT',
            'DATA_PROCESSING', 'CUSTOMER_DECLARATION'
          )
        ),
        CONSTRAINT chk_customer_agreements_version CHECK (length(agreement_version) > 0),
        CONSTRAINT chk_customer_agreements_entity_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_agreements_onboarding_type_version
         ON customer_agreements (onboarding_id, agreement_type, agreement_version)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_agreements_customer
         ON customer_agreements (customer_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_risk_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        onboarding_id UUID NOT NULL,
        risk_level VARCHAR(20) NOT NULL,
        rationale VARCHAR(500),
        assessed_by VARCHAR(160) NOT NULL,
        is_current BOOLEAN NOT NULL DEFAULT TRUE,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_risk_profiles_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_risk_profiles_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES customer_onboardings(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_risk_profiles_level CHECK (
          risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'PROHIBITED')
        ),
        CONSTRAINT chk_customer_risk_profiles_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_risk_profiles_current_customer
         ON customer_risk_profiles (customer_id)
       WHERE is_current = TRUE AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_risk_profiles_customer_created
         ON customer_risk_profiles (customer_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_onboarding_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        onboarding_id UUID NOT NULL,
        task_type VARCHAR(40) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        is_required BOOLEAN NOT NULL DEFAULT TRUE,
        completed_at TIMESTAMPTZ,
        completed_by VARCHAR(160),
        notes VARCHAR(500),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_onboarding_tasks_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_onboarding_tasks_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES customer_onboardings(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_onboarding_tasks_type CHECK (
          task_type IN (
            'PROFILE_COMPLETION', 'ADDRESS_VERIFICATION', 'IDENTITY_DOCUMENT',
            'KYC_REVIEW', 'AGREEMENT_ACCEPTANCE', 'MANUAL_REVIEW'
          )
        ),
        CONSTRAINT chk_customer_onboarding_tasks_status CHECK (status IN ('PENDING', 'COMPLETED')),
        CONSTRAINT chk_customer_onboarding_tasks_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_onboarding_tasks_customer
         ON customer_onboarding_tasks (customer_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_onboarding_tasks_onboarding_status
         ON customer_onboarding_tasks (onboarding_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_approval_decisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        onboarding_id UUID NOT NULL,
        decision VARCHAR(20) NOT NULL,
        reason VARCHAR(500),
        decided_by VARCHAR(160) NOT NULL,
        is_latest BOOLEAN NOT NULL DEFAULT TRUE,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_approval_decisions_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_approval_decisions_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES customer_onboardings(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_approval_decisions_decision CHECK (
          decision IN ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED')
        ),
        CONSTRAINT chk_customer_approval_decisions_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_approval_decisions_latest_customer
         ON customer_approval_decisions (customer_id)
       WHERE is_latest = TRUE AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_approval_decisions_customer_created
         ON customer_approval_decisions (customer_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS customer_approval_decisions`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_onboarding_tasks`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_risk_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_agreements`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_onboardings`);
  }
}
