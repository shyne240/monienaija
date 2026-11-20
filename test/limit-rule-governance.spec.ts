/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { LimitRuleGovernanceService } from '../src/limit-catalog/limit-rule-governance.service';
import { governedChangeFingerprint } from '../src/authorization/governed-action.registry';

const definition = {
  action: 'LIMIT_RULE_CREATE',
  resourceType: 'AGENT_FUNDING_REQUEST',
  initiatingFunctionCodes: ['limit_rule.manage'],
  approvingFunctionCodes: ['limit_rule.manage'],
  initiatingRoles: ['AGENT_NETWORK_MANAGER'],
  approvingRoles: ['FINANCE_CONTROLLER'],
  minimumApprovals: 1,
  selfApprovalProhibited: true,
  mfaRequired: true,
  minimumAssurance: 'MFA',
  approvalScope: 'limit_rule.manage',
};
const principal = {
  type: 'OPERATOR',
  principalId: 'controller-1',
  roles: ['FINANCE_CONTROLLER'],
  scopes: ['privileged:approve', 'limit_rule.manage'],
  assuranceLevel: 'MFA',
} as any;
const createDto = (overrides: Record<string, unknown> = {}) =>
  ({
    product: 'WALLET_TRANSFER',
    direction: 'OUTGOING',
    channel: null,
    currency: 'NGN',
    dimension: 'DAILY_AMOUNT',
    limitValueMinor: '5000000',
    limitValueCount: null,
    effectiveFrom: '2030-01-01T00:00:00.000Z',
    effectiveTo: null,
    isActive: true,
    priority: 0,
    reason: 'Approved test policy',
    ...overrides,
  }) as any;

function harness() {
  const approval: any = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actionType: 'LIMIT_RULE_CREATE',
    resourceType: 'AGENT_FUNDING_REQUEST',
    resourceId: null,
    status: 'APPROVED',
  };
  const approvalApi = {
    getApproval: jest.fn().mockResolvedValue(approval),
    consumeInTransaction: jest.fn().mockResolvedValue({ approved: true }),
  };
  const manager = {};
  const dataSource = {
    transaction: jest.fn((callback: (m: object) => unknown) => callback(manager)),
  };
  const governance = { requestChange: jest.fn().mockResolvedValue({ approvalId: approval.id }) };
  const catalog = {
    createRuleInTransaction: jest.fn().mockResolvedValue({ id: 'new-rule' }),
    updateRuleInTransaction: jest.fn().mockResolvedValue({ id: 'updated-rule' }),
  };
  const service = new LimitRuleGovernanceService(
    dataSource as never,
    governance as never,
    approvalApi as never,
    catalog as never,
  );
  jest.spyOn(service as any, 'definition').mockReturnValue(definition);
  return { service, approval, approvalApi, dataSource, governance, catalog, manager };
}

describe('limit-rule maker/checker adapter', () => {
  it('records a maker proposal only; it does not write a live rule', async () => {
    const h = harness();
    const receipt = await h.service.requestCreate(principal, 'PROFILE_A', createDto());
    expect(receipt.approvalId).toBe(h.approval.id);
    expect(h.governance.requestChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LIMIT_RULE_CREATE', reason: 'Approved test policy' }),
    );
    expect(h.catalog.createRuleInTransaction).not.toHaveBeenCalled();
    expect(h.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('consumes and applies the approved rule under the same transaction manager', async () => {
    const h = harness();
    await h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto());
    expect(h.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(h.approvalApi.consumeInTransaction).toHaveBeenCalledWith(
      h.manager,
      expect.objectContaining({
        actionType: 'LIMIT_RULE_CREATE',
        resource: { type: 'AGENT_FUNDING_REQUEST' },
      }),
    );
    expect(h.catalog.createRuleInTransaction).toHaveBeenCalledWith(
      h.manager,
      expect.objectContaining({
        limitProfileCode: 'PROFILE_A',
        effectiveFrom: createDto().effectiveFrom,
      }),
      principal.principalId,
    );
  });

  it('rejects altered payload fingerprints before any mutation', async () => {
    const h = harness();
    h.approvalApi.consumeInTransaction.mockResolvedValue({
      approved: false,
      reason: 'FINGERPRINT_MISMATCH',
    });
    await expect(
      h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto({ priority: 10 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.catalog.createRuleInTransaction).not.toHaveBeenCalled();
  });

  it('rejects unauthorized execution and leaves the active rule unchanged', async () => {
    const h = harness();
    h.approvalApi.consumeInTransaction.mockResolvedValue({
      approved: false,
      reason: 'ROLE_MISSING',
    });
    await expect(
      h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.catalog.createRuleInTransaction).not.toHaveBeenCalled();
  });

  it('does not execute a still-pending proposal (including a maker attempting self-approval)', async () => {
    const h = harness();
    h.approval.status = 'REQUESTED';
    h.approvalApi.consumeInTransaction.mockResolvedValue({ approved: false, reason: 'REQUESTED' });
    await expect(
      h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.catalog.createRuleInTransaction).not.toHaveBeenCalled();
  });

  it('rejects replay after the approval has already been consumed', async () => {
    const h = harness();
    h.approvalApi.consumeInTransaction
      .mockResolvedValueOnce({ approved: true })
      .mockResolvedValueOnce({ approved: false, reason: 'CONSUMED' });
    await h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto());
    await expect(
      h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.catalog.createRuleInTransaction).toHaveBeenCalledTimes(1);
  });

  it('allows only one concurrent consumer to apply a rule mutation', async () => {
    const h = harness();
    let consumed = false;
    let lock = Promise.resolve();
    h.approvalApi.consumeInTransaction.mockImplementation(async () => {
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (consumed) return { approved: false, reason: 'CONSUMED' };
        consumed = true;
        return { approved: true };
      } finally {
        release();
      }
    });
    const results = await Promise.allSettled([
      h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto()),
      h.service.executeCreate(principal, h.approval.id, 'PROFILE_A', createDto()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.catalog.createRuleInTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses the version in the approved update payload and preserves stale-version rejection', async () => {
    const h = harness();
    h.approval.actionType = 'LIMIT_RULE_UPDATE';
    h.approval.resourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    h.catalog.updateRuleInTransaction.mockRejectedValue(
      new ConflictException('Version conflict — stale version'),
    );
    const dto = { version: 4, priority: 2, reason: 'Correct rule priority' } as any;
    await expect(
      h.service.executeUpdate(principal, h.approval.id, h.approval.resourceId, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.catalog.updateRuleInTransaction).toHaveBeenCalledWith(
      h.manager,
      h.approval.resourceId,
      expect.objectContaining({ version: 4, priority: 2 }),
      principal.principalId,
    );
  });

  it('binds payload fingerprint to the governed action and resource identifier', async () => {
    const h = harness();
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    h.approval.actionType = 'LIMIT_RULE_UPDATE';
    h.approval.resourceId = id;
    const dto = { version: 1, priority: 3, reason: 'Change priority' } as any;
    await h.service.executeUpdate(principal, h.approval.id, id, dto);
    const command = h.approvalApi.consumeInTransaction.mock.calls[0]![1];
    expect(command.actionFingerprint).toBe(
      governedChangeFingerprint('LIMIT_RULE_UPDATE', 'AGENT_FUNDING_REQUEST', id, {
        version: 1,
        priority: 3,
        reason: 'Change priority',
      }),
    );
  });
});
