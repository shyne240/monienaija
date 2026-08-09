import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1FeeEngineRepository } from '../src/policy/b1-fee-engine.repository';
import {
  B1_FEE_ENGINE_CONTRACT_NAME,
  B1_FEE_ENGINE_CONTRACT_VERSION,
  B1_FEE_ENGINE_FAILURE_INCOMPATIBLE,
  B1_FEE_ENGINE_FAILURE_INVALID_COMMAND,
  B1_FEE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
  B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_FEE_ENGINE_SCOPE_CURRENCY,
  B1_FEE_ENGINE_SCOPE_KEY,
  B1_FEE_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-fee-engine.constants';
import type { B1CommercialDecisionRequestV1 } from '../src/policy/b1-fee-engine.types';

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequest = (
  overrides: Partial<B1CommercialDecisionRequestV1> = {},
): B1CommercialDecisionRequestV1 => ({
  contractName: B1_FEE_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  decisionKind: 'FEE',
  decisionRequestId: 'b1-fee-engine-req-1',
  decisionRequestVersion: 1,
  scopeKey: B1_FEE_ENGINE_SCOPE_KEY,
  scopeVersion: B1_FEE_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_FEE_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  baseAmountMinor: '100000',
  baseCurrency: B1_FEE_ENGINE_SCOPE_CURRENCY,
  customerId: 'b1-fee-engine-customer-1',
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantId: 'b1-fee-engine-merchant-1',
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerId: 'b1-fee-engine-partner-1',
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
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
  idempotencyKey: 'a'.repeat(64),
  requestContext: {
    requestId: 'b1-fee-engine-req',
    correlationId: 'b1-fee-engine-corr',
    traceId: 'b1-fee-engine-trace',
  },
  causationId: 'b1-fee-engine-causation',
  ...overrides,
});

describe('B1 fee engine repository (B1T04)', () => {
  let repository: B1FeeEngineRepository;

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
    repository = new B1FeeEngineRepository(
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
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
  });

  it('exposes the canonical B1 fee engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_FEE_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(B1_FEE_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 fee engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_FEE_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_FEE_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_FEE_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 fee engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-fee-engine');
    expect(repository.getAuditEntityType()).toBe('B1_COMMERCIAL_DECISION');
    expect(repository.getOutboxEventType()).toBe('B1CommercialDecisionDecided');
    expect(repository.getInternalIdempotencyScope()).toBe(B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE);
    expect(repository.getIdempotencyRetentionSeconds()).toBe(
      B1_FEE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS,
    );
    expect(repository.getReferencePrefix()).toBe('b1-commercial-decision');
  });

  it('exposes the B1 fee engine decision kind, outcome, and rule vocabularies', () => {
    expect(repository.getDecisionKinds()).toContain('FEE');
    expect(repository.getDecisionKinds()).toContain('COMMISSION');
    expect(repository.getDecisionKinds()).toContain('REVENUE_SHARING');
    expect(repository.getDecisionOutcomes()).toContain('COMMERCIAL_DECISION_ADMITTED');
    expect(repository.getDecisionOutcomes()).toContain('COMMERCIAL_DECISION_SUPPRESSED');
    expect(repository.getDecisionOutcomes()).toContain('COMMERCIAL_DECISION_DISABLED');
    expect(repository.getDecisionOutcomes()).toContain('COMMERCIAL_DECISION_FAILED');
    expect(repository.getAdmittedOutcome()).toBe('COMMERCIAL_DECISION_ADMITTED');
    expect(repository.getRuleKinds().length).toBeGreaterThan(20);
    expect(repository.getRuleOutcomes()).toContain('PASS');
    expect(repository.getRoundingPolicies()).toContain('BANKERS_ROUND');
  });

  it('exposes the B1 fee engine lookup, compatibility, consumer contract, version negotiation, and replay rule identifiers', () => {
    expect(repository.getLookupKinds().length).toBe(15);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
  });

  it('exposes the B1 fee engine declared dependencies, prohibited dependencies, and prohibited adjacent scopes', () => {
    expect(repository.getDeclaredDependencies()).toContain('A1-CANONICAL-IDENTITY');
    expect(repository.getDeclaredDependencies()).toContain('B1-COMMERCIAL-CATALOG');
    expect(repository.getProhibitedDependencies()).toContain('B1_BILLING_ENGINE');
    expect(repository.getProhibitedDependencies()).toContain('B1_TAX_ENGINE');
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
  });

  it('exposes the B1 fee engine failure codes, metrics, and data control classifications', () => {
    expect(repository.getFailureCodes().length).toBe(17);
    expect(repository.getMetrics().length).toBeGreaterThan(10);
    expect(repository.getDataControlClassifications().length).toBe(5);
  });

  it('returns the B1 fee engine consumer ports', () => {
    const ports = repository.getConsumerPorts();
    expect(typeof ports.evaluate).toBe('function');
    expect(typeof ports.replaySafeEvaluate).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('returns the B1 fee engine versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_FEE_ENGINE_CONTRACT_NAME);
    expect(versioning.decisionVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_FEE_ENGINE_SCOPE_KEY);
    expect(versioning.scopeVersion).toBe(B1_FEE_ENGINE_SCOPE_VERSION);
  });

  it('evaluates a B1 commercial decision and returns a deterministic record', () => {
    const request = buildRequest();
    const record = repository.evaluate(request);
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_ADMITTED');
    expect(record.decisionKind).toBe('FEE');
    expect(record.baseAmountMinor).toBe('100000');
    expect(record.currency).toBe('NGN');
    expect(record.accountingUnit).toBe('CUSTOMER_FUNDS');
    expect(SHA256_RE.test(record.decisionHash)).toBe(true);
    expect(SHA256_RE.test(record.decisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.requestHash)).toBe(true);
    expect(record.appliedPlan?.planKey).toBe(request.planKey);
    expect(record.appliedTiers?.customerTierKey).toBe(request.customerTierKey);
    expect(record.appliedTiers?.partnerTierKey).toBe(request.partnerTierKey);
    expect(record.appliedSubscription?.subscriptionKey).toBe(request.subscriptionKey);
    expect(record.appliedPackage?.packageKey).toBe(request.packageKey);
    expect(record.appliedBundle?.bundleKey).toBe(request.bundleKey);
    expect(record.appliedProductEntitlement?.entitlementKey).toBe(request.productEntitlementKey);
    expect(record.appliedFeatureFlags.length).toBe(2);
    expect(record.appliedDynamicLimits.length).toBe(2);
    expect(record.feeBreakdown).not.toBeNull();
    expect(record.commissionBreakdown).toBeNull();
    expect(record.revenueSharingBreakdown).toBeNull();
    expect(record.explanationTrace.traceKind).toBe('FEE_DECISION');
    expect(record.explanationTrace.traceSteps.length).toBeGreaterThan(20);
    expect(record.ruleTrace.ruleTraceSteps.length).toBe(record.explanationTrace.traceSteps.length);
    expect(record.auditEvidence.auditEntityType).toBe('B1_COMMERCIAL_DECISION');
    expect(record.auditEvidence.auditActor).toBe('b1-fee-engine');
    expect(record.failure).toBeNull();
    expect(record.replayed).toBe(false);
    expect(record.conflict).toBe(false);
  });

  it('produces a deterministic B1 commercial decision for identical inputs', () => {
    const request = buildRequest();
    const a = repository.evaluate(request);
    const b = repository.evaluate(request);
    expect(a.decisionHash).toBe(b.decisionHash);
    expect(a.decisionReplayHash).toBe(b.decisionReplayHash);
    expect(a.requestHash).toBe(b.requestHash);
    expect(a.feeBreakdown?.netFeeMinor).toBe(b.feeBreakdown?.netFeeMinor);
  });

  it('returns a commission breakdown for COMMISSION decision kind', () => {
    const record = repository.evaluate(
      buildRequest({
        decisionKind: 'COMMISSION',
        capabilityKey: 'commercial.virtual-account.inbound-funding.commission',
      }),
    );
    expect(record.decisionKind).toBe('COMMISSION');
    expect(record.feeBreakdown).toBeNull();
    expect(record.commissionBreakdown).not.toBeNull();
    expect(record.commissionBreakdown?.commissionRateBps).toBe(0);
    expect(record.explanationTrace.traceKind).toBe('COMMISSION_DECISION');
  });

  it('returns a revenue sharing breakdown for REVENUE_SHARING decision kind', () => {
    const record = repository.evaluate(buildRequest({ decisionKind: 'REVENUE_SHARING' }));
    expect(record.decisionKind).toBe('REVENUE_SHARING');
    expect(record.feeBreakdown).toBeNull();
    expect(record.commissionBreakdown).toBeNull();
    expect(record.revenueSharingBreakdown).not.toBeNull();
    expect(record.revenueSharingBreakdown?.platformShareMinor).toBe('0');
    expect(record.explanationTrace.traceKind).toBe('REVENUE_SHARING_DECISION');
  });

  it('returns a failure record for an invalid contract name', () => {
    const record = repository.evaluate(buildRequest({ contractName: 'B1-OTHER-ENGINE' as never }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid scope key', () => {
    const record = repository.evaluate(buildRequest({ scopeKey: 'commercial.fx' as never }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid scope version', () => {
    const record = repository.evaluate(buildRequest({ scopeVersion: 2 as never }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid decision kind', () => {
    const record = repository.evaluate(buildRequest({ decisionKind: 'INVALID' as never }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid currency', () => {
    const record = repository.evaluate(buildRequest({ expectedCurrency: 'USD' as never }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid accounting unit', () => {
    const record = repository.evaluate(
      buildRequest({ expectedAccountingUnit: 'MERCHANT_FUNDS' as never }),
    );
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid product key', () => {
    const record = repository.evaluate(buildRequest({ productKey: 'SAVINGS' as never }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure record for an invalid idempotency key', () => {
    const record = repository.evaluate(buildRequest({ idempotencyKey: 'invalid' }));
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_FAILED');
    expect(record.failure?.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 commercial decision compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildRequest());
    expect(compatibility.compatible).toBe(true);
    expect(compatibility.reasons.length).toBeGreaterThan(0);
  });

  it('returns a compatibility mismatch for the wrong scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_FEE_ENGINE_FAILURE_INVALID_COMMAND);
    }
  });

  it('returns a compatibility mismatch for the wrong decision kind', () => {
    const compatibility = repository.compatibilityCheck(
      buildRequest({ decisionKind: 'INVALID' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns a compatibility mismatch for a prohibited adjacent scope', () => {
    const compatibility = repository.compatibilityCheck(
      buildRequest({
        planKey: 'commercial.virtual-account.outbound-settlement' as never,
      }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_FEE_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a B1 fee engine consumer ports (evaluate, replaySafeEvaluate, compatibilityCheck)', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.evaluate(buildRequest());
    expect(evaluated.decisionOutcome).toBe('COMMERCIAL_DECISION_ADMITTED');
  });

  it('returns a replay-safe evaluate result', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeEvaluate(buildRequest());
    expect(result.record.decisionOutcome).toBe('COMMERCIAL_DECISION_ADMITTED');
    expect(result.idempotencyScope).toBe(B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE);
    expect(SHA256_RE.test(result.requestHash)).toBe(true);
    expect(SHA256_RE.test(result.decisionHash)).toBe(true);
    expect(SHA256_RE.test(result.decisionReplayHash)).toBe(true);
    expect(result.replayed).toBe(false);
  });

  it('returns a compatibility check result', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildRequest());
    expect(result.compatible).toBe(true);
  });
});
