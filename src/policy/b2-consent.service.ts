/**
 * B2T06 — B2 consent authority service.
 *
 * The B2 consent service is the only B2-side consent authority. It
 * implements Customer Consent, Marketing Consent, and Commercial Consent
 * for purposes B2_ACTIVATION, B2_COMMERCIAL, B2_SELF_SERVICE,
 * MARKETING_COMMERCIAL_OFFER with lifecycle PENDING -> GRANTED ->
 * REVOKED -> EXPIRED. It is deterministic and replay-safe with a
 * dedicated b2.consent.idempotency.v1 scope and an 86400s window. It
 * exposes only read-only consumer ports to later B2 tasks.
 */

import { Inject, Injectable } from '@nestjs/common';

import { B2_CONSENT_CONTRACT_NAME, B2_CONSENT_CONTRACT_VERSION } from './b2-consent.constants';
import { B2ConsentRepository } from './b2-consent.repository';
import type {
  B2ConsentCompatibilityResultV1,
  B2ConsentConsumerPortsV1,
  B2ConsentDecisionV1,
  B2ConsentReplaySafeResultV1,
  B2ConsentRequestV1,
  B2ConsentState,
} from './b2-consent.types';

@Injectable()
export class B2ConsentService {
  constructor(
    @Inject(B2ConsentRepository)
    private readonly repository: B2ConsentRepository,
  ) {}

  getContractName(): string {
    return B2_CONSENT_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_CONSENT_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2ConsentConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  compatibilityCheck(request: B2ConsentRequestV1): B2ConsentCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  computeRequestHash(request: B2ConsentRequestV1): string {
    return this.repository.computeRequestHash(request);
  }

  generateConsentDecision(request: B2ConsentRequestV1): B2ConsentDecisionV1 {
    return this.repository.generateConsentDecision(request);
  }

  transitionState(current: B2ConsentDecisionV1, targetState: B2ConsentState): B2ConsentDecisionV1 {
    return this.repository.transitionState(current, targetState);
  }

  replaySafeGenerateConsentDecision(
    request: B2ConsentRequestV1,
    existingByKey?: { decision: B2ConsentDecisionV1; requestHash: string } | null,
  ): B2ConsentReplaySafeResultV1 {
    return this.repository.replaySafeGenerateConsentDecision(request, existingByKey ?? null);
  }
}
