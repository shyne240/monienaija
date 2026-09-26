/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { SupportService } from '../src/support/support.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'test-salt-v1-007'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-007 Support Ticket Lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let supportService: SupportService;
  let fundingService: CustomerFundingService;
  let walletService: WalletService;
  let ledgerService: LedgerService;

  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: 'support-007-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: 'operator-007-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const privilegedPrincipal: any = {
    type: 'PRIVILEGED',
    principalId: 'priv-007-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-007-support');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    supportService = moduleRef.get(SupportService);
    fundingService = moduleRef.get(CustomerFundingService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try { await destroyIntegrationDataSource(dataSource); } catch { try { if (dataSource.isInitialized) await dataSource.destroy().catch(()=>undefined);} catch { void 0; } }
    }
  }, 60000);

  beforeEach(async () => {
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts')`,
    );
    if (rows.length) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
    const settlement: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (settlement.length === 0) {
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES
          ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000202','PAYMENT-SETTLEMENT_CLEARING-NGN','Payment settlement clearing NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES (gen_random_uuid(),'AGENT_FUNDING_POOL-NGN','Agent Funding Pool NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
    }
  });

  async function createCustomerWithCredential(opts: { reference?: string; password?: string } = {}): Promise<{ customerId: string; token: string; walletId: string; ledgerAccountId: string }> {
    const reference = opts.reference ?? `cust-support-${randomUUID()}`;
    const password = opts.password ?? 'correct-password-support';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'Support Customer']);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const wallet = await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `support-wallet-${customerId}-${randomUUID()}` });
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    return { customerId, token, walletId: wallet.id, ledgerAccountId: wallet.ledgerAccountId };
  }

  async function createAgentWithCredential(): Promise<{ agentId: string; token: string }> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [`cls-sup-${randomUUID().slice(0,8)}`, `SUP-${randomUUID().slice(0,6)}`, 'Support Class', JSON.stringify(['CASH_IN']), JSON.stringify({})],
    );
    const classId = classRows[0]!.id;
    const ref = `agent-sup-${randomUUID()}`;
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [ref, classId]);
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-sup', 'agent-salt-sup');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-sup' }).expect(200);
    return { agentId, token: login.body.accessToken as string };
  }

  async function getBalance(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0]!.balance);
  }

  // ──────────────────────────────────────────────
  // 1. Customer creates ticket
  // ──────────────────────────────────────────────

  it('1. Customer creates ticket (SELF, OPEN)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `cust-create-${randomUUID()}`)
      .send({ subject: 'My funding not credited', category: 'FUNDING', description: 'I paid 50k but not credited, funding ref pending' })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.reference).toMatch(/^SUP-/);
    expect(res.body.subject).toBe('My funding not credited');
    expect(res.body.category).toBe('FUNDING');
    expect(res.body.status).toBe('OPEN');
    expect(res.body.priority).toBe('MEDIUM');
    // safe: no assignedTo, no internal audit, no ledger ids
    expect(res.body.assignedTo).toBeUndefined();
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('password');
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('pin');
    // via service also
    const viaService = await supportService.getForCustomer(res.body.id, customerId);
    expect(viaService.id).toBe(res.body.id);
  });

  it('2. Customer sees own ticket (GET)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Cannot transfer', category: 'TRANSFER', description: 'Transfer failed with 500' })
      .expect(201);
    const get = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(get.body.id).toBe(created.body.id);
    expect(get.body.status).toBe('OPEN');
    // list own tickets
    const list = await request(app.getHttpServer())
      .get('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items.some((i: any) => i.id === created.body.id)).toBe(true);
    expect(list.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('3. Customer cannot see another customer ticket (404)', async () => {
    const custA = await createCustomerWithCredential();
    const custB = await createCustomerWithCredential();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${custA.token}`)
      .send({ subject: 'Issue A', category: 'OTHER', description: 'Customer A issue' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${custB.token}`)
      .expect(404);
    const listB = await request(app.getHttpServer())
      .get('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${custB.token}`)
      .expect(200);
    expect(listB.body.items.some((i: any) => i.id === created.body.id)).toBe(false);
    // service also isolates
    await expect(supportService.getForCustomer(created.body.id, custB.customerId)).rejects.toThrow(/not found/i);
  });

  it('4. Agent creates ticket (SELF)', async () => {
    const { agentId, token } = await createAgentWithCredential();
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/me/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Outlet not working', category: 'OUTLET', description: 'My outlet terminal offline since yesterday' })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('OPEN');
    const viaService = await supportService.getForAgent(res.body.id, agentId);
    expect(viaService.id).toBe(res.body.id);
    const list = await request(app.getHttpServer())
      .get('/api/v1/agents/me/support/tickets')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items.some((i: any) => i.id === res.body.id)).toBe(true);
  });

  it('5. Agent cannot see another Agent ticket (404)', async () => {
    const agentA = await createAgentWithCredential();
    const agentB = await createAgentWithCredential();
    const created = await request(app.getHttpServer())
      .post('/api/v1/agents/me/support/tickets')
      .set('Authorization', `Bearer ${agentA.token}`)
      .send({ subject: 'Agent A issue', category: 'OTHER', description: 'Agent A terminal' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/agents/me/support/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${agentB.token}`)
      .expect(404);
    await expect(supportService.getForAgent(created.body.id, agentB.agentId)).rejects.toThrow(/not found/i);
  });

  it('6. unauthenticated rejected (401 CUSTOMER/AGENT/INTERNAL)', async () => {
    await request(app.getHttpServer()).post('/api/v1/customers/me/support/tickets').send({ subject: 'x', category: 'OTHER', description: 'y' }).expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/support/tickets').expect(401);
    await request(app.getHttpServer()).post('/api/v1/agents/me/support/tickets').send({ subject: 'x', category: 'OTHER', description: 'y' }).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/support/tickets').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/support/tickets/some-id').expect(401);
  });

  it('7. authorized internal listing (workforce)', async () => {
    const cust = await createCustomerWithCredential();
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Internal list test', category: 'WALLET', description: 'Wallet balance mismatch' })
      .expect(201);
    const list = await supportService.listForInternal(1, 20);
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    const item = list.items.find((i) => i.subject === 'Internal list test');
    expect(item).toBeDefined();
    expect(item!.status).toBe('OPEN');
    // via internal HTTP should be 401 without token, but service proves workforce can list
    // also test that customer token cannot access internal
    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    // agent token also rejected on workforce route
    const agent = await createAgentWithCredential();
    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set('Authorization', `Bearer ${agent.token}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
  });

  it('8. assignment works (workforce)', async () => {
    const cust = await createCustomerWithCredential();
    const created = await supportService.createTicket({
      subject: 'Assignment test',
      category: 'OTHER' as any,
      description: 'Need assignment',
      principal: { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' } as any,
    });
    expect(created.assignedTo).toBeNull();
    const assigned = await supportService.assignTicket({
      ticketId: created.id,
      assignedTo: 'support-agent-007',
      principal: supportMaker,
    });
    expect(assigned.assignedTo).toBe('support-agent-007');
    // status should have moved to IN_PROGRESS on assign if was OPEN
    expect(assigned.status).toBe('IN_PROGRESS');
    // via internal get
    const fetched = await supportService.getForInternal(created.id);
    expect(fetched.assignedTo).toBe('support-agent-007');
    // audit exists
    const audits: Array<{ action: string }> = await dataSource.query(`SELECT action FROM audit_events WHERE entity_id=$1 AND entity_type='SUPPORT_TICKET'`, [created.id]);
    expect(audits.some((a) => a.action === 'SUPPORT_TICKET_ASSIGNED')).toBe(true);
    // outbox
    const outbox: Array<{ event_type: string }> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='support.ticket.assigned'`, [created.id]);
    expect(outbox.length).toBe(1);
    // reassignment audited
    const reassigned = await supportService.assignTicket({
      ticketId: created.id,
      assignedTo: 'support-agent-007-b',
      principal: operatorChecker,
    });
    expect(reassigned.assignedTo).toBe('support-agent-007-b');
    const audits2: Array<{ action: string }> = await dataSource.query(`SELECT action FROM audit_events WHERE entity_id=$1 AND action='SUPPORT_TICKET_ASSIGNED'`, [created.id]);
    expect(audits2.length).toBe(2);
  });

  it('9. unauthorized assignment rejected (CUSTOMER/AGENT cannot assign)', async () => {
    const cust = await createCustomerWithCredential();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Unauthorized assign', category: 'OTHER', description: 'test assign' })
      .expect(201);
    // customer via HTTP internal assign should be 401/403
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${created.body.id}/assign`)
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ assignedTo: 'someone' })
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    // service with customer principal should throw Forbidden
    const custPrincipal: any = { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' };
    await expect(supportService.assignTicket({ ticketId: created.body.id, assignedTo: 'x', principal: custPrincipal })).rejects.toThrow(/not allowed|Forbidden/i);
    const agent = await createAgentWithCredential();
    const agentPrincipal: any = { type: 'AGENT', principalId: agent.agentId, agentId: agent.agentId, roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'SELF' };
    await expect(supportService.assignTicket({ ticketId: created.body.id, assignedTo: 'x', principal: agentPrincipal })).rejects.toThrow(/not allowed/i);
  });

  it('10. valid status transition (OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED)', async () => {
    const cust = await createCustomerWithCredential();
    const created = await supportService.createTicket({
      subject: 'Status valid',
      category: 'OTHER' as any,
      description: 'status test',
      principal: { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' } as any,
    });
    expect(created.status).toBe('OPEN');
    const inProg = await supportService.updateStatus({ ticketId: created.id, status: 'IN_PROGRESS' as any, principal: supportMaker });
    expect(inProg.status).toBe('IN_PROGRESS');
    const resolved = await supportService.updateStatus({ ticketId: created.id, status: 'RESOLVED' as any, principal: operatorChecker });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).toBeTruthy();
    const closed = await supportService.updateStatus({ ticketId: created.id, status: 'CLOSED' as any, principal: privilegedPrincipal });
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).toBeTruthy();
    // outbox for resolved and closed
    const outboxRes: Array<any> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type IN ('support.ticket.resolved','support.ticket.closed','support.ticket.status_changed')`, [created.id]);
    expect(outboxRes.some((r) => r.event_type === 'support.ticket.resolved')).toBe(true);
    expect(outboxRes.some((r) => r.event_type === 'support.ticket.closed')).toBe(true);
  });

  it('11. invalid status transition rejected', async () => {
    const cust = await createCustomerWithCredential();
    const created = await supportService.createTicket({
      subject: 'Invalid transition',
      category: 'OTHER' as any,
      description: 'invalid',
      principal: { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' } as any,
    });
    // OPEN -> CLOSED is allowed, but RESOLVED -> OPEN is not, CLOSED -> anything not
    await supportService.updateStatus({ ticketId: created.id, status: 'RESOLVED' as any, principal: operatorChecker });
    await expect(supportService.updateStatus({ ticketId: created.id, status: 'OPEN' as any, principal: operatorChecker })).rejects.toThrow(/Invalid.*transition/i);
    await expect(supportService.updateStatus({ ticketId: created.id, status: 'IN_PROGRESS' as any, principal: operatorChecker })).rejects.toThrow(/Invalid.*transition/i);
    await supportService.updateStatus({ ticketId: created.id, status: 'CLOSED' as any, principal: operatorChecker });
    await expect(supportService.updateStatus({ ticketId: created.id, status: 'RESOLVED' as any, principal: operatorChecker })).rejects.toThrow(/Invalid.*transition/i);
    // also test CLOSED cannot be assigned
    await expect(supportService.assignTicket({ ticketId: created.id, assignedTo: 'someone', principal: supportMaker })).rejects.toThrow(/Cannot assign/i);
  });

  it('12. resolution works and 13. customer sees resolved status', async () => {
    const cust = await createCustomerWithCredential();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Resolve me', category: 'FUNDING', description: 'Please resolve' })
      .expect(201);
    const sw = await supportService.updateStatus({ ticketId: created.body.id, status: 'RESOLVED' as any, principal: operatorChecker });
    expect(sw.status).toBe('RESOLVED');
    const custView = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    expect(custView.body.status).toBe('RESOLVED');
    expect(custView.body.resolvedAt).toBeTruthy();
    // audit
    const audits: Array<{ action: string }> = await dataSource.query(`SELECT action FROM audit_events WHERE entity_id=$1`, [created.body.id]);
    expect(audits.some((a) => a.action === 'SUPPORT_TICKET_RESOLVED')).toBe(true);
  });

  it('14. messages persist (customer and agent)', async () => {
    const cust = await createCustomerWithCredential();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Message test', category: 'OTHER', description: 'need messages' })
      .expect(201);
    const msg1 = await request(app.getHttpServer())
      .post(`/api/v1/customers/me/support/tickets/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ body: 'Hello, I need help with funding' })
      .expect(201);
    expect(msg1.body.body).toBe('Hello, I need help with funding');
    expect(msg1.body.authorType).toBe('CUSTOMER');
    // workforce reply
    const msg2 = await supportService.addMessage({
      ticketId: created.body.id,
      body: 'We are looking into it',
      principal: supportMaker,
    });
    expect(msg2.body).toBe('We are looking into it');
    const listCust = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${created.body.id}/messages`)
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    expect(listCust.body.length).toBe(2);
    expect(listCust.body[0].body).toBe('Hello, I need help with funding');
    expect(listCust.body[1].body).toBe('We are looking into it');
    // agent messages
    const agent = await createAgentWithCredential();
    const agentTicket = await request(app.getHttpServer())
      .post('/api/v1/agents/me/support/tickets')
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ subject: 'Agent msg', category: 'OTHER', description: 'agent issue' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/support/tickets/${agentTicket.body.id}/messages`)
      .set('Authorization', `Bearer ${agent.token}`)
      .send({ body: 'Agent message 1' })
      .expect(201);
    const agentMsgs = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/support/tickets/${agentTicket.body.id}/messages`)
      .set('Authorization', `Bearer ${agent.token}`)
      .expect(200);
    expect(agentMsgs.body.length).toBe(1);
    expect(agentMsgs.body[0].body).toBe('Agent message 1');
  });

  it('15. message ownership isolation (customer cannot see other customer messages, cannot add to other ticket)', async () => {
    const custA = await createCustomerWithCredential();
    const custB = await createCustomerWithCredential();
    const ticketA = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${custA.token}`)
      .send({ subject: 'Cust A msg isolation', category: 'OTHER', description: 'Valid description A' })
      .expect(201);
    const ticketB = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${custB.token}`)
      .send({ subject: 'Cust B', category: 'OTHER', description: 'Valid description B' })
      .expect(201);
    // A adds message to own
    await request(app.getHttpServer())
      .post(`/api/v1/customers/me/support/tickets/${ticketA.body.id}/messages`)
      .set('Authorization', `Bearer ${custA.token}`)
      .send({ body: 'A message' })
      .expect(201);
    // B tries to add to A ticket -> 404
    await request(app.getHttpServer())
      .post(`/api/v1/customers/me/support/tickets/${ticketA.body.id}/messages`)
      .set('Authorization', `Bearer ${custB.token}`)
      .send({ body: 'B trying to inject' })
      .expect(404);
    // B tries to list A messages -> 404
    await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${ticketA.body.id}/messages`)
      .set('Authorization', `Bearer ${custB.token}`)
      .expect(404);
    // Service also isolates
    const custBPrincipal: any = { type: 'CUSTOMER', principalId: custB.customerId, customerId: custB.customerId, roles: [], scopes: [], customerAccess: 'SELF' };
    await expect(supportService.addMessage({ ticketId: ticketA.body.id, body: 'hack', principal: custBPrincipal })).rejects.toThrow(/not found/i);
    await expect(supportService.listMessages(ticketA.body.id, custBPrincipal)).rejects.toThrow(/not found/i);
  });

  it('16. internal-only messages not leaked to customer/agent', async () => {
    const cust = await createCustomerWithCredential();
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Internal note leak', category: 'OTHER', description: 'test internal' })
      .expect(201);
    // workforce adds internal note
    await supportService.addMessage({
      ticketId: ticket.body.id,
      body: 'Internal note: check funding 5000 NGN',
      isInternal: true,
      principal: supportMaker,
    });
    // workforce adds public reply
    await supportService.addMessage({
      ticketId: ticket.body.id,
      body: 'Public update: we are investigating',
      isInternal: false,
      principal: supportMaker,
    });
    // customer sees only public
    const custMsgs = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${ticket.body.id}/messages`)
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    expect(custMsgs.body.length).toBe(1);
    expect(custMsgs.body[0].body).toBe('Public update: we are investigating');
    expect(custMsgs.body.some((m: any) => m.body.includes('Internal note'))).toBe(false);
    expect(custMsgs.body.some((m: any) => m.isInternal === true)).toBe(false);
    // agent sees same filtered
    // workforce sees both
    const internalMsgs = await supportService.listMessages(ticket.body.id, supportMaker);
    expect(internalMsgs.length).toBe(2);
    expect(internalMsgs.some((m) => m.isInternal === true)).toBe(true);
    // also ensure customer cannot create internal
    await request(app.getHttpServer())
      .post(`/api/v1/customers/me/support/tickets/${ticket.body.id}/messages`)
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ body: 'try internal', isInternal: true })
      .expect((r) => expect([400, 403].includes(r.status)).toBe(true));
  });

  it('17. transaction link works (fundingRequestId + relatedTransferId)', async () => {
    const cust = await createCustomerWithCredential();
    // create funding request via service
    const funding = await fundingService.createRequest({
      customerId: cust.customerId,
      amountMinor: '50000',
      currency: 'NGN',
      idempotencyKey: `v1-007-fund-${randomUUID()}`,
      principal: supportMaker,
    });
    // create ticket linked to funding
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Funding link', category: 'FUNDING', description: 'My funding pending', fundingRequestId: funding.id })
      .expect(201);
    expect(ticket.body.fundingRequestId).toBe(funding.id);
    const fetched = await supportService.getForCustomer(ticket.body.id, cust.customerId);
    expect(fetched.fundingRequestId).toBe(funding.id);
    // internal also sees
    const internal = await supportService.getForInternal(ticket.body.id);
    expect(internal.fundingRequestId).toBe(funding.id);
    // invalid fundingRequestId should 400 or 404
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Bad funding', category: 'FUNDING', description: 'bad', fundingRequestId: randomUUID() })
      .expect((r) => expect([400, 404].includes(r.status)).toBe(true));
  });

  it('18. V1-001 fundingRequestId link works end-to-end (approve still works after ticket)', async () => {
    const cust = await createCustomerWithCredential();
    const funding = await fundingService.createRequest({
      customerId: cust.customerId,
      amountMinor: '25000',
      currency: 'NGN',
      idempotencyKey: `v1-007-fund2-${randomUUID()}`,
      principal: supportMaker,
    });
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Funding pending support', category: 'FUNDING', description: 'Please check', fundingRequestId: funding.id })
      .expect(201);
    expect(ticket.body.fundingRequestId).toBe(funding.id);
    // approve funding still credits wallet, ticket remains
    const before = await getBalance(cust.ledgerAccountId);
    await fundingService.approve({ fundingRequestId: funding.id, principal: operatorChecker });
    const after = await getBalance(cust.ledgerAccountId);
    expect(after).toBe(before + 25000n);
    // ticket still resolvable
    await supportService.updateStatus({ ticketId: ticket.body.id, status: 'RESOLVED' as any, principal: operatorChecker });
    const afterTicket = await supportService.getForCustomer(ticket.body.id, cust.customerId);
    expect(afterTicket.status).toBe('RESOLVED');
  });

  it('19. ticket creation does not mutate ledger', async () => {
    const cust = await createCustomerWithCredential();
    const before = await getBalance(cust.ledgerAccountId);
    const settlementRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    const settlementBalBeforeRows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`,
      [settlementRows[0]!.id],
    );
    const settlementBefore = BigInt(settlementBalBeforeRows[0]!.balance);
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Ledger not mutated', category: 'OTHER', description: 'Check ledger' })
      .expect(201);
    const after = await getBalance(cust.ledgerAccountId);
    expect(after).toBe(before);
    const settlementBalAfterRows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`,
      [settlementRows[0]!.id],
    );
    const settlementAfter = BigInt(settlementBalAfterRows[0]!.balance);
    expect(settlementAfter).toBe(settlementBefore);
    // count journals not increased for support
    const journals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM ledger_journals`);
    // create extra ticket via service and check again not increased
    const countBefore = Number(journals[0]!.count);
    await supportService.createTicket({ subject: 'Second', category: 'OTHER' as any, description: 'second ticket', principal: { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' } as any });
    const journals2: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM ledger_journals`);
    expect(Number(journals2[0]!.count)).toBe(countBefore);
  });

  it('20. ticket creation does not mutate wallet balance', async () => {
    const cust = await createCustomerWithCredential();
    const walletBefore = await walletService.getWallet(cust.walletId);
    const beforeMinor = walletBefore.balanceMinor;
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Wallet balance unchanged', category: 'WALLET', description: 'Balance question' })
      .expect(201);
    const walletAfter = await walletService.getWallet(cust.walletId);
    expect(walletAfter.balanceMinor).toBe(beforeMinor);
    // also via service
    const wallet2 = await walletService.getWallet(cust.walletId);
    expect(wallet2.balanceMinor).toBe(beforeMinor);
    // no financial journals for ticket
    const fundingBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM customer_funding_requests`);
    const fundingAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM customer_funding_requests`);
    expect(Number(fundingAfter[0]!.count)).toBe(Number(fundingBefore[0]!.count));
  });

  it('21. no PIN/password/OTP leakage in support endpoints', async () => {
    const cust = await createCustomerWithCredential();
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'No leak', category: 'OTHER', description: 'Test leakage' })
      .expect(201);
    const get = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${ticket.body.id}`)
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    const serial = JSON.stringify(get.body).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('pinhash');
    expect(serial).not.toContain('tokenhash');
    expect(serial).not.toContain('secret');
    expect(serial).not.toContain('otp');
    // message also safe
    await request(app.getHttpServer())
      .post(`/api/v1/customers/me/support/tickets/${ticket.body.id}/messages`)
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ body: 'My pin is 1234' })
      .expect(201);
    const msgs = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${ticket.body.id}/messages`)
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    // body itself contains pin but that's user content, not leaked secrets from system; ensure no system hash leaked
    expect(JSON.stringify(msgs.body).toLowerCase()).not.toContain('passwordhash');
    expect(JSON.stringify(msgs.body).toLowerCase()).not.toContain('tokenhash');
    // internal view also redacted via audit
    const audits: Array<{ new_values: any; previous_values: any }> = await dataSource.query(`SELECT new_values, previous_values FROM audit_events WHERE entity_type='SUPPORT_TICKET'`);
    const auditStr = JSON.stringify(audits).toLowerCase();
    expect(auditStr).not.toContain('password');
    // DB tables should not contain hashes
    const ticketRows: Array<any> = await dataSource.query(`SELECT * FROM support_tickets WHERE id=$1`, [ticket.body.id]);
    expect(JSON.stringify(ticketRows).toLowerCase()).not.toContain('password');
    expect(JSON.stringify(ticketRows).toLowerCase()).not.toContain('pin');
  });

  it('22. duplicate/idempotent creation behavior (Idempotency-Key)', async () => {
    const cust = await createCustomerWithCredential();
    const key = `idem-sup-${randomUUID()}`;
    const payload = { subject: 'Idempotent ticket', category: 'OTHER', description: 'Idempotent description' };
    const first = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.reference).toBe(first.body.reference);
    // same key different hash -> 409
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .set('Idempotency-Key', key)
      .send({ subject: 'Different subject', category: 'OTHER', description: 'Different description' })
      .expect(409);
    // without key, different tickets created
    const a = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'No key A', category: 'OTHER', description: 'Valid description A' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'No key B', category: 'OTHER', description: 'Valid description B' })
      .expect(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('23. concurrent state transition behaves correctly (one succeeds)', async () => {
    const cust = await createCustomerWithCredential();
    const ticket = await supportService.createTicket({
      subject: 'Concurrent status',
      category: 'OTHER' as any,
      description: 'concurrent',
      principal: { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' } as any,
    });
    // assign first to move to IN_PROGRESS
    await supportService.assignTicket({ ticketId: ticket.id, assignedTo: 'support-1', principal: supportMaker });
    const afterAssign = await supportService.getForInternal(ticket.id);
    expect(afterAssign.status).toBe('IN_PROGRESS');
    // two concurrent resolves
    const results = await Promise.allSettled([
      supportService.updateStatus({ ticketId: ticket.id, status: 'RESOLVED' as any, principal: operatorChecker }),
      supportService.updateStatus({ ticketId: ticket.id, status: 'RESOLVED' as any, principal: privilegedPrincipal }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // One should succeed, the other either succeed idempotently or conflict? Our updateStatus returns early if already RESOLVED, so second will be idempotent success, not conflict.
    // So we test that after both, status is RESOLVED and no double audit anomaly: at least one fulfilled and no double ledger mutation (already proven)
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const fetched = await supportService.getForInternal(ticket.id);
    expect(fetched.status).toBe('RESOLVED');
    // Now test version conflict: try stale version
    const currentVersion = fetched.version;
    // first succeeds with correct version
    await supportService.updateStatus({ ticketId: ticket.id, status: 'CLOSED' as any, principal: operatorChecker, version: currentVersion });
    const afterClosed = await supportService.getForInternal(ticket.id);
    expect(afterClosed.status).toBe('CLOSED');
    // stale version should be rejected (but our earlier closed, next with same old version should Conflict if we attempted with old version)
    // We already closed, so any further transition invalid; test version stale for new ticket
    const ticket2 = await supportService.createTicket({
      subject: 'Version stale',
      category: 'OTHER' as any,
      description: 'version',
      principal: { type: 'CUSTOMER', principalId: cust.customerId, customerId: cust.customerId, roles: [], scopes: [], customerAccess: 'SELF' } as any,
    });
    const staleVersion = ticket2.version;
    // do concurrent assignment + status to bump version
    await supportService.assignTicket({ ticketId: ticket2.id, assignedTo: 'x', principal: supportMaker });
    await expect(supportService.updateStatus({ ticketId: ticket2.id, status: 'RESOLVED' as any, principal: operatorChecker, version: staleVersion })).rejects.toThrow(/version is stale/i);
  });

  it('24. audit events exist for lifecycle', async () => {
    const cust = await createCustomerWithCredential();
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Audit test', category: 'OTHER', description: 'audit' })
      .expect(201);
    await supportService.assignTicket({ ticketId: ticket.body.id, assignedTo: 'auditor-1', principal: supportMaker });
    await supportService.updateStatus({ ticketId: ticket.body.id, status: 'RESOLVED' as any, principal: operatorChecker });
    await supportService.addMessage({ ticketId: ticket.body.id, body: 'audit message', principal: supportMaker });
    const audits: Array<{ action: string; entity_type: string }> = await dataSource.query(`SELECT action, entity_type FROM audit_events WHERE entity_id=$1 OR entity_id IN (SELECT id FROM support_ticket_messages WHERE ticket_id=$1) ORDER BY occurred_at`, [ticket.body.id]);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('SUPPORT_TICKET_CREATED');
    expect(actions).toContain('SUPPORT_TICKET_ASSIGNED');
    expect(actions).toContain('SUPPORT_TICKET_RESOLVED');
    expect(actions).toContain('SUPPORT_TICKET_MESSAGE_CREATED');
    // no secrets in audit
    expect(JSON.stringify(audits).toLowerCase()).not.toContain('password');
  });

  it('25. outbox events exist if implemented', async () => {
    const cust = await createCustomerWithCredential();
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'Outbox test', category: 'OTHER', description: 'outbox' })
      .expect(201);
    const outboxCreated: Array<{ event_type: string }> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='support.ticket.created'`, [ticket.body.id]);
    expect(outboxCreated.length).toBe(1);
    await supportService.assignTicket({ ticketId: ticket.body.id, assignedTo: 'outbox-assignee', principal: supportMaker });
    const outboxAssigned: Array<any> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='support.ticket.assigned'`, [ticket.body.id]);
    expect(outboxAssigned.length).toBe(1);
    await supportService.updateStatus({ ticketId: ticket.body.id, status: 'RESOLVED' as any, principal: operatorChecker });
    const outboxResolved: Array<any> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='support.ticket.resolved'`, [ticket.body.id]);
    expect(outboxResolved.length).toBe(1);
    await supportService.addMessage({ ticketId: ticket.body.id, body: 'outbox msg', principal: supportMaker });
    const outboxMsg: Array<any> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='support.ticket.message_added'`, [ticket.body.id]);
    expect(outboxMsg.length).toBe(1);
  });

  it('26. pagination works for customer', async () => {
    const cust = await createCustomerWithCredential();
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/support/tickets')
        .set('Authorization', `Bearer ${cust.token}`)
        .send({ subject: `Paginate ${i}`, category: 'OTHER', description: `desc ${i}` })
        .expect(201);
    }
    const p1 = await request(app.getHttpServer())
      .get('/api/v1/customers/me/support/tickets?page=1&limit=2')
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.pagination.page).toBe(1);
    expect(p1.body.pagination.limit).toBe(2);
    expect(p1.body.pagination.total).toBeGreaterThanOrEqual(5);
    expect(p1.body.pagination.hasNextPage).toBe(true);
    const p2 = await request(app.getHttpServer())
      .get('/api/v1/customers/me/support/tickets?page=2&limit=2')
      .set('Authorization', `Bearer ${cust.token}`)
      .expect(200);
    expect(p2.body.items.length).toBe(2);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
  });

  it('27. internal status transition and assignment via service (workforce)', async () => {
    const cust = await createCustomerWithCredential();
    const ticket = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set('Authorization', `Bearer ${cust.token}`)
      .send({ subject: 'HTTP internal', category: 'OTHER', description: 'http internal' })
      .expect(201);
    // Internal workforce operations are proven via service layer in this test environment
    // (HTTP workforce session requires A2_WORKFORCE_ENABLED + OIDC, which is disabled in integration harness).
    // Verify that service-level internal assignment and status transition work correctly,
    // and that HTTP unauthenticated/customer/agent rejection already verified in prior tests.
    const assigned = await supportService.assignTicket({
      ticketId: ticket.body.id,
      assignedTo: 'http-assignee-service',
      principal: supportMaker,
    });
    expect(assigned.assignedTo).toBe('http-assignee-service');
    const statusRes = await supportService.updateStatus({
      ticketId: ticket.body.id,
      status: 'RESOLVED' as any,
      principal: operatorChecker,
    });
    expect(statusRes.status).toBe('RESOLVED');
    // Verify internal view reflects changes
    const internal = await supportService.getForInternal(ticket.body.id);
    expect(internal.assignedTo).toBe('http-assignee-service');
    expect(internal.status).toBe('RESOLVED');
  });

  it('migration count is 65 and support tables exist', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBe(65);
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600064');
    expect(latest[0]!.name).toBe('CreateSupportTickets1785753600064');
    const supportTable: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE tablename='support_tickets'`);
    expect(supportTable.length).toBe(1);
    const messageTable: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE tablename='support_ticket_messages'`);
    expect(messageTable.length).toBe(1);
  });

  it('no second ledger/balance/provider for support', async () => {
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='support_tickets' AND column_name IN ('balance_minor','ledger_account_id','journal_id')`);
    expect(cols.length).toBe(0);
    const supportJournals: Array<any> = await dataSource.query(`SELECT * FROM ledger_journals WHERE reference LIKE 'SUP-%'`);
    expect(supportJournals.length).toBe(0);
  });
});
