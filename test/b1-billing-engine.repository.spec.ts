import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1BillingEngineRepository } from '../src/policy/b1-billing-engine.repository';
import {
  B1_BILLING_ENGINE_CONTRACT_NAME,
  B1_BILLING_ENGINE_CONTRACT_VERSION,
  B1_BILLING_ENGINE_FAILURE_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
  B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_BILLING_ENGINE_SCOPE_CURRENCY,
  B1_BILLING_ENGINE_SCOPE_KEY,
  B1_BILLING_ENGINE_SCOPE_VERSION,
  B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
} from '../src/policy/b1-billing-engine.constants';
import type {
  B1BillingRequestV1,
  B1InvoiceRequestV1,
  B1StatementRequestV1,
} from '../src/policy/b1-billing-engine.types';
import type { RequestContext } from '../src/production/request-context';

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-billing-engine-req',
  correlationId: 'b1-billing-engine-corr',
  traceId: 'b1-billing-engine-trace',
});

const buildBillingRequest = (overrides: Partial<B1BillingRequestV1> = {}): B1BillingRequestV1 => ({
  contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  billingRequestId: 'b1-billing-engine-req-1',
  billingRequestVersion: 1,
  scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
  scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-billing-engine-customer-1',
  merchantId: 'b1-billing-engine-merchant-1',
  partnerId: 'b1-billing-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.fee',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.fee.v1.plan.standard',
  planVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  packageKey: 'commercial.virtual-account.inbound-funding.package.fee.commission.v1',
  packageVersion: 1,
  bundleKey: 'commercial.virtual-account.inbound-funding.bundle.fee.commission.v1',
  bundleVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.fee.v1',
  productEntitlementVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.billing-period.per-transaction.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  commercialDecisionReferences: ['b1-commercial-decision:v1:fee:1'],
  commercialDecisionIdempotencyKeys: ['a'.repeat(64)],
  idempotencyKey: 'b'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-billing-engine-causation',
  ...overrides,
});

const buildInvoiceRequest = (overrides: Partial<B1InvoiceRequestV1> = {}): B1InvoiceRequestV1 => ({
  contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  invoiceRequestId: 'b1-billing-engine-invoice-req-1',
  invoiceRequestVersion: 1,
  scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
  scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-billing-engine-customer-1',
  merchantId: 'b1-billing-engine-merchant-1',
  partnerId: 'b1-billing-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.fee',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.fee.v1.plan.standard',
  planVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  packageKey: 'commercial.virtual-account.inbound-funding.package.fee.commission.v1',
  packageVersion: 1,
  bundleKey: 'commercial.virtual-account.inbound-funding.bundle.fee.commission.v1',
  bundleVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.fee.v1',
  productEntitlementVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  billingRecordReferences: ['b1-billing-engine-billing-record-ref-1'],
  commercialDecisionReferences: ['b1-commercial-decision:v1:fee:1'],
  commercialDecisionIdempotencyKeys: ['c'.repeat(64)],
  idempotencyKey: 'd'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-billing-engine-invoice-causation',
  ...overrides,
});

const buildStatementRequest = (
  overrides: Partial<B1StatementRequestV1> = {},
): B1StatementRequestV1 => ({
  contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  statementRequestId: 'b1-billing-engine-statement-req-1',
  statementRequestVersion: 1,
  scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
  scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-billing-engine-customer-1',
  merchantId: 'b1-billing-engine-merchant-1',
  partnerId: 'b1-billing-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.statement-period.daily.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T23:59:59.999Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  billingRecordReferences: ['b1-billing-engine-billing-record-ref-1'],
  invoiceReferences: ['b1-billing-engine-invoice-1'],
  commercialDecisionReferences: ['b1-commercial-decision:v1:fee:1'],
  commercialDecisionIdempotencyKeys: ['e'.repeat(64)],
  idempotencyKey: 'f'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-billing-engine-statement-causation',
  ...overrides,
});

describe('B1 billing engine repository (B1T05)', () => {
  let repository: B1BillingEngineRepository;

  beforeEach(() => {
    const idempotencyServiceMock = {
      reserve: jest.fn(() => {
        return Promise.resolve({ kind: 'NEW', record: { id: 'reservation-id' } });
      }),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const metricsServiceMock = {
      increment: jest.fn(() => {
        return Promise.resolve();
      }),
    };
    const dataSourceMock = {
      manager: {
        getRepository: () => ({}),
      },
    };
    repository = new B1BillingEngineRepository(
      dataSourceMock as never,
      {} as never,
      {} as never,
      new B1CommercialCatalogService({
        getFirstScopeRegistration: () => {
          throw new Error('not used');
        },
      } as never),
      {} as never,
      {} as never,
      {} as never,
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
  });

  it('exposes the B1 billing engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_BILLING_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(B1_BILLING_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 billing engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_BILLING_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_BILLING_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_BILLING_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 billing engine period identity', () => {
    expect(repository.getBillingPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.billing-period.per-transaction.v1',
    );
    expect(repository.getStatementPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.statement-period.daily.v1',
    );
  });

  it('exposes the B1 billing engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-billing-engine');
    expect(repository.getAuditEntityType()).toBe('B1_BILLING_DOCUMENT');
    expect(repository.getOutboxEventType()).toBe('B1BillingDocumentGenerated');
    expect(repository.getInternalIdempotencyScope()).toBe(
      B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getInvoiceIdempotencyScope()).toBe(
      B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getStatementIdempotencyScope()).toBe(
      B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(repository.getReferencePrefix()).toBe('b1-billing-document');
  });

  it('exposes the B1 billing engine vocabulary accessors', () => {
    expect(repository.getBillingRecordStates().length).toBe(5);
    expect(repository.getInvoiceStates().length).toBe(5);
    expect(repository.getStatementStates().length).toBe(4);
    expect(repository.getDocumentKinds().length).toBe(7);
    expect(repository.getRuleKinds().length).toBeGreaterThan(20);
    expect(repository.getRuleOutcomes().length).toBe(4);
    expect(repository.getLineKinds().length).toBe(7);
    expect(repository.getClassificationLevels().length).toBe(5);
    expect(repository.getDataControlClassifications().length).toBe(5);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(repository.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(repository.getFailureCodes().length).toBe(18);
    expect(repository.getRetentionDays()).toBe(365);
  });

  it('generates a B1 billing record for a valid request', () => {
    const record = repository.generateBillingRecord(buildBillingRequest());
    expect(record.billingRecordState).toBe('READY');
    expect(record.contractName).toBe(B1_BILLING_ENGINE_CONTRACT_NAME);
    expect(SHA256_RE.test(record.billingRecordHash)).toBe(true);
    expect(SHA256_RE.test(record.billingRecordReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.billingRequestHash)).toBe(true);
    expect(record.commercialDecisionIdempotencyKey.length).toBe(64);
    expect(record.commercialDecisionReference).toBeTruthy();
  });

  it('produces deterministic B1 billing records for identical inputs', () => {
    const request = buildBillingRequest();
    const a = repository.generateBillingRecord(request);
    const b = repository.generateBillingRecord(request);
    expect(a.billingRecordHash).toBe(b.billingRecordHash);
    expect(a.billingRecordReplayHash).toBe(b.billingRecordReplayHash);
    expect(a.billingRequestHash).toBe(b.billingRequestHash);
  });

  it('returns a failure record for an invalid contract name', () => {
    const record = repository.generateBillingRecord(
      buildBillingRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid scope key', () => {
    const record = repository.generateBillingRecord(
      buildBillingRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(record.failure?.code).toBe(B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid product key', () => {
    const record = repository.generateBillingRecord(
      buildBillingRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(record.failure?.code).toBe(B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid idempotency key', () => {
    const record = repository.generateBillingRecord(
      buildBillingRequest({ idempotencyKey: 'invalid' }),
    );
    expect(record.failure?.code).toBe(B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 invoice for a valid request', () => {
    const invoice = repository.generateInvoice(buildInvoiceRequest());
    expect(invoice.invoiceState).toBe('GENERATED');
    expect(invoice.invoiceNumber).toBeTruthy();
    expect(SHA256_RE.test(invoice.invoiceHash)).toBe(true);
    expect(SHA256_RE.test(invoice.invoiceReplayHash)).toBe(true);
    expect(invoice.invoiceLines.length).toBe(3);
  });

  it('produces deterministic B1 invoices for identical inputs', () => {
    const request = buildInvoiceRequest();
    const a = repository.generateInvoice(request);
    const b = repository.generateInvoice(request);
    expect(a.invoiceNumber).toBe(b.invoiceNumber);
    expect(a.invoiceHash).toBe(b.invoiceHash);
    expect(a.invoiceReplayHash).toBe(b.invoiceReplayHash);
  });

  it('returns a failure invoice for an invalid invoice request', () => {
    const invoice = repository.generateInvoice(
      buildInvoiceRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(invoice.failure?.code).toBe(B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 statement for a valid request', () => {
    const statement = repository.generateStatement(buildStatementRequest());
    expect(statement.statementState).toBe('GENERATED');
    expect(statement.statementNumber).toBeTruthy();
    expect(SHA256_RE.test(statement.statementHash)).toBe(true);
    expect(SHA256_RE.test(statement.statementReplayHash)).toBe(true);
    expect(statement.statementLines.length).toBe(3);
  });

  it('produces deterministic B1 statements for identical inputs', () => {
    const request = buildStatementRequest();
    const a = repository.generateStatement(request);
    const b = repository.generateStatement(request);
    expect(a.statementNumber).toBe(b.statementNumber);
    expect(a.statementHash).toBe(b.statementHash);
    expect(a.statementReplayHash).toBe(b.statementReplayHash);
  });

  it('returns a failure statement for an invalid statement request', () => {
    const statement = repository.generateStatement(
      buildStatementRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(statement.failure?.code).toBe(B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 billing document compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildBillingRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for an invalid scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildBillingRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_BILLING_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a compatibility mismatch for an invalid product key', () => {
    const compatibility = repository.compatibilityCheck(
      buildBillingRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 billing document versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_BILLING_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_BILLING_ENGINE_SCOPE_KEY);
  });

  it('exposes the B1 billing engine consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.generateBillingRecord(buildBillingRequest());
    expect(evaluated.billingRecordState).toBe('READY');
  });

  it('runs a replay-safe generate billing record', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateBillingRecord(buildBillingRequest());
    expect(result.record.billingRecordState).toBe('READY');
    expect(SHA256_RE.test(result.billingRequestHash)).toBe(true);
    expect(SHA256_RE.test(result.billingRecordHash)).toBe(true);
    expect(SHA256_RE.test(result.billingRecordReplayHash)).toBe(true);
  });

  it('runs a replay-safe generate invoice', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateInvoice(buildInvoiceRequest());
    expect(result.invoice.invoiceState).toBe('GENERATED');
  });

  it('runs a replay-safe generate statement', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateStatement(buildStatementRequest());
    expect(result.statement.statementState).toBe('GENERATED');
  });

  it('runs a compatibility check via consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildBillingRequest());
    expect(result.compatible).toBe(true);
  });
});
