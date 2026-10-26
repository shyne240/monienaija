import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { AuditService } from '../src/operations/audit.service';
import { AgentCashToCashOperationsController } from '../src/agent/agent-cash-to-cash-operations.controller';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

const PATH = '/api/v1/internal/admin/cash-to-cash/transfers';

type RequestWithPrincipal = {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
};

describe('V1 Admin Cash-to-Cash operations HTTP/PostgreSQL', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let agentId: string;
  let transferId: string;
  let requestHash: string;
  let authorizationRequireFunction: jest.SpyInstance;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('adminc2c');

    agentId = randomUUID();
    transferId = randomUUID();
    requestHash = randomBytes(32).toString('hex');
    const journalId = randomUUID();
    const debitAccountId = randomUUID();
    const creditAccountId = randomUUID();
    const reference = `C2C-HTTP-${randomUUID().slice(0, 8)}`;
    const amountMinor = '123456';

    await dataSource.query(
      `INSERT INTO agents (id, reference, status) VALUES ($1, $2, 'ACTIVE')`,
      [agentId, `AG-HTTP-${randomUUID().slice(0, 8)}`],
    );

    await dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO ledger_accounts
           (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
         VALUES
           ($1, $2, 'C2C HTTP test debit', 'ASSET', 'DEBIT', 'NGN', 'CUSTOMER_FUNDS', TRUE, TRUE),
           ($3, $4, 'C2C HTTP test credit', 'ASSET', 'CREDIT', 'NGN', 'CUSTOMER_FUNDS', TRUE, TRUE)`,
        [
          debitAccountId,
          `C2C-HTTP-DEBIT-${randomUUID()}`,
          creditAccountId,
          `C2C-HTTP-CREDIT-${randomUUID()}`,
        ],
      );
      await manager.query(
        `INSERT INTO ledger_journals
           (id, idempotency_key, request_hash, currency, accounting_unit, status, reference, description, metadata, total_minor)
         VALUES ($1, $2, $3, 'NGN', 'CUSTOMER_FUNDS', 'POSTED', $4, 'Admin C2C HTTP test seed', '{}'::jsonb, $5)`,
        [journalId, `c2c-http-journal-${randomUUID()}`, requestHash, reference, amountMinor],
      );
      await manager.query(
        `INSERT INTO ledger_lines
           (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit)
         VALUES
           ($1, $2, $3, 1, 'DEBIT', $5, 'NGN', 'CUSTOMER_FUNDS'),
           ($4, $2, $6, 2, 'CREDIT', $5, 'NGN', 'CUSTOMER_FUNDS')`,
        [randomUUID(), journalId, debitAccountId, randomUUID(), amountMinor, creditAccountId],
      );
      await manager.query(
        `INSERT INTO cash_to_cash_transfers
           (id, agent_id, beneficiary_phone, principal_minor, fee_minor, vat_minor, total_minor, currency,
            status, transfer_code_hash, hash_algorithm, journal_id, reference, idempotency_key, expires_at)
         VALUES ($1, $2, '7000000123', $3, 0, 0, $3, 'NGN', 'UNCLAIMED', 'TEST_HASH_NOT_FOR_RESPONSE',
                 'PBKDF2', $4, $5, $6, clock_timestamp() + INTERVAL '1 day')`,
        [transferId, agentId, amountMinor, journalId, reference, `c2c-http-transfer-${randomUUID()}`],
      );
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentCashToCashOperationsController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        {
          provide: AuditService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        AuthorizationService,
      ],
    }).compile();
    const authorizationService = moduleRef.get(AuthorizationService);
    authorizationRequireFunction = jest.spyOn(authorizationService, 'requireFunction');
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    const testPrincipalGuard: CanActivate = {
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest<RequestWithPrincipal>();
        const testAccess = req.headers['x-test-access'];
        req.authorizationPrincipal = {
          type: 'OPERATOR',
          principalId: 'test-operator-c2c',
          roles: [],
          scopes: testAccess === 'allow' ? ['transaction.view'] : [],
          customerAccess: 'NONE',
        };
        return true;
      },
    };
    app.useGlobalGuards(testPrincipalGuard);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  it('serves real filtered PostgreSQL transfer rows over the HTTP route with masked PII', async () => {
    const response = await request(app.getHttpServer())
      .get(PATH)
      .set('x-test-access', 'allow')
      .query({ page: '1', limit: '10', status: 'unclaimed', agentId, transferId })
      .expect(200);

    expect(authorizationRequireFunction).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['transaction.view'] }),
      'transaction.view',
      'agent-cash-to-cash-operations',
      ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
    );
    expect(response.body).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(response.body.data[0]).toMatchObject({
      id: transferId,
      agentId,
      beneficiaryPhoneMasked: '••••••0123',
      principalMinor: '123456',
      currency: 'NGN',
      status: 'UNCLAIMED',
      reference: expect.stringMatching(/^C2C-HTTP-/),
      redemptionMethod: null,
      claimJournalId: null,
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('7000000123');
    expect(serialized).not.toContain('TEST_HASH_NOT_FOR_RESPONSE');
    expect(serialized).not.toContain(requestHash);

    const filtered = await request(app.getHttpServer())
      .get(PATH)
      .set('x-test-access', 'allow')
      .query({ status: 'CLAIMED', transferId })
      .expect(200);
    expect(filtered.body).toMatchObject({ total: 0, data: [] });
  });

  it('rejects missing transaction.view over HTTP before querying the database', async () => {
    await request(app.getHttpServer()).get(PATH).set('x-test-access', 'deny').expect(403);
    expect(authorizationRequireFunction).toHaveBeenCalled();
  });

  it('validates malformed filters over HTTP', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('x-test-access', 'allow')
      .query({ status: 'PENDING' })
      .expect(400);
  });
});
