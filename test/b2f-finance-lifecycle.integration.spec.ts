import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../src/authorization/authorization.service';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { B2FFinanceControlService } from '../src/policy/b2f-finance-control.service';
import { B2FFinanceControlPolicy } from '../src/policy/b2f-finance-control.entity';
import type {
  B2FFinanceControlEvaluationV1,
  B2FFinanceControlPolicyDefinitionV1,
} from '../src/policy/b2f-finance-control.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * B2F Finance lifecycle coverage against real PostgreSQL.
 *
 * The whole point of this suite is the transaction boundary. B2FFinanceControlService owns a
 * SERIALIZABLE transaction and consumes the A2 approval through
 * `PrivilegedActionApprovalService.consumeInTransaction(manager, ...)`. Against real
 * PostgreSQL the previous nested-transaction form could not observe the caller's
 * pessimistic row lock and produced serialization/atomicity failures; this suite exercises
 * the corrected path end to end with the real approval service.
 */
describe('B2F Finance lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: B2FFinanceControlService;
  let approvals: PrivilegedActionApprovalService;

  const maker = {
    type: 'PRIVILEGED' as const,
    principalId: 'finance-maker',
    roles: ['FINANCE_PREPARER'],
    scopes: ['privileged:request'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  };
  const checker = {
    type: 'PRIVILEGED' as const,
    principalId: 'finance-checker',
    roles: ['FINANCE_APPROVER', 'FINANCE_CONTROLLER'],
    scopes: ['privileged:execute', 'privileged:approve'],
    customerAccess: 'NONE' as const,
    assuranceLevel: 'MFA' as const,
  };
  const ctx = () => ({
    requestId: randomUUID(),
    correlationId: randomUUID(),
    traceId: randomUUID(),
  });

  const definition: B2FFinanceControlPolicyDefinitionV1 = {
    policyKey: 'finance.control-policy.ng.primary',
    policyVersion: 1,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    materialityBands: [
      {
        name: 'STANDARD',
        minimumMinor: '0',
        maximumMinor: '100',
        requiredCheckerRoles: ['FINANCE_APPROVER'],
        requiredApprovalCount: 1,
        overrideEvidenceRequired: false,
      },
      {
        name: 'ELEVATED',
        minimumMinor: '101',
        maximumMinor: '1000',
        requiredCheckerRoles: ['FINANCE_CONTROLLER'],
        requiredApprovalCount: 1,
        overrideEvidenceRequired: false,
      },
      {
        name: 'MATERIAL',
        minimumMinor: '1001',
        maximumMinor: null,
        requiredCheckerRoles: ['FINANCE_CONTROLLER'],
        requiredApprovalCount: 1,
        overrideEvidenceRequired: true,
      },
    ],
    actionControls: [
      {
        action: 'FINANCE_JOURNAL_POST',
        makerRoles: ['FINANCE_PREPARER'],
        checkerRoles: ['FINANCE_APPROVER', 'FINANCE_CONTROLLER'],
        minimumApprovals: 1,
        materialityApplies: true,
        overrideEvidenceRequired: false,
      },
    ],
  } as B2FFinanceControlPolicyDefinitionV1;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('b2ffinance');

    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    approvals = new PrivilegedActionApprovalService(
      dataSource.getRepository(PrivilegedActionApproval),
      dataSource.getRepository(SecurityEventHistory),
      dataSource,
      audit,
      new AuthorizationService(dataSource, audit),
    );
    service = new B2FFinanceControlService(
      dataSource,
      new IdempotencyService(dataSource.getRepository(IdempotencyRecord)),
      audit,
      approvals,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createDraftPolicy(): Promise<B2FFinanceControlPolicy> {
    await service.createPolicy({
      definition,
      idempotencyKey: randomUUID(),
      principal: checker,
      requestContext: ctx(),
    } as never);
    const repo = dataSource.getRepository(B2FFinanceControlPolicy);
    const policy = await repo.findOne({ where: { policyKey: definition.policyKey } });
    if (!policy) throw new Error('Draft policy was not persisted');
    return policy;
  }

  /** Requests and approves a real A2 approval carrying the exact activation fingerprint. */
  async function approvedActivation(policy: B2FFinanceControlPolicy): Promise<string> {
    const fingerprint = service.computeActivationFingerprint(
      policy.policyReference,
      policy.policyKey,
      policy.policyVersion,
      policy.definitionHash,
      policy.effectiveFrom.toISOString(),
      policy.effectiveTo?.toISOString() ?? null,
      policy.recordVersion,
    );
    const requested = await approvals.request({
      principal: maker,
      policy: {
        action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
        resourceType: 'B2F_FINANCE_CONTROL_POLICY',
        requiredScopes: ['privileged:request'],
        minimumAssurance: 'MFA',
      } as never,
      resource: { type: 'B2F_FINANCE_CONTROL_POLICY', id: policy.id } as never,
      actionFingerprint: fingerprint,
      reason: 'Activate the Finance control policy',
    });
    const approvalId = requested.approval!.id;
    const approved = await approvals.approve({ principal: checker, approvalId });
    expect(approved.approved).toBe(true);
    return approvalId;
  }

  it('persists a draft control policy in real PostgreSQL', async () => {
    const policy = await createDraftPolicy();
    expect(policy.status).toBe('DRAFT');
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b2f_finance_control_policies',
    );
    expect(rows).toHaveLength(1);
  });

  it('replays policy creation idempotently', async () => {
    const key = randomUUID();
    const command = {
      definition,
      idempotencyKey: key,
      principal: checker,
      requestContext: ctx(),
    };
    await service.createPolicy(command as never);
    await service.createPolicy(command as never);
    const rows: Array<Record<string, unknown>> = await dataSource.query(
      'SELECT id FROM b2f_finance_control_policies',
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects the same creation key carrying a different request hash', async () => {
    const key = randomUUID();
    await service.createPolicy({
      definition,
      idempotencyKey: key,
      principal: checker,
      requestContext: ctx(),
    } as never);
    await expect(
      service.createPolicy({
        definition: { ...definition, effectiveFrom: '2026-02-01T00:00:00.000Z' },
        idempotencyKey: key,
        principal: checker,
        requestContext: ctx(),
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('transaction-aware approval consumption', () => {
    it('activates the policy by consuming a real A2 approval inside the caller transaction', async () => {
      const policy = await createDraftPolicy();
      const approvalId = await approvedActivation(policy);

      const result = (await service.activatePolicy({
        policyReference: policy.policyReference,
        expectedRecordVersion: policy.recordVersion,
        approvalId,
        principal: checker,
        idempotencyKey: randomUUID(),
        requestContext: ctx(),
      } as never)) as { status: string };

      expect(result.status).toBe('ACTIVE');

      // The approval was consumed in the same transaction that activated the policy.
      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM privileged_action_approvals WHERE id = $1',
        [approvalId],
      );
      expect(firstRow(rows, 'approval status').status).toBe('CONSUMED');
    });

    it('leaves the approval unconsumed when the activation transaction fails', async () => {
      const policy = await createDraftPolicy();
      const approvalId = await approvedActivation(policy);

      await expect(
        service.activatePolicy({
          policyReference: policy.policyReference,
          // Deliberately stale: the policy guard rejects before the approval is consumed.
          expectedRecordVersion: policy.recordVersion + 5,
          approvalId,
          principal: checker,
          idempotencyKey: randomUUID(),
          requestContext: ctx(),
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM privileged_action_approvals WHERE id = $1',
        [approvalId],
      );
      expect(firstRow(rows, 'approval status').status).toBe('APPROVED');

      const policies: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM b2f_finance_control_policies WHERE id = $1',
        [policy.id],
      );
      expect(firstRow(policies, 'policy status').status).toBe('DRAFT');
    });

    it('rolls the approval consumption back with the caller transaction', async () => {
      const policy = await createDraftPolicy();
      const approvalId = await approvedActivation(policy);
      const consumeArgs = {
        principal: checker,
        approvalId,
        actionType: 'FINANCE_CONTROL_POLICY_ACTIVATE',
        resource: { type: 'B2F_FINANCE_CONTROL_POLICY', id: policy.id },
        actionFingerprint: service.computeActivationFingerprint(
          policy.policyReference,
          policy.policyKey,
          policy.policyVersion,
          policy.definitionHash,
          policy.effectiveFrom.toISOString(),
          policy.effectiveTo?.toISOString() ?? null,
          policy.recordVersion,
        ),
      };

      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          const decision = await approvals.consumeInTransaction(manager, consumeArgs as never);
          expect(decision.approved).toBe(true);
          throw new Error('caller aborted');
        }),
      ).rejects.toThrow('caller aborted');

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT status FROM privileged_action_approvals WHERE id = $1',
        [approvalId],
      );
      // The consumption was undone with the caller transaction: the approval is still usable.
      expect(firstRow(rows, 'approval status').status).toBe('APPROVED');
    });

    it('shows why the nested form is a defect: consume() commits independently', async () => {
      // REGRESSION GUARD for the API contract. `consume()` opens its own transaction on a
      // second pooled connection, so an aborting caller cannot undo it. This is precisely
      // why every caller that already owns a transaction must use consumeInTransaction().
      const policy = await createDraftPolicy();
      const approvalId = await approvedActivation(policy);
      const consumeArgs = {
        principal: checker,
        approvalId,
        actionType: 'FINANCE_CONTROL_POLICY_ACTIVATE',
        resource: { type: 'B2F_FINANCE_CONTROL_POLICY', id: policy.id },
        actionFingerprint: service.computeActivationFingerprint(
          policy.policyReference,
          policy.policyKey,
          policy.policyVersion,
          policy.definitionHash,
          policy.effectiveFrom.toISOString(),
          policy.effectiveTo?.toISOString() ?? null,
          policy.recordVersion,
        ),
      };

      await expect(
        dataSource.transaction('SERIALIZABLE', async () => {
          const decision = await approvals.consume(consumeArgs as never);
          expect(decision.approved).toBe(true);
          throw new Error('caller aborted');
        }),
      ).rejects.toThrow('caller aborted');

      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT status FROM privileged_action_approvals WHERE id = $1',
        [approvalId],
      );
      // Burned despite the caller rolling back - the inconsistency the correction removes.
      expect(firstRow(rows, 'approval status').status).toBe('CONSUMED');
    });

    it('refuses an approval whose fingerprint targets a different record version', async () => {
      const policy = await createDraftPolicy();
      const wrongFingerprint = service.computeActivationFingerprint(
        policy.policyReference,
        policy.policyKey,
        policy.policyVersion,
        policy.definitionHash,
        policy.effectiveFrom.toISOString(),
        policy.effectiveTo?.toISOString() ?? null,
        policy.recordVersion + 1,
      );
      const requested = await approvals.request({
        principal: maker,
        policy: {
          action: 'FINANCE_CONTROL_POLICY_ACTIVATE',
          resourceType: 'B2F_FINANCE_CONTROL_POLICY',
          requiredScopes: ['privileged:request'],
          minimumAssurance: 'MFA',
        } as never,
        resource: { type: 'B2F_FINANCE_CONTROL_POLICY', id: policy.id } as never,
        actionFingerprint: wrongFingerprint,
        reason: 'Activate with a stale fingerprint',
      });
      await approvals.approve({ principal: checker, approvalId: requested.approval!.id });

      await expect(
        service.activatePolicy({
          policyReference: policy.policyReference,
          expectedRecordVersion: policy.recordVersion,
          approvalId: requested.approval!.id,
          principal: checker,
          idempotencyKey: randomUUID(),
          requestContext: ctx(),
        } as never),
      ).rejects.toBeTruthy();
    });

    it('cannot reuse a consumed approval', async () => {
      const policy = await createDraftPolicy();
      const approvalId = await approvedActivation(policy);
      await service.activatePolicy({
        policyReference: policy.policyReference,
        expectedRecordVersion: policy.recordVersion,
        approvalId,
        principal: checker,
        idempotencyKey: randomUUID(),
        requestContext: ctx(),
      } as never);

      await expect(
        service.activatePolicy({
          policyReference: policy.policyReference,
          expectedRecordVersion: policy.recordVersion,
          approvalId,
          principal: checker,
          idempotencyKey: randomUUID(),
          requestContext: ctx(),
        } as never),
      ).rejects.toBeTruthy();
    });
  });

  describe('control evaluation inside a real transaction', () => {
    async function activePolicy(): Promise<void> {
      const policy = await createDraftPolicy();
      const approvalId = await approvedActivation(policy);
      await service.activatePolicy({
        policyReference: policy.policyReference,
        expectedRecordVersion: policy.recordVersion,
        approvalId,
        principal: checker,
        idempotencyKey: randomUUID(),
        requestContext: ctx(),
      } as never);
    }

    function evaluation(
      overrides: Partial<B2FFinanceControlEvaluationV1> = {},
    ): B2FFinanceControlEvaluationV1 {
      return {
        action: 'FINANCE_JOURNAL_POST',
        amountMinor: '50',
        resourceType: 'JOURNAL',
        resourceId: 'resource-1',
        resourceVersion: 1,
        resourceHash: 'a'.repeat(64),
        makerPrincipalId: 'finance-maker',
        makerRoles: ['FINANCE_PREPARER'],
        executorPrincipal: checker,
        approvals: [],
        idempotencyKey: randomUUID(),
        requestContext: ctx(),
        evaluatedAt: new Date('2026-08-09T00:00:00Z'),
        ...overrides,
      } as B2FFinanceControlEvaluationV1;
    }

    it('persists a deterministic control decision', async () => {
      await activePolicy();
      const decision = await service.evaluate(evaluation());
      expect(['ALLOW', 'DENY']).toContain(decision.outcome);
      expect(decision.decisionHash).toMatch(/^[a-f0-9]{64}$/);
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM b2f_finance_control_decisions',
      );
      expect(rows).toHaveLength(1);
    });

    it('replays an identical evaluation without a second decision row', async () => {
      await activePolicy();
      const request = evaluation();
      const first = await service.evaluate(request);
      const second = await service.evaluate(request);
      expect(second.replayed).toBe(true);
      expect(second.decisionHash).toBe(first.decisionHash);
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM b2f_finance_control_decisions',
      );
      expect(rows).toHaveLength(1);
    });

    it('denies self-approval', async () => {
      await activePolicy();
      const decision = await service.evaluate(
        evaluation({ makerPrincipalId: checker.principalId }),
      );
      expect(decision.outcome).toBe('DENY');
      expect(decision.reasons).toContain('SELF_APPROVAL_FORBIDDEN');
    });

    it('fails closed when no active control policy exists', async () => {
      const decision = await service.evaluate(evaluation());
      expect(decision.outcome).toBe('DENY');
      expect(decision.reasons).toContain('ACTIVE_CONTROL_POLICY_NOT_FOUND');
    });

    it('shares the caller transaction through evaluateInTransaction', async () => {
      await activePolicy();
      const decision = await dataSource.transaction('SERIALIZABLE', async (manager) => {
        const inner = await service.evaluateInTransaction(manager, evaluation());
        // The decision row is visible to the caller's own manager before commit, which is
        // only possible because no nested transaction was opened.
        const rows: Array<Record<string, unknown>> = await manager.query(
          'SELECT id FROM b2f_finance_control_decisions',
        );
        expect(rows).toHaveLength(1);
        return inner;
      });
      expect(decision.decisionHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('discards the decision when the caller transaction rolls back', async () => {
      await activePolicy();
      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await service.evaluateInTransaction(manager, evaluation());
          throw new Error('caller aborted');
        }),
      ).rejects.toThrow('caller aborted');
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        'SELECT id FROM b2f_finance_control_decisions',
      );
      expect(rows).toEqual([]);
    });
  });
});
