import type {
  PartnerCapabilityKey,
  PartnerEnvironment,
  PartnerKey,
  PartnerOperationType,
} from './partner-adapter.types';

export type PartnerSigningAlgorithm = 'HMAC_SHA256' | 'RSA_SHA256';
export type PartnerCredentialKind = 'CLIENT_AUTHENTICATION' | 'REQUEST_SIGNING';
export type PartnerConnectionStatus =
  | 'DISABLED'
  | 'READY_FOR_TRANSPORT'
  | 'NOT_CONFIGURED'
  | 'ENVIRONMENT_MISMATCH'
  | 'CAPABILITY_MISMATCH'
  | 'CREDENTIAL_REFERENCE_MISSING'
  | 'SIGNING_REFERENCE_MISSING'
  | 'PRODUCTION_CONFIGURATION_FORBIDDEN';

export interface PartnerCredentialReference {
  partnerKey: PartnerKey;
  environment: PartnerEnvironment;
  kind: PartnerCredentialKind;
  reference: string;
}

export interface PartnerConnectionProfile {
  enabled: boolean;
  nodeEnvironment: 'development' | 'test' | 'staging' | 'production';
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  environment: PartnerEnvironment;
  apiVersion: string;
  adapterVersion: string;
  baseUrl: string | null;
  credentialReference: PartnerCredentialReference | null;
  signingKeyReference: PartnerCredentialReference | null;
  signingAlgorithm: PartnerSigningAlgorithm;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
}

export interface PartnerConnectionStatusView {
  status: PartnerConnectionStatus;
  enabled: boolean;
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  environment: PartnerEnvironment;
  apiVersion: string;
  adapterVersion: string;
  baseUrlConfigured: boolean;
  credentialReferenceConfigured: boolean;
  signingReferenceConfigured: boolean;
  signingAlgorithm: PartnerSigningAlgorithm;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
}

export interface PartnerConnectionContext {
  profile: PartnerConnectionProfile;
  credentialReference: PartnerCredentialReference;
  signingKeyReference: PartnerCredentialReference;
}

export interface PartnerConnectionBoundary {
  getProfile(): PartnerConnectionProfile;
  getStatus(): PartnerConnectionStatusView;
  assertReadyForTransport(): PartnerConnectionContext;
}

export interface PartnerSigningInput {
  partnerKey: PartnerKey;
  environment: PartnerEnvironment;
  algorithm: PartnerSigningAlgorithm;
  keyReference: PartnerCredentialReference;
  canonicalPayloadHash: string;
  requestId: string;
  correlationId: string;
  timestamp: string;
}

export interface PartnerSigningPreparation {
  status: 'PREPARED';
  input: PartnerSigningInput;
  signingInputHash: string;
}

export interface PartnerRequestSigner {
  prepare(input: PartnerSigningInput): PartnerSigningPreparation;
}

export interface PartnerConnectionAuditEvent {
  action:
    | 'PARTNER_CONFIGURATION_VALIDATED'
    | 'PARTNER_CONFIGURATION_REJECTED'
    | 'PARTNER_CAPABILITY_REGISTERED';
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  environment: PartnerEnvironment;
  status: PartnerConnectionStatus;
  adapterVersion: string;
  apiVersion: string;
  correlationId?: string;
  requestId?: string;
  failureCode?: string;
}
