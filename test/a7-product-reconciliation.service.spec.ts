import { createHash } from 'node:crypto';

import type { EntityManager } from 'typeorm';

import {
  A7_PRODUCT_RECONCILIATION_AUDIT_ACTOR,
  A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
  A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
  A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
  A7_PRODUCT_RECONCILIATION_INTERNAL_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_RECONCILIATION_PROVIDER_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND,
  A7_PRODUCT_RECONCILIATION_FAILURE_QUERY_UNAVAILABLE,
} from '../src/policy/a7-product-reconciliation.constants';
import { A7ProductReconciliationService } from '../src/policy/a7-product-reconciliation.service';
import type { A7ProductReconciliationRepository } from '../src/policy/a7-product-reconciliation.repository';
import type {
  A7ProductReconciliationCommandV1,
  A7ProductReconciliationConsumerPorts,
  A7ProductReconciliationReportV1,
} from '../src/policy/a7-product-reconciliation.types';
import { ExternalSettlementDecision } from '../src/partner/external-settlement.enums';
import { ExternalOperationReferenceSource } from '../src/partner/external-operation.enums';
import { ExternalSettlementStatus } from '../src/partner/external-settlement.enums';

const PRODUCT_OPERATION_REFERENCE = 'a7-product-operation:v1:abc';
const A6_EXTERNAL_OPERATION_REFERENCE = 'external-operation:v1:abc';
const A6_PROVIDER_IDEMPOTENCY_SCOPE = 'nibss.nip.external-operation.v1';
const A6_PROVIDER_IDEMPOTENCY_KEY = 'nibss.nip.external-operation.v1:abc';
const A7T04_MAP_REFERENCE = createHash('sha256').update('a7t04-map-v1').digest('hex');
const A7T05_COMMAND_REFERENCE = 'a7-product-command:v1:abc';
const A7T07_LIFECYCLE_REFERENCE = createHash('sha256').update('a7t07-lifecycle-1').digest('hex');
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const BINDING_ID = '00000000-0000-4000-8000-000000000003';
const A5_LEDGER_JOURNAL_ID = '00000000-0000-4000-8000-000000000004';
const A6T08_SETTLEMENT_ID = '00000000-0000-4000-8000-000000000005';
const A6T08_SUSPENSE_ID = '00000000-0000-4000-8000-000000000006';
const A6_PROVIDER_REFERENCE_ID = '00000000-0000-4000-8000-000000000007';
const A6_CALLBACK_RECEIPT_ID = '00000000-0000-4000-8000-000000000008';
const REQUEST_ID = 'request-a7t09-1';
const CORRELATION_ID = 'correlation-a7t09-1';
const TRACE_ID = 'trace-a7t09-1';
const A6T09_EXTERNAL_RECONCILIATION_REFERENCE = 'a6-t09-recon-1';

function makeInput(overrides: Record<string, unknown> = {}): A7ProductReconciliationCommandV1 {
  return {
    contractName: A7_PRODUCT_RECONCILIATION_CONTRACT_NAME,
    contractVersion: A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION,
    productKey: 'VIRTUAL_ACCOUNT',
    productVersion: 1,
    productOperationReference: PRODUCT_OPERATION_REFERENCE,
    a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    a6T08SettlementId: A6T08_SETTLEMENT_ID,
    a6T08SuspenseId: A6T08_SUSPENSE_ID,
    a5LedgerJournalId: A5_LEDGER_JOURNAL_ID,
    a6ProviderReferenceId: A6_PROVIDER_REFERENCE_ID,
    a6CallbackReceiptId: A6_CALLBACK_RECEIPT_ID,
    includeSupportTrace: true,
    includeCertificationEvidence: true,
    certificationCase: 'CERT_HAPPY_PATH',
    requestContext: {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
    },
    causationId: null,
    ...(overrides as Partial<A7ProductReconciliationCommandV1>),
  } as A7ProductReconciliationCommandV1;
}

class FakeRepository {
  public productOperation: unknown = {
    productFinancialEffectId: 'a7-product-financial-effect-1',
    productFinancialEffectReference: 'a7-product-financial-effect:v1:abc',
    outcome: 'OUTCOME_VERIFIED',
    category: 'CATEGORY_SETTLEMENT',
    currentState: 'FINANCIAL_EFFECT_SETTLEMENT_POSTED',
    a6T08Decision: 'SETTLE',
    a7ProductLifecycleReference: A7T07_LIFECYCLE_REFERENCE,
    a7ProductCommandReference: A7T05_COMMAND_REFERENCE,
    a7T04ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
    a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    a6LifecycleState: 'PENDING_VERIFICATION',
    a6ProviderIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
    a6ProviderIdempotencyKey: A6_PROVIDER_IDEMPOTENCY_KEY,
    a2AuthorizationContextReference: 'a2-authorization-context',
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    recoveryReference: null,
    reversalReason: null,
    failureCode: null,
    failureMessage: null,
    providerStatus: null,
    idempotencyScope: A7_PRODUCT_RECONCILIATION_INTERNAL_IDEMPOTENCY_SCOPE,
    idempotencyKey: 'a7-product-financial-effect-key-1',
    requestHash: createHash('sha256').update('placeholder').digest('hex'),
    requestContext: {
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      traceId: TRACE_ID,
    },
    causationId: null,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    version: 1,
  };
  public productLifecycle: unknown = {
    productLifecycleId: A7T07_LIFECYCLE_REFERENCE,
    productLifecycleReference: A7T07_LIFECYCLE_REFERENCE,
    capability: 'product.virtual-account',
    action: 'lifecycle',
    currentLifecycleState: 'PENDING_VERIFICATION',
    outcome: 'OUTCOME_VERIFIED',
  };
  public productCommand: unknown = {
    productCommandReference: A7T05_COMMAND_REFERENCE,
    productOperationReference: PRODUCT_OPERATION_REFERENCE,
    capabilityKey: 'virtual-account.inbound-funding',
    action: 'lifecycle',
    productState: 'FUNDING_PENDING_VERIFICATION',
    operationState: 'COMMAND_ADMITTED',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    amountMinor: '100000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    a7ProductCustomerBindingMapReference: A7T04_MAP_REFERENCE,
  };
  public productCustomerBinding: unknown = {
    mapReference: A7T04_MAP_REFERENCE,
    capabilityKey: 'virtual-account.inbound-funding',
    action: 'lifecycle',
    productState: 'FUNDING_PENDING_VERIFICATION',
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    bindingId: BINDING_ID,
    bindingVersion: 1,
    a4ProductPolicyDecisionReference: 'a4-product-policy-decision',
    a2AuthorizationContextReference: 'a2-authorization-context',
  };
  public a2AuthorizationContext: unknown = {
    principalType: 'SERVICE',
    principalId: 'a7-product-reconciliation',
    customerId: null,
    customerAccess: 'ANY',
    evaluatedAt: '2026-08-09T00:00:00.000Z',
    allowed: true,
    action: 'a7-product-reconciliation',
    resourceType: A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE,
    resourceId: null,
  };
  public a4ProductPolicyDecision: unknown = {
    decisionReference: 'a4-product-policy-decision',
    productKey: 'VIRTUAL_ACCOUNT',
    capability: 'product.virtual-account',
    action: 'lifecycle',
    profileReference: 'profile.product-virtual-account-lifecycle.v1',
    policyVersion: 'a4.profile.product-virtual-account-lifecycle.v1',
    decision: 'ALLOW_WITH_LIMITS',
    expiresAt: null,
    reasonCodes: [],
    maxAmountMinor: null,
  };
  public a5LedgerJournal: unknown = {
    journalId: A5_LEDGER_JOURNAL_ID,
    idempotencyKey: 'a5-journal-key-1',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    totalMinor: '100000',
    status: 'POSTED',
    reference: 'a7-product-financial-effect-1',
    reversalOfJournalId: null,
    createdAt: '2026-08-09T00:00:00.000Z',
    postedAt: '2026-08-09T00:00:00.000Z',
  };
  public a6ExternalOperation: unknown = {
    externalOperationId: 'a6-external-op-id-1',
    externalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    customerId: CUSTOMER_ID,
    walletAccountId: BINDING_ID,
    ledgerAccountId: BINDING_ID,
    amountMinor: '100000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    providerIdempotencyScope: A6_PROVIDER_IDEMPOTENCY_SCOPE,
    providerIdempotencyKey: A6_PROVIDER_IDEMPOTENCY_KEY,
    lifecycleState: 'PENDING_VERIFICATION',
    attemptCount: 1,
    maxAttempts: 3,
    replayed: false,
  };
  public a6CallbackReceipt: unknown = null;
  public a6T08Settlement: unknown = {
    settlementId: A6T08_SETTLEMENT_ID,
    externalOperationId: 'a6-external-op-id-1',
    externalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    operationType: 'OUTBOUND_BANK_SETTLEMENT',
    customerId: CUSTOMER_ID,
    walletAccountId: BINDING_ID,
    customerLedgerAccountId: BINDING_ID,
    settlementAssetLedgerAccountId: 'settlement-asset-1',
    decision: ExternalSettlementDecision.SETTLE,
    status: ExternalSettlementStatus.POSTED,
    amountMinor: '100000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    lifecycleState: 'PENDING_VERIFICATION',
    journalId: A5_LEDGER_JOURNAL_ID,
    reversalJournalId: null,
    evidence: {
      referenceType: 'OPERATION',
      referenceValue: A6_EXTERNAL_OPERATION_REFERENCE,
      namespace: 'a7-product-financial-effect-settlement',
      source: ExternalOperationReferenceSource.CALLBACK,
      observedAt: new Date('2026-08-09T00:00:00.000Z'),
      evidenceHash: 'evidence-hash-1',
    },
    idempotencyScope: 'external.partner.settlement.v1',
    idempotencyKey: 'a6-settlement-key-1',
    requestHash: 'request-hash-1',
    correlationId: CORRELATION_ID,
    requestId: REQUEST_ID,
    ownerPrincipal: 'a7-product-reconciliation',
    postedAt: new Date('2026-08-09T00:00:00.000Z'),
    reversalPostedAt: null,
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    replayed: false,
  };
  public a6T08SuspenseList: unknown[] = [];
  public a6PartnerOutage: unknown = {
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    state: 'CLOSED',
    openedAt: null,
    cooldownSeconds: 0,
    reasonCode: null,
  };
  public a6ReportAvailability: unknown = {
    partnerKey: 'NIBSS_NIP',
    capabilityKey: 'external.wallet.withdrawal.settlement',
    lastReportAt: '2026-08-08T00:00:00.000Z',
    fresh: true,
    reportAvailable: true,
    reasonCode: null,
  };
  public a6T09ExternalReconciliation: unknown = {
    a6T09ExternalReconciliationReference: A6T09_EXTERNAL_RECONCILIATION_REFERENCE,
    discrepancyCount: 0,
    errorCount: 0,
    warningCount: 0,
    report: null,
  };
  public operationsAuditList: unknown[] = [];
  public operationsIdempotencyList: unknown[] = [];
  public operationsOutboxList: unknown[] = [];
  public operationsDiagnosticsList: unknown[] = [];
  public dataSource: {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ) => Promise<T>;
  } = {
    transaction: <T>(
      _isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ): Promise<T> => runner({} as EntityManager),
  };
  public providerIdempotencyScope: string = A6_PROVIDER_IDEMPOTENCY_SCOPE;
  public queryUnavailable: boolean = false;

  getDataSource(): {
    transaction: <T>(
      isolation: 'REPEATABLE READ',
      runner: (manager: EntityManager) => Promise<T>,
    ) => Promise<T>;
  } {
    return this.dataSource;
  }

  getA7ProductReconciliationProviderIdempotencyScope(): string {
    return this.providerIdempotencyScope;
  }

  getConsumerPorts(): A7ProductReconciliationConsumerPorts {
    return {
      getDataSource: () => this.dataSource,
      a7T05ProductCommandLookup: () => Promise.resolve(this.productCommand as never),
      a7T07ProductLifecycleLookup: () => Promise.resolve(this.productLifecycle as never),
      a7T08ProductFinancialEffectLookup: () =>
        Promise.resolve(
          this.productOperation
            ? {
                journalId: A5_LEDGER_JOURNAL_ID,
                productOperationReference: (
                  this.productOperation as { productFinancialEffectReference: string }
                ).productFinancialEffectReference,
              }
            : null,
        ),
      a7T06NotificationDeliveryLookup: () => Promise.resolve(null),
      a7T04ProductCustomerBindingMapReferenceCheck: () =>
        Promise.resolve(this.productCustomerBinding as never),
      a2AuthorizationContextLookup: () => Promise.resolve(this.a2AuthorizationContext as never),
      a4ProductPolicyDecisionLookup: () => Promise.resolve(this.a4ProductPolicyDecision as never),
      a5LedgerJournalLookup: () => Promise.resolve(this.a5LedgerJournal as never),
      a6ExternalOperationLookup: () => Promise.resolve(this.a6ExternalOperation as never),
      a6ExternalOperationLookupByReference: () =>
        Promise.resolve({ externalOperationId: 'a6-external-op-id-1' }),
      a6CallbackReceiptLookup: () => Promise.resolve(this.a6CallbackReceipt as never),
      a6ProviderReferenceLookup: () => Promise.resolve(null),
      a6PartnerOutageLookup: () =>
        Promise.resolve(
          this.a6PartnerOutage as {
            partnerKey: string;
            capabilityKey: string;
            state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
            openedAt: string | null;
            cooldownSeconds: number;
            reasonCode: string | null;
          },
        ),
      a6ReportAvailabilityLookup: () =>
        Promise.resolve(
          this.a6ReportAvailability as {
            partnerKey: string;
            capabilityKey: string;
            lastReportAt: string | null;
            fresh: boolean;
            reportAvailable: boolean;
            reasonCode: string | null;
          },
        ),
      a6T08SettlementLookup: () => Promise.resolve(this.a6T08Settlement as never),
      a6T08SuspenseLookup: () => Promise.resolve(this.a6T08SuspenseList as never[]),
      a6T09ExternalReconciliationLookup: () =>
        Promise.resolve(this.a6T09ExternalReconciliation as never),
      operationsAuditLookup: () => Promise.resolve(this.operationsAuditList as never[]),
      operationsIdempotencyLookup: () => Promise.resolve(null),
      operationsOutboxLookup: () => Promise.resolve(this.operationsOutboxList as never[]),
      operationsDiagnosticsLookup: () => Promise.resolve(this.operationsDiagnosticsList as never[]),
    };
  }

  loadProductFact(): Promise<unknown> {
    return Promise.resolve({
      productOperation: this.productOperation
        ? {
            productOperationId: PRODUCT_OPERATION_REFERENCE,
            productOperationReference: PRODUCT_OPERATION_REFERENCE,
            productKey: 'VIRTUAL_ACCOUNT',
            productVersion: 1,
            capabilityKey: 'virtual-account.inbound-funding',
            action: 'lifecycle',
            productState: 'FUNDING_PENDING_VERIFICATION',
            customerId: CUSTOMER_ID,
            customerWalletId: CUSTOMER_WALLET_ID,
            bindingId: BINDING_ID,
            bindingVersion: 1,
            amountMinor: '100000',
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            outcome: 'OUTCOME_VERIFIED',
            operationState: 'COMMAND_ADMITTED',
            a6ExternalOperationReference: A6_EXTERNAL_OPERATION_REFERENCE,
          }
        : null,
      productLifecycle: this.productLifecycle,
      productCommand: this.productCommand,
      productCustomerBinding: this.productCustomerBinding,
      productFinancialEffect: this.productOperation
        ? {
            productFinancialEffectReference: (
              this.productOperation as { productFinancialEffectReference: string }
            ).productFinancialEffectReference,
            a5LedgerJournalId: A5_LEDGER_JOURNAL_ID,
            currentState: 'FINANCIAL_EFFECT_SETTLEMENT_POSTED',
            outcome: 'OUTCOME_VERIFIED',
            category: 'CATEGORY_SETTLEMENT',
            a6T08Decision: 'SETTLE',
          }
        : null,
    });
  }

  getOperationsFact(): Promise<{
    readonly operationsFact: {
      readonly audit: unknown[];
      readonly idempotency: unknown[];
      readonly outbox: unknown[];
      readonly diagnostics: unknown[];
    };
    readonly notificationFact: { readonly notificationDispatch: unknown };
  }> {
    return Promise.resolve({
      operationsFact: {
        audit: this.operationsAuditList,
        idempotency: this.operationsIdempotencyList,
        outbox: this.operationsOutboxList,
        diagnostics: this.operationsDiagnosticsList,
      },
      notificationFact: { notificationDispatch: null },
    });
  }

  getDiagnosticsReport(): Promise<null> {
    return Promise.resolve(null);
  }
}

function serviceWithFakeRepository(fake: FakeRepository): A7ProductReconciliationService {
  const service = new A7ProductReconciliationService(
    fake as unknown as A7ProductReconciliationRepository,
  );
  return service;
}

describe('A7T09 service', () => {
  it('exposes the A7 product reconciliation contract names and versions', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    const names = service.getContractNames();
    const versions = service.getContractVersions();
    expect(names.a2).toBe('A2-PROTECTED-ROUTE-AUTHORIZATION');
    expect(names.a3).toBe('A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING');
    expect(names.a4).toBe('A4-CAPABILITY-POLICY');
    expect(names.a5).toBe('A5-LEDGER');
    expect(names.a6).toBe('A6-EXTERNAL-PARTNER-ADAPTER');
    expect(names.a6T05).toBe('A6-EXTERNAL-OPERATION');
    expect(names.a6T08).toBe('A6-EXTERNAL-SETTLEMENT');
    expect(names.a6T09).toBe('A6-EXTERNAL-RECONCILIATION');
    expect(names.a6CircuitBreaker).toBe('A6-PARTNER-CIRCUIT-BREAKER');
    expect(names.a7T04).toBe('A7-PRODUCT-CUSTOMER-BINDING');
    expect(names.a7T05).toBe('A7-PRODUCT-COMMAND');
    expect(names.a7T06).toBe('A7-NOTIFICATION-DELIVERY');
    expect(names.a7T07).toBe('A7-PRODUCT-LIFECYCLE');
    expect(names.a7T08).toBe('A7-PRODUCT-FINANCIAL-EFFECT');
    expect(names.a7).toBe('A7-PRODUCT-RECONCILIATION');
    expect(versions.a7).toBe(1);
  });

  it('exposes the A7 product reconciliation scope / retention / audit / actor getters', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    expect(service.getInternalIdempotencyScope()).toBe(
      A7_PRODUCT_RECONCILIATION_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(service.getProviderIdempotencyScope()).toBe(
      A7_PRODUCT_RECONCILIATION_PROVIDER_IDEMPOTENCY_SCOPE,
    );
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getAuditEntityType()).toBe(A7_PRODUCT_RECONCILIATION_AUDIT_ENTITY_TYPE);
    expect(service.getAuditActor()).toBe(A7_PRODUCT_RECONCILIATION_AUDIT_ACTOR);
  });

  it('exposes the A7 product reconciliation check, expected, discrepancy, severity, owner, recovery, category, terminal, and journal vocabulary', () => {
    const service = serviceWithFakeRepository(new FakeRepository());
    expect(service.listCheckKeys().length).toBeGreaterThan(40);
    expect(service.listExpectedChecks().length).toBeGreaterThan(0);
    expect(service.listDiscrepancyCodes().length).toBeGreaterThan(60);
    expect(service.listSeverityValues()).toContain('ERROR');
    expect(service.listSeverityValues()).toContain('WARNING');
    expect(service.listRecoveryStateValues()).toContain('NO_AUTOMATIC_REPAIR');
    expect(service.listRecoveryStateValues()).toContain('MANUAL_REVIEW_REQUIRED');
    expect(service.listCategories().length).toBeGreaterThan(0);
    expect(service.listTerminalStates().length).toBeGreaterThan(0);
    expect(service.getDiscrepancyClassification()).toBeDefined();
  });

  it('rejects an invalid contract name', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(
      makeInput({ contractName: 'A7-PRODUCT-WRONG' as unknown as 'A7-PRODUCT-RECONCILIATION' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an invalid product key', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(
      makeInput({ productKey: 'WRONG' as unknown as 'VIRTUAL_ACCOUNT' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an empty product operation reference', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput({ productOperationReference: '' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an invalid A6 external operation reference', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(
      makeInput({ a6ExternalOperationReference: 'bad space' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects an invalid A5 ledger journal id', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput({ a5LedgerJournalId: 'not-a-uuid' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('reconciles a verified product financial effect with no discrepancies', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const report = result.report;
      expect(report.contractName).toBe(A7_PRODUCT_RECONCILIATION_CONTRACT_NAME);
      expect(report.contractVersion).toBe(A7_PRODUCT_RECONCILIATION_CONTRACT_VERSION);
      expect(report.productKey).toBe('VIRTUAL_ACCOUNT');
      expect(report.productOperationReference).toBe(PRODUCT_OPERATION_REFERENCE);
      expect(report.queryUnavailable).toBe(false);
      expect(report.supportTrace).not.toBeNull();
      expect(report.certificationEvidence).not.toBeNull();
    }
  });

  it('reconciles with a missing A5 ledger journal (the read-only A7 product financial effect)', async () => {
    const fake = new FakeRepository();
    fake.a5LedgerJournal = null;
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.authorityFact.a5LedgerJournal).toBeNull();
    }
  });

  it('reconciles with a missing A6T08 settlement', async () => {
    const fake = new FakeRepository();
    fake.a6T08Settlement = null;
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.authorityFact.a6T08Settlement).toBeNull();
    }
  });

  it('reconciles with a missing A6 report', async () => {
    const fake = new FakeRepository();
    fake.a6ReportAvailability = {
      partnerKey: 'NIBSS_NIP',
      capabilityKey: 'external.wallet.withdrawal.settlement',
      lastReportAt: null,
      fresh: false,
      reportAvailable: false,
      reasonCode: 'A6_REPORT_UNAVAILABLE',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_REPORT_UNAVAILABLE');
    }
  });

  it('classifies the partner-key mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6ExternalOperation = {
      ...(fake.a6ExternalOperation as Record<string, unknown>),
      partnerKey: 'OTHER_PARTNER',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_PARTNER_KEY_MISMATCH');
    }
  });

  it('classifies the capability-key mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6ExternalOperation = {
      ...(fake.a6ExternalOperation as Record<string, unknown>),
      capabilityKey: 'other.capability',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_CAPABILITY_MISMATCH');
    }
  });

  it('classifies the lifecycle not verified discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6ExternalOperation = {
      ...(fake.a6ExternalOperation as Record<string, unknown>),
      lifecycleState: 'CREATED',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_NOT_VERIFIED');
    }
  });

  it('classifies the amount mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6ExternalOperation = {
      ...(fake.a6ExternalOperation as Record<string, unknown>),
      amountMinor: '99999',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_AMOUNT_MISMATCH');
    }
  });

  it('classifies the currency mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6ExternalOperation = {
      ...(fake.a6ExternalOperation as Record<string, unknown>),
      currency: 'USD',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_CURRENCY_MISMATCH');
    }
  });

  it('classifies the accounting-unit mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6ExternalOperation = {
      ...(fake.a6ExternalOperation as Record<string, unknown>),
      accountingUnit: 'OTHER_UNIT',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_ACCOUNTING_UNIT_MISMATCH');
    }
  });

  it('classifies the binding mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.productCommand = {
      ...(fake.productCommand as Record<string, unknown>),
      bindingId: 'different-binding',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_BINDING_MISMATCH');
    }
  });

  it('classifies the lifecycle FAILED discrepancy', async () => {
    const fake = new FakeRepository();
    fake.productLifecycle = {
      ...(fake.productLifecycle as Record<string, unknown>),
      currentLifecycleState: 'FAILED',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_LIFECYCLE_FAILED');
    }
  });

  it('classifies the A2 authorization expired discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a2AuthorizationContext = {
      ...(fake.a2AuthorizationContext as Record<string, unknown>),
      allowed: false,
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_A2_AUTHORIZATION_EXPIRED');
    }
  });

  it('classifies the A4 product-policy decision not executable discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a4ProductPolicyDecision = {
      ...(fake.a4ProductPolicyDecision as Record<string, unknown>),
      decision: 'DENY',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A4_PRODUCT_POLICY_DECISION_NOT_EXECUTABLE',
      );
    }
  });

  it('classifies the A4 product-policy decision expired discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a4ProductPolicyDecision = {
      ...(fake.a4ProductPolicyDecision as Record<string, unknown>),
      expiresAt: '2024-01-01T00:00:00.000Z',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A4_PRODUCT_POLICY_DECISION_EXPIRED',
      );
    }
  });

  it('classifies the A6 partner outage discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6PartnerOutage = {
      ...(fake.a6PartnerOutage as Record<string, unknown>),
      state: 'OPEN',
      openedAt: '2026-08-09T00:00:00.000Z',
      reasonCode: 'A6_CIRCUIT_BREAKER_OPEN',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain('A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_PARTNER_OUTAGE');
    }
  });

  it('classifies the A6 settlement amount mismatch discrepancy', async () => {
    const fake = new FakeRepository();
    fake.a6T08Settlement = {
      ...(fake.a6T08Settlement as Record<string, unknown>),
      amountMinor: '99999',
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(true);
    if (result.valid) {
      const codes = result.report.discrepancies.map((d) => d.code);
      expect(codes).toContain(
        'A7_PRODUCT_RECONCILIATION_DISCREPANCY_A6_SETTLEMENT_AMOUNT_MISMATCH',
      );
    }
  });

  it('reconciles a batch of products', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileBatch([makeInput(), makeInput()]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.report.total).toBe(2);
    }
  });

  it('rejects an empty batch', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileBatch([]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_INVALID_COMMAND);
    }
  });

  it('returns a failure when the data source transaction throws', async () => {
    const fake = new FakeRepository();
    fake.dataSource = {
      transaction: <T>(
        _isolation: 'REPEATABLE READ',
        _runner: (manager: EntityManager) => Promise<T>,
      ): Promise<T> => {
        void _isolation;
        void _runner;
        return Promise.reject(new Error('query unavailable'));
      },
    };
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(makeInput());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.code).toBe(A7_PRODUCT_RECONCILIATION_FAILURE_QUERY_UNAVAILABLE);
    }
  });

  it('returns a no-support-trace and no-certification report when the flags are off', async () => {
    const fake = new FakeRepository();
    const service = serviceWithFakeRepository(fake);
    const result = await service.reconcileProduct(
      makeInput({
        includeSupportTrace: false,
        includeCertificationEvidence: false,
        certificationCase: null,
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      const report: A7ProductReconciliationReportV1 = result.report;
      expect(report.supportTrace).toBeNull();
      expect(report.certificationEvidence).toBeNull();
    }
  });
});
