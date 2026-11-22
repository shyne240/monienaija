import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 1 / COMMERCIAL-IMPLEMENTATION-COORDINATION §3.1 — customer classes of service.
 *
 * Creates `customer_classes` and `customer_class_assignments`, seeded with the three approved
 * first-class classes (STANDARD / PREMIUM / BUSINESS — Standard is the seeded default) plus
 * administrator-defined classes through the governed CRUD. Customer classes are deliberately
 * independent from KYC tiers: no column is added to `customers`, class is assigned, never derived
 * from `customers.kyc_level`.
 *
 * Backfill: every pre-existing customer that is not synthetic and not CLOSED receives exactly one
 * deterministic STANDARD assignment (`source='BACKFILL'`). This is a safe backfill — it never
 * overwrites an assignment (there were none), never touches synthetic accounts, and never activates
 * anyone. Remaining customers (synthetic, CLOSED) have no assignment and therefore resolve to an
 * explicit unresolved-class state at runtime (`resolveClassCode` returns null), never an invented one.
 *
 * The class `code` alphabet is a strict subset of the limit-catalogue `SEGMENT` alphabet
 * (`^[A-Z0-9_]{3,80}$`) so a class code is directly consumable as `segmentCodes=[class.code]`
 * for limit SEGMENT targeting without a second catalogue (coordination §3.2). No limit logic is
 * changed here.
 */
export class CreateCustomerClasses1785753600805 implements MigrationInterface {
  name = 'CreateCustomerClasses1785753600805';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(80) NOT NULL,
        code VARCHAR(80) NOT NULL CONSTRAINT chk_customer_classes_code CHECK (code ~ '^[A-Z0-9_]{3,80}$'),
        name VARCHAR(160) NOT NULL,
        description VARCHAR(500),
        kind VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER' CONSTRAINT chk_customer_classes_kind CHECK (kind IN ('CUSTOMER')),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CONSTRAINT chk_customer_classes_status CHECK (status IN ('ACTIVE','DISABLED','DEPRECATED')),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        configuration_status VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIGURED' CONSTRAINT chk_customer_classes_configuration CHECK (configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')),
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_customer_classes_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_classes_reference ON customer_classes (reference) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_classes_code ON customer_classes (code) WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_classes_default ON customer_classes (is_default) WHERE is_default AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_classes_status ON customer_classes (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_classes_enabled ON customer_classes (enabled)`,
    );

    await queryRunner.query(`
      CREATE TABLE customer_class_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        class_id UUID NOT NULL,
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        precedence INTEGER NOT NULL DEFAULT 0,
        source VARCHAR(40) NOT NULL DEFAULT 'MANUAL' CONSTRAINT chk_customer_class_assignments_source CHECK (source IN ('REGISTRATION_DEFAULT','MANUAL','BACKFILL','SWITCH')),
        reason VARCHAR(500),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_customer_class_assignments_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_customer_class_assignments_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer_class_assignments_class FOREIGN KEY (class_id) REFERENCES customer_classes(id) ON DELETE RESTRICT,
        CONSTRAINT chk_customer_class_assignments_effective CHECK (effective_to IS NULL OR effective_to > effective_from)
      )
    `);
    // At most one live assignment per customer; switching closes the old row and inserts a new one.
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_customer_class_assignments_active ON customer_class_assignments (customer_id) WHERE is_active AND deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_class_assignments_class ON customer_class_assignments (class_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_class_assignments_customer_effective ON customer_class_assignments (customer_id, effective_from DESC)`,
    );

    // Approved seed classes. Deterministic codes; Standard is the seeded default and the only
    // is_default allowed at a time (partial unique index enforces). Administrator-defined classes
    // go through the governed CRUD afterwards and never need a migration.
    await queryRunner.query(`
      INSERT INTO customer_classes (id, reference, code, name, description, kind, status, enabled, configuration_status, is_default, created_by)
      VALUES
        (gen_random_uuid(), 'CUSTOMER-CLASS-STANDARD', 'STANDARD', 'Standard', 'Default class of service for every eligible customer. Independent from KYC tier.', 'CUSTOMER', 'ACTIVE', TRUE, 'CONFIGURED', TRUE, 'MIGRATION_SEED'),
        (gen_random_uuid(), 'CUSTOMER-CLASS-PREMIUM', 'PREMIUM', 'Premium', 'Premium class of service. Independent from KYC tier.', 'CUSTOMER', 'ACTIVE', TRUE, 'CONFIGURED', FALSE, 'MIGRATION_SEED'),
        (gen_random_uuid(), 'CUSTOMER-CLASS-BUSINESS', 'BUSINESS', 'Business', 'Business class of service. Independent from KYC tier.', 'CUSTOMER', 'ACTIVE', TRUE, 'CONFIGURED', FALSE, 'MIGRATION_SEED')
      ON CONFLICT DO NOTHING
    `);

    // Safe backfill: one STANDARD assignment per pre-existing, non-synthetic, non-CLOSED customer.
    // Historical rows are created with created_by='MIGRATION_BACKFILL' and source='BACKFILL' so the
    // provenance is auditable; no customer is activated and no eligibility is asserted.
    await queryRunner.query(`
      INSERT INTO customer_class_assignments (id, customer_id, class_id, effective_from, is_active, precedence, source, reason, created_by)
      SELECT gen_random_uuid(), c.id, (SELECT id FROM customer_classes WHERE code = 'STANDARD' AND deleted_at IS NULL), NOW(), TRUE, 0, 'BACKFILL', 'Backfill: default Standard class for pre-existing customer at customer-class launch', 'MIGRATION_BACKFILL'
      FROM customers c
      WHERE c.deleted_at IS NULL
        AND c.is_synthetic = FALSE
        AND c.status IN ('DRAFT', 'ACTIVE', 'SUSPENDED')
      ON CONFLICT (customer_id) WHERE is_active AND deleted_at IS NULL DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Assignments carry provenance; refusing to drop when data exists is intentional.
    const rows = (await queryRunner.query(
      `SELECT (EXISTS (SELECT 1 FROM customer_class_assignments)) AS has_data`,
    )) as Array<{ has_data: boolean }>;
    if (rows[0]?.has_data) {
      throw new Error('Refusing to drop customer classes with assignment history');
    }
    await queryRunner.query(`DROP TABLE IF EXISTS customer_class_assignments`);
    await queryRunner.query(`DROP TABLE IF EXISTS customer_classes`);
  }
}
