import { A7ProductPolicyPersistenceRepository } from '../src/policy/a7-product-policy.persistence.repository';
import {
  A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS,
  A7_PRODUCT_POLICY_PROFILES,
} from '../src/policy/a7-product-policy.profiles';
import {
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
  A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
} from '../src/policy/a7-product-policy.constants';
import { PolicyProfileLifecycleState } from '../src/policy/capability-policy-persistence.enums';
import type {
  PolicyDecisionResult,
  PolicyDecisionStore,
} from '../src/policy/capability-policy.types';
import type {
  PolicyProfileVersionRecord,
  PolicyProfileVersionRepository,
} from '../src/policy/capability-policy-persistence.types';
import { PolicyDecisionState } from '../src/policy/capability-policy.enums';
import type { CapabilityPolicyProfile } from '../src/policy/capability-policy.types';
import type {
  TypeOrmPolicyDecisionRecordRepository,
  TypeOrmPolicyProfileVersionRepository,
} from '../src/policy/capability-policy-persistence.repositories';

class FakeA4ProfileRepository implements PolicyProfileVersionRepository {
  readonly records = new Map<string, PolicyProfileVersionRecord>();
  insertCalls = 0;

  getProfile(
    capability: string,
    action: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null> {
    return Promise.resolve(
      this.getProfileAt(capability, action, new Date().toISOString(), policyVersionHint),
    );
  }

  getProfileAt(
    capability: string,
    action: string,
    evaluationAt: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null> {
    const evaluationMillis = Date.parse(evaluationAt);
    for (const record of this.records.values()) {
      const effectiveTo = record.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
      if (
        record.capability === capability &&
        record.actions.includes(action) &&
        record.lifecycleState === PolicyProfileLifecycleState.ACTIVE &&
        (policyVersionHint === undefined || record.policyVersion === policyVersionHint) &&
        record.effectiveFrom.getTime() <= evaluationMillis &&
        effectiveTo > evaluationMillis
      ) {
        const { effectiveFrom, effectiveTo: eTo, lifecycleState, ...profile } = record;
        void effectiveFrom;
        void eTo;
        void lifecycleState;
        return Promise.resolve(profile as unknown as CapabilityPolicyProfile);
      }
    }
    return Promise.resolve(null);
  }

  findByPolicyVersion(policyVersion: string): Promise<PolicyProfileVersionRecord | null> {
    for (const record of this.records.values()) {
      if (record.policyVersion === policyVersion) return Promise.resolve(record);
    }
    return Promise.resolve(null);
  }

  insertImmutable(record: PolicyProfileVersionRecord): Promise<void> {
    this.insertCalls += 1;
    this.records.set(record.profileReference, record);
    return Promise.resolve();
  }

  transitionLifecycle(): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
}

class FakeA4DecisionRepository implements PolicyDecisionStore {
  readonly byRequestHash = new Map<string, PolicyDecisionResult>();
  readonly byDecisionReference = new Map<string, PolicyDecisionResult>();

  findByRequestHash(requestHash: string): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(this.byRequestHash.get(requestHash) ?? null);
  }

  save(result: PolicyDecisionResult): Promise<void> {
    this.byRequestHash.set(result.requestHash, result);
    this.byDecisionReference.set(result.decisionReference, result);
    return Promise.resolve();
  }

  findByDecisionReference(decisionReference: string): Promise<PolicyDecisionResult | null> {
    return Promise.resolve(this.byDecisionReference.get(decisionReference) ?? null);
  }
}

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const DECISION_REFERENCE = 'a4-decision-persistence-1';

function makeDecision(): PolicyDecisionResult {
  return {
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    decisionReference: DECISION_REFERENCE,
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    capability: 'product.virtual-account',
    action: 'assign',
    profileReference: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    profileKey: 'profile.product-virtual-account-assign',
    profileVersion: 1,
    policyVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
    definitionHash: 'e'.repeat(64),
    decision: PolicyDecisionState.ALLOW_WITH_LIMITS,
    requestedAt: '2026-08-07T10:00:00.000Z',
    evaluatedAt: '2026-08-07T10:00:00.000Z',
    expiresAt: '2026-08-07T10:15:00.000Z',
    reviewAt: null,
    reasonCodes: ['LIMITED_ALLOW'],
    explanation: { key: 'POLICY_ALLOW_WITH_LIMITS', audience: 'INTERNAL' },
    obligations: [],
    limits: [],
    sourceReferences: [],
    evidenceContext: {
      snapshotReference: 'snapshot-1',
      snapshotContractVersion: 1,
      normalizedInputHash: 'f'.repeat(64),
      freshnessSummary: [],
      collectionStatus: 'COMPLETE' as never,
    },
    authorizationContextReference: 'a2-auth-1',
    requestHash: '1'.repeat(64),
    resultHash: '2'.repeat(64),
    idempotencyReplay: false,
    requestContext: { requestId: 'r-1', correlationId: 'c-1' },
  };
}

describe('A7T03 A4 product-policy persistence repository', () => {
  it('lists the A7 first product A4 product-policy profile references', () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    expect(repository.listProfileReferences()).toEqual([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
    ]);
  });

  it('lists the A7 first product A4 product-policy versions', () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    expect(repository.listPolicyVersions()).toEqual([
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
      A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
    ]);
  });

  it('returns the A7 first product A4 product-policy profile registrations unchanged', () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    expect(repository.listProfileRegistrations()).toBe(A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS);
  });

  it('looks up an A4 product-policy profile by capability and action via the A4 registry', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const assignProfile = A7_PRODUCT_POLICY_PROFILES[0];
    if (!assignProfile) throw new Error('Expected the A7 assign product-policy profile');
    await profileRepository.insertImmutable({
      ...assignProfile,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      lifecycleState: PolicyProfileLifecycleState.ACTIVE,
      createdBy: 'test',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      retentionClass: 'A4_POLICY_HISTORY',
      legalHold: false,
      retentionExpiresAt: null,
      definitionPayload: assignProfile as unknown as Readonly<Record<string, unknown>>,
    });
    const found = await repository.getProfile(
      A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
      A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
    );
    expect(found?.profileReference).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE);
    expect(found?.policyVersion).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION);
  });

  it('returns null when the A4 product-policy profile is not registered for the requested action', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const found = await repository.getProfile('product.unknown', 'unknown');
    expect(found).toBeNull();
  });

  it('reads an A4 product-policy decision by reference', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const decision = makeDecision();
    await decisionRepository.save(decision);
    const found = await repository.findDecisionByReference(DECISION_REFERENCE);
    expect(found).toBe(decision);
  });

  it('reads an A4 product-policy decision by request hash', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const decision = makeDecision();
    await decisionRepository.save(decision);
    const found = await repository.findDecisionByRequestHash(decision.requestHash);
    expect(found).toBe(decision);
  });

  it('returns null when the A4 product-policy decision is not found by reference', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const found = await repository.findDecisionByReference('a4-decision-missing');
    expect(found).toBeNull();
  });

  it('returns null when the A4 product-policy decision is not found by request hash', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const found = await repository.findDecisionByRequestHash('a'.repeat(64));
    expect(found).toBeNull();
  });

  it('records an A4 product-policy profile for the A7 first product', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    await repository.recordProfile({
      productKey: 'VIRTUAL_ACCOUNT' as never,
      profileReference: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
      policyVersion: A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
      profileVersion: 1,
      definitionHash: 'a'.repeat(64),
      lifecycleState: 'ACTIVE',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      createdBy: 'a7-onboarder',
    });
    expect(profileRepository.insertCalls).toBe(1);
    const recorded = profileRepository.records.get(
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
    );
    expect(recorded).toBeDefined();
    expect(recorded?.lifecycleState).toBe(PolicyProfileLifecycleState.ACTIVE);
    expect(recorded?.effectiveTo).toBeNull();
    expect(recorded?.createdBy).toBe('a7-onboarder');
  });

  it('throws when the A4 product-policy profile reference is unknown', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    await expect(
      repository.recordProfile({
        productKey: 'VIRTUAL_ACCOUNT' as never,
        profileReference: 'profile.unknown.v1',
        policyVersion: 'a4.profile.unknown.v1',
        profileVersion: 1,
        definitionHash: 'a'.repeat(64),
        lifecycleState: 'ACTIVE',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        effectiveTo: null,
        createdBy: 'a7-onboarder',
      }),
    ).rejects.toThrow('A7 product policy profile not found for reference');
  });

  it('finds an A4 product-policy profile by policy version', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const assignProfile = A7_PRODUCT_POLICY_PROFILES[0];
    if (!assignProfile) throw new Error('Expected the A7 assign product-policy profile');
    await profileRepository.insertImmutable({
      ...assignProfile,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      lifecycleState: PolicyProfileLifecycleState.ACTIVE,
      createdBy: 'test',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      retentionClass: 'A4_POLICY_HISTORY',
      legalHold: false,
      retentionExpiresAt: null,
      definitionPayload: assignProfile as unknown as Readonly<Record<string, unknown>>,
    });
    const found = await repository.findProfileByPolicyVersion(
      A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
    );
    expect(found?.profileReference).toBe(A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE);
  });

  it('returns null when no A4 product-policy profile is found by policy version', async () => {
    const profileRepository = new FakeA4ProfileRepository();
    const decisionRepository = new FakeA4DecisionRepository();
    const repository = new A7ProductPolicyPersistenceRepository(
      profileRepository as unknown as TypeOrmPolicyProfileVersionRepository,
      decisionRepository as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const found = await repository.findProfileByPolicyVersion('a4.profile.unknown.v1');
    expect(found).toBeNull();
  });
});
