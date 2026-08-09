/**
 * B2T08 — B2 API consumer, credential, quota, and rate-limit types.
 *
 * The B2 API consumer registry, credential lifecycle, quota policies, and
 * token-bucket rate limiting are deterministic, replay-safe, and expose
 * only read-only consumer ports to later B2 tasks. Raw secrets are
 * returned once, hashed immediately, and never persisted or logged.
 */

import type { RequestContext } from '../production/request-context';

export type B2ApiConsumerContractName = 'B2-API-CONSUMER';
export type B2ApiConsumerContractVersion = 1;

export type B2ApiConsumerType = 'DEVELOPER' | 'MERCHANT' | 'AGENT' | 'PARTNER';
export type B2ApiConsumerState = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type B2ApiCredentialKind = 'API_KEY' | 'CLIENT_CREDENTIALS';
export type B2ApiCredentialState = 'ISSUED' | 'ROTATED' | 'REVOKED' | 'EXPIRED';
export type B2ApiSandboxType = 'SANDBOX' | 'PRODUCTION';
export type B2ApiQuotaGroup = 'commercial.read' | 'commercial.write' | 'webhooks.manage';
export type B2ApiQuotaState = 'ALLOCATED' | 'EXCEEDED';
export type B2ApiRateLimitBucket =
  | 'global'
  | 'commercial.read'
  | 'commercial.write'
  | 'commercial.activations:write'
  | 'webhooks:delivery';
export type B2ApiRateLimitState = 'ALLOWED' | 'THROTTLED';

export type B2ApiConsumerFailureCode =
  | 'B2_API_CONSUMER_INVALID_COMMAND'
  | 'B2_API_CONSUMER_INCOMPATIBLE'
  | 'B2_API_CONSUMER_NOT_FOUND'
  | 'B2_API_CONSUMER_SUSPENDED'
  | 'B2_API_CONSUMER_REVOKED'
  | 'B2_API_CONSUMER_CONSUMER_EXISTS'
  | 'B2_API_CONSUMER_REPLAY_CONFLICT'
  | 'B2_API_CONSUMER_REPLAY_EXPIRED'
  | 'B2_API_CONSUMER_CREDENTIAL_REVOKED'
  | 'B2_API_CONSUMER_CREDENTIAL_EXPIRED'
  | 'B2_API_CONSUMER_QUOTA_EXCEEDED'
  | 'B2_API_CONSUMER_RATE_LIMITED'
  | 'B2_API_CONSUMER_INVALID_STATE_TRANSITION';

export interface B2ApiConsumerRequestV1 {
  readonly displayName: string;
  readonly consumerType: B2ApiConsumerType;
  readonly ownerCustomerId?: string | null;
  readonly ownerMerchantId?: string | null;
  readonly ownerAgentId?: string | null;
  readonly audience: readonly string[];
  readonly scopes: readonly string[];
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2ApiConsumerDecisionV1 {
  readonly consumerReference: string;
  readonly consumerVersion: 1;
  readonly consumerId: string;
  readonly displayName: string;
  readonly consumerType: B2ApiConsumerType;
  readonly ownerCustomerId: string | null;
  readonly ownerMerchantId: string | null;
  readonly ownerAgentId: string | null;
  readonly audience: readonly string[];
  readonly scopes: readonly string[];
  readonly state: B2ApiConsumerState;
  readonly outcome: B2ApiConsumerState;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.api-consumer.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-API-CONSUMER';
  readonly contractVersion: 1;
}

export interface B2ApiCredentialRequestV1 {
  readonly consumerId: string;
  readonly kind: B2ApiCredentialKind;
  readonly scopes: readonly string[];
  readonly sandboxType: B2ApiSandboxType;
  readonly expirySeconds: number;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2ApiCredentialDecisionV1 {
  readonly credentialReference: string;
  readonly credentialVersion: 1;
  readonly credentialId: string;
  readonly consumerId: string;
  readonly kind: B2ApiCredentialKind;
  readonly keyId: string;
  readonly clientId: string | null;
  readonly secretHash: string;
  readonly rawSecret?: string | null;
  readonly scopes: readonly string[];
  readonly sandboxType: B2ApiSandboxType;
  readonly state: B2ApiCredentialState;
  readonly outcome: B2ApiCredentialState;
  readonly expiryAt: string;
  readonly rotationNextKeyId: string | null;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.api-consumer.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-API-CONSUMER';
  readonly contractVersion: 1;
}

export interface B2ApiQuotaDecisionV1 {
  readonly quotaReference: string;
  readonly consumerId: string;
  readonly quotaGroup: B2ApiQuotaGroup;
  readonly limit: number;
  readonly remaining: number;
  readonly window: string;
  readonly state: B2ApiQuotaState;
  readonly idempotencyScope: 'b2.api-consumer.idempotency.v1';
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface B2ApiRateLimitDecisionV1 {
  readonly bucket: B2ApiRateLimitBucket;
  readonly consumerId: string;
  readonly capacity: number;
  readonly remaining: number;
  readonly refillPerSecond: number;
  readonly strategy: 'TOKEN_BUCKET';
  readonly state: B2ApiRateLimitState;
  readonly retryAfterSeconds: number | null;
}

export interface B2ApiConsumerFailureV1 {
  readonly code: B2ApiConsumerFailureCode;
  readonly message: string;
  readonly field: string | null;
}

export interface B2ApiConsumerReplaySafeResultV1<T> {
  readonly decision: T | null;
  readonly failure: B2ApiConsumerFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2ApiConsumerCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2ApiConsumerFailureV1 | null;
}

export interface B2ApiConsumerConsumerPortsV1 {
  readonly contractName: B2ApiConsumerContractName;
  readonly contractVersion: B2ApiConsumerContractVersion;
  readonly idempotencyScope: 'b2.api-consumer.idempotency.v1';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}
