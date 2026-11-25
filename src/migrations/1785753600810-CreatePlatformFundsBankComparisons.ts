import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Finance → Reconciliation, "Platform Funds vs. Bank Balance".
 *
 * Three tables hold the staff-entered comparison between (a) the ledger-backed amount MonieNaija
 * expects to hold in a bank/settlement account and (b) the actual bank balance Finance verified
 * independently. Nothing here moves money and nothing posts a ledger adjustment:
 *
 *   platform_funds_comparisons         one row per comparison (DRAFT → SUBMITTED → APPROVED/REJECTED)
 *   platform_funds_timing_items        staff-recorded timing/difference explanations (DRAFT only)
 *   platform_funds_comparison_snapshots versioned, hash-bound ledger evidence + manual entry used
 *                                      for the comparison (reviewable forever)
 *
 * The comparison is maker/checker governed through the existing PrivilegedActionApprovalService
 * machinery under the registered PLATFORM_FUNDS_BANK_COMPARISON governed action; approval linkage
 * is deliberately a soft reference (approval rows are owned by the authorization module and their
 * lifecycle is decided there, exactly as journal reversals reference them).
 *
 * Once a comparison leaves DRAFT it is frozen: timing items and snapshots are append-only, and a
 * decided comparison (APPROVED/REJECTED) can never be mutated again. The trigger below refuses
 * those transitions in the database, independent of application code.
 */
export class CreatePlatformFundsBankComparisons1785753600810 implements MigrationInterface {
  name = 'CreatePlatformFundsBankComparisons1785753600810';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_funds_comparisons (
        id uuid PRIMARY KEY,
        institution_id uuid NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        scope varchar(16) NOT NULL,
        settlement_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        currency char(3) NOT NULL,
        accounting_unit varchar(64) NOT NULL DEFAULT 'CUSTOMER_FUNDS',
        ledger_cutoff timestamptz NOT NULL,
        bank_cutoff timestamptz NOT NULL,
        statement_reference varchar(255) NOT NULL,
        bank_balance_minor bigint NOT NULL,
        expected_minor bigint NOT NULL,
        difference_minor bigint NOT NULL,
        timing_total_minor bigint NOT NULL DEFAULT 0,
        unexplained_minor bigint NOT NULL,
        mapping_complete boolean NOT NULL,
        blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
        status varchar(16) NOT NULL DEFAULT 'DRAFT',
        approval_id uuid NULL,
        decision_reason text NULL,
        created_by varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        submitted_by varchar(160) NULL,
        submitted_at timestamptz NULL,
        reviewed_by varchar(160) NULL,
        reviewed_at timestamptz NULL,
        CONSTRAINT chk_platform_funds_scope CHECK (scope IN ('PLATFORM', 'INSTITUTION')),
        CONSTRAINT chk_platform_funds_scope_pair CHECK ((scope = 'INSTITUTION') = (institution_id IS NOT NULL)),
        CONSTRAINT chk_platform_funds_status CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
        CONSTRAINT chk_platform_funds_currency CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT chk_platform_funds_accounting_unit CHECK (accounting_unit ~ '^[A-Z][A-Z0-9_:-]{1,63}$'),
        CONSTRAINT chk_platform_funds_statement_reference CHECK (length(statement_reference) >= 3),
        CONSTRAINT chk_platform_funds_decision_shape CHECK (
          (status = 'DRAFT' AND reviewed_by IS NULL AND reviewed_at IS NULL AND decision_reason IS NULL)
          OR (status = 'SUBMITTED' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
          OR (status IN ('APPROVED', 'REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
        ),
        CONSTRAINT chk_platform_funds_difference_math CHECK (difference_minor = bank_balance_minor - expected_minor),
        CONSTRAINT chk_platform_funds_unexplained_math CHECK (unexplained_minor = difference_minor - timing_total_minor)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_platform_funds_comparisons_scope_created ON platform_funds_comparisons (scope, institution_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_platform_funds_comparisons_status ON platform_funds_comparisons (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_platform_funds_comparisons_settlement_account ON platform_funds_comparisons (settlement_account_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_platform_funds_comparisons_approval ON platform_funds_comparisons (approval_id) WHERE approval_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE platform_funds_timing_items (
        id uuid PRIMARY KEY,
        comparison_id uuid NOT NULL REFERENCES platform_funds_comparisons(id) ON DELETE CASCADE,
        title varchar(160) NOT NULL,
        reference varchar(120) NOT NULL,
        explanation varchar(1000) NOT NULL,
        amount_minor bigint NOT NULL,
        created_by varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_platform_funds_timing_amount CHECK (amount_minor <> 0),
        CONSTRAINT chk_platform_funds_timing_reference CHECK (length(reference) >= 3),
        CONSTRAINT chk_platform_funds_timing_title CHECK (length(title) >= 3)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_platform_funds_timing_items_comparison ON platform_funds_timing_items (comparison_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE platform_funds_comparison_snapshots (
        id uuid PRIMARY KEY,
        comparison_id uuid NOT NULL REFERENCES platform_funds_comparisons(id) ON DELETE CASCADE,
        version integer NOT NULL,
        reason varchar(16) NOT NULL,
        snapshot jsonb NOT NULL,
        evidence_hash char(64) NOT NULL,
        created_by varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_platform_funds_snapshot_version UNIQUE (comparison_id, version),
        CONSTRAINT chk_platform_funds_snapshot_version CHECK (version > 0),
        CONSTRAINT chk_platform_funds_snapshot_reason CHECK (reason IN ('CREATED', 'UPDATED', 'SUBMITTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED')),
        CONSTRAINT chk_platform_funds_snapshot_hash CHECK (evidence_hash ~ '^[a-f0-9]{64}$')
      )
    `);

    // Supports the as-of-cutoff ledger reads this workflow performs on every preview/submit.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_ledger_journals_currency_unit_posted ON ledger_journals (currency, accounting_unit, posted_at)`,
    );

    // --- freeze decided comparisons in the database, independent of application code -----------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_funds_comparisons_freeze()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Platform funds comparisons are immutable evidence and cannot be deleted'
            USING ERRCODE = '55000';
        END IF;
        IF OLD.status IN ('APPROVED', 'REJECTED') THEN
          RAISE EXCEPTION 'A decided platform funds comparison cannot be modified'
            USING ERRCODE = '55000';
        END IF;
        IF OLD.status = 'SUBMITTED' AND NEW.status NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') THEN
          RAISE EXCEPTION 'A submitted platform funds comparison cannot return to %', NEW.status
            USING ERRCODE = '55000';
        END IF;
        -- identity and ledger-facing fields never change after creation
        IF NEW.id <> OLD.id
           OR NEW.settlement_account_id <> OLD.settlement_account_id
           OR NEW.scope <> OLD.scope
           OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
           OR NEW.currency <> OLD.currency
           OR NEW.accounting_unit <> OLD.accounting_unit
           OR NEW.created_by <> OLD.created_by THEN
          RAISE EXCEPTION 'Comparison identity fields are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(
      `CREATE TRIGGER platform_funds_comparisons_freeze_trigger
         BEFORE UPDATE OR DELETE ON platform_funds_comparisons
         FOR EACH ROW EXECUTE FUNCTION platform_funds_comparisons_freeze()`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_funds_timing_items_freeze()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      DECLARE
        parent_status varchar(16);
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'Timing items are immutable; delete and re-add while the comparison is a draft'
            USING ERRCODE = '55000';
        END IF;
        SELECT status INTO parent_status
          FROM platform_funds_comparisons WHERE id = COALESCE(NEW.comparison_id, OLD.comparison_id);
        IF parent_status <> 'DRAFT' THEN
          RAISE EXCEPTION 'Timing items can only change while the comparison is in DRAFT'
            USING ERRCODE = '55000';
        END IF;
        RETURN COALESCE(NEW, OLD);
      END $$
    `);
    await queryRunner.query(
      `CREATE TRIGGER platform_funds_timing_items_freeze_trigger
         BEFORE INSERT OR UPDATE OR DELETE ON platform_funds_timing_items
         FOR EACH ROW EXECUTE FUNCTION platform_funds_timing_items_freeze()`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION platform_funds_snapshots_freeze()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Comparison snapshots are immutable evidence'
          USING ERRCODE = '55000';
      END $$
    `);
    await queryRunner.query(
      `CREATE TRIGGER platform_funds_snapshots_freeze_trigger
         BEFORE UPDATE OR DELETE ON platform_funds_comparison_snapshots
         FOR EACH ROW EXECUTE FUNCTION platform_funds_snapshots_freeze()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS platform_funds_snapshots_freeze_trigger ON platform_funds_comparison_snapshots`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS platform_funds_snapshots_freeze()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS platform_funds_timing_items_freeze_trigger ON platform_funds_timing_items`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS platform_funds_timing_items_freeze()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS platform_funds_comparisons_freeze_trigger ON platform_funds_comparisons`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS platform_funds_comparisons_freeze()`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ledger_journals_currency_unit_posted`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_funds_comparison_snapshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_funds_timing_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_funds_comparisons`);
  }
}
