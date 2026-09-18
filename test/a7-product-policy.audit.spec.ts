import {
  A7ProductPolicyAuditAdapter,
  assertA7AuditObligationCodesConsistent,
} from '../src/policy/a7-product-policy.audit.adapter';
import type { TypeOrmPolicyAuditAdapter } from '../src/policy/capability-policy-audit.adapter';
import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
  A7_PRODUCT_POLICY_AUDIT_ACTOR,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
  A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
} from '../src/policy/a7-product-policy.constants';
import {
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicyCollectionStatus,
} from '../src/policy/capability-policy.enums';
import type { PolicyAuditFact, PolicyDecisionResult } from '../src/policy/capability-policy.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const DECISION_REFERENCE = 'a4-decision-test-1';
const REQUEST_HASH = 'a'.repeat(64);
const NORMALIZED_INPUT_HASH = 'b'.repeat(64);
const CORRELATION_ID = 'correlation-audit-1';
const REQUEST_ID = 'request-audit-1';

class FakeA4AuditAdapter {
  readonly facts: PolicyAuditFact[] = [];

  record(fact: PolicyAuditFact): Promise<void> {
    this.facts.push(fact);
    return Promise.resolve();
  }
}

function makeDecision(overrides: Partial<PolicyDecisionResult> = {}): PolicyDecisionResult {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    decisionReference: DECISION_REFERENCE,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: 'product.virtual-account',
    action: 'assign',
    profileReference: 'profile.product-virtual-account-assign.v1',
    profileKey: 'profile.product-virtual-account-assign',
    profileVersion: 1,
    policyVersion: 'a4.profile.product-virtual-account-assign.v1',
    definitionHash: 'c'.repeat(64),
    decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
    requestedAt: '2026-08-07T10:00:00.000Z',
    evaluatedAt: '2026-08-07T10:00:00.000Z',
    expiresAt: '2026-08-07T10:15:00.000Z',
    reviewAt: null,
    reasonCodes: ['LIMITED_ALLOW'],
    explanation: { key: 'POLICY_ALLOW_WITH_LIMITS', audience: 'INTERNAL' },
    obligations: [
      { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION, required: true },
      { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING, required: true },
      { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE, required: true },
      { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT, required: true },
    ],
    limits: [{ type: 'SINGLE_TRANSACTION_AMOUNT', currency: 'NGN', amountMinor: '50000' }],
    sourceReferences: [],
    evidenceContext: {
      snapshotReference: 'snapshot-audit-1',
      snapshotContractVersion: 1,
      normalizedInputHash: NORMALIZED_INPUT_HASH,
      freshnessSummary: [PolicyEvidenceFreshnessState.CURRENT],
      collectionStatus: PolicyCollectionStatus.COMPLETE,
    },
    authorizationContextReference: 'a2-auth-audit-1',
    requestHash: REQUEST_HASH,
    resultHash: 'd'.repeat(64),
    idempotencyReplay: false,
    requestContext: { requestId: REQUEST_ID, correlationId: CORRELATION_ID },
    ...overrides,
  };
}

describe('A7T03 A4 product-policy audit adapter', () => {
  it('exposes the A7 audit obligation codes in a stable, frozen order', () => {
    const codes = assertA7AuditObligationCodesConsistent();
    expect(Object.isFrozen(codes)).toBe(true);
    expect(codes).toEqual([
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    ]);
  });

  it('records an A4 audit fact with the A7 product-policy decision context', async () => {
    const a4AuditAdapter = new FakeA4AuditAdapter();
    const adapter = new A7ProductPolicyAuditAdapter(
      a4AuditAdapter as unknown as TypeOrmPolicyAuditAdapter,
    );
    const decision = makeDecision();

    await adapter.recordDecision({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_PENDING',
      partnerReference: 'a6-partner-reference:virtual-account-assign-1',
      obligationCodes: [
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
      ],
      reasonCodes: decision.reasonCodes,
      decision,
    });

    expect(a4AuditAdapter.facts).toHaveLength(1);
    const fact = a4AuditAdapter.facts[0];
    if (!fact) throw new Error('Expected an A4 audit fact to be recorded');
    expect(fact).toMatchObject({
      action: 'A7_DECISION_CREATED',
      decisionReference: DECISION_REFERENCE,
      customerId: CUSTOMER_ID,
      capability: 'product.virtual-account',
      policyVersion: 'a4.profile.product-virtual-account-assign.v1',
      decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
      requestHash: REQUEST_HASH,
      normalizedInputHash: NORMALIZED_INPUT_HASH,
      correlationId: CORRELATION_ID,
      requestId: REQUEST_ID,
      actor: A7_PRODUCT_POLICY_AUDIT_ACTOR,
    });
    expect(fact.metadata).toMatchObject({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_PENDING',
      partnerReference: 'a6-partner-reference:virtual-account-assign-1',
      a7AuditContractName: 'A7-PRODUCT-POLICY',
      a7AuditContractVersion: 1,
      a4AuditContractName: 'A4-CAPABILITY-POLICY',
      a4AuditContractVersion: 1,
    });
    expect(fact.metadata?.obligationCodes).toEqual([
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    ]);
  });

  it('records an A4 audit fact with null partner reference when no A6 partner reference is present', async () => {
    const a4AuditAdapter = new FakeA4AuditAdapter();
    const adapter = new A7ProductPolicyAuditAdapter(
      a4AuditAdapter as unknown as TypeOrmPolicyAuditAdapter,
    );
    const decision = makeDecision();

    await adapter.recordDecision({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'NEW',
      partnerReference: null,
      obligationCodes: [
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
      ],
      reasonCodes: decision.reasonCodes,
      decision,
    });

    const fact = a4AuditAdapter.facts[0];
    if (!fact) throw new Error('Expected an A4 audit fact to be recorded');
    expect(fact.metadata?.partnerReference).toBeNull();
  });

  it('records an A4 audit fact for A7 product-policy re-evaluation', async () => {
    const a4AuditAdapter = new FakeA4AuditAdapter();
    const adapter = new A7ProductPolicyAuditAdapter(
      a4AuditAdapter as unknown as TypeOrmPolicyAuditAdapter,
    );
    const decision = makeDecision();

    await adapter.recordReevaluation({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_CLEARED',
      partnerReference: 'a6-partner-reference:virtual-account-assign-1',
      obligationCodes: [
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
        A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
      ],
      reasonCodes: decision.reasonCodes,
      decision,
      reevaluationReference: 'a4-reevaluation-test-1',
      reevaluationState: 'COMPLETED',
      reevaluationAttempts: 1,
    });

    expect(a4AuditAdapter.facts).toHaveLength(1);
    const fact = a4AuditAdapter.facts[0];
    if (!fact) throw new Error('Expected an A4 audit fact to be recorded');
    expect(fact).toMatchObject({
      action: 'A7_DECISION_REEVALUATED',
      decisionReference: DECISION_REFERENCE,
      customerId: CUSTOMER_ID,
      capability: 'product.virtual-account',
      policyVersion: 'a4.profile.product-virtual-account-assign.v1',
      decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
      actor: A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
    });
    expect(fact.metadata).toMatchObject({
      reevaluationReference: 'a4-reevaluation-test-1',
      reevaluationState: 'COMPLETED',
      reevaluationAttempts: 1,
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_CLEARED',
    });
  });
});
