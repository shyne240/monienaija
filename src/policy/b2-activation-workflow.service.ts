/**
 * B2T05 — B2 activation workflow service.
 *
 * The B2 activation workflow service is the single B2-side activation
 * authority. It consumes B2T03 customer readiness and B2T04 merchant/agent
 * readiness through their consumer ports only and never recalculates
 * readiness. Activation is allowed only when the readiness outcome is
 * ATTESTED_READY. The service is deterministic, replay-safe, and supports
 * the state machine PENDING -> ACTIVE -> SUSPENDED -> REVOKED with a
 * dedicated idempotency scope. It exposes only read-only consumer ports
 * to later B2 tasks.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  B2_ACTIVATION_WORKFLOW_CONTRACT_NAME,
  B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION,
} from './b2-activation-workflow.constants';
import { B2ActivationWorkflowRepository } from './b2-activation-workflow.repository';
import type {
  B2ActivationState,
  B2ActivationWorkflowCompatibilityResultV1,
  B2ActivationWorkflowConsumerPortsV1,
  B2ActivationWorkflowDecisionV1,
  B2ActivationWorkflowReplaySafeResultV1,
  B2ActivationWorkflowRequestV1,
} from './b2-activation-workflow.types';

@Injectable()
export class B2ActivationWorkflowService {
  constructor(
    @Inject(B2ActivationWorkflowRepository)
    private readonly repository: B2ActivationWorkflowRepository,
  ) {}

  getContractName(): string {
    return B2_ACTIVATION_WORKFLOW_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B2_ACTIVATION_WORKFLOW_CONTRACT_VERSION;
  }

  getConsumerPorts(): B2ActivationWorkflowConsumerPortsV1 {
    return this.repository.getConsumerPorts();
  }

  compatibilityCheck(
    request: B2ActivationWorkflowRequestV1,
  ): B2ActivationWorkflowCompatibilityResultV1 {
    return this.repository.compatibilityCheck(request);
  }

  computeRequestHash(request: B2ActivationWorkflowRequestV1): string {
    return this.repository.computeRequestHash(request);
  }

  generateActivationDecision(
    request: B2ActivationWorkflowRequestV1,
  ): B2ActivationWorkflowDecisionV1 {
    return this.repository.generateActivationDecision(request);
  }

  transitionState(
    current: B2ActivationWorkflowDecisionV1,
    targetState: B2ActivationState,
  ): B2ActivationWorkflowDecisionV1 {
    return this.repository.transitionState(current, targetState);
  }

  replaySafeGenerateActivationDecision(
    request: B2ActivationWorkflowRequestV1,
    existingByKey?: { decision: B2ActivationWorkflowDecisionV1; requestHash: string } | null,
  ): B2ActivationWorkflowReplaySafeResultV1 {
    return this.repository.replaySafeGenerateActivationDecision(request, existingByKey ?? null);
  }
}
