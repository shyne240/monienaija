import { randomUUID } from 'node:crypto';

import { B2WebhookRepository } from '../src/policy/b2-webhook.repository';
import type {
  B2WebhookDeliveryRequestV1,
  B2WebhookRegistrationRequestV1,
} from '../src/policy/b2-webhook.types';

const buildRegistration = (
  overrides: Partial<B2WebhookRegistrationRequestV1> = {},
): B2WebhookRegistrationRequestV1 => ({
  consumerId: randomUUID(),
  url: 'https://example.com/webhooks/monienaija',
  events: ['b2.activation.succeeded', 'b2.webhook.test'],
  secret: 'whsec_1234567890abcdef1234567890abcdef1234567890ab',
  hmacAlgorithm: 'HMAC_SHA256',
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

const buildDelivery = (
  registrationId: string,
  overrides: Partial<B2WebhookDeliveryRequestV1> = {},
): B2WebhookDeliveryRequestV1 => ({
  registrationId,
  event: 'b2.activation.succeeded',
  payload: {
    activationReference: 'b2-activation-123',
    cohortKey: 'b2.activation.cohort.inbound-funding',
  },
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

describe('B2 webhook repository (B2T09)', () => {
  let repository: B2WebhookRepository;

  beforeEach(() => {
    repository = new B2WebhookRepository();
  });

  it('is the only B2 webhook authority', () => {
    expect(repository.getContractName()).toBe('B2-WEBHOOK-AUTHORITY');
    expect(repository.getIdempotencyScope()).toBe('b2.webhook.idempotency.v1');
  });

  it('implements deterministic, replay-safe registration with HTTPS-only allowlist', () => {
    const req = buildRegistration();
    const first = repository.replaySafeGenerateRegistrationDecision(req, null);
    expect(first.replayed).toBe(false);
    expect(first.decision?.state).toBe('PENDING_VERIFICATION');
    expect(first.decision?.secretHash).toContain('argon2id$');
    expect(first.decision?.challengeNonce).toMatch(/^[a-f0-9]{32}$/);
    const replay = repository.replaySafeGenerateRegistrationDecision(req, {
      decision: first.decision!,
      requestHash: repository.computeRegistrationRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
    const diff = buildRegistration({
      idempotencyKey: req.idempotencyKey,
      url: 'https://example.com/other',
    });
    const conflict = repository.replaySafeGenerateRegistrationDecision(diff, {
      decision: first.decision!,
      requestHash: repository.computeRegistrationRequestHash(req),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_WEBHOOK_REPLAY_CONFLICT');

    const http = buildRegistration({ url: 'http://example.com/webhooks' });
    expect(repository.compatibilityCheckRegistration(http).compatible).toBe(false);
    const notAllowed = buildRegistration({ url: 'https://evil.com/webhooks' });
    expect(repository.compatibilityCheckRegistration(notAllowed).compatible).toBe(false);
  });

  it('verifies endpoint via challenge-response', () => {
    const decision = repository.generateRegistrationDecision(buildRegistration());
    const ok = repository.verifyRegistrationChallenge(decision, decision.challengeNonce);
    expect(ok.verified).toBe(true);
    expect(ok.decision.state).toBe('VERIFIED');
    const bad = repository.verifyRegistrationChallenge(decision, 'wrong-nonce');
    expect(bad.verified).toBe(false);
    expect(bad.failure?.code).toBe('B2_WEBHOOK_CHALLENGE_FAILED');
  });

  it('implements HMAC-SHA256 signing and verification', () => {
    const secret = 'test-secret-1234567890abcdef1234567890ab';
    const reg = repository.generateRegistrationDecision(buildRegistration({ secret }));
    const verifiedReg = repository.verifyRegistrationChallenge(reg, reg.challengeNonce).decision;
    const delivery = repository.generateDeliveryDecision(
      buildDelivery(verifiedReg.registrationId),
      verifiedReg,
      secret,
    );
    expect(delivery.signature.startsWith('sha256=')).toBe(true);
    expect(delivery.timestamp).toBeGreaterThan(0);
    const bad = repository.verifyHmacSignature({
      secret,
      payload: { activationReference: 'b2-activation-123' },
      timestamp: delivery.timestamp,
      deliveryId: delivery.deliveryId,
      signature: 'sha256=invalid',
    });
    expect(bad.verified).toBe(false);
    expect(bad.failure?.code).toBe('B2_WEBHOOK_SIGNATURE_INVALID');
  });

  it('enforces timestamp freshness 300s', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(repository.checkTimestampFreshness(now, now).verified).toBe(true);
    expect(repository.checkTimestampFreshness(now - 301, now).verified).toBe(false);
    expect(repository.checkTimestampFreshness(now - 301, now).failure?.code).toBe(
      'B2_WEBHOOK_TIMESTAMP_STALE',
    );
  });

  it('enforces Delivery-Id uniqueness', () => {
    const seen = new Set<string>(['id-1']);
    expect(repository.checkDeliveryIdUnique('id-2', seen).verified).toBe(true);
    expect(repository.checkDeliveryIdUnique('id-1', seen).verified).toBe(false);
    expect(repository.checkDeliveryIdUnique('id-1', seen).failure?.code).toBe(
      'B2_WEBHOOK_DELIVERY_ID_DUPLICATE',
    );
  });

  it('implements bounded retry with exponential backoff and dead-letter', () => {
    expect(repository.getNextAttemptAt(1)).not.toBeNull();
    expect(repository.getNextAttemptAt(5)).not.toBeNull();
    expect(repository.getNextAttemptAt(5 + 1)).toBeNull();
    const first = repository.getNextAttemptAt(1);
    const second = repository.getNextAttemptAt(2);
    expect(new Date(second!).getTime()).toBeGreaterThan(new Date(first!).getTime());
  });

  it('implements delivery state machine and dead-letter handling', () => {
    const baseReg = repository.generateRegistrationDecision(buildRegistration());
    const verified = repository.verifyRegistrationChallenge(
      baseReg,
      baseReg.challengeNonce,
    ).decision;
    const delivery = repository.generateDeliveryDecision(
      buildDelivery(verified.registrationId),
      verified,
      'test-secret-1234567890abcdef1234567890ab',
    );
    expect(delivery.state).toBe('ENQUEUED');
    expect(delivery.attempt).toBe(1);
    const failed = repository.transitionDeliveryState(delivery, 'FAILED_RETRYABLE');
    expect(failed.state).toBe('FAILED_RETRYABLE');
    expect(failed.nextAttemptAt).not.toBeNull();
    const dead = repository.transitionDeliveryState(
      { ...delivery, attempt: 5 } as never,
      'FAILED_RETRYABLE',
    );
    expect(dead.state).toBe('DEAD_LETTER');
    const delivered = repository.transitionDeliveryState(delivery, 'DELIVERED');
    expect(delivered.state).toBe('DELIVERED');
    expect(delivered.nextAttemptAt).toBeNull();
  });

  it('dedicates b2.webhook.idempotency.v1 with 86400s and deterministic hashes', () => {
    const req = buildRegistration();
    const h1 = repository.computeRegistrationRequestHash(req);
    const h2 = repository.computeRegistrationRequestHash(req);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    const deliveryReq = buildDelivery(randomUUID());
    const dh1 = repository.computeDeliveryRequestHash(deliveryReq);
    const dh2 = repository.computeDeliveryRequestHash(deliveryReq);
    expect(dh1).toBe(dh2);
  });

  it('replay protection for deliveries via b2.webhook.idempotency.v1', () => {
    const verifiedReg = (() => {
      const r = repository.generateRegistrationDecision(buildRegistration());
      return repository.verifyRegistrationChallenge(r, r.challengeNonce).decision;
    })();
    const key = randomUUID();
    const req = buildDelivery(verifiedReg.registrationId, { idempotencyKey: key });
    const first = repository.replaySafeGenerateDeliveryDecision(
      req,
      verifiedReg,
      'test-secret-1234567890abcdef1234567890ab',
      null,
    );
    expect(first.replayed).toBe(false);
    const replay = repository.replaySafeGenerateDeliveryDecision(
      req,
      verifiedReg,
      'test-secret-1234567890abcdef1234567890ab',
      {
        decision: first.decision!,
        requestHash: repository.computeDeliveryRequestHash(req),
      },
    );
    expect(replay.replayed).toBe(true);
    const diff = buildDelivery(verifiedReg.registrationId, {
      idempotencyKey: key,
      event: 'b2.activation.suspended',
    });
    const conflict = repository.replaySafeGenerateDeliveryDecision(
      diff,
      verifiedReg,
      'test-secret-1234567890abcdef1234567890ab',
      {
        decision: first.decision!,
        requestHash: repository.computeDeliveryRequestHash(req),
      },
    );
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_WEBHOOK_REPLAY_CONFLICT');
  });
});
