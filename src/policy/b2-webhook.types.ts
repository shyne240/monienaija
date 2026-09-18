/**
 * B2T09 — B2 webhook authority types.
 *
 * The B2 webhook authority is deterministic, replay-safe, and exposes
 * only read-only consumer ports to later B2 tasks. It implements the
 * only B2 webhook registration and delivery lifecycle for the first
 * cohort `b2.activation.cohort.inbound-funding` v1 with dedicated
 * idempotency and deterministic hashes.
 */

import type { RequestContext } from '../production/request-context';

export type B2WebhookContractName = 'B2-WEBHOOK-AUTHORITY';
export type B2WebhookContractVersion = 1;

export type B2WebhookEventType =
  | 'b2.activation.succeeded'
  | 'b2.activation.suspended'
  | 'b2.webhook.test'
  | 'b1.commercial.invoice.created';

export type B2WebhookRegistrationState =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'SUSPENDED'
  | 'REVOKED';

export type B2WebhookDeliveryState =
  | 'ENQUEUED'
  | 'DELIVERED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'DEAD_LETTER';

export type B2WebhookHmacAlgorithm = 'HMAC_SHA256';

export type B2WebhookFailureCode =
  | 'B2_WEBHOOK_INVALID_COMMAND'
  | 'B2_WEBHOOK_INCOMPATIBLE'
  | 'B2_WEBHOOK_PROHIBITED'
  | 'B2_WEBHOOK_URL_NOT_ALLOWED'
  | 'B2_WEBHOOK_CHALLENGE_FAILED'
  | 'B2_WEBHOOK_NOT_VERIFIED'
  | 'B2_WEBHOOK_REPLAY_CONFLICT'
  | 'B2_WEBHOOK_REPLAY_DETECTED'
  | 'B2_WEBHOOK_TIMESTAMP_STALE'
  | 'B2_WEBHOOK_SIGNATURE_INVALID'
  | 'B2_WEBHOOK_DELIVERY_ID_DUPLICATE'
  | 'B2_WEBHOOK_NOT_FOUND';

export interface B2WebhookRegistrationRequestV1 {
  readonly consumerId: string;
  readonly url: string;
  readonly events: readonly B2WebhookEventType[];
  readonly secret: string;
  readonly hmacAlgorithm: B2WebhookHmacAlgorithm;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2WebhookRegistrationDecisionV1 {
  readonly registrationReference: string;
  readonly registrationVersion: 1;
  readonly registrationId: string;
  readonly consumerId: string;
  readonly url: string;
  readonly events: readonly B2WebhookEventType[];
  readonly hmacAlgorithm: B2WebhookHmacAlgorithm;
  readonly secretHash: string;
  readonly challengeNonce: string;
  readonly state: B2WebhookRegistrationState;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.webhook.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-WEBHOOK-AUTHORITY';
  readonly contractVersion: 1;
}

export interface B2WebhookDeliveryRequestV1 {
  readonly registrationId: string;
  readonly event: B2WebhookEventType;
  readonly payload: Record<string, unknown>;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2WebhookDeliveryDecisionV1 {
  readonly deliveryReference: string;
  readonly deliveryVersion: 1;
  readonly deliveryId: string;
  readonly registrationId: string;
  readonly consumerId: string;
  readonly event: B2WebhookEventType;
  readonly url: string;
  readonly payloadHash: string;
  readonly signature: string;
  readonly timestamp: number;
  readonly deliveryIdHeader: string;
  readonly attempt: number;
  readonly maxAttempts: 5;
  readonly state: B2WebhookDeliveryState;
  readonly nextAttemptAt: string | null;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.webhook.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-WEBHOOK-AUTHORITY';
  readonly contractVersion: 1;
}

export interface B2WebhookFailureV1 {
  readonly code: B2WebhookFailureCode;
  readonly message: string;
  readonly field: string | null;
}

export interface B2WebhookReplaySafeResultV1<T> {
  readonly decision: T | null;
  readonly failure: B2WebhookFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2WebhookCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2WebhookFailureV1 | null;
}

export interface B2WebhookConsumerPortsV1 {
  readonly contractName: B2WebhookContractName;
  readonly contractVersion: B2WebhookContractVersion;
  readonly idempotencyScope: 'b2.webhook.idempotency.v1';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}

export interface B2WebhookVerificationResultV1 {
  readonly verified: boolean;
  readonly failure: B2WebhookFailureV1 | null;
}

export interface B2WebhookSignatureVerificationRequestV1 {
  readonly secret: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: number;
  readonly deliveryId: string;
  readonly signature: string;
}
