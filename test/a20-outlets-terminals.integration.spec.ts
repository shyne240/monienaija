/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { OutletService } from '../src/outlet/outlet.service';
import { TerminalService } from '../src/outlet/terminal.service';
import { OutletStatus, TerminalStatus } from '../src/outlet/outlet.enums';
import { AggregatorService } from '../src/aggregator/aggregator.service';
import { AggregatorAgentRelationshipService } from '../src/aggregator/aggregator-agent-relationship.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentStatus } from '../src/agent/agent.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('A20 Outlets & Terminals Foundation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let outletService: OutletService;
  let terminalService: TerminalService;
  let aggregatorService: AggregatorService;
  let relationshipService: AggregatorAgentRelationshipService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;

  const privilegedPrincipal: any = {
    type: 'PRIVILEGED',
    principalId: 'test-actor',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const aggregatorPrincipal = (aggregatorId: string): any => ({
    type: 'AGGREGATOR',
    principalId: aggregatorId,
    aggregatorId,
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'SELF',
  });
  const agentPrincipal = (agentId: string): any => ({
    type: 'AGENT',
    principalId: agentId,
    agentId,
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'SELF',
  });
  const customerPrincipal: any = {
    type: 'CUSTOMER',
    principalId: randomUUID(),
    customerId: randomUUID(),
    roles: [],
    scopes: [],
    customerAccess: 'SELF',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a20outlet');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    outletService = moduleRef.get(OutletService);
    terminalService = moduleRef.get(TerminalService);
    aggregatorService = moduleRef.get(AggregatorService);
    relationshipService = moduleRef.get(AggregatorAgentRelationshipService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
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
      reference: `cls-a20-${randomUUID().slice(0, 8)}`,
      code: `A20-${randomUUID().slice(0, 6)}`,
      name: 'A20 Class',
      isActive: true,
      applicableServices: [] as any,
      applicableLimits: {} as any,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A20 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a20-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a20',
    });
    await appService.submit(appEntity.id, 'applicant-a20');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    return { agentId: agent.id };
  }

  function uniqueRef(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  }
  function uniqueCode(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  async function createActiveAggregator(): Promise<string> {
    const agg = await aggregatorService.create({ reference: uniqueRef('agg-ref'), code: uniqueCode('AGG'), corporateName: 'Agg A20', actor: 'test-actor' });
    await aggregatorService.activate(agg.id, 'test-actor');
    return agg.id;
  }

  // 1. Outlet creation
  it('1. Outlet creation', async () => {
    const { agentId } = await createActiveAgent();
    const ref = uniqueRef('outlet-ref');
    const outlet = await outletService.create({
      agentId,
      reference: ref,
      code: uniqueCode('OUT'),
      name: 'Main Outlet Lagos',
      displayName: 'Lagos Main',
      addressLine: '12 Marina Street',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
      actor: 'test-actor',
      principal: privilegedPrincipal,
    });
    expect(outlet.id).toBeDefined();
    expect(outlet.agentId).toBe(agentId);
    expect(outlet.reference).toBe(ref);
    expect(outlet.status).toBe(OutletStatus.ACTIVE);
    const rows: Array<any> = await dataSource.query(`SELECT * FROM agent_outlets WHERE id=$1`, [outlet.id]);
    expect(rows[0]!.name).toBe('Main Outlet Lagos');
    expect(rows[0]!.city).toBe('Lagos');
  });

  // 2. Outlet uniqueness
  it('2. Outlet uniqueness', async () => {
    const { agentId } = await createActiveAgent();
    const ref = uniqueRef('outlet-uniq');
    const code = uniqueCode('OUT');
    await outletService.create({ agentId, reference: ref, code, name: 'Unique One', actor: 'test-actor', principal: privilegedPrincipal });
    await expect(
      outletService.create({ agentId, reference: ref, code: uniqueCode('OUT2'), name: 'Dup Ref', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/already exists|duplicate/i);
    await expect(
      outletService.create({ agentId, reference: uniqueRef('outlet-uniq2'), code, name: 'Dup Code', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/already exists|duplicate/i);
  });

  // 3. Terminal creation
  it('3. Terminal creation', async () => {
    const { agentId } = await createActiveAgent();
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-t'), name: 'Outlet T', actor: 'test-actor', principal: privilegedPrincipal });
    const termRef = uniqueRef('term-ref');
    const terminal = await terminalService.create({
      agentId,
      outletId: outlet.id,
      reference: termRef,
      code: uniqueCode('TERM'),
      label: 'POS-1',
      serialNumber: 'SN12345',
      actor: 'test-actor',
      principal: privilegedPrincipal,
    });
    expect(terminal.id).toBeDefined();
    expect(terminal.agentId).toBe(agentId);
    expect(terminal.outletId).toBe(outlet.id);
    expect(terminal.status).toBe(TerminalStatus.ACTIVE);
    const rows: Array<any> = await dataSource.query(`SELECT * FROM agent_terminals WHERE id=$1`, [terminal.id]);
    expect(rows[0]!.reference).toBe(termRef);
    expect(rows[0]!.label).toBe('POS-1');
  });

  // 4. Terminal uniqueness
  it('4. Terminal uniqueness', async () => {
    const { agentId } = await createActiveAgent();
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-tu'), name: 'Outlet TU', actor: 'test-actor', principal: privilegedPrincipal });
    const ref = uniqueRef('term-uniq');
    const code = uniqueCode('TERM');
    await terminalService.create({ agentId, outletId: outlet.id, reference: ref, code, actor: 'test-actor', principal: privilegedPrincipal });
    await expect(
      terminalService.create({ agentId, outletId: outlet.id, reference: ref, code: uniqueCode('TERM2'), actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/already exists|duplicate/i);
    await expect(
      terminalService.create({ agentId, outletId: outlet.id, reference: uniqueRef('term-uniq2'), code, actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/already exists|duplicate/i);
  });

  // 5. Correct Agent ownership
  it('5. Correct Agent ownership', async () => {
    const { agentId: agent1 } = await createActiveAgent();
    const { agentId: agent2 } = await createActiveAgent();
    const outlet1 = await outletService.create({ agentId: agent1, reference: uniqueRef('outlet-own'), name: 'Own Outlet', actor: 'test-actor', principal: privilegedPrincipal });
    expect(outlet1.agentId).toBe(agent1);
    // Try to create terminal for agent2 using outlet1 (mismatch) -> should fail
    await expect(
      terminalService.create({ agentId: agent2, outletId: outlet1.id, reference: uniqueRef('term-own'), actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/does not belong|mismatch/i);
    // Correct ownership succeeds
    const outlet2 = await outletService.create({ agentId: agent2, reference: uniqueRef('outlet-own2'), name: 'Own2', actor: 'test-actor', principal: privilegedPrincipal });
    const term = await terminalService.create({ agentId: agent2, outletId: outlet2.id, reference: uniqueRef('term-own-ok'), actor: 'test-actor', principal: privilegedPrincipal });
    expect(term.agentId).toBe(agent2);
    expect(term.outletId).toBe(outlet2.id);
  });

  // 6. Correct Outlet association
  it('6. Correct Outlet association', async () => {
    const { agentId } = await createActiveAgent();
    const outletA = await outletService.create({ agentId, reference: uniqueRef('outlet-a'), name: 'Outlet A', actor: 'test-actor', principal: privilegedPrincipal });
    const outletB = await outletService.create({ agentId, reference: uniqueRef('outlet-b'), name: 'Outlet B', actor: 'test-actor', principal: privilegedPrincipal });
    const termA = await terminalService.create({ agentId, outletId: outletA.id, reference: uniqueRef('term-a'), actor: 'test-actor', principal: privilegedPrincipal });
    const termB = await terminalService.create({ agentId, outletId: outletB.id, reference: uniqueRef('term-b'), actor: 'test-actor', principal: privilegedPrincipal });
    const listA = await terminalService.listByOutlet(outletA.id);
    expect(listA.map((t) => t.id)).toContain(termA.id);
    expect(listA.map((t) => t.id)).not.toContain(termB.id);
    const listAgent = await terminalService.listByAgent(agentId);
    expect(listAgent.length).toBe(2);
    const outlets = await outletService.listByAgent(agentId);
    expect(outlets.length).toBe(2);
  });

  // 7. Invalid Agent lifecycle rejection
  it('7. Invalid Agent lifecycle rejection', async () => {
    const { agentId } = await createActiveAgent();
    // Suspend agent
    await dataSource.query(`UPDATE agents SET status='SUSPENDED' WHERE id=$1`, [agentId]);
    await expect(
      outletService.create({ agentId, reference: uniqueRef('outlet-sus'), name: 'Should Fail Suspended', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/SUSPENDED|not.*active|cannot create/i);
    await dataSource.query(`UPDATE agents SET status='TERMINATED' WHERE id=$1`, [agentId]);
    await expect(
      outletService.create({ agentId, reference: uniqueRef('outlet-term'), name: 'Should Fail Terminated', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/TERMINATED|not.*active/i);
    // Restore to ACTIVE for terminal test of suspended agent cannot create terminal
    await dataSource.query(`UPDATE agents SET status='ACTIVE' WHERE id=$1`, [agentId]);
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-ok'), name: 'OK', actor: 'test-actor', principal: privilegedPrincipal });
    await dataSource.query(`UPDATE agents SET status='SUSPENDED' WHERE id=$1`, [agentId]);
    await expect(
      terminalService.create({ agentId, outletId: outlet.id, reference: uniqueRef('term-sus'), actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/SUSPENDED|not.*active/i);
    await dataSource.query(`UPDATE agents SET status='ACTIVE' WHERE id=$1`, [agentId]);
    // Also test that reactivation of outlet fails when agent suspended
    const outlet2 = await outletService.create({ agentId, reference: uniqueRef('outlet-react'), name: 'React', actor: 'test-actor', principal: privilegedPrincipal });
    await outletService.suspend(outlet2.id, 'test-actor');
    await dataSource.query(`UPDATE agents SET status='SUSPENDED' WHERE id=$1`, [agentId]);
    await expect(outletService.reactivate(outlet2.id, 'test-actor')).rejects.toThrow(/SUSPENDED|not.*active/i);
    await dataSource.query(`UPDATE agents SET status='ACTIVE' WHERE id=$1`, [agentId]);
    await outletService.reactivate(outlet2.id, 'test-actor');
    expect((await outletService.getById(outlet2.id)).status).toBe(OutletStatus.ACTIVE);
  });

  // 8. Invalid Outlet/Terminal lifecycle transition rejection
  it('8. Invalid Outlet/Terminal lifecycle transition rejection', async () => {
    const { agentId } = await createActiveAgent();
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-life'), name: 'Life', actor: 'test-actor', principal: privilegedPrincipal });
    expect(outlet.status).toBe(OutletStatus.ACTIVE);
    // Valid: ACTIVE -> SUSPENDED
    const suspended = await outletService.suspend(outlet.id, 'test-actor');
    expect(suspended.status).toBe(OutletStatus.SUSPENDED);
    // Valid: SUSPENDED -> ACTIVE
    const reactivated = await outletService.reactivate(outlet.id, 'test-actor');
    expect(reactivated.status).toBe(OutletStatus.ACTIVE);
    // Valid: ACTIVE -> TERMINATED
    const terminated = await outletService.terminate(outlet.id, 'test-actor');
    expect(terminated.status).toBe(OutletStatus.TERMINATED);
    // Invalid: TERMINATED -> ACTIVE
    await expect(outletService.reactivate(outlet.id, 'test-actor')).rejects.toThrow(/not allowed|TERMINATED/i);
    await expect(outletService.suspend(outlet.id, 'test-actor')).rejects.toThrow(/not allowed/i);
    // Terminal lifecycle similarly
    const outlet2 = await outletService.create({ agentId, reference: uniqueRef('outlet-life2'), name: 'Life2', actor: 'test-actor', principal: privilegedPrincipal });
    const terminal = await terminalService.create({ agentId, outletId: outlet2.id, reference: uniqueRef('term-life'), actor: 'test-actor', principal: privilegedPrincipal });
    await terminalService.suspend(terminal.id, 'test-actor');
    expect((await terminalService.getById(terminal.id)).status).toBe(TerminalStatus.SUSPENDED);
    await terminalService.reactivate(terminal.id, 'test-actor');
    expect((await terminalService.getById(terminal.id)).status).toBe(TerminalStatus.ACTIVE);
    await terminalService.terminate(terminal.id, 'test-actor');
    expect((await terminalService.getById(terminal.id)).status).toBe(TerminalStatus.TERMINATED);
    await expect(terminalService.reactivate(terminal.id, 'test-actor')).rejects.toThrow(/not allowed|TERMINATED/i);
    // Invalid direct ACTIVE -> ACTIVE? Trying to suspend already suspended? Do double suspend
    const outlet3 = await outletService.create({ agentId, reference: uniqueRef('outlet-life3'), name: 'Life3', actor: 'test-actor', principal: privilegedPrincipal });
    await outletService.suspend(outlet3.id, 'test-actor');
    await expect(outletService.suspend(outlet3.id, 'test-actor')).rejects.toThrow(/not allowed/i);
  });

  // 9. Duplicate concurrent creation/assignment protection
  it('9. Duplicate concurrent creation/assignment protection', async () => {
    const { agentId } = await createActiveAgent();
    const ref = uniqueRef('outlet-concur');
    const results = await Promise.allSettled([
      outletService.create({ agentId, reference: ref, name: 'Concur1', actor: 'test-actor', principal: privilegedPrincipal }),
      outletService.create({ agentId, reference: ref, name: 'Concur2', actor: 'test-actor', principal: privilegedPrincipal }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM agent_outlets WHERE reference=$1 AND deleted_at IS NULL`, [ref]);
    expect(Number(rows[0]!.count)).toBe(1);

    // Terminal concurrent same reference
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-concur-t'), name: 'Concur T Outlet', actor: 'test-actor', principal: privilegedPrincipal });
    const termRef = uniqueRef('term-concur');
    const termResults = await Promise.allSettled([
      terminalService.create({ agentId, outletId: outlet.id, reference: termRef, actor: 'test-actor', principal: privilegedPrincipal }),
      terminalService.create({ agentId, outletId: outlet.id, reference: termRef, actor: 'test-actor', principal: privilegedPrincipal }),
    ]);
    const termFulfilled = termResults.filter((r) => r.status === 'fulfilled').length;
    const termRejected = termResults.filter((r) => r.status === 'rejected').length;
    expect(termFulfilled).toBe(1);
    expect(termRejected).toBe(1);
    const termRows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM agent_terminals WHERE reference=$1 AND deleted_at IS NULL`, [termRef]);
    expect(Number(termRows[0]!.count)).toBe(1);
  });

  // 10. Aggregator relationship behavior
  it('10. Aggregator relationship behavior', async () => {
    const { agentId } = await createActiveAgent();
    const aggId = await createActiveAggregator();
    // No relationship -> should reject when creating outlet via aggregator
    await expect(
      outletService.create({ agentId, aggregatorId: aggId, reference: uniqueRef('outlet-agg'), name: 'Agg Outlet', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/relationship/i);
    // Create relationship then succeed
    await relationshipService.assign({ aggregatorId: aggId, agentId, actor: 'test-actor' });
    const outlet = await outletService.create({ agentId, aggregatorId: aggId, reference: uniqueRef('outlet-agg-ok'), name: 'Agg Ok', actor: 'test-actor', principal: privilegedPrincipal });
    expect(outlet.agentId).toBe(agentId);
    // Suspend relationship -> reject
    await relationshipService.suspend({ aggregatorId: aggId, agentId, actor: 'test-actor' });
    await expect(
      outletService.create({ agentId, aggregatorId: aggId, reference: uniqueRef('outlet-agg-sus'), name: 'Agg Sus', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/relationship/i);
    await relationshipService.reactivate({ aggregatorId: aggId, agentId, actor: 'test-actor' });
    const outlet2 = await outletService.create({ agentId, aggregatorId: aggId, reference: uniqueRef('outlet-agg-react'), name: 'Agg React', actor: 'test-actor', principal: privilegedPrincipal });
    expect(outlet2.id).toBeDefined();
    // Suspend aggregator -> reject
    await aggregatorService.suspend(aggId, 'test-actor');
    await expect(
      outletService.create({ agentId, aggregatorId: aggId, reference: uniqueRef('outlet-agg-aggsus'), name: 'Agg AggSus', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/SUSPENDED/i);
    await aggregatorService.terminate(aggId, 'test-actor');
    await expect(
      outletService.create({ agentId, aggregatorId: aggId, reference: uniqueRef('outlet-agg-aggterm'), name: 'Agg Term', actor: 'test-actor', principal: privilegedPrincipal }),
    ).rejects.toThrow(/TERMINATED/i);
    // Terminal via aggregator similarly
    const agg2 = await createActiveAggregator();
    const { agentId: agent2 } = await createActiveAgent();
    await relationshipService.assign({ aggregatorId: agg2, agentId: agent2, actor: 'test-actor' });
    const outlet3 = await outletService.create({ agentId: agent2, reference: uniqueRef('outlet-agg-t'), name: 'Agg T Outlet', actor: 'test-actor', principal: privilegedPrincipal });
    const term = await terminalService.create({ agentId: agent2, outletId: outlet3.id, aggregatorId: agg2, reference: uniqueRef('term-agg'), actor: 'test-actor', principal: privilegedPrincipal });
    expect(term.agentId).toBe(agent2);
  });

  // 11. Authorization boundaries
  it('11. Authorization boundaries', async () => {
    const { agentId } = await createActiveAgent();
    // Agent principal should be rejected
    await expect(
      outletService.create({ agentId, reference: uniqueRef('outlet-auth'), name: 'Auth Fail', actor: agentId, principal: agentPrincipal(agentId) }),
    ).rejects.toThrow(/Agent principal cannot manage/i);
    await expect(
      terminalService.create({ agentId, outletId: (await outletService.create({ agentId, reference: uniqueRef('outlet-auth-ok'), name: 'Ok', actor: 'test-actor', principal: privilegedPrincipal })).id, reference: uniqueRef('term-auth'), actor: agentId, principal: agentPrincipal(agentId) }),
    ).rejects.toThrow(/Agent principal/i);
    // Customer principal rejected
    await expect(
      outletService.create({ agentId, reference: uniqueRef('outlet-auth2'), name: 'Auth Fail Cust', actor: customerPrincipal.principalId, principal: customerPrincipal }),
    ).rejects.toThrow(/Customer principal/i);
    // Privileged should succeed (already tested)
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-auth-pass'), name: 'Pass', actor: 'test-actor', principal: privilegedPrincipal });
    expect(outlet.id).toBeDefined();
    // Check route policy registry for outlet/terminal routes is workforce only
    const { RoutePolicyRegistry } = await import('../src/authorization/route-policy-registry');
    const registry = new RoutePolicyRegistry();
    const policy1 = registry.resolve({ method: 'POST', url: '/api/v1/internal/agents/123/outlets' });
    expect(policy1.policy?.allowedPrincipalTypes).toEqual(['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']);
    const policy2 = registry.resolve({ method: 'POST', url: '/api/v1/internal/outlets/123/terminals' });
    expect(policy2.policy?.allowedPrincipalTypes).toEqual(['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']);
    const policy3 = registry.resolve({ method: 'GET', url: '/api/v1/internal/terminals/123' });
    expect(policy3.policy?.allowedPrincipalTypes).toEqual(['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']);
  });

  // 12. Audit generation/redaction
  it('12. Audit generation/redaction', async () => {
    const { agentId } = await createActiveAgent();
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-audit'), name: 'Audit Outlet', actor: 'test-actor', principal: privilegedPrincipal });
    const outletAudits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_OUTLET' ORDER BY created_at DESC LIMIT 1`, [outlet.id]);
    expect(outletAudits.length).toBe(1);
    let serial = JSON.stringify(outletAudits).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('secret');
    expect(serial).not.toContain('token');
    await outletService.suspend(outlet.id, 'test-actor');
    const suspendAudits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values, previous_values FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_OUTLET' AND action='AGENT_OUTLET_SUSPENDED'`, [outlet.id]);
    expect(suspendAudits.length).toBe(1);
    const terminalOutlet = await outletService.create({ agentId, reference: uniqueRef('outlet-audit-t'), name: 'Audit T Outlet', actor: 'test-actor', principal: privilegedPrincipal });
    const terminal = await terminalService.create({ agentId, outletId: terminalOutlet.id, reference: uniqueRef('term-audit'), actor: 'test-actor', principal: privilegedPrincipal });
    const termAudits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_TERMINAL' ORDER BY created_at DESC LIMIT 1`, [terminal.id]);
    expect(termAudits.length).toBe(1);
    serial = JSON.stringify(termAudits).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('secret');
  });

  // 13. Persistence/reload correctness
  it('13. Persistence/reload correctness', async () => {
    const { agentId } = await createActiveAgent();
    const ref = uniqueRef('outlet-persist');
    const created = await outletService.create({
      agentId,
      reference: ref,
      code: uniqueCode('OUT'),
      name: 'Persist Outlet',
      displayName: 'Persist Display',
      addressLine: '1 Test Street',
      city: 'Abuja',
      state: 'FCT',
      country: 'NG',
      actor: 'test-actor',
      principal: privilegedPrincipal,
    });
    const reloaded = await outletService.getById(created.id);
    expect(reloaded.reference).toBe(ref);
    expect(reloaded.name).toBe('Persist Outlet');
    expect(reloaded.displayName).toBe('Persist Display');
    expect(reloaded.addressLine).toBe('1 Test Street');
    expect(reloaded.city).toBe('Abuja');
    expect(reloaded.state).toBe('FCT');
    expect(reloaded.country).toBe('NG');
    expect(reloaded.agentId).toBe(agentId);
    expect(reloaded.status).toBe(OutletStatus.ACTIVE);
    // Terminal persistence
    const termRef = uniqueRef('term-persist');
    const terminal = await terminalService.create({
      agentId,
      outletId: created.id,
      reference: termRef,
      code: uniqueCode('TERM'),
      label: 'Terminal A',
      serialNumber: 'SN-PERSIST-001',
      actor: 'test-actor',
      principal: privilegedPrincipal,
    });
    const reloadedTerm = await terminalService.getById(terminal.id);
    expect(reloadedTerm.reference).toBe(termRef);
    expect(reloadedTerm.label).toBe('Terminal A');
    expect(reloadedTerm.serialNumber).toBe('SN-PERSIST-001');
    expect(reloadedTerm.outletId).toBe(created.id);
    // Listing
    const list = await outletService.listByAgent(agentId);
    expect(list.map((o) => o.id)).toContain(created.id);
    const termList = await terminalService.listByOutlet(created.id);
    expect(termList.map((t) => t.id)).toContain(terminal.id);
  });

  // 14. No financial side-effects (ledger/wallet)
  it('14. No financial side-effects', async () => {
    const walletsBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    const journalsBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const ledgerAccountsBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_accounts WHERE code LIKE 'AGENT_OUTLET%' OR code LIKE 'AGENT_TERMINAL%'`);
    const { agentId } = await createActiveAgent();
    const outlet = await outletService.create({ agentId, reference: uniqueRef('outlet-nofin'), name: 'NoFin', actor: 'test-actor', principal: privilegedPrincipal });
    await terminalService.create({ agentId, outletId: outlet.id, reference: uniqueRef('term-nofin'), actor: 'test-actor', principal: privilegedPrincipal });
    const walletsAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM wallet_accounts`);
    const journalsAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const ledgerAccountsAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_accounts WHERE code LIKE 'AGENT_OUTLET%' OR code LIKE 'AGENT_TERMINAL%'`);
    expect(Number(walletsAfter[0]!.count)).toBe(Number(walletsBefore[0]!.count));
    expect(Number(journalsAfter[0]!.count)).toBe(Number(journalsBefore[0]!.count));
    expect(Number(ledgerAccountsAfter[0]!.count)).toBe(0);
    expect(Number(ledgerAccountsBefore[0]!.count)).toBe(0);
    // Also ensure outlet/terminal are not wallet owners
    const walletOutlet: Array<any> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1`, [outlet.id]);
    expect(walletOutlet.length).toBe(0);
  });

  // 15. Migration chain
  it('15. Migration chain', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBe(64);
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600063');
    expect(latest[0]!.name).toBe('CreateCustomerFundingRequests1785753600063');
    const outletTable: Array<{ table_name: string }> = await dataSource.query(`SELECT table_name FROM information_schema.tables WHERE table_name='agent_outlets'`);
    expect(outletTable.length).toBe(1);
    const terminalTable: Array<{ table_name: string }> = await dataSource.query(`SELECT table_name FROM information_schema.tables WHERE table_name='agent_terminals'`);
    expect(terminalTable.length).toBe(1);
    const outletCheck: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='agent_outlets'::regclass AND conname='chk_agent_outlets_status'`);
    expect(outletCheck.length).toBe(1);
    const termCheck: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='agent_terminals'::regclass AND conname='chk_agent_terminals_status'`);
    expect(termCheck.length).toBe(1);
  });

  // 16. Production readiness
  it('16. Production readiness', async () => {
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600063');
    expect(latest[0]!.name).toBe('CreateCustomerFundingRequests1785753600063');
  });
});
