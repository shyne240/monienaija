import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive commercial fee targeting. No rules are seeded and collection remains disabled. */
export class FeeRuleTargeting1785753600506 implements MigrationInterface {
  name = 'FeeRuleTargeting1785753600506';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE fee_rules
        ADD COLUMN customer_class_code VARCHAR(80),
        ADD COLUMN agent_class_id UUID,
        ADD COLUMN institution_id UUID,
        ADD CONSTRAINT fk_fee_rules_agent_class FOREIGN KEY (agent_class_id)
          REFERENCES agent_classes(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_fee_rules_institution FOREIGN KEY (institution_id)
          REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        ADD CONSTRAINT chk_fee_rules_customer_class
          CHECK (customer_class_code IS NULL OR customer_class_code ~ '^[A-Z0-9_]{1,80}$')
    `);
    await queryRunner.query(`DROP INDEX uq_fee_rules_identity`);
    // NULL targets represent wildcard dimensions. Coalescing gives each scope a stable unique key.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_fee_rules_identity
      ON fee_rules (
        product_code, currency,
        COALESCE(customer_class_code, ''),
        COALESCE(agent_class_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
        effective_from
      ) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_fee_rules_target_lookup
      ON fee_rules (product_code, currency, institution_id, customer_class_code, agent_class_id, priority)
      WHERE is_active = true AND deleted_at IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_fee_rules_target_lookup`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_fee_rules_identity`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_fee_rules_identity
      ON fee_rules (product_code, currency, effective_from) WHERE deleted_at IS NULL`);
    await queryRunner.query(`ALTER TABLE fee_rules
      DROP CONSTRAINT IF EXISTS chk_fee_rules_customer_class,
      DROP CONSTRAINT IF EXISTS fk_fee_rules_agent_class,
      DROP CONSTRAINT IF EXISTS fk_fee_rules_institution,
      DROP COLUMN IF EXISTS customer_class_code,
      DROP COLUMN IF EXISTS agent_class_id,
      DROP COLUMN IF EXISTS institution_id`);
  }
}
