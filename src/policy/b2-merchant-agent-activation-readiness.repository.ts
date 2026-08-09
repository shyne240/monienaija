/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars */
/**
 * B2T04 — B2 merchant and agent activation-readiness repository.
 *
 * The B2 merchant and agent activation-readiness repository is the
 * single B2-side merchant/agent readiness authority. It verifies business
 * identity, beneficial-owner linkage, settlement eligibility, commercial
 * eligibility, A4 policy eligibility, and required consents for the
 * bounded first cohort `b2.activation.cohort.inbound-funding` v1.
 * Separate idempotency scopes for merchant and agent preserve replay
 * isolation. The repository exposes only read-only consumer ports to
 * later B2 tasks (B2T05).
 */

import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_AUDIT_ACTOR,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE_AGENT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE_MERCHANT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_VERSION,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_DOCUMENT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_REFERENCE_PREFIX_AGENT,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_REFERENCE_PREFIX_MERCHANT,
} from './b2-merchant-agent-activation-readiness.constants';
import type {
  B2AgentActivationReadinessRequestV1,
  B2MerchantActivationReadinessRequestV1,
  B2MerchantAgentActivationReadinessCompatibilityResultV1,
  B2MerchantAgentActivationReadinessConsumerPortsV1,
  B2MerchantAgentActivationReadinessDecisionV1,
  B2MerchantAgentActivationReadinessReplaySafeResultV1,
  B2MerchantAgentActivationReadinessRequestV1,
  B2MerchantAgentActivationReadinessRuleTraceStepV1,
} from './b2-merchant-agent-activation-readiness.types';

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
export class B2MerchantAgentActivationReadinessRepository {
  getContractName(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_DOCUMENT;
  }

  getIdempotencyScopeMerchant(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT;
  }

  getIdempotencyScopeAgent(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT;
  }

  getAuditActor(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_AUDIT_ACTOR;
  }

  getAuditEntityTypeMerchant(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE_MERCHANT;
  }

  getAuditEntityTypeAgent(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE_AGENT;
  }

  getConsumerPorts(): B2MerchantAgentActivationReadinessConsumerPortsV1 {
    return {
      contractName: B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME,
      contractVersion: B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION,
      idempotencyScopeMerchant: B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT,
      idempotencyScopeAgent: B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT,
      cohortKey: B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY,
      cohortVersion: B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_VERSION,
    };
  }

  compatibilityCheck(
    request: B2MerchantAgentActivationReadinessRequestV1,
  ): B2MerchantAgentActivationReadinessCompatibilityResultV1 {
    if (request.cohortKey !== B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_MERCHANT_AGENT_READINESS_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_KEY)}`,
          field: 'cohortKey',
        },
      };
    }
    if (request.cohortVersion !== B2_MERCHANT_AGENT_ACTIVATION_READINESS_COHORT_VERSION) {
      return {
        compatible: false,
        failure: {
          code: 'B2_MERCHANT_AGENT_READINESS_INCOMPATIBLE',
          message: 'cohortVersion must be 1',
          field: 'cohortVersion',
        },
      };
    }
    if (
      request.b1ScopeKey !== 'commercial.virtual-account.inbound-funding' ||
      request.b1ScopeVersion !== 1 ||
      request.currency !== 'NGN' ||
      request.accountingUnit !== 'CUSTOMER_FUNDS' ||
      request.region !== 'NG'
    ) {
      return {
        compatible: false,
        failure: {
          code: 'B2_MERCHANT_AGENT_READINESS_INCOMPATIBLE',
          message: 'b1Scope/currency/accountingUnit/region incompatible',
          field: null,
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_MERCHANT_AGENT_READINESS_INVALID_COMMAND',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
        },
      };
    }
    if (request.kind === 'MERCHANT') {
      const r = request;
      if (!UUID_PATTERN.test(r.merchantId) || !UUID_PATTERN.test(r.beneficialOwnerCustomerId)) {
        return {
          compatible: false,
          failure: {
            code: 'B2_MERCHANT_AGENT_READINESS_INVALID_COMMAND',
            message: 'merchantId/beneficialOwnerCustomerId must be uuid',
            field: 'merchantId',
          },
        };
      }
    } else {
      const r = request;
      if (
        !UUID_PATTERN.test(r.agentId) ||
        !UUID_PATTERN.test(r.supervisingMerchantId) ||
        !UUID_PATTERN.test(r.supervisingCustomerId)
      ) {
        return {
          compatible: false,
          failure: {
            code: 'B2_MERCHANT_AGENT_READINESS_INVALID_COMMAND',
            message: 'agentId/supervisingMerchantId/supervisingCustomerId must be uuid',
            field: 'agentId',
          },
        };
      }
    }
    return { compatible: true, failure: null };
  }

  computeRequestHash(request: B2MerchantAgentActivationReadinessRequestV1): string {
    const base = {
      kind: request.kind,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      b1ScopeKey: request.b1ScopeKey,
      b1ScopeVersion: request.b1ScopeVersion,
      currency: request.currency,
      accountingUnit: request.accountingUnit,
      region: request.region,
      businessIdentityState: request.businessIdentityState,
      beneficialOwnerState: request.beneficialOwnerState,
      settlementEligibilityState: request.settlementEligibilityState,
      commercialEligibilityState: request.commercialEligibilityState,
      a4EligibilityState: request.a4EligibilityState,
      consentState: request.consentState,
      idempotencyKey: request.idempotencyKey,
    } as Record<string, unknown>;
    if (request.kind === 'MERCHANT') {
      const r = request;
      Object.assign(base, {
        merchantId: r.merchantId,
        beneficialOwnerCustomerId: r.beneficialOwnerCustomerId,
        businessType: r.businessType,
        registrationReference: r.registrationReference,
        taxIdentifierReference: r.taxIdentifierReference,
        settlementAccountReference: r.settlementAccountReference,
      });
    } else {
      const r = request;
      Object.assign(base, {
        agentId: r.agentId,
        supervisingMerchantId: r.supervisingMerchantId,
        supervisingCustomerId: r.supervisingCustomerId,
        agentNetwork: r.agentNetwork,
        terminalReference: r.terminalReference,
        collectionModeReference: r.collectionModeReference,
      });
    }
    return sha256Hex(stableJson(base));
  }

  generateAttestationDecision(
    request: B2MerchantAgentActivationReadinessRequestV1,
  ): B2MerchantAgentActivationReadinessDecisionV1 {
    const compatibility = this.compatibilityCheck(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }

    const ruleTrace: B2MerchantAgentActivationReadinessRuleTraceStepV1[] = [];

    // Business identity
    if (request.businessIdentityState === 'VERIFIED') {
      ruleTrace.push({
        kind: 'BUSINESS_IDENTITY_VERIFICATION',
        outcome: 'PASS',
        code: null,
        detail: null,
      });
    } else {
      ruleTrace.push({
        kind: 'BUSINESS_IDENTITY_VERIFICATION',
        outcome: 'FAIL',
        code: 'B2_MERCHANT_AGENT_READINESS_BUSINESS_IDENTITY_NOT_VERIFIED',
        detail: `businessIdentityState is ${request.businessIdentityState}`,
      });
    }

    // Beneficial owner linkage
    if (request.beneficialOwnerState === 'VERIFIED') {
      ruleTrace.push({
        kind: 'BENEFICIAL_OWNER_LINKAGE',
        outcome: 'PASS',
        code: null,
        detail: null,
      });
    } else {
      ruleTrace.push({
        kind: 'BENEFICIAL_OWNER_LINKAGE',
        outcome: 'FAIL',
        code: 'B2_MERCHANT_AGENT_READINESS_BENEFICIAL_OWNER_NOT_VERIFIED',
        detail: 'beneficialOwnerState must be VERIFIED',
      });
    }

    // Settlement
    if (request.settlementEligibilityState === 'ELIGIBLE') {
      ruleTrace.push({ kind: 'SETTLEMENT_ELIGIBILITY', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'SETTLEMENT_ELIGIBILITY',
        outcome: 'FAIL',
        code: 'B2_MERCHANT_AGENT_READINESS_SETTLEMENT_NOT_ELIGIBLE',
        detail: 'settlementEligibilityState must be ELIGIBLE',
      });
    }

    // Commercial
    if (request.commercialEligibilityState === 'ELIGIBLE') {
      ruleTrace.push({ kind: 'COMMERCIAL_ELIGIBILITY', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'COMMERCIAL_ELIGIBILITY',
        outcome: 'FAIL',
        code: 'B2_MERCHANT_AGENT_READINESS_COMMERCIAL_NOT_ELIGIBLE',
        detail: 'commercialEligibilityState must be ELIGIBLE',
      });
    }

    // A4
    if (request.a4EligibilityState === 'ELIGIBLE') {
      ruleTrace.push({ kind: 'A4_POLICY_ELIGIBILITY', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'A4_POLICY_ELIGIBILITY',
        outcome: 'FAIL',
        code: 'B2_MERCHANT_AGENT_READINESS_A4_NOT_ELIGIBLE',
        detail: 'a4EligibilityState must be ELIGIBLE',
      });
    }

    // Consent
    if (request.consentState === 'GRANTED') {
      ruleTrace.push({ kind: 'CUSTOMER_CONSENT', outcome: 'PASS', code: null, detail: null });
    } else {
      ruleTrace.push({
        kind: 'CUSTOMER_CONSENT',
        outcome: 'FAIL',
        code: 'B2_MERCHANT_AGENT_READINESS_CONSENT_NOT_GRANTED',
        detail: `consentState is ${request.consentState}`,
      });
    }

    // Identity kind
    if (request.kind === 'MERCHANT') {
      ruleTrace.push({ kind: 'MERCHANT_IDENTITY', outcome: 'PASS', code: null, detail: null });
      ruleTrace.push({
        kind: 'AGENT_IDENTITY',
        outcome: 'NOT_APPLICABLE',
        code: null,
        detail: null,
      });
    } else {
      ruleTrace.push({
        kind: 'MERCHANT_IDENTITY',
        outcome: 'NOT_APPLICABLE',
        code: null,
        detail: null,
      });
      ruleTrace.push({ kind: 'AGENT_IDENTITY', outcome: 'PASS', code: null, detail: null });
    }

    const fails = ruleTrace.filter((s) => s.outcome === 'FAIL');
    const consentOnly = fails.length === 1 && fails[0]!.kind === 'CUSTOMER_CONSENT';

    let verificationState: B2MerchantAgentActivationReadinessDecisionV1['verificationState'];
    let activationEligibility: B2MerchantAgentActivationReadinessDecisionV1['activationEligibility'];
    let activationReady: boolean;
    let outcome: B2MerchantAgentActivationReadinessDecisionV1['outcome'];
    let activationReadyAt: string | null;

    if (fails.length === 0) {
      verificationState = 'VERIFIED';
      activationEligibility = 'ELIGIBLE';
      activationReady = true;
      outcome = 'ATTESTED_READY';
      activationReadyAt = new Date().toISOString();
    } else if (consentOnly) {
      verificationState = 'VERIFIED';
      activationEligibility = 'REQUIRES_CONSENT';
      activationReady = false;
      outcome = 'ATTESTED_REQUIRES_CONSENT';
      activationReadyAt = null;
    } else if (
      request.businessIdentityState === 'PENDING' &&
      fails.length === 1 &&
      fails[0]!.kind === 'BUSINESS_IDENTITY_VERIFICATION'
    ) {
      verificationState = 'PENDING_VERIFICATION';
      activationEligibility = 'INELIGIBLE';
      activationReady = false;
      outcome = 'ATTESTED_NOT_READY';
      activationReadyAt = null;
    } else {
      verificationState = 'DRAFT';
      activationEligibility = 'INELIGIBLE';
      activationReady = false;
      outcome = 'ATTESTED_NOT_READY';
      activationReadyAt = null;
    }

    const requestHash = this.computeRequestHash(request);
    const decisionPayload = {
      requestHash,
      verificationState,
      activationEligibility,
      activationReady,
      outcome,
      kind: request.kind,
      cohortKey: request.cohortKey,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      kind: request.kind,
      verificationState,
      activationEligibility,
      activationReady,
      outcome,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));

    const isAgent = request.kind === 'AGENT';
    const prefix = isAgent
      ? B2_MERCHANT_AGENT_ACTIVATION_READINESS_REFERENCE_PREFIX_AGENT
      : B2_MERCHANT_AGENT_ACTIVATION_READINESS_REFERENCE_PREFIX_MERCHANT;
    const scope = isAgent
      ? B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_AGENT
      : B2_MERCHANT_AGENT_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE_MERCHANT;
    const principalId = isAgent
      ? (request as B2AgentActivationReadinessRequestV1).agentId
      : (request as B2MerchantActivationReadinessRequestV1).merchantId;
    const beneficialOwnerCustomerId = isAgent
      ? (request as B2AgentActivationReadinessRequestV1).supervisingCustomerId
      : (request as B2MerchantActivationReadinessRequestV1).beneficialOwnerCustomerId;

    return {
      attestationReference: `${prefix}-${randomUUID()}`,
      attestationVersion: 1,
      kind: request.kind,
      principalId,
      beneficialOwnerCustomerId,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      verificationState,
      activationEligibility,
      activationReady,
      activationReadyAt,
      outcome,
      ruleTrace,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: scope,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: new Date().toISOString(),
      contractName: 'B2-MERCHANT-AGENT-ACTIVATION-READINESS',
      contractVersion: 1,
      b1ScopeKey: request.b1ScopeKey,
      currency: request.currency,
      accountingUnit: request.accountingUnit,
      region: request.region,
    };
  }

  replaySafeGenerateAttestationDecision(
    request: B2MerchantAgentActivationReadinessRequestV1,
    existingByKey?: {
      decision: B2MerchantAgentActivationReadinessDecisionV1;
      requestHash: string;
    } | null,
  ): B2MerchantAgentActivationReadinessReplaySafeResultV1 {
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
        code: 'B2_MERCHANT_AGENT_READINESS_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }
}
