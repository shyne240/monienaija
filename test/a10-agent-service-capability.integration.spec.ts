/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unnecessary-type-assertion */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentServiceCapabilityService } from '../src/agent/agent-service-capability.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentStatus } from '../src/agent/agent.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('A10 Agent service capability & authorization (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let capabilityService: AgentServiceCapabilityService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a10capability');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    capabilityService = moduleRef.get(AgentServiceCapabilityService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        // Best-effort: embedded pg may terminate connection during DROP DATABASE
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60_000);

  async function createActiveAgentWithServices(services: string[] | unknown, isActive = true) {
    const cls = await classService.create({
      reference: `cls-a10-${randomUUID().slice(0, 8)}`,
      code: `A10-${randomUUID().slice(0, 6)}`,
      name: 'A10 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A10 ${randomUUID().slice(0,4)}`,
      contactEmail: `a10-${randomUUID().slice(0,6)}@test.com`,
      actor: 'applicant-a10',
    });
    await appService.submit(appEntity.id, 'applicant-a10');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    return { cls, agent, appEntity };
  }

  it('A. active Agent + active class + permitted service → ALLOWED', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN, AgentService.CASH_OUT]);
    const res = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(res.allowed).toBe(true);
    expect(res.reason).toBe('ALLOWED');
    expect(res.canonicalService).toBe(AgentService.CASH_IN);
  });

  it('B. active Agent + active class + unpermitted service → DENIED (SERVICE_NOT_PERMITTED)', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    const res = await capabilityService.evaluate(agent.id, AgentService.CASH_OUT);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('SERVICE_NOT_PERMITTED');
  });

  it('C. pending Agent → DENIED', async () => {
    const cls = await classService.create({
      reference: `cls-pend-${randomUUID().slice(0, 6)}`,
      code: `PEND-${randomUUID().slice(0,6)}`,
      name: 'Pend Class',
      isActive: true,
      applicableServices: [AgentService.CASH_IN],
      actor: 'test-actor',
    });
    const pendingId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'PENDING',$3,1)`, [pendingId, `pend-${randomUUID()}`, cls.id]);
    const res = await capabilityService.evaluate(pendingId, AgentService.CASH_IN);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_PENDING');
  });

  it('D. suspended Agent → DENIED', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    await lifecycleService.suspend(agent.id, 'test-actor');
    const res = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_SUSPENDED');
  });

  it('E. terminated Agent → DENIED', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    await lifecycleService.terminate(agent.id, 'test-actor');
    const res = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_TERMINATED');
  });

  it('F. deleted Agent → DENIED', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    await dataSource.query(`UPDATE agents SET deleted_at=NOW() WHERE id=$1`, [agent.id]);
    const res = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(res.allowed).toBe(false);
    expect(['AGENT_NOT_FOUND', 'AGENT_DELETED']).toContain(res.reason);
  });

  it('G. inactive AgentClass → DENIED', async () => {
    const { agent, cls } = await createActiveAgentWithServices([AgentService.CASH_IN], true);
    // deactivate class
    await classService.update(cls.id, { isActive: false, actor: 'test-actor' });
    const res = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_CLASS_INACTIVE');
  });

  it('H. missing AgentClass → DENIED', async () => {
    const agentId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'ACTIVE',NULL,1)`, [agentId, `h-${randomUUID()}`]);
    const res = await capabilityService.evaluate(agentId, AgentService.CASH_IN);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('MISSING_AGENT_CLASS');
    // also test class id points to soft-deleted class (FK-safe)
    const clsTmp = await classService.create({
      reference: `cls-miss-${randomUUID().slice(0,6)}`,
      code: `MISS-${randomUUID().slice(0,6)}`,
      name: 'Missing Class',
      isActive: true,
      applicableServices: [AgentService.CASH_IN],
      actor: 'test-actor',
    });
    const agentId2 = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'ACTIVE',$3,1)`, [agentId2, `h-${randomUUID()}`, clsTmp.id]);
    await dataSource.query(`UPDATE agent_classes SET deleted_at=NOW() WHERE id=$1`, [clsTmp.id]);
    const res2 = await capabilityService.evaluate(agentId2, AgentService.CASH_IN);
    expect(res2.allowed).toBe(false);
    expect(['AGENT_CLASS_NOT_FOUND','AGENT_CLASS_DELETED']).toContain(res2.reason);
  });

  it('I. empty applicableServices → DENIED', async () => {
    const { agent: a1 } = await createActiveAgentWithServices([]);
    const r1 = await capabilityService.evaluate(a1.id, AgentService.CASH_IN);
    expect(r1.allowed).toBe(false);
    expect(r1.reason).toBe('EMPTY_APPLICABLE_SERVICES');

    const { agent: a2 } = await createActiveAgentWithServices(null);
    const r2 = await capabilityService.evaluate(a2.id, AgentService.CASH_IN);
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toBe('EMPTY_APPLICABLE_SERVICES');
  });

  it('J. malformed/unknown service → DENIED', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    const rUnknown = await capabilityService.evaluate(agent.id, 'UNKNOWN_SERVICE_XYZ');
    expect(rUnknown.allowed).toBe(false);
    expect(rUnknown.reason).toBe('UNKNOWN_SERVICE');

    const rEmpty = await capabilityService.evaluate(agent.id, '   ');
    expect(rEmpty.allowed).toBe(false);
    expect(['INVALID_SERVICE','UNKNOWN_SERVICE']).toContain(rEmpty.reason);

    // malformed applicableServices: not an array
    const { agent: aMal1 } = await createActiveAgentWithServices('not-an-array' as unknown as string[]);
    const rMal1 = await capabilityService.evaluate(aMal1.id, AgentService.CASH_IN);
    expect(rMal1.allowed).toBe(false);
    expect(rMal1.reason).toBe('MALFORMED_APPLICABLE_SERVICES');

    // malformed applicableServices: array with unknown service
    const { agent: aMal2 } = await createActiveAgentWithServices(['CASH_IN', 'INVALID_SERVICE'] as unknown as string[]);
    const rMal2 = await capabilityService.evaluate(aMal2.id, AgentService.CASH_IN);
    expect(rMal2.allowed).toBe(false);
    expect(rMal2.reason).toBe('MALFORMED_APPLICABLE_SERVICES');
  });

  it('K. service configuration change is respected at runtime', async () => {
    const { agent, cls } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    const r1 = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(r1.allowed).toBe(true);
    const r2 = await capabilityService.evaluate(agent.id, AgentService.CASH_OUT);
    expect(r2.allowed).toBe(false);

    // Update class to allow CASH_OUT
    await classService.update(cls.id, { applicableServices: [AgentService.CASH_IN, AgentService.CASH_OUT], actor: 'test-actor' });
    const r3 = await capabilityService.evaluate(agent.id, AgentService.CASH_OUT);
    expect(r3.allowed).toBe(true);

    // Remove CASH_IN
    await classService.update(cls.id, { applicableServices: [AgentService.CASH_OUT], actor: 'test-actor' });
    const r4 = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    expect(r4.allowed).toBe(false);
    expect(r4.reason).toBe('SERVICE_NOT_PERMITTED');
  });

  it('L. Agent A service cannot authorize Agent B (principal mismatch / changing Agent ID)', async () => {
    const { agent: agentA } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    const { agent: agentB } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    // Agent A principal trying to evaluate Agent B
    const principalA = { type: 'AGENT', agentId: agentA.id };
    const res = await capabilityService.evaluateWithPrincipal(agentB.id, AgentService.CASH_IN, principalA);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('PRINCIPAL_MISMATCH');

    // Correct principal for B should succeed
    const principalB = { type: 'AGENT', agentId: agentB.id };
    const res2 = await capabilityService.evaluateWithPrincipal(agentB.id, AgentService.CASH_IN, principalB);
    expect(res2.allowed).toBe(true);
  });

  it('M. Customer principal cannot use Agent service capability as an Agent', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    const custPrincipal = { type: 'CUSTOMER', customerId: randomUUID() } as any;
    const res = await capabilityService.evaluateWithPrincipal(agent.id, AgentService.CASH_IN, custPrincipal);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('PRINCIPAL_NOT_AGENT');
  });

  it('N. workforce/admin principal does not automatically acquire Agent service permission', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    for (const type of ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const workforcePrincipal = { type, principalId: 'workforce-1' } as any;
      const res = await capabilityService.evaluateWithPrincipal(agent.id, AgentService.CASH_IN, workforcePrincipal);
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('WORKFORCE_NOT_PERMITTED');
    }
  });

  it('O. no wallet/ledger/journal side effects', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    const walletBefore: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const journalBefore: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const lineBefore: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    // Evaluate multiple times
    await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    await capabilityService.evaluate(agent.id, AgentService.CASH_OUT);
    await capabilityService.evaluate(agent.id, AgentService.AGENT_FUNDING);
    const walletAfter: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const journalAfter: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const lineAfter: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    expect(walletAfter[0]!.cnt).toBe(walletBefore[0]!.cnt);
    expect(journalAfter[0]!.cnt).toBe(journalBefore[0]!.cnt);
    expect(lineAfter[0]!.cnt).toBe(lineBefore[0]!.cnt);
  });

  it('P. no Customer row created', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    const custRows: Array<{id:string}> = await dataSource.query(`SELECT id FROM customers WHERE reference=$1`, [agent.reference]);
    expect(custRows.length).toBe(0);
  });

  it('Q. repeated capability checks are deterministic', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN, AgentService.AGENT_FUNDING]);
    const r1 = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    const r2 = await capabilityService.evaluate(agent.id, AgentService.CASH_IN);
    const r3 = await capabilityService.evaluate(agent.id, AgentService.CASH_OUT);
    const r4 = await capabilityService.evaluate(agent.id, AgentService.CASH_OUT);
    expect(r1).toEqual(r2);
    expect(r3).toEqual(r4);
    expect(r1.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });

  it('security: bypass attempts via unknown service, inactive class, terminated agent', async () => {
    const { agent: activeAgent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    // unknown service
    const r1 = await capabilityService.evaluate(activeAgent.id, 'BILLS_PAYMENT');
    expect(r1.allowed).toBe(false);
    // inactive class
    const { agent: inactiveClassAgent, cls: inactiveCls } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    await classService.update(inactiveCls.id, { isActive: false, actor: 'test-actor' });
    const r2 = await capabilityService.evaluate(inactiveClassAgent.id, AgentService.CASH_IN);
    expect(r2.allowed).toBe(false);
    // terminated
    await lifecycleService.terminate(activeAgent.id, 'test-actor');
    const r3 = await capabilityService.evaluate(activeAgent.id, AgentService.CASH_IN);
    expect(r3.allowed).toBe(false);
    expect(r3.reason).toBe('AGENT_TERMINATED');
  });

  it('alias handling: CASH_TO_WALLET and WALLET_TO_CASH', async () => {
    const { agent } = await createActiveAgentWithServices([AgentService.CASH_IN]);
    // CASH_TO_WALLET should be treated as CASH_IN
    const rAlias = await capabilityService.evaluate(agent.id, 'CASH_TO_WALLET');
    expect(rAlias.allowed).toBe(true);
    expect(rAlias.canonicalService).toBe(AgentService.CASH_IN);
    // But if class has WALLET_TO_CASH, CASH_OUT should be allowed
    const cls2 = await classService.create({
      reference: `cls-alias-${randomUUID().slice(0,6)}`,
      code: `ALIAS-${randomUUID().slice(0,6)}`,
      name: 'Alias Class',
      isActive: true,
      applicableServices: ['WALLET_TO_CASH'],
      actor: 'test-actor',
    });
    const app2 = await appService.create({ agentClassId: cls2.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz Alias', contactEmail: 'alias@test.com', actor: 'applicant-alias' });
    await appService.submit(app2.id, 'applicant-alias');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app2.id]);
    const agent2 = await lifecycleService.activateFromApplication(app2.id, 'test-actor');
    const rOut = await capabilityService.evaluate(agent2.id, AgentService.CASH_OUT);
    expect(rOut.allowed).toBe(true);
    const rOutAlias = await capabilityService.evaluate(agent2.id, 'WALLET_TO_CASH');
    expect(rOutAlias.allowed).toBe(true);
  });
});
