import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-COMMERCIAL-03 — Fee Rule Schema foundation.
 *
 * Additive migration: creates `fee_rules`, the authoritative versioned registry of fee rule
 * DEFINITIONS for future consumption by the Commercial Resolver. SCHEMA ONLY:
 *  - ZERO rules are seeded (no pricing policy has been approved).
 *  - Nothing here is wired to financial flows; V1 stays fee-free.
 *  - No VAT/tax policy is decided: vat_bps is a column (existing FeeRule terminology) with no value.
 *
 * Terminology preserved from the authoritative FeeRule/FeeEngine contracts:
 * flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps
 * (src/fee/fee.types.ts, src/fee/fee.engine.ts).
 *
 * Integrity invariants (all at the database layer):
 *  - product_code must reference an existing products.code (RESTRICT) — products.code is the
 *    single canonical product identity (V1-COMMERCIAL-02); no second product-code system.
 *  - monetary values >= 0; bps values bounded to [0, 10000] where 10000 = 100% — this is the
 *    BASIS_POINTS convention already established by FeeEngine, not an invented business limit.
 *  - minimum <= maximum when both present (same invariant FeeEngine enforces at calculation time).
 *  - effective_to > effective_from when present.
 *  - at least one pricing parameter required (a rule with neither flat nor percentage is meaningless;
 *    ZERO/FREE pricing is expressed explicitly with flat_fee_minor = 0).
 *  - deterministic identity uniqueness: one rule per (product_code, currency, effective_from)
 *    among live rows. Overlapping windows are resolved later by priority/effective dates.
 *
 * Pricing models expressible today: ZERO/FREE (flat 0), FLAT, PERCENTAGE, PCT+MIN, PCT+MAX,
 * PCT+MIN+MAX, FLAT+PERCENTAGE (FeeEngine sums both). TIERED/BRACKETED pricing is NOT a row
 * shape here: it will be a later additive child table (fee_rule_tiers referencing fee_rules.id),
 * which the identity index does not obstruct.
 */
export class CreateFeeRules1785753600072 implements MigrationInterface {
  name = 'CreateFeeRules1785753600072';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE fee_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_code VARCHAR(80) NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_fee_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
        flat_fee_minor BIGINT CONSTRAINT chk_fee_rules_flat CHECK (flat_fee_minor IS NULL OR flat_fee_minor >= 0),
        percentage_bps INTEGER CONSTRAINT chk_fee_rules_percentage CHECK (percentage_bps IS NULL OR (percentage_bps >= 0 AND percentage_bps <= 10000)),
        minimum_fee_minor BIGINT CONSTRAINT chk_fee_rules_minimum CHECK (minimum_fee_minor IS NULL OR minimum_fee_minor >= 0),
        maximum_fee_minor BIGINT CONSTRAINT chk_fee_rules_maximum CHECK (maximum_fee_minor IS NULL OR maximum_fee_minor >= 0),
        vat_bps INTEGER CONSTRAINT chk_fee_rules_vat CHECK (vat_bps IS NULL OR (vat_bps >= 0 AND vat_bps <= 10000)),
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ CONSTRAINT chk_fee_rules_effective CHECK (effective_to IS NULL OR effective_to > effective_from),
        priority INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_fee_rules_version CHECK (version > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_fee_rules_params CHECK (flat_fee_minor IS NOT NULL OR percentage_bps IS NOT NULL),
        CONSTRAINT chk_fee_rules_min_max CHECK (minimum_fee_minor IS NULL OR maximum_fee_minor IS NULL OR minimum_fee_minor <= maximum_fee_minor)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_fee_rules_identity
      ON fee_rules (product_code, currency, effective_from)
      WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_fee_rules_product ON fee_rules (product_code)`);
    await queryRunner.query(`CREATE INDEX idx_fee_rules_currency ON fee_rules (currency)`);
    await queryRunner.query(`CREATE INDEX idx_fee_rules_active ON fee_rules (is_active)`);
    await queryRunner.query(`CREATE INDEX idx_fee_rules_effective_from ON fee_rules (effective_from)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE fee_rules`);
  }
}
