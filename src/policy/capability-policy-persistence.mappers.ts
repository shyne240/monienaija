import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  PolicyProfileLifecycleState,
  PolicyRetentionClass,
} from './capability-policy-persistence.enums';
import { ImmutableEvidenceSnapshotAttachment } from './immutable-evidence-snapshot-attachment.entity';
import { PolicyDecisionRecord } from './policy-decision-record.entity';
import { PolicyProfileVersion } from './policy-profile-version.entity';
import type {
  CapabilityPolicyProfile,
  PolicyDecisionResult,
  PolicyEvidenceSnapshot,
} from './capability-policy.types';
import type {
  PolicyDecisionRecordInput,
  PolicyProfileVersionRecord,
  PolicySnapshotAttachmentInput,
  PolicyRetentionMetadata,
} from './capability-policy-persistence.types';

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function profileRecordFromProfile(
  profile: CapabilityPolicyProfile,
  createdBy = 'policy-profile-publisher',
  effectiveFrom = new Date(0),
  effectiveTo: Date | null = null,
): PolicyProfileVersionRecord {
  return {
    profileReference: profile.profileReference,
    profileKey: profile.profileKey,
    profileVersion: profile.profileVersion,
    policyVersion: profile.policyVersion,
    definitionHash: profile.definitionHash,
    capability: profile.capability,
    actions: profile.actions,
    effectiveFrom,
    effectiveTo,
    lifecycleState: (profile.lifecycleState ??
      PolicyProfileLifecycleState.ACTIVE) as PolicyProfileLifecycleState,
    definitionPayload: profile as unknown as Readonly<Record<string, unknown>>,
    createdAt: new Date(),
    createdBy,
    ...DEFAULT_POLICY_RETENTION,
  };
}

export function profileToEntity(
  record: PolicyProfileVersionRecord,
  existing?: PolicyProfileVersion,
): PolicyProfileVersion {
  const entity = existing ?? new PolicyProfileVersion();
  entity.profileReference = record.profileReference;
  entity.profileKey = record.profileKey;
  entity.profileVersion = record.profileVersion;
  entity.policyVersion = record.policyVersion;
  entity.definitionHash = record.definitionHash;
  entity.capability = record.capability;
  entity.actions = [...record.actions];
  entity.subjectType = 'CUSTOMER';
  entity.contractName = 'A4-CAPABILITY-POLICY';
  entity.contractVersion = 1;
  entity.profileContractVersion = 1;
  entity.definitionPayload = record.definitionPayload;
  entity.effectiveFrom = record.effectiveFrom;
  entity.effectiveTo = record.effectiveTo;
  entity.lifecycleState = record.lifecycleState;
  entity.createdBy = record.createdBy;
  entity.publishedAt = existing?.publishedAt ?? null;
  entity.publishedBy = existing?.publishedBy ?? null;
  entity.retiredAt = existing?.retiredAt ?? null;
  entity.retiredBy = existing?.retiredBy ?? null;
  entity.lastCorrelationId = existing?.lastCorrelationId ?? null;
  entity.lastRequestId = existing?.lastRequestId ?? null;
  applyRetention(entity, record);
  return entity;
}

export function entityToProfile(entity: PolicyProfileVersion): CapabilityPolicyProfile {
  const payload = entity.definitionPayload as Partial<CapabilityPolicyProfile>;
  return {
    ...payload,
    profileReference: entity.profileReference,
    profileKey: entity.profileKey,
    profileVersion: entity.profileVersion,
    policyVersion: entity.policyVersion,
    definitionHash: entity.definitionHash,
    capability: entity.capability,
    actions: entity.actions,
    subjectType: 'CUSTOMER',
    contractName: 'A4-CAPABILITY-POLICY',
    contractVersion: 1,
    profileContractVersion: entity.profileContractVersion,
    effectiveFrom: entity.effectiveFrom.toISOString(),
    effectiveTo: entity.effectiveTo?.toISOString() ?? null,
    lifecycleState: entity.lifecycleState,
  } as CapabilityPolicyProfile;
}

export function decisionToEntity(
  input: PolicyDecisionRecordInput,
  existing?: PolicyDecisionRecord,
): PolicyDecisionRecord {
  const result = input.decision;
  const entity = existing ?? new PolicyDecisionRecord();
  entity.decisionReference = result.decisionReference;
  entity.customerId = result.subject.customerId;
  entity.capability = result.capability;
  entity.action = result.action;
  entity.profileReference = result.profileReference;
  entity.profileKey = result.profileKey;
  entity.profileVersion = result.profileVersion;
  entity.policyVersion = result.policyVersion;
  entity.contractName = result.contractName;
  entity.contractVersion = result.contractVersion;
  entity.definitionHash = result.definitionHash;
  entity.requestHash = result.requestHash;
  entity.snapshotReference = result.evidenceContext.snapshotReference;
  entity.snapshotContractVersion = result.evidenceContext.snapshotContractVersion;
  entity.normalizedInputHash = result.evidenceContext.normalizedInputHash;
  entity.resultHash = result.resultHash;
  entity.decision = result.decision;
  entity.reasonCodes = [...result.reasonCodes];
  entity.explanation = result.explanation;
  entity.obligations = result.obligations as unknown as readonly Record<string, unknown>[];
  entity.limits = result.limits as unknown as readonly Record<string, unknown>[];
  entity.sourceReferences = result.sourceReferences as unknown as readonly Record<
    string,
    unknown
  >[];
  entity.freshnessSummary = [...result.evidenceContext.freshnessSummary];
  entity.collectionStatus = result.evidenceContext.collectionStatus;
  entity.authorizationContextReference = result.authorizationContextReference;
  entity.targetBindingReference = null;
  entity.requestedAt = new Date(result.requestedAt);
  entity.evaluatedAt = new Date(result.evaluatedAt);
  entity.expiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
  entity.reviewAt = result.reviewAt ? new Date(result.reviewAt) : null;
  entity.supersedesDecisionReference = result.supersedesDecisionReference ?? null;
  entity.requestContext = result.requestContext;
  entity.createdBy = input.createdBy;
  applyRetention(entity, input);
  return entity;
}

export function entityToDecision(entity: PolicyDecisionRecord): PolicyDecisionResult {
  return {
    contractName: entity.contractName as 'A4-CAPABILITY-POLICY',
    contractVersion: entity.contractVersion as 1,
    decisionReference: entity.decisionReference,
    subject: { type: 'CUSTOMER', customerId: entity.customerId },
    capability: entity.capability,
    action: entity.action,
    profileReference: entity.profileReference,
    profileKey: entity.profileKey,
    profileVersion: entity.profileVersion,
    policyVersion: entity.policyVersion,
    definitionHash: entity.definitionHash,
    decision: entity.decision,
    ...(entity.supersedesDecisionReference
      ? { supersedesDecisionReference: entity.supersedesDecisionReference }
      : {}),
    requestedAt: entity.requestedAt.toISOString(),
    evaluatedAt: entity.evaluatedAt.toISOString(),
    expiresAt: entity.expiresAt?.toISOString() ?? null,
    reviewAt: entity.reviewAt?.toISOString() ?? null,
    reasonCodes: entity.reasonCodes,
    explanation: entity.explanation as PolicyDecisionResult['explanation'],
    obligations: entity.obligations as unknown as PolicyDecisionResult['obligations'],
    limits: entity.limits as unknown as PolicyDecisionResult['limits'],
    sourceReferences:
      entity.sourceReferences as unknown as PolicyDecisionResult['sourceReferences'],
    evidenceContext: {
      snapshotReference: entity.snapshotReference,
      snapshotContractVersion: entity.snapshotContractVersion,
      normalizedInputHash: entity.normalizedInputHash,
      freshnessSummary:
        entity.freshnessSummary as PolicyDecisionResult['evidenceContext']['freshnessSummary'],
      collectionStatus: entity.collectionStatus,
    },
    authorizationContextReference: entity.authorizationContextReference,
    requestHash: entity.requestHash,
    resultHash: entity.resultHash,
    idempotencyReplay: false,
    requestContext: entity.requestContext as PolicyDecisionResult['requestContext'],
  };
}

export function snapshotToEntity(
  input: PolicySnapshotAttachmentInput,
  existing?: ImmutableEvidenceSnapshotAttachment,
): ImmutableEvidenceSnapshotAttachment {
  const snapshot = input.snapshot;
  const entity = existing ?? new ImmutableEvidenceSnapshotAttachment();
  entity.snapshotReference = snapshot.snapshotReference;
  entity.snapshotContractName = snapshot.contractName;
  entity.snapshotContractVersion = snapshot.contractVersion;
  entity.customerId = snapshot.subject.customerId;
  entity.capability = snapshot.policyRequestScope.capability;
  entity.action = snapshot.policyRequestScope.action;
  entity.requestedAt = new Date(snapshot.policyRequestScope.requestedAt);
  entity.asOf = new Date(snapshot.policyRequestScope.asOf);
  entity.evidenceProfile = snapshot.policyRequestScope.evidenceProfile;
  entity.policyVersionHint = snapshot.policyRequestScope.policyVersionHint ?? null;
  entity.collectedAt = new Date(snapshot.collection.collectedAt);
  entity.collectionStatus = snapshot.collection.status;
  entity.requiredSourceClasses = snapshot.collection.requiredSourceClasses;
  entity.freshnessSummary = snapshot.evidenceSummary.freshnessStates;
  entity.normalizedInputHash = snapshot.evidenceSummary.normalizedInputHash;
  entity.canonicalizationVersion = snapshot.integrity.canonicalizationVersion;
  entity.hashAlgorithm = snapshot.integrity.hashAlgorithm;
  entity.snapshotPayload = snapshot as unknown as Readonly<Record<string, unknown>>;
  applyRetention(entity, input);
  return entity;
}

export function entityToSnapshot(
  entity: ImmutableEvidenceSnapshotAttachment,
): PolicyEvidenceSnapshot {
  const snapshot = entity.snapshotPayload as unknown as PolicyEvidenceSnapshot;
  if (!snapshot || snapshot.snapshotReference !== entity.snapshotReference) {
    throw new ConflictException('The stored A4 snapshot payload does not match its reference');
  }
  if (snapshot.evidenceSummary.normalizedInputHash !== entity.normalizedInputHash) {
    throw new ConflictException('The stored A4 snapshot hash does not match its attachment');
  }
  return snapshot;
}

export function validateRetentionMetadata(metadata: PolicyRetentionMetadata): void {
  if (!metadata.retentionClass.trim() || metadata.retentionClass.length > 64) {
    throw new BadRequestException('A4 retentionClass is invalid');
  }
  if (metadata.retentionExpiresAt && Number.isNaN(metadata.retentionExpiresAt.getTime())) {
    throw new BadRequestException('A4 retentionExpiresAt is invalid');
  }
}

function applyRetention(
  entity: PolicyProfileVersion | PolicyDecisionRecord | ImmutableEvidenceSnapshotAttachment,
  metadata: PolicyRetentionMetadata,
): void {
  validateRetentionMetadata(metadata);
  entity.retentionClass = metadata.retentionClass;
  entity.legalHold = metadata.legalHold;
  entity.retentionExpiresAt = metadata.retentionExpiresAt;
}

export function validateHash(value: string, field: string): void {
  if (!HASH_PATTERN.test(value)) throw new BadRequestException(`${field} must be SHA-256 hex`);
}

export const DEFAULT_POLICY_RETENTION: PolicyRetentionMetadata = {
  retentionClass: PolicyRetentionClass.POLICY_HISTORY,
  legalHold: false,
  retentionExpiresAt: null,
};
