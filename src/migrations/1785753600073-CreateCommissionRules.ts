import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-COMMISSION-01 — Commission Rule Schema foundation.
 *
 * Additive migration: creates `commission_rules`, the authoritative versioned registry of
 * commission rule DEFINITIONS for future consumption by the Commission Engine resolver.
 * SCHEMA ONLY:
 *  - ZERO rules are seeded (no commission policy has been approved).
 *  - Nothing here is wired to financial flows; V1 stays commission-free (commission = NONE).
 *  - No allocation split, precedence hierarchy, accounting treatment or enablement timing
 *    is decided by this schema; it only makes the supported MECHANICS recordable.
 *
 * Terminology mirrors the authoritative FeeRule conventions (src/fee/fee.types.ts):
 * flat (*)Minor, bps bounded to [0, 10000] where 10000 = 100% (BASIS_POINTS).
 *
 * Rule MECHANICS supported (all opt-in via calculation_model):
 *  - FIXED                  flat_commission_minor only
 *  - PERCENTAGE             percentage_bps only
 *  - PERCENTAGE_MIN         percentage_bps + minimum_commission_minor
 *  - PERCENTAGE_MAX         percentage_bps + maximum_commission_minor
 *  - PERCENTAGE_MIN_MAX     percentage_bps + minimum + maximum
 *  - FLAT_PLUS_PERCENTAGE   flat_commission_minor + percentage_bps
 *  - TIERED                 tiers JSONB: marginal brackets
 *                           [{"upToMinor":"100000","bps":100},{"upToMinor":null,"flatMinor":"50"}]
 *                           (upToMinor null = open-ended top bracket; flatMinor/bps per bracket,
 *                           at least one of the two required per bracket; brackets ascending,
 *                           first bracket starts at 0 implicitly, marginal application)
 *
 * Calculation BASE (calculation_basis): PRINCIPAL | FEE | NET — mechanics only.
 * NET means PRINCIPAL − FEE when fee evidence is available. No production default is
 * selected here; each rule names its basis explicitly.
 *
 * Recipient (recipient_type): AGENT | AGGREGATOR | PLATFORM. One rule = one recipient;
 * multi-recipient allocation is expressed by multiple co-applicable rules (one per
 * recipient). NO split percentages are hardcoded anywhere.
 *
 * Targeting (nullable FKs, AT MOST ONE set per rule — kept single-dimensional so
 * overlapping scopes stay legible and precedence remains explainable):
 *  - agent_class_id → rule applies to agents of that class
 *  - agent_id       → rule applies to one specific agent
 *  - aggregator_id  → rule applies to one specific aggregator
 *  - all NULL       → untargeted (applies to the product+currency as a whole)
 *
 * Integrity invariants (all at the database layer):
 *  - product_code must reference an existing products.code (RESTRICT) — products.code is
 *    the single canonical product identity (V1-COMMERCIAL-02); no second product system.
 *  - monetary values >= 0; percentage_bps bounded [0, 10000]; minimum <= maximum.
 *  - calculation_model/parameter coherence enforced by CHECK (unused params must be NULL).
 *  - calculation_basis/recipient_type constrained to the modelled vocabularies.
 *  - at most one targeting FK set (CHECK).
 *  - effective_to > effective_from when present.
 *  - deterministic identity uniqueness: one live rule per
 *    (product_code, currency, recipient_type, agent_class, agent, aggregator,
 *     effective_from) with NULL targeting folded to the zero UUID; overlapping windows
 *    are resolved later by priority/effective dates — equal highest priority means
 *    explicit ambiguity at resolution time (fail closed), never a silent choice.
 */
export class CreateCommissionRules1785753600073 implements MigrationInterface {
  name = 'CreateCommissionRules1785753600073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE commission_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_code VARCHAR(80) NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_commission_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
        recipient_type VARCHAR(20) NOT NULL CONSTRAINT chk_commission_rules_recipient
          CHECK (recipient_type IN ('AGENT','AGGREGATOR','PLATFORM')),
        calculation_model VARCHAR(24) NOT NULL CONSTRAINT chk_commission_rules_model
          CHECK (calculation_model IN ('FIXED','PERCENTAGE','PERCENTAGE_MIN','PERCENTAGE_MAX','PERCENTAGE_MIN_MAX','FLAT_PLUS_PERCENTAGE','TIERED')),
        calculation_basis VARCHAR(20) NOT NULL CONSTRAINT chk_commission_rules_basis
          CHECK (calculation_basis IN ('PRINCIPAL','FEE','NET')),
        flat_commission_minor BIGINT CONSTRAINT chk_commission_rules_flat
          CHECK (flat_commission_minor IS NULL OR flat_commission_minor >= 0),
        percentage_bps INTEGER CONSTRAINT chk_commission_rules_percentage
          CHECK (percentage_bps IS NULL OR (percentage_bps >= 0 AND percentage_bps <= 10000)),
        minimum_commission_minor BIGINT CONSTRAINT chk_commission_rules_minimum
          CHECK (minimum_commission_minor IS NULL OR minimum_commission_minor >= 0),
        maximum_commission_minor BIGINT CONSTRAINT chk_commission_rules_maximum
          CHECK (maximum_commission_minor IS NULL OR maximum_commission_minor >= 0),
        tiers JSONB CONSTRAINT chk_commission_rules_tiers_array
          CHECK (tiers IS NULL OR jsonb_typeof(tiers) = 'array'),
        agent_class_id UUID REFERENCES agent_classes(id) ON DELETE RESTRICT,
        agent_id UUID REFERENCES agents(id) ON DELETE RESTRICT,
        aggregator_id UUID REFERENCES aggregators(id) ON DELETE RESTRICT,
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ CONSTRAINT chk_commission_rules_effective
          CHECK (effective_to IS NULL OR effective_to > effective_from),
        priority INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_commission_rules_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_commission_rules_min_max
          CHECK (minimum_commission_minor IS NULL OR maximum_commission_minor IS NULL OR minimum_commission_minor <= maximum_commission_minor),
        CONSTRAINT chk_commission_rules_target_single CHECK (
          ((agent_class_id IS NOT NULL)::int + (agent_id IS NOT NULL)::int + (aggregator_id IS NOT NULL)::int) <= 1
        ),
        CONSTRAINT chk_commission_rules_model_params CHECK (
          (calculation_model = 'FIXED' AND flat_commission_minor IS NOT NULL AND percentage_bps IS NULL
             AND minimum_commission_minor IS NULL AND maximum_commission_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE' AND flat_commission_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_commission_minor IS NULL AND maximum_commission_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE_MIN' AND flat_commission_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_commission_minor IS NOT NULL AND maximum_commission_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE_MAX' AND flat_commission_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_commission_minor IS NULL AND maximum_commission_minor IS NOT NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE_MIN_MAX' AND flat_commission_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_commission_minor IS NOT NULL AND maximum_commission_minor IS NOT NULL AND tiers IS NULL)
          OR (calculation_model = 'FLAT_PLUS_PERCENTAGE' AND flat_commission_minor IS NOT NULL AND percentage_bps IS NOT NULL
             AND minimum_commission_minor IS NULL AND maximum_commission_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'TIERED' AND flat_commission_minor IS NULL AND percentage_bps IS NULL
             AND minimum_commission_minor IS NULL AND maximum_commission_minor IS NULL AND tiers IS NOT NULL
             AND jsonb_array_length(tiers) > 0)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_commission_rules_identity
      ON commission_rules (
        product_code,
        currency,
        recipient_type,
        COALESCE(agent_class_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(aggregator_id, '00000000-0000-0000-0000-000000000000'),
        effective_from
      )
      WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_commission_rules_product ON commission_rules (product_code)`);
    await queryRunner.query(`CREATE INDEX idx_commission_rules_active ON commission_rules (is_active)`);
    await queryRunner.query(`CREATE INDEX idx_commission_rules_effective_from ON commission_rules (effective_from)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE commission_rules`);
  }
}
