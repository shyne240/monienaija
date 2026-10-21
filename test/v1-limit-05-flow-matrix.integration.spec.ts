/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, no-empty */
// @ts-nocheck
/**
 * V1-LIMIT-05 — PART 1: per-flow limit regression matrix over ALL 8 wired V1 financial flows.
 *
 * Flows under test (product / limit principal / direction, per V1-LIMIT-04 wiring):
 *   1. W2W           WALLET_TRANSFER   CUSTOMER (source)          OUTGOING
 *   2. CASH_IN       CASH_TO_WALLET    CUSTOMER (recipient)       INCOMING
 *   3. CASH_OUT      WALLET_TO_CASH    CUSTOMER (payer)           OUTGOING
 *   4. C2C_INIT      CASH_TO_CASH      AGENT (initiating agent)   OUTGOING
 *   5. C2C_CLAIM     CASH_TO_CASH      CUSTOMER (beneficiary)     INCOMING
 *   6. CUST_FUNDING  CUSTOMER_FUNDING  CUSTOMER (funded)          INCOMING
 *   7. AGENT_FUNDING AGENT_FUNDING     AGENT (funded)             INCOMING
 *   8. AGENT_DEFUND  AGENT_DEFUNDING   AGENT (defunded)           OUTGOING
 *
 * Per-flow dimension applicability (documented, not mechanically applied):
 *   - MIN/MAX per-tx, the four cumulative amount windows and the four cumulative count
 *     windows apply to every flow (all move NGN amounts for a single principal).
 *   - WALLET_BALANCE_MAX applies ONLY to INCOMING flows (CASH_IN, C2C_CLAIM, CUST_FUNDING,
 *     AGENT_FUNDING): V1-LIMIT-04 enforces it against the authoritative ledger balance on
 *     credit only; OUTGOING flows spend balance down and are deliberately not checked.
 *   - Idempotent-replay semantics: W2W/cash-in/out/c2c/agent-funding replay the same
 *     idempotency key; Customer Funding replays the request creation (approve is one-shot —
 *     a second approve 409s) and the limit must still be consumed exactly once.
 *
 * Real PostgreSQL. Concurrency via Promise.all. No mocks of any financial service.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
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
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { TransferService } from '../src/transfer/transfer.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function randPhone(): string {
  return `80${Math.floor(10000000 + Math.random() * 89999999)}`;
}

type FlowKey =
  | 'W2W'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'C2C_INIT'
  | 'C2C_CLAIM'
  | 'CUST_FUNDING'
  | 'AGENT_FUNDING'
  | 'AGENT_DEFUNDING';

interface AttemptResult {
  ok: boolean;
  code?: string;
  replayed?: boolean;
  raw?: any;
}

interface RuleSeed {
  dimension: string;
  limitMinor?: string | null;
  limitCount?: number | null;
  product?: string; // override flow product (isolation tests)
  direction?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}

function errorCodeOf(e: any): string {
  const resp = e?.getResponse?.() as any;
  return (resp && (resp.error || resp.code)) || e?.code || e?.message || 'UNKNOWN';
}

describe('V1-LIMIT-05 Per-Flow Limit Regression Matrix (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let transferService: TransferService;
  let cashInService: AgentCashInService;
  let cashOutService: AgentCashOutService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let agentFundingService: AgentFundingService;
  let customerFundingService: CustomerFundingService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let agentPinService: AgentAuthenticationService;
  let customerPinService: CustomerTransactionPinService;
  let mfaService: MfaExecutionService;
  let settlementAccountId: string;

  const privilegedPrincipal: any = {
    type: 'PRIVILEGED',
    principalId: 'limit-matrix-actor',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: 'limit-matrix-maker',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: 'limit-matrix-checker',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-limit-05-matrix');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    transferService = moduleRef.get(TransferService);
    cashInService = moduleRef.get(AgentCashInService);
    cashOutService = moduleRef.get(AgentCashOutService);
    cashToCashService = moduleRef.get(AgentCashToCashService);
    claimService = moduleRef.get(AgentCashToCashClaimService);
    agentFundingService = moduleRef.get(AgentFundingService);
    customerFundingService = moduleRef.get(CustomerFundingService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    agentPinService = moduleRef.get(AgentAuthenticationService);
    customerPinService = moduleRef.get(CustomerTransactionPinService);
    mfaService = moduleRef.get(MfaExecutionService);

    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (!rows[0]) throw new Error('PAYMENT-SETTLEMENT_ASSET-NGN missing — migrations must seed it');
    settlementAccountId = rows[0].id;
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  // ───────────────────────── shared fixture builders ─────────────────────────

  async function createAgent(services: unknown): Promise<{ agentId: string; walletLedgerAccountId: string }> {
    const cls = await classService.create({
      reference: `cls-l5-${randomUUID().slice(0, 8)}`,
      code: `L5-${randomUUID().slice(0, 6)}`,
      name: 'L5 Matrix Class',
      isActive: true,
      applicableServices: services as unknown,
      actor: 'matrix',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz L5 ${randomUUID().slice(0, 4)}`,
      contactEmail: `l5-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-l5',
    });
    await appService.submit(appEntity.id, 'applicant-l5');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'matrix');
    if (agent.status !== AgentStatus.ACTIVE) throw new Error('agent not ACTIVE');
    await agentPinService.setTransactionPin(agent.id, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agent.id,
    });
    const wallet = await walletService.createWallet({ customerId: agent.id, currency: 'NGN', idempotencyKey: `l5-agent-w-${agent.id}-${randomUUID()}` });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    return { agentId: agent.id, walletLedgerAccountId: rows[0].ledger_account_id };
  }

  function agentPrincipal(agentId: string): any {
    return { type: 'AGENT', agentId, principalId: agentId, roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'SELF' };
  }

  async function createCustomer(opts: { phone?: string; withPin?: boolean } = {}): Promise<{ customerId: string; walletLedgerAccountId: string; phone?: string }> {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-l5-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0].id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, `Customer L5 ${randomUUID().slice(0, 4)}`]);
    let phone: string | undefined;
    if (opts.phone) {
      phone = opts.phone;
      await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`, [customerId, phone]);
    }
    if (opts.withPin) {
      await customerPinService.setTransactionPin(customerId, { pinHash: hashPin('1234'), hashAlgorithm: 'PBKDF2', pinVersion: 1, actor: customerId });
    }
    const wallet = await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `l5-cust-w-${customerId}-${randomUUID()}` });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    return { customerId, walletLedgerAccountId: rows[0].ledger_account_id, phone };
  }

  async function fundAccount(ledgerAccountId: string, amountMinor: string): Promise<void> {
    await ledgerService.postJournal({
      idempotencyKey: `l5-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `L5FUND-${randomUUID().slice(0, 8)}`,
      lines: [
        { accountId: settlementAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
  }

  function randOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async function createMfaChallenge(customerId: string): Promise<{ challengeId: string; otp: string }> {
    const otp = randOtp();
    const enrollRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM mfa_enrollments WHERE customer_id=$1 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
      [customerId],
    );
    let enrollmentId: string;
    let methodId: string;
    if (enrollRows[0]) {
      enrollmentId = enrollRows[0].id;
      const mRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM mfa_methods WHERE enrollment_id=$1 AND customer_id=$2 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
        [enrollmentId, customerId],
      );
      if (mRows[0]) methodId = mRows[0].id;
      else {
        const ins: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
          [randomUUID(), customerId, enrollmentId, `m-${randomUUID().slice(0, 6)}`],
        );
        methodId = ins[0].id;
      }
    } else {
      // Concurrent callers may race here (uq_mfa_enrollments_active_customer) — insert-or-reselect.
      try {
        const e: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
          [randomUUID(), customerId, `mfa-e-${randomUUID().slice(0, 6)}`],
        );
        enrollmentId = e[0].id;
      } catch {
        const e: Array<{ id: string }> = await dataSource.query(
          `SELECT id FROM mfa_enrollments WHERE customer_id=$1 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
          [customerId],
        );
        enrollmentId = e[0].id;
      }
      const m: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, enrollmentId, `m-${randomUUID().slice(0, 6)}`],
      );
      methodId = m[0].id;
    }
    const credRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM customer_authentication_credentials WHERE customer_id=$1 LIMIT 1`, [customerId]);
    let credentialId = credRows[0]?.id;
    if (!credentialId) {
      const c: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customer_authentication_credentials (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PASSWORD','dummyhash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
        [randomUUID(), customerId],
      );
      credentialId = c[0].id;
    }
    const sessionId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');
    await dataSource.query(
      `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
      [sessionId, customerId, credentialId, tokenHash],
    );
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
    const challenge = await mfaService.issueChallenge({ principal, enrollmentId, methodId, challengeHash: otp, ttlSeconds: 300, actor: customerId } as any);
    return { challengeId: (challenge as any).id ?? (challenge as any).challengeId, otp };
  }

  // ───────────────────────── limit catalogue seeding ─────────────────────────

  async function seedProfile(code: string, kind = 'CUSTOMER', enabled = true): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,$3,'ACTIVE',$4,'CONFIGURED','matrix')`,
      [code, `Profile ${code}`, kind, enabled],
    );
  }

  async function seedAssignment(params: {
    profileCode: string;
    subjectType: string;
    subjectId?: string | null;
    precedence?: number;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,true,'matrix')`,
      [
        randomUUID(),
        params.profileCode,
        params.subjectType,
        params.subjectId ?? null,
        params.precedence ?? 0,
        params.effectiveFrom ?? new Date(Date.now() - 86400000).toISOString(),
        params.effectiveTo ?? null,
      ],
    );
  }

  async function seedRule(profileCode: string, rule: RuleSeed, defaultProduct: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by) VALUES ($1,$2,$3,$4,NULL,'NGN',$5,$6,$7,$8,$9,$10,'matrix')`,
      [
        id,
        profileCode,
        rule.product ?? defaultProduct,
        rule.direction ?? null,
        rule.dimension,
        rule.limitMinor ?? null,
        rule.limitCount ?? null,
        rule.effectiveFrom ?? new Date(Date.now() - 86400000).toISOString(),
        rule.effectiveTo ?? null,
        rule.isActive ?? true,
      ],
    );
    return id;
  }

  // ───────────────────────── per-flow harness ─────────────────────────

  interface Harness {
    flow: FlowKey;
    product: string;
    principalType: 'CUSTOMER' | 'AGENT';
    direction: 'INCOMING' | 'OUTGOING';
    incoming: boolean;
    principalId: string;
    principalWalletLedgerAccountId: string;
    /**
     * Concurrency profile for the boundary case. MFA-guarded flows (CASH_OUT, C2C_CLAIM)
     * use smaller concurrency, consistent with the repository's own 2-way MFA concurrency
     * convention (a14 tests W/X/Y); 3 attempts of 30000 against a 70000 cap → exactly 2 commit.
     */
    concurrency: { count: number; amount: string; limit: string; expectedOk: number; expectedUsed: string };
    attempt(amountMinor: string, key?: string): Promise<AttemptResult>;
    /** second call with the SAME idempotency key (replay semantics) */
    replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult>;
    /** concurrent attempts for boundary tests; pre-creates per-attempt state where required */
    prepareConcurrent(count: number): Promise<Array<() => Promise<AttemptResult>>>;
    deactivatePrincipalWallet(): Promise<void>;
  }

  const DEFAULT_CONCURRENCY = { count: 5, amount: '30000', limit: '100000', expectedOk: 3, expectedUsed: '90000' };
  const MFA_CONCURRENCY = { count: 3, amount: '30000', limit: '70000', expectedOk: 2, expectedUsed: '60000' };

  async function usageRowsFor(principalId: string, product?: string): Promise<any[]> {
    return dataSource.query(
      `SELECT dimension, used_amount_minor::text AS used_amount_minor, used_count, reserved_amount_minor::text AS reserved_amount_minor, reserved_count, product FROM limit_usages WHERE principal_id=$1 ${product ? `AND product=$2` : ''} ORDER BY dimension`,
      product ? [principalId, product] : [principalId],
    );
  }

  async function reservationRowsFor(principalId: string, key?: string): Promise<any[]> {
    if (key) {
      return dataSource.query(`SELECT status, dimension, amount_minor::text AS amount_minor, count FROM limit_reservations WHERE idempotency_key=$1 ORDER BY dimension`, [key]);
    }
    return dataSource.query(`SELECT status, dimension FROM limit_reservations WHERE principal_id=$1 ORDER BY reserved_at`, [principalId]);
  }

  // V1-TEST-01: '40001'/'40P01' are the raw PostgreSQL SQLSTATE codes for a retryable
  // serialization failure / deadlock. 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED' is the stable,
  // documented machine code production code now throws (see
  // AgentCashToCashService.transactionContentionExhaustedException()) once its own bounded
  // internal retry budget (MAX_SERIALIZABLE_ATTEMPTS) is exhausted under genuinely adversarial
  // multi-way contention for the same limit-usage row — the raw driver error must never leak
  // to a caller, but the fact that it is safe (and expected) for a well-behaved client to retry
  // the whole request is preserved via this code. Recognizing it here is not a loosened
  // assertion: it keeps this harness's pre-existing behavior (transparently retry on a
  // transient/contention outcome, then assert the final, settled business outcome strictly)
  // intact against the now-cleaner production error shape.
  const SERIALIZATION_RETRY_CODES = new Set(['40001', '40P01', 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED']);

  function isSerializationFailure(res: AttemptResult): boolean {
    return !res.ok && !!res.code && SERIALIZATION_RETRY_CODES.has(String(res.code));
  }

  function wrapWithRetry(h: Harness): Harness {
    const origAttempt = h.attempt.bind(h);
    const origReplay = h.replay.bind(h);
    const origPrepare = h.prepareConcurrent.bind(h);
    return {
      ...h,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        let last: AttemptResult = { ok: false, code: 'UNKNOWN' };
        for (let i = 0; i < 10; i += 1) {
          last = await origAttempt(amountMinor, key);
          if (!isSerializationFailure(last)) return last;
          await new Promise((res) => setTimeout(res, 15 * (i + 1) + Math.floor(Math.random() * 25)));
        }
        return last;
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        let last: AttemptResult = { ok: false, code: 'UNKNOWN' };
        for (let i = 0; i < 10; i += 1) {
          last = await origReplay(amountMinor, key, first);
          if (!isSerializationFailure(last)) return last;
          await new Promise((res) => setTimeout(res, 15 * (i + 1) + Math.floor(Math.random() * 25)));
        }
        return last;
      },
      async prepareConcurrent(count: number): Promise<Array<() => Promise<AttemptResult>>> {
        const fns = await origPrepare(count);
        return fns.map((fn) => async () => {
          let last: AttemptResult = { ok: false, code: 'UNKNOWN' };
          for (let i = 0; i < 10; i += 1) {
            last = await fn();
            if (!isSerializationFailure(last)) return last;
            await new Promise((res) => setTimeout(res, 15 * (i + 1) + Math.floor(Math.random() * 25)));
          }
          return last;
        });
      },
    };
  }

  function buildHarness(flow: FlowKey): Promise<Harness> {
    switch (flow) {
      case 'W2W':
        return buildW2WHarness();
      case 'CASH_IN':
        return buildCashInHarness();
      case 'CASH_OUT':
        return buildCashOutHarness();
      case 'C2C_INIT':
        return buildC2CInitHarness();
      case 'C2C_CLAIM':
        return buildC2CClaimHarness();
      case 'CUST_FUNDING':
        return buildCustomerFundingHarness();
      case 'AGENT_FUNDING':
        return buildAgentFundingHarness('AGENT_FUNDING');
      case 'AGENT_DEFUNDING':
        return buildAgentFundingHarness('AGENT_DEFUNDING');
      default:
        throw new Error(`Unknown flow ${flow}`);
    }
  }

  async function buildW2WHarness(): Promise<Harness> {
    const source = await createCustomer({});
    const dest = await createCustomer({});
    await fundAccount(source.walletLedgerAccountId, '500000000');
    const sourceWalletId = await walletIdOf(source.customerId);
    const destWalletId = await walletIdOf(dest.customerId);
    return {
      flow: 'W2W',
      concurrency: DEFAULT_CONCURRENCY,
      product: 'WALLET_TRANSFER',
      principalType: 'CUSTOMER',
      direction: 'OUTGOING',
      incoming: false,
      principalId: source.customerId,
      principalWalletLedgerAccountId: source.walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        const idem = key ?? `l5-w2w-${randomUUID()}`;
        try {
          const view = await transferService.createTransfer({
            sourceWalletId,
            destinationWalletId: destWalletId,
            amountMinor,
            currency: 'NGN',
            idempotencyKey: idem,
          } as any);
          return { ok: true, raw: view };
        } catch (e) {
          return { ok: false, code: errorCodeOf(e) };
        }
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        const second = await this.attempt(amountMinor, key);
        if (second.ok && first.raw?.id) second.replayed = second.raw?.id === first.raw.id;
        return second;
      },
      async prepareConcurrent(count: number) {
        return Array.from({ length: count }, () => () => this.attempt('30000'));
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [source.walletLedgerAccountId]);
      },
    };
  }

  async function walletIdOf(customerId: string): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1 AND currency='NGN' LIMIT 1`, [customerId]);
    return rows[0].id;
  }

  async function buildCashInHarness(): Promise<Harness> {
    const { agentId, walletLedgerAccountId: agentWalletLedgerAccountId } = await createAgent([AgentService.CASH_IN]);
    await fundAccount(agentWalletLedgerAccountId, '500000000'); // agent pays cash in; fund generously up-front
    const recipient = await createCustomer({ phone: randPhone() });
    return {
      flow: 'CASH_IN',
      concurrency: DEFAULT_CONCURRENCY,
      product: 'CASH_TO_WALLET',
      principalType: 'CUSTOMER',
      direction: 'INCOMING',
      incoming: true,
      principalId: recipient.customerId,
      principalWalletLedgerAccountId: recipient.walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        try {
          const res = await cashInService.execute({
            agentId,
            principal: agentPrincipal(agentId),
            pin: '1234',
            recipientIdentifier: recipient.phone!,
            amountMinor,
            currency: 'NGN',
            idempotencyKey: key ?? `l5-ci-${randomUUID()}`,
          } as any);
          return { ok: true, replayed: res.replayed, raw: res };
        } catch (e) {
          return { ok: false, code: errorCodeOf(e) };
        }
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        return this.attempt(amountMinor, key);
      },
      async prepareConcurrent(count: number) {
        return Array.from({ length: count }, () => () => this.attempt('30000'));
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [recipient.walletLedgerAccountId]);
      },
    };
  }

  async function buildCashOutHarness(): Promise<Harness> {
    const { agentId } = await createAgent([AgentService.CASH_OUT]);
    const payer = await createCustomer({ phone: randPhone(), withPin: true });
    await fundAccount(payer.walletLedgerAccountId, '500000000');
    await createMfaChallenge(payer.customerId); // pre-warm enrollment/method/credential so concurrent attempts only issue challenges
    return {
      flow: 'CASH_OUT',
      concurrency: MFA_CONCURRENCY,
      product: 'WALLET_TO_CASH',
      principalType: 'CUSTOMER',
      direction: 'OUTGOING',
      incoming: false,
      principalId: payer.customerId,
      principalWalletLedgerAccountId: payer.walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        try {
          const { challengeId, otp } = await createMfaChallenge(payer.customerId);
          const res = await cashOutService.execute({
            agentId,
            agentPrincipal: agentPrincipal(agentId),
            agentPin: '1234',
            customerId: payer.customerId,
            customerPin: '1234',
            mfaChallengeId: challengeId,
            otp,
            amountMinor,
            currency: 'NGN',
            idempotencyKey: key ?? `l5-co-${randomUUID()}`,
          } as any);
          return { ok: true, replayed: res.replayed, raw: res };
        } catch (e) {
          return { ok: false, code: errorCodeOf(e) };
        }
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        return this.attempt(amountMinor, key);
      },
      async prepareConcurrent(count: number) {
        // Challenge is created INSIDE each closure so a serialization-retry gets a fresh OTP.
        return Array.from({ length: count }, () => async () => {
          try {
            const { challengeId, otp } = await createMfaChallenge(payer.customerId);
            const res = await cashOutService.execute({
              agentId,
              agentPrincipal: agentPrincipal(agentId),
              agentPin: '1234',
              customerId: payer.customerId,
              customerPin: '1234',
              mfaChallengeId: challengeId,
              otp,
              amountMinor: '30000',
              currency: 'NGN',
              idempotencyKey: `l5-co-c-${randomUUID()}`,
            } as any);
            return { ok: true, replayed: res.replayed, raw: res } as AttemptResult;
          } catch (e) {
            console.error('DBG_CO3', JSON.stringify({code:(e as any)?.code, msg:(e as any)?.message, detail:(e as any)?.detail}));
            return { ok: false, code: errorCodeOf(e) } as AttemptResult;
          }
        });
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [payer.walletLedgerAccountId]);
      },
    };
  }

  async function buildC2CInitHarness(): Promise<Harness> {
    const { agentId, walletLedgerAccountId } = await createAgent([AgentService.CASH_TO_CASH]);
    await fundAccount(walletLedgerAccountId, '500000000');
    const beneficiaryPhone = randPhone(); // stable across attempts so replays carry an identical request hash
    return {
      flow: 'C2C_INIT',
      concurrency: DEFAULT_CONCURRENCY,
      product: 'CASH_TO_CASH',
      principalType: 'AGENT',
      direction: 'OUTGOING',
      incoming: false,
      principalId: agentId,
      principalWalletLedgerAccountId: walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        try {
          const res = await cashToCashService.execute({
            agentId,
            agentPrincipal: agentPrincipal(agentId),
            agentPin: '1234',
            beneficiaryPhone,
            amountMinor,
            currency: 'NGN',
            idempotencyKey: key ?? `l5-c2c-${randomUUID()}`,
          } as any);
          return { ok: true, replayed: res.replayed, raw: res };
        } catch (e) {
          return { ok: false, code: errorCodeOf(e) };
        }
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        return this.attempt(amountMinor, key);
      },
      async prepareConcurrent(count: number) {
        return Array.from({ length: count }, () => () => this.attempt('30000'));
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [walletLedgerAccountId]);
      },
    };
  }

  async function buildC2CClaimHarness(): Promise<Harness> {
    // Initiating agent carries NO limit assignment — the limit under test belongs to the
    // beneficiary CUSTOMER on claim (INCOMING side of CASH_TO_CASH).
    const { agentId, walletLedgerAccountId } = await createAgent([AgentService.CASH_TO_CASH]);
    await fundAccount(walletLedgerAccountId, '500000000');
    const beneficiary = await createCustomer({ phone: randPhone() });
    await createMfaChallenge(beneficiary.customerId); // pre-warm enrollment/method/credential for concurrent claims

    async function initiate(amountMinor: string): Promise<{ transferId: string; transferCode: string }> {
      const res = await cashToCashService.execute({
        agentId,
        agentPrincipal: agentPrincipal(agentId),
        agentPin: '1234',
        beneficiaryPhone: beneficiary.phone!,
        amountMinor,
        currency: 'NGN',
        idempotencyKey: `l5-c2c-init-${randomUUID()}`,
      } as any);
      if (res.status !== 'COMPLETED') throw new Error(`c2c init failed: ${JSON.stringify(res)}`);
      return { transferId: res.transferId, transferCode: res.transferCode! };
    }

    async function claim(transferId: string, transferCode: string, amountMinor: string, key: string): Promise<AttemptResult> {
      try {
        const { challengeId, otp } = await createMfaChallenge(beneficiary.customerId);
        const res = await claimService.execute({
          transferId,
          beneficiaryPhone: beneficiary.phone!,
          transferCode,
          customerId: beneficiary.customerId,
          mfaChallengeId: challengeId,
          otp,
          idempotencyKey: key,
        } as any);
        return { ok: true, replayed: res.replayed, raw: res };
      } catch (e) {
        return { ok: false, code: errorCodeOf(e) };
      }
    }

    let lastInit: { transferId: string; transferCode: string } | null = null;
    let lastKey: string | null = null;

    return {
      flow: 'C2C_CLAIM',
      concurrency: MFA_CONCURRENCY,
      product: 'CASH_TO_CASH',
      principalType: 'CUSTOMER',
      direction: 'INCOMING',
      incoming: true,
      principalId: beneficiary.customerId,
      principalWalletLedgerAccountId: beneficiary.walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        const k = key ?? `l5-claim-${randomUUID()}`;
        lastInit = await initiate(amountMinor);
        lastKey = k;
        return claim(lastInit.transferId, lastInit.transferCode, amountMinor, k);
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        // Replay the same claim (same transfer + same idempotency key) — no new initiation.
        if (!lastInit) throw new Error('no claim to replay');
        return claim(lastInit.transferId, lastInit.transferCode, amountMinor, key);
      },
      async prepareConcurrent(count: number) {
        const inits: Array<{ transferId: string; transferCode: string }> = [];
        for (let i = 0; i < count; i += 1) inits.push(await initiate('30000'));
        return inits.map((init) => () => claim(init.transferId, init.transferCode, '30000', `l5-claim-c-${randomUUID()}`));
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [beneficiary.walletLedgerAccountId]);
      },
    };
  }

  async function buildCustomerFundingHarness(): Promise<Harness> {
    const customer = await createCustomer({});
    // stable across attempts so idempotent replays carry an identical request hash
    const externalReference = `EXT-${randomUUID().slice(0, 8)}`;

    async function createAndApprove(amountMinor: string, makerKey: string): Promise<{ result: AttemptResult; requestId?: string }> {
      let requestId: string;
      try {
        const created = await customerFundingService.createRequest({
          customerId: customer.customerId,
          amountMinor,
          currency: 'NGN',
          externalReference,
          channel: 'FUNDING_ACCOUNT_GT',
          description: 'matrix',
          idempotencyKey: makerKey,
          principal: supportMaker,
        } as any);
        requestId = created.id;
      } catch (e) {
        return { result: { ok: false, code: errorCodeOf(e) } };
      }
      try {
        const approved = await customerFundingService.approve({ fundingRequestId: requestId, principal: operatorChecker } as any);
        return { result: { ok: true, raw: approved }, requestId };
      } catch (e) {
        return { result: { ok: false, code: errorCodeOf(e) }, requestId };
      }
    }

    let lastRequestId: string | undefined;

    return {
      flow: 'CUST_FUNDING',
      concurrency: DEFAULT_CONCURRENCY,
      product: 'CUSTOMER_FUNDING',
      principalType: 'CUSTOMER',
      direction: 'INCOMING',
      incoming: true,
      principalId: customer.customerId,
      principalWalletLedgerAccountId: customer.walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        const { result, requestId } = await createAndApprove(amountMinor, key ?? `l5-cf-${randomUUID()}`);
        lastRequestId = requestId ?? lastRequestId;
        return result;
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        // Replay the maker request (same idempotency key → same request) then re-approve:
        // the approve is one-shot, so a 409 ALREADY-APPROVED is the expected replay outcome.
        const created = await customerFundingService.createRequest({
          customerId: customer.customerId,
          amountMinor,
          currency: 'NGN',
          externalReference,
          channel: 'FUNDING_ACCOUNT_GT',
          description: 'matrix replay',
          idempotencyKey: key,
          principal: supportMaker,
        } as any);
        try {
          await customerFundingService.approve({ fundingRequestId: created.id, principal: operatorChecker } as any);
          return { ok: true, replayed: true };
        } catch (e) {
          return { ok: false, code: errorCodeOf(e), replayed: true };
        }
      },
      async prepareConcurrent(count: number) {
        const requestIds: string[] = [];
        for (let i = 0; i < count; i += 1) {
          const created = await customerFundingService.createRequest({
            customerId: customer.customerId,
            amountMinor: '30000',
            currency: 'NGN',
            externalReference: `EXT-${randomUUID().slice(0, 8)}`,
            channel: 'FUNDING_ACCOUNT_GT',
            description: 'matrix concurrent',
            idempotencyKey: `l5-cf-c-${randomUUID()}`,
            principal: supportMaker,
          } as any);
          requestIds.push(created.id);
        }
        return requestIds.map((fundingRequestId) => async () => {
          try {
            const approved = await customerFundingService.approve({ fundingRequestId, principal: operatorChecker } as any);
            return { ok: true, raw: approved } as AttemptResult;
          } catch (e) {
            return { ok: false, code: errorCodeOf(e) } as AttemptResult;
          }
        });
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [customer.walletLedgerAccountId]);
      },
    };
  }

  async function buildAgentFundingHarness(kind: 'AGENT_FUNDING' | 'AGENT_DEFUNDING'): Promise<Harness> {
    const { agentId, walletLedgerAccountId } = await createAgent([AgentService.CASH_IN, AgentService.CASH_OUT, AgentService.CASH_TO_CASH, AgentService.AGENT_FUNDING, AgentService.AGENT_DEFUNDING]);
    const isFund = kind === 'AGENT_FUNDING';
    if (!isFund) {
      // defunding needs pre-existing balance; fund via the funding service WITHOUT any limit
      // assignment in place yet (assignments are seeded per-case after harness creation).
      await agentFundingService.fund({ agentId, amountMinor: '500000000', currency: 'NGN', idempotencyKey: `l5-seed-fund-${randomUUID()}`, principal: privilegedPrincipal, actor: 'matrix' } as any);
    }
    return {
      flow: kind === 'AGENT_FUNDING' ? 'AGENT_FUNDING' : 'AGENT_DEFUNDING',
      concurrency: DEFAULT_CONCURRENCY,
      product: kind,
      principalType: 'AGENT',
      direction: isFund ? 'INCOMING' : 'OUTGOING',
      incoming: isFund,
      principalId: agentId,
      principalWalletLedgerAccountId: walletLedgerAccountId,
      async attempt(amountMinor: string, key?: string): Promise<AttemptResult> {
        try {
          const res = isFund
            ? await agentFundingService.fund({ agentId, amountMinor, currency: 'NGN', idempotencyKey: key ?? `l5-af-${randomUUID()}`, principal: privilegedPrincipal, actor: 'matrix' } as any)
            : await agentFundingService.defund({ agentId, amountMinor, currency: 'NGN', idempotencyKey: key ?? `l5-ad-${randomUUID()}`, principal: privilegedPrincipal, actor: 'matrix' } as any);
          return { ok: true, replayed: (res as any).replayed === true, raw: res };
        } catch (e) {
          return { ok: false, code: errorCodeOf(e) };
        }
      },
      async replay(amountMinor: string, key: string, first: AttemptResult): Promise<AttemptResult> {
        return this.attempt(amountMinor, key);
      },
      async prepareConcurrent(count: number) {
        return Array.from({ length: count }, () => () => this.attempt('30000'));
      },
      async deactivatePrincipalWallet() {
        await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [walletLedgerAccountId]);
      },
    };
  }

  // ───────────────────────── helpers shared by cases ─────────────────────────

  async function seedRulesFor(h: Harness, profileCode: string, rules: RuleSeed[], kind?: string): Promise<void> {
    await seedProfile(profileCode, kind ?? h.principalType, true);
    await seedAssignment({ profileCode, subjectType: h.principalType, subjectId: h.principalId });
    for (const r of rules) await seedRule(profileCode, r, h.product);
  }

  function profileCodeFor(flow: FlowKey, caseName: string): string {
    return `L5_${flow}_${caseName}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  }

  // ───────────────────────── the regression matrix ─────────────────────────

  interface CaseDef {
    name: string;
    incomingOnly?: boolean;
    run(h: Harness): Promise<void>;
  }

  const FLOWS: FlowKey[] = ['W2W', 'CASH_IN', 'CASH_OUT', 'C2C_INIT', 'C2C_CLAIM', 'CUST_FUNDING', 'AGENT_FUNDING', 'AGENT_DEFUNDING'];

  const CASES: CaseDef[] = [
    {
      name: 'no-applicable-limit',
      async run(h) {
        // No assignment at all → unlimited, no usage rows created for this product.
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        const usages = await usageRowsFor(h.principalId, h.product);
        expect(usages.length).toBe(0);
      },
    },
    {
      name: 'within-limit',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'within'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '1000000' }]);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        const usages = await usageRowsFor(h.principalId, h.product);
        const daily = usages.find((u) => u.dimension === 'DAILY_AMOUNT');
        expect(daily).toBeDefined();
        expect(daily.used_amount_minor).toBe('50000');
        expect(daily.reserved_amount_minor).toBe('0');
      },
    },
    {
      name: 'exactly-at-limit',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'exact'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '50000' }]);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        const usages = await usageRowsFor(h.principalId, h.product);
        expect(usages.find((u) => u.dimension === 'DAILY_AMOUNT').used_amount_minor).toBe('50000');
      },
    },
    {
      name: 'one-unit-above-limit',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'oneover'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '50000' }]);
        const res = await h.attempt('50001');
        expect(res.ok).toBe(false);
        expect(res.code).toBe('LIMIT_DAILY_AMOUNT_EXCEEDED');
        const usages = await usageRowsFor(h.principalId, h.product);
        for (const u of usages) {
          expect(u.used_amount_minor).toBe('0');
          expect(u.reserved_amount_minor).toBe('0');
        }
      },
    },
    {
      name: 'below-min-amount-per-tx',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'min'), [{ dimension: 'MIN_AMOUNT_PER_TX', limitMinor: '10000' }]);
        const res = await h.attempt('5000');
        expect(res.ok).toBe(false);
        expect(res.code).toBe('LIMIT_MIN_AMOUNT_NOT_MET');
      },
    },
    {
      name: 'above-max-amount-per-tx',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'max'), [{ dimension: 'MAX_AMOUNT_PER_TX', limitMinor: '10000' }]);
        const res = await h.attempt('20000');
        expect(res.ok).toBe(false);
        expect(res.code).toBe('LIMIT_MAX_AMOUNT_EXCEEDED');
      },
    },
    {
      name: 'daily-amount-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'damt'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '100000' }]);
        expect((await h.attempt('60000')).ok).toBe(true);
        const second = await h.attempt('50000');
        expect(second.ok).toBe(false);
        expect(second.code).toBe('LIMIT_DAILY_AMOUNT_EXCEEDED');
      },
    },
    {
      name: 'weekly-amount-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'wamt'), [{ dimension: 'WEEKLY_AMOUNT', limitMinor: '100000' }]);
        expect((await h.attempt('60000')).ok).toBe(true);
        const second = await h.attempt('50000');
        expect(second.ok).toBe(false);
        expect(second.code).toBe('LIMIT_WEEKLY_AMOUNT_EXCEEDED');
      },
    },
    {
      name: 'monthly-amount-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'mamt'), [{ dimension: 'MONTHLY_AMOUNT', limitMinor: '100000' }]);
        expect((await h.attempt('60000')).ok).toBe(true);
        const second = await h.attempt('50000');
        expect(second.ok).toBe(false);
        expect(second.code).toBe('LIMIT_MONTHLY_AMOUNT_EXCEEDED');
      },
    },
    {
      name: 'yearly-amount-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'yamt'), [{ dimension: 'YEARLY_AMOUNT', limitMinor: '100000' }]);
        expect((await h.attempt('60000')).ok).toBe(true);
        const second = await h.attempt('50000');
        expect(second.ok).toBe(false);
        expect(second.code).toBe('LIMIT_YEARLY_AMOUNT_EXCEEDED');
      },
    },
    {
      name: 'daily-count-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'dcnt'), [{ dimension: 'DAILY_COUNT', limitCount: 2 }]);
        expect((await h.attempt('1000')).ok).toBe(true);
        expect((await h.attempt('1000')).ok).toBe(true);
        const third = await h.attempt('1000');
        expect(third.ok).toBe(false);
        expect(third.code).toBe('LIMIT_DAILY_COUNT_EXCEEDED');
      },
    },
    {
      name: 'weekly-count-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'wcnt'), [{ dimension: 'WEEKLY_COUNT', limitCount: 2 }]);
        expect((await h.attempt('1000')).ok).toBe(true);
        expect((await h.attempt('1000')).ok).toBe(true);
        const third = await h.attempt('1000');
        expect(third.ok).toBe(false);
        expect(third.code).toBe('LIMIT_WEEKLY_COUNT_EXCEEDED');
      },
    },
    {
      name: 'monthly-count-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'mcnt'), [{ dimension: 'MONTHLY_COUNT', limitCount: 2 }]);
        expect((await h.attempt('1000')).ok).toBe(true);
        expect((await h.attempt('1000')).ok).toBe(true);
        const third = await h.attempt('1000');
        expect(third.ok).toBe(false);
        expect(third.code).toBe('LIMIT_MONTHLY_COUNT_EXCEEDED');
      },
    },
    {
      name: 'yearly-count-exceeded',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'ycnt'), [{ dimension: 'YEARLY_COUNT', limitCount: 2 }]);
        expect((await h.attempt('1000')).ok).toBe(true);
        expect((await h.attempt('1000')).ok).toBe(true);
        const third = await h.attempt('1000');
        expect(third.ok).toBe(false);
        expect(third.code).toBe('LIMIT_YEARLY_COUNT_EXCEEDED');
      },
    },
    {
      name: 'multiple-simultaneous-limits',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'multi'), [
          { dimension: 'DAILY_AMOUNT', limitMinor: '100000' },
          { dimension: 'DAILY_COUNT', limitCount: 1 },
          { dimension: 'MAX_AMOUNT_PER_TX', limitMinor: '500000' },
        ]);
        expect((await h.attempt('60000')).ok).toBe(true);
        const second = await h.attempt('45000'); // breaches count(>1) AND amount(105000>100000)
        expect(second.ok).toBe(false);
        expect(['LIMIT_DAILY_COUNT_EXCEEDED', 'LIMIT_DAILY_AMOUNT_EXCEEDED']).toContain(second.code);
        const usages = await usageRowsFor(h.principalId, h.product);
        const daily = usages.find((u) => u.dimension === 'DAILY_AMOUNT');
        expect(daily.used_amount_minor).toBe('60000'); // failed attempt consumed nothing
      },
    },
    {
      name: 'concurrent-boundary',
      async run(h) {
        const c = h.concurrency;
        await seedRulesFor(h, profileCodeFor(h.flow, 'conc'), [{ dimension: 'DAILY_AMOUNT', limitMinor: c.limit }]);
        const attempts = await h.prepareConcurrent(c.count);
        const results = await Promise.all(attempts.map((fn) => fn()));
        const successes = results.filter((r) => r.ok).length;
        // c.count concurrent attempts of c.amount against a c.limit daily cap → exactly c.expectedOk commit
        expect(successes).toBe(c.expectedOk);
        const failures = results.filter((r) => !r.ok);
        for (const f of failures) expect(f.code).toBe('LIMIT_DAILY_AMOUNT_EXCEEDED');
        const usages = await usageRowsFor(h.principalId, h.product);
        const daily = usages.find((u) => u.dimension === 'DAILY_AMOUNT');
        expect(daily.used_amount_minor).toBe(c.expectedUsed);
        expect(daily.reserved_amount_minor).toBe('0');
      },
    },
    {
      name: 'idempotent-replay',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'replay'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '1000000' }]);
        const key = `l5-replay-${h.flow}-${randomUUID()}`;
        const first = await h.attempt('40000', key);
        expect(first.ok).toBe(true);
        const second = await h.replay('40000', key, first);
        if (h.flow === 'CUST_FUNDING') {
          // approve is one-shot: replay surfaces as already-approved conflict; limit must NOT be consumed twice
          expect(second.ok).toBe(false);
        } else {
          expect(second.ok).toBe(true);
        }
        const usages = await usageRowsFor(h.principalId, h.product);
        const daily = usages.find((u) => u.dimension === 'DAILY_AMOUNT');
        expect(daily.used_amount_minor).toBe('40000'); // consumed exactly once
      },
    },
    {
      name: 'failed-financial-execution-releases-reservation',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'failrel'), [{ dimension: 'DAILY_COUNT', limitCount: 5 }]);
        await h.deactivatePrincipalWallet(); // ledger rejects after reservation → release path
        const res = await h.attempt('1000');
        expect(res.ok).toBe(false);
        const usages = await usageRowsFor(h.principalId, h.product);
        for (const u of usages) {
          expect(u.used_count).toBe(0);
          expect(u.used_amount_minor).toBe('0');
          expect(u.reserved_count).toBe(0);
          expect(u.reserved_amount_minor).toBe('0');
        }
        const reservations = await reservationRowsFor(h.principalId);
        expect(reservations.filter((r) => r.status === 'RESERVED').length).toBe(0);
      },
    },
    {
      name: 'successful-execution-commits-reservations',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'commit'), [
          { dimension: 'DAILY_AMOUNT', limitMinor: '1000000' },
          { dimension: 'DAILY_COUNT', limitCount: 10 },
        ]);
        const key = `l5-commit-${h.flow}-${randomUUID()}`;
        const res = await h.attempt('25000', key);
        expect(res.ok).toBe(true);
        // Customer Funding keys its limit reservations on `customer-funding-approve:{requestId}`,
        // not the maker idempotency key — look them up by principal instead.
        const reservations = h.flow === 'CUST_FUNDING'
          ? await reservationRowsFor(h.principalId)
          : await reservationRowsFor(h.principalId, key);
        expect(reservations.length).toBeGreaterThan(0);
        for (const r of reservations) expect(r.status).toBe('COMMITTED');
        const usages = await usageRowsFor(h.principalId, h.product);
        for (const u of usages) {
          expect(u.reserved_amount_minor).toBe('0');
          expect(u.reserved_count).toBe(0);
        }
      },
    },
    {
      name: 'product-isolation',
      async run(h) {
        const otherProduct = h.product === 'WALLET_TRANSFER' ? 'CASH_TO_WALLET' : 'WALLET_TRANSFER';
        await seedRulesFor(h, profileCodeFor(h.flow, 'prodiso'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '10', product: otherProduct }]);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true); // rule belongs to another product → not applicable
        const usages = await usageRowsFor(h.principalId, h.product);
        expect(usages.length).toBe(0);
      },
    },
    {
      name: 'principal-isolation',
      async run(h) {
        const profile = profileCodeFor(h.flow, 'prisolo');
        await seedProfile(profile, h.principalType, true);
        await seedAssignment({ profileCode: profile, subjectType: h.principalType, subjectId: randomUUID() }); // somebody else
        await seedRule(profile, { dimension: 'DAILY_AMOUNT', limitMinor: '10' }, h.product);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        const usages = await usageRowsFor(h.principalId, h.product);
        expect(usages.length).toBe(0);
      },
    },
    {
      name: 'future-effective-rule-ignored',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'future'), [
          { dimension: 'DAILY_AMOUNT', limitMinor: '10', effectiveFrom: new Date(Date.now() + 2 * 86400000).toISOString() },
        ]);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        const usages = await usageRowsFor(h.principalId, h.product);
        expect(usages.length).toBe(0);
      },
    },
    {
      name: 'disabled-rule-ignored',
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'disrule'), [{ dimension: 'DAILY_AMOUNT', limitMinor: '10', isActive: false }]);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        const usages = await usageRowsFor(h.principalId, h.product);
        expect(usages.length).toBe(0);
      },
    },
    {
      name: 'disabled-profile-allows',
      async run(h) {
        const profile = profileCodeFor(h.flow, 'disprof');
        await seedProfile(profile, h.principalType, false); // enabled=false
        await seedAssignment({ profileCode: profile, subjectType: h.principalType, subjectId: h.principalId });
        await seedRule(profile, { dimension: 'DAILY_AMOUNT', limitMinor: '10' }, h.product);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true); // disabled profile → unresolved → unlimited
      },
    },
    {
      name: 'assignment-precedence',
      async run(h) {
        // Higher-precedence permissive profile must win over lower-precedence blocking one.
        const permissive = profileCodeFor(h.flow, 'prec_hi');
        const blocking = profileCodeFor(h.flow, 'prec_lo');
        await seedProfile(permissive, h.principalType, true);
        await seedProfile(blocking, h.principalType, true);
        await seedAssignment({ profileCode: permissive, subjectType: h.principalType, subjectId: h.principalId, precedence: 100 });
        await seedAssignment({ profileCode: blocking, subjectType: h.principalType, subjectId: h.principalId, precedence: 1 });
        await seedRule(blocking, { dimension: 'DAILY_AMOUNT', limitMinor: '10' }, h.product);
        const res = await h.attempt('50000');
        expect(res.ok).toBe(true);
        // usage, if any, must be against the permissive (higher-precedence) profile only
        const rows: any[] = await dataSource.query(`SELECT limit_profile_code FROM limit_usages WHERE principal_id=$1`, [h.principalId]);
        for (const r of rows) expect(r.limit_profile_code).toBe(permissive);
      },
    },
    {
      name: 'wallet-balance-max-incoming',
      incomingOnly: true,
      async run(h) {
        await seedRulesFor(h, profileCodeFor(h.flow, 'balmax'), [{ dimension: 'WALLET_BALANCE_MAX', limitMinor: '50000' }]);
        await fundAccount(h.principalWalletLedgerAccountId, '40000');
        const over = await h.attempt('20000'); // 40000 + 20000 > 50000
        expect(over.ok).toBe(false);
        expect(over.code).toBe('LIMIT_WALLET_BALANCE_EXCEEDED');
        const within = await h.attempt('10000'); // 40000 + 10000 ≤ 50000
        expect(within.ok).toBe(true);
      },
    },
  ];

  // ───────────────────────── generate the matrix ─────────────────────────

  for (const flow of FLOWS) {
    describe(`${flow} flow`, () => {
      for (const c of CASES) {
        if (c.incomingOnly && !['CASH_IN', 'C2C_CLAIM', 'CUST_FUNDING', 'AGENT_FUNDING'].includes(flow)) {
          continue; // WALLET_BALANCE_MAX is credit-side only — not semantically applicable to outgoing flows
        }
        it(`${flow} ${c.name}`, async () => {
          const h = wrapWithRetry(await buildHarness(flow));
          await c.run(h);
        }, 120000);
      }
    });
  }

  // ───────────────────────── PART 4 coverage: failure-code union ─────────────────────────

  it('TransferFailureCode includes the complete stable LIMIT_* union (type safety)', async () => {
    const { TransferFailureCode } = await import('../src/transfer/transfer.enums');
    const { LimitFailureCode } = await import('../src/limit-catalog/limit-error.codes');
    for (const value of Object.values(LimitFailureCode)) {
      expect(Object.values(TransferFailureCode)).toContain(value);
      expect(TransferFailureCode[value as keyof typeof TransferFailureCode]).toBe(value);
    }
    // No stable code renamed
    expect(TransferFailureCode.LIMIT_MIN_AMOUNT_NOT_MET).toBe('LIMIT_MIN_AMOUNT_NOT_MET');
    expect(TransferFailureCode.LIMIT_RESERVATION_FAILED).toBe('LIMIT_RESERVATION_FAILED');
    // W2W failureCode is persisted as a typed LIMIT_* member
    const h = wrapWithRetry(await buildHarness('W2W'));
    await seedRulesFor(h, profileCodeFor('W2W', 'typefail'), [{ dimension: 'MIN_AMOUNT_PER_TX', limitMinor: '100000' }]);
    const res = await h.attempt('5000');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('LIMIT_MIN_AMOUNT_NOT_MET');
    const rows: Array<{ failure_code: string }> = await dataSource.query(
      `SELECT failure_code FROM transfers WHERE failure_code LIKE 'LIMIT_%' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]?.failure_code).toBe('LIMIT_MIN_AMOUNT_NOT_MET');
  });
});
