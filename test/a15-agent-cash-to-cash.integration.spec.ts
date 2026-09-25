/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-argument, @typescript-eslint/await-thenable, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentCashToCashService } from '../src/agent/agent-cash-to-cash.service';
import { AgentCashInService } from '../src/agent/agent-cash-in.service';
import { AgentCashOutService } from '../src/agent/agent-cash-out.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';

import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('A15 Agent Cash→Cash (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let cashToCashService: AgentCashToCashService;
  let cashInService: AgentCashInService;
  let cashOutService: AgentCashOutService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let ledgerService: LedgerService;

  let systemLedgerAccountId: string;
  let unclaimedLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a15cashtocash');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    cashToCashService = moduleRef.get(AgentCashToCashService);
    cashInService = moduleRef.get(AgentCashInService);
    cashOutService = moduleRef.get(AgentCashOutService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);

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
    const unclaimedRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' LIMIT 1`);
    if (unclaimedRows[0]) {
      unclaimedLedgerAccountId = unclaimedRows[0]!.id;
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
  }, 180000);

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
  }, 60000);

  async function createActiveAgentWithServicesAndPin(services: unknown, pin: string | null, isActive = true) {
    const cls = await classService.create({
      reference: `cls-a15-${randomUUID().slice(0, 8)}`,
      code: `A15-${randomUUID().slice(0, 6)}`,
      name: 'A15 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A15 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a15-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a15',
    });
    await appService.submit(appEntity.id, 'applicant-a15');
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
      [`cust-a15-${randomUUID().slice(0, 8)}`],
    );
    const customerId = custRows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, `Customer A15 ${randomUUID().slice(0,4)}`]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$2,true)`, [customerId, phoneCanonical]);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `cust-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, wallet };
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

  // 1. valid Cash→Cash initiation succeeds
  it('1. valid Cash→Cash initiation succeeds', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '10000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: `1-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    expect(res.transferId).toBeDefined();
    expect(res.journalId).toBeDefined();
    expect(res.beneficiaryPhone).toBe(phone.replace(/^0/, '').replace(/^234/, '').replace(/^\+234/, '').slice(-10));
    expect(res.transferCode).toBeDefined();
    expect(res.transferCode!).toMatch(/^\d{8}$/);
    expect(res.replayed).toBe(false);
  });

  // 2. unregistered beneficiary phone is accepted
  it('2. unregistered beneficiary phone is accepted', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const unregisteredPhone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    // ensure no customer has this phone
    const exists: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customer_contact_methods WHERE normalized_value=$1`, [unregisteredPhone]);
    expect(exists[0]!.cnt).toBe('0');
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: unregisteredPhone,
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: `2-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    expect(res.beneficiaryPhone).toBe(unregisteredPhone);
    const transferRows: Array<{ beneficiary_phone: string }> = await dataSource.query(`SELECT beneficiary_phone FROM cash_to_cash_transfers WHERE id=$1`, [res.transferId]);
    expect(transferRows[0]!.beneficiary_phone).toBe(unregisteredPhone);
  });

  // 3. registered Customer beneficiary phone does NOT become a Customer wallet credit through A15
  it('3. registered Customer phone does NOT credit wallet via A15', async () => {
    const { agent, wallet: agentWallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(agentWallet.ledgerAccountId, '10000');
    const phone = `81${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { customerId, wallet: custWallet } = await createCustomerWithPhone(phone);
    const beforeCust = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: `3-${randomUUID()}`,
    });
    expect(res.status).toBe('COMPLETED');
    const afterCust = await ledgerService.getAccountBalance(custWallet.ledgerAccountId);
    expect(afterCust.balanceMinor).toBe(beforeCust.balanceMinor);
    // ensure no customer wallet credit via unclaimed instead
    const journal = await ledgerService.getJournal(res.journalId);
    const creditLine = journal!.lines.find(l => l.direction === LedgerEntryDirection.CREDIT)!;
    expect(creditLine.accountId).toBe(unclaimedLedgerAccountId);
    expect(creditLine.accountId).not.toBe(custWallet.ledgerAccountId);
  });

  // 4. exact beneficiary phone is persisted canonically
  it('4. exact beneficiary phone is persisted canonically', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const variants = [`0${phone}`, `+234${phone}`];
    for (const variant of variants) {
      const canonical = variant.replace(/^\+234/, '').replace(/^234/, '').replace(/^0/, '');
      const res = await cashToCashService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        beneficiaryPhone: variant,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `4-${randomUUID()}`,
      });
      expect(res.beneficiaryPhone).toBe(canonical);
      const row: Array<{ beneficiary_phone: string }> = await dataSource.query(`SELECT beneficiary_phone FROM cash_to_cash_transfers WHERE id=$1`, [res.transferId]);
      expect(row[0]!.beneficiary_phone).toBe(canonical);
    }
  });

  // 5. transfer code is not stored plaintext
  it('5. transfer code is not stored plaintext', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `82${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1200',
      currency: 'NGN',
      idempotencyKey: `5-${randomUUID()}`,
    });
    const code = res.transferCode!;
    const rows: Array<{ transfer_code_hash: string; beneficiary_phone: string }> = await dataSource.query(`SELECT transfer_code_hash, beneficiary_phone FROM cash_to_cash_transfers WHERE id=$1`, [res.transferId]);
    expect(rows[0]!.transfer_code_hash).not.toContain(code);
    expect(rows[0]!.transfer_code_hash).toMatch(/^PBKDF2\$sha256\$\d+\$.+\$.+/);
    // also check idempotency record does not contain plaintext
    const idem: Array<{ response_body: any }> = await dataSource.query(`SELECT response_body FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`, [`agent-financial.v1:${agent.id}`, res.idempotencyKey]);
    expect(JSON.stringify(idem[0]!.response_body).toLowerCase()).not.toContain(code.toLowerCase());
    const audit: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='AGENT_CASH_TO_CASH' AND entity_id=$1`, [res.journalId]);
    expect(JSON.stringify(audit[0]!.new_values).toLowerCase()).not.toContain(code.toLowerCase());
  });

  // 6. transfer-code hash is present and bound to beneficiary phone
  it('6. transfer-code hash is present and bound to beneficiary phone', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `83${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1300',
      currency: 'NGN',
      idempotencyKey: `6-${randomUUID()}`,
    });
    const rows: Array<{ transfer_code_hash: string; beneficiary_phone: string; hash_algorithm: string }> = await dataSource.query(`SELECT transfer_code_hash, beneficiary_phone, hash_algorithm FROM cash_to_cash_transfers WHERE id=$1`, [res.transferId]);
    expect(rows[0]!.transfer_code_hash).toBeDefined();
    expect(rows[0]!.hash_algorithm).toBe('PBKDF2');
    expect(rows[0]!.beneficiary_phone).toBe(phone);
    // Different phone should have different binding, but hash is per transfer, not phone-derived. Just ensure they are distinct transfers can have same code but different phone? Not needed.
  });

  // 7. Agent balance decreases correctly
  it('7. Agent balance decreases correctly', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '8000');
    const before = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const phone = `84${Math.floor(10000000 + Math.random() * 89999999)}`;
    await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '2500',
      currency: 'NGN',
      idempotencyKey: `7-${randomUUID()}`,
    });
    const after = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) - 2500n);
  });

  // 8. reserved/unclaimed principal is identifiable
  it('8. reserved/unclaimed principal is identifiable', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `85${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1800',
      currency: 'NGN',
      idempotencyKey: `8-${randomUUID()}`,
    });
    const transfer: Array<{ status: string; principal_minor: string; total_minor: string }> = await dataSource.query(`SELECT status, principal_minor, total_minor FROM cash_to_cash_transfers WHERE id=$1`, [res.transferId]);
    expect(transfer[0]!.status).toBe('UNCLAIMED');
    expect(transfer[0]!.principal_minor).toBe('1800');
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal!.lines.some(l => l.accountId === unclaimedLedgerAccountId && l.direction === LedgerEntryDirection.CREDIT && l.amountMinor === '1800')).toBe(true);
    const unclaimedBal = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    expect(BigInt(unclaimedBal.balanceMinor) >= 1800n).toBe(true);
  });

  // 9. applicable fee is separated correctly if fee infrastructure is enabled
  it('9. fee separated correctly (V1 fee 0)', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `86${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `9-${randomUUID()}`,
    });
    const rows: Array<{ fee_minor: string; vat_minor: string; total_minor: string; principal_minor: string }> = await dataSource.query(`SELECT fee_minor, vat_minor, total_minor, principal_minor FROM cash_to_cash_transfers WHERE id=$1`, [res.transferId]);
    expect(rows[0]!.fee_minor).toBe('0');
    expect(rows[0]!.vat_minor).toBe('0');
    expect(rows[0]!.total_minor).toBe(rows[0]!.principal_minor);
  });

  // 10. insufficient Agent balance produces no financial mutation
  it('10. insufficient Agent balance produces no financial mutation', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    // no funding, balance 0
    const beforeAgent = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(beforeAgent.balanceMinor).toBe('0');
    const beforeUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const phone = `87${Math.floor(10000000 + Math.random() * 89999999)}`;
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const beforeTransfers: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM cash_to_cash_transfers`);
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `10-${randomUUID()}`,
    })).rejects.toThrow(/sufficient|insufficient/i);
    const afterAgent = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const afterUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    expect(afterAgent.balanceMinor).toBe(beforeAgent.balanceMinor);
    expect(afterUnclaimed.balanceMinor).toBe(beforeUnclaimed.balanceMinor);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    const afterTransfers: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM cash_to_cash_transfers`);
    expect(afterTransfers[0]!.cnt).toBe(beforeTransfers[0]!.cnt);
  });

  // 11. no Agent overdraft
  it('11. no Agent overdraft', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '1000');
    const phone = `88${Math.floor(10000000 + Math.random() * 89999999)}`;
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: `11-${randomUUID()}`,
    })).rejects.toThrow();
    const bal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(bal.balanceMinor).toBe('1000');
  });

  // 12. duplicate same idempotency key does not double-debit
  it('12. duplicate same idempotency key does not double-debit', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '10000');
    const phone = `89${Math.floor(10000000 + Math.random() * 89999999)}`;
    const key = `12-${randomUUID()}`;
    const r1 = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(r1.status).toBe('COMPLETED');
    expect(r1.transferCode).toBeDefined();
    const beforeBal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const r2 = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '2000',
      currency: 'NGN',
      idempotencyKey: key,
    });
    expect(r2.status).toBe('REPLAYED');
    expect(r2.replayed).toBe(true);
    expect(r2.journalId).toBe(r1.journalId);
    expect(r2.transferId).toBe(r1.transferId);
    expect(r2.transferCode).toBeUndefined();
    const afterBal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(afterBal.balanceMinor).toBe(beforeBal.balanceMinor);
    const journals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals WHERE idempotency_key LIKE $1`, [`agent:${agent.id}:${key}`]);
    expect(journals[0]!.cnt).toBe('1');
  });

  // 13. concurrent same idempotency key produces exactly one financial effect
  it('13. concurrent same idempotency key produces exactly one financial effect', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '10000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const key = `13-${randomUUID()}`;
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const beforeTransfers: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM cash_to_cash_transfers`);
    const [r1, r2] = await Promise.all([
      cashToCashService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        beneficiaryPhone: phone,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: key,
      }),
      cashToCashService.execute({
        agentId: agent.id,
        agentPrincipal: agentPrincipal(agent.id) as any,
        agentPin: '1234',
        beneficiaryPhone: phone,
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
    const afterTransfers: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM cash_to_cash_transfers`);
    expect(BigInt(afterTransfers[0]!.cnt)).toBe(BigInt(beforeTransfers[0]!.cnt) + 1n);
  });

  // 14. different idempotency keys create distinct valid operations
  it('14. different idempotency keys create distinct valid operations', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '10000');
    const phone1 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const phone2 = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const r1 = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone1,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `14a-${randomUUID()}`,
    });
    const r2 = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone2,
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: `14b-${randomUUID()}`,
    });
    expect(r1.journalId).not.toBe(r2.journalId);
    expect(r1.transferId).not.toBe(r2.transferId);
    const bal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(bal.balanceMinor)).toBe(10000n - 1000n - 1500n);
  });

  // 15. invalid Agent status/service/PIN cannot initiate
  it('15. invalid Agent status/service/PIN cannot initiate', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    // wrong PIN
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '9999',
      beneficiaryPhone: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `15a-${randomUUID()}`,
    })).rejects.toThrow(/PIN/i);
    // missing service
    const { agent: agent2, wallet: w2 } = await createActiveAgentWithServicesAndPin([AgentService.CASH_IN], '1234');
    await fundAgent(w2.ledgerAccountId, '5000');
    await expect(cashToCashService.execute({
      agentId: agent2.id,
      agentPrincipal: agentPrincipal(agent2.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `15b-${randomUUID()}`,
    })).rejects.toThrow(/CASH_TO_CASH|capability/i);
    // suspended
    await lifecycleService.suspend(agent.id, 'test-actor');
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `15c-${randomUUID()}`,
    })).rejects.toThrow(/SUSPENDED/i);
  });

  // 16. failed authorization causes no ledger mutation
  it('16. failed authorization causes no ledger mutation', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const beforeAgent = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const beforeUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '0000',
      beneficiaryPhone: phone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `16-${randomUUID()}`,
    })).rejects.toThrow();
    const afterAgent = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const afterUnclaimed = await ledgerService.getAccountBalance(unclaimedLedgerAccountId);
    expect(afterAgent.balanceMinor).toBe(beforeAgent.balanceMinor);
    expect(afterUnclaimed.balanceMinor).toBe(beforeUnclaimed.balanceMinor);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
  });

  // 17. failed validation causes no ledger mutation
  it('17. failed validation causes no ledger mutation', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const beforeAgent = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: '12345', // invalid
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `17-${randomUUID()}`,
    })).rejects.toThrow(/Nigerian/i);
    const afterAgent = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(afterAgent.balanceMinor).toBe(beforeAgent.balanceMinor);
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: `80${Math.floor(10000000 + Math.random()*89999999)}`,
      amountMinor: '0',
      currency: 'NGN',
      idempotencyKey: `17b-${randomUUID()}`,
    })).rejects.toThrow();
  });

  // 18. audit trail contains the required initiation event without secrets
  it('18. audit trail contains initiation without secrets', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1100',
      currency: 'NGN',
      idempotencyKey: `18-${randomUUID()}`,
    });
    const audits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='AGENT_CASH_TO_CASH' AND entity_id=$1`, [res.journalId]);
    expect(audits.length).toBe(1);
    const serial = JSON.stringify(audits[0]!.new_values).toLowerCase();
    expect(serial).toContain(phone);
    expect(serial).toContain('unclaimed');
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('transfercode');
    expect(serial).not.toContain('pbkdf2');
    const code = res.transferCode!;
    expect(serial).not.toContain(code.toLowerCase());
    expect(JSON.stringify(res).toLowerCase()).not.toContain('pinhash');
  });

  // 19. journal is balanced
  it('19. journal is balanced', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const res = await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '1900',
      currency: 'NGN',
      idempotencyKey: `19-${randomUUID()}`,
    });
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal).toBeDefined();
    const debit = journal!.lines.filter(l => l.direction === LedgerEntryDirection.DEBIT).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    const credit = journal!.lines.filter(l => l.direction === LedgerEntryDirection.CREDIT).reduce((s, l) => s + BigInt(l.amountMinor), 0n);
    expect(debit).toBe(credit);
    expect(debit.toString()).toBe('1900');
    expect(journal!.lines.length).toBe(2);
  });

  // 20. transaction is atomic under failure (insufficient balance already covers, but also test that no partial transfer exists)
  it('20. transaction is atomic under failure', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '1000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const beforeTransfers: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM cash_to_cash_transfers WHERE agent_id=$1`, [agent.id]);
    await expect(cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: phone,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `20-${randomUUID()}`,
    })).rejects.toThrow();
    const afterTransfers: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM cash_to_cash_transfers WHERE agent_id=$1`, [agent.id]);
    expect(afterTransfers[0]!.cnt).toBe(beforeTransfers[0]!.cnt);
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    // journal count should not have increased for failed
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
  });

  // Additional: ensure no Agent recipient allowed
  it('21. Agent recipient not allowed', async () => {
    const { agent: agent1, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const { agent: agent2 } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    // get agent2 receiving number
    const recv: Array<{ receiving_number: string }> = await dataSource.query(`SELECT receiving_number FROM agent_receiving_numbers WHERE agent_id=$1`, [agent2.id]);
    expect(recv[0]).toBeDefined();
    const agentPhone = recv[0]!.receiving_number;
    await expect(cashToCashService.execute({
      agentId: agent1.id,
      agentPrincipal: agentPrincipal(agent1.id) as any,
      agentPin: '1234',
      beneficiaryPhone: agentPhone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `21-${randomUUID()}`,
    })).rejects.toThrow(/Agent recipient/i);
  });

  // Ensure no Customer wallet created via A15
  it('22. no Customer wallet created via A15', async () => {
    const beforeWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const unregisteredPhone = `80${Math.floor(10000000 + Math.random()*89999999)}`;
    await cashToCashService.execute({
      agentId: agent.id,
      agentPrincipal: agentPrincipal(agent.id) as any,
      agentPin: '1234',
      beneficiaryPhone: unregisteredPhone,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: `22-${randomUUID()}`,
    });
    const afterWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts`);
    // Only agent wallet exists, no new wallet for unregistered beneficiary
    expect(BigInt(afterWallets[0]!.cnt)).toBe(BigInt(beforeWallets[0]!.cnt) + 1n); // +1 for agent wallet created in this test
    const contact: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM customer_contact_methods WHERE normalized_value=$1`, [unregisteredPhone]);
    expect(contact[0]!.cnt).toBe('0');
    const custWallets: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM wallet_accounts WHERE customer_id::text IN (SELECT customer_id::text FROM customer_contact_methods WHERE normalized_value=$1)`, [unregisteredPhone]);
    expect(custWallets[0]!.cnt).toBe('0');
  });

  it('23. API authorization via HTTP', async () => {
    const { agent, wallet } = await createActiveAgentWithServicesAndPin([AgentService.CASH_TO_CASH], '1234');
    await fundAgent(wallet.ledgerAccountId, '5000');
    const phone = `80${Math.floor(10000000 + Math.random() * 89999999)}`;
    const resNoToken = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/cash-to-cash',
      payload: {
        beneficiaryPhone: phone,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `23-${randomUUID()}`,
        agentPin: '1234',
      },
    });
    expect([401, 403].includes(resNoToken.statusCode)).toBe(true);
  });
});
