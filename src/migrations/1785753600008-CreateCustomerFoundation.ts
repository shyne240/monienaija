import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerFoundation1785753600008 implements MigrationInterface {
  name = 'CreateCustomerFoundation1785753600008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(160) NOT NULL,
        customer_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        kyc_level VARCHAR(20) NOT NULL,
        kyc_status VARCHAR(20) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT uq_customers_reference UNIQUE (reference),
        CONSTRAINT chk_customers_reference CHECK (reference ~ '^[a-z0-9][a-z0-9_.:-]{0,159}$'),
        CONSTRAINT chk_customers_type CHECK (customer_type IN ('INDIVIDUAL', 'BUSINESS')),
        CONSTRAINT chk_customers_status CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
        CONSTRAINT chk_customers_kyc_level CHECK (kyc_level IN ('NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3')),
        CONSTRAINT chk_customers_kyc_status CHECK (
          kyc_status IN ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED')
        ),
        CONSTRAINT chk_customers_version CHECK (version > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE customer_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        display_name VARCHAR(200) NOT NULL,
        legal_name VARCHAR(200),
        date_of_birth DATE,
        nationality VARCHAR(3),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_profiles_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_profiles_active_customer
         ON customer_profiles (customer_id)
       WHERE is_active = TRUE AND deleted_at IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_addresses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        type VARCHAR(20) NOT NULL,
        line_one VARCHAR(200) NOT NULL,
        line_two VARCHAR(200),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        country VARCHAR(3) NOT NULL,
        postal_code VARCHAR(20),
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_customer_addresses_type CHECK (type IN ('RESIDENTIAL', 'BUSINESS', 'MAILING')),
        CONSTRAINT chk_customer_addresses_country CHECK (country ~ '^[A-Z]{2,3}$'),
        CONSTRAINT fk_customer_addresses_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_addresses_customer
         ON customer_addresses (customer_id, deleted_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_contact_methods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        type VARCHAR(20) NOT NULL,
        value VARCHAR(255) NOT NULL,
        normalized_value VARCHAR(255) NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_customer_contacts_type CHECK (type IN ('EMAIL', 'PHONE')),
        CONSTRAINT fk_customer_contacts_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_contacts_type_value
         ON customer_contact_methods (type, normalized_value)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_contacts_customer
         ON customer_contact_methods (customer_id, deleted_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_identity_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        type VARCHAR(30) NOT NULL,
        document_number VARCHAR(160) NOT NULL,
        issuing_country VARCHAR(3) NOT NULL,
        issued_at DATE,
        expires_at DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_customer_documents_type CHECK (
          type IN ('BVN', 'NIN', 'INTERNATIONAL_PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD', 'BUSINESS_REGISTRATION')
        ),
        CONSTRAINT chk_customer_documents_country CHECK (issuing_country ~ '^[A-Z]{2,3}$'),
        CONSTRAINT fk_customer_documents_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_identity_document_type
         ON customer_identity_documents (customer_id, type)
       WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_identity_documents_customer
         ON customer_identity_documents (customer_id, deleted_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_kyc_assessments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        kyc_level VARCHAR(20) NOT NULL,
        kyc_status VARCHAR(20) NOT NULL,
        reason VARCHAR(500),
        assessed_by VARCHAR(160) NOT NULL,
        is_current BOOLEAN NOT NULL DEFAULT TRUE,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_customer_kyc_assessment_level CHECK (
          kyc_level IN ('NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3')
        ),
        CONSTRAINT chk_customer_kyc_assessment_status CHECK (
          kyc_status IN ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED')
        ),
        CONSTRAINT fk_customer_kyc_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_kyc_current
         ON customer_kyc_assessments (customer_id)
       WHERE is_current = TRUE`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_kyc_customer_created
         ON customer_kyc_assessments (customer_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS customer_kyc_assessments`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_identity_documents`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_contact_methods`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_addresses`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS customers`);
  }
}
