import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateB1PaymentTermTables1785753600051 implements MigrationInterface {
  name = 'CreateB1PaymentTermTables1785753600051';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE b1_payment_terms (
      id UUID PRIMARY KEY, payment_term_reference VARCHAR(180) NOT NULL, payment_term_version INTEGER NOT NULL,
      term_basis VARCHAR(32) NOT NULL, term_value INTEGER NOT NULL, definition_hash CHAR(64) NOT NULL,
      effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ, currency VARCHAR(3) NOT NULL,
      accounting_unit VARCHAR(64) NOT NULL, commercial_scope_key VARCHAR(180) NOT NULL, commercial_scope_version INTEGER NOT NULL,
      applicability JSONB NOT NULL, status VARCHAR(24) NOT NULL, idempotency_scope VARCHAR(120) NOT NULL,
      idempotency_key VARCHAR(255) NOT NULL, created_by VARCHAR(160) NOT NULL, approved_by VARCHAR(160), approval_id UUID,
      last_reason VARCHAR(500), correlation_id VARCHAR(255) NOT NULL, causation_id VARCHAR(255), record_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_b1_payment_terms_reference_version UNIQUE(payment_term_reference,payment_term_version),
      CONSTRAINT chk_b1_payment_terms_basis_value CHECK(term_basis='ELAPSED_DAYS' AND term_value BETWEEN 0 AND 3660),
      CONSTRAINT chk_b1_payment_terms_status CHECK(status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','REVOKED')),
      CONSTRAINT chk_b1_payment_terms_scope CHECK(currency='NGN' AND accounting_unit='CUSTOMER_FUNDS' AND commercial_scope_key='commercial.virtual-account.inbound-funding' AND commercial_scope_version=1),
      CONSTRAINT chk_b1_payment_terms_dates CHECK(effective_to IS NULL OR effective_to > effective_from),
      CONSTRAINT chk_b1_payment_terms_hash CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_b1_payment_terms_idempotency CHECK(idempotency_scope='b1.payment-term.definition.idempotency.v1')
    )`);
    await q.query(
      `CREATE INDEX idx_b1_payment_terms_status_effective ON b1_payment_terms(status,effective_from,effective_to)`,
    );
    await q.query(
      `CREATE INDEX idx_b1_payment_terms_definition_hash ON b1_payment_terms(definition_hash)`,
    );
    await q.query(`CREATE TABLE b1_invoice_payment_term_bindings (
      id UUID PRIMARY KEY, binding_reference VARCHAR(180) NOT NULL UNIQUE, binding_hash CHAR(64) NOT NULL, request_hash CHAR(64) NOT NULL,
      invoice_reference VARCHAR(200) NOT NULL, invoice_version INTEGER NOT NULL, invoice_hash CHAR(64) NOT NULL, issued_at TIMESTAMPTZ NOT NULL,
      payment_term_reference VARCHAR(180) NOT NULL, payment_term_version INTEGER NOT NULL, payment_term_definition_hash CHAR(64) NOT NULL,
      term_basis VARCHAR(32) NOT NULL, term_value INTEGER NOT NULL, due_at TIMESTAMPTZ NOT NULL, due_date_calculation_hash CHAR(64) NOT NULL,
      currency VARCHAR(3) NOT NULL, accounting_unit VARCHAR(64) NOT NULL, effective_at TIMESTAMPTZ NOT NULL, applicability JSONB NOT NULL,
      invoice_record JSONB NOT NULL, idempotency_scope VARCHAR(120) NOT NULL, idempotency_key VARCHAR(255) NOT NULL,
      created_by VARCHAR(160) NOT NULL, correlation_id VARCHAR(255) NOT NULL, causation_id VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_b1_invoice_term_binding_invoice UNIQUE(invoice_reference,invoice_version),
      CONSTRAINT fk_b1_invoice_term_binding_invoice FOREIGN KEY(invoice_reference,invoice_version) REFERENCES b1_billing_documents(document_reference,document_version) ON DELETE RESTRICT,
      CONSTRAINT fk_b1_invoice_term_binding_term FOREIGN KEY(payment_term_reference,payment_term_version) REFERENCES b1_payment_terms(payment_term_reference,payment_term_version) ON DELETE RESTRICT,
      CONSTRAINT chk_b1_invoice_term_binding_hashes CHECK(binding_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$' AND invoice_hash ~ '^[a-f0-9]{64}$' AND payment_term_definition_hash ~ '^[a-f0-9]{64}$' AND due_date_calculation_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_b1_invoice_term_binding_scope CHECK(invoice_version=1 AND term_basis='ELAPSED_DAYS' AND term_value BETWEEN 0 AND 3660 AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'),
      CONSTRAINT chk_b1_invoice_term_binding_idempotency CHECK(idempotency_scope='b1.payment-term.invoice-binding.idempotency.v1')
    )`);
    await q.query(
      `CREATE INDEX idx_b1_invoice_term_binding_hash ON b1_invoice_payment_term_bindings(binding_hash)`,
    );
    await q.query(
      `CREATE INDEX idx_b1_invoice_term_binding_term ON b1_invoice_payment_term_bindings(payment_term_reference,payment_term_version)`,
    );
    await q.query(`CREATE TABLE b1_due_date_amendments (
      id UUID PRIMARY KEY, amendment_reference VARCHAR(180) NOT NULL UNIQUE, amendment_hash CHAR(64) NOT NULL, request_hash CHAR(64) NOT NULL,
      original_binding_reference VARCHAR(180) NOT NULL, original_binding_hash CHAR(64) NOT NULL, original_issued_at TIMESTAMPTZ NOT NULL,
      original_due_at TIMESTAMPTZ NOT NULL, replacement_elapsed_days INTEGER NOT NULL, replacement_due_at TIMESTAMPTZ NOT NULL,
      reason VARCHAR(500) NOT NULL, effective_at TIMESTAMPTZ NOT NULL, supersedes_evidence_reference VARCHAR(180) NOT NULL,
      supersedes_evidence_hash CHAR(64) NOT NULL, sequence INTEGER NOT NULL, approval_id UUID NOT NULL, approved_by VARCHAR(160) NOT NULL,
      idempotency_scope VARCHAR(120) NOT NULL, idempotency_key VARCHAR(255) NOT NULL, created_by VARCHAR(160) NOT NULL,
      correlation_id VARCHAR(255) NOT NULL, causation_id VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT uq_b1_due_date_amendment_sequence UNIQUE(original_binding_reference,sequence),
      CONSTRAINT fk_b1_due_date_amendment_binding FOREIGN KEY(original_binding_reference) REFERENCES b1_invoice_payment_term_bindings(binding_reference) ON DELETE RESTRICT,
      CONSTRAINT fk_b1_due_date_amendment_approval FOREIGN KEY(approval_id) REFERENCES privileged_action_approvals(id) ON DELETE RESTRICT,
      CONSTRAINT chk_b1_due_date_amendment_value CHECK(replacement_elapsed_days BETWEEN 0 AND 3660),
      CONSTRAINT chk_b1_due_date_amendment_hashes CHECK(amendment_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$' AND original_binding_hash ~ '^[a-f0-9]{64}$' AND supersedes_evidence_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_b1_due_date_amendment_idempotency CHECK(idempotency_scope='b1.payment-term.due-date-amendment.idempotency.v1')
    )`);
    await q.query(
      `CREATE INDEX idx_b1_due_date_amendment_binding ON b1_due_date_amendments(original_binding_reference,effective_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS b1_due_date_amendments`);
    await q.query(`DROP TABLE IF EXISTS b1_invoice_payment_term_bindings`);
    await q.query(`DROP TABLE IF EXISTS b1_payment_terms`);
  }
}
