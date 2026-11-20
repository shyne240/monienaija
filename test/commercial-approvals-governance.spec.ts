import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import {
  AGENT_FUNDING_ACTIONS,
  governedAction,
} from '../src/authorization/governed-action.registry';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';

function makePrincipal(overrides: Partial<AuthorizationPrincipal> = {}): AuthorizationPrincipal {
  return {
    type: 'OPERATOR',
    principalId: 'controller-1',
    sessionId: '11111111-1111-4111-8111-111111111111',
    assuranceLevel: 'MFA',
    customerAccess: 'NONE',
    roles: ['FINANCE_CONTROLLER'],
    scopes: [
      'privileged:approve',
      ...(governedAction('FEE_RULE_CREATE')?.approvingFunctionCodes ?? []),
    ],
    ...overrides,
  };
}

function makeApprovalRow(overrides: Partial<PrivilegedActionApproval> = {}): PrivilegedActionApproval {
  const now = new Date();
  return {
    id: '22222222-2222-4222-8222-222222222222',
    actionType: 'FEE_RULE_CREATE',
    resourceType: 'FEE_RULE',
    resourceId: 'rule-001',
    customerId: null,
    actionFingerprint: 'a'.repeat(64),
    policy: {
      action: 'FEE_RULE_CREATE',
      resourceType: 'FEE_RULE',
      requiredRoles: ['FINANCE_PREPARER'],
      institutionId: 'inst-1',
    },
    approvalScope: 'privileged:approve',
    requiredAssurance: 'MFA',
    requesterPrincipalId: 'preparer-1',
    requesterSessionId: '33333333-3333-4333-8333-333333333333',
    approvedBy: null,
    approverSessionId: null,
    reason: 'Create standard transfer fee rule',
    status: PrivilegedActionApprovalStatus.REQUESTED,
    isEmergency: false,
    requestedAt: now,
    expiresAt: new Date(now.getTime() + 900_000),
    approvedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    consumedAt: null,
    emergencyReviewStatus: null,
    emergencyReviewedAt: null,
    emergencyReviewedBy: null,
    emergencyReviewNotes: null,
    emergencyWindowClosedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildService(rows: PrivilegedActionApproval[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  let lockPromise: Promise<void> = Promise.resolve();

  const makeManager = () => ({
    getRepository: jest.fn(() => ({
      save: jest.fn(async (entity: PrivilegedActionApproval) => {
        const next = { ...entity, version: (entity.version ?? 1) + 1 };
        store.set(entity.id, next);
        return { ...next };
      }),
      createQueryBuilder: jest.fn(() => {
        let targetId: string | undefined;
        const qb: {
          where: jest.Mock;
          setLock: jest.Mock;
          getOne: jest.Mock;
        } = {
          where: jest.fn((_clause: string, params: { approvalId?: string }) => {
            targetId = params.approvalId;
            return qb;
          }),
          setLock: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => {
            const row = targetId ? store.get(targetId) : undefined;
            return row ? { ...row } : null;
          }),
        };
        return qb;
      }),
    })),
    findOne: jest.fn(async (_entity: unknown, opts: { where: { id: string } }) => {
      const row = store.get(opts.where.id);
      return row ? { ...row } : null;
    }),
    save: jest.fn(async (_entity: unknown, entity: PrivilegedActionApproval) => {
      const next = { ...entity, version: (entity.version ?? 1) + 1 };
      store.set(entity.id, next);
      return { ...next };
    }),
    create: jest.fn((_entity: unknown, data: Partial<PrivilegedActionApproval>) => ({ ...data })),
  });

  const dataSource = {
    transaction: jest.fn(async (cb: (manager: ReturnType<typeof makeManager>) => Promise<unknown>) => {
      const prev = lockPromise;
      let release!: () => void;
      lockPromise = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        return await cb(makeManager());
      } finally {
        release();
      }
    }),
  };

  const approvalRepository = {
    findOne: jest.fn(async (opts: { where: { id: string } }) => {
      const row = store.get(opts.where.id);
      return row ? { ...row } : null;
    }),
    createQueryBuilder: jest.fn(() => {
      const filters: Record<string, unknown> = {};
      const qb: {
        orderBy: jest.Mock;
        andWhere: jest.Mock;
        getMany: jest.Mock;
      } = {
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn((clause: string, params: Record<string, unknown>) => {
          Object.assign(filters, params);
          void clause;
          return qb;
        }),
        getMany: jest.fn(async () =>
          Array.from(store.values()).filter((r) => {
            if (filters.status && r.status !== filters.status) return false;
            if (filters.actionType && r.actionType !== filters.actionType) return false;
            if (filters.resourceType && r.resourceType !== filters.resourceType) return false;
            return true;
          }),
        ),
      };
      return qb;
    }),
  };

  const securityEventRepository = {
    create: jest.fn((d: unknown) => d),
    save: jest.fn(async (d: unknown) => ({ id: 'sec-1', ...(d as object) })),
  };

  const auditService = {
    record: jest.fn(async () => undefined),
  };

  const authorizationService = {
    authorize: jest.fn(async () => ({ allowed: true })),
    hasFunctions: jest.fn(async () => true),
  };

  const service = new PrivilegedActionApprovalService(
    approvalRepository as never,
    securityEventRepository as never,
    dataSource as never,
    auditService as never,
    authorizationService as never,
  );

  return { service, store };
}

describe('Commercial Approvals & Governance', () => {
  it('forbids self-approval when requester tries to approve their own proposal', async () => {
    const row = makeApprovalRow({ requesterPrincipalId: 'preparer-1' });
    const { service } = buildService([row]);

    const result = await service.approve({
      approvalId: row.id,
      principal: makePrincipal({ principalId: 'preparer-1' }),
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('filters out proposals outside the principal authorized scope in listApprovals', async () => {
    const feeRow = makeApprovalRow({
      id: '22222222-2222-4222-8222-222222222222',
      actionType: 'FEE_RULE_CREATE',
      resourceType: 'FEE_RULE',
    });
    const fundingRow = makeApprovalRow({
      id: '44444444-4444-4444-8444-444444444444',
      actionType: Object.values(AGENT_FUNDING_ACTIONS)[0]!.action,
      resourceType: 'AGENT_FUNDING',
      approvalScope: 'agent.fund',
    });
    const { service } = buildService([feeRow, fundingRow]);

    // Preparer without FINANCE_CONTROLLER role sees nothing
    const preparerList = await service.listApprovals({
      principal: makePrincipal({
        principalId: 'preparer-1',
        roles: ['FINANCE_PREPARER'],
        scopes: ['commercial:prepare'],
      }),
    });
    expect(preparerList.total).toBe(0);

    // Controller without MFA sees nothing
    const noMfaList = await service.listApprovals({
      principal: makePrincipal({ assuranceLevel: 'PASSWORD' }),
    });
    expect(noMfaList.total).toBe(0);

    // SUPER_ADMIN cannot see agent funding approvals (Decision 7)
    const superAdminList = await service.listApprovals({
      principal: makePrincipal({
        roles: ['SUPER_ADMIN', 'FINANCE_CONTROLLER'],
        scopes: ['privileged:approve', 'agent.fund'],
      }),
    });
    expect(superAdminList.items.map((i) => i.id)).toEqual([feeRow.id]);
  });

  it('rejects stale version when expectedVersion does not match current version', async () => {
    const row = makeApprovalRow({ version: 2 });
    const { service } = buildService([row]);

    const result = await service.approve({
      approvalId: row.id,
      principal: makePrincipal({ principalId: 'controller-1' }),
      expectedVersion: 1,
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('STALE_VERSION');
  });

  it('prevents duplicate approvals on an already-approved proposal', async () => {
    const row = makeApprovalRow();
    const { service } = buildService([row]);

    const first = await service.approve({
      approvalId: row.id,
      principal: makePrincipal({ principalId: 'controller-1' }),
      expectedVersion: 1,
    });
    expect(first.approved).toBe(true);
    expect(first.reason).toBe('APPROVED');

    const second = await service.approve({
      approvalId: row.id,
      principal: makePrincipal({ principalId: 'controller-2' }),
    });
    expect(second.approved).toBe(false);
    expect(second.reason).toBe('APPROVED');
  });

  it('supports rejection workflow with reason/comment', async () => {
    const row = makeApprovalRow();
    const { service, store } = buildService([row]);

    const result = await service.reject({
      approvalId: row.id,
      principal: makePrincipal({ principalId: 'controller-1' }),
      comment: 'Fee rate exceeds policy cap',
      expectedVersion: 1,
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('REJECTED');
    expect(store.get(row.id)?.status).toBe(PrivilegedActionApprovalStatus.REJECTED);
  });

  it('allows only one winner when concurrent reviewers race to approve', async () => {
    const row = makeApprovalRow();
    const { service } = buildService([row]);

    const [r1, r2] = await Promise.all([
      service.approve({
        approvalId: row.id,
        principal: makePrincipal({ principalId: 'controller-1' }),
      }),
      service.approve({
        approvalId: row.id,
        principal: makePrincipal({ principalId: 'controller-2' }),
      }),
    ]);

    const winners = [r1, r2].filter((r) => r.approved);
    const losers = [r1, r2].filter((r) => !r.approved);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.reason).toBe('APPROVED');
  });
});
