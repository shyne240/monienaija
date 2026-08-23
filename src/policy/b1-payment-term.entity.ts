import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import type { B1InvoiceV1 } from './b1-billing-engine.types';
import type { B1PaymentTermApplicabilityV1 } from './b1-payment-term.types';

@Entity({ name: 'b1_payment_terms' })
@Index('uq_b1_payment_terms_reference_version', ['paymentTermReference', 'paymentTermVersion'], {
  unique: true,
})
@Index('idx_b1_payment_terms_status_effective', ['status', 'effectiveFrom', 'effectiveTo'])
@Index('idx_b1_payment_terms_definition_hash', ['definitionHash'])
@Check(
  'chk_b1_payment_terms_basis_value',
  "term_basis='ELAPSED_DAYS' AND term_value BETWEEN 0 AND 3660",
)
@Check('chk_b1_payment_terms_status', "status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','REVOKED')")
@Check(
  'chk_b1_payment_terms_scope',
  "currency='NGN' AND accounting_unit='CUSTOMER_FUNDS' AND commercial_scope_key='commercial.virtual-account.inbound-funding' AND commercial_scope_version=1",
)
@Check('chk_b1_payment_terms_dates', 'effective_to IS NULL OR effective_to > effective_from')
@Check('chk_b1_payment_terms_hash', "definition_hash ~ '^[a-f0-9]{64}$'")
export class B1PaymentTerm {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'payment_term_reference', type: 'varchar', length: 180 })
  paymentTermReference!: string;
  @Column({ name: 'payment_term_version', type: 'integer' }) paymentTermVersion!: number;
  @Column({ name: 'term_basis', type: 'varchar', length: 32 }) termBasis!: 'ELAPSED_DAYS';
  @Column({ name: 'term_value', type: 'integer' }) termValue!: number;
  @Column({ name: 'definition_hash', type: 'char', length: 64 }) definitionHash!: string;
  @Column({ name: 'effective_from', type: 'timestamptz' }) effectiveFrom!: Date;
  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true }) effectiveTo!: Date | null;
  @Column({ type: 'varchar', length: 3 }) currency!: 'NGN';
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: 'CUSTOMER_FUNDS';
  @Column({ name: 'commercial_scope_key', type: 'varchar', length: 180 })
  commercialScopeKey!: 'commercial.virtual-account.inbound-funding';
  @Column({ name: 'commercial_scope_version', type: 'integer' }) commercialScopeVersion!: 1;
  @Column({ type: 'jsonb' }) applicability!: B1PaymentTermApplicabilityV1;
  @Column({ type: 'varchar', length: 24 }) status!:
    | 'DRAFT'
    | 'PENDING_APPROVAL'
    | 'ACTIVE'
    | 'REVOKED';
  @Column({ name: 'idempotency_scope', type: 'varchar', length: 120 })
  idempotencyScope!: 'b1.payment-term.definition.idempotency.v1';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 }) idempotencyKey!: string;
  @Column({ name: 'created_by', type: 'varchar', length: 160 }) createdBy!: string;
  @Column({ name: 'approved_by', type: 'varchar', length: 160, nullable: true }) approvedBy!:
    | string
    | null;
  @Column({ name: 'approval_id', type: 'uuid', nullable: true }) approvalId!: string | null;
  @Column({ name: 'last_reason', type: 'varchar', length: 500, nullable: true }) lastReason!:
    | string
    | null;
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 }) correlationId!: string;
  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true }) causationId!:
    | string
    | null;
  @VersionColumn({ name: 'record_version', type: 'integer', default: 1 }) recordVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'b1_invoice_payment_term_bindings' })
@Index('uq_b1_invoice_term_binding_reference', ['bindingReference'], { unique: true })
@Index('uq_b1_invoice_term_binding_invoice', ['invoiceReference', 'invoiceVersion'], {
  unique: true,
})
@Index('idx_b1_invoice_term_binding_hash', ['bindingHash'])
@Index('idx_b1_invoice_term_binding_term', ['paymentTermReference', 'paymentTermVersion'])
@Check(
  'chk_b1_invoice_term_binding_hashes',
  "binding_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$' AND invoice_hash ~ '^[a-f0-9]{64}$' AND payment_term_definition_hash ~ '^[a-f0-9]{64}$' AND due_date_calculation_hash ~ '^[a-f0-9]{64}$'",
)
@Check(
  'chk_b1_invoice_term_binding_scope',
  "invoice_version=1 AND term_basis='ELAPSED_DAYS' AND term_value BETWEEN 0 AND 3660 AND currency='NGN' AND accounting_unit='CUSTOMER_FUNDS'",
)
export class B1InvoicePaymentTermBinding {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'binding_reference', type: 'varchar', length: 180 }) bindingReference!: string;
  @Column({ name: 'binding_hash', type: 'char', length: 64 }) bindingHash!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @Column({ name: 'invoice_reference', type: 'varchar', length: 200 }) invoiceReference!: string;
  @Column({ name: 'invoice_version', type: 'integer' }) invoiceVersion!: 1;
  @Column({ name: 'invoice_hash', type: 'char', length: 64 }) invoiceHash!: string;
  @Column({ name: 'issued_at', type: 'timestamptz' }) issuedAt!: Date;
  @Column({ name: 'payment_term_reference', type: 'varchar', length: 180 })
  paymentTermReference!: string;
  @Column({ name: 'payment_term_version', type: 'integer' }) paymentTermVersion!: number;
  @Column({ name: 'payment_term_definition_hash', type: 'char', length: 64 })
  paymentTermDefinitionHash!: string;
  @Column({ name: 'term_basis', type: 'varchar', length: 32 }) termBasis!: 'ELAPSED_DAYS';
  @Column({ name: 'term_value', type: 'integer' }) termValue!: number;
  @Column({ name: 'due_at', type: 'timestamptz' }) dueAt!: Date;
  @Column({ name: 'due_date_calculation_hash', type: 'char', length: 64 })
  dueDateCalculationHash!: string;
  @Column({ type: 'varchar', length: 3 }) currency!: 'NGN';
  @Column({ name: 'accounting_unit', type: 'varchar', length: 64 })
  accountingUnit!: 'CUSTOMER_FUNDS';
  @Column({ name: 'effective_at', type: 'timestamptz' }) effectiveAt!: Date;
  @Column({ type: 'jsonb' }) applicability!: B1PaymentTermApplicabilityV1;
  @Column({ name: 'invoice_record', type: 'jsonb' }) invoiceRecord!: B1InvoiceV1;
  @Column({ name: 'idempotency_scope', type: 'varchar', length: 120 })
  idempotencyScope!: 'b1.payment-term.invoice-binding.idempotency.v1';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 }) idempotencyKey!: string;
  @Column({ name: 'created_by', type: 'varchar', length: 160 }) createdBy!: string;
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 }) correlationId!: string;
  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true }) causationId!:
    | string
    | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'b1_due_date_amendments' })
@Index('uq_b1_due_date_amendment_reference', ['amendmentReference'], { unique: true })
@Index('uq_b1_due_date_amendment_sequence', ['originalBindingReference', 'sequence'], {
  unique: true,
})
@Index('idx_b1_due_date_amendment_binding', ['originalBindingReference', 'effectiveAt'])
@Check('chk_b1_due_date_amendment_value', 'replacement_elapsed_days BETWEEN 0 AND 3660')
@Check(
  'chk_b1_due_date_amendment_hashes',
  "amendment_hash ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$' AND original_binding_hash ~ '^[a-f0-9]{64}$' AND supersedes_evidence_hash ~ '^[a-f0-9]{64}$'",
)
export class B1DueDateAmendment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'amendment_reference', type: 'varchar', length: 180 })
  amendmentReference!: string;
  @Column({ name: 'amendment_hash', type: 'char', length: 64 }) amendmentHash!: string;
  @Column({ name: 'request_hash', type: 'char', length: 64 }) requestHash!: string;
  @Column({ name: 'original_binding_reference', type: 'varchar', length: 180 })
  originalBindingReference!: string;
  @Column({ name: 'original_binding_hash', type: 'char', length: 64 }) originalBindingHash!: string;
  @Column({ name: 'original_issued_at', type: 'timestamptz' }) originalIssuedAt!: Date;
  @Column({ name: 'original_due_at', type: 'timestamptz' }) originalDueAt!: Date;
  @Column({ name: 'replacement_elapsed_days', type: 'integer' }) replacementElapsedDays!: number;
  @Column({ name: 'replacement_due_at', type: 'timestamptz' }) replacementDueAt!: Date;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ name: 'effective_at', type: 'timestamptz' }) effectiveAt!: Date;
  @Column({ name: 'supersedes_evidence_reference', type: 'varchar', length: 180 })
  supersedesEvidenceReference!: string;
  @Column({ name: 'supersedes_evidence_hash', type: 'char', length: 64 })
  supersedesEvidenceHash!: string;
  @Column({ type: 'integer' }) sequence!: number;
  @Column({ name: 'approval_id', type: 'uuid' }) approvalId!: string;
  @Column({ name: 'approved_by', type: 'varchar', length: 160 }) approvedBy!: string;
  @Column({ name: 'idempotency_scope', type: 'varchar', length: 120 })
  idempotencyScope!: 'b1.payment-term.due-date-amendment.idempotency.v1';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 }) idempotencyKey!: string;
  @Column({ name: 'created_by', type: 'varchar', length: 160 }) createdBy!: string;
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 }) correlationId!: string;
  @Column({ name: 'causation_id', type: 'varchar', length: 255, nullable: true }) causationId!:
    | string
    | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
