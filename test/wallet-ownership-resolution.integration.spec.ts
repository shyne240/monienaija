/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
/**
 * Governed wallet ownership resolution — real PostgreSQL + real HTTP acceptance suite.
 *
 * Proves the REVIEW -> CUSTOMER / AGENT / SYSTEM workflow implemented by migration
 * `1785753600118` and `WalletOwnershipResolutionService`:
 *
 *  - maker (FINANCE_PREPARER) files a `WALLET_OWNERSHIP_RESOLUTION` / `WALLET_ACCOUNT` request with
 *    a server-computed fingerprint; nothing is resolved until the request is approved and executed;
 *  - an independent FINANCE_CONTROLLER approves, and execution consumes the approval atomically
 *    with the ownership change (rollback leaves both the approval and the wallet untouched);
 *  - authorization denials (auditor maker, maker self-approval, maker execution, unauthenticated,
 *    customer/agent/orchestration identities) and evidence validation failures;
 *  - concurrency (competing approvals for one wallet, concurrent replay of one approval);
 *  - canonical UUID uniqueness at the DATABASE level (differently-cased duplicates impossible);
 *  - safe ownership-collision handling (refused, wallet stays REVIEW, nothing merged);
 *  - wallet id, ledger account, balance and full journal/line history preservation;
 *  - administrative reconciliation visibility and continued financial restrictions while unresolved.
 *
 * Nothing authorization-relevant is mocked. Synthetic fixtures only; no provider call, no real
 * financial transaction, no deployment.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { WalletOwnerClass } from '../src/wallet/wallet.enums';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { WalletOwnershipResolutionService } from '../src/wallet/wallet-ownership-resolution.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { walletOwnershipResolutionFingerprint } from '../src/wallet/wallet-ownership-resolution.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const WALLETS = '/api/v1/wallets';
const APPROVALS = '/api/v1/internal/a2/workforce/approvals';
const REVIEW_VISIBILITY = '/api/v1/internal/wallets/ownership-review';

const SYSTEM_OWNERS = ['PLATFORM_SUSPENSE', 'PLATFORM_SETTLEMENT', 'PLATFORM_LEGACY'] as const;

describe('Governed wallet ownership resolution — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let sessions: A2WorkforceSessionService;
  let boundary: WalletFinancialBoundaryService;
  let provisioned: { preparer: Role; controller: Role; auditor: Role } | undefined;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  interface Role {
    principalId: string;
    token: string;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('w08ownership');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ledger = moduleRef.get(LedgerService);
    sessions = moduleRef.get(A2WorkforceSessionService);
    boundary = moduleRef.get(WalletFinancialBoundaryService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // The system-owner registry is migration-owned reference data; the wholesale test truncate
    // removes it, so it is restored exactly as the migration seeded it.
    for (const code of SYSTEM_OWNERS) {
      await dataSource.query(
        `INSERT INTO wallet_system_owners (code, name, description) VALUES ($1,$1,$1)
         ON CONFLICT (code) DO NOTHING`,
        [code],
      );
    }
    provisioned = undefined;
  });

  // ------------------------------------------------------------------ fixtures

  async function provisionRole(
    roleKey: string,
    assuranceLevel: 'PASSWORD' | 'MFA' = 'MFA',
  ): Promise<Role> {
    const principalId = `w08own:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `w08-wallet-ownership:${principalId}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      assignedBy: 'test-harness',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as any);
    const result = await sessions.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel,
      amr: assuranceLevel === 'MFA' ? ['pwd', 'otp'] : ['pwd'],
      acr: null,
      signingKeyId: 'test-harness-key',
    });
    return { principalId, token: result.accessToken };
  }

  async function roles() {
    if (!provisioned) {
      provisioned = {
        preparer: await provisionRole('FINANCE_PREPARER'),
        controller: await provisionRole('FINANCE_CONTROLLER'),
        auditor: await provisionRole('FINANCE_AUDITOR'),
      };
    }
    return provisioned;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createCustomer(
    overrides: { reference?: string; synthetic?: boolean; deleted?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    const synthetic = overrides.synthetic ?? false;
    // Synthetic customers are structurally non-financial (chk_synthetic_customer_nonfinancial).
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status, is_synthetic, deleted_at)
       VALUES ($1,$2,'INDIVIDUAL',$3,$4,$5,$6,$7)`,
      [
        id,
        overrides.reference ?? `cust-${id.slice(0, 8)}`,
        synthetic ? 'DRAFT' : 'ACTIVE',
        synthetic ? 'NONE' : 'LEVEL_1',
        synthetic ? 'NOT_STARTED' : 'APPROVED',
        synthetic,
        overrides.deleted ? new Date() : null,
      ],
    );
    return id;
  }

  async function createAgent(status = 'ACTIVE'): Promise<{ id: string; reference: string }> {
    const id = randomUUID();
    const reference = `agent-${id.slice(0, 8)}`;
    await dataSource.query(`INSERT INTO agents (id, reference, status) VALUES ($1,$2,$3)`, [
      id,
      reference,
      status,
    ]);
    return { id, reference };
  }

  async function createLedgerAccount(
    type: LedgerAccountType = LedgerAccountType.LIABILITY,
    normalBalance: LedgerNormalBalance = LedgerNormalBalance.CREDIT,
    allowNegativeBalance = false,
  ): Promise<string> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const account = await ledger.createAccount({
      code: `W08-${suffix}`,
      name: `W08 ${suffix}`,
      accountType: type,
      normalBalance,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance,
    });
    return account.id;
  }

  /** Honest synthetic ledger movement onto a not-yet-linked ledger account. */
  async function postMovement(liabilityAccountId: string, amountMinor: string): Promise<string> {
    const assetId = await createLedgerAccount(LedgerAccountType.ASSET, LedgerNormalBalance.DEBIT);
    const journal = await ledger.postJournal({
      idempotencyKey: `w08-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'W08 synthetic movement',
      lines: [
        { accountId: assetId, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: liabilityAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
    return journal.id;
  }

  /**
   * Inserts a wallet row directly (the historical state migration 0116 found in production):
   * the owner reference is preserved verbatim and the trigger classifies it.
   */
  async function insertWallet(input: {
    ownerReference: string;
    currency?: string;
    ledgerAccountId?: string;
    status?: string;
  }): Promise<{ id: string; ledgerAccountId: string }> {
    const id = randomUUID();
    const ledgerAccountId = input.ledgerAccountId ?? (await createLedgerAccount());
    await dataSource.query(
      `INSERT INTO wallet_accounts (id, customer_id, currency, status, ledger_account_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        id,
        input.ownerReference,
        input.currency ?? 'NGN',
        input.status ?? 'ACTIVE',
        ledgerAccountId,
      ],
    );
    return { id, ledgerAccountId };
  }

  async function walletRow(walletId: string) {
    const [row] = await dataSource.query<
      Array<{
        id: string;
        customer_id: string;
        owner_class: string;
        currency: string;
        ledger_account_id: string;
      }>
    >(
      'SELECT id, customer_id, owner_class, currency, ledger_account_id FROM wallet_accounts WHERE id=$1',
      [walletId],
    );
    return row!;
  }

  async function resolutionRows() {
    return dataSource.query<
      Array<{ wallet_id: string; resolution_class: string; previous_owner_ref: string }>
    >(
      'SELECT wallet_id, resolution_class, previous_owner_ref FROM governed_wallet_ownership_resolutions',
    );
  }

  async function approvalRow(id: string) {
    return dataSource.getRepository(PrivilegedActionApproval).findOne({ where: { id } });
  }

  async function requestResolution(token: string, walletId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`${WALLETS}/${walletId}/ownership-resolution/request`)
      .set(auth(token))
      .send(body);
  }

  async function executeResolution(token: string, walletId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`${WALLETS}/${walletId}/ownership-resolution`)
      .set(auth(token))
      .send(body);
  }

  async function approve(token: string, approvalId: string) {
    return request(app.getHttpServer())
      .post(`${APPROVALS}/${approvalId}/approve`)
      .set(auth(token))
      .send({ comment: 'wallet ownership evidence verified' });
  }

  /** Full governed CUSTOMER resolution, returning the approval id and executed view. */
  async function resolveToCustomer(
    walletId: string,
    customer: { id: string; reference: string },
    evidenceType = 'CUSTOMER_RECORD_REFERENCE',
  ) {
    const { preparer, controller } = await roles();
    const created = await requestResolution(preparer.token, walletId, {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType,
      evidenceReference: customer.reference,
      reason: 'Legacy owner reference reconciled to the authoritative customer record',
    });
    expect(created.status).toBe(201);
    const approvalId = created.body.approvalId as string;
    const decision = await approve(controller.token, approvalId);
    expect(decision.status).toBe(201);
    const executed = await executeResolution(controller.token, walletId, {
      approvalId,
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType,
      evidenceReference: customer.reference,
      reason: 'Legacy owner reference reconciled to the authoritative customer record',
    });
    return { approvalId, executed };
  }

  async function customerFixture() {
    const reference = `cust-${randomUUID().slice(0, 8)}`;
    const id = await createCustomer({ reference });
    return { id, reference };
  }

  // ------------------------------------------------------------------ maker request

  it('files a pending, fingerprinted WALLET_ACCOUNT request without resolving anything', async () => {
    const { preparer } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);

    const res = await requestResolution(preparer.token, wallet.id, {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      actionType: 'WALLET_OWNERSHIP_RESOLUTION',
      resourceType: 'WALLET_ACCOUNT',
      resourceId: wallet.id,
    });
    expect(res.body.actionFingerprint).toBe(
      walletOwnershipResolutionFingerprint(
        wallet.id,
        'CUSTOMER',
        customer.id,
        null,
        'CUSTOMER_RECORD_REFERENCE',
        customer.reference,
        'Reconciled against the authoritative customer record',
      ),
    );
    expect(res.body.actionFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const stored = await approvalRow(res.body.approvalId);
    expect(stored!.status).toBe(PrivilegedActionApprovalStatus.REQUESTED);
    expect(stored!.requesterPrincipalId).toBe(preparer.principalId);
    // Still REVIEW: a request is not a resolution.
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
    expect(await resolutionRows()).toHaveLength(0);
  });

  // ------------------------------------------------------------------ successful resolutions

  it('resolves REVIEW -> CUSTOMER atomically and preserves id, ledger account, balance and history', async () => {
    const { controller } = await roles();
    const customer = await customerFixture();
    const ledgerAccountId = await createLedgerAccount();
    const firstJournal = await postMovement(ledgerAccountId, '2500');
    const secondJournal = await postMovement(ledgerAccountId, '750');
    const wallet = await insertWallet({
      ownerReference: randomUUID(),
      ledgerAccountId,
    });

    const linesBefore = await dataSource.query<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM ledger_lines WHERE ledger_account_id=$1',
      [ledgerAccountId],
    );
    const balanceBefore = await ledger.getAccountBalance(ledgerAccountId);

    const { approvalId, executed } = await resolveToCustomer(wallet.id, customer);

    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      walletId: wallet.id,
      resolutionClass: 'CUSTOMER',
      resolvedOwnerReference: customer.id,
      ledgerAccountId,
      ownerClass: 'CUSTOMER',
      financiallyRestricted: false,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      executedBy: controller.principalId,
      approvalId,
    });
    expect(executed.body.previousOwnerReference).toMatch(/^[0-9a-f-]{36}$/);
    expect(executed.body.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);

    const after = await walletRow(wallet.id);
    expect(after).toMatchObject({
      id: wallet.id,
      customer_id: customer.id,
      owner_class: WalletOwnerClass.CUSTOMER,
      ledger_account_id: ledgerAccountId,
    });

    // Nothing financial moved: same ledger account, same lines, same balance.
    const linesAfter = await dataSource.query<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM ledger_lines WHERE ledger_account_id=$1',
      [ledgerAccountId],
    );
    expect(linesAfter[0]!.count).toBe(linesBefore[0]!.count);
    expect((await ledger.getAccountBalance(ledgerAccountId)).balanceMinor).toBe(
      balanceBefore.balanceMinor,
    );
    const journals = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM ledger_journals WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[firstJournal, secondJournal]],
    );
    expect(journals).toHaveLength(2);

    // Approval consumed exactly once, audit trail records previous and new ownership.
    expect((await approvalRow(approvalId))!.status).toBe(PrivilegedActionApprovalStatus.CONSUMED);
    const audits = await dataSource.query<Array<{ action: string }>>(
      `SELECT action FROM audit_events WHERE entity_type='WALLET_ACCOUNT' AND entity_id=$1`,
      [wallet.id],
    );
    expect(audits.map((row) => row.action)).toContain('WALLET_OWNERSHIP_RESOLVED');
  });

  it('resolves REVIEW -> AGENT with agent-record evidence', async () => {
    const { preparer, controller } = await roles();
    const agent = await createAgent();
    const wallet = await insertWallet({ ownerReference: `legacy-agent-${randomUUID()}` });

    const created = await requestResolution(preparer.token, wallet.id, {
      resolutionClass: 'AGENT',
      targetOwnerId: agent.id,
      evidenceType: 'AGENT_RECORD_REFERENCE',
      evidenceReference: agent.reference,
      reason: 'Legacy agent reference reconciled to the authoritative agent record',
    });
    expect(created.status).toBe(201);
    await approve(controller.token, created.body.approvalId);

    const executed = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      resolutionClass: 'AGENT',
      targetOwnerId: agent.id,
      evidenceType: 'AGENT_RECORD_REFERENCE',
      evidenceReference: agent.reference,
      reason: 'Legacy agent reference reconciled to the authoritative agent record',
    });
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      resolutionClass: 'AGENT',
      ownerClass: 'AGENT',
      resolvedOwnerReference: agent.id,
    });
    expect(await walletRow(wallet.id)).toMatchObject({
      customer_id: agent.id,
      owner_class: WalletOwnerClass.AGENT,
    });
  });

  it('resolves REVIEW -> SYSTEM only with zero-activity evidence and a registered system owner', async () => {
    const { preparer, controller } = await roles();
    const ledgerAccountId = await createLedgerAccount();
    const code = (
      await dataSource.query<Array<{ code: string }>>(
        'SELECT code FROM ledger_accounts WHERE id=$1',
        [ledgerAccountId],
      )
    )[0]!.code;
    const wallet = await insertWallet({
      ownerReference: `unidentified-${randomUUID()}`,
      ledgerAccountId,
    });

    const created = await requestResolution(preparer.token, wallet.id, {
      resolutionClass: 'SYSTEM',
      systemOwnerCode: 'PLATFORM_SUSPENSE',
      evidenceType: 'ZERO_LEDGER_ACTIVITY',
      evidenceReference: code,
      reason: 'No identifiable customer or agent owner; wallet holds no posted value',
    });
    expect(created.status).toBe(201);
    await approve(controller.token, created.body.approvalId);

    const executed = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      resolutionClass: 'SYSTEM',
      systemOwnerCode: 'PLATFORM_SUSPENSE',
      evidenceType: 'ZERO_LEDGER_ACTIVITY',
      evidenceReference: code,
      reason: 'No identifiable customer or agent owner; wallet holds no posted value',
    });
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({
      resolutionClass: 'SYSTEM',
      systemOwnerCode: 'PLATFORM_SUSPENSE',
      resolvedOwnerReference: 'SYSTEM:PLATFORM_SUSPENSE',
      ownerClass: 'SYSTEM',
    });
    expect(await walletRow(wallet.id)).toMatchObject({
      customer_id: 'SYSTEM:PLATFORM_SUSPENSE',
      owner_class: WalletOwnerClass.SYSTEM,
    });
    // The historical reference is preserved in the immutable resolution record.
    const [record] = await dataSource.query<Array<{ previous_owner_ref: string }>>(
      'SELECT previous_owner_ref FROM governed_wallet_ownership_resolutions WHERE wallet_id=$1',
      [wallet.id],
    );
    expect(record!.previous_owner_ref).toMatch(/^unidentified-/);
  });

  it('supports customer financial-account-binding evidence', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const ledgerAccountId = await createLedgerAccount();
    const wallet = await insertWallet({ ownerReference: randomUUID(), ledgerAccountId });
    // The binding is the authoritative internal record linking this wallet to the customer.
    const bindingId = randomUUID();
    const customerWalletId = randomUUID();
    await dataSource.query(
      `INSERT INTO customer_wallets (id, customer_id, type, currency, status)
       VALUES ($1,$2,'SAVINGS','NGN','ACTIVE')`,
      [customerWalletId, customer.id],
    );
    await dataSource.query(
      `INSERT INTO customer_financial_account_bindings
         (id, customer_id, customer_wallet_id, wallet_account_id, ledger_account_id, currency,
          accounting_unit, state, source_customer_version, source_customer_wallet_version,
          created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'NGN','CUSTOMER_FUNDS','ACTIVE',1,1,'test-harness','test-harness')`,
      [bindingId, customer.id, customerWalletId, wallet.id, ledgerAccountId],
    );

    const created = await requestResolution(preparer.token, wallet.id, {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
      evidenceReference: bindingId,
      reason: 'Active financial account binding proves the customer owns this wallet',
    });
    expect(created.status).toBe(201);
    await approve(controller.token, created.body.approvalId);
    const executed = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
      evidenceReference: bindingId,
      reason: 'Active financial account binding proves the customer owns this wallet',
    });
    expect(executed.status).toBe(201);
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.CUSTOMER);
  });

  // ------------------------------------------------------------------ authorization denials

  it('denies unauthorized makers, self-approval and maker execution', async () => {
    const { preparer, controller, auditor } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    };

    // FINANCE_AUDITOR is not a maker role.
    expect((await requestResolution(auditor.token, wallet.id, body)).status).toBe(403);
    // A customer cannot reach the workforce route at all.
    const anonymous = await request(app.getHttpServer())
      .post(`${WALLETS}/${wallet.id}/ownership-resolution/request`)
      .send(body);
    expect([401, 403]).toContain(anonymous.status);

    const created = await requestResolution(preparer.token, wallet.id, body);
    expect(created.status).toBe(201);
    const approvalId = created.body.approvalId as string;

    // Maker can never approve their own request.
    expect((await approve(preparer.token, approvalId)).status).toBe(403);
    // Unapproved approval cannot be executed.
    expect(
      (await executeResolution(controller.token, wallet.id, { approvalId, ...body })).status,
    ).toBe(409);
    // The auditor may not execute either.
    await approve(controller.token, approvalId);
    expect(
      (await executeResolution(auditor.token, wallet.id, { approvalId, ...body })).status,
    ).toBe(403);
    // Maker holds no execution entitlement even when the approval exists.
    expect(
      (await executeResolution(preparer.token, wallet.id, { approvalId, ...body })).status,
    ).toBe(403);
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
  });

  it('rejects an execution payload that differs from the approved request', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const other = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    };
    const created = await requestResolution(preparer.token, wallet.id, body);
    await approve(controller.token, created.body.approvalId);

    // The approval is bound to the exact payload: a different target is a fingerprint mismatch.
    const tampered = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      ...body,
      targetOwnerId: other.id,
      evidenceReference: other.reference,
    });
    expect(tampered.status).toBe(403);
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
    // Nothing was consumed by the rejected attempt.
    expect((await approvalRow(created.body.approvalId))!.status).toBe(
      PrivilegedActionApprovalStatus.APPROVED,
    );
  });

  // ------------------------------------------------------------------ evidence validation

  it('rejects unsupported or unverifiable evidence', async () => {
    const { preparer } = await roles();
    const customer = await customerFixture();
    const agent = await createAgent();
    const wallet = await insertWallet({ ownerReference: randomUUID() });

    // Wrong customer record reference.
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'CUSTOMER',
          targetOwnerId: customer.id,
          evidenceType: 'CUSTOMER_RECORD_REFERENCE',
          evidenceReference: 'not-the-reference',
          reason: 'Reconciled against the authoritative customer record',
        })
      ).status,
    ).toBe(400);

    // Evidence type not supported for the requested class.
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'CUSTOMER',
          targetOwnerId: customer.id,
          evidenceType: 'AGENT_RECORD_REFERENCE',
          evidenceReference: customer.reference,
          reason: 'Cross-domain evidence must be refused',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'SYSTEM',
          systemOwnerCode: 'PLATFORM_LEGACY',
          evidenceType: 'CUSTOMER_RECORD_REFERENCE',
          evidenceReference: customer.reference,
          reason: 'Customer evidence cannot support platform custody',
        })
      ).status,
    ).toBe(400);

    // REVIEW is never a resolution target; unknown classes are refused by validation.
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'REVIEW',
          evidenceType: 'CUSTOMER_RECORD_REFERENCE',
          evidenceReference: customer.reference,
          reason: 'REVIEW is not a target',
        })
      ).status,
    ).toBe(400);

    // An agent UUID is not a customer record at all.
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'CUSTOMER',
          targetOwnerId: agent.id,
          evidenceType: 'CUSTOMER_RECORD_REFERENCE',
          evidenceReference: agent.reference,
          reason: 'Agent identity cannot be a customer owner',
        })
      ).status,
    ).toBe(404);

    // A UUID that is simultaneously a customer and an agent is ambiguous and stays unresolved.
    const ambiguous = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED')`,
      [ambiguous, `cust-amb-${ambiguous.slice(0, 8)}`],
    );
    await dataSource.query(`INSERT INTO agents (id, reference, status) VALUES ($1,$2,'ACTIVE')`, [
      ambiguous,
      `agent-amb-${ambiguous.slice(0, 8)}`,
    ]);
    for (const resolutionClass of ['CUSTOMER', 'AGENT'] as const) {
      const ambiguousAttempt = await requestResolution(preparer.token, wallet.id, {
        resolutionClass,
        targetOwnerId: ambiguous,
        evidenceType:
          resolutionClass === 'CUSTOMER' ? 'CUSTOMER_RECORD_REFERENCE' : 'AGENT_RECORD_REFERENCE',
        evidenceReference:
          resolutionClass === 'CUSTOMER'
            ? `cust-amb-${ambiguous.slice(0, 8)}`
            : `agent-amb-${ambiguous.slice(0, 8)}`,
        reason: 'Ambiguous authoritative identity must not be resolved',
      });
      expect(ambiguousAttempt.status).toBe(409);
    }

    // Synthetic customers can never own a wallet.
    const synthetic = await createCustomer({ synthetic: true });
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'CUSTOMER',
          targetOwnerId: synthetic,
          evidenceType: 'CUSTOMER_RECORD_REFERENCE',
          evidenceReference: `cust-${synthetic.slice(0, 8)}`,
          reason: 'Synthetic identity is not a valid owner',
        })
      ).status,
    ).toBe(409);

    // An unregistered system owner code does not exist as authoritative evidence.
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'SYSTEM',
          systemOwnerCode: 'PLATFORM_UNREGISTERED',
          evidenceType: 'ZERO_LEDGER_ACTIVITY',
          evidenceReference: 'W08-NOPE',
          reason: 'Unregistered system owner',
        })
      ).status,
    ).toBe(409);

    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
    expect(await resolutionRows()).toHaveLength(0);
  });

  it('refuses SYSTEM custody for a wallet that still holds posted value', async () => {
    const { preparer } = await roles();
    const ledgerAccountId = await createLedgerAccount();
    await postMovement(ledgerAccountId, '1000');
    const code = (
      await dataSource.query<Array<{ code: string }>>(
        'SELECT code FROM ledger_accounts WHERE id=$1',
        [ledgerAccountId],
      )
    )[0]!.code;
    const wallet = await insertWallet({
      ownerReference: `unidentified-${randomUUID()}`,
      ledgerAccountId,
    });

    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'SYSTEM',
          systemOwnerCode: 'PLATFORM_SETTLEMENT',
          evidenceType: 'ZERO_LEDGER_ACTIVITY',
          evidenceReference: code,
          reason: 'Wallet has posted activity',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await requestResolution(preparer.token, wallet.id, {
          resolutionClass: 'SYSTEM',
          systemOwnerCode: 'PLATFORM_SETTLEMENT',
          evidenceType: 'ZERO_LEDGER_BALANCE',
          evidenceReference: code,
          reason: 'Wallet has a non-zero balance',
        })
      ).status,
    ).toBe(409);
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
  });

  // ------------------------------------------------------------------ atomicity / rollback

  it('rolls back the whole resolution when evidence stops holding before execution', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    const created = await requestResolution(preparer.token, wallet.id, {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    });
    await approve(controller.token, created.body.approvalId);

    // The authoritative customer record is removed after approval: the evidence can no longer hold.
    await dataSource.query(`UPDATE customers SET deleted_at=clock_timestamp() WHERE id=$1`, [
      customer.id,
    ]);

    const executed = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    });
    expect(executed.status).toBe(409);
    // Atomicity: approval NOT consumed, no resolution record, wallet still REVIEW.
    expect((await approvalRow(created.body.approvalId))!.status).toBe(
      PrivilegedActionApprovalStatus.APPROVED,
    );
    expect(await resolutionRows()).toHaveLength(0);
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
  });

  it('consumes each approval exactly once and replays the committed resolution idempotently', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    };
    const created = await requestResolution(preparer.token, wallet.id, body);
    await approve(controller.token, created.body.approvalId);

    const first = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      ...body,
    });
    expect(first.status).toBe(201);

    // Replay of the same approval returns the same committed resolution, no second record.
    const replay = await executeResolution(controller.token, wallet.id, {
      approvalId: created.body.approvalId,
      ...body,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.executedAt).toBe(first.body.executedAt);
    expect(await resolutionRows()).toHaveLength(1);

    // A second, independently approved request for the same wallet can never apply.
    const second = await requestResolution(preparer.token, wallet.id, body);
    expect(second.status).toBe(409);
  });

  // ------------------------------------------------------------------ concurrency

  it('serializes competing approvals for one wallet: exactly one resolution wins', async () => {
    const { preparer, controller } = await roles();
    const first = await customerFixture();
    const second = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });

    const bodyFor = (target: { id: string; reference: string }, reason: string) => ({
      resolutionClass: 'CUSTOMER',
      targetOwnerId: target.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: target.reference,
      reason,
    });
    const firstBody = bodyFor(first, 'First competing reconciliation');
    const secondBody = bodyFor(second, 'Second competing reconciliation');
    const firstRequest = await requestResolution(preparer.token, wallet.id, firstBody);
    const secondRequest = await requestResolution(preparer.token, wallet.id, secondBody);
    await approve(controller.token, firstRequest.body.approvalId);
    await approve(controller.token, secondRequest.body.approvalId);

    const [firstResult, secondResult] = await Promise.all([
      executeResolution(controller.token, wallet.id, {
        approvalId: firstRequest.body.approvalId,
        ...firstBody,
      }),
      executeResolution(controller.token, wallet.id, {
        approvalId: secondRequest.body.approvalId,
        ...secondBody,
      }),
    ]);

    const statuses = [firstResult.status, secondResult.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await resolutionRows()).toHaveLength(1);
    const applied = await walletRow(wallet.id);
    expect(applied.owner_class).toBe(WalletOwnerClass.CUSTOMER);
    expect([first.id, second.id]).toContain(applied.customer_id);
    // The losing approval is not consumed and can never be applied later.
    const losingApproval =
      firstResult.status === 201 ? secondRequest.body.approvalId : firstRequest.body.approvalId;
    expect((await approvalRow(losingApproval))!.status).toBe(
      PrivilegedActionApprovalStatus.APPROVED,
    );
  });

  it('handles concurrent replay of one approval without duplicating the resolution', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Concurrent replay reconciliation',
    };
    const created = await requestResolution(preparer.token, wallet.id, body);
    await approve(controller.token, created.body.approvalId);

    const results = await Promise.all([
      executeResolution(controller.token, wallet.id, {
        approvalId: created.body.approvalId,
        ...body,
      }),
      executeResolution(controller.token, wallet.id, {
        approvalId: created.body.approvalId,
        ...body,
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0].body.executedAt).toBe(results[1].body.executedAt);
    expect(await resolutionRows()).toHaveLength(1);
  });

  // ------------------------------------------------------------------ canonical uniqueness / collisions

  it('enforces canonical UUID uniqueness and canonicalises direct inserts', async () => {
    const customer = await customerFixture();

    // A direct insert with a non-canonical UUID is normalised to the canonical form.
    const wallet = await insertWallet({ ownerReference: customer.id.toUpperCase() });
    expect((await walletRow(wallet.id)).customer_id).toBe(customer.id.toLowerCase());
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.CUSTOMER);

    // A differently-cased duplicate of the same canonical owner is rejected by the database,
    // not merely by application code.
    const ledgerAccountId = await createLedgerAccount();
    await expect(
      dataSource.query(
        `INSERT INTO wallet_accounts (id, customer_id, currency, status, ledger_account_id)
         VALUES ($1,$2,'NGN','ACTIVE',$3)`,
        [randomUUID(), customer.id.toUpperCase(), ledgerAccountId],
      ),
    ).rejects.toThrow(/uq_wallet_accounts/);
  });

  it('refuses a resolution that would collide with an existing wallet and leaves it REVIEW', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    // The target customer already owns (canonical) NGN wallet.
    const existing = await insertWallet({ ownerReference: customer.id });
    expect((await walletRow(existing.id)).owner_class).toBe(WalletOwnerClass.CUSTOMER);
    const review = await insertWallet({ ownerReference: randomUUID() });

    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Collision must not merge wallets',
    };
    const created = await requestResolution(preparer.token, review.id, body);
    expect(created.status).toBe(409);
    expect((await walletRow(review.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
    expect(await resolutionRows()).toHaveLength(0);

    // A collision that appears AFTER approval is caught at execution and rolled back.
    const second = await customerFixture();
    const pending = await requestResolution(preparer.token, review.id, {
      ...body,
      targetOwnerId: second.id,
      evidenceReference: second.reference,
    });
    expect(pending.status).toBe(201);
    await approve(controller.token, pending.body.approvalId);
    await insertWallet({ ownerReference: second.id });

    const executed = await executeResolution(controller.token, review.id, {
      approvalId: pending.body.approvalId,
      ...body,
      targetOwnerId: second.id,
      evidenceReference: second.reference,
    });
    expect(executed.status).toBe(409);
    expect((await walletRow(review.id)).owner_class).toBe(WalletOwnerClass.REVIEW);
    expect((await approvalRow(pending.body.approvalId))!.status).toBe(
      PrivilegedActionApprovalStatus.APPROVED,
    );
    // Both wallets still exist: nothing was merged, deleted or re-pointed.
    expect(
      await dataSource.query(
        `SELECT count(*)::int AS count FROM wallet_accounts WHERE id = ANY($1::uuid[])`,
        [[existing.id, review.id]],
      ),
    ).toEqual([{ count: 2 }]);
  });

  // ------------------------------------------------------------------ unsupported changes

  it('rejects unsupported ownership changes, including direct database mutation', async () => {
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: customer.id });
    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.CUSTOMER);

    // Already-resolved wallets cannot be re-resolved through the governed path.
    const other = await customerFixture();
    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: other.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: other.reference,
      reason: 'Re-resolution is not supported',
    };
    expect((await requestResolution(preparer.token, wallet.id, body)).status).toBe(409);
    void controller;

    // Direct SQL cannot rewrite an owner class or owner reference.
    await expect(
      dataSource.query(`UPDATE wallet_accounts SET owner_class='AGENT' WHERE id=$1`, [wallet.id]),
    ).rejects.toThrow(/immutable|governed resolution/);
    await expect(
      dataSource.query(`UPDATE wallet_accounts SET customer_id=$2 WHERE id=$1`, [
        wallet.id,
        randomUUID(),
      ]),
    ).rejects.toThrow(/immutable|governed resolution/);
    // The ledger account binding is immutable too (a valid replacement account is still refused).
    const replacement = await createLedgerAccount();
    await expect(
      dataSource.query(`UPDATE wallet_accounts SET ledger_account_id=$2 WHERE id=$1`, [
        wallet.id,
        replacement,
      ]),
    ).rejects.toThrow(/immutable/);
    // And a resolution record cannot exist unless its governed approval was actually consumed.
    const review = await insertWallet({ ownerReference: randomUUID() });
    const pending = await requestResolution(preparer.token, review.id, {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: other.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: other.reference,
      reason: 'Record must not exist before execution',
    });
    expect(pending.status).toBe(201);
    await expect(
      dataSource.query(
        `INSERT INTO governed_wallet_ownership_resolutions
           (approval_id, wallet_id, resolution_class, previous_owner_ref, resolved_owner_ref,
            evidence_type, evidence_reference, evidence_digest, reason, executed_by)
         VALUES ($1,$2,'CUSTOMER',$3,$4,'CUSTOMER_RECORD_REFERENCE',$5,repeat('a',64),'r','x')`,
        [
          pending.body.approvalId,
          review.id,
          (await walletRow(review.id)).customer_id,
          other.id,
          other.reference,
        ],
      ),
    ).rejects.toThrow(/does not match its approval/);

    expect((await walletRow(wallet.id)).owner_class).toBe(WalletOwnerClass.CUSTOMER);
  });

  // ------------------------------------------------------------------ restrictions / visibility

  it('keeps unresolved wallets financially restricted and shows them in reconciliation', async () => {
    const { controller } = await roles();
    const customer = await customerFixture();
    const ledgerAccountId = await createLedgerAccount();
    await postMovement(ledgerAccountId, '4200');
    const review = await insertWallet({ ownerReference: randomUUID(), ledgerAccountId });
    const legacy = await insertWallet({ ownerReference: `legacy-${randomUUID()}` });

    // Journal posting to an unresolved (REVIEW) wallet is refused by the real boundary.
    const asset = await createLedgerAccount(LedgerAccountType.ASSET, LedgerNormalBalance.DEBIT);
    await expect(
      dataSource.transaction(async (manager) => {
        await ledger.postJournalInTransaction(manager, {
          idempotencyKey: `w08-review-${randomUUID()}`,
          currency: 'NGN',
          lines: [
            { accountId: asset, direction: LedgerEntryDirection.DEBIT, amountMinor: '1' },
            {
              accountId: review.ledgerAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: '1',
            },
          ],
        });
      }),
    ).rejects.toThrow(/requires review/);

    // Administrative reconciliation visibility (reconciliation.view).
    const report = await request(app.getHttpServer())
      .get(REVIEW_VISIBILITY)
      .set(auth((await roles()).auditor.token));
    expect(report.status).toBe(200);
    expect(report.body.summary).toMatchObject({
      totalWallets: 2,
      unresolved: 2,
      resolved: 0,
      financiallyRestricted: 2,
      appliedResolutions: 0,
    });
    const byId = new Map(
      (report.body.unresolvedWallets as any[]).map((item) => [item.walletId, item]),
    );
    expect(byId.get(review.id)).toMatchObject({
      ownerClass: 'REVIEW',
      reviewReason: 'NO_AUTHORITATIVE_OWNER',
      balanceMinor: '4200',
      financiallyRestricted: true,
      currency: 'NGN',
    });
    expect(byId.get(legacy.id)).toMatchObject({
      reviewReason: 'NON_CANONICAL_REFERENCE',
      balanceMinor: '0',
    });

    // Unauthenticated access to the reconciliation surface is impossible.
    expect((await request(app.getHttpServer()).get(REVIEW_VISIBILITY)).status).toBe(401);

    // After a governed resolution the wallet disappears from the unresolved list and is recorded.
    const { executed } = await resolveToCustomer(review.id, customer);
    expect(executed.status).toBe(201);

    const after = await request(app.getHttpServer())
      .get(REVIEW_VISIBILITY)
      .set(auth((await roles()).auditor.token));
    expect(after.status).toBe(200);
    expect(after.body.summary).toMatchObject({
      totalWallets: 2,
      unresolved: 1,
      resolved: 1,
      financiallyRestricted: 1,
      appliedResolutions: 1,
    });
    expect(after.body.summary.byOwnerClass).toMatchObject({ CUSTOMER: 1, REVIEW: 1 });
    expect(after.body.appliedResolutions[0]).toMatchObject({
      walletId: review.id,
      resolutionClass: 'CUSTOMER',
      resolvedOwnerReference: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      executedBy: controller.principalId,
    });
    // The preserved balance is still visible for the resolved wallet's ledger account.
    expect((await ledger.getAccountBalance(review.ledgerAccountId)).balanceMinor).toBe('4200');
  });

  it('keeps SYSTEM custody wallets out of customer and agent financial lanes', async () => {
    const { preparer, controller } = await roles();
    const ledgerAccountId = await createLedgerAccount();
    const code = (
      await dataSource.query<Array<{ code: string }>>(
        'SELECT code FROM ledger_accounts WHERE id=$1',
        [ledgerAccountId],
      )
    )[0]!.code;
    const wallet = await insertWallet({
      ownerReference: `unidentified-${randomUUID()}`,
      ledgerAccountId,
    });
    const body = {
      resolutionClass: 'SYSTEM',
      systemOwnerCode: 'PLATFORM_LEGACY',
      evidenceType: 'ZERO_LEDGER_BALANCE',
      evidenceReference: code,
      reason: 'Platform custody designation',
    };
    const created = await requestResolution(preparer.token, wallet.id, body);
    expect(created.status).toBe(201);
    await approve(controller.token, created.body.approvalId);
    expect(
      (
        await executeResolution(controller.token, wallet.id, {
          approvalId: created.body.approvalId,
          ...body,
        })
      ).status,
    ).toBe(201);

    await expect(
      boundary.requireAccounts(dataSource.manager, [wallet.ledgerAccountId]),
    ).rejects.toThrow(/System-owned wallet is not eligible/);
    await expect(
      boundary.requireCustomerWallet(
        dataSource.manager,
        randomUUID(),
        wallet.id,
        wallet.ledgerAccountId,
      ),
    ).rejects.toThrow(/requires review/);
  });

  it('requires MFA before a privileged controller session exists or may execute', async () => {
    // Arena 4 documented MFA as an acceptance property; this proves where it is enforced. A
    // privileged workforce session cannot even be established without MFA, and the service
    // independently refuses to execute for a principal whose assurance has been downgraded.
    const { controller } = await roles();
    await expect(provisionRole('FINANCE_CONTROLLER', 'PASSWORD')).rejects.toThrow(
      /requires recent MFA/,
    );

    const resolution = app.get(WalletOwnershipResolutionService);
    const downgraded = {
      principalId: controller.principalId,
      type: 'OPERATOR',
      roles: ['FINANCE_CONTROLLER'],
      scopes: [],
      assuranceLevel: 'PASSWORD',
    } as unknown as AuthorizationPrincipal;
    expect(() => resolution.assertExecuteEntitled(downgraded)).toThrow(/FINANCE_CONTROLLER/);

    // Read-only principals are refused too, even at MFA.
    const readOnly = {
      ...downgraded,
      assuranceLevel: 'MFA' as const,
      readOnlyPrincipal: true,
    };
    expect(() => resolution.assertExecuteEntitled(readOnly)).toThrow(/FINANCE_CONTROLLER/);
  });

  it('keeps resolved CUSTOMER wallets subject to KYC financial eligibility', async () => {
    // Ownership resolution must not become a financial-eligibility bypass: once the wallet is a
    // CUSTOMER wallet, the real boundary still applies the governed KYC gate to its owner.
    const { preparer, controller } = await roles();
    const customer = await customerFixture();
    const wallet = await insertWallet({ ownerReference: randomUUID() });
    const body = {
      resolutionClass: 'CUSTOMER',
      targetOwnerId: customer.id,
      evidenceType: 'CUSTOMER_RECORD_REFERENCE',
      evidenceReference: customer.reference,
      reason: 'Reconciled against the authoritative customer record',
    };
    const created = await requestResolution(preparer.token, wallet.id, body);
    expect(created.status).toBe(201);
    await approve(controller.token, created.body.approvalId);
    expect(
      (
        await executeResolution(controller.token, wallet.id, {
          approvalId: created.body.approvalId,
          ...body,
        })
      ).status,
    ).toBe(201);

    const resolved = await walletRow(wallet.id);
    expect(resolved.owner_class).toBe(WalletOwnerClass.CUSTOMER);
    // The fixture customer has no governed KYC evidence, so the eligibility gate still refuses.
    await expect(
      boundary.requireCustomerWallet(
        dataSource.manager,
        customer.id,
        wallet.id,
        wallet.ledgerAccountId,
      ),
    ).rejects.toThrow(/not eligible for financial access|financial policy is unavailable/);
  });
});
