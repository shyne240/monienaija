/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unsafe-argument */
// @ts-nocheck
/**
 * V1-AGENT-HISTORY-01 — agent unified transaction history verification (real PG).
 *
 * Proves the read-only unified history GET /api/v1/agents/me/transactions against real flows:
 * every item type (CASH_IN / CASH_OUT / CASH_TO_CASH lifecycle / AGENT_FUNDING / AGENT_DEFUNDING),
 * unified chronological ordering, pagination, timestamp-tie ordering, cross-agent isolation at the
 * query boundary, authenticated-context identity, suspended-agent read convention, read-only
 * (zero mutation) and safe projection. No fake financial transactions — all flows are real.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, randomBytes, pbkdf2Sync } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { CommissionRuleRegistryService } from '../src/commission/commission-rule-registry.service';
import { FeeRuleRegistryService } from '../src/fee-rules/fee-rule-registry.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashInService } from '../src/agent/agent-cash-in.service';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentFundingService } from '../src/agent/agent-funding.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function encodePassword(password: string): string {
  const salt = Buffer.from(`ah01-test-salt`);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-AGENT-HISTORY-01 (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let commissionRegistry: CommissionRuleRegistryService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let cashInService: AgentCashInService;
  let cashOutService: AgentCashOutService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let fundingService: AgentFundingService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let mfaService: MfaExecutionService;
  let customerPinService: CustomerTransactionPinService;
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
      if (!token || !token.startsWith('workforce-')) {
        throw new UnauthorizedException('invalid workforce token');
      }
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

  const ENV_KEYS = [
    'COMMERCIAL_ACCOUNTING_ENABLED',
    'COMMERCIAL_ACCOUNTING_VAT_TREATMENT',
    'COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT',
    'COMMERCIAL_COMMISSION_RECOGNITION_TIMING',
  ] as const;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-agent-history-01');
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
    walletService = app.get(WalletService);
    ledgerService = app.get(LedgerService);
    commissionRegistry = app.get(CommissionRuleRegistryService);
    feeRuleRegistry = app.get(FeeRuleRegistryService);
    cashInService = app.get(AgentCashInService);
    cashOutService = app.get(AgentCashOutService);
    cashToCashService = app.get(AgentCashToCashService);
    claimService = app.get(AgentCashToCashClaimService);
    fundingService = app.get(AgentFundingService);
    classService = app.get(AgentClassService);
    appService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    mfaService = app.get(MfaExecutionService);
    customerPinService = app.get(CustomerTransactionPinService);
  }, 180000);

  afterAll(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await app.get(ProductCatalogSeedService).seedIfEmpty();
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
    await ledgerService.createAccount({
      code: 'CASH_TO_CASH-UNCLAIMED-NGN',
      name: 'Cash-to-Cash Unclaimed NGN',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    await dataSource.query(
      `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
       VALUES (gen_random_uuid(),'AGENT_FUNDING_POOL-NGN','Agent Funding Pool NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
       ON CONFLICT (code) DO NOTHING`,
    );
    const pool: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN'`);
    await dataSource.transaction(async (manager) => {
      await ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `ah01-pool-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `POOL-SEED-${randomUUID().slice(0, 6)}`,
        lines: [
          { accountId: systemLedgerAccountId, direction: 'DEBIT', amountMinor: '10000000' },
          { accountId: pool[0].id, direction: 'CREDIT', amountMinor: '10000000' },
        ],
      });
    });
  });

  // ── harness ──

  function newPhone(): string {
    return `80${Math.floor(10000000 + Math.random() * 89999999)}`;
  }

  async function seedLimitProfile(code: string, subjectType: 'AGENT' | 'CUSTOMER', subjectId: string, product: string) {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,$3,'ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`, subjectType],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,$4,NULL,0,$5,NULL,true,'test')`,
      [randomUUID(), code, subjectType, subjectId, new Date(Date.now() - 86400000).toISOString()],
    );
    for (const [dimension, value] of [
      ['MIN_AMOUNT_PER_TX', '100'],
      ['DAILY_AMOUNT', '100000000'],
    ]) {
      await dataSource.query(
        `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
         VALUES ($1,$2,$3,NULL,NULL,'NGN',$4,$5,NULL,$6,NULL,true,'test')`,
        [randomUUID(), code, product, dimension, value, new Date(Date.now() - 86400000).toISOString()],
      );
    }
  }

  async function createActiveAgentWithPin(services: unknown, pin: string | null) {
    const cls = await classService.create({
      reference: `cls-ah01-${randomUUID().slice(0, 8)}`,
      code: `AH01-${randomUUID().slice(0, 6)}`,
      name: 'AH01 Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz AH01 ${randomUUID().slice(0, 4)}`,
      contactEmail: `ah01-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-ah01',
    });
    await appService.submit(appEntity.id, 'applicant-ah01');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
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
      idempotencyKey: `ah01-agent-wallet-${agent.id}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    return { cls, agent, appEntity, wallet, walletLedgerAccountId: rows[0].ledger_account_id };
  }

  /** Real agent login (a21 convention): credential insert + POST /agents/sessions. */
  async function agentLoginToken(agentId: string, password = 'correct-password'): Promise<string> {
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, encodePassword(password)],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password })
      .expect(200);
    return login.body.accessToken as string;
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
      [`cust-ah01-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer AH01',true)`,
      [customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`,
      [customerId, phoneCanonical],
    );
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `ah01-cust-wallet-${customerId}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    await customerPinService.setTransactionPin(customerId, {
      pinHash: hashPin(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    return { customerId, wallet, walletLedgerAccountId: rows[0].ledger_account_id };
  }

  async function fundWalletDirect(ledgerAccountId: string, amountMinor: string) {
    await dataSource.transaction(async (manager) => {
      await ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `ah01-fund-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `AHF-${ledgerAccountId.slice(0, 8)}`,
        lines: [
          { accountId: systemLedgerAccountId, direction: 'DEBIT', amountMinor },
          { accountId: ledgerAccountId, direction: 'CREDIT', amountMinor },
        ],
      });
    });
  }

  async function createMfaChallenge(customerId: string, otp: string) {
    const eRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
    );
    const enrollmentId = eRows[0]!.id;
    const mRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
      [randomUUID(), customerId, enrollmentId, `ah01-${randomUUID().slice(0, 6)}`],
    );
    const methodId = mRows[0]!.id;
    const cRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
      [randomUUID(), customerId],
    );
    const credentialId = cRows[0]!.id;
    const sessionId = randomUUID();
    await lifecycleService; // keep linter quiet about unused import symmetry
    await dataSource
      .query(
        `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
        [sessionId, customerId, credentialId, randomBytes(32).toString('hex')],
      )
      .catch(() => {});
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
    const challenge = await mfaService.issueChallenge({
      principal,
      enrollmentId,
      methodId,
      challengeHash: otp,
      ttlSeconds: 300,
      actor: customerId,
    } as any);
    return (challenge as any).id ?? (challenge as any).challengeId;
  }

  const privilegedPrincipal: any = {
    type: 'PRIVILEGED', principalId: 'test-actor', roles: [], scopes: [],
    customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE',
  };

  /** Full service-enabled agent with a funded float. */
  async function agentBundle(opts: { floatMinor?: string } = {}) {
    const bundle = await createActiveAgentWithPin(
      ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'], '1234',
    );
    if (opts.floatMinor && opts.floatMinor !== '0') {
      const fund = await fundingService.fund({
        agentId: bundle.agent.id, amountMinor: opts.floatMinor, currency: 'NGN',
        idempotencyKey: `ah01-f-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
      });
      expect(fund.status).toBe('COMPLETED');
    }
    const token = await agentLoginToken(bundle.agent.id);
    return { ...bundle, token };
  }

  // ═══════════════════ CASES ═══════════════════

  it('1. agent with no history returns an empty, well-formed page', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '0' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false });
    void agent;
  });

  it('2. AGENT_FUNDING appears as CREDIT with WORKFORCE counterparty', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '5000' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const item = res.body.items.find((i: any) => i.type === 'AGENT_FUNDING');
    expect(item).toBeDefined();
    expect(item.status).toBe('COMPLETED');
    expect(item.amountMinor).toBe('5000');
    expect(item.direction).toBe('CREDIT');
    expect(item.counterparty).toEqual({ type: 'WORKFORCE' });
    void agent;
  });

  it('3. AGENT_DEFUNDING appears as DEBIT', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '5000' });
    const defund = await fundingService.defund({
      agentId: agent.id, amountMinor: '2000', currency: 'NGN',
      idempotencyKey: `ah01-d-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    expect(defund.status).toBe('COMPLETED');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=AGENT_DEFUNDING')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('AGENT_DEFUNDING');
    expect(res.body.items[0].direction).toBe('DEBIT');
    expect(res.body.items[0].amountMinor).toBe('2000');
  });

  it('4. Wallet→Cash executed by the agent appears as CASH_OUT (CREDIT)', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '0' });
    const phone = newPhone();
    const { customerId, walletLedgerAccountId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWalletDirect(walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const challengeId = await createMfaChallenge(customerId, 'ah01-otp');
    const out = await cashOutService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      customerId, customerPin: '1234', mfaChallengeId: challengeId, otp: 'ah01-otp',
      amountMinor: '30000', currency: 'NGN', idempotencyKey: `ah01-out-${randomUUID()}`,
    });
    expect(out.status).toBe('COMPLETED');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_OUT')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].direction).toBe('CREDIT');
    expect(res.body.items[0].amountMinor).toBe('30000');
    expect(res.body.items[0].status).toBe('COMPLETED');
    expect(res.body.items[0].counterparty).toEqual({ type: 'CUSTOMER' });
  });

  it('5. Cash→Wallet executed by the agent appears as CASH_IN (DEBIT)', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '100000' });
    const phone = newPhone();
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_WALLET');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'CASH_TO_WALLET');
    const result = await cashInService.execute({
      agentId: agent.id, principal: agentPrincipal(agent.id) as any, pin: '1234',
      recipientIdentifier: phone, amountMinor: '30000', currency: 'NGN',
      idempotencyKey: `ah01-in-${randomUUID()}`, reference: `ref-${randomUUID().slice(0, 6)}`,
    });
    expect(result.status).toBe('COMPLETED');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_IN')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].direction).toBe('DEBIT');
    expect(res.body.items[0].amountMinor).toBe('30000');
  });

  it('6. CASH_TO_CASH initiation appears; status is the source-of-truth lifecycle (UNCLAIMED)', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '500000' });
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_CASH');
    const init = await cashToCashService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '30000', currency: 'NGN',
      idempotencyKey: `ah01-c2c-${randomUUID()}`,
    });
    expect(init.status).toBe('COMPLETED');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_TO_CASH')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('CASH_TO_CASH');
    expect(res.body.items[0].status).toBe('UNCLAIMED');
    expect(res.body.items[0].direction).toBe('DEBIT');
    // claim then appears on the SAME history item (lifecycle projection, not a second row):
    const { customerId } = await createCustomerWithPhoneAndPin(init.beneficiaryPhone, '1234');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'CASH_TO_CASH');
    const challengeId = await createMfaChallenge(customerId, 'ah01-claim');
    const claim = await claimService.execute({
      transferId: init.transferId, beneficiaryPhone: init.beneficiaryPhone, transferCode: init.transferCode,
      customerId, mfaChallengeId: challengeId, otp: 'ah01-claim',
      idempotencyKey: `ah01-claim-${randomUUID()}`,
    });
    expect(claim.status).toBe('COMPLETED');
    const res2 = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_TO_CASH')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.items[0].id).toBe(res.body.items[0].id);
    expect(res2.body.items[0].status).toBe('CLAIMED');
    expect(res2.body.items[0].completedAt).toBeTruthy();
  });

  it('7. mixed real flows produce ONE unified chronological history (newest first)', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '500000' });
    // C2C initiation
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_CASH');
    await cashToCashService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '11000', currency: 'NGN',
      idempotencyKey: `ah01-m1-${randomUUID()}`,
    });
    // Defunding
    await fundingService.defund({
      agentId: agent.id, amountMinor: '4000', currency: 'NGN',
      idempotencyKey: `ah01-m2-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    // C2W
    const phone = newPhone();
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_WALLET');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'CASH_TO_WALLET');
    await cashInService.execute({
      agentId: agent.id, principal: agentPrincipal(agent.id) as any, pin: '1234',
      recipientIdentifier: phone, amountMinor: '22000', currency: 'NGN',
      idempotencyKey: `ah01-m3-${randomUUID()}`, reference: `ref-${randomUUID().slice(0, 6)}`,
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // funding (from bundle) + C2C + defunding + cash-in = 4 items
    expect(res.body.pagination.total).toBe(4);
    const types = res.body.items.map((i: any) => i.type);
    expect(types).toContain('AGENT_FUNDING');
    expect(types).toContain('AGENT_DEFUNDING');
    expect(types).toContain('CASH_TO_CASH');
    expect(types).toContain('CASH_IN');
    const times = res.body.items.map((i: any) => new Date(i.createdAt).getTime());
    for (let i = 1; i < times.length; i += 1) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    expect(types[0]).toBe('CASH_IN'); // executed last
  });

  it('8. pagination: limit=1 pages through the unified history with correct totals', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '500000' });
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_CASH');
    await cashToCashService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '11000', currency: 'NGN', idempotencyKey: `ah01-p1-${randomUUID()}`,
    });
    await fundingService.defund({
      agentId: agent.id, amountMinor: '1000', currency: 'NGN',
      idempotencyKey: `ah01-p2-${randomUUID()}`, principal: privilegedPrincipal, actor: 'test-actor',
    });
    const page1 = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?page=1&limit=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 1, total: 3, totalPages: 3, hasNextPage: true });
    expect(page1.body.items).toHaveLength(1);
    const page2 = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?page=2&limit=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.pagination.hasNextPage).toBe(true);
    const page3 = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?page=3&limit=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page3.body.pagination.hasNextPage).toBe(false);
    const ids = [page1, page2, page3].flatMap((p) => p.body.items.map((i: any) => i.id));
    expect(new Set(ids).size).toBe(3);
  });

  it('9. deterministic tie-break: equal created_at orders by id DESC (stable across repeated reads)', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '500000' });
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_CASH');
    await cashToCashService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '9000', currency: 'NGN', idempotencyKey: `ah01-t1-${randomUUID()}`,
    });
    await cashToCashService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '7000', currency: 'NGN', idempotencyKey: `ah01-t2-${randomUUID()}`,
    });
    // Force a timestamp collision between the two (business-table rows; ledger immutable by design).
    const fixed = '2026-09-30T10:00:00.000Z';
    await dataSource.query(
      `UPDATE cash_to_cash_transfers SET created_at=$1 WHERE agent_id=$2`,
      [fixed, agent.id],
    );
    const read1 = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_TO_CASH')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const read2 = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_TO_CASH')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(read1.body.items).toHaveLength(2);
    expect(read1.body.items.map((i: any) => i.id)).toEqual(read2.body.items.map((i: any) => i.id));
    const collided = read1.body.items;
    expect(new Date(collided[0].createdAt).getTime()).toBe(new Date(collided[1].createdAt).getTime());
    expect(collided[0].id > collided[1].id).toBe(true); // id DESC
  });

  it('10. cross-agent isolation: agent A never sees agent B activity', async () => {
    const a = await agentBundle({ floatMinor: '5000' });
    const b = await agentBundle({ floatMinor: '50000' });
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', b.agent.id, 'CASH_TO_CASH');
    await cashToCashService.execute({
      agentId: b.agent.id, agentPrincipal: agentPrincipal(b.agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '9000', currency: 'NGN', idempotencyKey: `ah01-x-${randomUUID()}`,
    });
    const resA = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(resA.body.items).toHaveLength(1);
    expect(resA.body.items[0].type).toBe('AGENT_FUNDING');
    const resB = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200);
    expect(resB.body.items).toHaveLength(2);
    // No id overlap between the two agents' histories.
    const idsA = new Set(resA.body.items.map((i: any) => i.id));
    for (const item of resB.body.items) expect(idsA.has(item.id)).toBe(false);
  });

  it('11. forged agentId query param is ignored — identity comes from the session', async () => {
    const a = await agentBundle({ floatMinor: '5000' });
    const b = await agentBundle({ floatMinor: '7000' });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/transactions?agentId=${b.agent.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('AGENT_FUNDING');
    expect(res.body.items[0].amountMinor).toBe('5000'); // A's own, not B's 7000
  });

  it('12. unauthenticated 401; non-agent principal cannot read agent history', async () => {
    await request(app.getHttpServer()).get('/api/v1/agents/me/transactions').expect(401);
    const a = await agentBundle({ floatMinor: '1000' });
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', 'Bearer workforce-service')
      .expect((r) => expect([401, 403]).toContain(r.status));
    void a;
  });

  it('13. suspended agent keeps read access (existing read conventions; no invented lifecycle policy)', async () => {
    const a = await agentBundle({ floatMinor: '5000' });
    await lifecycleService.suspend(a.agent.id, 'test-actor');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('AGENT_FUNDING');
  });

  it('14. reading history mutates NOTHING (ledger, wallets, journals, snapshots, audit untouched)', async () => {
    const a = await agentBundle({ floatMinor: '5000' });
    const before = {
      lines: (await dataSource.query(`SELECT count(*)::text AS n FROM ledger_lines`))[0].n,
      journals: (await dataSource.query(`SELECT count(*)::text AS n FROM ledger_journals`))[0].n,
      wallets: (await dataSource.query(`SELECT count(*)::text AS n FROM wallet_accounts`))[0].n,
      snaps: (await dataSource.query(`SELECT count(*)::text AS n FROM commercial_decision_snapshots`))[0].n,
      audits: (await dataSource.query(`SELECT count(*)::text AS n FROM audit_events`))[0].n,
      idempotency: (await dataSource.query(`SELECT count(*)::text AS n FROM idempotency_records`))[0].n,
      agentRow: await dataSource.query(`SELECT status::text AS s, updated_at FROM agents WHERE id=$1`, [a.agent.id]),
    };
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=AGENT_FUNDING&page=2')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    const after = {
      lines: (await dataSource.query(`SELECT count(*)::text AS n FROM ledger_lines`))[0].n,
      journals: (await dataSource.query(`SELECT count(*)::text AS n FROM ledger_journals`))[0].n,
      wallets: (await dataSource.query(`SELECT count(*)::text AS n FROM wallet_accounts`))[0].n,
      snaps: (await dataSource.query(`SELECT count(*)::text AS n FROM commercial_decision_snapshots`))[0].n,
      audits: (await dataSource.query(`SELECT count(*)::text AS n FROM audit_events`))[0].n,
      idempotency: (await dataSource.query(`SELECT count(*)::text AS n FROM idempotency_records`))[0].n,
      agentRow: await dataSource.query(`SELECT status::text AS s, updated_at FROM agents WHERE id=$1`, [a.agent.id]),
    };
    // Financial state identical: no ledger/wallet/journal/snapshot/idempotency/agent mutation.
    const financialKeys = ['lines', 'journals', 'wallets', 'snaps', 'idempotency', 'agentRow'];
    for (const k of financialKeys) expect(after[k]).toEqual(before[k]);
    // Existing audit rows are never mutated; the only delta is the platform's pre-existing
    // AUTHORIZATION_DECISION/ALLOWED access observation emitted by the access guard for EVERY
    // authenticated route (profile/financial-position behave identically) — not history-feature output.
    const deltaAudits: Array<{ entity_type: string; action: string }> = await dataSource.query(
      `SELECT entity_type, action FROM audit_events ORDER BY created_at DESC, id DESC LIMIT $1`,
      [Math.max(0, Number(after.audits) - Number(before.audits))],
    );
    for (const e of deltaAudits) {
      expect(e.entity_type).toBe('AUTHORIZATION_DECISION');
      expect(e.action).toBe('ALLOWED');
    }
  });

  it('15. commission evidence: the agent sees its OWN allocation on a commission-bearing flow', async () => {
    await feeRuleRegistry.createRule(
      {
        productCode: 'WALLET_TO_CASH', currency: 'NGN',
        flatFeeMinor: '1000', percentageBps: null, minimumFeeMinor: null, maximumFeeMinor: null,
        vatBps: 0, effectiveFrom: new Date(Date.now() - 86400000), priority: 0, isActive: true,
      },
      'test',
    );
    await commissionRegistry.createRule(
      {
        productCode: 'WALLET_TO_CASH', currency: 'NGN', recipientType: 'AGENT',
        calculationModel: 'PERCENTAGE', calculationBasis: 'FEE',
        flatCommissionMinor: null, percentageBps: 1000,
        minimumCommissionMinor: null, maximumCommissionMinor: null, tiers: null,
        agentClassId: null, agentId: null, aggregatorId: null,
        effectiveFrom: new Date(Date.now() - 86400000), effectiveTo: null, priority: 0, isActive: true,
      } as any,
      'test',
    );
    const { agent, token } = await agentBundle({ floatMinor: '0' });
    const phone = newPhone();
    const { customerId, walletLedgerAccountId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundWalletDirect(walletLedgerAccountId, '500000');
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'CUSTOMER', customerId, 'WALLET_TO_CASH');
    const challengeId = await createMfaChallenge(customerId, 'ah01-c15');
    const out = await cashOutService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      customerId, customerPin: '1234', mfaChallengeId: challengeId, otp: 'ah01-c15',
      amountMinor: '30000', currency: 'NGN', idempotencyKey: `ah01-c15-${randomUUID()}`,
    });
    expect(out.status).toBe('COMPLETED');
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=CASH_OUT')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].commission).not.toBeNull();
    expect(res.body.items[0].commission.commissionMinor).toBe('100');
    expect(res.body.items[0].commission.payable).toBe(false); // accounting not enabled in this harness
  });

  it('16. input validation: invalid type is 400; page/limit clamped to conventions', async () => {
    const { token } = await agentBundle({ floatMinor: '1000' });
    await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?type=WALLET_TRANSFER')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions?page=0&limit=500')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
  });

  it('17. safe projection: no journal/ledger-account/request-hash/secret internals exposed', async () => {
    const { agent, token } = await agentBundle({ floatMinor: '500000' });
    await seedLimitProfile(`PCA_${randomUUID().slice(0, 6).toUpperCase()}`, 'AGENT', agent.id, 'CASH_TO_CASH');
    await cashToCashService.execute({
      agentId: agent.id, agentPrincipal: agentPrincipal(agent.id) as any, agentPin: '1234',
      beneficiaryPhone: newPhone(), amountMinor: '8000', currency: 'NGN', idempotencyKey: `ah01-s17-${randomUUID()}`,
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/transactions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const item of res.body.items) {
      const blob = JSON.stringify(item);
      expect(blob).not.toMatch(/requestHash|request_hash|ledgerAccountId|ledger_account_id|transfer_code|pinHash|password/);
      expect(item).not.toHaveProperty('metadata');
      expect(item).not.toHaveProperty('journalId');
      expect(item).not.toHaveProperty('walletId');
    }
  });
});
