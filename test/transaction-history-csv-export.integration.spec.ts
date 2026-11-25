/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/operations/audit.service';
import { MAX_EXPORT_ROWS } from '../src/admin/transaction-history-export.service';
import { CSV_COLUMNS } from '../src/admin/transaction-history-csv';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

/**
 * CSV export acceptance, against the real thing.
 *
 * Fully migrated disposable PostgreSQL, real AppModule, real local workforce credentials and the
 * real workforce session guard — no synthetic principal adapter and no stubbed audit sink. The
 * only thing this file fabricates is the business fixture it exports (inbound payments, one of
 * them belonging to a second institution), because there is no supported product API that creates
 * settled transactions in bulk.
 *
 * The point of every assertion is one of:
 *  - the file contains exactly the rows the screen shows, once each, across many UI pages;
 *  - the same filters and Lagos boundaries govern both;
 *  - a foreign institution can never appear, and an unauthorized caller is refused server-side;
 *  - escaping, formula protection, empty results and the size limit behave under real HTTP.
 */

const seed = require('../scripts/local-dev-seed-11-roles.js') as {
  ROLES: string[];
  emailFor(role: string): string;
  passwordFor(role: string): string;
  principalFor(email: string, config: any): string;
  seedLocalRoles(ds: DataSource, config: any, audit: AuditService): Promise<any[]>;
};
const loginPath = '/api/v1/internal/a2/workforce/local-admin-sessions';
const base = '/api/v1/internal/admin/transaction-history';

/** Minimal RFC 4180 parser: enough to prove the server wrote well-formed CSV. */
/** `noUncheckedIndexedAccess` is on; the assertions below want the parsed cell, not `| undefined`. */
function cell(row: string[] | undefined, index: number): string {
  return row?.[index] ?? '';
}

function parseCsv(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe('Transaction history CSV export (real migrations, PostgreSQL, workforce sessions)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let audit: AuditService;
  const old = { ...process.env };

  /** Sessions for the roles this suite needs. */
  let ops: any;
  let auditor: any;
  let own = '';
  let foreign = '';

  const login = async (role: string) =>
    (
      await request(app.getHttpServer())
        .post(loginPath)
        .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
        .expect(201)
    ).body;

  const exportCsv = (query: string, session: any) =>
    request(app.getHttpServer())
      .get(`${base}/export.csv${query}`)
      .set('Authorization', `Bearer ${session.accessToken}`);

  const listAllPages = async (query: Record<string, string>, session: any) => {
    const seen: any[] = [];
    let cursor = '';
    for (;;) {
      const params = new URLSearchParams({ ...query, limit: '20', cursor });
      const page = await request(app.getHttpServer())
        .get(`${base}?${params}`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      seen.push(...page.body.items);
      if (!page.body.nextCursor) return seen;
      cursor = page.body.nextCursor;
    }
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    ds = await createIntegrationDataSourceFromScratch('csvexport');
    if (ds.options.type !== 'postgres') throw new Error('Expected PostgreSQL');
    const options = ds.options;
    const cli = spawnSync(process.execPath, ['scripts/local-dev-seed-11-roles.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_HOST: String(options.host),
        DB_PORT: String(options.port),
        DB_NAME: String(options.database),
        DB_USER: String(options.username),
        DB_PASSWORD: String(options.password),
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    expect({ status: cli.status, stderr: cli.stderr, stdout: cli.stdout.slice(-2000) }).toEqual({
      status: 0,
      stderr: '',
      stdout: expect.any(String),
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(ds)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    audit = mod.get(AuditService);
  }, 240_000);

  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
    process.env = old;
  }, 60_000);

  it('exports every matching row exactly once, with the same filters and Lagos boundaries as the list', async () => {
    ops = await login('OPERATIONS');
    auditor = await login('FINANCE_AUDITOR');

    const institution = async () =>
      (
        await ds.query(
          `INSERT INTO financial_institutions(reference,code,legal_name,institution_type,created_by) VALUES($1,$2,'CSV export synthetic institution','PARTNER','test') RETURNING id`,
          [randomUUID(), `CSV_${randomUUID().slice(0, 8).toUpperCase()}`],
        )
      )[0].id;
    own = await institution();
    foreign = await institution();
    await ds.query(
      `INSERT INTO workforce_institution_assignments(principal_id,institution_id,status,granted_by) VALUES($1,$2,'ACTIVE','test')`,
      [ops.principal.principalId, own],
    );

    /*
     * 47 visible rows for OPERATIONS across five UI pages at the list's default size of 20, plus
     * rows that must never reach the file: 9 in the other institution, and 2 own-institution rows
     * just outside the requested Lagos day (one microsecond before midnight, one exactly at the
     * next midnight). Shared timestamps exercise the microsecond keyset.
     */
    await ds.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,currency,
          gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
       SELECT $1::uuid,'MONNIFY','sandbox','CSV-OWN-' || lpad(n::text,2,'0'),'NGN',10000,100,9900,
              CASE WHEN n % 4 = 0 THEN 'UNVERIFIED' ELSE 'VERIFIED' END,
              '2026-11-24T12:00:00Z'::timestamptz - (n % 11) * interval '1 second'
         FROM generate_series(1,47) n`,
      [own],
    );
    await ds.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,currency,
          gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
       SELECT $1::uuid,'MONNIFY','sandbox','CSV-FOREIGN-' || lpad(n::text,2,'0'),'NGN',20000,200,19800,'VERIFIED',
              '2026-11-24T12:00:00Z'::timestamptz
         FROM generate_series(1,9) n`,
      [foreign],
    );
    // Lagos day boundaries: 2026-11-24 starts 2026-11-23T23:00:00Z and ends 2026-11-24T23:00:00Z.
    await ds.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,currency,
          gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
       VALUES ($1::uuid,'MONNIFY','sandbox','CSV-BEFORE-MIDNIGHT','NGN',100,1,99,'VERIFIED','2026-11-23T22:59:59.999999Z'),
              ($1::uuid,'MONNIFY','sandbox','CSV-AT-NEXT-MIDNIGHT','NGN',100,1,99,'VERIFIED','2026-11-24T23:00:00Z')`,
      [own],
    );

    const filters = { from: '2026-11-24', to: '2026-11-24', type: 'BANK_TO_WALLET' };
    const onScreen = await listAllPages(filters, ops);
    // Five pages of the UI's own page size — the export must not stop at one.
    expect(onScreen).toHaveLength(47);

    const response = await exportCsv(
      `?from=${filters.from}&to=${filters.to}&type=${filters.type}`,
      ops,
    ).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['x-export-rows']).toBe('47');
    expect(response.headers['x-export-id']).toMatch(/^[0-9a-f-]{36}$/);

    const table = parseCsv(response.text);
    expect(table[0]).toEqual([...CSV_COLUMNS]);
    const rows = table.slice(1);
    expect(rows).toHaveLength(47);
    // Every row once: the reference column is unique in the fixture, and the id column proves it.
    const references = rows.map((r) => cell(r, 0));
    expect(new Set(references).size).toBe(47);
    expect(new Set(rows.map((r) => cell(r, 10))).size).toBe(47);
    // Same rows as the paginated list, not merely the same count.
    expect([...references].sort()).toEqual([...onScreen.map((r) => r.reference)].sort());
    // Foreign institution and out-of-range rows are absent.
    expect(references.some((r) => (r ?? '').startsWith('CSV-FOREIGN'))).toBe(false);
    expect(references).not.toContain('CSV-BEFORE-MIDNIGHT');
    expect(references).not.toContain('CSV-AT-NEXT-MIDNIGHT');
    // Lagos wall clock, not UTC and not server-local.
    for (const row of rows) expect(cell(row, 4)).toMatch(/^2026-11-24 1[23]:/);
    // 9900 minor units on a 10000 gross with a 100 provider fee.
    expect(cell(rows[0], 6)).toBe('99.00');
    expect(cell(rows[0], 7)).toBe('NGN');
    // BANK_TO_WALLET in this projection records a provider fee, so it is a recorded value.
    expect(new Set(rows.map((r) => cell(r, 9)))).toEqual(new Set(['true']));

    // Provenance: the audit trail names the actor and the exact filters that produced this file.
    const [, exportId] = [null, response.headers['x-export-id'] as string];
    const auditRow = await ds.query(
      `SELECT actor,entity_type,action,new_values FROM audit_events WHERE entity_type='TRANSACTION_HISTORY_EXPORT' AND entity_id=$1`,
      [exportId],
    );
    expect(auditRow).toHaveLength(1);
    expect(auditRow[0].actor).toBe(ops.principal.principalId);
    expect(auditRow[0].action).toBe('TRANSACTION_HISTORY_CSV_EXPORTED');
    expect(auditRow[0].new_values).toMatchObject({
      outcome: 'SUCCEEDED',
      rowCount: 47,
      format: 'CSV',
      filters: { from: '2026-11-24', to: '2026-11-24', type: 'BANK_TO_WALLET' },
    });

    // The platform auditor sees both institutions, so the same filters produce a different file.
    const auditorFile = parseCsv(
      (await exportCsv(`?from=2026-11-24&to=2026-11-24&type=BANK_TO_WALLET`, auditor).expect(200))
        .text,
    );
    expect(auditorFile.slice(1)).toHaveLength(56);
    expect(
      auditorFile
        .slice(1)
        .map((r) => r[0])
        .some((r) => (r ?? '').startsWith('CSV-FOREIGN')),
    ).toBe(true);
  }, 240_000);

  it('denies the export server-side to unauthorized callers', async () => {
    const treasury = await login('TREASURY');
    const denied = await exportCsv('?type=BANK_TO_WALLET', treasury);
    expect(denied.status).toBe(403);
    expect(denied.text).not.toContain('transaction_reference');
    // A caller the guard refuses before the handler runs leaves no export record behind: the only
    // rows for this principal are the successful exports above, and none names the Treasury user.
    const refusedActors = await ds.query(
      `SELECT actor FROM audit_events WHERE entity_type='TRANSACTION_HISTORY_EXPORT' AND actor=$1`,
      [treasury.principal.principalId],
    );
    expect(refusedActors).toEqual([]);

    await request(app.getHttpServer()).get(`${base}/export.csv`).expect(401);

    // A caller must not be able to ask for a partial file that looks whole.
    for (const paging of ['limit=5', 'cursor=abc']) {
      const rejected = await exportCsv(`?${paging}`, ops);
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.body)).toContain('Export applies its own paging');
    }

    // Malformed filters are rejected by the same validation the list uses.
    for (const bad of ['?from=2026-02-30', '?type=DEPOSIT', '?from=2026-11-25&to=2026-11-24']) {
      expect((await exportCsv(bad, ops)).status).toBe(400);
    }
  }, 120_000);

  it('refuses to export another institution’s rows even with an exact reference', async () => {
    const page = await request(app.getHttpServer())
      .get(`${base}/export.csv?reference=CSV-FOREIGN-01`)
      .set('Authorization', `Bearer ${ops.accessToken}`)
      .expect(200);
    const table = parseCsv(page.text);
    // Header only: the reference is real, but the row is out of the operator's scope.
    expect(table).toHaveLength(1);
    expect(page.headers['x-export-rows']).toBe('0');
    expect(page.text).not.toContain('CSV-FOREIGN-01');
  }, 60_000);

  it('escapes hostile references and neutralises formulas in a real export', async () => {
    /*
     * Customer Funding is the one product whose history reference is genuine operator free text
     * chosen by whoever raised the request — exactly the path a hostile reference travels. The
     * ledger's own balance triggers are real here, so the fixture uses pending requests with no
     * journal rather than fabricating an unbalanced journal.
     */
    const customer = (
      await ds.query(
        `INSERT INTO customers(reference,customer_type,status,kyc_level,kyc_status) VALUES($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
        [`csv-cust-${randomUUID()}`],
      )
    )[0].id;
    const hostile = [
      '=HYPERLINK("http://evil.invalid","x")',
      '+2348000000000',
      '-1+1',
      '@SUM(A1:A9)',
      'COMMA,AND"QUOTE',
      'LINE\nBREAK',
    ];
    for (const [index, reference] of hostile.entries()) {
      await ds.query(
        `INSERT INTO customer_funding_requests
           (id,customer_id,amount_minor,currency,status,reference,idempotency_key,request_hash,
            maker_id,maker_type,created_at,updated_at)
         VALUES ($1::uuid,$2::uuid,100,'NGN','PENDING',$3,$4,$5,'csv-maker','OPERATOR',$6::timestamptz,$6::timestamptz)`,
        [
          randomUUID(),
          customer,
          reference,
          `csv-hostile-${index}-${randomUUID()}`,
          'b'.repeat(64),
          `2026-11-20T09:0${index}:00Z`,
        ],
      );
    }
    /*
     * Platform-scoped requests (no captured custody evidence) are visible to the platform auditor
     * but withheld from institution staff, so the auditor is the reader that can see this fixture.
     */
    const response = await exportCsv(
      '?from=2026-11-20&to=2026-11-20&type=CUSTOMER_FUNDING',
      auditor,
    ).expect(200);
    const table = parseCsv(response.text);
    const rows = table.slice(1);
    expect(rows).toHaveLength(hostile.length);
    const references = rows.map((r) => cell(r, 0));
    /*
     * Two distinct properties, asserted separately because they are two different defences:
     *  - a leading `= + - @` (and tab/CR) is neutralised with an apostrophe;
     *  - a delimiter, quote or newline is quoted and preserved exactly.
     * Conflating them would let one silently stop working while the other passed.
     */
    const neutralised = references.filter((r) => /^[=+\-@\t\r]/.test((r ?? '').slice(1)));
    expect(neutralised).toEqual(
      expect.arrayContaining([
        '\'=HYPERLINK("http://evil.invalid","x")',
        "'+2348000000000",
        "'-1+1",
        "'@SUM(A1:A9)",
      ]),
    );
    // Values that are not formula triggers are left exactly as the operator typed them.
    expect(references).toEqual(
      expect.arrayContaining(['COMMA,AND"QUOTE', 'LINE\nBREAK']),
    );
    // No exported cell still begins a formula.
    for (const reference of references) expect(reference).not.toMatch(/^[=+@]/);
    // The embedded comma/quote/newline did not create extra rows or columns.
    expect(table.every((row) => row.length === CSV_COLUMNS.length)).toBe(true);
    // No data line begins a formula.
    for (const line of response.text.replace(/^\uFEFF/, '').split('\r\n').slice(1))
      expect(line).not.toMatch(/^[=+@]/);
    // An institution-restricted reader does not see platform-scoped requests at all.
    expect((await exportCsv('?type=CUSTOMER_FUNDING', ops).expect(200)).text).not.toContain(
      'HYPERLINK',
    );
  }, 120_000);

  it('an empty result is a header-only file and is still recorded', async () => {
    const response = await exportCsv('?reference=CSV-DOES-NOT-EXIST', ops).expect(200);
    expect(parseCsv(response.text)).toEqual([[...CSV_COLUMNS]]);
    expect(response.headers['x-export-rows']).toBe('0');
    const row = await ds.query(
      `SELECT new_values FROM audit_events WHERE entity_type='TRANSACTION_HISTORY_EXPORT' AND entity_id=$1`,
      [response.headers['x-export-id']],
    );
    expect(row[0].new_values).toMatchObject({ outcome: 'SUCCEEDED', rowCount: 0 });
  }, 60_000);

  it('refuses an export above the supported size and explains how to narrow it', async () => {
    /*
     * The ceiling is a constructor option precisely so it can be lowered for a test (and tuned
     * from measured capacity in deployment). The real default is asserted separately below.
     */
    expect(MAX_EXPORT_ROWS).toBe(50_000);
    const { TransactionHistoryExportService } = require('../src/admin/transaction-history-export.service');
    const controller = app.get(require('../src/admin/transaction-history.controller').TransactionHistoryController);
    const lowCeiling = new TransactionHistoryExportService(ds, audit, { maxRows: 10 });
    // Reuse the real controller's own reader by calling the real endpoint's dependencies.
    const principal = {
      type: 'OPERATOR',
      principalId: ops.principal.principalId,
      roles: ops.principal.roles,
      scopes: ops.principal.scopes,
      customerAccess: 'NONE',
    };
    const reader = {
      list: (req: any, query: Record<string, string>) => controller.list(req, query),
    };
    const refused = await lowCeiling
      .export(reader, { authorizationPrincipal: principal as any }, { type: 'BANK_TO_WALLET' })
      .then(
        () => null,
        (error: any) => error,
      );
    expect(refused?.getStatus()).toBe(413);
    expect(refused.message).toMatch(/above the supported export size/);
    expect(refused.message).toMatch(/Narrow the date range/);
    expect(refused.message).toMatch(/No file was produced/);
    // The refusal is recorded, with the filters that caused it, and no partial file escapes.
    const refusal = await ds.query(
      `SELECT new_values FROM audit_events WHERE entity_type='TRANSACTION_HISTORY_EXPORT' AND new_values->>'outcome'='REFUSED_SIZE_LIMIT' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(refusal).toHaveLength(1);
    expect(refusal[0].new_values).toMatchObject({ rowCount: 0, filters: { type: 'BANK_TO_WALLET' } });
  }, 120_000);

  it('revocation removes the rows from the very next export', async () => {
    await ds.query(
      `UPDATE workforce_institution_assignments SET status='REVOKED',revoked_by='test',revoked_at=clock_timestamp() WHERE principal_id=$1`,
      [ops.principal.principalId],
    );
    // The same live session and the same URL: scope is re-evaluated per request, not cached.
    const response = await exportCsv('?type=BANK_TO_WALLET', ops).expect(200);
    expect(parseCsv(response.text)).toHaveLength(1);
    expect(response.headers['x-export-rows']).toBe('0');
    // Restore the same assignment (the table's own constraint requires revoked_at to clear).
    await ds.query(
      `UPDATE workforce_institution_assignments SET status='ACTIVE',revoked_by=NULL,revoked_at=NULL WHERE principal_id=$1`,
      [ops.principal.principalId],
    );
    const restored = await exportCsv('?type=BANK_TO_WALLET', ops).expect(200);
    expect(Number(restored.headers['x-export-rows'])).toBeGreaterThan(0);
  }, 120_000);
});
