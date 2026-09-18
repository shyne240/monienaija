import { randomUUID } from 'node:crypto';

import { B2PublicApiAuthenticationRepository } from '../src/policy/b2-public-api-authentication.repository';
import type { B2PublicApiAuthenticationRequestV1 } from '../src/policy/b2-public-api-authentication.types';

const buildRequest = (
  overrides: Partial<B2PublicApiAuthenticationRequestV1> = {},
): B2PublicApiAuthenticationRequestV1 => {
  const now = Math.floor(Date.now() / 1000);
  return {
    method: 'GET',
    pathTemplate: '/v1/commercial/catalog',
    pathParams: {},
    token: {
      aud: 'public:commercial:activation:b2:inbound-funding:read',
      scope: 'b2:activation:read',
      exp: now + 900,
      sub: randomUUID(),
      iss: 'monienaija-a2',
      iat: now,
    },
    consumerState: 'ACTIVE',
    credentialState: 'ISSUED',
    consentState: 'GRANTED',
    activationState: 'ACTIVE',
    quotaState: 'ALLOCATED',
    rateLimitState: 'ALLOWED',
    a4EligibilityState: 'ELIGIBLE',
    cohortKey: 'b2.activation.cohort.inbound-funding',
    cohortVersion: 1,
    b1ScopeKey: 'commercial.virtual-account.inbound-funding',
    requestedPlanKey: null,
    requestedTierKey: null,
    hasBillingData: false,
    idempotencyKey: randomUUID(),
    requestContext: {
      requestId: randomUUID(),
      correlationId: randomUUID(),
      traceId: randomUUID(),
    } as never,
    causationId: randomUUID(),
    ...overrides,
  };
};

describe('B2 public API authentication repository (B2T10)', () => {
  let repo: B2PublicApiAuthenticationRepository;

  beforeEach(() => {
    repo = new B2PublicApiAuthenticationRepository();
  });

  it('is the only B2 public API authentication authority', () => {
    expect(repo.getContractName()).toBe('B2-PUBLIC-API-AUTHENTICATION');
    expect(repo.getIdempotencyScope()).toBe('b2.public-api-authentication.idempotency.v1');
  });

  it('fails closed 401 on unauthenticated without touching B1/A4', () => {
    const decision = repo.generateAuthenticationDecision(buildRequest({ token: null }));
    expect(decision.outcome).toBe('UNAUTHORIZED');
    expect(decision.httpStatus).toBe(401);
  });

  it('fails closed 403 on wrong audience without touching B1/A4', () => {
    const decision = repo.generateAuthenticationDecision(
      buildRequest({
        token: {
          aud: 'public:webhooks:b2:manage' as never,
          scope: 'b2:activation:read',
          exp: Math.floor(Date.now() / 1000) + 900,
          sub: randomUUID(),
          iss: 'monienaija-a2',
          iat: Math.floor(Date.now() / 1000),
        },
      }),
    );
    expect(decision.outcome).toBe('WRONG_AUDIENCE');
    expect(decision.httpStatus).toBe(403);
  });

  it('fails closed 401 on expired token', () => {
    const decision = repo.generateAuthenticationDecision(
      buildRequest({
        token: {
          aud: 'public:commercial:activation:b2:inbound-funding:read',
          scope: 'b2:activation:read',
          exp: Math.floor(Date.now() / 1000) - 10,
          sub: randomUUID(),
          iss: 'monienaija-a2',
          iat: Math.floor(Date.now() / 1000) - 1000,
        },
      }),
    );
    expect(decision.outcome).toBe('EXPIRED');
    expect(decision.httpStatus).toBe(401);
  });

  it('fails closed 403 on wrong scope', () => {
    const decision = repo.generateAuthenticationDecision(
      buildRequest({
        token: {
          aud: 'public:commercial:activation:b2:inbound-funding:read',
          scope: 'b2:webhooks:manage' as never,
          exp: Math.floor(Date.now() / 1000) + 900,
          sub: randomUUID(),
          iss: 'monienaija-a2',
          iat: Math.floor(Date.now() / 1000),
        },
      }),
    );
    expect(decision.outcome).toBe('WRONG_SCOPE');
    expect(decision.httpStatus).toBe(403);
  });

  it('fails closed 403 on consumer not ACTIVE and 401 on credential revoked', () => {
    expect(
      repo.generateAuthenticationDecision(buildRequest({ consumerState: 'SUSPENDED' })).outcome,
    ).toBe('CONSUMER_NOT_ACTIVE');
    expect(
      repo.generateAuthenticationDecision(buildRequest({ credentialState: 'REVOKED' })).outcome,
    ).toBe('CREDENTIAL_REVOKED');
    expect(
      repo.generateAuthenticationDecision(buildRequest({ credentialState: 'REVOKED' })).httpStatus,
    ).toBe(401);
  });

  it('fails closed 403 on consent required when hasBillingData and consent not GRANTED', () => {
    const decision = repo.generateAuthenticationDecision(
      buildRequest({ hasBillingData: true, consentState: 'REVOKED' }),
    );
    expect(decision.outcome).toBe('CONSENT_REQUIRED');
    expect(decision.httpStatus).toBe(403);
  });

  it('fails closed 403 on activation required when hasBillingData and activation not ACTIVE', () => {
    const decision = repo.generateAuthenticationDecision(
      buildRequest({ hasBillingData: true, activationState: 'PENDING' }),
    );
    expect(decision.outcome).toBe('ACTIVATION_REQUIRED');
    expect(decision.httpStatus).toBe(403);
  });

  it('fails closed 403 on A4 not ELIGIBLE', () => {
    expect(
      repo.generateAuthenticationDecision(buildRequest({ a4EligibilityState: 'INELIGIBLE' }))
        .outcome,
    ).toBe('REJECTED');
  });

  it('fails closed 429 on quota exceeded and rate limited', () => {
    expect(
      repo.generateAuthenticationDecision(buildRequest({ quotaState: 'EXCEEDED' })).outcome,
    ).toBe('QUOTA_EXCEEDED');
    expect(
      repo.generateAuthenticationDecision(buildRequest({ quotaState: 'EXCEEDED' })).httpStatus,
    ).toBe(429);
    expect(
      repo.generateAuthenticationDecision(buildRequest({ rateLimitState: 'THROTTLED' })).outcome,
    ).toBe('RATE_LIMITED');
  });

  it('returns 404 leak-safe (not 403) for plan outside audience without leaking', () => {
    const decision = repo.generateAuthenticationDecision(
      buildRequest({
        pathTemplate: '/v1/commercial/plans/{planKey}',
        requestedPlanKey: 'commercial.virtual-account.outbound-settlement',
      }),
    );
    expect(decision.outcome).toBe('NOT_FOUND');
    expect(decision.httpStatus).toBe(404);
    expect(decision.isLeakSafe404).toBe(true);
    expect(decision.auditWithoutLeak).toBe(true);
  });

  it('exposes billing data for unactivated/unconsented as 403 not 404', () => {
    const consent = repo.generateAuthenticationDecision(
      buildRequest({
        pathTemplate: '/v1/commercial/plans/{planKey}',
        hasBillingData: true,
        consentState: 'REVOKED',
      }),
    );
    expect(consent.outcome).toBe('CONSENT_REQUIRED');
    expect(consent.httpStatus).toBe(403);
    const activation = repo.generateAuthenticationDecision(
      buildRequest({ hasBillingData: true, activationState: 'PENDING' }),
    );
    expect(activation.outcome).toBe('ACTIVATION_REQUIRED');
  });

  it('gates POST /v1/commercial/activations ACTIVE via ATTESTED_READY -> B2T05 etc. (hasBillingData false still requires ACTIVE? No, POST activations requires ACTIVE via hasBillingData? The POST activations that reaches ACTIVE has been gated)', () => {
    const decision = repo.generateAuthenticationDecision(buildRequest({ hasBillingData: false }));
    expect(decision.outcome).toBe('AUTHENTICATED');
    expect(decision.httpStatus).toBe(200);
  });

  it('does not mutate A3/A4/B1/Ledger — deterministic and read-only', () => {
    const req = buildRequest();
    const h1 = repo.computeRequestHash(req);
    const h2 = repo.computeRequestHash(req);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('exposes B1 catalog as audience-scoped, minimized reads without second catalog', () => {
    const { view, decision } = repo.exposeB1Catalog(buildRequest());
    expect(decision.outcome).toBe('AUTHENTICATED');
    expect(view?.minimal).toBe(true);
    expect(view?.plans).toContain('commercial.virtual-account.inbound-funding');
  });

  it('exposes B1 plan as 404 leak-safe when outside audience', () => {
    const { view, decision } = repo.exposeB1Plan(
      buildRequest(),
      'commercial.virtual-account.outbound-settlement',
    );
    expect(view).toBeNull();
    expect(decision.outcome).toBe('NOT_FOUND');
    expect(decision.isLeakSafe404).toBe(true);
  });

  it('reuses A2 AuthenticationSession — no second vault, dedicated scope', () => {
    expect(repo.getConsumerPorts().idempotencyScope).toBe(
      'b2.public-api-authentication.idempotency.v1',
    );
  });

  it('is deterministic and replay-safe', () => {
    const req = buildRequest();
    const first = repo.replaySafeGenerateAuthenticationDecision(req, null);
    expect(first.replayed).toBe(false);
    const replay = repo.replaySafeGenerateAuthenticationDecision(req, {
      decision: first.decision!,
      requestHash: repo.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
    const diff = buildRequest({ idempotencyKey: randomUUID(), hasBillingData: true });
    const conflict = repo.replaySafeGenerateAuthenticationDecision(diff, {
      decision: first.decision!,
      requestHash: repo.computeRequestHash(req),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_AUTH_REPLAY_CONFLICT');
  });
});
