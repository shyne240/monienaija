/**
 * B2T03 — B2 customer activation-readiness service.
 *
 * The B2 customer activation-readiness service is the single B2-side
 * entry point for the customer activation-readiness attestation. It is a
 * read-only service that exposes the deterministic attestation, the
 * replay-safe attestation, the compatibility check, the versioning
 * contract, and the read-only consumer boundary surface. It never
 * activates a customer, never creates a public API, never creates a
 * credential, never dispatches a notification, never mutates an A1-A7/B1
 * authority, never posts a ledger entry, and never performs commercial
 * execution.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME,
  B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION,
} from './b2-customer-activation-readiness.constants';
import { B2CustomerActivationReadinessRepository } from './b2-customer-activation-readiness.repository';
import type {
  B2CustomerActivationReadinessCompatibilityResultV1,
  B2CustomerActivationReadinessConsumerPortsV1,
  B2CustomerActivationReadinessDecisionV1,
  B2CustomerActivationReadinessReplaySafeResultV1,
  B2CustomerActivationReadinessRequestV1,
} from './b2-customer-activation-readiness.types';

@Injectable()
export class B2CustomerActivationReadinessService {
  constructor(
    @Inject(B2CustomerActivationReadinessRepository)
    private readonly repository: B2CustomerActivationReadinessRepository,
  ) {}

  getContractName(): string {
    return B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2CustomerActivationReadinessConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  compatibilityCheck(
    request: B2CustomerActivationReadinessRequestV1,
  ): B2CustomerActivationReadinessCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  computeRequestHash(request: B2CustomerActivationReadinessRequestV1): string {
    return this.repository.computeRequestHash(request);
  }

  generateAttestationDecision(
    request: B2CustomerActivationReadinessRequestV1,
  ): B2CustomerActivationReadinessDecisionV1 {
    return this.repository.generateAttestationDecision(request);
  }

  replaySafeGenerateAttestationDecision(
    request: B2CustomerActivationReadinessRequestV1,
    existingByKey?: {
      decision: B2CustomerActivationReadinessDecisionV1;
      requestHash: string;
    } | null,
  ): B2CustomerActivationReadinessReplaySafeResultV1 {
    return this.repository.replaySafeGenerateAttestationDecision(request, existingByKey ?? null);
  }
}
