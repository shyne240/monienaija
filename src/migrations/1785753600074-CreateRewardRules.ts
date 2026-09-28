import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-REWARD-01 — Reward Rule Schema foundation.
 *
 * Additive migration: creates `reward_rules`, the authoritative versioned registry of
 * reward/cashback rule DEFINITIONS for future consumption by the Reward Engine resolver.
 * SCHEMA ONLY:
 *  - ZERO rules are seeded (no reward policy has been approved).
 *  - Nothing here is wired to financial flows; V1 stays reward-free (reward = NONE).
 *  - No reward rate, eligibility policy, precedence hierarchy, campaign identity,
 *    frequency/usage policy, funding source, accounting treatment or enablement timing
 *    is decided by this schema; it only makes the supported MECHANICS recordable.
 *
 * Terminology mirrors the authoritative FeeRule conventions (src/fee/fee.types.ts):
 * flat (*)Minor, bps bounded to [0, 10000] where 10000 = 100% (BASIS_POINTS).
 *
 * Rule MECHANICS supported (all opt-in via calculation_model):
 *  - FIXED                  flat_reward_minor only
 *  - PERCENTAGE             percentage_bps only
 *  - PERCENTAGE_MIN         percentage_bps + minimum_reward_minor
 *  - PERCENTAGE_MAX         percentage_bps + maximum_reward_minor
 *  - PERCENTAGE_MIN_MAX     percentage_bps + minimum + maximum
 *  - FLAT_PLUS_PERCENTAGE   flat_reward_minor + percentage_bps
 *  - TIERED                 tiers JSONB: marginal brackets
 *                           [{"upToMinor":"100000","bps":100},{"upToMinor":null,"flatMinor":"50"}]
 *                           (upToMinor null = open-ended top bracket; flatMinor/bps per bracket,
 *                           at least one of the two required per bracket; brackets ascending,
 *                           first bracket starts at 0 implicitly, marginal application)
 *  - maximum_reward_minor is simultaneously the ONLY per-transaction reward cap mechanism
 *    (PERCENTAGE_MAX / PERCENTAGE_MIN_MAX). Cumulative/frequency caps are NOT modelled
 *    here: they require durable per-beneficiary usage state whose write point is the
 *    future grant-posting decision, not this definition registry (documented).
 *
 * Calculation BASE (calculation_basis): PRINCIPAL | FEE | NET — mechanics only.
 * NET means PRINCIPAL − FEE when fee evidence is available. No production default is
 * selected here; each rule names its basis explicitly. Whether FEE-based rewards are
 * desirable is unresolved policy (fees are NOT_CONFIGURED in V1).
 *
 * Beneficiary (beneficiary_type): CUSTOMER | AGENT — who receives the grant. One rule =
 * one beneficiary type; multiple co-applicable beneficiary groups emerge from
 * per-beneficiary resolution, never from a split column. PLATFORM/AGGREGATOR reward
 * beneficiaries are intentionally not modelled (no policy supports them).
 *
 * Grant classification (reward_type): CASHBACK | BONUS | PROMOTION — the vocabulary the
 * existing Commercial Decision Snapshot's RewardGrantSnapshot.rewardType requires.
 * Purely a classification; no business meaning is decided here.
 *
 * Eligibility targeting (nullable, AT MOST ONE set per rule — kept single-dimensional so
 * overlapping scopes stay legible and precedence remains explainable):
 *  - customer_id         → rule applies to one specific customer (FK → customers)
 *  - customer_kyc_level  → rule applies to customers carrying that EXISTING
 *                          CustomerKycLevel (NONE/LEVEL_1/LEVEL_2/LEVEL_3 — the
 *                          authoritative enum on customers.kyc_level; NOT invented here,
 *                          no FK: it is a classification, not a table)
 *  - agent_class_id      → rule applies in the context of agents of that class (FK)
 *  - agent_id            → rule applies in the context of one specific agent (FK)
 *  - campaign_code       → rule applies when the transaction carries that promotion
 *                          identity; CONFIGURATION SURFACE ONLY — no campaign registry
 *                          exists (B1 campaign tables are decision records, not a
 *                          registry), so this is a format-validated free code, not an FK.
 *  - all NULL            → untargeted (applies to the product+currency as a whole)
 * Targeting (eligibility context) is deliberately independent of beneficiary_type:
 * e.g. a CUSTOMER-beneficiary rule targeted by agent_class_id means "customers whose
 * transaction is serviced by a class-X agent". No combination is pre-judged.
 *
 * Integrity invariants (all at the database layer):
 *  - product_code must reference an existing products.code (RESTRICT) — products.code is
 *    the single canonical product identity (V1-COMMERCIAL-02); no second product system.
 *  - monetary values >= 0; percentage_bps bounded [0, 10000]; minimum <= maximum.
 *  - calculation_model/parameter coherence enforced by CHECK (unused params must be NULL).
 *  - calculation_basis/beneficiary_type/reward_type/customer_kyc_level constrained.
 *  - at most one targeting dimension set (CHECK).
 *  - effective_to > effective_from when present.
 *  - deterministic identity uniqueness: one live rule per
 *    (product_code, currency, beneficiary_type, normalized targets, effective_from);
 *    overlapping windows are resolved later by priority/effective dates — equal highest
 *    priority means explicit ambiguity at resolution time (fail closed), never a
 *    silent choice.
 */
export class CreateRewardRules1785753600074 implements MigrationInterface {
  name = 'CreateRewardRules1785753600074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE reward_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_code VARCHAR(80) NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_reward_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
        beneficiary_type VARCHAR(20) NOT NULL CONSTRAINT chk_reward_rules_beneficiary
          CHECK (beneficiary_type IN ('CUSTOMER','AGENT')),
        reward_type VARCHAR(20) NOT NULL CONSTRAINT chk_reward_rules_reward_type
          CHECK (reward_type IN ('CASHBACK','BONUS','PROMOTION')),
        calculation_model VARCHAR(24) NOT NULL CONSTRAINT chk_reward_rules_model
          CHECK (calculation_model IN ('FIXED','PERCENTAGE','PERCENTAGE_MIN','PERCENTAGE_MAX','PERCENTAGE_MIN_MAX','FLAT_PLUS_PERCENTAGE','TIERED')),
        calculation_basis VARCHAR(20) NOT NULL CONSTRAINT chk_reward_rules_basis
          CHECK (calculation_basis IN ('PRINCIPAL','FEE','NET')),
        flat_reward_minor BIGINT CONSTRAINT chk_reward_rules_flat
          CHECK (flat_reward_minor IS NULL OR flat_reward_minor >= 0),
        percentage_bps INTEGER CONSTRAINT chk_reward_rules_percentage
          CHECK (percentage_bps IS NULL OR (percentage_bps >= 0 AND percentage_bps <= 10000)),
        minimum_reward_minor BIGINT CONSTRAINT chk_reward_rules_minimum
          CHECK (minimum_reward_minor IS NULL OR minimum_reward_minor >= 0),
        maximum_reward_minor BIGINT CONSTRAINT chk_reward_rules_maximum
          CHECK (maximum_reward_minor IS NULL OR maximum_reward_minor >= 0),
        tiers JSONB CONSTRAINT chk_reward_rules_tiers_array
          CHECK (tiers IS NULL OR jsonb_typeof(tiers) = 'array'),
        customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
        customer_kyc_level VARCHAR(20) CONSTRAINT chk_reward_rules_kyc_level
          CHECK (customer_kyc_level IS NULL OR customer_kyc_level IN ('NONE','LEVEL_1','LEVEL_2','LEVEL_3')),
        agent_class_id UUID REFERENCES agent_classes(id) ON DELETE RESTRICT,
        agent_id UUID REFERENCES agents(id) ON DELETE RESTRICT,
        campaign_code VARCHAR(80) CONSTRAINT chk_reward_rules_campaign_code
          CHECK (campaign_code IS NULL OR campaign_code ~ '^[A-Z0-9][A-Z0-9_\\-]{0,79}$'),
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ CONSTRAINT chk_reward_rules_effective
          CHECK (effective_to IS NULL OR effective_to > effective_from),
        priority INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_reward_rules_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_reward_rules_min_max
          CHECK (minimum_reward_minor IS NULL OR maximum_reward_minor IS NULL OR minimum_reward_minor <= maximum_reward_minor),
        CONSTRAINT chk_reward_rules_target_single CHECK (
          ((customer_id IS NOT NULL)::int + (customer_kyc_level IS NOT NULL)::int + (agent_class_id IS NOT NULL)::int
            + (agent_id IS NOT NULL)::int + (campaign_code IS NOT NULL)::int) <= 1
        ),
        CONSTRAINT chk_reward_rules_model_params CHECK (
          (calculation_model = 'FIXED' AND flat_reward_minor IS NOT NULL AND percentage_bps IS NULL
             AND minimum_reward_minor IS NULL AND maximum_reward_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE' AND flat_reward_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_reward_minor IS NULL AND maximum_reward_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE_MIN' AND flat_reward_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_reward_minor IS NOT NULL AND maximum_reward_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE_MAX' AND flat_reward_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_reward_minor IS NULL AND maximum_reward_minor IS NOT NULL AND tiers IS NULL)
          OR (calculation_model = 'PERCENTAGE_MIN_MAX' AND flat_reward_minor IS NULL AND percentage_bps IS NOT NULL
             AND minimum_reward_minor IS NOT NULL AND maximum_reward_minor IS NOT NULL AND tiers IS NULL)
          OR (calculation_model = 'FLAT_PLUS_PERCENTAGE' AND flat_reward_minor IS NOT NULL AND percentage_bps IS NOT NULL
             AND minimum_reward_minor IS NULL AND maximum_reward_minor IS NULL AND tiers IS NULL)
          OR (calculation_model = 'TIERED' AND flat_reward_minor IS NULL AND percentage_bps IS NULL
             AND minimum_reward_minor IS NULL AND maximum_reward_minor IS NULL AND tiers IS NOT NULL
             AND jsonb_array_length(tiers) > 0)
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_reward_rules_identity
      ON reward_rules (
        product_code,
        currency,
        beneficiary_type,
        COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(customer_kyc_level, ''),
        COALESCE(agent_class_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'),
        COALESCE(campaign_code, ''),
        effective_from
      )
      WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_reward_rules_product ON reward_rules (product_code)`);
    await queryRunner.query(`CREATE INDEX idx_reward_rules_active ON reward_rules (is_active)`);
    await queryRunner.query(`CREATE INDEX idx_reward_rules_effective_from ON reward_rules (effective_from)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE reward_rules`);
  }
}
