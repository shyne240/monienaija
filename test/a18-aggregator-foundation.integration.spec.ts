/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AggregatorService } from '../src/aggregator/aggregator.service';
import { AggregatorAgentRelationshipService } from '../src/aggregator/aggregator-agent-relationship.service';
import { AggregatorStatus, AggregatorAgentRelationshipStatus } from '../src/aggregator/aggregator.enums';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentStatus } from '../src/agent/agent.enums';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('A18 Aggregator Foundation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let aggregatorService: AggregatorService;
  let relationshipService: AggregatorAgentRelationshipService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let authService: AuthorizationService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a18agg');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    aggregatorService = moduleRef.get(AggregatorService);
    relationshipService = moduleRef.get(AggregatorAgentRelationshipService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    authService = moduleRef.get(AuthorizationService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try { if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined); } catch { void 0; }
      }
    }
  }, 60000);

  async function createActiveAgent(): Promise<{ agentId: string }> {
    const cls = await classService.create({
      reference: `cls-a18-${randomUUID().slice(0, 8)}`,
      code: `A18-${randomUUID().slice(0, 6)}`,
      name: 'A18 Class',
      isActive: true,
      applicableServices: [] as any,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A18 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a18-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a18',
    });
    await appService.submit(appEntity.id, 'applicant-a18');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    return { agentId: agent.id };
  }

  function uniqueRef(): string {
    return `agg-ref-${randomUUID().slice(0, 8)}`;
  }
  function uniqueCode(): string {
    return `AGG-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  // 1. Aggregator creation
  it('1. Aggregator creation', async () => {
    const agg = await aggregatorService.create({
      reference: uniqueRef(),
      code: uniqueCode(),
      corporateName: 'Acme Aggregator Ltd',
      displayName: 'Acme',
      contactEmail: 'contact@acme.test',
      actor: 'test-actor',
    });
    expect(agg.id).toBeDefined();
    expect(agg.reference).toBeDefined();
    expect(agg.corporateName).toBe('Acme Aggregator Ltd');
    expect(agg.status).toBe(AggregatorStatus.PENDING);
    const row: Array<any> = await dataSource.query(`SELECT * FROM aggregators WHERE id=$1`, [agg.id]);
    expect(row[0]!.corporate_name).toBe('Acme Aggregator Ltd');
  });

  // 2. unique Aggregator identity
  it('2. unique Aggregator identity', async () => {
    const ref = uniqueRef();
    const code = uniqueCode();
    await aggregatorService.create({ reference: ref, code, corporateName: 'Unique One', actor: 'test-actor' });
    await expect(
      aggregatorService.create({ reference: ref, code: uniqueCode(), corporateName: 'Duplicate Ref', actor: 'test-actor' }),
    ).rejects.toThrow(/already exists|duplicate/i);
    await expect(
      aggregatorService.create({ reference: uniqueRef(), code, corporateName: 'Duplicate Code', actor: 'test-actor' }),
    ).rejects.toThrow(/already exists|duplicate/i);
  });

  // 3. valid Aggregator status
  it('3. valid Aggregator status', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Status Valid', actor: 'test-actor' });
    expect(agg.status).toBe(AggregatorStatus.PENDING);
    const activated = await aggregatorService.activate(agg.id, 'test-actor');
    expect(activated.status).toBe(AggregatorStatus.ACTIVE);
  });

  // 4. invalid Aggregator status rejected
  it('4. invalid Aggregator status rejected', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Invalid Status', actor: 'test-actor' });
    // Try raw DB insert with invalid status should fail via check constraint
    await expect(
      dataSource.query(`INSERT INTO aggregators (id, reference, code, corporate_name, status, created_by, version) VALUES ($1,$2,$3,$4,'BOGUS','test',1)`, [
        randomUUID(),
        uniqueRef(),
        uniqueCode(),
        'Bogus',
      ]),
    ).rejects.toThrow(/check|chk_aggregators_status/i);
    // Try service transition with invalid target
    await expect(aggregatorService['transition'](agg.id, 'BOGUS' as any, 'test-actor', 'TEST')).rejects.toThrow(/Invalid status/i);
  });

  // 5. valid lifecycle transition(s)
  it('5. valid lifecycle transition(s)', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Lifecycle Valid', actor: 'test-actor' });
    let cur = await aggregatorService.activate(agg.id, 'test-actor');
    expect(cur.status).toBe(AggregatorStatus.ACTIVE);
    cur = await aggregatorService.suspend(cur.id, 'test-actor');
    expect(cur.status).toBe(AggregatorStatus.SUSPENDED);
    cur = await aggregatorService.reactivate(cur.id, 'test-actor');
    expect(cur.status).toBe(AggregatorStatus.ACTIVE);
    cur = await aggregatorService.terminate(cur.id, 'test-actor');
    expect(cur.status).toBe(AggregatorStatus.TERMINATED);
  });

  // 6. invalid lifecycle transition rejected
  it('6. invalid lifecycle transition rejected', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Lifecycle Invalid', actor: 'test-actor' });
    // PENDING -> SUSPENDED is not allowed
    await expect(aggregatorService.suspend(agg.id, 'test-actor')).rejects.toThrow(/not allowed/i);
    // Activate then terminate, then try to activate again
    const active = await aggregatorService.activate(agg.id, 'test-actor');
    const terminated = await aggregatorService.terminate(active.id, 'test-actor');
    await expect(aggregatorService.activate(terminated.id, 'test-actor')).rejects.toThrow(/not allowed|TERMINATED/i);
    await expect(aggregatorService.reactivate(terminated.id, 'test-actor')).rejects.toThrow(/not allowed/i);
  });

  // 7. Agent↔Aggregator relationship creation
  it('7. Agent↔Aggregator relationship creation', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Rel Create', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    const rel = await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    expect(rel.id).toBeDefined();
    expect(rel.aggregatorId).toBe(agg.id);
    expect(rel.agentId).toBe(agentId);
    expect(rel.status).toBe(AggregatorAgentRelationshipStatus.ACTIVE);
    const rows: Array<any> = await dataSource.query(`SELECT * FROM aggregator_agent_assignments WHERE id=$1`, [rel.id]);
    expect(rows[0]!.aggregator_id).toBe(agg.id);
  });

  // 8. duplicate relationship rejected
  it('8. duplicate relationship rejected', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Rel Dup', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    await expect(relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' })).rejects.toThrow(/already|duplicate/i);
  });

  // 9. relationship foreign-key integrity
  it('9. relationship foreign-key integrity', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Rel FK', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    const fakeAgg = randomUUID();
    const fakeAgent = randomUUID();
    await expect(relationshipService.assign({ aggregatorId: fakeAgg, agentId, actor: 'test-actor' })).rejects.toThrow(/not found/i);
    await expect(relationshipService.assign({ aggregatorId: agg.id, agentId: fakeAgent, actor: 'test-actor' })).rejects.toThrow(/not found/i);
    // Raw DB FK violation should also fail
    await expect(
      dataSource.query(`INSERT INTO aggregator_agent_assignments (id, aggregator_id, agent_id, status, assigned_at, assigned_by) VALUES ($1,$2,$3,'ACTIVE',NOW(),'test')`, [
        randomUUID(),
        fakeAgg,
        agentId,
      ]),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  // 10. relationship lifecycle if implemented
  it('10. relationship lifecycle if implemented', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Rel Lifecycle', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    const rel = await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    expect(rel.status).toBe(AggregatorAgentRelationshipStatus.ACTIVE);
    const suspended = await relationshipService.suspend({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    expect(suspended.status).toBe(AggregatorAgentRelationshipStatus.SUSPENDED);
    const reactivated = await relationshipService.reactivate({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    expect(reactivated.status).toBe(AggregatorAgentRelationshipStatus.ACTIVE);
    const terminated = await relationshipService.unassign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    expect(terminated.status).toBe(AggregatorAgentRelationshipStatus.TERMINATED);
    expect(terminated.unassignedAt).not.toBeNull();
  });

  // 11. inactive/terminated Aggregator cannot perform restricted operation
  it('11. inactive/terminated Aggregator cannot perform restricted operation', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Inactive Op', actor: 'test-actor' });
    // PENDING cannot assign
    const { agentId: agent1 } = await createActiveAgent();
    await expect(relationshipService.assign({ aggregatorId: agg.id, agentId: agent1, actor: 'test-actor' })).rejects.toThrow(/cannot be assigned/i);
    await aggregatorService.activate(agg.id, 'test-actor');
    await aggregatorService.suspend(agg.id, 'test-actor');
    const { agentId: agent2 } = await createActiveAgent();
    await expect(relationshipService.assign({ aggregatorId: agg.id, agentId: agent2, actor: 'test-actor' })).rejects.toThrow(/cannot be assigned/i);
    await aggregatorService.terminate(agg.id, 'test-actor');
    const { agentId: agent3 } = await createActiveAgent();
    await expect(relationshipService.assign({ aggregatorId: agg.id, agentId: agent3, actor: 'test-actor' })).rejects.toThrow(/cannot be assigned/i);
    // Also direct canOperate check
    await expect(aggregatorService.assertCanOperate(agg.id)).rejects.toThrow(/TERMINATED/i);
  });

  // 12. Agent remains an independent first-class entity
  it('12. Agent remains an independent first-class entity', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Agent Independent', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    const rel = await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    // Agent still exists independently
    const agentRows: Array<any> = await dataSource.query(`SELECT id, status FROM agents WHERE id=$1`, [agentId]);
    expect(agentRows[0]!.id).toBe(agentId);
    // Unassign does NOT terminate agent
    await relationshipService.unassign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    const afterRows: Array<any> = await dataSource.query(`SELECT id, status FROM agents WHERE id=$1`, [agentId]);
    expect(afterRows[0]!.id).toBe(agentId);
    expect(afterRows[0]!.status).toBe(AgentStatus.ACTIVE);
    // Relationship terminated but agent still ACTIVE
    const relAfter: Array<any> = await dataSource.query(`SELECT status FROM aggregator_agent_assignments WHERE id=$1`, [rel.id]);
    expect(relAfter[0]!.status).toBe(AggregatorAgentRelationshipStatus.TERMINATED);
  });

  // 13. Aggregator is not represented as an Agent
  it('13. Aggregator is not represented as an Agent', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Not Agent', actor: 'test-actor' });
    const agentRows: Array<any> = await dataSource.query(`SELECT id FROM agents WHERE id=$1`, [agg.id]);
    expect(agentRows.length).toBe(0);
    const aggRows: Array<any> = await dataSource.query(`SELECT id FROM aggregators WHERE id=$1`, [agg.id]);
    expect(aggRows.length).toBe(1);
  });

  // 14. Aggregator does not accidentally receive Customer SELF authorization
  it('14. Aggregator does not accidentally receive Customer SELF authorization', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Auth Check', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const aggregatorPrincipal: any = {
      type: 'AGGREGATOR',
      principalId: agg.id,
      aggregatorId: agg.id,
      roles: [],
      scopes: [],
      customerAccess: 'NONE',
      aggregatorAccess: 'SELF',
    };
    // Try to authorize as CUSTOMER SELF on a customer resource — should be denied
    const decision = await authService.authorize(aggregatorPrincipal, {
      resourceType: 'customer',
      action: 'customer:read',
      allowedPrincipalTypes: ['CUSTOMER'],
      customerAccess: 'SELF',
    } as any, { type: 'customer', id: randomUUID(), customerId: randomUUID() });
    expect(decision.allowed).toBe(false);
    // Aggregator trying to access Agent SELF should also be denied
    const decision2 = await authService.authorize(aggregatorPrincipal, {
      resourceType: 'agent',
      action: 'agent:read',
      allowedPrincipalTypes: ['AGENT'],
      customerAccess: 'NONE',
      agentAccess: 'SELF',
    } as any, { type: 'agent', id: randomUUID(), agentId: randomUUID() });
    expect(decision2.allowed).toBe(false);
    // Valid aggregator self access should be allowed when policy allows AGGREGATOR
    const decision3 = await authService.authorize(aggregatorPrincipal, {
      resourceType: 'aggregator',
      action: 'aggregator:read',
      allowedPrincipalTypes: ['AGGREGATOR'],
      customerAccess: 'NONE',
      aggregatorAccess: 'SELF',
    } as any, { type: 'aggregator', id: agg.id, aggregatorId: agg.id });
    expect(decision3.allowed).toBe(true);
  });

  // 15. no unintended Agent wallet creation
  it('15. no unintended Agent wallet creation', async () => {
    const walletsBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'No Wallet', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const walletsAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    expect(Number(walletsAfter[0]!.count)).toBe(Number(walletsBefore[0]!.count));
    const { agentId } = await createActiveAgent();
    const walletsAfterAgent: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    expect(Number(walletsAfterAgent[0]!.count)).toBe(Number(walletsAfter[0]!.count));
    await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    const walletsAfterAssign: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    expect(Number(walletsAfterAssign[0]!.count)).toBe(Number(walletsAfter[0]!.count));
    // Ensure no wallet for aggregator id
    const aggWallet: Array<any> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1`, [agg.id]);
    expect(aggWallet.length).toBe(0);
  });

  // 16. no unintended Customer wallet creation
  it('16. no unintended Customer wallet creation', async () => {
    const before: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts WHERE customer_id::text IN (SELECT id::text FROM customers)`);
    await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'No Cust Wallet', actor: 'test-actor' });
    const after: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts WHERE customer_id::text IN (SELECT id::text FROM customers)`);
    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
  });

  // 17. no unintended ledger/journal creation
  it('17. no unintended ledger/journal creation', async () => {
    const beforeJ: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const beforeL: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_accounts WHERE code LIKE 'AGGREGATOR%'`);
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'No Ledger', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    const afterJ: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const afterL: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_accounts WHERE code LIKE 'AGGREGATOR%'`);
    expect(Number(afterJ[0]!.count)).toBe(Number(beforeJ[0]!.count));
    expect(Number(afterL[0]!.count)).toBe(Number(beforeL[0]!.count));
    expect(Number(afterL[0]!.count)).toBe(0);
  });

  // 18. audit records contain no secrets
  it('18. audit records contain no secrets', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Audit Record', actor: 'test-actor' });
    const audits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_id=$1 AND entity_type='AGGREGATOR'`, [agg.id]);
    expect(audits.length).toBeGreaterThan(0);
    const serial = JSON.stringify(audits).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('secret');
    expect(serial).not.toContain('token');
    const { agentId } = await createActiveAgent();
    await aggregatorService.activate(agg.id, 'test-actor');
    await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    const relAudits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='AGGREGATOR_AGENT_ASSIGNMENT' ORDER BY created_at DESC LIMIT 1`);
    const relSerial = JSON.stringify(relAudits).toLowerCase();
    expect(relSerial).not.toContain('password');
    expect(relSerial).not.toContain('pin');
  });

  // 19. transaction atomicity
  it('19. transaction atomicity', async () => {
    const ref = uniqueRef();
    const code = uniqueCode();
    await aggregatorService.create({ reference: ref, code, corporateName: 'Atomic One', actor: 'test-actor' });
    const countBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM aggregators WHERE reference=$1`, [ref]);
    expect(Number(countBefore[0]!.count)).toBe(1);
    // Duplicate should not create partial second row and should not delete first
    await expect(aggregatorService.create({ reference: ref, code: uniqueCode(), corporateName: 'Atomic Dup', actor: 'test-actor' })).rejects.toThrow(/already exists/i);
    const countAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM aggregators WHERE reference=$1`, [ref]);
    expect(Number(countAfter[0]!.count)).toBe(1);
    // Relationship atomicity: duplicate assign should not create second row
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Atomic Rel', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    await relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' });
    const relBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM aggregator_agent_assignments WHERE aggregator_id=$1 AND agent_id=$2`, [agg.id, agentId]);
    expect(Number(relBefore[0]!.count)).toBe(1);
    await expect(relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' })).rejects.toThrow(/already/i);
    const relAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM aggregator_agent_assignments WHERE aggregator_id=$1 AND agent_id=$2`, [agg.id, agentId]);
    expect(Number(relAfter[0]!.count)).toBe(1);
  });

  // 20. concurrent duplicate relationship protection
  it('20. concurrent duplicate relationship protection', async () => {
    const agg = await aggregatorService.create({ reference: uniqueRef(), code: uniqueCode(), corporateName: 'Concurrent Dup', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    const { agentId } = await createActiveAgent();
    const results = await Promise.allSettled([
      relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' }),
      relationshipService.assign({ aggregatorId: agg.id, agentId, actor: 'test-actor' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM aggregator_agent_assignments WHERE aggregator_id=$1 AND agent_id=$2 AND status='ACTIVE'`, [agg.id, agentId]);
    expect(Number(rows[0]!.count)).toBe(1);
  });

  // 21. migration chain
  it('21. migration chain', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBe(61);
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600060');
    expect(latest[0]!.name).toBe('CreateAggregators1785753600060');
    const aggCheck: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='aggregators'::regclass AND conname='chk_aggregators_status'`);
    expect(aggCheck.length).toBe(1);
    const relCheck: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='aggregator_agent_assignments'::regclass AND conname='chk_aggregator_agent_status'`);
    expect(relCheck.length).toBe(1);
  });

  // 22. production readiness
  it('22. production readiness', async () => {
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600060');
    expect(latest[0]!.name).toBe('CreateAggregators1785753600060');
  });
});
