/**
 * P0-A unit tests: CommercialRuleGovernanceService — maker/checker lifecycle over the REAL
 * PrivilegedActionApprovalService (in-memory repositories), with AuthorizationService and
 * AuditService mocked. Covers allowed and denied cases: initiation, self-approval prohibition,
 * approval-scope enforcement, ungoverned-write closure (writes only via consumed approvals),
 * tamper rejection (fingerprint binding), replay rejection, expiry, rejection, and execution
 * failure auditing.
 */
import type { DataSource, DeepPartial, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import type { AuditService } from '../src/operations/audit.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import {
  CommercialRuleGovernanceService,
  governedChangeConsumptionError,
} from '../src/authorization/commercial-rule-governance.service';
import { governedChangeFingerprint } from '../src/authorization/governed-action.registry';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';

const MAKER_ID = '00000000-0000-4000-8000-0000000000a1';
const CHECKER_ID = '00000000-0000-4000-8000-0000000000a2';
const MAKER_SESSION = '00000000-0000-4000-8000-0000000000b1';
const CHECKER_SESSION = '00000000-0000-4000-8000-0000000000b2';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input?: DeepPartial<T>): T {
    return (input ?? {}) as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`;
    }
    record.createdAt ??= new Date('2026-01-01T00:00:00.000Z');
    record.updatedAt = new Date('2026-01-01T00:00:00.000Z');
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ) ?? null,
    );
  }

  createQueryBuilder() {
    let conditions: Partial<T> = {};
    const queryBuilder = {
      where(_condition: string, parameters: { approvalId: string }) {
        conditions = { id: parameters.approvalId } as unknown as Partial<T>;
        return this;
      },
      setLock() {
        return this;
      },
      getOne: () => this.findOne({ where: conditions }),
    };
    return queryBuilder;
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: unknown): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected repository');
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  readonly manager: MemoryManager;

  constructor(repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {
    this.manager = new MemoryManager(repositories);
  }

  transaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return callback(this.manager as unknown as EntityManager);
  }
}

const maker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: MAKER_ID,
  sessionId: MAKER_SESSION,
  roles: ['FINANCE_PREPARER'],
  scopes: ['fee_rule.create', 'fee_rule.modify', 'privileged:request'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const checker: AuthorizationPrincipal = {
  type: 'OPERATOR',
  principalId: CHECKER_ID,
  sessionId: CHECKER_SESSION,
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['fee_rule.create', 'fee_rule.modify', 'privileged:approve', 'privileged:execute'],
  customerAccess: 'NONE',
  assuranceLevel: 'MFA',
};

const createPayload = {
  productCode: 'CASH_IN',
  currency: 'NGN',
  percentageBps: 30,
  reason: 'Repricing cash-in for Q1',
};

function fixture() {
  const approvalRepository = new MemoryRepository<PrivilegedActionApproval>();
  const securityEventRepository = new MemoryRepository<SecurityEventHistory>();
  const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
    [PrivilegedActionApproval, approvalRepository as unknown as MemoryRepository<ObjectLiteral>],
    [SecurityEventHistory, securityEventRepository as unknown as MemoryRepository<ObjectLiteral>],
  ]);
  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const authorizationService = {
    authorize: jest.fn().mockResolvedValue({ allowed: true, action: 'FEE_RULE_CREATE' }),
    requireFunction: jest.fn().mockResolvedValue('fee_rule.create'),
  };
  const approvals = new PrivilegedActionApprovalService(
    approvalRepository as unknown as Repository<PrivilegedActionApproval>,
    securityEventRepository as unknown as Repository<SecurityEventHistory>,
    new MemoryDataSource(repositories) as unknown as DataSource,
    auditService as unknown as AuditService,
    authorizationService as unknown as AuthorizationService,
  );
  const governance = new CommercialRuleGovernanceService(
    approvals,
    auditService as unknown as AuditService,
    new MemoryDataSource(repositories) as unknown as DataSource,
  );
  return { governance, approvals, approvalRepository, auditService, authorizationService };
}

describe('CommercialRuleGovernanceService (P0-A)', () => {
  it('records a pending request whose fingerprint is the deterministic hash of the actual change', async () => {
    const { governance, approvalRepository } = fixture();
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });

    expect(view.status).toBe(PrivilegedActionApprovalStatus.REQUESTED);
    expect(view.actionType).toBe('FEE_RULE_CREATE');
    expect(view.resourceType).toBe('FEE_RULE');
    expect(view.resourceId).toBeNull();
    expect(view.actionFingerprint).toBe(
      governedChangeFingerprint('FEE_RULE_CREATE', 'FEE_RULE', null, createPayload),
    );
    expect(approvalRepository.records.size).toBe(1);
  });

  it('refuses unauthorized initiation and persists nothing', async () => {
    const { governance, approvalRepository, authorizationService } = fixture();
    authorizationService.authorize.mockResolvedValueOnce({ allowed: false, reason: 'ROLE_MISSING' });

    await expect(
      governance.requestChange({
        principal: maker,
        action: 'FEE_RULE_CREATE',
        payload: createPayload,
        reason: createPayload.reason,
      }),
    ).rejects.toThrow(/denied/i);
    expect(approvalRepository.records.size).toBe(0);
  });

  it('blocks self-approval and approval without the registered action function', async () => {
    const { governance, approvals } = fixture();
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });

    // Maker cannot approve their own request (established separation of duties).
    const selfDecision = await approvals.approve({ approvalId: view.approvalId, principal: maker });
    expect(selfDecision).toMatchObject({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' });

    // A checker without the action's approval function cannot approve either.
    const blindChecker = { ...checker, scopes: ['privileged:approve'] };
    const blindDecision = await approvals.approve({
      approvalId: view.approvalId,
      principal: blindChecker,
    });
    expect(blindDecision).toMatchObject({ approved: false, reason: 'FUNCTION_MISSING' });

    // The properly-scoped FINANCE_CONTROLLER approves.
    const decision = await approvals.approve({ approvalId: view.approvalId, principal: checker });
    expect(decision.approved).toBe(true);
  });

  it('executes an approved change once — via the approver — and blocks maker execution, replay and tampering', async () => {
    const { governance, approvals } = fixture();
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });
    await approvals.approve({ approvalId: view.approvalId, principal: checker });

    // The maker who requested the change cannot execute it.
    await expect(
      governance.executeChange({
        principal: maker,
        action: 'FEE_RULE_CREATE',
        approvalId: view.approvalId,
        payload: createPayload,
        write: jest.fn(),
      }),
    ).rejects.toThrow(/execute an approved change/i);

    // The approving FINANCE_CONTROLLER executes exactly the approved payload.
    const write = jest.fn().mockResolvedValue({ id: 'rule-1' });
    const result = await governance.executeChange({
      principal: checker,
      action: 'FEE_RULE_CREATE',
      approvalId: view.approvalId,
      payload: createPayload,
      write,
    });
    expect(result).toEqual({ id: 'rule-1' });
    expect(write).toHaveBeenCalledWith(null);

    // Replay is rejected (the approval is consumed).
    await expect(
      governance.executeChange({
        principal: checker,
        action: 'FEE_RULE_CREATE',
        approvalId: view.approvalId,
        payload: createPayload,
        write: jest.fn(),
      }),
    ).rejects.toThrow(/already been consumed/i);
  });

  it('allows a privileged:execute principal who is not the approver to execute (established consume rule)', async () => {
    const { governance, approvals } = fixture();
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });
    await approvals.approve({ approvalId: view.approvalId, principal: checker });

    const superAdmin: AuthorizationPrincipal = {
      type: 'PRIVILEGED',
      principalId: '00000000-0000-4000-8000-0000000000a3',
      sessionId: '00000000-0000-4000-8000-0000000000b3',
      roles: ['SUPER_ADMIN'],
      scopes: ['privileged:execute'],
      customerAccess: 'NONE',
      assuranceLevel: 'MFA',
    };
    const write = jest.fn().mockResolvedValue({ id: 'rule-2' });
    await expect(
      governance.executeChange({
        principal: superAdmin,
        action: 'FEE_RULE_CREATE',
        approvalId: view.approvalId,
        payload: createPayload,
        write,
      }),
    ).resolves.toEqual({ id: 'rule-2' });
  });

  it('rejects a tampered payload with 403 and never writes', async () => {
    const { governance, approvals } = fixture();
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });
    await approvals.approve({ approvalId: view.approvalId, principal: checker });

    const write = jest.fn();
    const tampered = { ...createPayload, percentageBps: 99 };
    await expect(
      governance.executeChange({
        principal: checker,
        action: 'FEE_RULE_CREATE',
        approvalId: view.approvalId,
        payload: tampered,
        write,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(write).not.toHaveBeenCalled();
  });

  it('binds modify requests to their resource and hands the bound id to the write', async () => {
    const { governance, approvals } = fixture();
    const modifyPayload = { isActive: false, version: 2, reason: 'Disable mispriced rule' };
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_MODIFY',
      resourceId: 'rule-42',
      payload: modifyPayload,
      reason: modifyPayload.reason,
    });
    expect(view.resourceId).toBe('rule-42');
    expect(view.actionFingerprint).toBe(
      governedChangeFingerprint('FEE_RULE_MODIFY', 'FEE_RULE', 'rule-42', modifyPayload),
    );
    await approvals.approve({ approvalId: view.approvalId, principal: checker });

    const write = jest.fn().mockResolvedValue({ id: 'rule-42', isActive: false });
    await governance.executeChange({
      principal: checker,
      action: 'FEE_RULE_MODIFY',
      approvalId: view.approvalId,
      payload: modifyPayload,
      write,
    });
    expect(write).toHaveBeenCalledWith('rule-42');
  });

  it('honours rejection and expiry as 409-style refusals', async () => {
    const { governance, approvals } = fixture();
    const rejected = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });
    await approvals.reject({ approvalId: rejected.approvalId, principal: checker });
    await expect(
      governance.executeChange({
        principal: checker,
        action: 'FEE_RULE_CREATE',
        approvalId: rejected.approvalId,
        payload: createPayload,
        write: jest.fn(),
      }),
    ).rejects.toMatchObject({ status: 409 });

    const t0 = new Date('2026-03-01T10:00:00.000Z');
    const expiring = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
      expiresInSeconds: 60,
      now: t0,
    });
    await approvals.approve({ approvalId: expiring.approvalId, principal: checker, now: t0 });
    await expect(
      governance.executeChange({
        principal: checker,
        action: 'FEE_RULE_CREATE',
        approvalId: expiring.approvalId,
        payload: createPayload,
        write: jest.fn(),
        now: new Date('2026-03-01T10:05:00.000Z'),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('audits GOVERNED_CHANGE_EXECUTION_FAILED and rethrows when the domain write fails after consumption', async () => {
    const { governance, approvals, auditService, approvalRepository } = fixture();
    const view = await governance.requestChange({
      principal: maker,
      action: 'FEE_RULE_CREATE',
      payload: createPayload,
      reason: createPayload.reason,
    });
    await approvals.approve({ approvalId: view.approvalId, principal: checker });

    await expect(
      governance.executeChange({
        principal: checker,
        action: 'FEE_RULE_CREATE',
        approvalId: view.approvalId,
        payload: createPayload,
        write: jest.fn().mockRejectedValue(new Error('duplicate rule identity')),
      }),
    ).rejects.toThrow(/duplicate rule identity/i);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'GOVERNED_CHANGE_EXECUTION_FAILED' }),
    );
    // The approval stays consumed — the failure is durable and the maker must re-request.
    const stored = [...approvalRepository.records.values()][0]!;
    expect(stored.status).toBe(PrivilegedActionApprovalStatus.CONSUMED);
  });

  it('maps consumption refusals to the established HTTP semantics', () => {
    expect(governedChangeConsumptionError('NOT_FOUND')).toMatchObject({ status: 404 });
    expect(governedChangeConsumptionError('FINGERPRINT_MISMATCH')).toMatchObject({ status: 403 });
    expect(governedChangeConsumptionError('APPROVAL_SCOPE_MISSING')).toMatchObject({ status: 403 });
    expect(governedChangeConsumptionError('CONSUMED')).toMatchObject({ status: 409 });
    expect(governedChangeConsumptionError('EXPIRED')).toMatchObject({ status: 409 });
    expect(governedChangeConsumptionError(undefined, 'REJECTED')).toMatchObject({ status: 409 });
  });
});
