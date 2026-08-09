import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1BillingEngineRepository } from '../src/policy/b1-billing-engine.repository';
import { B1BillingEngineService } from '../src/policy/b1-billing-engine.service';
import {
  B1_BILLING_ENGINE_CONTRACT_NAME,
  B1_BILLING_ENGINE_CONTRACT_VERSION,
  B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE,
  B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE,
  B1_BILLING_ENGINE_REFERENCE_PREFIX,
  B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_BILLING_ENGINE_SCOPE_CURRENCY,
  B1_BILLING_ENGINE_SCOPE_DIRECTION,
  B1_BILLING_ENGINE_SCOPE_KEY,
  B1_BILLING_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_BILLING_ENGINE_SCOPE_VERSION,
  B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
} from '../src/policy/b1-billing-engine.constants';
import type {
  B1BillingRequestV1,
  B1InvoiceRequestV1,
  B1StatementRequestV1,
} from '../src/policy/b1-billing-engine.types';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-billing-engine-svc-req',
  correlationId: 'b1-billing-engine-svc-corr',
  traceId: 'b1-billing-engine-svc-trace',
});

const buildBillingRequest = (overrides: Partial<B1BillingRequestV1> = {}): B1BillingRequestV1 => ({
  contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  billingRequestId: 'b1-billing-engine-svc-req-1',
  billingRequestVersion: 1,
  scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
  scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-billing-engine-svc-customer-1',
  merchantId: 'b1-billing-engine-svc-merchant-1',
  partnerId: 'b1-billing-engine-svc-partner-1',
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
  causationId: 'b1-billing-engine-svc-causation',
  ...overrides,
});

const buildInvoiceRequest = (): B1InvoiceRequestV1 => ({
  contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  invoiceRequestId: 'b1-billing-engine-svc-invoice-req-1',
  invoiceRequestVersion: 1,
  scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
  scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-billing-engine-svc-customer-1',
  merchantId: 'b1-billing-engine-svc-merchant-1',
  partnerId: 'b1-billing-engine-svc-partner-1',
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
  billingRecordReferences: ['b1-billing-engine-svc-billing-record-ref-1'],
  commercialDecisionReferences: ['b1-commercial-decision:v1:fee:1'],
  commercialDecisionIdempotencyKeys: ['c'.repeat(64)],
  idempotencyKey: 'd'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-billing-engine-svc-invoice-causation',
});

const buildStatementRequest = (): B1StatementRequestV1 => ({
  contractName: B1_BILLING_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  statementRequestId: 'b1-billing-engine-svc-statement-req-1',
  statementRequestVersion: 1,
  scopeKey: B1_BILLING_ENGINE_SCOPE_KEY,
  scopeVersion: B1_BILLING_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_BILLING_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-billing-engine-svc-customer-1',
  merchantId: 'b1-billing-engine-svc-merchant-1',
  partnerId: 'b1-billing-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.statement-period.daily.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T23:59:59.999Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  billingRecordReferences: ['b1-billing-engine-svc-billing-record-ref-1'],
  invoiceReferences: ['b1-billing-engine-svc-invoice-1'],
  commercialDecisionReferences: ['b1-commercial-decision:v1:fee:1'],
  commercialDecisionIdempotencyKeys: ['e'.repeat(64)],
  idempotencyKey: 'f'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-billing-engine-svc-statement-causation',
});

describe('B1 billing engine service (B1T05)', () => {
  let repository: B1BillingEngineRepository;
  let service: B1BillingEngineService;

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
    service = new B1BillingEngineService(repository);
  });

  it('exposes the B1 billing engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_BILLING_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(B1_BILLING_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 billing engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_BILLING_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_BILLING_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_BILLING_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(service.getScopeDirection()).toBe(B1_BILLING_ENGINE_SCOPE_DIRECTION);
    expect(service.getScopeProductDependency()).toBe(B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY);
    expect(service.getScopePartnerDependency()).toBe(B1_BILLING_ENGINE_SCOPE_PARTNER_DEPENDENCY);
  });

  it('exposes the B1 billing engine period identity', () => {
    expect(service.getBillingPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.billing-period.per-transaction.v1',
    );
    expect(service.getStatementPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.statement-period.daily.v1',
    );
  });

  it('exposes the B1 billing engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-billing-engine');
    expect(service.getAuditEntityType()).toBe('B1_BILLING_DOCUMENT');
    expect(service.getOutboxEventType()).toBe(B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getInternalIdempotencyScope()).toBe(
      B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(service.getInvoiceIdempotencyScope()).toBe(B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE);
    expect(service.getStatementIdempotencyScope()).toBe(
      B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE,
    );
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_BILLING_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 billing engine vocabulary accessors', () => {
    expect(service.getBillingRecordStates().length).toBe(5);
    expect(service.getInvoiceStates().length).toBe(5);
    expect(service.getStatementStates().length).toBe(4);
    expect(service.getDocumentKinds().length).toBe(7);
    expect(service.getRuleKinds().length).toBeGreaterThan(20);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getLineKinds().length).toBe(7);
    expect(service.getClassificationLevels().length).toBe(5);
    expect(service.getDataControlClassifications().length).toBe(5);
    expect(service.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.getFailureCodes().length).toBe(18);
    expect(service.getRetentionDays()).toBe(365);
  });

  it('exposes the B1 billing engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.generateBillingRecord).toBe('function');
    expect(typeof ports.replaySafeGenerateBillingRecord).toBe('function');
    expect(typeof ports.generateInvoice).toBe('function');
    expect(typeof ports.replaySafeGenerateInvoice).toBe('function');
    expect(typeof ports.generateStatement).toBe('function');
    expect(typeof ports.replaySafeGenerateStatement).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 billing record generate', () => {
    const record = service.generateBillingRecord(buildBillingRequest());
    expect(record.billingRecordState).toBe('READY');
  });

  it('runs a B1 invoice generate', () => {
    const invoice = service.generateInvoice(buildInvoiceRequest());
    expect(invoice.invoiceState).toBe('GENERATED');
  });

  it('runs a B1 statement generate', () => {
    const statement = service.generateStatement(buildStatementRequest());
    expect(statement.statementState).toBe('GENERATED');
  });

  it('runs a B1 billing document compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildBillingRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 billing record replay-safe generate', async () => {
    const result = await service.replaySafeGenerateBillingRecord(buildBillingRequest());
    expect(result.record.billingRecordState).toBe('READY');
  });

  it('runs a B1 invoice replay-safe generate', async () => {
    const result = await service.replaySafeGenerateInvoice(buildInvoiceRequest());
    expect(result.invoice.invoiceState).toBe('GENERATED');
  });

  it('runs a B1 statement replay-safe generate', async () => {
    const result = await service.replaySafeGenerateStatement(buildStatementRequest());
    expect(result.statement.statementState).toBe('GENERATED');
  });

  it('returns the B1 billing document versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_BILLING_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_BILLING_ENGINE_SCOPE_KEY);
  });
});
