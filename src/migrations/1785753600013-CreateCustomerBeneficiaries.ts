import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerBeneficiaries1785753600013 implements MigrationInterface {
  name = 'CreateCustomerBeneficiaries1785753600013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_beneficiaries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        beneficiary_type VARCHAR(30) NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        reference VARCHAR(160) NOT NULL,
        destination_identifier VARCHAR(160) NOT NULL,
        normalized_destination_identifier VARCHAR(160) NOT NULL,
        destination_name VARCHAR(200),
        destination_institution VARCHAR(200),
        nickname VARCHAR(120),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_beneficiaries_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT uq_customer_beneficiaries_reference UNIQUE (reference),
        CONSTRAINT chk_customer_beneficiaries_type CHECK (
          beneficiary_type IN ('INTERNAL_CUSTOMER', 'BANK_ACCOUNT', 'MOBILE_MONEY', 'CASH_AGENT')
        ),
        CONSTRAINT chk_customer_beneficiaries_status CHECK (
          status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')
        ),
        CONSTRAINT chk_customer_beneficiaries_reference CHECK (
          reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'
        ),
        CONSTRAINT chk_customer_beneficiaries_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_beneficiaries_customer_destination
         ON customer_beneficiaries (customer_id, normalized_destination_identifier)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_beneficiaries_customer_status
         ON customer_beneficiaries (customer_id, status)`,
    );

    await queryRunner.query(`
      CREATE TABLE beneficiary_ownerships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        beneficiary_id UUID NOT NULL,
        customer_id UUID NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_beneficiary_ownerships_beneficiary
          FOREIGN KEY (beneficiary_id) REFERENCES customer_beneficiaries(id) ON DELETE RESTRICT,
        CONSTRAINT fk_beneficiary_ownerships_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT chk_beneficiary_ownerships_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_beneficiary_ownerships_beneficiary
         ON beneficiary_ownerships (beneficiary_id)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_beneficiary_ownerships_customer
         ON beneficiary_ownerships (customer_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE beneficiary_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        beneficiary_id UUID NOT NULL,
        verified_by VARCHAR(160) NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL,
        verification_method VARCHAR(80) NOT NULL,
        remarks VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_beneficiary_verifications_beneficiary
          FOREIGN KEY (beneficiary_id) REFERENCES customer_beneficiaries(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_beneficiary_verifications_beneficiary_created
         ON beneficiary_verifications (beneficiary_id, created_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE beneficiary_histories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        beneficiary_id UUID NOT NULL,
        action VARCHAR(30) NOT NULL,
        previous_status VARCHAR(20),
        new_status VARCHAR(20),
        previous_verified BOOLEAN,
        new_verified BOOLEAN,
        actor VARCHAR(160) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_beneficiary_histories_beneficiary
          FOREIGN KEY (beneficiary_id) REFERENCES customer_beneficiaries(id) ON DELETE RESTRICT,
        CONSTRAINT chk_beneficiary_histories_action CHECK (
          action IN ('CREATED', 'OWNERSHIP_CREATED', 'STATUS_CHANGED', 'VERIFIED')
        ),
        CONSTRAINT chk_beneficiary_histories_previous_status CHECK (
          previous_status IS NULL OR previous_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')
        ),
        CONSTRAINT chk_beneficiary_histories_new_status CHECK (
          new_status IS NULL OR new_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_beneficiary_histories_beneficiary_created
         ON beneficiary_histories (beneficiary_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS beneficiary_histories`);
    await queryRunner.query(`DROP TABLE IF EXISTS beneficiary_verifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS beneficiary_ownerships`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_beneficiaries`);
  }
}
