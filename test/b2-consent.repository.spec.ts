import { randomUUID } from 'node:crypto';

import { B2ConsentRepository } from '../src/policy/b2-consent.repository';
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

describe('B2 consent repository (B2T06)', () => {
  let repository: B2ConsentRepository;

  beforeEach(() => {
    repository = new B2ConsentRepository();
  });

  it('exposes the contract identity', () => {
    expect(repository.getContractName()).toBe('B2-CONSENT-AUTHORITY');
    expect(repository.getIdempotencyScope()).toBe('b2.consent.idempotency.v1');
  });

  it('creates a PENDING consent for B2_ACTIVATION', () => {
    const d = repository.generateConsentDecision(buildRequest({ purpose: 'B2_ACTIVATION' }));
    expect(d.state).toBe('PENDING');
    expect(d.purpose).toBe('B2_ACTIVATION');
    expect(d.consentReference.startsWith('b2-consent-')).toBe(true);
  });

  it('creates a consent for each purpose', () => {
    for (const purpose of ['B2_ACTIVATION', 'B2_COMMERCIAL', 'B2_SELF_SERVICE'] as const) {
      const d = repository.generateConsentDecision(buildRequest({ purpose }));
      expect(d.purpose).toBe(purpose);
      expect(d.channel).toBeNull();
    }
    const marketing = repository.generateConsentDecision(
      buildRequest({ purpose: 'MARKETING_COMMERCIAL_OFFER', channel: 'email' }),
    );
    expect(marketing.purpose).toBe('MARKETING_COMMERCIAL_OFFER');
    expect(marketing.channel).toBe('email');
  });

  it('rejects marketing without channel and non-marketing with channel', () => {
    const noChannel = repository.compatibilityCheck(
      buildRequest({ purpose: 'MARKETING_COMMERCIAL_OFFER', channel: null }),
    );
    expect(noChannel.compatible).toBe(false);
    const withChannel = repository.compatibilityCheck(
      buildRequest({ purpose: 'B2_ACTIVATION', channel: 'email' as never }),
    );
    expect(withChannel.compatible).toBe(false);
  });

  it('supports the lifecycle PENDING -> GRANTED -> REVOKED -> EXPIRED', () => {
    const pending = repository.generateConsentDecision(buildRequest({ requestedState: 'PENDING' }));
    expect(pending.state).toBe('PENDING');
    const granted = repository.transitionState(pending, 'GRANTED');
    expect(granted.state).toBe('GRANTED');
    const revoked = repository.transitionState(granted, 'REVOKED');
    expect(revoked.state).toBe('REVOKED');
    const expired = repository.transitionState(revoked, 'EXPIRED');
    expect(expired.state).toBe('EXPIRED');
  });

  it('rejects invalid transitions', () => {
    const pending = repository.generateConsentDecision(buildRequest({ requestedState: 'PENDING' }));
    expect(() => repository.transitionState(pending, 'REVOKED')).toThrow(
      /invalid consent transition/,
    );
  });

  it('is replay-safe — same key+hash replays, different hash conflicts', () => {
    const key = randomUUID();
    const req = buildRequest({ idempotencyKey: key, subjectCustomerId: randomUUID() });
    const first = repository.replaySafeGenerateConsentDecision(req, null);
    expect(first.replayed).toBe(false);
    const replay = repository.replaySafeGenerateConsentDecision(req, {
      decision: first.decision!,
      requestHash: repository.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.decision?.consentReference).toBe(first.decision?.consentReference);

    const diff = buildRequest({ idempotencyKey: key, subjectCustomerId: randomUUID() });
    const conflict = repository.replaySafeGenerateConsentDecision(diff, {
      decision: first.decision!,
      requestHash: repository.computeRequestHash(req),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_CONSENT_REPLAY_CONFLICT');
  });

  it('is the only B2 consent authority — dedicated idempotency scope', () => {
    expect(repository.getConsumerPorts().idempotencyScope).toBe('b2.consent.idempotency.v1');
  });
});
