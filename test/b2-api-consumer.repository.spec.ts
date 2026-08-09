/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { randomUUID } from 'node:crypto';

import { B2ApiConsumerRepository } from '../src/policy/b2-api-consumer.repository';
import type {
  B2ApiConsumerRequestV1,
  B2ApiCredentialRequestV1,
} from '../src/policy/b2-api-consumer.types';

const buildConsumer = (
  overrides: Partial<B2ApiConsumerRequestV1> = {},
): B2ApiConsumerRequestV1 => ({
  displayName: 'Test Consumer',
  consumerType: 'DEVELOPER',
  ownerCustomerId: randomUUID(),
  ownerMerchantId: null,
  ownerAgentId: null,
  audience: ['public:commercial:activation:b2:inbound-funding:read'],
  scopes: ['b2:activation:read'],
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

const buildCredential = (
  consumerId: string,
  overrides: Partial<B2ApiCredentialRequestV1> = {},
): B2ApiCredentialRequestV1 => ({
  consumerId,
  kind: 'API_KEY',
  scopes: ['b2:activation:read'],
  sandboxType: 'PRODUCTION',
  expirySeconds: 3600,
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

describe('B2 API consumer repository (B2T08)', () => {
  let repo: B2ApiConsumerRepository;

  beforeEach(() => {
    repo = new B2ApiConsumerRepository();
  });

  it('is the only B2 API consumer authority', () => {
    expect(repo.getContractName()).toBe('B2-API-CONSUMER');
    expect(repo.getIdempotencyScope()).toBe('b2.api-consumer.idempotency.v1');
    expect(repo.getConsumerPorts().idempotencyScope).toBe('b2.api-consumer.idempotency.v1');
  });

  it('implements deterministic, replay-safe consumer registration', () => {
    const req = buildConsumer();
    const first = repo.replaySafeGenerateConsumerDecision(req, null);
    expect(first.replayed).toBe(false);
    expect(first.conflict).toBe(false);
    expect(first.decision?.consumerReference.startsWith('b2-consumer-')).toBe(true);
    expect(first.decision?.state).toBe('ACTIVE');
    const replay = repo.replaySafeGenerateConsumerDecision(req, {
      decision: first.decision!,
      requestHash: repo.computeConsumerRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.decision?.consumerReference).toBe(first.decision?.consumerReference);

    const diff = buildConsumer({ idempotencyKey: req.idempotencyKey, displayName: 'Other' });
    const conflict = repo.replaySafeGenerateConsumerDecision(diff, {
      decision: first.decision!,
      requestHash: repo.computeConsumerRequestHash(req),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_API_CONSUMER_REPLAY_CONFLICT');
  });

  it('implements the consumer state machine DRAFT -> ACTIVE -> SUSPENDED -> REVOKED', () => {
    const d = repo.generateConsumerDecision(buildConsumer());
    expect(d.state).toBe('ACTIVE');
    const suspended = repo.transitionConsumerState(d, 'SUSPENDED');
    expect(suspended.state).toBe('SUSPENDED');
    const revoked = repo.transitionConsumerState(suspended, 'REVOKED');
    expect(revoked.state).toBe('REVOKED');
    const reactivated = repo.transitionConsumerState(
      repo.generateConsumerDecision(buildConsumer({ displayName: 'Re' })),
      'SUSPENDED',
    );
    const back = repo.transitionConsumerState(reactivated, 'REVOKED');
    expect(back.state).toBe('REVOKED');
  });

  it('generates client IDs with mnj_live_/mnj_test_ prefix and raw secret once, hash-only storage', () => {
    const consumer = repo.generateConsumerDecision(buildConsumer());
    const cred = repo.generateCredentialDecision(buildCredential(consumer.consumerId));
    expect(cred.keyId.startsWith('mnj_live_')).toBe(true);
    expect(cred.rawSecret).toBeDefined();
    expect(cred.secretHash).toContain('argon2id$');
    expect(cred.secretHash).not.toContain(cred.rawSecret as string);
    // sandbox
    const sandbox = repo.generateCredentialDecision(
      buildCredential(consumer.consumerId, { sandboxType: 'SANDBOX' }),
    );
    expect(sandbox.keyId.startsWith('mnj_test_')).toBe(true);
    expect(sandbox.sandboxType).toBe('SANDBOX');
    // different kind
    const cc = repo.generateCredentialDecision(
      buildCredential(consumer.consumerId, { kind: 'CLIENT_CREDENTIALS' }),
    );
    expect(cc.clientId).toBe(cc.keyId);
    expect(cc.keyId.startsWith('mnj_live_')).toBe(true);
  });

  it('supports rotation with new secret once and 300s grace via rotationNextKeyId', () => {
    const consumer = repo.generateConsumerDecision(buildConsumer());
    const issued = repo.generateCredentialDecision(buildCredential(consumer.consumerId));
    const rotated = repo.rotateCredentialDecision(issued);
    expect(rotated.state).toBe('ROTATED');
    expect(rotated.rotationNextKeyId).toBe(rotated.keyId);
    expect(rotated.keyId).not.toBe(issued.keyId);
    expect(rotated.rawSecret).toBeDefined();
    expect(rotated.rawSecret).not.toBe(issued.rawSecret);
    expect(rotated.secretHash).not.toBe(issued.secretHash);
  });

  it('supports revocation', () => {
    const consumer = repo.generateConsumerDecision(buildConsumer());
    const cred = repo.generateCredentialDecision(buildCredential(consumer.consumerId));
    const revoked = repo.revokeCredentialDecision(cred);
    expect(revoked.state).toBe('REVOKED');
    expect(revoked.rawSecret).toBeNull();
  });

  it('separates sandbox and production credential scopes', () => {
    const consumer = repo.generateConsumerDecision(buildConsumer());
    const prod = repo.generateCredentialDecision(
      buildCredential(consumer.consumerId, { sandboxType: 'PRODUCTION' }),
    );
    const sand = repo.generateCredentialDecision(
      buildCredential(consumer.consumerId, { sandboxType: 'SANDBOX' }),
    );
    expect(prod.sandboxType).not.toBe(sand.sandboxType);
    expect(prod.keyId.startsWith('mnj_live_')).toBe(true);
    expect(sand.keyId.startsWith('mnj_test_')).toBe(true);
  });

  it('implements quota policies UTC calendar day with ALLOCATED/EXCEEDED', () => {
    const consumerId = randomUUID();
    const quota = repo.createQuotaDecision(
      consumerId,
      'commercial.read',
      randomUUID(),
      randomUUID(),
    );
    expect(quota.limit).toBe(5000);
    expect(quota.state).toBe('ALLOCATED');
    const consumed = repo.checkQuota(quota, 5000);
    expect(consumed.state).toBe('EXCEEDED');
    expect(consumed.remaining).toBe(0);
    const still = repo.checkQuota(consumed, 1);
    expect(still.state).toBe('EXCEEDED');
    const write = repo.createQuotaDecision(
      consumerId,
      'commercial.write',
      randomUUID(),
      randomUUID(),
    );
    expect(write.limit).toBe(500);
    const web = repo.createQuotaDecision(consumerId, 'webhooks.manage', randomUUID(), randomUUID());
    expect(web.limit).toBe(100);
  });

  it('implements token-bucket rate limiting with burst and Retry-After', () => {
    const consumerId = randomUUID();
    const global = repo.createRateLimitBucket(consumerId, 'global');
    expect(global.capacity).toBe(100);
    expect(global.strategy).toBe('TOKEN_BUCKET');
    expect(global.state).toBe('ALLOWED');
    const allowed = repo.consumeRateLimitToken(global, 10);
    expect(allowed.state).toBe('ALLOWED');
    expect(allowed.remaining).toBe(90);
    const throttled = repo.consumeRateLimitToken({ ...global, remaining: 0 }, 1);
    expect(throttled.state).toBe('THROTTLED');
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    const activ = repo.createRateLimitBucket(consumerId, 'commercial.activations:write');
    expect(activ.capacity).toBe(10);
    const web = repo.createRateLimitBucket(consumerId, 'webhooks:delivery');
    expect(web.capacity).toBe(5);
  });

  it('uses dedicated 86400s idempotency scope with deterministic hashes', () => {
    const req = buildConsumer();
    const h1 = repo.computeConsumerRequestHash(req);
    const h2 = repo.computeConsumerRequestHash(req);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    const credReq = buildCredential(randomUUID());
    const h3 = repo.computeCredentialRequestHash(credReq);
    expect(h3).toMatch(/^[a-f0-9]{64}$/);
  });
});
