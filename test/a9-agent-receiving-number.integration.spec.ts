/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentReceivingNumberService } from '../src/agent/agent-receiving-number.service';
import { RecipientResolutionService } from '../src/agent/recipient-resolution.service';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('A9 Agent MonieNaija receiving number (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let receivingService: AgentReceivingNumberService;
  let resolutionService: RecipientResolutionService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a9receiving');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    receivingService = moduleRef.get(AgentReceivingNumberService);
    resolutionService = moduleRef.get(RecipientResolutionService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60_000);

  it('A. ACTIVE Agent receives exactly one canonical 10-digit number', async () => {
    const cls = await classService.create({ reference: `cls-a-${randomUUID().slice(0,8)}`, code: `CA-${randomUUID().slice(0,6)}`, name: 'Test Class A', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz A', contactEmail: 'a@test.com', actor: 'applicant-a' });
    await appService.submit(app.id, 'applicant-a');
    const toReview = await dataSource.getRepository('agent_applications' as any).findOne({ where: { id: app.id } }) as any;
    // Simulate internal approve (set status APPROVED)
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    const agent = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    const rn = await receivingService.getByAgentId(agent.id);
    expect(rn).not.toBeNull();
    expect(rn!.receivingNumber).toMatch(/^[789][0-9]{9}$/);
    // Allocation should have created one row
    const count: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM agent_receiving_numbers WHERE agent_id=$1`, [agent.id]);
    expect(Number(count[0]!.cnt)).toBe(1);
  });

  it('B. Idempotent activation does not create second number', async () => {
    const cls = await classService.create({ reference: `cls-b-${randomUUID().slice(0,8)}`, code: `CB-${randomUUID().slice(0,6)}`, name: 'Test Class B', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz B', contactEmail: 'b@test.com', actor: 'applicant-b' });
    await appService.submit(app.id, 'applicant-b');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    const agent1 = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    const rn1 = await receivingService.getByAgentId(agent1.id);
    const agent2 = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    const rn2 = await receivingService.getByAgentId(agent2.id);
    expect(rn1!.receivingNumber).toBe(rn2!.receivingNumber);
    const cnt: Array<{cnt:string}> = await dataSource.query(`SELECT count(*)::text as cnt FROM agent_receiving_numbers WHERE agent_id=$1`, [agent1.id]);
    expect(Number(cnt[0]!.cnt)).toBe(1);
  });

  it('C. Persists and D. Unique', async () => {
    const cls = await classService.create({ reference: `cls-c-${randomUUID().slice(0,8)}`, code: `CC-${randomUUID().slice(0,6)}`, name: 'Test Class C', isActive: true, actor: 'test-actor' });
    const app1 = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz C1', contactEmail: 'c1@test.com', actor: 'applicant-c1' });
    const app2 = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz C2', contactEmail: 'c2@test.com', actor: 'applicant-c2' });
    for (const app of [app1, app2]) {
      await appService.submit(app.id, 'applicant-c');
      await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    }
    const a1 = await lifecycleService.activateFromApplication(app1.id, 'test-actor');
    const a2 = await lifecycleService.activateFromApplication(app2.id, 'test-actor');
    const rn1 = await receivingService.getByAgentId(a1.id);
    const rn2 = await receivingService.getByAgentId(a2.id);
    expect(rn1!.receivingNumber).not.toBe(rn2!.receivingNumber);
    // Check DB unique
    const dup: Array<{cnt:string}> = await dataSource.query(`SELECT count(DISTINCT receiving_number)::text as cnt FROM agent_receiving_numbers WHERE agent_id IN ($1,$2)`, [a1.id, a2.id]);
    expect(Number(dup[0]!.cnt)).toBe(2);
  });

  it('E. Customer/Agent no collision', async () => {
    // Create a Customer with phone 8012345678 (10-digit) primary
    const custRows: Array<{id:string}> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-e-${randomUUID().slice(0,8)}`],
    );
    const custId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [custId, 'Customer E'],
    );
    const phoneCanonical = '8011112222';
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`,
      [custId, phoneCanonical],
    );
    // Now create an Agent and attempt to allocate; if random hits same number, it should retry and get different
    // We can force collision by mocking generateCandidate? For now, ensure at least that after allocation, not equal
    const cls = await classService.create({ reference: `cls-e-${randomUUID().slice(0,8)}`, code: `CE-${randomUUID().slice(0,6)}`, name: 'Test Class E', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz E', contactEmail: 'e@test.com', actor: 'applicant-e' });
    await appService.submit(app.id, 'applicant-e');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    const agent = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    const rn = await receivingService.getByAgentId(agent.id);
    expect(rn!.receivingNumber).not.toBe(phoneCanonical);
    // Also ensure resolution distinguishes
    const resCustomer = await resolutionService.resolve(phoneCanonical);
    expect(resCustomer.ownerType).toBe('CUSTOMER');
    expect(resCustomer.ownerId).toBe(custId);
    const resAgent = await resolutionService.resolve(rn!.receivingNumber);
    expect(resAgent.ownerType).toBe('AGENT');
    expect(resAgent.ownerId).toBe(agent.id);
  });

  it('F. Concurrent allocations do not duplicate', async () => {
    const cls = await classService.create({ reference: `cls-f-${randomUUID().slice(0,8)}`, code: `CF-${randomUUID().slice(0,6)}`, name: 'Test Class F', isActive: true, actor: 'test-actor' });
    const apps = [];
    for (let i=0;i<3;i++) {
      const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: `Biz F${i}`, contactEmail: `f${i}@test.com`, actor: `applicant-f${i}` });
      await appService.submit(app.id, `applicant-f${i}`);
      await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
      apps.push(app);
    }
    const agents = await Promise.all(apps.map(a => lifecycleService.activateFromApplication(a.id, 'test-actor')));
    const numbers = await Promise.all(agents.map(a => receivingService.getByAgentId(a.id)));
    const set = new Set(numbers.map(n => n!.receivingNumber));
    expect(set.size).toBe(3);
  });

  it('G. PENDING no active number, H. APPROVED-not-ACTIVE no active number', async () => {
    const cls = await classService.create({ reference: `cls-g-${randomUUID().slice(0,8)}`, code: `CG-${randomUUID().slice(0,6)}`, name: 'Test Class G', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz G', contactEmail: 'g@test.com', actor: 'applicant-g' });
    // DRAFT has no number
    await dataSource.query(`SELECT id FROM agent_applications WHERE id=$1`, [app.id]);
    // Not yet ACTIVE, so any lookup for non-existent agent should be null
    // Create PENDING agent directly via lifecycle's pending creation path
    await appService.submit(app.id, 'applicant-g');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    // Before activation, check no agent yet or PENDING
    const before = await dataSource.query(`SELECT agent_id FROM agent_applications WHERE id=$1`, [app.id]) as Array<{agent_id:string|null}>;
    expect(before[0]!.agent_id).toBeNull();
    // Now activate
    const agent = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    expect(agent.status).toBe('ACTIVE');
    // PENDING agents directly if we create one via raw insert
    const pendingId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, version) VALUES ($1,$2,'PENDING',1)`, [pendingId, `pend-${randomUUID()}`]);
    const rnPending = await receivingService.getByAgentId(pendingId);
    expect(rnPending).toBeNull();
  });

  it('I. SUSPENDED retains, J. TERMINATED not reassigned', async () => {
    const cls = await classService.create({ reference: `cls-i-${randomUUID().slice(0,8)}`, code: `CI-${randomUUID().slice(0,6)}`, name: 'Test Class I', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz I', contactEmail: 'i@test.com', actor: 'applicant-i' });
    await appService.submit(app.id, 'applicant-i');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    const agent = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    const rnActive = await receivingService.getByAgentId(agent.id);
    expect(rnActive).not.toBeNull();
    await lifecycleService.suspend(agent.id, 'test-actor');
    const rnSuspended = await receivingService.getByAgentId(agent.id);
    expect(rnSuspended!.receivingNumber).toBe(rnActive!.receivingNumber);
    // Resolution should still return AGENT but status SUSPENDED
    const resSusp = await resolutionService.resolve(rnSuspended!.receivingNumber);
    expect(resSusp.ownerType).toBe('AGENT');
    expect(resSusp.status).toBe('SUSPENDED');
    await lifecycleService.terminate(agent.id, 'test-actor');
    // After terminated, resolution should not return agent
    await expect(resolutionService.resolve(rnSuspended!.receivingNumber)).rejects.toThrow();
    // Ensure not reassigned: try to re-activate same agent (should fail)
    await expect(lifecycleService.activate(agent.id, 'test-actor')).rejects.toThrow();
    const after = await dataSource.query(`SELECT status FROM agent_receiving_numbers WHERE agent_id=$1`, [agent.id]) as Array<{status:string}>;
    expect(after[0]!.status).toBe('REVOKED');
  });

  it('K/L/M/N/O: resolution preserves Customer and returns typed owners', async () => {
    // Create Customer with phone and profile
    const custRows: Array<{id:string}> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-k-${randomUUID().slice(0,8)}`],
    );
    const custId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer K',true)`, [custId]);
    const custPhone = '8099998888';
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [custId, custPhone]);
    const resCust = await resolutionService.resolve(custPhone);
    expect(resCust.ownerType).toBe('CUSTOMER');
    expect(resCust.ownerId).toBe(custId);
    // Agent
    const cls = await classService.create({ reference: `cls-k-${randomUUID().slice(0,8)}`, code: `CK-${randomUUID().slice(0,6)}`, name: 'Test Class K', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz K', contactEmail: 'k@test.com', actor: 'applicant-k' });
    await appService.submit(app.id, 'applicant-k');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    const agent = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    const rn = await receivingService.getByAgentId(agent.id);
    const resAgent = await resolutionService.resolve(rn!.receivingNumber);
    expect(resAgent.ownerType).toBe('AGENT');
    // Also test phone normalization with +234 prefix
    const resCustWithCountry = await resolutionService.resolve('+234' + custPhone);
    expect(resCustWithCountry.ownerType).toBe('CUSTOMER');
    const resAgentWithCountry = await resolutionService.resolve('+234' + rn!.receivingNumber);
    expect(resAgentWithCountry.ownerType).toBe('AGENT');
  });

  it('P. No Customer row for Agent, Q. No wallet duplicate, R. No journal', async () => {
    const cls = await classService.create({ reference: `cls-p-${randomUUID().slice(0,8)}`, code: `CP-${randomUUID().slice(0,6)}`, name: 'Test Class P', isActive: true, actor: 'test-actor' });
    const app = await appService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: 'Biz P', contactEmail: 'p@test.com', actor: 'applicant-p' });
    await appService.submit(app.id, 'applicant-p');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [app.id]);
    const agent = await lifecycleService.activateFromApplication(app.id, 'test-actor');
    // No Customer row with same reference
    const custRows: Array<{id:string}> = await dataSource.query(`SELECT id FROM customers WHERE reference=$1`, [agent.reference]);
    expect(custRows.length).toBe(0);
    // No wallet duplicate: wallet_accounts where customer_id = agent.id should not exist (Agent uses different wallet binding)
    const walletRows: Array<{id:string}> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1`, [agent.id]);
    // Should be 0 because Agent wallet not auto-created
    expect(walletRows.length).toBe(0);
    // No journal/ledger entry created for Agent activation alone
    const journalRows: Array<{id:string}> = await dataSource.query(`SELECT id FROM ledger_journals WHERE description LIKE $1`, [`%${agent.id}%`]);
    expect(journalRows.length).toBe(0);
  });

  it('Y. No balance column on agent_receiving_numbers', async () => {
    const cols: Array<{column_name:string}> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='agent_receiving_numbers'`,
    );
    const names = cols.map(c => c.column_name);
    expect(names).not.toContain('balance');
    expect(names).not.toContain('ledger_account_id');
    expect(names).not.toContain('ledgerAccountId');
    expect(names).toContain('receiving_number');
    expect(names).toContain('agent_id');
  });
});
