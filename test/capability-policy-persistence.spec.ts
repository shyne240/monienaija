import { ConflictException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import type { DataSource, EntityManager, QueryRunner, Repository } from 'typeorm';

import {
  calculatePolicyDecisionResultHash,
  calculateSnapshotInputHash,
} from '../src/policy/capability-policy.service';
import { DEFAULT_CAPABILITY_POLICY_PROFILES } from '../src/policy/capability-policy.profiles';
import { TypeOrmPolicyIdempotencyAdapter } from '../src/policy/capability-policy-idempotency.adapter';
import {
  PolicyCollectionStatus,
  PolicyDecisionState,
  PolicyEvidenceFreshnessState,
  PolicySourceClass,
} from '../src/policy/capability-policy.enums';
import type {
  PolicyDecisionResult,
  PolicyEvidenceSnapshot,
} from '../src/policy/capability-policy.types';
import {
  DEFAULT_POLICY_RETENTION,
  decisionToEntity,
  entityToDecision,
  entityToProfile,
  assertPublishedProfileImmutable,
  entityToSnapshot,
  profileRecordFromProfile,
  profileToEntity,
  snapshotToEntity,
} from '../src/policy/capability-policy-persistence.mappers';
import {
  PolicyProfileLifecycleState,
  PolicyReplayOutcome,
} from '../src/policy/capability-policy-persistence.enums';
import {
  TypeOrmPolicyDecisionRecordRepository,
  TypeOrmPolicyEvidenceSnapshotAttachmentRepository,
  TypeOrmPolicyProfileVersionRepository,
} from '../src/policy/capability-policy-persistence.repositories';
import { ImmutableEvidenceSnapshotAttachment } from '../src/policy/immutable-evidence-snapshot-attachment.entity';
import { PolicyDecisionRecord } from '../src/policy/policy-decision-record.entity';
import { PolicyProfileVersion } from '../src/policy/policy-profile-version.entity';
import { CreateCapabilityPolicyPersistence1785753600022 } from '../src/migrations/1785753600022-CreateCapabilityPolicyPersistence';
import type { IdempotencyReservation } from '../src/operations/operations.types';
import type { IdempotencyService } from '../src/operations/idempotency.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const AT = '2026-08-07T10:00:00.000Z';

class RecordingQueryRunner {
  readonly queries: string[] = [];

  query(sql: string): Promise<unknown[]> {
    this.queries.push(sql);
    return Promise.resolve([]);
  }
}

class FakeRepository<T extends { id?: string }> {
  readonly records: T[] = [];

  findOne(options: { where: Partial<T> }): Promise<T | null> {
    const entries = Object.entries(options.where) as Array<[keyof T, unknown]>;
    return Promise.resolve(
      this.records.find((record) => entries.every(([key, value]) => record[key] === value)) ?? null,
    );
  }

  find(options?: { where?: Partial<T> }): Promise<T[]> {
    if (!options?.where) return Promise.resolve([...this.records]);
    const entries = Object.entries(options.where) as Array<[keyof T, unknown]>;
    return Promise.resolve(
      this.records.filter((record) => entries.every(([key, value]) => record[key] === value)),
    );
  }

  insert(entity: T): Promise<void> {
    this.records.push(entity);
    return Promise.resolve();
  }

  save(entity: T): Promise<T> {
    const record = entity as T & { recordVersion?: number };
    if (record.recordVersion !== undefined) record.recordVersion += 1;
    return Promise.resolve(entity);
  }
}

class FakeDataSource {
  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback({} as EntityManager);
  }
}

class FakeOperationsIdempotencyService {
  completed:
    | {
        recordId: string;
        resourceId?: string;
      }
    | undefined;
  failed: string | undefined;

  reserve(
    manager: EntityManager,
    command: Record<string, unknown>,
  ): Promise<IdempotencyReservation> {
    void manager;
    void command;
    return Promise.resolve({
      kind: 'NEW',
      record: { id: 'a4-idempotency-1' } as unknown as IdempotencyReservation['record'],
    });
  }

  complete(
    manager: EntityManager,
    recordId: string,
    command: { resourceId?: string },
  ): Promise<void> {
    void manager;
    this.completed = { recordId, resourceId: command.resourceId };
    return Promise.resolve();
  }

  fail(manager: EntityManager, recordId: string): Promise<void> {
    void manager;
    this.failed = recordId;
    return Promise.resolve();
  }
}

class FakeDecisionLookup {
  findByDecisionReference(reference: string): Promise<PolicyDecisionResult | null> {
    void reference;
    return Promise.resolve(null);
  }
}

function makeSnapshot(): PolicyEvidenceSnapshot {
  const snapshot: PolicyEvidenceSnapshot = {
    contractName: 'A4-EVIDENCE-SNAPSHOT',
    contractVersion: 1,
    snapshotReference: 'snapshot-persistence-1',
    subject: { type: 'CUSTOMER', customerId: CUSTOMER_ID },
    policyRequestScope: {
      capability: 'wallet.account',
      action: 'read',
      requestedAt: AT,
      asOf: AT,
      evidenceProfile: 'profile.wallet-account-read.v1',
    },
    collection: {
      status: PolicyCollectionStatus.COMPLETE,
      startedAt: AT,
      collectedAt: AT,
      requiredSourceClasses: [PolicySourceClass.CUSTOMER],
      collectedSourceClasses: [PolicySourceClass.CUSTOMER],
      missingSourceClasses: [],
      unavailableSourceClasses: [],
      restrictedSourceClasses: [],
      conflictSourceClasses: [],
    },
    sourceItems: [
      {
        sourceClass: PolicySourceClass.CUSTOMER,
        sourceType: 'Customer',
        sourceId: CUSTOMER_ID,
        customerId: CUSTOMER_ID,
        sourceVersion: 1,
        sourceUpdatedAt: AT,
        observedAt: AT,
        deleted: false,
        freshnessState: PolicyEvidenceFreshnessState.CURRENT,
        classification: 'Restricted',
        normalizedValue: { status: 'ACTIVE', version: 1 },
        sourceReference: 'customer:1',
      },
    ],
    evidenceSummary: {
      freshnessStates: [PolicyEvidenceFreshnessState.CURRENT],
      sourceCount: 1,
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

function makeDecision(snapshot: PolicyEvidenceSnapshot): PolicyDecisionResult {
  const core = {
    contractName: 'A4-CAPABILITY-POLICY' as const,
    contractVersion: 1 as const,
    subject: { type: 'CUSTOMER' as const, customerId: CUSTOMER_ID },
    capability: 'wallet.account',
    action: 'read',
    profileReference: 'profile.wallet-account-read.v1',
    profileKey: 'profile.wallet-account-read',
    profileVersion: 1,
    policyVersion: 'a4.profile.wallet-account-read.v1',
    definitionHash: 'a'.repeat(64),
    decision: PolicyDecisionState.ALLOW,
    requestedAt: AT,
    evaluatedAt: AT,
    expiresAt: '2026-08-07T10:15:00.000Z',
    reviewAt: null,
    reasonCodes: ['CAPABILITY_ALLOWED'],
    explanation: { key: 'POLICY_ALLOW', audience: 'INTERNAL' as const },
    obligations: [{ code: 'RECHECK_A2_AUTHORIZATION', required: true }],
    limits: [],
    sourceReferences: [],
    evidenceContext: {
      snapshotReference: snapshot.snapshotReference,
      snapshotContractVersion: 1,
      normalizedInputHash: snapshot.evidenceSummary.normalizedInputHash,
      freshnessSummary: [PolicyEvidenceFreshnessState.CURRENT],
      collectionStatus: PolicyCollectionStatus.COMPLETE,
    },
    authorizationContextReference: 'a2-auth-1',
    requestHash: 'b'.repeat(64),
    requestContext: {
      requestId: 'request-persistence-1',
      correlationId: 'correlation-persistence-1',
    },
  };
  return {
    ...core,
    decisionReference: 'a4-decision-persistence-1',
    resultHash: calculatePolicyDecisionResultHash(core),
    idempotencyReplay: false,
  };
}

describe('A4 physical policy persistence artifacts', () => {
  it('applies and rolls back only the A4 policy persistence tables', async () => {
    const migration = new CreateCapabilityPolicyPersistence1785753600022();
    const up = new RecordingQueryRunner();
    await migration.up(up as unknown as QueryRunner);
    const upSql = up.queries.join(' ').replace(/\s+/g, ' ').toLowerCase();

    expect(upSql).toContain('create table policy_profile_versions');
    expect(upSql).toContain('create table immutable_evidence_snapshot_attachments');
    expect(upSql).toContain('create table policy_decision_records');
    expect(upSql).toContain('effective_from timestamptz not null');
    expect(upSql).toContain('lifecycle_state varchar(20) not null');
    expect(upSql).toContain('create trigger policy_profile_versions_are_immutable');
    expect(upSql).toContain('before update or delete on policy_profile_versions');
    expect(upSql).toContain('enforce_policy_profile_version_immutability()');
    expect(upSql).toContain('create trigger policy_decision_records_are_immutable');
    expect(upSql).toContain('create trigger immutable_evidence_snapshot_attachments_are_immutable');
    expect(upSql).not.toMatch(/(insert|update|delete)\s+(customers|ledger_|wallet_|customer_)/);
    expect(upSql).not.toContain('create table ledger_journals');
    expect(upSql).not.toContain('create table ledger_lines');

    const down = new RecordingQueryRunner();
    await migration.down(down as unknown as QueryRunner);
    const downSql = down.queries.join(' ').replace(/\s+/g, ' ').toLowerCase();
    expect(downSql).toContain('drop table if exists policy_decision_records');
    expect(downSql).toContain('drop table if exists immutable_evidence_snapshot_attachments');
    expect(downSql).toContain('drop table if exists policy_profile_versions');
    expect(downSql).toContain('drop trigger if exists policy_profile_versions_are_immutable');
    expect(downSql).toContain(
      'drop function if exists enforce_policy_profile_version_immutability()',
    );
    expect(downSql).toContain('drop function if exists reject_immutable_a4_history_mutation()');
  });

  it('declares immutable profile, decision, and snapshot entity metadata', () => {
    const storage = getMetadataArgsStorage();
    expect(
      storage.tables.some(
        (table) =>
          table.target === PolicyProfileVersion && table.name === 'policy_profile_versions',
      ),
    ).toBe(true);
    expect(
      storage.tables.some(
        (table) =>
          table.target === PolicyDecisionRecord && table.name === 'policy_decision_records',
      ),
    ).toBe(true);
    expect(
      storage.tables.some(
        (table) =>
          table.target === ImmutableEvidenceSnapshotAttachment &&
          table.name === 'immutable_evidence_snapshot_attachments',
      ),
    ).toBe(true);
    expect(
      storage.columns
        .filter((column) => column.target === PolicyProfileVersion)
        .map((column) => column.propertyName),
    ).toEqual(
      expect.arrayContaining([
        'profileReference',
        'effectiveFrom',
        'effectiveTo',
        'lifecycleState',
        'definitionHash',
        'retentionClass',
        'legalHold',
      ]),
    );
    expect(
      storage.columns
        .filter((column) => column.target === PolicyDecisionRecord)
        .map((column) => column.propertyName),
    ).toEqual(
      expect.arrayContaining([
        'decisionReference',
        'requestHash',
        'normalizedInputHash',
        'resultHash',
        'supersedesDecisionReference',
        'createdAt',
      ]),
    );
    expect(
      storage.columns
        .filter((column) => column.target === ImmutableEvidenceSnapshotAttachment)
        .map((column) => column.propertyName),
    ).toEqual(
      expect.arrayContaining([
        'snapshotReference',
        'snapshotPayload',
        'normalizedInputHash',
        'retentionClass',
        'legalHold',
      ]),
    );
  });

  it('round-trips profile, snapshot, and decision records without changing hashes', () => {
    const profile = DEFAULT_CAPABILITY_POLICY_PROFILES[0];
    if (!profile) throw new Error('Expected a default A4 profile');
    const profileRecord = profileRecordFromProfile(profile, 'test-publisher', new Date(AT));
    const profileEntity = profileToEntity(profileRecord);
    expect(entityToProfile(profileEntity)).toMatchObject({
      profileReference: profile.profileReference,
      policyVersion: profile.policyVersion,
      definitionHash: profile.definitionHash,
      lifecycleState: PolicyProfileLifecycleState.ACTIVE,
    });

    const snapshot = makeSnapshot();
    const snapshotEntity = snapshotToEntity({
      snapshot,
      ...DEFAULT_POLICY_RETENTION,
      retentionClass: 'A4_EVIDENCE_SNAPSHOT',
      createdAt: new Date(AT),
    });
    expect(entityToSnapshot(snapshotEntity).evidenceSummary.normalizedInputHash).toBe(
      snapshot.evidenceSummary.normalizedInputHash,
    );

    const decision = makeDecision(snapshot);
    const decisionEntity = decisionToEntity({
      decision,
      ...DEFAULT_POLICY_RETENTION,
      createdBy: 'persistence-test',
    });
    expect(entityToDecision(decisionEntity)).toMatchObject({
      decisionReference: decision.decisionReference,
      resultHash: decision.resultHash,
      policyVersion: decision.policyVersion,
    });
  });

  it('keeps profile lifecycle selection effective-time aware', async () => {
    const repository = new FakeRepository<PolicyProfileVersion>();
    const profile = DEFAULT_CAPABILITY_POLICY_PROFILES.find(
      (candidate) => candidate.capability === 'wallet.account',
    );
    if (!profile) throw new Error('Expected a wallet account A4 profile');
    const first = profileToEntity(
      profileRecordFromProfile(
        profile,
        'test',
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-08-07T10:00:00.000Z'),
      ),
    );
    const second = profileToEntity(
      profileRecordFromProfile(profile, 'test', new Date('2026-08-07T10:00:00.000Z')),
    );
    second.profileVersion = 2;
    second.policyVersion = 'a4.profile.wallet-account-read.v2';
    second.profileReference = 'profile.wallet-account-read.v2';
    second.lifecycleState = PolicyProfileLifecycleState.ACTIVE;
    repository.records.push(first, second);
    const registry = new TypeOrmPolicyProfileVersionRepository(
      repository as unknown as Repository<PolicyProfileVersion>,
    );

    const before = await registry.getProfileAt(
      'wallet.account',
      'read',
      '2026-08-07T09:00:00.000Z',
    );
    const after = await registry.getProfileAt('wallet.account', 'read', '2026-08-07T10:01:00.000Z');

    expect(before?.policyVersion).toBe(profile.policyVersion);
    expect(after?.policyVersion).toBe('a4.profile.wallet-account-read.v2');
  });

  it('rejects published profile definition mutations and permits only ordered lifecycle transitions', async () => {
    const repository = new FakeRepository<PolicyProfileVersion>();
    const profile = DEFAULT_CAPABILITY_POLICY_PROFILES.find(
      (candidate) => candidate.capability === 'wallet.account',
    );
    if (!profile) throw new Error('Expected a wallet account A4 profile');
    const draft = profileToEntity(
      profileRecordFromProfile(profile, 'publisher', new Date('2026-01-01T00:00:00.000Z')),
    );
    draft.lifecycleState = PolicyProfileLifecycleState.DRAFT;
    draft.publishedAt = null;
    draft.publishedBy = null;
    repository.records.push(draft);
    const registry = new TypeOrmPolicyProfileVersionRepository(
      repository as unknown as Repository<PolicyProfileVersion>,
    );

    await registry.transitionLifecycle(profile.policyVersion, {
      lifecycleState: PolicyProfileLifecycleState.ACTIVE,
      actor: 'publisher',
      expectedRecordVersion: 1,
    });
    expect(draft.lifecycleState).toBe(PolicyProfileLifecycleState.ACTIVE);
    expect(draft.publishedBy).toBe('publisher');
    expect(draft.recordVersion).toBe(2);

    await registry.transitionLifecycle(profile.policyVersion, {
      lifecycleState: PolicyProfileLifecycleState.RETIRED,
      actor: 'publisher',
      expectedRecordVersion: 2,
    });
    expect(draft.lifecycleState).toBe(PolicyProfileLifecycleState.RETIRED);
    expect(draft.retiredBy).toBe('publisher');
    expect(draft.recordVersion).toBe(3);

    expect(() =>
      assertPublishedProfileImmutable(draft, { ...draft, capability: 'wallet.changed' }),
    ).toThrow(ConflictException);
    expect(() =>
      assertPublishedProfileImmutable(draft, {
        ...draft,
        effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ).toThrow(ConflictException);
    await expect(
      registry.transitionLifecycle(profile.policyVersion, {
        lifecycleState: PolicyProfileLifecycleState.ACTIVE,
        actor: 'publisher',
        expectedRecordVersion: 3,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns only an active, non-expired, non-superseded current decision', async () => {
    const decisionRepository = new FakeRepository<PolicyDecisionRecord>();
    const snapshotRepository = new FakeRepository<ImmutableEvidenceSnapshotAttachment>();
    const profileRepository = new FakeRepository<PolicyProfileVersion>();
    const profile = DEFAULT_CAPABILITY_POLICY_PROFILES.find(
      (candidate) => candidate.capability === 'wallet.account',
    );
    if (!profile) throw new Error('Expected a wallet account A4 profile');
    const profileStore = new TypeOrmPolicyProfileVersionRepository(
      profileRepository as unknown as Repository<PolicyProfileVersion>,
    );
    await profileStore.insertImmutable(
      profileRecordFromProfile(profile, 'test', new Date('2026-01-01T00:00:00.000Z')),
    );
    const snapshotStore = new TypeOrmPolicyEvidenceSnapshotAttachmentRepository(
      snapshotRepository as unknown as Repository<ImmutableEvidenceSnapshotAttachment>,
    );
    const decisionStore = new TypeOrmPolicyDecisionRecordRepository(
      decisionRepository as unknown as Repository<PolicyDecisionRecord>,
      profileStore,
      snapshotStore,
    );
    const snapshot = makeSnapshot();
    const baseDecision = makeDecision(snapshot);
    const decision = {
      ...baseDecision,
      definitionHash: profile.definitionHash,
      resultHash: calculatePolicyDecisionResultHash({
        ...baseDecision,
        definitionHash: profile.definitionHash,
      }),
    };
    await decisionStore.insertImmutable({
      decision,
      ...DEFAULT_POLICY_RETENTION,
      createdBy: 'test',
    });

    const current = await decisionStore.findCurrentEffectiveDecision({
      customerId: CUSTOMER_ID,
      capability: 'wallet.account',
      action: 'read',
      asOf: '2026-08-07T10:05:00.000Z',
    });
    expect(current?.decisionReference).toBe(decision.decisionReference);

    const entity = decisionRepository.records[0];
    if (!entity) throw new Error('Expected persisted decision');
    entity.expiresAt = new Date('2026-08-07T10:05:00.000Z');
    expect(
      await decisionStore.findCurrentEffectiveDecision({
        customerId: CUSTOMER_ID,
        capability: 'wallet.account',
        action: 'read',
        asOf: '2026-08-07T10:05:00.000Z',
      }),
    ).toBeNull();
  });

  it('rejects changed immutable decision or snapshot content', async () => {
    const decisionRepository = new FakeRepository<PolicyDecisionRecord>();
    const snapshotRepository = new FakeRepository<ImmutableEvidenceSnapshotAttachment>();
    const profileRepository = new FakeRepository<PolicyProfileVersion>();
    const profile = DEFAULT_CAPABILITY_POLICY_PROFILES.find(
      (candidate) => candidate.capability === 'wallet.account',
    );
    if (!profile) throw new Error('Expected a wallet account A4 profile');
    const profileStore = new TypeOrmPolicyProfileVersionRepository(
      profileRepository as unknown as Repository<PolicyProfileVersion>,
    );
    const snapshotStore = new TypeOrmPolicyEvidenceSnapshotAttachmentRepository(
      snapshotRepository as unknown as Repository<ImmutableEvidenceSnapshotAttachment>,
    );
    const decisionStore = new TypeOrmPolicyDecisionRecordRepository(
      decisionRepository as unknown as Repository<PolicyDecisionRecord>,
      profileStore,
      snapshotStore,
    );
    const snapshot = makeSnapshot();
    const decision = makeDecision(snapshot);

    await snapshotStore.insertImmutable({
      snapshot,
      ...DEFAULT_POLICY_RETENTION,
      retentionClass: 'A4_EVIDENCE_SNAPSHOT',
      createdAt: new Date(AT),
    });
    await decisionStore.insertImmutable({
      decision,
      ...DEFAULT_POLICY_RETENTION,
      createdBy: 'test',
    });
    await decisionStore.insertImmutable({
      decision,
      ...DEFAULT_POLICY_RETENTION,
      createdBy: 'test',
    });

    const changed = { ...decision, decision: PolicyDecisionState.DENY };
    await expect(
      decisionStore.insertImmutable({
        decision: {
          ...changed,
          resultHash: calculatePolicyDecisionResultHash(changed),
        },
        ...DEFAULT_POLICY_RETENTION,
        createdBy: 'test',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const changedSnapshot = {
      ...snapshot,
      snapshotReference: 'snapshot-persistence-1',
      sourceItems: [],
    };
    await expect(
      snapshotStore.insertImmutable({
        snapshot: {
          ...changedSnapshot,
          evidenceSummary: {
            ...changedSnapshot.evidenceSummary,
            normalizedInputHash: calculateSnapshotInputHash(changedSnapshot),
          },
        },
        ...DEFAULT_POLICY_RETENTION,
        retentionClass: 'A4_EVIDENCE_SNAPSHOT',
        createdAt: new Date(AT),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('adapts the shared Operations idempotency primitive for A4 decision replay', async () => {
    const operations = new FakeOperationsIdempotencyService();
    const adapter = new TypeOrmPolicyIdempotencyAdapter(
      new FakeDataSource() as unknown as DataSource,
      operations as unknown as IdempotencyService,
      new FakeDecisionLookup() as unknown as TypeOrmPolicyDecisionRecordRepository,
    );
    const reservation = await adapter.reserve({
      scope: 'policy.capability-decision.v1',
      key: 'persistence-idempotency-1',
      requestHash: 'b'.repeat(64),
    });
    expect(reservation).toMatchObject({ kind: 'NEW', reservationId: 'a4-idempotency-1' });

    const decision = makeDecision(makeSnapshot());
    await adapter.complete('a4-idempotency-1', decision);
    expect(operations.completed).toEqual({
      recordId: 'a4-idempotency-1',
      resourceId: decision.decisionReference,
    });
    await adapter.fail('a4-idempotency-1', 'A4_TRANSIENT_FAILURE');
    expect(operations.failed).toBe('a4-idempotency-1');
  });

  it('returns exact historical replay bundle only when profile, snapshot, and result hashes match', async () => {
    const decisionRepository = new FakeRepository<PolicyDecisionRecord>();
    const snapshotRepository = new FakeRepository<ImmutableEvidenceSnapshotAttachment>();
    const profileRepository = new FakeRepository<PolicyProfileVersion>();
    const profile = DEFAULT_CAPABILITY_POLICY_PROFILES.find(
      (candidate) => candidate.capability === 'wallet.account',
    );
    if (!profile) throw new Error('Expected a wallet account A4 profile');
    const profileStore = new TypeOrmPolicyProfileVersionRepository(
      profileRepository as unknown as Repository<PolicyProfileVersion>,
    );
    const snapshotStore = new TypeOrmPolicyEvidenceSnapshotAttachmentRepository(
      snapshotRepository as unknown as Repository<ImmutableEvidenceSnapshotAttachment>,
    );
    const decisionStore = new TypeOrmPolicyDecisionRecordRepository(
      decisionRepository as unknown as Repository<PolicyDecisionRecord>,
      profileStore,
      snapshotStore,
    );
    const snapshot = makeSnapshot();
    const baseDecision = makeDecision(snapshot);
    const decision = {
      ...baseDecision,
      definitionHash: profile.definitionHash,
      resultHash: calculatePolicyDecisionResultHash({
        ...baseDecision,
        definitionHash: profile.definitionHash,
      }),
    };
    const profileRecord = profileRecordFromProfile(
      profile,
      'test',
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await profileStore.insertImmutable(profileRecord);
    await snapshotStore.insertImmutable({
      snapshot,
      ...DEFAULT_POLICY_RETENTION,
      retentionClass: 'A4_EVIDENCE_SNAPSHOT',
      createdAt: new Date(AT),
    });
    await decisionStore.insertImmutable({
      decision,
      ...DEFAULT_POLICY_RETENTION,
      createdBy: 'test',
    });

    const replay = await decisionStore.reconstructDecision(decision.decisionReference);
    expect(replay.outcome).toBe(PolicyReplayOutcome.REPLAY_EXACT);
    expect(replay.integrityMismatch).toBe(false);
    expect(replay.decision?.resultHash).toBe(decision.resultHash);
  });
});
