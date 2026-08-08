export const EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME = 'A6-EXTERNAL-PARTNER-ADAPTER' as const;
export const EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION = 1 as const;

export const NIBSS_NIP_PARTNER_KEY = 'NIBSS_NIP' as const;
export const EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY =
  'external.wallet.withdrawal.settlement' as const;
export const OUTBOUND_BANK_SETTLEMENT_OPERATION = 'OUTBOUND_BANK_SETTLEMENT' as const;
export const A6_PARTNER_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

export type PartnerKey = typeof NIBSS_NIP_PARTNER_KEY;
export type PartnerCapabilityKey = typeof EXTERNAL_WALLET_WITHDRAWAL_SETTLEMENT_CAPABILITY;
export type PartnerOperationType = typeof OUTBOUND_BANK_SETTLEMENT_OPERATION;
export type PartnerAccountingUnit = typeof A6_PARTNER_ACCOUNTING_UNIT;
export type PartnerEnvironment = 'sandbox' | 'production';
export type PartnerTargetType = 'BANK_ACCOUNT';
export type PartnerTargetReferenceType =
  | 'CUSTOMER_BENEFICIARY'
  | 'FUNDING_INSTRUMENT'
  | 'APPROVED_EXTERNAL_TARGET';
export type ProviderReferenceType =
  | 'REQUEST'
  | 'OPERATION'
  | 'TRANSACTION'
  | 'SETTLEMENT'
  | 'CALLBACK'
  | 'STATEMENT_ROW'
  | 'PROVIDER_IDEMPOTENCY';
export type ProviderEvidenceSource =
  | 'ACKNOWLEDGEMENT'
  | 'STATUS_QUERY'
  | 'CALLBACK'
  | 'STATEMENT'
  | 'REPORT';
export type ExternalPartnerOutcome =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'NOT_SUPPORTED';
export type ExternalPartnerFinancialPosture =
  | 'NOT_ESTABLISHED'
  | 'EXTERNAL_ACCEPTED_NOT_SETTLED'
  | 'EXTERNAL_REJECTED_NO_EFFECT_ESTABLISHED'
  | 'EXTERNAL_OUTCOME_UNKNOWN'
  | 'REQUIRES_RECONCILIATION';
export type PartnerSendState = 'NOT_ATTEMPTED' | 'SENT' | 'UNKNOWN';
export type PartnerRetryDirective =
  | 'DO_NOT_RETRY'
  | 'RETRY_SAME_OPERATION'
  | 'VERIFY_THEN_DECIDE'
  | 'WAIT_FOR_EXTERNAL_EVIDENCE'
  | 'ROUTE_TO_MANUAL_REVIEW'
  | 'OPEN_PARTNER_CIRCUIT';
export type ExternalPartnerErrorCategory =
  | 'VALIDATION'
  | 'CAPABILITY'
  | 'CONFIGURATION'
  | 'TRANSPORT'
  | 'SECURITY'
  | 'CONTRACT'
  | 'PROVIDER'
  | 'CORRELATION'
  | 'EVIDENCE'
  | 'RECOVERY';
export type ExternalPartnerErrorCode =
  | 'ADAPTER_CONTRACT_INVALID'
  | 'CAPABILITY_UNSUPPORTED'
  | 'PARTNER_NOT_CONFIGURED'
  | 'PARTNER_UNAVAILABLE'
  | 'TIMEOUT_BEFORE_SEND'
  | 'TIMEOUT_AFTER_SEND_UNKNOWN'
  | 'PROVIDER_AUTHENTICATION_FAILED'
  | 'PROVIDER_RESPONSE_AUTHENTICITY_FAILED'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'PROVIDER_VERSION_UNSUPPORTED'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_PENDING'
  | 'PROVIDER_DUPLICATE'
  | 'RATE_LIMITED'
  | 'TARGET_INVALID'
  | 'CURRENCY_UNSUPPORTED'
  | 'AMOUNT_UNSUPPORTED'
  | 'REFERENCE_CONFLICT'
  | 'PARTNER_EVIDENCE_UNAVAILABLE'
  | 'CIRCUIT_OPEN'
  | 'ADAPTER_INTERNAL_FAILURE'
  | 'MANUAL_REVIEW_REQUIRED';

export interface PartnerCorrelationContextV1 {
  requestId: string;
  correlationId: string;
  traceId: string | null;
  causationId: string | null;
  commandId: string | null;
  resourceId: string | null;
  externalOperationId: string | null;
  requestedAt: string;
}

export interface ExternalTargetReferenceV1 {
  targetType: PartnerTargetType;
  institutionCode: string;
  targetReference: string;
  targetReferenceType: PartnerTargetReferenceType;
  targetVersion: number | null;
  targetCurrency: string | null;
  verificationReference: string | null;
}

export interface PartnerIdempotencyContextV1 {
  internalScope: string;
  internalKey: string;
  providerScope: string | null;
  providerKey: string | null;
  requestHash: string;
}

export interface ExternalPartnerRequestV1 {
  contractName: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME;
  contractVersion: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION;
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  capabilityVersion: string;
  internalResource: {
    resourceType: 'WITHDRAWAL';
    resourceId: string;
    internalCommandId: string | null;
    externalOperationId: string | null;
  };
  internalContext: {
    customerId: string;
    walletAccountId: string;
    ledgerAccountId: string;
    bindingId: string | null;
    policyDecisionReference: string | null;
    authorizationContextReference: string | null;
  };
  money: {
    amountMinor: string;
    currency: string;
    accountingUnit: PartnerAccountingUnit;
  };
  target: ExternalTargetReferenceV1;
  idempotency: PartnerIdempotencyContextV1;
  correlation: PartnerCorrelationContextV1;
  transport: {
    profileReference: string;
    deadlineAt: string | null;
  };
  requestedAt: string;
}

export interface ProviderReferenceV1 {
  partnerKey: PartnerKey;
  referenceType: ProviderReferenceType;
  value: string;
  namespace: string;
  observedAt: string;
  source: ProviderEvidenceSource;
}

export interface PartnerRetryClassificationV1 {
  retryable: boolean;
  directive: PartnerRetryDirective;
  sendState: PartnerSendState;
  retryAfterSeconds: number | null;
  reasonCode: ExternalPartnerErrorCode | null;
}

export interface AdapterEvidenceReferenceV1 {
  adapterVersion: string;
  contractVersion: number;
  partnerApiVersion: string | null;
  responseHash: string | null;
  providerPayloadReference: string | null;
  observedAt: string;
  source: ProviderEvidenceSource;
}

export interface ExternalPartnerErrorV1 {
  code: ExternalPartnerErrorCode;
  category: ExternalPartnerErrorCategory;
  safeMessage: string;
  providerCode: string | null;
  providerReference: ProviderReferenceV1 | null;
  retryDirective: PartnerRetryDirective;
  effectPosture: ExternalPartnerFinancialPosture;
  occurredAt: string;
  correlation: PartnerCorrelationContextV1;
}

export interface ExternalPartnerResultV1 {
  contractName: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME;
  contractVersion: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION;
  adapter: {
    adapterKey: string;
    adapterVersion: string;
    partnerKey: PartnerKey;
    partnerApiVersion: string | null;
    capabilityKey: PartnerCapabilityKey;
    capabilityVersion: string;
  };
  outcome: ExternalPartnerOutcome;
  financialPosture: ExternalPartnerFinancialPosture;
  providerReferences: readonly ProviderReferenceV1[];
  echoed: {
    amountMinor: string | null;
    currency: string | null;
    targetReference: string | null;
  };
  evidence: AdapterEvidenceReferenceV1 | null;
  correlation: PartnerCorrelationContextV1;
  retry: PartnerRetryClassificationV1;
  error: ExternalPartnerErrorV1 | null;
  observedAt: string;
}

export interface PartnerCapabilityQueryV1 {
  contractName: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME;
  contractVersion: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION;
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  currency: string;
  accountingUnit: PartnerAccountingUnit;
  requestedAt: string;
  correlation: PartnerCorrelationContextV1;
}

export interface PartnerCapabilityResultV1 {
  contractName: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_NAME;
  contractVersion: typeof EXTERNAL_PARTNER_ADAPTER_CONTRACT_VERSION;
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  supported: boolean;
  adapterVersion: string;
  partnerApiVersion: string | null;
  supportedCurrencies: readonly string[];
  supportedTargetTypes: readonly PartnerTargetType[];
  supports: {
    submit: boolean;
    statusQuery: boolean;
    callback: boolean;
    statementOrReport: boolean;
  };
  availability: 'CONFIGURED' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'UNKNOWN';
  safeReasonCode: string | null;
  observedAt: string;
  correlation: PartnerCorrelationContextV1;
}

export interface PartnerCapabilityRegistration {
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  supportedCurrencies: readonly ['NGN'];
  supportedTargetTypes: readonly ['BANK_ACCOUNT'];
  environments: readonly PartnerEnvironment[];
  adapterVersion: string;
  partnerApiVersion: string;
}

export interface PartnerAdapterPort {
  getCapabilities(request: PartnerCapabilityQueryV1): Promise<PartnerCapabilityResultV1>;
  execute(request: ExternalPartnerRequestV1): Promise<ExternalPartnerResultV1>;
}
