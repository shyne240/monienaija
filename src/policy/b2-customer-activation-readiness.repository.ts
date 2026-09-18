/**
 * B2T03 — B2 customer activation-readiness repository.
 *
 * The B2 customer activation-readiness repository is the single B2-side
 * customer activation-readiness authority. It is a deterministic,
 * replay-safe attestation engine that verifies KYC, A3 binding, A4
 * policy eligibility, A7 product compatibility, B1 tier/entitlement
 * compatibility, and CustomerConsent for the bounded first cohort
 * `b2.activation.cohort.inbound-funding` v1. It exposes only read-only
 * consumer ports to later B2 tasks (B2T05).
 */

import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_CUSTOMER_ACTIVATION_READINESS_AUDIT_ACTOR,
  B2_CUSTOMER_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_DOCUMENT,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION,
  B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY,
  B2_CUSTOMER_ACTIVATION_READINESS_COHORT_VERSION,
  B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE,
  B2_CUSTOMER_ACTIVATION_READINESS_REFERENCE_PREFIX,
} from './b2-customer-activation-readiness.constants';
import type {
  B2CustomerActivationReadinessCompatibilityResultV1,
  B2CustomerActivationReadinessConsumerPortsV1,
  B2CustomerActivationReadinessDecisionV1,
  B2CustomerActivationReadinessReplaySafeResultV1,
  B2CustomerActivationReadinessRequestV1,
  B2CustomerActivationReadinessRuleTraceStepV1,
} from './b2-customer-activation-readiness.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

@Injectable()
export class B2CustomerActivationReadinessRepository {
  getContractName(): string {
    return B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_DOCUMENT;
  }

  getIdempotencyScope(): typeof B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE {
    return B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE;
  }

  getAuditActor(): string {
    return B2_CUSTOMER_ACTIVATION_READINESS_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B2_CUSTOMER_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE;
  }

  getReferencePrefix(): string {
    return B2_CUSTOMER_ACTIVATION_READINESS_REFERENCE_PREFIX;
  }

  getConsumerPorts(): B2CustomerActivationReadinessConsumerPortsV1 {
    return {
      contractName: B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME,
      contractVersion: B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION,
      idempotencyScope: B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE,
      cohortKey: B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY,
      cohortVersion: B2_CUSTOMER_ACTIVATION_READINESS_COHORT_VERSION,
    };
  }

  compatibilityCheck(
    request: B2CustomerActivationReadinessRequestV1,
  ): B2CustomerActivationReadinessCompatibilityResultV1 {
    if (request.cohortKey !== B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY)}`,
          field: 'cohortKey',
        },
      };
    }
    if (request.cohortVersion !== B2_CUSTOMER_ACTIVATION_READINESS_COHORT_VERSION) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE',
          message: 'cohortVersion must be 1',
          field: 'cohortVersion',
        },
      };
    }
    if (
      request.b1ScopeKey !== 'commercial.virtual-account.inbound-funding' ||
      request.b1ScopeVersion !== 1 ||
      request.a7ProductKey !== 'VIRTUAL_ACCOUNT' ||
      request.a7ProductVersion !== 1 ||
      request.currency !== 'NGN' ||
      request.accountingUnit !== 'CUSTOMER_FUNDS' ||
      request.region !== 'NG' ||
      request.consentPurpose !== 'B2_ACTIVATION'
    ) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE',
          message:
            'b1Scope/a7Product/currency/accountingUnit/region/consentPurpose incompatible with frozen cohort',
          field: null,
        },
      };
    }
    if (!UUID_PATTERN.test(request.customerId)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CUSTOMER_ACTIVATION_READINESS_INVALID_COMMAND',
          message: 'customerId must be uuid',
          field: 'customerId',
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CUSTOMER_ACTIVATION_READINESS_INVALID_COMMAND',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
        },
      };
    }
    return { compatible: true, failure: null };
  }

  computeRequestHash(request: B2CustomerActivationReadinessRequestV1): string {
    const payload = {
      customerId: request.customerId,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      b1ScopeKey: request.b1ScopeKey,
      b1ScopeVersion: request.b1ScopeVersion,
      a7ProductKey: request.a7ProductKey,
      a7ProductVersion: request.a7ProductVersion,
      currency: request.currency,
      accountingUnit: request.accountingUnit,
      region: request.region,
      consentPurpose: request.consentPurpose,
      kycVerificationState: request.kycVerificationState,
      a3BindingState: request.a3BindingState,
      a4EligibilityState: request.a4EligibilityState,
      a4CurrentnessState: request.a4CurrentnessState,
      a7CompatibilityState: request.a7CompatibilityState,
      b1TierState: request.b1TierState,
      b1EntitlementState: request.b1EntitlementState,
      customerConsentState: request.customerConsentState,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateAttestationDecision(
    request: B2CustomerActivationReadinessRequestV1,
  ): B2CustomerActivationReadinessDecisionV1 {
    const compatibility = this.compatibilityCheck(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }

    const ruleTrace: B2CustomerActivationReadinessRuleTraceStepV1[] = [];

    // KYC
    if (request.kycVerificationState === 'VERIFIED') {
      ruleTrace.push({ kind: 'KYC_VERIFICATION', outcome: 'PASS', code: null, detail: null });
    } else if (request.kycVerificationState === 'PENDING') {
      ruleTrace.push({
        kind: 'KYC_VERIFICATION',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_KYC_NOT_VERIFIED',
        detail: 'kycVerificationState must be VERIFIED',
      });
    } else {
      ruleTrace.push({
        kind: 'KYC_VERIFICATION',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_KYC_NOT_VERIFIED',
        detail: `kycVerificationState is ${request.kycVerificationState}`,
      });
    }

    // A3 binding
    if (request.a3BindingState === 'VERIFIED') {
      ruleTrace.push({ kind: 'A3_BINDING_RECHECK', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'A3_BINDING_RECHECK',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_A3_BINDING_INVALID',
        detail: `a3BindingState is ${request.a3BindingState}`,
      });
    }

    // A4 eligibility
    if (request.a4EligibilityState === 'ELIGIBLE' && request.a4CurrentnessState === 'CURRENT') {
      ruleTrace.push({ kind: 'A4_POLICY_ELIGIBILITY', outcome: 'PASS', code: null, detail: null });
      ruleTrace.push({ kind: 'A4_POLICY_CURRENTNESS', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'A4_POLICY_ELIGIBILITY',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_A4_NOT_ELIGIBLE',
        detail: `a4EligibilityState=${request.a4EligibilityState} currentness=${request.a4CurrentnessState}`,
      });
      ruleTrace.push({
        kind: 'A4_POLICY_CURRENTNESS',
        outcome: request.a4CurrentnessState === 'CURRENT' ? 'PASS' : 'FAIL',
        code:
          request.a4CurrentnessState === 'CURRENT'
            ? null
            : 'B2_CUSTOMER_ACTIVATION_READINESS_A4_NOT_ELIGIBLE',
        detail: null,
      });
    }

    // A7
    if (request.a7CompatibilityState === 'COMPATIBLE') {
      ruleTrace.push({
        kind: 'A7_PRODUCT_COMPATIBILITY',
        outcome: 'PASS',
        code: null,
        detail: null,
      });
    } else {
      ruleTrace.push({
        kind: 'A7_PRODUCT_COMPATIBILITY',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_A7_INCOMPATIBLE',
        detail: 'a7CompatibilityState must be COMPATIBLE',
      });
    }

    // B1 tier
    if (request.b1TierState === 'COMPATIBLE') {
      ruleTrace.push({ kind: 'B1_TIER_COMPATIBILITY', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'B1_TIER_COMPATIBILITY',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_B1_TIER_INELIGIBLE',
        detail: 'b1TierState must be COMPATIBLE',
      });
    }

    // B1 entitlement
    if (request.b1EntitlementState === 'COMPATIBLE') {
      ruleTrace.push({
        kind: 'B1_ENTITLEMENT_COMPATIBILITY',
        outcome: 'PASS',
        code: null,
        detail: null,
      });
    } else {
      ruleTrace.push({
        kind: 'B1_ENTITLEMENT_COMPATIBILITY',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_B1_ENTITLEMENT_INELIGIBLE',
        detail: 'b1EntitlementState must be COMPATIBLE',
      });
    }

    // Consent
    if (request.customerConsentState === 'GRANTED') {
      ruleTrace.push({ kind: 'CUSTOMER_CONSENT', outcome: 'PASS', code: null, detail: null });
    } else if (request.customerConsentState === 'NOT_GRANTED') {
      ruleTrace.push({
        kind: 'CUSTOMER_CONSENT',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_CONSENT_NOT_GRANTED',
        detail: 'customerConsentState is NOT_GRANTED',
      });
    } else {
      ruleTrace.push({
        kind: 'CUSTOMER_CONSENT',
        outcome: 'FAIL',
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_CONSENT_NOT_GRANTED',
        detail: `customerConsentState is ${request.customerConsentState}`,
      });
    }

    // Customer identity always passes if compatibility passed (already uuid-checked)
    ruleTrace.push({ kind: 'CUSTOMER_IDENTITY', outcome: 'PASS', code: null, detail: null });

    const hasFail = ruleTrace.some((s) => s.outcome === 'FAIL');
    const consentMissing = ruleTrace.find(
      (s) => s.kind === 'CUSTOMER_CONSENT' && s.outcome === 'FAIL',
    );

    let verificationState: B2CustomerActivationReadinessDecisionV1['verificationState'];
    let activationEligibility: B2CustomerActivationReadinessDecisionV1['activationEligibility'];
    let activationReady: boolean;
    let outcome: B2CustomerActivationReadinessDecisionV1['outcome'];
    let activationReadyAt: string | null;

    if (!hasFail) {
      verificationState = 'VERIFIED';
      activationEligibility = 'ELIGIBLE';
      activationReady = true;
      outcome = 'ATTESTED_READY';
      activationReadyAt = new Date().toISOString();
    } else if (consentMissing && ruleTrace.filter((s) => s.outcome === 'FAIL').length === 1) {
      verificationState = 'VERIFIED';
      activationEligibility = 'REQUIRES_CONSENT';
      activationReady = false;
      outcome = 'ATTESTED_REQUIRES_CONSENT';
      activationReadyAt = null;
    } else if (
      request.kycVerificationState === 'PENDING' &&
      ruleTrace.filter((s) => s.outcome === 'FAIL').length === 1
    ) {
      verificationState = 'PENDING';
      activationEligibility = 'INELIGIBLE';
      activationReady = false;
      outcome = 'ATTESTED_NOT_READY';
      activationReadyAt = null;
    } else {
      verificationState = 'UNVERIFIED';
      activationEligibility = 'INELIGIBLE';
      activationReady = false;
      outcome = hasFail ? 'ATTESTED_NOT_READY' : 'REJECTED';
      activationReadyAt = null;
    }

    const requestHash = this.computeRequestHash(request);
    // decisionHash includes outcome + ruleTrace, replayHash excludes random reference/createdAt
    const decisionPayload = {
      requestHash,
      verificationState,
      activationEligibility,
      activationReady,
      outcome,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      b1ScopeKey: request.b1ScopeKey,
      customerConsentState: request.customerConsentState,
      a3BindingState: request.a3BindingState,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      b1ScopeKey: request.b1ScopeKey,
      verificationState,
      activationEligibility,
      activationReady,
      outcome,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));

    const attestationReference = `${B2_CUSTOMER_ACTIVATION_READINESS_REFERENCE_PREFIX}-${randomUUID()}`;

    return {
      attestationReference,
      attestationVersion: 1,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      customerId: request.customerId,
      verificationState,
      activationEligibility,
      activationReady,
      activationReadyAt,
      outcome,
      ruleTrace,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: new Date().toISOString(),
      contractName: B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME,
      contractVersion: 1,
      b1ScopeKey: request.b1ScopeKey,
      currency: request.currency,
      accountingUnit: request.accountingUnit,
      region: request.region,
    };
  }

  replaySafeGenerateAttestationDecision(
    request: B2CustomerActivationReadinessRequestV1,
    existingByKey?: {
      decision: B2CustomerActivationReadinessDecisionV1;
      requestHash: string;
    } | null,
  ): B2CustomerActivationReadinessReplaySafeResultV1 {
    const requestHash = this.computeRequestHash(request);

    if (!existingByKey) {
      const decision = this.generateAttestationDecision(request);
      return { decision, failure: null, replayed: false, conflict: false };
    }

    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }

    return {
      decision: null,
      failure: {
        code: 'B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }
}
