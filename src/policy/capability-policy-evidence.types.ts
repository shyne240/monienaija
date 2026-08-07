import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { PolicyEvidenceFreshnessState, PolicySourceClass } from './capability-policy.enums';
import type {
  PolicyDecisionRequest,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
} from './capability-policy.types';

export const POLICY_EVIDENCE_ADAPTER_CONTRACT = 'A4-SOURCE-EVIDENCE' as const;
export const POLICY_EVIDENCE_ADAPTER_CONTRACT_VERSION = 1 as const;

export type PolicyEvidenceReadStatus =
  | 'COMPLETE'
  | 'MISSING'
  | 'UNAVAILABLE'
  | 'RESTRICTED'
  | 'CONFLICTING';

export interface PolicyEvidenceCollectionContext {
  readonly customerId: string;
  readonly capability: string;
  readonly action: string;
  readonly requestedAt: string;
  readonly asOf: string;
  readonly evidenceProfile: string;
  readonly requiredSourceClasses: readonly PolicySourceClass[];
  readonly policyVersionHint?: string;
  readonly evaluationContext?: PolicyDecisionRequest['evaluationContext'];
  readonly targetBindingId?: string;
  readonly actorContext: PolicyDecisionRequest['actorContext'];
  readonly requestContext: PolicyDecisionRequest['requestContext'];
}

export interface PolicyEvidenceReadItem {
  readonly sourceType?: string;
  readonly sourceId?: string | null;
  readonly customerId?: string | null;
  readonly sourceVersion?: string | number | null;
  readonly sourceUpdatedAt?: string | null;
  readonly observedAt?: string;
  readonly deleted?: boolean;
  readonly freshnessState?: PolicyEvidenceFreshnessState;
  readonly freshnessReasonCode?: string;
  readonly classification?: string;
  /** The source-owner read contract must already minimize this value. */
  readonly normalizedValue: Readonly<Record<string, unknown>>;
  readonly sourceReference?: string | null;
}

export interface PolicyEvidenceReadResult {
  readonly status: PolicyEvidenceReadStatus;
  readonly sourceType: string;
  readonly observedAt: string;
  readonly items: readonly PolicyEvidenceReadItem[];
  readonly classification: string;
  readonly failureReference?: string;
  readonly freshnessReasonCode?: string;
}

/** Read-only source-owner boundary. It has no write or mutation method by design. */
export interface PolicyEvidenceReader {
  read(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceReadResult>;
}

export interface PolicyEvidenceAdapterResult {
  readonly contractName: typeof POLICY_EVIDENCE_ADAPTER_CONTRACT;
  readonly contractVersion: typeof POLICY_EVIDENCE_ADAPTER_CONTRACT_VERSION;
  readonly sourceClass: PolicySourceClass;
  readonly collectionStatus: PolicyEvidenceReadStatus;
  readonly sourceType: string;
  readonly observedAt: string;
  readonly items: readonly PolicyEvidenceItem[];
  readonly failureReference?: string;
}

export interface PolicyEvidenceAdapter {
  readonly sourceClass: PolicySourceClass;
  collect(context: PolicyEvidenceCollectionContext): Promise<PolicyEvidenceAdapterResult>;
}

export interface PolicyEvidenceCollectionCommand extends PolicyEvidenceCollectionContext {
  readonly startedAt?: string;
}

export interface PolicyEvidenceCoordinatorOptions {
  readonly now?: () => Date;
  readonly snapshotReferenceFactory?: (normalizedInputHash: string) => string;
  readonly defaultClassification?: string;
}

export interface PolicyEvidenceAdapterPrincipalContext {
  readonly principal: AuthorizationPrincipal;
}

export type PolicyEvidenceSourceRecord = PolicyEvidenceReadItem;
export type PolicyEvidenceSnapshotResult = PolicyEvidenceSnapshot;
