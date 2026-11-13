import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 4 — Phase 2: institutional financial ownership and database-level isolation.
 *
 * Adds, on top of `1785753600400-CreateInstitutionFoundation`:
 *
 *  1. `customer_institution_enrolments` — authoritative, per-institution financial relationship for
 *     one (unchanged) customer identity. Global identity never grants institutional financial
 *     eligibility; KYC reuse is only legal when consent + policy + evidence references are recorded.
 *  2. Wallet + ledger institutional attribution — `wallet_accounts.institution_id` /
 *     `institution_attribution_id`, `ledger_accounts.institutional_scope` / `institution_id` /
 *     `institutional_purpose`, and the immutable execution record
 *     `governed_wallet_institution_attributions`. Ownership classification (`owner_class`) is left
 *     completely intact and remains orthogonal to institutional attribution.
 *  3. `ledger_journals.institution_id` plus a `ledger_lines` guard that makes cross-institution and
 *     unattributed/institutional mixed postings impossible at the database level.
 *  4. Read-only reconciliation views for unattributed financial accounts.
 *
 * Nothing is backfilled: every existing wallet, ledger account and journal stays unattributed. No
 * row is assigned to a default institution, no aggregator is consulted, and no historical journal is
 * rewritten (journals and lines are immutable by existing triggers — which is why
 * `ledger_journals.institution_id` must be written at INSERT time).
 *
 * Migration identifier is inside Arena 4's allocated range `1785753600400–1785753600499`.
 */
export class CreateInstitutionalFinancialOwnership1785753600401 implements MigrationInterface {
  name = 'CreateInstitutionalFinancialOwnership1785753600401';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- ledger institutional scope
    await queryRunner.query(`
      ALTER TABLE ledger_accounts
        ADD COLUMN institutional_scope VARCHAR(24) NOT NULL DEFAULT 'UNATTRIBUTED',
        ADD COLUMN institution_id UUID,
        ADD COLUMN institutional_purpose VARCHAR(32)
    `);
    await queryRunner.query(`
      ALTER TABLE ledger_accounts
        ADD CONSTRAINT fk_ledger_accounts_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        ADD CONSTRAINT chk_ledger_accounts_institutional_scope
          CHECK (institutional_scope IN ('UNATTRIBUTED','INSTITUTION','PLATFORM')),
        ADD CONSTRAINT chk_ledger_accounts_institutional_purpose
          CHECK (institutional_purpose IS NULL
                 OR institutional_purpose IN ('CUSTOMER_FUNDS','SETTLEMENT','SUSPENSE','CLEARING','PLATFORM_OPERATIONS')),
        ADD CONSTRAINT chk_ledger_accounts_institution_pair
          CHECK ((institutional_scope = 'INSTITUTION') = (institution_id IS NOT NULL)),
        ADD CONSTRAINT chk_ledger_accounts_institutional_combination
          CHECK ((institutional_scope = 'UNATTRIBUTED' AND institutional_purpose IS NULL)
              OR (institutional_scope = 'INSTITUTION'
                  AND institutional_purpose IN ('CUSTOMER_FUNDS','SETTLEMENT','SUSPENSE','CLEARING'))
              OR (institutional_scope = 'PLATFORM' AND institutional_purpose = 'PLATFORM_OPERATIONS'))
    `);
    await queryRunner.query(`
      CREATE INDEX idx_ledger_accounts_institution
        ON ledger_accounts (institution_id, institutional_scope)
    `);

    await queryRunner.query(`
      ALTER TABLE ledger_journals
        ADD COLUMN institution_id UUID
    `);
    await queryRunner.query(`
      ALTER TABLE ledger_journals
        ADD CONSTRAINT fk_ledger_journals_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX idx_ledger_journals_institution ON ledger_journals (institution_id)
    `);

    // ------------------------------------------------ governed wallet institutional attribution
    await queryRunner.query(`
      ALTER TABLE wallet_accounts
        ADD COLUMN institution_id UUID,
        ADD COLUMN institution_attribution_id UUID
    `);
    await queryRunner.query(`
      ALTER TABLE wallet_accounts
        ADD CONSTRAINT fk_wallet_accounts_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        ADD CONSTRAINT chk_wallet_accounts_institution_owner
          CHECK (institution_id IS NULL OR owner_class IN ('CUSTOMER','AGENT')),
        ADD CONSTRAINT chk_wallet_accounts_institution_pair
          CHECK ((institution_id IS NULL) = (institution_attribution_id IS NULL))
    `);
    await queryRunner.query(`
      CREATE INDEX idx_wallet_accounts_institution ON wallet_accounts (institution_id)
    `);
    await queryRunner.query(`
      CREATE TABLE governed_wallet_institution_attributions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        approval_id UUID NOT NULL,
        wallet_id UUID NOT NULL,
        ledger_account_id UUID NOT NULL,
        institution_id UUID NOT NULL,
        previous_institution_id UUID,
        owner_class VARCHAR(12) NOT NULL,
        owner_reference VARCHAR(160) NOT NULL,
        evidence_type VARCHAR(40) NOT NULL,
        evidence_reference VARCHAR(160) NOT NULL,
        evidence_digest CHAR(64) NOT NULL,
        reason VARCHAR(500) NOT NULL,
        executed_by VARCHAR(160) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_gwia_approval
          FOREIGN KEY (approval_id) REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        CONSTRAINT fk_gwia_wallet
          FOREIGN KEY (wallet_id) REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_gwia_ledger_account
          FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_gwia_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT fk_gwia_previous_institution
          FOREIGN KEY (previous_institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT chk_gwia_owner_class CHECK (owner_class IN ('CUSTOMER','AGENT')),
        CONSTRAINT chk_gwia_digest CHECK (evidence_digest ~ '^[a-f0-9]{64}$')
      )
    `);
    // V1 attributes a wallet at most once; re-attribution is a later governed migration, never an
    // in-place flip that would silently re-label history.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_gwia_approval ON governed_wallet_institution_attributions (approval_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_gwia_wallet ON governed_wallet_institution_attributions (wallet_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_gwia_institution ON governed_wallet_institution_attributions (institution_id)
    `);
    await queryRunner.query(`
      ALTER TABLE wallet_accounts
        ADD CONSTRAINT fk_wallet_accounts_institution_attribution
          FOREIGN KEY (institution_attribution_id)
          REFERENCES governed_wallet_institution_attributions(id) ON DELETE RESTRICT
    `);

    // ------------------------------------------- customer institutional enrolment (one identity)
    await queryRunner.query(`
      CREATE TABLE customer_institution_enrolments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(80) NOT NULL,
        customer_id UUID NOT NULL,
        institution_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        status_reason VARCHAR(500),
        financial_eligibility VARCHAR(24) NOT NULL DEFAULT 'PENDING_KYC',
        kyc_reuse_authorized BOOLEAN NOT NULL DEFAULT false,
        kyc_reuse_evidence_reference VARCHAR(160),
        consent_reference VARCHAR(160),
        policy_reference VARCHAR(160),
        approval_id UUID NOT NULL,
        effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
        effective_to TIMESTAMPTZ,
        created_by VARCHAR(160) NOT NULL,
        updated_by VARCHAR(160),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_cie_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cie_institution
          FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cie_approval
          FOREIGN KEY (approval_id) REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
        CONSTRAINT chk_cie_status CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED')),
        CONSTRAINT chk_cie_eligibility CHECK (
          financial_eligibility IN ('PENDING_KYC','ELIGIBLE','RESTRICTED')),
        CONSTRAINT chk_cie_reference CHECK (length(btrim(reference)) BETWEEN 3 AND 80),
        CONSTRAINT chk_cie_version CHECK (version > 0),
        CONSTRAINT chk_cie_effective CHECK (
          (status = 'CLOSED' AND effective_to IS NOT NULL)
          OR (status <> 'CLOSED' AND effective_to IS NULL)),
        CONSTRAINT chk_cie_effective_order CHECK (effective_to IS NULL OR effective_to > effective_from),
        -- KYC reuse requires the full authorization triad: evidence, consent, applicable policy.
        CONSTRAINT chk_cie_kyc_reuse CHECK (
          (kyc_reuse_authorized = false
            AND kyc_reuse_evidence_reference IS NULL
            AND consent_reference IS NULL
            AND policy_reference IS NULL)
          OR (kyc_reuse_authorized = true
            AND kyc_reuse_evidence_reference IS NOT NULL
            AND consent_reference IS NOT NULL
            AND policy_reference IS NOT NULL)),
        -- Institutional financial eligibility is never implied by the global customer record.
        CONSTRAINT chk_cie_eligibility_status CHECK (
          financial_eligibility <> 'ELIGIBLE' OR status = 'ACTIVE')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cie_customer_institution
        ON customer_institution_enrolments (customer_id, institution_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cie_reference ON customer_institution_enrolments (reference)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cie_institution_status
        ON customer_institution_enrolments (institution_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cie_customer ON customer_institution_enrolments (customer_id)
    `);

    // ------------------------------------------------------------------- guard functions
    await queryRunner.query(`
      CREATE FUNCTION wallet_institution_attribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        v_receipt governed_wallet_institution_attributions%ROWTYPE;
        v_status TEXT;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.institution_id IS NOT NULL OR NEW.institution_attribution_id IS NOT NULL THEN
            RAISE EXCEPTION 'A wallet cannot be created with an institutional attribution; use the governed attribution workflow';
          END IF;
          RETURN NEW;
        END IF;

        IF NEW.institution_id IS NOT DISTINCT FROM OLD.institution_id
           AND NEW.institution_attribution_id IS NOT DISTINCT FROM OLD.institution_attribution_id THEN
          RETURN NEW;
        END IF;

        IF OLD.institution_id IS NOT NULL THEN
          RAISE EXCEPTION 'Wallet institutional attribution is immutable';
        END IF;
        IF NEW.institution_id IS NULL OR NEW.institution_attribution_id IS NULL THEN
          RAISE EXCEPTION 'Wallet institutional attribution cannot be cleared or partially set';
        END IF;
        IF NEW.owner_class NOT IN ('CUSTOMER','AGENT') THEN
          RAISE EXCEPTION 'Only customer and agent wallets can carry an institutional attribution';
        END IF;

        SELECT * INTO v_receipt
          FROM governed_wallet_institution_attributions r
         WHERE r.id = NEW.institution_attribution_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Wallet institutional attribution requires a governed execution record';
        END IF;
        IF v_receipt.wallet_id <> NEW.id
           OR v_receipt.institution_id <> NEW.institution_id
           OR v_receipt.ledger_account_id <> NEW.ledger_account_id THEN
          RAISE EXCEPTION 'Wallet institutional attribution does not match its governed execution record';
        END IF;
        IF NOT fn_institution_approval_consumed(
          v_receipt.approval_id, 'WALLET_INSTITUTION_ATTRIBUTION', 'WALLET_ACCOUNT', NEW.id::text) THEN
          RAISE EXCEPTION 'Wallet institutional attribution requires a consumed WALLET_INSTITUTION_ATTRIBUTION approval';
        END IF;

        SELECT status INTO v_status FROM financial_institutions WHERE id = NEW.institution_id;
        IF v_status IS DISTINCT FROM 'APPROVED' THEN
          RAISE EXCEPTION 'Wallet institutional attribution requires an operationally approved institution';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER wallet_institution_attribution_guard
        BEFORE INSERT OR UPDATE ON wallet_accounts
        FOR EACH ROW EXECUTE FUNCTION wallet_institution_attribution_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION ledger_account_institution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        v_status TEXT;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.institutional_scope = 'INSTITUTION' THEN
            -- Institution-specific settlement/suspense/clearing accounts are created directly and
            -- never replace the governed wallet attribution path.
            IF NEW.institutional_purpose = 'CUSTOMER_FUNDS' THEN
              RAISE EXCEPTION 'A customer-funds ledger account is attributed only through the governed wallet workflow';
            END IF;
            SELECT status INTO v_status FROM financial_institutions WHERE id = NEW.institution_id;
            IF v_status IS DISTINCT FROM 'APPROVED' THEN
              RAISE EXCEPTION 'An institution account requires an operationally approved institution';
            END IF;
          END IF;
          RETURN NEW;
        END IF;

        IF NEW.institution_id IS NOT DISTINCT FROM OLD.institution_id
           AND NEW.institutional_scope IS NOT DISTINCT FROM OLD.institutional_scope
           AND NEW.institutional_purpose IS NOT DISTINCT FROM OLD.institutional_purpose THEN
          RETURN NEW;
        END IF;

        IF OLD.institution_id IS NOT NULL AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
          RAISE EXCEPTION 'Ledger account institutional attribution is immutable';
        END IF;
        IF OLD.institutional_scope <> 'UNATTRIBUTED'
           AND NEW.institutional_scope IS DISTINCT FROM OLD.institutional_scope THEN
          RAISE EXCEPTION 'Ledger account institutional scope is immutable once set';
        END IF;

        IF NEW.institution_id IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM governed_wallet_institution_attributions r
             WHERE r.institution_id = NEW.institution_id
               AND r.ledger_account_id = NEW.id
          ) THEN
            RAISE EXCEPTION 'Ledger account institutional attribution requires a governed wallet attribution record';
          END IF;
          IF EXISTS (SELECT 1 FROM ledger_lines l WHERE l.ledger_account_id = NEW.id) THEN
            RAISE EXCEPTION 'A ledger account with posted financial history cannot be institutionally attributed'
              USING ERRCODE = '55000';
          END IF;
        END IF;

        IF NEW.institutional_scope = 'PLATFORM' AND OLD.institutional_scope = 'UNATTRIBUTED' THEN
          IF EXISTS (SELECT 1 FROM wallet_accounts w WHERE w.ledger_account_id = NEW.id) THEN
            RAISE EXCEPTION 'A wallet ledger account cannot become a platform-level account';
          END IF;
          IF EXISTS (SELECT 1 FROM ledger_lines l WHERE l.ledger_account_id = NEW.id) THEN
            RAISE EXCEPTION 'A ledger account with posted financial history cannot become a platform-level account';
          END IF;
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER ledger_account_institution_guard
        BEFORE INSERT OR UPDATE ON ledger_accounts
        FOR EACH ROW EXECUTE FUNCTION ledger_account_institution_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION ledger_line_institution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        v_journal_institution UUID;
        v_scope TEXT;
        v_account_institution UUID;
      BEGIN
        SELECT institution_id INTO v_journal_institution
          FROM ledger_journals WHERE id = NEW.journal_id;
        SELECT institutional_scope, institution_id INTO v_scope, v_account_institution
          FROM ledger_accounts WHERE id = NEW.ledger_account_id;

        IF v_scope = 'INSTITUTION' THEN
          IF v_journal_institution IS NULL THEN
            RAISE EXCEPTION 'An institutional ledger account requires an institutional journal';
          END IF;
          IF v_journal_institution <> v_account_institution THEN
            RAISE EXCEPTION 'Cross-institution internal posting is not permitted'
              USING ERRCODE = '23514';
          END IF;
        ELSIF v_journal_institution IS NOT NULL THEN
          RAISE EXCEPTION 'A ledger account without an institutional attribution cannot participate in an institutional journal'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER ledger_line_institution_guard
        BEFORE INSERT ON ledger_lines
        FOR EACH ROW EXECUTE FUNCTION ledger_line_institution_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION governed_wallet_institution_attribution_guard() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'Governed wallet institution attribution records are immutable';
        END IF;
        IF NOT fn_institution_approval_consumed(
          NEW.approval_id, 'WALLET_INSTITUTION_ATTRIBUTION', 'WALLET_ACCOUNT', NEW.wallet_id::text) THEN
          RAISE EXCEPTION 'Governed wallet institution attribution requires a consumed WALLET_INSTITUTION_ATTRIBUTION approval';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER governed_wallet_institution_attribution_guard
        BEFORE INSERT OR UPDATE OR DELETE ON governed_wallet_institution_attributions
        FOR EACH ROW EXECUTE FUNCTION governed_wallet_institution_attribution_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION customer_institution_enrolment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        v_status TEXT;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Customer institution enrolments cannot be deleted; close them instead';
        END IF;

        IF TG_OP = 'INSERT' THEN
          IF NOT fn_institution_approval_consumed(
            NEW.approval_id, 'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE', 'CUSTOMER', NEW.customer_id::text) THEN
            RAISE EXCEPTION 'A customer institution enrolment requires a consumed CUSTOMER_INSTITUTION_ENROLMENT_CHANGE approval';
          END IF;
          IF NEW.status = 'ACTIVE' THEN
            SELECT status INTO v_status FROM financial_institutions WHERE id = NEW.institution_id;
            IF v_status IS DISTINCT FROM 'APPROVED' THEN
              RAISE EXCEPTION 'An ACTIVE enrolment requires an operationally approved institution';
            END IF;
          END IF;
          NEW.version := 1;
          NEW.created_at := clock_timestamp();
          NEW.updated_at := clock_timestamp();
          RETURN NEW;
        END IF;

        IF NEW.customer_id <> OLD.customer_id
           OR NEW.institution_id <> OLD.institution_id
           OR NEW.reference <> OLD.reference
           OR NEW.created_by <> OLD.created_by
           OR NEW.created_at <> OLD.created_at THEN
          RAISE EXCEPTION 'Customer institution enrolment identity is immutable';
        END IF;
        IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
          RAISE EXCEPTION 'A closed customer institution enrolment cannot be reopened';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status OR NEW.financial_eligibility IS DISTINCT FROM OLD.financial_eligibility THEN
          IF NEW.approval_id IS NOT DISTINCT FROM OLD.approval_id
             AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.financial_eligibility IS DISTINCT FROM OLD.financial_eligibility) THEN
            RAISE EXCEPTION 'A customer institution enrolment change requires its own approved request';
          END IF;
          IF NOT fn_institution_approval_consumed(
            NEW.approval_id, 'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE', 'CUSTOMER', NEW.customer_id::text) THEN
            RAISE EXCEPTION 'A customer institution enrolment change requires a consumed CUSTOMER_INSTITUTION_ENROLMENT_CHANGE approval';
          END IF;
          IF NEW.status = 'ACTIVE' THEN
            SELECT status INTO v_status FROM financial_institutions WHERE id = NEW.institution_id;
            IF v_status IS DISTINCT FROM 'APPROVED' THEN
              RAISE EXCEPTION 'An ACTIVE enrolment requires an operationally approved institution';
            END IF;
          END IF;
        END IF;

        NEW.version := OLD.version + 1;
        NEW.updated_at := clock_timestamp();
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER customer_institution_enrolment_guard
        BEFORE INSERT OR UPDATE OR DELETE ON customer_institution_enrolments
        FOR EACH ROW EXECUTE FUNCTION customer_institution_enrolment_guard()
    `);

    // ------------------------------------------------------- read-only reconciliation views
    await queryRunner.query(`
      CREATE VIEW unattributed_financial_accounts AS
      SELECT
        'WALLET'::text AS entity,
        w.id AS entity_id,
        w.owner_class,
        w.customer_id AS owner_reference,
        w.currency,
        w.status,
        w.ledger_account_id,
        (SELECT count(*)::bigint FROM ledger_lines l WHERE l.ledger_account_id = w.ledger_account_id)
          AS ledger_line_count,
        (SELECT COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)
           FROM ledger_lines l WHERE l.ledger_account_id = w.ledger_account_id)::text
          AS balance_minor
      FROM wallet_accounts w
      WHERE w.institution_id IS NULL
      UNION ALL
      SELECT
        'LEDGER_ACCOUNT'::text AS entity,
        a.id AS entity_id,
        NULL::varchar AS owner_class,
        NULL::varchar AS owner_reference,
        a.currency,
        CASE WHEN a.is_active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
        a.id AS ledger_account_id,
        (SELECT count(*)::bigint FROM ledger_lines l WHERE l.ledger_account_id = a.id) AS ledger_line_count,
        (SELECT COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)
           FROM ledger_lines l WHERE l.ledger_account_id = a.id)::text AS balance_minor
      FROM ledger_accounts a
      WHERE a.institutional_scope = 'UNATTRIBUTED'
        AND NOT EXISTS (SELECT 1 FROM wallet_accounts w WHERE w.ledger_account_id = a.id)
    `);
    await queryRunner.query(`
      CREATE VIEW institution_financial_coverage AS
      SELECT
        fi.id AS institution_id,
        fi.code,
        fi.status AS institution_status,
        (SELECT count(*)::bigint FROM customer_institution_enrolments e
          WHERE e.institution_id = fi.id AND e.status = 'ACTIVE') AS active_enrolments,
        (SELECT count(*)::bigint FROM institution_agent_affiliations af
          WHERE af.institution_id = fi.id AND af.status = 'ACTIVE') AS active_affiliations,
        (SELECT count(*)::bigint FROM wallet_accounts w
          WHERE w.institution_id = fi.id) AS attributed_wallets,
        (SELECT count(*)::bigint FROM ledger_accounts a
          WHERE a.institution_id = fi.id) AS institutional_ledger_accounts
      FROM financial_institutions fi
    `);
  }

  /**
   * Removing institutional ownership would silently re-open ungoverned institutional postings and
   * detach attributed wallets from their governed execution records. Refuse while any institution is
   * registered, mirroring the fail-closed convention of `1785753600400` and `1785753600118`.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT count(*)::text AS count FROM financial_institutions`,
    )) as Array<{ count: string }>;
    if (Number(rows[0]?.count ?? '0') > 0) {
      throw new Error(
        'Refusing to remove institutional financial ownership while financial institutions exist',
      );
    }
    await queryRunner.query(`DROP VIEW IF EXISTS institution_financial_coverage`);
    await queryRunner.query(`DROP VIEW IF EXISTS unattributed_financial_accounts`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS customer_institution_enrolment_guard ON customer_institution_enrolments`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS customer_institution_enrolment_guard()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS governed_wallet_institution_attribution_guard ON governed_wallet_institution_attributions`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS governed_wallet_institution_attribution_guard()`,
    );
    await queryRunner.query(`DROP TRIGGER IF EXISTS ledger_line_institution_guard ON ledger_lines`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS ledger_line_institution_guard()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS ledger_account_institution_guard ON ledger_accounts`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS ledger_account_institution_guard()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS wallet_institution_attribution_guard ON wallet_accounts`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS wallet_institution_attribution_guard()`);
    await queryRunner.query(
      `ALTER TABLE wallet_accounts DROP CONSTRAINT IF EXISTS fk_wallet_accounts_institution_attribution`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS governed_wallet_institution_attributions`);
    await queryRunner.query(
      `ALTER TABLE wallet_accounts
         DROP CONSTRAINT IF EXISTS chk_wallet_accounts_institution_pair,
         DROP CONSTRAINT IF EXISTS chk_wallet_accounts_institution_owner,
         DROP CONSTRAINT IF EXISTS fk_wallet_accounts_institution,
         DROP COLUMN IF EXISTS institution_attribution_id,
         DROP COLUMN IF EXISTS institution_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS customer_institution_enrolments`);
    await queryRunner.query(
      `ALTER TABLE ledger_journals
         DROP CONSTRAINT IF EXISTS fk_ledger_journals_institution,
         DROP COLUMN IF EXISTS institution_id`,
    );
    await queryRunner.query(
      `ALTER TABLE ledger_accounts
         DROP CONSTRAINT IF EXISTS chk_ledger_accounts_institutional_combination,
         DROP CONSTRAINT IF EXISTS chk_ledger_accounts_institution_pair,
         DROP CONSTRAINT IF EXISTS chk_ledger_accounts_institutional_purpose,
         DROP CONSTRAINT IF EXISTS chk_ledger_accounts_institutional_scope,
         DROP CONSTRAINT IF EXISTS fk_ledger_accounts_institution,
         DROP COLUMN IF EXISTS institutional_purpose,
         DROP COLUMN IF EXISTS institution_id,
         DROP COLUMN IF EXISTS institutional_scope`,
    );
  }
}
