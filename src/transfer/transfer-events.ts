import { ConflictException } from '@nestjs/common';

import type { Transfer } from './transfer.entity';

export const INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE = 'transfer.completed';
export const INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION = 1;
export const INTERNAL_TRANSFER_EVENT_CLASSIFICATION = 'RESTRICTED_FINANCIAL';
export const INTERNAL_TRANSFER_EVENT_RETENTION_CLASS = 'A5_TRANSFER_EVENT';

export interface InternalTransferCompletedEvent {
  eventKey: string;
  eventType: typeof INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE;
  schemaVersion: typeof INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION;
  aggregateType: 'TRANSFER';
  aggregateId: string;
  occurredAt: string;
  transferId: string;
  commandId: string;
  sourceCustomerId: string;
  destinationCustomerId: string;
  sourceWalletAccountId: string;
  destinationWalletAccountId: string;
  sourceLedgerAccountId: string;
  destinationLedgerAccountId: string;
  amountMinor: string;
  currency: string;
  accountingUnit: 'CUSTOMER_FUNDS';
  journalId: string;
  requestHash: string;
  correlationId: string | null;
  causationId: string | null;
  policyDecisionReference: string | null;
}

export function transferCompletedEventKey(transferId: string): string {
  return `transfer.completed:${transferId}:v${INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION}`;
}

export function buildInternalTransferCompletedEvent(
  transfer: Transfer,
  occurredAt: Date,
): InternalTransferCompletedEvent {
  if (
    !transfer.commandId ||
    !transfer.sourceCustomerId ||
    !transfer.destinationCustomerId ||
    !transfer.sourceLedgerAccountId ||
    !transfer.destinationLedgerAccountId ||
    !transfer.journalId ||
    transfer.accountingUnit !== 'CUSTOMER_FUNDS'
  ) {
    throw new ConflictException('The completed transfer is missing outbox event metadata');
  }

  const eventKey = transferCompletedEventKey(transfer.id);
  return {
    eventKey,
    eventType: INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE,
    schemaVersion: INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION,
    aggregateType: 'TRANSFER',
    aggregateId: transfer.id,
    occurredAt: occurredAt.toISOString(),
    transferId: transfer.id,
    commandId: transfer.commandId,
    sourceCustomerId: transfer.sourceCustomerId,
    destinationCustomerId: transfer.destinationCustomerId,
    sourceWalletAccountId: transfer.sourceWalletId,
    destinationWalletAccountId: transfer.destinationWalletId,
    sourceLedgerAccountId: transfer.sourceLedgerAccountId,
    destinationLedgerAccountId: transfer.destinationLedgerAccountId,
    amountMinor: transfer.amountMinor,
    currency: transfer.currency,
    accountingUnit: 'CUSTOMER_FUNDS',
    journalId: transfer.journalId,
    requestHash: transfer.requestHash,
    correlationId: transfer.correlationId,
    causationId: transfer.causationId,
    policyDecisionReference: transfer.policyDecisionReference,
  };
}
