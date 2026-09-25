/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/await-thenable, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
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
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { RecipientResolutionService } from '../src/agent/recipient-resolution.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('A13 Agent Cash→Wallet (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashInService: AgentCashInService;
  let financialService: AgentFinancialExecutionService;
  let authzService: AgentTransactionAuthorizationService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let recipientService: RecipientResolutionService;

  let systemLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a13cashin');
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
    financialService = moduleRef.get(AgentFinancialExecutionService);
    authzService = moduleRef.get(AgentTransactionAuthorizationService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    recipientService = moduleRef.get(RecipientResolutionService);

    // Ensure system account for funding Agents
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
      reference: `cls-a13-${randomUUID().slice(0, 8)}`,
      code: `A13-${randomUUID().slice(0, 6)}`,
      name: 'A13 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A13 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a13-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a13',
    });
    await appService.submit(appEntity.id, 'applicant-a13');
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
    // Ensure Agent wallet exists via WalletService (idempotent)
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

  async function createCustomerWithPhone(phoneCanonical: string, displayName = 'Customer A13'): Promise<{ customerId: string; wallet: any }> {
    const custRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-a13-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, displayName]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phoneCanonical]);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
  }

  async function fundAgent(agentId: string, walletLedgerAccountId: string, amount: string) {
    // Credit Agent via system float
    const sys = systemLedgerAccountId;
    await ledgerService.postJournal({
      idempotencyKey: `fund-${agentId}-${amount}-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: sys, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: walletLedgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
    });
  }

  // A. successful Cash→Wallet
  it('A. successful Cash→Wallet Agent decreases, Customer increases, equal principal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '10000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);
    const agentBalBefore = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBalBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBalBefore.balanceMinor).toBe('10000');
    expect(custBalBefore.balanceMinor).toBe('0');

    const result = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: `a-${randomUUID()}`,
      reference: `ref-a-${randomUUID()}`,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.journalId).toBeDefined();
    expect(result.replayed).toBe(false);
    expect(result.amountMinor).toBe('3000');
    expect(result.recipientCustomerId).toBe(customerId);

    const agentBalAfter = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBalAfter = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBalAfter.balanceMinor).toBe('7000');
    expect(custBalAfter.balanceMinor).toBe('3000');
    // Conservation
    const agentDelta = BigInt(agentBalAfter.balanceMinor) - BigInt(agentBalBefore.balanceMinor);
    const custDelta = BigInt(custBalAfter.balanceMinor) - BigInt(custBalBefore.balanceMinor);
    expect(agentDelta).toBe(-3000n);
    expect(custDelta).toBe(3000n);
    expect(agentDelta + custDelta).toBe(0n);
  });

  // B. recipient resolution by Customer phone
  it('B. recipient resolution by Customer phone', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `90${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone, 'Phone Customer');
    const res = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `b-${randomUUID()}`,
    });
    expect(res.recipientCustomerId).toBe(customerId);
    const bal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(bal.balanceMinor).toBe('1000');
  });

  // C. recipient resolution by Customer MonieNaija receiving number (canonical variant)
  it('C. recipient resolution by Customer MonieNaija receiving number', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `81${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone, 'Receiving Customer');
    // Use +234 variant as receiving number
    const plus234 = `+234${phone}`;
    const res = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: plus234,
      amountMinor: '1200',
      currency: 'NGN',
      idempotencyKey: `c-${randomUUID()}`,
    });
    expect(res.recipientCustomerId).toBe(customerId);
    const bal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(bal.balanceMinor).toBe('1200');
  });

  // D. Agent identifier cannot resolve as Customer recipient
  it('D. Agent identifier cannot resolve as Customer recipient', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const { agent: agentB } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    // Get agentB's receiving number
    const rnRows: Array<{ receiving_number: string }> = await dataSource.query(`SELECT receiving_number FROM agent_receiving_numbers WHERE agent_id=$1`, [agentB.id]);
    expect(rnRows[0]).toBeDefined();
    const agentBNumber = rnRows[0]!.receiving_number;
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: agentBNumber,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `d-${randomUUID()}`,
      }),
    ).rejects.toThrow(/Recipient must be a Customer|Agent/i);
    // Ensure no debit
    const bal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(bal.balanceMinor).toBe('5000');
  });

  // E. unknown recipient rejected
  it('E. unknown recipient rejected', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const unknownPhone = `70${Math.floor(10000000 + Math.random() * 89999999)}`;
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: unknownPhone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `e-${randomUUID()}`,
      }),
    ).rejects.toThrow(/not found/i);
    const bal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(bal.balanceMinor).toBe('5000');
  });

  // F. deleted/ineligible Customer rejected
  it('F. deleted/ineligible Customer rejected', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `70${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhone(phone, 'ToDelete');
    // Soft-delete customer
    await dataSource.query(`UPDATE customers SET deleted_at=NOW() WHERE id=$1`, [customerId]);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `f-${randomUUID()}`,
      }),
    ).rejects.toThrow(/not found/i);
    // Also test CLOSED
    const phone2 = `70${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId: cid2 } = await createCustomerWithPhone(phone2, 'Closed');
    await dataSource.query(`UPDATE customers SET status='CLOSED' WHERE id=$1`, [cid2]);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone2,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `f2-${randomUUID()}`,
      }),
    ).rejects.toThrow(/not found/i);
    // SUSPENDED also ineligible for Cash→Wallet (our service checks ACTIVE only)
    const phone3 = `70${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId: cid3 } = await createCustomerWithPhone(phone3, 'Suspended');
    await dataSource.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [cid3]);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone3,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `f3-${randomUUID()}`,
      }),
    ).rejects.toThrow(/not found/i);
  });

  // G. missing/invalid amount rejected
  it('G. missing/invalid amount rejected', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    for (const bad of ['0', '-100', '0.5', 'abc', '']) {
      await expect(
        cashInService.execute({
          agentId: agent.id,
          principal: agentPrincipal(agent.id) as any,
          pin: '1234',
          recipientIdentifier: phone,
          amountMinor: bad as any,
          currency: 'NGN',
          idempotencyKey: `g-${randomUUID()}`,
        }),
      ).rejects.toThrow();
    }
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: '',
      }),
    ).rejects.toThrow(/idempotency/i);
  });

  // H. non-NGN rejected
  it('H. non-NGN rejected', async () => {
    const { agent } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'USD',
        idempotencyKey: `h-${randomUUID()}`,
      }),
    ).rejects.toThrow(/NGN/i);
  });

  // I. Agent without CASH_IN denied
  it('I. Agent without CASH_IN denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_OUT], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `i-${randomUUID()}`,
      }),
    ).rejects.toThrow(/CASH_IN|capability|not permitted/i);
  });

  // J. suspended Agent denied
  it('J. suspended Agent denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await lifecycleService.suspend(agent.id, 'test-actor');
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `j-${randomUUID()}`,
      }),
    ).rejects.toThrow(/SUSPENDED|suspended|not permitted/i);
  });

  // K. terminated Agent denied
  it('K. terminated Agent denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await lifecycleService.terminate(agent.id, 'test-actor');
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `k-${randomUUID()}`,
      }),
    ).rejects.toThrow(/TERMINATED|terminated|not permitted/i);
  });

  // L. pending Agent denied
  it('L. pending Agent denied', async () => {
    const cls = await classService.create({
      reference: `cls-pend-a13-${randomUUID().slice(0, 6)}`,
      code: `PEND-A13-${randomUUID().slice(0, 6)}`,
      name: 'Pend A13',
      isActive: true,
      applicableServices: [AgentService.CASH_IN],
      actor: 'test-actor',
    });
    const pendingId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'PENDING',$3,1)`, [pendingId, `pend-a13-${randomUUID()}`, cls.id]);
    await pinService.setTransactionPin(pendingId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: pendingId,
    });
    // also need wallet for pending agent to avoid wallet not found masking auth failure
    await walletService.createWallet({ customerId: pendingId, currency: 'NGN', idempotencyKey: `pend-wallet-${pendingId}-${randomUUID()}` });
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await expect(
      cashInService.execute({
        agentId: pendingId,
        principal: agentPrincipal(pendingId) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `l-${randomUUID()}`,
      }),
    ).rejects.toThrow(/PENDING|not permitted/i);
  });

  // M. missing/inactive Agent class denied
  it('M. missing/inactive Agent class denied', async () => {
    const { agent, wallet: agentWallet, cls } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await classService.update(cls.id, { isActive: false, actor: 'test-actor' });
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `m-${randomUUID()}`,
      }),
    ).rejects.toThrow(/CLASS_INACTIVE|class/i);
    // missing class
    const noClassId = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status, agent_class_id, version) VALUES ($1,$2,'ACTIVE',NULL,1)`, [noClassId, `noclass-a13-${randomUUID()}`]);
    await pinService.setTransactionPin(noClassId, {
      pinHash: hashPin('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: noClassId,
    });
    await walletService.createWallet({ customerId: noClassId, currency: 'NGN', idempotencyKey: `noclass-wallet-${noClassId}-${randomUUID()}` });
    await expect(
      cashInService.execute({
        agentId: noClassId,
        principal: agentPrincipal(noClassId) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `m2-${randomUUID()}`,
      }),
    ).rejects.toThrow(/class|CLASS/i);
  });

  // N. invalid PIN denied
  it('N. invalid PIN denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '9999',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `n-${randomUUID()}`,
      }),
    ).rejects.toThrow(/PIN|pin|invalid/i);
  });

  // O. locked PIN denied
  it('O. locked PIN denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    const princ = agentPrincipal(agent.id);
    for (let i = 0; i < 5; i++) {
      try {
        await cashInService.execute({
          agentId: agent.id,
          principal: princ as any,
          pin: '0000',
          recipientIdentifier: phone,
          amountMinor: '100',
          currency: 'NGN',
          idempotencyKey: `o-attempt-${i}-${randomUUID()}`,
        });
      } catch {}
    }
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: princ as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `o-${randomUUID()}`,
      }),
    ).rejects.toThrow(/locked|PIN_LOCKED/i);
  });

  // P. Customer principal denied
  it('P. Customer principal denied', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhone(phone);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: customerPrincipal(customerId) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `p-${randomUUID()}`,
      }),
    ).rejects.toThrow(/Customer principal|PRINCIPAL_NOT_AGENT|not permitted/i);
  });

  // Q. Agent A cannot execute as Agent B
  it('Q. Agent A cannot execute as Agent B', async () => {
    const { agent: agentA, wallet: walletA } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const { agent: agentB } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agentA.id, walletA.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    await expect(
      cashInService.execute({
        agentId: agentB.id,
        principal: agentPrincipal(agentA.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `q-${randomUUID()}`,
      }),
    ).rejects.toThrow(/cannot execute as|PRINCIPAL_MISMATCH|mismatch/i);
  });

  // R. insufficient Agent balance rejected
  it('R. insufficient Agent balance rejected', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    // No funding, balance 0
    const bal0 = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(bal0.balanceMinor).toBe('0');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: custWallet } = await createCustomerWithPhone(phone);
    const custBalBefore = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(custBalBefore.balanceMinor).toBe('0');
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: `r-${randomUUID()}`,
      }),
    ).rejects.toThrow(/sufficient|insufficient|negative/i);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    const agentBalAfter = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBalAfter = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBalAfter.balanceMinor).toBe('0');
    expect(custBalAfter.balanceMinor).toBe('0');
  });

  // S. successful transaction creates balanced journal
  it('S. successful transaction creates balanced journal', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '8000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);
    const res = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '2500',
      currency: 'NGN',
      idempotencyKey: `s-${randomUUID()}`,
    });
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal).toBeDefined();
    expect(journal!.currency).toBe('NGN');
    expect(journal!.accountingUnit).toBe('CUSTOMER_FUNDS');
    // Balanced
    const lines = journal!.lines;
    expect(lines.length).toBe(2);
    const totalDebit = lines.filter((l) => l.direction === LedgerEntryDirection.DEBIT).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const totalCredit = lines.filter((l) => l.direction === LedgerEntryDirection.CREDIT).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit.toString()).toBe('2500');
    // Owner-aware
    const debit = lines.find((l) => l.direction === LedgerEntryDirection.DEBIT)!;
    const credit = lines.find((l) => l.direction === LedgerEntryDirection.CREDIT)!;
    expect(debit.accountId).toBe(agentWallet.ledgerAccountId);
    expect(credit.accountId).toBe(custWallet.ledgerAccountId);
    // Journal metadata contains operation
    expect((journal!.metadata as any).operation).toBe('CASH_IN');
    expect((journal!.metadata as any).agentId).toBe(agent.id);
    expect((journal!.metadata as any).recipientCustomerId).toBe(customerId);
  });

  // T. failed transaction creates no partial journal/effect
  it('T. failed transaction creates no partial journal/effect', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '1000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: custWallet } = await createCustomerWithPhone(phone);
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const beforeAgentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const beforeCustBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    // Try insufficient (should fail entirely)
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: `t-${randomUUID()}`,
      }),
    ).rejects.toThrow();
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const afterAgentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const afterCustBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    expect(afterAgentBal.balanceMinor).toBe(beforeAgentBal.balanceMinor);
    expect(afterCustBal.balanceMinor).toBe(beforeCustBal.balanceMinor);
    // No orphan lines
    const orphan: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines WHERE journal_id NOT IN (SELECT id FROM ledger_journals)`);
    expect(orphan[0]!.cnt).toBe('0');
  });

  // U. idempotent replay creates no second financial effect
  it('U. idempotent replay creates no second financial effect', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: custWallet } = await createCustomerWithPhone(phone);
    const key = `u-${randomUUID()}`;
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const r1 = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    const r2 = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(r1.journalId).toBe(r2.journalId);
    expect(r2.replayed).toBe(true);
    expect(r2.status).toBe('REPLAYED');
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(BigInt(afterJournals[0]!.cnt)).toBe(BigInt(beforeJournals[0]!.cnt) + 1n);
    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('3000'); // 5000-2000
    expect(custBal.balanceMinor).toBe('2000');
  });

  // V. conflicting idempotency request rejected
  it('V. conflicting idempotency request rejected', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    const phone2 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone2);
    const key = `v-${randomUUID()}`;
    await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone2,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/already used/i);
    await expect(
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
    ).rejects.toThrow(/already used/i);
  });

  // W. concurrent duplicate request converges correctly
  it('W. concurrent duplicate request converges correctly', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '10000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: custWallet } = await createCustomerWithPhone(phone);
    const key = `w-${randomUUID()}`;
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const [r1, r2] = await Promise.all([
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
    ]);
    const ids = [r1.journalId, r2.journalId];
    expect(ids[0]).toBe(ids[1]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['COMPLETED', 'REPLAYED']);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(BigInt(afterJournals[0]!.cnt)).toBe(BigInt(beforeJournals[0]!.cnt) + 1n);
    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    const custBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('7000');
    expect(custBal.balanceMinor).toBe('3000');
  });

  // X. concurrent debits cannot produce negative Agent balance
  it('X. concurrent debits cannot produce negative Agent balance', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '10000');
    const phone1 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const phone2 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: cw1 } = await createCustomerWithPhone(phone1);
    const { wallet: cw2 } = await createCustomerWithPhone(phone2);
    // Two concurrent cash-ins of 8000 each from same Agent (only one should succeed)
    const results = await Promise.allSettled([
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone1,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: `x1-${randomUUID()}`,
      }),
      cashInService.execute({
        agentId: agent.id,
        principal: agentPrincipal(agent.id) as any,
        pin: '1234',
        recipientIdentifier: phone2,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: `x2-${randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0]!.reason as Error).message.toLowerCase()).toContain('sufficient');
    const agentBal = await ledgerService.getAccountBalance(agentWallet.ledgerAccountId);
    expect(agentBal.balanceMinor).toBe('2000');
    expect(BigInt(agentBal.balanceMinor) >= 0n).toBe(true);
    // One of the customers got 8000, the other 0
    const b1 = await ledgerService.getAccountBalance(cw1.ledgerAccountId);
    const b2 = await ledgerService.getAccountBalance(cw2.ledgerAccountId);
    const sum = BigInt(b1.balanceMinor) + BigInt(b2.balanceMinor);
    expect(sum).toBe(8000n);
  });

  // Extra concurrency: concurrent credits to same Customer remain ledger-correct
  it('concurrent credits to same Customer remain ledger-correct', async () => {
    const { agent: agentA, wallet: walletA } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const { agent: agentB, wallet: walletB } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agentA.id, walletA.ledgerAccountId, '5000');
    await fundAgent(agentB.id, walletB.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: custWallet } = await createCustomerWithPhone(phone);
    const results = await Promise.allSettled([
      cashInService.execute({
        agentId: agentA.id,
        principal: agentPrincipal(agentA.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: `conc-cust-1-${randomUUID()}`,
      }),
      cashInService.execute({
        agentId: agentB.id,
        principal: agentPrincipal(agentB.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `conc-cust-2-${randomUUID()}`,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);
    const custBal = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(custBal.balanceMinor).toBe('5000');
  });

  // Y. audit exists and contains no PIN/hash/secret
  it('Y. audit exists and contains no PIN/hash/secret', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    const key = `y-${randomUUID()}`;
    const corr = `corr-y-${randomUUID()}`;
    const res = await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: key,
      correlationId: corr,
    });
    const audits: Array<{ new_values: any; entity_type: string; action: string }> = await dataSource.query(
      `SELECT new_values, entity_type, action FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_CASH_IN' ORDER BY occurred_at DESC LIMIT 1`,
      [res.journalId],
    );
    expect(audits.length).toBe(1);
    const nv = audits[0]!.new_values as Record<string, unknown>;
    const serial = JSON.stringify(nv).toLowerCase();
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('pinhash');
    expect(serial).not.toContain('pin_hash');
    expect(serial).not.toContain('secret');
    expect(nv['agentId']).toBe(agent.id);
    expect(nv['amountMinor']).toBe('1500');
    expect(nv['currency']).toBe('NGN');
    expect(nv['operation']).toBe('CASH_IN');
    expect(nv['journalId']).toBe(res.journalId);
    expect(nv['idempotencyKey']).toBe(key);
    // Also check A12 audit exists
    const a12Audits: Array<{ entity_type: string }> = await dataSource.query(`SELECT entity_type FROM audit_events WHERE entity_id=$1 AND entity_type='AGENT_FINANCIAL_EXECUTION'`, [res.journalId]);
    expect(a12Audits.length).toBe(1);
  });

  // Z. no physical-cash ledger/accounting state is created
  it('Z. no physical-cash ledger/accounting state is created', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    const beforeAccounts: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_accounts`);
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `z-${randomUUID()}`,
    });
    const afterAccounts: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_accounts`);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    // One journal added, but no new ledger account for cash
    expect(BigInt(afterJournals[0]!.cnt)).toBe(BigInt(beforeJournals[0]!.cnt) + 1n);
    // No cash account should be created (accounts may increase only if wallets were auto-created, but not cash)
    // Check that no account with code like CASH exists
    const cashAcc: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_accounts WHERE code ILIKE '%CASH%' AND code != 'CASH_TO_CASH-UNCLAIMED-NGN'`);
    expect(cashAcc[0]!.cnt).toBe('0');
    // Check ledger_accounts has no physical cash type
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ledger_accounts'`);
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain('cash');
    // No extra wallet for cash
    const walletCols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts'`);
    const wnames = walletCols.map((c) => c.column_name);
    expect(wnames).not.toContain('cash');
  });

  // AA. no Customer record is created as side effect
  it('AA. no Customer record is created as side effect', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId } = await createCustomerWithPhone(phone);
    const beforeCust: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    const beforeVal = BigInt(beforeCust[0]!.cnt);
    await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `aa-${randomUUID()}`,
    });
    const afterCust: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customers`);
    expect(BigInt(afterCust[0]!.cnt)).toBe(beforeVal);
    // Ensure the same customer still exists, not duplicated
    const custRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM customers WHERE id=$1`, [customerId]);
    expect(custRows.length).toBe(1);
  });

  // AB. existing Customer financial flows remain functional
  it('AB. existing Customer financial flows remain functional', async () => {
    // Create two customer wallets and do a Transfer via WalletService/LedgerService directly
    const custId1 = randomUUID();
    const custId2 = randomUUID();
    await dataSource.query(`INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [custId1, `ab-cust1-${randomUUID().slice(0,6)}`]);
    await dataSource.query(`INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`, [custId2, `ab-cust2-${randomUUID().slice(0,6)}`]);
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'AB1',true)`, [custId1]);
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,'AB2',true)`, [custId2]);
    const wallet1 = await walletService.createWallet({ customerId: custId1, currency: 'NGN', idempotencyKey: `ab1-${randomUUID()}` });
    const wallet2 = await walletService.createWallet({ customerId: custId2, currency: 'NGN', idempotencyKey: `ab2-${randomUUID()}` });
    // Fund wallet1 via system
    await ledgerService.postJournal({
      idempotencyKey: `ab-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
        { accountId: wallet1.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '5000' },
      ],
    });
    const before1 = await ledgerService.getAccountBalance(wallet1.ledgerAccountId);
    const before2 = await ledgerService.getAccountBalance(wallet2.ledgerAccountId);
    expect(before1.balanceMinor).toBe('5000');
    expect(before2.balanceMinor).toBe('0');
    // Do a customer-to-customer transfer via ledger (simulating Wallet→Wallet)
    await ledgerService.postJournal({
      idempotencyKey: `ab-xfer-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: wallet1.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '2000' },
        { accountId: wallet2.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '2000' },
      ],
    });
    const after1 = await ledgerService.getAccountBalance(wallet1.ledgerAccountId);
    const after2 = await ledgerService.getAccountBalance(wallet2.ledgerAccountId);
    expect(after1.balanceMinor).toBe('3000');
    expect(after2.balanceMinor).toBe('2000');
    // Now also test that Cash→Wallet still works after that
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '3000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: cw } = await createCustomerWithPhone(phone);
    await cashInService.execute({
      agentId: agent.id,
      principal: agentPrincipal(agent.id) as any,
      pin: '1234',
      recipientIdentifier: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `ab-cashin-${randomUUID()}`,
    });
    const cwBal = await ledgerService.getAccountBalance(cw.ledgerAccountId);
    expect(cwBal.balanceMinor).toBe('1000');
  });

  // AC. A8/A9/A10/A11/A12 regression smoke
  it('AC. A8/A9/A10/A11/A12 regression smoke', async () => {
    // A10 capability check
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const cap = await (await import('../src/agent/agent-service-capability.service')).AgentServiceCapabilityService;
    // Use service directly
    const capabilityService = (cashInService as any).authorizationService?.['capabilityService'] ?? null;
    // Instead, test via authz service
    const authRes = await authzService.authorize({
      agentId: agent.id,
      service: AgentService.CASH_IN,
      pin: '1234',
      principal: agentPrincipal(agent.id) as any,
    });
    expect(authRes.allowed).toBe(true);
    // A12 direct financial execution still works
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '2000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { wallet: cw } = await createCustomerWithPhone(phone);
    const exec = await financialService.execute({
      authorizedContext: authRes.context!,
      idempotencyKey: `ac-a12-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: agentWallet.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '500' },
        { accountId: cw.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '500' },
      ],
    });
    expect(exec.status).toBe('COMPLETED');
    // A9 recipient resolution still works
    const res = await recipientService.resolve(phone);
    expect(res.ownerType).toBe('CUSTOMER');
    // A8 lifecycle still works (suspend/reactivate)
    await lifecycleService.suspend(agent.id, 'test-actor');
    const afterSuspend = await dataSource.query(`SELECT status FROM agents WHERE id=$1`, [agent.id]);
    expect(afterSuspend[0].status).toBe('SUSPENDED');
    await lifecycleService.reactivate(agent.id, 'test-actor');
    const afterReact = await dataSource.query(`SELECT status FROM agents WHERE id=$1`, [agent.id]);
    expect(afterReact[0].status).toBe('ACTIVE');
  });

  // Concurrency 1: Two concurrent Cash→Wallet debits from same Agent where only one can succeed (already X)
  // Concurrency 4 already covered, but add explicit test for physical cash not involved is Z

  // HTTP security: Agent endpoint requires AGENT principal (tested via service, but also via app.inject)
  it('HTTP: Customer cannot invoke Agent Cash→Wallet', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(agent.id, agentWallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    // Create a Customer session token via direct principal injection is not possible via HTTP without customer auth,
    // but we can test that calling service with CUSTOMER principal is denied (already P), and that endpoint without token is 401
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-in',
      payload: {
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `http-cust-${randomUUID()}`,
        pin: '1234',
      },
    });
    expect([401, 403].includes(res.statusCode)).toBe(true);
  });

  it('HTTP: Agent A cannot use Agent B wallet via service', async () => {
    const { agent: agentA, wallet: walletA } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    const { agent: agentB } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(walletA.ledgerAccountId, walletA.ledgerAccountId, '1000').catch(() => {});
    // Actually fund agentA correctly
    await ledgerService.postJournal({
      idempotencyKey: `http-fund-a-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
        { accountId: walletA.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '5000' },
      ],
    });
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    await createCustomerWithPhone(phone);
    // Attempt via service with mismatched principal
    await expect(
      cashInService.execute({
        agentId: agentB.id,
        principal: agentPrincipal(agentA.id) as any,
        pin: '1234',
        recipientIdentifier: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `http-mismatch-${randomUUID()}`,
      }),
    ).rejects.toThrow(/cannot execute as|mismatch/i);
  });
});
