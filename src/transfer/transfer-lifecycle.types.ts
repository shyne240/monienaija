import type { TransferFailureCode, TransferStatus } from './transfer.enums';

export const TRANSFER_LIFECYCLE_IDEMPOTENCY_SCOPE = 'wallet.transfer.lifecycle.v1';
export const TRANSFER_STATE_IDEMPOTENCY_SCOPE = 'wallet.transfer.state.v1';
export const TRANSFER_LEDGER_POST_IDEMPOTENCY_SCOPE = 'wallet.transfer.ledger-post.v1';
export const TRANSFER_COMMAND_SCOPE = 'wallet.transfer.create.v1';

export interface TransferLifecycleRequestContext {
  requestId: string;
  correlationId: string;
  traceId?: string;
  causationId?: string;
}

export interface CreateTransferLifecycleCommand {
  contractVersion: 1;
  commandType: 'INTERNAL_TRANSFER';
  commandId: string;
  capability: 'wallet.transfer';
  action: 'create';
  scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER';
  sourceCustomerId: string;
  destinationCustomerId: string;
  sourceCustomerWalletId: string;
  destinationCustomerWalletId: string;
  sourceBindingId: string;
  destinationBindingId: string;
  sourceBindingVersion: number;
  destinationBindingVersion: number;
  sourceWalletAccountId: string;
  destinationWalletAccountId: string;
  sourceLedgerAccountId: string;
  destinationLedgerAccountId: string;
  amountMinor: string | number | bigint;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  idempotencyScope: typeof TRANSFER_COMMAND_SCOPE;
  idempotencyKey: string;
  requestHash: string;
  authorizationContextReference: string;
  policyDecisionReference: string;
  policyVersion: string;
  policyProfileReference: string;
  policyProfileVersion: number;
  policySnapshotReference: string;
  policyInputHash: string;
  requestedAt: string;
  requestContext: TransferLifecycleRequestContext;
  reference?: string | null;
  narration?: string | null;
}

export interface PostTransferToLedgerCommand {
  idempotencyKey: string;
  requestContext: TransferLifecycleRequestContext;
}

export interface TransitionTransferLifecycleCommand {
  transferId: string;
  nextStatus: TransferStatus;
  idempotencyKey: string;
  requestContext: TransferLifecycleRequestContext;
  expectedVersion?: number;
  journalId?: string;
  recoveryReference?: string;
  reason?: string;
  failureCode?: TransferFailureCode;
  failureMessage?: string;
  failureStatusCode?: number;
}

export interface TransferLifecycleView {
  id: string;
  commandId: string | null;
  commandType: string | null;
  commandVersion: number | null;
  capability: string | null;
  action: string | null;
  scope: string | null;
  sourceCustomerId: string | null;
  destinationCustomerId: string | null;
  sourceCustomerWalletId: string | null;
  destinationCustomerWalletId: string | null;
  sourceBindingId: string | null;
  destinationBindingId: string | null;
  sourceBindingVersion: number | null;
  destinationBindingVersion: number | null;
  sourceWalletAccountId: string;
  destinationWalletAccountId: string;
  sourceLedgerAccountId: string | null;
  destinationLedgerAccountId: string | null;
  authorizationContextReference: string | null;
  policyDecisionReference: string | null;
  policyVersion: string | null;
  policyProfileReference: string | null;
  policyProfileVersion: number | null;
  policySnapshotReference: string | null;
  policyInputHash: string | null;
  journalId: string | null;
  paymentReference: string | null;
  amountMinor: string;
  currency: string;
  accountingUnit: string | null;
  status: TransferStatus;
  idempotencyScope: string | null;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  correlationId: string | null;
  traceId: string | null;
  causationId: string | null;
  requestedAt: Date | null;
  reference: string | null;
  narration: string | null;
  failureCode: TransferFailureCode | null;
  failureMessage: string | null;
  failureStatusCode: number | null;
  recoveryReference: string | null;
  stateReason: string | null;
  pendingAt: Date | null;
  processingAt: Date | null;
  pendingRecoveryAt: Date | null;
  unknownAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  version: number;
  idempotencyReplay: boolean;
}
