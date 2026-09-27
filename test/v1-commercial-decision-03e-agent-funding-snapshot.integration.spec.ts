/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING commercial snapshot wiring
 * (real PostgreSQL). Completes commercial capture for all SEVEN V1 financial products.
 *
 * Both operations run through AgentFundingService's single shared SERIALIZABLE boundary with
 * direction-driven identities:
 *   - AGENT_FUNDING:   pool DEBIT → Agent wallet CREDIT, AGENT / INCOMING
 *   - AGENT_DEFUNDING: Agent wallet DEBIT → pool CREDIT, AGENT / OUTGOING (no overdraft)
 * Each snapshot is recorded inside that same transaction via resolveWithManager +
 * recordDecisionWithManager (never recordDecision, never async). The pool/wallet accounting
 * is untouched: no new ledger accounts, no second journal, no second balance.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AgentFundingService } from '../src/agent/agent-funding.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('V1-COMMERCIAL-DECISION-03E AGENT_FUNDING/DEFUNDING snapshot wiring (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fundingService: AgentFundingService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let walletService: WalletService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let poolAccountId: string;

  const privilegedPrincipal: any = {
    type: 'PRIVILEGED',
    principalId: `priv-03e-${randomUUID().slice(0, 6)}`,
    roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
  };

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    jwksJson: [],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-comm-decision-03e');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    fundingService = moduleRef.get(AgentFundingService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    walletService = moduleRef.get(WalletService);
    feeRuleRegistry = moduleRef.get(FeeRuleRegistryService);
    await moduleRef.get(ProductCatalogSeedService).seedIfEmpty();

    const poolRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN' LIMIT 1`);
    expect(poolRows.length).toBe(1); // migration-seeded pool — never recreated by this task
    poolAccountId = poolRows[0].id;
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  // ── harness (mirrors a19 conventions) ──

  async function createActiveAgent(): Promise<{ agentId: string; walletLedgerId: string }> {
    const cls = await classService.create({
      reference: `cls-03e-${randomUUID().slice(0, 8)}`,
      code: `C03E-${randomUUID().slice(0, 6)}`,
      name: '03E Class',
      isActive: true,
      applicableServices: ['AGENT_FUNDING', 'AGENT_DEFUNDING'] as any,
      applicableLimits: {} as any,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz 03E ${randomUUID().slice(0, 4)}`,
      contactEmail: `03e-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-03e',
    });
    await appService.submit(appEntity.id, 'applicant-03e');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    const wallet = await walletService.createWallet({ customerId: agent.id, currency: 'NGN', idempotencyKey: `03e-wallet-${agent.id}-${randomUUID()}` });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    return { agentId: agent.id, walletLedgerId: rows[0].ledger_account_id };
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance
         FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0].balance);
  }

  async function seedAgentLimitProfile(code: string, agentId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,'AGENT','ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'AGENT',$3,NULL,0,$4,NULL,true,'test')`,
      [randomUUID(), code, agentId, new Date(Date.now() - 86400000).toISOString()],
    );
  }

  async function seedAgentLimitRule(profileCode: string, product: string, dimension: string, limitMinor: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,NULL,NULL,'NGN',$4,$5,NULL,$6,NULL,true,'test')`,
      [id, profileCode, product, dimension, limitMinor, new Date(Date.now() - 86400000).toISOString()],
    );
    return id;
  }

  async function snapshotsFor(key: { journalId?: string; idempotencyKey?: string; product?: string; principalId?: string }): Promise<any[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (key.journalId) { params.push(key.journalId); clauses.push(`journal_id = $${params.length}`); }
    if (key.idempotencyKey) { params.push(key.idempotencyKey); clauses.push(`idempotency_key = $${params.length}`); }
    if (key.product) { params.push(key.product); clauses.push(`product = $${params.length}`); }
    if (key.principalId) { params.push(key.principalId); clauses.push(`principal_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return dataSource.query(`SELECT * FROM commercial_decision_snapshots ${where}`, params);
  }

  // ════════════════════ AGENT_FUNDING ════════════════════

  it('01. successful funding creates exactly one FINAL snapshot (AGENT INCOMING) with authoritative limit evidence; pool→wallet accounting unchanged', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    const profile = `P03E_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedAgentLimitProfile(profile, agentId);
    const dailyRule = await seedAgentLimitRule(profile, 'AGENT_FUNDING', 'DAILY_AMOUNT', '9000000');

    const agentBefore = await balanceOf(walletLedgerId);
    const poolBefore = await balanceOf(poolAccountId);
    const idem = `c03e-01-${randomUUID()}`;
    const res = await fundingService.fund({
      agentId, amountMinor: '30000', currency: 'NGN', idempotencyKey: idem,
      principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(res.status).toBe('COMPLETED');

    // accounting UNCHANGED: DEBIT pool (liability decreases), CREDIT Agent wallet
    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [res.journalId],
    );
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.direction === 'DEBIT');
    const credit = lines.find((l) => l.direction === 'CREDIT');
    expect(debit.amount_minor).toBe('30000');
    expect(debit.ledger_account_id).toBe(poolAccountId);
    expect(credit.amount_minor).toBe('30000');
    expect(credit.ledger_account_id).toBe(walletLedgerId);
    expect(await balanceOf(walletLedgerId)).toBe(agentBefore + 30000n);
    expect(await balanceOf(poolAccountId)).toBe(poolBefore - 30000n);

    // exactly one snapshot describing the funding
    const snapshots = await snapshotsFor({ journalId: res.journalId });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.product).toBe('AGENT_FUNDING'); // canonical identity
    expect(snap.transaction_reference).toBe(res.journalId);
    expect(snap.journal_id).toBe(res.journalId);
    expect(snap.idempotency_key).toBe(`agent-funding:${agentId}:${idem}`);
    expect(snap.principal_type).toBe('AGENT');
    expect(snap.principal_id).toBe(agentId);
    expect(snap.direction).toBe('INCOMING');
    expect(snap.currency).toBe('NGN');
    expect(snap.principal_amount_minor.toString()).toBe('30000');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.created_by).toBe('agent-funding');
    expect(snap.revenue_decision).toBeNull();
    expect(snap.configuration_version).toBeNull();
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.feeMinor).toBe('0');
    expect(snap.fee_decision.totalMinor).toBe('30000');
    expect(snap.fee_decision.ruleRefs).toEqual([]);
    expect(snap.fee_decision.agentId).toBe(agentId);
    expect(snap.fee_decision.aggregatorId).toBeNull();
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    expect(snap.limit_decision.ruleRefs.map((r: any) => r.ruleId)).toEqual([dailyRule]);
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [idem]);
    expect(reservations.length).toBe(1);
    expect(snap.limit_decision.reservationIds).toEqual(reservations.map((r) => r.id));
    expect(snap.limit_decision.usageIds).toEqual(reservations.map((r) => r.limit_usage_id));

    // workforce diagnostic read API lists it
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?product=AGENT_FUNDING')
      .set('Authorization', 'Bearer workforce-operator')
      .expect(200);
    const items = Array.isArray(list.body) ? list.body : list.body.data ?? [];
    expect(items.some((s: any) => (s.transactionReference ?? s.transaction_reference) === res.journalId)).toBe(true);
  });

  it('02. funding replay: REPLAYED, same journal, exactly ONE snapshot, credited once', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    const idem = `c03e-02-${randomUUID()}`;
    const payload = { agentId, amountMinor: '15000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' };
    const first = await fundingService.fund(payload);
    expect(first.status).toBe('COMPLETED');
    const journalsAfterFirst: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);

    const replay = await fundingService.fund({ ...payload });
    expect(replay.replayed).toBe(true);
    expect(replay.journalId).toBe(first.journalId);

    expect(await snapshotsFor({ journalId: first.journalId })).toHaveLength(1); // NOT duplicated
    const journalsAfterReplay: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterReplay[0].cnt).toBe(journalsAfterFirst[0].cnt);
    expect(await balanceOf(walletLedgerId)).toBe(15000n); // credited once
  });

  it('03. funding key clash: same key different payload rejected (409), snapshot count unchanged', async () => {
    const { agentId } = await createActiveAgent();
    const idem = `c03e-03-${randomUUID()}`;
    const first = await fundingService.fund({ agentId, amountMinor: '10000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' });
    expect(first.status).toBe('COMPLETED');
    await expect(
      fundingService.fund({ agentId, amountMinor: '10001', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshotsFor({ idempotencyKey: `agent-funding:${agentId}:${idem}` })).toHaveLength(1);
  });

  it('04. funding rollback: forced failure after snapshot rolls back everything; clean retry succeeds exactly once', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    const profile = `P03E_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedAgentLimitProfile(profile, agentId);
    await seedAgentLimitRule(profile, 'AGENT_FUNDING', 'DAILY_AMOUNT', '9000000');

    const journalsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    const poolBefore = await balanceOf(poolAccountId);
    const idem = `c03e-04-${randomUUID()}`;

    await expect(
      fundingService.fund({
        agentId, amountMinor: '25000', currency: 'NGN', idempotencyKey: idem,
        principal: privilegedPrincipal, actor: 'test-actor',
        _simulateFailureAfterJournal: true, // fails AFTER snapshot, BEFORE commit
      }),
    ).rejects.toThrow('Simulated failure after journal');

    expect(await snapshotsFor({ idempotencyKey: `agent-funding:${agentId}:${idem}` })).toHaveLength(0); // snapshot gone
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='AGENT_FUNDING'`, [agentId])).length).toBe(0);
    const journalsAfterFail: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterFail[0].cnt).toBe(journalsBefore[0].cnt); // journal gone
    expect(await balanceOf(walletLedgerId)).toBe(0n); // balance unchanged
    expect(await balanceOf(poolAccountId)).toBe(poolBefore);
    expect((await dataSource.query(`SELECT id FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`, [`agent-funding.v1:${agentId}`, idem])).length).toBe(0);

    // clean retry — no stranded side effects
    const retry = await fundingService.fund({ agentId, amountMinor: '25000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' });
    expect(retry.status).toBe('COMPLETED');
    expect(await snapshotsFor({ idempotencyKey: `agent-funding:${agentId}:${idem}` })).toHaveLength(1); // exactly one
    expect(await balanceOf(walletLedgerId)).toBe(25000n);
  });

  it('05. funding limit rejection: 422, no snapshot, no stranded reservation, no mutation', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    const profile = `P03E_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedAgentLimitProfile(profile, agentId);
    await seedAgentLimitRule(profile, 'AGENT_FUNDING', 'DAILY_AMOUNT', '20000'); // tighter than requested

    const poolBefore = await balanceOf(poolAccountId);
    const idem = `c03e-05-${randomUUID()}`;
    await expect(
      fundingService.fund({ agentId, amountMinor: '30000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await snapshotsFor({ idempotencyKey: `agent-funding:${agentId}:${idem}` })).toHaveLength(0);
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect(await balanceOf(walletLedgerId)).toBe(0n);
    expect(await balanceOf(poolAccountId)).toBe(poolBefore);
  });

  // ════════════════════ AGENT_DEFUNDING ════════════════════

  it('06. successful defunding creates exactly one FINAL snapshot (AGENT OUTGOING); wallet→pool accounting unchanged', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    await fundingService.fund({ agentId, amountMinor: '50000', currency: 'NGN', idempotencyKey: `c03e-06-seed-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });

    const profile = `P03E_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedAgentLimitProfile(profile, agentId);
    const dailyRule = await seedAgentLimitRule(profile, 'AGENT_DEFUNDING', 'DAILY_AMOUNT', '9000000');

    const poolBefore = await balanceOf(poolAccountId);
    const idem = `c03e-06-${randomUUID()}`;
    const res = await fundingService.defund({
      agentId, amountMinor: '18000', currency: 'NGN', idempotencyKey: idem,
      principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(res.status).toBe('COMPLETED');

    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [res.journalId],
    );
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.direction === 'DEBIT');
    const credit = lines.find((l) => l.direction === 'CREDIT');
    expect(debit.amount_minor).toBe('18000');
    expect(debit.ledger_account_id).toBe(walletLedgerId); // Agent wallet DEBIT
    expect(credit.amount_minor).toBe('18000');
    expect(credit.ledger_account_id).toBe(poolAccountId); // pool CREDIT
    expect(await balanceOf(walletLedgerId)).toBe(32000n); // 50000 − 18000
    expect(await balanceOf(poolAccountId)).toBe(poolBefore + 18000n);

    const snapshots = await snapshotsFor({ journalId: res.journalId });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.product).toBe('AGENT_DEFUNDING'); // canonical identity
    expect(snap.idempotency_key).toBe(`agent-defunding:${agentId}:${idem}`);
    expect(snap.principal_type).toBe('AGENT');
    expect(snap.principal_id).toBe(agentId);
    expect(snap.direction).toBe('OUTGOING');
    expect(snap.principal_amount_minor.toString()).toBe('18000');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.created_by).toBe('agent-defunding');
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.ruleRefs).toEqual([]);
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    expect(snap.limit_decision.ruleRefs.map((r: any) => r.ruleId)).toEqual([dailyRule]);
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [idem]);
    expect(reservations.length).toBe(1);
    expect(snap.limit_decision.reservationIds).toEqual(reservations.map((r) => r.id));
    expect(snap.limit_decision.usageIds).toEqual(reservations.map((r) => r.limit_usage_id));
    // the earlier funding snapshot remains separate and untouched
    expect(await snapshotsFor({ product: 'AGENT_FUNDING', principalId: agentId })).toHaveLength(1);
  });

  it('07. defunding replay + key clash: REPLAYED converges; conflicting payload rejected; one snapshot', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    await fundingService.fund({ agentId, amountMinor: '40000', currency: 'NGN', idempotencyKey: `c03e-07-seed-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });

    const idem = `c03e-07-${randomUUID()}`;
    const payload = { agentId, amountMinor: '9000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' };
    const first = await fundingService.defund(payload);
    expect(first.status).toBe('COMPLETED');
    const replay = await fundingService.defund({ ...payload });
    expect(replay.replayed).toBe(true);
    expect(replay.journalId).toBe(first.journalId);
    expect(await snapshotsFor({ journalId: first.journalId })).toHaveLength(1); // NOT duplicated
    expect(await balanceOf(walletLedgerId)).toBe(31000n); // debited once

    await expect(
      fundingService.defund({ ...payload, amountMinor: '9001' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshotsFor({ idempotencyKey: `agent-defunding:${agentId}:${idem}` })).toHaveLength(1);
  });

  it('08. defunding rollback: forced failure after snapshot rolls back everything; clean retry succeeds exactly once', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    await fundingService.fund({ agentId, amountMinor: '60000', currency: 'NGN', idempotencyKey: `c03e-08-seed-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });

    const journalsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    const poolBefore = await balanceOf(poolAccountId);
    const idem = `c03e-08-${randomUUID()}`;

    await expect(
      fundingService.defund({
        agentId, amountMinor: '20000', currency: 'NGN', idempotencyKey: idem,
        principal: privilegedPrincipal, actor: 'test-actor',
        _simulateFailureAfterJournal: true, // fails AFTER snapshot, BEFORE commit
      }),
    ).rejects.toThrow('Simulated failure after journal');

    expect(await snapshotsFor({ idempotencyKey: `agent-defunding:${agentId}:${idem}` })).toHaveLength(0); // snapshot gone
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='AGENT_DEFUNDING'`, [agentId])).length).toBe(0);
    const journalsAfterFail: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterFail[0].cnt).toBe(journalsBefore[0].cnt);
    expect(await balanceOf(walletLedgerId)).toBe(60000n); // unchanged
    expect(await balanceOf(poolAccountId)).toBe(poolBefore);

    const retry = await fundingService.defund({ agentId, amountMinor: '20000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' });
    expect(retry.status).toBe('COMPLETED');
    expect(await snapshotsFor({ idempotencyKey: `agent-defunding:${agentId}:${idem}` })).toHaveLength(1); // exactly one
    expect(await balanceOf(walletLedgerId)).toBe(40000n);
  });

  it('09. defunding limit rejection + no-overdraft: 422s, no snapshot, no stranded reservation, balance never negative', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    await fundingService.fund({ agentId, amountMinor: '25000', currency: 'NGN', idempotencyKey: `c03e-09-seed-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });

    // (a) limit rejection first
    const profile = `P03E_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedAgentLimitProfile(profile, agentId);
    await seedAgentLimitRule(profile, 'AGENT_DEFUNDING', 'DAILY_AMOUNT', '10000'); // tighter than attempted
    const idemLimit = `c03e-09a-${randomUUID()}`;
    await expect(
      fundingService.defund({ agentId, amountMinor: '15000', currency: 'NGN', idempotencyKey: idemLimit, principal: privilegedPrincipal, actor: 'test-actor' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await snapshotsFor({ idempotencyKey: `agent-defunding:${agentId}:${idemLimit}` })).toHaveLength(0);
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idemLimit])).length).toBe(0);

    // (b) overdraft rejection (beyond balance) — existing ledger protection unchanged
    const idemOver = `c03e-09b-${randomUUID()}`;
    await expect(
      fundingService.defund({ agentId, amountMinor: '25001', currency: 'NGN', idempotencyKey: idemOver, principal: privilegedPrincipal, actor: 'test-actor' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await snapshotsFor({ idempotencyKey: `agent-defunding:${agentId}:${idemOver}` })).toHaveLength(0);

    expect(await balanceOf(walletLedgerId)).toBe(25000n); // untouched by both rejections
    expect(await snapshotsFor({ product: 'AGENT_DEFUNDING', principalId: agentId })).toHaveLength(0);
  });

  // ════════════════════ CONCURRENCY + CROSS-CUTTING ════════════════════

  it('10. concurrent identical funding converges: ONE financial operation, ONE original snapshot', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    const idem = `c03e-10-${randomUUID()}`;
    const payload = { agentId, amountMinor: '12000', currency: 'NGN', idempotencyKey: idem, principal: privilegedPrincipal, actor: 'test-actor' };

    const settled = await Promise.allSettled([
      fundingService.fund({ ...payload }),
      fundingService.fund({ ...payload }),
      fundingService.fund({ ...payload }),
      fundingService.fund({ ...payload }),
    ]);
    // fulfilled outcomes must be COMPLETED or REPLAYED (any rejection is a benign conflict/serialization
    // failure — the invariants below are what actually matter)
    for (const r of settled) {
      if (r.status === 'fulfilled') expect(['COMPLETED', 'REPLAYED']).toContain(r.value.status);
    }
    const completed = settled.filter((r) => r.status === 'fulfilled' && r.value.status === 'COMPLETED');
    expect(completed).toHaveLength(1); // exactly one original success

    expect(await snapshotsFor({ idempotencyKey: `agent-funding:${agentId}:${idem}` })).toHaveLength(1); // ONE original snapshot
    const journals: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text AS cnt FROM ledger_journals j WHERE EXISTS (SELECT 1 FROM ledger_lines l WHERE l.journal_id=j.id AND l.ledger_account_id=$1)`,
      [walletLedgerId],
    );
    expect(journals[0].cnt).toBe('1'); // ONE financial operation
    expect(await balanceOf(walletLedgerId)).toBe(12000n); // credited exactly once
  });

  it('11. concurrent defunding respects balance: no overdraft, no duplicate snapshots, successes match balance exactly', async () => {
    const { agentId, walletLedgerId } = await createActiveAgent();
    await fundingService.fund({ agentId, amountMinor: '50000', currency: 'NGN', idempotencyKey: `c03e-11-seed-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });

    const keys = [1, 2, 3, 4].map(() => `c03e-11-${randomUUID()}`);
    const settled = await Promise.allSettled(
      keys.map((k) => fundingService.defund({ agentId, amountMinor: '20000', currency: 'NGN', idempotencyKey: k, principal: privilegedPrincipal, actor: 'test-actor' })),
    );
    const succeeded = settled.filter((r) => r.status === 'fulfilled').length;
    const rejected = settled.filter((r) => r.status === 'rejected').length;
    expect(succeeded + rejected).toBe(4);
    expect(succeeded).toBeGreaterThanOrEqual(1);
    expect(succeeded).toBeLessThanOrEqual(2); // 50000 / 20000 → at most 2 can succeed

    const snaps = await snapshotsFor({ product: 'AGENT_DEFUNDING', principalId: agentId });
    expect(snaps).toHaveLength(succeeded); // one snapshot per successful defunding — no duplicates
    const finalBalance = await balanceOf(walletLedgerId);
    expect(finalBalance).toBe(BigInt(50000 - succeeded * 20000)); // conservation, never negative
    expect(finalBalance >= 0n).toBe(true);
  });

  it('12. TEST-ONLY synthetic fee rules: both flows capture ruleId/version/parameters without charging; zero production rules beforehand', async () => {
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM fee_rules`);
    expect(before[0].cnt).toBe('0'); // NO production fee rules exist

    const fundRule = await feeRuleRegistry.createRule(
      {
        productCode: 'AGENT_FUNDING', currency: 'NGN',
        flatFeeMinor: '100', percentageBps: 5,
        minimumFeeMinor: null, maximumFeeMinor: null, vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000), priority: 0, isActive: true,
      },
      'test',
    );
    const defundRule = await feeRuleRegistry.createRule(
      {
        productCode: 'AGENT_DEFUNDING', currency: 'NGN',
        flatFeeMinor: '150', percentageBps: 8,
        minimumFeeMinor: null, maximumFeeMinor: null, vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000), priority: 0, isActive: true,
      },
      'test',
    );

    const { agentId, walletLedgerId } = await createActiveAgent();
    const fund = await fundingService.fund({ agentId, amountMinor: '18000', currency: 'NGN', idempotencyKey: `c03e-12f-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });
    const defund = await fundingService.defund({ agentId, amountMinor: '7000', currency: 'NGN', idempotencyKey: `c03e-12d-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });

    const fundSnaps = await snapshotsFor({ journalId: fund.journalId });
    expect(fundSnaps).toHaveLength(1);
    const ff = fundSnaps[0].fee_decision;
    expect(ff.status).toBe('NOT_CONFIGURED'); // still NOT_CONFIGURED — charging not enabled
    expect(ff.feeMinor).toBe('0');
    expect(ff.totalMinor).toBe('18000');
    expect(ff.ruleRefs).toHaveLength(1);
    expect(ff.ruleRefs[0].ruleId).toBe(fundRule.id);
    expect(ff.ruleRefs[0].ruleVersion).toBe(1);
    expect(ff.ruleRefs[0].flatFeeMinor).toBe('100');
    expect(ff.ruleRefs[0].percentageBps).toBe(5);

    const defundSnaps = await snapshotsFor({ journalId: defund.journalId });
    expect(defundSnaps).toHaveLength(1);
    const df = defundSnaps[0].fee_decision;
    expect(df.status).toBe('NOT_CONFIGURED');
    expect(df.feeMinor).toBe('0');
    expect(df.totalMinor).toBe('7000');
    expect(df.ruleRefs).toHaveLength(1);
    expect(df.ruleRefs[0].ruleId).toBe(defundRule.id);
    expect(df.ruleRefs[0].flatFeeMinor).toBe('150');
    expect(df.ruleRefs[0].percentageBps).toBe(8);

    // money flow UNCHANGED: principal-only journals, exact balances
    for (const [journalId, expected] of [[fund.journalId, '18000'], [defund.journalId, '7000']] as Array<[string, string]>) {
      const lines: Array<any> = await dataSource.query(`SELECT amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`, [journalId]);
      expect(lines).toHaveLength(2);
      for (const l of lines) expect(l.amount_minor).toBe(expected);
    }
    expect(await balanceOf(walletLedgerId)).toBe(11000n); // 18000 − 7000, principal only
  });

  it('13. both snapshots immutable + exact wiring boundary + canonical product identities', async () => {
    const { agentId } = await createActiveAgent();
    const fund = await fundingService.fund({ agentId, amountMinor: '8000', currency: 'NGN', idempotencyKey: `c03e-13f-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });
    const defund = await fundingService.defund({ agentId, amountMinor: '3000', currency: 'NGN', idempotencyKey: `c03e-13d-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor' });
    const fundSnap = (await snapshotsFor({ journalId: fund.journalId }))[0];
    const defundSnap = (await snapshotsFor({ journalId: defund.journalId }))[0];
    for (const snap of [fundSnap, defundSnap]) {
      await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET product='X' WHERE id=$1`, [snap.id])).rejects.toThrow(
        /commercial_decision_snapshots is immutable/,
      );
      await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snap.id])).rejects.toThrow(
        /commercial_decision_snapshots is immutable/,
      );
    }

    // wiring boundary
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const fundingSource = readFileSync(join(__dirname, '../src/agent/agent-funding.service.ts'), 'utf8');
    expect(fundingSource).toContain('resolveWithManager'); // read-only resolution inside the tx
    expect(fundingSource).toContain('recordDecisionWithManager'); // snapshot joins the SAME tx
    expect(fundingSource).not.toMatch(/\.recordDecision\(/); // never the second-transaction variant
    expect(fundingSource).not.toContain('feeEngine'); // no FeeEngine participation
    expect(fundingSource).toContain(`isFund ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING'`); // canonical identities only
    // no invented product variants in the catalogue
    const products: Array<{ code: string }> = await dataSource.query(`SELECT code FROM products WHERE code LIKE 'AGENT_FUNDING%' OR code LIKE 'AGENT_DEFUNDING%' OR code LIKE 'AGENT_FLOAT%'`);
    expect(products.map((p) => p.code).sort()).toEqual(['AGENT_DEFUNDING', 'AGENT_FUNDING']);
    // the shared agent execution gate remains exactly the two cash flows (no accidental scope creep)
    const executionSource = readFileSync(join(__dirname, '../src/agent/agent-financial-execution.service.ts'), 'utf8');
    expect(executionSource).toContain(`['CASH_TO_WALLET', 'WALLET_TO_CASH']`);
  });
});
