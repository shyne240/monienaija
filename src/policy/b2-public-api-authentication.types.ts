/**
 * B2T10 — B2 public API authentication and B1 capability exposure types.
 *
 * The B2 public API authentication integrates every public B2 route
 * through A2 audience/scope/token-expiry, consumer ACTIVE, credential
 * ISSUED/ROTATED, consent GRANTED, A4 ELIGIBLE, quota ALLOCATED, and
 * rate-limit ALLOWED, and exposes B1 catalog/plan/tier and B2
 * activation as audience-scoped, minimized reads. It is deterministic,
 * replay-safe, and exposes only read-only consumer ports to later B2
 * tasks.
 */

import type { RequestContext } from '../production/request-context';

export type B2PublicApiAuthenticationContractName = 'B2-PUBLIC-API-AUTHENTICATION';
export type B2PublicApiAuthenticationContractVersion = 1;

export type B2PublicApiRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type B2PublicApiRoutePath =
  | '/v1/commercial/activations'
  | '/v1/commercial/activations/{activationReference}'
  | '/v1/commercial/catalog'
  | '/v1/commercial/plans/{planKey}'
  | '/v1/commercial/tiers/{tierKey}'
  | '/v1/auth/token'
  | '/v1/webhooks/registrations'
  | '/v1/consents'
  | '/v1/health'
  | '/v1/support/activations/{activationReference}';

export type B2PublicApiAudience =
  | 'public:commercial:activation:b2:inbound-funding:read'
  | 'public:commercial:activation:b2:inbound-funding:write'
  | 'public:webhooks:b2:manage'
  | 'public:consents:b2:manage'
  | 'public:support:b2:read'
  | 'public:auth:token:exchange';

export type B2PublicApiScope =
  | 'b2:activation:read'
  | 'b2:activation:write'
  | 'b2:webhooks:manage'
  | 'b2:consents:manage'
  | 'b2:support:read'
  | 'b2:auth:token:exchange';

export type B2PublicApiAuthOutcome =
  | 'AUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'WRONG_AUDIENCE'
  | 'EXPIRED'
  | 'WRONG_SCOPE'
  | 'CONSUMER_NOT_ACTIVE'
  | 'CREDENTIAL_REVOKED'
  | 'CONSENT_REQUIRED'
  | 'ACTIVATION_REQUIRED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'REJECTED';

export type B2PublicApiFailureCode =
  | 'B2_AUTH_UNAUTHORIZED'
  | 'B2_AUTH_FORBIDDEN'
  | 'B2_AUTH_WRONG_AUDIENCE'
  | 'B2_AUTH_EXPIRED'
  | 'B2_AUTH_WRONG_SCOPE'
  | 'B2_AUTH_CONSUMER_NOT_ACTIVE'
  | 'B2_AUTH_CREDENTIAL_REVOKED'
  | 'B2_AUTH_CONSENT_REQUIRED'
  | 'B2_AUTH_ACTIVATION_REQUIRED'
  | 'B2_AUTH_QUOTA_EXCEEDED'
  | 'B2_AUTH_RATE_LIMITED'
  | 'B2_AUTH_NOT_FOUND'
  | 'B2_AUTH_REPLAY_CONFLICT'
  | 'B2_AUTH_INCOMPATIBLE'
  | 'B2_AUTH_A4_NOT_ELIGIBLE';

export interface B2PublicApiAuthTokenV1 {
  readonly aud: B2PublicApiAudience;
  readonly scope: B2PublicApiScope;
  readonly exp: number;
  readonly sub: string;
  readonly iss: string;
  readonly iat: number;
}

export interface B2PublicApiAuthenticationRequestV1 {
  readonly method: B2PublicApiRouteMethod;
  readonly pathTemplate: B2PublicApiRoutePath;
  readonly pathParams?: Record<string, string>;
  readonly token: B2PublicApiAuthTokenV1 | null;
  readonly consumerState: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'DRAFT';
  readonly credentialState: 'ISSUED' | 'ROTATED' | 'REVOKED' | 'EXPIRED';
  readonly consentState: 'GRANTED' | 'REVOKED' | 'PENDING' | null;
  readonly activationState: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REVOKED' | null;
  readonly quotaState: 'ALLOCATED' | 'EXCEEDED';
  readonly rateLimitState: 'ALLOWED' | 'THROTTLED';
  readonly a4EligibilityState: 'ELIGIBLE' | 'INELIGIBLE';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly requestedPlanKey?: string | null;
  readonly requestedTierKey?: string | null;
  readonly hasBillingData: boolean;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string;
}

export interface B2PublicApiAuthenticationDecisionV1 {
  readonly authReference: string;
  readonly authVersion: 1;
  readonly method: B2PublicApiRouteMethod;
  readonly pathTemplate: B2PublicApiRoutePath;
  readonly outcome: B2PublicApiAuthOutcome;
  readonly failureCode: B2PublicApiFailureCode | null;
  readonly httpStatus: number;
  readonly isLeakSafe404: boolean;
  readonly auditWithoutLeak: boolean;
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b2.public-api-authentication.idempotency.v1';
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly contractName: 'B2-PUBLIC-API-AUTHENTICATION';
  readonly contractVersion: 1;
}

export interface B2B1CatalogViewV1 {
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly b1ScopeVersion: 1;
  readonly plans: readonly string[];
  readonly tiers: readonly string[];
  readonly minimal: boolean;
}

export interface B2B1PlanViewV1 {
  readonly planKey: string;
  readonly b1ScopeKey: 'commercial.virtual-account.inbound-funding';
  readonly tier: string | null;
  readonly audience: B2PublicApiAudience;
}

export interface B2B1ActivationViewV1 {
  readonly activationReference: string;
  readonly state: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'REVOKED';
  readonly minimal: boolean;
}

export interface B2PublicApiAuthenticationFailureV1 {
  readonly code: B2PublicApiFailureCode;
  readonly message: string;
  readonly field: string | null;
  readonly httpStatus: number;
}

export interface B2PublicApiAuthenticationReplaySafeResultV1 {
  readonly decision: B2PublicApiAuthenticationDecisionV1 | null;
  readonly failure: B2PublicApiAuthenticationFailureV1 | null;
  readonly replayed: boolean;
  readonly conflict: boolean;
}

export interface B2PublicApiAuthenticationCompatibilityResultV1 {
  readonly compatible: boolean;
  readonly failure: B2PublicApiAuthenticationFailureV1 | null;
}

export interface B2PublicApiAuthenticationConsumerPortsV1 {
  readonly contractName: B2PublicApiAuthenticationContractName;
  readonly contractVersion: B2PublicApiAuthenticationContractVersion;
  readonly idempotencyScope: 'b2.public-api-authentication.idempotency.v1';
  readonly cohortKey: 'b2.activation.cohort.inbound-funding';
  readonly cohortVersion: 1;
}
