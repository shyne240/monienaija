/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';

import { B2ApiConsumerRepository } from '../src/policy/b2-api-consumer.repository';
import { B2ApiConsumerService } from '../src/policy/b2-api-consumer.service';

describe('B2 API consumer service (B2T08)', () => {
  let service: B2ApiConsumerService;

  beforeEach(() => {
    service = new B2ApiConsumerService(new B2ApiConsumerRepository());
  });

  it('exposes the only B2 API consumer authority', () => {
    expect(service.getContractName()).toBe('B2-API-CONSUMER');
    expect(service.getContractVersion()).toBe(1);
    expect(service.getConsumerPorts().idempotencyScope).toBe('b2.api-consumer.idempotency.v1');
  });

  it('delegates consumer registration to the repository', () => {
    const req: any = {
      displayName: 'Svc Consumer',
      consumerType: 'DEVELOPER',
      ownerCustomerId: randomUUID(),
      audience: ['public:commercial:activation:b2:inbound-funding:read'],
      scopes: ['b2:activation:read'],
      cohortKey: 'b2.activation.cohort.inbound-funding',
      cohortVersion: 1,
      idempotencyKey: randomUUID(),
      requestContext: {
        requestId: randomUUID(),
        correlationId: randomUUID(),
        traceId: randomUUID(),
      },
      causationId: randomUUID(),
    };
    const d = service.generateConsumerDecision(req);
    expect(d.consumerReference.startsWith('b2-consumer-')).toBe(true);
    expect(d.state).toBe('ACTIVE');
  });

  it('delegates credential lifecycle', () => {
    const consumer = service.generateConsumerDecision({
      displayName: 'CredSvc',
      consumerType: 'DEVELOPER',
      ownerCustomerId: randomUUID(),
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
    } as never);
    const cred = service.generateCredentialDecision({
      consumerId: consumer.consumerId,
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
    } as never);
    expect(cred.secretHash).toContain('argon2id$');
    const rotated = service.rotateCredentialDecision(cred as never);
    expect(rotated.state).toBe('ROTATED');
    const revoked = service.revokeCredentialDecision(rotated as never);
    expect(revoked.state).toBe('REVOKED');
  });

  it('delegates quota and rate limiting', () => {
    const consumerId = randomUUID();
    const quota = service.createQuotaDecision(
      consumerId,
      'commercial.read',
      randomUUID(),
      randomUUID(),
    );
    expect(quota.limit).toBe(5000);
    const buckets = service.createRateLimitBucket(consumerId, 'global');
    expect(buckets.capacity).toBe(100);
    const consumed = service.consumeRateLimitToken(buckets, 1);
    expect(consumed.remaining).toBe(99);
  });
});
