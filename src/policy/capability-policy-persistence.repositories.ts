import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import {
  calculatePolicyDecisionResultHash,
  calculateSnapshotInputHash,
} from './capability-policy.service';
import type {
  CapabilityPolicyProfile,
  PolicyDecisionResult,
  PolicyEvidenceSnapshot,
} from './capability-policy.types';
import {
  DEFAULT_POLICY_RETENTION,
  decisionToEntity,
  entityToDecision,
  entityToProfile,
  assertPublishedProfileImmutable,
  entityToSnapshot,
  profileToEntity,
  snapshotToEntity,
  validateHash,
} from './capability-policy-persistence.mappers';
import type {
  PolicyDecisionRecordInput,
  PolicyDecisionRecordRepository,
  PolicyHistoricalReplayBundle,
  PolicyProfileVersionRecord,
  PolicyProfileVersionRepository,
  PolicySnapshotAttachmentInput,
  PolicyEvidenceSnapshotAttachmentRepository,
  PolicyDecisionPersistenceServiceContract,
  PolicyProfileLifecycleUpdate,
} from './capability-policy-persistence.types';
import {
  PolicyProfileLifecycleState,
  PolicyReplayOutcome,
} from './capability-policy-persistence.enums';
import { ImmutableEvidenceSnapshotAttachment } from './immutable-evidence-snapshot-attachment.entity';
import { PolicyDecisionRecord } from './policy-decision-record.entity';
import { PolicyProfileVersion } from './policy-profile-version.entity';

@Injectable()
export class TypeOrmPolicyProfileVersionRepository implements PolicyProfileVersionRepository {
  constructor(
    @InjectRepository(PolicyProfileVersion)
    private readonly repository: Repository<PolicyProfileVersion>,
  ) {}

  async getProfile(
    capability: string,
    action: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null> {
    return this.getProfileAt(capability, action, new Date().toISOString(), policyVersionHint);
  }

  async getProfileAt(
    capability: string,
    action: string,
    evaluationAt: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null> {
    const evaluationMillis = Date.parse(evaluationAt);
    if (Number.isNaN(evaluationMillis)) return null;
    const records = await this.repository.find({
      where: { capability },
      order: { effectiveFrom: 'DESC', profileVersion: 'DESC' },
    });
    const record = records.find((candidate) => {
      const effectiveTo = candidate.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
      return (
        candidate.lifecycleState === PolicyProfileLifecycleState.ACTIVE &&
        candidate.actions.includes(action) &&
        (policyVersionHint === undefined || candidate.policyVersion === policyVersionHint) &&
        candidate.effectiveFrom.getTime() <= evaluationMillis &&
        effectiveTo > evaluationMillis
      );
    });
    return record ? entityToProfile(record) : null;
  }

  async findByPolicyVersion(policyVersion: string): Promise<PolicyProfileVersionRecord | null> {
    const entity = await this.repository.findOne({ where: { policyVersion } });
    if (!entity) return null;
    return {
      ...entityToProfile(entity),
      effectiveFrom: entity.effectiveFrom,
      effectiveTo: entity.effectiveTo,
      lifecycleState: entity.lifecycleState,
      definitionPayload: entity.definitionPayload,
      createdAt: entity.createdAt,
      createdBy: entity.createdBy,
      retentionClass: entity.retentionClass,
      legalHold: entity.legalHold,
      retentionExpiresAt: entity.retentionExpiresAt,
    } as PolicyProfileVersionRecord;
  }

  async insertImmutable(record: PolicyProfileVersionRecord): Promise<void> {
    validateHash(record.definitionHash, 'definitionHash');
    const existing = await this.repository.findOne({
      where: { profileReference: record.profileReference },
    });
    if (existing) {
      if (
        existing.definitionHash !== record.definitionHash ||
        existing.policyVersion !== record.policyVersion
      ) {
        throw new ConflictException('A4 policy profile reference is immutable');
      }
      return;
    }
    if (record.lifecycleState === PolicyProfileLifecycleState.ACTIVE) {
      const existingRecords = await this.repository.find({
        where: { capability: record.capability },
      });
      const overlaps = existingRecords.some(
        (candidate) =>
          candidate.lifecycleState === PolicyProfileLifecycleState.ACTIVE &&
          candidate.actions.some((action) => record.actions.includes(action)) &&
          intervalsOverlap(
            candidate.effectiveFrom,
            candidate.effectiveTo,
            record.effectiveFrom,
            record.effectiveTo,
          ),
      );
      if (overlaps) {
        throw new ConflictException('A4 active profile effective intervals overlap');
      }
    }
    const entity = profileToEntity(record);
    const insertValue = entity as unknown as Parameters<
      Repository<PolicyProfileVersion>['insert']
    >[0];
    await this.repository.insert(insertValue);
  }

  async transitionLifecycle(
    policyVersion: string,
    update: PolicyProfileLifecycleUpdate,
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { policyVersion } });
    if (!entity) throw new ConflictException('A4 policy profile version was not found');
    if (
      update.expectedRecordVersion !== undefined &&
      update.expectedRecordVersion !== entity.recordVersion
    ) {
      throw new ConflictException('A4 policy profile lifecycle version is stale');
    }
    if (entity.lifecycleState === PolicyProfileLifecycleState.DRAFT) {
      if (
        ![
          PolicyProfileLifecycleState.ACTIVE,
          PolicyProfileLifecycleState.REJECTED,
          PolicyProfileLifecycleState.ABANDONED,
        ].includes(update.lifecycleState)
      ) {
        throw new ConflictException('Invalid A4 DRAFT profile lifecycle transition');
      }
    } else {
      assertPublishedProfileImmutable(entity, { ...entity, lifecycleState: update.lifecycleState });
    }
    entity.lifecycleState = update.lifecycleState;
    entity.lastCorrelationId = update.correlationId ?? entity.lastCorrelationId;
    entity.lastRequestId = update.requestId ?? entity.lastRequestId;
    if (update.lifecycleState === PolicyProfileLifecycleState.ACTIVE) {
      entity.publishedAt = entity.publishedAt ?? new Date();
      entity.publishedBy = entity.publishedBy ?? update.actor;
    }
    if (update.lifecycleState === PolicyProfileLifecycleState.RETIRED) {
      entity.retiredAt = entity.retiredAt ?? new Date();
      entity.retiredBy = entity.retiredBy ?? update.actor;
    }
    await this.repository.save(entity);
  }
}

function intervalsOverlap(
  leftFrom: Date,
  leftTo: Date | null,
  rightFrom: Date,
  rightTo: Date | null,
): boolean {
  const leftEnd = leftTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = rightTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftFrom.getTime() < rightEnd && rightFrom.getTime() < leftEnd;
}

@Injectable()
export class TypeOrmPolicyEvidenceSnapshotAttachmentRepository
  implements PolicyEvidenceSnapshotAttachmentRepository
{
  constructor(
    @InjectRepository(ImmutableEvidenceSnapshotAttachment)
    private readonly repository: Repository<ImmutableEvidenceSnapshotAttachment>,
  ) {}

  async insertImmutable(input: PolicySnapshotAttachmentInput): Promise<void> {
    const snapshot = input.snapshot;
    const calculatedHash = calculateSnapshotInputHash(snapshot);
    if (calculatedHash !== snapshot.evidenceSummary.normalizedInputHash) {
      throw new ConflictException('A4 evidence snapshot hash is invalid');
    }
    const existing = await this.repository.findOne({
      where: { snapshotReference: snapshot.snapshotReference },
    });
    if (existing) {
      if (existing.normalizedInputHash !== snapshot.evidenceSummary.normalizedInputHash) {
        throw new ConflictException('A4 evidence snapshot reference is immutable');
      }
      return;
    }
    const entity = snapshotToEntity(input);
    const insertValue = entity as unknown as Parameters<
      Repository<ImmutableEvidenceSnapshotAttachment>['insert']
    >[0];
    await this.repository.insert(insertValue);
  }

  async findByReference(snapshotReference: string): Promise<PolicyEvidenceSnapshot | null> {
    const entity = await this.repository.findOne({ where: { snapshotReference } });
    return entity ? entityToSnapshot(entity) : null;
  }

  async findByHash(normalizedInputHash: string): Promise<PolicyEvidenceSnapshot | null> {
    const entity = await this.repository.findOne({ where: { normalizedInputHash } });
    return entity ? entityToSnapshot(entity) : null;
  }
}

@Injectable()
export class TypeOrmPolicyDecisionRecordRepository implements PolicyDecisionRecordRepository {
  constructor(
    @InjectRepository(PolicyDecisionRecord)
    private readonly repository: Repository<PolicyDecisionRecord>,
    private readonly profileRepository: TypeOrmPolicyProfileVersionRepository,
    private readonly snapshotRepository: TypeOrmPolicyEvidenceSnapshotAttachmentRepository,
    private readonly dataSource?: DataSource,
    private readonly auditService?: AuditService,
  ) {}

  async findByRequestHash(requestHash: string): Promise<PolicyDecisionResult | null> {
    const entity = await this.repository.findOne({
      where: { requestHash },
      order: { evaluatedAt: 'DESC' },
    });
    return entity ? entityToDecision(entity) : null;
  }

  async findByDecisionReference(decisionReference: string): Promise<PolicyDecisionResult | null> {
    const entity = await this.repository.findOne({ where: { decisionReference } });
    return entity ? entityToDecision(entity) : null;
  }

  async save(result: PolicyDecisionResult): Promise<void> {
    await this.insertImmutable({
      decision: result,
      createdBy: result.requestContext.requestId,
      ...DEFAULT_POLICY_RETENTION,
    });
  }

  async saveWithSnapshot(
    result: PolicyDecisionResult,
    snapshot: PolicyEvidenceSnapshot,
  ): Promise<void> {
    validateHash(result.definitionHash, 'definitionHash');
    validateHash(result.requestHash, 'requestHash');
    validateHash(result.evidenceContext.normalizedInputHash, 'normalizedInputHash');
    validateHash(result.resultHash, 'resultHash');
    if (calculateSnapshotInputHash(snapshot) !== snapshot.evidenceSummary.normalizedInputHash) {
      throw new ConflictException('A4 evidence snapshot hash is invalid');
    }
    if (
      snapshot.snapshotReference !== result.evidenceContext.snapshotReference ||
      snapshot.evidenceSummary.normalizedInputHash !== result.evidenceContext.normalizedInputHash
    ) {
      throw new ConflictException('A4 decision and snapshot linkage is invalid');
    }
    if (calculatePolicyDecisionResultHash(result) !== result.resultHash) {
      throw new ConflictException('A4 decision result hash is invalid');
    }
    const dataSource = this.dataSource;
    const auditService = this.auditService;
    if (!dataSource || !auditService) {
      throw new ConflictException('A4 persistence transaction wiring is unavailable');
    }
    await dataSource.transaction(async (manager) => {
      const snapshotEntity = snapshotToEntity({
        snapshot,
        ...DEFAULT_POLICY_RETENTION,
        retentionClass: 'A4_EVIDENCE_SNAPSHOT',
        createdAt: new Date(),
      });
      const snapshotRepository = manager.getRepository(ImmutableEvidenceSnapshotAttachment);
      const existingSnapshot = await snapshotRepository.findOne({
        where: { snapshotReference: snapshot.snapshotReference },
      });
      if (!existingSnapshot) {
        const snapshotInsert = snapshotEntity as unknown as Parameters<
          Repository<ImmutableEvidenceSnapshotAttachment>['insert']
        >[0];
        await snapshotRepository.insert(snapshotInsert);
      } else if (
        existingSnapshot.normalizedInputHash !== snapshot.evidenceSummary.normalizedInputHash
      ) {
        throw new ConflictException('A4 evidence snapshot reference is immutable');
      }
      const decisionEntity = decisionToEntity({
        decision: result,
        ...DEFAULT_POLICY_RETENTION,
        createdBy: result.requestContext.requestId,
      });
      const existingDecision = await manager
        .getRepository(PolicyDecisionRecord)
        .findOne({ where: { decisionReference: result.decisionReference } });
      if (!existingDecision) {
        const decisionInsert = decisionEntity as unknown as Parameters<
          Repository<PolicyDecisionRecord>['insert']
        >[0];
        await manager.getRepository(PolicyDecisionRecord).insert(decisionInsert);
        await auditService.record(manager, {
          entityType: 'A4_POLICY_DECISION',
          entityId: result.decisionReference,
          action: 'DECISION_PERSISTED',
          actor: result.requestContext.requestId,
          correlationId: result.requestContext.correlationId,
          requestId: result.requestContext.requestId,
          newValues: {
            customerId: result.subject.customerId,
            capability: result.capability,
            action: result.action,
            policyVersion: result.policyVersion,
            decision: result.decision,
            requestHash: result.requestHash,
            normalizedInputHash: result.evidenceContext.normalizedInputHash,
            resultHash: result.resultHash,
          },
        });
      } else if (existingDecision.resultHash !== result.resultHash) {
        throw new ConflictException('A4 decision reference is immutable');
      }
    });
  }

  async insertImmutable(input: PolicyDecisionRecordInput): Promise<void> {
    const result = input.decision;
    validateHash(result.definitionHash, 'definitionHash');
    validateHash(result.requestHash, 'requestHash');
    validateHash(result.evidenceContext.normalizedInputHash, 'normalizedInputHash');
    validateHash(result.resultHash, 'resultHash');
    if (calculatePolicyDecisionResultHash(result) !== result.resultHash) {
      throw new ConflictException('A4 decision result hash is invalid');
    }
    const existing = await this.repository.findOne({
      where: { decisionReference: result.decisionReference },
    });
    if (existing) {
      if (existing.resultHash !== result.resultHash) {
        throw new ConflictException('A4 decision reference is immutable');
      }
      return;
    }
    const entity = decisionToEntity(input);
    const insertValue = entity as unknown as Parameters<
      Repository<PolicyDecisionRecord>['insert']
    >[0];
    await this.repository.insert(insertValue);
  }

  async findCurrentEffectiveDecision(query: {
    customerId: string;
    capability: string;
    action: string;
    asOf: string;
    targetBindingId?: string;
  }): Promise<PolicyDecisionResult | null> {
    const asOf = Date.parse(query.asOf);
    if (Number.isNaN(asOf)) return null;
    const records = await this.repository.find({
      where: {
        customerId: query.customerId,
        capability: query.capability,
        action: query.action,
      },
      order: { evaluatedAt: 'DESC' },
    });
    const superseded = new Set(
      records
        .map((record) => record.supersedesDecisionReference)
        .filter((reference): reference is string => reference !== null),
    );
    for (const record of records) {
      const expiresAt = record.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const reviewAt = record.reviewAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (superseded.has(record.decisionReference) || expiresAt <= asOf || reviewAt <= asOf) {
        continue;
      }
      const profile = await this.profileRepository.getProfileAt(
        record.capability,
        record.action,
        query.asOf,
        record.policyVersion,
      );
      if (
        profile?.policyVersion === record.policyVersion &&
        profile.definitionHash === record.definitionHash
      ) {
        return entityToDecision(record);
      }
    }
    return null;
  }

  async listDecisionLineage(decisionReference: string): Promise<readonly PolicyDecisionResult[]> {
    const lineage: PolicyDecisionResult[] = [];
    const seen = new Set<string>();
    let currentReference: string | null = decisionReference;
    while (currentReference && !seen.has(currentReference)) {
      seen.add(currentReference);
      const current = await this.findByDecisionReference(currentReference);
      if (!current) break;
      lineage.push(current);
      currentReference = current.supersedesDecisionReference ?? null;
    }
    return lineage;
  }

  async reconstructDecision(decisionReference: string): Promise<PolicyHistoricalReplayBundle> {
    const decision = await this.findByDecisionReference(decisionReference);
    if (!decision) {
      return {
        outcome: PolicyReplayOutcome.REPLAY_UNAVAILABLE,
        decision: null,
        profile: null,
        snapshot: null,
        integrityMismatch: false,
      };
    }
    const profileRecord = await this.profileRepository.findByPolicyVersion(decision.policyVersion);
    const profile = profileRecord ? (profileRecord as unknown as CapabilityPolicyProfile) : null;
    const snapshot = await this.snapshotRepository.findByReference(
      decision.evidenceContext.snapshotReference,
    );
    if (!profile || !snapshot) {
      return {
        outcome: PolicyReplayOutcome.REPLAY_UNAVAILABLE,
        decision,
        profile,
        snapshot,
        integrityMismatch: false,
      };
    }
    if (
      profile.definitionHash !== decision.definitionHash ||
      snapshot.evidenceSummary.normalizedInputHash !==
        decision.evidenceContext.normalizedInputHash ||
      calculatePolicyDecisionResultHash(decision) !== decision.resultHash
    ) {
      return {
        outcome: PolicyReplayOutcome.REPLAY_INTEGRITY_MISMATCH,
        decision,
        profile,
        snapshot,
        integrityMismatch: true,
      };
    }
    return {
      outcome: PolicyReplayOutcome.REPLAY_EXACT,
      decision,
      profile,
      snapshot,
      integrityMismatch: false,
    };
  }
}

@Injectable()
export class TypeOrmPolicyDecisionPersistenceService
  implements PolicyDecisionPersistenceServiceContract
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly decisionRepository: TypeOrmPolicyDecisionRecordRepository,
    private readonly auditService: AuditService,
  ) {}

  async saveDecisionWithSnapshot(
    input: PolicyDecisionRecordInput,
    snapshot: PolicySnapshotAttachmentInput,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const snapshotEntity = snapshotToEntity(snapshot);
      const existingSnapshot = await manager
        .getRepository(ImmutableEvidenceSnapshotAttachment)
        .findOne({ where: { snapshotReference: snapshotEntity.snapshotReference } });
      if (!existingSnapshot) {
        const snapshotInsert = snapshotEntity as unknown as Parameters<
          Repository<ImmutableEvidenceSnapshotAttachment>['insert']
        >[0];
        await manager.getRepository(ImmutableEvidenceSnapshotAttachment).insert(snapshotInsert);
      } else if (existingSnapshot.normalizedInputHash !== snapshotEntity.normalizedInputHash) {
        throw new ConflictException('A4 evidence snapshot reference is immutable');
      }
      const decisionEntity = decisionToEntity(input);
      const existingDecision = await manager
        .getRepository(PolicyDecisionRecord)
        .findOne({ where: { decisionReference: decisionEntity.decisionReference } });
      let inserted = false;
      if (!existingDecision) {
        const decisionInsert = decisionEntity as unknown as Parameters<
          Repository<PolicyDecisionRecord>['insert']
        >[0];
        await manager.getRepository(PolicyDecisionRecord).insert(decisionInsert);
        inserted = true;
      } else if (existingDecision.resultHash !== decisionEntity.resultHash) {
        throw new ConflictException('A4 decision reference is immutable');
      }
      if (inserted) {
        await this.auditService.record(manager, {
          entityType: 'A4_POLICY_DECISION',
          entityId: decisionEntity.decisionReference,
          action: 'DECISION_PERSISTED',
          actor: input.createdBy,
          correlationId: decisionEntity.requestContext.correlationId as string | undefined,
          requestId: decisionEntity.requestContext.requestId as string | undefined,
          newValues: {
            customerId: decisionEntity.customerId,
            capability: decisionEntity.capability,
            action: decisionEntity.action,
            policyVersion: decisionEntity.policyVersion,
            decision: decisionEntity.decision,
            requestHash: decisionEntity.requestHash,
            normalizedInputHash: decisionEntity.normalizedInputHash,
            resultHash: decisionEntity.resultHash,
          },
        });
      }
    });
  }

  async reconstructDecision(decisionReference: string): Promise<PolicyHistoricalReplayBundle> {
    return this.decisionRepository.reconstructDecision(decisionReference);
  }
}
