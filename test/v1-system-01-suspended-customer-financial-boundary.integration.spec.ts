/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { TransferService } from '../src/transfer/transfer.service';
import {
  KycTierEvidenceReader,
  type TierEvidenceSnapshot,
} from '../src/kyc-verification/kyc-tier-evidence.reader';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * V1-SYSTEM-01 regression: WalletAccount.status is created ACTIVE and is NEVER transitioned
 * away from ACTIVE when the owning customer is later SUSPENDED — so wallet status alone
 * cannot be relied upon to block money movement for a suspended customer. Before this fix,
 * neither TransferService (Wallet→Wallet) nor CustomerFundingService.approve (Customer
 * Funding) re-checked the CURRENT `customers.status` at the point money actually moved,
 * meaning a SUSPENDED customer could still RECEIVE a wallet transfer from another active
 * customer, and a funding request created while ACTIVE could still be approved/credited
 * after the customer was later suspended. This mirrors the check already correctly applied
 * by agent cash-in, agent cash-out, and agent C2C claim.
 */
describe('V1-SYSTEM-01 suspended-customer financial boundary (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let transferService: TransferService;
  let fundingService: CustomerFundingService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  const snapshots = new Map<string, TierEvidenceSnapshot>();

  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: 'operator-checker-sys01',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: 'support-maker-sys01',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1system01-suspend');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue({
        read: (_manager: unknown, id: string) => Promise.resolve(snapshots.get(id) ?? null),
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    transferService = moduleRef.get(TransferService);
    fundingService = moduleRef.get(CustomerFundingService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    // Controlled local policy and synthetic trusted reader: exercise the real
    // eligibility gate without activating or asserting a production policy.
    const proposal = randomUUID(),
      requirements = { all: [], any: [] };
    const definition = {
      regulatoryRequirementsConfirmed: true,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveUntil: null,
      regulatory: { LEVEL_1: requirements, LEVEL_2: requirements },
      operator: { LEVEL_1: requirements, LEVEL_2: requirements },
    };
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_proposals(id,request_id,expected_version,definition,fingerprint,maker_id,maker_session_id,checker_id,checker_session_id,state) VALUES($1,$2,0,$3,$4,'maker',$5,'checker',$6,'APPROVED')`,
      [
        proposal,
        randomUUID(),
        JSON.stringify(definition),
        'a'.repeat(64),
        randomUUID(),
        randomUUID(),
      ],
    );
    await dataSource.query(
      `INSERT INTO kyc_tier_policy_versions(version,proposal_id,definition,maker_id,checker_id) VALUES(1,$1,$2,'maker','checker')`,
      [proposal, JSON.stringify(definition)],
    );
    await dataSource.query('UPDATE kyc_tier_policy_head SET version=1');
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        /* noop */
      }
    }
  });

  async function createActiveCustomerWithWallet(): Promise<{
    customerId: string;
    walletId: string;
    ledgerAccountId: string;
  }> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-sys01-${randomUUID().slice(0, 8)}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'Suspend Boundary Customer'],
    );
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, canonical10],
    );
    await dataSource.query(
      `INSERT INTO customer_kyc_assessments(customer_id,kyc_level,kyc_status,assessed_by,expires_at) VALUES($1,'LEVEL_1','APPROVED','fixture',clock_timestamp()+interval '1 hour')`,
      [customerId],
    );
    snapshots.set(customerId, {
      identityRevision: 'fixture',
      evidence: [
        {
          id: randomUUID(),
          customerId,
          identityRevision: 'fixture',
          type: 'BVN',
          status: 'VERIFIED',
          provenance: 'VERIFIED_PROVIDER',
          verifiedAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 1800000),
        },
      ],
    });
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `sys01-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, walletId: wallet.id, ledgerAccountId: wallet.ledgerAccountId };
  }

  async function suspendCustomer(customerId: string): Promise<void> {
    await dataSource.query(`UPDATE customers SET status='SUSPENDED' WHERE id=$1`, [customerId]);
  }

  async function fundWallet(ledgerAccountId: string, amountMinor: string): Promise<void> {
    const sys = await ledgerService.createAccount({
      code: `SYS01-FLOAT-NGN-${randomUUID().slice(0, 6)}`,
      name: 'SYS01 float',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledgerService.postJournal({
      idempotencyKey: `sys01-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: sys.id, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
  }

  async function getBalance(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0]!.balance);
  }

  it('1. W2W: transfer TO a SUSPENDED destination customer is rejected (no silent credit)', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await suspendCustomer(recipient.customerId);

    const beforeSender = await getBalance(sender.ledgerAccountId);
    const beforeRecipient = await getBalance(recipient.ledgerAccountId);

    await expect(
      transferService.createTransfer({
        // INTEGRATION: main's `CreateTransferCommand.ownership` is now required. This spec drives
        // TransferService directly (no HTTP principal) to test the suspended-customer boundary, so it
        // passes an INTERNAL binding — which `assertWalletOwnership` deliberately does not restrict —
        // keeping every assertion in this file exactly as before the integration.
        ownership: { kind: 'INTERNAL', principalId: 'v1-system-01-spec', principalType: 'SERVICE' },
        sourceWalletId: sender.walletId,
        destinationWalletId: recipient.walletId,
        amountMinor: '25000',
        currency: 'NGN',
        idempotencyKey: `sys01-w2w-suspended-dest-${randomUUID()}`,
      }),
    ).rejects.toThrow(/active/i);

    expect(await getBalance(sender.ledgerAccountId)).toBe(beforeSender);
    expect(await getBalance(recipient.ledgerAccountId)).toBe(beforeRecipient);
  });

  it('2. W2W: transfer FROM a SUSPENDED source customer is rejected', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await suspendCustomer(sender.customerId);

    await expect(
      transferService.createTransfer({
        // INTEGRATION: see the ownership note above — INTERNAL binding, behaviour unchanged.
        ownership: { kind: 'INTERNAL', principalId: 'v1-system-01-spec', principalType: 'SERVICE' },
        sourceWalletId: sender.walletId,
        destinationWalletId: recipient.walletId,
        amountMinor: '25000',
        currency: 'NGN',
        idempotencyKey: `sys01-w2w-suspended-src-${randomUUID()}`,
      }),
    ).rejects.toThrow(/active/i);
  });

  it('3. W2W: transfer between two ACTIVE customers still succeeds (no false-positive block)', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');

    const view = await transferService.createTransfer({
      // INTEGRATION: see the ownership note above — INTERNAL binding, behaviour unchanged.
      ownership: { kind: 'INTERNAL', principalId: 'v1-system-01-spec', principalType: 'SERVICE' },
      sourceWalletId: sender.walletId,
      destinationWalletId: recipient.walletId,
      amountMinor: '25000',
      currency: 'NGN',
      idempotencyKey: `sys01-w2w-active-${randomUUID()}`,
    });
    expect(view.status).toBe('COMPLETED');
    expect(await getBalance(recipient.ledgerAccountId)).toBe(25000n);
  });

  it('4. CUSTOMER_FUNDING: approval for a customer SUSPENDED after request creation is rejected (no silent credit)', async () => {
    const customer = await createActiveCustomerWithWallet();
    const created = await fundingService.createRequest({
      customerId: customer.customerId,
      amountMinor: '60000',
      currency: 'NGN',
      idempotencyKey: `sys01-funding-create-${randomUUID()}`,
      principal: supportMaker,
    });
    expect(created.status).toBe('PENDING');

    // Customer suspended AFTER the funding request was created but BEFORE it is approved.
    await suspendCustomer(customer.customerId);

    const beforeBalance = await getBalance(customer.ledgerAccountId);
    await expect(
      fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker }),
    ).rejects.toThrow(/not active/i);
    expect(await getBalance(customer.ledgerAccountId)).toBe(beforeBalance);

    const rows: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM customer_funding_requests WHERE id=$1`,
      [created.id],
    );
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('5. CUSTOMER_FUNDING: approval for a still-ACTIVE customer still succeeds (no false-positive block)', async () => {
    const customer = await createActiveCustomerWithWallet();
    const created = await fundingService.createRequest({
      customerId: customer.customerId,
      amountMinor: '45000',
      currency: 'NGN',
      idempotencyKey: `sys01-funding-create-active-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({
      fundingRequestId: created.id,
      principal: operatorChecker,
    });
    expect(approved.status).toBe('APPROVED');
    expect(await getBalance(customer.ledgerAccountId)).toBe(45000n);
  });
});
