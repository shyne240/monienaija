import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';
import type {
  ExternalTargetReferenceV1,
  PartnerCapabilityKey,
  PartnerKey,
  PartnerOperationType,
} from './partner-adapter.types';

export const EXTERNAL_TARGET_USE_ACTION = 'wallet:withdrawal:external-target:use' as const;
export const EXTERNAL_TARGET_USE_RESOURCE = 'external-funding-target' as const;
export const EXTERNAL_TARGET_USE_PURPOSE = 'OUTBOUND_BANK_SETTLEMENT' as const;

export type ExternalFundingTargetSource = 'CUSTOMER_BENEFICIARY' | 'FUNDING_INSTRUMENT';
export type ExternalFundingTargetDecision = 'ALLOW' | 'ALLOW_WITH_LIMITS';

export interface ExternalFundingTargetPolicyAssertion {
  customerId: string;
  capability: PartnerCapabilityKey;
  action: 'create';
  decision: ExternalFundingTargetDecision;
  decisionReference: string;
  policyVersion: string;
  currency: string;
  expiresAt: string;
  reviewAt?: string | null;
  maxAmountMinor?: string | null;
}

export interface ExternalFundingTargetConsentAssertion {
  reference: string;
  customerId: string;
  targetSource: ExternalFundingTargetSource;
  targetId: string;
  purpose: typeof EXTERNAL_TARGET_USE_PURPOSE;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  version: number;
}

export interface ExternalFundingTargetMappingCommand {
  principal: AuthorizationPrincipal;
  requestContext: RequestContext;
  customerId: string;
  sourceCustomerWalletId: string;
  sourceBindingId: string;
  sourceBindingVersion: number;
  sourceWalletAccountId: string;
  sourceLedgerAccountId: string;
  amountMinor: string | number | bigint;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  target: {
    source: ExternalFundingTargetSource;
    fundingInstrumentId?: string;
    beneficiaryId?: string;
    version: number;
    institutionCode: string;
    targetCurrency?: string;
  };
  consent: ExternalFundingTargetConsentAssertion;
  policy: ExternalFundingTargetPolicyAssertion;
}

export interface ExternalFundingTargetMappingResult {
  mappingVersion: 1;
  mappingReference: string;
  partner: {
    partnerKey: PartnerKey;
    capabilityKey: PartnerCapabilityKey;
    operationType: PartnerOperationType;
  };
  customerId: string;
  internalAccount: {
    customerWalletId: string;
    bindingId: string;
    bindingVersion: number;
    walletAccountId: string;
    ledgerAccountId: string;
    currency: string;
    accountingUnit: 'CUSTOMER_FUNDS';
  };
  target: {
    source: ExternalFundingTargetSource;
    sourceId: string;
    sourceVersion: number;
    targetType: 'BANK_ACCOUNT';
    institutionCode: string;
    targetReferenceHash: string;
    consentReference: string;
    consentVersion: number;
    externalTarget: ExternalTargetReferenceV1;
  };
  money: {
    amountMinor: string;
    currency: string;
    accountingUnit: 'CUSTOMER_FUNDS';
  };
  policy: {
    decision: ExternalFundingTargetDecision;
    decisionReference: string;
    policyVersion: string;
    expiresAt: string;
  };
  authorization: {
    principalType: AuthorizationPrincipal['type'];
    principalId: string;
    evaluatedAt: string;
  };
  requestContext: RequestContext;
}

export type ExternalFundingTargetMappingErrorCode =
  | 'COMMAND_INVALID'
  | 'AUTHORIZATION_REQUIRED'
  | 'POLICY_NOT_EXECUTABLE'
  | 'ACCOUNTING_UNIT_MISMATCH'
  | 'CURRENCY_UNSUPPORTED'
  | 'ACCOUNT_BINDING_NOT_ACTIVE'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_TYPE_UNSUPPORTED'
  | 'TARGET_NOT_VERIFIED'
  | 'TARGET_NOT_ACTIVE'
  | 'TARGET_VERSION_STALE'
  | 'TARGET_OWNERSHIP_MISMATCH'
  | 'BANK_NOT_FOUND'
  | 'BANK_NOT_SUPPORTED'
  | 'BANK_NOT_ACTIVE'
  | 'CONSENT_INVALID'
  | 'TARGET_MAPPING_AMBIGUOUS'
  | 'TARGET_MAPPING_CONFLICT'
  | 'TARGET_SOURCE_UNAVAILABLE'
  | 'OPERATIONS_EVIDENCE_UNAVAILABLE'
  | 'PARTNER_CAPABILITY_UNAVAILABLE';

export interface ExternalFundingTargetMappingFailure {
  code: ExternalFundingTargetMappingErrorCode;
  message: string;
}
