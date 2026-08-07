import { ConflictException, ForbiddenException } from '@nestjs/common';

import type { AuthorizationPolicy } from '../src/authorization/authorization.types';
import { StaticCapabilityPolicyProfileRegistry } from '../src/policy/capability-policy.profiles';
import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import {
  calculateSnapshotInputHash,
  CapabilityPolicyEvaluationService,
} from '../src/policy/capability-policy.service';
import type {
  PolicyAuditFact,
  PolicyAuditPort,
  PolicyDecisionResult,
  PolicyDecisionStore,
  PolicyEvaluationCommand,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
  PolicyIdempotencyCommand,
  PolicyIdempotencyPort,
  PolicyIdempotencyReservation,
  PolicyAuthorizationPort,
} from '../src/policy/capability-policy.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const BINDING_ID = '00000000-0000-4000-8000-000000000002';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';

const principal = {
  type: 'SERVICE' as const,
  principalId: 'policy-service',
  customerId: CUSTOMER_ID,
  audience: 'internal-policy',
  roles: ['policy'],
  scopes: ['policy:capability:evaluate'],
  customerAccess: 'ANY' as const,
  assuranceLevel: 'MFA' as const,
};

class FakeAuthorizationService implements PolicyAuthorizationPort {
  allowed = true;
  readonly policies: AuthorizationPolicy[] = [];

  authorize(
    _principal: typeof principal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: { type: string; id?: string; customerId?: string },
  ) {
    if (policy) this.policies.push(policy);
    return Promise.resolve({
      allowed: this.allowed,
      reason: this.allowed ? undefined : ('SCOPE_MISSING' as const),
      principalType: 'SERVICE' as const,
      principalId: principal.principalId,
      resourceType: resource.type,
      resourceId: resource.id,
      customerId: resource.customerId,
      action: policy?.action ?? 'UNKNOWN',
      evaluatedAt: new Date(REQUESTED_AT),
      requiredScopes: policy?.requiredScopes ?? [],
      requiredRoles: policy?.requiredRoles ?? [],
    });
  }
}

class FakeDecisionStore implements PolicyDecisionStore {
  readonly byRequestHash = new Map<string, PolicyDecisionResult>();
  readonly byDecisionReference = new Map<string, PolicyDecisionResult>();
  saveCalls = 0;

  findByRequestHash(requestHash: string): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(this.byRequestHash.get(requestHash) ?? null);
  }

  save(result: PolicyDecisionResult): Promise<void> {
    this.saveCalls += 1;
    this.byRequestHash.set(result.requestHash, result);
    this.byDecisionReference.set(result.decisionReference, result);
    return Promise.resolve();
  }

  findByDecisionReference(decisionReference: string): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(this.byDecisionReference.get(decisionReference) ?? null);
  }
}

class FakeIdempotencyPort implements PolicyIdempotencyPort {
  readonly records = new Map<
    string,
    {
      reservationId: string;
      requestHash: string;
      status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      result?: PolicyDecisionResult;
    }
  >();
  private sequence = 0;
  completeCalls = 0;
  failCalls = 0;

  reserve(command: PolicyIdempotencyCommand): Promise<PolicyIdempotencyReservation> {
    const key = `${command.scope}:${command.key}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        return Promise.reject(
          new ConflictException('The idempotency key was already used for another request'),
        );
      }
      if (existing.status === 'IN_PROGRESS') {
        return Promise.resolve({ kind: 'IN_PROGRESS', reservationId: existing.reservationId });
      }
      return Promise.resolve({
        kind: 'REPLAY',
        reservationId: existing.reservationId,
        result: existing.result,
        decisionReference: existing.result?.decisionReference,
      });
    }
    this.sequence += 1;
    const reservationId = `reservation-${this.sequence}`;
    this.records.set(key, {
      reservationId,
      requestHash: command.requestHash,
      status: 'IN_PROGRESS',
    });
    return Promise.resolve({ kind: 'NEW', reservationId });
  }

  complete(reservationId: string, result: PolicyDecisionResult): Promise<void> {
    const record = [...this.records.values()].find((item) => item.reservationId === reservationId);
    if (!record) return Promise.reject(new Error('Reservation not found'));
    record.status = 'COMPLETED';
    record.result = result;
    this.completeCalls += 1;
    return Promise.resolve();
  }

  fail(reservationId: string, reason: string): Promise<void> {
    void reason;
    const record = [...this.records.values()].find((item) => item.reservationId === reservationId);
    if (record) record.status = 'FAILED';
    this.failCalls += 1;
    return Promise.resolve();
  }
}

class FakeAuditPort implements PolicyAuditPort {
  readonly facts: PolicyAuditFact[] = [];

  record(fact: PolicyAuditFact): Promise<void> {
    this.facts.push(fact);
    return Promise.resolve();
  }
}

interface Fixture {
  service: CapabilityPolicyEvaluationService;
  authorization: FakeAuthorizationService;
  decisions: FakeDecisionStore;
  idempotency: FakeIdempotencyPort;
  audit: FakeAuditPort;
}

function makeItem(
  sourceClass: PolicySourceClass,
  sourceType: string,
  normalizedValue: Record<string, unknown>,
  overrides: Partial<PolicyEvidenceItem> = {},
): PolicyEvidenceItem {
  return {
    sourceClass,
    sourceType,
    sourceId: `${sourceClass.toLowerCase()}-source`,
    customerId: CUSTOMER_ID,
    sourceVersion: 1,
    sourceUpdatedAt: REQUESTED_AT,
    observedAt: REQUESTED_AT,
    deleted: false,
    freshnessState: PolicyEvidenceFreshnessState.CURRENT,
    classification: 'Restricted',
    normalizedValue,
    sourceReference: `${sourceClass.toLowerCase()}:source`,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<PolicyEvidenceSnapshot> = {},
  itemOverrides: Partial<Record<PolicySourceClass, PolicyEvidenceItem[]>> = {},
): PolicyEvidenceSnapshot {
  const items: PolicyEvidenceItem[] = [
    makeItem(PolicySourceClass.CUSTOMER, 'Customer', {
      status: 'ACTIVE',
      version: 1,
    }),
    makeItem(PolicySourceClass.ONBOARDING, 'CustomerOnboarding', {
      status: 'COMPLETED',
      version: 1,
    }),
    makeItem(PolicySourceClass.ELIGIBILITY, 'CustomerEligibility', {
      status: 'ELIGIBLE',
      version: 1,
    }),
    makeItem(PolicySourceClass.RESTRICTIONS, 'CustomerRestriction', {
      type: 'NONE',
      active: false,
      version: 1,
    }),
    makeItem(PolicySourceClass.LIMITS, 'CustomerLimitProfile', {
      profileVersion: 1,
      currency: 'NGN',
      dailyTransactionCount: 10,
      dailyTransactionAmountMinor: '100000',
      singleTransactionAmountMinor: '50000',
      monthlyTransactionAmountMinor: '500000',
      walletBalanceMinor: '1000000',
    }),
    makeItem(PolicySourceClass.ENROLLMENT, 'CustomerProductEnrollment', {
      product: 'wallet.transfer',
      status: 'ACTIVE',
      version: 1,
    }),
    makeItem(PolicySourceClass.PERMISSIONS, 'CustomerOperatingPermission', {
      type: 'TRANSFER',
      enabled: true,
      version: 1,
    }),
    makeItem(PolicySourceClass.RISK, 'CustomerRiskProfile', {
      sourceKind: 'P1_10_MANUAL',
      status: 'ACTIVE',
      riskLevel: 'LOW',
      assessmentDate: '2026-08-01T00:00:00.000Z',
      reviewDueDate: '2026-09-01T00:00:00.000Z',
      factorReferences: ['factor-1'],
      version: 1,
    }),
    makeItem(PolicySourceClass.COMPLIANCE, 'CustomerComplianceCase', {
      casePresent: false,
    }),
    makeItem(PolicySourceClass.ACCOUNT_BINDING, 'CustomerFinancialAccountBinding', {
      bindingId: BINDING_ID,
      state: 'ACTIVE',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      dimensionsCompatible: true,
      ledgerIsActive: true,
      reconciliationStatus: 'PASS',
    }),
  ];
  const replaced = items.flatMap((item) => itemOverrides[item.sourceClass] ?? [item]);
  const sourceClasses = Object.values(PolicySourceClass);
  const snapshot: PolicyEvidenceSnapshot = {
    contractName: 'A4-EVIDENCE-SNAPSHOT',
    contractVersion: 1,
    snapshotReference: 'snapshot-transfer-1',
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    policyRequestScope: {
      capability: 'wallet.transfer',
      action: 'create',
      requestedAt: REQUESTED_AT,
      asOf: REQUESTED_AT,
      evidenceProfile: 'profile.wallet-transfer-create.v1',
    },
    collection: {
      status: PolicyCollectionStatus.COMPLETE,
      startedAt: REQUESTED_AT,
      collectedAt: REQUESTED_AT,
      requiredSourceClasses: sourceClasses,
      collectedSourceClasses: sourceClasses,
      missingSourceClasses: [],
      unavailableSourceClasses: [],
      restrictedSourceClasses: [],
      conflictSourceClasses: [],
    },
    sourceItems: replaced,
    evidenceSummary: {
      freshnessStates: [PolicyEvidenceFreshnessState.CURRENT],
      sourceCount: replaced.length,
      normalizedInputHash: '',
    },
    integrity: {
      canonicalizationVersion: 1,
      arrayOrderingRule: 'sourceClass/sourceType/sourceId/sourceVersion',
      hashAlgorithm: 'SHA-256',
    },
    ...overrides,
  };
  return {
    ...snapshot,
    evidenceSummary: {
      ...snapshot.evidenceSummary,
      normalizedInputHash: calculateSnapshotInputHash(snapshot),
    },
  };
}

function makeRequest(
  snapshot: PolicyEvidenceSnapshot,
  overrides: Partial<PolicyEvaluationCommand> = {},
): PolicyEvaluationCommand {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: 'wallet.transfer',
    action: 'create',
    requestedAt: REQUESTED_AT,
    evaluationContext: {
      currency: 'NGN',
      targetBindingId: BINDING_ID,
      limitUsage: {
        amountMinor: '10000',
        currency: 'NGN',
        dailyUsedCount: 1,
        dailyUsedAmountMinor: '10000',
        monthlyUsedAmountMinor: '10000',
        projectedWalletBalanceMinor: '50000',
        usageAsOf: REQUESTED_AT,
        usageSourceReference: 'usage:transfer-1',
      },
    },
    actorContext: { principal },
    sourceEvidenceRequest: {
      evidenceProfile: 'profile.wallet-transfer-create.v1',
      asOf: REQUESTED_AT,
      requiredSourceClasses: Object.values(PolicySourceClass),
    },
    requestContext: {
      requestId: 'request-policy-1',
      correlationId: 'correlation-policy-1',
      traceId: 'trace-policy-1',
    },
    idempotencyContext: {
      scope: 'policy.capability-decision.v1',
      key: 'policy-request-1',
    },
    snapshot,
    ...overrides,
  };
}

function makeFixture(): Fixture {
  const authorization = new FakeAuthorizationService();
  const decisions = new FakeDecisionStore();
  const idempotency = new FakeIdempotencyPort();
  const audit = new FakeAuditPort();
  return {
    service: new CapabilityPolicyEvaluationService(
      authorization,
      new StaticCapabilityPolicyProfileRegistry(),
      decisions,
      idempotency,
      audit,
    ),
    authorization,
    decisions,
    idempotency,
    audit,
  };
}

describe('CapabilityPolicyEvaluationService', () => {
  it('evaluates a current transfer profile with exact limits and A2 authorization', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot();

    const result = await fixture.service.evaluate(makeRequest(snapshot));

    expect(result).toMatchObject({
      decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
      capability: 'wallet.transfer',
      action: 'create',
      policyVersion: 'a4.profile.wallet-transfer-create.v1',
      profileReference: 'profile.wallet-transfer-create.v1',
      idempotencyReplay: false,
    });
    expect(result.reasonCodes).toContain('LIMITED_ALLOW');
    expect(result.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RECHECK_A2_AUTHORIZATION', required: true }),
        expect.objectContaining({ code: 'RECHECK_A3_BINDING', required: true }),
        expect.objectContaining({ code: 'RECHECK_EXECUTION_LIMIT', required: true }),
      ]),
    );
    expect(result.limits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'SINGLE_TRANSACTION_AMOUNT',
          currency: 'NGN',
          amountMinor: '50000',
        }),
      ]),
    );
    expect(result.evidenceContext.normalizedInputHash).toBe(
      snapshot.evidenceSummary.normalizedInputHash,
    );
    expect(fixture.authorization.policies[0]).toMatchObject({
      resourceType: 'customer-capability-policy',
      action: 'policy:capability:evaluate',
      requiredScopes: ['policy:capability:evaluate'],
    });
    expect(fixture.decisions.saveCalls).toBe(1);
    expect(fixture.audit.facts[0]).toMatchObject({ action: 'DECISION_CREATED' });
  });

  it('applies deny, suspend, and review precedence without mutating the snapshot', async () => {
    const fixture = makeFixture();
    const deniedSnapshot = makeSnapshot(
      {},
      {
        [PolicySourceClass.RESTRICTIONS]: [
          makeItem(PolicySourceClass.RESTRICTIONS, 'CustomerRestriction', {
            type: 'BLACKLISTED',
            active: true,
          }),
        ],
        [PolicySourceClass.RISK]: [
          makeItem(PolicySourceClass.RISK, 'CustomerRiskProfile', {
            sourceKind: 'P1_10_MANUAL',
            status: 'ACTIVE',
            riskLevel: 'CRITICAL',
            factorReferences: ['factor-1'],
            reviewDueDate: '2026-09-01T00:00:00.000Z',
          }),
        ],
      },
    );
    const before = JSON.stringify(deniedSnapshot);
    const denied = await fixture.service.evaluate(
      makeRequest(deniedSnapshot, {
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'deny-1' },
      }),
    );
    expect(denied.decision).toBe(PolicyDecisionState.DENY);
    expect(denied.reasonCodes).toEqual(
      expect.arrayContaining(['RESTRICTION_BLACKLISTED', 'RISK_CRITICAL_REVIEW']),
    );
    expect(JSON.stringify(deniedSnapshot)).toBe(before);

    const suspendedSnapshot = makeSnapshot(
      {},
      {
        [PolicySourceClass.RESTRICTIONS]: [
          makeItem(PolicySourceClass.RESTRICTIONS, 'CustomerRestriction', {
            type: 'FROZEN',
            active: true,
          }),
        ],
      },
    );
    const suspended = await fixture.service.evaluate(
      makeRequest(suspendedSnapshot, {
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'suspend-1' },
      }),
    );
    expect(suspended.decision).toBe(PolicyDecisionState.SUSPEND);

    const pendingSnapshot = makeSnapshot(
      {},
      {
        [PolicySourceClass.RISK]: [
          makeItem(
            PolicySourceClass.RISK,
            'CustomerRiskProfile',
            {
              sourceKind: 'P1_10_MANUAL',
              status: 'ACTIVE',
              riskLevel: 'LOW',
              factorReferences: ['factor-1'],
            },
            { freshnessState: PolicyEvidenceFreshnessState.STALE },
          ),
        ],
      },
    );
    const pending = await fixture.service.evaluate(
      makeRequest(pendingSnapshot, {
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'pending-1' },
      }),
    );
    expect(pending.decision).toBe(PolicyDecisionState.PENDING_REVIEW);
  });

  it('rejects disabled permissions and missing enrollments', async () => {
    const fixture = makeFixture();
    const disabled = makeSnapshot(
      {},
      {
        [PolicySourceClass.PERMISSIONS]: [
          makeItem(PolicySourceClass.PERMISSIONS, 'CustomerOperatingPermission', {
            type: 'TRANSFER',
            enabled: false,
          }),
        ],
      },
    );
    const denied = await fixture.service.evaluate(
      makeRequest(disabled, {
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'disabled-1' },
      }),
    );
    expect(denied.decision).toBe(PolicyDecisionState.DENY);
    expect(denied.reasonCodes).toContain('PERMISSION_DISABLED');

    const missingEnrollment = makeSnapshot({}, { [PolicySourceClass.ENROLLMENT]: [] });
    const enrollmentDenied = await fixture.service.evaluate(
      makeRequest(missingEnrollment, {
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'enrollment-1' },
      }),
    );
    expect(enrollmentDenied.decision).toBe(PolicyDecisionState.DENY);
    expect(enrollmentDenied.reasonCodes).toContain('ENROLLMENT_REQUIRED');
  });

  it('rejects exceeded and unavailable limits deterministically', async () => {
    const fixture = makeFixture();
    const exceeded = await fixture.service.evaluate(
      makeRequest(makeSnapshot(), {
        evaluationContext: {
          currency: 'NGN',
          targetBindingId: BINDING_ID,
          limitUsage: {
            amountMinor: '60000',
            currency: 'NGN',
            dailyUsedCount: 1,
            dailyUsedAmountMinor: '10000',
            monthlyUsedAmountMinor: '10000',
            projectedWalletBalanceMinor: '50000',
            usageAsOf: REQUESTED_AT,
          },
        },
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'limit-exceeded-1' },
      }),
    );
    expect(exceeded.decision).toBe(PolicyDecisionState.DENY);
    expect(exceeded.reasonCodes).toContain('LIMIT_EXCEEDED');

    const unavailable = await fixture.service.evaluate(
      makeRequest(makeSnapshot(), {
        evaluationContext: {
          currency: 'NGN',
          targetBindingId: BINDING_ID,
          limitUsage: undefined,
        },
        idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'limit-unavailable-1' },
      }),
    );
    expect(unavailable.decision).toBe(PolicyDecisionState.PENDING_REVIEW);
    expect(unavailable.reasonCodes).toContain('LIMIT_USAGE_UNAVAILABLE');
  });

  it('replays identical requests and rejects changed payloads under the same key', async () => {
    const fixture = makeFixture();
    const request = makeRequest(makeSnapshot());
    const first = await fixture.service.evaluate(request);
    const second = await fixture.service.evaluate(request);

    expect(second).toMatchObject({
      decisionReference: first.decisionReference,
      resultHash: first.resultHash,
      idempotencyReplay: true,
    });
    expect(fixture.decisions.saveCalls).toBe(1);
    expect(fixture.idempotency.completeCalls).toBe(1);
    expect(fixture.audit.facts.map((fact) => fact.action)).toEqual([
      'DECISION_CREATED',
      'DECISION_REPLAYED',
    ]);

    await expect(
      fixture.service.evaluate(
        makeRequest(makeSnapshot(), {
          evaluationContext: {
            currency: 'NGN',
            targetBindingId: BINDING_ID,
            limitUsage: { amountMinor: '20000', currency: 'NGN' },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.decisions.saveCalls).toBe(1);
  });

  it('supports deterministic read-only evaluation without persisting a decision', async () => {
    const fixture = makeFixture();
    const result = await fixture.service.evaluateReadOnly(makeRequest(makeSnapshot()));

    expect(result.decision).toBe(PolicyDecisionState.ALLOW_WITH_LIMITS);
    expect(fixture.decisions.saveCalls).toBe(0);
    expect(fixture.audit.facts).toHaveLength(0);
  });

  it('prevents concurrent identical evaluations from creating ambiguous decisions', async () => {
    const fixture = makeFixture();
    const request = makeRequest(makeSnapshot(), {
      idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'concurrent-1' },
    });

    const outcomes = await Promise.allSettled([
      fixture.service.evaluate(request),
      fixture.service.evaluate(request),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<PolicyDecisionResult> =>
        outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConflictException);
    expect(fixture.decisions.saveCalls).toBe(1);
  });

  it('fails closed for authorization denial, snapshot mismatch, and invalid policy profiles', async () => {
    const fixture = makeFixture();
    fixture.authorization.allowed = false;
    await expect(fixture.service.evaluate(makeRequest(makeSnapshot()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fixture.decisions.saveCalls).toBe(0);

    const invalidSnapshot = makeSnapshot();
    const mismatched = {
      ...invalidSnapshot,
      evidenceSummary: { ...invalidSnapshot.evidenceSummary, normalizedInputHash: '0'.repeat(64) },
    };
    fixture.authorization.allowed = true;
    await expect(fixture.service.evaluate(makeRequest(mismatched))).rejects.toBeInstanceOf(
      ConflictException,
    );

    await expect(
      fixture.service.evaluate(
        makeRequest(makeSnapshot(), {
          capability: 'wallet.unknown',
          idempotencyContext: { scope: 'policy.capability-decision.v1', key: 'unknown-1' },
        }),
      ),
    ).rejects.toThrow('No A4 policy profile is registered');
  });
});
