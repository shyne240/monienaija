/**
 * B2T06 — B2 consent authority repository.
 *
 * The B2 consent repository is the only B2-side consent authority. It
 * implements Customer Consent, Marketing Consent, and Commercial Consent
 * for purposes B2_ACTIVATION, B2_COMMERCIAL, B2_SELF_SERVICE,
 * MARKETING_COMMERCIAL_OFFER. Each decision is deterministic, replay-safe
 * via the dedicated b2.consent.idempotency.v1 scope with an 86400s
 * window and deterministic hashes. The lifecycle is
 * PENDING -> GRANTED -> REVOKED -> EXPIRED. The repository exposes only
 * read-only consumer ports to later B2 tasks.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_CONSENT_AUDIT_ACTOR,
  B2_CONSENT_AUDIT_ENTITY_TYPE,
  B2_CONSENT_COHORT_KEY,
  B2_CONSENT_COHORT_VERSION,
  B2_CONSENT_CONTRACT_DOCUMENT,
  B2_CONSENT_CONTRACT_NAME,
  B2_CONSENT_CONTRACT_VERSION,
  B2_CONSENT_IDEMPOTENCY_SCOPE,
  B2_CONSENT_REFERENCE_PREFIX,
} from './b2-consent.constants';
import type {
  B2ConsentCompatibilityResultV1,
  B2ConsentConsumerPortsV1,
  B2ConsentDecisionV1,
  B2ConsentReplaySafeResultV1,
  B2ConsentRequestV1,
  B2ConsentState,
} from './b2-consent.types';

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

const ALLOWED_PURPOSES = new Set<string>([
  'B2_ACTIVATION',
  'B2_COMMERCIAL',
  'B2_SELF_SERVICE',
  'MARKETING_COMMERCIAL_OFFER',
]);

@Injectable()
export class B2ConsentRepository {
  getContractName(): string {
    return B2_CONSENT_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_CONSENT_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_CONSENT_CONTRACT_DOCUMENT;
  }

  getIdempotencyScope(): string {
    return B2_CONSENT_IDEMPOTENCY_SCOPE;
  }

  getAuditActor(): string {
    return B2_CONSENT_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B2_CONSENT_AUDIT_ENTITY_TYPE;
  }

  getConsumerPorts(): B2ConsentConsumerPortsV1 {
    return {
      contractName: B2_CONSENT_CONTRACT_NAME,
      contractVersion: B2_CONSENT_CONTRACT_VERSION,
      idempotencyScope: B2_CONSENT_IDEMPOTENCY_SCOPE,
      cohortKey: B2_CONSENT_COHORT_KEY,
      cohortVersion: B2_CONSENT_COHORT_VERSION,
    };
  }

  compatibilityCheck(request: B2ConsentRequestV1): B2ConsentCompatibilityResultV1 {
    if (!UUID_PATTERN.test(request.subjectCustomerId)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INVALID_COMMAND',
          message: 'subjectCustomerId must be uuid',
          field: 'subjectCustomerId',
        },
      };
    }
    if (!ALLOWED_PURPOSES.has(request.purpose)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INCOMPATIBLE',
          message: `purpose must be one of ${Array.from(ALLOWED_PURPOSES).join(',')}`,
          field: 'purpose',
        },
      };
    }
    if (request.purpose === 'MARKETING_COMMERCIAL_OFFER' && !request.channel) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INVALID_COMMAND',
          message: 'channel is required for MARKETING_COMMERCIAL_OFFER',
          field: 'channel',
        },
      };
    }
    if (request.purpose !== 'MARKETING_COMMERCIAL_OFFER' && request.channel) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INCOMPATIBLE',
          message: 'channel is allowed only for MARKETING_COMMERCIAL_OFFER',
          field: 'channel',
        },
      };
    }
    if (request.cohortKey !== B2_CONSENT_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_CONSENT_COHORT_KEY)}`,
          field: 'cohortKey',
        },
      };
    }
    if (request.cohortVersion !== B2_CONSENT_COHORT_VERSION) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INCOMPATIBLE',
          message: 'cohortVersion must be 1',
          field: 'cohortVersion',
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_CONSENT_INVALID_COMMAND',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
        },
      };
    }
    return { compatible: true, failure: null };
  }

  computeRequestHash(request: B2ConsentRequestV1): string {
    const payload = {
      subjectCustomerId: request.subjectCustomerId,
      purpose: request.purpose,
      channel: request.channel,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestedState: request.requestedState,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateConsentDecision(request: B2ConsentRequestV1): B2ConsentDecisionV1 {
    const compatibility = this.compatibilityCheck(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }

    const state = request.requestedState;
    const outcome = state as B2ConsentDecisionV1['outcome'];

    const requestHash = this.computeRequestHash(request);
    const consentReference = `${B2_CONSENT_REFERENCE_PREFIX}-${randomUUID()}`;

    const decisionPayload = {
      requestHash,
      subjectCustomerId: request.subjectCustomerId,
      purpose: request.purpose,
      channel: request.channel,
      state,
      outcome,
      cohortKey: request.cohortKey,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      purpose: request.purpose,
      state,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));

    const now = new Date().toISOString();

    return {
      consentReference,
      consentVersion: 1,
      subjectCustomerId: request.subjectCustomerId,
      purpose: request.purpose,
      channel: request.channel,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      state,
      outcome,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_CONSENT_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-CONSENT-AUTHORITY',
      contractVersion: 1,
    };
  }

  transitionState(current: B2ConsentDecisionV1, targetState: B2ConsentState): B2ConsentDecisionV1 {
    const allowed: Record<B2ConsentState, B2ConsentState[]> = {
      PENDING: ['GRANTED'],
      GRANTED: ['REVOKED'],
      REVOKED: ['EXPIRED'],
      EXPIRED: [],
    };

    if (!allowed[current.state].includes(targetState)) {
      throw Object.assign(
        new Error(`invalid consent transition ${current.state} -> ${targetState}`),
        { code: 'B2_CONSENT_INVALID_STATE_TRANSITION' },
      );
    }

    const requestHash = current.requestHash;
    const decisionPayload = {
      consentReference: current.consentReference,
      targetState,
      previousState: current.state,
      purpose: current.purpose,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      consentReference: current.consentReference,
      targetState,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));

    return {
      ...current,
      state: targetState,
      outcome: targetState as B2ConsentDecisionV1['outcome'],
      decisionHash,
      decisionReplayHash,
      updatedAt: new Date().toISOString(),
    };
  }

  replaySafeGenerateConsentDecision(
    request: B2ConsentRequestV1,
    existingByKey?: { decision: B2ConsentDecisionV1; requestHash: string } | null,
  ): B2ConsentReplaySafeResultV1 {
    const requestHash = this.computeRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateConsentDecision(request);
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_CONSENT_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }
}
