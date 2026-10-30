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

export const INTERNAL_TRANSFER_FAILED_EVENT_TYPE = 'transfer.failed';

export function transferFailedEventKey(transferId: string): string {
  return `transfer.failed:${transferId}:v${INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION}`;
}

/**
 * Authoritative recipient identity for the audited TransferService producer path.
 * Values come from the pessimistically-locked wallet rows that backed the ledger
 * posting — never from client-supplied payload guesses. WalletAccount.customerId is
 * an opaque reference (it may identify a non-customer/system wallet); the producer
 * passes it through unchanged and the notification consumer resolves, suppresses,
 * or quarantines safely when no verified customer contact exists.
 */
export interface AuditedTransferRecipientIdentity {
  sourceCustomerId: string;
  destinationCustomerId: string;
}

function assertAuditedRecipientIdentity(
  recipients: AuditedTransferRecipientIdentity,
): void {
  if (
    typeof recipients.sourceCustomerId !== 'string' ||
    recipients.sourceCustomerId.trim().length === 0 ||
    typeof recipients.destinationCustomerId !== 'string' ||
    recipients.destinationCustomerId.trim().length === 0
  ) {
    throw new ConflictException(
      'The transfer is missing authoritative source/destination customer identity for the notification event contract',
    );
  }
}

/**
 * Versioned (schema v1) transfer.completed event facts for the audited TransferService
 * completion path. Mirrors the InternalTransferCompletedEvent contract using ONLY
 * authoritative domain state: the persisted Transfer entity plus the locked wallets'
 * customer ids. Fields the audited path does not own (commandId, ledger account ids,
 * accountingUnit, policyDecisionReference) faithfully mirror the entity (null) so the
 * transfer reconciliation payload comparison stays exact, and the notification consumer
 * receives the recipient identity + rendering facts (transferId, amountMinor, currency)
 * it requires instead of quarantining the event with zero intents. The notification
 * delivery payload is separately projected through the event allowlist, so journalId /
 * paymentReference / requestHash can never render into a customer message.
 */
export function buildAuditedInternalTransferCompletedEvent(
  transfer: Transfer,
  recipients: AuditedTransferRecipientIdentity,
  occurredAt: Date,
): Record<string, unknown> {
  if (!transfer.id || !transfer.journalId) {
    throw new ConflictException('The completed transfer is missing outbox event metadata');
  }
  assertAuditedRecipientIdentity(recipients);
  return {
    eventKey: transferCompletedEventKey(transfer.id),
    eventType: INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE,
    schemaVersion: INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION,
    aggregateType: 'TRANSFER',
    aggregateId: transfer.id,
    occurredAt: occurredAt.toISOString(),
    transferId: transfer.id,
    commandId: transfer.commandId,
    sourceCustomerId: recipients.sourceCustomerId,
    destinationCustomerId: recipients.destinationCustomerId,
    sourceWalletAccountId: transfer.sourceWalletId,
    destinationWalletAccountId: transfer.destinationWalletId,
    sourceLedgerAccountId: transfer.sourceLedgerAccountId,
    destinationLedgerAccountId: transfer.destinationLedgerAccountId,
    amountMinor: transfer.amountMinor,
    currency: transfer.currency,
    accountingUnit: transfer.accountingUnit,
    journalId: transfer.journalId,
    requestHash: transfer.requestHash,
    correlationId: transfer.correlationId ?? `transfer:${transfer.id}`,
    causationId: transfer.causationId,
    policyDecisionReference: transfer.policyDecisionReference,
    // Legacy operational consumers of the audited path already received this field.
    paymentReference: transfer.paymentReference,
  };
}

/**
 * Versioned (schema v1) transfer.failed event facts for the audited TransferService
 * failure path. Carries the authoritative recipient identity (the notification consumer
 * addresses failure notices to the source customer only — audience selection stays the
 * consumer's contract), the committed request amount/currency, the stable internal
 * failure code, and an 8-hex public-safe reference derived from the transfer id.
 * Deliberately omits: journalId (a failed transfer posts no journal), failureMessage
 * rejection prose, PINs/transfer secrets, and any settlement or cash-handover inference.
 */
export function buildAuditedInternalTransferFailedEvent(
  transfer: Transfer,
  recipients: AuditedTransferRecipientIdentity,
  failureCode: string | null,
  occurredAt: Date,
): Record<string, unknown> {
  if (!transfer.id) {
    throw new ConflictException('The failed transfer is missing outbox event metadata');
  }
  assertAuditedRecipientIdentity(recipients);
  return {
    eventKey: transferFailedEventKey(transfer.id),
    eventType: INTERNAL_TRANSFER_FAILED_EVENT_TYPE,
    schemaVersion: INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION,
    aggregateType: 'TRANSFER',
    aggregateId: transfer.id,
    occurredAt: occurredAt.toISOString(),
    transferId: transfer.id,
    sourceCustomerId: recipients.sourceCustomerId,
    destinationCustomerId: recipients.destinationCustomerId,
    amountMinor: transfer.amountMinor,
    currency: transfer.currency,
    failureCode,
    reference: transfer.id.slice(0, 8),
  };
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
