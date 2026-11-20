/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
// @ts-nocheck
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { governedAction } from '../src/authorization/governed-action.registry';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { LimitCatalogService } from '../src/limit-catalog/limit-catalog.service';
import { LimitRuleGovernanceService } from '../src/limit-catalog/limit-rule-governance.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const registered = Boolean(
  governedAction('LIMIT_RULE_CREATE') && governedAction('LIMIT_RULE_UPDATE'),
);
const describeWhenReady = registered ? describe : describe.skip;

describeWhenReady('Limit-rule maker/checker governance (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let moduleRef: any;
  let approvals: PrivilegedActionApprovalService;
  let catalog: LimitCatalogService;
  let limitGovernance: LimitRuleGovernanceService;

  const maker: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: 'limit-maker',
    sessionId: '11111111-1111-4111-8111-111111111111',
    roles: ['AGENT_NETWORK_MANAGER'],
    scopes: ['limit.modify', 'limit_rule.manage'],
    assuranceLevel: 'MFA',
    customerAccess: 'NONE',
  } as any;
  const checker: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: 'limit-checker',
    sessionId: '22222222-2222-4222-8222-222222222222',
    roles: ['FINANCE_CONTROLLER'],
    scopes: ['limit.modify', 'limit_rule.manage'],
    assuranceLevel: 'MFA',
    customerAccess: 'NONE',
  } as any;
  const stranger: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: 'unentitled-operator',
    sessionId: '33333333-3333-4333-8333-333333333333',
    roles: ['CUSTOMER_SERVICE'],
    scopes: ['limit.view'],
    assuranceLevel: 'MFA',
    customerAccess: 'NONE',
  } as any;

  const createDto = (overrides: Record<string, unknown> = {}) => ({
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
    reason: 'Governed limit policy test',
    ...overrides,
  });

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('limit-rule-governance');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(AuthorizationService)
      .useValue({ authorize: async () => ({ allowed: true }), hasFunctions: async () => true })
      .compile();
    approvals = moduleRef.get(PrivilegedActionApprovalService);
    catalog = moduleRef.get(LimitCatalogService);
    limitGovernance = moduleRef.get(LimitRuleGovernanceService);
  }, 180000);

  afterAll(async () => {
    if (moduleRef) await moduleRef.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await catalog.createProfile(
      { code: 'GOV_PROFILE', name: 'Governed Test Profile', kind: 'CUSTOMER', createdBy: 'test' },
      'test',
    );
  });

  async function proposeAndApproveCreate(dto = createDto()) {
    const pending = await limitGovernance.requestCreate(maker, 'GOV_PROFILE', dto as any);
    expect(pending.status).toBe('REQUESTED');
    const decision = await approvals.approve({
      approvalId: pending.approvalId,
      principal: checker,
      expectedVersion: 1,
    });
    expect(decision.approved).toBe(true);
    return pending.approvalId;
  }

  it('self-approval is rejected and POST request does not create an active rule', async () => {
    const pending = await limitGovernance.requestCreate(maker, 'GOV_PROFILE', createDto() as any);
    expect(await catalog.countRules()).toBe(0);
    const selfDecision = await approvals.approve({
      approvalId: pending.approvalId,
      principal: maker,
      expectedVersion: 1,
    });
    expect(selfDecision).toMatchObject({ approved: false, reason: 'SELF_APPROVAL_FORBIDDEN' });
    expect(await catalog.countRules()).toBe(0);
  });

  it('rejects altered payloads, unauthorized execution, and replay without a second mutation', async () => {
    const approvalId = await proposeAndApproveCreate();
    await expect(
      limitGovernance.executeCreate(
        checker,
        approvalId,
        'GOV_PROFILE',
        createDto({ priority: 9 }) as any,
      ),
    ).rejects.toThrow();
    expect(await catalog.countRules()).toBe(0);
    await expect(
      limitGovernance.executeCreate(stranger, approvalId, 'GOV_PROFILE', createDto() as any),
    ).rejects.toThrow();
    expect(await catalog.countRules()).toBe(0);
    const applied = await limitGovernance.executeCreate(
      checker,
      approvalId,
      'GOV_PROFILE',
      createDto() as any,
    );
    expect(applied.limitProfileCode).toBe('GOV_PROFILE');
    await expect(
      limitGovernance.executeCreate(checker, approvalId, 'GOV_PROFILE', createDto() as any),
    ).rejects.toThrow();
    expect(await catalog.countRules()).toBe(1);
  });

  it('stale update version rolls back approval consumption with the rule write', async () => {
    const rule = await catalog.createRule(
      {
        limitProfileCode: 'GOV_PROFILE',
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
        createdBy: 'test',
      },
      'test',
    );
    await catalog.updateRule(
      rule.id,
      { version: 1, priority: 1, updatedBy: 'race-writer' },
      'race-writer',
    );
    const updateDto = { version: 1, priority: 3, reason: 'Change effective rule priority' } as any;
    const pending = await limitGovernance.requestUpdate(maker, rule.id, updateDto);
    await approvals.approve({
      approvalId: pending.approvalId,
      principal: checker,
      expectedVersion: 1,
    });
    await expect(
      limitGovernance.executeUpdate(checker, pending.approvalId, rule.id, updateDto),
    ).rejects.toThrow(/version/i);
    const approval = await approvals.getApproval(pending.approvalId);
    expect(approval?.status).toBe('APPROVED');
    expect((await catalog.getRule(rule.id)).version).toBe(2);
  });

  it('concurrent executions consume one approval and apply exactly one limit rule', async () => {
    const approvalId = await proposeAndApproveCreate();
    const results = await Promise.allSettled([
      limitGovernance.executeCreate(checker, approvalId, 'GOV_PROFILE', createDto() as any),
      limitGovernance.executeCreate(checker, approvalId, 'GOV_PROFILE', createDto() as any),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await catalog.countRules()).toBe(1);
    expect((await approvals.getApproval(approvalId))?.status).toBe('CONSUMED');
  });
});
