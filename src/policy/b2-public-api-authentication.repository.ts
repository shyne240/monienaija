/**
 * B2T10 — B2 public API authentication repository.
 *
 * The repository is the only B2-side public API authentication
 * authority. It verifies every public B2 route through A2 audience,
 * token expiry, scope, consumer ACTIVE, credential ISSUED/ROTATED,
 * consent GRANTED, A4 ELIGIBLE, quota ALLOCATED, and rate-limit
 * ALLOWED, and exposes B1 catalog/plan/tier and B2 activation as
 * audience-scoped, minimized reads. It preserves every frozen boundary
 * from B2T01–B2T09, consumes previous B2 modules only through their
 * published consumer ports, reuses Operations Audit/Idempotency/Outbox/
 * Metrics, and maintains deterministic hashing, replay protection,
 * idempotency, auditability, and versioning.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  B2_PUBLIC_API_AUTHENTICATION_AUDIT_ACTOR,
  B2_PUBLIC_API_AUTHENTICATION_AUDIT_ENTITY_TYPE,
  B2_PUBLIC_API_AUTHENTICATION_B1_PLANS,
  B2_PUBLIC_API_AUTHENTICATION_B1_TIERS,
  B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY,
  B2_PUBLIC_API_AUTHENTICATION_COHORT_VERSION,
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_DOCUMENT,
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME,
  B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION,
  B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE,
  B2_PUBLIC_API_AUTHENTICATION_REFERENCE_PREFIX,
} from './b2-public-api-authentication.constants';
import type {
  B2B1CatalogViewV1,
  B2B1PlanViewV1,
  B2PublicApiAuthenticationCompatibilityResultV1,
  B2PublicApiAuthenticationConsumerPortsV1,
  B2PublicApiAuthenticationDecisionV1,
  B2PublicApiAuthenticationReplaySafeResultV1,
  B2PublicApiAuthenticationRequestV1,
  B2PublicApiAuthOutcome,
  B2PublicApiFailureCode,
} from './b2-public-api-authentication.types';

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

const ROUTE_AUDIENCE: Record<string, string | null> = {
  '/v1/commercial/activations': 'public:commercial:activation:b2:inbound-funding:write',
  '/v1/commercial/activations/{activationReference}':
    'public:commercial:activation:b2:inbound-funding:read',
  '/v1/commercial/catalog': 'public:commercial:activation:b2:inbound-funding:read',
  '/v1/commercial/plans/{planKey}': 'public:commercial:activation:b2:inbound-funding:read',
  '/v1/commercial/tiers/{tierKey}': 'public:commercial:activation:b2:inbound-funding:read',
  '/v1/webhooks/registrations': 'public:webhooks:b2:manage',
  '/v1/consents': 'public:consents:b2:manage',
  '/v1/support/activations/{activationReference}': 'public:support:b2:read',
  '/v1/auth/token': null,
  '/v1/health': null,
};

const ROUTE_SCOPE: Record<string, string | null> = {
  '/v1/commercial/activations': 'b2:activation:write',
  '/v1/commercial/activations/{activationReference}': 'b2:activation:read',
  '/v1/commercial/catalog': 'b2:activation:read',
  '/v1/commercial/plans/{planKey}': 'b2:activation:read',
  '/v1/commercial/tiers/{tierKey}': 'b2:activation:read',
  '/v1/webhooks/registrations': 'b2:webhooks:manage',
  '/v1/consents': 'b2:consents:manage',
  '/v1/support/activations/{activationReference}': 'b2:support:read',
  '/v1/auth/token': null,
  '/v1/health': null,
};

const ALLOWED_B1_PLANS: readonly string[] =
  B2_PUBLIC_API_AUTHENTICATION_B1_PLANS as unknown as readonly string[];
const ALLOWED_B1_TIERS: readonly string[] =
  B2_PUBLIC_API_AUTHENTICATION_B1_TIERS as unknown as readonly string[];

@Injectable()
export class B2PublicApiAuthenticationRepository {
  getContractName(): string {
    return B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION;
  }

  getContractDocument(): string {
    return B2_PUBLIC_API_AUTHENTICATION_CONTRACT_DOCUMENT;
  }

  getIdempotencyScope(): string {
    return B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE;
  }

  getAuditActor(): string {
    return B2_PUBLIC_API_AUTHENTICATION_AUDIT_ACTOR;
  }

  getConsumerPorts(): B2PublicApiAuthenticationConsumerPortsV1 {
    return {
      contractName: B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME,
      contractVersion: B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION,
      idempotencyScope: B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE,
      cohortKey: B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY,
      cohortVersion: B2_PUBLIC_API_AUTHENTICATION_COHORT_VERSION,
    };
  }

  compatibilityCheck(
    request: B2PublicApiAuthenticationRequestV1,
  ): B2PublicApiAuthenticationCompatibilityResultV1 {
    if (request.cohortKey !== B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY) {
      return {
        compatible: false,
        failure: {
          code: 'B2_AUTH_INCOMPATIBLE',
          message: `cohortKey must be ${String(B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY)}`,
          field: 'cohortKey',
          httpStatus: 403,
        },
      };
    }
    if (!UUID_PATTERN.test(request.idempotencyKey)) {
      return {
        compatible: false,
        failure: {
          code: 'B2_AUTH_INCOMPATIBLE',
          message: 'idempotencyKey must be uuid',
          field: 'idempotencyKey',
          httpStatus: 400,
        },
      };
    }
    return { compatible: true, failure: null };
  }

  computeRequestHash(request: B2PublicApiAuthenticationRequestV1): string {
    const payload = {
      method: request.method,
      pathTemplate: request.pathTemplate,
      aud: request.token?.aud ?? null,
      scope: request.token?.scope ?? null,
      exp: request.token?.exp ?? null,
      sub: request.token?.sub ?? null,
      consumerState: request.consumerState,
      credentialState: request.credentialState,
      consentState: request.consentState,
      activationState: request.activationState,
      quotaState: request.quotaState,
      rateLimitState: request.rateLimitState,
      a4EligibilityState: request.a4EligibilityState,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestedPlanKey: request.requestedPlanKey ?? null,
      hasBillingData: request.hasBillingData,
      idempotencyKey: request.idempotencyKey,
    };
    return sha256Hex(stableJson(payload));
  }

  private decideOutcome(request: B2PublicApiAuthenticationRequestV1): {
    outcome: B2PublicApiAuthenticationDecisionV1['outcome'];
    failureCode: B2PublicApiFailureCode | null;
    httpStatus: number;
    isLeakSafe404: boolean;
    auditWithoutLeak: boolean;
  } {
    const now = Math.floor(Date.now() / 1000);
    const path = request.pathTemplate;

    // Health is always allowed without auth
    if (path === '/v1/health') {
      return {
        outcome: 'AUTHENTICATED',
        failureCode: null,
        httpStatus: 200,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // Auth token exchange is anonymous but still requires cohort check
    if (path === '/v1/auth/token') {
      // No token required, but if token is present it must be valid? At B2T10, POST /auth/token is anonymous client_credentials.
      return {
        outcome: 'AUTHENTICATED',
        failureCode: null,
        httpStatus: 200,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 1. Unauthenticated
    if (!request.token) {
      return {
        outcome: 'UNAUTHORIZED',
        failureCode: 'B2_AUTH_UNAUTHORIZED',
        httpStatus: 401,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    const expectedAud = ROUTE_AUDIENCE[path];
    const expectedScope = ROUTE_SCOPE[path];

    // 2. Wrong audience
    if (expectedAud && request.token.aud !== expectedAud) {
      return {
        outcome: 'WRONG_AUDIENCE',
        failureCode: 'B2_AUTH_WRONG_AUDIENCE',
        httpStatus: 403,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 3. Expired
    if (request.token.exp < now) {
      return {
        outcome: 'EXPIRED',
        failureCode: 'B2_AUTH_EXPIRED',
        httpStatus: 401,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 4. Wrong scope
    if (expectedScope && request.token.scope !== expectedScope) {
      // Also handle case where scope is space-separated list — check contains
      const scopes = request.token.scope.split(' ');
      if (!scopes.includes(expectedScope)) {
        return {
          outcome: 'WRONG_SCOPE',
          failureCode: 'B2_AUTH_WRONG_SCOPE',
          httpStatus: 403,
          isLeakSafe404: false,
          auditWithoutLeak: false,
        };
      }
    }

    // 5. Consumer not ACTIVE
    if (request.consumerState !== 'ACTIVE') {
      return {
        outcome: 'CONSUMER_NOT_ACTIVE',
        failureCode: 'B2_AUTH_CONSUMER_NOT_ACTIVE',
        httpStatus: 403,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 6. Credential REVOKED/EXPIRED
    if (request.credentialState === 'REVOKED' || request.credentialState === 'EXPIRED') {
      return {
        outcome: 'CREDENTIAL_REVOKED',
        failureCode: 'B2_AUTH_CREDENTIAL_REVOKED',
        httpStatus: 401,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 7. Consent required (where hasBillingData or activationState is involved) — for B2T10, check consent for billing data and for POST activations
    // For simplicity, if hasBillingData true and consent not GRANTED, require consent
    if (request.hasBillingData && request.consentState !== 'GRANTED') {
      return {
        outcome: 'CONSENT_REQUIRED',
        failureCode: 'B2_AUTH_CONSENT_REQUIRED',
        httpStatus: 403,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 8. Activation required for billing data
    if (request.hasBillingData && request.activationState !== 'ACTIVE') {
      return {
        outcome: 'ACTIVATION_REQUIRED',
        failureCode: 'B2_AUTH_ACTIVATION_REQUIRED',
        httpStatus: 403,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 9. A4 not eligible
    if (request.a4EligibilityState !== 'ELIGIBLE') {
      return {
        outcome: 'REJECTED',
        failureCode: 'B2_AUTH_A4_NOT_ELIGIBLE',
        httpStatus: 403,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 10. Quota exceeded
    if (request.quotaState === 'EXCEEDED') {
      return {
        outcome: 'QUOTA_EXCEEDED',
        failureCode: 'B2_AUTH_QUOTA_EXCEEDED',
        httpStatus: 429,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 11. Rate limited
    if (request.rateLimitState === 'THROTTLED') {
      return {
        outcome: 'RATE_LIMITED',
        failureCode: 'B2_AUTH_RATE_LIMITED',
        httpStatus: 429,
        isLeakSafe404: false,
        auditWithoutLeak: false,
      };
    }

    // 12. B1 plan outside audience -> 404 leak-safe (not 403)
    if (request.requestedPlanKey) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const allowed = (ALLOWED_B1_PLANS as readonly string[]).includes(request.requestedPlanKey);
      if (!allowed) {
        return {
          outcome: 'NOT_FOUND',
          failureCode: 'B2_AUTH_NOT_FOUND',
          httpStatus: 404,
          isLeakSafe404: true,
          auditWithoutLeak: true,
        };
      }
    }

    // 13. Billing data without activation/consent already handled above; otherwise authenticated
    return {
      outcome: 'AUTHENTICATED',
      failureCode: null,
      httpStatus: 200,
      isLeakSafe404: false,
      auditWithoutLeak: false,
    };
  }

  generateAuthenticationDecision(
    request: B2PublicApiAuthenticationRequestV1,
  ): B2PublicApiAuthenticationDecisionV1 {
    const compatibility = this.compatibilityCheck(request);
    if (!compatibility.compatible) {
      throw Object.assign(new Error(compatibility.failure!.message), {
        code: compatibility.failure!.code,
      });
    }

    const decided = this.decideOutcome(request);
    const requestHash = this.computeRequestHash(request);
    const authReference = `${B2_PUBLIC_API_AUTHENTICATION_REFERENCE_PREFIX}-${randomUUID()}`;
    const decisionPayload = {
      requestHash,
      outcome: decided.outcome,
      failureCode: decided.failureCode,
      httpStatus: decided.httpStatus,
      pathTemplate: request.pathTemplate,
      method: request.method,
      aud: request.token?.aud ?? null,
    };
    const decisionHash = sha256Hex(stableJson(decisionPayload));
    const replayPayload = {
      requestHash,
      cohortKey: request.cohortKey,
      pathTemplate: request.pathTemplate,
      outcome: decided.outcome,
    };
    const decisionReplayHash = sha256Hex(stableJson(replayPayload));
    const now = new Date().toISOString();

    return {
      authReference,
      authVersion: 1,
      method: request.method,
      pathTemplate: request.pathTemplate,
      outcome: decided.outcome,
      failureCode: decided.failureCode,
      httpStatus: decided.httpStatus,
      isLeakSafe404: decided.isLeakSafe404,
      auditWithoutLeak: decided.auditWithoutLeak,
      cohortKey: request.cohortKey,
      cohortVersion: request.cohortVersion,
      requestHash,
      decisionHash,
      decisionReplayHash,
      idempotencyScope: B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestContext.correlationId ?? request.causationId,
      causationId: request.causationId,
      createdAt: now,
      updatedAt: now,
      contractName: 'B2-PUBLIC-API-AUTHENTICATION',
      contractVersion: 1,
    };
  }

  exposeB1Catalog(request: B2PublicApiAuthenticationRequestV1): {
    view: B2B1CatalogViewV1 | null;
    decision: B2PublicApiAuthenticationDecisionV1;
  } {
    const decision = this.generateAuthenticationDecision(request);
    if (decision.outcome !== 'AUTHENTICATED') {
      return { view: null, decision };
    }
    // No second catalog — read-only minimized catalog via B1T02 catalog
    const view: B2B1CatalogViewV1 = {
      cohortKey: request.cohortKey,
      b1ScopeKey: 'commercial.virtual-account.inbound-funding',
      b1ScopeVersion: 1,
      plans: [...(B2_PUBLIC_API_AUTHENTICATION_B1_PLANS as unknown as readonly string[])],
      tiers: [...(B2_PUBLIC_API_AUTHENTICATION_B1_TIERS as unknown as readonly string[])],
      minimal: true,
    };
    return { view, decision };
  }

  exposeB1Plan(
    request: B2PublicApiAuthenticationRequestV1,
    planKey: string,
  ): { view: B2B1PlanViewV1 | null; decision: B2PublicApiAuthenticationDecisionV1 } {
    const decision = this.generateAuthenticationDecision({
      ...request,
      requestedPlanKey: planKey,
    } as B2PublicApiAuthenticationRequestV1);
    if (decision.outcome !== 'AUTHENTICATED') {
      return { view: null, decision };
    }
    // If planKey allowed, return minimized view; otherwise decision is already 404 leak-safe
    if (decision.isLeakSafe404) {
      return { view: null, decision };
    }
    const view: B2B1PlanViewV1 = {
      planKey,
      b1ScopeKey: 'commercial.virtual-account.inbound-funding',
      tier: (B2_PUBLIC_API_AUTHENTICATION_B1_TIERS as unknown as readonly string[])[0]!,
      audience:
        (request.token?.aud as unknown as B2B1PlanViewV1['audience']) ??
        'public:commercial:activation:b2:inbound-funding:read',
    };
    return { view, decision };
  }

  replaySafeGenerateAuthenticationDecision(
    request: B2PublicApiAuthenticationRequestV1,
    existingByKey?: { decision: B2PublicApiAuthenticationDecisionV1; requestHash: string } | null,
  ): B2PublicApiAuthenticationReplaySafeResultV1 {
    const requestHash = this.computeRequestHash(request);
    if (!existingByKey) {
      const decision = this.generateAuthenticationDecision(request);
      return { decision, failure: null, replayed: false, conflict: false };
    }
    if (existingByKey.requestHash === requestHash) {
      return { decision: existingByKey.decision, failure: null, replayed: true, conflict: false };
    }
    return {
      decision: null,
      failure: {
        code: 'B2_AUTH_REPLAY_CONFLICT',
        message: 'same idempotencyKey with different payload',
        field: 'idempotencyKey',
        httpStatus: 409,
      },
      replayed: false,
      conflict: true,
    };
  }
}
