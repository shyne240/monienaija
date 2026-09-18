import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { RequestContext } from '../production/request-context';
import type { LedgerAccountType, LedgerNormalBalance } from './ledger.enums';

export interface A5ArControlAccountDefinitionV1 {
  readonly code: string;
  readonly name: string;
  readonly accountType: LedgerAccountType;
  readonly normalBalance: LedgerNormalBalance;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly allowNegativeBalance: boolean;
}
export interface A5ArControlAccountProvisionCommandV1 {
  readonly definition: A5ArControlAccountDefinitionV1;
  readonly idempotencyKey: string;
  readonly approvalId: string;
  readonly principal: AuthorizationPrincipal;
  readonly requestContext: RequestContext;
  readonly causationId?: string;
  readonly now?: Date;
}
export interface A5ArControlAccountEvidenceV1 {
  readonly provisioningReference: string;
  readonly provisioningVersion: 1;
  readonly definitionHash: string;
  readonly requestHash: string;
  readonly canonicalA5AccountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountType: string;
  readonly normalBalance: string;
  readonly currency: string;
  readonly accountingUnit: string;
  readonly allowNegativeBalance: false;
  readonly isActive: true;
  readonly accountSnapshotHash: string;
  readonly approvalId: string;
  readonly controlDecisionReference: string;
  readonly auditEventId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly verifiedAt: string;
  readonly readyForB2F03Mapping: true;
}
export interface A5ArControlAccountProvisionResultV1 {
  readonly outcome: 'PROVISIONED' | 'RECOVERED' | 'REPLAYED' | 'REJECTED';
  readonly evidence: A5ArControlAccountEvidenceV1 | null;
  readonly replayed: boolean;
  readonly failure: { readonly code: string; readonly message: string } | null;
}
