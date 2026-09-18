import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';
import type { B1InvoiceRequestV1, B1InvoiceV1 } from './b1-billing-engine.types';

export type B1PaymentTermBasisV1 = 'ELAPSED_DAYS';
export type B1PaymentTermStatusV1 = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type B1VersionedApplicabilityDimensionV1 = Readonly<{ key: string; version: number }> | null;
export interface B1PaymentTermApplicabilityV1 {
  readonly capability: B1VersionedApplicabilityDimensionV1;
  readonly plan: B1VersionedApplicabilityDimensionV1;
  readonly subscription: B1VersionedApplicabilityDimensionV1;
  readonly product: B1VersionedApplicabilityDimensionV1;
  readonly customer: string | null;
  readonly merchant: string | null;
  readonly partner: string | null;
}
export interface B1PaymentTermCreateCommandV1 {
  readonly paymentTermReference: string;
  readonly paymentTermVersion: number;
  readonly termBasis: B1PaymentTermBasisV1;
  readonly termValue: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly applicability: B1PaymentTermApplicabilityV1;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string | null;
  readonly now?: Date;
}
export interface B1PaymentTermLifecycleCommandV1 {
  readonly paymentTermReference: string;
  readonly paymentTermVersion: number;
  readonly expectedRecordVersion: number;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly reason: string;
  readonly approvalId?: string;
  readonly activationActorPrincipalId?: string;
  readonly now?: Date;
}
export interface B1PaymentTermViewV1 {
  readonly id: string;
  readonly paymentTermReference: string;
  readonly paymentTermVersion: number;
  readonly termBasis: 'ELAPSED_DAYS';
  readonly termValue: number;
  readonly definitionHash: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly commercialScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly commercialScopeVersion: 1;
  readonly applicability: B1PaymentTermApplicabilityV1;
  readonly status: B1PaymentTermStatusV1;
  readonly persistedStatus: Exclude<B1PaymentTermStatusV1, 'EXPIRED'>;
  readonly idempotencyScope: 'b1.payment-term.definition.idempotency.v1';
  readonly createdBy: string;
  readonly approvedBy: string | null;
  readonly approvalId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface B1PaymentTermResultV1 {
  readonly outcome: 'CREATED' | 'UPDATED' | 'REPLAYED' | 'REJECTED';
  readonly term: B1PaymentTermViewV1 | null;
  readonly replayed: boolean;
  readonly failure: Readonly<{ code: string; message: string }> | null;
}
export interface B1InvoicePaymentTermBindingCommandV1 {
  readonly invoiceRequest: B1InvoiceRequestV1;
  readonly paymentTermReference: string;
  readonly paymentTermVersion: number;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string | null;
  readonly now?: Date;
}
export interface B1InvoicePaymentTermBindingViewV1 {
  readonly id: string;
  readonly bindingReference: string;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly invoiceReference: string;
  readonly invoiceVersion: 1;
  readonly invoiceHash: string;
  readonly issuedAt: string;
  readonly paymentTermReference: string;
  readonly paymentTermVersion: number;
  readonly paymentTermDefinitionHash: string;
  readonly termBasis: 'ELAPSED_DAYS';
  readonly termValue: number;
  readonly dueAt: string;
  readonly dueDateCalculationHash: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly effectiveAt: string;
  readonly applicability: B1PaymentTermApplicabilityV1;
  readonly invoice: B1InvoiceV1;
  readonly idempotencyScope: 'b1.payment-term.invoice-binding.idempotency.v1';
  readonly idempotencyKey: string;
  readonly createdBy: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly createdAt: string;
}
export interface B1InvoicePaymentTermBindingResultV1 {
  readonly outcome: 'BOUND' | 'REPLAYED' | 'REJECTED';
  readonly binding: B1InvoicePaymentTermBindingViewV1 | null;
  readonly replayed: boolean;
  readonly failure: Readonly<{ code: string; message: string }> | null;
}
export interface B1DueDateAmendmentCommandV1 {
  readonly bindingReference: string;
  readonly supersedesEvidenceReference: string;
  readonly expectedEvidenceHash: string;
  readonly replacementElapsedDays: number;
  readonly reason: string;
  readonly effectiveAt: string;
  readonly idempotencyKey: string;
  readonly approvalId: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string | null;
  readonly now?: Date;
}
export interface B1DueDateAmendmentViewV1 {
  readonly id: string;
  readonly amendmentReference: string;
  readonly amendmentHash: string;
  readonly requestHash: string;
  readonly originalBindingReference: string;
  readonly originalBindingHash: string;
  readonly originalIssuedAt: string;
  readonly originalDueAt: string;
  readonly replacementElapsedDays: number;
  readonly replacementDueAt: string;
  readonly reason: string;
  readonly effectiveAt: string;
  readonly supersedesEvidenceReference: string;
  readonly supersedesEvidenceHash: string;
  readonly sequence: number;
  readonly approvalId: string;
  readonly approvedBy: string;
  readonly idempotencyScope: 'b1.payment-term.due-date-amendment.idempotency.v1';
  readonly idempotencyKey: string;
  readonly createdBy: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly createdAt: string;
}
export interface B1DueDateAmendmentResultV1 {
  readonly outcome: 'AMENDED' | 'REPLAYED' | 'REJECTED';
  readonly amendment: B1DueDateAmendmentViewV1 | null;
  readonly replayed: boolean;
  readonly failure: Readonly<{ code: string; message: string }> | null;
}
export interface B1InvoicePaymentTermEvidenceV1 {
  readonly contractName: 'B1-PAYMENT-TERM';
  readonly contractVersion: 1;
  readonly readOnly: true;
  readonly invoice: B1InvoiceV1;
  readonly term: B1PaymentTermViewV1;
  readonly binding: B1InvoicePaymentTermBindingViewV1;
  readonly amendments: readonly B1DueDateAmendmentViewV1[];
  readonly effectiveEvidenceReference: string;
  readonly effectiveEvidenceHash: string;
  readonly effectiveDueAt: string;
  readonly supersessionStatus: 'ORIGINAL' | 'AMENDED';
  readonly verifiedAt: string;
}
export interface B1PaymentTermConsumerPortsV1 {
  readonly contractName: 'B1-PAYMENT-TERM';
  readonly contractVersion: 1;
  readonly getInvoicePaymentTermEvidence: (
    invoiceReference: string,
    invoiceVersion?: 1,
    at?: Date,
  ) => Promise<B1InvoicePaymentTermEvidenceV1 | null>;
}
