import type {
  CapabilityPolicyProfile,
  PolicyDecisionResult,
  PolicyEvidenceSnapshot,
} from './capability-policy.types';
import type {
  PolicyProfileLifecycleState,
  PolicyReplayOutcome,
  PolicyRetentionClass,
} from './capability-policy-persistence.enums';
import type {
  PolicyCurrentEffectiveDecisionQuery,
  PolicyDecisionLifecycleStore,
} from './capability-policy-recovery.types';
import type { PolicyDecisionStore, PolicyProfileRegistry } from './capability-policy.types';

export interface PolicyRetentionMetadata {
  readonly retentionClass: PolicyRetentionClass | string;
  readonly legalHold: boolean;
  readonly retentionExpiresAt: Date | null;
}

export interface PolicyProfileVersionRecord extends PolicyRetentionMetadata {
  readonly profileReference: string;
  readonly profileKey: string;
  readonly profileVersion: number;
  readonly policyVersion: string;
  readonly definitionHash: string;
  readonly capability: string;
  readonly actions: readonly string[];
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly lifecycleState: PolicyProfileLifecycleState;
  readonly definitionPayload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly createdBy: string;
}

export interface PolicyDecisionRecordInput extends PolicyRetentionMetadata {
  readonly decision: PolicyDecisionResult;
  readonly createdBy: string;
}

export interface PolicySnapshotAttachmentInput extends PolicyRetentionMetadata {
  readonly snapshot: PolicyEvidenceSnapshot;
  readonly createdAt: Date;
}

export interface PolicyProfileLifecycleUpdate {
  readonly lifecycleState: PolicyProfileLifecycleState;
  readonly actor: string;
  readonly expectedRecordVersion?: number;
  readonly correlationId?: string;
  readonly requestId?: string;
}

export interface PolicyProfileVersionRepository extends PolicyProfileRegistry {
  getProfileAt(
    capability: string,
    action: string,
    evaluationAt: string,
    policyVersionHint?: string,
  ): Promise<CapabilityPolicyProfile | null>;
  findByPolicyVersion(policyVersion: string): Promise<PolicyProfileVersionRecord | null>;
  insertImmutable(record: PolicyProfileVersionRecord): Promise<void>;
  transitionLifecycle(policyVersion: string, update: PolicyProfileLifecycleUpdate): Promise<void>;
}

export interface PolicyEvidenceSnapshotAttachmentRepository {
  insertImmutable(input: PolicySnapshotAttachmentInput): Promise<void>;
  findByReference(snapshotReference: string): Promise<PolicyEvidenceSnapshot | null>;
  findByHash(normalizedInputHash: string): Promise<PolicyEvidenceSnapshot | null>;
}

export interface PolicyDecisionRecordRepository
  extends PolicyDecisionStore,
    PolicyDecisionLifecycleStore {
  insertImmutable(input: PolicyDecisionRecordInput): Promise<void>;
  listDecisionLineage(decisionReference: string): Promise<readonly PolicyDecisionResult[]>;
  reconstructDecision(decisionReference: string): Promise<PolicyHistoricalReplayBundle>;
}

export interface PolicyHistoricalReplayBundle {
  readonly outcome: PolicyReplayOutcome;
  readonly decision: PolicyDecisionResult | null;
  readonly profile: CapabilityPolicyProfile | null;
  readonly snapshot: PolicyEvidenceSnapshot | null;
  readonly integrityMismatch: boolean;
}

export interface PolicyPersistenceQuery extends PolicyCurrentEffectiveDecisionQuery {
  readonly policyVersion?: string;
}

export interface PolicyDecisionPersistenceServiceContract {
  saveDecisionWithSnapshot(
    input: PolicyDecisionRecordInput,
    snapshot: PolicySnapshotAttachmentInput,
  ): Promise<void>;
  reconstructDecision(decisionReference: string): Promise<PolicyHistoricalReplayBundle>;
}
