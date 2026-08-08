import type { EntityManager } from 'typeorm';

import type { RequestContext } from '../production/request-context';
import type { PartnerKey } from './partner-adapter.types';
import type { ExternalOperationLifecycleState } from './external-operation-lifecycle.enums';
import type { ExternalOperationReferenceSource } from './external-operation.enums';
import type {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from './external-settlement.enums';
import type { ExternalSettlementRejectionCode } from './external-settlement.enums';

export const EXTERNAL_SETTLEMENT_CONTRACT_NAME = 'A6-EXTERNAL-SETTLEMENT' as const;
export const EXTERNAL_SETTLEMENT_CONTRACT_VERSION = 1 as const;
export const EXTERNAL_SETTLEMENT_IDEMPOTENCY_SCOPE = 'external.partner.settlement.v1';
export const EXTERNAL_COMPENSATING_IDEMPOTENCY_SCOPE = 'external.partner.compensating.v1';
export const EXTERNAL_SETTLEMENT_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;
export const EXTERNAL_SETTLEMENT_CURRENCY = 'NGN' as const;
export const EXTERNAL_SETTLEMENT_RETENTION_SECONDS = 86_400;
export const EXTERNAL_SETTLEMENT_OWNER = 'finance-ledger-suspense' as const;
export const EXTERNAL_SETTLEMENT_OWNER_PRINCIPAL = 'a6-settlement-suspense-owner' as const;
export const EXTERNAL_SETTLEMENT_INTERNAL_COMMAND_ACTOR = 'a6-external-settlement' as const;

export type ExternalSettlementEvidenceType = 'OPERATION' | 'TRANSACTION' | 'SETTLEMENT';

export interface ExternalSettlementEvidence {
  referenceType: ExternalSettlementEvidenceType;
  referenceValue: string;
  namespace: string;
  source: ExternalOperationReferenceSource;
  observedAt: Date;
}

export interface SettleVerifiedOutcomeCommand {
  externalOperationId: string;
  decision: ExternalSettlementDecision;
  expectedVersion: number;
  evidence: ExternalSettlementEvidence;
  requestContext: RequestContext;
  ownerPrincipal?: string;
}

export interface ExternalSettlementView {
  settlementVersion: 1;
  settlementId: string;
  externalOperationId: string;
  externalOperationReference: string;
  partnerKey: PartnerKey;
  capabilityKey: 'external.wallet.withdrawal.settlement';
  operationType: 'OUTBOUND_BANK_SETTLEMENT';
  customerId: string;
  walletAccountId: string;
  customerLedgerAccountId: string;
  settlementAssetLedgerAccountId: string;
  decision: ExternalSettlementDecision;
  status: ExternalSettlementStatus;
  amountMinor: string;
  currency: string;
  accountingUnit: typeof EXTERNAL_SETTLEMENT_ACCOUNTING_UNIT;
  lifecycleState: string;
  journalId: string | null;
  reversalJournalId: string | null;
  evidence: ExternalSettlementEvidence & { evidenceHash: string };
  idempotencyScope: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  requestId: string;
  ownerPrincipal: string;
  postedAt: Date | null;
  reversalPostedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  replayed: boolean;
}

export interface ExternalSuspenseEntryView {
  suspenseId: string;
  externalOperationId: string;
  externalOperationReference: string;
  customerId: string;
  amountMinor: string;
  currency: string;
  accountingUnit: string;
  reason: string;
  status: ExternalSuspenseStatus;
  owner: string;
  ownerPrincipal: string;
  evidenceHash: string;
  lifecycleState: string;
  rejectionCode: string;
  correlationId: string;
  requestId: string;
  reversalJournalId: string | null;
  settlementId: string | null;
  clearedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SuspenseVerifiedOutcomeCommand {
  externalOperationId: string;
  reason: string;
  rejectionCode: ExternalSettlementRejectionCode;
  expectedVersion: number;
  evidence: ExternalSettlementEvidence;
  requestContext: RequestContext;
  owner?: string;
  ownerPrincipal?: string;
}

export interface RecordCompensatingEntryCommand {
  externalOperationId: string;
  settlementId: string;
  suspenseEntryId: string;
  expectedVersion: number;
  requestContext: RequestContext;
  reason?: string;
}

export interface ExternalSettlementResult {
  decision: ExternalSettlementDecision;
  settlement: ExternalSettlementView;
  suspense: ExternalSuspenseEntryView | null;
  replayed: boolean;
}

export interface ExternalSettlementCompensatingResult {
  settlement: ExternalSettlementView;
  suspense: ExternalSuspenseEntryView;
  reversalJournalId: string;
  replayed: boolean;
}

export class ExternalSettlementException extends Error {
  constructor(
    readonly code: ExternalSettlementRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalSettlementException';
  }
}

export interface ExternalSettlementAuditCommand {
  manager: EntityManager;
  action:
    | 'SETTLEMENT_POSTED'
    | 'SETTLEMENT_REPLAYED'
    | 'SETTLEMENT_REJECTED'
    | 'SUSPENSE_RECORDED'
    | 'COMPENSATING_POSTED'
    | 'COMPENSATING_REPLAYED'
    | 'COMPENSATING_REJECTED'
    | 'SETTLEMENT_DISABLED';
  entityId: string;
  requestContext: RequestContext;
  settlement?: ExternalSettlementView;
  suspense?: ExternalSuspenseEntryView;
  failureCode?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

export type ResolvedVerifiedLifecycleState =
  | ExternalOperationLifecycleState.PENDING_VERIFICATION
  | 'SETTLED'
  | 'REJECTED'
  | 'COMPENSATED';
