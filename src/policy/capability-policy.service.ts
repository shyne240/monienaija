import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type {
  AuthorizationPolicy,
  AuthorizationPrincipal,
} from '../authorization/authorization.types';
import {
  PolicyAccountBindingRequirement,
  PolicyCollectionStatus,
  PolicyComplianceRequirement,
  PolicyDecisionState,
  PolicyEnrollmentRequirement,
  PolicyEvidenceFreshnessState,
  PolicyLimitDimension,
  PolicyLimitEvaluationStatus,
  PolicyLimitRequirement,
  PolicyPermissionRequirement,
  PolicyRequirementMode,
  PolicyRiskRequirement,
  PolicySourceClass,
} from './capability-policy.enums';
import {
  calculatePolicyProfileDefinitionHash,
  StaticCapabilityPolicyProfileRegistry,
} from './capability-policy.profiles';
import type {
  CapabilityPolicyProfile,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyEvaluationCommand,
  PolicyEvidenceItem,
  PolicyEvidenceSnapshot,
  PolicyEvidenceSourceReference,
  PolicyEvaluationContext,
  PolicyAuditPort,
  PolicyAuthorizationPort,
  PolicyDecisionStore,
  PolicyIdempotencyPort,
  PolicyLimitCheck,
  PolicyLimitEvaluation,
  PolicyLimitOutput,
  PolicyObligation,
  PolicyProfileRegistry,
} from './capability-policy.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,2}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const POLICY_IDEMPOTENCY_SCOPE = 'policy.capability-decision.v1';
const AUTHORIZATION_RESOURCE_TYPE = 'customer-capability-policy';
const AUTHORIZATION_READ_ACTION = 'policy:capability:read';
const AUTHORIZATION_EVALUATE_ACTION = 'policy:capability:evaluate';

const OUTCOME_PRIORITY: Record<PolicyDecisionState, number> = {
  [PolicyDecisionState.ALLOW]: 1,
  [PolicyDecisionState.ALLOW_WITH_LIMITS]: 2,
  [PolicyDecisionState.PENDING_REVIEW]: 3,
  [PolicyDecisionState.SUSPEND]: 4,
  [PolicyDecisionState.DENY]: 5,
};

const FRESHNESS_ORDER: PolicyEvidenceFreshnessState[] = [
  PolicyEvidenceFreshnessState.CURRENT,
  PolicyEvidenceFreshnessState.STALE,
  PolicyEvidenceFreshnessState.MISSING,
  PolicyEvidenceFreshnessState.DELETED,
  PolicyEvidenceFreshnessState.CONFLICTING,
  PolicyEvidenceFreshnessState.UNAVAILABLE,
  PolicyEvidenceFreshnessState.RESTRICTED,
];

interface CandidateOutcome {
  readonly decision: PolicyDecisionState;
  readonly code: string;
}

interface NormalizedRequest {
  readonly request: PolicyDecisionRequest;
  readonly requestHash: string;
}

interface ReservationContext {
  readonly reservation: Awaited<ReturnType<PolicyIdempotencyPort['reserve']>>;
  readonly managed: boolean;
}

interface EvaluationState {
  readonly candidates: CandidateOutcome[];
  readonly reasons: Set<string>;
  readonly limits: PolicyLimitOutput[];
  readonly obligations: PolicyObligation[];
  readonly reviewDates: string[];
}

@Injectable()
export class CapabilityPolicyEvaluationService {
  constructor(
    private readonly authorizationService: PolicyAuthorizationPort,
    private readonly profileRegistry: PolicyProfileRegistry = new StaticCapabilityPolicyProfileRegistry(),
    private readonly decisionStore: PolicyDecisionStore,
    private readonly idempotency: PolicyIdempotencyPort,
    private readonly audit: PolicyAuditPort,
  ) {}

  async evaluateReadOnly(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult> {
    const normalized = this.normalizeRequest(command);
    const authorization = await this.authorize(command.actorContext.principal, normalized.request);
    if (!authorization.allowed) {
      throw new ForbiddenException(`Authorization denied: ${authorization.reason ?? 'UNKNOWN'}`);
    }
    const profile = this.profileRegistry.getProfileAt
      ? await this.profileRegistry.getProfileAt(
          normalized.request.capability,
          normalized.request.action,
          normalized.request.requestedAt,
          normalized.request.policyVersionHint,
        )
      : await this.profileRegistry.getProfile(
          normalized.request.capability,
          normalized.request.action,
          normalized.request.policyVersionHint,
        );
    if (!profile) {
      throw new BadRequestException(
        'No A4 policy profile is registered for this capability/action',
      );
    }
    this.assertProfile(profile, normalized.request);
    this.assertSnapshot(command.snapshot, normalized.request);
    return this.evaluateSnapshot(
      normalized.request,
      command.snapshot,
      profile,
      authorization,
      normalized.requestHash,
    );
  }

  async evaluate(command: PolicyEvaluationCommand): Promise<PolicyDecisionResult> {
    const normalized = this.normalizeRequest(command);
    const authorization = await this.authorize(command.actorContext.principal, normalized.request);
    if (!authorization.allowed) {
      throw new ForbiddenException(`Authorization denied: ${authorization.reason ?? 'UNKNOWN'}`);
    }

    const profile = this.profileRegistry.getProfileAt
      ? await this.profileRegistry.getProfileAt(
          normalized.request.capability,
          normalized.request.action,
          normalized.request.requestedAt,
          normalized.request.policyVersionHint,
        )
      : await this.profileRegistry.getProfile(
          normalized.request.capability,
          normalized.request.action,
          normalized.request.policyVersionHint,
        );
    if (!profile) {
      throw new BadRequestException(
        'No A4 policy profile is registered for this capability/action',
      );
    }
    this.assertProfile(profile, normalized.request);
    this.assertSnapshot(command.snapshot, normalized.request);

    const reservationContext = await this.reserveIdempotency(normalized);
    const reservation = reservationContext.reservation;
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ConflictException('The policy decision request is already in progress');
    }
    if (reservation.kind === 'REPLAY') {
      const replay =
        reservation.result ??
        (reservation.decisionReference
          ? await this.decisionStore.findByDecisionReference(reservation.decisionReference)
          : await this.decisionStore.findByRequestHash(normalized.requestHash));
      if (!replay) {
        throw new ConflictException('The idempotent policy decision result is unavailable');
      }
      const replayResult = { ...replay, idempotencyReplay: true };
      await this.auditReplay(replayResult);
      return replayResult;
    }

    try {
      const result = this.evaluateSnapshot(
        normalized.request,
        command.snapshot,
        profile,
        authorization,
        normalized.requestHash,
      );
      if (this.decisionStore.saveWithSnapshot) {
        await this.decisionStore.saveWithSnapshot(result, command.snapshot);
      } else {
        await this.decisionStore.save(result);
      }
      if (reservationContext.managed) {
        await this.idempotency.complete(reservation.reservationId, result);
      }
      await this.auditDecision(result, command.actorContext.principal);
      return result;
    } catch (error) {
      if (reservationContext.managed) {
        await this.idempotency.fail(reservation.reservationId, this.safeErrorMessage(error));
      }
      throw error;
    }
  }

  private async authorize(principal: AuthorizationPrincipal, request: PolicyDecisionRequest) {
    const policy = this.authorizationPolicy(principal);
    return this.authorizationService.authorize(principal, policy, {
      type: AUTHORIZATION_RESOURCE_TYPE,
      id: request.subject.customerId,
      customerId: request.subject.customerId,
    });
  }

  private authorizationPolicy(principal: AuthorizationPrincipal): AuthorizationPolicy {
    if (principal.type === 'CUSTOMER') {
      return {
        resourceType: AUTHORIZATION_RESOURCE_TYPE,
        action: AUTHORIZATION_READ_ACTION,
        allowedPrincipalTypes: ['CUSTOMER'],
        customerAccess: 'SELF',
      };
    }
    return {
      resourceType: AUTHORIZATION_RESOURCE_TYPE,
      action: AUTHORIZATION_EVALUATE_ACTION,
      requiredScopes: [AUTHORIZATION_EVALUATE_ACTION],
      allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
      customerAccess: 'ASSIGNED',
    };
  }

  private async reserveIdempotency(normalized: NormalizedRequest): Promise<ReservationContext> {
    const idempotencyContext = normalized.request.idempotencyContext;
    if (!idempotencyContext) {
      return {
        managed: false,
        reservation: {
          kind: 'NEW',
          reservationId: `read-through:${normalized.requestHash}`,
        },
      };
    }
    if (idempotencyContext.scope !== POLICY_IDEMPOTENCY_SCOPE) {
      throw new BadRequestException(`Idempotency scope must be ${POLICY_IDEMPOTENCY_SCOPE}`);
    }
    return {
      managed: true,
      reservation: await this.idempotency.reserve({
        scope: idempotencyContext.scope,
        key: idempotencyContext.key,
        requestHash: normalized.requestHash,
      }),
    };
  }

  private evaluateSnapshot(
    request: PolicyDecisionRequest,
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    authorization: { readonly evaluatedAt: Date; readonly allowed: boolean },
    requestHash: string,
  ): PolicyDecisionResult {
    const state: EvaluationState = {
      candidates: [],
      reasons: new Set<string>(),
      limits: [],
      obligations: this.profileObligations(profile),
      reviewDates: [],
    };

    this.addGenericEvidenceDegradation(profile, snapshot, request, state);
    this.evaluateCustomer(snapshot, profile, state);
    this.evaluateOnboarding(snapshot, profile, state);
    this.evaluateEligibility(snapshot, profile, state);
    this.evaluateRestrictions(snapshot, profile, state);
    this.evaluateRisk(snapshot, profile, state);
    this.evaluateCompliance(snapshot, profile, state);
    this.evaluateEnrollment(snapshot, profile, request, state);
    this.evaluatePermission(snapshot, profile, state);
    this.evaluateAccountBinding(snapshot, profile, request, state);

    const evaluatedAt = this.evaluationTime(snapshot, request);
    const limitEvaluation = this.evaluateLimits(snapshot, profile, request, evaluatedAt, state);
    if (limitEvaluation.status === PolicyLimitEvaluationStatus.WITHIN_LIMITS) {
      state.limits.push(...limitEvaluation.effectiveLimits);
      if (profile.limitRequirement.returnsLimits) {
        this.addCandidate(state, PolicyDecisionState.ALLOW_WITH_LIMITS, 'LIMITED_ALLOW');
      }
    }

    let selected = this.selectDecision(state.candidates, profile);
    if (selected === PolicyDecisionState.ALLOW_WITH_LIMITS && state.limits.length === 0) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'LIMIT_OBLIGATION_UNAVAILABLE');
      selected = this.selectDecision(state.candidates, profile);
    }
    const reasonCodes = this.sortReasonCodes(state.candidates);
    const sourceReferences = this.sourceReferences(snapshot);
    const freshnessSummary = this.freshnessSummary(snapshot);
    const authorizationContextReference = this.authorizationReference(
      request.actorContext.principal,
      authorization,
    );
    const decisionReference = calculatePolicyDecisionReference(
      requestHash,
      profile.policyVersion,
      snapshot.evidenceSummary.normalizedInputHash,
    );
    const reviewAt = this.reviewAt(state.reviewDates);
    const expiresAt = this.decisionExpiry(profile, evaluatedAt);
    const resultCore = {
      contractName: 'A4-CAPABILITY-POLICY' as const,
      contractVersion: 1 as const,
      subject: request.subject,
      capability: request.capability,
      action: request.action,
      profileReference: profile.profileReference,
      profileKey: profile.profileKey,
      profileVersion: profile.profileVersion,
      policyVersion: profile.policyVersion,
      definitionHash: profile.definitionHash,
      decision: selected,
      requestedAt: request.requestedAt,
      evaluatedAt,
      expiresAt,
      reviewAt,
      reasonCodes,
      explanation: {
        key: `POLICY_${selected}`,
        audience: 'INTERNAL' as const,
      },
      obligations: state.obligations,
      limits: state.limits,
      sourceReferences,
      evidenceContext: {
        snapshotReference: snapshot.snapshotReference,
        snapshotContractVersion: snapshot.contractVersion,
        normalizedInputHash: snapshot.evidenceSummary.normalizedInputHash,
        freshnessSummary,
        collectionStatus: snapshot.collection.status,
      },
      authorizationContextReference,
      requestHash,
      requestContext: request.requestContext,
    };
    const resultHash = calculatePolicyDecisionResultHash(resultCore);
    return {
      ...resultCore,
      decisionReference,
      resultHash,
      idempotencyReplay: false,
    };
  }

  private evaluateCustomer(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    const item = this.firstItem(snapshot, PolicySourceClass.CUSTOMER);
    if (!item) {
      this.addCandidate(state, PolicyDecisionState.DENY, 'IDENTITY_MISSING');
      return;
    }
    if (item.freshnessState === PolicyEvidenceFreshnessState.DELETED) {
      this.addCandidate(state, PolicyDecisionState.DENY, 'IDENTITY_DELETED');
      return;
    }
    if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'IDENTITY_EVIDENCE_DEGRADED');
      return;
    }
    const status = stringValue(item.normalizedValue.status);
    if (profile.productEligibility.customerLifecycle === 'NOT_REQUIRED') return;
    if (status === 'CLOSED') {
      this.addCandidate(state, PolicyDecisionState.DENY, 'CUSTOMER_CLOSED');
    } else if (status === 'SUSPENDED') {
      this.addCandidate(state, PolicyDecisionState.SUSPEND, 'CUSTOMER_SUSPENDED');
    } else if (status !== 'ACTIVE') {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'CUSTOMER_NOT_ACTIVE');
    }
  }

  private evaluateOnboarding(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    const requirement = profile.productEligibility.onboarding;
    if (requirement === 'NOT_REQUIRED') return;
    const item = this.firstItem(snapshot, PolicySourceClass.ONBOARDING);
    if (!item) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ONBOARDING_MISSING');
      return;
    }
    if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ONBOARDING_EVIDENCE_DEGRADED');
      return;
    }
    const status = stringValue(item.normalizedValue.status);
    if (status === 'REJECTED') {
      this.addCandidate(state, PolicyDecisionState.DENY, 'ONBOARDING_REJECTED');
    } else if (requirement === 'COMPLETED_REQUIRED' && status !== 'COMPLETED') {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ONBOARDING_NOT_COMPLETED');
    } else if (status.length === 0) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ONBOARDING_STATUS_MISSING');
    }
  }

  private evaluateEligibility(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    const requirement = profile.productEligibility.eligibility;
    if (requirement === 'NOT_REQUIRED') return;
    const item = this.firstItem(snapshot, PolicySourceClass.ELIGIBILITY);
    if (!item) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ELIGIBILITY_MISSING');
      return;
    }
    if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ELIGIBILITY_EVIDENCE_DEGRADED');
      return;
    }
    const status = stringValue(item.normalizedValue.status);
    if (status === 'INELIGIBLE' || status === 'REVOKED') {
      this.addCandidate(state, PolicyDecisionState.DENY, 'ELIGIBILITY_BLOCKED');
    } else if (status === 'SUSPENDED') {
      this.addCandidate(state, PolicyDecisionState.SUSPEND, 'ELIGIBILITY_SUSPENDED');
    } else if (status === 'PENDING' || status.length === 0) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ELIGIBILITY_PENDING');
    }
  }

  private evaluateRestrictions(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    if (profile.productEligibility.restrictions === 'NOT_REQUIRED') return;
    const items = this.items(snapshot, PolicySourceClass.RESTRICTIONS);
    if (items.length === 0) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RESTRICTION_EVIDENCE_MISSING');
      return;
    }
    for (const item of items) {
      if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) continue;
      if (!booleanValue(item.normalizedValue.active ?? item.normalizedValue.isActive)) continue;
      const type = stringValue(item.normalizedValue.type);
      if (type === 'BLACKLISTED') {
        this.addCandidate(state, PolicyDecisionState.DENY, 'RESTRICTION_BLACKLISTED');
      } else if (type === 'FROZEN') {
        this.addCandidate(state, PolicyDecisionState.SUSPEND, 'RESTRICTION_FROZEN');
      } else if (type === 'MANUAL_REVIEW') {
        this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RESTRICTION_MANUAL_REVIEW');
      } else if (type === 'LIMITED') {
        this.addCandidate(state, PolicyDecisionState.ALLOW_WITH_LIMITS, 'RESTRICTION_LIMITED');
      }
    }
  }

  private evaluateRisk(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    if (profile.riskRequirement.mode === PolicyRiskRequirement.NOT_REQUIRED) return;
    const items = this.items(snapshot, PolicySourceClass.RISK);
    const currentItems = items.filter(
      (item) => item.freshnessState === PolicyEvidenceFreshnessState.CURRENT,
    );
    if (currentItems.length === 0) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RISK_PROFILE_MISSING');
      return;
    }
    for (const item of currentItems) {
      const value = item.normalizedValue;
      const sourceKind = stringValue(value.sourceKind);
      const riskLevel = stringValue(value.riskLevel ?? value.overallRiskLevel);
      const reviewDueDate = stringValue(value.reviewDueDate);
      if (sourceKind === 'ONBOARDING_LEGACY' && riskLevel === 'PROHIBITED') {
        this.addCandidate(state, PolicyDecisionState.DENY, 'LEGACY_RISK_PROHIBITED');
      } else if (sourceKind === 'P1_10_MANUAL') {
        if (value.status !== undefined && stringValue(value.status) !== 'ACTIVE') {
          this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RISK_PROFILE_NOT_ACTIVE');
        }
        if (riskLevel === 'CRITICAL') {
          this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RISK_CRITICAL_REVIEW');
        } else if (
          riskLevel === 'HIGH' &&
          profile.riskRequirement.mode === PolicyRiskRequirement.PROFILE_CONTROLLED
        ) {
          this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RISK_HIGH_REVIEW');
        }
        if (reviewDueDate.length > 0) {
          const reviewDate = this.parseTimestamp(reviewDueDate);
          if (reviewDate !== null) {
            state.reviewDates.push(reviewDate);
            if (reviewDate <= this.evaluationTime(snapshot, undefined)) {
              this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RISK_REVIEW_DUE');
            }
          }
        }
        if (
          profile.riskRequirement.mode === PolicyRiskRequirement.CURRENT_REQUIRED &&
          (!Array.isArray(value.factorReferences) || value.factorReferences.length === 0)
        ) {
          this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RISK_FACTORS_MISSING');
        }
      }
    }
  }

  private evaluateCompliance(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    if (profile.complianceRequirement.mode === PolicyComplianceRequirement.NOT_REQUIRED) return;
    const items = this.items(snapshot, PolicySourceClass.COMPLIANCE);
    if (items.length === 0) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'COMPLIANCE_EVIDENCE_MISSING');
      return;
    }
    for (const item of items) {
      if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) continue;
      const value = item.normalizedValue;
      if (booleanValue(value.casePresent) === false) continue;
      const status = stringValue(value.status);
      const severity = stringValue(value.severity);
      if (
        ['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'PENDING_CUSTOMER'].includes(status) &&
        ['HIGH', 'CRITICAL'].includes(severity)
      ) {
        this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'COMPLIANCE_REVIEW_OPEN');
      } else if (
        profile.complianceRequirement.mode === PolicyComplianceRequirement.PROFILE_CONTROLLED &&
        ['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'PENDING_CUSTOMER'].includes(status)
      ) {
        this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'COMPLIANCE_CASE_OPEN');
      }
    }
  }

  private evaluateEnrollment(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    request: PolicyDecisionRequest,
    state: EvaluationState,
  ): void {
    const requirement = profile.enrollmentRequirement;
    if (
      requirement.mode === PolicyEnrollmentRequirement.NOT_REQUIRED ||
      requirement.mode === PolicyEnrollmentRequirement.ENROLLMENT_ACTION
    )
      return;
    const productKey = requirement.productKey ?? request.evaluationContext?.product;
    const items = this.items(snapshot, PolicySourceClass.ENROLLMENT).filter((item) => {
      const product = stringValue(item.normalizedValue.product);
      return productKey === undefined || product === productKey;
    });
    if (items.length === 0) {
      if (requirement.mode === PolicyEnrollmentRequirement.REQUIRED_ACTIVE) {
        this.addCandidate(state, PolicyDecisionState.DENY, 'ENROLLMENT_REQUIRED');
      } else {
        this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ENROLLMENT_MISSING');
      }
      return;
    }
    const item = items[0];
    if (!item) return;
    if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ENROLLMENT_EVIDENCE_DEGRADED');
      return;
    }
    const status = stringValue(item.normalizedValue.status);
    if (status === 'ACTIVE') return;
    if (status === 'SUSPENDED') {
      this.addCandidate(state, PolicyDecisionState.SUSPEND, 'ENROLLMENT_SUSPENDED');
    } else if (status === 'CLOSED') {
      this.addCandidate(state, PolicyDecisionState.DENY, 'ENROLLMENT_CLOSED');
    } else {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ENROLLMENT_PENDING');
    }
  }

  private evaluatePermission(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    state: EvaluationState,
  ): void {
    const requirement = profile.permissionRequirement;
    if (requirement.mode === PolicyPermissionRequirement.NOT_REQUIRED) return;
    const items = this.items(snapshot, PolicySourceClass.PERMISSIONS).filter((item) => {
      const type = stringValue(item.normalizedValue.type);
      return requirement.permissionType === undefined || type === requirement.permissionType;
    });
    if (items.length === 0) {
      if (requirement.mode === PolicyPermissionRequirement.REQUIRED_ENABLED) {
        this.addCandidate(state, PolicyDecisionState.DENY, 'PERMISSION_MISSING');
      } else {
        this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'PERMISSION_EVIDENCE_MISSING');
      }
      return;
    }
    const item = items[0];
    if (!item) return;
    if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'PERMISSION_EVIDENCE_DEGRADED');
      return;
    }
    if (!booleanValue(item.normalizedValue.enabled)) {
      this.addCandidate(state, PolicyDecisionState.DENY, 'PERMISSION_DISABLED');
    }
  }

  private evaluateAccountBinding(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    request: PolicyDecisionRequest,
    state: EvaluationState,
  ): void {
    const requirement = profile.accountBindingRequirement.mode;
    if (requirement === PolicyAccountBindingRequirement.NOT_REQUIRED) return;
    if (
      requirement === PolicyAccountBindingRequirement.REQUIRED_IF_CONTEXT &&
      request.evaluationContext?.targetBindingId === undefined
    ) {
      return;
    }
    const item = this.firstItem(snapshot, PolicySourceClass.ACCOUNT_BINDING);
    if (!item) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'BINDING_MISSING');
      return;
    }
    if (item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'BINDING_EVIDENCE_DEGRADED');
      return;
    }
    const value = item.normalizedValue;
    const stateValue = stringValue(value.state ?? value.bindingState);
    if (stateValue === 'CLOSED') {
      this.addCandidate(state, PolicyDecisionState.DENY, 'BINDING_CLOSED');
    } else if (stateValue === 'SUSPENDED') {
      this.addCandidate(state, PolicyDecisionState.SUSPEND, 'BINDING_SUSPENDED');
    } else if (stateValue === 'REPAIR_REQUIRED') {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'BINDING_REPAIR_REQUIRED');
    } else if (stateValue === 'PENDING') {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'BINDING_PENDING');
    } else if (stateValue !== 'ACTIVE') {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'BINDING_STATE_UNKNOWN');
    }
    if (value.dimensionsCompatible === false || value.ledgerIsActive === false) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'ACCOUNT_DIMENSION_CONFLICT');
    }
    if (value.reconciliationStatus === 'ERROR') {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'RECONCILIATION_ERROR');
    }
  }

  private evaluateLimits(
    snapshot: PolicyEvidenceSnapshot,
    profile: CapabilityPolicyProfile,
    request: PolicyDecisionRequest,
    evaluatedAt: string,
    state: EvaluationState,
  ): PolicyLimitEvaluation {
    const requirement = profile.limitRequirement;
    if (requirement.mode === PolicyLimitRequirement.NOT_APPLICABLE) {
      return {
        status: PolicyLimitEvaluationStatus.NOT_APPLICABLE,
        capability: profile.capability,
        action: request.action,
        profileVersion: profile.profileVersion,
        currency: null,
        checks: [],
        effectiveLimits: [],
        usageAsOf: null,
        evaluatedAt,
        limitReference: null,
      };
    }
    const item = this.firstItem(snapshot, PolicySourceClass.LIMITS);
    if (!item || item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'LIMIT_EVIDENCE_DEGRADED');
      return {
        status: PolicyLimitEvaluationStatus.UNAVAILABLE,
        capability: profile.capability,
        action: request.action,
        profileVersion: profile.profileVersion,
        currency: null,
        checks: [],
        effectiveLimits: [],
        usageAsOf: null,
        evaluatedAt,
        limitReference: null,
      };
    }
    const configured = item.normalizedValue;
    const usage = request.evaluationContext?.limitUsage;
    const configuredCurrency = stringValue(configured.currency) || null;
    const requestedCurrency =
      request.evaluationContext?.currency ?? usage?.currency ?? configuredCurrency;
    if (
      configuredCurrency !== null &&
      requestedCurrency !== undefined &&
      requestedCurrency !== null &&
      configuredCurrency !== requestedCurrency.trim().toUpperCase()
    ) {
      this.addCandidate(state, PolicyDecisionState.DENY, 'LIMIT_CURRENCY_MISMATCH');
      return {
        status: PolicyLimitEvaluationStatus.INCOMPATIBLE,
        capability: profile.capability,
        action: request.action,
        profileVersion: profile.profileVersion,
        currency: configuredCurrency,
        checks: [],
        effectiveLimits: [],
        usageAsOf: usage?.usageAsOf ?? null,
        evaluatedAt,
        limitReference: null,
      };
    }
    const checks: PolicyLimitCheck[] = [];
    const effectiveLimits: PolicyLimitOutput[] = [];
    let hasConfiguredDimension = false;
    let hasExceeded = false;
    let unavailable = false;
    for (const dimension of profile.limitRequirement.dimensions) {
      const check = this.evaluateLimitDimension(dimension, configured, usage, configuredCurrency);
      if (check === null) continue;
      checks.push(check.check);
      if (check.output) effectiveLimits.push(check.output);
      hasConfiguredDimension ||= check.configured;
      hasExceeded ||= check.exceeded;
      unavailable ||= check.unavailable;
      if (check.reasonCode) this.addCandidate(state, check.decision, check.reasonCode);
    }
    if (!hasConfiguredDimension && requirement.mode !== PolicyLimitRequirement.USAGE_REQUIRED) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'LIMIT_CONFIGURATION_MISSING');
      return {
        status: PolicyLimitEvaluationStatus.UNAVAILABLE,
        capability: profile.capability,
        action: request.action,
        profileVersion: profile.profileVersion,
        currency: configuredCurrency,
        checks,
        effectiveLimits,
        usageAsOf: usage?.usageAsOf ?? null,
        evaluatedAt,
        limitReference: null,
      };
    }
    if (hasExceeded) {
      return {
        status: PolicyLimitEvaluationStatus.EXCEEDED,
        capability: profile.capability,
        action: request.action,
        profileVersion: profile.profileVersion,
        currency: configuredCurrency,
        checks,
        effectiveLimits,
        usageAsOf: usage?.usageAsOf ?? null,
        evaluatedAt,
        limitReference: null,
      };
    }
    if (unavailable) {
      this.addCandidate(state, PolicyDecisionState.PENDING_REVIEW, 'LIMIT_USAGE_UNAVAILABLE');
      return {
        status: PolicyLimitEvaluationStatus.UNAVAILABLE,
        capability: profile.capability,
        action: request.action,
        profileVersion: profile.profileVersion,
        currency: configuredCurrency,
        checks,
        effectiveLimits,
        usageAsOf: usage?.usageAsOf ?? null,
        evaluatedAt,
        limitReference: null,
      };
    }
    return {
      status: PolicyLimitEvaluationStatus.WITHIN_LIMITS,
      capability: profile.capability,
      action: request.action,
      profileVersion: profile.profileVersion,
      currency: configuredCurrency,
      checks,
      effectiveLimits,
      usageAsOf: usage?.usageAsOf ?? null,
      evaluatedAt,
      limitReference: null,
    };
  }

  private evaluateLimitDimension(
    dimension: PolicyLimitDimension,
    configured: Readonly<Record<string, unknown>>,
    usage: PolicyEvaluationContext['limitUsage'],
    currency: string | null,
  ): {
    check: PolicyLimitCheck;
    output: PolicyLimitOutput | null;
    configured: boolean;
    exceeded: boolean;
    unavailable: boolean;
    decision: PolicyDecisionState;
    reasonCode?: string;
  } | null {
    const configuredKey = this.configuredLimitKey(dimension);
    const rawConfigured = configured[configuredKey];
    if (rawConfigured === undefined || rawConfigured === null) return null;
    const configuredNumber = parseNonNegativeInteger(rawConfigured);
    if (configuredNumber === null) {
      return this.invalidLimitCheck(dimension, currency);
    }
    const outputBase: PolicyLimitOutput = {
      type: dimension,
      ...(currency ? { currency } : {}),
      ...(this.isAmountDimension(dimension)
        ? { amountMinor: configuredNumber.toString() }
        : { count: Number(configuredNumber) }),
    };
    const usageValue = this.usageValue(dimension, usage);
    if (usageValue === null && this.requiresUsage(dimension)) {
      return {
        check: {
          dimension,
          configuredValue: this.outputValue(configuredNumber, dimension),
          observedValue: null,
          proposedValue: null,
          remainingValue: null,
          passed: false,
          reasonCode: 'LIMIT_USAGE_UNAVAILABLE',
        },
        output: outputBase,
        configured: true,
        exceeded: false,
        unavailable: true,
        decision: PolicyDecisionState.PENDING_REVIEW,
        reasonCode: 'LIMIT_USAGE_UNAVAILABLE',
      };
    }
    const proposed = this.proposedValue(dimension, usage);
    if (proposed === null) {
      return {
        check: {
          dimension,
          configuredValue: this.outputValue(configuredNumber, dimension),
          observedValue: this.outputValue(usageValue, dimension),
          proposedValue: null,
          remainingValue: null,
          passed: false,
          reasonCode: 'LIMIT_AMOUNT_MISSING',
        },
        output: outputBase,
        configured: true,
        exceeded: false,
        unavailable: true,
        decision: PolicyDecisionState.PENDING_REVIEW,
        reasonCode: 'LIMIT_AMOUNT_MISSING',
      };
    }
    const passed = proposed <= configuredNumber;
    const remaining = passed ? configuredNumber - proposed : 0n;
    const output: PolicyLimitOutput = {
      ...outputBase,
      ...(this.isAmountDimension(dimension)
        ? { remainingMinor: remaining.toString() }
        : { remainingCount: Number(remaining) }),
    };
    return {
      check: {
        dimension,
        configuredValue: this.outputValue(configuredNumber, dimension),
        observedValue: this.outputValue(usageValue, dimension),
        proposedValue: this.outputValue(proposed, dimension),
        remainingValue: this.outputValue(remaining, dimension),
        passed,
        ...(passed ? {} : { reasonCode: 'LIMIT_EXCEEDED' }),
      },
      output,
      configured: true,
      exceeded: !passed,
      unavailable: false,
      decision: passed ? PolicyDecisionState.ALLOW_WITH_LIMITS : PolicyDecisionState.DENY,
      ...(passed ? {} : { reasonCode: 'LIMIT_EXCEEDED' }),
    };
  }

  private invalidLimitCheck(
    dimension: PolicyLimitDimension,
    currency: string | null,
  ): {
    check: PolicyLimitCheck;
    output: null;
    configured: boolean;
    exceeded: boolean;
    unavailable: boolean;
    decision: PolicyDecisionState;
    reasonCode: string;
  } {
    return {
      check: {
        dimension,
        configuredValue: null,
        observedValue: null,
        proposedValue: null,
        remainingValue: null,
        passed: false,
        reasonCode: 'LIMIT_CONFIGURATION_INVALID',
      },
      output: null,
      configured: true,
      exceeded: false,
      unavailable: true,
      decision: PolicyDecisionState.PENDING_REVIEW,
      reasonCode: `LIMIT_CONFIGURATION_INVALID${currency ? `_${currency}` : ''}`,
    };
  }

  private addGenericEvidenceDegradation(
    profile: CapabilityPolicyProfile,
    snapshot: PolicyEvidenceSnapshot,
    request: PolicyDecisionRequest,
    state: EvaluationState,
  ): void {
    if (snapshot.collection.status === PolicyCollectionStatus.UNAVAILABLE) {
      this.addCandidate(
        state,
        PolicyDecisionState.PENDING_REVIEW,
        'EVIDENCE_COLLECTION_UNAVAILABLE',
      );
    } else if (snapshot.collection.status === PolicyCollectionStatus.INCOMPLETE) {
      this.addCandidate(
        state,
        PolicyDecisionState.PENDING_REVIEW,
        'EVIDENCE_COLLECTION_INCOMPLETE',
      );
    }
    for (const sourceClass of Object.values(PolicySourceClass)) {
      if (sourceClass === PolicySourceClass.AUTHORIZATION) continue;
      const requirement = profile.evidenceRequirements[sourceClass];
      if (!this.isRequiredForRequest(requirement, request)) continue;
      const items = this.items(snapshot, sourceClass);
      if (items.length === 0) {
        this.addCandidate(
          state,
          PolicyDecisionState.PENDING_REVIEW,
          `SOURCE_${sourceClass}_MISSING`,
        );
        continue;
      }
      if (items.some((item) => item.freshnessState !== PolicyEvidenceFreshnessState.CURRENT)) {
        this.addCandidate(
          state,
          PolicyDecisionState.PENDING_REVIEW,
          `SOURCE_${sourceClass}_DEGRADED`,
        );
      }
    }
  }

  private isRequiredForRequest(
    requirement: PolicyRequirementMode,
    request: PolicyDecisionRequest,
  ): boolean {
    if (
      requirement === PolicyRequirementMode.NOT_USED ||
      requirement === PolicyRequirementMode.OPTIONAL_REFERENCE
    ) {
      return false;
    }
    if (requirement !== PolicyRequirementMode.REQUIRED_IF_CONTEXT) return true;
    return Boolean(
      request.evaluationContext?.targetBindingId ??
        request.evaluationContext?.product ??
        request.evaluationContext?.channel ??
        request.evaluationContext?.currency,
    );
  }

  private selectDecision(
    candidates: readonly CandidateOutcome[],
    profile: CapabilityPolicyProfile,
  ): PolicyDecisionState {
    const selected =
      candidates.length === 0
        ? PolicyDecisionState.ALLOW
        : candidates.reduce(
            (current, candidate) =>
              OUTCOME_PRIORITY[candidate.decision] > OUTCOME_PRIORITY[current]
                ? candidate.decision
                : current,
            candidates[0]?.decision ?? PolicyDecisionState.ALLOW,
          );
    if (profile.allowedDecisions.includes(selected)) return selected;
    return PolicyDecisionState.PENDING_REVIEW;
  }

  private addCandidate(state: EvaluationState, decision: PolicyDecisionState, code: string): void {
    state.reasons.add(code);
    if (!state.candidates.some((candidate) => candidate.code === code)) {
      state.candidates.push({ decision, code });
    }
  }

  private profileObligations(profile: CapabilityPolicyProfile): PolicyObligation[] {
    return profile.obligations.map((obligation) => ({
      code: obligation.code,
      required: obligation.required,
      ...(obligation.reference ? { reference: obligation.reference } : {}),
    }));
  }

  private sortReasonCodes(candidates: readonly CandidateOutcome[]): string[] {
    return [...candidates]
      .sort((left, right) => {
        const priority = OUTCOME_PRIORITY[right.decision] - OUTCOME_PRIORITY[left.decision];
        return priority || left.code.localeCompare(right.code);
      })
      .map((candidate) => candidate.code);
  }

  private sourceReferences(snapshot: PolicyEvidenceSnapshot): PolicyEvidenceSourceReference[] {
    return [...snapshot.sourceItems]
      .sort((left, right) => this.sourceItemKey(left).localeCompare(this.sourceItemKey(right)))
      .map((item) => ({
        sourceClass: item.sourceClass,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        customerId: item.customerId,
        sourceVersion: item.sourceVersion ?? null,
        observedAt: item.observedAt,
        freshnessState: item.freshnessState,
        classification: item.classification,
        reference: item.sourceReference ?? null,
      }));
  }

  private freshnessSummary(snapshot: PolicyEvidenceSnapshot): PolicyEvidenceFreshnessState[] {
    const states = new Set(snapshot.sourceItems.map((item) => item.freshnessState));
    for (const state of snapshot.evidenceSummary.freshnessStates) states.add(state);
    return FRESHNESS_ORDER.filter((state) => states.has(state));
  }

  private authorizationReference(
    principal: AuthorizationPrincipal,
    authorization: { readonly evaluatedAt: Date; readonly allowed: boolean },
  ): string {
    return `a2-auth-${hashCanonical({
      principalType: principal.type,
      customerId: principal.customerId ?? null,
      audience: principal.audience ?? null,
      assuranceLevel: principal.assuranceLevel ?? null,
      allowed: authorization.allowed,
      evaluatedAt: authorization.evaluatedAt.toISOString(),
    })}`;
  }

  private decisionExpiry(profile: CapabilityPolicyProfile, evaluatedAt: string): string | null {
    const seconds = profile.decisionValidity?.expiresInSeconds;
    if (seconds === undefined) return null;
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      throw new ConflictException('The A4 policy decision validity interval is invalid');
    }
    const evaluatedMillis = Date.parse(evaluatedAt);
    const expiresMillis = evaluatedMillis + seconds * 1000;
    if (!Number.isSafeInteger(expiresMillis)) {
      throw new ConflictException('The A4 policy decision expiry is invalid');
    }
    return new Date(expiresMillis).toISOString();
  }

  private reviewAt(reviewDates: readonly string[]): string | null {
    return [...reviewDates].sort()[0] ?? null;
  }

  private parseTimestamp(value: string): string | null {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private evaluationTime(
    snapshot: PolicyEvidenceSnapshot,
    request?: PolicyDecisionRequest,
  ): string {
    const collected = this.parseTimestamp(snapshot.collection.collectedAt);
    if (collected) return collected;
    if (request) return request.requestedAt;
    return new Date(0).toISOString();
  }

  private items(
    snapshot: PolicyEvidenceSnapshot,
    sourceClass: PolicySourceClass,
  ): PolicyEvidenceItem[] {
    return snapshot.sourceItems.filter((item) => item.sourceClass === sourceClass);
  }

  private firstItem(
    snapshot: PolicyEvidenceSnapshot,
    sourceClass: PolicySourceClass,
  ): PolicyEvidenceItem | null {
    return this.items(snapshot, sourceClass)[0] ?? null;
  }

  private assertProfile(profile: CapabilityPolicyProfile, request: PolicyDecisionRequest): void {
    const { definitionHash, ...definition } = profile;
    delete definition.effectiveFrom;
    delete definition.effectiveTo;
    delete definition.lifecycleState;
    if (
      profile.subjectType !== 'CUSTOMER' ||
      profile.contractName !== request.contractName ||
      profile.contractVersion !== request.contractVersion ||
      profile.capability !== request.capability ||
      !profile.actions.includes(request.action) ||
      !HASH_PATTERN.test(definitionHash) ||
      calculatePolicyProfileDefinitionHash(definition) !== definitionHash
    ) {
      throw new ConflictException('The A4 policy profile is invalid for this request');
    }
  }

  private assertSnapshot(snapshot: PolicyEvidenceSnapshot, request: PolicyDecisionRequest): void {
    if (
      snapshot.contractName !== 'A4-EVIDENCE-SNAPSHOT' ||
      snapshot.contractVersion !== 1 ||
      snapshot.subject.type !== 'CUSTOMER' ||
      normalizeUuid(snapshot.subject.customerId) !== request.subject.customerId ||
      snapshot.policyRequestScope.capability !== request.capability ||
      snapshot.policyRequestScope.action !== request.action ||
      snapshot.policyRequestScope.evidenceProfile !==
        request.sourceEvidenceRequest.evidenceProfile ||
      (snapshot.policyRequestScope.policyVersionHint ?? null) !==
        (request.policyVersionHint ?? null) ||
      normalizeTimestamp(snapshot.policyRequestScope.requestedAt) !== request.requestedAt ||
      normalizeTimestamp(snapshot.policyRequestScope.asOf) !== request.sourceEvidenceRequest.asOf ||
      !HASH_PATTERN.test(snapshot.evidenceSummary.normalizedInputHash)
    ) {
      throw new ConflictException(
        'The immutable evidence snapshot does not match the policy request',
      );
    }
    const calculatedHash = calculateSnapshotInputHash(snapshot);
    if (calculatedHash !== snapshot.evidenceSummary.normalizedInputHash) {
      throw new ConflictException('The evidence snapshot hash is invalid');
    }
  }

  private normalizeRequest(command: PolicyEvaluationCommand): NormalizedRequest {
    const request = command;
    if (request.contractName !== 'A4-CAPABILITY-POLICY' || request.contractVersion !== 1) {
      throw new BadRequestException('Unsupported A4 policy contract version');
    }
    const customerId = normalizeUuid(request.subject.customerId);
    if (request.subject.type !== 'CUSTOMER') {
      throw new BadRequestException('A4 policy subject must be CUSTOMER');
    }
    const capability = normalizePolicyKey(request.capability, 'capability');
    const action = normalizePolicyKey(request.action, 'action');
    const requestedAt = normalizeTimestamp(request.requestedAt);
    const asOf = normalizeTimestamp(request.sourceEvidenceRequest.asOf);
    if (request.sourceEvidenceRequest.evidenceProfile.trim().length === 0) {
      throw new BadRequestException('A4 evidence profile is required');
    }
    if (request.requestContext.requestId.trim().length === 0) {
      throw new BadRequestException('A4 requestId is required');
    }
    if (request.requestContext.correlationId.trim().length === 0) {
      throw new BadRequestException('A4 correlationId is required');
    }
    const normalizedRequest: PolicyDecisionRequest = {
      ...request,
      subject: { type: 'CUSTOMER', customerId },
      capability,
      action,
      requestedAt,
      sourceEvidenceRequest: {
        ...request.sourceEvidenceRequest,
        asOf,
        requiredSourceClasses: [...new Set(request.sourceEvidenceRequest.requiredSourceClasses)],
      },
      requestContext: {
        ...request.requestContext,
        requestId: request.requestContext.requestId.trim(),
        correlationId: request.requestContext.correlationId.trim(),
      },
    };
    const requestHash = calculatePolicyRequestHash(normalizedRequest);
    return { request: normalizedRequest, requestHash };
  }

  private safeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 255) : 'A4 policy evaluation failed';
  }

  private async auditDecision(
    result: PolicyDecisionResult,
    principal: AuthorizationPrincipal,
  ): Promise<void> {
    await this.audit.record({
      action: 'DECISION_CREATED',
      decisionReference: result.decisionReference,
      customerId: result.subject.customerId,
      capability: result.capability,
      policyVersion: result.policyVersion,
      decision: result.decision,
      requestHash: result.requestHash,
      normalizedInputHash: result.evidenceContext.normalizedInputHash,
      correlationId: result.requestContext.correlationId,
      requestId: result.requestContext.requestId,
      actor: principal.principalId,
      metadata: {
        profileReference: result.profileReference,
        profileVersion: result.profileVersion,
        definitionHash: result.definitionHash,
        reasonCodes: result.reasonCodes,
        idempotencyReplay: result.idempotencyReplay,
      },
    });
  }

  private async auditReplay(result: PolicyDecisionResult): Promise<void> {
    await this.audit.record({
      action: 'DECISION_REPLAYED',
      decisionReference: result.decisionReference,
      customerId: result.subject.customerId,
      capability: result.capability,
      policyVersion: result.policyVersion,
      decision: result.decision,
      requestHash: result.requestHash,
      normalizedInputHash: result.evidenceContext.normalizedInputHash,
      correlationId: result.requestContext.correlationId,
      requestId: result.requestContext.requestId,
      actor: 'policy-replay',
      metadata: { idempotencyReplay: true },
    });
  }

  private configuredLimitKey(dimension: PolicyLimitDimension): string {
    switch (dimension) {
      case PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT:
        return 'singleTransactionAmountMinor';
      case PolicyLimitDimension.DAILY_TRANSACTION_COUNT:
        return 'dailyTransactionCount';
      case PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT:
        return 'dailyTransactionAmountMinor';
      case PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT:
        return 'monthlyTransactionAmountMinor';
      case PolicyLimitDimension.WALLET_BALANCE:
        return 'walletBalanceMinor';
    }
  }

  private usageValue(
    dimension: PolicyLimitDimension,
    usage: PolicyEvaluationContext['limitUsage'],
  ): bigint | null {
    if (!usage) return null;
    switch (dimension) {
      case PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT:
        return null;
      case PolicyLimitDimension.DAILY_TRANSACTION_COUNT:
        return usage.dailyUsedCount === undefined ? null : BigInt(usage.dailyUsedCount);
      case PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT:
        return parseNonNegativeInteger(usage.dailyUsedAmountMinor);
      case PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT:
        return parseNonNegativeInteger(usage.monthlyUsedAmountMinor);
      case PolicyLimitDimension.WALLET_BALANCE:
        return parseNonNegativeInteger(usage.projectedWalletBalanceMinor);
    }
  }

  private proposedValue(
    dimension: PolicyLimitDimension,
    usage: PolicyEvaluationContext['limitUsage'],
  ): bigint | null {
    if (!usage) return null;
    switch (dimension) {
      case PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT:
        return parsePositiveInteger(usage.amountMinor);
      case PolicyLimitDimension.DAILY_TRANSACTION_COUNT:
        return usage.dailyUsedCount === undefined ? null : BigInt(usage.dailyUsedCount + 1);
      case PolicyLimitDimension.DAILY_TRANSACTION_AMOUNT:
        return this.addAmount(usage.dailyUsedAmountMinor, usage.amountMinor);
      case PolicyLimitDimension.MONTHLY_TRANSACTION_AMOUNT:
        return this.addAmount(usage.monthlyUsedAmountMinor, usage.amountMinor);
      case PolicyLimitDimension.WALLET_BALANCE:
        return parseNonNegativeInteger(usage.projectedWalletBalanceMinor);
    }
  }

  private addAmount(
    base: string | null | undefined,
    amount: string | null | undefined,
  ): bigint | null {
    const baseValue = parseNonNegativeInteger(base);
    const amountValue = parseNonNegativeInteger(amount);
    if (baseValue === null || amountValue === null) return null;
    return baseValue + amountValue;
  }

  private outputValue(
    value: bigint | null,
    dimension: PolicyLimitDimension,
  ): string | number | null {
    if (value === null) return null;
    return this.isAmountDimension(dimension) ? value.toString() : Number(value);
  }

  private isAmountDimension(dimension: PolicyLimitDimension): boolean {
    return dimension !== PolicyLimitDimension.DAILY_TRANSACTION_COUNT;
  }

  private requiresUsage(dimension: PolicyLimitDimension): boolean {
    return dimension !== PolicyLimitDimension.SINGLE_TRANSACTION_AMOUNT;
  }

  private sourceItemKey(item: PolicyEvidenceItem): string {
    return [
      item.sourceClass,
      item.sourceType,
      item.sourceId ?? '',
      String(item.sourceVersion ?? ''),
    ].join('|');
  }
}

export function calculatePolicyRequestHash(request: PolicyDecisionRequest): string {
  return hashCanonical({
    contractName: request.contractName,
    contractVersion: request.contractVersion,
    subject: request.subject,
    capability: request.capability,
    action: request.action,
    requestedAt: request.requestedAt,
    evaluationContext: request.evaluationContext ?? null,
    sourceEvidenceRequest: request.sourceEvidenceRequest,
    policyVersionHint: request.policyVersionHint ?? null,
    actorContext: {
      principalType: request.actorContext.principal.type,
      customerId: request.actorContext.principal.customerId ?? null,
      audience: request.actorContext.principal.audience ?? null,
      assuranceLevel: request.actorContext.principal.assuranceLevel ?? null,
    },
  });
}

export function calculatePolicyDecisionReference(
  requestHash: string,
  policyVersion: string,
  normalizedInputHash: string,
  lineageReference?: string,
): string {
  const base = { requestHash, policyVersion, normalizedInputHash };
  return `a4-decision-${hashCanonical(lineageReference ? { ...base, lineageReference } : base)}`;
}

type PolicyDecisionResultHashInput = Pick<
  PolicyDecisionResult,
  | 'contractName'
  | 'contractVersion'
  | 'subject'
  | 'capability'
  | 'action'
  | 'profileReference'
  | 'profileKey'
  | 'profileVersion'
  | 'policyVersion'
  | 'definitionHash'
  | 'decision'
  | 'requestedAt'
  | 'evaluatedAt'
  | 'expiresAt'
  | 'reviewAt'
  | 'reasonCodes'
  | 'explanation'
  | 'obligations'
  | 'limits'
  | 'sourceReferences'
  | 'evidenceContext'
> & {
  readonly supersedesDecisionReference?: string;
};

export function calculatePolicyDecisionResultHash(result: PolicyDecisionResultHashInput): string {
  return hashCanonical({
    contractName: result.contractName,
    contractVersion: result.contractVersion,
    subject: result.subject,
    capability: result.capability,
    action: result.action,
    profileReference: result.profileReference,
    profileKey: result.profileKey,
    profileVersion: result.profileVersion,
    policyVersion: result.policyVersion,
    definitionHash: result.definitionHash,
    decision: result.decision,
    ...(result.supersedesDecisionReference
      ? { supersedesDecisionReference: result.supersedesDecisionReference }
      : {}),
    requestedAt: result.requestedAt,
    evaluatedAt: result.evaluatedAt,
    expiresAt: result.expiresAt,
    reviewAt: result.reviewAt,
    reasonCodes: result.reasonCodes,
    explanation: result.explanation,
    obligations: result.obligations,
    limits: result.limits,
    sourceReferences: result.sourceReferences,
    evidenceContext: result.evidenceContext,
  });
}

export function calculateSnapshotInputHash(snapshot: PolicyEvidenceSnapshot): string {
  const sourceItems = [...snapshot.sourceItems]
    .sort((left, right) => {
      const leftKey = [
        left.sourceClass,
        left.sourceType,
        left.sourceId ?? '',
        String(left.sourceVersion ?? ''),
      ].join('|');
      const rightKey = [
        right.sourceClass,
        right.sourceType,
        right.sourceId ?? '',
        String(right.sourceVersion ?? ''),
      ].join('|');
      return leftKey.localeCompare(rightKey);
    })
    .map((item) => ({
      sourceClass: item.sourceClass,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      customerId: item.customerId,
      sourceVersion: item.sourceVersion ?? null,
      sourceUpdatedAt: item.sourceUpdatedAt ?? null,
      deleted: item.deleted,
      freshnessState: item.freshnessState,
      freshnessReasonCode: item.freshnessReasonCode ?? null,
      classification: item.classification,
      normalizedValue: item.normalizedValue,
      sourceReference: item.sourceReference ?? null,
    }));
  return hashCanonical({
    contractName: snapshot.contractName,
    contractVersion: snapshot.contractVersion,
    subject: snapshot.subject,
    policyRequestScope: snapshot.policyRequestScope,
    collection: {
      status: snapshot.collection.status,
      requiredSourceClasses: [...snapshot.collection.requiredSourceClasses].sort(),
      collectedSourceClasses: [...snapshot.collection.collectedSourceClasses].sort(),
      missingSourceClasses: [...snapshot.collection.missingSourceClasses].sort(),
      unavailableSourceClasses: [...snapshot.collection.unavailableSourceClasses].sort(),
      restrictedSourceClasses: [...snapshot.collection.restrictedSourceClasses].sort(),
      conflictSourceClasses: [...snapshot.collection.conflictSourceClasses].sort(),
    },
    sourceItems,
    integrity: snapshot.integrity,
  });
}

function normalizeUuid(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new BadRequestException('Customer ID must be a UUID');
  return normalized;
}

function normalizePolicyKey(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!POLICY_KEY_PATTERN.test(normalized)) {
    throw new BadRequestException(`${field} is not a canonical A4 policy key`);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new BadRequestException('A4 policy timestamp is invalid');
  return parsed.toISOString();
}

function parseNonNegativeInteger(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  try {
    return BigInt(value.trim());
  } catch {
    return null;
  }
}

function parsePositiveInteger(value: unknown): bigint | null {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0n ? parsed : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}
