import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier-based customer default class mappings.
 *
 * Each verified KYC tier (LEVEL_1/2/3) gets an effective default service class. Mappings are
 * governance-sensitive: migration seeds them from the current global default but marks them as
 * PENDING_APPROVAL so operators must explicitly approve all three before activation can rely on
 * them. This surfaces the legacy global default while preventing silent tier-based behavior.
 */
export class CustomerTierDefaultClassMappings1785753600810 implements MigrationInterface {
  name = 'CustomerTierDefaultClassMappings1785753600810';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_tier_default_classes (
        tier VARCHAR(20) PRIMARY KEY,
        class_id UUID NOT NULL REFERENCES customer_classes(id) ON DELETE RESTRICT,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING_APPROVAL',
        approved_at TIMESTAMPTZ,
        approved_by VARCHAR(160),
        approval_id UUID,
        reason VARCHAR(500),
        global_default_class_code_at_migration VARCHAR(80),
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_customer_tier_default_classes_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_customer_tier_default_classes_tier CHECK (tier IN ('LEVEL_1','LEVEL_2','LEVEL_3')),
        CONSTRAINT chk_customer_tier_default_classes_status CHECK (status IN ('PENDING_APPROVAL','APPROVED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customer_tier_default_classes_class ON customer_tier_default_classes (class_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_customer_tier_default_classes_status ON customer_tier_default_classes (status)`,
    );

    // Surface the current global default during migration and require explicit approval of all
    // three tier mappings. We seed the global default as the proposed class, but leave the
    // mappings PENDING_APPROVAL so no tier-based activation depends on an unreviewed mapping.
    await queryRunner.query(`
      INSERT INTO customer_tier_default_classes (
        tier, class_id, status, reason, global_default_class_code_at_migration, created_by
      )
      SELECT
        tier.value,
        dc.id,
        'PENDING_APPROVAL',
        'Seeded from current global default during tier-default migration; explicit approval required',
        dc.code,
        'MIGRATION_1785753600810'
      FROM (
        SELECT id, code
        FROM customer_classes
        WHERE is_default = TRUE AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      ) dc
      CROSS JOIN (VALUES ('LEVEL_1'), ('LEVEL_2'), ('LEVEL_3')) AS tier(value)
      ON CONFLICT (tier) DO NOTHING
    `);

    // Allow TIER_DEFAULT as an assignment source for tier-driven automatic assignments.
    await queryRunner.query(`
      ALTER TABLE customer_class_assignments
        DROP CONSTRAINT IF EXISTS chk_customer_class_assignments_source
    `);
    await queryRunner.query(`
      ALTER TABLE customer_class_assignments
        ADD CONSTRAINT chk_customer_class_assignments_source
        CHECK (source IN ('REGISTRATION_DEFAULT','MANUAL','BACKFILL','SWITCH','TIER_DEFAULT'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT (EXISTS (SELECT 1 FROM customer_tier_default_classes WHERE status = 'APPROVED')) AS has_approved`,
    )) as Array<{ has_approved: boolean }>;
    if (rows[0]?.has_approved) {
      throw new Error('Refusing to drop approved customer tier default class mappings');
    }
    await queryRunner.query(`DROP TABLE IF EXISTS customer_tier_default_classes`);
    await queryRunner.query(`
      ALTER TABLE customer_class_assignments
        DROP CONSTRAINT IF EXISTS chk_customer_class_assignments_source
    `);
    await queryRunner.query(`
      ALTER TABLE customer_class_assignments
        ADD CONSTRAINT chk_customer_class_assignments_source
        CHECK (source IN ('REGISTRATION_DEFAULT','MANUAL','BACKFILL','SWITCH'))
    `);
  }
}
