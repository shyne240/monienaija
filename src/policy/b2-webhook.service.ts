/**
 * B2T09 — B2 webhook authority service.
 *
 * The B2 webhook service is the only B2-side webhook authority. It
 * implements the deterministic, replay-safe webhook registration and
 * delivery lifecycle with HMAC-SHA256 signing and verification. It
 * exposes only read-only consumer ports to later B2 tasks.
 */

import { Inject, Injectable } from '@nestjs/common';

import { B2_WEBHOOK_CONTRACT_NAME, B2_WEBHOOK_CONTRACT_VERSION } from './b2-webhook.constants';
import { B2WebhookRepository } from './b2-webhook.repository';
import type {
  B2WebhookConsumerPortsV1,
  B2WebhookDeliveryDecisionV1,
  B2WebhookDeliveryRequestV1,
  B2WebhookRegistrationDecisionV1,
  B2WebhookRegistrationRequestV1,
  B2WebhookReplaySafeResultV1,
  B2WebhookSignatureVerificationRequestV1,
  B2WebhookVerificationResultV1,
} from './b2-webhook.types';

@Injectable()
export class B2WebhookService {
  constructor(
    @Inject(B2WebhookRepository)
    private readonly repository: B2WebhookRepository,
  ) {}

  getContractName(): string {
    return B2_WEBHOOK_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_WEBHOOK_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2WebhookConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  generateRegistrationDecision(
    request: B2WebhookRegistrationRequestV1,
  ): B2WebhookRegistrationDecisionV1 {
    return this.repository.generateRegistrationDecision(request);
  }

  verifyRegistrationChallenge(
    decision: B2WebhookRegistrationDecisionV1,
    providedChallenge: string,
  ): { verified: boolean; decision: B2WebhookRegistrationDecisionV1 } {
    return this.repository.verifyRegistrationChallenge(decision, providedChallenge);
  }

  replaySafeGenerateRegistrationDecision(
    request: B2WebhookRegistrationRequestV1,
    existingByKey?: { decision: B2WebhookRegistrationDecisionV1; requestHash: string } | null,
  ): B2WebhookReplaySafeResultV1<B2WebhookRegistrationDecisionV1> {
    return this.repository.replaySafeGenerateRegistrationDecision(request, existingByKey ?? null);
  }

  generateDeliveryDecision(
    request: B2WebhookDeliveryRequestV1,
    registration: B2WebhookRegistrationDecisionV1,
    secretForSigning: string,
  ): B2WebhookDeliveryDecisionV1 {
    return this.repository.generateDeliveryDecision(request, registration, secretForSigning);
  }

  verifyHmacSignature(
    request: B2WebhookSignatureVerificationRequestV1,
  ): B2WebhookVerificationResultV1 {
    return this.repository.verifyHmacSignature(request);
  }

  checkTimestampFreshness(timestamp: number, nowSeconds?: number): B2WebhookVerificationResultV1 {
    return this.repository.checkTimestampFreshness(timestamp, nowSeconds);
  }

  checkDeliveryIdUnique(deliveryId: string, seen: Set<string>): B2WebhookVerificationResultV1 {
    return this.repository.checkDeliveryIdUnique(deliveryId, seen);
  }

  getNextAttemptAt(attempt: number): string | null {
    return this.repository.getNextAttemptAt(attempt);
  }

  transitionDeliveryState(
    current: B2WebhookDeliveryDecisionV1,
    targetState: B2WebhookDeliveryDecisionV1['state'],
  ): B2WebhookDeliveryDecisionV1 {
    return this.repository.transitionDeliveryState(current, targetState);
  }

  replaySafeGenerateDeliveryDecision(
    request: B2WebhookDeliveryRequestV1,
    registration: B2WebhookRegistrationDecisionV1,
    secretForSigning: string,
    existingByKey?: { decision: B2WebhookDeliveryDecisionV1; requestHash: string } | null,
  ): B2WebhookReplaySafeResultV1<B2WebhookDeliveryDecisionV1> {
    return this.repository.replaySafeGenerateDeliveryDecision(
      request,
      registration,
      secretForSigning,
      existingByKey ?? null,
    );
  }
}
