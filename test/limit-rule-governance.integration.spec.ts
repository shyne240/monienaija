/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { governedAction } from '../src/authorization/governed-action.registry';
import { AuthorizationCatalogueRuntimeService } from '../src/authorization-catalogue/authorization-catalogue-runtime.service';
import { AuthorizationCatalogueSeedService } from '../src/authorization-catalogue/authorization-catalogue-seed.service';
import { AuthorizationRole } from '../src/authorization-catalogue/authorization-role.entity';
import { AuthorizationRoleFunction } from '../src/authorization-catalogue/authorization-role-function.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { LimitCatalogService } from '../src/limit-catalog/limit-catalog.service';
import { LimitCatalogController } from '../src/limit-catalog/limit-catalog.controller';
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
  let app: any;
  let approvals: PrivilegedActionApprovalService;
  let catalogueRuntime: AuthorizationCatalogueRuntimeService;
  let catalogueSeed: AuthorizationCatalogueSeedService;
  let catalog: LimitCatalogService;
  let limitController: LimitCatalogController;
  let limitGovernance: LimitRuleGovernanceService;

  const maker: AuthorizationPrincipal = {
    type: 'OPERATOR',
    principalId: 'limit-maker',
    sessionId: '11111111-1111-4111-8111-111111111111',
    roles: ['FINANCE_PREPARER'],
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
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    await app.init();
    approvals = moduleRef.get(PrivilegedActionApprovalService);
    catalog = moduleRef.get(LimitCatalogService);
    limitController = moduleRef.get(LimitCatalogController);
    limitGovernance = moduleRef.get(LimitRuleGovernanceService);
    catalogueRuntime = moduleRef.get(AuthorizationCatalogueRuntimeService);
    catalogueSeed = moduleRef.get(AuthorizationCatalogueSeedService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    else if (moduleRef) await moduleRef.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await catalogueSeed.seedIfEmpty();
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

  it('resolves checker permission from the seeded runtime catalogue, not from the test principal only', async () => {
    const effective = await catalogueRuntime.resolveForRoleKeys(['FINANCE_CONTROLLER']);
    expect(effective.recognizedRoleKeys).toContain('FINANCE_CONTROLLER');
    expect(effective.functionCodes).toContain('limit.modify');
    const role = await dataSource
      .getRepository(AuthorizationRole)
      .findOne({ where: { roleKey: 'FINANCE_CONTROLLER' } });
    expect(role).toBeTruthy();
    const grant = await dataSource.getRepository(AuthorizationRoleFunction).findOne({
      where: { roleId: role.id, functionCode: 'limit.modify', isActive: true },
    });
    expect(grant?.accessType).toBe('APPROVE');
    expect(
      (await catalogueRuntime.resolveForRoleKeys(['FINANCE_PREPARER'])).functionCodes,
    ).toContain('limit.modify');
  });

  it('self-approval is rejected and POST request does not create an active rule', async () => {
    const pending = await limitController.createRule(
      'GOV_PROFILE',
      { authorizationPrincipal: maker, headers: {} } as any,
      createDto() as any,
    );
    expect(await catalog.countRules()).toBe(0);
    const checkerInbox = await (approvals as any).listApprovals({
      principal: checker,
      status: 'REQUESTED',
      actionType: 'LIMIT_RULE_CREATE',
    });
    expect(checkerInbox.items.map((item: any) => item.id)).toContain(pending.approvalId);
    const makerInbox = await (approvals as any).listApprovals({
      principal: maker,
      status: 'REQUESTED',
      actionType: 'LIMIT_RULE_CREATE',
    });
    expect(makerInbox.items.map((item: any) => item.id)).not.toContain(pending.approvalId);
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
    const lowAssuranceChecker = {
      ...checker,
      principalId: 'low-assurance-checker',
      sessionId: '44444444-4444-4444-8444-444444444444',
      assuranceLevel: 'LOW',
    } as any;
    await expect(
      limitGovernance.executeCreate(
        lowAssuranceChecker,
        approvalId,
        'GOV_PROFILE',
        createDto() as any,
      ),
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
    const pending = await limitController.updateRule(
      rule.id,
      { authorizationPrincipal: maker, headers: {} } as any,
      updateDto,
    );
    await approvals.approve({
      approvalId: pending.approvalId,
      principal: checker,
      expectedVersion: 1,
    });
    await expect(
      limitController.executeUpdateRule(
        rule.id,
        pending.approvalId,
        { authorizationPrincipal: checker, headers: {} } as any,
        updateDto,
      ),
    ).rejects.toThrow(/version/i);
    const approval = await approvals.getApproval(pending.approvalId);
    expect(approval?.status).toBe('APPROVED');
    expect((await catalog.getRule(rule.id)).version).toBe(2);
  });

  it('approved update changes a rule only through the checker execution endpoint', async () => {
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
        createdBy: 'fixture',
      },
      'fixture',
    );
    const updateDto = { version: 1, priority: 5, reason: 'Approved priority update' } as any;
    const pending = await limitController.updateRule(
      rule.id,
      { authorizationPrincipal: maker, headers: {} } as any,
      updateDto,
    );
    expect((await catalog.getRule(rule.id)).priority).toBe(0);
    expect((await catalog.getRule(rule.id)).version).toBe(1);

    await approvals.approve({
      approvalId: pending.approvalId,
      principal: checker,
      expectedVersion: 1,
    });
    await limitController.executeUpdateRule(
      rule.id,
      pending.approvalId,
      { authorizationPrincipal: checker, headers: {} } as any,
      updateDto,
    );
    expect((await catalog.getRule(rule.id)).priority).toBe(5);
    expect((await catalog.getRule(rule.id)).version).toBe(2);
    expect((await approvals.getApproval(pending.approvalId))?.status).toBe('CONSUMED');
  });

  it('rolls back approval consumption if the approved rule write fails', async () => {
    const approvalId = await proposeAndApproveCreate();
    const write = jest
      .spyOn(catalog, 'createRuleInTransaction')
      .mockRejectedValueOnce(new Error('simulated rule write failure'));
    try {
      await expect(
        limitGovernance.executeCreate(checker, approvalId, 'GOV_PROFILE', createDto() as any),
      ).rejects.toThrow('simulated rule write failure');
    } finally {
      write.mockRestore();
    }
    expect(await catalog.countRules()).toBe(0);
    expect((await approvals.getApproval(approvalId))?.status).toBe('APPROVED');
    const created = await limitGovernance.executeCreate(
      checker,
      approvalId,
      'GOV_PROFILE',
      createDto() as any,
    );
    expect(created.limitProfileCode).toBe('GOV_PROFILE');
    expect((await approvals.getApproval(approvalId))?.status).toBe('CONSUMED');
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
