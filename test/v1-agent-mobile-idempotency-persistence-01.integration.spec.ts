/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/await-thenable, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashInService } from '../src/agent/agent-cash-in.service';
import { AgentCashToCashClaimService } from '../src/agent/agent-cash-to-cash-claim.service';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
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
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01.
 *
 * Backend-level proof of the PART 2/3 process-kill analysis documented in
 * docs/V1/V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01.md:
 *
 *  - Scenario A (replay-safe): resubmitting the EXACT same Idempotency-Key for the same
 *    logical operation never produces a second financial effect. This is what the mobile
 *    client's new pending-operation persistence (apps/agent-mobile/src/services/
 *    pending-operation.ts) relies on to make a resumed-after-process-kill retry safe.
 *  - Scenario B (the confirmed risk, Cash-In/Cash-Out/Cash-to-Cash-Send): resubmitting a
 *    BRAND NEW Idempotency-Key for what the Agent still believes is the same operation
 *    DOES produce a second, independent financial effect — there is no backend-side
 *    business guard against it, which is exactly why the mobile key's durability matters.
 *  - Scenario C (Cash-to-Cash CLAIM is architecturally immune): the claim's own
 *    `cash_to_cash_transfers` UNCLAIMED→CLAIMED state machine — keyed by the immutable
 *    `transferId`, independent of the client's Idempotency-Key — rejects a second claim
 *    attempt with a brand-new key with a definitive 409, producing NO second financial
 *    effect. (Already covered more extensively by test/a16-agent-cash-to-cash-claim.
 *    integration.spec.ts tests 25/26/27; this pins the exact audit scenario in one place.)
 *
 * All three scenarios run against real PostgreSQL — no mocks on the financial path.
 */
describe('V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-01 (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashInService: AgentCashInService;
  let cashToCashService: AgentCashToCashService;
  let claimService: AgentCashToCashClaimService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let mfaService: MfaExecutionService;

  let systemLedgerAccountId: string;

  function hashPin(pin: string): string {
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1agentidemp01');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cashInService = moduleRef.get(AgentCashInService);
    cashToCashService = moduleRef.get(AgentCashToCashService);
    claimService = moduleRef.get(AgentCashToCashClaimService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    mfaService = moduleRef.get(MfaExecutionService);

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

  async function createActiveAgentWithServicesAndPin(services: unknown, pin: string) {
    const cls = await classService.create({
      reference: `cls-v1aip-${randomUUID().slice(0, 8)}`,
      code: `V1AIP-${randomUUID().slice(0, 6)}`,
      name: 'V1 Agent Idempotency Persistence Class',
      isActive: true,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz V1AIP ${randomUUID().slice(0, 4)}`,
      contactEmail: `v1aip-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-v1aip',
    });
    await appService.submit(appEntity.id, 'applicant-v1aip');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    await pinService.setTransactionPin(agent.id, {
      pinHash: hashPin(pin),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: agent.id,
    });
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    return { agent, wallet };
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

  async function createCustomerWithPhone(phoneCanonical: string, displayName = 'Customer V1AIP') {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-v1aip-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [
      customerId,
      displayName,
    ]);
    // verified_at is required: V1-SYSTEM-01's claimant phone-binding check (reused for
    // Scenario C) reads this column (mirrors test/a16-agent-cash-to-cash-claim.integration.
    // spec.ts's createBeneficiaryCustomer fixture).
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, phoneCanonical],
    );
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  // Adapted verbatim from test/a16-agent-cash-to-cash-claim.integration.spec.ts's
  // createMfaChallenge helper — issues a real OTP challenge via the canonical
  // MfaExecutionService rather than hand-rolling the mfa_* table shapes.
  async function createMfaChallenge(customerId: string, otp: string, ttlSeconds = 300) {
    let enrollmentId: string;
    let methodId: string;
    const enrollRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM mfa_enrollments WHERE customer_id=$1 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
      [customerId],
    );
    if (enrollRows[0]) {
      enrollmentId = enrollRows[0]!.id;
      const methodRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM mfa_methods WHERE enrollment_id=$1 AND customer_id=$2 AND status='ENABLED' AND deleted_at IS NULL LIMIT 1`,
        [enrollmentId, customerId],
      );
      if (methodRows[0]) methodId = methodRows[0]!.id;
      else {
        const mRows: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
          [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
        );
        methodId = mRows[0]!.id;
      }
    } else {
      const eRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_enrollments (id, customer_id, reference, status) VALUES ($1,$2,$3,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, `mfa-enroll-${randomUUID().slice(0, 6)}`],
      );
      enrollmentId = eRows[0]!.id;
      const mRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO mfa_methods (id, customer_id, enrollment_id, method_type, label, status) VALUES ($1,$2,$3,'TOTP',$4,'ENABLED') RETURNING id`,
        [randomUUID(), customerId, enrollmentId, `mfa-method-${randomUUID().slice(0, 6)}`],
      );
      methodId = mRows[0]!.id;
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
      credentialId = cRows[0]!.id;
    }
    const sessionId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');
    await dataSource
      .query(
        `INSERT INTO authentication_sessions (id, customer_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,'customer-api','ACTIVE',NOW(),NOW() + INTERVAL '1 hour',NOW())`,
        [sessionId, customerId, credentialId, tokenHash],
      )
      .catch(() => {});
    const principal: any = { principalType: 'CUSTOMER', customerId, credentialId, sessionId };
    const challenge = await mfaService.issueChallenge({
      principal,
      enrollmentId,
      methodId,
      challengeHash: otp,
      ttlSeconds,
      actor: customerId,
    } as any);
    return { challengeId: (challenge as any).id ?? (challenge as any).challengeId };
  }

  async function fundAgent(agentId: string, walletLedgerAccountId: string, amount: string) {
    await ledgerService.postJournal({
      idempotencyKey: `fund-${agentId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: walletLedgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  async function journalCount(): Promise<bigint> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    return BigInt(rows[0]!.cnt);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Scenario A — same key reused for the same logical operation: replay-safe.
  // This is the behavior the mobile pending-operation persistence RELIES ON.
  // ───────────────────────────────────────────────────────────────────────
  it('A. Cash-In: resubmitting the SAME Idempotency-Key after success replays — no second financial effect', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '20000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);

    const key = `scenario-a-${randomUUID()}`;
    const before = await journalCount();

    const first = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(first.replayed).toBe(false);

    // Simulates: mobile client's pending-operation persistence recognized a still-pending
    // intent (counterpartyId + amountMinor match) and reused the ORIGINAL key for the retry
    // instead of minting a new one — exactly what the Confirm screens now do.
    const second = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.journalId).toBe(first.journalId);

    const after = await journalCount();
    expect(after).toBe(before + 1n); // exactly ONE financial effect, not two

    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('17000'); // debited once only
    expect(custBal.balanceMinor).toBe('3000'); // credited once only
  });

  // ───────────────────────────────────────────────────────────────────────
  // Scenario B — the CONFIRMED risk: a brand-new key for "the same" operation creates a
  // genuinely independent financial effect. This is exactly what would happen if the Agent's
  // device were killed before the first response arrived and the mobile client had no durable
  // record of the original key (pre-fix behavior, or if persistence were ever bypassed).
  // ───────────────────────────────────────────────────────────────────────
  it('B. Cash-In: a DIFFERENT Idempotency-Key for "the same" operation produces a genuine second debit/credit', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '20000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);

    const before = await journalCount();

    const first = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: `scenario-b-k1-${randomUUID()}`,
    });
    expect(first.replayed).toBe(false);

    // Simulates: the app process was killed before the Agent saw a response, the Agent
    // reopened the app, re-entered the SAME recipient + amount, and the Amount screen minted
    // a brand-new key (K2) because no durable pending-operation record existed to recover.
    const second = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: `scenario-b-k2-${randomUUID()}`,
    });
    expect(second.replayed).toBe(false);
    expect(second.journalId).not.toBe(first.journalId);

    const after = await journalCount();
    expect(after).toBe(before + 2n); // TWO independent financial effects — the real risk

    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('14000'); // debited TWICE
    expect(custBal.balanceMinor).toBe('6000'); // credited TWICE — the duplicate-credit risk
  });

  // ───────────────────────────────────────────────────────────────────────
  // Scenario B2 — Cash-to-Cash send shares the identical generic `agent-financial.v1:<agentId>`
  // idempotency architecture as Cash-In (same AgentFinancialExecutionService boundary), so the
  // same risk applies there too: a new key after process-kill creates a second pending transfer
  // and a second real debit from the Agent's float.
  // ───────────────────────────────────────────────────────────────────────
  it('B2. Cash-to-Cash send: a DIFFERENT Idempotency-Key for "the same" send produces a second independent pending transfer', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_TO_CASH],
      '5678',
    );
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '20000');
    const beneficiaryPhone = `81${Math.floor(10000000 + Math.random() * 89999999)}`;

    const agentBalBefore = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(agentBalBefore.balanceMinor).toBe('20000');

    const countBefore: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM cash_to_cash_transfers WHERE beneficiary_phone = $1`,
      [beneficiaryPhone],
    );

    const first = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '5678',
      beneficiaryPhone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: `scenario-b2-k1-${randomUUID()}`,
    });
    expect(first.replayed).toBe(false);

    // Same process-kill amnesia scenario as above, applied to Cash-to-Cash send.
    const second = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '5678',
      beneficiaryPhone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: `scenario-b2-k2-${randomUUID()}`,
    });
    expect(second.replayed).toBe(false);
    expect((second as any).transferId).not.toBe((first as any).transferId);

    const countAfter: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM cash_to_cash_transfers WHERE beneficiary_phone = $1`,
      [beneficiaryPhone],
    );
    expect(BigInt(countAfter[0]!.cnt)).toBe(BigInt(countBefore[0]!.cnt) + 2n); // two independent pending transfers

    const agentBalAfter = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(agentBalAfter.balanceMinor).toBe('16000'); // debited TWICE (2000 x 2)
  });

  // ───────────────────────────────────────────────────────────────────────
  // Scenario C — Cash-to-Cash CLAIM is architecturally immune: the claim's own
  // UNCLAIMED→CLAIMED state machine (keyed by the immutable transferId) rejects a second
  // claim attempt with a brand-new Idempotency-Key, independent of the key's identity.
  // No durable mobile-side key persistence is required to prevent a double-claim.
  // ───────────────────────────────────────────────────────────────────────
  it('C. Cash-to-Cash claim: a DIFFERENT Idempotency-Key for an already-claimed transfer is rejected — no second financial effect', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_TO_CASH],
      '9999',
    );
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '10000');
    const beneficiaryPhone = `82${Math.floor(10000000 + Math.random() * 89999999)}`;

    const sendResult = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '9999',
      beneficiaryPhone,
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: `scenario-c-send-${randomUUID()}`,
    });
    const transferId = (sendResult as any).transferId as string;
    const transferCode = (sendResult as any).transferCode as string;

    const { customerId } = await createCustomerWithPhone(beneficiaryPhone, 'Beneficiary V1AIP');

    const { challengeId: challenge1Id } = await createMfaChallenge(customerId, 'otp-c-1');

    const before = await journalCount();

    const claim1 = await claimService.execute({
      transferId,
      beneficiaryPhone,
      transferCode,
      customerId,
      mfaChallengeId: challenge1Id,
      otp: 'otp-c-1',
      idempotencyKey: `scenario-c-claim-k1-${randomUUID()}`,
    });
    expect(claim1.replayed).toBe(false);

    const { challengeId: challenge2Id } = await createMfaChallenge(customerId, 'otp-c-2');

    // Simulates: the claiming Agent's process was killed before seeing the claim-success
    // response and they re-attempted with a brand-new key (K2) believing it had not gone
    // through. Unlike Cash-In/Cash-to-Cash-send, this must be REJECTED, not duplicated.
    await expect(
      claimService.execute({
        transferId,
        beneficiaryPhone,
        transferCode,
        customerId,
        mfaChallengeId: challenge2Id,
        otp: 'otp-c-2',
        idempotencyKey: `scenario-c-claim-k2-${randomUUID()}`,
      }),
    ).rejects.toThrow(/already claimed/i);

    const after = await journalCount();
    expect(after).toBe(before + 1n); // exactly ONE claim financial effect, the second was rejected
  });
});
