/**
 * B2T09 — B2 webhook authority repository.
 *
 * The B2 webhook repository is the only B2-side webhook authority. It
 * implements deterministic, replay-safe webhook registration with
 * HTTPS-only allowlist validation and challenge-response verification,
 * HMAC-SHA256 signing, delivery attempts, bounded retry with exponential
 * backoff, dead-letter handling, event lifecycle, delivery state machine,
 * replay protection, timestamp freshness (300s), and Delivery-Id
 * uniqueness. The dedicated `b2.webhook.idempotency.v1` scope is
 * replay-safe with an 86400s window and deterministic hashes.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_WEBHOOK_ALLOWLIST_HOSTS,
  B2_WEBHOOK_AUDIT_ACTOR,
  B2_WEBHOOK_AUDIT_ENTITY_TYPE_DELIVERY,
  B2_WEBHOOK_AUDIT_ENTITY_TYPE_REGISTRATION,
  B2_WEBHOOK_COHORT_KEY,
  B2_WEBHOOK_COHORT_VERSION,
  B2_WEBHOOK_CONTRACT_DOCUMENT,
  B2_WEBHOOK_CONTRACT_NAME,
  B2_WEBHOOK_CONTRACT_VERSION,
  B2_WEBHOOK_DELIVERY_MAX_ATTEMPTS,
  B2_WEBHOOK_HMAC_ALGORITHM,
  B2_WEBHOOK_IDEMPOTENCY_SCOPE,
  B2_WEBHOOK_REGISTRATION_REFERENCE_PREFIX,
  B2_WEBHOOK_DELIVERY_REFERENCE_PREFIX,
  B2_WEBHOOK_RETRY_BACKOFF_SECONDS,
  B2_WEBHOOK_TIMESTAMP_FRESHNESS_SECONDS,
} from './b2-webhook.constants';
import type {
  B2WebhookCompatibilityResultV1,
  B2WebhookConsumerPortsV1,
  B2WebhookDeliveryDecisionV1,
  B2WebhookDeliveryRequestV1,
  B2WebhookEventType,
  B2WebhookFailureV1,
  B2WebhookRegistrationDecisionV1,
  B2WebhookRegistrationRequestV1,
  B2WebhookReplaySafeResultV1,
  B2WebhookSignatureVerificationRequestV1,
  B2WebhookVerificationResultV1,
} from './b2-webhook.types';

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

function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = sha256Hex(`${salt}:${secret}`);
  return `argon2id$${salt}$${hash}`;
}

function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowlistedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (B2_WEBHOOK_ALLOWLIST_HOSTS as readonly string[]).includes(host);
  } catch {
    return false;
  }
}

@Injectable()
export class B2WebhookRepository {
  getContractName(): string {
    return B2_WEBHOOK_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_WEBHOOK_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_WEBHOOK_CONTRACT_DOCUMENT;
  }

  getIdempotencyScope(): string {
    return B2_WEBHOOK_IDEMPOTENCY_SCOPE;
  }

  getAuditActor(): string {
    return B2_WEBHOOK_AUDIT_ACTOR;
  }

  getConsumerPorts(): B2WebhookConsumerPortsV1 {
    return {
      contractName: B2_WEBHOOK_CONTRACT_NAME,
      contractVersion: B2_WEBHOOK_CONTRACT_VERSION,
      idempotencyScope: B2_WEBHOOK_IDEMPOTENCY_SCOPE,
      cohortKey: B2_WEBHOOK_COHORT_KEY,
      cohortVersion: B2_WEBHOOK_COHORT_VERSION,
    };
  }

  // ------------------------------------------------------------------ //
  // Registration
  // ------------------------------------------------------------------ //

  compatibilityCheckRegistration(
    request: B2WebhookRegistrationRequestV1,
  ): B2WebhookCompatibilityResultV1 {
    if (!UUID_PATTERN.test(request.consumerId)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_INVALID_COMMAND',
          message: 'consumerId must be uuid',
          field: 'consumerId',
        },
      };
    }
    if (!isHttpsUrl(request.url)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_URL_NOT_ALLOWED',
          message: 'url must be https',
          field: 'url',
        },
      };
    }
    if (!isAllowlistedHost(request.url)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_URL_NOT_ALLOWED',
          message: `host must be one of ${B2_WEBHOOK_ALLOWLIST_HOSTS.join(',')}`,
          field: 'url',
        },
      };
    }
    if (!request.events || request.events.length === 0) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_INVALID_COMMAND',
          message: 'events must be non-empty',
          field: 'events',
        },
      };
    }
    if (request.hmacAlgorithm !== B2_WEBHOOK_HMAC_ALGORITHM) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_INVALID_COMMAND',
          message: 'hmacAlgorithm must be HMAC_SHA256',
          field: 'hmacAlgorithm',
        },
      };
    }
    if (request.cohortKey !== B2_WEBHOOK_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_WEBHOOK_COHORT_KEY)}`,
          field: 'cohortKey',
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_WEBHOOK_INVALID_COMMAND',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
        },
      };
    }
    return { compatible: true, failure: null };
  }

  computeRegistrationRequestHash(request: B2WebhookRegistrationRequestV1): string {
    const payload = {
      consumerId: request.consumerId,
      url: request.url,
      events: [...request.events].sort(),
      hmacAlgorithm: request.hmacAlgorithm,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateRegistrationDecision(
    request: B2WebhookRegistrationRequestV1,
  ): B2WebhookRegistrationDecisionV1 {
    const compatibility = this.compatibilityCheckRegistration(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }
    const requestHash = this.computeRegistrationRequestHash(request);
    const registrationId = randomUUID();
    const registrationReference = `${B2_WEBHOOK_REGISTRATION_REFERENCE_PREFIX}-${randomUUID()}`;
    const secretHash = hashSecret(request.secret);
    const challengeNonce = randomBytes(16).toString('hex');
    const decisionPayload = {
      requestHash,
      consumerId: request.consumerId,
      url: request.url,
      events: [...request.events].sort(),
      cohortKey: request.cohortKey,
      state: 'PENDING_VERIFICATION' as const,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      consumerId: request.consumerId,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));
    const now = new Date().toISOString();
    return {
      registrationReference,
      registrationVersion: 1,
      registrationId,
      consumerId: request.consumerId,
      url: request.url,
      events: [...request.events],
      hmacAlgorithm: request.hmacAlgorithm,
      secretHash,
      challengeNonce,
      state: 'PENDING_VERIFICATION',
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_WEBHOOK_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-WEBHOOK-AUTHORITY',
      contractVersion: 1,
    };
  }

  verifyRegistrationChallenge(
    decision: B2WebhookRegistrationDecisionV1,
    providedChallenge: string,
  ): {
    verified: boolean;
    decision: B2WebhookRegistrationDecisionV1;
    failure: B2WebhookFailureV1 | null;
  } {
    if (providedChallenge === decision.challengeNonce) {
      const updated: B2WebhookRegistrationDecisionV1 = {
        ...decision,
        state: 'VERIFIED',
        decisionHash: sha256Hex(
          stableJson({ registrationId: decision.registrationId, state: 'VERIFIED' }),
        ),
        decisionReplayHash: sha256Hex(
          stableJson({ registrationId: decision.registrationId, state: 'VERIFIED' }),
        ),
        updatedAt: new Date().toISOString(),
      };
      return { verified: true, decision: updated, failure: null };
    }
    return {
      verified: false,
      decision,
      failure: {
        code: 'B2_WEBHOOK_CHALLENGE_FAILED',
        message: 'challenge response does not match',
        field: 'challenge',
      },
    };
  }

  replaySafeGenerateRegistrationDecision(
    request: B2WebhookRegistrationRequestV1,
    existingByKey?: { decision: B2WebhookRegistrationDecisionV1; requestHash: string } | null,
  ): B2WebhookReplaySafeResultV1<B2WebhookRegistrationDecisionV1> {
    const requestHash = this.computeRegistrationRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateRegistrationDecision(request);
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_WEBHOOK_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }

  // ------------------------------------------------------------------ //
  // Delivery
  // ------------------------------------------------------------------ //

  computeDeliveryRequestHash(request: B2WebhookDeliveryRequestV1): string {
    const payload = {
      registrationId: request.registrationId,
      event: request.event,
      payload: request.payload,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateDeliveryDecision(
    request: B2WebhookDeliveryRequestV1,
    registration: B2WebhookRegistrationDecisionV1,
    secretForSigning: string,
  ): B2WebhookDeliveryDecisionV1 {
    if (registration.state !== 'VERIFIED') {
      throw Object.assign(new Error('registration must be VERIFIED'), {
        code: 'B2_WEBHOOK_NOT_VERIFIED',
      });
    }
    const requestHash = this.computeDeliveryRequestHash(request);
    const deliveryId = randomUUID();
    const deliveryReference = `${B2_WEBHOOK_DELIVERY_REFERENCE_PREFIX}-${randomUUID()}`;
    const payloadHash = sha256Hex(stableJson(request.payload));
    const timestamp = Math.floor(Date.now() / 1000);
    const signaturePayload = `${payloadHash}.${timestamp}.${deliveryId}`;
    const signature = `sha256=${createHmac('sha256', secretForSigning).update(signaturePayload).digest('hex')}`;
    const decisionPayload = {
      requestHash,
      registrationId: request.registrationId,
      event: request.event,
      payloadHash,
      deliveryId,
      state: 'ENQUEUED' as const,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      registrationId: request.registrationId,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));
    const now = new Date().toISOString();
    return {
      deliveryReference,
      deliveryVersion: 1,
      deliveryId,
      registrationId: request.registrationId,
      consumerId: registration.consumerId,
      event: request.event,
      url: registration.url,
      payloadHash,
      signature,
      timestamp,
      deliveryIdHeader: deliveryId,
      attempt: 1,
      maxAttempts: B2_WEBHOOK_DELIVERY_MAX_ATTEMPTS,
      state: 'ENQUEUED',
      nextAttemptAt: null,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_WEBHOOK_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-WEBHOOK-AUTHORITY',
      contractVersion: 1,
    };
  }

  verifyHmacSignature(
    request: B2WebhookSignatureVerificationRequestV1,
  ): B2WebhookVerificationResultV1 {
    const payloadHash = sha256Hex(stableJson(request.payload));
    const signaturePayload = `${payloadHash}.${request.timestamp}.${request.deliveryId}`;
    const expected = `sha256=${createHmac('sha256', request.secret).update(signaturePayload).digest('hex')}`;
    if (expected !== request.signature) {
      return {
        verified: false,
        failure: {
          code: 'B2_WEBHOOK_SIGNATURE_INVALID',
          message: 'HMAC signature does not match',
          field: 'signature',
        },
      };
    }
    return { verified: true, failure: null };
  }

  checkTimestampFreshness(
    timestamp: number,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): B2WebhookVerificationResultV1 {
    const diff = Math.abs(nowSeconds - timestamp);
    if (diff > B2_WEBHOOK_TIMESTAMP_FRESHNESS_SECONDS) {
      return {
        verified: false,
        failure: {
          code: 'B2_WEBHOOK_TIMESTAMP_STALE',
          message: `timestamp outside ${B2_WEBHOOK_TIMESTAMP_FRESHNESS_SECONDS}s window`,
          field: 'timestamp',
        },
      };
    }
    return { verified: true, failure: null };
  }

  checkDeliveryIdUnique(deliveryId: string, seen: Set<string>): B2WebhookVerificationResultV1 {
    if (seen.has(deliveryId)) {
      return {
        verified: false,
        failure: {
          code: 'B2_WEBHOOK_DELIVERY_ID_DUPLICATE',
          message: 'Delivery-Id already seen',
          field: 'deliveryId',
        },
      };
    }
    return { verified: true, failure: null };
  }

  getNextAttemptAt(attempt: number): string | null {
    if (attempt > B2_WEBHOOK_DELIVERY_MAX_ATTEMPTS) return null;
    const backoff = B2_WEBHOOK_RETRY_BACKOFF_SECONDS[attempt - 1] ?? 900;
    const next = new Date(Date.now() + backoff * 1000);
    return next.toISOString();
  }

  transitionDeliveryState(
    current: B2WebhookDeliveryDecisionV1,
    targetState: B2WebhookDeliveryDecisionV1['state'],
    options?: { attempt?: number },
  ): B2WebhookDeliveryDecisionV1 {
    const attempt = options?.attempt ?? current.attempt;
    if (targetState === 'FAILED_RETRYABLE') {
      if (attempt >= B2_WEBHOOK_DELIVERY_MAX_ATTEMPTS) {
        return this.transitionDeliveryState(current, 'DEAD_LETTER');
      }
      const nextAttemptAt = this.getNextAttemptAt(attempt);
      return {
        ...current,
        state: 'FAILED_RETRYABLE',
        attempt: attempt + 1,
        nextAttemptAt,
        decisionHash: sha256Hex(
          stableJson({
            deliveryId: current.deliveryId,
            state: 'FAILED_RETRYABLE',
            attempt: attempt + 1,
          }),
        ),
        decisionReplayHash: sha256Hex(
          stableJson({ deliveryId: current.deliveryId, state: 'FAILED_RETRYABLE' }),
        ),
        updatedAt: new Date().toISOString(),
      };
    }
    if (targetState === 'DEAD_LETTER') {
      return {
        ...current,
        state: 'DEAD_LETTER',
        nextAttemptAt: null,
        decisionHash: sha256Hex(
          stableJson({ deliveryId: current.deliveryId, state: 'DEAD_LETTER' }),
        ),
        decisionReplayHash: sha256Hex(
          stableJson({ deliveryId: current.deliveryId, state: 'DEAD_LETTER' }),
        ),
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      ...current,
      state: targetState,
      nextAttemptAt: targetState === 'DELIVERED' ? null : this.getNextAttemptAt(attempt),
      decisionHash: sha256Hex(stableJson({ deliveryId: current.deliveryId, state: targetState })),
      decisionReplayHash: sha256Hex(
        stableJson({ deliveryId: current.deliveryId, state: targetState }),
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  replaySafeGenerateDeliveryDecision(
    request: B2WebhookDeliveryRequestV1,
    registration: B2WebhookRegistrationDecisionV1,
    secretForSigning: string,
    existingByKey?: { decision: B2WebhookDeliveryDecisionV1; requestHash: string } | null,
  ): B2WebhookReplaySafeResultV1<B2WebhookDeliveryDecisionV1> {
    const requestHash = this.computeDeliveryRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateDeliveryDecision(request, registration, secretForSigning);
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_WEBHOOK_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }
}
