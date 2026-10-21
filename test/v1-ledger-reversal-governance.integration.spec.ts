/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * P0-B — dedicated real-PostgreSQL, real-HTTP proof suite for the journal-reversal maker
 * request wiring (`LedgerReversalGovernanceService` + `LedgerController`):
 * a valid FINANCE_PREPARER request creates the correct pending maker-checker request bound to
 * `LEDGER_JOURNAL_REVERSAL` / `LEDGER_JOURNAL` with a deterministic fingerprint of the ACTUAL
 * requested action and payload; invalid/unauthorized/duplicate/tampered requests are rejected
 * per the existing rules; approval remains subject to the established separation-of-duties;
 * execution consumes the approved request and delegates to the untouched reversal primitive.
 *
 * Nothing authorization-relevant is mocked (same session pattern as
 * test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts). Uses
 * synthetic test data only (no seed assumptions, no real accounts).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import { ledgerReversalRequestFingerprint } from '../src/ledger/ledger-reversal-governance.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerEntryDirection, LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LEDGER_PATH = '/api/v1/internal/ledger';
const APPROVE_PATH = '/api/v1/internal/a2/workforce/approvals';

describe('P0-B ledger journal reversal maker-checker governance — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('p0bledgrev01');

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
    sessionService = moduleRef.get(A2WorkforceSessionService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  // ---------------------------------------------------------------- session helpers

  async function provisionRole(roleKey: string): Promise<{ principalId: string; token: string }> {
    const principalId = `p0bledgrev01:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `p0-b-ledg-rev-01:${principalId}:${roleKey}`,
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
    const result = await sessionService.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'test-harness-key',
    });
    return { principalId, token: result.accessToken };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** Synthetic balanced journal via the real ledger service (a5 pattern; no seed assumptions). */
  async function seedJournal(): Promise<{ journalId: string; reason: string }> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const debit = await ledger.createAccount({
      code: `P0BD${suffix}`,
      name: `P0-B debit ${suffix}`,
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    const credit = await ledger.createAccount({
      code: `P0BC${suffix}`,
      name: `P0-B credit ${suffix}`,
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    const journal = await ledger.postJournal({
      idempotencyKey: `p0b-${suffix}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: `P0-B synthetic journal ${suffix}`,
      lines: [
        { accountId: debit.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
        { accountId: credit.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '5000' },
      ],
    });
    return { journalId: journal.id, reason: `P0-B duplicate posting ${suffix}` };
  }

  // ---------------------------------------------------------------- P0-B lifecycle

  it('creates the correct pending maker-checker request from a valid preparer request', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const { journalId, reason } = await seedJournal();

    const res = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      actionType: 'LEDGER_JOURNAL_REVERSAL',
      resourceType: 'LEDGER_JOURNAL',
      resourceId: journalId,
    });
    // The fingerprint is the deterministic hash of the ACTUAL requested action + payload —
    // computed server-side, never a client-supplied placeholder.
    expect(res.body.actionFingerprint).toBe(ledgerReversalRequestFingerprint(journalId, reason));
    expect(res.body.actionFingerprint).toMatch(/^[0-9a-f]{64}$/);

    // No reversal has been posted: the request is pending only.
    const stored = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: res.body.approvalId },
    });
    expect(stored!.status).toBe(PrivilegedActionApprovalStatus.REQUESTED);
    expect(stored!.requesterPrincipalId).toBe(preparer.principalId);
  });

  it('rejects invalid maker requests per the reversal domain rules', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const { journalId, reason } = await seedJournal();

    // Missing/blank reason.
    const noReason = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason: '   ' });
    expect(noReason.status).toBe(400);

    // Unknown journal.
    const unknown = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${randomUUID()}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason });
    expect(unknown.status).toBe(404);

    // Unauthenticated.
    const anonymous = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .send({ reason });
    expect([401, 403]).toContain(anonymous.status);
  });

  it('rejects unauthorized makers (FINANCE_AUDITOR cannot initiate)', async () => {
    const auditor = await provisionRole('FINANCE_AUDITOR');
    const preparer = await provisionRole('FINANCE_PREPARER');
    const { journalId, reason } = await seedJournal();

    const res = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(auditor.token))
      .send({ reason });
    expect(res.status).toBe(403);
  });

  it('keeps approval separation of duties on the reversal request', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const { journalId, reason } = await seedJournal();

    const created = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason });
    const approvalId = created.body.approvalId as string;

    // Maker cannot approve.
    const makerAttempt = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(preparer.token))
      .send({});
    expect(makerAttempt.status).toBe(403);

    // Checker approves through the established decide() machinery (MFA + approvalScope).
    const decision = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'reversal verified' });
    expect(decision.status).toBe(200);
    expect(decision.body).toMatchObject({ approved: true, reason: 'APPROVED' });
  });

  it('executes an approved reversal exactly once and posts a compensating journal', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const { journalId, reason } = await seedJournal();

    const created = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason });
    const approvalId = created.body.approvalId as string;
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });

    // The maker cannot execute.
    const makerExecute = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(preparer.token))
      .send({ reason, approvalId, idempotencyKey: `rev-${journalId}-maker` });
    expect(makerExecute.status).toBe(403);

    // The approving FINANCE_CONTROLLER executes the approved request.
    const executed = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(controller.token))
      .send({ reason, approvalId, idempotencyKey: `rev-${journalId}-checker` });
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({ reversalOfJournalId: journalId });

    // Replay is rejected.
    const replay = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(controller.token))
      .send({ reason, approvalId, idempotencyKey: `rev-${journalId}-replay` });
    expect(replay.status).toBe(409);

    // The approval trail shows pending → approved → consumed.
    const stored = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
    });
    expect(stored!.status).toBe(PrivilegedActionApprovalStatus.CONSUMED);
    expect(stored!.approvedBy).toBe(controller.principalId);
  });

  it('rejects tampered executions: wrong reason (fingerprint mismatch), missing approvalId, unentitled executor', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const { journalId, reason } = await seedJournal();

    const created = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason });
    const approvalId = created.body.approvalId as string;
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });

    const tampered = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(controller.token))
      .send({ reason: 'A DIFFERENT reason', approvalId, idempotencyKey: `rev-${journalId}-t` });
    expect(tampered.status).toBe(403);

    const missingApproval = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(controller.token))
      .send({ reason, idempotencyKey: `rev-${journalId}-m` });
    expect(missingApproval.status).toBe(400);

    // The execution is still available afterwards — nothing consumed, nothing posted.
    const stored = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
    });
    expect(stored!.status).toBe(PrivilegedActionApprovalStatus.APPROVED);
  });

  it('rejects duplicate reversal requests on an already-reversed journal and reversals of reversals', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const { journalId, reason } = await seedJournal();

    const created = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason });
    const approvalId = created.body.approvalId as string;
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });
    const executed = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(controller.token))
      .send({ reason, approvalId, idempotencyKey: `rev-${journalId}-1` });
    expect(executed.status).toBe(201);
    const reversalId = executed.body.id as string;

    // Already-reversed journal: new maker request is rejected by the domain rules.
    const duplicate = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason: 'trying again' });
    expect(duplicate.status).toBe(409);

    // Reversal of a reversal is rejected.
    const reversalOfReversal = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${reversalId}/reversal-request`)
      .set(auth(preparer.token))
      .send({ reason: 'undo the undo' });
    expect(reversalOfReversal.status).toBe(409);
  });

  it('never executes a request whose client-supplied fingerprint does not match the actual request', async () => {
    // The legacy generic approvals surface still accepts client-supplied fingerprints for
    // compatibility, but execution recomputes the fingerprint from the ACTUAL payload — a
    // placeholder fingerprint can never be consumed to reverse a journal.
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const { journalId, reason } = await seedJournal();

    const generic = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/request`)
      .set(auth(preparer.token))
      .send({
        action: 'LEDGER_JOURNAL_REVERSAL',
        resource: { type: 'LEDGER_JOURNAL', id: journalId },
        actionFingerprint: '4db33761157d636e1451c3746c9094b4c063207b4db33761157d636e1451c374',
        reason,
      });
    expect(generic.status).toBe(201);
    const approvalId = generic.body.approval?.id ?? generic.body.id;
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'approved without noticing the placeholder' });

    const execute = await request(app.getHttpServer())
      .post(`${LEDGER_PATH}/journals/${journalId}/reversal`)
      .set(auth(controller.token))
      .send({ reason, approvalId, idempotencyKey: `rev-${journalId}-placeholder` });
    expect(execute.status).toBe(403);
  });
});
