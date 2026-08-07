import { BadRequestException, Injectable } from '@nestjs/common';

import { PolicyDecisionState } from './capability-policy.enums';
import type {
  PolicyDecisionResult,
  PolicyEvidenceSourceReference,
  PolicyObligation,
  PolicyLimitOutput,
} from './capability-policy.types';
import {
  PolicyExplanationAudience,
  PolicyExplanationReasonSeverity,
} from './capability-policy-explanation.enums';
import type {
  PolicyExplanationAudiencePolicy,
  PolicyExplanationLimit,
  PolicyExplanationObligation,
  PolicyExplanationReason,
  PolicyExplanationRequest,
  PolicyExplanationResult,
  PolicyExplanationSourceReference,
} from './capability-policy-explanation.types';

const REASON_CATEGORY_ORDER = [
  'IDENTITY',
  'CUSTOMER',
  'ONBOARDING',
  'ELIGIBILITY',
  'RESTRICTION',
  'LEGACY_RISK',
  'RISK',
  'COMPLIANCE',
  'ENROLLMENT',
  'PERMISSION',
  'BINDING',
  'ACCOUNT',
  'RECONCILIATION',
  'LIMIT',
  'EVIDENCE',
  'CAPABILITY',
];

const SENSITIVE_REASON_PREFIXES = ['RISK_', 'LEGACY_RISK', 'COMPLIANCE_'];
const SENSITIVE_SOURCE_CLASSES = new Set(['RISK', 'COMPLIANCE', 'AUTHORIZATION']);

@Injectable()
export class CapabilityPolicyExplanationService {
  explain(request: PolicyExplanationRequest): PolicyExplanationResult {
    this.assertDecision(request.decision);
    const decision = request.decision;
    const policy = this.audiencePolicy(request.audience);
    const orderedInternalCodes = this.orderReasonCodes(decision.reasonCodes);
    const reasons = this.explanationReasons(
      orderedInternalCodes,
      request.audience,
      decision.decision,
    );
    const obligations = this.explanationObligations(decision.obligations, request.audience);
    const limits = this.explanationLimits(decision.limits, request.audience);

    return {
      contractName: 'A4-CAPABILITY-EXPLANATION',
      contractVersion: 1,
      audience: request.audience,
      readOnly: true,
      customerId: decision.subject.customerId,
      capability: decision.capability,
      action: decision.action,
      decision: decision.decision,
      policyVersion: decision.policyVersion,
      evaluatedAt: decision.evaluatedAt,
      expiresAt: decision.expiresAt,
      reviewAt: decision.reviewAt,
      reasons,
      obligations,
      limits,
      provenance: {
        ...(policy.includeDecisionReferences
          ? {
              decisionReference: decision.decisionReference,
              profileReference: decision.profileReference,
              profileVersion: decision.profileVersion,
              definitionHash: decision.definitionHash,
              snapshotReference: decision.evidenceContext.snapshotReference,
              snapshotContractVersion: decision.evidenceContext.snapshotContractVersion,
              normalizedInputHash: decision.evidenceContext.normalizedInputHash,
              resultHash: decision.resultHash,
            }
          : {}),
        ...(policy.includeSourceReferences
          ? {
              sourceReferences: this.sourceReferences(decision.sourceReferences, request.audience),
            }
          : { sourceReferences: [] }),
        ...(policy.includeDecisionReferences
          ? {
              authorizationContextReference: decision.authorizationContextReference,
            }
          : {}),
        ...(policy.includeRequestContext ? { requestContext: decision.requestContext } : {}),
        ...(request.audience === PolicyExplanationAudience.OPERATIONS ||
        request.audience === PolicyExplanationAudience.INTERNAL_SERVICES
          ? {
              collectionStatus: decision.evidenceContext.collectionStatus,
              freshnessSummary: decision.evidenceContext.freshnessSummary,
            }
          : {}),
      },
    };
  }

  private audiencePolicy(audience: PolicyExplanationAudience): PolicyExplanationAudiencePolicy {
    switch (audience) {
      case PolicyExplanationAudience.CUSTOMER:
        return {
          includeInternalReasonCodes: false,
          includeSourceReferences: false,
          includeDecisionReferences: false,
          includeLimitReferences: false,
          includeRequestContext: false,
        };
      case PolicyExplanationAudience.CUSTOMER_SUPPORT:
        return {
          includeInternalReasonCodes: false,
          includeSourceReferences: true,
          includeDecisionReferences: true,
          includeLimitReferences: false,
          includeRequestContext: true,
        };
      case PolicyExplanationAudience.OPERATIONS:
      case PolicyExplanationAudience.INTERNAL_SERVICES:
        return {
          includeInternalReasonCodes: true,
          includeSourceReferences: true,
          includeDecisionReferences: true,
          includeLimitReferences: true,
          includeRequestContext: true,
        };
    }
  }

  private explanationReasons(
    internalCodes: readonly string[],
    audience: PolicyExplanationAudience,
    decision: PolicyDecisionState,
  ): PolicyExplanationReason[] {
    const codes = internalCodes.length > 0 ? internalCodes : [this.defaultReason(decision)];
    const mapped = codes.map((code) => this.mapReason(code, audience, decision));
    const unique = new Map<string, PolicyExplanationReason>();
    for (const reason of mapped) {
      if (!unique.has(reason.code)) unique.set(reason.code, reason);
    }
    return [...unique.values()].sort((left, right) => {
      const categoryOrder =
        this.reasonCategoryRank(left.code) - this.reasonCategoryRank(right.code);
      return categoryOrder || left.code.localeCompare(right.code);
    });
  }

  private mapReason(
    code: string,
    audience: PolicyExplanationAudience,
    decision: PolicyDecisionState,
  ): PolicyExplanationReason {
    if (
      audience === PolicyExplanationAudience.OPERATIONS ||
      audience === PolicyExplanationAudience.INTERNAL_SERVICES
    ) {
      return {
        code,
        messageKey: `policy.reason.${code.toLowerCase()}`,
        severity: this.severityForDecision(decision),
      };
    }

    const safeCode = this.safeReasonCode(code, audience, decision);
    return {
      code: safeCode,
      messageKey: `policy.explanation.${safeCode.toLowerCase()}`,
      severity: this.severityForDecision(decision),
    };
  }

  private safeReasonCode(
    code: string,
    audience: PolicyExplanationAudience,
    decision: PolicyDecisionState,
  ): string {
    if (audience === PolicyExplanationAudience.CUSTOMER) {
      if (code === 'LIMITED_ALLOW' || code === 'RESTRICTION_LIMITED') {
        return 'CAPABILITY_LIMITED';
      }
      if (code === 'LIMIT_EXCEEDED') return 'LIMIT_EXCEEDED';
      if (code.startsWith('ONBOARDING_')) return 'ONBOARDING_REQUIREMENT';
      if (code === 'ENROLLMENT_REQUIRED' || code.startsWith('ENROLLMENT_')) {
        return 'ENROLLMENT_REQUIRED';
      }
      if (code.startsWith('PERMISSION_')) return 'PERMISSION_REQUIRED';
      if (code === 'CUSTOMER_SUSPENDED' || code === 'RESTRICTION_FROZEN') {
        return 'CAPABILITY_SUSPENDED';
      }
      if (
        code.startsWith('RISK_') ||
        code.startsWith('LEGACY_RISK') ||
        code.startsWith('COMPLIANCE_') ||
        code === 'RESTRICTION_MANUAL_REVIEW'
      ) {
        return 'ADDITIONAL_REVIEW_REQUIRED';
      }
      if (
        code.startsWith('BINDING_') ||
        code.startsWith('ACCOUNT_') ||
        code.startsWith('RECONCILIATION_') ||
        code === 'LEDGER_READ_UNAVAILABLE'
      ) {
        return 'ACCOUNT_REVIEW_REQUIRED';
      }
      if (code.startsWith('LIMIT_')) return 'LIMIT_REVIEW_REQUIRED';
      if (code.startsWith('IDENTITY_') || code === 'CUSTOMER_CLOSED') {
        return 'CAPABILITY_NOT_AVAILABLE';
      }
      if (code.startsWith('EVIDENCE_') || code.startsWith('SOURCE_')) {
        return 'ADDITIONAL_REVIEW_REQUIRED';
      }
      return this.defaultReason(decision);
    }

    if (this.isSensitiveReason(code)) {
      if (
        code.startsWith('COMPLIANCE_') ||
        code.startsWith('RISK_') ||
        code.startsWith('LEGACY_RISK')
      ) {
        return 'REVIEW_REQUIRED';
      }
      return 'RESTRICTED_POLICY_REASON';
    }
    if (code.startsWith('RESTRICTION_')) return 'RESTRICTION_ACTIVE';
    if (code.startsWith('BINDING_') || code.startsWith('ACCOUNT_')) {
      return 'ACCOUNT_REVIEW_REQUIRED';
    }
    return code;
  }

  private defaultReason(decision: PolicyDecisionState): string {
    switch (decision) {
      case PolicyDecisionState.ALLOW:
        return 'CAPABILITY_ALLOWED';
      case PolicyDecisionState.ALLOW_WITH_LIMITS:
        return 'CAPABILITY_LIMITED';
      case PolicyDecisionState.PENDING_REVIEW:
        return 'ADDITIONAL_REVIEW_REQUIRED';
      case PolicyDecisionState.SUSPEND:
        return 'CAPABILITY_SUSPENDED';
      case PolicyDecisionState.DENY:
        return 'CAPABILITY_NOT_AVAILABLE';
    }
  }

  private severityForDecision(decision: PolicyDecisionState): PolicyExplanationReasonSeverity {
    switch (decision) {
      case PolicyDecisionState.ALLOW:
        return PolicyExplanationReasonSeverity.INFO;
      case PolicyDecisionState.ALLOW_WITH_LIMITS:
        return PolicyExplanationReasonSeverity.LIMITED;
      case PolicyDecisionState.PENDING_REVIEW:
        return PolicyExplanationReasonSeverity.REVIEW;
      case PolicyDecisionState.SUSPEND:
        return PolicyExplanationReasonSeverity.SUSPENDED;
      case PolicyDecisionState.DENY:
        return PolicyExplanationReasonSeverity.BLOCKED;
    }
  }

  private orderReasonCodes(codes: readonly string[]): string[] {
    return [...new Set(codes)].sort((left, right) => {
      const categoryOrder = this.reasonCategoryRank(left) - this.reasonCategoryRank(right);
      return categoryOrder || left.localeCompare(right);
    });
  }

  private reasonCategoryRank(code: string): number {
    const category = REASON_CATEGORY_ORDER.find((candidate) => code.startsWith(candidate));
    return category ? REASON_CATEGORY_ORDER.indexOf(category) : REASON_CATEGORY_ORDER.length;
  }

  private explanationObligations(
    obligations: readonly PolicyObligation[],
    audience: PolicyExplanationAudience,
  ): PolicyExplanationObligation[] {
    const mapped = obligations
      .filter((obligation) => this.includeObligation(obligation, audience))
      .map((obligation) => {
        const code = this.safeObligationCode(obligation.code, audience);
        const includeReference =
          audience === PolicyExplanationAudience.OPERATIONS ||
          audience === PolicyExplanationAudience.INTERNAL_SERVICES;
        return {
          code,
          required: obligation.required,
          ...(obligation.dueAt ? { dueAt: obligation.dueAt } : {}),
          ...(obligation.expiresAt ? { expiresAt: obligation.expiresAt } : {}),
          ...(includeReference && obligation.reference ? { reference: obligation.reference } : {}),
        };
      });
    const unique = new Map<string, PolicyExplanationObligation>();
    for (const obligation of mapped) {
      if (!unique.has(obligation.code)) unique.set(obligation.code, obligation);
    }
    return [...unique.values()].sort((left, right) => {
      const requiredOrder = Number(right.required) - Number(left.required);
      return requiredOrder || left.code.localeCompare(right.code);
    });
  }

  private includeObligation(
    obligation: PolicyObligation,
    audience: PolicyExplanationAudience,
  ): boolean {
    if (audience === PolicyExplanationAudience.CUSTOMER) {
      return obligation.code !== 'RECHECK_A2_AUTHORIZATION';
    }
    return true;
  }

  private safeObligationCode(code: string, audience: PolicyExplanationAudience): string {
    if (
      audience === PolicyExplanationAudience.OPERATIONS ||
      audience === PolicyExplanationAudience.INTERNAL_SERVICES
    ) {
      return code;
    }
    if (code === 'RECHECK_A2_AUTHORIZATION') return 'ACCESS_RECHECK_REQUIRED';
    if (code === 'RECHECK_A3_BINDING' || code === 'RECONCILIATION_CONTROL_REQUIRED') {
      return 'ACCOUNT_REVIEW_REQUIRED';
    }
    if (code === 'RECHECK_EXECUTION_LIMIT') return 'RECHECK_LIMIT';
    if (code === 'REQUIRE_CURRENT_RISK_REVIEW') return 'REVIEW_REQUIRED';
    return code;
  }

  private explanationLimits(
    limits: readonly PolicyLimitOutput[],
    audience: PolicyExplanationAudience,
  ): PolicyExplanationLimit[] {
    const includeReference =
      audience === PolicyExplanationAudience.OPERATIONS ||
      audience === PolicyExplanationAudience.INTERNAL_SERVICES;
    return [...limits]
      .map((limit) => ({
        type: limit.type,
        ...(limit.currency ? { currency: limit.currency } : {}),
        ...(limit.amountMinor ? { amountMinor: limit.amountMinor } : {}),
        ...(limit.count !== undefined ? { count: limit.count } : {}),
        ...(limit.period ? { period: limit.period } : {}),
        ...(limit.remainingMinor ? { remainingMinor: limit.remainingMinor } : {}),
        ...(limit.remainingCount !== undefined ? { remainingCount: limit.remainingCount } : {}),
        ...(includeReference && limit.limitReference
          ? { limitReference: limit.limitReference }
          : {}),
      }))
      .sort((left, right) => left.type.localeCompare(right.type));
  }

  private sourceReferences(
    references: readonly PolicyEvidenceSourceReference[],
    audience: PolicyExplanationAudience,
  ): PolicyExplanationSourceReference[] {
    return [...references]
      .sort((left, right) =>
        this.sourceReferenceKey(left).localeCompare(this.sourceReferenceKey(right)),
      )
      .map((reference) => {
        const sensitive = SENSITIVE_SOURCE_CLASSES.has(reference.sourceClass);
        const includeIdentifiers =
          audience === PolicyExplanationAudience.OPERATIONS ||
          audience === PolicyExplanationAudience.INTERNAL_SERVICES;
        const includeSupportMetadata = audience === PolicyExplanationAudience.CUSTOMER_SUPPORT;
        return {
          sourceClass: reference.sourceClass,
          sourceType: reference.sourceType,
          ...(includeIdentifiers && !sensitive && reference.sourceId
            ? { sourceId: reference.sourceId }
            : {}),
          ...(includeIdentifiers &&
          reference.sourceVersion !== null &&
          reference.sourceVersion !== undefined
            ? { sourceVersion: reference.sourceVersion }
            : {}),
          ...(includeIdentifiers ? { observedAt: reference.observedAt } : {}),
          freshnessState: reference.freshnessState,
          ...(includeIdentifiers && reference.classification
            ? { classification: reference.classification }
            : {}),
          ...(includeIdentifiers && !sensitive && reference.reference
            ? { reference: reference.reference }
            : {}),
          ...(includeSupportMetadata && !sensitive
            ? { freshnessState: reference.freshnessState }
            : {}),
        };
      });
  }

  private sourceReferenceKey(reference: PolicyEvidenceSourceReference): string {
    return [
      reference.sourceClass,
      reference.sourceType,
      reference.sourceId ?? '',
      String(reference.sourceVersion ?? ''),
    ].join('|');
  }

  private isSensitiveReason(code: string): boolean {
    return SENSITIVE_REASON_PREFIXES.some((prefix) => code.startsWith(prefix));
  }

  private assertDecision(decision: Readonly<PolicyDecisionResult>): void {
    if (
      decision.contractName !== 'A4-CAPABILITY-POLICY' ||
      decision.contractVersion !== 1 ||
      decision.subject.type !== 'CUSTOMER' ||
      decision.policyVersion.trim().length === 0 ||
      decision.resultHash.trim().length === 0 ||
      decision.evidenceContext.normalizedInputHash.trim().length === 0
    ) {
      throw new BadRequestException('The A4 policy decision is invalid for explanation');
    }
  }
}
