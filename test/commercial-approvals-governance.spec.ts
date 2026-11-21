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

function makeApprovalRow(
  overrides: Partial<PrivilegedActionApproval> = {},
): PrivilegedActionApproval {
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
      save: jest.fn((entity: PrivilegedActionApproval) => {
        const next = { ...entity, version: (entity.version ?? 1) + 1 };
        store.set(entity.id, next);
        return Promise.resolve({ ...next });
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
          getOne: jest.fn(() => {
            const row = targetId ? store.get(targetId) : undefined;
            return Promise.resolve(row ? { ...row } : null);
          }),
        };
        return qb;
      }),
    })),
    findOne: jest.fn((_entity: unknown, opts: { where: { id: string } }) => {
      const row = store.get(opts.where.id);
      return Promise.resolve(row ? { ...row } : null);
    }),
    save: jest.fn((_entity: unknown, entity: PrivilegedActionApproval) => {
      const next = { ...entity, version: (entity.version ?? 1) + 1 };
      store.set(entity.id, next);
      return Promise.resolve({ ...next });
    }),
    create: jest.fn((_entity: unknown, data: Partial<PrivilegedActionApproval>) => ({ ...data })),
  });

  const dataSource = {
    transaction: jest.fn(
      async (cb: (manager: ReturnType<typeof makeManager>) => Promise<unknown>) => {
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
      },
    ),
  };

  const approvalRepository = {
    findOne: jest.fn((opts: { where: { id: string } }) => {
      const row = store.get(opts.where.id);
      return Promise.resolve(row ? { ...row } : null);
    }),
    createQueryBuilder: jest.fn(() => {
      const filters: Record<string, unknown> = {};
      let skipN = 0;
      let takeN = 50;
      const applyFilters = () =>
        Array.from(store.values()).filter((r) => {
          if (filters.status && r.status !== filters.status) return false;
          if (filters.actionType && r.actionType !== filters.actionType) return false;
          if (filters.resourceType && r.resourceType !== filters.resourceType) return false;
          if (Array.isArray(filters.scopes) && !filters.scopes.includes(r.approvalScope)) {
            return false;
          }
          if (filters.mfaAssurance && r.requiredAssurance === filters.mfaAssurance) return false;
          if (
            Array.isArray(filters.agentFundingActions) &&
            filters.agentFundingActions.includes(r.actionType)
          ) {
            return false;
          }
          if (
            Array.isArray(filters.forbiddenRegisteredActions) &&
            filters.forbiddenRegisteredActions.includes(r.actionType)
          ) {
            return false;
          }
          if (
            Array.isArray(filters.registeredActions) &&
            Array.isArray(filters.principalRoles) &&
            !filters.registeredActions.includes(r.actionType)
          ) {
            const approvingRoles = Array.isArray(r.policy?.approvingRoles)
              ? (r.policy.approvingRoles as string[])
              : [];
            const requiredRoles = Array.isArray(r.policy?.requiredRoles)
              ? (r.policy.requiredRoles as string[])
              : [];
            const rolesToCheck = approvingRoles.length > 0 ? approvingRoles : requiredRoles;
            if (
              rolesToCheck.length > 0 &&
              !rolesToCheck.some((role) => (filters.principalRoles as string[]).includes(role))
            ) {
              return false;
            }
          }
          return true;
        });
      const qb: {
        orderBy: jest.Mock;
        addOrderBy: jest.Mock;
        andWhere: jest.Mock;
        skip: jest.Mock;
        take: jest.Mock;
        getManyAndCount: jest.Mock;
      } = {
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn((clause: string, params: Record<string, unknown>) => {
          Object.assign(filters, params);
          void clause;
          return qb;
        }),
        skip: jest.fn((n: number) => {
          skipN = n;
          return qb;
        }),
        take: jest.fn((n: number) => {
          takeN = n;
          return qb;
        }),
        getManyAndCount: jest.fn(() => {
          const all = applyFilters();
          return Promise.resolve([all.slice(skipN, skipN + takeN), all.length]);
        }),
      };
      return qb;
    }),
  };

  const securityEventRepository = {
    create: jest.fn((d: unknown) => d),
    save: jest.fn((d: unknown) => Promise.resolve({ id: 'sec-1', ...(d as object) })),
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const authorizationService = {
    authorize: jest.fn().mockResolvedValue({ allowed: true }),
    hasFunctions: jest.fn().mockResolvedValue(true),
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

  it('enforces LIMIT_RULE_CREATE and LIMIT_RULE_UPDATE with LIMIT_RULE resourceType and limit.modify function code', async () => {
    const createDef = governedAction('LIMIT_RULE_CREATE');
    const updateDef = governedAction('LIMIT_RULE_UPDATE');
    for (const def of [createDef, updateDef]) {
      expect(def).toBeDefined();
      expect(def?.resourceType).toBe('LIMIT_RULE');
      expect(def?.initiatingRoles).toEqual(['FINANCE_PREPARER']);
      expect(def?.approvingRoles).toEqual(['FINANCE_CONTROLLER']);
      expect(def?.initiatingFunctionCodes).toEqual(['limit.modify']);
      expect(def?.approvingFunctionCodes).toEqual(['limit.modify']);
      expect(def?.approvalScope).toBe('limit.modify');
      expect(def?.minimumAssurance).toBe('MFA');
    }

    const limitRow = makeApprovalRow({
      id: '55555555-5555-4555-8555-555555555555',
      actionType: 'LIMIT_RULE_UPDATE',
      resourceType: 'LIMIT_RULE',
      resourceId: 'limit-rule-1',
    });
    const { service } = buildService([limitRow]);

    // Missing limit.modify function code -> rejected
    const missingFn = await service.approve({
      approvalId: limitRow.id,
      principal: makePrincipal({
        principalId: 'controller-1',
        scopes: ['privileged:approve'],
      }),
    });
    expect(missingFn.approved).toBe(false);
    expect(missingFn.reason).toBe('FUNCTION_MISSING');

    // Independent FINANCE_CONTROLLER with limit.modify + privileged:approve + MFA -> approved
    const valid = await service.approve({
      approvalId: limitRow.id,
      principal: makePrincipal({
        principalId: 'controller-1',
        scopes: ['privileged:approve', 'limit.modify'],
      }),
    });
    expect(valid.approved).toBe(true);
    expect(valid.reason).toBe('APPROVED');
  });

  it('paginates and counts database-filtered results accurately across large mixed-authority datasets', async () => {
    const rows: PrivilegedActionApproval[] = [];
    for (let i = 0; i < 60; i += 1) {
      rows.push(
        makeApprovalRow({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          actionType: 'FEE_RULE_CREATE',
          resourceType: 'FEE_RULE',
          approvalScope: 'privileged:approve',
        }),
      );
    }
    for (let i = 60; i < 80; i += 1) {
      rows.push(
        makeApprovalRow({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          actionType: Object.values(AGENT_FUNDING_ACTIONS)[0]!.action,
          resourceType: 'AGENT_FUNDING',
          approvalScope: 'agent.fund',
        }),
      );
    }
    const { service } = buildService(rows);

    const page1 = await service.listApprovals({
      principal: makePrincipal({
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
      }),
      limit: 25,
      offset: 0,
    });
    expect(page1.total).toBe(60);
    expect(page1.items).toHaveLength(25);

    const page3 = await service.listApprovals({
      principal: makePrincipal({
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
      }),
      limit: 25,
      offset: 50,
    });
    expect(page3.total).toBe(60);
    expect(page3.items).toHaveLength(10);
  });

  it('enforces policy.approvingRoles, policy.requiredRoles, and missing role policies for unregistered actions', async () => {
    const unregisteredApproving = makeApprovalRow({
      id: '66666666-6666-4666-8666-666666666661',
      actionType: 'CUSTOM_UNREGISTERED_ACTION_1',
      policy: { approvingRoles: ['RISK_REVIEWER'] },
    });
    const unregisteredRequired = makeApprovalRow({
      id: '66666666-6666-4666-8666-666666666662',
      actionType: 'CUSTOM_UNREGISTERED_ACTION_2',
      policy: { requiredRoles: ['COMPLIANCE_OFFICER'] },
    });
    const unregisteredOpen = makeApprovalRow({
      id: '66666666-6666-4666-8666-666666666663',
      actionType: 'CUSTOM_UNREGISTERED_ACTION_3',
      policy: {},
    });
    const { service } = buildService([
      unregisteredApproving,
      unregisteredRequired,
      unregisteredOpen,
    ]);

    const riskReviewerList = await service.listApprovals({
      principal: makePrincipal({
        roles: ['RISK_REVIEWER'],
        scopes: ['privileged:approve'],
      }),
    });
    expect(riskReviewerList.total).toBe(2);
    expect(riskReviewerList.items.map((i) => i.id)).toEqual([
      unregisteredApproving.id,
      unregisteredOpen.id,
    ]);

    const controllerList = await service.listApprovals({
      principal: makePrincipal({
        roles: ['FINANCE_CONTROLLER'],
        scopes: ['privileged:approve'],
      }),
    });
    expect(controllerList.total).toBe(3);
  });

  it('handles non-array, null, object, string, and empty-array role policies safely', async () => {
    const nullPolicy = makeApprovalRow({
      id: '77777777-7777-4777-8777-777777777771',
      actionType: 'CUSTOM_NULL_ROLE',
      policy: { approvingRoles: null, requiredRoles: null },
    });
    const objectPolicy = makeApprovalRow({
      id: '77777777-7777-4777-8777-777777777772',
      actionType: 'CUSTOM_OBJ_ROLE',
      policy: { approvingRoles: { role: 'ADMIN' }, requiredRoles: {} },
    });
    const stringPolicy = makeApprovalRow({
      id: '77777777-7777-4777-8777-777777777773',
      actionType: 'CUSTOM_STR_ROLE',
      policy: { approvingRoles: 'RISK_REVIEWER', requiredRoles: 'OTHER' },
    });
    const emptyArrPolicy = makeApprovalRow({
      id: '77777777-7777-4777-8777-777777777774',
      actionType: 'CUSTOM_EMPTY_ARR_ROLE',
      policy: { approvingRoles: [], requiredRoles: ['COMPLIANCE_OFFICER'] },
    });
    const { service } = buildService([nullPolicy, objectPolicy, stringPolicy, emptyArrPolicy]);

    const reviewerList = await service.listApprovals({
      principal: makePrincipal({
        roles: ['RISK_REVIEWER'],
        scopes: ['privileged:approve'],
      }),
    });
    // null, object, string normalize to empty array (open); emptyArrPolicy falls back to requiredRoles=['COMPLIANCE_OFFICER'] (excluded)
    expect(reviewerList.total).toBe(3);
    expect(reviewerList.items.map((i) => i.id)).toEqual([
      nullPolicy.id,
      objectPolicy.id,
      stringPolicy.id,
    ]);
  });
});
