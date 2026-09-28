/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-DECISION-03C — CASH_TO_CASH commercial snapshot wiring (real PostgreSQL).
 *
 * Wires BOTH operations of the CASH_TO_CASH domain, kept explicitly separate under the ONE
 * canonical product code CASH_TO_CASH:
 *   - INITIATION (AgentCashToCashService): Agent electronic value → reserved/unclaimed funds;
 *     snapshot identity AGENT / OUTGOING
 *   - CLAIM (AgentCashToCashClaimService): reserved/unclaimed funds → recipient Customer wallet;
 *     snapshot identity CUSTOMER / INCOMING
 * Each snapshot is recorded inside THAT operation's own existing SERIALIZABLE transaction via
 * resolveWithManager + recordDecisionWithManager (never recordDecision, never async).
 *
 * Verified: success atomicity ×2, rollback atomicity ×2 (forced real in-transaction failure),
 * replay ×2, key clash ×2, limit rejection ×2, NOT_CONFIGURED fee (never ZERO), synthetic
 * TEST-ONLY fee rule captured without charging on both operations, immutability ×2, wiring
 * boundary (no other flow touched), zero production fee rules.
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
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

describe('V1-COMMERCIAL-DECISION-03C CASH_TO_CASH snapshot wiring (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let mfaService: MfaExecutionService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let feeRuleRegistry: FeeRuleRegistryService;
  let systemLedgerAccountId: string;
  let unclaimedLedgerAccountId: string;
  let syntheticRuleId: string | null = null;

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
    dataSource = await createIntegrationDataSource('v1-comm-decision-03c');
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
    cashToCashService = moduleRef.get(AgentCashToCashService);
    claimService = moduleRef.get(AgentCashToCashClaimService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
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
    // Reserved/unclaimed liability account (a15 convention)
    const unclaimedRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' LIMIT 1`);
    if (unclaimedRows[0]) {
      unclaimedLedgerAccountId = unclaimedRows[0].id;
    } else {
      const acc = await ledgerService.createAccount({
        code: 'CASH_TO_CASH-UNCLAIMED-NGN',
        name: 'Cash-to-Cash Unclaimed NGN',
        accountType: LedgerAccountType.LIABILITY,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: false,
      });
      unclaimedLedgerAccountId = acc.id;
    }
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  // ── harness (synthetic test data only; mirrors a15/a16 conventions) ──

  async function createActiveAgentWithServicesAndPin(services: unknown, pin: string | null, isActive = true) {
    const cls = await classService.create({
      reference: `cls-03c-${randomUUID().slice(0, 8)}`,
      code: `C03C-${randomUUID().slice(0, 6)}`,
      name: '03C Class',
      isActive,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz 03C ${randomUUID().slice(0, 4)}`,
      contactEmail: `03c-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-03c',
    });
    await appService.submit(appEntity.id, 'applicant-03c');
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

  async function createCustomerWithPhone(phoneCanonical: string) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-03c-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0].id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'Customer 03C',true)`, [customerId]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phoneCanonical]);
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
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
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

  async function fundAgent(agentWalletLedgerId: string, amount: string) {
    await ledgerService.postJournal({
      idempotencyKey: `fund-agent-${agentWalletLedgerId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: agentWalletLedgerId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  function newPhone(): string {
    return `80${Math.floor(10000000 + Math.random() * 89999999)}`;
  }

  async function seedLimitProfile(code: string, subjectType: 'AGENT' | 'CUSTOMER', subjectId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO limit_profiles (code, name, kind, status, enabled, configuration_status, created_by) VALUES ($1,$2,$3,'ACTIVE',true,'CONFIGURED','test')`,
      [code, `Profile ${code}`, subjectType],
    );
    await dataSource.query(
      `INSERT INTO limit_assignments (id, limit_profile_code, subject_type, subject_id, segment_code, precedence, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,$4,NULL,0,$5,NULL,true,'test')`,
      [randomUUID(), code, subjectType, subjectId, new Date(Date.now() - 86400000).toISOString()],
    );
  }

  async function seedLimitRule(profileCode: string, dimension: string, limitMinor: string | null, limitCount: number | null): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO limit_rules (id, limit_profile_code, product, direction, channel, currency, dimension, limit_value_minor, limit_value_count, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'CASH_TO_CASH',NULL,NULL,'NGN',$3,$4,$5,$6,NULL,true,'test')`,
      [id, profileCode, dimension, limitMinor, limitCount, new Date(Date.now() - 86400000).toISOString()],
    );
    return id;
  }

  async function snapshotsFor(key: { journalId?: string; idempotencyKey?: string; product?: string; transferRef?: string }): Promise<any[]> {
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

  async function initiateTransfer(agent: any, phone: string, amount: string, idem?: string) {
    return cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: amount,
      currency: 'NGN',
      idempotencyKey: idem ?? `init-03c-${randomUUID()}`,
    });
  }

  // ════════════════════ INITIATION ════════════════════

  it('01. successful initiation creates exactly one snapshot (AGENT OUTGOING identity) with authoritative limit evidence; reserved/unclaimed behavior unchanged', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '100000');
    const phone = newPhone();

    const profile = `P03CA_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, 'AGENT', agent.id);
    const dailyRule = await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000', null);

    const idem = `c03c-01-${randomUUID()}`;
    const result = await initiateTransfer(agent, phone, '30000', idem);
    expect(result.status).toBe('COMPLETED');

    // reserved/unclaimed financial behavior UNCHANGED: DEBIT Agent, CREDIT Unclaimed, transfer UNCLAIMED
    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [result.journalId],
    );
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => l.direction === 'DEBIT');
    const credit = lines.find((l) => l.direction === 'CREDIT');
    expect(debit.amount_minor).toBe('30000');
    expect(debit.ledger_account_id).toBe(agentWallet.ledgerAccountId);
    expect(credit.amount_minor).toBe('30000');
    expect(credit.ledger_account_id).toBe(unclaimedLedgerAccountId);
    const transferRows: Array<any> = await dataSource.query(`SELECT status, beneficiary_phone, principal_minor::text AS principal_minor, journal_id, transfer_code_hash FROM cash_to_cash_transfers WHERE id=$1`, [result.transferId]);
    expect(transferRows[0].status).toBe('UNCLAIMED');
    expect(transferRows[0].beneficiary_phone).toBe(phone);
    expect(transferRows[0].journal_id).toBe(result.journalId);
    expect(transferRows[0].transfer_code_hash).toMatch(/^PBKDF2\$/); // code security preserved
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('70000');
    expect((await ledgerService.getAccountBalance(unclaimedLedgerAccountId)).balanceMinor).toBe('30000');

    // exactly one snapshot describing the INITIATION operation
    const snapshots = await snapshotsFor({ journalId: result.journalId });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.product).toBe('CASH_TO_CASH');
    expect(snap.transaction_reference).toBe(result.journalId);
    expect(snap.journal_id).toBe(result.journalId);
    expect(snap.idempotency_key).toBe(`cash-to-cash:${agent.id}:${idem}`);
    expect(snap.principal_type).toBe('AGENT'); // initiation identity
    expect(snap.principal_id).toBe(agent.id);
    expect(snap.direction).toBe('OUTGOING'); // authoritative limit direction
    expect(snap.currency).toBe('NGN');
    expect(snap.principal_amount_minor.toString()).toBe('30000');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.created_by).toBe('agent-cash-to-cash');
    expect(snap.revenue_decision).toBeNull();
    expect(snap.configuration_version).toBeNull();
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.feeMinor).toBe('0');
    expect(snap.fee_decision.totalMinor).toBe('30000');
    expect(snap.fee_decision.ruleRefs).toEqual([]);
    expect(snap.fee_decision.agentId).toBe(agent.id);
    expect(snap.fee_decision.transferId).toBe(result.transferId);
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    expect(snap.limit_decision.ruleRefs.map((r: any) => r.ruleId)).toEqual([dailyRule]);
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [idem]);
    expect(reservations.length).toBe(1);
    expect(snap.limit_decision.reservationIds).toEqual(reservations.map((r) => r.id));
    expect(snap.limit_decision.usageIds).toEqual(reservations.map((r) => r.limit_usage_id));
  });

  it('02. initiation replay: REPLAYED, same journal/transfer, exactly ONE snapshot, no duplicate reserved value', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const idem = `c03c-02-${randomUUID()}`;
    const first = await initiateTransfer(agent, phone, '15000', idem);
    expect(first.status).toBe('COMPLETED');
    const journalsAfterFirst: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    const unclaimedAfterFirst = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);

    const replay = await initiateTransfer(agent, phone, '15000', idem);
    expect(replay.replayed).toBe(true);
    expect(replay.journalId).toBe(first.journalId);
    expect(replay.transferCode).toBeUndefined(); // one-time code never replayed

    expect(await snapshotsFor({ journalId: first.journalId })).toHaveLength(1); // NOT duplicated
    const journalsAfterReplay: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterReplay[0].cnt).toBe(journalsAfterFirst[0].cnt); // no duplicate journal
    expect((await ledgerService.getAccountBalance(unclaimedLedgerAccountId)).balanceMinor).toBe(unclaimedAfterFirst.balanceMinor); // reserved once
  });

  it('03. initiation key clash: same key different payload rejected (409)', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const idem = `c03c-03-${randomUUID()}`;
    const first = await initiateTransfer(agent, phone, '10000', idem);
    expect(first.status).toBe('COMPLETED');
    await expect(initiateTransfer(agent, phone, '10001', idem)).rejects.toMatchObject({ status: 409 });
    expect(await snapshotsFor({ idempotencyKey: `cash-to-cash:${agent.id}:${idem}` })).toHaveLength(1);
  });

  it('04. initiation rollback: forced failure after snapshot rolls back snapshot + limits + journal + transfer; Agent position unchanged', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '70000');
    const phone = newPhone();

    const profile = `P03CA_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, 'AGENT', agent.id);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000', null);

    const journalsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    const agentBefore = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const unclaimedBefore = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const idem = `c03c-04-${randomUUID()}`;

    await expect(
      cashToCashService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        beneficiaryPhone: phone,
        amountMinor: '25000',
        currency: 'NGN',
        idempotencyKey: idem,
        _simulateFailureAfterJournal: true, // fails AFTER snapshot, BEFORE commit
      }),
    ).rejects.toThrow('Simulated failure after journal');

    expect(await snapshotsFor({ idempotencyKey: `cash-to-cash:${agent.id}:${idem}` })).toHaveLength(0); // snapshot gone
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='CASH_TO_CASH'`, [agent.id])).length).toBe(0);
    const journalsAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfter[0].cnt).toBe(journalsBefore[0].cnt); // journal gone
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe(agentBefore.balanceMinor);
    expect((await ledgerService.getAccountBalance(unclaimedLedgerAccountId)).balanceMinor).toBe(unclaimedBefore.balanceMinor); // reserved state unchanged
    expect((await dataSource.query(`SELECT id FROM cash_to_cash_transfers WHERE idempotency_key=$1`, [idem])).length).toBe(0); // transfer row gone
    expect((await dataSource.query(`SELECT id FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`, [`agent-financial.v1:${agent.id}`, idem])).length).toBe(0);
  });

  it('05. initiation limit rejection: rejected, no snapshot, no stranded reservation, no mutation', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '90000');
    const phone = newPhone();

    const profile = `P03CA_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, 'AGENT', agent.id);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '20000', null);

    const idem = `c03c-05-${randomUUID()}`;
    await expect(initiateTransfer(agent, phone, '30000', idem)).rejects.toMatchObject({ status: 422 });

    expect(await snapshotsFor({ idempotencyKey: `cash-to-cash:${agent.id}:${idem}` })).toHaveLength(0);
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [idem])).length).toBe(0);
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('90000');
    expect((await dataSource.query(`SELECT id FROM cash_to_cash_transfers WHERE idempotency_key=$1`, [idem])).length).toBe(0);
  });

  it('06. TEST-ONLY synthetic fee rule: initiation captures ruleId/version/parameters without charging; zero production rules beforehand', async () => {
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM fee_rules`);
    expect(before[0].cnt).toBe('0'); // NO production fee rules exist

    const rule = await feeRuleRegistry.createRule(
      {
        productCode: 'CASH_TO_CASH',
        currency: 'NGN',
        flatFeeMinor: '250',
        percentageBps: 15,
        minimumFeeMinor: null,
        maximumFeeMinor: null,
        vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000),
        priority: 0,
        isActive: true,
      },
      'test',
    );
    syntheticRuleId = rule.id;

    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '50000');
    const phone = newPhone();
    const result = await initiateTransfer(agent, phone, '18000');
    expect(result.status).toBe('COMPLETED');
    expect(result.feeMinor).toBe('0'); // service still charges nothing

    const snapshots = await snapshotsFor({ journalId: result.journalId });
    expect(snapshots).toHaveLength(1);
    const fee = snapshots[0].fee_decision;
    // V1-COMMERCIAL-IMPLEMENTATION-01 — RESOLVED rule now computes: floor(18000·15/10000)=27 + 250
    expect(fee.status).toBe('APPLIED');
    expect(fee.calculationModel).toBe('FLAT_PLUS_PERCENTAGE');
    expect(fee.feeMinor).toBe('277');
    expect(fee.totalMinor).toBe('18277');
    expect(fee.posting).toEqual({
      journalLegsPosted: false,
      reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
    }); // accounting boundary — journals stay principal-only (result.feeMinor '0' above)
    expect(fee.ruleRefs).toHaveLength(1);
    expect(fee.ruleRefs[0].ruleId).toBe(rule.id);
    expect(fee.ruleRefs[0].ruleVersion).toBe(1);
    expect(fee.ruleRefs[0].flatFeeMinor).toBe('250');
    expect(fee.ruleRefs[0].percentageBps).toBe(15);

    // money flow UNCHANGED: principal-only, exact reserved value
    const lines: Array<any> = await dataSource.query(`SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`, [result.journalId]);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('18000');
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe('32000');

    // V1-COMMERCIAL-IMPLEMENTATION-01 — the seeded TEST rule now has runtime effect on ALL
    // subsequent CASH_TO_CASH operations in this suite; remove it so the remaining
    // NOT_CONFIGURED-era assertion blocks stay in their authored world. Test 12 re-seeds its
    // own rule locally.
    await dataSource.query(`DELETE FROM fee_rules WHERE id=$1`, [syntheticRuleId]);
  });

  // ════════════════════ CLAIM ════════════════════

  it('07. successful claim creates exactly one ADDITIONAL snapshot (CUSTOMER INCOMING identity); recipient wallet behavior unchanged', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '20000');
    expect(init.status).toBe('COMPLETED');

    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);
    const profile = `P03CC_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, 'CUSTOMER', customerId);
    const dailyRule = await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000', null);

    const otp = 'c03c-otp-07';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claimKey = `c03c-07-claim-${randomUUID()}`;
    const unclaimedBefore = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const custBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);

    const claim = await claimService.execute({
      transferId: init.transferId,
      beneficiaryPhone: phone,
      transferCode: init.transferCode!,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: claimKey,
    });
    expect(claim.status).toBe('COMPLETED');

    // recipient wallet behavior UNCHANGED: DEBIT Unclaimed, CREDIT beneficiary, transfer CLAIMED
    const lines: Array<any> = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor, ledger_account_id FROM ledger_lines WHERE journal_id=$1 ORDER BY direction`,
      [claim.journalId],
    );
    expect(lines).toHaveLength(2);
    expect(lines.find((l: any) => l.direction === 'DEBIT').ledger_account_id).toBe(unclaimedLedgerAccountId);
    expect(lines.find((l: any) => l.direction === 'CREDIT').ledger_account_id).toBe(custWallet.ledgerAccountId);
    for (const l of lines) expect(l.amount_minor).toBe('20000');
    const transferRows: Array<any> = await dataSource.query(`SELECT status, claim_journal_id, claimant_customer_id FROM cash_to_cash_transfers WHERE id=$1`, [init.transferId]);
    expect(transferRows[0].status).toBe('CLAIMED');
    expect(transferRows[0].claim_journal_id).toBe(claim.journalId);
    expect((await ledgerService.getAccountBalance(unclaimedLedgerAccountId)).balanceMinor).toBe((BigInt(unclaimedBefore.balanceMinor) - 20000n).toString());
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe((BigInt(custBefore.balanceMinor) + 20000n).toString());

    // the initiation snapshot still exists untouched; the claim adds exactly ONE new snapshot
    expect(await snapshotsFor({ journalId: init.journalId })).toHaveLength(1);
    const claimSnaps = await snapshotsFor({ journalId: claim.journalId });
    expect(claimSnaps).toHaveLength(1);
    const snap = claimSnaps[0];
    expect(snap.product).toBe('CASH_TO_CASH'); // ONE canonical product code — no CASH_TO_CASH_CLAIM invented
    expect(snap.transaction_reference).toBe(claim.journalId);
    expect(snap.journal_id).toBe(claim.journalId);
    expect(snap.idempotency_key).toBe(`cash-to-cash-claim:${init.transferId}:${claimKey}`);
    expect(snap.principal_type).toBe('CUSTOMER'); // claim identity
    expect(snap.principal_id).toBe(customerId);
    expect(snap.direction).toBe('INCOMING'); // authoritative claim limit direction
    expect(snap.currency).toBe('NGN');
    expect(snap.principal_amount_minor.toString()).toBe('20000');
    expect(snap.decision_status).toBe('FINAL');
    expect(snap.created_by).toBe('agent-cash-to-cash-claim');
    expect(snap.fee_decision.status).toBe('NOT_CONFIGURED');
    expect(snap.fee_decision.totalMinor).toBe('20000');
    expect(snap.fee_decision.transferId).toBe(init.transferId);
    expect(snap.commission_decision).toEqual({ status: 'NONE', allocations: [], ruleRefs: [] });
    expect(snap.reward_decision).toEqual({ status: 'NONE', grants: [], ruleRefs: [] });
    expect(snap.limit_decision.status).toBe('APPROVED');
    expect(snap.limit_decision.profileCode).toBe(profile);
    expect(snap.limit_decision.ruleRefs.map((r: any) => r.ruleId)).toEqual([dailyRule]);
    const reservations: Array<any> = await dataSource.query(`SELECT id, limit_usage_id FROM limit_reservations WHERE idempotency_key=$1 ORDER BY id`, [claimKey]);
    expect(reservations.length).toBe(1);
    expect(snap.limit_decision.reservationIds).toEqual(reservations.map((r) => r.id));
    expect(snap.limit_decision.usageIds).toEqual(reservations.map((r) => r.limit_usage_id));
  });

  it('08. claim replay: REPLAYED via natural OTP accommodation, exactly ONE claim snapshot, no duplicate credit/journal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '12000');
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);
    const otp = 'c03c-otp-08';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claimKey = `c03c-08-claim-${randomUUID()}`;
    const payload = {
      transferId: init.transferId,
      beneficiaryPhone: phone,
      transferCode: init.transferCode!,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: claimKey,
    };
    const first = await claimService.execute(payload);
    expect(first.status).toBe('COMPLETED');
    const journalsAfterFirst: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);

    // Genuine idempotent retry: same challenge/otp → OTP REPLAYED permitted because the claim
    // idempotency record is COMPLETED → early return, nothing re-executed.
    const replay = await claimService.execute({ ...payload });
    expect(replay.replayed).toBe(true);
    expect(replay.journalId).toBe(first.journalId);

    expect(await snapshotsFor({ journalId: first.journalId })).toHaveLength(1); // NOT duplicated
    const journalsAfterReplay: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfterReplay[0].cnt).toBe(journalsAfterFirst[0].cnt);
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe('12000'); // credited once
  });

  it('09. claim key clash: same key different financial parameters rejected (409), snapshot count unchanged', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '9000');
    const { customerId } = await createCustomerWithPhone(phone);
    const claimKey = `c03c-09-claim-${randomUUID()}`;

    const otp1 = 'c03c-otp-09a';
    const { challengeId: ch1 } = await createMfaChallenge(customerId, otp1);
    const first = await claimService.execute({
      transferId: init.transferId,
      beneficiaryPhone: phone,
      transferCode: init.transferCode!,
      customerId,
      mfaChallengeId: ch1,
      otp: otp1,
      idempotencyKey: claimKey,
    });
    expect(first.status).toBe('COMPLETED');

    const otp2 = 'c03c-otp-09b';
    const { challengeId: ch2 } = await createMfaChallenge(customerId, otp2);
    await expect(
      claimService.execute({
        transferId: init.transferId,
        beneficiaryPhone: phone,
        transferCode: init.transferCode!,
        customerId,
        mfaChallengeId: ch2,
        otp: otp2,
        idempotencyKey: claimKey,
        reference: `different-reference-${randomUUID()}`, // different financial parameter under same key
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshotsFor({ idempotencyKey: `cash-to-cash-claim:${init.transferId}:${claimKey}` })).toHaveLength(1);
  });

  it('10. claim rollback: forced failure after snapshot rolls back snapshot + limits + claim journal; transfer stays UNCLAIMED and consistent', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '14000');
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);

    const profile = `P03CC_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, 'CUSTOMER', customerId);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '5000000', null);

    const otp = 'c03c-otp-10';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claimKey = `c03c-10-claim-${randomUUID()}`;
    const journalsBefore: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    const custBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    const unclaimedBefore = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);

    await expect(
      claimService.execute({
        transferId: init.transferId,
        beneficiaryPhone: phone,
        transferCode: init.transferCode!,
        customerId,
        mfaChallengeId: challengeId,
        otp,
        idempotencyKey: claimKey,
        _simulateFailureAfterJournal: true, // fails AFTER snapshot, BEFORE commit
      }),
    ).rejects.toThrow('Simulated failure after journal');

    expect(await snapshotsFor({ idempotencyKey: `cash-to-cash-claim:${init.transferId}:${claimKey}` })).toHaveLength(0); // snapshot gone
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [claimKey])).length).toBe(0);
    expect((await dataSource.query(`SELECT id FROM limit_usages WHERE principal_id=$1 AND product='CASH_TO_CASH'`, [customerId])).length).toBe(0);
    const journalsAfter: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ledger_journals`);
    expect(journalsAfter[0].cnt).toBe(journalsBefore[0].cnt); // claim journal gone
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe(custBefore.balanceMinor); // wallet unchanged
    expect((await ledgerService.getAccountBalance(unclaimedLedgerAccountId)).balanceMinor).toBe(unclaimedBefore.balanceMinor);
    // original reserved/unclaimed state CONSISTENT: still UNCLAIMED, no claim linkage
    const transferRows: Array<any> = await dataSource.query(`SELECT status, claim_journal_id, claimant_customer_id FROM cash_to_cash_transfers WHERE id=$1`, [init.transferId]);
    expect(transferRows[0].status).toBe('UNCLAIMED');
    expect(transferRows[0].claim_journal_id).toBeNull();
    expect(transferRows[0].claimant_customer_id).toBeNull();
  });

  it('11. claim limit rejection: rejected, no snapshot, no stranded reservation, transfer stays UNCLAIMED', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '30000');
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);

    const profile = `P03CC_${randomUUID().slice(0, 6).toUpperCase()}`;
    await seedLimitProfile(profile, 'CUSTOMER', customerId);
    await seedLimitRule(profile, 'DAILY_AMOUNT', '20000', null); // tighter than the transfer principal

    const otp = 'c03c-otp-11';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claimKey = `c03c-11-claim-${randomUUID()}`;
    await expect(
      claimService.execute({
        transferId: init.transferId,
        beneficiaryPhone: phone,
        transferCode: init.transferCode!,
        customerId,
        mfaChallengeId: challengeId,
        otp,
        idempotencyKey: claimKey,
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await snapshotsFor({ idempotencyKey: `cash-to-cash-claim:${init.transferId}:${claimKey}` })).toHaveLength(0);
    expect((await dataSource.query(`SELECT id FROM limit_reservations WHERE idempotency_key=$1`, [claimKey])).length).toBe(0);
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe('0');
    const transferRows: Array<any> = await dataSource.query(`SELECT status FROM cash_to_cash_transfers WHERE id=$1`, [init.transferId]);
    expect(transferRows[0].status).toBe('UNCLAIMED');
  });

  it('12. TEST-ONLY synthetic fee rule: claim replicates the same ruleId/version/parameters (now with computed decision)', async () => {
    const rule12 = await feeRuleRegistry.createRule(
      {
        productCode: 'CASH_TO_CASH', currency: 'NGN',
        flatFeeMinor: '250', percentageBps: 15,
        minimumFeeMinor: null, maximumFeeMinor: null, vatBps: null,
        effectiveFrom: new Date(Date.now() - 86400000), priority: 0, isActive: true,
      },
      'test',
    );
    syntheticRuleId = rule12.id; // same shape as test 06's rule; seeded locally for isolation
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '60000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '11000');
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);
    const otp = 'c03c-otp-12';
    const { challengeId } = await createMfaChallenge(customerId, otp);

    const claim = await claimService.execute({
      transferId: init.transferId,
      beneficiaryPhone: phone,
      transferCode: init.transferCode!,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: `c03c-12-claim-${randomUUID()}`,
    });
    expect(claim.status).toBe('COMPLETED');

    const snaps = await snapshotsFor({ journalId: claim.journalId });
    expect(snaps).toHaveLength(1);
    const fee = snaps[0].fee_decision;
    // V1-COMMERCIAL-IMPLEMENTATION-01 — claim replicates the SAME computed decision:
    // floor(11000·15/10000)=16 + 250 = 266 (identical to initiation, rule-identity preserved)
    expect(fee.status).toBe('APPLIED');
    expect(fee.calculationModel).toBe('FLAT_PLUS_PERCENTAGE');
    expect(fee.feeMinor).toBe('266');
    expect(fee.totalMinor).toBe('11266');
    expect(fee.posting).toEqual({
      journalLegsPosted: false,
      reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
    }); // accounting boundary — claim journal below stays principal-only
    expect(fee.ruleRefs).toHaveLength(1);
    expect(fee.ruleRefs[0].ruleId).toBe(syntheticRuleId);
    expect(fee.ruleRefs[0].ruleVersion).toBe(1);
    expect(fee.ruleRefs[0].flatFeeMinor).toBe('250');
    expect(fee.ruleRefs[0].percentageBps).toBe(15);

    const lines: Array<any> = await dataSource.query(`SELECT amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1`, [claim.journalId]);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.amount_minor).toBe('11000'); // principal-only
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe('11000');
  });

  // ════════════════════ CROSS-CUTTING ════════════════════

  it('13. both snapshots immutable + wiring boundary (only CASH_TO_CASH init/claim wired here; no other flow touched)', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '40000');
    const phone = newPhone();
    const init = await initiateTransfer(agent, phone, '8000');
    const { customerId } = await createCustomerWithPhone(phone);
    const otp = 'c03c-otp-13';
    const { challengeId } = await createMfaChallenge(customerId, otp);
    const claim = await claimService.execute({
      transferId: init.transferId,
      beneficiaryPhone: phone,
      transferCode: init.transferCode!,
      customerId,
      mfaChallengeId: challengeId,
      otp,
      idempotencyKey: `c03c-13-claim-${randomUUID()}`,
    });
    const initSnap = (await snapshotsFor({ journalId: init.journalId }))[0];
    const claimSnap = (await snapshotsFor({ journalId: claim.journalId }))[0];
    for (const snap of [initSnap, claimSnap]) {
      await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET product='X' WHERE id=$1`, [snap.id])).rejects.toThrow(
        /commercial_decision_snapshots is immutable/,
      );
      await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snap.id])).rejects.toThrow(
        /commercial_decision_snapshots is immutable/,
      );
    }

    // wiring boundary assertions
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const initSource = readFileSync(join(__dirname, '../src/agent/agent-cash-to-cash.service.ts'), 'utf8');
    const claimSource = readFileSync(join(__dirname, '../src/agent/agent-cash-to-cash-claim.service.ts'), 'utf8');
    for (const src of [initSource, claimSource]) {
      expect(src).toContain('recordDecisionWithManager'); // same-transaction recording
      expect(src).toContain('resolveWithManager'); // read-only resolution
      expect(src).not.toMatch(/\.recordDecision\(/); // never the second-transaction variant
      expect(src).not.toContain('feeEngine'); // no FeeEngine participation
      expect(src).toContain(`productCode = 'CASH_TO_CASH'`); // ONE canonical product code in both operations
    }
    // no CASH_TO_CASH_CLAIM catalogue identity was invented (claim metadata constants are not products)
    const products: Array<{ code: string }> = await dataSource.query(`SELECT code FROM products WHERE code LIKE 'CASH_TO_CASH%'`);
    expect(products.map((p) => p.code)).toEqual(['CASH_TO_CASH']);
    // the shared agent execution service gate is unchanged (CASH_TO_CASH does not flow through it)
    const executionSource = readFileSync(join(__dirname, '../src/agent/agent-financial-execution.service.ts'), 'utf8');
    expect(executionSource).toContain(`['CASH_TO_WALLET', 'WALLET_TO_CASH']`);

    // workforce diagnostic API lists both operations under the one product code
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/commercial-decision-snapshots?product=CASH_TO_CASH')
      .set('Authorization', 'Bearer workforce-operator')
      .expect(200);
    const items = Array.isArray(list.body) ? list.body : list.body.data ?? [];
    expect(items.some((s: any) => (s.transactionReference ?? s.transaction_reference) === init.journalId)).toBe(true);
    expect(items.some((s: any) => (s.transactionReference ?? s.transaction_reference) === claim.journalId)).toBe(true);
  });
});
