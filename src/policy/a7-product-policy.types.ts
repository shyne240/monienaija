/**
 * A7T03 — A7 product-policy types.
 *
 * The A7 product-policy contract reuses A4 types end-to-end. The A7
 * product-policy types below are thin A7-side wrappers that bind an A4
 * decision / re-evaluation / replay result to the A7 product-catalog
 * product key, the A7 product-state vocabulary, and the A6 partner
 * reference.
 *
 * No new A4 type is introduced. No A4 record is mutated. No A4 source,
 * A2 principal, A3 binding, A6 partner reference, A7 product state,
 * A7 notification, A7 public surface, or A8 work is exposed through
 * these types.
 */

import type {
  PolicyAuthorizationPort,
  PolicyAuditPort,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
  PolicyIdempotencyPort,
} from './capability-policy.types';
import type { PolicyHistoricalReplayResult } from './capability-policy-historical-replay.service';
import type {
  PolicyReevaluationRequest,
  PolicyReevaluationResult,
} from './capability-policy-recovery.types';

/**
 * The A7 product-catalog product key for the first product. The A7 product
 * catalog (per `docs/A7-PRODUCT-CATALOG-CONTRACT.md`) freezes the A7
 * first product as `VIRTUAL_ACCOUNT` v1. The A7 product-policy service
 * binds an A4 product-policy decision / re-evaluation / replay result
 * to the A7 product key.
 */
export type A7ProductPolicyProductKey = 'VIRTUAL_ACCOUNT';

/**
 * The A4 decision vocabulary (reused) for the A7 product-policy contract.
 * The A7 product-policy service does not introduce a new decision state.
 */
export type A7ProductPolicyDecision = PolicyDecisionResult['decision'];

/**
 * The A4 re-evaluation trigger (reused) for the A7 product-policy
 * contract. The A7 first product's default trigger is `SOURCE_CHANGED`.
 */
export type A7ProductPolicyReevaluationTrigger = PolicyReevaluationRequest['trigger'];

/**
 * A frozen A7 product-policy profile registration. The A7 product-policy
 * contract does not introduce a new A4 capability-policy profile shape;
 * it composes a frozen A4 `CapabilityPolicyProfile` together with the
 * A7 product key, the A4 capability/action, the A4 policy version, the
 * A4 profile version, the A4 definition hash, the A4 re-evaluation
 * trigger, the A4 limit dimensions, the A4 product-eligibility
 * requirements, and the A4 obligation template codes.
 */
export interface A7ProductPolicyProfileRegistration {
  readonly productKey: A7ProductPolicyProductKey;
  readonly capability: string;
  readonly action: string;
  readonly profileReference: string;
  readonly profileVersion: number;
  readonly policyVersion: string;
  readonly definitionHash: string;
  readonly reevaluationTrigger: A7ProductPolicyReevaluationTrigger;
  readonly limitDimensions: readonly string[];
  readonly obligationCodes: readonly string[];
}

/**
 * A7 product-policy evaluation command. The A7 product-policy service
 * delegates to the A4 `CapabilityPolicyEvaluationService.evaluate()`;
 * the A7 command is a thin A7-side wrapper that binds the A4 evaluation
 * command to the A7 product key, the A7 product state, and the A6
 * partner reference.
 */
export interface A7ProductPolicyEvaluationCommand {
  readonly evaluation: PolicyEvaluationCommand;
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly partnerReference: string | null;
}

/**
 * A7 product-policy evaluation result. The A7 product-policy service
 * returns the A4 `PolicyDecisionResult` together with the A7 product
 * key, the A7 product state, the A4 product-policy obligation codes,
 * the A4 product-limit output, and the A4 reason codes.
 */
export interface A7ProductPolicyEvaluationResult {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly decision: PolicyDecisionResult;
  readonly obligationCodes: readonly string[];
  readonly limitOutputs: PolicyDecisionResult['limits'];
  readonly reasonCodes: readonly string[];
}

/**
 * A7 product-policy re-evaluation command. The A7 product-policy service
 * delegates to the A4 `CapabilityPolicyRecoveryService.reevaluate()`;
 * the A7 command is a thin A7-side wrapper that binds the A4
 * re-evaluation request to the A7 product key and the A7 product state.
 */
export interface A7ProductPolicyReevaluationCommand {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly request: PolicyReevaluationRequest;
}

/**
 * A7 product-policy re-evaluation result. The A7 product-policy service
 * returns the A4 `PolicyReevaluationResult` together with the A7 product
 * key, the A7 product state, and the A4 re-evaluation reference.
 */
export interface A7ProductPolicyReevaluationResult {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly reevaluationReference: string;
  readonly result: PolicyReevaluationResult;
}

/**
 * A7 product-policy historical replay command. The A7 product-policy
 * service delegates to the A4 `CapabilityPolicyHistoricalReplayService.replay()`;
 * the A7 command is a thin A7-side wrapper that binds the A4
 * historical-replay call to the A7 product key and the A4 decision
 * reference.
 */
export interface A7ProductPolicyReplayCommand {
  readonly productKey: A7ProductPolicyProductKey;
  readonly decisionReference: string;
  readonly command: PolicyEvaluationCommand;
}

/**
 * A7 product-policy historical replay result. The A7 product-policy
 * service returns the A4 `PolicyHistoricalReplayResult` together with the
 * A7 product key.
 */
export interface A7ProductPolicyReplayResult {
  readonly productKey: A7ProductPolicyProductKey;
  readonly result: PolicyHistoricalReplayResult;
}

/**
 * A7 product-policy audit context. The A7 product-policy service
 * records the A4 audit fact through the A4 `TypeOrmPolicyAuditAdapter`
 * and adds the A7 product key, the A7 product state, the A6 partner
 * reference, and the A4 obligation codes as A4 audit metadata.
 */
export interface A7ProductPolicyAuditContext {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly partnerReference: string | null;
  readonly obligationCodes: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly decision: PolicyDecisionResult;
}

/**
 * A7 product-policy product-level evidence. The A7 product-policy
 * service records the A4 evidence item through the A4 audit and
 * snapshot contracts. No new A4 evidence class is introduced; the A4
 * `PolicySourceClass` enum is reused.
 */
export interface A7ProductPolicyProductLevelEvidence {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly sourceClass: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly sourceVersion: string | number | null;
  readonly sourceUpdatedAt: string | null;
  readonly observedAt: string;
  readonly classification: string;
  readonly normalizedValue: Readonly<Record<string, unknown>>;
  readonly sourceReference: string | null;
  readonly productReference: string;
}

/**
 * A7 product-policy re-evaluation trigger shape. The A7 product-policy
 * service reuses the A4 `PolicyReevaluationTrigger` enum; the A7
 * trigger is the A4 trigger with the A7 product-level context
 * attached.
 */
export interface A7ProductPolicyReevaluationTriggerShape {
  readonly productKey: A7ProductPolicyProductKey;
  readonly productState: string;
  readonly trigger: A7ProductPolicyReevaluationTrigger;
  readonly reevaluationReference: string;
  readonly previousDecisionReference: string | null;
  readonly idempotencyKey: string;
}

/**
 * A7 product-policy persistence contract. The A7 product-policy
 * service reuses the A4 `TypeOrmPolicyProfileVersionRepository`;
 * the A7 contract is a thin A7-side wrapper that binds the A4
 * persistence call to the A7 product key.
 */
export interface A7ProductPolicyPersistenceContract {
  readonly productKey: A7ProductPolicyProductKey;
  readonly profileReference: string;
  readonly policyVersion: string;
  readonly profileVersion: number;
  readonly definitionHash: string;
  readonly lifecycleState: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'REJECTED' | 'ABANDONED';
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdBy: string;
}

/**
 * A7 product-policy auditor (reuses the A4 `PolicyAuditPort`).
 */
export type A7ProductPolicyAuditor = PolicyAuditPort;

/**
 * A7 product-policy authorizer (reuses the A4 `PolicyAuthorizationPort`).
 */
export type A7ProductPolicyAuthorizer = PolicyAuthorizationPort;

/**
 * A7 product-policy idempotency port (reuses the A4 `PolicyIdempotencyPort`).
 */
export type A7ProductPolicyIdempotencyPort = PolicyIdempotencyPort;

/**
 * A7 product-policy evidence snapshot (reuses the A4 `PolicyEvidenceSnapshot`).
 */
export type A7ProductPolicyEvidenceSnapshot = PolicyEvidenceSnapshot;

/**
 * A7 product-policy evidence item (reuses the A4 `PolicyEvidenceItem`).
 */
export type A7ProductPolicyEvidenceItem = PolicyEvidenceItem;
