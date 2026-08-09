import type { EntityManager } from 'typeorm';

import type { A7ProductReconciliationReportV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationBatchReportV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationResultV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationBatchResultV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationCheck } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationDiscrepancy } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationSupportTraceV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationCertificationEvidenceV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationHandoffV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationCommandV1 } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationConsumerPorts } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationSeverity } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationOwner } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationRecoveryState } from '../src/policy/a7-product-reconciliation.types';
import type { A7ProductReconciliationSensitivity } from '../src/policy/a7-product-reconciliation.types';

describe('A7T09 types', () => {
  it('exposes the A7 product reconciliation report shape', () => {
    const report: A7ProductReconciliationReportV1 = {
      contractName: 'A7-PRODUCT-RECONCILIATION',
      contractVersion: 1,
      reconciliationId: '00000000-0000-4000-8000-000000000001',
      reconciliationReference: 'a7-product-reconciliation:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation:v1:abc',
      productLifecycleReference: null,
      productCommandReference: null,
      productCustomerBindingMapReference: null,
      a2AuthorizationContextReference: null,
      a4ProductPolicyDecisionReference: null,
      a5LedgerJournalReference: null,
      a6ExternalOperationReference: null,
      a6CallbackReceiptReference: null,
      a6T08SettlementReference: null,
      a6T08SuspenseReference: null,
      a6ProviderReferenceReference: null,
      checks: [],
      discrepancies: [],
      a6T09ExternalReconciliationReference: null,
      a6T09ExternalReconciliationDiscrepancyCount: null,
      productFact: {
        productOperation: null,
        productLifecycle: null,
        productCommand: null,
        productCustomerBinding: null,
        productFinancialEffect: null,
      },
      authorityFact: {
        a2AuthorizationContext: null,
        a4ProductPolicyDecision: null,
        a5LedgerJournal: null,
        a6ExternalOperation: null,
        a6CallbackReceipt: null,
        a6T08Settlement: null,
        a6T08Suspense: [],
        a6ProviderReference: null,
        a6PartnerOutage: null,
        a6ReportAvailability: null,
      },
      notificationFact: {
        notificationDispatch: null,
      },
      operationsFact: {
        audit: [],
        idempotency: [],
        outbox: [],
        diagnostics: [],
      },
      supportTrace: null,
      certificationEvidence: null,
      handoff: {
        contractName: 'A7-PRODUCT-RECONCILIATION',
        contractVersion: 1,
        handoffScope: 'a7-product-reconciliation-handoff.v1',
        productOperationReference: 'a7-product-operation:v1:abc',
        a6ExternalOperationReference: null,
        a6T08SettlementId: null,
        a6T08SuspenseId: null,
        a5LedgerJournalId: null,
        a6ProviderReferenceId: null,
        a6CallbackReceiptId: null,
        issuedAt: '2026-08-09T00:00:00.000Z',
        expiresAt: '2026-08-09T00:15:00.000Z',
        correlationId: 'correlation-1',
        requestId: 'request-1',
        traceId: 'trace-1',
        causationId: null,
      },
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      causationId: null,
      queryUnavailable: false,
    };
    expect(report.contractName).toBe('A7-PRODUCT-RECONCILIATION');
    expect(report.checks).toEqual([]);
    expect(report.discrepancies).toEqual([]);
  });

  it('exposes the A7 product reconciliation batch report shape', () => {
    const report: A7ProductReconciliationBatchReportV1 = {
      contractName: 'A7-PRODUCT-RECONCILIATION',
      contractVersion: 1,
      batchId: '00000000-0000-4000-8000-000000000002',
      batchReference: 'a7-product-reconciliation-batch:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      total: 1,
      withDiscrepancies: 0,
      withErrors: 0,
      withWarnings: 0,
      queryUnavailable: 0,
      reports: [],
      generatedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
    };
    expect(report.total).toBe(1);
    expect(report.reports).toEqual([]);
  });

  it('exposes the A7 product reconciliation result envelope', () => {
    const result: A7ProductReconciliationResultV1 = {
      valid: false,
      failure: {
        contractName: 'A7-PRODUCT-RECONCILIATION',
        contractVersion: 1,
        code: 'A7_PRODUCT_RECONCILIATION_QUERY_UNAVAILABLE',
        message: 'query unavailable',
        correlationId: 'correlation-1',
        requestId: 'request-1',
        createdAt: '2026-08-09T00:00:00.000Z',
      },
    };
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe('A7_PRODUCT_RECONCILIATION_QUERY_UNAVAILABLE');
    }
  });

  it('exposes the A7 product reconciliation batch result envelope', () => {
    const result: A7ProductReconciliationBatchResultV1 = {
      valid: false,
      failure: {
        contractName: 'A7-PRODUCT-RECONCILIATION',
        contractVersion: 1,
        code: 'A7_PRODUCT_RECONCILIATION_INVALID_COMMAND',
        message: 'invalid command',
        correlationId: 'correlation-1',
        requestId: 'request-1',
        createdAt: '2026-08-09T00:00:00.000Z',
      },
    };
    expect(result.valid).toBe(false);
  });

  it('exposes the A7 product reconciliation check shape', () => {
    const check: A7ProductReconciliationCheck = {
      key: 'PRODUCT_OPERATION_PRESENT',
      status: 'OK',
      message: null,
    };
    expect(check.status).toBe('OK');
  });

  it('exposes the A7 product reconciliation discrepancy shape', () => {
    const discrepancy: A7ProductReconciliationDiscrepancy = {
      code: 'A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_OPERATION',
      severity: 'ERROR',
      owner: 'RECONCILIATION',
      recoveryState: 'MANUAL_REVIEW_REQUIRED',
      productOperationReference: null,
      a6ExternalOperationReference: null,
      a6T08SettlementId: null,
      a6T08SuspenseId: null,
      a5LedgerJournalId: null,
      a6ProviderReferenceId: null,
      a6CallbackReceiptId: null,
      notificationDispatchId: null,
      scopeValue: null,
      message: 'product operation missing',
    };
    expect(discrepancy.severity).toBe('ERROR');
  });

  it('exposes the A7 product reconciliation support trace shape', () => {
    const trace: A7ProductReconciliationSupportTraceV1 = {
      contractName: 'A7-PRODUCT-RECONCILIATION',
      contractVersion: 1,
      supportTraceReference: 'a7-product-support-trace:v1:abc',
      productOperationReference: 'a7-product-operation:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      customerId: '00000000-0000-4000-8000-000000000001',
      a6ExternalOperationReference: null,
      a6T08SettlementId: null,
      a6T08SuspenseId: null,
      a5LedgerJournalId: null,
      a6ProviderReferenceId: null,
      a6CallbackReceiptId: null,
      auditEventIds: [],
      outboxEventIds: [],
      idempotencyRecordIds: [],
      diagnosticsEventIds: [],
      sensitivity: 'INTERNAL',
      issuedAt: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-08-09T00:15:00.000Z',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      traceId: 'trace-1',
      causationId: null,
    };
    expect(trace.sensitivity).toBe('INTERNAL');
  });

  it('exposes the A7 product reconciliation certification evidence shape', () => {
    const evidence: A7ProductReconciliationCertificationEvidenceV1 = {
      contractName: 'A7-PRODUCT-RECONCILIATION',
      contractVersion: 1,
      certificationReference: 'a7-product-certification:v1:abc',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      certificationCase: 'CERT_HAPPY_PATH',
      handoffReference: 'a7-product-reconciliation-handoff:v1:abc',
      a6PartnerCertificationReference: null,
      discrepancyCount: 0,
      errorCount: 0,
      warningCount: 0,
      recordedAt: '2026-08-09T00:00:00.000Z',
      correlationId: 'correlation-1',
    };
    expect(evidence.certificationCase).toBe('CERT_HAPPY_PATH');
  });

  it('exposes the A7 product reconciliation handoff shape', () => {
    const handoff: A7ProductReconciliationHandoffV1 = {
      contractName: 'A7-PRODUCT-RECONCILIATION',
      contractVersion: 1,
      handoffScope: 'a7-product-reconciliation-handoff.v1',
      productOperationReference: 'a7-product-operation:v1:abc',
      a6ExternalOperationReference: null,
      a6T08SettlementId: null,
      a6T08SuspenseId: null,
      a5LedgerJournalId: null,
      a6ProviderReferenceId: null,
      a6CallbackReceiptId: null,
      issuedAt: '2026-08-09T00:00:00.000Z',
      expiresAt: '2026-08-09T00:15:00.000Z',
      correlationId: 'correlation-1',
      requestId: 'request-1',
      traceId: 'trace-1',
      causationId: null,
    };
    expect(handoff.handoffScope).toBe('a7-product-reconciliation-handoff.v1');
  });

  it('exposes the A7 product reconciliation command shape', () => {
    const command: A7ProductReconciliationCommandV1 = {
      contractName: 'A7-PRODUCT-RECONCILIATION',
      contractVersion: 1,
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      productOperationReference: 'a7-product-operation:v1:abc',
      a6ExternalOperationReference: null,
      a6T08SettlementId: null,
      a6T08SuspenseId: null,
      a5LedgerJournalId: null,
      a6ProviderReferenceId: null,
      a6CallbackReceiptId: null,
      includeSupportTrace: true,
      includeCertificationEvidence: false,
      certificationCase: null,
      requestContext: {
        requestId: 'request-1',
        correlationId: 'correlation-1',
        traceId: 'trace-1',
      },
      causationId: null,
    };
    expect(command.productKey).toBe('VIRTUAL_ACCOUNT');
  });

  it('exposes the A7 product reconciliation severity, owner, recovery-state, and sensitivity vocabulary', () => {
    const severity: A7ProductReconciliationSeverity = 'ERROR';
    const owner: A7ProductReconciliationOwner = 'FINANCE';
    const recoveryState: A7ProductReconciliationRecoveryState = 'MANUAL_REVIEW_REQUIRED';
    const sensitivity: A7ProductReconciliationSensitivity = 'CONFIDENTIAL';
    expect(severity).toBe('ERROR');
    expect(owner).toBe('FINANCE');
    expect(recoveryState).toBe('MANUAL_REVIEW_REQUIRED');
    expect(sensitivity).toBe('CONFIDENTIAL');
  });

  it('exposes the A7 product reconciliation consumer ports shape', () => {
    const ports: A7ProductReconciliationConsumerPorts = {
      getDataSource: () => ({
        transaction: <T>(
          _isolation: 'REPEATABLE READ',
          runner: (manager: EntityManager) => Promise<T>,
        ): Promise<T> => runner({} as EntityManager),
      }),
      a7T05ProductCommandLookup: () => Promise.resolve(null),
      a7T07ProductLifecycleLookup: () => Promise.resolve(null),
      a7T08ProductFinancialEffectLookup: () => Promise.resolve(null),
      a7T06NotificationDeliveryLookup: () => Promise.resolve(null),
      a7T04ProductCustomerBindingMapReferenceCheck: () => Promise.resolve(null),
      a2AuthorizationContextLookup: () => Promise.resolve(null),
      a4ProductPolicyDecisionLookup: () => Promise.resolve(null),
      a5LedgerJournalLookup: () => Promise.resolve(null),
      a6ExternalOperationLookup: () => Promise.resolve(null),
      a6ExternalOperationLookupByReference: () => Promise.resolve(null),
      a6CallbackReceiptLookup: () => Promise.resolve(null),
      a6ProviderReferenceLookup: () => Promise.resolve(null),
      a6PartnerOutageLookup: () =>
        Promise.resolve({
          partnerKey: 'NIBSS_NIP',
          capabilityKey: 'external.wallet.withdrawal.settlement',
          state: 'CLOSED',
          openedAt: null,
          cooldownSeconds: 0,
          reasonCode: null,
        }),
      a6ReportAvailabilityLookup: () =>
        Promise.resolve({
          partnerKey: 'NIBSS_NIP',
          capabilityKey: 'external.wallet.withdrawal.settlement',
          lastReportAt: null,
          fresh: false,
          reportAvailable: false,
          reasonCode: null,
        }),
      a6T08SettlementLookup: () => Promise.resolve(null),
      a6T08SuspenseLookup: () => Promise.resolve([]),
      a6T09ExternalReconciliationLookup: () => Promise.resolve(null),
      operationsAuditLookup: () => Promise.resolve([]),
      operationsIdempotencyLookup: () => Promise.resolve(null),
      operationsOutboxLookup: () => Promise.resolve([]),
      operationsDiagnosticsLookup: () => Promise.resolve([]),
    };
    expect(typeof ports.a6PartnerOutageLookup).toBe('function');
  });
});
