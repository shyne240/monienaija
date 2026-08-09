/**
 * A7T09 — A7 product reconciliation, certification, and support
 * trace types.
 *
 * The A7 product reconciliation contract is the runtime
 * read-only product reconciliation, certification, and
 * support-trace contract for the A7 first product
 * (`VIRTUAL_ACCOUNT` v1). The A7 product reconciliation contract
 * reuses (without modification) the A2 authorization, A3
 * customer-to-financial-account binding, A4 product-policy
 * decision, A5 Ledger / journal / line, A6T05 external-operation
 * identity, A6T07 lifecycle, A6T08 settlement / suspense /
 * compensating-entry, A6T09 external reconciliation, A6T10
 * data-classification, A6T11 integration, A7 product catalog,
 * A7 product-policy profile, A7T04 product customer-binding,
 * A7T05 product command/operation, A7T06 product notification
 * delivery, A7T07 product lifecycle, and A7T08 product financial
 * effect, and the shared Operations audit, idempotency, outbox,
 * metrics, and diagnostics services.
 *
 * The A7 product reconciliation contract is a read-only contract.
 * The A7 product reconciliation contract does NOT introduce a
 * second reconciliation engine, a second Ledger authority, a
 * second settlement authority, a second suspense authority, a
 * second compensating-entry authority, a second financial-
 * invariants engine, a second audit authority, a second
 * idempotency authority, a second outbox authority, a second
 * metrics authority, a second diagnostics authority, a second
 * customer-binding authority, a second policy authority, a
 * second authorization authority, a second notification
 * authority, a new product identity, or a new product financial
 * identity.
 */

import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';
import type {
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../partner/external-settlement.types';
import type { ExternalReconciliationReport } from '../reconciliation/external-reconciliation.types';

/**
 * The A7 product-catalog product key for the first product. The
 * A7 product reconciliation contract binds the A7 product
 * reconciliation identity to the A7 product catalog registration.
 */
export type A7ProductReconciliationProductKey = 'VIRTUAL_ACCOUNT';

/**
 * A7 product reconciliation state vocabulary.
 */
export type A7ProductReconciliationState =
  | 'FINANCIAL_EFFECT_PENDING'
  | 'FINANCIAL_EFFECT_ADMITTED'
  | 'FINANCIAL_EFFECT_SETTLEMENT_POSTED'
  | 'FINANCIAL_EFFECT_SUSPENSE_RECORDED'
  | 'FINANCIAL_EFFECT_COMPENSATING_POSTED'
  | 'FINANCIAL_EFFECT_REVERSAL_POSTED'
  | 'FINANCIAL_EFFECT_FAILED'
  | 'FINANCIAL_EFFECT_CANCELLED';

/**
 * A7 product reconciliation product state vocabulary (reused
 * from the A7T02 product catalog; the A7 product reconciliation
 * contract does not introduce a new A7 product state).
 */
export type A7ProductReconciliationProductState =
  | 'ASSIGN_REQUESTED'
  | 'ASSIGN_PENDING'
  | 'ASSIGN_ACTIVE'
  | 'ASSIGN_SUSPENDED'
  | 'ASSIGN_FAILED'
  | 'ASSIGN_CLOSED'
  | 'FUNDING_REQUESTED'
  | 'FUNDING_PENDING_VERIFICATION'
  | 'FUNDING_SETTLED'
  | 'FUNDING_UNKNOWN'
  | 'FUNDING_SUSPENDED'
  | 'FUNDING_FAILED'
  | 'FUNDING_CLOSED';

/**
 * A7 product reconciliation check status vocabulary.
 */
export type A7ProductReconciliationCheckStatus = 'OK' | 'NOT_VERIFIED' | 'FAIL';

/**
 * A7 product reconciliation severity vocabulary (re-exported for
 * the A7 product reconciliation report / trace types).
 */
export type A7ProductReconciliationSeverity = 'WARNING' | 'ERROR';

/**
 * A7 product reconciliation owner vocabulary.
 */
export type A7ProductReconciliationOwner =
  | 'RECONCILIATION'
  | 'FINANCE'
  | 'SECURITY'
  | 'PARTNER_OWNER'
  | 'WALLET'
  | 'OPERATIONS'
  | 'NOTIFICATION'
  | 'LIFECYCLE';

/**
 * A7 product reconciliation recovery state vocabulary.
 */
export type A7ProductReconciliationRecoveryState = 'NO_AUTOMATIC_REPAIR' | 'MANUAL_REVIEW_REQUIRED';

/**
 * A7 product reconciliation sensitivity vocabulary.
 */
export type A7ProductReconciliationSensitivity =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED';

/**
 * A7 product reconciliation product operation view (read-only;
 * the A7 product reconciliation service does NOT introduce a
 * parallel A7 product command authority).
 */
export interface A7ProductReconciliationProductOperationView {
  readonly productOperationId: string;
  readonly productOperationReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductReconciliationProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly outcome: string;
  readonly operationState: string;
  readonly a6ExternalOperationReference: string;
}

/**
 * A7 product reconciliation product lifecycle view (read-only;
 * the A7 product reconciliation service does NOT introduce a
 * parallel A7 product lifecycle authority).
 */
export interface A7ProductReconciliationProductLifecycleView {
  readonly productLifecycleId: string;
  readonly productLifecycleReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductReconciliationProductState;
  readonly currentLifecycleState: string;
  readonly outcome: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
}

/**
 * A7 product reconciliation product command view (read-only;
 * the A7 product reconciliation service does NOT introduce a
 * parallel A7 product command authority).
 */
export interface A7ProductReconciliationProductCommandView {
  readonly productCommandReference: string;
  readonly productOperationReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductReconciliationProductState;
  readonly operationState: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
}

/**
 * A7 product reconciliation product customer-binding view
 * (read-only; the A7 product reconciliation service does NOT
 * introduce a parallel A7 product customer-binding authority).
 */
export interface A7ProductReconciliationProductCustomerBindingView {
  readonly mapReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductReconciliationProductState;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
}

/**
 * A7 product reconciliation A2 authorization context view
 * (read-only).
 */
export interface A7ProductReconciliationA2AuthorizationContextView {
  readonly principalType: 'CUSTOMER' | 'SUPPORT' | 'OPERATOR' | 'SERVICE' | 'PRIVILEGED';
  readonly principalId: string;
  readonly customerId: string | null;
  readonly customerAccess: 'ANY' | 'OWN_ONLY' | 'NONE';
  readonly evaluatedAt: string;
  readonly allowed: boolean;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
}

/**
 * A7 product reconciliation A4 product-policy decision view
 * (read-only).
 */
export interface A7ProductReconciliationA4ProductPolicyDecisionView {
  readonly decisionReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly capability: string;
  readonly action: string;
  readonly profileReference: string;
  readonly policyVersion: string;
  readonly decision: 'ALLOW' | 'ALLOW_WITH_LIMITS' | 'PENDING_REVIEW' | 'DENY' | 'SUSPEND';
  readonly expiresAt: string | null;
  readonly reasonCodes: readonly string[];
  readonly maxAmountMinor: string | null;
}

/**
 * A7 product reconciliation A5 Ledger journal view (read-only).
 */
export interface A7ProductReconciliationA5LedgerJournalView {
  readonly journalId: string;
  readonly idempotencyKey: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly totalMinor: string;
  readonly status: string;
  readonly reference: string | null;
  readonly reversalOfJournalId: string | null;
  readonly createdAt: string;
  readonly postedAt: string;
}

/**
 * A7 product reconciliation A6T08 settlement view (read-only;
 * the A6T08 settlement service is the only settlement
 * authority). The A7 product reconciliation service consumes
 * the A6T08 settlement record through the A6T08
 * `ExternalSettlementService.getByOperation()` read-only
 * consumer boundary.
 */
export type A7ProductReconciliationA6T08SettlementView = ExternalSettlementView;

/**
 * A7 product reconciliation A6T08 suspense view (read-only;
 * the A6T08 suspense service is the only suspense authority).
 * The A7 product reconciliation service consumes the A6T08
 * suspense record through the A6T08
 * `ExternalSettlementService.getSuspenseForOperation()` read-only
 * consumer boundary.
 */
export type A7ProductReconciliationA6T08SuspenseView = ExternalSuspenseEntryView;

/**
 * A7 product reconciliation A6 external-operation view (read-only).
 */
export interface A7ProductReconciliationA6ExternalOperationView {
  readonly externalOperationId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly customerId: string;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly providerIdempotencyScope: string;
  readonly providerIdempotencyKey: string;
  readonly lifecycleState: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly replayed: boolean;
}

/**
 * A7 product reconciliation A6 callback receipt view (read-only).
 */
export interface A7ProductReconciliationA6CallbackReceiptView {
  readonly callbackReceiptId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly callbackEventId: string;
  readonly payloadHash: string;
  readonly signatureHash: string;
  readonly providerReferenceType: string;
  readonly providerReferenceNamespace: string;
  readonly providerStatus: string;
  readonly providerOccurredAt: string;
  readonly receivedAt: string;
  readonly correlationId: string;
  readonly status: string;
  readonly rejectionCode: string | null;
}

/**
 * A7 product reconciliation A6 provider reference view (read-only).
 */
export interface A7ProductReconciliationA6ProviderReferenceView {
  readonly providerReferenceId: string;
  readonly externalOperationReference: string;
  readonly partnerKey: string;
  readonly referenceType: string;
  readonly referenceValueHash: string;
  readonly referenceValue: string;
  readonly namespace: string;
  readonly source: string;
  readonly observedAt: string;
}

/**
 * A7 product reconciliation A6 partner outage view (read-only).
 */
export interface A7ProductReconciliationA6PartnerOutageView {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly state: 'OPEN' | 'HALF_OPEN' | 'CLOSED';
  readonly openedAt: string | null;
  readonly cooldownSeconds: number;
  readonly reasonCode: string | null;
}

/**
 * A7 product reconciliation A6 report availability view (read-only).
 */
export interface A7ProductReconciliationA6ReportAvailabilityView {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly lastReportAt: string | null;
  readonly fresh: boolean;
  readonly reportAvailable: boolean;
  readonly reasonCode: string | null;
}

/**
 * A7 product reconciliation A7T06 notification dispatch fact view
 * (read-only).
 */
export interface A7ProductReconciliationNotificationDispatchFactView {
  readonly notificationDispatchId: string;
  readonly productOperationReference: string;
  readonly customerId: string;
  readonly channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';
  readonly deliveryLifecycleState: string;
  readonly audience: string;
  readonly redactionApplied: boolean;
  readonly recordedAt: string;
}

/**
 * A7 product reconciliation Operations audit fact view (read-only).
 */
export interface A7ProductReconciliationOperationsAuditFactView {
  readonly auditEventId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly actor: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly recordedAt: string;
}

/**
 * A7 product reconciliation Operations idempotency record view
 * (read-only).
 */
export interface A7ProductReconciliationOperationsIdempotencyRecordView {
  readonly idempotencyRecordId: string;
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly retentionSeconds: number;
  readonly recordedAt: string;
}

/**
 * A7 product reconciliation Operations outbox fact view
 * (read-only).
 */
export interface A7ProductReconciliationOperationsOutboxFactView {
  readonly outboxEventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventKey: string;
  readonly schemaVersion: number;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly payloadHash: string;
}

/**
 * A7 product reconciliation Operations diagnostics fact view
 * (read-only).
 */
export interface A7ProductReconciliationOperationsDiagnosticsFactView {
  readonly diagnosticsEventId: string;
  readonly category: string;
  readonly severity: 'INFO' | 'WARNING' | 'ERROR';
  readonly correlationId: string;
  readonly recordedAt: string;
}

/**
 * A7 product reconciliation check (a single read-only product
 * reconciliation check).
 */
export interface A7ProductReconciliationCheck {
  readonly key: string;
  readonly status: A7ProductReconciliationCheckStatus;
  readonly message: string | null;
}

/**
 * A7 product reconciliation discrepancy (a single read-only
 * product reconciliation discrepancy).
 */
export interface A7ProductReconciliationDiscrepancy {
  readonly code: string;
  readonly severity: A7ProductReconciliationSeverity;
  readonly owner: A7ProductReconciliationOwner;
  readonly recoveryState: A7ProductReconciliationRecoveryState;
  readonly productOperationReference: string | null;
  readonly a6ExternalOperationReference: string | null;
  readonly a6T08SettlementId: string | null;
  readonly a6T08SuspenseId: string | null;
  readonly a5LedgerJournalId: string | null;
  readonly a6ProviderReferenceId: string | null;
  readonly a6CallbackReceiptId: string | null;
  readonly notificationDispatchId: string | null;
  readonly scopeValue: string | null;
  readonly message: string;
}

/**
 * A7 product reconciliation command (read-only; the A7 product
 * reconciliation command is supplied by the A7 product
 * command / lifecycle / financial-effect boundary or by an
 * A2-protected internal control surface).
 */
export interface A7ProductReconciliationCommandV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly a6ExternalOperationReference: string | null;
  readonly a6T08SettlementId: string | null;
  readonly a6T08SuspenseId: string | null;
  readonly a5LedgerJournalId: string | null;
  readonly a6ProviderReferenceId: string | null;
  readonly a6CallbackReceiptId: string | null;
  readonly includeSupportTrace: boolean;
  readonly includeCertificationEvidence: boolean;
  readonly certificationCase:
    | 'CERT_HAPPY_PATH'
    | 'CERT_REJECTION'
    | 'CERT_DUPLICATE'
    | 'CERT_CALLBACK_REPLAY'
    | 'CERT_DELAYED_REPORT'
    | 'CERT_OUTAGE'
    | 'CERT_TIMEOUT'
    | 'CERT_SETTLEMENT_MISMATCH'
    | 'CERT_SUSPENSE'
    | 'CERT_ROLLBACK'
    | null;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product reconciliation product financial effect summary
 * (the read-only product financial effect summary block inside
 * the A7 product reconciliation report).
 */
export interface A7ProductReconciliationProductFinancialEffectSummaryV1 {
  readonly productFinancialEffectReference: string;
  readonly a5LedgerJournalId: string | null;
  readonly currentState: string;
  readonly outcome: string;
  readonly category: string;
  readonly a6T08Decision: string;
}

/**
 * A7 product reconciliation product fact (the read-only product
 * fact block inside the A7 product reconciliation report).
 */
export interface A7ProductReconciliationProductFactV1 {
  readonly productOperation: A7ProductReconciliationProductOperationView | null;
  readonly productLifecycle: A7ProductReconciliationProductLifecycleView | null;
  readonly productCommand: A7ProductReconciliationProductCommandView | null;
  readonly productCustomerBinding: A7ProductReconciliationProductCustomerBindingView | null;
  readonly productFinancialEffect: A7ProductReconciliationProductFinancialEffectSummaryV1 | null;
}

/**
 * A7 product reconciliation authority fact (the read-only
 * authority fact block inside the A7 product reconciliation
 * report).
 */
export interface A7ProductReconciliationAuthorityFactV1 {
  readonly a2AuthorizationContext: A7ProductReconciliationA2AuthorizationContextView | null;
  readonly a4ProductPolicyDecision: A7ProductReconciliationA4ProductPolicyDecisionView | null;
  readonly a5LedgerJournal: A7ProductReconciliationA5LedgerJournalView | null;
  readonly a6ExternalOperation: A7ProductReconciliationA6ExternalOperationView | null;
  readonly a6CallbackReceipt: A7ProductReconciliationA6CallbackReceiptView | null;
  readonly a6T08Settlement: ExternalSettlementView | null;
  readonly a6T08Suspense: ExternalSuspenseEntryView[];
  readonly a6ProviderReference: A7ProductReconciliationA6ProviderReferenceView | null;
  readonly a6PartnerOutage: A7ProductReconciliationA6PartnerOutageView | null;
  readonly a6ReportAvailability: A7ProductReconciliationA6ReportAvailabilityView | null;
}

/**
 * A7 product reconciliation notification fact (the read-only
 * notification fact block inside the A7 product reconciliation
 * report).
 */
export interface A7ProductReconciliationNotificationFactV1 {
  readonly notificationDispatch: A7ProductReconciliationNotificationDispatchFactView | null;
}

/**
 * A7 product reconciliation Operations fact (the read-only
 * Operations fact block inside the A7 product reconciliation
 * report).
 */
export interface A7ProductReconciliationOperationsFactV1 {
  readonly audit: A7ProductReconciliationOperationsAuditFactView[];
  readonly idempotency: A7ProductReconciliationOperationsIdempotencyRecordView[];
  readonly outbox: A7ProductReconciliationOperationsOutboxFactView[];
  readonly diagnostics: A7ProductReconciliationOperationsDiagnosticsFactView[];
}

/**
 * A7 product reconciliation support trace (the read-only A7
 * product reconciliation support trace, classified for the A1
 * data classification, retention, legal-hold, and support-access
 * controls).
 */
export interface A7ProductReconciliationSupportTraceV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly supportTraceReference: string;
  readonly productOperationReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly customerId: string;
  readonly a6ExternalOperationReference: string | null;
  readonly a6T08SettlementId: string | null;
  readonly a6T08SuspenseId: string | null;
  readonly a5LedgerJournalId: string | null;
  readonly a6ProviderReferenceId: string | null;
  readonly a6CallbackReceiptId: string | null;
  readonly auditEventIds: readonly string[];
  readonly outboxEventIds: readonly string[];
  readonly idempotencyRecordIds: readonly string[];
  readonly diagnosticsEventIds: readonly string[];
  readonly sensitivity: A7ProductReconciliationSensitivity;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly causationId: string | null;
}

/**
 * A7 product reconciliation certification evidence (the
 * read-only A7 product certification evidence block inside the
 * A7 product reconciliation report).
 */
export interface A7ProductReconciliationCertificationEvidenceV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly certificationReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly productVersion: 1;
  readonly certificationCase:
    | 'CERT_HAPPY_PATH'
    | 'CERT_REJECTION'
    | 'CERT_DUPLICATE'
    | 'CERT_CALLBACK_REPLAY'
    | 'CERT_DELAYED_REPORT'
    | 'CERT_OUTAGE'
    | 'CERT_TIMEOUT'
    | 'CERT_SETTLEMENT_MISMATCH'
    | 'CERT_SUSPENSE'
    | 'CERT_ROLLBACK';
  readonly handoffReference: string;
  readonly a6PartnerCertificationReference: string | null;
  readonly discrepancyCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly recordedAt: string;
  readonly correlationId: string;
}

/**
 * A7 product reconciliation handoff (the read-only A7 product
 * reconciliation handoff, support-traceable, A2-protected
 * internal control surface).
 */
export interface A7ProductReconciliationHandoffV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly handoffScope: 'a7-product-reconciliation-handoff.v1';
  readonly productOperationReference: string;
  readonly a6ExternalOperationReference: string | null;
  readonly a6T08SettlementId: string | null;
  readonly a6T08SuspenseId: string | null;
  readonly a5LedgerJournalId: string | null;
  readonly a6ProviderReferenceId: string | null;
  readonly a6CallbackReceiptId: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly causationId: string | null;
}

/**
 * A7 product reconciliation report (the read-only A7 product
 * reconciliation report; the A7 product reconciliation service
 * does NOT mutate source records and does NOT auto-repair).
 */
export interface A7ProductReconciliationReportV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly reconciliationId: string;
  readonly reconciliationReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly productLifecycleReference: string | null;
  readonly productCommandReference: string | null;
  readonly productCustomerBindingMapReference: string | null;
  readonly a2AuthorizationContextReference: string | null;
  readonly a4ProductPolicyDecisionReference: string | null;
  readonly a5LedgerJournalReference: string | null;
  readonly a6ExternalOperationReference: string | null;
  readonly a6CallbackReceiptReference: string | null;
  readonly a6T08SettlementReference: string | null;
  readonly a6T08SuspenseReference: string | null;
  readonly a6ProviderReferenceReference: string | null;
  readonly checks: readonly A7ProductReconciliationCheck[];
  readonly discrepancies: readonly A7ProductReconciliationDiscrepancy[];
  readonly a6T09ExternalReconciliationReference: string | null;
  readonly a6T09ExternalReconciliationDiscrepancyCount: number | null;
  readonly productFact: A7ProductReconciliationProductFactV1;
  readonly authorityFact: A7ProductReconciliationAuthorityFactV1;
  readonly notificationFact: A7ProductReconciliationNotificationFactV1;
  readonly operationsFact: A7ProductReconciliationOperationsFactV1;
  readonly supportTrace: A7ProductReconciliationSupportTraceV1 | null;
  readonly certificationEvidence: A7ProductReconciliationCertificationEvidenceV1 | null;
  readonly handoff: A7ProductReconciliationHandoffV1;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly causationId: string | null;
  readonly queryUnavailable: boolean;
}

/**
 * A7 product reconciliation batch report (the read-only A7
 * product reconciliation batch report).
 */
export interface A7ProductReconciliationBatchReportV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly batchId: string;
  readonly batchReference: string;
  readonly productKey: A7ProductReconciliationProductKey;
  readonly total: number;
  readonly withDiscrepancies: number;
  readonly withErrors: number;
  readonly withWarnings: number;
  readonly queryUnavailable: number;
  readonly reports: readonly A7ProductReconciliationReportV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * A7 product reconciliation failure (read-only; the A7 product
 * reconciliation service does NOT mutate source records on
 * failure).
 */
export interface A7ProductReconciliationFailureV1 {
  readonly contractName: 'A7-PRODUCT-RECONCILIATION';
  readonly contractVersion: 1;
  readonly code:
    | 'A7_PRODUCT_RECONCILIATION_QUERY_UNAVAILABLE'
    | 'A7_PRODUCT_RECONCILIATION_INVALID_COMMAND'
    | 'A7_PRODUCT_RECONCILIATION_DISCREPANCY_DETECTED';
  readonly message: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * A7 product reconciliation result (the read-only A7 product
 * reconciliation result envelope; the A7 product reconciliation
 * result envelope does NOT mutate source records).
 */
export type A7ProductReconciliationResultV1 =
  | {
      readonly valid: true;
      readonly report: A7ProductReconciliationReportV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductReconciliationFailureV1;
    };

/**
 * A7 product reconciliation batch result (the read-only A7
 * product reconciliation batch result envelope).
 */
export type A7ProductReconciliationBatchResultV1 =
  | {
      readonly valid: true;
      readonly report: A7ProductReconciliationBatchReportV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductReconciliationFailureV1;
    };

/**
 * A7 product reconciliation A6T09 external reconciliation
 * snapshot (the read-only A6T09 external reconciliation
 * snapshot, sourced from the A6T09 external reconciliation
 * authority).
 */
export interface A7ProductReconciliationA6T09ExternalReconciliationSnapshot {
  readonly a6T09ExternalReconciliationReference: string;
  readonly discrepancyCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly report: ExternalReconciliationReport | null;
}

/**
 * A7 product reconciliation consumer ports (the read-only
 * consumer port boundary). The A7 product reconciliation
 * consumer ports re-use the existing A2 / A3 / A4 / A5 / A6 /
 * A7 / Operations authorities through their approved
 * read-only consumer boundaries. The A7 product reconciliation
 * consumer ports do NOT introduce a second audit, idempotency,
 * outbox, metrics, or diagnostics authority.
 */
export interface A7ProductReconciliationConsumerPorts {
  /**
   * Data source for the REPEATABLE READ, read-only transaction
   * boundary. The A7 product reconciliation service uses the
   * data source only to open a read-only transaction. The A7
   * product reconciliation service does NOT write through the
   * data source.
   */
  readonly getDataSource: () => {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ) => Promise<T>;
  };

  /**
   * A7T05 product command consumer (read-only; the A7T05
   * product command service is the only A7T05 product
   * command authority).
   */
  /**
   * A7T05 product command consumer (read-only; the A7T05
   * product command service is the only A7T05 product
   * command authority). The A7 product reconciliation
   * service reads the A7T05 product command record through
   * the shared Operations `IdempotencyService` `responseBody`
   * read-only consumer boundary.
   */
  readonly a7T05ProductCommandLookup: (
    productCommandReference: string,
  ) => Promise<A7ProductReconciliationProductCommandView | null>;

  /**
   * A7T07 product lifecycle consumer (read-only; the A7T07
   * product lifecycle service is the only A7T07 product
   * lifecycle authority). The A7 product reconciliation
   * service reads the A7T07 product lifecycle record through
   * the shared Operations `IdempotencyService` `responseBody`
   * read-only consumer boundary.
   */
  readonly a7T07ProductLifecycleLookup: (
    productLifecycleReference: string,
  ) => Promise<A7ProductReconciliationProductLifecycleView | null>;

  /**
   * A7T08 product financial effect consumer (read-only; the
   * A7T08 product financial effect service is the only A7T08
   * product financial effect authority). The A7 product
   * reconciliation service reads the A7T08 product financial
   * effect record through the shared Operations
   * `IdempotencyService` `responseBody` read-only consumer
   * boundary.
   */
  readonly a7T08ProductFinancialEffectLookup: (productOperationReference: string) => Promise<{
    readonly journalId: string | null;
    readonly productOperationReference: string;
  } | null>;

  /**
   * A7T06 product notification delivery consumer (read-only;
   * the A7T06 product notification delivery service is the
   * only A7T06 product notification delivery authority). The
   * A7 product reconciliation service reads the A7T06
   * product notification delivery record through the shared
   * Operations `IdempotencyService` `responseBody` read-only
   * consumer boundary.
   */
  readonly a7T06NotificationDeliveryLookup: (
    productOperationReference: string,
  ) => Promise<{ readonly notificationDispatchId: string | null } | null>;

  /**
   * A7T04 product customer-binding map consumer (read-only;
   * the A7T04 product customer-binding service is the only
   * A7T04 product customer-binding authority). The A7 product
   * reconciliation service reads the A7T04 product
   * customer-binding map through the shared Operations
   * `IdempotencyService` `responseBody` read-only consumer
   * boundary.
   */
  readonly a7T04ProductCustomerBindingMapReferenceCheck: (
    mapReference: string,
  ) => Promise<A7ProductReconciliationProductCustomerBindingView | null>;

  /**
   * A2 authorization context consumer (read-only).
   */
  readonly a2AuthorizationContextLookup: (
    authorizationContextReference: string,
  ) => Promise<A7ProductReconciliationA2AuthorizationContextView | null>;

  /**
   * A4 product-policy decision consumer (read-only).
   */
  readonly a4ProductPolicyDecisionLookup: (
    decisionReference: string,
  ) => Promise<A7ProductReconciliationA4ProductPolicyDecisionView | null>;

  /**
   * A5 Ledger journal consumer (read-only).
   */
  readonly a5LedgerJournalLookup: (
    journalId: string,
  ) => Promise<A7ProductReconciliationA5LedgerJournalView | null>;

  /**
   * A6T05 external-operation consumer (read-only).
   */
  readonly a6ExternalOperationLookup: (
    externalOperationReference: string,
  ) => Promise<A7ProductReconciliationA6ExternalOperationView | null>;

  /**
   * A6T05 external-operation lookup by reference (read-only).
   */
  readonly a6ExternalOperationLookupByReference: (
    externalOperationReference: string,
  ) => Promise<{ readonly externalOperationId: string } | null>;

  /**
   * A6 callback receipt consumer (read-only).
   */
  readonly a6CallbackReceiptLookup: (
    callbackReceiptId: string,
  ) => Promise<A7ProductReconciliationA6CallbackReceiptView | null>;

  /**
   * A6 provider reference consumer (read-only).
   */
  readonly a6ProviderReferenceLookup: (
    providerReferenceId: string,
  ) => Promise<A7ProductReconciliationA6ProviderReferenceView | null>;

  /**
   * A6 partner outage consumer (read-only).
   */
  readonly a6PartnerOutageLookup: (
    partnerKey: string,
    capabilityKey: string,
  ) => Promise<A7ProductReconciliationA6PartnerOutageView>;

  /**
   * A6 report availability consumer (read-only).
   */
  readonly a6ReportAvailabilityLookup: (
    partnerKey: string,
    capabilityKey: string,
  ) => Promise<A7ProductReconciliationA6ReportAvailabilityView>;

  /**
   * A6T08 settlement consumer (read-only).
   */
  readonly a6T08SettlementLookup: (
    externalOperationReference: string,
  ) => Promise<ExternalSettlementView | null>;

  /**
   * A6T08 suspense consumer (read-only).
   */
  readonly a6T08SuspenseLookup: (
    externalOperationReference: string,
  ) => Promise<ExternalSuspenseEntryView[] | null>;

  /**
   * A6T09 external reconciliation consumer (read-only; the
   * A6T09 external reconciliation service is the only A6T09
   * external reconciliation authority).
   */
  readonly a6T09ExternalReconciliationLookup: (
    externalOperationId: string,
    generatedAt: string,
  ) => Promise<A7ProductReconciliationA6T09ExternalReconciliationSnapshot | null>;

  /**
   * Shared Operations audit consumer (read-only).
   */
  readonly operationsAuditLookup: (
    entityType: string,
    entityId: string,
  ) => Promise<A7ProductReconciliationOperationsAuditFactView[]>;

  /**
   * Shared Operations idempotency consumer (read-only).
   */
  readonly operationsIdempotencyLookup: (
    scope: string,
    key: string,
  ) => Promise<A7ProductReconciliationOperationsIdempotencyRecordView | null>;

  /**
   * Shared Operations outbox consumer (read-only).
   */
  readonly operationsOutboxLookup: (
    aggregateType: string,
    aggregateId: string,
  ) => Promise<A7ProductReconciliationOperationsOutboxFactView[]>;

  /**
   * Shared Operations diagnostics consumer (read-only).
   */
  readonly operationsDiagnosticsLookup: (
    category: string,
    correlationId: string,
  ) => Promise<A7ProductReconciliationOperationsDiagnosticsFactView[]>;
}
