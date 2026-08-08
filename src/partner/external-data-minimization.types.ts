import type {
  ExternalConsentSource,
  ExternalConsentStatus,
  ExternalDataControlAction,
  ExternalDataHandlingLevel,
  ExternalDisclosureAudience,
  ExternalLegalHoldAuthority,
  ExternalLegalHoldScope,
  ExternalLegalHoldStatus,
  ExternalSecretCategory,
} from './external-data-minimization.enums';

export const EXTERNAL_DATA_MINIMIZATION_FIELD_REGISTRY_VERSION = 1 as const;

export interface ExternalDataClassificationEntry {
  fieldName: string;
  level: ExternalDataHandlingLevel;
  sourceDomain: string;
  owner: string;
  audienceMaximums: Readonly<Record<ExternalDisclosureAudience, ExternalDataHandlingLevel>>;
  secretCategory: ExternalSecretCategory | null;
  retentionDays: number;
  holdSupport: boolean;
}

export interface ExternalDataClassificationView {
  classificationId: string;
  fieldName: string;
  level: ExternalDataHandlingLevel;
  sourceDomain: string;
  owner: string;
  recordedAt: Date;
  classificationRegistryVersion: number;
}

export interface ExternalConsentAssertion {
  customerId: string;
  source: ExternalConsentSource;
  targetId: string;
  targetVersion: number;
  purpose: string;
  jurisdiction: string;
  mandateReference: string;
  mandateVersion: number;
  grantedAt: Date;
  expiresAt: Date;
  grantedBy: string;
  revocable: boolean;
  revokedAt: Date | null;
}

export interface ExternalConsentView {
  consentId: string;
  customerId: string;
  source: ExternalConsentSource;
  targetId: string;
  targetVersion: number;
  purpose: string;
  jurisdiction: string;
  mandateReference: string;
  mandateVersion: number;
  grantedAt: Date;
  expiresAt: Date;
  grantedBy: string;
  revocable: boolean;
  revokedAt: Date | null;
  status: ExternalConsentStatus;
  recordedAt: Date;
}

export interface ExternalRetentionEntry {
  dataset: string;
  level: ExternalDataHandlingLevel;
  owner: string;
  retentionDays: number;
  holdSupport: boolean;
}

export interface ExternalRetentionView {
  retentionId: string;
  dataset: string;
  level: ExternalDataHandlingLevel;
  owner: string;
  retentionDays: number;
  holdSupport: boolean;
  recordedAt: Date;
}

export interface ExternalLegalHoldRecord {
  scope: ExternalLegalHoldScope;
  referenceId: string;
  owner: string;
  authority: ExternalLegalHoldAuthority;
  reason: string;
  imposedAt: Date;
  imposedBy: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  notes: string | null;
}

export interface ExternalLegalHoldView {
  holdId: string;
  scope: ExternalLegalHoldScope;
  referenceId: string;
  owner: string;
  authority: ExternalLegalHoldAuthority;
  reason: string;
  imposedAt: Date;
  imposedBy: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  notes: string | null;
  status: ExternalLegalHoldStatus;
}

export interface ExternalSecretClassification {
  category: ExternalSecretCategory;
  owner: string;
  reference: string;
  notes: string | null;
}

export interface ExternalSecretClassificationView {
  classificationId: string;
  category: ExternalSecretCategory;
  owner: string;
  reference: string;
  notes: string | null;
  recordedAt: Date;
}

export interface ExternalDisclosureView {
  viewId: string;
  externalOperationId: string;
  audience: ExternalDisclosureAudience;
  fields: Readonly<Record<string, unknown>>;
  maskedFields: readonly string[];
  generatedAt: Date;
}

export interface ExternalSupportTraceView {
  traceId: string;
  externalOperationId: string;
  audience: ExternalDisclosureAudience;
  trace: Readonly<Record<string, unknown>>;
  maskedFields: readonly string[];
  generatedAt: Date;
}

export interface ExternalPartnerPayload {
  partnerKey: string;
  capabilityKey: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface ExternalPartnerPayloadValidation {
  valid: boolean;
  rejectedFields: readonly { field: string; reason: string }[];
  missingFields: readonly string[];
  recommendedFields: readonly string[];
  auditRecorded: boolean;
}

export interface ExternalDataControlAuditContext {
  requestId?: string | null;
  correlationId?: string | null;
  actor?: string;
}

export interface ExternalDataControlAuditEvent {
  entityType: 'A6_EXTERNAL_DATA_CONTROL';
  entityId: string;
  action: ExternalDataControlAction;
  actor: string;
  correlationId: string | null;
  requestId: string | null;
  newValues: Record<string, unknown>;
  previousValues: Record<string, unknown> | null;
  occurredAt: Date;
}

export class ExternalDataMinimizationException extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalDataMinimizationException';
  }
}

export const SECRET_FIELD_NAMES = new Set<string>([
  'password',
  'passwordhash',
  'pin',
  'otp',
  'secret',
  'apikey',
  'clientsecret',
  'callbacksecret',
  'callbacksignature',
  'signingkey',
  'privatekey',
  'authorization',
  'cookie',
  'devicefingerprint',
  'risknarrative',
  'compliancenote',
  'callbackpayloadraw',
  'partnercredential',
  'rawriskcontent',
  'rawcompliancecontent',
  'rawdevicefingerprint',
]);
