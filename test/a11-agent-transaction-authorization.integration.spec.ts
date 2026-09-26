/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unnecessary-type-assertion */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentTransactionAuthorizationService } from '../src/agent/agent-transaction-authorization.service';
import { AgentServiceCapabilityService } from '../src/agent/agent-service-capability.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('A11 Agent transaction authorization (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let authzService: AgentTransactionAuthorizationService;
  let capabilityService: AgentServiceCapabilityService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a11authz');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authzService = moduleRef.get(AgentTransactionAuthorizationService);
    capabilityService = moduleRef.get(AgentServiceCapabilityService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60_000);

  async function createActiveAgentWithServicesAndPin(
    services: unknown,
    pin: string | null,
    isActive = true,
  ) {
    const cls = await classService.create({
      reference: `cls-a11-${randomUUID().slice(0, 8)}`,
      code: `A11-${randomUUID().slice(0, 6)}`,
      name: 'A11 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A11 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a11-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a11',
    });
    await appService.submit(appEntity.id, 'applicant-a11');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    if (pin !== null) {
      await pinService.setTransactionPin(agent.id, {
        pinHash: hashPin(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agent.id,
      });
    }
    return { cls, agent, appEntity };
  }

  function agentPrincipal(agentId: string) {
    return { type: 'AGENT', agentId, principalId: agentId, roles: [], scopes: [], customerAccess: 'NONE' as const, agentAccess: 'SELF' as const };
  }

  // A. valid authenticated Agent + permitted service + valid PIN → AUTHORIZED
  it('A. valid authenticated Agent + permitted service + valid PIN → AUTHORIZED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(true);
    expect(res.decision).toBe('AUTHORIZED');
    expect(res.canonicalService).toBe(AgentService.CASH_IN);
    expect(res.context).toBeDefined();
    expect(res.context!.agentId).toBe(agent.id);
    expect(res.context!.canonicalService).toBe(AgentService.CASH_IN);
    // context must not contain secrets (check properties, not random UUID substring)
    expect((res.context as any).pin).toBeUndefined();
    expect((res.context as any).pinHash).toBeUndefined();
    expect((res.context as any).pin_hash).toBeUndefined();
    const ctxSerial = JSON.stringify(res.context);
    expect(ctxSerial.toLowerCase()).not.toContain('pinhash');
    expect(ctxSerial.toLowerCase()).not.toContain('pin_hash');
  });

  // B. valid Agent + permitted service + invalid PIN → DENIED
  it('B. valid Agent + permitted service + invalid PIN → DENIED (PIN_INVALID)', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '9999',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(['PIN_INVALID', 'MISMATCH']).toContain(res.reason);
  });

  // C. valid Agent + permitted service + locked PIN → DENIED
  it('C. valid Agent + permitted service + locked PIN → DENIED (PIN_LOCKED)', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const principal = agentPrincipal(agent.id);
    // 5 failed attempts to lock
    for (let i = 0; i < 5; i++) {
      const r = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '9999', principal });
      expect(r.allowed).toBe(false);
    }
    // now even correct PIN should be locked
    const locked = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    expect(locked.allowed).toBe(false);
    expect(locked.reason).toBe('PIN_LOCKED');
  });

  // D. valid Agent + unpermitted service → DENIED (SERVICE_NOT_PERMITTED) regardless of PIN
  it('D. valid Agent + unpermitted service → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_OUT,
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('SERVICE_NOT_PERMITTED');
  });

  // E. PENDING Agent → DENIED
  it('E. PENDING Agent → DENIED', async () => {
    const cls = await classService.create({
      reference: `cls-pend-a11-${randomUUID().slice(0, 6)}`,
      code: `PEND-A11-${randomUUID().slice(0, 6)}`,
      name: 'Pend A11',
      isActive: true,
      applicableServices: [AgentService.CASH_IN],
      actor: 'test-actor',
    });
    const pendingId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'PENDING',$3,1)`, [pendingId, `pend-a11-${randomUUID()}`, cls.id]);
    // set PIN directly via DB hash (need credential-like but we can use service after inserting agent)
    await pinService.setTransactionPin(pendingId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: pendingId,
    });
    const res = await authzService.authorize({
      agentId: pendingId,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(pendingId),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_PENDING');
  });

  // F. SUSPENDED Agent → DENIED
  it('F. SUSPENDED Agent → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await lifecycleService.suspend(agent.id, 'test-actor');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_SUSPENDED');
  });

  // G. TERMINATED Agent → DENIED
  it('G. TERMINATED Agent → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await lifecycleService.terminate(agent.id, 'test-actor');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_TERMINATED');
  });

  // H. deleted Agent → DENIED
  it('H. deleted Agent → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await dataSource.query(`UPDATE agents SET deleted_at=NOW() WHERE id=$1`, [agent.id]);
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(['AGENT_NOT_FOUND', 'AGENT_DELETED']).toContain(res.reason);
  });

  // I. wrong Agent principal ID → DENIED
  it('I. wrong Agent principal ID → DENIED (PRINCIPAL_MISMATCH)', async () => {
    const { agent: agentA } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const { agent: agentB } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const res = await authzService.authorize({
      agentId: agentB.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agentA.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('PRINCIPAL_MISMATCH');
  });

  // J. CUSTOMER principal → DENIED
  it('J. CUSTOMER principal → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const custPrincipal: any = { type: 'CUSTOMER', customerId: randomUUID(), principalId: randomUUID(), roles: [], scopes: [], customerAccess: 'SELF' };
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: custPrincipal,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('PRINCIPAL_NOT_AGENT');
  });

  // K. workforce principal → DENIED
  it('K. workforce principal → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    for (const type of ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const workforcePrincipal: any = { type, principalId: 'workforce-1', roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE' };
      const res = await authzService.authorize({
        agentId: agent.id,
        service: AgentService.CASH_IN,
        pin: '1234',
        principal: workforcePrincipal,
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('WORKFORCE_NOT_PERMITTED');
    }
  });

  // L. missing PIN → DENIED
  it('L. missing PIN → DENIED (PIN_REQUIRED)', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const resUndefined = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      principal: agentPrincipal(agent.id),
    });
    expect(resUndefined.allowed).toBe(false);
    expect(resUndefined.reason).toBe('PIN_REQUIRED');

    const resEmpty = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '',
      principal: agentPrincipal(agent.id),
    });
    expect(resEmpty.allowed).toBe(false);
    expect(resEmpty.reason).toBe('PIN_REQUIRED');
  });

  // M. unknown service → DENIED
  it('M. unknown service → DENIED', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: 'UNKNOWN_SERVICE_XYZ',
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('UNKNOWN_SERVICE');
  });

  // N. inactive AgentClass → DENIED
  it('N. inactive AgentClass → DENIED', async () => {
    const { agent, cls } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await classService.update(cls.id, { isActive: false, actor: 'test-actor' });
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('AGENT_CLASS_INACTIVE');
  });

  // O. missing AgentClass → DENIED
  it('O. missing AgentClass → DENIED', async () => {
    const agentId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'ACTIVE',NULL,1)`, [agentId, `o-a11-${randomUUID()}`]);
    await pinService.setTransactionPin(agentId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agentId,
    });
    const res = await authzService.authorize({
      agentId,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agentId),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('MISSING_AGENT_CLASS');
  });

  // P. repeated valid authorization is deterministic
  it('P. repeated valid authorization is deterministic', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN, AgentService.AGENT_FUNDING], '1234');
    const principal = agentPrincipal(agent.id);
    const r1 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    const r2 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r1.decision).toBe(r2.decision);
    expect(r1.reason).toBe(r2.reason);
    expect(r1.canonicalService).toBe(r2.canonicalService);
    // also deterministic for denied
    const d1 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_OUT, pin: '1234', principal });
    const d2 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_OUT, pin: '1234', principal });
    expect(d1.allowed).toBe(false);
    expect(d2.allowed).toBe(false);
    expect(d1.reason).toBe(d2.reason);
  });

  // Q. failed PIN does not create any financial side effect
  it('Q. failed PIN does not create any financial side effect', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const walletBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const journalBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const lineBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    const customerBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '9999', principal: agentPrincipal(agent.id) });
    const walletAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const journalAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const lineAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    const customerAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    expect(walletAfter[0]!.cnt).toBe(walletBefore[0]!.cnt);
    expect(journalAfter[0]!.cnt).toBe(journalBefore[0]!.cnt);
    expect(lineAfter[0]!.cnt).toBe(lineBefore[0]!.cnt);
    expect(customerAfter[0]!.cnt).toBe(customerBefore[0]!.cnt);
  });

  // R. successful authorization does not create wallet/ledger/customer/balance
  it('R. successful authorization does not create wallet/ledger/customer/balance', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const walletBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const journalBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const lineBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    const custBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal: agentPrincipal(agent.id) });
    const walletAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const journalAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const lineAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    const custAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    expect(walletAfter[0]!.cnt).toBe(walletBefore[0]!.cnt);
    expect(journalAfter[0]!.cnt).toBe(journalBefore[0]!.cnt);
    expect(lineAfter[0]!.cnt).toBe(lineBefore[0]!.cnt);
    expect(custAfter[0]!.cnt).toBe(custBefore[0]!.cnt);
    // also check no balance column side effect (just ensure no wallet created for agent reference)
    const custRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM customers WHERE reference=$1`, [agent.reference]);
    expect(custRows.length).toBe(0);
  });

  // S. Agent A cannot authorize a transaction for Agent B
  it('S. Agent A cannot authorize a transaction for Agent B', async () => {
    const { agent: agentA } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const { agent: agentB } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const res = await authzService.authorize({
      agentId: agentB.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agentA.id),
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('PRINCIPAL_MISMATCH');
    // correct principal succeeds
    const res2 = await authzService.authorize({
      agentId: agentB.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agentB.id),
    });
    expect(res2.allowed).toBe(true);
  });

  // T. capability configuration change is respected
  it('T. capability configuration change is respected', async () => {
    const { agent, cls } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const principal = agentPrincipal(agent.id);
    const r1 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    expect(r1.allowed).toBe(true);
    const r2 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_OUT, pin: '1234', principal });
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toBe('SERVICE_NOT_PERMITTED');

    await classService.update(cls.id, { applicableServices: [AgentService.CASH_IN, AgentService.CASH_OUT], actor: 'test-actor' });
    const r3 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_OUT, pin: '1234', principal });
    expect(r3.allowed).toBe(true);

    await classService.update(cls.id, { applicableServices: [AgentService.CASH_OUT], actor: 'test-actor' });
    const r4 = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    expect(r4.allowed).toBe(false);
    expect(r4.reason).toBe('SERVICE_NOT_PERMITTED');
  });

  // U. PIN lockout remains enforced according to existing PIN policy
  it('U. PIN lockout remains enforced according to the existing PIN policy', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const principal = agentPrincipal(agent.id);
    // Ensure initially valid
    const ok = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    expect(ok.allowed).toBe(true);

    // 5 consecutive invalid → lock
    for (let i = 0; i < 5; i++) {
      const fail = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '0000', principal });
      expect(fail.allowed).toBe(false);
    }
    const locked = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal });
    expect(locked.allowed).toBe(false);
    expect(locked.reason).toBe('PIN_LOCKED');

    // verify via direct Pin entity
    const pinRow: Array<{ failed_count: number; account_locked: boolean }> = await dataSource.query(
      `SELECT failed_count, account_locked FROM agent_transaction_pins WHERE agent_id=$1`,
      [agent.id],
    );
    expect(pinRow[0]!.account_locked).toBe(true);
    expect(pinRow[0]!.failed_count).toBeGreaterThanOrEqual(5);
  });

  // Additional security: ensure no ADMIN bypass, terminated etc already covered
  it('security: unauthenticated, unknown service, terminated, suspended, inactive, invalid PIN all denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    // unauthenticated
    const unauth = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal: undefined });
    expect(unauth.allowed).toBe(false);
    expect(unauth.reason).toBe('UNAUTHENTICATED');

    // unknown service
    const unk = await authzService.authorize({ agentId: agent.id, service: 'BILLS_PAYMENT', pin: '1234', principal: agentPrincipal(agent.id) });
    expect(unk.allowed).toBe(false);
    expect(unk.reason).toBe('UNKNOWN_SERVICE');

    // terminated
    await lifecycleService.terminate(agent.id, 'test-actor');
    const term = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal: agentPrincipal(agent.id) });
    expect(term.allowed).toBe(false);
    expect(term.reason).toBe('AGENT_TERMINATED');
  });

  it('security: PIN does not leak in result, audit does not contain PIN', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '4321');
    const res = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '4321',
      principal: agentPrincipal(agent.id),
    });
    expect(res.allowed).toBe(true);
    expect((res as any).pin).toBeUndefined();
    expect((res as any).pinHash).toBeUndefined();
    const serial = JSON.stringify(res);
    expect(serial.toLowerCase()).not.toContain('pinhash');
    expect(serial.toLowerCase()).not.toContain('pin_hash');

    // audit rows must not contain PIN
    const audits: Array<{ new_values: unknown }> = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='AGENT_TRANSACTION_AUTHORIZATION' ORDER BY occurred_at DESC LIMIT 5`,
    );
    const auditSerial = JSON.stringify(audits);
    expect(auditSerial.toLowerCase()).not.toContain('pinhash');
    expect(auditSerial.toLowerCase()).not.toContain('pin_hash');
    // ensure no pin property in audit payload
    for (const row of audits) {
      const v = row.new_values as any;
      if (v) {
        expect(v.pin).toBeUndefined();
        expect(v.pinHash).toBeUndefined();
      }
    }
  });

  it('alias handling: CASH_TO_WALLET → CASH_IN via capability', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const alias = await authzService.authorize({
      agentId: agent.id,
      service: 'CASH_TO_WALLET',
      pin: '1234',
      principal: agentPrincipal(agent.id),
    });
    expect(alias.allowed).toBe(true);
    expect(alias.canonicalService).toBe(AgentService.CASH_IN);
  });
});
