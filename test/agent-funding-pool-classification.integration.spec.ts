/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
/**
 * Stage 6 — `AGENT_FUNDING_POOL-NGN` economic classification (real PostgreSQL).
 *
 * The published pool is a **platform-level counterparty liability** in the `CUSTOMER_FUNDS`
 * accounting unit. It is not a bank, settlement, treasury, CBN/NIBSS or institution account, and
 * no licensed institution owns it (`docs/integration/AGENT-FUNDING-POOL-CLASSIFICATION.md`).
 *
 * These cases pin the fail-closed boundary that keeps that classification honest:
 *
 *  1. the published pool row is unattributed/platform, NGN, `CUSTOMER_FUNDS`, active, and is the
 *     only counterparty of the platform agent rail (baseline behaviour unchanged);
 *  2. an institution-attributed agent wallet is never funded from platform float — the refusal is
 *     explicit, nothing is posted and no idempotency authority is consumed;
 *  3. a pool row attributed to an institution is refused (the global pool must never be assigned
 *     to an institution to make a rail work);
 *  4. a pool row in another currency, another accounting unit, or inactive is refused.
 *
 * Every fixture is synthetic. No provider call, no real financial transaction, no deployment.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentFundingService } from '../src/agent/agent-funding.service';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { AgentFundingGovernanceTestFacade } from './support/agent-funding-governance';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { WalletService } from '../src/wallet/wallet.service';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

const POOL_CODE = 'AGENT_FUNDING_POOL-NGN';

describe('AGENT_FUNDING_POOL-NGN economic classification (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fundingService: AgentFundingService;
  let classService: AgentClassService;
  let applicationService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let walletService: WalletService;
  let governed: GovernedFinancialFixture;

  const privilegedPrincipal: any = {
    type: 'OPERATOR',
    principalId: 'stage6-agent-network-manager',
    roles: ['AGENT_NETWORK_MANAGER'],
    scopes: ['agent.fund', 'agent.defund'],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
    assuranceLevel: 'MFA',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('s6pool');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    fundingService = new AgentFundingGovernanceTestFacade(
      moduleRef.get(AgentFundingService),
      moduleRef.get(PrivilegedActionApprovalService),
    ) as unknown as AgentFundingService;
    classService = moduleRef.get(AgentClassService);
    applicationService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    walletService = moduleRef.get(WalletService);
    governed = new GovernedFinancialFixture({ app, dataSource, label: 's6pool' });
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
      }
    }
  }, 60_000);

  async function createActiveAgent(): Promise<{
    agentId: string;
    walletId: string;
    walletLedgerId: string;
  }> {
    const cls = await classService.create({
      reference: `cls-s6-${randomUUID().slice(0, 8)}`,
      code: `S6-${randomUUID().slice(0, 6)}`,
      name: 'Stage 6 Class',
      isActive: true,
      applicableServices: ['AGENT_FUNDING', 'AGENT_DEFUNDING'] as any,
      applicableLimits: {} as any,
      actor: 's6-actor',
    });
    const application = await applicationService.create({
      agentClassId: cls.id,
      applicantReference: `s6-${randomUUID()}`,
      businessName: `Biz S6 ${randomUUID().slice(0, 4)}`,
      contactEmail: `s6-${randomUUID().slice(0, 6)}@test.com`,
      actor: 's6-applicant',
    });
    await applicationService.submit(application.id, 's6-applicant');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [application.id],
    );
    const agent = await lifecycleService.activateFromApplication(application.id, 's6-actor');
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `s6-wallet-${agent.id}-${randomUUID()}`,
    });
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [wallet.id],
    );
    return { agentId: agent.id, walletId: wallet.id, walletLedgerId: rows[0]!.ledger_account_id };
  }

  async function journalCount(): Promise<number> {
    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM ledger_journals`,
    );
    return Number(rows[0]!.count);
  }

  async function poolRow(): Promise<{
    id: string;
    currency: string;
    accounting_unit: string;
    institutional_scope: string;
    institution_id: string | null;
    allow_negative_balance: boolean;
    is_active: boolean;
  }> {
    const rows: Array<{
      id: string;
      currency: string;
      accounting_unit: string;
      institutional_scope: string;
      institution_id: string | null;
      allow_negative_balance: boolean;
      is_active: boolean;
    }> = await dataSource.query(
      `SELECT id, currency, accounting_unit, institutional_scope, institution_id,
              allow_negative_balance, is_active
         FROM ledger_accounts WHERE code=$1`,
      [POOL_CODE],
    );
    return rows[0]!;
  }

  it('keeps the published platform classification and the platform agent rail working', async () => {
    const pool = await poolRow();
    expect(pool).toMatchObject({
      currency: 'NGN',
      accounting_unit: 'CUSTOMER_FUNDS',
      institutional_scope: 'UNATTRIBUTED',
      institution_id: null,
      allow_negative_balance: true,
      is_active: true,
    });

    const { agentId, walletLedgerId } = await createActiveAgent();
    const result = await fundingService.fund({
      agentId,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `s6-baseline-${randomUUID()}`,
      principal: privilegedPrincipal,
      actor: 's6-actor',
    });
    expect(result.status).toBe('COMPLETED');
    const lines: Array<{ ledger_account_id: string; direction: string }> = await dataSource.query(
      `SELECT ledger_account_id, direction FROM ledger_lines WHERE journal_id=$1`,
      [result.journalId],
    );
    expect(lines.find((line) => line.direction === 'DEBIT')!.ledger_account_id).toBe(pool.id);
    expect(lines.find((line) => line.direction === 'CREDIT')!.ledger_account_id).toBe(
      walletLedgerId,
    );
  }, 180_000);

  it('refuses to fund an institution-attributed agent wallet from platform float', async () => {
    const institutionId = await governed.institution();
    const { agentId, walletId, walletLedgerId } = await createActiveAgent();
    await governed.affiliateAgent(agentId, institutionId);
    await governed.attributeWallet(walletId, institutionId);
    const attribution: Array<{ institution_id: string | null }> = await dataSource.query(
      `SELECT institution_id FROM wallet_accounts WHERE id=$1`,
      [walletId],
    );
    expect(attribution[0]!.institution_id).toBe(institutionId);

    const before = await journalCount();
    const idempotencyKey = `s6-attributed-${randomUUID()}`;
    await expect(
      fundingService.fund({
        agentId,
        amountMinor: '4000',
        currency: 'NGN',
        idempotencyKey,
        principal: privilegedPrincipal,
        actor: 's6-actor',
      }),
    ).rejects.toThrow(/institution funds authority/i);

    // Fail closed: no journal, no ledger line, no consumed idempotency authority.
    expect(await journalCount()).toBe(before);
    const wallets = await dataSource.query<Array<{ balance: string }>>(
      `SELECT COALESCE(SUM(CASE WHEN l.direction=a.normal_balance THEN l.amount_minor
                                ELSE -l.amount_minor END),0)::text AS balance
         FROM ledger_accounts a LEFT JOIN ledger_lines l ON l.ledger_account_id=a.id
        WHERE a.id=$1`,
      [walletLedgerId],
    );
    expect(wallets[0]!.balance).toBe('0');
    const consumed: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM idempotency_records WHERE idempotency_key=$1`,
      [idempotencyKey],
    );
    expect(consumed[0]!.count).toBe('0');
  }, 240_000);

  it('the database itself refuses to attribute the platform pool to an institution', async () => {
    // The service guard for an `INSTITUTION`-scoped pool is unreachable through the database on
    // purpose: the institutional ownership contract refuses ledger-account attribution unless a
    // governed `WALLET_INSTITUTION_ATTRIBUTION` execution recorded it. That is a stronger
    // guarantee than a service check, so the assertion is that the mutation is rejected and the
    // published classification is preserved byte-for-byte.
    const institutionId = await governed.institution();
    const pool = await poolRow();
    await expect(
      dataSource.query(
        `UPDATE ledger_accounts SET institutional_scope='INSTITUTION', institution_id=$2 WHERE id=$1`,
        [pool.id, institutionId],
      ),
    ).rejects.toThrow(/governed wallet attribution record/i);
    expect(await poolRow()).toMatchObject({
      institutional_scope: 'UNATTRIBUTED',
      institution_id: null,
      accounting_unit: 'CUSTOMER_FUNDS',
      currency: 'NGN',
    });

    // The platform rail still works after the refused mutation.
    const { agentId } = await createActiveAgent();
    const funded = await fundingService.fund({
      agentId,
      amountMinor: '1200',
      currency: 'NGN',
      idempotencyKey: `s6-post-refusal-${randomUUID()}`,
      principal: privilegedPrincipal,
      actor: 's6-actor',
    });
    expect(funded.status).toBe('COMPLETED');
  }, 180_000);

  it('refuses a pool row in another accounting unit, currency or inactive', async () => {
    const pool = await poolRow();
    const { agentId } = await createActiveAgent();
    const restore = () =>
      dataSource.query(
        `UPDATE ledger_accounts SET currency='NGN', accounting_unit='CUSTOMER_FUNDS', is_active=true WHERE id=$1`,
        [pool.id],
      );
    try {
      await dataSource.query(
        `UPDATE ledger_accounts SET accounting_unit='BANK_FLOAT' WHERE id=$1`,
        [pool.id],
      );
      await expect(
        fundingService.fund({
          agentId,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `s6-unit-${randomUUID()}`,
          principal: privilegedPrincipal,
          actor: 's6-actor',
        }),
      ).rejects.toThrow(/CUSTOMER_FUNDS accounting unit/i);
      await restore();

      await dataSource.query(`UPDATE ledger_accounts SET currency='USD' WHERE id=$1`, [pool.id]);
      await expect(
        fundingService.fund({
          agentId,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `s6-currency-${randomUUID()}`,
          principal: privilegedPrincipal,
          actor: 's6-actor',
        }),
      ).rejects.toThrow(/does not hold the requested funding currency/i);
      await restore();

      await dataSource.query(`UPDATE ledger_accounts SET is_active=false WHERE id=$1`, [pool.id]);
      await expect(
        fundingService.fund({
          agentId,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `s6-inactive-${randomUUID()}`,
          principal: privilegedPrincipal,
          actor: 's6-actor',
        }),
      ).rejects.toThrow(/not active/i);
    } finally {
      await restore();
    }
  }, 240_000);
});
