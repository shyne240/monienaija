import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';

export type B2FAccountMappingStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'REJECTED';
export interface B2FAccountMappingCreateCommandV1 {
  readonly mappingVersion: number;
  readonly classificationKey: string;
  readonly classificationVersion: 1;
  readonly a5LedgerAccountId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string;
  readonly now?: Date;
}
export interface B2FAccountMappingLifecycleCommandV1 {
  readonly mappingReference: string;
  readonly mappingVersion: number;
  readonly expectedRecordVersion: number;
  readonly idempotencyKey: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly reason: string;
  readonly approvalId?: string;
  readonly overrideEvidenceReference?: string;
  readonly now?: Date;
}
export interface B2FAccountMappingViewV1 {
  readonly mappingReference: string;
  readonly mappingVersion: number;
  readonly status: B2FAccountMappingStatus;
  readonly bookKey: 'finance.book.ng.primary';
  readonly bookVersion: 1;
  readonly classificationKey: string;
  readonly classificationVersion: 1;
  readonly a5LedgerAccountId: string;
  readonly observedA5Code: string;
  readonly observedA5Name: string;
  readonly observedA5AccountType: string;
  readonly observedA5NormalBalance: string;
  readonly observedA5Active: boolean;
  readonly observedA5AllowNegativeBalance: boolean;
  readonly currency: 'NGN';
  readonly accountingUnit: 'CUSTOMER_FUNDS';
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly idempotencyScope: 'b2.finance.account-mapping.idempotency.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly a5SnapshotHash: string;
  readonly controlDecisionReference: string | null;
  readonly createdBy: string;
  readonly createdRoles: readonly string[];
  readonly approvedBy: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface B2FAccountMappingResultV1 {
  readonly outcome: 'CREATED' | 'UPDATED' | 'REPLAYED' | 'REJECTED';
  readonly mapping: B2FAccountMappingViewV1 | null;
  readonly replayed: boolean;
  readonly failure: { readonly code: string; readonly message: string } | null;
}
export interface B2FAccountMappingVerificationRequestV1 {
  readonly mappingReference: string;
  readonly mappingVersion: number;
  readonly bookKey: 'finance.book.ng.primary';
  readonly classificationKey: string;
  readonly a5LedgerAccountId: string;
  readonly accountingDate: string;
}
export interface B2FAccountMappingVerificationV1 {
  readonly compatible: boolean;
  readonly readOnly: true;
  readonly mapping: B2FAccountMappingViewV1 | null;
  readonly reasons: readonly string[];
  readonly verifiedAt: string;
}
export interface B2FAccountMappingConsumerPortsV1 {
  readonly contractName: 'B2F-ACCOUNT-MAPPING';
  readonly contractVersion: 1;
  readonly getByReference: (
    reference: string,
    version: number,
  ) => Promise<B2FAccountMappingViewV1 | null>;
  readonly listByClassification: (
    bookKey: 'finance.book.ng.primary',
    classificationKey: string,
  ) => Promise<readonly B2FAccountMappingViewV1[]>;
  readonly getByA5Account: (
    bookKey: 'finance.book.ng.primary',
    a5LedgerAccountId: string,
  ) => Promise<readonly B2FAccountMappingViewV1[]>;
  readonly verify: (
    request: B2FAccountMappingVerificationRequestV1,
  ) => Promise<B2FAccountMappingVerificationV1>;
}
