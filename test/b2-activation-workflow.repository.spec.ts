import { randomUUID } from 'node:crypto';

import { B2ActivationWorkflowRepository } from '../src/policy/b2-activation-workflow.repository';
import type { B2ActivationWorkflowRequestV1 } from '../src/policy/b2-activation-workflow.types';

const buildRequest = (
  overrides: Partial<B2ActivationWorkflowRequestV1> = {},
): B2ActivationWorkflowRequestV1 => ({
  kind: 'CUSTOMER',
  principalId: randomUUID(),
  beneficialOwnerCustomerId: randomUUID(),
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

describe('B2 activation workflow repository (B2T05)', () => {
  let repository: B2ActivationWorkflowRepository;

  beforeEach(() => {
    repository = new B2ActivationWorkflowRepository();
  });

  it('exposes the contract identity', () => {
    expect(repository.getContractName()).toBe('B2-ACTIVATION-WORKFLOW');
    expect(repository.getIdempotencyScope()).toBe('b2.activation-workflow.idempotency.v1');
  });

  it('creates a PENDING activation when readiness is ATTESTED_READY', () => {
    const d = repository.generateActivationDecision(buildRequest());
    expect(d.state).toBe('PENDING');
    expect(d.outcome).toBe('PENDING');
    expect(d.readinessOutcome).toBe('ATTESTED_READY');
    expect(d.activationReference.startsWith('b2-activation-')).toBe(true);
    expect(d.idempotencyScope).toBe('b2.activation-workflow.idempotency.v1');
  });

  it('never recalculates readiness — rejects non-ATTESTED_READY', () => {
    expect(() =>
      repository.generateActivationDecision(
        buildRequest({ readinessOutcome: 'ATTESTED_NOT_READY' as never }),
      ),
    ).toThrow(/B2_ACTIVATION_WORKFLOW_READINESS_NOT_READY|readinessOutcome must be ATTESTED_READY/);
  });

  it('enforces readinessKind must match principal kind', () => {
    const comp = repository.compatibilityCheck(
      buildRequest({ kind: 'MERCHANT', readinessKind: 'CUSTOMER' as never }),
    );
    expect(comp.compatible).toBe(false);
  });

  it('supports the state machine PENDING -> ACTIVE -> SUSPENDED -> REVOKED', () => {
    const pending = repository.generateActivationDecision(buildRequest());
    const active = repository.transitionState(pending, 'ACTIVE');
    expect(active.state).toBe('ACTIVE');
    expect(active.outcome).toBe('ACTIVATED');
    const suspended = repository.transitionState(active, 'SUSPENDED');
    expect(suspended.state).toBe('SUSPENDED');
    const revoked = repository.transitionState(suspended, 'REVOKED');
    expect(revoked.state).toBe('REVOKED');
  });

  it('rejects invalid transitions', () => {
    const pending = repository.generateActivationDecision(buildRequest());
    expect(() => repository.transitionState(pending, 'SUSPENDED')).toThrow(
      /invalid state transition PENDING -> SUSPENDED/,
    );
    const active = repository.transitionState(pending, 'ACTIVE');
    expect(() => repository.transitionState(active, 'REVOKED')).toThrow(
      /invalid state transition ACTIVE -> REVOKED/,
    );
  });

  it('is deterministic and replay-safe', () => {
    const key = randomUUID();
    const req = buildRequest({ idempotencyKey: key, principalId: randomUUID() });
    const first = repository.replaySafeGenerateActivationDecision(req, null);
    expect(first.replayed).toBe(false);
    expect(first.conflict).toBe(false);
    const replay = repository.replaySafeGenerateActivationDecision(req, {
      decision: first.decision!,
      requestHash: repository.computeRequestHash(req),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.decision?.activationReference).toBe(first.decision?.activationReference);

    const diff = buildRequest({ idempotencyKey: key, principalId: randomUUID() });
    const conflict = repository.replaySafeGenerateActivationDecision(diff, {
      decision: first.decision!,
      requestHash: repository.computeRequestHash(req),
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.failure?.code).toBe('B2_ACTIVATION_WORKFLOW_REPLAY_CONFLICT');
  });

  it('uses a dedicated idempotency scope', () => {
    expect(repository.getConsumerPorts().idempotencyScope).toBe(
      'b2.activation-workflow.idempotency.v1',
    );
    expect(repository.getConsumerPorts().idempotencyScope).not.toBe(
      'b2.customer-activation-readiness.idempotency.v1',
    );
    expect(repository.getConsumerPorts().idempotencyScope).not.toBe(
      'b2.merchant-activation-readiness.idempotency.v1',
    );
  });
});
