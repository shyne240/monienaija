import { randomUUID } from 'node:crypto';

import { B2ConsentRepository } from '../src/policy/b2-consent.repository';
import { B2ConsentService } from '../src/policy/b2-consent.service';
import {
  B2_CONSENT_CONTRACT_NAME,
  B2_CONSENT_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-consent.constants';
import type { B2ConsentRequestV1 } from '../src/policy/b2-consent.types';

const buildRequest = (overrides: Partial<B2ConsentRequestV1> = {}): B2ConsentRequestV1 => ({
  subjectCustomerId: randomUUID(),
  purpose: 'B2_ACTIVATION',
  channel: null,
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  requestedState: 'PENDING',
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

describe('B2 consent service (B2T06)', () => {
  let service: B2ConsentService;

  beforeEach(() => {
    service = new B2ConsentService(new B2ConsentRepository());
  });

  it('exposes the contract and dedicated scope', () => {
    expect(service.getContractName()).toBe(B2_CONSENT_CONTRACT_NAME);
    expect(service.getConsumerPorts().idempotencyScope).toBe(B2_CONSENT_IDEMPOTENCY_SCOPE);
  });

  it('creates a consent and transitions it', () => {
    const pending = service.generateConsentDecision(buildRequest({ requestedState: 'PENDING' }));
    expect(pending.state).toBe('PENDING');
    const granted = service.transitionState(pending, 'GRANTED');
    expect(granted.state).toBe('GRANTED');
  });

  it('is replay-safe', () => {
    const req = buildRequest();
    const first = service.replaySafeGenerateConsentDecision(req, null);
    const replay = service.replaySafeGenerateConsentDecision(req, {
      decision: first.decision!,
      requestHash: service.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
  });
});
