/**
 * A7T03 — A7 product-policy types.
 *
 * The A7 product-policy contract reuses A4 types end-to-end. The A7
 * product-policy types below are thin A7-side wrappers that bind an A4
 * decision / re-evaluation / replay result to the A7 product-catalog
 * product key, the A7 product-state vocabulary, and the A6 partner
 * reference.
 *
 * No new A4 type is introduced. No A4 record is mutated. No A4 source,
 * A2 principal, A3 binding, A6 partner reference, A7 product state,
 * A7 notification, A7 public surface, or A8 work is exposed through
 * these types.
 */

import type {
  PolicyAuthorizationPort,
  PolicyAuditPort,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
  PolicyIdempotencyPort,
} from './capability-policy.types';
import type { PolicyHistoricalReplayResult } from './capability-policy-historical-replay.service';
import type {
  PolicyReevaluationRequest,
  PolicyReevaluationResult,
} from './capability-policy-recovery.types';

/**
 * The A7 product-catalog product key for the first product. The A7 product
 * catalog (per `docs/A7-PRODUCT-CATALOG-CONTRACT.md`) freezes the A7
 * first product as `VIRTUAL_ACCOUNT` v1. The A7 product-policy service
 * binds an A4 product-policy decision / re-evaluation / replay result
 * to the A7 product key.
 */
export type A7ProductPolicyProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A4 decision vocabulary (reused) for the A7 product-policy contract.
 * The A7 product-policy service does not introduce a new decision state.
 */
export type A7ProductPolicyDecision = PolicyDecisionResult['decision'];

/**
 * The A4 re-evaluation trigger (reused) for the A7 product-policy
 * contract. The A7 first product's default trigger is `SOURCE_CHANGED`.
 */
export type A7ProductPolicyReevaluationTrigger = PolicyReevaluationRequest['trigger'];

/**
 * A frozen A7 product-policy profile registration. The A7 product-policy
 * contract does not introduce a new A4 capability-policy profile shape;
 * it composes a frozen A4 `CapabilityPolicyProfile` together with the
 * A7 product key, the A4 capability/action, the A4 policy version, the
 * A4 profile version, the A4 definition hash, the A4 re-evaluation
 * trigger, the A4 limit dimensions, the A4 product-eligibility
 * requirements, and the A4 obligation template codes.
 */
export interface A7ProductPolicyProfileRegistration {
  readonly productKey: A7ProductPolicyProductKey;
  readonly capability: string;
  readonly action: string;
  readonly profileReference: string;
  readonly profileVersion: number;
  readonly policyVersion: string;
  readonly definitionHash: string;
  readonly reevaluationTrigger: A7ProductPolicyReevaluationTrigger;
  readonly limitDimensions: readonly string[];
  readonly obligationCodes: readonly string[];
}

/**
 * A7 product-policy evaluation command. The A7 product-policy service
 * delegates to the A4 `CapabilityPolicyEvaluationService.evaluate()`;
 * the A7 command is a thin A7-side wrapper that binds the A4 evaluation
 * command to the A7 product key, the A7 product state, and the A6
 * partner reference.
 */
export interface A7ProductPolicyEvaluationCommand {
  readonly evaluation: PolicyEvaluationCommand;
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly partnerReference: string | null;
}

/**
 * A7 product-policy evaluation result. The A7 product-policy service
 * returns the A4 `PolicyDecisionResult` together with the A7 product
 * key, the A7 product state, the A4 product-policy obligation codes,
 * the A4 product-limit output, and the A4 reason codes.
 */
export interface A7ProductPolicyEvaluationResult {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly decision: PolicyDecisionResult;
  readonly obligationCodes: readonly string[];
  readonly limitOutputs: PolicyDecisionResult['limits'];
  readonly reasonCodes: readonly string[];
}

/**
 * A7 product-policy re-evaluation command. The A7 product-policy service
 * delegates to the A4 `CapabilityPolicyRecoveryService.reevaluate()`;
 * the A7 command is a thin A7-side wrapper that binds the A4
 * re-evaluation request to the A7 product key and the A7 product state.
 */
export interface A7ProductPolicyReevaluationCommand {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly request: PolicyReevaluationRequest;
}

/**
 * A7 product-policy re-evaluation result. The A7 product-policy service
 * returns the A4 `PolicyReevaluationResult` together with the A7 product
 * key, the A7 product state, and the A4 re-evaluation reference.
 */
export interface A7ProductPolicyReevaluationResult {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly reevaluationReference: string;
  readonly result: PolicyReevaluationResult;
}

/**
 * A7 product-policy historical replay command. The A7 product-policy service
 * delegates to the A4 `CapabilityPolicyHistoricalReplayService.replay()`;
 * the A7 command is a thin A7-side wrapper that binds the A4
 * historical-replay call to the A7 product key and the A4 decision
 * reference.
 */
export interface A7ProductPolicyReplayCommand {
  readonly productKey: A7ProductPolicyProductKey;
  readonly decisionReference: string;
  readonly command: PolicyEvaluationCommand;
}

/**
 * A7 product-policy historical replay result. The A7 product-policy
 * service returns the A4 `PolicyHistoricalReplayResult` together with the
 * A7 product key.
 */
export interface A7ProductPolicyReplayResult {
  readonly productKey: A7ProductPolicyProductKey;
  readonly result: PolicyHistoricalReplayResult;
}

/**
 * A7 product-policy audit context. The A7 product-policy service
 * records the A4 audit fact through the A4 `TypeOrmPolicyAuditAdapter`
 * and adds the A7 product key, the A7 product state, the A6 partner
 * reference, and the A4 obligation codes as A4 audit metadata.
 */
export interface A7ProductPolicyAuditContext {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly partnerReference: string | null;
  readonly obligationCodes: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly decision: PolicyDecisionResult;
}

/**
 * A7 product-policy product-level evidence. The A7 product-policy
 * service records the A4 evidence item through the A4 audit and
 * snapshot contracts. No new A4 evidence class is introduced; the A4
 * `PolicySourceClass` enum is reused.
 */
export interface A7ProductPolicyProductLevelEvidence {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly sourceClass: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly sourceVersion: string | number | null;
  readonly sourceUpdatedAt: string | null;
  readonly observedAt: string;
  readonly classification: string;
  readonly normalizedValue: Readonly<Record<string, unknown>>;
  readonly sourceReference: string | null;
  readonly productReference: string;
}

/**
 * A7 product-policy re-evaluation trigger shape. The A7 product-policy
 * service reuses the A4 `PolicyReevaluationTrigger` enum; the A7
 * trigger is the A4 trigger with the A7 product-level context
 * attached.
 */
export interface A7ProductPolicyReevaluationTriggerShape {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly trigger: A7ProductPolicyReevaluationTrigger;
  readonly reevaluationReference: string;
  readonly previousDecisionReference: string | null;
  readonly idempotencyKey: string;
}

/**
 * A7 product-policy persistence contract. The A7 product-policy
 * service reuses the A4 `TypeOrmPolicyProfileVersionRepository`;
 * the A7 contract is a thin A7-side wrapper that binds the A4
 * persistence call to the A7 product key.
 */
export interface A7ProductPolicyPersistenceContract {
  readonly productKey: A7ProductPolicyProductKey;
  readonly profileReference: string;
  readonly policyVersion: string;
  readonly profileVersion: number;
  readonly definitionHash: string;
  readonly lifecycleState: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'REJECTED' | 'ABANDONED';
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdBy: string;
}

/**
 * A7 product-policy auditor (reuses the A4 `PolicyAuditPort`).
 */
export type A7ProductPolicyAuditor = PolicyAuditPort;

/**
 * A7 product-policy authorizer (reuses the A4 `PolicyAuthorizationPort`).
 */
export type A7ProductPolicyAuthorizer = PolicyAuthorizationPort;

/**
 * A7 product-policy idempotency port (reuses the A4 `PolicyIdempotencyPort`).
 */
export type A7ProductPolicyIdempotencyPort = PolicyIdempotencyPort;

/**
 * A7 product-policy evidence snapshot (reuses the A4 `PolicyEvidenceSnapshot`).
 */
export type A7ProductPolicyEvidenceSnapshot = PolicyEvidenceSnapshot;

/**
 * A7 product-policy evidence item (reuses the A4 `PolicyEvidenceItem`).
 */
export type A7ProductPolicyEvidenceItem = PolicyEvidenceItem;

/**
 * A7T04 — A7 product customer-binding types.
 *
 * The A7 product customer-binding contract is a read-only consumer of
 * the A3 binding authority, the existing `virtual-account` module
 * (compatibility input), the A6 partner boundary, the A4 product-policy
 * decision, the A2 authorization context, and the A7 product catalog.
 * The A7 product customer-binding contract does not mutate any source
 * record and does not introduce a new customer-binding, partner,
 * policy, authorization, or notification authority.
 */

/**
 * The A7 product-catalog product key for the first product. The A7
 * product customer-binding service binds the A3 binding tuple and the
 * A6 partner reference to the A7 product key.
 */
export type A7ProductCustomerBindingProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A7 product customer-binding state vocabulary. The A7 product
 * customer-binding service consumes the A7T02 frozen first-product
 * capability-level lifecycle state set. A7T04 does not introduce a
 * new product state.
 */
export type A7ProductCustomerBindingState =
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
 * A6 partner identity for the A7 product customer-binding handoff. The
 * A6 partner is the only partner-identity authority.
 */
export interface A7ProductCustomerBindingA6PartnerIdentity {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly environment: 'sandbox' | 'production';
}

/**
 * A6 partner reference for the A7 product customer-binding handoff. The
 * A6 partner reference is supplied by the A6 boundary; the A7 product
 * customer-binding service MUST NOT synthesize it.
 */
export interface A7ProductCustomerBindingA6PartnerReference {
  readonly referenceType: string;
  readonly value: string;
  readonly namespace: string;
  readonly observedAt: string;
  readonly source: 'ACKNOWLEDGEMENT' | 'STATUS_QUERY' | 'CALLBACK' | 'STATEMENT' | 'REPORT';
}

/**
 * A6 partner reference for the A7 product customer-binding handoff. The
 * A6 partner reference is supplied by the A6 boundary; the A7 product
 * customer-binding service MUST NOT synthesize it.
 */
export type A7ProductCustomerBindingA6Reference = A7ProductCustomerBindingA6PartnerReference | null;

/**
 * A6 partner correlation context for the A7 product customer-binding
 * handoff.
 */
export interface A7ProductCustomerBindingA6PartnerCorrelation {
  readonly partnerKey: string;
  readonly capabilityKey: string;
  readonly operationType: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId: string | null;
  readonly externalOperationId: string | null;
  readonly a6CallbackReceiptId: string | null;
  readonly a6SettlementId: string | null;
}

/**
 * A7 product customer-binding command (the read-only consumer-boundary
 * command). The command is supplied by the A7 product command boundary
 * (A7T05). The A7 product customer-binding service does not write any
 * record.
 */
export interface A7ProductCustomerBindingCommand {
  readonly contractName: 'A7-PRODUCT-CUSTOMER-BINDING';
  readonly contractVersion: 1;

  readonly productKey: A7ProductCustomerBindingProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCustomerBindingState;

  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;

  readonly virtualAccount: {
    readonly virtualAccountId: string;
    readonly provider: string;
    readonly accountNumber: string;
    readonly accountName: string;
    readonly bankCode: string;
  };

  readonly a6PartnerIdentity: A7ProductCustomerBindingA6PartnerIdentity;
  readonly a6PartnerCorrelation: A7ProductCustomerBindingA6PartnerCorrelation;
  readonly a6PartnerReference: A7ProductCustomerBindingA6Reference;

  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;

  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';

  readonly idempotencyKey: string;
}

/**
 * A3 binding tuple recheck shape (the read-only A3 consumer boundary).
 * The A7 product customer-binding service consumes the A3 binding tuple
 * through the A3 `validateActiveBinding` consumer boundary.
 */
export interface A7ProductCustomerBindingA3BindingRecheck {
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly expectedCurrency: 'NGN';
  readonly expectedAccountingUnit: 'CUSTOMER_FUNDS';
  readonly expectedBindingVersion: number | null;
}

/**
 * A3 binding recheck outcome. The A7 product customer-binding service
 * fails closed for any non-`valid: true` outcome.
 */
export type A7ProductCustomerBindingA3RecheckOutcome =
  | {
      readonly valid: true;
      readonly bindingId: string;
      readonly customerId: string;
      readonly customerWalletId: string;
      readonly walletAccountId: string;
      readonly ledgerAccountId: string;
      readonly bindingVersion: number;
      readonly currency: 'NGN';
      readonly accountingUnit: 'CUSTOMER_FUNDS';
      readonly customerVersion: number;
      readonly customerWalletVersion: number;
    }
  | {
      readonly valid: false;
      readonly code: string;
      readonly message: string;
    };

/**
 * Virtual-account ownership evidence shape (the read-only `VirtualAccount`
 * consumer boundary). The A7 product customer-binding service consumes
 * the existing `VirtualAccount` row through the existing
 * `VirtualAccountService` consumer boundary.
 */
export interface A7ProductCustomerBindingVirtualAccountEvidence {
  readonly virtualAccountId: string;
  readonly walletId: string;
  readonly bankCode: string;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly provider: string;
  readonly status: 'ACTIVE' | 'DEACTIVATED';
  readonly reference: string;
  readonly assignedAt: string;
  readonly deactivatedAt: string | null;
}

/**
 * A4 product-policy decision reference shape (the read-only A4
 * consumer boundary). The A7 product customer-binding service consumes
 * the A4 product-policy decision reference through the A4
 * `CapabilityPolicyEvaluationService` consumer boundary.
 */
export interface A7ProductCustomerBindingA4ProductPolicyDecision {
  readonly decisionReference: string;
  readonly productKey: A7ProductPolicyProductKey;
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
 * A2 authorization context reference shape (the read-only A2 consumer
 * boundary). The A7 product customer-binding service consumes the A2
 * authorization context reference through the A2 `AuthorizationService`
 * consumer boundary.
 */
export interface A7ProductCustomerBindingA2AuthorizationContext {
  readonly principalType: 'CUSTOMER' | 'SUPPORT' | 'OPERATOR' | 'SERVICE' | 'PRIVILEGED';
  readonly principalId: string;
  readonly customerAccess: 'NONE' | 'SELF' | 'ASSIGNED' | 'ANY';
  readonly evaluatedAt: string;
  readonly allowed: boolean;
}

/**
 * A6T04 funding-target consumer shape (the read-only A6T04 consumer
 * boundary). The A7 product customer-binding service consumes the A6T04
 * funding-target evidence through the A6T04 `ExternalFundingTargetMappingService`
 * consumer boundary.
 */
export interface A7ProductCustomerBindingA6T04FundingTargetEvidence {
  readonly source: 'CUSTOMER_BENEFICIARY' | 'FUNDING_INSTRUMENT';
  readonly targetId: string;
  readonly targetVersion: number;
  readonly institutionCode: string;
  readonly targetCurrency: 'NGN' | null;
  readonly consentReference: string;
  readonly consentVersion: number;
  readonly consentGrantedAt: string;
  readonly consentExpiresAt: string;
  readonly consentGrantedBy: string;
  readonly consentPurpose: 'OUTBOUND_BANK_SETTLEMENT';
  readonly verificationReference: string;
}

/**
 * Bank directory entry shape (the read-only bank-directory consumer
 * boundary). The A7 product customer-binding service consumes the
 * bank directory through the existing `BankService` consumer boundary.
 */
export interface A7ProductCustomerBindingBankDirectoryEntry {
  readonly bankCode: string;
  readonly bankName: string;
  readonly shortName: string;
  readonly nipSupported: boolean;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

/**
 * A7 product customer-binding ownership check shape.
 */
export interface A7ProductCustomerBindingOwnershipCheck {
  readonly virtualAccountOwnerMatchesBinding: boolean;
  readonly fundingTargetOwnerMatchesBinding: boolean;
  readonly bankDirectorySupported: boolean;
  readonly consentCurrent: boolean;
  readonly mandateCurrent: boolean;
  readonly purposeCompatible: boolean;
  readonly currencyCompatible: boolean;
  readonly limitCompatible: boolean;
}

/**
 * A7 product customer-binding map shape. The A7 product customer-binding
 * service produces a single, frozen, deterministic, in-memory A7
 * product customer-binding map. The map is consumed by A7T05 (product
 * command identity), A7T07 (product lifecycle), A7T08 (product
 * financial effect), and A7T09 (product reconciliation).
 */
export interface A7ProductCustomerBindingMapV1 {
  readonly contractName: 'A7-PRODUCT-CUSTOMER-BINDING';
  readonly contractVersion: 1;
  readonly mapName: 'A7-PRODUCT-CUSTOMER-BINDING';
  readonly mapVersion: 1;
  readonly mapReference: string;
  readonly productKey: A7ProductCustomerBindingProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCustomerBindingState;

  readonly customer: {
    readonly customerId: string;
    readonly customerWalletId: string;
    readonly customerVersion: number;
    readonly customerWalletVersion: number;
  };

  readonly a3Binding: {
    readonly bindingId: string;
    readonly bindingVersion: number;
    readonly bindingState: 'ACTIVE';
    readonly currency: 'NGN';
    readonly accountingUnit: 'CUSTOMER_FUNDS';
  };

  readonly internalAccount: {
    readonly walletAccountId: string;
    readonly ledgerAccountId: string;
    readonly walletStatus: 'ACTIVE';
    readonly ledgerIsActive: true;
    readonly ledgerAccountType: 'LIABILITY';
    readonly ledgerNormalBalance: 'CREDIT';
    readonly ledgerAllowNegativeBalance: false;
    readonly currency: 'NGN';
    readonly accountingUnit: 'CUSTOMER_FUNDS';
  };

  readonly virtualAccount: {
    readonly virtualAccountId: string;
    readonly provider: string;
    readonly accountNumber: string;
    readonly accountName: string;
    readonly bankCode: string;
    readonly reference: string;
    readonly status: 'ACTIVE';
    readonly assignedAt: string;
    readonly deactivatedAt: null;
    readonly ownerCustomerWalletId: string;
    readonly ownerCustomerId: string;
  };

  readonly a6PartnerIdentity: A7ProductCustomerBindingA6PartnerIdentity;
  readonly a6PartnerCorrelation: A7ProductCustomerBindingA6PartnerCorrelation;
  readonly a6PartnerReference: A7ProductCustomerBindingA6Reference;

  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;

  readonly ownership: A7ProductCustomerBindingOwnershipCheck;

  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * A7 product customer-binding verification failure shape. The A7
 * product customer-binding service returns a deterministic
 * verification failure for any missing, stale, revoked, blocked,
 * expired, mismatched, or unavailable evidence.
 */
export interface A7ProductCustomerBindingVerificationFailureV1 {
  readonly contractName: 'A7-PRODUCT-CUSTOMER-BINDING';
  readonly contractVersion: 1;
  readonly mapName: 'A7-PRODUCT-CUSTOMER-BINDING';
  readonly mapVersion: 1;
  readonly productKey: A7ProductCustomerBindingProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCustomerBindingState;
  readonly code: string;
  readonly message: string;
  readonly checks: {
    readonly a3Binding: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly virtualAccount: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6PartnerReference: 'OK' | 'FAIL' | 'NOT_VERIFIED' | 'NOT_APPLICABLE';
    readonly a4ProductPolicyDecision: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a2AuthorizationContext: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly a6T04FundingTarget: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly bankDirectory: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly consent: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly purpose: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly currency: 'OK' | 'FAIL' | 'NOT_VERIFIED';
    readonly limit: 'OK' | 'FAIL' | 'NOT_VERIFIED' | 'NOT_APPLICABLE';
  };
  readonly correlationId: string;
  readonly requestId: string;
  readonly createdAt: string;
}

/**
 * A7 product customer-binding handoff token shape. The A7 product
 * customer-binding service issues a single-use, bounded-validity,
 * A2-protected internal control surface handoff token. The handoff
 * token carries only the safe A3 binding tuple, the safe `VirtualAccount`
 * reference, the A6 partner identity, the A6 partner reference, the
 * A4 product-policy decision reference, the A2 authorization context
 * reference, and the request context. The handoff token MUST NOT carry
 * raw credentials, signatures, private keys, or unrestricted customer
 * data.
 */
export interface A7ProductCustomerBindingHandoffTokenV1 {
  readonly contractName: 'A7-PRODUCT-CUSTOMER-BINDING';
  readonly contractVersion: 1;
  readonly tokenReference: string;
  readonly handoffScope: 'a7-product-customer-binding-handoff.v1';
  readonly productKey: A7ProductCustomerBindingProductKey;
  readonly productVersion: 1;
  readonly capabilityKey: string;
  readonly action: string;
  readonly productState: A7ProductCustomerBindingState;
  readonly mapReference: string;
  readonly customerId: string;
  readonly customerWalletId: string;
  readonly bindingId: string;
  readonly bindingVersion: number;
  readonly walletAccountId: string;
  readonly ledgerAccountId: string;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly virtualAccountReference: string;
  readonly virtualAccountIdentifierHash: string;
  readonly virtualAccountProvider: string;
  readonly virtualAccountBankCode: string;
  readonly virtualAccountAssignedAt: string;
  readonly a6PartnerIdentity: A7ProductCustomerBindingA6PartnerIdentity;
  readonly a6PartnerReference: A7ProductCustomerBindingA6Reference;
  readonly a4ProductPolicyDecisionReference: string;
  readonly a2AuthorizationContextReference: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly requestId: string;
}

/**
 * A7 product customer-binding result shape. The A7 product
 * customer-binding service returns a single, frozen, in-memory result.
 * The result is consumed by A7T05 (product command identity), A7T07
 * (product lifecycle), A7T08 (product financial effect), and A7T09
 * (product reconciliation).
 */
export type A7ProductCustomerBindingResult =
  | {
      readonly valid: true;
      readonly map: A7ProductCustomerBindingMapV1;
    }
  | {
      readonly valid: false;
      readonly failure: A7ProductCustomerBindingVerificationFailureV1;
    };

/**
 * A7 product customer-binding consumer ports. The A7 product
 * customer-binding service consumes the canonical A3 binding authority,
 * the existing `VirtualAccount` module, the A6 partner boundary, the
 * A4 product-policy decision, the A2 authorization context, the A6T04
 * funding-target consumer, the bank directory, the A7 product catalog,
 * and the shared Operations audit / outbox / idempotency. The A7
 * product customer-binding service does not introduce a parallel
 * authority.
 */
export interface A7ProductCustomerBindingConsumerPorts {
  /**
   * A3 binding recheck consumer. The A3 binding service remains the
   * only A3 binding authority. The A7 product customer-binding service
   * consumes the A3 binding tuple through the A3 `validateActiveBinding`
   * consumer boundary. The A7 product customer-binding service does
   * not write any A3 binding record.
   */
  readonly a3BindingRecheck: (
    recheck: A7ProductCustomerBindingA3BindingRecheck,
  ) => Promise<A7ProductCustomerBindingA3RecheckOutcome>;

  /**
   * Existing `VirtualAccount` consumer. The existing `virtual-account`
   * module remains the only `VirtualAccount` authority. The A7 product
   * customer-binding service consumes the existing `VirtualAccount` row
   * through the existing `VirtualAccountService.get()` consumer
   * boundary. The A7 product customer-binding service does not write
   * any `VirtualAccount` record.
   */
  readonly virtualAccountLookup: (
    virtualAccountId: string,
  ) => Promise<A7ProductCustomerBindingVirtualAccountEvidence | null>;

  /**
   * Existing `VirtualAccount` lookup by (provider, accountNumber) consumer.
   * The A7 product customer-binding service consumes the existing
   * `VirtualAccount` row through the existing
   * `VirtualAccountService.lookup()` consumer boundary. The A7 product
   * customer-binding service does not write any `VirtualAccount`
   * record.
   */
  readonly virtualAccountLookupByProviderAndNumber: (
    provider: string,
    accountNumber: string,
  ) => Promise<A7ProductCustomerBindingVirtualAccountEvidence | null>;

  /**
   * A4 product-policy decision consumer. The A4 product-policy
   * service (A7T03) remains the only A4 product-policy authority. The
   * A7 product customer-binding service consumes the A4
   * product-policy decision through the A4 historical-replay service
   * consumer boundary. The A7 product customer-binding service does
   * not write any A4 product-policy decision.
   */
  readonly a4ProductPolicyDecisionLookup: (
    decisionReference: string,
  ) => Promise<A7ProductCustomerBindingA4ProductPolicyDecision | null>;

  /**
   * A2 authorization context consumer. The A2 authorization service
   * remains the only A2 authorization authority. The A7 product
   * customer-binding service consumes the A2 authorization context
   * through the A2 `AuthorizationService` consumer boundary. The A7
   * product customer-binding service does not write any A2
   * authorization context.
   */
  readonly a2AuthorizationContextLookup: (
    authorizationContextReference: string,
  ) => Promise<A7ProductCustomerBindingA2AuthorizationContext | null>;

  /**
   * A6T04 funding-target consumer. The A6T04 funding-target service
   * (per `docs/ADR/ADR-0051-External-Funding-Instrument-Use.md`) remains
   * the only A6T04 funding-target authority. The A7 product
   * customer-binding service consumes the A6T04 funding-target
   * evidence through the A6T04 `ExternalFundingTargetMappingService`
   * consumer boundary. The A7 product customer-binding service does
   * not write any A6T04 funding-target evidence.
   */
  readonly a6T04FundingTargetLookup: (
    customerId: string,
    virtualAccountReference: string,
  ) => Promise<A7ProductCustomerBindingA6T04FundingTargetEvidence | null>;

  /**
   * Bank directory consumer. The existing `bank` module remains the
   * only bank-directory authority. The A7 product customer-binding
   * service consumes the bank directory through the existing
   * `BankService` consumer boundary. The A7 product customer-binding
   * service does not write any bank-directory record.
   */
  readonly bankDirectoryLookup: (
    bankCode: string,
  ) => Promise<A7ProductCustomerBindingBankDirectoryEntry | null>;

  /**
   * Operations audit consumer. The shared `AuditService` remains the
   * only audit authority. The A7 product customer-binding service
   * records the A7 product customer-binding audit fact through the
   * shared `AuditService` consumer boundary. The A7 product
   * customer-binding service does not write any source record.
   */
  readonly operationsAudit: (record: {
    readonly action: string;
    readonly entityId: string;
    readonly actor: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly newValues: Readonly<Record<string, unknown>>;
  }) => Promise<void>;
}
