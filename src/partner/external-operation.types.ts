import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';
import type {
  PartnerCapabilityKey,
  PartnerKey,
  PartnerOperationType,
} from './partner-adapter.types';
import type {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
  ExternalOperationResourceType,
} from './external-operation.enums';

export const EXTERNAL_OPERATION_CONTRACT_VERSION = 1 as const;
export const EXTERNAL_OPERATION_IDEMPOTENCY_SCOPE = 'external.partner.operation.v1';
export const EXTERNAL_OPERATION_PROVIDER_IDEMPOTENCY_SCOPE = 'nibss.nip.external-operation.v1';

export interface CreateExternalOperationCommand {
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  resourceType: ExternalOperationResourceType;
  resourceId: string;
  internalCommandId: string;
  customerId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  targetMappingReference: string;
  amountMinor: string | number | bigint;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  idempotencyKey: string;
  requestContext: RequestContext;
  causationId?: string | null;
}

export interface ExternalOperationView {
  operationVersion: 1;
  externalOperationId: string;
  externalOperationReference: string;
  partnerKey: PartnerKey;
  capabilityKey: PartnerCapabilityKey;
  operationType: PartnerOperationType;
  resourceType: ExternalOperationResourceType;
  resourceId: string;
  internalCommandId: string;
  customerId: string;
  walletAccountId: string;
  ledgerAccountId: string;
  targetMappingReference: string;
  amountMinor: string;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  internalIdempotencyScope: string;
  internalIdempotencyKey: string;
  providerIdempotencyScope: string;
  providerIdempotencyKey: string;
  requestHash: string;
  requestContext: RequestContext;
  causationId: string | null;
  providerReferences: readonly ExternalOperationReferenceView[];
  replayed: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface RecordProviderReferenceCommand {
  externalOperationId: string;
  partnerKey: PartnerKey;
  referenceType: ExternalOperationReferenceType;
  referenceValue: string;
  namespace: string;
  source: ExternalOperationReferenceSource;
  observedAt?: string;
  requestContext: RequestContext;
}

export interface ExternalOperationReferenceView {
  id: string;
  externalOperationId: string;
  partnerKey: PartnerKey;
  referenceType: ExternalOperationReferenceType;
  referenceValue: string;
  namespace: string;
  source: ExternalOperationReferenceSource;
  observedAt: Date;
  createdAt: Date;
  replayed: boolean;
}

export interface RecordProviderReferenceResult {
  reference: ExternalOperationReferenceView;
  replayed: boolean;
}

export interface ExternalOperationAuditContext {
  manager: EntityManager;
  action: 'CREATED' | 'REPLAYED' | 'PROVIDER_REFERENCE_RECORDED' | 'REJECTED';
  operation: ExternalOperationView | null;
  reference: ExternalOperationReferenceView | null;
  requestContext: RequestContext;
  failureCode?: string;
}
