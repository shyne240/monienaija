/**
 * A7T10 — A7 product data minimization types.
 *
 * The A7 product data minimization contract is the runtime read-only
 * product data minimization, classification, consent, retention,
 * legal-hold, secret, disclosure, support-trace, and partner-payload
 * validation contract for the A7 first product (`VIRTUAL_ACCOUNT`
 * v1). The A7 product data minimization contract reuses (without
 * modification) the A6T10 data classification, consent, retention,
 * legal-hold, secret, disclosure, support-trace, and partner-payload
 * validation authorities, the A1 `CustomerPreference` intent
 * authority, the A2 authorization context, the A3
 * customer-to-financial-account binding, the A4 product-policy
 * decision, the A7 product catalog (A7T02), the A7 product-policy
 * profile (A7T03), the A7 product customer-binding map (A7T04), the
 * A7 product command/operation identity (A7T05), the A7 product
 * notification delivery (A7T06), the A7 product lifecycle (A7T07),
 * the A7 product financial effect (A7T08), the A7 product
 * reconciliation (A7T09), and the shared Operations audit,
 * idempotency, outbox, metrics, and diagnostics services.
 *
 * The A7 product data minimization contract is a read-only contract.
 * The A7 product data minimization contract does NOT introduce a
 * second data classification, consent, retention, legal-hold, secret,
 * disclosure, support-trace, partner-payload validation, audit,
 * idempotency, outbox, metrics, diagnostics, customer-binding,
 * policy, authorization, or notification authority, or a new product
 * identity, or a new product financial identity.
 */

import type { RequestContext } from '../production/request-context';
import type {
  ExternalConsentView,
  ExternalDataClassificationView,
  ExternalDataControlAuditContext,
  ExternalDisclosureView,
  ExternalLegalHoldView,
  ExternalPartnerPayloadValidation,
  ExternalRetentionView,
  ExternalSecretClassificationView,
  ExternalSupportTraceView,
} from '../partner/external-data-minimization.types';
import type {
  ExternalConsentSource,
  ExternalConsentStatus,
  ExternalDataControlAction,
  ExternalDataHandlingLevel,
  ExternalDataMinimizationRejectionCode,
  ExternalDisclosureAudience,
  ExternalLegalHoldAuthority,
  ExternalLegalHoldScope,
  ExternalSecretCategory,
} from '../partner/external-data-minimization.enums';

/**
 * A7 product data minimization product key (the A7 product catalog
 * first product key; the A7 product data minimization contract reuses
 * the A7 product catalog product key).
 */
export type A7ProductDataMinimizationProductKey = 'VIRTUAL_ACCOUNT';

/**
 * A7 product data minimization data handling level (reused from the
 * A6T10 data handling level vocabulary).
 */
export type A7ProductDataMinimizationLevel = ExternalDataHandlingLevel;

/**
 * A7 product data minimization disclosure audience (reused from the
 * A6T10 disclosure audience vocabulary).
 */
export type A7ProductDataMinimizationAudience = ExternalDisclosureAudience;

/**
 * A7 product data minimization field vocabulary (frozen; the A7
 * first product's data-field inventory). Each field is classified
 * against the A6T10 data classification registry.
 */
export type A7ProductDataMinimizationFieldName =
  // Product operation (A7T05)
  | 'a7.productOperationReference'
  | 'a7.productOperationId'
  | 'a7.productKey'
  | 'a7.productVersion'
  | 'a7.productCapabilityKey'
  | 'a7.productAction'
  | 'a7.productState'
  | 'a7.productOperationState'
  | 'a7.productOperationOutcome'
  | 'a7.productCommandReference'
  | 'a7.productLifecycleReference'
  | 'a7.productCustomerBindingMapReference'
  | 'a7.productFinancialEffectReference'
  | 'a7.a6ExternalOperationReference'
  | 'a7.a5LedgerJournalId'
  | 'a7.a6T08SettlementId'
  | 'a7.a6T08SuspenseId'
  | 'a7.a6ProviderReferenceId'
  | 'a7.a6CallbackReceiptId'
  // Customer / wallet (A3; A7T04)
  | 'a7.customerId'
  | 'a7.customerWalletId'
  | 'a7.bindingId'
  | 'a7.bindingVersion'
  // Amount / currency / accounting unit
  | 'a7.amountMinor'
  | 'a7.currency'
  | 'a7.accountingUnit'
  // Policy (A4; A7T03)
  | 'a7.a4ProductPolicyDecisionReference'
  | 'a7.a2AuthorizationContextReference'
  // Notification (A7T06)
  | 'a7.notificationDispatchId'
  | 'a7.notificationChannel'
  | 'a7.notificationAudience'
  // Reconciliation (A7T09)
  | 'a7.reconciliationReference'
  | 'a7.supportTraceReference'
  | 'a7.certificationReference'
  | 'a7.handoffReference';

/**
 * A7 product data minimization field classification entry (the A7
 * product data-field inventory entry registered with the A6T10 data
 * classification registry). The A7 product data minimization field
 * classification entry is consumed by the A6T10 data classification
 * registry through the A6T10 consumer boundary.
 */
export interface A7ProductDataMinimizationFieldClassification {
  readonly fieldName: A7ProductDataMinimizationFieldName;
  readonly level: A7ProductDataMinimizationLevel;
  readonly sourceDomain: string;
  readonly owner: string;
  readonly secretCategory: ExternalSecretCategory | null;
  readonly retentionDays: number;
  readonly holdSupport: boolean;
}

/**
 * A7 product data minimization consent assertion (read-only; the A7
 * product consent assertion is sourced from the A6T10 consent
 * record; the A7 product data minimization contract does NOT
 * introduce a new consent authority).
 */
export interface A7ProductDataMinimizationConsentAssertionV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly customerId: string;
  readonly source: ExternalConsentSource;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly grantedBy: string;
  readonly revocable: boolean;
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly status: ExternalConsentStatus;
  readonly mandateReference: string;
  readonly mandateVersion: number;
  readonly consentReference: string | null;
  readonly recordedAt: string;
}

/**
 * A7 product data minimization legal-hold record (read-only; the
 * A7 product legal-hold record is sourced from the A6T10 legal-hold
 * authority).
 */
export interface A7ProductDataMinimizationLegalHoldV1 {
  readonly holdId: string | null;
  readonly scope: ExternalLegalHoldScope;
  readonly referenceId: string;
  readonly owner: string;
  readonly authority: ExternalLegalHoldAuthority;
  readonly reason: string;
  readonly imposedAt: string | null;
  readonly imposedBy: string | null;
  readonly releasedAt: string | null;
  readonly releasedBy: string | null;
  readonly notes: string | null;
  readonly active: boolean;
}

/**
 * A7 product data minimization partner-payload validation result
 * (read-only; the A7 product partner-payload validation result is
 * sourced from the A6T10 partner-payload validation authority).
 */
export interface A7ProductDataMinimizationPartnerPayloadValidationV1 {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly valid: boolean;
  readonly rejectedFields: readonly { readonly field: string; readonly reason: string }[];
  readonly missingFields: readonly string[];
  readonly recommendedFields: readonly string[];
  readonly auditRecorded: boolean;
  readonly rejectionCodes: readonly ExternalDataMinimizationRejectionCode[];
}

/**
 * A7 product data minimization disclosure projection request (the
 * A7 product data minimization disclosure projection request is
 * consumed by the A6T10 disclosure projection).
 */
export interface A7ProductDataMinimizationDisclosureRequestV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly audience: A7ProductDataMinimizationAudience;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly audit: ExternalDataControlAuditContext;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization disclosure projection result (read-only;
 * the A7 product disclosure projection result is sourced from the
 * A6T10 disclosure projection; the A7 product data minimization
 * contract does NOT introduce a new disclosure authority).
 */
export interface A7ProductDataMinimizationDisclosureProjectionV1 {
  readonly disclosureReference: string;
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly audience: A7ProductDataMinimizationAudience;
  readonly projectedFields: Readonly<Record<string, unknown>>;
  readonly maskedFields: readonly string[];
  readonly audienceMaximumLevel: A7ProductDataMinimizationLevel;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * A7 product data minimization support-trace projection request (the
 * A7 product support-trace projection request is consumed by the
 * A6T10 support-trace projection).
 */
export interface A7ProductDataMinimizationSupportTraceRequestV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly audience: A7ProductDataMinimizationAudience;
  readonly trace: Readonly<Record<string, unknown>>;
  readonly audit: ExternalDataControlAuditContext;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization support-trace projection result
 * (read-only; the A7 product support-trace projection result is
 * sourced from the A6T10 support-trace projection; the A7 product
 * data minimization contract does NOT introduce a new support-trace
 * authority).
 */
export interface A7ProductDataMinimizationSupportTraceProjectionV1 {
  readonly supportTraceReference: string;
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly audience: A7ProductDataMinimizationAudience;
  readonly projectedTrace: Readonly<Record<string, unknown>>;
  readonly maskedFields: readonly string[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * A7 product data minimization classify command (the A7 product
 * data-field classification command is consumed by the A6T10 data
 * classification registry; the A7 product data minimization contract
 * is read-only with respect to the A6T10 data classification
 * registry).
 */
export interface A7ProductDataMinimizationClassifyCommandV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly fieldName: A7ProductDataMinimizationFieldName;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization consent validation command (the A7
 * product consent validation command is consumed by the A6T10
 * consent authority; the A7 product data minimization contract is
 * read-only with respect to the A6T10 consent authority).
 */
export interface A7ProductDataMinimizationConsentCommandV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly customerId: string;
  readonly source: ExternalConsentSource;
  readonly targetId: string;
  readonly targetVersion: number;
  readonly purpose: string;
  readonly jurisdiction: string;
  readonly mandateReference: string;
  readonly mandateVersion: number;
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly grantedBy: string;
  readonly revocable: boolean;
  readonly revokedAt: string | null;
  readonly consentReference: string | null;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization retention lookup command (the A7
 * product retention lookup command is consumed by the A6T10
 * retention authority; the A7 product data minimization contract is
 * read-only with respect to the A6T10 retention authority).
 */
export interface A7ProductDataMinimizationRetentionCommandV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly dataset: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization legal-hold lookup command (the A7
 * product legal-hold lookup command is consumed by the A6T10
 * legal-hold authority; the A7 product data minimization contract
 * is read-only with respect to the A6T10 legal-hold authority).
 */
export interface A7ProductDataMinimizationLegalHoldCommandV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly scope: ExternalLegalHoldScope;
  readonly referenceId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization secret lookup command (the A7
 * product secret lookup command is consumed by the A6T10 secret
 * authority; the A7 product data minimization contract is read-only
 * with respect to the A6T10 secret authority).
 */
export interface A7ProductDataMinimizationSecretCommandV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly category: ExternalSecretCategory;
  readonly reference: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization partner-payload validation command
 * (the A7 product partner-payload validation command is consumed by
 * the A6T10 partner-payload validation authority; the A7 product
 * data minimization contract is read-only with respect to the A6T10
 * partner-payload validation authority).
 */
export interface A7ProductDataMinimizationPartnerPayloadCommandV1 {
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization batch command (the A7 product data
 * minimization batch command is consumed by the A7 product data
 * minimization service; the A7 product data minimization service
 * never mutates any A6T10 source record).
 */
export type A7ProductDataMinimizationCommandV1 =
  | ({ readonly kind: 'CLASSIFY' } & A7ProductDataMinimizationClassifyCommandV1)
  | ({ readonly kind: 'CONSENT' } & A7ProductDataMinimizationConsentCommandV1)
  | ({ readonly kind: 'RETENTION' } & A7ProductDataMinimizationRetentionCommandV1)
  | ({ readonly kind: 'LEGAL_HOLD' } & A7ProductDataMinimizationLegalHoldCommandV1)
  | ({ readonly kind: 'SECRET' } & A7ProductDataMinimizationSecretCommandV1)
  | ({ readonly kind: 'PARTNER_PAYLOAD' } & A7ProductDataMinimizationPartnerPayloadCommandV1)
  | ({ readonly kind: 'DISCLOSURE' } & A7ProductDataMinimizationDisclosureRequestV1)
  | ({ readonly kind: 'SUPPORT_TRACE' } & A7ProductDataMinimizationSupportTraceRequestV1);

/**
 * A7 product data minimization failure (read-only; the A7 product
 * data minimization failure result is sourced from the A6T10 data
 * minimization rejection authority).
 */
export interface A7ProductDataMinimizationFailureV1 {
  readonly contractName: 'A7-PRODUCT-DATA-MINIMIZATION';
  readonly contractVersion: 1;
  readonly code: string;
  readonly rejectionCode: ExternalDataMinimizationRejectionCode | null;
  readonly message: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * A7 product data minimization report (the A7 product data
 * minimization report; the A7 product data minimization report is
 * the A7 product data minimization result envelope).
 */
export interface A7ProductDataMinimizationReportV1 {
  readonly contractName: 'A7-PRODUCT-DATA-MINIMIZATION';
  readonly contractVersion: 1;
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly productOperationReference: string;
  readonly kind: A7ProductDataMinimizationCommandV1['kind'];
  readonly classificationView: ExternalDataClassificationView | null;
  readonly consentView: ExternalConsentView | null;
  readonly retentionView: ExternalRetentionView | null;
  readonly legalHoldView: ExternalLegalHoldView | null;
  readonly secretView: ExternalSecretClassificationView | null;
  readonly disclosureProjection: ExternalDisclosureView | null;
  readonly supportTraceProjection: ExternalSupportTraceView | null;
  readonly partnerPayloadValidation: ExternalPartnerPayloadValidation | null;
  readonly failure: A7ProductDataMinimizationFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly causationId: string | null;
}

/**
 * A7 product data minimization result envelope (the A7 product data
 * minimization result envelope is the A7 product data minimization
 * command result; the A7 product data minimization result envelope
 * never mutates any A6T10 source record).
 */
export type A7ProductDataMinimizationResultV1 =
  | {
      readonly valid: true;
      readonly report: A7ProductDataMinimizationReportV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductDataMinimizationFailureV1;
    };

/**
 * A7 product data minimization batch result envelope (the A7 product
 * data minimization batch result envelope; the A7 product data
 * minimization service never mutates any A6T10 source record).
 */
export interface A7ProductDataMinimizationBatchReportV1 {
  readonly contractName: 'A7-PRODUCT-DATA-MINIMIZATION';
  readonly contractVersion: 1;
  readonly batchId: string;
  readonly batchReference: string;
  readonly productKey: A7ProductDataMinimizationProductKey;
  readonly productVersion: 1;
  readonly total: number;
  readonly withFailure: number;
  readonly queryUnavailable: number;
  readonly reports: readonly A7ProductDataMinimizationReportV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

export type A7ProductDataMinimizationBatchResultV1 =
  | {
      readonly valid: true;
      readonly report: A7ProductDataMinimizationBatchReportV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductDataMinimizationFailureV1;
    };

/**
 * A6T10 data control action vocabulary (re-exported for the A7
 * product data minimization service / report).
 */
export type A7ProductDataMinimizationControlAction = ExternalDataControlAction;
