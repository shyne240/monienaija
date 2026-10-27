/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion */
/**
 * ARENA 3 — Sprint 3 integration coverage (real PostgreSQL):
 *
 * V1-SPRINT3-AGENT-HISTORY-API-01 (P1): GET /api/v1/internal/agents/:id/transactions — the
 * workforce read of the unified Agent transaction history that admin-web's
 * AgentUnifiedHistoryPanel (commit b604565) already consumes but which did not exist at the
 * end of Sprint 2 (every request 404'd). The endpoint reuses the SAME read-only projection
 * as the Agent-self route GET /api/v1/agents/me/transactions
 * (AgentTransactionHistoryService.listUnified, V1-AGENT-HISTORY-01): identical item schema,
 * merge ordering, pagination shape and canonical-type filter. Nothing is synthesized and no
 * accounting event is double-counted — the six-service transaction architecture is untouched.
 * Authorization: requireWorkforce + requireFunction('agent.view') in the controller, with the
 * RoutePolicyRegistry declaring the same gate (WORKFORCE_SESSION, OPERATOR/SERVICE/PRIVILEGED,
 * resource 'agent-transaction-history') for defense in depth.
 *
 * V1-SPRINT3-GUARD-01 (P2): RuntimeAccessGuard's WORKFORCE_SESSION branch now enforces ONLY
 * the catalogue gates a route policy explicitly DECLARES (requiredFunctions/requiredRoles/
 * requiredScopes) — never the bare allowedPrincipalTypes list whose blanket enforcement
 * caused the 401→403 status drift trialled and rejected in V1-HARDEN-01 Part D. The Sprint 3
 * mapping (docs/ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md) shows every
 * declared-gate branch is backed by an equal-or-stricter controller gate today, so the check
 * is pure defense-in-depth with zero status drift. These tests pin (a) guard-level precedence
 * (declared requiredRoles denies BEFORE the controller's custom message, same 403), (b) every
 * legitimate declared-gate flow still passes, (c) the read-only principal method gate still
 * fires ahead of it, and (d) the canonical denial message/status match requireFunction's.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltPhrase: string): string {
  const salt = Buffer.from(saltPhrase);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1 Sprint 3 — unified agent history API + workforce declared-gate enforcement (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let ledgerService: LedgerService;
  let walletService: WalletService;

  let agentId: string;
  let agentToken: string;
  let c2cTransferId: string;
  let systemLedgerAccountId: string;

  const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
  const password = `pw-${randomUUID().slice(0, 8)}`;

  const workforceConfig = {
    enabled: true,
    environment: 'test',
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 3600,
    mfaFreshnessSeconds: 300,
    oidcJwksCacheSeconds: 900,
    oidcJwksMaxStalenessSeconds: 3600,
    bootstrapEnabled: false,
    bootstrapIssuer: '',
    bootstrapAudience: '',
    bootstrapKeys: [],
    bootstrapFinanceAdminScopes: [],
    recoveryEnabled: false,
    recoveryAudience: '',
    recoveryKeys: [],
    roles: [],
    makerCheckerRules: [],
    rateLimits: [
      { category: 'privileged-approval', capacity: 100, refillRatePerSecond: 100, enabled: true },
    ],
    trustedProxyAddresses: [],
  } as unknown as A2WorkforceConfigurationV1;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1s3hist');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = moduleRef.get(A2WorkforceSessionService);
    ledgerService = moduleRef.get(LedgerService);
    walletService = moduleRef.get(WalletService);

    // ——— One ACTIVE Agent with real records across all six canonical history types. ———
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
       VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-${randomUUID().slice(0, 8)}`,
        `S3H-${randomUUID().slice(0, 6)}`,
        'Sprint 3 History Class',
        JSON.stringify(['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-${randomUUID()}`, classRows[0]!.id],
    );
    agentId = agentRows[0]!.id;
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, encodePbkdf2(password, `s3h-salt-${agentId.slice(0, 8)}`)],
    );

    const sys = await ledgerService.createAccount({
      code: `S3H-SYS-NGN-${randomUUID().slice(0, 6)}`,
      name: 'Sprint 3 History System Float NGN',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    systemLedgerAccountId = sys.id;
    const wallet = await walletService.createWallet({
      customerId: agentId,
      currency: 'NGN',
      idempotencyKey: `s3h-wallet-${randomUUID()}`,
    });
    const walletLedgerAccountId: string = wallet.ledgerAccountId;

    // The SAME authoritative records the Agent-self projection reads — journals carry the
    // canonicalService/direction metadata the real services write; nothing is synthesized.
    // Funding credit is posted first so the wallet balance never goes negative.
    const post = (
      direction: LedgerEntryDirection,
      amountMinor: number,
      metadata: Record<string, unknown>,
      reference: string,
      description: string,
    ) =>
      ledgerService.postJournal({
        idempotencyKey: `s3h-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference,
        description,
        metadata,
        lines: [
          { accountId: walletLedgerAccountId, direction, amountMinor },
          {
            accountId: systemLedgerAccountId,
            direction:
              direction === LedgerEntryDirection.DEBIT
                ? LedgerEntryDirection.CREDIT
                : LedgerEntryDirection.DEBIT,
            amountMinor,
          },
        ],
      });

    await post(LedgerEntryDirection.CREDIT, 250_000, { direction: 'FUND', agentId }, 'S3-FUND', 'Sprint 3 agent funding');
    await post(LedgerEntryDirection.DEBIT, 10_000, { canonicalService: 'CASH_IN' }, 'S3-CASHIN', 'Sprint 3 cash-in');
    await post(LedgerEntryDirection.CREDIT, 4_000, { canonicalService: 'CASH_OUT' }, 'S3-CASHOUT', 'Sprint 3 cash-out');
    await post(LedgerEntryDirection.DEBIT, 50_000, { direction: 'DEFUND', agentId }, 'S3-DEFUND', 'Sprint 3 agent defunding');

    // CASH_TO_CASH: a real initiated (UNCLAIMED) transfer row bound to a posted journal.
    const startJournal = await post(
      LedgerEntryDirection.DEBIT,
      8_000,
      { canonicalService: 'CASH_TO_CASH' },
      'S3-C2C-START',
      'Sprint 3 cash-to-cash start',
    );
    c2cTransferId = randomUUID();
    await dataSource.query(
      `INSERT INTO cash_to_cash_transfers
         (id, agent_id, beneficiary_phone, principal_minor, fee_minor, vat_minor, total_minor, currency,
          status, transfer_code_hash, hash_algorithm, transfer_code_version, failed_attempts, is_locked,
          journal_id, reference, idempotency_key, expires_at)
       VALUES ($1,$2,'8039876543',8000,0,0,8000,'NGN','UNCLAIMED','S3_TEST_HASH_NOT_FOR_RESPONSE','PBKDF2',1,0,false,
          $3,'S3-C2C-REF',$4, clock_timestamp() + INTERVAL '1 day')`,
      [c2cTransferId, agentId, startJournal.id, `s3h-c2c-${randomUUID()}`],
    );

    // CASH_TO_CASH_CLAIM: the settled claim audit projection (journal-settled, AGENT_CASH).
    const claimJournal = await post(
      LedgerEntryDirection.CREDIT,
      8_000,
      { canonicalService: 'CASH_TO_CASH_CLAIM' },
      'S3-C2C-CLAIM',
      'Sprint 3 cash-to-cash claim settlement',
    );
    await dataSource.query(
      `INSERT INTO audit_events (id, entity_type, entity_id, action, actor, new_values, occurred_at, created_at)
       VALUES ($1,'AGENT_CASH_TO_CASH_CLAIM',$2,'CASH_TO_CASH_CLAIMED',$3,
          '{"principalMinor":8000,"currency":"NGN","redemptionMethod":"AGENT_CASH","beneficiaryPhone":"8039876543"}'::jsonb,
          NOW(),NOW())`,
      [randomUUID(), claimJournal.id, agentId],
    );

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/sessions',
      payload: { agentId, password },
    });
    expect(login.statusCode).toBe(200);
    agentToken = (login.json() as { accessToken: string }).accessToken;
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60_000);

  async function workforceToken(roleKey: string): Promise<string> {
    const id = `s3h:${randomUUID()}`;
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: randomUUID(),
      assignmentVersion: 1,
      principalId: id,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60000),
      effectiveTo: new Date(now.getTime() + 3600000),
      assignedBy: 'test',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    });
    const session = await sessions.establish({
      issuer: 'https://s3h.test',
      subject: id,
      principalId: id,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'test',
    });
    return session.accessToken;
  }

  describe('GET /api/v1/internal/agents/:id/transactions (V1-SPRINT3-AGENT-HISTORY-API-01)', () => {
    it('returns the unified projection across all six canonical types for an agent.view holder', async () => {
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions`,
        headers: headers(token),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.pagination).toEqual({ page: 1, limit: 20, total: 6, totalPages: 1, hasNextPage: false });
      expect(body.items.map((i: any) => i.type).sort()).toEqual(
        ['AGENT_DEFUNDING', 'AGENT_FUNDING', 'CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'CASH_TO_CASH_CLAIM'].sort(),
      );

      const cashIn = body.items.find((i: any) => i.type === 'CASH_IN');
      expect(cashIn).toMatchObject({
        status: 'COMPLETED',
        amountMinor: '10000',
        currency: 'NGN',
        direction: 'DEBIT',
        reference: 'S3-CASHIN',
        narration: 'Sprint 3 cash-in',
        feeMinor: '0',
        commission: null,
        failureCode: null,
        failureMessage: null,
      });
      expect(cashIn.counterparty).toEqual({ type: 'CUSTOMER' });
      expect(cashIn.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(cashIn.createdAt).toBeTruthy();
      expect(cashIn.completedAt).toBeTruthy();

      const funding = body.items.find((i: any) => i.type === 'AGENT_FUNDING');
      expect(funding).toMatchObject({ amountMinor: '250000', direction: 'CREDIT', reference: 'S3-FUND', status: 'COMPLETED' });
      expect(funding.counterparty).toEqual({ type: 'WORKFORCE' });
      const defunding = body.items.find((i: any) => i.type === 'AGENT_DEFUNDING');
      expect(defunding).toMatchObject({ amountMinor: '50000', direction: 'DEBIT', reference: 'S3-DEFUND' });

      const c2c = body.items.find((i: any) => i.type === 'CASH_TO_CASH');
      expect(c2c).toMatchObject({
        id: c2cTransferId,
        amountMinor: '8000',
        currency: 'NGN',
        status: 'UNCLAIMED',
        direction: 'DEBIT',
        reference: 'S3-C2C-REF',
        narration: null,
        feeMinor: '0',
        completedAt: null,
      });
      expect(c2c.counterparty).toEqual({ type: 'CUSTOMER', beneficiaryPhone: '8039876543' });

      const claim = body.items.find((i: any) => i.type === 'CASH_TO_CASH_CLAIM');
      expect(claim).toMatchObject({
        amountMinor: '8000',
        currency: 'NGN',
        status: 'COMPLETED',
        direction: 'CREDIT',
        reference: 'S3-C2C-CLAIM',
        narration: 'Cash→Cash cash payout',
      });
      expect(claim.counterparty).toEqual({ type: 'CUSTOMER', beneficiaryPhone: '8039876543' });
    });

    it('is consistent with the Agent SELF projection (same service, same item IDs)', async () => {
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      const workforceRes = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions?limit=100`,
        headers: headers(token),
      });
      const selfRes = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/me/transactions?limit=100',
        headers: headers(agentToken),
      });
      expect(workforceRes.statusCode).toBe(200);
      expect(selfRes.statusCode).toBe(200);
      const workforceIds = (workforceRes.json() as any).items.map((i: any) => i.id).sort();
      const selfIds = (selfRes.json() as any).items.map((i: any) => i.id).sort();
      expect(workforceIds).toEqual(selfIds);
      expect(workforceIds).toHaveLength(6);
    });

    it('filters by canonical type server-side and rejects unknown types with 400', async () => {
      const token = await workforceToken('FINANCE_AUDITOR');
      for (const [type, reference] of [
        ['CASH_TO_CASH', 'S3-C2C-REF'],
        ['AGENT_FUNDING', 'S3-FUND'],
        ['CASH_TO_CASH_CLAIM', 'S3-C2C-CLAIM'],
      ] as const) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/internal/agents/${agentId}/transactions?type=${type}`,
          headers: headers(token),
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as any;
        expect(body.pagination.total).toBe(1);
        expect(body.items).toHaveLength(1);
        expect(body.items[0].type).toBe(type);
        expect(body.items[0].reference).toBe(reference);
      }
      const invalid = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions?type=WIRE_TRANSFER`,
        headers: headers(token),
      });
      expect(invalid.statusCode).toBe(400);
      expect((invalid.json() as any).message).toMatch(/type must be one of/);
    });

    it('paginates server-side without duplicates or loss', async () => {
      const token = await workforceToken('FINANCE_AUDITOR');
      const pages: any[] = [];
      for (const page of [1, 2, 3, 4]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/internal/agents/${agentId}/transactions?page=${page}&limit=2`,
          headers: headers(token),
        });
        expect(res.statusCode).toBe(200);
        pages.push(res.json());
      }
      expect(pages[0].pagination).toEqual({ page: 1, limit: 2, total: 6, totalPages: 3, hasNextPage: true });
      expect(pages[1].pagination.hasNextPage).toBe(true);
      expect(pages[2].pagination).toMatchObject({ page: 3, hasNextPage: false });
      expect(pages[3].items).toHaveLength(0);
      const allIds = [...pages[0].items, ...pages[1].items, ...pages[2].items].map((i: any) => i.id);
      expect(new Set(allIds).size).toBe(6);
      // Global deterministic ordering: created_at DESC (stable across pages).
      const times = [...pages[0].items, ...pages[1].items, ...pages[2].items].map(
        (i: any) => new Date(i.createdAt).getTime(),
      );
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('enforces the agent.view workforce matrix (catalogue holders 200, others 403)', async () => {
      for (const role of ['AGENT_NETWORK_MANAGER', 'FINANCE_AUDITOR', 'ADMINISTRATOR', 'SUPER_ADMIN']) {
        const token = await workforceToken(role);
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/internal/agents/${agentId}/transactions`,
          headers: headers(token),
        });
        expect([role, res.statusCode]).toEqual([role, 200]);
      }
      for (const role of ['OPERATIONS', 'FINANCE_CONTROLLER', 'TREASURY']) {
        const token = await workforceToken(role);
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/internal/agents/${agentId}/transactions`,
          headers: headers(token),
        });
        expect([role, res.statusCode]).toEqual([role, 403]);
        // Canonical requireFunction-equivalent denial (guard-declared gate fires first).
        expect((res.json() as any).message).toBe('Authorization denied: FUNCTION_MISSING');
      }
    });

    it('denies Agent sessions with 403 and rejects unauthenticated/garbage callers with 401', async () => {
      const agentRes = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions`,
        headers: headers(agentToken),
      });
      expect(agentRes.statusCode).toBe(403);
      const anon = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions`,
      });
      expect(anon.statusCode).toBe(401);
      const garbage = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions`,
        headers: { Authorization: 'Bearer not-a-real-token' },
      });
      expect(garbage.statusCode).toBe(401);
    });

    it('returns 404 for an unknown Agent UUID and 400 for a malformed :id', async () => {
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      const unknown = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${randomUUID()}/transactions`,
        headers: headers(token),
      });
      expect(unknown.statusCode).toBe(404);
      expect((unknown.json() as any).message).toBe('Agent not found');
      const malformed = await app.inject({
        method: 'GET',
        url: '/api/v1/internal/agents/not-a-uuid/transactions',
        headers: headers(token),
      });
      expect(malformed.statusCode).toBe(400);
      expect((malformed.json() as any).message).toBe('id must be a UUID');
    });
  });

  describe('V1-SPRINT3-GUARD-01: declared-gate enforcement is defense-in-depth, not drift', () => {
    it('denies a declared requiredRoles gate IN THE GUARD, before the controller message', async () => {
      // AGENT_NETWORK_MANAGER holds agent.fund+agent.defund (INITIATE) but is NOT a
      // FINANCE_CONTROLLER: the execute route declares requiredRoles ['FINANCE_CONTROLLER'] +
      // requiredFunctions ['agent.fund','agent.defund'], so the guard denies with the
      // canonical ROLE_MISSING message BEFORE the controller's custom 'A non-SUPER_ADMIN
      // FINANCE_CONTROLLER with MFA is required...' message can fire. Status stays 403 —
      // identical to Sprint 2 behavior — proving guard-level precedence without drift.
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/internal/agents/funding-requests/${randomUUID()}/execute`,
        headers: { ...headers(token), 'content-type': 'application/json' },
        payload: { reason: 'guard precedence probe' },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as any).message).toBe('Authorization denied: ROLE_MISSING');
    });

    it('keeps every legitimate declared-gate flow working', async () => {
      const anmToken = await workforceToken('AGENT_NETWORK_MANAGER');
      // Maker funding request: declared requiredFunctions ['agent.fund'] — ANM holds it
      // (INITIATE) and passes the controller's own requireFunction + MFA maker checks.
      const maker = await app.inject({
        method: 'POST',
        url: `/api/v1/internal/agents/${agentId}/fund-request`,
        headers: { ...headers(anmToken), 'content-type': 'application/json' },
        payload: {
          amountMinor: '25000',
          currency: 'NGN',
          reason: 'Sprint 3 guard-drift probe',
          idempotencyKey: `s3h-fundreq-${randomUUID()}`,
        },
      });
      expect(maker.statusCode).toBe(201);

      // Checker inbox: declared FINANCE_CONTROLLER + agent.fund + agent.defund — FC holds all.
      const fcToken = await workforceToken('FINANCE_CONTROLLER');
      const inbox = await app.inject({
        method: 'GET',
        url: '/api/v1/internal/agents/funding-requests?status=PENDING',
        headers: headers(fcToken),
      });
      expect(inbox.statusCode).toBe(200);

      // Classes mutation: declared agent.manage_classes for non-GET — ANM holds it (EXECUTE).
      const createClass = await app.inject({
        method: 'POST',
        url: '/api/v1/internal/agents/classes',
        headers: { ...headers(anmToken), 'content-type': 'application/json' },
        payload: {
          name: `S3 Guard Class ${randomUUID().slice(0, 8)}`,
          code: `S3GC${randomUUID().slice(0, 6)}`,
          isActive: true,
        },
      });
      expect(createClass.statusCode).toBe(201);

      // SUPER_ADMIN keeps its explicitly approved behavior on agent.view reads.
      const saToken = await workforceToken('SUPER_ADMIN');
      const saRead = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/transactions`,
        headers: headers(saToken),
      });
      expect(saRead.statusCode).toBe(200);
    });

    it('keeps declared-function denials canonical (outlet mutation without manage_outlets_terminals)', async () => {
      // OPERATIONS holds aggregator.manage but NOT agent.manage_outlets_terminals: the
      // declared gate denies in the guard with the SAME 403 status and message the
      // controller's requireManage produced before this change (zero observable drift).
      const token = await workforceToken('OPERATIONS');
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/internal/agents/${agentId}/outlets`,
        headers: { ...headers(token), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as any).message).toBe('Authorization denied: FUNCTION_MISSING');
    });

    it('keeps the read-only principal method gate ahead of the declared-function gate', async () => {
      // FINANCE_AUDITOR is a catalogue read-only principal: the method gate (Part C,
      // unchanged) must still deny non-safe methods with its documented message — proving
      // the new declared-gate check is appended AFTER existing gates, not replacing them.
      const token = await workforceToken('FINANCE_AUDITOR');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/internal/agents/classes',
        headers: { ...headers(token), 'content-type': 'application/json' },
        payload: { name: `S3 Denied ${randomUUID().slice(0, 8)}` },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as any).message).toBe('Read-only principal may not perform this operation');
    });

    it('V1-SPRINT3-SEC-SWEEP-01: gates Agent-scoped limit-assignment reads with limit.view and non-Agent writes with limit.modify', async () => {
      // Before this fix, every limit-assignment GET passed with the bare requireWorkforce
      // type check — TREASURY (reconciliation.view only) and OPERATIONS (no limit.*
      // function) could read Agent-scoped limit assignments via
      // GET /internal/limit-assignments/agent/:id, and any OPERATOR-typed role could
      // create/patch non-Agent assignments. The sibling LimitCatalogController already
      // gates the SAME domain with limit.view/limit.modify; this mirrors it.
      for (const role of ['OPERATIONS', 'TREASURY']) {
        const token = await workforceToken(role);
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/internal/limit-assignments/agent/${agentId}`,
          headers: headers(token),
        });
        expect([role, res.statusCode, (res.json() as any).message]).toEqual([
          role,
          403,
          'Authorization denied: FUNCTION_MISSING',
        ]);
        const listRes = await app.inject({
          method: 'GET',
          url: '/api/v1/internal/limit-assignments',
          headers: headers(token),
        });
        expect([role, listRes.statusCode]).toEqual([role, 403]);
      }
      // Catalogue limit.view holders keep (now function-gated) access.
      for (const role of ['FINANCE_AUDITOR', 'AGENT_NETWORK_MANAGER', 'FINANCE_CONTROLLER']) {
        const token = await workforceToken(role);
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/internal/limit-assignments/agent/${agentId}`,
          headers: headers(token),
        });
        expect([role, res.statusCode]).toEqual([role, 200]);
        expect((res.json() as any).total).toBe(0);
      }
      // Non-Agent write without limit.modify: canonical FUNCTION_MISSING 403 (payload is
      // DTO-valid so the gate — not validation — produces the denial).
      const opToken = await workforceToken('OPERATIONS');
      const deniedCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/internal/limit-assignments',
        headers: { ...headers(opToken), 'content-type': 'application/json' },
        payload: { limitProfileCode: 'S3_P3_PROF', subjectType: 'GLOBAL' },
      });
      expect(deniedCreate.statusCode).toBe(403);
      expect((deniedCreate.json() as any).message).toBe('Authorization denied: FUNCTION_MISSING');
      // limit.modify holder passes the gate (the unknown profile code then fails in the
      // service with 400/404 — proving gate passage without mutating any data).
      const fcToken = await workforceToken('FINANCE_CONTROLLER');
      const passedGate = await app.inject({
        method: 'POST',
        url: '/api/v1/internal/limit-assignments',
        headers: { ...headers(fcToken), 'content-type': 'application/json' },
        payload: { limitProfileCode: 'S3_P3_PROF', subjectType: 'GLOBAL' },
      });
      expect([400, 404]).toContain(passedGate.statusCode);
      // COMPLIANCE (no limit.* function in the catalogue) is denied the same canonical way.
      const complianceToken = await workforceToken('COMPLIANCE');
      const complianceRes = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/limit-assignments/agent/${agentId}`,
        headers: headers(complianceToken),
      });
      expect(complianceRes.statusCode).toBe(403);
      expect((complianceRes.json() as any).message).toBe('Authorization denied: FUNCTION_MISSING');
    });

    it('keeps the Sprint 2 receiving-number gate passing for agent.view holders (no regression)', async () => {
      const token = await workforceToken('FINANCE_AUDITOR');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/internal/agents/${agentId}/receiving-number`,
        headers: headers(token),
      });
      // The fixture Agent has no receiving number: the declared agent.view gate passes
      // (no 403) and the controller's explicit NONE view surfaces — exactly Sprint 2 behavior.
      expect(res.statusCode).toBe(200);
      expect((res.json() as any).receivingNumber).toBeNull();
      expect((res.json() as any).status).toBe('NONE');
    });
  });
});
