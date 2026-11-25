/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import * as request from 'supertest';

import type {
  AgentLimitProductView,
  AgentLimitWindowView,
} from '../src/agent/agent-limit-view.service';
import { AppModule } from '../src/app.module';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';

function encodePbkdf2(password: string, saltStr = 'v1alv-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * V1-AGENT-LIMITS-VIEW-01 — GET /agents/me/limits (agent-safe projection of the
 * authoritative limit-catalog system), mirroring the customer precedent
 * (V1-CUSTOMER-08, test/v1-customer-08-limits-view.integration.spec.ts).
 *
 * These tests exercise the REAL LimitProfileResolverService / limit_rules / limit_usages
 * tables and the REAL LimitEnforcementService (the exact enforcement path used by the
 * agent cash-in/cash-out/C2C/funding/bank-transfer flows), never a parallel or mocked
 * calculation — a passing test is direct evidence that the agent-facing projection
 * matches backend-authoritative state, including AGENT and AGENT_CLASS subject
 * assignments (class-level configuration propagating to the agent's view).
 */
const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

describe('V1-AGENT-LIMITS-VIEW-01 Agent Limits View (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1alv01');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createAgentClass(services: string[] = ['CASH_IN', 'CASH_OUT']): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-v1alv-${randomUUID().slice(0, 8)}`,
        `ALV-${randomUUID().slice(0, 6)}`,
        'V1ALV Class',
        JSON.stringify(services),
        JSON.stringify({}),
      ],
    );
    return rows[0]!.id;
  }

  async function createAgentWithSession(
    agentClassId: string,
  ): Promise<{ agentId: string; token: string }> {
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-v1alv-${randomUUID()}`, agentClassId],
    );
    const agentId = agentRows[0]!.id;
    const receivingNumber = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO agent_receiving_numbers (agent_id, receiving_number, status) VALUES ($1,$2,'ACTIVE')`,
      [agentId, receivingNumber],
    );
    const password = 'correct-password-v1alv';
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, encodePbkdf2(password)],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password })
      .expect(200);
    return { agentId, token: login.body.accessToken as string };
  }

  async function createProfile(
    kind: string,
    subject: { type: 'GLOBAL' | 'AGENT' | 'AGENT_CLASS'; id?: string | null; precedence?: number },
    rules: Array<{
      product: string;
      direction?: string | null;
      dimension: string;
      limitValueMinor?: string | null;
      limitValueCount?: number | null;
    }>,
  ): Promise<string> {
    const code = `PROF_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, '_')}`;
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,$3,'ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`, kind],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, is_active, created_by) VALUES ($1,$2,$3,$4,NULL,$5,NOW(),true,'test')`,
      [randomUUID(), code, subject.type, subject.id ?? null, subject.precedence ?? 0],
    );
    for (const r of rules) {
      await dataSource.query(
        `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, is_active, created_by)
         VALUES ($1,$2,$3,$4,NULL,'NGN',$5,$6,$7,NOW(),true,'test')`,
        [
          randomUUID(),
          code,
          r.product,
          r.direction ?? null,
          r.dimension,
          r.limitValueMinor ?? null,
          r.limitValueCount ?? null,
        ],
      );
    }
    return code;
  }

  // The exact product/direction pairs the projection must carry — one entry per
  // AGENT-principal enforceWithManager call site documented in agent-limit-view.service.ts.
  const EXPECTED_PAIRS = [
    ['CASH_TO_WALLET', 'OUTGOING'],
    ['WALLET_TO_CASH', 'INCOMING'],
    ['CASH_TO_CASH', 'OUTGOING'],
    ['CASH_TO_CASH', 'INCOMING'],
    ['WALLET_TRANSFER', 'OUTGOING'],
    ['WALLET_TRANSFER', 'INCOMING'],
    ['AGENT_FUNDING', 'INCOMING'],
    ['AGENT_DEFUNDING', 'OUTGOING'],
    // PR #27: the agent wallet→bank route is reported under the canonical catalogue product. The
    // seeded rules below still carry the legacy `EXTERNAL_BANK_TRANSFER` alias, so this pair is also
    // the live proof that alias matching works end to end.
    ['WALLET_TO_BANK', 'OUTGOING'],
  ] as const;

  it('1. Unauthenticated request is rejected (401) — backend remains authoritative, not client-trusted', async () => {
    await request(app.getHttpServer()).get('/api/v1/agents/me/limits').expect(401);
  });

  it('2. No limit profile/assignment configured — returns every agent product pair as unconfigured, never fabricates a limit', async () => {
    const classId = await createAgentClass();
    const { agentId, token } = await createAgentWithSession(classId);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.agentId).toBe(agentId);
    expect(res.body.currency).toBe('NGN');
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBe(EXPECTED_PAIRS.length);
    const pairs = (res.body.products as AgentLimitProductView[])
      .map((p) => [p.product, p.direction] as const)
      .sort();
    expect(pairs).toEqual([...EXPECTED_PAIRS].sort());
    for (const p of res.body.products) {
      expect(p.configured).toBe(false);
      expect(p.windows).toEqual([]);
      expect(p.perTransactionMinMinor).toBeNull();
      expect(p.perTransactionMaxMinor).toBeNull();
    }
  });

  it('3. AGENT-subject assignment configures exactly its product/direction pair; other buckets stay isolated', async () => {
    const classId = await createAgentClass();
    const { agentId, token } = await createAgentWithSession(classId);
    await createProfile('AGENT', { type: 'AGENT', id: agentId, precedence: 10 }, [
      {
        product: 'CASH_TO_WALLET',
        direction: 'OUTGOING',
        dimension: 'MAX_AMOUNT_PER_TX',
        limitValueMinor: '500000',
      },
      {
        product: 'CASH_TO_WALLET',
        direction: 'OUTGOING',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '1000000',
      },
      {
        product: 'CASH_TO_WALLET',
        direction: 'OUTGOING',
        dimension: 'DAILY_COUNT',
        limitValueCount: 10,
      },
    ]);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const cashIn = (res.body.products as AgentLimitProductView[]).find(
      (p) => p.product === 'CASH_TO_WALLET' && p.direction === 'OUTGOING',
    )!;
    expect(cashIn.configured).toBe(true);
    expect(cashIn.perTransactionMaxMinor).toBe('500000');
    const dailyAmount = cashIn.windows.find(
      (w: AgentLimitWindowView) => w.dimension === 'DAILY_AMOUNT',
    )!;
    expect(dailyAmount.limitMinor).toBe('1000000');
    expect(dailyAmount.usedMinor).toBe('0');
    expect(dailyAmount.remainingMinor).toBe('1000000');
    expect(dailyAmount.period).toBe('DAILY');
    expect(new Date(dailyAmount.windowResetsAt).getTime()).toBeGreaterThan(Date.now());
    const dailyCount = cashIn.windows.find(
      (w: AgentLimitWindowView) => w.dimension === 'DAILY_COUNT',
    )!;
    expect(dailyCount.limitCount).toBe(10);
    expect(dailyCount.remainingCount).toBe(10);
    // The customer-side CASH_TO_WALLET INCOMING bucket is not an agent product at all,
    // and every other agent bucket remains unconfigured.
    expect(
      (res.body.products as AgentLimitProductView[]).filter(
        (p) => p.product === 'CASH_TO_WALLET' && p.direction === 'INCOMING',
      ),
    ).toEqual([]);
    for (const p of res.body.products as AgentLimitProductView[]) {
      if (p.product === 'CASH_TO_WALLET') continue;
      expect(p.configured).toBe(false);
    }
  });

  it('4. AGENT_CLASS-subject assignment propagates to every agent of that class (administrator class configuration is visible)', async () => {
    const classId = await createAgentClass();
    const a = await createAgentWithSession(classId);
    const b = await createAgentWithSession(classId);
    await createProfile('AGENT', { type: 'AGENT_CLASS', id: classId, precedence: 5 }, [
      {
        product: 'WALLET_TO_CASH',
        direction: 'INCOMING',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '2000000',
      },
    ]);
    for (const agent of [a, b]) {
      const res = await request(app.getHttpServer())
        .get('/api/v1/agents/me/limits')
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);
      const cashOut = (res.body.products as AgentLimitProductView[]).find(
        (p) => p.product === 'WALLET_TO_CASH' && p.direction === 'INCOMING',
      )!;
      expect(cashOut.configured).toBe(true);
      expect(cashOut.windows[0]!.limitMinor).toBe('2000000');
    }
  });

  it('5. After a real enforceWithManager reservation + commit, used/remaining reflect the committed amount exactly (same engine as the financial flows)', async () => {
    const classId = await createAgentClass(['CASH_IN', 'EXTERNAL_BANK_TRANSFER']);
    const { agentId, token } = await createAgentWithSession(classId);
    await createProfile('AGENT', { type: 'AGENT', id: agentId, precedence: 10 }, [
      {
        product: 'EXTERNAL_BANK_TRANSFER',
        direction: 'OUTGOING',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '1000000',
      },
    ]);

    const enforcement = app.get(LimitEnforcementService);
    const idempotencyKey = `v1alv-${randomUUID()}`;
    await dataSource.transaction(async (manager) => {
      const result = await enforcement.enforceWithManager(manager, {
        principalType: 'AGENT',
        principalId: agentId,
        agentClassId: classId,
        // The canonical product the runtime passes; the rule rows above are stored under the
        // legacy alias and must still be selected.
        product: 'WALLET_TO_BANK',
        currency: 'NGN',
        direction: 'OUTGOING',
        channel: null,
        amountMinor: '300000',
        idempotencyKey,
        requestHash: createHash('sha256').update('v1alv-test-5').digest('hex'),
      });
      expect(result.allowed).toBe(true);
      await enforcement.commitReservationsWithManager(manager, idempotencyKey);
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Reported under the canonical product, resolved from rules stored under the legacy alias.
    const bank = (res.body.products as AgentLimitProductView[]).find(
      (p) => p.product === 'WALLET_TO_BANK',
    )!;
    const dailyAmount = bank.windows.find(
      (w: AgentLimitWindowView) => w.dimension === 'DAILY_AMOUNT',
    )!;
    expect(dailyAmount.usedMinor).toBe('300000');
    expect(dailyAmount.remainingMinor).toBe('700000');
  });

  it('5b. A RESERVED (not yet committed) amount still reduces displayed remaining — matches enforcement semantics for in-flight operations', async () => {
    const classId = await createAgentClass(['CASH_IN', 'EXTERNAL_BANK_TRANSFER']);
    const { agentId, token } = await createAgentWithSession(classId);
    await createProfile('AGENT', { type: 'AGENT', id: agentId, precedence: 10 }, [
      {
        product: 'EXTERNAL_BANK_TRANSFER',
        direction: 'OUTGOING',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '1000000',
      },
    ]);
    const enforcement = app.get(LimitEnforcementService);
    await dataSource.transaction(async (manager) => {
      const result = await enforcement.enforceWithManager(manager, {
        principalType: 'AGENT',
        principalId: agentId,
        agentClassId: classId,
        // The canonical product the runtime passes; the rule rows above are stored under the
        // legacy alias and must still be selected.
        product: 'WALLET_TO_BANK',
        currency: 'NGN',
        direction: 'OUTGOING',
        channel: null,
        amountMinor: '200000',
        idempotencyKey: `v1alv-${randomUUID()}`,
        requestHash: createHash('sha256').update('v1alv-test-5b').digest('hex'),
      });
      expect(result.allowed).toBe(true);
      // Deliberately do NOT commit — simulates an in-flight financial operation.
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Reported under the canonical product, resolved from rules stored under the legacy alias.
    const bank = (res.body.products as AgentLimitProductView[]).find(
      (p) => p.product === 'WALLET_TO_BANK',
    )!;
    const dailyAmount = bank.windows.find(
      (w: AgentLimitWindowView) => w.dimension === 'DAILY_AMOUNT',
    )!;
    expect(dailyAmount.usedMinor).toBe('0');
    expect(dailyAmount.remainingMinor).toBe('800000'); // 1,000,000 - 0 used - 200,000 reserved
  });

  it("6. Each agent sees only their own AGENT-scoped assignment, never another agent's (SELF-only, no :id parameter)", async () => {
    const classId = await createAgentClass();
    const a = await createAgentWithSession(classId);
    const b = await createAgentWithSession(classId);
    await createProfile('AGENT', { type: 'AGENT', id: a.agentId, precedence: 10 }, [
      {
        product: 'CASH_TO_CASH',
        direction: 'OUTGOING',
        dimension: 'MAX_AMOUNT_PER_TX',
        limitValueMinor: '50000',
      },
    ]);
    const resA = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200);
    const c2cA = (resA.body.products as AgentLimitProductView[]).find(
      (p) => p.product === 'CASH_TO_CASH' && p.direction === 'OUTGOING',
    )!;
    const c2cB = (resB.body.products as AgentLimitProductView[]).find(
      (p) => p.product === 'CASH_TO_CASH' && p.direction === 'OUTGOING',
    )!;
    expect(c2cA.configured).toBe(true);
    expect(c2cA.perTransactionMaxMinor).toBe('50000');
    expect(c2cB.configured).toBe(false);
    expect(resB.body.agentId).toBe(b.agentId);
  });

  it('7. Response never leaks internal policy identifiers (profile code, assignment id, rule id, channel, created_by, priority)', async () => {
    const classId = await createAgentClass();
    const { agentId, token } = await createAgentWithSession(classId);
    await createProfile('AGENT', { type: 'AGENT', id: agentId, precedence: 10 }, [
      {
        product: 'AGENT_FUNDING',
        direction: 'INCOMING',
        dimension: 'DAILY_AMOUNT',
        limitValueMinor: '1000000',
      },
    ]);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const serial = JSON.stringify(res.body).toLowerCase();
    expect(serial).not.toContain('prof_');
    expect(serial).not.toContain('assignmentid');
    expect(serial).not.toContain('ruleid');
    expect(serial).not.toContain('createdby');
    expect(serial).not.toContain('priority');
    expect(serial).not.toContain('precedence');
    expect(serial).not.toContain('channel');
    expect(serial).not.toContain('ledgeraccount');
  });

  it('8. Route policy resolves GET /agents/me/limits as AGENT SELF (no workforce, no cross-agent access)', async () => {
    const { RoutePolicyRegistry } = await import('../src/authorization/route-policy-registry');
    const registry = new RoutePolicyRegistry();
    const resolved = registry.resolve({ method: 'GET', url: '/api/v1/agents/me/limits' });
    expect(resolved.policy?.allowedPrincipalTypes).toEqual(['AGENT']);
    expect(resolved.policy?.agentAccess).toBe('SELF');
  });

  it('9. A soft-deleted agent gets no projection (401), while an active agent keeps its own view', async () => {
    const classId = await createAgentClass();
    const deleted = await createAgentWithSession(classId);
    const active = await createAgentWithSession(classId);
    await dataSource.query(`UPDATE agents SET deleted_at=NOW() WHERE id=$1`, [deleted.agentId]);
    // Session validation itself rejects non-ACTIVE/deleted agents (Mission 15A) — the
    // limits view adds no bypass.
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${deleted.token}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${active.token}`)
      .expect(200);
  });

  it('10. A suspended agent session is rejected — limit reads are not a suspension bypass', async () => {
    const classId = await createAgentClass();
    const { agentId, token } = await createAgentWithSession(classId);
    await dataSource.query(`UPDATE agents SET status='SUSPENDED' WHERE id=$1`, [agentId]);
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
