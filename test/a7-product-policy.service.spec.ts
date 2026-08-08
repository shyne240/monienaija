import { ConflictException, ForbiddenException } from '@nestjs/common';

import type {
  AuthorizationDecision,
  AuthorizationPolicy,
} from '../src/authorization/authorization.types';
import { A7ProductPolicyAuditAdapter } from '../src/policy/a7-product-policy.audit.adapter';
import type { A7ProductPolicyPersistenceRepository } from '../src/policy/a7-product-policy.persistence.repository';
import { A7ProductPolicyReplayService } from '../src/policy/a7-product-policy.replay.service';
import { A7ProductPolicyService } from '../src/policy/a7-product-policy.service';
import type { TypeOrmPolicyAuditAdapter } from '../src/policy/capability-policy-audit.adapter';
import {
  CapabilityPolicyEvaluationService,
  calculateSnapshotInputHash,
} from '../src/policy/capability-policy.service';
import { CapabilityPolicyRecoveryService } from '../src/policy/capability-policy-recovery.service';
import type { CapabilityPolicyHistoricalReplayService } from '../src/policy/capability-policy-historical-replay.service';
import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
  A7_PRODUCT_POLICY_AUDIT_ACTOR,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
  A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
  A7_PRODUCT_POLICY_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
  A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
} from '../src/policy/a7-product-policy.constants';
import {
  A7_PRODUCT_POLICY_COMPOSED_PROFILES,
  A7_PRODUCT_POLICY_PROFILES,
  A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS,
} from '../src/policy/a7-product-policy.profiles';
import type {
  A7ProductPolicyEvaluationCommand,
  A7ProductPolicyReevaluationCommand,
  A7ProductPolicyReplayCommand,
} from '../src/policy/a7-product-policy.types';
import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import { PolicyReplayOutcome } from '../src/policy/capability-policy-persistence.enums';
import {
  PolicyReevaluationTrigger,
  PolicyReevaluationState,
} from '../src/policy/capability-policy-recovery.enums';
import { StaticCapabilityPolicyProfileRegistry } from '../src/policy/capability-policy.profiles';
import type {
  PolicyAuditFact,
  PolicyAuditPort,
  PolicyAuthorizationPort,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
  PolicyIdempotencyCommand,
  PolicyIdempotencyPort,
  PolicyIdempotencyReservation,
} from '../src/policy/capability-policy.types';
import type { PolicyHistoricalReplayResult } from '../src/policy/capability-policy-historical-replay.service';
import type {
  PolicyDecisionLifecycleStore,
  PolicyReevaluationRequest,
  PolicyReevaluationResult,
} from '../src/policy/capability-policy-recovery.types';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const BINDING_ID = '00000000-0000-4000-8000-000000000002';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';
const SNAPSHOT_REFERENCE = 'snapshot-a7-product-policy-1';

const principal = {
  type: 'SERVICE' as const,
  principalId: 'a7-product-policy',
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
  ): Promise<AuthorizationDecision> {
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

  findCurrentEffectiveDecision(query: {
    customerId: string;
    capability: string;
    action: string;
    asOf: string;
    targetBindingId?: string;
  }): Promise<PolicyDecisionResult | null> {
    void query;
    return Promise.resolve(null);
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
    return Promise.resolve();
  }

  fail(reservationId: string, reason: string): Promise<void> {
    void reason;
    const record = [...this.records.values()].find((item) => item.reservationId === reservationId);
    if (record) record.status = 'FAILED';
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

class FakeReplayService {
  calls: Array<{ decisionReference: string; command: PolicyEvaluationCommand }> = [];
  result: PolicyHistoricalReplayResult = {
    outcome: PolicyReplayOutcome.REPLAY_UNAVAILABLE,
    decision: null,
    profile: null,
    snapshot: null,
    integrityMismatch: false,
    reconstructedDecision: null,
  };

  replay(
    decisionReference: string,
    command: PolicyEvaluationCommand,
  ): PolicyHistoricalReplayResult {
    this.calls.push({ decisionReference, command });
    return this.result;
  }
}

class FakeA7PersistenceRepository {
  getProfileCalls: Array<{ capability: string; action: string }> = [];
  recordProfileCalls: Array<{ profileReference: string }> = [];
  profiles: Map<string, unknown> = new Map();

  getProfile(capability: string, action: string): unknown {
    this.getProfileCalls.push({ capability, action });
    return this.profiles.get(`${capability}:${action}`) ?? null;
  }

  findDecisionByReference(): null {
    return null;
  }

  findDecisionByRequestHash(): null {
    return null;
  }

  recordProfile(profile: { profileReference: string }): void {
    this.recordProfileCalls.push({ profileReference: profile.profileReference });
  }

  findProfileByPolicyVersion(): null {
    return null;
  }

  listProfileRegistrations() {
    return A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS;
  }

  listProfileReferences() {
    return Object.freeze([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    ]);
  }

  listPolicyVersions() {
    return Object.freeze([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
    ]);
  }
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
  capability: string,
  action: string,
  profileReference: string,
  overrides: Partial<PolicyEvidenceSnapshot> = {},
  itemOverrides: Partial<Record<PolicySourceClass, PolicyEvidenceItem[]>> = {},
): PolicyEvidenceSnapshot {
  void overrides;
  const items: PolicyEvidenceItem[] = [
    makeItem(PolicySourceClass.CUSTOMER, 'Customer', { status: 'ACTIVE', version: 1 }),
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
      product: 'virtual-account',
      status: 'ACTIVE',
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
    makeItem(PolicySourceClass.COMPLIANCE, 'CustomerComplianceCase', { casePresent: false }),
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
    snapshotReference: SNAPSHOT_REFERENCE,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    policyRequestScope: {
      capability,
      action,
      requestedAt: REQUESTED_AT,
      asOf: REQUESTED_AT,
      evidenceProfile: profileReference,
      ...(overrides.policyRequestScope ?? {}),
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
  capability: string,
  action: string,
  profileReference: string,
  snapshot: PolicyEvidenceSnapshot,
  overrides: Partial<PolicyEvaluationCommand> = {},
): PolicyEvaluationCommand {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability,
    action,
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
        usageSourceReference: 'usage:1',
      },
    },
    actorContext: { principal },
    sourceEvidenceRequest: {
      evidenceProfile: profileReference,
      asOf: REQUESTED_AT,
      requiredSourceClasses: Object.values(PolicySourceClass),
    },
    requestContext: {
      requestId: 'request-a7-1',
      correlationId: 'correlation-a7-1',
      traceId: 'trace-a7-1',
    },
    idempotencyContext: {
      scope: A7_PRODUCT_POLICY_IDEMPOTENCY_SCOPE,
      key: 'a7-policy-key-1',
    },
    snapshot,
    ...overrides,
  };
}

interface Fixture {
  service: A7ProductPolicyService;
  evaluationService: CapabilityPolicyEvaluationService;
  recoveryService: CapabilityPolicyRecoveryService;
  replayService: FakeReplayService;
  auditAdapter: A7ProductPolicyAuditAdapter;
  a4Audit: FakeAuditPort;
  a7Persistence: FakeA7PersistenceRepository;
  a4Persistence: FakeDecisionStore;
  authorization: FakeAuthorizationService;
  idempotency: FakeIdempotencyPort;
}

function makeFixture(): Fixture {
  const authorization = new FakeAuthorizationService();
  const a4Persistence = new FakeDecisionStore();
  const idempotency = new FakeIdempotencyPort();
  const a4Audit = new FakeAuditPort();
  const evaluationService = new CapabilityPolicyEvaluationService(
    authorization,
    new StaticCapabilityPolicyProfileRegistry(A7_PRODUCT_POLICY_COMPOSED_PROFILES),
    a4Persistence,
    idempotency,
    a4Audit,
  );
  const recoveryService = new CapabilityPolicyRecoveryService(
    evaluationService,
    new StaticCapabilityPolicyProfileRegistry(A7_PRODUCT_POLICY_COMPOSED_PROFILES),
    a4Persistence,
    idempotency,
    a4Audit,
    { retry: { maxAttempts: 1, baseDelayMilliseconds: 0, maxDelayMilliseconds: 0 } },
  );
  const fakeHistoricalReplay = new FakeReplayService();
  const replayService = new A7ProductPolicyReplayService(
    fakeHistoricalReplay as unknown as CapabilityPolicyHistoricalReplayService,
  );
  const a7Persistence = new FakeA7PersistenceRepository();
  const auditAdapter = new A7ProductPolicyAuditAdapter(
    a4Audit as unknown as TypeOrmPolicyAuditAdapter,
  );
  const service = new A7ProductPolicyService(
    evaluationService,
    recoveryService,
    replayService,
    a7Persistence as unknown as A7ProductPolicyPersistenceRepository,
    auditAdapter,
  );
  return {
    service,
    evaluationService,
    recoveryService,
    replayService: fakeHistoricalReplay,
    auditAdapter,
    a4Audit,
    a7Persistence,
    a4Persistence,
    authorization,
    idempotency,
  };
}

describe('A7T03 A4 product-policy service', () => {
  it('exposes the A4 + A7 contract names and versions', () => {
    const fixture = makeFixture();
    expect(fixture.service.getContractNames()).toEqual({
      a4: 'A4-CAPABILITY-POLICY',
      a7: 'A7-PRODUCT-POLICY',
    });
    expect(fixture.service.getContractVersions()).toEqual({ a4: 1, a7: 1 });
  });

  it('exposes the A4 idempotency scopes (reused) and A4 audit actors', () => {
    const fixture = makeFixture();
    expect(fixture.service.getIdempotencyScope()).toBe(A7_PRODUCT_POLICY_IDEMPOTENCY_SCOPE);
    expect(fixture.service.getReevaluationIdempotencyScope()).toBe(
      A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
    );
    expect(fixture.service.getAuditActor()).toBe(A7_PRODUCT_POLICY_AUDIT_ACTOR);
    expect(fixture.service.getReevaluationAuditActor()).toBe(
      A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
    );
  });

  it('exposes the A4 default re-evaluation trigger for the A7 first product', () => {
    const fixture = makeFixture();
    expect(fixture.service.getDefaultReevaluationTrigger()).toBe(
      A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
    );
    expect(fixture.service.getDefaultReevaluationTrigger()).toBe(
      PolicyReevaluationTrigger.SOURCE_CHANGED,
    );
  });

  it('returns the A4 + A7 composed profiles', () => {
    const fixture = makeFixture();
    expect(fixture.service.getComposedProfiles()).toBe(A7_PRODUCT_POLICY_COMPOSED_PROFILES);
  });

  it('returns the A4 product-policy profile reference for the assign and lifecycle actions', () => {
    const fixture = makeFixture();
    expect(
      fixture.service.getProductPolicyReference(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      ),
    ).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE);
    expect(
      fixture.service.getProductPolicyReference(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE,
      ),
    ).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE);
    expect(fixture.service.getProductPolicyReference('unknown', 'unknown')).toBeNull();
    expect(
      fixture.service.getProductPolicyReference(A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY, 'unknown'),
    ).toBeNull();
  });

  it('returns the A4 product-policy version for the assign and lifecycle actions', () => {
    const fixture = makeFixture();
    expect(
      fixture.service.getProductPolicyVersion(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      ),
    ).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION);
    expect(
      fixture.service.getProductPolicyVersion(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE,
      ),
    ).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION);
    expect(fixture.service.getProductPolicyVersion('unknown', 'unknown')).toBeNull();
  });

  it('returns the A4 product-policy profile registration for the assign and lifecycle actions', () => {
    const fixture = makeFixture();
    expect(
      fixture.service.getProfileRegistration(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      ),
    ).toBe(A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[0]);
    expect(
      fixture.service.getProfileRegistration(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE,
      ),
    ).toBe(A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[1]);
    expect(fixture.service.getProfileRegistration('unknown', 'unknown')).toBeNull();
  });

  it('lists the A4 product-policy profile references, versions, and registrations', () => {
    const fixture = makeFixture();
    expect(fixture.service.listProductPolicyReferences()).toEqual([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    ]);
    expect(fixture.service.listProductPolicyVersions()).toEqual([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
    ]);
    expect(fixture.service.listProductPolicyRegistrations()).toBe(
      A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS,
    );
  });

  it('verifies the A4 product-policy definition-hash consistency', () => {
    const fixture = makeFixture();
    const verified = fixture.service.verifyProductPolicyDefinitionHashes();
    expect(verified).toHaveLength(2);
    expect(verified[0]?.profileReference).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE);
    expect(verified[1]?.profileReference).toBe(
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    );
  });

  it('looks up the A4 product-policy profile via the A7 persistence repository', async () => {
    const fixture = makeFixture();
    const assignProfile = A7_PRODUCT_POLICY_PROFILES[0];
    fixture.a7Persistence.profiles.set(
      `${A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY}:${A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN}`,
      assignProfile,
    );
    const found = await fixture.service.getProductPolicyProfile(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
    );
    expect(found).toBe(assignProfile);
    expect(fixture.a7Persistence.getProfileCalls).toEqual([
      {
        capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      },
    ]);
  });

  it('records A4 product-policy profiles for both A7 capabilities via the A7 persistence repository', async () => {
    const fixture = makeFixture();
    await fixture.service.recordProductPolicyProfile('2026-08-07T10:00:00.000Z', 'a7-onboarder');
    expect(fixture.a7Persistence.recordProfileCalls.map((call) => call.profileReference)).toEqual([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    ]);
  });

  it('evaluates an A4 product-policy decision for the A7 first product and records the A7 audit fact', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    const command: A7ProductPolicyEvaluationCommand = {
      evaluation: makeRequest(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
        snapshot,
      ),
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_PENDING',
      partnerReference: 'a6-partner-reference:virtual-account-assign-1',
    };

    const result = await fixture.service.evaluateProductPolicy(command);

    expect(result.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
    expect(result.productState).toBe('PARTNER_PENDING');
    expect(result.decision.capability).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY);
    expect(result.decision.action).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN);
    expect(result.decision.policyVersion).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION);
    expect(result.obligationCodes).toEqual([
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
      A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
    ]);
    const a7AuditFact = fixture.a4Audit.facts.find((fact) => fact.action === 'A7_DECISION_CREATED');
    expect(a7AuditFact).toBeDefined();
    expect(a7AuditFact?.actor).toBe(A7_PRODUCT_POLICY_AUDIT_ACTOR);
    expect(a7AuditFact?.metadata?.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
    expect(a7AuditFact?.metadata?.partnerReference).toBe(
      'a6-partner-reference:virtual-account-assign-1',
    );
  });

  it('rejects evaluation commands that target a non-A7-first-product key', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    await expect(
      fixture.service.evaluateProductPolicy({
        evaluation: makeRequest(
          A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
          A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
          A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
          snapshot,
        ),
        productKey: 'ANOTHER_PRODUCT' as never,
        productState: 'NEW',
        partnerReference: null,
      }),
    ).rejects.toThrow('A7 product-policy evaluation is registered for productKey');
  });

  it('replays an A4 product-policy decision via the A7 replay service', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    const command: A7ProductPolicyReplayCommand = {
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      decisionReference: 'a4-decision-replay-1',
      command: makeRequest(
        A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
        A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
        snapshot,
      ),
    };
    const result = await fixture.service.replayProductPolicy(command);
    expect(result.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
    expect(fixture.replayService.calls).toHaveLength(1);
  });

  it('triggers an A4 product-policy re-evaluation and records the A7 re-evaluation audit fact', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    const evaluation = makeRequest(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      snapshot,
    );
    const reevaluationRequest: PolicyReevaluationRequest = {
      contractName: 'A4-POLICY-REEVALUATION',
      contractVersion: 1,
      trigger: PolicyReevaluationTrigger.SOURCE_CHANGED,
      evaluation,
      previousDecisionReference: 'a4-decision-prev-1',
      idempotencyContext: {
        scope: A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
        key: 'a7-reevaluation-1',
      },
    };
    const expectedReevaluation: PolicyReevaluationResult = {
      contractName: 'A4-POLICY-REEVALUATION',
      contractVersion: 1,
      reevaluationReference: 'a4-reevaluation-1',
      customerId: CUSTOMER_ID,
      capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      requestHash: 'a'.repeat(64),
      normalizedInputHash: 'b'.repeat(64),
      trigger: PolicyReevaluationTrigger.SOURCE_CHANGED,
      state: PolicyReevaluationState.COMPLETED,
      decision: {
        contractName: 'A4-CAPABILITY-POLICY',
        contractVersion: 1,
        decisionReference: 'a4-decision-reevaluated-1',
        subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
        capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
        action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
        profileReference: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
        profileKey: 'profile.product-virtual-account-assign',
        profileVersion: 1,
        policyVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
        definitionHash: 'a'.repeat(64),
        decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
        requestedAt: REQUESTED_AT,
        evaluatedAt: REQUESTED_AT,
        expiresAt: '2026-08-07T10:15:00.000Z',
        reviewAt: null,
        reasonCodes: ['LIMITED_ALLOW'],
        explanation: { key: 'POLICY_ALLOW_WITH_LIMITS', audience: 'INTERNAL' },
        obligations: [
          { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION, required: true },
          { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING, required: true },
          {
            code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
            required: true,
          },
          { code: A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT, required: true },
        ],
        limits: [],
        sourceReferences: [],
        evidenceContext: {
          snapshotReference: SNAPSHOT_REFERENCE,
          snapshotContractVersion: 1,
          normalizedInputHash: 'b'.repeat(64),
          freshnessSummary: [PolicyEvidenceFreshnessState.CURRENT],
          collectionStatus: PolicyCollectionStatus.COMPLETE,
        },
        authorizationContextReference: 'a2-auth-1',
        requestHash: 'c'.repeat(64),
        resultHash: 'd'.repeat(64),
        idempotencyReplay: false,
        requestContext: evaluation.requestContext,
      },
      previousDecisionReference: 'a4-decision-prev-1',
      attempts: 1,
      maxAttempts: 1,
      recovery: {
        state: 'RECOVERED' as never,
        code: 'A4_CURRENT_EVIDENCE_RESTORED',
        currentness: 'CURRENT' as never,
        retryable: false,
        manualReviewRequired: false,
      },
      idempotencyReplay: false,
      requestContext: evaluation.requestContext,
    };
    const reevaluateSpy = jest
      .spyOn(fixture.recoveryService, 'reevaluate')
      .mockResolvedValue(expectedReevaluation);

    const command: A7ProductPolicyReevaluationCommand = {
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_CLEARED',
      request: reevaluationRequest,
    };
    const result = await fixture.service.triggerProductPolicyReevaluation(command);

    expect(result.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
    expect(result.productState).toBe('PARTNER_CLEARED');
    expect(result.reevaluationReference).toBe('a4-reevaluation-1');
    expect(reevaluateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: PolicyReevaluationTrigger.SOURCE_CHANGED,
        idempotencyContext: {
          scope: A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
          key: 'a7-reevaluation-1',
        },
      }),
    );
    const a7AuditFact = fixture.a4Audit.facts.find(
      (fact) => fact.action === 'A7_DECISION_REEVALUATED',
    );
    expect(a7AuditFact).toBeDefined();
    expect(a7AuditFact?.actor).toBe(A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR);
    expect(a7AuditFact?.metadata?.productKey).toBe(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT);
    expect(a7AuditFact?.metadata?.reevaluationState).toBe('COMPLETED');
    reevaluateSpy.mockRestore();
  });

  it('does not record an A7 re-evaluation audit fact when the A4 re-evaluation produces no decision', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    const evaluation = makeRequest(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      snapshot,
    );
    const reevaluationRequest: PolicyReevaluationRequest = {
      contractName: 'A4-POLICY-REEVALUATION',
      contractVersion: 1,
      trigger: PolicyReevaluationTrigger.SOURCE_CHANGED,
      evaluation,
      idempotencyContext: {
        scope: A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
        key: 'a7-reevaluation-2',
      },
    };
    const noDecision: PolicyReevaluationResult = {
      contractName: 'A4-POLICY-REEVALUATION',
      contractVersion: 1,
      reevaluationReference: 'a4-reevaluation-2',
      customerId: CUSTOMER_ID,
      capability: A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      action: A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      requestHash: 'a'.repeat(64),
      normalizedInputHash: 'b'.repeat(64),
      trigger: PolicyReevaluationTrigger.SOURCE_CHANGED,
      state: PolicyReevaluationState.RETRY_SCHEDULED,
      decision: null,
      previousDecisionReference: null,
      attempts: 1,
      maxAttempts: 1,
      recovery: {
        state: 'RETRY_REQUIRED' as never,
        code: 'A4_REEVALUATION_RETRY_SCHEDULED',
        currentness: 'STALE_EVIDENCE' as never,
        retryable: true,
        manualReviewRequired: false,
      },
      idempotencyReplay: false,
      requestContext: evaluation.requestContext,
    };
    const reevaluateSpy = jest
      .spyOn(fixture.recoveryService, 'reevaluate')
      .mockResolvedValue(noDecision);

    const result = await fixture.service.triggerProductPolicyReevaluation({
      productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
      productState: 'PARTNER_PENDING',
      request: reevaluationRequest,
    });

    expect(result.reevaluationReference).toBe('a4-reevaluation-2');
    expect(
      fixture.a4Audit.facts.find((fact) => fact.action === 'A7_DECISION_REEVALUATED'),
    ).toBeUndefined();
    reevaluateSpy.mockRestore();
  });

  it('rejects re-evaluation commands that target a non-A7-first-product key', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    const evaluation = makeRequest(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      snapshot,
    );
    await expect(
      fixture.service.triggerProductPolicyReevaluation({
        productKey: 'ANOTHER_PRODUCT' as never,
        productState: 'NEW',
        request: {
          contractName: 'A4-POLICY-REEVALUATION',
          contractVersion: 1,
          trigger: PolicyReevaluationTrigger.SOURCE_CHANGED,
          evaluation,
          idempotencyContext: {
            scope: A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
            key: 'a7-reevaluation-3',
          },
        },
      }),
    ).rejects.toThrow('A7 product-policy re-evaluation is registered for productKey');
  });

  it('fails closed when the A4 evaluator rejects the A2 authorization', async () => {
    const fixture = makeFixture();
    fixture.authorization.allowed = false;
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    await expect(
      fixture.service.evaluateProductPolicy({
        evaluation: makeRequest(
          A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
          A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
          A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
          snapshot,
        ),
        productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
        productState: 'NEW',
        partnerReference: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.a4Audit.facts).toHaveLength(0);
  });

  it('fails closed when the A4 snapshot is invalid', async () => {
    const fixture = makeFixture();
    const snapshot = makeSnapshot(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    const mismatched: PolicyEvidenceSnapshot = {
      ...snapshot,
      evidenceSummary: {
        ...snapshot.evidenceSummary,
        normalizedInputHash: '0'.repeat(64),
      },
    };
    await expect(
      fixture.service.evaluateProductPolicy({
        evaluation: makeRequest(
          A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
          A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
          A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
          mismatched,
        ),
        productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
        productState: 'NEW',
        partnerReference: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
