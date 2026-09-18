import { randomUUID } from 'node:crypto';

import { B2WebhookRepository } from '../src/policy/b2-webhook.repository';
import { B2WebhookService } from '../src/policy/b2-webhook.service';
import type { B2WebhookRegistrationRequestV1 } from '../src/policy/b2-webhook.types';

describe('B2 webhook service (B2T09)', () => {
  let service: B2WebhookService;

  beforeEach(() => {
    service = new B2WebhookService(new B2WebhookRepository());
  });

  it('exposes the only B2 webhook authority', () => {
    expect(service.getContractName()).toBe('B2-WEBHOOK-AUTHORITY');
    expect(service.getConsumerPorts().idempotencyScope).toBe('b2.webhook.idempotency.v1');
  });

  it('delegates registration with challenge-response', () => {
    const req: B2WebhookRegistrationRequestV1 = {
      consumerId: randomUUID(),
      url: 'https://example.com/webhooks/monienaija',
      events: ['b2.activation.succeeded', 'b2.webhook.test'],
      secret: 'whsec_test1234567890abcdef1234567890ab',
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
    };
    const decision = service.generateRegistrationDecision(req);
    expect(decision.state).toBe('PENDING_VERIFICATION');
    const verified = service.verifyRegistrationChallenge(decision, decision.challengeNonce);
    expect(verified.verified).toBe(true);
    expect(verified.decision.state).toBe('VERIFIED');
  });

  it('delegates HMAC verification, freshness, and Delivery-Id', () => {
    const secret = 'test-secret-1234567890abcdef1234567890ab';
    const req: B2WebhookRegistrationRequestV1 = {
      consumerId: randomUUID(),
      url: 'https://example.com/webhooks/monienaija',
      events: ['b2.webhook.test'],
      secret,
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
    };
    const base = service.generateRegistrationDecision(req);
    const ver = service.verifyRegistrationChallenge(base, base.challengeNonce).decision;
    const delivery = service.generateDeliveryDecision(
      {
        registrationId: ver.registrationId,
        event: 'b2.webhook.test',
        payload: { hello: 'world' },
        cohortKey: 'b2.activation.cohort.inbound-funding',
        cohortVersion: 1,
        idempotencyKey: randomUUID(),
        requestContext: {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          traceId: randomUUID(),
        } as never,
        causationId: randomUUID(),
      } as never,
      ver,
      secret,
    );
    expect(delivery.signature.startsWith('sha256=')).toBe(true);
    expect(service.checkTimestampFreshness(delivery.timestamp).verified).toBe(true);
    expect(service.checkDeliveryIdUnique(delivery.deliveryId, new Set()).verified).toBe(true);
    expect(
      service.checkDeliveryIdUnique(delivery.deliveryId, new Set([delivery.deliveryId])).verified,
    ).toBe(false);
  });
});
