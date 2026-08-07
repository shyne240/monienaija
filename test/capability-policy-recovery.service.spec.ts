import { ConflictException } from '@nestjs/common';

import type {
  AuthorizationDecision,
  AuthorizationPolicy,
} from '../src/authorization/authorization.types';
import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import { StaticCapabilityPolicyProfileRegistry } from '../src/policy/capability-policy.profiles';
import {
  CapabilityPolicyEvaluationService,
  calculateSnapshotInputHash,
} from '../src/policy/capability-policy.service';
import type {
  PolicyAuditFact,
  PolicyAuditPort,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
  PolicyIdempotencyCommand,
  PolicyIdempotencyPort,
  PolicyIdempotencyReservation,
  PolicyAuthorizationPort,
} from '../src/policy/capability-policy.types';
import {
  PolicyCurrentnessState,
  PolicyProfileVersionState,
  PolicyRecoveryState,
  PolicyReevaluationState,
  PolicyReevaluationTrigger,
} from '../src/policy/capability-policy-recovery.enums';
import {
  CapabilityPolicyRecoveryService,
  PolicyRetryableRecoveryError,
  PolicyUnknownRecoveryOutcomeError,
} from '../src/policy/capability-policy-recovery.service';
import type {
  PolicyCurrentEffectiveDecisionQuery,
  PolicyDecisionEvaluator,
  PolicyDecisionLifecycleStore,
  PolicyProfileLifecyclePort,
  PolicyRecoveryClock,
  PolicyRecoveryDiagnostic,
} from '../src/policy/capability-policy-recovery.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const BINDING_ID = '00000000-0000-4000-8000-000000000002';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';
const LATER_AT = '2026-08-07T10:16:00.000Z';

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
  authorize(
    _principal: typeof principal | undefined,
    policy: AuthorizationPolicy | undefined,
    resource: { type: string; id?: string; customerId?: string },
  ): Promise<AuthorizationDecision> {
    return Promise.resolve({
      allowed: true,
      principalType: 'SERVICE',
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

class FakeDecisionStore implements PolicyDecisionLifecycleStore {
  readonly byRequestHash = new Map<string, PolicyDecisionResult>();
  readonly byDecisionReference = new Map<string, PolicyDecisionResult>();
  readonly current = new Map<string, PolicyDecisionResult>();
  saveCalls = 0;

  findByRequestHash(requestHash: string): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(this.byRequestHash.get(requestHash) ?? null);
  }

  save(result: PolicyDecisionResult): Promise<void> {
    this.saveCalls += 1;
    this.byRequestHash.set(result.requestHash, result);
    this.byDecisionReference.set(result.decisionReference, result);
    this.current.set(this.key(result.subject.customerId, result.capability, result.action), result);
    return Promise.resolve();
  }

  findByDecisionReference(decisionReference: string): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(this.byDecisionReference.get(decisionReference) ?? null);
  }

  findCurrentEffectiveDecision(
    query: PolicyCurrentEffectiveDecisionQuery,
  ): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(
      this.current.get(this.key(query.customerId, query.capability, query.action)) ?? null,
    );
  }

  private key(customerId: string, capability: string, action: string): string {
    return `${customerId}|${capability}|${action}`;
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
        return Promise.reject(new ConflictException('The idempotency key was already used'));
      }
      if (existing.status === 'IN_PROGRESS') {
        return Promise.resolve({ kind: 'IN_PROGRESS', reservationId: existing.reservationId });
      }
      if (existing.result) {
        return Promise.resolve({
          kind: 'REPLAY',
          reservationId: existing.reservationId,
          result: existing.result,
          decisionReference: existing.result.decisionReference,
        });
      }
      this.records.delete(key);
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

class FixedClock implements PolicyRecoveryClock {
  sleeps: number[] = [];

  constructor(private readonly value: string) {}

  now(): Date {
    return new Date(this.value);
  }

  sleep(milliseconds: number): Promise<void> {
    this.sleeps.push(milliseconds);
    return Promise.resolve();
  }
}

class FakeDiagnostics {
  readonly entries: PolicyRecoveryDiagnostic[] = [];

  record(diagnostic: PolicyRecoveryDiagnostic): Promise<void> {
    this.entries.push(diagnostic);
    return Promise.resolve();
  }
}

class FlakyEvaluator implements PolicyDecisionEvaluator {
  calls = 0;

  constructor(
    private readonly delegate: PolicyDecisionEvaluator,
    private readonly failure: Error,
  ) {}

  evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult> {
    this.calls += 1;
    if (this.calls === 1) return Promise.reject(this.failure);
    return this.delegate.evaluate(command);
  }
}

class UnknownAfterDurableEvaluator implements PolicyDecisionEvaluator {
  calls = 0;

  constructor(private readonly delegate: PolicyDecisionEvaluator) {}

  async evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult> {
    this.calls += 1;
    await this.delegate.evaluate(command);
    throw new PolicyUnknownRecoveryOutcomeError('A4_AUDIT_OUTCOME_UNKNOWN');
  }
}

class AlwaysRetryingEvaluator implements PolicyDecisionEvaluator {
  calls = 0;

  evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult> {
    void command;
    this.calls += 1;
    return Promise.reject(new PolicyRetryableRecoveryError('A4_EVIDENCE_UNAVAILABLE'));
  }
}

function makeItem(
  sourceClass: PolicySourceClass,
  sourceType: string,
  normalizedValue: Record<string, unknown>,
  at: string,
  overrides: Partial<PolicyEvidenceItem> = {},
): PolicyEvidenceItem {
  return {
    sourceClass,
    sourceType,
    sourceId: `${sourceClass.toLowerCase()}-source`,
    customerId: CUSTOMER_ID,
    sourceVersion: 1,
    sourceUpdatedAt: at,
    observedAt: at,
    deleted: false,
    freshnessState: PolicyEvidenceFreshnessState.CURRENT,
    classification: 'Restricted',
    normalizedValue,
    sourceReference: `${sourceClass.toLowerCase()}:source`,
    ...overrides,
  };
}

function makeSnapshot(
  at = REQUESTED_AT,
  options: {
    riskFreshness?: PolicyEvidenceFreshnessState;
    riskReviewDueDate?: string;
    conflictSourceClasses?: readonly PolicySourceClass[];
    collectionStatus?: PolicyCollectionStatus;
    snapshotReference?: string;
    restriction?: Record<string, unknown>;
  } = {},
): PolicyEvidenceSnapshot {
  const items: PolicyEvidenceItem[] = [
    makeItem(PolicySourceClass.CUSTOMER, 'Customer', { status: 'ACTIVE', version: 1 }, at),
    makeItem(
      PolicySourceClass.ONBOARDING,
      'CustomerOnboarding',
      { status: 'COMPLETED', version: 1 },
      at,
    ),
    makeItem(
      PolicySourceClass.ELIGIBILITY,
      'CustomerEligibility',
      { status: 'ELIGIBLE', version: 1 },
      at,
    ),
    makeItem(
      PolicySourceClass.RESTRICTIONS,
      'CustomerRestriction',
      options.restriction ?? { type: 'NONE', active: false, version: 1 },
      at,
    ),
    makeItem(
      PolicySourceClass.LIMITS,
      'CustomerLimitProfile',
      {
        profileVersion: 1,
        currency: 'NGN',
        dailyTransactionCount: 10,
        dailyTransactionAmountMinor: '100000',
        singleTransactionAmountMinor: '50000',
        monthlyTransactionAmountMinor: '500000',
        walletBalanceMinor: '1000000',
      },
      at,
    ),
    makeItem(
      PolicySourceClass.ENROLLMENT,
      'CustomerProductEnrollment',
      { product: 'wallet.transfer', status: 'ACTIVE', version: 1 },
      at,
    ),
    makeItem(
      PolicySourceClass.PERMISSIONS,
      'CustomerOperatingPermission',
      { type: 'TRANSFER', enabled: true, version: 1 },
      at,
    ),
    makeItem(
      PolicySourceClass.RISK,
      'CustomerRiskProfile',
      {
        sourceKind: 'P1_10_MANUAL',
        status: 'ACTIVE',
        riskLevel: 'LOW',
        reviewDueDate: options.riskReviewDueDate ?? '2026-09-01T00:00:00.000Z',
        factorReferences: ['factor-1'],
        version: 1,
      },
      at,
      options.riskFreshness ? { freshnessState: options.riskFreshness } : {},
    ),
    makeItem(PolicySourceClass.COMPLIANCE, 'CustomerComplianceCase', { casePresent: false }, at),
    makeItem(
      PolicySourceClass.ACCOUNT_BINDING,
      'CustomerFinancialAccountBinding',
      {
        bindingId: BINDING_ID,
        state: 'ACTIVE',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        dimensionsCompatible: true,
        ledgerIsActive: true,
        reconciliationStatus: 'PASS',
      },
      at,
    ),
  ];
  const sourceClasses = Object.values(PolicySourceClass);
  const snapshot: PolicyEvidenceSnapshot = {
    contractName: 'A4-EVIDENCE-SNAPSHOT',
    contractVersion: 1,
    snapshotReference: options.snapshotReference ?? `snapshot-${at}`,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    policyRequestScope: {
      capability: 'wallet.transfer',
      action: 'create',
      requestedAt: at,
      asOf: at,
      evidenceProfile: 'profile.wallet-transfer-create.v1',
    },
    collection: {
      status: options.collectionStatus ?? PolicyCollectionStatus.COMPLETE,
      startedAt: at,
      collectedAt: at,
      requiredSourceClasses: sourceClasses,
      collectedSourceClasses: sourceClasses,
      missingSourceClasses: [],
      unavailableSourceClasses: [],
      restrictedSourceClasses: [],
      conflictSourceClasses: options.conflictSourceClasses ?? [],
    },
    sourceItems: items,
    evidenceSummary: {
      freshnessStates: [PolicyEvidenceFreshnessState.CURRENT],
      sourceCount: items.length,
      normalizedInputHash: '',
    },
    integrity: {
      canonicalizationVersion: 1,
      arrayOrderingRule: 'sourceClass/sourceType/sourceId/sourceVersion',
      hashAlgorithm: 'SHA-256',
    },
  };
  return {
    ...snapshot,
    evidenceSummary: {
      ...snapshot.evidenceSummary,
      normalizedInputHash: calculateSnapshotInputHash(snapshot),
    },
  };
}

function makeEvaluation(
  snapshot: PolicyEvidenceSnapshot,
  key = 'reevaluation-1',
): PolicyEvaluationCommand {
  const at = snapshot.policyRequestScope.asOf;
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: 'wallet.transfer',
    action: 'create',
    requestedAt: at,
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
        usageAsOf: at,
      },
    },
    actorContext: { principal },
    sourceEvidenceRequest: {
      evidenceProfile: 'profile.wallet-transfer-create.v1',
      asOf: at,
      requiredSourceClasses: Object.values(PolicySourceClass),
    },
    requestContext: {
      requestId: `request-${key}`,
      correlationId: `correlation-${key}`,
      traceId: `trace-${key}`,
    },
    idempotencyContext: {
      scope: 'policy.capability-decision.v1',
      key: `inner-${key}`,
    },
    snapshot,
  };
}

interface Fixture {
  store: FakeDecisionStore;
  idempotency: FakeIdempotencyPort;
  audit: FakeAuditPort;
  diagnostics: FakeDiagnostics;
  evaluator: CapabilityPolicyEvaluationService;
  recovery: CapabilityPolicyRecoveryService;
}

function makeRecoveryWithEvaluator(
  dependencies: Pick<Fixture, 'store' | 'idempotency' | 'audit' | 'diagnostics'>,
  evaluator: PolicyDecisionEvaluator,
  clock: PolicyRecoveryClock = new FixedClock(LATER_AT),
  profileLifecycle?: PolicyProfileLifecyclePort,
): CapabilityPolicyRecoveryService {
  return new CapabilityPolicyRecoveryService(
    evaluator,
    new StaticCapabilityPolicyProfileRegistry(),
    dependencies.store,
    dependencies.idempotency,
    dependencies.audit,
    {
      clock,
      profileLifecycle,
      diagnostics: dependencies.diagnostics,
      retry: { maxAttempts: 2, baseDelayMilliseconds: 0, maxDelayMilliseconds: 0 },
    },
  );
}

function makeFixture(
  evaluatorOverride?: PolicyDecisionEvaluator,
  clock: PolicyRecoveryClock = new FixedClock(LATER_AT),
): Fixture {
  const authorization = new FakeAuthorizationService();
  const store = new FakeDecisionStore();
  const idempotency = new FakeIdempotencyPort();
  const audit = new FakeAuditPort();
  const diagnostics = new FakeDiagnostics();
  const evaluator = new CapabilityPolicyEvaluationService(
    authorization,
    new StaticCapabilityPolicyProfileRegistry(),
    store,
    idempotency,
    audit,
  );
  const recovery = makeRecoveryWithEvaluator(
    { store, idempotency, audit, diagnostics },
    evaluatorOverride ?? evaluator,
    clock,
  );
  return { store, idempotency, audit, diagnostics, evaluator, recovery };
}

function makeReevaluation(
  snapshot: PolicyEvidenceSnapshot,
  key: string,
  trigger: PolicyReevaluationTrigger,
  previousDecisionReference?: string,
) {
  return {
    contractName: 'A4-POLICY-REEVALUATION' as const,
    contractVersion: 1 as const,
    trigger,
    evaluation: makeEvaluation(snapshot, key),
    ...(previousDecisionReference ? { previousDecisionReference } : {}),
    idempotencyContext: {
      scope: 'policy.capability-decision.v1' as const,
      key,
    },
  };
}

describe('CapabilityPolicyRecoveryService', () => {
  it('sets an immutable expiry and refuses an expired decision as current', async () => {
    const fixture = makeFixture(undefined, new FixedClock(LATER_AT));
    const originalSnapshot = makeSnapshot();
    const original = await fixture.evaluator.evaluate(makeEvaluation(originalSnapshot, 'original'));
    expect(original.expiresAt).toBe('2026-08-07T10:15:00.000Z');

    const current = await fixture.recovery.getCurrentEffectiveDecision({
      customerId: CUSTOMER_ID,
      capability: 'wallet.transfer',
      action: 'create',
      asOf: REQUESTED_AT,
      evidenceProfile: 'profile.wallet-transfer-create.v1',
      actorContext: { principal },
      requestContext: makeEvaluation(originalSnapshot).requestContext,
      currentSnapshot: originalSnapshot,
    });

    expect(current.currentness).toBe(PolicyCurrentnessState.EXPIRED);
    expect(current.requiresReevaluation).toBe(true);
    expect(current.decision?.decisionReference).toBe(original.decisionReference);
    expect(fixture.store.byDecisionReference.get(original.decisionReference)).toEqual(original);
  });

  it('marks a review-due decision non-current without rewriting its review timestamp', async () => {
    const fixture = makeFixture(undefined, new FixedClock('2026-08-07T10:05:00.000Z'));
    const snapshot = makeSnapshot(REQUESTED_AT, {
      riskReviewDueDate: '2026-08-07T10:01:00.000Z',
      snapshotReference: 'snapshot-review-due',
    });
    const decision = await fixture.evaluator.evaluate(makeEvaluation(snapshot, 'review-due'));

    const current = await fixture.recovery.getCurrentEffectiveDecision({
      customerId: CUSTOMER_ID,
      capability: 'wallet.transfer',
      action: 'create',
      asOf: REQUESTED_AT,
      evidenceProfile: 'profile.wallet-transfer-create.v1',
      actorContext: { principal },
      requestContext: makeEvaluation(snapshot).requestContext,
      currentSnapshot: snapshot,
    });

    expect(decision.reviewAt).toBe('2026-08-07T10:01:00.000Z');
    expect(current.currentness).toBe(PolicyCurrentnessState.REVIEW_DUE);
    expect(current.decision?.reviewAt).toBe(decision.reviewAt);
  });

  it('re-evaluates an expired decision, preserves lineage, and never rewrites the old result', async () => {
    const fixture = makeFixture();
    const originalSnapshot = makeSnapshot();
    const original = await fixture.evaluator.evaluate(makeEvaluation(originalSnapshot, 'original'));
    const replacementSnapshot = makeSnapshot(LATER_AT, {
      snapshotReference: 'snapshot-replacement',
    });

    const revalued = await fixture.recovery.reevaluate(
      makeReevaluation(
        replacementSnapshot,
        'expired-recovery',
        PolicyReevaluationTrigger.EXPIRED,
        original.decisionReference,
      ),
    );

    expect(revalued.state).toBe(PolicyReevaluationState.COMPLETED);
    expect(revalued.decision?.decision).toBe(PolicyDecisionState.ALLOW_WITH_LIMITS);
    expect(revalued.decision?.supersedesDecisionReference).toBe(original.decisionReference);
    expect(revalued.decision?.decisionReference).not.toBe(original.decisionReference);
    expect(fixture.store.byDecisionReference.get(original.decisionReference)).toEqual(original);
    expect(fixture.audit.facts.map((fact) => fact.action)).toEqual(
      expect.arrayContaining(['DECISION_REEVALUATED']),
    );
  });

  it('blocks re-evaluation against retired or superseded policy versions', async () => {
    const fixture = makeFixture();
    const originalSnapshot = makeSnapshot();
    const original = await fixture.evaluator.evaluate(
      makeEvaluation(originalSnapshot, 'lifecycle'),
    );
    const retiredLifecycle: PolicyProfileLifecyclePort = {
      getVersionState: () => Promise.resolve(PolicyProfileVersionState.RETIRED),
      getCurrentPolicyVersion: () => Promise.resolve(original.policyVersion),
    };
    const retiredRecovery = makeRecoveryWithEvaluator(
      fixture,
      fixture.evaluator,
      new FixedClock(LATER_AT),
      retiredLifecycle,
    );
    const retired = await retiredRecovery.reevaluate(
      makeReevaluation(
        makeSnapshot(LATER_AT, { snapshotReference: 'snapshot-retired' }),
        'retired-policy',
        PolicyReevaluationTrigger.POLICY_VERSION_SUPERSEDED,
        original.decisionReference,
      ),
    );
    expect(retired.state).toBe(PolicyReevaluationState.BLOCKED);
    expect(retired.recovery.code).toBe('POLICY_VERSION_RETIRED');

    const supersededLifecycle: PolicyProfileLifecyclePort = {
      getVersionState: () => Promise.resolve(PolicyProfileVersionState.ACTIVE),
      getCurrentPolicyVersion: () => Promise.resolve('a4.profile.wallet-transfer-create.v2'),
    };
    const supersededRecovery = makeRecoveryWithEvaluator(
      fixture,
      fixture.evaluator,
      new FixedClock(LATER_AT),
      supersededLifecycle,
    );
    const superseded = await supersededRecovery.reevaluate(
      makeReevaluation(
        makeSnapshot(LATER_AT, { snapshotReference: 'snapshot-superseded' }),
        'superseded-policy',
        PolicyReevaluationTrigger.POLICY_VERSION_SUPERSEDED,
        original.decisionReference,
      ),
    );
    expect(superseded.state).toBe(PolicyReevaluationState.BLOCKED);
    expect(superseded.recovery.code).toBe('POLICY_VERSION_SUPERSEDED');
  });

  it('fails closed for stale, conflicting, and unavailable evidence without changing source snapshots', async () => {
    const staleSnapshot = makeSnapshot(REQUESTED_AT, {
      riskFreshness: PolicyEvidenceFreshnessState.STALE,
      snapshotReference: 'snapshot-stale',
    });
    const staleBefore = JSON.stringify(staleSnapshot);
    const staleFixture = makeFixture();
    const stale = await staleFixture.recovery.reevaluate(
      makeReevaluation(staleSnapshot, 'stale-recovery', PolicyReevaluationTrigger.STALE_EVIDENCE),
    );
    expect(stale.state).toBe(PolicyReevaluationState.COMPLETED);
    expect(stale.decision?.decision).toBe(PolicyDecisionState.PENDING_REVIEW);
    expect(stale.recovery.state).toBe(PolicyRecoveryState.MANUAL_REVIEW);
    expect(stale.decision?.reasonCodes).toContain('EVIDENCE_RISK_STALE');
    expect(JSON.stringify(staleSnapshot)).toBe(staleBefore);

    const conflictingSnapshot = makeSnapshot(REQUESTED_AT, {
      conflictSourceClasses: [PolicySourceClass.RISK],
      snapshotReference: 'snapshot-conflicting',
    });
    const conflicting = await staleFixture.recovery.reevaluate(
      makeReevaluation(
        conflictingSnapshot,
        'conflicting-recovery',
        PolicyReevaluationTrigger.CONFLICTING_EVIDENCE,
      ),
    );
    expect(conflicting.decision?.decision).toBe(PolicyDecisionState.PENDING_REVIEW);
    expect(conflicting.decision?.reasonCodes).toContain('EVIDENCE_RISK_CONFLICTING');

    const unavailableSnapshot = makeSnapshot(REQUESTED_AT, {
      collectionStatus: PolicyCollectionStatus.UNAVAILABLE,
      snapshotReference: 'snapshot-unavailable',
    });
    const unavailable = await staleFixture.recovery.reevaluate(
      makeReevaluation(
        unavailableSnapshot,
        'unavailable-recovery',
        PolicyReevaluationTrigger.UNAVAILABLE_EVIDENCE,
      ),
    );
    expect(unavailable.decision?.decision).toBe(PolicyDecisionState.PENDING_REVIEW);
    expect(unavailable.recovery.state).toBe(PolicyRecoveryState.MANUAL_REVIEW);
    expect(unavailable.recovery.retryable).toBe(true);
  });

  it('retries transient evaluation failures with bounded attempts and recovery audit facts', async () => {
    const fixture = makeFixture();
    const flaky = new FlakyEvaluator(
      fixture.evaluator,
      new PolicyRetryableRecoveryError('A4_SERIALIZATION_RETRY'),
    );
    fixture.recovery = makeRecoveryWithEvaluator(fixture, flaky);
    const result = await fixture.recovery.reevaluate(
      makeReevaluation(
        makeSnapshot(REQUESTED_AT, { snapshotReference: 'snapshot-retry' }),
        'retry-recovery',
        PolicyReevaluationTrigger.MANUAL,
      ),
    );

    expect(result.state).toBe(PolicyReevaluationState.COMPLETED);
    expect(result.attempts).toBe(2);
    expect(flaky.calls).toBe(2);
    expect(fixture.audit.facts.map((fact) => fact.action)).toEqual(
      expect.arrayContaining(['REEVALUATION_RETRY', 'DECISION_REEVALUATED']),
    );
  });

  it('bounds retries and leaves a retry-required non-decision after exhaustion', async () => {
    const fixture = makeFixture();
    const alwaysRetrying = new AlwaysRetryingEvaluator();
    fixture.recovery = makeRecoveryWithEvaluator(fixture, alwaysRetrying);
    const result = await fixture.recovery.reevaluate(
      makeReevaluation(
        makeSnapshot(REQUESTED_AT, { snapshotReference: 'snapshot-retry-exhausted' }),
        'retry-exhausted',
        PolicyReevaluationTrigger.UNAVAILABLE_EVIDENCE,
      ),
    );

    expect(result.state).toBe(PolicyReevaluationState.RETRY_SCHEDULED);
    expect(result.decision).toBeNull();
    expect(result.recovery.state).toBe(PolicyRecoveryState.RETRY_REQUIRED);
    expect(alwaysRetrying.calls).toBe(2);
    expect(fixture.idempotency.failCalls).toBe(1);
  });

  it('verifies durable evidence after an unknown outcome before retrying', async () => {
    const fixture = makeFixture();
    const unknown = new UnknownAfterDurableEvaluator(fixture.evaluator);
    fixture.recovery = makeRecoveryWithEvaluator(fixture, unknown);
    const result = await fixture.recovery.reevaluate(
      makeReevaluation(
        makeSnapshot(REQUESTED_AT, { snapshotReference: 'snapshot-unknown' }),
        'unknown-recovery',
        PolicyReevaluationTrigger.MANUAL,
      ),
    );

    expect(result.state).toBe(PolicyReevaluationState.COMPLETED);
    expect(result.recovery.code).toBe('A4_UNKNOWN_OUTCOME_VERIFIED');
    expect(result.attempts).toBe(1);
    expect(unknown.calls).toBe(1);
  });

  it('replays an identical re-evaluation and conflicts on changed payloads', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(REQUESTED_AT, { snapshotReference: 'snapshot-replay' });
    const request = makeReevaluation(snapshot, 'replay-recovery', PolicyReevaluationTrigger.MANUAL);
    const first = await fixture.recovery.reevaluate(request);
    const replay = await fixture.recovery.reevaluate(request);

    expect(replay.state).toBe(PolicyReevaluationState.REPLAYED);
    expect(replay.idempotencyReplay).toBe(true);
    expect(replay.reevaluationReference).toBe(first.reevaluationReference);
    expect(fixture.store.saveCalls).toBe(1);

    const changed = makeReevaluation(
      makeSnapshot(REQUESTED_AT, { snapshotReference: 'snapshot-replay-changed' }),
      'replay-recovery',
      PolicyReevaluationTrigger.SOURCE_CHANGED,
    );
    await expect(fixture.recovery.reevaluate(changed)).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.store.saveCalls).toBe(1);
  });

  it('detects source change and policy supersession in current-effective lookup', async () => {
    const fixture = makeFixture(undefined, new FixedClock('2026-08-07T10:05:00.000Z'));
    const snapshot = makeSnapshot();
    const decision = await fixture.evaluator.evaluate(makeEvaluation(snapshot, 'current'));
    const changedSnapshot = makeSnapshot(REQUESTED_AT, {
      restriction: { type: 'MANUAL_REVIEW', active: true },
      snapshotReference: 'snapshot-current-changed',
    });
    const changed = await fixture.recovery.getCurrentEffectiveDecision({
      customerId: CUSTOMER_ID,
      capability: 'wallet.transfer',
      action: 'create',
      asOf: REQUESTED_AT,
      evidenceProfile: 'profile.wallet-transfer-create.v1',
      actorContext: { principal },
      requestContext: makeEvaluation(snapshot).requestContext,
      currentSnapshot: changedSnapshot,
    });
    expect(changed.currentness).toBe(PolicyCurrentnessState.STALE_EVIDENCE);
    expect(changed.decision?.decisionReference).toBe(decision.decisionReference);

    const retiredFixture = makeFixture();
    const retiredDecision = await retiredFixture.evaluator.evaluate(
      makeEvaluation(makeSnapshot(), 'retired'),
    );
    const retired = await retiredFixture.recovery.getCurrentEffectiveDecision({
      customerId: CUSTOMER_ID,
      capability: 'wallet.transfer',
      action: 'create',
      asOf: REQUESTED_AT,
      evidenceProfile: 'profile.wallet-transfer-create.v1',
      actorContext: { principal },
      requestContext: makeEvaluation(snapshot).requestContext,
      currentSnapshot: snapshot,
    });
    expect(retired.decision?.decisionReference).toBe(retiredDecision.decisionReference);
  });
});
