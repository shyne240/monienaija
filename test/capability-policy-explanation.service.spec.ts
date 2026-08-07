import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import { CapabilityPolicyExplanationService } from '../src/policy/capability-policy-explanation.service';
import { PolicyExplanationAudience } from '../src/policy/capability-policy-explanation.enums';
import type { PolicyDecisionResult } from '../src/policy/capability-policy.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';

function makeDecision(overrides: Partial<PolicyDecisionResult> = {}): PolicyDecisionResult {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    decisionReference: 'a4-decision-1',
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: 'wallet.transfer',
    action: 'create',
    profileReference: 'profile.wallet-transfer-create.v1',
    profileKey: 'profile.wallet-transfer-create',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-transfer-create.v1',
    definitionHash: 'd'.repeat(64),
    decision: PolicyDecisionState.DENY,
    requestedAt: REQUESTED_AT,
    evaluatedAt: REQUESTED_AT,
    expiresAt: null,
    reviewAt: '2026-09-01T00:00:00.000Z',
    reasonCodes: [
      'RISK_CRITICAL_REVIEW',
      'LIMIT_EXCEEDED',
      'COMPLIANCE_REVIEW_OPEN',
      'RESTRICTION_BLACKLISTED',
      'ONBOARDING_INCOMPLETE',
      'LIMIT_EXCEEDED',
    ],
    explanation: {
      key: 'raw-internal-explanation-that-must-not-be-exposed',
      audience: 'INTERNAL',
    },
    obligations: [
      { code: 'RECHECK_A2_AUTHORIZATION', required: true, reference: 'auth-secret-reference' },
      { code: 'RECHECK_A3_BINDING', required: true, reference: 'binding-internal-reference' },
      { code: 'RECHECK_EXECUTION_LIMIT', required: true, reference: 'limit-reference' },
      { code: 'MANUAL_REVIEW_REQUIRED', required: false },
    ],
    limits: [
      {
        type: 'SINGLE_TRANSACTION_AMOUNT',
        currency: 'NGN',
        amountMinor: '50000',
        remainingMinor: '40000',
        limitReference: 'limit-internal-reference',
      },
    ],
    sourceReferences: [
      {
        sourceClass: PolicySourceClass.RISK,
        sourceType: 'CustomerRiskProfile',
        sourceId: 'risk-sensitive-id',
        customerId: CUSTOMER_ID,
        sourceVersion: 3,
        observedAt: REQUESTED_AT,
        freshnessState: PolicyEvidenceFreshnessState.CURRENT,
        classification: 'Highly Restricted',
        reference: 'risk-sensitive-reference',
      },
      {
        sourceClass: PolicySourceClass.COMPLIANCE,
        sourceType: 'CustomerComplianceCase',
        sourceId: 'case-sensitive-id',
        customerId: CUSTOMER_ID,
        sourceVersion: 4,
        observedAt: REQUESTED_AT,
        freshnessState: PolicyEvidenceFreshnessState.CURRENT,
        classification: 'Highly Restricted',
        reference: 'case-sensitive-reference',
      },
      {
        sourceClass: PolicySourceClass.ELIGIBILITY,
        sourceType: 'CustomerEligibility',
        sourceId: 'eligibility-id',
        customerId: CUSTOMER_ID,
        sourceVersion: 2,
        observedAt: REQUESTED_AT,
        freshnessState: PolicyEvidenceFreshnessState.CURRENT,
        classification: 'Restricted',
        reference: 'eligibility-reference',
      },
    ],
    evidenceContext: {
      snapshotReference: 'snapshot-1',
      snapshotContractVersion: 1,
      normalizedInputHash: 'a'.repeat(64),
      freshnessSummary: [PolicyEvidenceFreshnessState.CURRENT],
      collectionStatus: PolicyCollectionStatus.COMPLETE,
    },
    authorizationContextReference: 'a2-auth-reference',
    requestHash: 'b'.repeat(64),
    resultHash: 'c'.repeat(64),
    idempotencyReplay: false,
    requestContext: {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      traceId: 'trace-1',
    },
    ...overrides,
  };
}

describe('CapabilityPolicyExplanationService', () => {
  it('generates safe customer explanations and filters sensitive provenance', () => {
    const service = new CapabilityPolicyExplanationService();

    const result = service.explain({
      audience: PolicyExplanationAudience.CUSTOMER,
      decision: makeDecision(),
    });

    expect(result).toMatchObject({
      contractName: 'A4-CAPABILITY-EXPLANATION',
      contractVersion: 1,
      audience: PolicyExplanationAudience.CUSTOMER,
      readOnly: true,
      customerId: CUSTOMER_ID,
      policyVersion: 'a4.profile.wallet-transfer-create.v1',
    });
    expect(result.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        'ONBOARDING_REQUIREMENT',
        'CAPABILITY_NOT_AVAILABLE',
        'ADDITIONAL_REVIEW_REQUIRED',
        'LIMIT_EXCEEDED',
      ]),
    );
    expect(result.reasons.map((reason) => reason.code)).not.toContain('RISK_CRITICAL_REVIEW');
    expect(result.reasons.map((reason) => reason.code)).not.toContain('COMPLIANCE_REVIEW_OPEN');
    expect(result.provenance.sourceReferences).toEqual([]);
    expect(result.provenance.snapshotReference).toBeUndefined();
    expect(result.provenance.definitionHash).toBeUndefined();
    expect(result.obligations.map((item) => item.code)).not.toContain('RECHECK_A2_AUTHORIZATION');
    expect(result.obligations.every((item) => item.reference === undefined)).toBe(true);
    expect(result.limits[0]).toEqual(
      expect.objectContaining({ type: 'SINGLE_TRANSACTION_AMOUNT', currency: 'NGN' }),
    );
    expect(result.limits[0]?.limitReference).toBeUndefined();
  });

  it('filters customer-support reasons and source references without exposing raw evidence', () => {
    const service = new CapabilityPolicyExplanationService();

    const result = service.explain({
      audience: PolicyExplanationAudience.CUSTOMER_SUPPORT,
      decision: makeDecision({ decision: PolicyDecisionState.PENDING_REVIEW }),
    });

    expect(result.reasons.map((reason) => reason.code)).toContain('REVIEW_REQUIRED');
    expect(result.reasons.map((reason) => reason.code)).not.toContain('RISK_CRITICAL_REVIEW');
    expect(result.provenance.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: PolicySourceClass.RISK,
          sourceType: 'CustomerRiskProfile',
        }),
        expect.objectContaining({
          sourceClass: PolicySourceClass.COMPLIANCE,
          sourceType: 'CustomerComplianceCase',
        }),
        expect.objectContaining({
          sourceClass: PolicySourceClass.ELIGIBILITY,
          sourceType: 'CustomerEligibility',
        }),
      ]),
    );
    expect(
      result.provenance.sourceReferences.find(
        (reference) => reference.sourceClass === PolicySourceClass.RISK,
      ),
    ).not.toHaveProperty('sourceId');
    expect(result.provenance.sourceReferences[0]).not.toHaveProperty('reference');
    expect(result.provenance.snapshotReference).toBe('snapshot-1');
    expect(result.provenance.normalizedInputHash).toBe('a'.repeat(64));
    expect(result.obligations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ACCOUNT_REVIEW_REQUIRED' })]),
    );
    expect(result.obligations.every((item) => item.reference === undefined)).toBe(true);
  });

  it('preserves safe internal reasons, references, obligations, limits, and provenance for operations', () => {
    const service = new CapabilityPolicyExplanationService();

    const result = service.explain({
      audience: PolicyExplanationAudience.OPERATIONS,
      decision: makeDecision({ decision: PolicyDecisionState.ALLOW_WITH_LIMITS }),
    });

    expect(result.reasons.map((reason) => reason.code)).toEqual([
      'ONBOARDING_INCOMPLETE',
      'RESTRICTION_BLACKLISTED',
      'RISK_CRITICAL_REVIEW',
      'COMPLIANCE_REVIEW_OPEN',
      'LIMIT_EXCEEDED',
    ]);
    expect(result.provenance).toMatchObject({
      decisionReference: 'a4-decision-1',
      profileReference: 'profile.wallet-transfer-create.v1',
      definitionHash: 'd'.repeat(64),
      snapshotReference: 'snapshot-1',
      normalizedInputHash: 'a'.repeat(64),
      resultHash: 'c'.repeat(64),
    });
    expect(result.provenance.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceClass: PolicySourceClass.RISK,
          sourceType: 'CustomerRiskProfile',
        }),
        expect.objectContaining({
          sourceClass: PolicySourceClass.COMPLIANCE,
          sourceType: 'CustomerComplianceCase',
        }),
        expect.objectContaining({
          sourceClass: PolicySourceClass.ELIGIBILITY,
          sourceId: 'eligibility-id',
          reference: 'eligibility-reference',
        }),
      ]),
    );
    expect(
      result.provenance.sourceReferences.find(
        (reference) => reference.sourceClass === PolicySourceClass.RISK,
      ),
    ).not.toHaveProperty('sourceId');
    expect(
      result.provenance.sourceReferences.find(
        (reference) => reference.sourceClass === PolicySourceClass.COMPLIANCE,
      ),
    ).not.toHaveProperty('reference');
    expect(result.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RECHECK_A2_AUTHORIZATION',
          reference: 'auth-secret-reference',
        }),
        expect.objectContaining({
          code: 'RECHECK_A3_BINDING',
          reference: 'binding-internal-reference',
        }),
      ]),
    );
    expect(result.limits[0]?.limitReference).toBe('limit-internal-reference');
  });

  it('orders reasons deterministically, deduplicates mappings, and is replay-consistent', () => {
    const service = new CapabilityPolicyExplanationService();
    const decision = makeDecision({
      reasonCodes: ['LIMIT_EXCEEDED', 'RISK_CRITICAL_REVIEW', 'LIMIT_EXCEEDED'],
    });

    const first = service.explain({
      audience: PolicyExplanationAudience.CUSTOMER,
      decision,
    });
    const second = service.explain({
      audience: PolicyExplanationAudience.CUSTOMER,
      decision,
    });

    expect(second).toEqual(first);
    expect(first.reasons).toHaveLength(2);
    expect(first.reasons.map((reason) => reason.code)).toEqual([
      'LIMIT_EXCEEDED',
      'ADDITIONAL_REVIEW_REQUIRED',
    ]);
    expect(first.provenance.resultHash).toBeUndefined();
  });

  it('supports internal-services filtering without exposing normalized source values', () => {
    const service = new CapabilityPolicyExplanationService();

    const result = service.explain({
      audience: PolicyExplanationAudience.INTERNAL_SERVICES,
      decision: makeDecision({
        sourceReferences: [
          ...makeDecision().sourceReferences,
          {
            sourceClass: PolicySourceClass.ACCOUNT_BINDING,
            sourceType: 'CustomerFinancialAccountBinding',
            sourceId: 'binding-id',
            customerId: CUSTOMER_ID,
            sourceVersion: 5,
            observedAt: REQUESTED_AT,
            freshnessState: PolicyEvidenceFreshnessState.CURRENT,
            classification: 'Highly Restricted financial/control data',
            reference: 'binding-reference',
          },
        ],
      }),
    });

    expect(result.audience).toBe(PolicyExplanationAudience.INTERNAL_SERVICES);
    expect(result.provenance.sourceReferences).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: 'binding-id' })]),
    );
    expect(JSON.stringify(result)).not.toContain(
      'raw-internal-explanation-that-must-not-be-exposed',
    );
    expect(JSON.stringify(result)).not.toContain('normalizedValue');
  });
});
