/**
 * B2T04 — B2 merchant and agent activation-readiness service.
 *
 * The B2 merchant and agent activation-readiness service is the single
 * B2-side merchant/agent readiness authority. It never activates a
 * merchant or an agent, never creates a public API, never creates a
 * credential, never dispatches a notification, never posts a ledger
 * entry, never executes a settlement, and never mutates an A1-A7/B1
 * authority. It exposes only read-only consumer ports to later B2 tasks
 * (B2T05).
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION,
} from './b2-merchant-agent-activation-readiness.constants';
import { B2MerchantAgentActivationReadinessRepository } from './b2-merchant-agent-activation-readiness.repository';
import type {
  B2MerchantAgentActivationReadinessCompatibilityResultV1,
  B2MerchantAgentActivationReadinessConsumerPortsV1,
  B2MerchantAgentActivationReadinessDecisionV1,
  B2MerchantAgentActivationReadinessReplaySafeResultV1,
  B2MerchantAgentActivationReadinessRequestV1,
} from './b2-merchant-agent-activation-readiness.types';

@Injectable()
export class B2MerchantAgentActivationReadinessService {
  constructor(
    @Inject(B2MerchantAgentActivationReadinessRepository)
    private readonly repository: B2MerchantAgentActivationReadinessRepository,
  ) {}

  getContractName(): string {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_MERCHANT_AGENT_ACTIVATION_READINESS_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2MerchantAgentActivationReadinessConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  compatibilityCheck(
    request: B2MerchantAgentActivationReadinessRequestV1,
  ): B2MerchantAgentActivationReadinessCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  computeRequestHash(request: B2MerchantAgentActivationReadinessRequestV1): string {
    return this.repository.computeRequestHash(request);
  }

  generateAttestationDecision(
    request: B2MerchantAgentActivationReadinessRequestV1,
  ): B2MerchantAgentActivationReadinessDecisionV1 {
    return this.repository.generateAttestationDecision(request);
  }

  replaySafeGenerateAttestationDecision(
    request: B2MerchantAgentActivationReadinessRequestV1,
    existingByKey?: {
      decision: B2MerchantAgentActivationReadinessDecisionV1;
      requestHash: string;
    } | null,
  ): B2MerchantAgentActivationReadinessReplaySafeResultV1 {
    return this.repository.replaySafeGenerateAttestationDecision(request, existingByKey ?? null);
  }
}
