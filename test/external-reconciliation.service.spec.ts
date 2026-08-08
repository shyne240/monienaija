import { createHash } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';

import type { DataSource } from 'typeorm';

import { ExternalCallbackReceiptStatus } from '../src/partner/external-callback.enums';
import { ExternalOperationLifecycleState } from '../src/partner/external-operation-lifecycle.enums';
import {
  ExternalOperationReferenceSource,
  ExternalOperationReferenceType,
} from '../src/partner/external-operation.enums';
import {
  ExternalSettlementDecision,
  ExternalSettlementStatus,
  ExternalSuspenseStatus,
} from '../src/partner/external-settlement.enums';
import type {
  ExternalSettlementView,
  ExternalSuspenseEntryView,
} from '../src/partner/external-settlement.types';
import { ExternalReconciliationService } from '../src/reconciliation/external-reconciliation.service';
import { evaluateExternalReconciliation } from '../src/reconciliation/external-reconciliation.evaluator';
import { ExternalReconciliationDiscrepancyCode } from '../src/reconciliation/external-reconciliation.enums';
import type {
  ExternalReconciliationAuditFact,
  ExternalReconciliationCallbackFact,
  ExternalReconciliationFacts,
  ExternalReconciliationIdempotencyHint,
  ExternalReconciliationJournalFact,
  ExternalReconciliationJournalLineFact,
  ExternalReconciliationOperationFact,
  ExternalReconciliationOutboxFact,
  ExternalReconciliationReferenceFact,
  ExternalReconciliationSettlementFact,
  ExternalReconciliationSuspenseFact,
} from '../src/reconciliation/external-reconciliation.types';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';

const EXTERNAL_OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const SETTLEMENT_ID = '00000000-0000-4000-8000-000000000002';
const JOURNAL_ID = '00000000-0000-4000-8000-000000000003';
const REVERSAL_JOURNAL_ID = '00000000-0000-4000-8000-000000000004';
const PROVIDER_REFERENCE_ID = '00000000-0000-4000-8000-000000000005';
const CALLBACK_RECEIPT_ID = '00000000-0000-4000-8000-000000000006';
const SUSPENSE_ENTRY_ID = '00000000-0000-4000-8000-000000000007';
const OUTBOX_EVENT_ID = '00000000-0000-4000-8000-000000000008';
const AUDIT_EVENT_ID = '00000000-0000-4000-8000-000000000009';
const CORRELATION_ID = 'correlation-external-recon-1';
const SETTLEMENT_IDEMPOTENCY_KEY = 'a6-settlement:' + 'b'.repeat(21) + 'aa';
const SETTLEMENT_REQUEST_HASH = 'c'.repeat(64);
const PROVIDER_REFERENCE_VALUE = 'provider-evidence-recon-1';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function makeOperationFact(
  overrides: Partial<ExternalReconciliationOperationFact> = {},
): ExternalReconciliationOperationFact {
  return {
    id: EXTERNAL_OPERATION_ID,
    operationVersion: 1,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    resourceType: 'WITHDRAWAL',
    resourceId: '00000000-0000-4000-8000-00000000000a',
    internalCommandId: '00000000-0000-4000-8000-00000000000b',
    customerId: '00000000-0000-4000-8000-00000000000c',
    walletAccountId: '00000000-0000-4000-8000-00000000000d',
    ledgerAccountId: '00000000-0000-4000-8000-00000000000e',
    targetMappingReference: `a6-target:${'f'.repeat(64)}`,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lifecycleState: ExternalOperationLifecycleState.PENDING_VERIFICATION,
    requestHash: 'd'.repeat(64),
    correlationId: CORRELATION_ID,
    requestId: 'request-recon-1',
    attemptCount: 1,
    maxAttempts: 3,
    version: 1,
    ...overrides,
  };
}

function makeSettlementFact(
  overrides: Partial<ExternalReconciliationSettlementFact> = {},
): ExternalReconciliationSettlementFact {
  return {
    id: SETTLEMENT_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    externalOperationReference: `external-operation:v1:${sha256(`NIBSS_NIP:${EXTERNAL_OPERATION_ID}:external-operation`)}`,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    customerId: '00000000-0000-4000-8000-00000000000c',
    walletAccountId: '00000000-0000-4000-8000-00000000000d',
    customerLedgerAccountId: '00000000-0000-4000-8000-00000000000e',
    settlementAssetLedgerAccountId: '00000000-0000-4000-8000-00000000000f',
    decision: ExternalSettlementDecision.SETTLE,
    status: ExternalSettlementStatus.POSTED,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lifecycleState: 'SETTLED',
    journalId: JOURNAL_ID,
    reversalJournalId: null,
    evidenceType: ExternalOperationReferenceType.TRANSACTION,
    evidenceValueHash: sha256(PROVIDER_REFERENCE_VALUE),
    evidenceValue: PROVIDER_REFERENCE_VALUE,
    evidenceNamespace: 'nibss.nip',
    evidenceSource: 'ACKNOWLEDGEMENT',
    evidenceHash: sha256(PROVIDER_REFERENCE_VALUE),
    idempotencyScope: 'external.partner.settlement.v1',
    idempotencyKey: SETTLEMENT_IDEMPOTENCY_KEY,
    requestHash: SETTLEMENT_REQUEST_HASH,
    correlationId: CORRELATION_ID,
    requestId: 'settlement-request-1',
    ownerPrincipal: 'a6-settlement-suspense-owner',
    postedAt: new Date('2026-08-08T01:00:00.000Z'),
    reversalPostedAt: null,
    ...overrides,
  };
}

function makeSuspenseFact(
  overrides: Partial<ExternalReconciliationSuspenseFact> = {},
): ExternalReconciliationSuspenseFact {
  return {
    id: SUSPENSE_ENTRY_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    externalOperationReference: `external-operation:v1:${sha256(`NIBSS_NIP:${EXTERNAL_OPERATION_ID}:external-operation`)}`,
    customerId: '00000000-0000-4000-8000-00000000000c',
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    reason: 'EVIDENCE_REFERENCE_MISSING',
    status: ExternalSuspenseStatus.OPEN,
    owner: 'finance-ledger-suspense',
    ownerPrincipal: 'a6-settlement-suspense-owner',
    evidenceHash: sha256(PROVIDER_REFERENCE_VALUE),
    lifecycleState: 'PENDING_VERIFICATION',
    rejectionCode: 'EVIDENCE_REFERENCE_MISSING',
    correlationId: CORRELATION_ID,
    requestId: 'suspense-request-1',
    reversalJournalId: null,
    settlementId: null,
    clearedAt: null,
    createdAt: new Date('2026-08-08T00:35:00.000Z'),
    agedHours: 1,
    ...overrides,
  };
}

function makeJournalFact(
  overrides: Partial<ExternalReconciliationJournalFact> = {},
): ExternalReconciliationJournalFact {
  return {
    id: JOURNAL_ID,
    idempotencyKey: SETTLEMENT_IDEMPOTENCY_KEY,
    requestHash: SETTLEMENT_REQUEST_HASH,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    status: 'POSTED',
    reference: EXTERNAL_OPERATION_ID,
    description:
      'a6-settlement:NIBSS_NIP:external.wallet.withdrawal.settlement:OUTBOUND_BANK_SETTLEMENT',
    correlationId: CORRELATION_ID,
    reversalOfJournalId: null,
    totalMinor: '1000',
    postedAt: new Date('2026-08-08T01:00:00.000Z'),
    externalOperationReference: `external-operation:v1:${sha256(`NIBSS_NIP:${EXTERNAL_OPERATION_ID}:external-operation`)}`,
    evidenceHash: sha256(PROVIDER_REFERENCE_VALUE),
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    verifiedProviderReferenceType: 'TRANSACTION',
    verifiedProviderReferenceValue: PROVIDER_REFERENCE_VALUE,
    verifiedProviderReferenceNamespace: 'nibss.nip',
    verifiedProviderSource: 'ACKNOWLEDGEMENT',
    settlementId: SETTLEMENT_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    ...overrides,
  };
}

function makeJournalLines(): ExternalReconciliationJournalLineFact[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000010',
      journalId: JOURNAL_ID,
      accountId: '00000000-0000-4000-8000-00000000000e',
      direction: 'DEBIT',
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    },
    {
      id: '00000000-0000-4000-8000-000000000011',
      journalId: JOURNAL_ID,
      accountId: '00000000-0000-4000-8000-00000000000f',
      direction: 'CREDIT',
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    },
  ];
}

function makeReferenceFact(
  overrides: Partial<ExternalReconciliationReferenceFact> = {},
): ExternalReconciliationReferenceFact {
  return {
    id: PROVIDER_REFERENCE_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    partnerKey: 'NIBSS_NIP',
    referenceType: ExternalOperationReferenceType.TRANSACTION,
    referenceValueHash: sha256(PROVIDER_REFERENCE_VALUE),
    referenceValue: PROVIDER_REFERENCE_VALUE,
    namespace: 'nibss.nip',
    source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
    observedAt: new Date('2026-08-08T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCallbackFact(
  overrides: Partial<ExternalReconciliationCallbackFact> = {},
): ExternalReconciliationCallbackFact {
  return {
    id: CALLBACK_RECEIPT_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    partnerKey: 'NIBSS_NIP',
    callbackEventId: 'callback-event-recon-1',
    payloadHash: 'a'.repeat(64),
    signatureHash: 'b'.repeat(64),
    providerReferenceType: ExternalOperationReferenceType.TRANSACTION,
    providerReferenceValueHash: sha256(PROVIDER_REFERENCE_VALUE),
    providerReferenceNamespace: 'nibss.nip',
    providerStatus: 'PROCESSING',
    providerOccurredAt: new Date('2026-08-08T00:00:00.000Z'),
    receivedAt: new Date('2026-08-08T00:00:30.000Z'),
    correlationId: CORRELATION_ID,
    status: ExternalCallbackReceiptStatus.RECEIVED,
    rejectionCode: null,
    ...overrides,
  };
}

function makeAuditFact(
  overrides: Partial<ExternalReconciliationAuditFact> = {},
): ExternalReconciliationAuditFact {
  return {
    id: AUDIT_EVENT_ID,
    entityType: 'A6_EXTERNAL_SETTLEMENT',
    entityId: SETTLEMENT_ID,
    action: 'SETTLEMENT_POSTED',
    correlationId: CORRELATION_ID,
    newValuesSummary: {
      externalOperationId: EXTERNAL_OPERATION_ID,
      settlementId: SETTLEMENT_ID,
      journalId: JOURNAL_ID,
      decision: 'SETTLE',
      status: 'POSTED',
      evidenceHash: sha256(PROVIDER_REFERENCE_VALUE),
    },
    ...overrides,
  };
}

function makeOutboxFact(
  overrides: Partial<ExternalReconciliationOutboxFact> = {},
): ExternalReconciliationOutboxFact {
  return {
    id: OUTBOX_EVENT_ID,
    eventType: 'A6_EXTERNAL_SETTLEMENT_POSTED',
    aggregateType: 'A6_EXTERNAL_SETTLEMENT',
    aggregateId: SETTLEMENT_ID,
    eventKey: `A6_EXTERNAL_SETTLEMENT_POSTED:${SETTLEMENT_ID}`,
    schemaVersion: 1,
    correlationId: CORRELATION_ID,
    causationId: null,
    payloadSummary: {
      externalOperationId: EXTERNAL_OPERATION_ID,
      settlementId: SETTLEMENT_ID,
      journalId: JOURNAL_ID,
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
    },
    ...overrides,
  };
}

function makeIdempotencyHint(
  overrides: Partial<ExternalReconciliationIdempotencyHint> = {},
): ExternalReconciliationIdempotencyHint {
  return {
    scope: 'external.partner.settlement.v1',
    key: SETTLEMENT_IDEMPOTENCY_KEY,
    status: 'COMPLETED',
    requestHash: SETTLEMENT_REQUEST_HASH,
    resourceId: SETTLEMENT_ID,
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    match: 'MATCH',
    ...overrides,
  };
}

function makeFacts(
  overrides: Partial<ExternalReconciliationFacts> = {},
): ExternalReconciliationFacts {
  return {
    externalOperationId: EXTERNAL_OPERATION_ID,
    operation: makeOperationFact(),
    references: [makeReferenceFact()],
    callbacks: [makeCallbackFact()],
    settlement: makeSettlementFact(),
    suspenseEntries: [],
    journal: makeJournalFact(),
    journalLines: makeJournalLines(),
    auditEvents: [makeAuditFact({ action: 'SETTLEMENT_POSTED' })],
    outboxEvents: [makeOutboxFact()],
    idempotencyHints: [makeIdempotencyHint()],
    ...overrides,
  };
}

function expectCode(
  facts: ExternalReconciliationFacts,
  code: ExternalReconciliationDiscrepancyCode,
  expectedStatus: VerificationStatus = VerificationStatus.ERROR,
) {
  const report = evaluateExternalReconciliation(facts, '2026-08-08T02:00:00.000Z');
  expect(report.discrepancies.map((discrepancy) => discrepancy.code)).toContain(code);
  expect(report.status).toBe(expectedStatus);
  expect(report.readOnly).toBe(true);
  expect(report.repairPerformed).toBe(false);
  return report;
}

describe('ExternalReconciliationService evaluator', () => {
  it('reports a complete external operation, settlement, journal, audit, outbox, and callback trace as PASS', () => {
    const report = evaluateExternalReconciliation(
      makeFacts({
        suspenseEntries: [
          makeSuspenseFact({
            status: ExternalSuspenseStatus.CLEARED,
            reversalJournalId: JOURNAL_ID,
            clearedAt: new Date('2026-08-08T01:30:00.000Z'),
            settlementId: SETTLEMENT_ID,
          }),
        ],
        auditEvents: [
          makeAuditFact({ action: 'SETTLEMENT_POSTED' }),
          makeAuditFact({
            action: 'SUSPENSE_RECORDED',
            entityId: EXTERNAL_OPERATION_ID,
            entityType: 'A6_EXTERNAL_OPERATION',
          }),
          makeAuditFact({ action: 'COMPENSATING_POSTED' }),
        ],
        outboxEvents: [
          makeOutboxFact(),
          makeOutboxFact({
            id: '00000000-0000-4000-8000-000000000099',
            eventType: 'A6_EXTERNAL_SETTLEMENT_SUSPENSE',
            aggregateId: SUSPENSE_ENTRY_ID,
          }),
          makeOutboxFact({
            id: '00000000-0000-4000-8000-000000000098',
            eventType: 'A6_EXTERNAL_SETTLEMENT_COMPENSATED',
          }),
        ],
      }),
      '2026-08-08T02:00:00.000Z',
    );

    expect(report).toMatchObject({
      status: VerificationStatus.PASS,
      readOnly: true,
      contractName: 'A6-EXTERNAL-RECONCILIATION',
      contractVersion: 1,
      repairPerformed: false,
    });
    expect(report.discrepancies).toHaveLength(0);
    expect(report.trace.externalSettlementId).toBe(SETTLEMENT_ID);
    expect(report.trace.externalSettlementJournalId).toBe(JOURNAL_ID);
    expect(report.trace.providerReferenceIds).toEqual([PROVIDER_REFERENCE_ID]);
    expect(report.trace.callbackReceiptIds).toEqual([CALLBACK_RECEIPT_ID]);
    expect(report.certification.partnerKey).toBe('NIBSS_NIP');
    expect(report.certification.capabilityKey).toBe('external.wallet.withdrawal.settlement');
    expect(report.certification.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.certification.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.certification.observedChecks.length).toBeGreaterThan(0);
    expect(report.replayHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('classifies a missing settlement for a verified operation', () => {
    expectCode(
      makeFacts({ settlement: null, journal: null, journalLines: [], idempotencyHints: [] }),
      ExternalReconciliationDiscrepancyCode.MISSING_SETTLEMENT,
      VerificationStatus.WARNING,
    );
  });

  it('classifies a missing journal for a posted settlement', () => {
    const facts = makeFacts({});
    facts.settlement = makeSettlementFact({ journalId: null });
    facts.journal = null;
    facts.journalLines = [];
    const report = evaluateExternalReconciliation(facts, '2026-08-08T02:00:00.000Z');
    expect(report.discrepancies.map((d) => d.code)).toContain(
      ExternalReconciliationDiscrepancyCode.MISSING_JOURNAL,
    );
    expect(report.status).toBe(VerificationStatus.ERROR);
  });

  it('classifies a missing suspense entry when a settlement is rejected', () => {
    const facts: ExternalReconciliationFacts = {
      externalOperationId: EXTERNAL_OPERATION_ID,
      operation: makeOperationFact(),
      references: [makeReferenceFact()],
      callbacks: [makeCallbackFact()],
      settlement: makeSettlementFact({ status: ExternalSettlementStatus.POSTED, journalId: null }),
      suspenseEntries: [],
      journal: null,
      journalLines: [],
      auditEvents: [
        makeAuditFact({
          action: 'SUSPENSE_RECORDED',
          entityId: EXTERNAL_OPERATION_ID,
          entityType: 'A6_EXTERNAL_OPERATION',
        }),
      ],
      outboxEvents: [
        makeOutboxFact({
          eventType: 'A6_EXTERNAL_SETTLEMENT_SUSPENSE',
          aggregateId: SUSPENSE_ENTRY_ID,
        }),
      ],
      idempotencyHints: [],
    };
    const report = evaluateExternalReconciliation(facts, '2026-08-08T02:00:00.000Z');
    expect(report.discrepancies.map((d) => d.code)).toContain(
      ExternalReconciliationDiscrepancyCode.MISSING_SUSPENSE_ENTRY,
    );
  });

  it('classifies provider/internal mismatch (amount)', () => {
    expectCode(
      makeFacts({
        settlement: makeSettlementFact({ amountMinor: '2000' }),
      }),
      ExternalReconciliationDiscrepancyCode.SETTLEMENT_AMOUNT_MISMATCH,
    );
  });

  it('classifies provider/internal mismatch (currency)', () => {
    expectCode(
      makeFacts({
        settlement: makeSettlementFact({ currency: 'USD' }),
      }),
      ExternalReconciliationDiscrepancyCode.SETTLEMENT_CURRENCY_MISMATCH,
    );
  });

  it('classifies a journal balance mismatch', () => {
    expectCode(
      makeFacts({
        journalLines: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            journalId: JOURNAL_ID,
            accountId: '00000000-0000-4000-8000-00000000000e',
            direction: 'DEBIT',
            amountMinor: '1000',
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
          },
          {
            id: '00000000-0000-4000-8000-000000000011',
            journalId: JOURNAL_ID,
            accountId: '00000000-0000-4000-8000-00000000000f',
            direction: 'CREDIT',
            amountMinor: '900',
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
          },
        ],
      }),
      ExternalReconciliationDiscrepancyCode.JOURNAL_BALANCE_MISMATCH,
    );
  });

  it('classifies an idempotency hash mismatch (duplicate settlement detection)', () => {
    expectCode(
      makeFacts({
        idempotencyHints: [makeIdempotencyHint({ requestHash: 'f'.repeat(64), match: 'MISMATCH' })],
      }),
      ExternalReconciliationDiscrepancyCode.IDEMPOTENCY_HASH_MISMATCH,
    );
  });

  it('classifies a callback authenticity rejection', () => {
    expectCode(
      makeFacts({
        callbacks: [
          makeCallbackFact({
            status: ExternalCallbackReceiptStatus.REJECTED,
            rejectionCode: 'CALLBACK_SIGNATURE_INVALID',
          }),
        ],
      }),
      ExternalReconciliationDiscrepancyCode.CALLBACK_AUTHENTICITY_REJECTED,
    );
  });

  it('classifies a duplicate provider reference', () => {
    expectCode(
      makeFacts({
        references: [
          makeReferenceFact(),
          makeReferenceFact({ id: '00000000-0000-4000-8000-000000000099' }),
        ],
      }),
      ExternalReconciliationDiscrepancyCode.DUPLICATE_PROVIDER_REFERENCE,
    );
  });

  it('classifies a missing audit event', () => {
    expectCode(
      makeFacts({
        auditEvents: [],
      }),
      ExternalReconciliationDiscrepancyCode.MISSING_AUDIT_EVIDENCE,
      VerificationStatus.WARNING,
    );
  });

  it('classifies a missing outbox fact', () => {
    expectCode(
      makeFacts({
        outboxEvents: [],
      }),
      ExternalReconciliationDiscrepancyCode.MISSING_OUTBOX_FACT,
      VerificationStatus.WARNING,
    );
  });

  it('classifies a terminal lifecycle state', () => {
    expectCode(
      makeFacts({
        operation: makeOperationFact({ lifecycleState: ExternalOperationLifecycleState.FAILED }),
      }),
      ExternalReconciliationDiscrepancyCode.LIFECYCLE_TERMINAL,
    );
  });

  it('classifies a partner capability mismatch', () => {
    expectCode(
      makeFacts({
        operation: makeOperationFact({
          partnerKey: 'OTHER_PARTNER',
          capabilityKey: 'other.capability',
        }),
      }),
      ExternalReconciliationDiscrepancyCode.PARTNER_CAPABILITY_MISMATCH,
    );
  });

  it('classifies a settlement reversal orphan', () => {
    const facts = makeFacts({
      settlement: makeSettlementFact({
        status: ExternalSettlementStatus.REVERSED,
        reversalJournalId: REVERSAL_JOURNAL_ID,
        reversalPostedAt: new Date('2026-08-08T02:00:00.000Z'),
      }),
    });
    facts.settlement!.journalId = null;
    expectCode(facts, ExternalReconciliationDiscrepancyCode.SETTLEMENT_REVERSAL_ORPHAN);
  });

  it('classifies a settlement evidence mismatch', () => {
    expectCode(
      makeFacts({
        references: [
          makeReferenceFact({
            referenceType: ExternalOperationReferenceType.OPERATION,
            referenceValue: 'different-evidence',
          }),
        ],
      }),
      ExternalReconciliationDiscrepancyCode.SETTLEMENT_EVIDENCE_MISMATCH,
    );
  });

  it('classifies an outbox payload mismatch', () => {
    expectCode(
      makeFacts({
        outboxEvents: [
          makeOutboxFact({
            payloadSummary: {
              externalOperationId: EXTERNAL_OPERATION_ID,
              settlementId: SETTLEMENT_ID,
              journalId: JOURNAL_ID,
              amountMinor: '2000',
              currency: 'NGN',
              accountingUnit: 'CUSTOMER_FUNDS',
              partnerKey: 'NIBSS_NIP',
              capabilityKey: 'external.wallet.withdrawal.settlement',
              operationType: 'OUTBOUND_BANK_SETTLEMENT',
            },
          }),
        ],
      }),
      ExternalReconciliationDiscrepancyCode.OUTBOX_PAYLOAD_MISMATCH,
    );
  });

  it('classifies a missing operation', () => {
    const report = evaluateExternalReconciliation(
      makeFacts({ operation: null }),
      '2026-08-08T02:00:00.000Z',
    );
    expect(report.discrepancies.map((d) => d.code)).toContain(
      ExternalReconciliationDiscrepancyCode.OPERATION_NOT_FOUND,
    );
    expect(report.status).toBe(VerificationStatus.ERROR);
  });

  it('replay consistency: identical facts produce identical discrepancy list and replay hash', () => {
    const facts = makeFacts();
    const first = evaluateExternalReconciliation(facts, '2026-08-08T02:00:00.000Z');
    const second = evaluateExternalReconciliation(facts, '2026-08-08T02:00:00.000Z');
    expect(second.replayHash).toBe(first.replayHash);
    expect(second.discrepancies.map((d) => d.code)).toEqual(first.discrepancies.map((d) => d.code));
  });

  it('certification evidence names the partner, capability, contract version, and adapter version', () => {
    const report = evaluateExternalReconciliation(makeFacts(), '2026-08-08T02:00:00.000Z');
    expect(report.certification).toMatchObject({
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      capabilityVersion: '1',
      adapterVersion: 'a6-adapter-1',
      contractName: 'A6-EXTERNAL-RECONCILIATION',
      contractVersion: 1,
      contractReference: 'docs/ADR/ADR-0053-Independent-External-Reconciliation.md',
      contractDocument: 'docs/A6-EXTERNAL-RECONCILIATION-CONTRACT.md',
    });
    expect(report.certification.expectedChecks.length).toBeGreaterThan(0);
    expect(report.certification.observedChecks.length).toBe(
      report.certification.expectedChecks.length,
    );
    expect(report.certification.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.certification.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('support trace classifies fields with INTERNAL/CONFIDENTIAL/RESTRICTED sensitivity', () => {
    const cleanReport = evaluateExternalReconciliation(makeFacts(), '2026-08-08T02:00:00.000Z');
    expect(cleanReport.trace.supportClassification).toBe('INTERNAL');
    expect(cleanReport.trace.externalOperationId).toBe(EXTERNAL_OPERATION_ID);
    expect(cleanReport.trace.customerId.length).toBeGreaterThan(0);
    expect(cleanReport.trace.settlementAssetLedgerAccountId).toBe(
      '00000000-0000-4000-8000-00000000000f',
    );
    expect(cleanReport.trace.correlationId).toBe(CORRELATION_ID);
    expect(cleanReport.trace.generatedAt).toBe('2026-08-08T02:00:00.000Z');

    const errorReport = evaluateExternalReconciliation(
      makeFacts({
        operation: makeOperationFact({ currency: 'USD' }),
      }),
      '2026-08-08T02:00:00.000Z',
    );
    expect(errorReport.trace.supportClassification).toBe('RESTRICTED');

    const warningReport = evaluateExternalReconciliation(
      makeFacts({
        callbacks: [],
      }),
      '2026-08-08T02:00:00.000Z',
    );
    expect(warningReport.trace.supportClassification).toBe('CONFIDENTIAL');
  });

  it('support trace exposes canonical IDs without raw secrets or restricted payloads', () => {
    const report = evaluateExternalReconciliation(makeFacts(), '2026-08-08T02:00:00.000Z');
    const traceJson = JSON.stringify(report.trace);
    expect(traceJson).not.toContain('raw-secret');
    expect(traceJson).not.toContain('signatureHash');
  });

  it('reconciliation report declares readOnly: true and repairPerformed: false', () => {
    const report = evaluateExternalReconciliation(makeFacts(), '2026-08-08T02:00:00.000Z');
    expect(report.readOnly).toBe(true);
    expect(report.repairPerformed).toBe(false);
  });
});

class ReadOnlyReconciliationDataSource {
  readOnly = false;
  operationRows: unknown[] = [];
  referenceRows: unknown[] = [];
  callbackRows: unknown[] = [];
  journalRows: unknown[] = [];
  journalLineRows: unknown[] = [];
  auditRows: unknown[] = [];
  outboxRows: unknown[] = [];
  idempotencyRows: unknown[] = [];

  setOperation(rows: unknown[]) {
    this.operationRows = rows;
  }
  setReferences(rows: unknown[]) {
    this.referenceRows = rows;
  }
  setCallbacks(rows: unknown[]) {
    this.callbackRows = rows;
  }
  setJournals(rows: unknown[]) {
    this.journalRows = rows;
  }
  setJournalLines(rows: unknown[]) {
    this.journalLineRows = rows;
  }
  setAudit(rows: unknown[]) {
    this.auditRows = rows;
  }
  setOutbox(rows: unknown[]) {
    this.outboxRows = rows;
  }
  setIdempotency(rows: unknown[]) {
    this.idempotencyRows = rows;
  }

  transaction<T>(
    _isolation: string,
    callback: (manager: {
      query: (sql: string, parameters?: unknown[]) => Promise<unknown[]>;
    }) => Promise<T>,
  ): Promise<T> {
    const manager = {
      query: async (sql: string): Promise<unknown[]> => {
        await Promise.resolve();
        if (sql.startsWith('SET TRANSACTION READ ONLY')) {
          this.readOnly = true;
          return [];
        }
        if (
          sql.includes('SELECT id::text AS external_operation_id') &&
          sql.includes('FROM external_operations')
        ) {
          return this.operationRows.map((row) => ({
            external_operation_id: (row as { id?: string }).id ?? EXTERNAL_OPERATION_ID,
          }));
        }
        if (sql.includes('FROM external_operations')) {
          return this.operationRows;
        }
        if (sql.includes('FROM external_operation_references')) {
          return this.referenceRows;
        }
        if (sql.includes('FROM external_callback_receipts')) {
          return this.callbackRows;
        }
        if (sql.includes('FROM ledger_journals')) {
          return this.journalRows;
        }
        if (sql.includes('FROM ledger_lines')) {
          return this.journalLineRows;
        }
        if (sql.includes('FROM audit_events')) {
          return this.auditRows;
        }
        if (sql.includes('FROM outbox_events')) {
          return this.outboxRows;
        }
        if (sql.includes('FROM idempotency_records')) {
          return this.idempotencyRows;
        }
        return [];
      },
    };
    return callback(manager);
  }
}

function makeSettlementView(
  overrides: Partial<ExternalSettlementView> = {},
): ExternalSettlementView {
  return {
    settlementVersion: 1,
    settlementId: SETTLEMENT_ID,
    externalOperationId: EXTERNAL_OPERATION_ID,
    externalOperationReference: `external-operation:v1:${sha256(`NIBSS_NIP:${EXTERNAL_OPERATION_ID}:external-operation`)}`,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    customerId: '00000000-0000-4000-8000-00000000000c',
    walletAccountId: '00000000-0000-4000-8000-00000000000d',
    customerLedgerAccountId: '00000000-0000-4000-8000-00000000000e',
    settlementAssetLedgerAccountId: '00000000-0000-4000-8000-00000000000f',
    decision: ExternalSettlementDecision.SETTLE,
    status: ExternalSettlementStatus.POSTED,
    amountMinor: '1000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lifecycleState: 'SETTLED',
    journalId: JOURNAL_ID,
    reversalJournalId: null,
    evidence: {
      referenceType: 'TRANSACTION' as const,
      referenceValue: PROVIDER_REFERENCE_VALUE,
      namespace: 'nibss.nip',
      source: ExternalOperationReferenceSource.ACKNOWLEDGEMENT,
      observedAt: new Date('2026-08-08T00:00:00.000Z'),
      evidenceHash: sha256(PROVIDER_REFERENCE_VALUE),
    },
    idempotencyScope: 'external.partner.settlement.v1',
    idempotencyKey: SETTLEMENT_IDEMPOTENCY_KEY,
    requestHash: SETTLEMENT_REQUEST_HASH,
    correlationId: CORRELATION_ID,
    requestId: 'settlement-request-1',
    ownerPrincipal: 'a6-settlement-suspense-owner',
    postedAt: new Date('2026-08-08T01:00:00.000Z'),
    reversalPostedAt: null,
    createdAt: new Date('2026-08-08T00:30:00.000Z'),
    updatedAt: new Date('2026-08-08T01:00:00.000Z'),
    replayed: false,
    ...overrides,
  };
}

class FakeExternalSettlementService {
  private settlement: ExternalSettlementView | null = null;
  private suspense: ExternalSuspenseEntryView[] = [];

  setSettlement(settlement: ExternalSettlementView | null) {
    this.settlement = settlement;
  }
  setSuspense(suspense: ExternalSuspenseEntryView[]) {
    this.suspense = suspense;
  }
  getByOperation(): Promise<ExternalSettlementView | null> {
    return Promise.resolve(this.settlement);
  }
  getSuspenseForOperation(): Promise<ExternalSuspenseEntryView[]> {
    return Promise.resolve(this.suspense);
  }
}

class FakeExternalOperationService {
  get() {
    return Promise.resolve({} as never);
  }
}

function makeOperationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EXTERNAL_OPERATION_ID,
    operation_version: 1,
    partner_key: 'NIBSS_NIP',
    capability_key: 'external.wallet.withdrawal.settlement',
    operation_type: 'OUTBOUND_BANK_SETTLEMENT',
    resource_type: 'WITHDRAWAL',
    resource_id: '00000000-0000-4000-8000-00000000000a',
    internal_command_id: '00000000-0000-4000-8000-00000000000b',
    customer_id: '00000000-0000-4000-8000-00000000000c',
    wallet_account_id: '00000000-0000-4000-8000-00000000000d',
    ledger_account_id: '00000000-0000-4000-8000-00000000000e',
    target_mapping_reference: `a6-target:${'f'.repeat(64)}`,
    amount_minor: '1000',
    currency: 'NGN',
    accounting_unit: 'CUSTOMER_FUNDS',
    internal_idempotency_scope: 'external.partner.operation.v1',
    internal_idempotency_key: 'operation-key-1',
    provider_idempotency_scope: 'nibss.nip.external-operation.v1',
    provider_idempotency_key: 'provider-key-1',
    request_hash: 'd'.repeat(64),
    request_id: 'request-1',
    correlation_id: CORRELATION_ID,
    trace_id: 'trace-1',
    causation_id: null,
    lifecycle_state: 'PENDING_VERIFICATION',
    attempt_count: 1,
    max_attempts: 3,
    next_retry_at: null,
    last_attempt_at: null,
    provider_status: 'PENDING',
    failure_code: null,
    failure_message: null,
    failure_status_code: null,
    recovery_reference: null,
    submitting_at: null,
    pending_at: null,
    pending_verification_at: null,
    unknown_at: null,
    manual_review_at: null,
    failed_at: null,
    cancelled_at: null,
    version: 1,
    created_at: new Date('2026-08-08T00:00:00.000Z'),
    updated_at: new Date('2026-08-08T00:00:00.000Z'),
    ...overrides,
  };
}

function makeJournalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOURNAL_ID,
    idempotency_key: SETTLEMENT_IDEMPOTENCY_KEY,
    request_hash: SETTLEMENT_REQUEST_HASH,
    currency: 'NGN',
    accounting_unit: 'CUSTOMER_FUNDS',
    status: 'POSTED',
    reference: EXTERNAL_OPERATION_ID,
    description:
      'a6-settlement:NIBSS_NIP:external.wallet.withdrawal.settlement:OUTBOUND_BANK_SETTLEMENT',
    correlation_id: CORRELATION_ID,
    reversal_of_journal_id: null,
    total_minor: '1000',
    posted_at: new Date('2026-08-08T01:00:00.000Z'),
    metadata: {
      externalOperationId: EXTERNAL_OPERATION_ID,
      externalOperationReference: `external-operation:v1:${sha256(`NIBSS_NIP:${EXTERNAL_OPERATION_ID}:external-operation`)}`,
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
      verifiedProviderReferenceHash: sha256(PROVIDER_REFERENCE_VALUE),
      verifiedProviderReferenceType: 'TRANSACTION',
      verifiedProviderReferenceValue: PROVIDER_REFERENCE_VALUE,
      verifiedProviderReferenceNamespace: 'nibss.nip',
      verifiedProviderSource: 'ACKNOWLEDGEMENT',
      settlementId: SETTLEMENT_ID,
    },
    ...overrides,
  };
}

function makeReferenceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROVIDER_REFERENCE_ID,
    external_operation_id: EXTERNAL_OPERATION_ID,
    partner_key: 'NIBSS_NIP',
    reference_type: 'TRANSACTION',
    reference_value: PROVIDER_REFERENCE_VALUE,
    namespace: 'nibss.nip',
    source: 'ACKNOWLEDGEMENT',
    observed_at: new Date('2026-08-08T00:00:00.000Z'),
    ...overrides,
  };
}

function makeCallbackRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CALLBACK_RECEIPT_ID,
    external_operation_id: EXTERNAL_OPERATION_ID,
    partner_key: 'NIBSS_NIP',
    callback_event_id: 'callback-event-recon-1',
    payload_hash: 'a'.repeat(64),
    signature_hash: 'b'.repeat(64),
    provider_reference_type: 'TRANSACTION',
    provider_reference_value: PROVIDER_REFERENCE_VALUE,
    provider_reference_namespace: 'nibss.nip',
    provider_status: 'PROCESSING',
    provider_occurred_at: new Date('2026-08-08T00:00:00.000Z'),
    received_at: new Date('2026-08-08T00:00:30.000Z'),
    correlation_id: CORRELATION_ID,
    status: 'RECEIVED',
    rejection_code: null,
    ...overrides,
  };
}

function makeAuditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AUDIT_EVENT_ID,
    entity_type: 'A6_EXTERNAL_SETTLEMENT',
    entity_id: SETTLEMENT_ID,
    action: 'SETTLEMENT_POSTED',
    correlation_id: CORRELATION_ID,
    new_values: {
      externalOperationId: EXTERNAL_OPERATION_ID,
      settlementId: SETTLEMENT_ID,
      journalId: JOURNAL_ID,
      decision: 'SETTLE',
      status: 'POSTED',
      evidenceHash: sha256(PROVIDER_REFERENCE_VALUE),
    },
    ...overrides,
  };
}

function makeOutboxRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: OUTBOX_EVENT_ID,
    event_type: 'A6_EXTERNAL_SETTLEMENT_POSTED',
    aggregate_type: 'A6_EXTERNAL_SETTLEMENT',
    aggregate_id: SETTLEMENT_ID,
    event_key: `A6_EXTERNAL_SETTLEMENT_POSTED:${SETTLEMENT_ID}`,
    schema_version: 1,
    correlation_id: CORRELATION_ID,
    causation_id: null,
    payload: {
      externalOperationId: EXTERNAL_OPERATION_ID,
      settlementId: SETTLEMENT_ID,
      journalId: JOURNAL_ID,
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      operationType: 'OUTBOUND_BANK_SETTLEMENT',
    },
    ...overrides,
  };
}

function makeJournalLineRows(): Record<string, unknown>[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000010',
      journal_id: JOURNAL_ID,
      account_id: '00000000-0000-4000-8000-00000000000e',
      direction: 'DEBIT',
      amount_minor: '1000',
      currency: 'NGN',
      accounting_unit: 'CUSTOMER_FUNDS',
    },
    {
      id: '00000000-0000-4000-8000-000000000011',
      journal_id: JOURNAL_ID,
      account_id: '00000000-0000-4000-8000-00000000000f',
      direction: 'CREDIT',
      amount_minor: '1000',
      currency: 'NGN',
      accounting_unit: 'CUSTOMER_FUNDS',
    },
  ];
}

function makeIdempotencyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'external.partner.settlement.v1',
    key: SETTLEMENT_IDEMPOTENCY_KEY,
    status: 'COMPLETED',
    request_hash: SETTLEMENT_REQUEST_HASH,
    resource_id: SETTLEMENT_ID,
    expires_at: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ExternalReconciliationService', () => {
  it('uses a repeatable-read read-only transaction and never exposes a write path', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const settlementService = new FakeExternalSettlementService();
    settlementService.setSettlement(makeSettlementView());
    const operationService = new FakeExternalOperationService();
    const service = new ExternalReconciliationService(
      dataSource as unknown as DataSource,
      operationService as never,
      settlementService as never,
    );

    dataSource.setOperation([makeOperationRow()]);
    dataSource.setReferences([makeReferenceRow()]);
    dataSource.setCallbacks([makeCallbackRow()]);
    dataSource.setJournals([makeJournalRow()]);
    dataSource.setJournalLines(makeJournalLineRows());
    dataSource.setAudit([makeAuditRow()]);
    dataSource.setOutbox([makeOutboxRow()]);
    dataSource.setIdempotency([makeIdempotencyRow()]);

    const report = await service.reconcileOperation(EXTERNAL_OPERATION_ID);

    expect(dataSource.readOnly).toBe(true);
    expect(report.readOnly).toBe(true);
    expect(report.repairPerformed).toBe(false);
    expect(report.status).toBe(VerificationStatus.PASS);
    expect(report.certification.partnerKey).toBe('NIBSS_NIP');
  });

  it('produces a deterministic certification fingerprint across two runs with identical facts', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const settlementService = new FakeExternalSettlementService();
    settlementService.setSettlement(makeSettlementView());
    const operationService = new FakeExternalOperationService();
    const service = new ExternalReconciliationService(
      dataSource as unknown as DataSource,
      operationService as never,
      settlementService as never,
    );
    dataSource.setOperation([makeOperationRow()]);
    dataSource.setReferences([makeReferenceRow()]);
    dataSource.setCallbacks([makeCallbackRow()]);
    dataSource.setJournals([makeJournalRow()]);
    dataSource.setJournalLines(makeJournalLineRows());
    dataSource.setAudit([makeAuditRow()]);
    dataSource.setOutbox([makeOutboxRow()]);
    dataSource.setIdempotency([makeIdempotencyRow()]);

    const generatedAt = '2026-08-08T02:00:00.000Z';
    const first = await service.reconcileOperationAt(EXTERNAL_OPERATION_ID, generatedAt);
    const second = await service.reconcileOperationAt(EXTERNAL_OPERATION_ID, generatedAt);
    expect(second.certification.fingerprint).toBe(first.certification.fingerprint);
    expect(second.certification.evidenceHash).toBe(first.certification.evidenceHash);
  });

  it('rejects an invalid external operation id', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const service = new ExternalReconciliationService(
      dataSource as unknown as DataSource,
      new FakeExternalOperationService() as never,
      new FakeExternalSettlementService() as never,
    );
    await expect(service.reconcileOperation('not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reports missing operation as ERROR when no source rows exist', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const settlementService = new FakeExternalSettlementService();
    const service = new ExternalReconciliationService(
      dataSource as unknown as DataSource,
      new FakeExternalOperationService() as never,
      settlementService as never,
    );
    dataSource.setOperation([]);

    const report = await service.reconcileOperation(EXTERNAL_OPERATION_ID);

    expect(report.status).toBe(VerificationStatus.ERROR);
    expect(report.discrepancies.map((d) => d.code)).toContain(
      ExternalReconciliationDiscrepancyCode.OPERATION_NOT_FOUND,
    );
  });

  it('emits MISSING_SETTLEMENT when settlement is absent for a verified operation', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const settlementService = new FakeExternalSettlementService();
    settlementService.setSettlement(null);
    const service = new ExternalReconciliationService(
      dataSource as unknown as DataSource,
      new FakeExternalOperationService() as never,
      settlementService as never,
    );
    dataSource.setOperation([makeOperationRow()]);
    dataSource.setReferences([makeReferenceRow()]);
    dataSource.setCallbacks([makeCallbackRow()]);
    dataSource.setJournals([]);
    dataSource.setJournalLines([]);
    dataSource.setAudit([]);
    dataSource.setOutbox([]);
    dataSource.setIdempotency([]);

    const report = await service.reconcileOperation(EXTERNAL_OPERATION_ID);

    expect(report.discrepancies.map((d) => d.code)).toContain(
      ExternalReconciliationDiscrepancyCode.MISSING_SETTLEMENT,
    );
    expect(report.discrepancies.map((d) => d.code)).toContain(
      ExternalReconciliationDiscrepancyCode.MISSING_OUTBOX_FACT,
    );
  });

  it('reconciles all operations and aggregates their statuses', async () => {
    const dataSource = new ReadOnlyReconciliationDataSource();
    const settlementService = new FakeExternalSettlementService();
    settlementService.setSettlement(makeSettlementView());
    const service = new ExternalReconciliationService(
      dataSource as unknown as DataSource,
      new FakeExternalOperationService() as never,
      settlementService as never,
    );
    dataSource.setOperation([makeOperationRow({ id: EXTERNAL_OPERATION_ID })]);
    dataSource.setReferences([makeReferenceRow()]);
    dataSource.setCallbacks([makeCallbackRow()]);
    dataSource.setJournals([makeJournalRow()]);
    dataSource.setJournalLines(makeJournalLineRows());
    dataSource.setAudit([makeAuditRow()]);
    dataSource.setOutbox([makeOutboxRow()]);
    dataSource.setIdempotency([makeIdempotencyRow()]);

    const batch = await service.reconcileAll();
    expect(batch.readOnly).toBe(true);
    expect(batch.repairPerformed).toBe(false);
    expect(batch.reports).toHaveLength(1);
    expect(batch.status).toBe(VerificationStatus.PASS);
  });
});
