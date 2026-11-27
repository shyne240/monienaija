import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Arena 10 — Provider Settlement Report & Statement Reconciliation.
 *
 * Strictly non-posting reconciliation evidence, matching, settlement-to-statement verification,
 * and return/reversal/dispute correlation tables:
 *   1. `settlement_report_imports` — immutable imported report/statement metadata + SHA-256 dedupe
 *   2. `settlement_report_rejected_rows` — append-only malformed/duplicate row rejection log
 *   3. `settlement_report_rows` — append-only normalized report/statement rows (masked accounts only)
 *   4. `settlement_transaction_matches` — row-level & missing-in-provider matches + MFA maker-checker review
 *   5. `settlement_batch_reconciliations` — gross, Monnify fee, merchant settlement, platform charge,
 *      customer wallet credit & statement credit reconciliation + MFA maker-checker review
 *   6. `settlement_return_dispute_cases` — return, disbursement reversal, voluntary refund, chargeback/lien
 *      and customer-dispute cases with frozen, immutable original transaction amounts
 *   7. `settlement_return_dispute_events` — append-only lifecycle event log per return/dispute case
 *
 * Nothing in these tables or triggers ever writes to `ledger_journals`, `ledger_lines`,
 * `wallet_accounts`, `banking_outbound_operations`, or `banking_inbound_payments`.
 */
export class SettlementReportReconciliation1785753600910 implements MigrationInterface {
  name = 'SettlementReportReconciliation1785753600910';

  public async up(q: QueryRunner): Promise<void> {
    // -------------------------------------------------------- 1. report imports
    await q.query(`
      CREATE TABLE settlement_report_imports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope varchar(16) NOT NULL CHECK (scope IN ('PLATFORM', 'INSTITUTION')),
        institution_id uuid NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL CHECK (provider_key ~ '^[A-Z][A-Z0-9_]{2,31}$'),
        report_type varchar(32) NOT NULL CHECK (
          report_type IN (
            'COLLECTIONS',
            'PAYOUTS',
            'SETTLEMENTS',
            'WALLET_STATEMENT',
            'BANK_STATEMENT',
            'REFUNDS_DISPUTES'
          )
        ),
        file_format varchar(16) NOT NULL CHECK (file_format IN ('JSON', 'CSV')),
        verification_status varchar(48) NOT NULL CHECK (
          verification_status IN (
            'VERIFIED_OFFICIAL_API_JSON',
            'UNVERIFIED_MISSING_REDACTED_EXPORT'
          )
        ),
        statement_destination varchar(24) NOT NULL DEFAULT 'UNSPECIFIED' CHECK (
          statement_destination IN ('MONNIFY_WALLET', 'BANK_ACCOUNT', 'UNSPECIFIED')
        ),
        masked_statement_account varchar(32) NULL CHECK (
          masked_statement_account IS NULL OR masked_statement_account ~ '^(•)+[0-9A-Za-z]{0,4}$'
        ),
        source_filename varchar(255) NOT NULL CHECK (length(source_filename) >= 1),
        content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
        byte_length integer NOT NULL CHECK (byte_length > 0),
        currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
        period_start timestamptz NULL,
        period_end timestamptz NULL,
        total_rows integer NOT NULL CHECK (total_rows >= 0),
        valid_rows integer NOT NULL CHECK (valid_rows >= 0 AND valid_rows <= total_rows),
        rejected_rows integer NOT NULL CHECK (rejected_rows >= 0 AND valid_rows + rejected_rows = total_rows),
        gross_total_minor numeric(20,0) NOT NULL DEFAULT 0,
        provider_fee_total_minor numeric(20,0) NOT NULL DEFAULT 0,
        net_total_minor numeric(20,0) NOT NULL DEFAULT 0,
        imported_by varchar(160) NOT NULL,
        importer_note varchar(500) NULL,
        imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT chk_settlement_report_imports_scope_pair CHECK (
          (scope = 'INSTITUTION') = (institution_id IS NOT NULL)
        ),
        CONSTRAINT chk_settlement_report_imports_period CHECK (
          period_start IS NULL OR period_end IS NULL OR period_start <= period_end
        )
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX uq_settlement_report_imports_sha256
        ON settlement_report_imports (
          COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
          provider_key,
          report_type,
          content_sha256
        )
    `);
    await q.query(`
      CREATE INDEX idx_settlement_report_imports_scope_time
        ON settlement_report_imports (scope, institution_id, imported_at DESC)
    `);

    // --------------------------------------------------- 2. rejected rows (append-only)
    await q.query(`
      CREATE TABLE settlement_report_rejected_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        import_id uuid NOT NULL REFERENCES settlement_report_imports(id) ON DELETE RESTRICT,
        row_number integer NOT NULL CHECK (row_number >= 1),
        reason_code varchar(64) NOT NULL,
        message varchar(500) NOT NULL,
        sanitized_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (import_id, row_number)
      )
    `);

    // --------------------------------------------------- 3. report rows (append-only)
    await q.query(`
      CREATE TABLE settlement_report_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        import_id uuid NOT NULL REFERENCES settlement_report_imports(id) ON DELETE RESTRICT,
        row_number integer NOT NULL CHECK (row_number >= 1),
        direction varchar(24) NOT NULL CHECK (
          direction IN (
            'INBOUND',
            'OUTBOUND',
            'SETTLEMENT',
            'STATEMENT_CREDIT',
            'STATEMENT_DEBIT',
            'RETURN_EVENT'
          )
        ),
        provider_transaction_reference varchar(160) NULL,
        platform_reference varchar(160) NULL,
        payment_reference varchar(160) NULL,
        settlement_reference varchar(160) NULL,
        payout_reference varchar(160) NULL,
        nip_session_id varchar(64) NULL,
        refund_or_dispute_reference varchar(160) NULL,
        currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
        gross_amount_minor numeric(20,0) NOT NULL DEFAULT 0,
        provider_fee_minor numeric(20,0) NOT NULL DEFAULT 0,
        net_amount_minor numeric(20,0) NOT NULL DEFAULT 0,
        running_balance_after_minor numeric(20,0) NULL,
        provider_status varchar(64) NOT NULL,
        occurred_at timestamptz NULL,
        settled_at timestamptz NULL,
        masked_counterparty_account varchar(32) NULL CHECK (
          masked_counterparty_account IS NULL OR masked_counterparty_account ~ '^(•)+[0-9A-Za-z]{0,4}$'
        ),
        masked_destination_account varchar(32) NULL CHECK (
          masked_destination_account IS NULL OR masked_destination_account ~ '^(•)+[0-9A-Za-z]{0,4}$'
        ),
        counterparty_bank_code varchar(32) NULL,
        narration varchar(500) NULL,
        underlying_items jsonb NOT NULL DEFAULT '[]'::jsonb,
        normalized_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
        row_fingerprint char(64) NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (import_id, row_number)
      )
    `);
    await q.query(`
      CREATE INDEX idx_settlement_report_rows_fingerprint
        ON settlement_report_rows (row_fingerprint)
    `);
    await q.query(`
      CREATE INDEX idx_settlement_report_rows_settlement_ref
        ON settlement_report_rows (settlement_reference)
        WHERE settlement_reference IS NOT NULL
    `);

    // --------------------------------------------------- 4. transaction matches & exception queue
    await q.query(`
      CREATE TABLE settlement_transaction_matches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope varchar(16) NOT NULL CHECK (scope IN ('PLATFORM', 'INSTITUTION')),
        institution_id uuid NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL,
        report_type varchar(32) NOT NULL,
        import_id uuid NOT NULL REFERENCES settlement_report_imports(id) ON DELETE RESTRICT,
        report_row_id uuid NULL REFERENCES settlement_report_rows(id) ON DELETE RESTRICT,
        direction varchar(24) NOT NULL,
        match_status varchar(40) NOT NULL CHECK (
          match_status IN (
            'MATCHED',
            'MISSING_INTERNAL',
            'MISSING_IN_PROVIDER',
            'AMOUNT_MISMATCH',
            'FEE_MISMATCH',
            'STATUS_MISMATCH',
            'DATE_WINDOW_MISMATCH',
            'DUPLICATE_PROVIDER_ROW',
            'AMBIGUOUS_CANDIDATES'
          )
        ),
        matched_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
        explanation varchar(600) NOT NULL,
        currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
        provider_gross_minor numeric(20,0) NULL,
        provider_fee_minor numeric(20,0) NULL,
        provider_net_minor numeric(20,0) NULL,
        provider_status varchar(64) NULL,
        provider_occurred_at timestamptz NULL,
        internal_source_type varchar(48) NULL,
        internal_source_id uuid NULL,
        internal_business_reference varchar(160) NULL,
        internal_provider_reference varchar(160) NULL,
        internal_gross_minor numeric(20,0) NULL,
        internal_provider_fee_minor numeric(20,0) NULL,
        internal_net_minor numeric(20,0) NULL,
        internal_platform_fee_minor numeric(20,0) NULL,
        internal_customer_credit_minor numeric(20,0) NULL,
        internal_status varchar(64) NULL,
        internal_occurred_at timestamptz NULL,
        internal_transaction_history_path varchar(200) NULL,
        internal_journal_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        variance_minor numeric(20,0) NOT NULL DEFAULT 0,
        fee_variance_minor numeric(20,0) NOT NULL DEFAULT 0,
        ambiguous_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
        review_state varchar(24) NOT NULL DEFAULT 'NONE' CHECK (
          review_state IN ('NONE', 'PROPOSED', 'APPROVED', 'REJECTED')
        ),
        proposed_decision varchar(48) NULL,
        selected_candidate_id uuid NULL,
        linked_journal_id uuid NULL REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        proposed_note varchar(1000) NULL,
        proposed_by varchar(160) NULL,
        proposed_at timestamptz NULL,
        reviewed_by varchar(160) NULL,
        reviewed_at timestamptz NULL,
        review_note varchar(1000) NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT chk_settlement_tx_matches_scope_pair CHECK (
          (scope = 'INSTITUTION') = (institution_id IS NOT NULL)
        ),
        CONSTRAINT chk_settlement_tx_matches_sod CHECK (
          reviewed_by IS NULL OR proposed_by IS NULL OR reviewed_by <> proposed_by
        )
      )
    `);
    await q.query(`
      CREATE INDEX idx_settlement_tx_matches_scope_status
        ON settlement_transaction_matches (scope, institution_id, match_status, created_at DESC)
    `);

    // --------------------------------------------------- 5. settlement batch reconciliations
    await q.query(`
      CREATE TABLE settlement_batch_reconciliations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope varchar(16) NOT NULL CHECK (scope IN ('PLATFORM', 'INSTITUTION')),
        institution_id uuid NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL,
        settlement_reference varchar(160) NOT NULL,
        payout_reference varchar(160) NULL,
        settlement_row_id uuid NULL REFERENCES settlement_report_rows(id) ON DELETE RESTRICT,
        statement_row_id uuid NULL REFERENCES settlement_report_rows(id) ON DELETE RESTRICT,
        statement_destination varchar(24) NOT NULL DEFAULT 'UNSPECIFIED' CHECK (
          statement_destination IN ('MONNIFY_WALLET', 'BANK_ACCOUNT', 'UNSPECIFIED')
        ),
        masked_destination_account varchar(32) NULL CHECK (
          masked_destination_account IS NULL OR masked_destination_account ~ '^(•)+[0-9A-Za-z]{0,4}$'
        ),
        currency char(3) NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
        gross_collections_minor numeric(20,0) NOT NULL DEFAULT 0,
        provider_fee_total_minor numeric(20,0) NOT NULL DEFAULT 0,
        expected_net_settlement_minor numeric(20,0) NOT NULL DEFAULT 0,
        platform_fee_total_minor numeric(20,0) NOT NULL DEFAULT 0,
        customer_wallet_credit_total_minor numeric(20,0) NOT NULL DEFAULT 0,
        reported_net_settlement_minor numeric(20,0) NOT NULL DEFAULT 0,
        statement_credit_minor numeric(20,0) NULL,
        variance_minor numeric(20,0) NOT NULL DEFAULT 0,
        matched_collection_count integer NOT NULL DEFAULT 0 CHECK (matched_collection_count >= 0),
        missing_collection_count integer NOT NULL DEFAULT 0 CHECK (missing_collection_count >= 0),
        settled_at timestamptz NULL,
        batch_status varchar(40) NOT NULL CHECK (
          batch_status IN (
            'RECONCILED',
            'NET_AMOUNT_MISMATCH',
            'FEE_MISMATCH',
            'MISSING_COLLECTION_DETAIL',
            'STATEMENT_UNMATCHED',
            'PAYOUT_FAILED_OR_PENDING',
            'AMBIGUOUS'
          )
        ),
        explanation varchar(600) NOT NULL,
        review_state varchar(24) NOT NULL DEFAULT 'NONE' CHECK (
          review_state IN ('NONE', 'PROPOSED', 'APPROVED', 'REJECTED')
        ),
        proposed_decision varchar(48) NULL,
        linked_journal_id uuid NULL REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        linked_comparison_id uuid NULL REFERENCES platform_funds_comparisons(id) ON DELETE RESTRICT,
        proposed_note varchar(1000) NULL,
        proposed_by varchar(160) NULL,
        proposed_at timestamptz NULL,
        reviewed_by varchar(160) NULL,
        reviewed_at timestamptz NULL,
        review_note varchar(1000) NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT chk_settlement_batches_scope_pair CHECK (
          (scope = 'INSTITUTION') = (institution_id IS NOT NULL)
        ),
        CONSTRAINT chk_settlement_batches_sod CHECK (
          reviewed_by IS NULL OR proposed_by IS NULL OR reviewed_by <> proposed_by
        )
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX uq_settlement_batch_reconciliations_ref
        ON settlement_batch_reconciliations (
          COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
          provider_key,
          settlement_reference
        )
    `);
    await q.query(`
      CREATE INDEX idx_settlement_batch_reconciliations_scope
        ON settlement_batch_reconciliations (scope, institution_id, batch_status, updated_at DESC)
    `);

    // --------------------------------------------------- 6. return, reversal & dispute cases
    await q.query(`
      CREATE TABLE settlement_return_dispute_cases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        case_key varchar(200) NOT NULL,
        scope varchar(16) NOT NULL CHECK (scope IN ('PLATFORM', 'INSTITUTION')),
        institution_id uuid NULL REFERENCES financial_institutions(id) ON DELETE RESTRICT,
        provider_key varchar(32) NOT NULL,
        case_kind varchar(48) NOT NULL CHECK (
          case_kind IN (
            'VOLUNTARY_REFUND',
            'APPROVED_RETURN_AWAITING_CONFIRMATION',
            'OUTBOUND_DISBURSEMENT_REVERSAL',
            'INBOUND_COLLECTION_REVERSAL',
            'CHARGEBACK_OR_LIEN',
            'CUSTOMER_DISPUTE_LINKED'
          )
        ),
        original_source_type varchar(48) NULL,
        original_source_id uuid NULL,
        original_business_reference varchar(160) NULL,
        original_provider_reference varchar(160) NULL,
        original_currency char(3) NOT NULL DEFAULT 'NGN' CHECK (original_currency ~ '^[A-Z]{3}$'),
        original_gross_minor numeric(20,0) NULL,
        original_provider_fee_minor numeric(20,0) NULL,
        original_net_minor numeric(20,0) NULL,
        original_customer_credit_minor numeric(20,0) NULL,
        original_internal_status varchar(64) NULL,
        original_occurred_at timestamptz NULL,
        original_journal_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        return_or_dispute_reference varchar(160) NULL,
        event_amount_minor numeric(20,0) NULL,
        event_fee_minor numeric(20,0) NOT NULL DEFAULT 0,
        provider_event_status varchar(64) NULL,
        internal_return_status varchar(64) NULL,
        provider_report_row_id uuid NULL REFERENCES settlement_report_rows(id) ON DELETE RESTRICT,
        statement_row_id uuid NULL REFERENCES settlement_report_rows(id) ON DELETE RESTRICT,
        linked_internal_dispute_id uuid NULL REFERENCES transaction_disputes(id) ON DELETE RESTRICT,
        linked_reversal_journal_id uuid NULL REFERENCES ledger_journals(id) ON DELETE RESTRICT,
        lifecycle_status varchar(48) NOT NULL CHECK (
          lifecycle_status IN (
            'AWAITING_PROVIDER_CONFIRMATION',
            'PROVIDER_CONFIRMED_UNMATCHED_INTERNAL',
            'AMOUNT_OR_FEE_VARIANCE',
            'AMBIGUOUS',
            'RECONCILED'
          )
        ),
        variance_minor numeric(20,0) NOT NULL DEFAULT 0,
        explanation varchar(600) NOT NULL,
        review_state varchar(24) NOT NULL DEFAULT 'NONE' CHECK (
          review_state IN ('NONE', 'PROPOSED', 'APPROVED', 'REJECTED')
        ),
        proposed_decision varchar(48) NULL,
        proposed_note varchar(1000) NULL,
        proposed_by varchar(160) NULL,
        proposed_at timestamptz NULL,
        reviewed_by varchar(160) NULL,
        reviewed_at timestamptz NULL,
        review_note varchar(1000) NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT chk_settlement_return_cases_scope_pair CHECK (
          (scope = 'INSTITUTION') = (institution_id IS NOT NULL)
        ),
        CONSTRAINT chk_settlement_return_cases_sod CHECK (
          reviewed_by IS NULL OR proposed_by IS NULL OR reviewed_by <> proposed_by
        )
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX uq_settlement_return_dispute_cases_key
        ON settlement_return_dispute_cases (
          COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
          case_key
        )
    `);
    await q.query(`
      CREATE INDEX idx_settlement_return_dispute_cases_scope
        ON settlement_return_dispute_cases (scope, institution_id, lifecycle_status, updated_at DESC)
    `);

    // --------------------------------------------------- 7. return/dispute events (append-only)
    await q.query(`
      CREATE TABLE settlement_return_dispute_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id uuid NOT NULL REFERENCES settlement_return_dispute_cases(id) ON DELETE RESTRICT,
        event_source varchar(32) NOT NULL CHECK (
          event_source IN (
            'INTERNAL_RECORD',
            'PROVIDER_REPORT',
            'STATEMENT_ENTRY',
            'FINANCE_PREPARER',
            'FINANCE_CONTROLLER'
          )
        ),
        event_type varchar(64) NOT NULL,
        status_label varchar(64) NOT NULL,
        amount_minor numeric(20,0) NULL,
        fee_minor numeric(20,0) NULL,
        reference varchar(160) NULL,
        actor varchar(160) NULL,
        detail varchar(600) NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        event_fingerprint char(64) NOT NULL CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
        UNIQUE (case_id, event_fingerprint)
      )
    `);
    await q.query(`
      CREATE INDEX idx_settlement_return_dispute_events_case
        ON settlement_return_dispute_events (case_id, occurred_at ASC, recorded_at ASC)
    `);

    // --------------------------------------------------- immutability & append-only triggers
    await q.query(`
      CREATE FUNCTION public.settlement_report_append_only()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'Settlement report evidence rows are append-only' USING ERRCODE = '55000';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Settlement report evidence rows are never deleted' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END $$
    `);

    for (const table of [
      'settlement_report_rejected_rows',
      'settlement_report_rows',
      'settlement_return_dispute_events',
    ]) {
      await q.query(`
        CREATE TRIGGER trg_${table}_append_only
          BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION public.settlement_report_append_only()
      `);
    }

    await q.query(`
      CREATE FUNCTION public.settlement_report_imports_guard()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Settlement report imports are never deleted' USING ERRCODE = '55000';
        END IF;
        IF OLD.scope IS DISTINCT FROM NEW.scope
           OR OLD.institution_id IS DISTINCT FROM NEW.institution_id
           OR OLD.provider_key IS DISTINCT FROM NEW.provider_key
           OR OLD.report_type IS DISTINCT FROM NEW.report_type
           OR OLD.content_sha256 IS DISTINCT FROM NEW.content_sha256
           OR OLD.total_rows IS DISTINCT FROM NEW.total_rows
           OR OLD.valid_rows IS DISTINCT FROM NEW.valid_rows
           OR OLD.rejected_rows IS DISTINCT FROM NEW.rejected_rows
           OR OLD.imported_by IS DISTINCT FROM NEW.imported_by THEN
          RAISE EXCEPTION 'Settlement report import metadata is immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END $$
    `);
    await q.query(`
      CREATE TRIGGER trg_settlement_report_imports_guard
        BEFORE UPDATE OR DELETE ON settlement_report_imports
        FOR EACH ROW EXECUTE FUNCTION public.settlement_report_imports_guard()
    `);

    await q.query(`
      CREATE FUNCTION public.settlement_reconciliation_no_delete()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Settlement reconciliation records are never deleted' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END $$
    `);
    for (const table of [
      'settlement_transaction_matches',
      'settlement_batch_reconciliations',
    ]) {
      await q.query(`
        CREATE TRIGGER trg_${table}_no_delete
          BEFORE DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION public.settlement_reconciliation_no_delete()
      `);
    }

    await q.query(`
      CREATE FUNCTION public.settlement_return_dispute_cases_guard()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Return and dispute reconciliation cases are never deleted' USING ERRCODE = '55000';
        END IF;
        -- Original transaction amounts, once captured from internal or provider evidence, may never
        -- be overwritten by subsequent refund, reversal or chargeback events.
        IF (OLD.original_gross_minor IS NOT NULL AND OLD.original_gross_minor IS DISTINCT FROM NEW.original_gross_minor)
           OR (OLD.original_provider_fee_minor IS NOT NULL AND OLD.original_provider_fee_minor IS DISTINCT FROM NEW.original_provider_fee_minor)
           OR (OLD.original_net_minor IS NOT NULL AND OLD.original_net_minor IS DISTINCT FROM NEW.original_net_minor)
           OR (OLD.original_customer_credit_minor IS NOT NULL AND OLD.original_customer_credit_minor IS DISTINCT FROM NEW.original_customer_credit_minor) THEN
          RAISE EXCEPTION 'Original transaction amounts on a return/dispute case are immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END $$
    `);
    await q.query(`
      CREATE TRIGGER trg_settlement_return_dispute_cases_guard
        BEFORE UPDATE OR DELETE ON settlement_return_dispute_cases
        FOR EACH ROW EXECUTE FUNCTION public.settlement_return_dispute_cases_guard()
    `);

    // --------------------------------------------------- database role privileges
    for (const table of [
      'settlement_report_imports',
      'settlement_report_rejected_rows',
      'settlement_report_rows',
      'settlement_transaction_matches',
      'settlement_batch_reconciliations',
      'settlement_return_dispute_cases',
      'settlement_return_dispute_events',
    ]) {
      await q.query(`REVOKE ALL ON public.${table} FROM PUBLIC`);
      await q.query(`GRANT SELECT ON public.${table} TO monienaija_authority_core`);
    }
    for (const appendOnlyTable of [
      'settlement_report_rejected_rows',
      'settlement_report_rows',
      'settlement_return_dispute_events',
    ]) {
      await q.query(`GRANT SELECT, INSERT ON public.${appendOnlyTable} TO monienaija_runtime`);
      await q.query(
        `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.${appendOnlyTable} FROM monienaija_runtime`,
      );
    }
    for (const updatableTable of [
      'settlement_report_imports',
      'settlement_transaction_matches',
      'settlement_batch_reconciliations',
      'settlement_return_dispute_cases',
    ]) {
      await q.query(
        `GRANT SELECT, INSERT, UPDATE ON public.${updatableTable} TO monienaija_runtime`,
      );
      await q.query(
        `REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.${updatableTable} FROM monienaija_runtime`,
      );
    }
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Refusing to remove settlement report reconciliation history: it is financial audit evidence',
      ),
    );
  }
}
