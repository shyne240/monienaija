/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-DECISION-03B — WALLET_TO_CASH commercial snapshot wiring (real PostgreSQL).
 *
 * Extends the proven WALLET_TRANSFER (02) / CASH_TO_WALLET (03A) pilot pattern to exactly
 * ONE more flow: WALLET_TO_CASH (Customer wallet DEBIT → Agent electronic value CREDIT;
 * physical cash stays outside the electronic ledger) via AgentFinancialExecutionService's
 * existing SERIALIZABLE boundary. The full Customer PIN → OTP → Agent capability
 * authorization chain runs through the real services (authorization regression).
 *
 * Verified here:
 *   - success atomicity: ledger + limit state + snapshot commit together; exactly one snapshot
 *   - rollback atomicity: forced downstream failure after the snapshot rolls everything back
 *   - idempotent replay never duplicates the snapshot; key/payload clash still rejected
 *   - fee decision NOT_CONFIGURED (never ZERO); commission/reward NONE; revenue null
 *   - authoritative live limit evidence (profile, rule ids, reservation ids, usage ids)
 *   - limit rejection → rejected transfer, no snapshot, no stranded reservation
 *   - synthetic TEST-ONLY fee rule captured as evidence without charging anything
 *   - snapshot immutability; financial behavior unchanged
 *
 * NO production fee rules are seeded: the synthetic rule exists only in the disposable
 * per-process test database.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentFinancialExecutionService } from '../src/agent/agent-financial-execution.service';
import { AgentTransactionAuthorizationService } from '../src/agent/agent-transaction-authorization.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('V1-COMMERCIAL-DECISION-03B WALLET_TO_CASH snapshot wiring (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashOutService: AgentCashOutService;
  let financialService: AgentFinancialExecutionService;
  let authzService: AgentTransactionAuthorizationService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let customerPinService: CustomerTransactionPinService;
  let mfaService: MfaExecutionService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let systemLedgerAccountId: string;

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
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-comm-decision-03b');
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
    cashOutService = moduleRef.get(AgentCashOutService);
    financialService = moduleRef.get(AgentFinancialExecutionService);
    authzService = moduleRef.get(AgentTransactionAuthorizationService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
    customerPinService = moduleRef.get(CustomerTransactionPinService);
    mfaService = moduleRef.get(MfaExecutionService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    feeRuleRegistry = moduleRef.get(FeeRuleRegistryService);
    await moduleRef.get(ProductCatalogSeedService).seedIfEmpty();

    const sys = await ledgerService.createAccount({
      code: `SYS-FLOAT-NGN-${randomUUID().slice(0, 6)}`,
      name: 'System Float NGN',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    systemLedgerAccountId = sys.id;
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  // ── harness (synthetic test data only; mirrors the a14 conventions) ──

  async function createActiveAgentWithServicesAndPin(services: unknown, pin: string | null, isActive = true) {
    const cls = await classService.create({
      reference: `cls-03b-${randomUUID().slice(0, 8)}`,
      code: `C03B-${randomUUID().slice(0, 6)}`,
      name: '03B Class',
      isActive,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz 03B ${randomUUID().slice(0, 4)}`,
      contactEmail: `03b-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-03b',
    });
    await appService.submit(appEntity.id, 'applicant-03b');
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
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    return { cls, agent, appEntity, wallet };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      agentId,
      principalId: agentId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
  }

  async function createCustomerWithPhoneAndPin(phoneCanonical: string, pin: string) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-03b-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0].id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer 03B',true)`, [customerId]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phoneCanonical]);
    await customerPinService.setTransactionPin(customerId, {
      pinHash: hashPin(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  async function createMfaChallenge(customerId: string, otp: string, ttlSeconds = 300) {
    let enrollmentId: string;
    let methodId: string;
    const enrollRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM mfa_enrollments WHERE customer_id=$1 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
      [customerId],
    );
    if (enrollRows[0]) {
      enrollmentId = enrollRows[0].id;
      const methodRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM mfa_methods WHERE enrollment_id=$1 AND customer_id=$2 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
        [enrollmentId, customerId],
      );
      if (methodRows[0]) {
        methodId = methodRows[0].id;
      } else {
        const mRows: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
          [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
        );
        methodId = mRows[0].id;
      }
    } else {
      const eRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
      );
      enrollmentId = eRows[0].id;
      const mRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
      );
      methodId = mRows[0].id;
    }
    const credentialRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 LIMIT 1`,
      [customerId],
    );
    let credentialId = credentialRows[0]?.id;
    if (!credentialId) {
      const cRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
        [randomUUID(), customerId],
      );
      credentialId = cRows[0].id;
    }
    const sessionId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');
    await dataSource.query(
      `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
      [sessionId, customerId, credentialId, tokenHash],
    ).catch(() => {});
    const principal: any = {
      principalType: 'CUSTOMER',
      customerId,
      credentialId,
      sessionId,
    };
    const challenge = await mfaService.issueChallenge({
      principal,
      enrollmentId,
      methodId,
      challengeHash: otp,
      ttlSeconds,
      actor: customerId,
    } as any);
    return { challengeId: (challenge as any).id ?? (challenge as any).challengeId, otp };
  }

  async function fundCustomer(customerWalletLedgerId: string, amount: string) {
    await ledgerService.postJournal({
      idempotencyKey: `fund-cust-${customerWalletLedgerId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: customerWalletLedgerId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  function newPhone(): string {
    return `80${Math.floor(10000000 + Math.random() * 89999999)}`;
  }

  async function seedLimitProfile(code: string, customerId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,'CUSTOMER','ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'CUSTOMER',$3,NULL,0,$4,NULL,true,'test')`,
      [randomUUID(), code, customerId, new Date(Date.now() - 86400000).toISOString()],
    );
  }

  async function seedLimitRule(profileCode: string, dimension: string, limitMinor: string | null, limitCount: number | null): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'WALLET_TO_CASH',NULL,NULL,'NGN',$3,$4,$5,$6,NULL,true,'test')`,
      [id, profileCode, dimension, limitMinor, limitCount, new Date(Date.now() - 86400000).toISOString()],
    );
    return id;
  }

  async function snapshotsFor(key: { journalId?: string; idempotencyKey?: string; product?: string }): Promise<any[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (key.journalId) {
      params.push(key.journalId);
      clauses.push(`journal_id = $${params.length}`);
    }
    if (key.idempotencyKey) {
      params.push(key.idempotencyKey);
      clauses.push(`idempotency_key = $${params.length}`);
    }
    if (key.product) {
      params.push(key.product);
      clauses.push(`product = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return dataSource.query(`SELECT * FROM commercial_decision_snapshots ${where}`, params);
  }

  // ── 1. success atomicity + snapshot content ──

  it('01. successful WALLET_TO_CASH creates exactly one FINAL snapshot with authoritative limit evidence', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '100000');

    const profile = `P03B_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, customerId);
    const minRule = await seedLimitRule(profile, 'MIN_AMOUNT_PER_TX', '1000', null);
    const dailyRule = await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000', null);

    const otp = 'c03b-otp-01';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const idem = `c03b-01-${randomUUID()}`;
    const result = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: idem,
    });
    expect(result.status).toBe('COMPLETED');

    const snapshots = await snapshotsFor({ journalId: result.journalId });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.product).toBe('WALLET_TO_CASH');
    expect(snap.transaction_reference).toBe(result.journalId); // the exact transaction identity
    expect(snap.journal_id).toBe(result.journalId);
    expect(snap.idempotency_key).toBe(`cash-out:${agent.id}:${idem}`);
    expect(snap.principal_type).toBe('CUSTOMER'); // the limit subject (paying customer)
    expect(snap.principal_id).toBe(customerId);
    expect(snap.currency).toBe('NGN');
    expect(snap.principal_amount_minor.toString()).toBe('30000');
    expect(snap.direction).toBe('OUTGOING');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.decided_at).toBeDefined();
    expect(snap.finalized_at).toBeDefined();
    expect(snap.created_by).toBe('agent-cash-out');
    expect(snap.revenue_decision).toBeNull();
    expect(snap.configuration_version).toBeNull();

    // fee NOT_CONFIGURED (never ZERO), commission/reward NONE, acting agent captured as evidence
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.feeMinor).toBe('0');
    expect(snap.fee_decision.vatMinor).toBe('0');
    expect(snap.fee_decision.totalMinor).toBe('30000');
    expect(snap.fee_decision.ruleRefs).toEqual([]);
    expect(snap.fee_decision.agentId).toBe(agent.id);
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });

    // limit decision = the AUTHORITATIVE live enforcement outcome
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    const ruleIds = snap.limit_decision.ruleRefs.map((r: any) => r.ruleId).sort();
    expect(ruleIds).toEqual([minRule, dailyRule].sort());
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id, status FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [idem]);
    expect(reservations.length).toBe(1); // DAILY_AMOUNT only
    expect(snap.limit_decision.reservationIds).toEqual(reservations.map((r) => r.id));
    expect(snap.limit_decision.usageIds).toEqual(reservations.map((r) => r.limit_usage_id));

    // workforce diagnostic read API verifies it (no duplicate APIs created)
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?product=WALLET_TO_CASH')
      .set('Authorization', 'Bearer workforce-operator')
      .expect(200);
    const items = Array.isArray(list.body) ? list.body : list.body.data ?? [];
    expect(items.some((s: any) => (s.transactionReference ?? s.transaction_reference) === result.journalId)).toBe(true);
  });

  // ── 2. zero-fee financial proof ──

  it('02. financial behavior identical: principal-only journal, Customer debit + Agent credit, no fee/revenue accounts', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '80000');

    const accountsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_accounts`);
    const agentBefore = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);

    const otp = 'c03b-otp-02';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const result = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '22000',
      currency: 'NGN',
      idempotencyKey: `c03b-02-${randomUUID()}`,
    });
    expect(result.status).toBe('COMPLETED');

    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [result.journalId],
    );
    expect(lines).toHaveLength(2); // principal movement only — no fee/revenue/commission/reward lines
    const debit = lines.find((l) => l.direction === 'DEBIT');
    const credit = lines.find((l) => l.direction === 'CREDIT');
    expect(debit.amount_minor).toBe('22000');
    expect(debit.ledger_account_id).toBe(custWallet.ledgerAccountId); // Customer wallet DEBIT unchanged
    expect(credit.amount_minor).toBe('22000');
    expect(credit.ledger_account_id).toBe(agentWallet.ledgerAccountId); // Agent electronic value CREDIT unchanged

    const accountsAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_accounts`);
    expect(accountsAfter[0].cnt).toBe(accountsBefore[0].cnt); // no physical-cash/fee/revenue account created
    const agentAfter = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custAfter = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentAfter.balanceMinor).toBe((BigInt(agentBefore.balanceMinor) + 22000n).toString());
    expect(custAfter.balanceMinor).toBe((BigInt(custBefore.balanceMinor) - 22000n).toString());
  });

  // ── 3. replay + idempotency conflict ──

  it('03. identical replay converges: REPLAYED status, same journal, exactly ONE snapshot, no double movement', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '60000');

    const otp = 'c03b-otp-03';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const idem = `c03b-03-${randomUUID()}`;
    const payload = {
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '15000',
      currency: 'NGN',
      idempotencyKey: idem,
    };
    const first = await cashOutService.execute(payload);
    expect(first.status).toBe('COMPLETED');
    const journalsAfterFirst: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);

    // Genuine idempotent retry: same challengeId+otp → OTP layer reports REPLAYED, which the
    // service permits ONLY because the financial idempotency record is already COMPLETED.
    const replay = await cashOutService.execute({ ...payload });
    expect(replay.replayed).toBe(true);
    expect(replay.journalId).toBe(first.journalId);

    expect(await snapshotsFor({ journalId: first.journalId })).toHaveLength(1); // NOT duplicated
    const journalsAfterReplay: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterReplay[0].cnt).toBe(journalsAfterFirst[0].cnt); // no duplicate ledger transaction
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe('45000'); // debited once
  });

  it('04. same idempotency key with a different payload remains rejected (409)', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '60000');

    const idem = `c03b-04-${randomUUID()}`;
    const otp1 = 'c03b-otp-04a';
    const { challengeId: challenge1 } = await createMfaChallenge(customerId, otp1);
    const base = {
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      currency: 'NGN',
      idempotencyKey: idem,
    };
    const first = await cashOutService.execute({ ...base, mfaChallengeId: challenge1, otp: otp1, amountMinor: '10000' });
    expect(first.status).toBe('COMPLETED');

    const otp2 = 'c03b-otp-04b';
    const { challengeId: challenge2 } = await createMfaChallenge(customerId, otp2);
    await expect(
      cashOutService.execute({ ...base, mfaChallengeId: challenge2, otp: otp2, amountMinor: '10001' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshotsFor({ idempotencyKey: `cash-out:${agent.id}:${idem}` })).toHaveLength(1);
  });

  // ── 4. rollback atomicity (real in-transaction failure, not a mocked service failure) ──

  it('05. forced downstream failure after the snapshot rolls back snapshot + limits + journal + balances', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '70000');

    const profile = `P03B_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, customerId);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000', null);

    const authRes = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_OUT,
      pin: '1234',
      principal: agentPrincipal(agent.id) as any,
    });
    expect(authRes.allowed).toBe(true);

    const journalsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    const agentBefore = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    const idem = `c03b-05-${randomUUID()}`;

    await expect(
      financialService.execute({
        authorizedContext: authRes.context!,
        idempotencyKey: idem,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          { accountId: custWallet.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '25000' },
          { accountId: agentWallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '25000' },
        ],
        limit: {
          product: 'WALLET_TO_CASH',
          principalType: 'CUSTOMER',
          principalId: customerId,
          direction: 'OUTGOING',
          channel: null,
          amountMinor: '25000',
          currency: 'NGN',
          walletLedgerAccountId: custWallet.ledgerAccountId,
          principalWalletCustomerId: customerId,
        },
        _simulateFailureAfterJournal: true, // fails AFTER snapshot recording, BEFORE commit
      }),
    ).rejects.toThrow('Simulated failure after journal');

    // everything rolled back together
    expect(await snapshotsFor({ idempotencyKey: `cash-out:${agent.id}:${idem}` })).toHaveLength(0); // snapshot gone
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='WALLET_TO_CASH'`, [customerId])).length).toBe(0);
    const journalsAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfter[0].cnt).toBe(journalsBefore[0].cnt); // journal gone
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe(agentBefore.balanceMinor);
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe(custBefore.balanceMinor);
    const idemRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`,
      [`agent-financial.v1:${agent.id}`, idem],
    );
    expect(idemRows.length).toBe(0); // idempotency reservation rolled back too
  });

  // ── 5. limit rejection ──

  it('06. limit-rejected WALLET_TO_CASH: rejected, no snapshot, no stranded reservation, no mutation', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '90000');

    const profile = `P03B_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, customerId);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '20000', null); // tighter than the attempted amount

    const otp = 'c03b-otp-06';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const idem = `c03b-06-${randomUUID()}`;
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp,
        amountMinor: '30000',
        currency: 'NGN',
        idempotencyKey: idem,
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await snapshotsFor({ idempotencyKey: `cash-out:${agent.id}:${idem}` })).toHaveLength(0); // consistent with the pilots
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='WALLET_TO_CASH'`, [customerId])).length).toBe(0);
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe('90000');
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('0');
  });

  // ── 6. synthetic fee rule captured as evidence, without charging ──

  it('07. TEST-ONLY synthetic fee rule → snapshot captures ruleId/version/parameters; nothing charged', async () => {
    const rule = await feeRuleRegistry.createRule(
      {
        productCode: 'WALLET_TO_CASH',
        currency: 'NGN',
        flatFeeMinor: '200',
        percentageBps: 10,
        minimumFeeMinor: null,
        maximumFeeMinor: null,
        vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000),
        priority: 0,
        isActive: true,
      },
      'test',
    );

    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '50000');

    const otp = 'c03b-otp-07';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const result = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '18000',
      currency: 'NGN',
      idempotencyKey: `c03b-07-${randomUUID()}`,
    });
    expect(result.status).toBe('COMPLETED');

    const snapshots = await snapshotsFor({ journalId: result.journalId });
    expect(snapshots).toHaveLength(1);
    const fee = snapshots[0].fee_decision;
    expect(fee.status).toBe('NOT_CONFIGURED'); // still NOT_CONFIGURED — charging is not enabled
    expect(fee.feeMinor).toBe('0');
    expect(fee.totalMinor).toBe('18000');
    expect(fee.ruleRefs).toHaveLength(1);
    expect(fee.ruleRefs[0].ruleId).toBe(rule.id);
    expect(fee.ruleRefs[0].ruleVersion).toBe(1);
    expect(fee.ruleRefs[0].flatFeeMinor).toBe('200');
    expect(fee.ruleRefs[0].percentageBps).toBe(10);

    // money flow UNCHANGED: principal-only journal, exact balances
    const lines: Array<any> = await dataSource.query(`SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`, [result.journalId]);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('18000');
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe('32000');
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('18000');
  });

  // ── 7. immutability + wiring boundary ──

  it('08. snapshot remains immutable (UPDATE/DELETE blocked) and the gate covers exactly the two pilot Agent flows', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = newPhone();
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '40000');
    const otp = 'c03b-otp-08';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const result = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '9000',
      currency: 'NGN',
      idempotencyKey: `c03b-08-${randomUUID()}`,
    });
    const snapshots = await snapshotsFor({ journalId: result.journalId });
    expect(snapshots).toHaveLength(1);
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET product='X' WHERE id=$1`, [snapshots[0].id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snapshots[0].id])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );

    // wiring boundary: the shared execution service gates snapshot recording to exactly
    // CASH_TO_WALLET + WALLET_TO_CASH; the flow orchestrators themselves stay unwired
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const executionSource = readFileSync(join(__dirname, '../src/agent/agent-financial-execution.service.ts'), 'utf8');
    expect(executionSource).toContain(`['CASH_TO_WALLET', 'WALLET_TO_CASH']`); // explicit product gate
    expect(executionSource).toContain('recordDecisionWithManager'); // same-transaction recording
    expect(executionSource).not.toMatch(/\.recordDecision\(/); // never the second-transaction variant
    expect(executionSource).not.toContain('feeEngine'); // no FeeEngine participation
    const cashOutSource = readFileSync(join(__dirname, '../src/agent/agent-cash-out.service.ts'), 'utf8');
    expect(cashOutSource).not.toContain('CommercialDecisionSnapshotService');
    expect(cashOutSource).not.toContain('FeeRuleResolverService');
    const cashInSource = readFileSync(join(__dirname, '../src/agent/agent-cash-in.service.ts'), 'utf8');
    expect(cashInSource).not.toContain('CommercialDecisionSnapshotService');
    expect(cashInSource).not.toContain('FeeRuleResolverService');
  });
});
