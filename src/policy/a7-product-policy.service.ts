/**
 * A7T03 — A4 product-policy service.
 *
 * The A7 product-policy service is the single A7-side entry point for
 * the A7 first product's A4 product-policy decision, re-evaluation,
 * and historical replay. The A7 product-policy service composes the
 * existing A4 authority boundaries (reused as-is, without modification):
 *
 *  - the A4 `CapabilityPolicyEvaluationService` (reused for the A7
 *    product-policy decision evaluation);
 *  - the A4 `CapabilityPolicyRecoveryService` (reused for the A7
 *    product-policy re-evaluation; the A7 default re-evaluation
 *    trigger is `SOURCE_CHANGED`);
 *  - the A4 `CapabilityPolicyHistoricalReplayService` (reused for the
 *    A7 product-policy historical replay) via the A7
 *    `A7ProductPolicyReplayService` wrapper;
 *  - the A4 `TypeOrmPolicyProfileVersionRepository` (reused for the A4
 *    `policy_profile_versions` table; the A4 table is the only
 *    product-policy persistence table);
 *  - the A4 `TypeOrmPolicyDecisionRecordRepository` (reused for the A4
 *    `policy_decision_records` table; the A4 table is the only
 *    product-policy decision persistence table);
 *  - the A4 `TypeOrmPolicyAuditAdapter` (reused for the A4
 *    `A4_POLICY_DECISION` audit entity; the A4 audit entity is the
 *    only product-policy audit entity) via the A7
 *    `A7ProductPolicyAuditAdapter` wrapper.
 *
 * No new policy evaluator, no new re-evaluation engine, no new replay
 * engine, no new persistence layer, no new audit store, no new
 * idempotency store, and no new authorization / binding / partner
 * boundary is introduced. The A4 authority is the only authority; the
 * A2 / A3 / A6 authorities are the only authorities.
 */

import { Injectable } from '@nestjs/common';

import {
  A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
  A7_PRODUCT_POLICY_AUDIT_ACTOR,
  A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
  A7_PRODUCT_POLICY_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE,
  A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT,
  A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR,
  A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE,
  A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION,
  A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE,
} from './a7-product-policy.constants';
import { A7ProductPolicyAuditAdapter } from './a7-product-policy.audit.adapter';
import { A7ProductPolicyPersistenceRepository } from './a7-product-policy.persistence.repository';
import { A7ProductPolicyReplayService } from './a7-product-policy.replay.service';
import {
  A7_PRODUCT_POLICY_COMPOSED_PROFILES,
  A7_PRODUCT_POLICY_PROFILES,
  A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS,
  assertA7ProductPolicyProfileHashesConsistent,
} from './a7-product-policy.profiles';
import type {
  A7ProductPolicyAuditContext,
  A7ProductPolicyEvaluationCommand,
  A7ProductPolicyEvaluationResult,
  A7ProductPolicyProfileRegistration,
  A7ProductPolicyReevaluationCommand,
  A7ProductPolicyReevaluationResult,
  A7ProductPolicyReplayCommand,
  A7ProductPolicyReplayResult,
} from './a7-product-policy.types';
import { CapabilityPolicyEvaluationService } from './capability-policy.service';
import { CapabilityPolicyRecoveryService } from './capability-policy-recovery.service';
import type { PolicyReevaluationRequest } from './capability-policy-recovery.types';
import type {
  CapabilityPolicyProfile,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
} from './capability-policy.types';
import type { PolicyReevaluationTrigger } from './capability-policy-recovery.enums';

/**
 * A4 product-policy contract name (reused).
 */
const A4_CAPABILITY_POLICY_CONTRACT_NAME = 'A4-CAPABILITY-POLICY' as const;

/**
 * A7 product-policy contract name (new, recorded in audit metadata
 * only).
 */
const A7_PRODUCT_POLICY_CONTRACT_NAME = 'A7-PRODUCT-POLICY' as const;

/**
 * A7 product-policy contract version (new, recorded in audit metadata
 * only).
 */
const A7_PRODUCT_POLICY_CONTRACT_VERSION = 1 as const;

/**
 * The A7 product-policy service. The A7 product-policy service is the
 * single A7-side entry point for the A7 first product's A4
 * product-policy decision, re-evaluation, and historical replay.
 */
@Injectable()
export class A7ProductPolicyService {
  constructor(
    private readonly evaluationService: CapabilityPolicyEvaluationService,
    private readonly recoveryService: CapabilityPolicyRecoveryService,
    private readonly replayService: A7ProductPolicyReplayService,
    private readonly persistenceRepository: A7ProductPolicyPersistenceRepository,
    private readonly auditAdapter: A7ProductPolicyAuditAdapter,
  ) {}

  /**
   * Records the A4 product-policy profile for the A7 first product.
   * The A4 `PolicyProfileVersionRepository.insertImmutable()` enforces
   * the A4 profile reference uniqueness, the A4 definition hash
   * integrity, the A4 effective interval, and the A4 lifecycle state
   * machine.
   */
  async recordProductPolicyProfile(effectiveFrom: string, createdBy: string): Promise<void> {
    for (const profileEntry of A7_PRODUCT_POLICY_PROFILES) {
      await this.persistenceRepository.recordProfile({
        productKey: A7_PRODUCT_KEY_VIRTUAL_ACCOUNT,
        profileReference: profileEntry.profileReference,
        policyVersion: profileEntry.policyVersion,
        profileVersion: profileEntry.profileVersion,
        definitionHash: profileEntry.definitionHash,
        lifecycleState: 'ACTIVE',
        effectiveFrom,
        effectiveTo: null,
        createdBy,
      });
    }
  }

  /**
   * Evaluates the A4 product-policy decision for the A7 first product.
   * The A4 `CapabilityPolicyEvaluationService.evaluate()` consumes the
   * A4 capability / action / profile-version / evidence-snapshot /
   * A2-authorization / A3-binding / A6-partner-reference / idempotency.
   * The A7 product-policy service returns the A4 `PolicyDecisionResult`
   * together with the A7 product key, the A7 product state, the A4
   * product-policy obligation codes, the A4 product-limit output, and
   * the A4 reason codes.
   */
  async evaluateProductPolicy(
    command: A7ProductPolicyEvaluationCommand,
  ): Promise<A7ProductPolicyEvaluationResult> {
    if (command.productKey !== A7_PRODUCT_KEY_VIRTUAL_ACCOUNT) {
      throw new Error(
        `A7 product-policy evaluation is registered for productKey: ${String(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT)}`,
      );
    }
    const result = await this.evaluationService.evaluate(command.evaluation);
    const obligationCodes = this.collectObligationCodes(result);
    const auditContext: A7ProductPolicyAuditContext = {
      productKey: command.productKey,
      productState: command.productState,
      partnerReference: command.partnerReference,
      obligationCodes,
      reasonCodes: [...result.reasonCodes],
      decision: result,
    };
    await this.auditAdapter.recordDecision(auditContext);
    return {
      productKey: command.productKey,
      productState: command.productState,
      decision: result,
      obligationCodes,
      limitOutputs: [...result.limits],
      reasonCodes: [...result.reasonCodes],
    };
  }

  /**
   * Triggers the A4 product-policy re-evaluation for the A7 first
   * product. The A4 `CapabilityPolicyRecoveryService.reevaluate()`
   * consumes the A4 re-evaluation request, the A4 idempotency, the
   * A4 audit, the A4 persistence, the A4 snapshot, and the A4
   * profile-version lifecycle. The A7 product-policy service returns
   * the A4 `PolicyReevaluationResult` together with the A7 product
   * key, the A7 product state, and the A4 re-evaluation reference.
   */
  async triggerProductPolicyReevaluation(
    command: A7ProductPolicyReevaluationCommand,
  ): Promise<A7ProductPolicyReevaluationResult> {
    if (command.productKey !== A7_PRODUCT_KEY_VIRTUAL_ACCOUNT) {
      throw new Error(
        `A7 product-policy re-evaluation is registered for productKey: ${String(A7_PRODUCT_KEY_VIRTUAL_ACCOUNT)}`,
      );
    }
    const enrichedRequest = this.enrichReevaluationRequest(command);
    const result = await this.recoveryService.reevaluate(enrichedRequest);
    if (result.decision !== null) {
      const auditContext: A7ProductPolicyAuditContext = {
        productKey: command.productKey,
        productState: command.productState,
        partnerReference: this.extractPartnerReference(command),
        obligationCodes: this.collectObligationCodes(result.decision),
        reasonCodes: [...result.decision.reasonCodes],
        decision: result.decision,
      };
      await this.auditAdapter.recordReevaluation({
        ...auditContext,
        reevaluationReference: result.reevaluationReference,
        reevaluationState: result.state,
        reevaluationAttempts: result.attempts,
      });
    }
    return {
      productKey: command.productKey,
      productState: command.productState,
      reevaluationReference: result.reevaluationReference,
      result,
    };
  }

  /**
   * Replays the A4 product-policy decision for the A7 first product.
   * The A7 product-policy historical replay service consumes the A4
   * historical-replay service.
   */
  async replayProductPolicy(
    command: A7ProductPolicyReplayCommand,
  ): Promise<A7ProductPolicyReplayResult> {
    return this.replayService.replay(command);
  }

  /**
   * Returns the A4 product-policy profile registration for the A7
   * first product by A4 capability and A4 action.
   */
  getProfileRegistration(
    capability: string,
    action: string,
  ): A7ProductPolicyProfileRegistration | null {
    if (capability !== A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY) return null;
    if (action === A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN) {
      return A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[0] ?? null;
    }
    if (action === A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE) {
      return A7_PRODUCT_POLICY_PROFILE_REGISTRATIONS[1] ?? null;
    }
    return null;
  }

  /**
   * Returns the A4 product-policy profile for the A7 first product by
   * A4 capability and A4 action. The A4 product-policy profile is the
   * A4 `CapabilityPolicyProfile` recorded in the A4 product-policy
   * profile registry; the A7 product-policy service returns the A4
   * profile as-is, without modification.
   */
  async getProductPolicyProfile(
    capability: string,
    action: string,
  ): Promise<CapabilityPolicyProfile | null> {
    return this.persistenceRepository.getProfile(capability, action);
  }

  /**
   * Returns the A4 product-policy version for the A7 first product by
   * A4 capability and A4 action.
   */
  getProductPolicyVersion(capability: string, action: string): string | null {
    if (capability !== A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY) return null;
    if (action === A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN) {
      return A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_POLICY_VERSION;
    }
    if (action === A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE) {
      return A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_POLICY_VERSION;
    }
    return null;
  }

  /**
   * Returns the A4 product-policy profile reference for the A7 first
   * product by A4 capability and A4 action.
   */
  getProductPolicyReference(capability: string, action: string): string | null {
    if (capability !== A7_PRODUCT_VIRTUAL_ACCOUNT_CAPABILITY) return null;
    if (action === A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_ASSIGN) {
      return A7_PRODUCT_VIRTUAL_ACCOUNT_ASSIGN_PROFILE_REFERENCE;
    }
    if (action === A7_PRODUCT_VIRTUAL_ACCOUNT_ACTION_LIFECYCLE) {
      return A7_PRODUCT_VIRTUAL_ACCOUNT_LIFECYCLE_PROFILE_REFERENCE;
    }
    return null;
  }

  /**
   * Returns the A4 product-policy profile references for the A7 first
   * product. The A7 product-policy service consumes the references
   * to verify that the A4 product-policy profile is registered.
   */
  listProductPolicyReferences(): readonly string[] {
    return this.persistenceRepository.listProfileReferences();
  }

  /**
   * Returns the A4 product-policy versions for the A7 first product.
   * The A7 product-policy service consumes the versions to verify
   * that the A4 product-policy version is recorded.
   */
  listProductPolicyVersions(): readonly string[] {
    return this.persistenceRepository.listPolicyVersions();
  }

  /**
   * Returns the A4 product-policy profile registrations for the A7
   * first product. The A7 product-policy service consumes the
   * registrations to look up the A4 product-policy profile for a
   * given A7 capability / action.
   */
  listProductPolicyRegistrations(): readonly A7ProductPolicyProfileRegistration[] {
    return this.persistenceRepository.listProfileRegistrations();
  }

  /**
   * Verifies the A4 product-policy definition-hash consistency for the
   * A7 first product. The A7 product-policy service consumes the A4
   * `calculatePolicyProfileDefinitionHash()` to compute the A4
   * definition hash for each A7 product-policy profile and compares
   * it to the A4 definition hash recorded on the A4
   * `CapabilityPolicyProfile`. The A4 definition hash is the
   * authoritative source of truth.
   */
  verifyProductPolicyDefinitionHashes(): readonly {
    productKey: string;
    capability: string;
    action: string;
    profileReference: string;
    policyVersion: string;
    definitionHash: string;
  }[] {
    return assertA7ProductPolicyProfileHashesConsistent();
  }

  /**
   * Returns the A4 + A7 composed profile list. The A7 product-policy
   * service consumes the composed list to verify that the A4
   * product-policy profile registry includes the A7 product-policy
   * profiles.
   */
  getComposedProfiles(): readonly CapabilityPolicyProfile[] {
    return A7_PRODUCT_POLICY_COMPOSED_PROFILES;
  }

  /**
   * Returns the A4 re-evaluation trigger default for the A7 first
   * product.
   */
  getDefaultReevaluationTrigger(): PolicyReevaluationTrigger {
    return A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER;
  }

  /**
   * Returns the A4 idempotency scope (reused) for the A7 product-policy
   * idempotency.
   */
  getIdempotencyScope(): string {
    return A7_PRODUCT_POLICY_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A4 re-evaluation idempotency scope (reused) for the
   * A7 product-policy re-evaluation idempotency.
   */
  getReevaluationIdempotencyScope(): string {
    return A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE;
  }

  /**
   * Returns the A4 audit actor (reused) for the A7 product-policy audit.
   */
  getAuditActor(): string {
    return A7_PRODUCT_POLICY_AUDIT_ACTOR;
  }

  /**
   * Returns the A4 re-evaluation audit actor (reused) for the A7
   * product-policy re-evaluation audit.
   */
  getReevaluationAuditActor(): string {
    return A7_PRODUCT_POLICY_REEVALUATION_AUDIT_ACTOR;
  }

  /**
   * Returns the A4 + A7 contract name. The A4 contract name is the
   * authoritative contract name; the A7 contract name is recorded in
   * the A7 audit metadata only.
   */
  getContractNames(): {
    readonly a4: string;
    readonly a7: string;
  } {
    return Object.freeze({
      a4: A4_CAPABILITY_POLICY_CONTRACT_NAME,
      a7: A7_PRODUCT_POLICY_CONTRACT_NAME,
    });
  }

  /**
   * Returns the A4 + A7 contract version. The A4 contract version is
   * the authoritative contract version; the A7 contract version is
   * recorded in the A7 audit metadata only.
   */
  getContractVersions(): {
    readonly a4: number;
    readonly a7: number;
  } {
    return Object.freeze({ a4: 1, a7: A7_PRODUCT_POLICY_CONTRACT_VERSION });
  }

  private collectObligationCodes(result: PolicyDecisionResult): readonly string[] {
    const codes: string[] = [];
    for (const obligation of result.obligations) {
      codes.push(obligation.code);
    }
    if (!codes.includes(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION)) {
      codes.push(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A2_AUTHORIZATION);
    }
    if (!codes.includes(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING)) {
      codes.push(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A3_BINDING);
    }
    if (!codes.includes(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE)) {
      codes.push(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_A6_PARTNER_REFERENCE);
    }
    if (!codes.includes(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT)) {
      codes.push(A7_PRODUCT_POLICY_OBLIGATION_RECHECK_EXECUTION_LIMIT);
    }
    return Object.freeze([...new Set(codes)].sort());
  }

  private enrichReevaluationRequest(
    command: A7ProductPolicyReevaluationCommand,
  ): PolicyReevaluationRequest {
    return {
      ...command.request,
      trigger: command.request.trigger ?? A7_PRODUCT_POLICY_DEFAULT_REEVALUATION_TRIGGER,
      idempotencyContext: {
        scope:
          command.request.idempotencyContext.scope ??
          A7_PRODUCT_POLICY_REEVALUATION_IDEMPOTENCY_SCOPE,
        key: command.request.idempotencyContext.key,
      },
    };
  }

  private extractPartnerReference(command: A7ProductPolicyReevaluationCommand): string | null {
    const evaluation: PolicyEvaluationCommand = command.request.evaluation;
    if (evaluation.evaluationContext?.declaredContext === undefined) return null;
    const value = evaluation.evaluationContext.declaredContext.partnerReference;
    return typeof value === 'string' ? value : null;
  }
}
