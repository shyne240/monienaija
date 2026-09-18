/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'node:crypto';

import { B2PublicApiAuthenticationRepository } from '../src/policy/b2-public-api-authentication.repository';
import { B2PublicApiAuthenticationService } from '../src/policy/b2-public-api-authentication.service';
import type { B2PublicApiAuthenticationRequestV1 } from '../src/policy/b2-public-api-authentication.types';

describe('B2 public API authentication service (B2T10)', () => {
  let service: B2PublicApiAuthenticationService;

  beforeEach(() => {
    service = new B2PublicApiAuthenticationService(new B2PublicApiAuthenticationRepository());
  });

  it('exposes the only B2 public API authentication integration', () => {
    expect(service.getContractName()).toBe('B2-PUBLIC-API-AUTHENTICATION');
    expect(service.getConsumerPorts().idempotencyScope).toBe(
      'b2.public-api-authentication.idempotency.v1',
    );
  });

  it('authenticates and exposes B1 plan leak-safe', () => {
    const now = Math.floor(Date.now() / 1000);
    const req: any = {
      method: 'GET',
      pathTemplate: '/v1/commercial/plans/{planKey}',
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
      requestedPlanKey: 'commercial.virtual-account.outbound-settlement',
      hasBillingData: false,
      idempotencyKey: randomUUID(),
      requestContext: {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        traceId: randomUUID(),
      },
      causationId: randomUUID(),
    };
    const { view, decision } = service.exposeB1Plan(req, req.requestedPlanKey);
    expect(view).toBeNull();
    expect(decision.httpStatus).toBe(404);
    expect(decision.isLeakSafe404).toBe(true);
  });

  it('is replay-safe', () => {
    const now = Math.floor(Date.now() / 1000);
    const req = {
      method: 'GET',
      pathTemplate: '/v1/commercial/catalog',
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
      hasBillingData: false,
      idempotencyKey: randomUUID(),
      requestContext: {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        traceId: randomUUID(),
      } as never,
      causationId: randomUUID(),
    } as unknown as B2PublicApiAuthenticationRequestV1;
    const first = service.replaySafeAuthenticate(req, null);
    expect(first.replayed).toBe(false);
    const repo = new B2PublicApiAuthenticationRepository();
    const hash = repo.computeRequestHash(req);
    const replay = service.replaySafeAuthenticate(req, {
      decision: first.decision!,
      requestHash: hash,
    });
    expect(replay.replayed).toBe(true);
  });
});
