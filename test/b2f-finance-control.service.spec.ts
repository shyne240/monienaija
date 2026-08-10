import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { B2FFinanceControlPolicy } from '../src/policy/b2f-finance-control.entity';
import type { B2FFinanceControlDecision } from '../src/policy/b2f-finance-control.entity';
import { B2FFinanceControlService } from '../src/policy/b2f-finance-control.service';
import type {
  B2FFinanceControlEvaluationV1,
  B2FFinanceControlPolicyDefinitionV1,
} from '../src/policy/b2f-finance-control.types';

class Repo<T extends { id: string; recordVersion?: number; status?: string }> {
  rows: T[] = [];
  create(v: Partial<T>) {
    return v as T;
  }
  async save(v: T) {
    await Promise.resolve();
    if (!v.id) v.id = randomUUID();
    const i = this.rows.findIndex((r) => r.id === v.id);
    if (i >= 0) {
      if (v.recordVersion) v.recordVersion++;
      this.rows[i] = v;
    } else this.rows.push(v);
    return v;
  }
  async findOne(o: { where: Record<string, unknown> }) {
    await Promise.resolve();
    return (
      this.rows.find((r) =>
        Object.entries(o.where).every(
          ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
        ),
      ) ?? null
    );
  }
  createQueryBuilder() {
    let ref = '';
    const q = {
      where: (_s: string, v: { reference: string }) => {
        ref = v.reference;
        return q;
      },
      setLock: (mode: string) => {
        void mode;
        return q;
      },
      getOne: async () => {
        await Promise.resolve();
        return (
          this.rows.find(
            (r) => (r as unknown as { policyReference?: string }).policyReference === ref,
          ) ?? null
        );
      },
    };
    return q;
  }
}
class Idem {
  m = new Map<
    string,
    { id: string; requestHash: string; responseBody: Record<string, unknown> | null }
  >();
  async reserve(_m: EntityManager, c: { scope: string; key: string; requestHash: string }) {
    await Promise.resolve();
    const k = c.scope + c.key,
      e = this.m.get(k);
    if (e) {
      if (e.requestHash !== c.requestHash) throw new ConflictException();
      return { kind: 'REPLAY' as const, record: e };
    }
    const r = { id: randomUUID(), requestHash: c.requestHash, responseBody: null };
    this.m.set(k, r);
    return { kind: 'NEW' as const, record: r };
  }
  async complete(_m: EntityManager, id: string, c: { responseBody: Record<string, unknown> }) {
    await Promise.resolve();
    [...this.m.values()].find((v) => v.id === id)!.responseBody = c.responseBody;
  }
}
const principal = {
  type: 'PRIVILEGED' as const,
  principalId: 'checker',
  roles: ['FINANCE_APPROVER', 'FINANCE_CONTROLLER'],
  scopes: ['privileged:execute'],
  customerAccess: 'NONE' as const,
  assuranceLevel: 'MFA' as const,
};
const ctx = { requestId: randomUUID(), correlationId: randomUUID(), traceId: randomUUID() };
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
    {
      action: 'FINANCE_PERIOD_OPEN',
      makerRoles: ['FINANCE_PREPARER'],
      checkerRoles: ['FINANCE_CONTROLLER'],
      minimumApprovals: 1,
      materialityApplies: false,
      overrideEvidenceRequired: false,
    },
    {
      action: 'FINANCE_PERIOD_HARD_CLOSE',
      makerRoles: ['FINANCE_PREPARER'],
      checkerRoles: ['FINANCE_CONTROLLER'],
      minimumApprovals: 1,
      materialityApplies: false,
      overrideEvidenceRequired: true,
    },
    {
      action: 'FINANCE_PERIOD_REOPEN',
      makerRoles: ['FINANCE_PREPARER'],
      checkerRoles: ['FINANCE_CONTROLLER'],
      minimumApprovals: 1,
      materialityApplies: false,
      overrideEvidenceRequired: true,
    },
  ],
};

describe('B2F Finance control service (B2F06)', () => {
  let policies: Repo<B2FFinanceControlPolicy>,
    decisions: Repo<B2FFinanceControlDecision>,
    service: B2FFinanceControlService,
    audits: string[],
    approvalCalls: number;
  beforeEach(async () => {
    policies = new Repo();
    decisions = new Repo();
    audits = [];
    approvalCalls = 0;
    const manager = {
      getRepository: (e: unknown) => (e === B2FFinanceControlPolicy ? policies : decisions),
    } as unknown as EntityManager;
    const ds = {
      transaction: async (_i: string, cb: (m: EntityManager) => Promise<unknown>) => cb(manager),
      getRepository: (e: unknown) => (e === B2FFinanceControlPolicy ? policies : decisions),
    } as unknown as DataSource;
    service = new B2FFinanceControlService(
      ds,
      new Idem() as never,
      {
        record: async (_m: EntityManager, c: { action: string }) => {
          await Promise.resolve();
          audits.push(c.action);
        },
      } as never,
      {
        consume: async () => {
          await Promise.resolve();
          approvalCalls += 1;
          return { approved: true, reason: 'CONSUMED' };
        },
      } as never,
    );
    const created = await service.createPolicy({
      definition,
      idempotencyKey: randomUUID(),
      principal,
      requestContext: ctx,
    });
    const p = policies.rows[0]!;
    p.status = 'ACTIVE';
    p.recordVersion = (created as { recordVersion: number }).recordVersion;
    await policies.save(p);
  });
  const approval = (maker = 'maker', checker = 'checker') => ({
    id: randomUUID(),
    actionType: 'FINANCE_JOURNAL_POST',
    resourceType: 'JOURNAL',
    resourceId: 'resource-1',
    customerId: null,
    requesterPrincipalId: maker,
    approvedBy: checker,
    approvalScope: 'finance:approve',
    requiredAssurance: 'MFA',
    policy: { requiredRoles: ['FINANCE_PREPARER'] },
    status: PrivilegedActionApprovalStatus.CONSUMED,
    isEmergency: false,
    requestedAt: new Date(),
    expiresAt: new Date(Date.now() + 1000),
    approvedAt: new Date(),
    rejectedAt: null,
    cancelledAt: null,
    consumedAt: new Date(),
    version: 1,
  });
  const request = (
    overrides: Partial<B2FFinanceControlEvaluationV1> = {},
  ): B2FFinanceControlEvaluationV1 => ({
    action: 'FINANCE_JOURNAL_POST',
    amountMinor: '50',
    resourceType: 'JOURNAL',
    resourceId: 'resource-1',
    resourceVersion: 1,
    resourceHash: 'a'.repeat(64),
    makerPrincipalId: 'maker',
    makerRoles: ['FINANCE_PREPARER'],
    executorPrincipal: principal,
    approvals: [approval()],
    idempotencyKey: randomUUID(),
    requestContext: ctx,
    evaluatedAt: new Date('2026-08-09T00:00:00Z'),
    ...overrides,
  });
  it('publishes a role/control contract through read-only consumer ports', async () => {
    expect(service.getConsumerPorts().contractName).toBe('B2F-FINANCE-CONTROL');
    expect((await service.getConsumerPorts().getActivePolicy())?.policyVersion).toBe(1);
  });
  it('activates policy only through the existing A2 privileged approval integration', async () => {
    const policy = policies.rows[0]!;
    policy.status = 'DRAFT';
    const result = await service.activatePolicy({
      policyReference: policy.policyReference,
      expectedRecordVersion: policy.recordVersion,
      approvalId: randomUUID(),
      principal,
      idempotencyKey: randomUUID(),
      requestContext: ctx,
    });
    expect(result).toMatchObject({ status: 'ACTIVE' });
    expect(approvalCalls).toBe(1);
  });
  it('selects deterministic standard and elevated materiality bands', async () => {
    expect((await service.evaluate(request())).materialityBand).toBe('STANDARD');
    expect(
      (await service.evaluate(request({ amountMinor: '500', idempotencyKey: randomUUID() })))
        .materialityBand,
    ).toBe('ELEVATED');
  });
  it('requires override evidence for the material band', async () => {
    const denied = await service.evaluate(request({ amountMinor: '1001' }));
    expect(denied.outcome).toBe('DENY');
    expect(denied.reasons).toContain('OVERRIDE_EVIDENCE_REQUIRED');
    const allowed = await service.evaluate(
      request({
        amountMinor: '1001',
        overrideEvidenceReference: 'materiality-override-1',
        idempotencyKey: randomUUID(),
      }),
    );
    expect(allowed.outcome).toBe('ALLOW');
  });
  it('enforces maker-checker and rejects self approval', async () => {
    const d = await service.evaluate(request({ makerPrincipalId: 'checker' }));
    expect(d.outcome).toBe('DENY');
    expect(d.reasons).toContain('SELF_APPROVAL_FORBIDDEN');
  });
  it('rejects insufficient maker and checker roles', async () => {
    const d = await service.evaluate(
      request({ makerRoles: ['OTHER'], executorPrincipal: { ...principal, roles: ['OTHER'] } }),
    );
    expect(d.reasons).toEqual(
      expect.arrayContaining(['MAKER_ROLE_INSUFFICIENT', 'CHECKER_ROLE_INSUFFICIENT']),
    );
  });
  it('rejects stale or mismatched approval evidence', async () => {
    const bad = { ...approval(), resourceId: 'other' };
    const d = await service.evaluate(request({ approvals: [bad] }));
    expect(d.reasons).toContain('APPROVAL_STALE_OR_MISMATCHED');
  });
  it('is deterministic and replay safe', async () => {
    const r = request(),
      first = await service.evaluate(r),
      replay = await service.evaluate(r);
    expect(replay.replayed).toBe(true);
    expect(replay.decisionReference).toBe(first.decisionReference);
  });
  it('conflicts when idempotency key is reused for changed semantics', async () => {
    const r = request();
    await service.evaluate(r);
    await expect(service.evaluate({ ...r, amountMinor: '99' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('fails closed without an active policy', async () => {
    policies.rows[0]!.status = 'RETIRED';
    const d = await service.evaluate(request());
    expect(d.outcome).toBe('DENY');
    expect(d.reasons).toContain('ACTIVE_CONTROL_POLICY_NOT_FOUND');
  });
  it('audits policy and deterministic control decisions', async () => {
    await service.evaluate(request());
    expect(audits).toEqual(
      expect.arrayContaining(['FINANCE_CONTROL_POLICY_CREATED', 'FINANCE_CONTROL_ALLOWED']),
    );
  });
});
