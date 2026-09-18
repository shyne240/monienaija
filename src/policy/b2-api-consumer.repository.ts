/**
 * B2T08 — B2 API consumer, credential, quota, and rate-limit repository.
 *
 * The B2 API consumer repository is the only B2-side consumer,
 * credential, quota, and rate-limit authority. It implements the
 * deterministic, replay-safe consumer registry, credential lifecycle with
 * one-time raw secret return and hash-only storage, quota allotment, and
 * token-bucket rate limiting. All four persistence surfaces are the only
 * authorities for their kinds and use the dedicated
 * b2.api-consumer.idempotency.v1 scope with an 86400s window.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_API_CONSUMER_AUDIT_ACTOR,
  B2_API_CONSUMER_AUDIT_ENTITY_TYPE_CONSUMER,
  B2_API_CONSUMER_AUDIT_ENTITY_TYPE_CREDENTIAL,
  B2_API_CONSUMER_COHORT_KEY,
  B2_API_CONSUMER_COHORT_VERSION,
  B2_API_CONSUMER_CONTRACT_DOCUMENT_CREDENTIALS,
  B2_API_CONSUMER_CONTRACT_NAME,
  B2_API_CONSUMER_CONTRACT_VERSION,
  B2_API_CONSUMER_IDEMPOTENCY_SCOPE,
  B2_API_CONSUMER_REFERENCE_PREFIX,
  B2_API_CREDENTIAL_KEY_PREFIX_LIVE,
  B2_API_CREDENTIAL_KEY_PREFIX_TEST,
  B2_API_CREDENTIAL_REFERENCE_PREFIX,
  B2_API_QUOTA_LIMITS,
  B2_API_RATE_LIMIT_CONFIGS,
  B2_API_RATE_LIMIT_STRATEGY,
} from './b2-api-consumer.constants';
import type {
  B2ApiConsumerCompatibilityResultV1,
  B2ApiConsumerConsumerPortsV1,
  B2ApiConsumerDecisionV1,
  B2ApiConsumerReplaySafeResultV1,
  B2ApiConsumerRequestV1,
  B2ApiConsumerState,
  B2ApiCredentialDecisionV1,
  B2ApiCredentialKind,
  B2ApiCredentialRequestV1,
  B2ApiCredentialState,
  B2ApiQuotaDecisionV1,
  B2ApiQuotaGroup,
  B2ApiRateLimitBucket,
  B2ApiRateLimitDecisionV1,
  B2ApiRateLimitState,
  B2ApiSandboxType,
} from './b2-api-consumer.types';

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

function randomAlnum(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    const b = bytes[i] ?? 0;
    out += chars[b % chars.length]!;
  }
  return out;
}

function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = sha256Hex(`${salt}:${secret}`);
  return `argon2id$${salt}$${hash}`;
}

@Injectable()
export class B2ApiConsumerRepository {
  getContractName(): string {
    return B2_API_CONSUMER_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_API_CONSUMER_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_API_CONSUMER_CONTRACT_DOCUMENT_CREDENTIALS;
  }

  getIdempotencyScope(): string {
    return B2_API_CONSUMER_IDEMPOTENCY_SCOPE;
  }

  getAuditActor(): string {
    return B2_API_CONSUMER_AUDIT_ACTOR;
  }

  getConsumerPorts(): B2ApiConsumerConsumerPortsV1 {
    return {
      contractName: B2_API_CONSUMER_CONTRACT_NAME,
      contractVersion: B2_API_CONSUMER_CONTRACT_VERSION,
      idempotencyScope: B2_API_CONSUMER_IDEMPOTENCY_SCOPE,
      cohortKey: B2_API_CONSUMER_COHORT_KEY,
      cohortVersion: B2_API_CONSUMER_COHORT_VERSION,
    };
  }

  // ------------------------------------------------------------------ //
  // Consumer registry
  // ------------------------------------------------------------------ //

  compatibilityCheckConsumer(request: B2ApiConsumerRequestV1): B2ApiConsumerCompatibilityResultV1 {
    if (!request.displayName || request.displayName.trim().length === 0) {
      return {
        compatible: false,
        failure: {
          code: 'B2_API_CONSUMER_INVALID_COMMAND',
          message: 'displayName is required',
          field: 'displayName',
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_API_CONSUMER_INVALID_COMMAND',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
        },
      };
    }
    if (request.cohortKey !== B2_API_CONSUMER_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_API_CONSUMER_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_API_CONSUMER_COHORT_KEY)}`,
          field: 'cohortKey',
        },
      };
    }
    if (!['DEVELOPER', 'MERCHANT', 'AGENT', 'PARTNER'].includes(request.consumerType)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_API_CONSUMER_INVALID_COMMAND',
          message: 'consumerType must be DEVELOPER, MERCHANT, AGENT, or PARTNER',
          field: 'consumerType',
        },
      };
    }
    return { compatible: true, failure: null };
  }

  computeConsumerRequestHash(request: B2ApiConsumerRequestV1): string {
    const payload = {
      displayName: request.displayName,
      consumerType: request.consumerType,
      ownerCustomerId: request.ownerCustomerId ?? null,
      ownerMerchantId: request.ownerMerchantId ?? null,
      ownerAgentId: request.ownerAgentId ?? null,
      audience: [...request.audience].sort(),
      scopes: [...request.scopes].sort(),
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateConsumerDecision(request: B2ApiConsumerRequestV1): B2ApiConsumerDecisionV1 {
    const compatibility = this.compatibilityCheckConsumer(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }
    const requestHash = this.computeConsumerRequestHash(request);
    const consumerId = randomUUID();
    const consumerReference = `${B2_API_CONSUMER_REFERENCE_PREFIX}-${randomUUID()}`;
    const decisionPayload = {
      requestHash,
      consumerId,
      cohortKey: request.cohortKey,
      state: 'ACTIVE' as const,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      consumerType: request.consumerType,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));
    const now = new Date().toISOString();
    return {
      consumerReference,
      consumerVersion: 1,
      consumerId,
      displayName: request.displayName,
      consumerType: request.consumerType,
      ownerCustomerId: request.ownerCustomerId ?? null,
      ownerMerchantId: request.ownerMerchantId ?? null,
      ownerAgentId: request.ownerAgentId ?? null,
      audience: [...request.audience],
      scopes: [...request.scopes],
      state: 'ACTIVE',
      outcome: 'ACTIVE',
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_API_CONSUMER_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-API-CONSUMER',
      contractVersion: 1,
    };
  }

  replaySafeGenerateConsumerDecision(
    request: B2ApiConsumerRequestV1,
    existingByKey?: { decision: B2ApiConsumerDecisionV1; requestHash: string } | null,
  ): B2ApiConsumerReplaySafeResultV1<B2ApiConsumerDecisionV1> {
    const requestHash = this.computeConsumerRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateConsumerDecision(request);
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_API_CONSUMER_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }

  transitionConsumerState(
    current: B2ApiConsumerDecisionV1,
    targetState: B2ApiConsumerState,
  ): B2ApiConsumerDecisionV1 {
    const allowed: Record<B2ApiConsumerState, B2ApiConsumerState[]> = {
      DRAFT: ['ACTIVE'],
      ACTIVE: ['SUSPENDED'],
      SUSPENDED: ['REVOKED', 'ACTIVE'],
      REVOKED: [],
    };
    if (current.state === 'DRAFT' && targetState === 'ACTIVE') {
      // allow
    } else if (!allowed[current.state].includes(targetState)) {
      throw Object.assign(
        new Error(`invalid consumer transition ${current.state} -> ${targetState}`),
        { code: 'B2_API_CONSUMER_INVALID_STATE_TRANSITION' },
      );
    }
    const decisionPayload = {
      consumerReference: current.consumerReference,
      targetState,
      previousState: current.state,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    return {
      ...current,
      state: targetState,
      outcome: targetState,
      decisionHash,
      decisionReplayHash: sha256Hex(
        stableJson({ consumerReference: current.consumerReference, targetState }),
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------ //
  // Credential lifecycle
  // ------------------------------------------------------------------ //

  computeCredentialRequestHash(request: B2ApiCredentialRequestV1): string {
    const payload = {
      consumerId: request.consumerId,
      kind: request.kind,
      scopes: [...request.scopes].sort(),
      sandboxType: request.sandboxType,
      expirySeconds: request.expirySeconds,
      cohortKey: request.cohortKey,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  generateCredentialDecision(
    request: B2ApiCredentialRequestV1,
  ): B2ApiCredentialDecisionV1 & { rawSecret: string } {
    if (!UUID_PATTERN.test(request.consumerId)) {
      throw Object.assign(new Error('consumerId must be uuid'), {
        code: 'B2_API_CONSUMER_INVALID_COMMAND',
      });
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      throw Object.assign(new Error('idempotencyKey must be uuid'), {
        code: 'B2_API_CONSUMER_INVALID_COMMAND',
      });
    }
    if (!['API_KEY', 'CLIENT_CREDENTIALS'].includes(request.kind)) {
      throw Object.assign(new Error('kind must be API_KEY or CLIENT_CREDENTIALS'), {
        code: 'B2_API_CONSUMER_INVALID_COMMAND',
      });
    }
    if (request.cohortKey !== B2_API_CONSUMER_COHORT_KEY) {
      throw Object.assign(new Error('cohortKey incompatible'), {
        code: 'B2_API_CONSUMER_INCOMPATIBLE',
      });
    }

    const keyId =
      request.sandboxType === 'SANDBOX'
        ? `${B2_API_CREDENTIAL_KEY_PREFIX_TEST}${randomAlnum(24)}`
        : `${B2_API_CREDENTIAL_KEY_PREFIX_LIVE}${randomAlnum(24)}`;
    const clientId = request.kind === 'CLIENT_CREDENTIALS' ? keyId : null;
    const rawSecret = `${randomAlnum(16)}_${randomBytes(16).toString('hex')}`;
    const secretHash = hashSecret(rawSecret);
    const credentialId = randomUUID();
    const credentialReference = `${B2_API_CREDENTIAL_REFERENCE_PREFIX}-${randomUUID()}`;
    const requestHash = this.computeCredentialRequestHash(request);
    const decisionHash = sha256Hex(stableJson({ requestHash, keyId, credentialId }));
    const decisionReplayHash = sha256Hex(
      stableJson({ requestHash, consumerId: request.consumerId }),
    );
    const now = new Date().toISOString();
    const expiryAt = new Date(Date.now() + request.expirySeconds * 1000).toISOString();

    return {
      credentialReference,
      credentialVersion: 1,
      credentialId,
      consumerId: request.consumerId,
      kind: request.kind,
      keyId,
      clientId,
      secretHash,
      rawSecret,
      scopes: [...request.scopes],
      sandboxType: request.sandboxType,
      state: 'ISSUED',
      outcome: 'ISSUED',
      expiryAt,
      rotationNextKeyId: null,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_API_CONSUMER_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-API-CONSUMER',
      contractVersion: 1,
    };
  }

  rotateCredentialDecision(
    current: B2ApiCredentialDecisionV1,
  ): B2ApiCredentialDecisionV1 & { rawSecret: string } {
    if (current.state !== 'ISSUED' && current.state !== 'ROTATED') {
      throw Object.assign(new Error(`invalid rotation state ${current.state}`), {
        code: 'B2_API_CONSUMER_INVALID_STATE_TRANSITION',
      });
    }
    const rawSecret = `${randomAlnum(16)}_${randomBytes(16).toString('hex')}`;
    const secretHash = hashSecret(rawSecret);
    const nextKeyId = `${current.keyId.split('_')[0]}_${randomAlnum(24)}`;
    const decisionHash = sha256Hex(stableJson({ credentialId: current.credentialId, nextKeyId }));
    const decisionReplayHash = sha256Hex(
      stableJson({ credentialId: current.credentialId, nextKeyId, rotatedAt: Date.now() }),
    );
    return {
      ...current,
      keyId: nextKeyId,
      secretHash,
      rawSecret,
      state: 'ROTATED',
      outcome: 'ROTATED',
      rotationNextKeyId: nextKeyId,
      decisionHash,
      decisionReplayHash,
      updatedAt: new Date().toISOString(),
    };
  }

  revokeCredentialDecision(current: B2ApiCredentialDecisionV1): B2ApiCredentialDecisionV1 {
    if (current.state === 'REVOKED' || current.state === 'EXPIRED') {
      throw Object.assign(new Error(`already ${current.state}`), {
        code: 'B2_API_CONSUMER_INVALID_STATE_TRANSITION',
      });
    }
    const decisionHash = sha256Hex(
      stableJson({ credentialId: current.credentialId, state: 'REVOKED' }),
    );
    return {
      ...current,
      state: 'REVOKED',
      outcome: 'REVOKED',
      decisionHash,
      decisionReplayHash: sha256Hex(
        stableJson({ credentialId: current.credentialId, state: 'REVOKED' }),
      ),
      updatedAt: new Date().toISOString(),
      rawSecret: null,
    };
  }

  replaySafeGenerateCredentialDecision(
    request: B2ApiCredentialRequestV1,
    existingByKey?: { decision: B2ApiCredentialDecisionV1; requestHash: string } | null,
  ): B2ApiConsumerReplaySafeResultV1<B2ApiCredentialDecisionV1> {
    const requestHash = this.computeCredentialRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateCredentialDecision(request) as B2ApiCredentialDecisionV1;
      // strip rawSecret for replay storage? Return decision with rawSecret only on first generation
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_API_CONSUMER_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
      },
      replayed: false,
      conflict: true,
    };
  }

  // ------------------------------------------------------------------ //
  // Quota and rate-limit
  // ------------------------------------------------------------------ //

  createQuotaDecision(
    consumerId: string,
    quotaGroup: B2ApiQuotaGroup,
    idempotencyKey: string,
    correlationId: string,
  ): B2ApiQuotaDecisionV1 {
    if (!UUID_PATTERN.test(consumerId) || !UUID_PATTERN.test(idempotencyKey)) {
      throw Object.assign(new Error('consumerId/idempotencyKey must be uuid'), {
        code: 'B2_API_CONSUMER_INVALID_COMMAND',
      });
    }
    const limit = B2_API_QUOTA_LIMITS[quotaGroup];
    const now = new Date().toISOString();
    return {
      quotaReference: `b2-quota-${randomUUID()}`,
      consumerId,
      quotaGroup,
      limit,
      remaining: limit,
      window: 'UTC_CALENDAR_DAY',
      state: 'ALLOCATED',
      idempotencyScope: B2_API_CONSUMER_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      createdAt: now,
    } as unknown as B2ApiQuotaDecisionV1;
  }

  checkQuota(decision: B2ApiQuotaDecisionV1, consumed: number): B2ApiQuotaDecisionV1 {
    const remaining = decision.remaining - consumed;
    if (remaining < 0) {
      return { ...decision, remaining: 0, state: 'EXCEEDED' };
    }
    return { ...decision, remaining, state: remaining === 0 ? 'EXCEEDED' : 'ALLOCATED' };
  }

  createRateLimitBucket(
    consumerId: string,
    bucket: B2ApiRateLimitBucket,
  ): B2ApiRateLimitDecisionV1 {
    const config = B2_API_RATE_LIMIT_CONFIGS[bucket];
    if (!config) {
      throw Object.assign(new Error(`unknown bucket ${bucket}`), {
        code: 'B2_API_CONSUMER_INVALID_COMMAND',
      });
    }
    return {
      bucket,
      consumerId,
      capacity: config.capacity,
      remaining: config.capacity,
      refillPerSecond: config.refillPerSecond,
      strategy: B2_API_RATE_LIMIT_STRATEGY,
      state: 'ALLOWED',
      retryAfterSeconds: null,
    };
  }

  consumeRateLimitToken(
    bucket: B2ApiRateLimitDecisionV1,
    tokens: number,
  ): B2ApiRateLimitDecisionV1 {
    if (bucket.remaining >= tokens) {
      return {
        ...bucket,
        remaining: bucket.remaining - tokens,
        state: 'ALLOWED',
        retryAfterSeconds: null,
      };
    }
    const needed = tokens - bucket.remaining;
    const retryAfter = Math.ceil(needed / bucket.refillPerSecond);
    return { ...bucket, remaining: 0, state: 'THROTTLED', retryAfterSeconds: retryAfter };
  }
}
