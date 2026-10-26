/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * P0/P1 security-remediation regression coverage (real PostgreSQL only).
 *
 * All schema creation goes through the run-scoped test harness. This suite does not connect to
 * or mutate a development database. The workforce mock resolves the actual seeded 11-role
 * catalogue grants, and approval HTTP endpoints use the required enabled privileged-approval
 * rate-limit rule from V1-REWARD-01.
 */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  AUTHORIZATION_ROLE_FUNCTION_SEED,
  AUTHORIZATION_ROLE_SEED,
} from '../src/authorization-catalogue/authorization-catalogue.seed';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { OutletService } from '../src/outlet/outlet.service';
import { TerminalService } from '../src/outlet/terminal.service';
import { AggregatorService } from '../src/aggregator/aggregator.service';
import { LimitCatalogService } from '../src/limit-catalog/limit-catalog.service';
import { LimitProfileKind } from '../src/limit-catalog/limit-catalog.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

const CATALOGUE_ROLES = AUTHORIZATION_ROLE_SEED.map((role) => role.roleKey);
const ROLE_BY_KEY = new Map(AUTHORIZATION_ROLE_SEED.map((role) => [role.roleKey, role]));
const FUNCTION_CODES_BY_ROLE = new Map<string, string[]>();
for (const assignment of AUTHORIZATION_ROLE_FUNCTION_SEED) {
  const codes = FUNCTION_CODES_BY_ROLE.get(assignment.roleKey) ?? [];
  codes.push(assignment.functionCode);
  FUNCTION_CODES_BY_ROLE.set(assignment.roleKey, codes);
}

const P1_EXPECTED_ROLE_GRANTS: Record<string, string[]> = {
  'aggregator.manage': ['OPERATIONS', 'SUPER_ADMIN'],
  'agent.manage_outlets_terminals': ['AGENT_NETWORK_MANAGER', 'SUPER_ADMIN'],
  'agent.assign_limit': ['AGENT_NETWORK_MANAGER', 'SUPER_ADMIN'],
};

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
  // Required for POST /internal/a2/workforce/approvals/:id/{approve,reject}.
  // Do not replace this with an empty array: the production controller fails closed without it.
  rateLimits: [
    {
      category: 'privileged-approval',
      capacity: 1000,
      refillRatePerSecond: 1000,
      enabled: true,
    },
  ],
  trustedProxies: ['127.0.0.1'],
} as unknown as A2WorkforceConfigurationV1;

function workforceToken(...roleKeys: string[]): string {
  const roles = [...roleKeys].map((role) => role.toUpperCase()).sort();
  if (roles.length === 1 && roles[0] === 'SUPPORT') return supportToken();
  const type = roles.includes('SUPER_ADMIN') || roles.includes('ADMINISTRATOR')
    ? 'PRIVILEGED'
    : 'OPERATOR';
  return `workforce-${type}|${roles.join('+')}`;
}

function supportToken(): string {
  return 'workforce-SUPPORT|SUPPORT';
}

function bearer(...roleKeys: string[]): string {
  return `Bearer ${workforceToken(...roleKeys)}`;
}

const mockWorkforceSessions = {
  validate: async (token: string, audience: string) => {
    const match = /^workforce-([A-Z]+)\|([A-Z_+]+)$/i.exec(token ?? '');
    if (!match) throw new UnauthorizedException('invalid workforce token');
    const type = match[1].toUpperCase();
    const allowedTypes = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'];
    if (!allowedTypes.includes(type)) throw new UnauthorizedException('invalid workforce type');

    const roles = match[2]
      .split('+')
      .map((role) => role.toUpperCase())
      .filter((role) => ROLE_BY_KEY.has(role))
      .sort();
    const scopes = [...new Set(roles.flatMap((role) => FUNCTION_CODES_BY_ROLE.get(role) ?? []))];
    const recognised = roles.map((role) => ROLE_BY_KEY.get(role));
    const readOnlyPrincipal = recognised.length > 0 && recognised.every((role) => role.readOnly === true);
    const identity = roles.length ? roles.join('+') : type;

    return {
      type,
      principalId: `p0p1-test:${identity}`,
      sessionId: randomUUID(),
      audience,
      roles,
      scopes,
      assuranceLevel: 'MFA',
      customerAccess: 'NONE',
      agentAccess: 'NONE',
      aggregatorAccess: 'NONE',
      readOnlyPrincipal,
    } as any;
  },
};

function freshCode(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

describe('P0/P1 security remediation (isolated real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let classService: AgentClassService;
  let applicationService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let outletService: OutletService;
  let terminalService: TerminalService;
  let aggregatorService: AggregatorService;
  let limitCatalogService: LimitCatalogService;

  beforeAll(async () => {
    expect(CATALOGUE_ROLES).toHaveLength(11);
    dataSource = await createIntegrationDataSource('p0p1remediation');
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();

    classService = moduleRef.get(AgentClassService);
    applicationService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    outletService = moduleRef.get(OutletService);
    terminalService = moduleRef.get(TerminalService);
    aggregatorService = moduleRef.get(AggregatorService);
    limitCatalogService = moduleRef.get(LimitCatalogService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  async function financialSnapshot(): Promise<Record<string, unknown>> {
    const transfers = await dataSource.query(
      `SELECT id, source_wallet_id, destination_wallet_id, journal_id, amount_minor::text AS amount_minor,
              currency, status, idempotency_key, request_hash
         FROM transfers ORDER BY id`,
    );
    const deposits = await dataSource.query(
      `SELECT id, wallet_id, journal_id, payment_reference, amount_minor::text AS amount_minor,
              currency, status, idempotency_key, request_hash, failure_code, failure_message
         FROM deposits ORDER BY id`,
    );
    const withdrawals = await dataSource.query(
      `SELECT id, wallet_id, journal_id, payment_reference, amount_minor::text AS amount_minor,
              currency, status, idempotency_key, request_hash, failure_code, failure_message
         FROM withdrawals ORDER BY id`,
    );
    const paymentReferences = await dataSource.query(
      `SELECT reference, payment_type, payment_id FROM payment_references ORDER BY reference`,
    );
    const walletAccounts = await dataSource.query(
      `SELECT id, customer_id, currency, status, ledger_account_id, creation_idempotency_key
         FROM wallet_accounts ORDER BY id`,
    );
    const ledgerAccounts = await dataSource.query(
      `SELECT id, code, account_type, normal_balance, currency, accounting_unit,
              allow_negative_balance, is_active
         FROM ledger_accounts ORDER BY id`,
    );
    const journals = await dataSource.query(
      `SELECT id, idempotency_key, request_hash, currency, accounting_unit, status, total_minor::text AS total_minor
         FROM ledger_journals ORDER BY id`,
    );
    const lines = await dataSource.query(
      `SELECT id, journal_id, line_number, ledger_account_id, direction, amount_minor::text AS amount_minor,
              currency, accounting_unit
         FROM ledger_lines ORDER BY journal_id, line_number`,
    );
    const balances = await dataSource.query(
      `SELECT a.id AS ledger_account_id,
              COALESCE(SUM(CASE WHEN l.direction = a.normal_balance
                                THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS balance_minor
         FROM ledger_accounts a
         LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
        GROUP BY a.id
        ORDER BY a.id`,
    );
    return {
      transfers,
      deposits,
      withdrawals,
      paymentReferences,
      walletAccounts,
      ledgerAccounts,
      journals,
      lines,
      balances,
    };
  }

  async function createActiveAgent(): Promise<string> {
    const agentClass = await classService.create({
      reference: `p0p1-class-${randomUUID().slice(0, 10)}`,
      code: freshCode('P0P1CLASS'),
      name: 'P0/P1 remediation agent class',
      isActive: true,
      applicableServices: ['AGENT_FUNDING', 'AGENT_DEFUNDING'],
      applicableLimits: {},
      actor: 'p0p1-fixture',
    });
    const application = await applicationService.create({
      agentClassId: agentClass.id,
      applicantReference: `p0p1-app-${randomUUID()}`,
      businessName: `P0/P1 Agent ${randomUUID().slice(0, 6)}`,
      contactEmail: `p0p1-${randomUUID().slice(0, 8)}@example.test`,
      actor: 'p0p1-fixture',
    });
    await applicationService.submit(application.id, 'p0p1-fixture');
    await dataSource.query(
      `UPDATE agent_applications
          SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW()
        WHERE id=$1`,
      [application.id],
    );
    const agent = await lifecycleService.activateFromApplication(application.id, 'p0p1-fixture');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    return agent.id;
  }

  async function createCustomerWalletPair(): Promise<{
    sourceWalletId: string;
    destinationWalletId: string;
    sourceLedgerAccountId: string;
  }> {
    const customerIds: string[] = [];
    for (const suffix of ['source', 'destination']) {
      const rows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
        [`p0a-${suffix}-${randomUUID()}`],
      );
      customerIds.push(rows[0].id);
    }
    const source = await walletService.createWallet({
      customerId: customerIds[0],
      currency: 'NGN',
      idempotencyKey: `p0a-source-${randomUUID()}`,
    });
    const destination = await walletService.createWallet({
      customerId: customerIds[1],
      currency: 'NGN',
      idempotencyKey: `p0a-destination-${randomUUID()}`,
    });
    const settlementRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    expect(settlementRows).toHaveLength(1);
    await ledgerService.postJournal({
      idempotencyKey: `p0a-wallet-seed-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `p0a-seed-${randomUUID()}`,
      lines: [
        { accountId: settlementRows[0].id, direction: 'DEBIT' as any, amountMinor: '50000' },
        { accountId: source.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' },
      ],
    });
    return {
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      sourceLedgerAccountId: source.ledgerAccountId,
    };
  }

  async function seedPendingDepositAndWithdrawal(walletId: string): Promise<{
    depositId: string;
    withdrawalId: string;
  }> {
    const depositId = randomUUID();
    const withdrawalId = randomUUID();
    const paymentReferenceRows: Array<{ deposit_sequence: string; withdrawal_sequence: string }> =
      await dataSource.query(
        `SELECT nextval('payment_reference_sequence')::text AS deposit_sequence,
                nextval('payment_reference_sequence')::text AS withdrawal_sequence`,
      );
    const depositReference = `MN${paymentReferenceRows[0].deposit_sequence.padStart(12, '0')}`;
    const withdrawalReference = `MN${paymentReferenceRows[0].withdrawal_sequence.padStart(12, '0')}`;
    const hash = 'a'.repeat(64);
    await dataSource.query(
      `INSERT INTO deposits
         (id, wallet_id, payment_reference, amount_minor, currency, status, idempotency_key,
          request_hash, reference, narration)
       VALUES ($1, $2, $3, 1250, 'NGN', 'PENDING', $4, $5, 'pending fixture', 'P0-A fixture')`,
      [depositId, walletId, depositReference, `p0a-deposit-${depositId}`, hash],
    );
    await dataSource.query(
      `INSERT INTO withdrawals
         (id, wallet_id, payment_reference, amount_minor, currency, status, idempotency_key,
          request_hash, reference, narration)
       VALUES ($1, $2, $3, 1250, 'NGN', 'PENDING', $4, $5, 'pending fixture', 'P0-A fixture')`,
      [withdrawalId, walletId, withdrawalReference, `p0a-withdrawal-${withdrawalId}`, hash],
    );
    await dataSource.query(
      `INSERT INTO payment_references (reference, payment_type, payment_id)
       VALUES ($1, 'DEPOSIT', $2), ($3, 'WITHDRAWAL', $4)`,
      [depositReference, depositId, withdrawalReference, withdrawalId],
    );
    return { depositId, withdrawalId };
  }

  async function count(table: string): Promise<number> {
    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS count FROM ${table}`,
    );
    return Number(rows[0].count);
  }

  function requestFunding(
    agentId: string,
    direction: 'FUND' | 'DEFUND',
    roleKeys: string[],
    amountMinor: string,
    idempotencyKey = `p0c-${direction.toLowerCase()}-${randomUUID()}`,
  ) {
    const route = direction === 'FUND' ? 'fund-request' : 'defund-request';
    return request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/${route}`)
      .set('Authorization', bearer(...roleKeys))
      .send({
        idempotencyKey,
        amountMinor,
        currency: 'NGN',
        reference: `P0C ${direction} ${idempotencyKey}`,
        description: `P0/P1 integration ${direction.toLowerCase()}`,
        metadata: { suite: 'p0-p1-security-remediation' },
        reason: `P0/P1 ${direction.toLowerCase()} request fixture`,
      });
  }

  function decideApproval(
    approvalId: string,
    action: 'approve' | 'reject',
    roleKeys: string[],
    body: Record<string, unknown> = { comment: 'P0/P1 real PostgreSQL approval test' },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${approvalId}/${action}`)
      .set('Authorization', bearer(...roleKeys))
      .send(body);
  }

  function executeFunding(requestId: string, roleKeys: string[] = ['FINANCE_CONTROLLER']) {
    return request(app.getHttpServer())
      .post(`/api/v1/internal/agents/funding-requests/${requestId}/execute`)
      .set('Authorization', bearer(...roleKeys))
      .send({});
  }

  async function approvalRow(approvalId: string): Promise<any> {
    const rows = await dataSource.query(
      `SELECT id, action_type, status, requester_principal_id, approved_by, consumed_at
         FROM privileged_action_approvals WHERE id=$1`,
      [approvalId],
    );
    return rows[0];
  }

  async function fundingRequestRow(requestId: string): Promise<any> {
    const rows = await dataSource.query(
      `SELECT id, direction, amount_minor::text AS amount_minor, request_hash, approval_fingerprint,
              approval_id, status, maker_principal_id, maker_role, checker_principal_id,
              checker_role, journal_id, rejection_reason
         FROM agent_funding_requests WHERE id=$1`,
      [requestId],
    );
    return rows[0];
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance_minor: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance
                                THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS balance_minor
         FROM ledger_accounts a
         LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
        WHERE a.id=$1
        GROUP BY a.id`,
      [ledgerAccountId],
    );
    return BigInt(rows[0].balance_minor);
  }

  // ── P0-A: generic financial commands are blocked without changing financial state ──

  it('P0-A: generic transfer/deposit/withdrawal creates and lifecycle mutations fail closed without changing transactions, journals, or balances', async () => {
    const { sourceWalletId, destinationWalletId } = await createCustomerWalletPair();
    const { depositId, withdrawalId } = await seedPendingDepositAndWithdrawal(sourceWalletId);
    const before = await financialSnapshot();
    const idempotencyKey = () => `p0a-disabled-${randomUUID()}`;

    const blockedRequests: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: '/api/v1/transfers',
        body: { sourceWalletId, destinationWalletId, amountMinor: '1250', currency: 'NGN' },
      },
      {
        path: '/api/v1/deposits',
        body: { walletId: sourceWalletId, amountMinor: '1250', currency: 'NGN', reference: 'valid DTO' },
      },
      {
        path: '/api/v1/withdrawals',
        body: { walletId: sourceWalletId, amountMinor: '1250', currency: 'NGN', reference: 'valid DTO' },
      },
      { path: `/api/v1/deposits/${depositId}/complete`, body: {} },
      { path: `/api/v1/deposits/${depositId}/fail`, body: { reason: 'valid failure reason' } },
      { path: `/api/v1/deposits/${depositId}/cancel`, body: { reason: 'valid cancellation reason' } },
      { path: `/api/v1/withdrawals/${withdrawalId}/process`, body: {} },
      { path: `/api/v1/withdrawals/${withdrawalId}/complete`, body: {} },
      { path: `/api/v1/withdrawals/${withdrawalId}/fail`, body: { reason: 'valid failure reason' } },
      { path: `/api/v1/withdrawals/${withdrawalId}/cancel`, body: { reason: 'valid cancellation reason' } },
    ];

    for (const blocked of blockedRequests) {
      await request(app.getHttpServer())
        .post(blocked.path)
        .set('Authorization', bearer('SUPER_ADMIN'))
        .set('Idempotency-Key', idempotencyKey())
        .send(blocked.body)
        .expect(403);
    }

    expect(await financialSnapshot()).toEqual(before);
    const unchangedDeposit: any[] = await dataSource.query(
      `SELECT status, journal_id FROM deposits WHERE id=$1`,
      [depositId],
    );
    const unchangedWithdrawal: any[] = await dataSource.query(
      `SELECT status, journal_id FROM withdrawals WHERE id=$1`,
      [withdrawalId],
    );
    expect(unchangedDeposit[0]).toEqual({ status: 'PENDING', journal_id: null });
    expect(unchangedWithdrawal[0]).toEqual({ status: 'PENDING', journal_id: null });
  }, 60_000);

  // ── P0-B: generic ledger writes remain fail-closed even with valid DTOs ──

  it('P0-B: valid generic ledger account creation and balanced journal posting make no account, journal, line, or balance changes', async () => {
    const before = await financialSnapshot();
    const accountRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts
        WHERE code IN ('FINANCE-COMMISSION_EXPENSE-NGN', 'FINANCE-FEE_REVENUE-NGN')
        ORDER BY code`,
    );
    expect(accountRows).toHaveLength(2);

    await request(app.getHttpServer())
      .post('/api/v1/ledger/accounts')
      .set('Authorization', bearer('FINANCE_PREPARER'))
      .send({
        code: freshCode('P0B_ACCOUNT'),
        name: 'Valid governed-account DTO that must remain blocked',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: true,
      })
      .expect(403);

    const journalIdempotencyKey = `p0b-journal-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/v1/ledger/journals')
      .set('Authorization', bearer('FINANCE_PREPARER'))
      .set('Idempotency-Key', journalIdempotencyKey)
      .send({
        idempotencyKey: journalIdempotencyKey,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `P0B ${randomUUID()}`,
        description: 'Valid balanced journal DTO; generic route must fail closed',
        lines: [
          { accountId: accountRows[0].id, direction: 'DEBIT', amountMinor: '1250' },
          { accountId: accountRows[1].id, direction: 'CREDIT', amountMinor: '1250' },
        ],
      })
      .expect(403);

    expect(await financialSnapshot()).toEqual(before);
  }, 60_000);

  // ── P0-C: real maker-checker workflow, requests, decisions, and execution ──

  it('P0-C Decision 7: ANM maker, independent Finance Controller checker, SUPER_ADMIN excluded, exactly-once fund and defund posting', async () => {
    const agentId = await createActiveAgent();
    const beforeAnyRequest = await financialSnapshot();

    await requestFunding(agentId, 'FUND', ['SUPPORT'], '7000').expect(403);
    await requestFunding(agentId, 'FUND', ['FINANCE_CONTROLLER'], '7000').expect(403);
    await requestFunding(agentId, 'FUND', ['OPERATIONS'], '7000').expect(403);
    expect(await count('agent_funding_requests')).toBe(0);
    expect(await count('privileged_action_approvals')).toBe(0);
    expect(await financialSnapshot()).toEqual(beforeAnyRequest);

    const pendingResponse = await requestFunding(
      agentId,
      'FUND',
      ['AGENT_NETWORK_MANAGER'],
      '7000',
    ).expect(201);
    const pending = pendingResponse.body;
    expect(pending.status).toBe('PENDING');
    expect(pending.direction).toBe('FUND');
    expect(pending.makerRole).toBe('AGENT_NETWORK_MANAGER');
    expect(pending.makerPrincipalId).toBe('p0p1-test:AGENT_NETWORK_MANAGER');
    expect(pending.approvalId).toBeTruthy();
    expect((await approvalRow(pending.approvalId)).status).toBe('REQUESTED');
    expect(await financialSnapshot()).toEqual(beforeAnyRequest);

    // A role without the Finance Controller checker entitlement is rejected at the actual HTTP endpoint.
    await decideApproval(pending.approvalId, 'approve', ['OPERATIONS']).expect(403);
    expect((await approvalRow(pending.approvalId)).status).toBe('REQUESTED');

    // Even a principal that also carries FINANCE_CONTROLLER cannot exercise checker authority
    // when it carries SUPER_ADMIN; Decision 7 expressly excludes SUPER_ADMIN.
    const superAdminDecision = await decideApproval(
      pending.approvalId,
      'approve',
      ['SUPER_ADMIN', 'FINANCE_CONTROLLER'],
    ).expect(201);
    expect(superAdminDecision.body.reason).toBe('SUPER_ADMIN_NOT_ALLOWED');
    expect((await approvalRow(pending.approvalId)).status).toBe('REQUESTED');

    // Exercise the service-level self-approval check with a dual-role maker identity that has
    // both catalogue functions but is still the exact principal that initiated the request.
    const dualRolePending = await requestFunding(
      agentId,
      'FUND',
      ['AGENT_NETWORK_MANAGER', 'FINANCE_CONTROLLER'],
      '7100',
    ).expect(201);
    const selfApproval = await decideApproval(
      dualRolePending.body.approvalId,
      'approve',
      ['AGENT_NETWORK_MANAGER', 'FINANCE_CONTROLLER'],
    ).expect(201);
    expect(selfApproval.body.reason).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await approvalRow(dualRolePending.body.approvalId)).status).toBe('REQUESTED');
    expect(await financialSnapshot()).toEqual(beforeAnyRequest);

    const approvedResponse = await decideApproval(
      pending.approvalId,
      'approve',
      ['FINANCE_CONTROLLER'],
    ).expect(201);
    expect(approvedResponse.body.reason).toBe('APPROVED');
    expect(approvedResponse.body.approval.status).toBe('APPROVED');
    expect(await financialSnapshot()).toEqual(beforeAnyRequest);

    // SUPER_ADMIN is not permitted to execute either, even when combined with checker role.
    await executeFunding(pending.id, ['SUPER_ADMIN', 'FINANCE_CONTROLLER']).expect(403);
    await executeFunding(pending.id, ['OPERATIONS']).expect(403);
    expect((await fundingRequestRow(pending.id)).status).toBe('PENDING');
    expect((await approvalRow(pending.approvalId)).status).toBe('APPROVED');
    expect(await financialSnapshot()).toEqual(beforeAnyRequest);

    const fundResult = await executeFunding(pending.id).expect(201);
    expect(fundResult.body.status).toBe('COMPLETED');
    expect(fundResult.body.journalId).toBeTruthy();
    const executedFund = await fundingRequestRow(pending.id);
    expect(executedFund.status).toBe('EXECUTED');
    expect(executedFund.maker_role).toBe('AGENT_NETWORK_MANAGER');
    expect(executedFund.checker_role).toBe('FINANCE_CONTROLLER');
    expect(executedFund.checker_principal_id).toBe('p0p1-test:FINANCE_CONTROLLER');
    expect(executedFund.maker_principal_id).not.toBe(executedFund.checker_principal_id);
    expect(executedFund.journal_id).toBe(fundResult.body.journalId);
    const consumedFundApproval = await approvalRow(pending.approvalId);
    expect(consumedFundApproval.status).toBe('CONSUMED');
    expect(consumedFundApproval.consumed_at).not.toBeNull();
    const fundedWalletRows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 AND currency='NGN'`,
      [agentId],
    );
    expect(fundedWalletRows).toHaveLength(1);
    expect(await balanceOf(fundedWalletRows[0].ledger_account_id)).toBe(7000n);
    const fundLines: any[] = await dataSource.query(
      `SELECT direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1 ORDER BY line_number`,
      [fundResult.body.journalId],
    );
    expect(fundLines).toEqual([
      { direction: 'DEBIT', amount_minor: '7000' },
      { direction: 'CREDIT', amount_minor: '7000' },
    ]);
    const afterFund = await financialSnapshot();
    expect(afterFund.ledgerAccounts).toHaveLength((beforeAnyRequest.ledgerAccounts as any[]).length + 1);
    expect(afterFund.journals).toHaveLength((beforeAnyRequest.journals as any[]).length + 1);
    expect(afterFund.lines).toHaveLength((beforeAnyRequest.lines as any[]).length + 2);

    // A same-checker replay may return the prior result, but must not post a second journal.
    const replayedFund = await executeFunding(pending.id).expect(201);
    expect(replayedFund.body.status).toBe('REPLAYED');
    expect(replayedFund.body.replayed).toBe(true);
    expect(replayedFund.body.journalId).toBe(fundResult.body.journalId);
    expect(await financialSnapshot()).toEqual(afterFund);

    const beforeDefund = await financialSnapshot();
    const pendingDefundResponse = await requestFunding(
      agentId,
      'DEFUND',
      ['AGENT_NETWORK_MANAGER'],
      '2500',
    ).expect(201);
    const pendingDefund = pendingDefundResponse.body;
    expect(pendingDefund.status).toBe('PENDING');
    expect(pendingDefund.direction).toBe('DEFUND');
    expect(await financialSnapshot()).toEqual(beforeDefund);
    await decideApproval(pendingDefund.approvalId, 'approve', ['FINANCE_CONTROLLER']).expect(201);
    expect(await financialSnapshot()).toEqual(beforeDefund);
    const defundResult = await executeFunding(pendingDefund.id).expect(201);
    expect(defundResult.body.status).toBe('COMPLETED');
    const executedDefund = await fundingRequestRow(pendingDefund.id);
    expect(executedDefund.status).toBe('EXECUTED');
    expect(executedDefund.maker_role).toBe('AGENT_NETWORK_MANAGER');
    expect(executedDefund.checker_role).toBe('FINANCE_CONTROLLER');
    expect((await approvalRow(pendingDefund.approvalId)).status).toBe('CONSUMED');
    expect(await balanceOf(fundedWalletRows[0].ledger_account_id)).toBe(4500n);
    const afterDefund = await financialSnapshot();
    expect(afterDefund.journals).toHaveLength((beforeDefund.journals as any[]).length + 1);
    expect(afterDefund.lines).toHaveLength((beforeDefund.lines as any[]).length + 2);
    const replayedDefund = await executeFunding(pendingDefund.id).expect(201);
    expect(replayedDefund.body.status).toBe('REPLAYED');
    expect(replayedDefund.body.replayed).toBe(true);
    expect(replayedDefund.body.journalId).toBe(defundResult.body.journalId);
    expect(await financialSnapshot()).toEqual(afterDefund);
  }, 120_000);

  it('P0-C: dedicated Finance Controller rejection atomically rejects both approval and request; generic rejection route stays closed', async () => {
    const agentId = await createActiveAgent();
    const before = await financialSnapshot();
    const pendingResponse = await requestFunding(
      agentId,
      'FUND',
      ['AGENT_NETWORK_MANAGER'],
      '9000',
    ).expect(201);
    const pending = pendingResponse.body;
    expect(pending.status).toBe('PENDING');
    expect(await financialSnapshot()).toEqual(before);

    await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${pending.approvalId}/reject`)
      .set('Authorization', bearer('FINANCE_CONTROLLER'))
      .send({ comment: 'must use dedicated atomic funding rejection route' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/funding-requests/${pending.id}/reject`)
      .set('Authorization', bearer('OPERATIONS'))
      .send({ reason: 'unauthorized role must not reject' })
      .expect(403);
    expect((await approvalRow(pending.approvalId)).status).toBe('REQUESTED');
    expect((await fundingRequestRow(pending.id)).status).toBe('PENDING');

    const rejection = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/funding-requests/${pending.id}/reject`)
      .set('Authorization', bearer('FINANCE_CONTROLLER'))
      .send({ reason: 'Independent Finance Controller rejection' })
      .expect(201);
    expect(rejection.body.status).toBe('REJECTED');
    expect(rejection.body.rejectionReason).toBe('Independent Finance Controller rejection');
    const rejectedRequest = await fundingRequestRow(pending.id);
    expect(rejectedRequest.status).toBe('REJECTED');
    expect(rejectedRequest.maker_role).toBe('AGENT_NETWORK_MANAGER');
    expect(rejectedRequest.checker_role).toBe('FINANCE_CONTROLLER');
    expect(rejectedRequest.checker_principal_id).toBe('p0p1-test:FINANCE_CONTROLLER');
    expect(rejectedRequest.journal_id).toBeNull();
    expect((await approvalRow(pending.approvalId)).status).toBe('REJECTED');
    expect(await financialSnapshot()).toEqual(before);
  }, 60_000);

  it('P0-C: payload tampering and execute replay are rejected; approved request is recoverable after restoring the bound payload', async () => {
    const agentId = await createActiveAgent();
    const before = await financialSnapshot();
    const pending = (await requestFunding(
      agentId,
      'FUND',
      ['AGENT_NETWORK_MANAGER'],
      '4300',
    ).expect(201)).body;
    await decideApproval(pending.approvalId, 'approve', ['FINANCE_CONTROLLER']).expect(201);
    expect(await financialSnapshot()).toEqual(before);

    await dataSource.query(
      `UPDATE agent_funding_requests SET amount_minor='4301' WHERE id=$1`,
      [pending.id],
    );
    await executeFunding(pending.id).expect(409);
    expect((await fundingRequestRow(pending.id)).status).toBe('PENDING');
    expect((await approvalRow(pending.approvalId)).status).toBe('APPROVED');
    expect(await financialSnapshot()).toEqual(before);

    await dataSource.query(
      `UPDATE agent_funding_requests SET amount_minor='4300' WHERE id=$1`,
      [pending.id],
    );
    const recovered = await executeFunding(pending.id).expect(201);
    expect(recovered.body.amountMinor).toBe('4300');
    const afterRecovery = await financialSnapshot();
    expect((await fundingRequestRow(pending.id)).status).toBe('EXECUTED');
    expect((await approvalRow(pending.approvalId)).status).toBe('CONSUMED');
    const replayed = await executeFunding(pending.id).expect(201);
    expect(replayed.body.status).toBe('REPLAYED');
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.journalId).toBe(recovered.body.journalId);
    expect(await financialSnapshot()).toEqual(afterRecovery);
  }, 90_000);

  it('P0-C: failure after the in-transaction journal write rolls back approval consumption, wallet/account, journal, idempotency, and request state; retry succeeds', async () => {
    const agentId = await createActiveAgent();
    const before = await financialSnapshot();
    const pending = (await requestFunding(
      agentId,
      'FUND',
      ['AGENT_NETWORK_MANAGER'],
      '5600',
    ).expect(201)).body;
    await decideApproval(pending.approvalId, 'approve', ['FINANCE_CONTROLLER']).expect(201);
    expect(await financialSnapshot()).toEqual(before);

    const originalPost = ledgerService.postJournalInTransaction.bind(ledgerService);
    let injected = false;
    const failureSpy = jest
      .spyOn(ledgerService, 'postJournalInTransaction')
      .mockImplementation(async (manager: any, command: any) => {
        const journalId = await originalPost(manager, command);
        if (!injected) {
          injected = true;
          throw new Error('P0-C injected failure after journal insert');
        }
        return journalId;
      });
    try {
      await executeFunding(pending.id).expect(500);
    } finally {
      failureSpy.mockRestore();
    }
    expect(injected).toBe(true);

    expect((await fundingRequestRow(pending.id)).status).toBe('PENDING');
    expect((await approvalRow(pending.approvalId)).status).toBe('APPROVED');
    expect(await financialSnapshot()).toEqual(before);
    const idempotencyRows = await dataSource.query(
      `SELECT id FROM idempotency_records WHERE scope=$1 AND idempotency_key=$2`,
      [`agent-funding.v1:${agentId}`, pending.idempotencyKey],
    );
    expect(idempotencyRows).toHaveLength(0);

    const recovered = await executeFunding(pending.id).expect(201);
    expect(recovered.body.amountMinor).toBe('5600');
    expect((await fundingRequestRow(pending.id)).status).toBe('EXECUTED');
    expect((await approvalRow(pending.approvalId)).status).toBe('CONSUMED');
    const afterRecovery = await financialSnapshot();
    expect(afterRecovery.walletAccounts).toHaveLength((before.walletAccounts as any[]).length + 1);
    expect(afterRecovery.ledgerAccounts).toHaveLength((before.ledgerAccounts as any[]).length + 1);
    expect(afterRecovery.journals).toHaveLength((before.journals as any[]).length + 1);
    expect(afterRecovery.lines).toHaveLength((before.lines as any[]).length + 2);
  }, 90_000);

  // ── P1 role matrix: actual HTTP controllers, actual catalogue grants, valid DTOs ──

  describe('P1 role matrix for aggregator, agent outlets/terminals, and agent-limit assignment', () => {
    let agentId: string;
    let baseAggregatorId: string;
    let baseOutletId: string;
    let baseTerminalId: string;

    beforeAll(async () => {
      agentId = await createActiveAgent();
      const baseAggregator = await aggregatorService.create({
        reference: `p1-base-aggregator-${randomUUID().slice(0, 8)}`,
        code: freshCode('P1BASEAGG'),
        corporateName: 'P1 matrix base aggregator',
        actor: 'p1-fixture',
      });
      const activeAggregator = await aggregatorService.activate(baseAggregator.id, 'p1-fixture');
      baseAggregatorId = activeAggregator.id;
      const baseOutlet = await outletService.create({
        agentId,
        reference: `p1-base-outlet-${randomUUID().slice(0, 8)}`,
        code: freshCode('P1BASEOUTLET'),
        name: 'P1 matrix base outlet',
        actor: 'p1-fixture',
      });
      baseOutletId = baseOutlet.id;
      const baseTerminal = await terminalService.create({
        agentId,
        outletId: baseOutletId,
        reference: `p1-base-terminal-${randomUUID().slice(0, 8)}`,
        code: freshCode('P1BASETERMINAL'),
        label: 'P1 matrix base terminal',
        actor: 'p1-fixture',
      });
      baseTerminalId = baseTerminal.id;
    }, 60_000);

    function hasExpectedFunction(roleKey: string, functionCode: string): boolean {
      return (FUNCTION_CODES_BY_ROLE.get(roleKey) ?? []).includes(functionCode);
    }

    async function aggregatorRows(): Promise<number> {
      return count('aggregators');
    }

    async function outletRows(): Promise<number> {
      return count('agent_outlets');
    }

    async function terminalRows(): Promise<number> {
      return count('agent_terminals');
    }

    async function assignmentRows(): Promise<number> {
      return count('limit_assignments');
    }

    it('uses the explicit expected P1 grants rather than principal-type access', async () => {
      for (const [functionCode, expectedRoles] of Object.entries(P1_EXPECTED_ROLE_GRANTS)) {
        const actualRoles = CATALOGUE_ROLES.filter((role) => hasExpectedFunction(role, functionCode)).sort();
        expect(actualRoles).toEqual([...expectedRoles].sort());
      }
    });

    describe.each(CATALOGUE_ROLES)('catalogue role %s', (roleKey) => {
      it('aggregator create, activation, association, and lifecycle mutations match aggregator.manage', async () => {
        const allowed = P1_EXPECTED_ROLE_GRANTS['aggregator.manage'].includes(roleKey);
        const beforeAggregators = await aggregatorRows();
        const beforeAssignments = await count('aggregator_agent_assignments');
        const suffix = randomUUID().slice(0, 8).toUpperCase();
        const created = await request(app.getHttpServer())
          .post('/api/v1/internal/aggregators')
          .set('Authorization', bearer(roleKey))
          .send({
            reference: `p1-${roleKey.toLowerCase()}-${suffix}`,
            code: `P1_${roleKey}_${suffix}`,
            corporateName: `P1 matrix ${roleKey} aggregator`,
            displayName: `P1 ${roleKey}`,
            contactEmail: `p1-${suffix.toLowerCase()}@example.test`,
          });

        if (!allowed) {
          expect(created.status).toBe(403);
          expect(await aggregatorRows()).toBe(beforeAggregators);
          expect(await request(app.getHttpServer())
            .post(`/api/v1/internal/aggregators/${baseAggregatorId}/suspend`)
            .set('Authorization', bearer(roleKey))
            .send({ reason: 'negative role-matrix check' })
            .then((response: any) => response.status)).toBe(403);
          expect(await request(app.getHttpServer())
            .post(`/api/v1/internal/aggregators/${baseAggregatorId}/agents`)
            .set('Authorization', bearer(roleKey))
            .send({ agentId })
            .then((response: any) => response.status)).toBe(403);
          expect(await count('aggregator_agent_assignments')).toBe(beforeAssignments);
          const base = await dataSource.query(`SELECT status FROM aggregators WHERE id=$1`, [baseAggregatorId]);
          expect(base[0].status).toBe('ACTIVE');
          return;
        }

        expect(created.status).toBe(201);
        expect(await aggregatorRows()).toBe(beforeAggregators + 1);
        await request(app.getHttpServer())
          .post(`/api/v1/internal/aggregators/${created.body.id}/activate`)
          .set('Authorization', bearer(roleKey))
          .send({})
          .expect(200);
        const associationAgentId = await createActiveAgent();
        await request(app.getHttpServer())
          .post(`/api/v1/internal/aggregators/${created.body.id}/agents`)
          .set('Authorization', bearer(roleKey))
          .send({ agentId: associationAgentId })
          .expect(201);
        expect(await count('aggregator_agent_assignments')).toBe(beforeAssignments + 1);
        await request(app.getHttpServer())
          .post(`/api/v1/internal/aggregators/${created.body.id}/suspend`)
          .set('Authorization', bearer(roleKey))
          .send({ reason: 'positive role-matrix check' })
          .expect(200);
        const finalRows = await dataSource.query(`SELECT status FROM aggregators WHERE id=$1`, [created.body.id]);
        expect(finalRows[0].status).toBe('SUSPENDED');
      });

      it('outlet and terminal creation/suspension mutations match agent.manage_outlets_terminals', async () => {
        const allowed = P1_EXPECTED_ROLE_GRANTS['agent.manage_outlets_terminals'].includes(roleKey);
        const beforeOutlets = await outletRows();
        const beforeTerminals = await terminalRows();
        const suffix = randomUUID().slice(0, 8).toUpperCase();
        const createdOutlet = await request(app.getHttpServer())
          .post(`/api/v1/internal/agents/${agentId}/outlets`)
          .set('Authorization', bearer(roleKey))
          .send({
            reference: `p1-outlet-${roleKey.toLowerCase()}-${suffix}`,
            code: `P1_OUTLET_${suffix}`,
            name: `P1 matrix ${roleKey} outlet`,
            displayName: `P1 ${roleKey} outlet`,
            country: 'NG',
          });

        if (!allowed) {
          expect(createdOutlet.status).toBe(403);
          expect(await outletRows()).toBe(beforeOutlets);
          await request(app.getHttpServer())
            .post(`/api/v1/internal/outlets/${baseOutletId}/suspend`)
            .set('Authorization', bearer(roleKey))
            .send({})
            .expect(403);
          await request(app.getHttpServer())
            .post(`/api/v1/internal/outlets/${baseOutletId}/terminals`)
            .set('Authorization', bearer(roleKey))
            .send({
              reference: `p1-denied-terminal-${suffix}`,
              code: `P1_DENIED_${suffix}`,
              outletId: baseOutletId,
              label: 'Must not be created',
            })
            .expect(403);
          await request(app.getHttpServer())
            .post(`/api/v1/internal/terminals/${baseTerminalId}/suspend`)
            .set('Authorization', bearer(roleKey))
            .send({})
            .expect(403);
          expect(await terminalRows()).toBe(beforeTerminals);
          const base = await dataSource.query(`SELECT status FROM agent_outlets WHERE id=$1`, [baseOutletId]);
          const baseTerminal = await dataSource.query(`SELECT status FROM agent_terminals WHERE id=$1`, [baseTerminalId]);
          expect(base[0].status).toBe('ACTIVE');
          expect(baseTerminal[0].status).toBe('ACTIVE');
          return;
        }

        expect(createdOutlet.status).toBe(201);
        expect(await outletRows()).toBe(beforeOutlets + 1);
        const createdTerminal = await request(app.getHttpServer())
          .post(`/api/v1/internal/outlets/${createdOutlet.body.id}/terminals`)
          .set('Authorization', bearer(roleKey))
          .send({
            reference: `p1-terminal-${roleKey.toLowerCase()}-${suffix}`,
            code: `P1_TERMINAL_${suffix}`,
            outletId: createdOutlet.body.id,
            label: `P1 matrix ${roleKey} terminal`,
          });
        expect(createdTerminal.status).toBe(201);
        expect(await terminalRows()).toBe(beforeTerminals + 1);
        await request(app.getHttpServer())
          .post(`/api/v1/internal/terminals/${createdTerminal.body.id}/suspend`)
          .set('Authorization', bearer(roleKey))
          .send({})
          .expect(200);
        await request(app.getHttpServer())
          .post(`/api/v1/internal/outlets/${createdOutlet.body.id}/suspend`)
          .set('Authorization', bearer(roleKey))
          .send({})
          .expect(200);
        const outletStatus = await dataSource.query(
          `SELECT status FROM agent_outlets WHERE id=$1`,
          [createdOutlet.body.id],
        );
        const terminalStatus = await dataSource.query(
          `SELECT status FROM agent_terminals WHERE id=$1`,
          [createdTerminal.body.id],
        );
        expect(outletStatus[0].status).toBe('SUSPENDED');
        expect(terminalStatus[0].status).toBe('SUSPENDED');
      });

      it('agent-level limit assignment follows agent.assign_limit, not limit.modify', async () => {
        const allowed = P1_EXPECTED_ROLE_GRANTS['agent.assign_limit'].includes(roleKey);
        const profileCode = freshCode('P1_ASSIGN');
        await limitCatalogService.createProfile(
          {
            code: profileCode,
            name: `P1 assignment profile ${roleKey}`,
            kind: LimitProfileKind.AGENT,
            status: 'ACTIVE',
            enabled: true,
            configurationStatus: 'CONFIGURED',
          } as any,
          'p1-fixture',
        );
        const beforeAssignments = await assignmentRows();
        const assignment = await request(app.getHttpServer())
          .post('/api/v1/internal/limit-assignments')
          .set('Authorization', bearer(roleKey))
          .send({
            limitProfileCode: profileCode,
            subjectType: 'AGENT',
            subjectId: agentId,
            precedence: 0,
            effectiveFrom: new Date(Date.now() + CATALOGUE_ROLES.indexOf(roleKey) * 1000).toISOString(),
            isActive: true,
          });

        if (!allowed) {
          expect(assignment.status).toBe(403);
          expect(await assignmentRows()).toBe(beforeAssignments);
          return;
        }
        expect(assignment.status).toBe(201);
        expect(await assignmentRows()).toBe(beforeAssignments + 1);
        const rows = await dataSource.query(
          `SELECT limit_profile_code, subject_type, subject_id, is_active
             FROM limit_assignments WHERE id=$1`,
          [assignment.body.id],
        );
        expect(rows[0]).toEqual({
          limit_profile_code: profileCode,
          subject_type: 'AGENT',
          subject_id: agentId,
          is_active: true,
        });
      });
    });

    it('AGENT_NETWORK_MANAGER assignment authority does not grant limit-catalogue definition authority', async () => {
      const code = freshCode('P1_UNGOVERNED');
      const before = await dataSource.query(
        `SELECT COUNT(*)::text AS count FROM limit_profiles WHERE code=$1`,
        [code],
      );
      expect(before[0].count).toBe('0');
      await request(app.getHttpServer())
        .post('/api/v1/internal/limit-profiles')
        .set('Authorization', bearer('AGENT_NETWORK_MANAGER'))
        .send({
          code,
          name: 'Agent assignment must not create or define a catalogue profile',
          kind: 'AGENT',
          status: 'ACTIVE',
          enabled: true,
          configurationStatus: 'CONFIGURED',
        })
        .expect(403);
      const after = await dataSource.query(
        `SELECT COUNT(*)::text AS count FROM limit_profiles WHERE code=$1`,
        [code],
      );
      expect(after[0].count).toBe('0');
    });
  });
});
