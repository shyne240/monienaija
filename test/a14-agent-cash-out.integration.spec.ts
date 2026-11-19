/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { TrustedTierFixture } from './support/trusted-tier-fixture';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentCashInService } from '../src/agent/agent-cash-in.service';
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
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { MfaExecutionService } from '../src/customer-authentication/mfa-execution.service';
import { RecipientResolutionService } from '../src/agent/recipient-resolution.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

import { makeCustomerFinanciallyEligible } from './support/kyc-test-fixtures';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import {
  createDeskOtpFixture,
  overrideSmsProvider,
  RecordingSmsProvider,
  type DeskOtpHandle,
} from './support/desk-otp-fixture';

// Test-only trusted-evidence override. Opt-in per suite; the production reader stays
// fail-closed because nothing in AppModule references this module.
const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

describe('A14 Agent Wallet→Cash (real PostgreSQL)', () => {
  let dataSource: DataSource;
  const evidence = new TrustedTierFixture();
  let app: NestFastifyApplication;
  let cashOutService: AgentCashOutService;
  let cashInService: AgentCashInService;
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
  let recipientService: RecipientResolutionService;

  let systemLedgerAccountId: string;
  const smsProvider = new RecordingSmsProvider();
  let deskOtp: DeskOtpHandle;
  let fixture: GovernedFinancialFixture;
  let institutionId: string;
  const agentSessions = new Map<string, string>();

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a14cashout');
    await evidence.seedPolicy(dataSource);
    const baseBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(evidence);
    const builder = overrideSmsProvider(baseBuilder, smsProvider);
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cashOutService = moduleRef.get(AgentCashOutService);
    cashInService = moduleRef.get(AgentCashInService);
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
    recipientService = moduleRef.get(RecipientResolutionService);
    deskOtp = createDeskOtpFixture(app, smsProvider);
    fixture = new GovernedFinancialFixture({ app, dataSource, label: 'a14' });
    institutionId = await fixture.institution();

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

  async function createActiveAgentWithServicesAndPin(
    services: unknown,
    pin: string | null,
    isActive = true,
  ) {
    const cls = await classService.create({
      reference: `cls-a14-${randomUUID().slice(0, 8)}`,
      code: `A14-${randomUUID().slice(0, 6)}`,
      name: 'A14 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A14 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a14-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a14',
    });
    await appService.submit(appEntity.id, 'applicant-a14');
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
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    // Governed institutional context: affiliation + wallet attribution before the first ledger
    // line, so the Cash-Out institution scope resolves for this Agent.
    await fixture.affiliateAgent(agent.id, institutionId);
    await fixture.attributeWallet(wallet.id, institutionId);
    // Cash-Out requires an authenticated Agent session bound to the cash-out intent.
    const [credential] = await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status)
       VALUES ($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [agent.id, hashPin('login-password')],
    );
    const [session] = await dataSource.query(
      `INSERT INTO agent_authentication_sessions (agent_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at)
       VALUES ($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+INTERVAL '1 hour',clock_timestamp()) RETURNING id`,
      [agent.id, credential.id, randomBytes(32).toString('hex')],
    );
    agentSessions.set(agent.id, session.id);
    return { cls, agent, appEntity, wallet };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      sessionId: agentSessions.get(agentId),
      agentId,
      principalId: agentId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
  }

  function customerPrincipal(customerId: string) {
    return {
      type: 'CUSTOMER' as const,
      customerId,
      principalId: customerId,
      roles: [],
      scopes: [],
      customerAccess: 'SELF' as const,
      agentAccess: 'NONE' as const,
    };
  }

  async function createCustomerWithPhoneAndPin(
    phoneCanonical: string,
    pin: string,
    displayName = 'Customer A14',
  ) {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-a14-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, displayName],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,clock_timestamp())`,
      [customerId, phoneCanonical],
    );
    await customerPinService.setTransactionPin(customerId, {
      pinHash: hashPin(pin),
      hashAlgorithm: 'PBKDF2',
      pinVersion: 1,
      actor: customerId,
    });
    await evidence.approveLevelOne(dataSource, customerId);
    // Batch 2C: this fixture created the customer with raw SQL only, which the governed
    // financial-eligibility gate (correctly) rejects. Applied after the suite's own
    // profile/phone rows exist and immediately before the wallet that needs the gate.
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    // Institutional enrolment + wallet attribution before any ledger line; the cash-out intent
    // binds the resolving institution and rejects unattributed source wallets.
    await fixture.enrolCustomer(customerId, institutionId, {
      targetStatus: 'ACTIVE',
      financialEligibility: 'ELIGIBLE',
    });
    await fixture.attributeWallet(wallet.id, institutionId);
    return { customerId, wallet };
  }

  /**
   * Issues a real, intent-bound Cash-Out OTP through AgentDeskOtpService (purpose WALLET_TO_CASH).
   * The intent, the challenge binding and the SMS delivery are all produced by the production
   * lifecycle; nothing about the challenge is fabricated by the test.
   */
  /** The canonical OTP verifier reconstructs its principal from an ACTIVE Customer credential. */
  async function ensureCustomerCredential(customerId: string): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customer_authentication_credentials
        WHERE customer_id=$1 AND status='ACTIVE' AND deleted_at IS NULL LIMIT 1`,
      [customerId],
    );
    if (rows[0]) return rows[0]!.id;
    const created: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customer_authentication_credentials
         (id, customer_id, credential_type, password_hash, hash_algorithm, password_version, password_changed_at, status)
       VALUES ($1,$2,'PASSWORD','fixture-hash','PBKDF2',1,NOW(),'ACTIVE') RETURNING id`,
      [randomUUID(), customerId],
    );
    return created[0]!.id;
  }

  async function issueCashOutOtp(params: {
    agentId: string;
    customerId: string;
    amountMinor: string;
    operationKey?: string;
    supersedesOperationKey?: string;
    ttlSeconds?: number;
    agentSessionId?: string;
  }) {
    await ensureCustomerCredential(params.customerId);
    const agentSessionId = params.agentSessionId ?? agentSessions.get(params.agentId);
    if (!agentSessionId) throw new Error('Cash-Out requires an authenticated Agent session');
    const operationKey = params.operationKey ?? `cashout-op-${randomUUID()}`;
    const issued = await deskOtp.issue({
      agentId: params.agentId,
      customerId: params.customerId,
      purpose: 'WALLET_TO_CASH',
      agentSessionId,
      amountMinor: params.amountMinor,
      currency: 'NGN',
      operationKey,
      supersedesOperationKey: params.supersedesOperationKey,
      ttlSeconds: params.ttlSeconds ?? 300,
    });
    return { challengeId: issued.challengeId, otp: issued.otp, operationKey };
  }

  async function fundCustomer(customerWalletLedgerId: string, amount: string) {
    // The customer wallet is institution-attributed, so it must be funded from that
    // institution's own settlement account — never from platform float, and never by mixing
    // attributed and unattributed accounts in one journal.
    await fixture.fundLedgerAccount(customerWalletLedgerId, amount, { institutionId });
  }

  it('rejects cash-out from an existing wallet after evidence withdrawal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(wallet.ledgerAccountId, '10000');
    const {
      challengeId,
      otp: otp_withdrawn_328,
      operationKey: cashOutOperation333,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    evidence.withdraw(customerId);
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_withdrawn_328,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation333,
      }),
    ).rejects.toThrow();
    expect((await ledgerService.getAccountBalance(wallet.ledgerAccountId)).balanceMinor).toBe(
      '10000',
    );
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe(
      '0',
    );
  });

  // A. successful Wallet→Cash
  it('A. successful Wallet→Cash', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '10000');
    const {
      challengeId,
      otp: otp_123456_361,
      operationKey: cashOutOperation370,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '3000',
    });
    const agentBalBefore = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBalBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBalBefore.balanceMinor).toBe('0');
    expect(custBalBefore.balanceMinor).toBe('10000');

    const result = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_123456_361,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: cashOutOperation370,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.journalId).toBeDefined();
    expect(result.replayed).toBe(false);
    expect(result.amountMinor).toBe('3000');

    const agentBalAfter = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBalAfter = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBalAfter.balanceMinor).toBe('3000');
    expect(custBalAfter.balanceMinor).toBe('7000');
  });

  it('B. Customer balance decreases by principal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `81${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '5000');
    const {
      challengeId,
      otp: otp_111111_398,
      operationKey: cashOutOperation411,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '2000',
    });
    const before = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_111111_398,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: cashOutOperation411,
    });
    const after = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) - 2000n);
  });

  it('C. Agent balance increases by principal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `82${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '5000');
    const {
      challengeId,
      otp: otp_222222_424,
      operationKey: cashOutOperation441,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1500',
    });
    const before = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_222222_424,
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: cashOutOperation441,
    });
    const after = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) + 1500n);
  });

  it('D. balanced journal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `83${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '8000');
    const {
      challengeId,
      otp: otp_333333_450,
      operationKey: cashOutOperation471,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '2500',
    });
    const res = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_333333_450,
      amountMinor: '2500',
      currency: 'NGN',
      idempotencyKey: cashOutOperation471,
    });
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal).toBeDefined();
    expect(journal!.currency).toBe('NGN');
    expect(journal!.accountingUnit).toBe('CUSTOMER_FUNDS');
    const lines = journal!.lines;
    expect(lines.length).toBe(2);
    const totalDebit = lines
      .filter((l) => l.direction === LedgerEntryDirection.DEBIT)
      .reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const totalCredit = lines
      .filter((l) => l.direction === LedgerEntryDirection.CREDIT)
      .reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit.toString()).toBe('2500');
    const debit = lines.find((l) => l.direction === LedgerEntryDirection.DEBIT)!;
    const credit = lines.find((l) => l.direction === LedgerEntryDirection.CREDIT)!;
    expect(debit.accountId).toBe(custWallet.ledgerAccountId);
    expect(credit.accountId).toBe(agentWallet.ledgerAccountId);
    expect((journal!.metadata as any).operation).toBe('CASH_OUT');
  });

  it('E. Customer transaction PIN required', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `84${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_444444_488,
      operationKey: cashOutOperation513,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '',
        mfaChallengeId: challengeId,
        otp: otp_444444_488,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation513,
      }),
    ).rejects.toThrow(/pin/i);
  });

  it('F. invalid Customer PIN denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `85${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_555555_509,
      operationKey: cashOutOperation538,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '9999',
        mfaChallengeId: challengeId,
        otp: otp_555555_509,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation538,
      }),
    ).rejects.toThrow(/Customer PIN/i);
  });

  it('G. locked Customer PIN denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `86${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    // The Customer PIN is verified *before* the OTP, so one governed challenge can carry the
    // wrong-PIN attempts without consuming it.
    const {
      challengeId: lockoutChallengeId,
      otp: lockoutOtp,
      operationKey: cashOutOperation565,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId,
      amountMinor: '100',
    });
    for (let i = 0; i < 5; i++) {
      try {
        await cashOutService.execute({
          agentId: agent.id,
          agentPrincipal: agentPrincipal(agent.id) as any,
          agentPin: '1234',
          customerId,
          customerPin: '0000',
          mfaChallengeId: lockoutChallengeId,
          otp: lockoutOtp,
          amountMinor: '100',
          currency: 'NGN',
          idempotencyKey: cashOutOperation565,
        });
      } catch {}
    }
    const {
      challengeId,
      otp: otp_666666_550,
      operationKey: cashOutOperation586,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_666666_550,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation586,
      }),
    ).rejects.toThrow(/locked/i);
  });

  it('H. OTP required', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `87${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: '',
        otp: '',
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `h-${randomUUID()}`,
      }),
    ).rejects.toThrow(/otp|challenge/i);
  });

  it('I. invalid OTP denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `88${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_777777_591,
      operationKey: cashOutOperation631,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: '000000',
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation631,
      }),
    ).rejects.toThrow(/OTP/i);
  });

  it('J. expired OTP denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `89${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_888888_612,
      operationKey: cashOutOperation656,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    // Expire it manually
    await dataSource.query(
      `UPDATE mfa_challenges SET expires_at=NOW() - INTERVAL '1 hour' WHERE id=$1`,
      [challengeId],
    );
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_888888_612,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation656,
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('K. consumed/reused OTP denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '5000');
    const {
      challengeId,
      otp: otp_999999_642,
      operationKey: cashOutOperation690,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_999999_642,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: cashOutOperation690,
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: '999999',
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `k2-${randomUUID()}`,
      }),
    ).rejects.toThrow(/already used|OTP|intent unavailable or mismatched/i);
  });

  it('L. Customer A cannot withdraw from Customer B', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phoneA = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const phoneB = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId: custA } = await createCustomerWithPhoneAndPin(phoneA, '1234');
    const { customerId: custB, wallet: walletB } = await createCustomerWithPhoneAndPin(
      phoneB,
      '1234',
    );
    await fundCustomer(walletB.ledgerAccountId, '5000');
    const {
      challengeId,
      otp: otp_101010_681,
      operationKey: cashOutOperation733,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: custA,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId: custB,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_101010_681,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation733,
      }),
    ).rejects.toThrow(/challenge|OTP|belong/i);
  });

  it('M. Agent without CASH_OUT denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    // The CASH_OUT capability is enforced when the challenge is issued: an Agent that cannot
    // perform Cash-Out never receives a usable OTP, so no redemption can be attempted at all.
    await expect(
      issueCashOutOtp({ agentId: agent.id, customerId: customerId, amountMinor: '1000' }),
    ).rejects.toThrow(/CASH_OUT|capability|agent unavailable/i);
  });

  it('N. Agent A cannot execute as Agent B', async () => {
    const { agent: agentA } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const { agent: agentB } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_303030_730,
      operationKey: cashOutOperation790,
    } = await issueCashOutOtp({
      agentId: agentB.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agentB.id,
        agentPrincipal: agentPrincipal(agentA.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_303030_730,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation790,
      }),
    ).rejects.toThrow(/cannot execute as|mismatch/i);
  });

  it('O. suspended Agent denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_404040_751,
      operationKey: cashOutOperation815,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await lifecycleService.suspend(agent.id, 'test-actor');
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_404040_751,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation815,
      }),
    ).rejects.toThrow(/SUSPENDED/i);
  });

  it('P. terminated Agent denied', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_505050_773,
      operationKey: cashOutOperation841,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await lifecycleService.terminate(agent.id, 'test-actor');
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_505050_773,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation841,
      }),
    ).rejects.toThrow(/TERMINATED/i);
  });

  it('Q. pending Agent denied', async () => {
    const cls = await classService.create({
      reference: `cls-pend-a14-${randomUUID().slice(0, 6)}`,
      code: `PEND-A14-${randomUUID().slice(0, 6)}`,
      name: 'Pend A14',
      isActive: true,
      applicableServices: [AgentService.CASH_OUT],
      actor: 'test-actor',
    });
    const pendingId = randomUUID();
    await dataSource.query(
      `INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'PENDING',$3,1)`,
      [pendingId, `pend-a14-${randomUUID()}`, cls.id],
    );
    await pinService.setTransactionPin(pendingId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: pendingId,
    });
    // Wallet creation authority refuses a non-ACTIVE Agent owner, so no wallet is provisioned: the
    // denial must come from Agent authorization, not from a missing wallet.
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    // A PENDING Agent cannot hold an authenticated session, so the governed challenge is never
    // issued for it — the refusal is upstream of any redemption attempt.
    await expect(
      issueCashOutOtp({ agentId: pendingId, customerId: customerId, amountMinor: '1000' }),
    ).rejects.toThrow(/session|agent unavailable|CASH_OUT/i);
  });

  it('R. inactive/missing Agent class denied', async () => {
    const { agent, cls } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_707070_842,
      operationKey: cashOutOperation918,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await classService.update(cls.id, { isActive: false, actor: 'test-actor' });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_707070_842,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation918,
      }),
    ).rejects.toThrow(/CLASS_INACTIVE/i);
  });

  it('S. insufficient Customer balance rejected', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    // No funding
    const custBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(custBal.balanceMinor).toBe('0');
    const {
      challengeId,
      otp: otp_808080_870,
      operationKey: cashOutOperation950,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '5000',
    });
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_journals`,
    );
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_808080_870,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation950,
      }),
    ).rejects.toThrow(/sufficient|insufficient/i);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_journals`,
    );
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('0');
  });

  it('T. failed execution leaves both balances unchanged', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '1000');
    const beforeAgent = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const beforeCust = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    const {
      challengeId,
      otp: otp_909090_906,
      operationKey: cashOutOperation990,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '5000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_909090_906,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation990,
      }),
    ).rejects.toThrow();
    const afterAgent = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const afterCust = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(afterAgent.balanceMinor).toBe(beforeAgent.balanceMinor);
    expect(afterCust.balanceMinor).toBe(beforeCust.balanceMinor);
  });

  it('U. idempotent replay produces no second financial effect', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '5000');
    const key = `u-${randomUUID()}`;
    // Idempotent replay is a *financial* property: the same idempotency key must not produce a
    // second journal even when the redemption is re-driven with the same (already consumed)
    // challenge. The challenge is restored to ACTIVE to model a replayed request reaching the
    // financial boundary again; no challenge row is fabricated.
    const { challengeId, otp } = await issueCashOutOtp({
      agentId: agent.id,
      customerId,
      amountMinor: '2000',
      operationKey: key,
    });
    const r1 = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(r1.status).toBe('COMPLETED');
    // For second call, the challenge is now VERIFIED, so we need to handle that our service will see it as already used and throw.
    // We will patch the test to directly test financial replay via the underlying financial service, or we will create a new challenge with same OTP but same idempotencyKey should be 409?
    // Instead, we will test that a second call with same key but same OTP and same challengeId is considered replay if we allow VERIFIED challenges to be reused for idempotent replay.
    // For this, we will update the mfa_challenges status back to ACTIVE for the second call, to simulate that the OTP is still valid for replay.
    await dataSource.query(
      `UPDATE mfa_challenges SET status='ACTIVE', verified_at=NULL WHERE id=$1`,
      [challengeId],
    );
    const r2 = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(r2.journalId).toBe(r1.journalId);
    expect(r2.replayed).toBe(true);
    expect(r2.status).toBe('REPLAYED');
    const afterAgent = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const afterCust = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(afterAgent.balanceMinor).toBe('2000');
    expect(afterCust.balanceMinor).toBe('3000');
  });

  it('V. conflicting idempotency rejected', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const wRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 AND currency='NGN'`,
      [customerId],
    );
    const wallet = { ledgerAccountId: wRows[0]!.ledger_account_id } as any;
    await fundCustomer(wallet.ledgerAccountId, '5000');
    const key = `v-${randomUUID()}`;
    const { challengeId, otp: otp_v001_1009 } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
      operationKey: key,
    });
    await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_v001_1009,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    // Reusing one operation key for different material details is a genuine conflict: the
    // established intent cannot be re-used, and the conflict is refused before any challenge for
    // the conflicting operation can exist.
    await expect(
      issueCashOutOtp({
        agentId: agent.id,
        customerId: customerId,
        amountMinor: '2000',
        operationKey: key,
      }),
    ).rejects.toThrow(/already used|operation context does not match|intent unavailable/i);
  });

  it('W. concurrent duplicate requests converge', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '10000');
    const key = `w-${randomUUID()}`;
    // One operation (one intent, one governed challenge, one idempotency key) driven twice
    // concurrently: the financial layer must converge on a single journal, one COMPLETED and one
    // REPLAYED, with no second debit.
    const { challengeId, otp } = await issueCashOutOtp({
      agentId: agent.id,
      customerId,
      amountMinor: '3000',
      operationKey: key,
    });
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_journals`,
    );
    const [r1, r2] = await Promise.all([
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
    ]);
    const ids = [r1.journalId, r2.journalId];
    expect(ids[0]).toBe(ids[1]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['COMPLETED', 'REPLAYED']);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_journals`,
    );
    expect(BigInt(afterJournals[0]!.cnt)).toBe(BigInt(beforeJournals[0]!.cnt) + 1n);
  });

  it('X. concurrent withdrawals cannot make Customer balance negative', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '10000');
    const {
      challengeId: ch1,
      otp: otp_x001_1105,
      operationKey: xKey1,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '8000',
    });
    const {
      challengeId: ch2,
      otp: otp_x002_1106,
      operationKey: xKey2,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '8000',
    });
    // Observe real PostgreSQL errors, including a deadlock hidden by a later successful
    // retry. Do not change scheduling, retry policy, authorization or the DB response.
    const queryErrors = jest.spyOn(dataSource.logger, 'logQueryError');
    const results = await Promise.allSettled([
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: ch1,
        otp: otp_x001_1105,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: xKey1,
      }),
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: ch2,
        otp: otp_x002_1106,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: xKey2,
      }),
    ]);
    const dbCodes = queryErrors.mock.calls.map(([error]) => (error as { code?: string }).code);
    queryErrors.mockRestore();
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<AgentCashOutService['execute']>>
    >[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winner = fulfilled[0]!.value;
    expect(winner.status).toBe('COMPLETED');
    expect((await ledgerService.getAccountBalance(custWallet.ledgerAccountId)).balanceMinor).toBe(
      '2000',
    );
    expect((await ledgerService.getAccountBalance(agentWallet.ledgerAccountId)).balanceMinor).toBe(
      '8000',
    );
    expect(
      await dataSource.query(
        `SELECT id FROM ledger_journals WHERE idempotency_key = ANY($1::text[])`,
        [[xKey1, xKey2].map((key) => `agent:${agent.id}:${key}`)],
      ),
    ).toEqual([{ id: winner.journalId }]);
    expect(
      await dataSource.query(
        `SELECT journal_id, idempotency_key FROM cash_out_execution_records WHERE agent_id=$1 AND idempotency_key = ANY($2::text[])`,
        [agent.id, [xKey1, xKey2]],
      ),
    ).toEqual([{ journal_id: winner.journalId, idempotency_key: winner.idempotencyKey }]);
    expect((rejected[0]!.reason as Error).message.toLowerCase()).toContain('sufficient');
    expect(dbCodes).not.toContain('40P01');
  });

  it('Y. concurrent Agent credits remain correct', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone1 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const phone2 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId: cust1, wallet: w1 } = await createCustomerWithPhoneAndPin(phone1, '1234');
    const { customerId: cust2, wallet: w2 } = await createCustomerWithPhoneAndPin(phone2, '1234');
    await fundCustomer(w1.ledgerAccountId, '5000');
    await fundCustomer(w2.ledgerAccountId, '5000');
    const {
      challengeId: ch1,
      otp: otp_y001_1152,
      operationKey: yKey1,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: cust1,
      amountMinor: '2000',
    });
    const {
      challengeId: ch2,
      otp: otp_y002_1153,
      operationKey: yKey2,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: cust2,
      amountMinor: '3000',
    });
    const results = await Promise.allSettled([
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId: cust1,
        customerPin: '1234',
        mfaChallengeId: ch1,
        otp: otp_y001_1152,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: yKey1,
      }),
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId: cust2,
        customerPin: '1234',
        mfaChallengeId: ch2,
        otp: otp_y002_1153,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: yKey2,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);
    const agentBal = await ledgerService.getAccountBalance(
      (
        await walletService
          .createWallet({
            customerId: agent.id,
            currency: 'NGN',
            idempotencyKey: `y-agent-${agent.id}-${randomUUID()}`,
          })
          .catch(async () => {
            const w: Array<{ ledger_account_id: string }> = await dataSource.query(
              `SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`,
              [agent.id],
            );
            return { ledgerAccountId: w[0]!.ledger_account_id } as Awaited<
              ReturnType<WalletService['createWallet']>
            >;
          })
      ).ledgerAccountId,
    );
    expect(BigInt(agentBal.balanceMinor)).toBe(5000n);
  });

  it('Z. no physical-cash ledger/account created', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '5000');
    const {
      challengeId,
      otp: otp_z001_1208,
      operationKey: cashOutOperation1312,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    const beforeAccounts: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_accounts`,
    );
    await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_z001_1208,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: cashOutOperation1312,
    });
    const afterAccounts: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_accounts`,
    );
    // Only wallets may have been created, but no cash account
    const cashAcc: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM ledger_accounts WHERE code ILIKE '%CASH%' AND code != 'CASH_TO_CASH-UNCLAIMED-NGN'`,
    );
    expect(cashAcc[0]!.cnt).toBe('0');
  });

  it('AA. no Customer record created as side effect', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    const beforeCust: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM customers`,
    );
    const beforeVal = BigInt(beforeCust[0]!.cnt);
    const {
      challengeId,
      otp: otp_aa001_1242,
      operationKey: cashOutOperation1350,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await fundCustomer(wallet.ledgerAccountId, '5000');
    await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_aa001_1242,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: cashOutOperation1350,
    });
    const afterCust: Array<{ cnt: string }> = await dataSource.query(
      `SELECT count(*)::text as cnt FROM customers`,
    );
    expect(BigInt(afterCust[0]!.cnt)).toBe(beforeVal);
  });

  it('AB. no PIN/OTP/secret appears in audit/result/logs', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(custWallet.ledgerAccountId, '5000');
    const {
      challengeId,
      otp: otp_ab001_1282,
      operationKey: cashOutOperation1394,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1500',
    });
    const res = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_ab001_1282,
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: cashOutOperation1394,
    });
    expect(JSON.stringify(res).toLowerCase()).not.toContain('pin');
    expect(JSON.stringify(res).toLowerCase()).not.toContain('otp');
    const audits: Array<{ new_values: any }> = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_CASH_OUT'`,
      [res.journalId],
    );
    expect(audits.length).toBe(1);
    const serial = JSON.stringify(audits[0]!.new_values).toLowerCase();
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('pinhash');
    expect(serial).not.toContain('otp');
    expect(serial).not.toContain('secret');
    expect(serial).not.toContain('challengehash');
    // Also check financial audit
    const finAudits: Array<{ new_values: any }> = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_FINANCIAL_EXECUTION'`,
      [res.journalId],
    );
    expect(finAudits.length).toBe(1);
    expect(JSON.stringify(finAudits[0]!.new_values).toLowerCase()).not.toContain('pin');
  });

  it('AC. existing Customer Wallet→Wallet flow remains functional', async () => {
    const custId1 = randomUUID();
    const custId2 = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [custId1, `ac-cust1-${randomUUID().slice(0, 6)}`],
    );
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [custId2, `ac-cust2-${randomUUID().slice(0, 6)}`],
    );
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'AC1',true)`,
      [custId1],
    );
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'AC2',true)`,
      [custId2],
    );
    for (const id of [custId1, custId2]) {
      const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
      await dataSource.query(
        `INSERT INTO customer_contact_methods(customer_id,type,value,normalized_value,is_primary,verified_at) VALUES($1,'PHONE',$2,$2,true,clock_timestamp())`,
        [id, phone],
      );
      await evidence.approveLevelOne(dataSource, id);
    }
    const wallet1 = await walletService.createWallet({
      customerId: custId1,
      currency: 'NGN',
      idempotencyKey: `ac1-${randomUUID()}`,
    });
    const wallet2 = await walletService.createWallet({
      customerId: custId2,
      currency: 'NGN',
      idempotencyKey: `ac2-${randomUUID()}`,
    });
    // Both wallets belong to the same institution before the wallet→wallet journal: an
    // institution-attributed account cannot move value against an unattributed one.
    for (const [customerId, wallet] of [
      [custId1, wallet1],
      [custId2, wallet2],
    ] as const) {
      await fixture.enrolCustomer(customerId, institutionId, {
        targetStatus: 'ACTIVE',
        financialEligibility: 'ELIGIBLE',
      });
      await fixture.attributeWallet(wallet.id, institutionId);
    }
    // Agent float is funded from the institution's own settlement account: the Agent wallet is
    // institution-attributed, so platform float cannot be mixed into this journal.
    await fixture.fundLedgerAccount(wallet1.ledgerAccountId, '5000', { institutionId });
    await ledgerService.postJournal({
      idempotencyKey: `ac-xfer-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: wallet1.ledgerAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '2000',
        },
        {
          accountId: wallet2.ledgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '2000',
        },
      ],
    });
    const after1 = await ledgerService.getAccountBalance(wallet1.ledgerAccountId);
    const after2 = await ledgerService.getAccountBalance(wallet2.ledgerAccountId);
    expect(after1.balanceMinor).toBe('3000');
    expect(after2.balanceMinor).toBe('2000');
  });

  it('AD. existing Agent Cash→Wallet remains functional', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_IN],
      '1234',
    );
    // Agent float is funded from the institution's own settlement account: the Agent wallet is
    // institution-attributed, so platform float cannot be mixed into this journal.
    await fixture.fundLedgerAccount(agentWallet.ledgerAccountId, '5000', { institutionId });
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhoneAndPin(phone, '1234');
    // Use CashIn service
    const res = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `ad-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    const custWallet = await walletService
      .createWallet({
        customerId: (
          await dataSource.query(
            `SELECT id FROM customers WHERE reference LIKE 'cust-a14%' ORDER BY created_at DESC LIMIT 1`,
          )
        )[0].id,
        currency: 'NGN',
        idempotencyKey: `ad-cust-wallet-${randomUUID()}`,
      })
      .catch(async () => {
        const cid = (
          await dataSource.query(
            `SELECT customer_id FROM customer_contact_methods WHERE normalized_value=$1`,
            [phone],
          )
        )[0].customer_id;
        const w: Array<{ ledger_account_id: string }> = await dataSource.query(
          `SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`,
          [cid],
        );
        return { ledgerAccountId: w[0]!.ledger_account_id } as Awaited<
          ReturnType<WalletService['createWallet']>
        >;
      });
    // Just check that cashIn succeeded
    expect(res.journalId).toBeDefined();
  });

  it('AE. A8/A9/A10/A11/A12/A13 regression', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const authRes = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_OUT,
      pin: '1234',
      principal: agentPrincipal(agent.id) as any,
    });
    expect(authRes.allowed).toBe(true);
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: cw } = await createCustomerWithPhoneAndPin(phone, '1234');
    await fundCustomer(cw.ledgerAccountId, '2000');
    const {
      challengeId,
      otp: otp_ae001_1473,
      operationKey: cashOutOperation1589,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '500',
    });
    const exec = await cashOutService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      customerId,
      customerPin: '1234',
      mfaChallengeId: challengeId,
      otp: otp_ae001_1473,
      amountMinor: '500',
      currency: 'NGN',
      idempotencyKey: cashOutOperation1589,
    });
    expect(exec.status).toBe('COMPLETED');
    const res = await recipientService.resolve(phone);
    expect(res.ownerType).toBe('CUSTOMER');
    await lifecycleService.suspend(agent.id, 'test-actor');
    const afterSuspend = await dataSource.query(`SELECT status FROM agents WHERE id=$1`, [
      agent.id,
    ]);
    expect(afterSuspend[0].status).toBe('SUSPENDED');
    await lifecycleService.reactivate(agent.id, 'test-actor');
    const afterReact = await dataSource.query(`SELECT status FROM agents WHERE id=$1`, [agent.id]);
    expect(afterReact[0].status).toBe('ACTIVE');
    // A13 cashIn still works
    const { agent: agent2, wallet: w2 } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_IN],
      '1234',
    );
    // Agent float is funded from the institution's own settlement account: the Agent wallet is
    // institution-attributed, so platform float cannot be mixed into this journal.
    await fixture.fundLedgerAccount(w2.ledgerAccountId, '3000', { institutionId });
    const phone2 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhoneAndPin(phone2, '1234');
    const cashInRes = await cashInService.execute({
      agentId: agent2.id,
      principal: agentPrincipal(agent2.id) as any,
      pin: '1234',
      recipientIdentifier: phone2,
      amountMinor: '500',
      currency: 'NGN',
      idempotencyKey: `ae-cashin-${randomUUID()}`,
    });
    expect(cashInRes.status).toBe('COMPLETED');
  });

  it('AF. API authorization tests', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhoneAndPin(phone, '1234');
    const {
      challengeId,
      otp: otp_af001_1537,
      operationKey: cashOutOperation1657,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    // no token
    const resNoToken = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-out',
      payload: {
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: otp_af001_1537,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation1657,
        agentPin: '1234',
      },
    });
    expect([401, 403].includes(resNoToken.statusCode)).toBe(true);
    // Customer principal on Agent-only endpoint — we can't easily create customer token, but we can test service layer
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: customerPrincipal(customerId) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: challengeId,
        otp: 'af001',
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `af2-${randomUUID()}`,
      }),
    ).rejects.toThrow(/Customer principal/i);
    // wrong Agent
    const { agent: agentB } = await createActiveAgentWithServicesAndPin(
      [AgentService.CASH_OUT],
      '1234',
    );
    const {
      challengeId: ch2,
      otp: otp_af002_1574,
      operationKey: cashOutOperation1698,
    } = await issueCashOutOtp({
      agentId: agentB.id,
      customerId: customerId,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agentB.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: ch2,
        otp: otp_af002_1574,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation1698,
      }),
    ).rejects.toThrow(/cannot execute as/i);
    // wrong Customer (OTP belongs to different customer)
    const phone2 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId: cust2 } = await createCustomerWithPhoneAndPin(phone2, '1234');
    const {
      challengeId: ch3,
      otp: otp_af003_1592,
      operationKey: cashOutOperation1720,
    } = await issueCashOutOtp({
      agentId: agent.id,
      customerId: cust2,
      amountMinor: '1000',
    });
    await expect(
      cashOutService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        customerId,
        customerPin: '1234',
        mfaChallengeId: ch3,
        otp: otp_af003_1592,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: cashOutOperation1720,
      }),
    ).rejects.toThrow(/belong|OTP/i);
  });
});
