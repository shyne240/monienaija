import { randomUUID } from 'node:crypto';

import { B2ActivationWorkflowRepository } from '../src/policy/b2-activation-workflow.repository';
import { B2ActivationWorkflowService } from '../src/policy/b2-activation-workflow.service';
import {
  B2_ACTIVATION_WORKFLOW_CONTRACT_NAME,
  B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE,
} from '../src/policy/b2-activation-workflow.constants';
import type { B2ActivationWorkflowRequestV1 } from '../src/policy/b2-activation-workflow.types';

const buildRequest = (
  overrides: Partial<B2ActivationWorkflowRequestV1> = {},
): B2ActivationWorkflowRequestV1 => ({
  kind: 'CUSTOMER',
  principalId: randomUUID(),
  cohortKey: 'b2.activation.cohort.inbound-funding',
  cohortVersion: 1,
  b1ScopeKey: 'commercial.virtual-account.inbound-funding',
  b1ScopeVersion: 1,
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  region: 'NG',
  readinessOutcome: 'ATTESTED_READY',
  readinessReference: `b2-activation-readiness-${randomUUID()}`,
  readinessKind: 'CUSTOMER',
  idempotencyKey: randomUUID(),
  requestContext: {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  } as never,
  causationId: randomUUID(),
  ...overrides,
});

describe('B2 activation workflow service (B2T05)', () => {
  let service: B2ActivationWorkflowService;

  beforeEach(() => {
    service = new B2ActivationWorkflowService(new B2ActivationWorkflowRepository());
  });

  it('exposes the contract and dedicated idempotency scope', () => {
    expect(service.getContractName()).toBe(B2_ACTIVATION_WORKFLOW_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(1);
    expect(service.getConsumerPorts().idempotencyScope).toBe(
      B2_ACTIVATION_WORKFLOW_IDEMPOTENCY_SCOPE,
    );
  });

  it('creates a PENDING activation and transitions through the state machine', () => {
    const pending = service.generateActivationDecision(buildRequest());
    expect(pending.state).toBe('PENDING');
    const active = service.transitionState(pending, 'ACTIVE');
    expect(active.state).toBe('ACTIVE');
    const suspended = service.transitionState(active, 'SUSPENDED');
    expect(suspended.state).toBe('SUSPENDED');
    const revoked = service.transitionState(suspended, 'REVOKED');
    expect(revoked.state).toBe('REVOKED');
  });

  it('is replay-safe', () => {
    const req = buildRequest();
    const first = service.replaySafeGenerateActivationDecision(req, null);
    const replay = service.replaySafeGenerateActivationDecision(req, {
      decision: first.decision!,
      requestHash: service.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
  });
});
