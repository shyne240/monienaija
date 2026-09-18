/**
 * B2T05 — B2 activation workflow repository.
 *
 * The B2 activation workflow repository is the single B2-side activation
 * authority. It consumes B2T03 customer readiness and B2T04 merchant/agent
 * readiness through their consumer ports only and never recalculates
 * readiness. Activation is allowed only when the readiness outcome is
 * ATTESTED_READY. The workflow is deterministic, replay-safe via a
 * dedicated idempotency scope, and supports the state machine PENDING ->
 * ACTIVE -> SUSPENDED -> REVOKED. It preserves all A1–A7 and B1
 * authority boundaries and never posts a ledger entry, dispatches a
 * notification, or performs settlement.
 */

import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_ACTIVATION_WORKFLOW_AUDIT_ACTOR,
  B2_ACTIVATION_WORKFLOW_AUDIT_ENTITY_TYPE,
  B2_ACTIVATION_WORKFLOW_COHORT_KEY,
  B2_ACTIVATION_WORKFLOW_COHORT_VERSION,
  B2_ACTIVATION_WORKFLOW_CONTRACT_DOCUMENT,
  B2_ACTIVATION_WORKFLOW_CONTRACT_NAME,
  B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION,
  B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE,
  B2_ACTIVATION_WORKFLOW_REFERENCE_PREFIX,
} from './b2-activation-workflow.constants';
import type {
  B2ActivationState,
  B2ActivationWorkflowCompatibilityResultV1,
  B2ActivationWorkflowConsumerPortsV1,
  B2ActivationWorkflowDecisionV1,
  B2ActivationWorkflowReplaySafeResultV1,
  B2ActivationWorkflowRequestV1,
  B2ActivationWorkflowRuleTraceStepV1,
} from './b2-activation-workflow.types';

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
export class B2ActivationWorkflowRepository {
  getContractName(): string {
    return B2_ACTIVATION_WORKFLOW_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_ACTIVATION_WORKFLOW_CONTRACT_DOCUMENT;
  }

  getIdempotencyScope(): string {
    return B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE;
  }

  getAuditActor(): string {
    return B2_ACTIVATION_WORKFLOW_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B2_ACTIVATION_WORKFLOW_AUDIT_ENTITY_TYPE;
  }

  getConsumerPorts(): B2ActivationWorkflowConsumerPortsV1 {
    return {
      contractName: B2_ACTIVATION_WORKFLOW_CONTRACT_NAME,
      contractVersion: B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION,
      idempotencyScope: B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE,
      cohortKey: B2_ACTIVATION_WORKFLOW_COHORT_KEY,
      cohortVersion: B2_ACTIVATION_WORKFLOW_COHORT_VERSION,
    };
  }

  compatibilityCheck(
    request: B2ActivationWorkflowRequestV1,
  ): B2ActivationWorkflowCompatibilityResultV1 {
    if (request.cohortKey !== B2_ACTIVATION_WORKFLOW_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_ACTIVATION_WORKFLOW_COHORT_KEY)}`,
          field: 'cohortKey',
        },
      };
    }
    if (request.cohortVersion !== B2_ACTIVATION_WORKFLOW_COHORT_VERSION) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INCOMPATIBLE',
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
          code: 'B2_ACTIVATION_WORKFLOW_INCOMPATIBLE',
          message: 'b1Scope/currency/accountingUnit/region incompatible',
          field: null,
        },
      };
    }
    if (!UUID_PATTERN.test(request.principalId)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INVALID_COMMAND',
          message: 'principalId must be uuid',
          field: 'principalId',
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INVALID_COMMAND',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
        },
      };
    }
    if (request.readinessOutcome !== 'ATTESTED_READY') {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY',
          message:
            'readinessOutcome must be ATTESTED_READY — readiness must be consumed via B2T03/B2T04 and never recalculated',
          field: 'readinessOutcome',
        },
      };
    }
    if (!request.readinessReference || request.readinessReference.length === 0) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INVALID_COMMAND',
          message: 'readinessReference is required',
          field: 'readinessReference',
        },
      };
    }
    if (!['CUSTOMER', 'MERCHANT', 'AGENT'].includes(request.kind)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INVALID_COMMAND',
          message: 'kind must be CUSTOMER, MERCHANT, or AGENT',
          field: 'kind',
        },
      };
    }
    if (
      (request.readinessKind === 'CUSTOMER' && request.kind !== 'CUSTOMER') ||
      (request.readinessKind === 'MERCHANT' && request.kind !== 'MERCHANT') ||
      (request.readinessKind === 'AGENT' && request.kind !== 'AGENT')
    ) {
      return {
        compatible: false,
        failure: {
          code: 'B2_ACTIVATION_WORKFLOW_INCOMPATIBLE',
          message: 'readinessKind must match principal kind',
          field: 'readinessKind',
        },
      };
    }
    return { compatible: true, failure: null };
  }

  computeRequestHash(request: B2ActivationWorkflowRequestV1): string {
    const payload = {
      kind: request.kind,
      principalId: request.principalId,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      b1ScopeKey: request.b1ScopeKey,
      b1ScopeVersion: request.b1ScopeVersion,
      currency: request.currency,
      accountingUnit: request.accountingUnit,
      region: request.region,
      readinessOutcome: request.readinessOutcome,
      readinessReference: request.readinessReference,
      readinessKind: request.readinessKind,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateActivationDecision(
    request: B2ActivationWorkflowRequestV1,
  ): B2ActivationWorkflowDecisionV1 {
    const compatibility = this.compatibilityCheck(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }

    const ruleTrace: B2ActivationWorkflowRuleTraceStepV1[] = [];
    ruleTrace.push({ kind: 'COHORT_COMPATIBILITY', outcome: 'PASS', code: null, detail: null });
    ruleTrace.push({ kind: 'B1_SCOPE_COMPATIBILITY', outcome: 'PASS', code: null, detail: null });
    ruleTrace.push({
      kind: 'READINESS_CONSUMPTION',
      outcome: 'PASS',
      code: null,
      detail: 'consumed ATTESTED_READY via B2T03/B2T04 consumer ports',
    });
    ruleTrace.push({
      kind: 'ACTIVATION_STATE_MACHINE',
      outcome: 'PASS',
      code: null,
      detail: 'PENDING is the deterministic initial state',
    });

    const requestHash = this.computeRequestHash(request);
    const activationReference = `${B2_ACTIVATION_WORKFLOW_REFERENCE_PREFIX}-${randomUUID()}`;
    const state: B2ActivationWorkflowDecisionV1['state'] = 'PENDING';
    const outcome: B2ActivationWorkflowDecisionV1['outcome'] = 'PENDING';

    const decisionPayload = {
      requestHash,
      state,
      outcome,
      kind: request.kind,
      cohortKey: request.cohortKey,
      readinessReference: request.readinessReference,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      kind: request.kind,
      state,
      outcome,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));

    const now = new Date().toISOString();

    return {
      activationReference,
      activationVersion: 1,
      kind: request.kind,
      principalId: request.principalId,
      beneficialOwnerCustomerId: request.beneficialOwnerCustomerId ?? null,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      b1ScopeKey: request.b1ScopeKey,
      b1ScopeVersion: request.b1ScopeVersion,
      currency: request.currency,
      accountingUnit: request.accountingUnit,
      region: request.region,
      state,
      outcome,
      readinessReference: request.readinessReference,
      readinessOutcome: request.readinessOutcome,
      ruleTrace,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-ACTIVATION-WORKFLOW',
      contractVersion: 1,
    };
  }

  /**
   * Deterministic state transition. Only the four lifecycle states are
   * allowed, and the machine enforces PENDING -> ACTIVE -> SUSPENDED ->
   * REVOKED with no backward transitions and no ledger mutation.
   */
  transitionState(
    current: B2ActivationWorkflowDecisionV1,
    targetState: B2ActivationState,
  ): B2ActivationWorkflowDecisionV1 {
    const allowed: Record<B2ActivationState, B2ActivationState[]> = {
      PENDING: ['ACTIVE'],
      ACTIVE: ['SUSPENDED'],
      SUSPENDED: ['REVOKED'],
      REVOKED: [],
    };

    if (!allowed[current.state].includes(targetState)) {
      throw Object.assign(
        new Error(`invalid state transition ${current.state} -> ${targetState}`),
        { code: 'B2_ACTIVATION_WORKFLOW_INVALID_STATE_TRANSITION' },
      );
    }

    const outcome: B2ActivationWorkflowDecisionV1['outcome'] =
      targetState === 'ACTIVE'
        ? 'ACTIVATED'
        : targetState === 'SUSPENDED'
          ? 'SUSPENDED'
          : 'REVOKED';

    const ruleTrace: B2ActivationWorkflowRuleTraceStepV1[] = [
      {
        kind: 'ACTIVATION_STATE_MACHINE',
        outcome: 'PASS',
        code: null,
        detail: `${current.state} -> ${targetState}`,
      },
    ];

    const decisionPayload = {
      activationReference: current.activationReference,
      targetState,
      outcome,
      previousState: current.state,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      activationReference: current.activationReference,
      targetState,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));

    return {
      ...current,
      state: targetState,
      outcome,
      ruleTrace,
      decisionHash,
      decisionReplayHash,
      updatedAt: new Date().toISOString(),
    };
  }

  replaySafeGenerateActivationDecision(
    request: B2ActivationWorkflowRequestV1,
    existingByKey?: { decision: B2ActivationWorkflowDecisionV1; requestHash: string } | null,
  ): B2ActivationWorkflowReplaySafeResultV1 {
    const requestHash = this.computeRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateActivationDecision(request);
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_ACTIVATION_WORKFLOW_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }
}
