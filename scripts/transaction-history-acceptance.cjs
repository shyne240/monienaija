/* Synthetic-only disposable PostgreSQL acceptance. Never connects to the local app database.
 * Browser mode uses a test-only bearer adapter, NOT the production workforce session guard.
 * Real controller SQL and AuthorizationService run unchanged; only audit sink is stubbed.
 */
require('ts-node/register/transpile-only');
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const EmbeddedPostgres = require('embedded-postgres').default;
const { DataSource } = require('typeorm');
const {
  TransactionHistoryController,
  lagosBoundary,
} = require('../src/admin/transaction-history.controller');
const { AuthorizationService } = require('../src/authorization/authorization.service');
const out = 'docs/transaction-history/evidence';
fs.mkdirSync(out, { recursive: true });
const report = [];
const check = async (name, fn) => {
  await fn();
  report.push({ name, result: 'PASS' });
  console.log('PASS', name);
};
(async () => {
  const cluster = new EmbeddedPostgres({
    databaseDir: `/tmp/history-pg-${process.pid}`,
    port: 55439,
    user: 'history_test',
    password: randomUUID(),
    persistent: false,
    onLog: () => {},
    onError: console.error,
  });
  let db, server;
  try {
    await cluster.initialise();
    await cluster.start();
    const client = cluster.getPgClient();
    await client.connect();
    // Deliberately minimal schema, shaped from production entities: this tests read SQL, not migrations.
    await client.query(`CREATE TABLE wallet_accounts(id uuid primary key,institution_id uuid);
 CREATE TABLE transfers(id uuid primary key,source_wallet_id uuid,destination_wallet_id uuid,journal_id uuid,payment_reference text,reference text,status text,created_at timestamptz,completed_at timestamptz,amount_minor bigint,fee_minor bigint,vat_minor bigint,currency text,failure_code text,failure_message text);
 CREATE TABLE ledger_journals(id uuid primary key,institution_id uuid,metadata jsonb default '{}',status text,reference text,created_at timestamptz,posted_at timestamptz,currency text,reversal_of_journal_id uuid);
 CREATE TABLE cash_to_cash_transfers(id uuid primary key,agent_id uuid,reference text,status text,created_at timestamptz,claimed_at timestamptz,expired_at timestamptz,principal_minor bigint,fee_minor bigint,vat_minor bigint,total_minor bigint,currency text,journal_id uuid,claim_journal_id uuid,claimant_customer_id uuid,claim_reference text,beneficiary_phone text,expires_at timestamptz,updated_at timestamptz);
 CREATE TABLE audit_events(id uuid,entity_type text,action text,entity_id uuid,new_values jsonb,occurred_at timestamptz);
 CREATE TABLE workforce_institution_assignments(principal_id text,institution_id uuid,status text);`);
    const institution = randomUUID(),
      other = randomUUID(),
      wallet = randomUUID(),
      foreignWallet = randomUUID();
    await client.query('INSERT INTO wallet_accounts VALUES($1,$2),($3,$4)', [
      wallet,
      institution,
      foreignWallet,
      other,
    ]);
    await client.query(
      "INSERT INTO workforce_institution_assignments VALUES('restricted',$1,'ACTIVE')",
      [institution],
    );
    const ids = [];
    for (let i = 0; i < 44; i++) {
      const id = randomUUID();
      ids.push(id);
      await client.query(
        `INSERT INTO transfers(id,source_wallet_id,destination_wallet_id,reference,status,created_at,amount_minor,fee_minor,vat_minor,currency) VALUES($1,$2,$2,$3,'COMPLETED', $4,125000,50,0,'NGN')`,
        [
          id,
          i === 43 ? foreignWallet : wallet,
          `SYN-WALLET-${String(i).padStart(3, '0')}`,
          i < 40
            ? `2026-11-24T12:00:00.${String(i).padStart(6, '0')}Z`
            : [
                '2026-11-23T22:59:59.999999Z',
                '2026-11-23T23:00:00Z',
                '2026-11-24T23:00:00Z',
                '2026-11-24T10:00:00Z',
              ][i - 40],
        ],
      );
    }
    const cash = randomUUID(),
      journal = randomUUID(),
      claim = randomUUID();
    await client.query('INSERT INTO ledger_journals(id,institution_id) VALUES($1,$3),($2,$3)', [
      journal,
      claim,
      institution,
    ]);
    await client.query(
      `INSERT INTO cash_to_cash_transfers(id,agent_id,reference,status,created_at,claimed_at,principal_minor,fee_minor,vat_minor,total_minor,currency,journal_id,claim_journal_id,beneficiary_phone,expires_at,updated_at) VALUES($1,$2,'SYN-C2C-CLAIMED','CLAIMED','2026-11-24T13:00:00Z','2026-11-24T14:00:00Z',500000,100,8,500108,'NGN',$3,$4,'8012345678','2026-11-25T13:00:00Z','2026-11-24T14:00:00Z')`,
      [cash, randomUUID(), journal, claim],
    );
    await client.query(
      `INSERT INTO audit_events VALUES($1,'AGENT_CASH_TO_CASH_CLAIM','CASH_TO_CASH_CLAIMED',$2,'{"redemptionMethod":"AGENT_CASH"}','2026-11-24T14:00:00Z')`,
      [randomUUID(), claim],
    );
    for (const service of ['CASH_IN', 'CASH_OUT'])
      await client.query(
        `INSERT INTO ledger_journals(id,institution_id,metadata,status,reference,created_at,posted_at,currency) VALUES($1,$2,$3,'POSTED',$4,'2026-11-24T12:30:00Z','2026-11-24T12:30:00Z','NGN')`,
        [
          randomUUID(),
          institution,
          JSON.stringify({
            canonicalService: service,
            amountMinor: '250000',
            agentId: randomUUID(),
          }),
          `SYN-${service}`,
        ],
      );
    await client.end();
    // Use the cluster's private client config; no existing env/DB configuration is read.
    const cfg = cluster.getPgClient().connectionParameters;
    db = new DataSource({
      type: 'postgres',
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      password: cfg.password,
      database: cfg.database,
    });
    await db.initialize();
    const auth = new AuthorizationService(db, { record: async () => {} });
    const controller = new TransactionHistoryController(db, auth);
    const principal = {
      type: 'OPERATOR',
      principalId: 'restricted',
      roles: ['OPERATIONS'],
      scopes: ['transaction.view'],
      customerAccess: 'NONE',
      sessionId: 'synthetic',
      audience: 'workforce-admin',
      assuranceLevel: 'MFA',
    };
    const req = { authorizationPrincipal: principal };
    await check('mixed history includes all four supported types', async () => {
      const r = await controller.list(req, { limit: '100' });
      assert.equal(r.items.length, 46);
      assert.equal(new Set(r.items.map((x) => x.type)).size, 4);
    });
    await check('combined Lagos date, type, status and exact reference filters', async () => {
      const r = await controller.list(req, {
        from: '2026-11-24',
        to: '2026-11-24',
        type: 'CASH_TO_CASH',
        status: 'CLAIMED',
        reference: 'SYN-C2C-CLAIMED',
      });
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].id, cash);
    });
    await check('Lagos inclusive start and exclusive next-midnight boundaries', async () => {
      assert.equal(lagosBoundary('2026-11-24'), '2026-11-23T23:00:00.000Z');
      const r = await controller.list(req, { from: '2026-11-24', to: '2026-11-24', limit: '100' });
      const keys = r.items.map((x) => x.id);
      assert(keys.includes(ids[41]));
      assert(!keys.includes(ids[40]));
      assert(!keys.includes(ids[42]));
    });
    await check(
      'keyset pagination preserves microseconds without duplicates or omissions',
      async () => {
        const seen = [];
        let cursor = '';
        do {
          const r = await controller.list(req, { limit: '7', cursor });
          seen.push(...r.items.map((x) => x.id));
          cursor = r.nextCursor;
        } while (cursor);
        assert.equal(seen.length, 46);
        assert.equal(new Set(seen).size, 46);
      },
    );
    await check(
      'detail counts initiation and claim once, masks phone and gates ledger',
      async () => {
        const r = await controller.detail(req, 'CASH_TO_CASH', cash);
        assert.equal(r.journals, null);
        assert.equal(r.investigation.beneficiaryPhoneMasked, '••••••5678');
        assert.equal(r.investigation.redemptionMethod, 'AGENT_CASH');
        assert(!JSON.stringify(r).includes('transfer_code'));
        const r2 = await controller.detail(
          {
            authorizationPrincipal: { ...principal, scopes: [...principal.scopes, 'ledger.view'] },
          },
          'CASH_TO_CASH',
          cash,
        );
        assert.equal(r2.journals.length, 2);
      },
    );
    await check('restricted list and direct detail cannot read foreign institution', async () => {
      assert.equal((await controller.list(req, { reference: 'SYN-WALLET-043' })).items.length, 0);
      await assert.rejects(
        controller.detail(req, 'WALLET_TRANSFER', ids[43]),
        (e) => e.getStatus() === 404,
      );
    });
    await check('assignment revocation takes effect on list and detail immediately', async () => {
      await db.query("UPDATE workforce_institution_assignments SET status='REVOKED'");
      assert.equal((await controller.list(req, {})).items.length, 0);
      await assert.rejects(
        controller.detail(req, 'CASH_TO_CASH', cash),
        (e) => e.getStatus() === 404,
      );
      await db.query("UPDATE workforce_institution_assignments SET status='ACTIVE'");
    });
    await check('missing capability and unauthenticated callers denied', async () => {
      await assert.rejects(
        controller.list({ authorizationPrincipal: { ...principal, scopes: [] } }, {}),
        (e) => e.getStatus() === 403,
      );
      await assert.rejects(controller.list({}, {}), (e) => e.getStatus() === 401);
    });
    await check('malformed filters and cursor rejected', async () => {
      for (const q of [
        { type: 'DEPOSIT' },
        { from: '2026-02-30' },
        { from: '2026-11-25', to: '2026-11-24' },
        { cursor: 'bad' },
        { limit: '0' },
        { reference: 'x'.repeat(256) },
      ])
        await assert.rejects(controller.list(req, q), (e) => e.getStatus() === 400);
    });
    if (process.argv.includes('--browser')) {
      server = http.createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://localhost');
          const match = /\/transaction-history(?:\/([^/]+)\/([^/]+))?$/.exec(url.pathname);
          if (!match) {
            response.writeHead(404).end();
            return;
          }
          const r = match[1]
            ? await controller.detail(req, match[1], match[2])
            : await controller.list(req, Object.fromEntries(url.searchParams));
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(r));
        } catch (e) {
          response
            .writeHead(e.getStatus?.() || 500, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ message: e.message }));
        }
      });
      await new Promise((r) => server.listen(3099, '127.0.0.1', r));
      const { chromium } = require('playwright');
      const binary = require('@sparticuz/chromium').default;
      const browser = await chromium.launch({
        executablePath: await binary.executablePath(),
        args: binary.args,
        headless: true,
      });
      try {
        const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
        await page.addInitScript((p) => {
          localStorage.setItem('admin_workforce_token', 'synthetic-harness-only');
          localStorage.setItem('admin_workforce_session_id', 'synthetic');
          localStorage.setItem('admin_workforce_principal', JSON.stringify(p));
        }, principal);
        await page.goto('http://127.0.0.1:5173/#transaction-history/WALLET_TRANSFER/' + ids[0]);
        await page.getByRole('dialog').waitFor();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByText('SYN-C2C-CLAIMED', { exact: true }).waitFor();
        await page.getByTestId('section-money').click();
        assert.equal(await page.getByTestId('nav-transfers').innerText(), 'Transaction History');
        for (const removed of ['cashIn', 'cashOut', 'cashToCashOps'])
          assert.equal(await page.getByTestId(`nav-${removed}`).count(), 0);
        await page.screenshot({ path: `${out}/mixed-history.png`, fullPage: true });
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByText('Page 2 · newest first').waitFor();
        await page.screenshot({ path: `${out}/page-2.png`, fullPage: true });
        await page.getByLabel('From date', { exact: true }).fill('2026-11-24');
        await page.getByLabel('To date', { exact: true }).fill('2026-11-24');
        await page.getByLabel('Transaction type', { exact: true }).selectOption('CASH_TO_CASH');
        await page.getByLabel('Status', { exact: true }).selectOption('CLAIMED');
        await page.getByLabel('Exact reference', { exact: true }).fill('SYN-C2C-CLAIMED');
        await page.getByRole('button', { name: 'Apply filters' }).click();
        await page.getByText('SYN-C2C-CLAIMED', { exact: true }).waitFor();
        await page.screenshot({ path: `${out}/combined-filters.png`, fullPage: true });
        await page.getByRole('link', { name: 'View details', exact: true }).click();
        await page.getByText('AGENT_CASH', { exact: true }).waitFor();
        await page.screenshot({ path: `${out}/cash-to-cash-detail.png`, fullPage: true });
        report.push({
          name: 'Chromium full SPA mixed history, next page, combined filters, C2C detail (real PostgreSQL read API; synthetic bearer adapter)',
          result: 'PASS',
        });
      } finally {
        await browser.close();
      }
    }
    fs.writeFileSync(
      `${out}/acceptance.json`,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          scope:
            'Disposable minimal PostgreSQL schema; production controller and AuthorizationService; audit sink and browser bearer adapter test-only. NOT full application/session integration.',
          checks: report,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (db?.isInitialized) await db.destroy();
    await cluster.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
