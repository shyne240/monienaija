import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1-COMMERCIAL-DECISION-01 — Commercial Decision Snapshot foundation.
 *
 * Additive migration: creates `commercial_decision_snapshots`, the immutable durable record of
 * "what commercial configuration and decisions were applied to this transaction?" for fee,
 * commission, reward/cashback and limit decisions. Foundation only — V1 flows stay fee-free and
 * are NOT wired here; no commercial policy values are invented.
 *
 * Design constraints honored:
 *  - FEE / COMMISSION / REWARD / REVENUE / LIMIT remain distinct decision sections (never collapsed).
 *  - Not a ledger: no balances, no journal lines, no wallet state.
 *  - No secrets/PINs/OTPs/credentials — schema carries only operational decision evidence.
 *  - JSONB decision sections are validated by CHECK constraints on their status + shape
 *    (not an opaque blob); allocation/rule-reference arrays are the documented flexible part.
 *  - Immutability enforced at the database layer: UPDATE/DELETE trigger raises; corrections are
 *    expressed only as NEW compensating rows via supersedes_snapshot_id.
 */
export class CreateCommercialDecisionSnapshots1785753600070 implements MigrationInterface {
  name = 'CreateCommercialDecisionSnapshots1785753600070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE commercial_decision_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key VARCHAR(255) NOT NULL CONSTRAINT chk_commercial_decision_idempotency CHECK (length(idempotency_key) > 0),
        request_hash CHAR(64) NOT NULL,
        product VARCHAR(80) NOT NULL CONSTRAINT chk_commercial_decision_product CHECK (length(product) > 0),
        direction VARCHAR(20) CONSTRAINT chk_commercial_decision_direction CHECK (direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')),
        channel VARCHAR(30),
        principal_type VARCHAR(20) NOT NULL CONSTRAINT chk_commercial_decision_principal_type CHECK (principal_type IN ('CUSTOMER','AGENT')),
        principal_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL CONSTRAINT chk_commercial_decision_currency CHECK (currency ~ '^[A-Z]{3}$'),
        principal_amount_minor BIGINT NOT NULL CONSTRAINT chk_commercial_decision_amount CHECK (principal_amount_minor >= 0),
        transaction_reference VARCHAR(255) NOT NULL CONSTRAINT chk_commercial_decision_reference CHECK (length(transaction_reference) > 0),
        correlation_id VARCHAR(160),
        journal_id UUID,
        decision_status VARCHAR(20) NOT NULL DEFAULT 'FINAL' CONSTRAINT chk_commercial_decision_status CHECK (decision_status IN ('PENDING','FINAL')),
        finalized_at TIMESTAMPTZ,
        decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fee_decision JSONB NOT NULL
          CONSTRAINT chk_commercial_decision_fee_object CHECK (jsonb_typeof(fee_decision) = 'object')
          CONSTRAINT chk_commercial_decision_fee_status CHECK (fee_decision->>'status' IN ('NOT_CONFIGURED','ZERO','APPLIED','WAIVED')),
        commission_decision JSONB NOT NULL
          CONSTRAINT chk_commercial_decision_commission_object CHECK (jsonb_typeof(commission_decision) = 'object')
          CONSTRAINT chk_commercial_decision_commission_status CHECK (commission_decision->>'status' IN ('NONE','ALLOCATED')),
        reward_decision JSONB NOT NULL
          CONSTRAINT chk_commercial_decision_reward_object CHECK (jsonb_typeof(reward_decision) = 'object')
          CONSTRAINT chk_commercial_decision_reward_status CHECK (reward_decision->>'status' IN ('NONE','GRANTED')),
        limit_decision JSONB NOT NULL
          CONSTRAINT chk_commercial_decision_limit_object CHECK (jsonb_typeof(limit_decision) = 'object')
          CONSTRAINT chk_commercial_decision_limit_status CHECK (limit_decision->>'status' IN ('NOT_EVALUATED','APPROVED','REJECTED')),
        revenue_decision JSONB
          CONSTRAINT chk_commercial_decision_revenue_object CHECK (revenue_decision IS NULL OR jsonb_typeof(revenue_decision) = 'object')
          CONSTRAINT chk_commercial_decision_revenue_status CHECK (revenue_decision IS NULL OR revenue_decision->>'status' IN ('NONE','RETAINED')),
        configuration_version VARCHAR(80),
        snapshot_schema_version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_commercial_decision_schema_version CHECK (snapshot_schema_version > 0),
        supersedes_snapshot_id UUID REFERENCES commercial_decision_snapshots(id) ON DELETE RESTRICT,
        superseded_reason VARCHAR(255),
        created_by VARCHAR(80) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_commercial_decision_version CHECK (version > 0),
        CONSTRAINT chk_commercial_decision_supersede_reason CHECK (supersedes_snapshot_id IS NULL OR superseded_reason IS NOT NULL),
        CONSTRAINT chk_commercial_decision_finalized CHECK (decision_status <> 'FINAL' OR finalized_at IS NOT NULL)
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX uq_commercial_decision_idempotency ON commercial_decision_snapshots (idempotency_key)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_commercial_decision_reference
      ON commercial_decision_snapshots (product, transaction_reference)
      WHERE supersedes_snapshot_id IS NULL
    `);
    await queryRunner.query(`CREATE INDEX idx_commercial_decision_principal ON commercial_decision_snapshots (principal_type, principal_id)`);
    await queryRunner.query(`CREATE INDEX idx_commercial_decision_product_decided ON commercial_decision_snapshots (product, decided_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_commercial_decision_status ON commercial_decision_snapshots (decision_status)`);
    await queryRunner.query(`CREATE INDEX idx_commercial_decision_journal ON commercial_decision_snapshots (journal_id)`);

    // Immutability: snapshots cannot be modified or deleted through any path. Corrections are
    // expressed ONLY as new compensating rows (supersedes_snapshot_id). TRUNCATE is deliberately
    // not blocked (test/provisioning tooling), consistent with repository conventions.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION commercial_decision_snapshots_immutable()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'commercial_decision_snapshots is immutable: % is not permitted; corrections require a new compensating snapshot', TG_OP;
      END;
      $$;
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_commercial_decision_snapshots_immutable
      BEFORE UPDATE OR DELETE ON commercial_decision_snapshots
      FOR EACH ROW EXECUTE FUNCTION commercial_decision_snapshots_immutable()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_commercial_decision_snapshots_immutable ON commercial_decision_snapshots`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS commercial_decision_snapshots_immutable()`);
    await queryRunner.query(`DROP TABLE commercial_decision_snapshots`);
  }
}
