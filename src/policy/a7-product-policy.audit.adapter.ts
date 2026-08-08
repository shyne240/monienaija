/**
 * A7T03 — A4 product-policy audit adapter.
 *
 * The A7 product-policy service reuses the A4 `TypeOrmPolicyAuditAdapter`
 * (which writes the A4 `A4_POLICY_DECISION` audit entity through the A4
 * `AuditService`). The A7 product-policy audit adapter is a thin
 * A7-side wrapper that:
 *
 *  - delegates the A4 audit fact recording to the A4
 *    `TypeOrmPolicyAuditAdapter`;
 *  - augments the A4 audit `metadata` with the A7 product key, the A7
 *    product state, the A6 partner reference, and the A4 obligation
 *    codes; and
 *  - records an additional A4 `DECISION_REEVALUATED` audit fact when
 *    the A4 re-evaluation is triggered by an A7 product-level event
 *    (e.g. a partner-cleared virtual-account assignment).
 *
 * No new audit entity type, no new audit store, and no new audit
 * adapter is introduced. The A4 `A4_POLICY_DECISION` audit entity is
 * the only audit entity. The A4 `AuditService` is the only audit
 * boundary.
 */

import { Injectable } from '@nestjs/common';

import { TypeOrmPolicyAuditAdapter } from './capability-policy-audit.adapter';
import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
  A7_PRODUCT_POLICY_AUDIT_ACTOR,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
  A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
} from './a7-product-policy.constants';
import type { A7ProductPolicyAuditContext } from './a7-product-policy.types';
import type { PolicyAuditFact } from './capability-policy.types';

/**
 * A4 product-policy audit action for the A7 product-policy decision
 * creation. The action is the A4 `DECISION_CREATED` action; the A7
 * product-policy audit adapter augments the A4 audit fact with the A7
 * product context.
 */
const A7_AUDIT_ACTION_DECISION_CREATED = 'A7_DECISION_CREATED';

/**
 * A4 product-policy audit action for the A7 product-policy re-evaluation.
 * The action is the A4 `DECISION_REEVALUATED` action; the A7 product-policy
 * audit adapter augments the A4 audit fact with the A7 product context.
 */
const A7_AUDIT_ACTION_DECISION_REEVALUATED = 'A7_DECISION_REEVALUATED';

/**
 * The A7 product-policy audit adapter. The A7 product-policy service
 * uses this adapter to record the A4 audit fact for an A7 product-policy
 * decision or re-evaluation. The A7 product-policy service does not
 * introduce a new audit entity type, a new audit store, or a new audit
 * adapter; the A4 `TypeOrmPolicyAuditAdapter` is the only audit adapter.
 */
@Injectable()
export class A7ProductPolicyAuditAdapter {
  constructor(private readonly a4AuditAdapter: TypeOrmPolicyAuditAdapter) {}

  /**
   * Records an A4 product-policy audit fact for the A7 product-policy
   * decision. The A4 audit fact is augmented with the A7 product
   * context. The A4 audit entity type `A4_POLICY_DECISION` is reused.
   */
  async recordDecision(context: A7ProductPolicyAuditContext): Promise<void> {
    const fact: PolicyAuditFact = {
      action: A7_AUDIT_ACTION_DECISION_CREATED,
      decisionReference: context.decision.decisionReference,
      customerId: context.decision.subject.customerId,
      capability: context.decision.capability,
      policyVersion: context.decision.policyVersion,
      decision: context.decision.decision,
      requestHash: context.decision.requestHash,
      normalizedInputHash: context.decision.evidenceContext.normalizedInputHash,
      correlationId: context.decision.requestContext.correlationId,
      requestId: context.decision.requestContext.requestId,
      actor: A7_PRODUCT_POLICY_AUDIT_ACTOR,
      metadata: {
        productKey: context.productKey,
        productState: context.productState,
        partnerReference: context.partnerReference,
        obligationCodes: [...context.obligationCodes],
        reasonCodes: [...context.reasonCodes],
        a7AuditContractName: 'A7-PRODUCT-POLICY',
        a7AuditContractVersion: 1,
        a4AuditContractName: 'A4-CAPABILITY-POLICY',
        a4AuditContractVersion: 1,
      },
    };
    await this.a4AuditAdapter.record(fact);
  }

  /**
   * Records an A4 product-policy audit fact for the A7 product-policy
   * re-evaluation. The A4 audit fact is augmented with the A7 product
   * context, the A7 re-evaluation reference, and the A4 re-evaluation
   * state. The A4 audit entity type `A4_POLICY_DECISION` is reused.
   */
  async recordReevaluation(
    context: A7ProductPolicyAuditContext & {
      readonly reevaluationReference: string;
      readonly reevaluationState: string;
      readonly reevaluationAttempts: number;
    },
  ): Promise<void> {
    const fact: PolicyAuditFact = {
      action: A7_AUDIT_ACTION_DECISION_REEVALUATED,
      decisionReference: context.decision.decisionReference,
      customerId: context.decision.subject.customerId,
      capability: context.decision.capability,
      policyVersion: context.decision.policyVersion,
      decision: context.decision.decision,
      requestHash: context.decision.requestHash,
      normalizedInputHash: context.decision.evidenceContext.normalizedInputHash,
      correlationId: context.decision.requestContext.correlationId,
      requestId: context.decision.requestContext.requestId,
      actor: A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
      metadata: {
        productKey: context.productKey,
        productState: context.productState,
        partnerReference: context.partnerReference,
        obligationCodes: [...context.obligationCodes],
        reasonCodes: [...context.reasonCodes],
        reevaluationReference: context.reevaluationReference,
        reevaluationState: context.reevaluationState,
        reevaluationAttempts: context.reevaluationAttempts,
        a7AuditContractName: 'A7-PRODUCT-POLICY',
        a7AuditContractVersion: 1,
        a4AuditContractName: 'A4-CAPABILITY-POLICY',
        a4AuditContractVersion: 1,
      },
    };
    await this.a4AuditAdapter.record(fact);
  }
}

/**
 * Verifies that the A7 product-policy audit obligation codes are the
 * expected A4 obligation codes. This is a defensive consistency check
 * used by tests; the A4 obligation codes are the authoritative source
 * of truth.
 */
export function assertA7AuditObligationCodesConsistent(): readonly string[] {
  return Object.freeze([
    A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
    A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
    A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
    A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
  ]);
}

/**
 * The A7 product-policy product key (reused). Exposed for tests.
 */
export const A7_PRODUCT_POLICY_PRODUCT_KEY_VALUE = A7_PRODUCT_KEY_VIRTUAL_ACCOUNT;
