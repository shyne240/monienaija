/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * V1-COMMERCIAL-02 — Product Catalogue FOUNDATION (real PostgreSQL).
 *
 * Foundation only: answers "What product is this?" — never "How much does this product cost?".
 * Verified here:
 *   - additive migration 0071: table, CHECK constraints, indexes, code validation at the DB layer
 *   - bootstrap seeding: exactly the 7 established V1 products, NGN/V1/ACTIVE/enabled/NOT_CONFIGURED
 *   - product-code uniqueness (PK + duplicate-create 409)
 *   - V2/out-of-scope products never seeded or enabled
 *   - status/configuration/enabled behavior; version-checked audited writes; stale-version 409
 *   - workforce authorization (OPERATOR/SERVICE/PRIVILEGED only), safe projection, read/write surface
 *   - NO wallet / ledger / limit-usage / limit-reservation mutation from any catalogue operation
 *   - commercial decision snapshots stay immutable and unaffected by catalogue changes
 *   - no DELETE route — deprecation is a status transition
 */
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { CommercialDecisionSnapshotService } from '../src/commercial-decision/commercial-decision-snapshot.service';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { ProductCatalogService } from '../src/product-catalog/product-catalog.service';
import { OUT_OF_SCOPE_PRODUCT_CODES, PRODUCT_CATALOG_SEED, V1_PRODUCT_CODES } from '../src/product-catalog/product-catalog.seed';
import {
  commissionNone,
  feeNotConfigured,
  limitNotEvaluated,
  rewardNone,
} from '../src/commercial-decision/commercial-decision.defaults';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

describe('V1-COMMERCIAL-02 Product Catalogue foundation (real PG)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let service: ProductCatalogService;
  let seedService: ProductCatalogSeedService;
  let snapshotService: CommercialDecisionSnapshotService;

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
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  const auth = (type: string) => `Bearer workforce-${type.toLowerCase()}`;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-comm-02');
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await (app.getHttpAdapter().getInstance() as any).ready();
    service = app.get(ProductCatalogService);
    seedService = app.get(ProductCatalogSeedService);
    snapshotService = app.get(CommercialDecisionSnapshotService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await seedService.reseed();
  });

  async function rowCount(table: string): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text AS cnt FROM ${table}`);
    return Number(rows[0]!.cnt);
  }

  async function financialTables(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ['ledger_accounts', 'ledger_journals', 'ledger_lines', 'wallet_accounts', 'limit_usages', 'limit_reservations', 'commercial_decision_snapshots']) {
      out[t] = await rowCount(t);
    }
    return out;
  }

  // ── 1. migration & schema ──

  it('01. migration 0071 creates products with code validation, status checks and indexes', async () => {
    const tables: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='products'`,
    );
    expect(tables).toHaveLength(1);

    const constraints: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='products'::regclass ORDER BY conname`,
    );
    const names = constraints.map((c) => c.conname);
    for (const expected of ['chk_products_code', 'chk_products_domain', 'chk_products_currency', 'chk_products_scope', 'chk_products_status', 'chk_products_configuration', 'chk_products_version', 'products_pkey']) {
      expect(names).toContain(expected);
    }

    const indexes: Array<{ indexname: string }> = await dataSource.query(`SELECT indexname FROM pg_indexes WHERE tablename='products'`);
    const idx = indexes.map((i) => i.indexname);
    for (const expected of ['idx_products_domain', 'idx_products_scope', 'idx_products_status', 'idx_products_enabled']) {
      expect(idx).toContain(expected);
    }

    // DB-layer code validation rejects invalid identities (subset of limit_rules.product pattern)
    await expect(
      dataSource.query(`INSERT INTO products (code, name, domain, currency, created_by) VALUES ('bad-code!','x','CUSTOMER','NGN','test')`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      dataSource.query(`INSERT INTO products (code, name, domain, currency, created_by) VALUES ('AB','x','CUSTOMER','NGN','test')`),
    ).rejects.toMatchObject({ code: '23514' }); // too short (<3)
    await expect(
      dataSource.query(`INSERT INTO products (code, name, domain, currency, created_by) VALUES ('OK_CODE','x','INVENTED','NGN','test')`),
    ).rejects.toMatchObject({ code: '23514' }); // invalid domain
    await expect(
      dataSource.query(`INSERT INTO products (code, name, domain, currency, created_by) VALUES ('OK_CODE','x','CUSTOMER','ngn','test')`),
    ).rejects.toMatchObject({ code: '23514' }); // currency must be uppercase ISO

    // catalogue has NO commercial rate columns — separation is structural
    const columns: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='products'`,
    );
    const cols = columns.map((c) => c.column_name);
    for (const forbidden of ['fee', 'commission', 'reward', 'vat', 'tax', 'rate', 'price', 'limit']) {
      expect(cols.some((c) => c.includes(forbidden))).toBe(false);
    }
  });

  // ── 2. seeding: exactly the 7 established V1 products ──

  it('02. seeds exactly the seven established V1 products with honest defaults', async () => {
    const rows: Array<Record<string, unknown>> = await dataSource.query(`SELECT * FROM products ORDER BY code`);
    expect(rows).toHaveLength(7);
    const codes = rows.map((r) => r.code);
    expect(codes).toEqual([...V1_PRODUCT_CODES].sort());
    expect(codes).toEqual(
      ['AGENT_DEFUNDING', 'AGENT_FUNDING', 'CASH_TO_CASH', 'CASH_TO_WALLET', 'CUSTOMER_FUNDING', 'WALLET_TO_CASH', 'WALLET_TRANSFER'],
    );

    for (const row of rows) {
      expect(row.currency).toBe('NGN'); // V1 is internal NGN-only
      expect(row.product_scope).toBe('V1');
      expect(row.status).toBe('ACTIVE');
      expect(row.enabled).toBe(true); // the flows genuinely exist in the runtime
      expect(row.configuration_status).toBe('NOT_CONFIGURED'); // no commercial pricing configured — honest
      expect(row.created_by).toBe('system-seed');
      expect(row.deleted_at).toBeNull();
      expect(row.name).toBeTruthy();
    }

    // domain mapping follows audit doc §12
    const byCode = Object.fromEntries(rows.map((r) => [r.code as string, r]));
    expect(byCode['WALLET_TRANSFER']!.domain).toBe('CUSTOMER');
    for (const c of ['WALLET_TO_CASH', 'CASH_TO_WALLET', 'CASH_TO_CASH']) expect(byCode[c]!.domain).toBe('AGENT');
    for (const c of ['CUSTOMER_FUNDING', 'AGENT_FUNDING', 'AGENT_DEFUNDING']) expect(byCode[c]!.domain).toBe('FINANCE');
  });

  it('03. seed is idempotent and only inserts missing codes (never overwrites operator changes)', async () => {
    await dataSource.query(`UPDATE products SET name = 'Operator Renamed' WHERE code = 'WALLET_TRANSFER'`);
    const inserted = await seedService.seedIfEmpty();
    expect(inserted).toBe(0);
    const rows: Array<{ name: string }> = await dataSource.query(`SELECT name FROM products WHERE code='WALLET_TRANSFER'`);
    expect(rows[0]!.name).toBe('Operator Renamed');
    expect(await rowCount('products')).toBe(7);

    // a missing seed code is inserted on later boots
    await dataSource.query(`DELETE FROM products WHERE code='CASH_TO_CASH'`);
    const inserted2 = await seedService.seedIfEmpty();
    expect(inserted2).toBe(1);
    expect(await rowCount('products')).toBe(7);
  });

  // ── 3. uniqueness & V2/out-of-scope guards ──

  it('04. product code is unique: duplicate creation conflicts, V2/out-of-scope products never exist', async () => {
    await expect(service.createProduct({ code: 'WALLET_TRANSFER', name: 'Dup', domain: 'CUSTOMER' }, 'test')).rejects.toMatchObject({ status: 409 });
    await request(app.getHttpServer())
      .post('/api/v1/internal/products')
      .set('Authorization', auth('PRIVILEGED'))
      .send({ code: 'wallet_transfer', name: 'Dup', domain: 'CUSTOMER' })
      .expect(409); // normalized to uppercase → same identity
    expect(await rowCount('products')).toBe(7);

    const all: Array<{ code: string; product_scope: string; enabled: boolean }> = await dataSource.query(`SELECT code, product_scope, enabled FROM products`);
    for (const forbidden of OUT_OF_SCOPE_PRODUCT_CODES) {
      expect(all.some((r) => r.code === forbidden)).toBe(false);
    }
    expect(all.some((r) => r.product_scope === 'V2')).toBe(false);
    // no non-NGN currency anywhere
    const currencies: Array<{ currency: string }> = await dataSource.query(`SELECT DISTINCT currency FROM products`);
    expect(currencies.map((c) => c.currency)).toEqual(['NGN']);

    // the seed itself never carries out-of-scope codes or non-NGN currencies
    for (const entry of PRODUCT_CATALOG_SEED) {
      expect(OUT_OF_SCOPE_PRODUCT_CODES).not.toContain(entry.code);
      expect(entry.currency).toBe('NGN');
      expect(entry.productScope).toBe('V1');
    }
  });

  // ── 4. catalogue CRUD-lite behavior ──

  it('05. create registers future products safely: validation, normalization, defaults, audit', async () => {
    const before = await financialTables();
    const created = await service.createProduct(
      { code: 'future_product', name: 'Future Product', description: 'planned, not enabled', domain: 'CUSTOMER' },
      'workforce-operator-1',
    );
    expect(created.code).toBe('FUTURE_PRODUCT'); // normalized uppercase
    expect(created.currency).toBe('NGN');
    expect(created.productScope).toBe('V1');
    expect(created.status).toBe('ACTIVE');
    expect(created.enabled).toBe(false); // default: NOT enabled without explicit enablement
    expect(created.configurationStatus).toBe('NOT_CONFIGURED');
    expect(created.version).toBe(1);

    const audits: Array<{ entity_type: string; action: string; actor: string }> = await dataSource.query(
      `SELECT entity_type, action, actor FROM audit_events WHERE entity_type='PRODUCT' ORDER BY occurred_at`,
    );
    expect(audits.some((a) => a.action === 'CREATED' && a.entity_type === 'PRODUCT')).toBe(true);
    expect(await financialTables()).toEqual(before);
  });

  it('06. create validation rejects malformed input without persisting anything', async () => {
    const attempts = [
      { code: '', name: 'X', domain: 'CUSTOMER' },
      { code: 'ab', name: 'X', domain: 'CUSTOMER' },
      { code: 'BAD CODE!', name: 'X', domain: 'CUSTOMER' },
      { code: 'GOOD_CODE', name: '', domain: 'CUSTOMER' },
      { code: 'GOOD_CODE', name: 'X', domain: 'INVENTED' },
      { code: 'GOOD_CODE', name: 'X', domain: 'CUSTOMER', currency: 'US' }, // wrong length ('usd' is normalized to 'USD' by design)
      { code: 'GOOD_CODE', name: 'X', domain: 'CUSTOMER', productScope: 'V3' },
      { code: 'GOOD_CODE', name: 'X', domain: 'CUSTOMER', status: 'BOGUS' },
      { code: 'GOOD_CODE', name: 'X', domain: 'CUSTOMER', configurationStatus: 'BOGUS' },
    ];
    for (const a of attempts) {
      await expect(service.createProduct(a as any, 'test')).rejects.toMatchObject({ status: 400 });
    }
    expect(await rowCount('products')).toBe(7);
  });

  it('07. update is version-checked and audited: stale version 409, correct version succeeds and bumps', async () => {
    const current = await service.getProduct('WALLET_TRANSFER');
    expect(current.version).toBe(1);

    await expect(
      service.updateProduct('WALLET_TRANSFER', { name: 'Stale', version: 99 }, 'test'),
    ).rejects.toMatchObject({ status: 409 });

    const updated = await service.updateProduct(
      'WALLET_TRANSFER',
      { name: 'Wallet Transfer (P2P)', description: 'updated description', status: 'ACTIVE', version: current.version },
      'workforce-operator-1',
    );
    expect(updated.name).toBe('Wallet Transfer (P2P)');
    expect(updated.version).toBe(current.version + 1);
    expect(updated.updatedBy).toBe('workforce-operator-1');

    // replaying the same (now stale) version conflicts
    await expect(
      service.updateProduct('WALLET_TRANSFER', { enabled: false, version: current.version }, 'test'),
    ).rejects.toMatchObject({ status: 409 });

    await expect(service.updateProduct('NO_SUCH_PRODUCT', { name: 'x', version: 1 }, 'test')).rejects.toMatchObject({ status: 404 });
    await expect(service.updateProduct('WALLET_TRANSFER', { status: 'INVENTED', version: updated.version }, 'test')).rejects.toMatchObject({ status: 400 });

    const audits: Array<{ action: string }> = await dataSource.query(
      `SELECT action FROM audit_events WHERE entity_type='PRODUCT' ORDER BY occurred_at`,
    );
    expect(audits.filter((a) => a.action === 'UPDATED').length).toBeGreaterThanOrEqual(1);
  });

  it('08. concurrent updates: exactly one writer wins per version (optimistic concurrency)', async () => {
    const current = await service.getProduct('CASH_TO_CASH');
    const results = await Promise.allSettled([
      service.updateProduct('CASH_TO_CASH', { name: 'Writer A', version: current.version }, 'test-a'),
      service.updateProduct('CASH_TO_CASH', { name: 'Writer B', version: current.version }, 'test-b'),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(String((losers[0] as any).reason.status)).toBe('409');
    const after = await service.getProduct('CASH_TO_CASH');
    expect(after.version).toBe(current.version + 1);
    expect(['Writer A', 'Writer B']).toContain(after.name);
  });

  it('09. status/configuration/enabled behavior: deprecate instead of delete; disabled products list-filterable', async () => {
    const disabled = await service.updateProduct('WALLET_TO_CASH', { enabled: false, version: 1 }, 'test');
    expect(disabled.enabled).toBe(false);
    const deprecated = await service.updateProduct('WALLET_TO_CASH', { status: 'DEPRECATED', version: 2 }, 'test');
    expect(deprecated.status).toBe('DEPRECATED');
    expect(deprecated.enabled).toBe(false);

    const onlyDisabled = await service.listProducts({ enabled: false });
    expect(onlyDisabled.data.map((p) => p.code)).toEqual(['WALLET_TO_CASH']);
    const deprecatedList = await service.listProducts({ status: 'DEPRECATED' });
    expect(deprecatedList.data.map((p) => p.code)).toEqual(['WALLET_TO_CASH']);
    const configured = await service.listProducts({ configurationStatus: 'CONFIGURED' });
    expect(configured.total).toBe(0); // no commercial configuration exists anywhere — honest

    // soft-delete column exists and rows are never hard-deleted by the API
    expect(await rowCount('products')).toBe(7);
  });

  // ── 5. API surface: authorization, safe projection, pagination, read-only boundary ──

  it('10. unauthenticated and non-workforce principals are denied', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/products').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/products/WALLET_TRANSFER').expect(401);
    await request(app.getHttpServer()).post('/api/v1/internal/products').send({}).expect(401);

    for (const type of ['CUSTOMER', 'AGENT', 'AGGREGATOR', 'SUPPORT']) {
      await request(app.getHttpServer()).get('/api/v1/internal/products').set('Authorization', auth(type)).expect(403);
      await request(app.getHttpServer()).get('/api/v1/internal/products/WALLET_TRANSFER').set('Authorization', auth(type)).expect(403);
      await request(app.getHttpServer()).post('/api/v1/internal/products').set('Authorization', auth(type)).send({ code: 'X_CODE', name: 'x', domain: 'CUSTOMER' }).expect(403);
      await request(app.getHttpServer()).patch('/api/v1/internal/products/WALLET_TRANSFER').set('Authorization', auth(type)).send({ version: 1 }).expect(403);
    }
  });

  it('11. workforce roles can use the surface; responses are safe projections', async () => {
    for (const type of ['OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const list = await request(app.getHttpServer()).get('/api/v1/internal/products').set('Authorization', auth(type)).expect(200);
      expect(list.body.total).toBe(7);
      const one = await request(app.getHttpServer()).get('/api/v1/internal/products/WALLET_TRANSFER').set('Authorization', auth(type)).expect(200);
      expect(one.body.code).toBe('WALLET_TRANSFER');
    }

    const one = await request(app.getHttpServer()).get('/api/v1/internal/products/WALLET_TRANSFER').set('Authorization', auth('OPERATOR')).expect(200);
    const body = JSON.stringify(one.body);
    // safe projection: only catalogue facts — no secrets, no internal implementation details
    for (const forbidden of ['password', 'pin', 'otp', 'secret', 'token', 'request_hash', 'requestHash']) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
    expect(one.body.currency).toBe('NGN');
    expect(one.body.productScope).toBe('V1');
    expect(one.body.status).toBe('ACTIVE');
    expect(one.body.enabled).toBe(true);
    expect(one.body.configurationStatus).toBe('NOT_CONFIGURED');
    expect(one.body.version).toBe(1);

    await request(app.getHttpServer()).get('/api/v1/internal/products/NO_SUCH_PRODUCT').set('Authorization', auth('OPERATOR')).expect(404);
  });

  it('12. list filters, deterministic ordering and pagination validation', async () => {
    const all = await request(app.getHttpServer()).get('/api/v1/internal/products').set('Authorization', auth('OPERATOR')).expect(200);
    expect(all.body.total).toBe(7);
    const codes = all.body.data.map((p: any) => p.code);
    expect([...codes].sort()).toEqual(codes); // deterministic code ASC

    const agent = await request(app.getHttpServer()).get('/api/v1/internal/products?domain=AGENT').set('Authorization', auth('OPERATOR')).expect(200);
    expect(agent.body.total).toBe(3);
    expect(agent.body.data.every((p: any) => p.domain === 'AGENT')).toBe(true);

    const finance = await request(app.getHttpServer()).get('/api/v1/internal/products?domain=FINANCE').set('Authorization', auth('OPERATOR')).expect(200);
    expect(finance.body.total).toBe(3);

    const enabled = await request(app.getHttpServer()).get('/api/v1/internal/products?enabled=true').set('Authorization', auth('OPERATOR')).expect(200);
    expect(enabled.body.total).toBe(7);

    const page1 = await request(app.getHttpServer()).get('/api/v1/internal/products?page=1&limit=3').set('Authorization', auth('OPERATOR')).expect(200);
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.hasNextPage).toBe(true);
    const page3 = await request(app.getHttpServer()).get('/api/v1/internal/products?page=3&limit=3').set('Authorization', auth('OPERATOR')).expect(200);
    expect(page3.body.data).toHaveLength(1);
    expect(page3.body.hasNextPage).toBe(false);
    const ids1 = page1.body.data.map((p: any) => p.code);
    const ids3 = page3.body.data.map((p: any) => p.code);
    expect(ids3.every((c: string) => !ids1.includes(c))).toBe(true);

    await request(app.getHttpServer()).get('/api/v1/internal/products?page=0').set('Authorization', auth('OPERATOR')).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/products?limit=101').set('Authorization', auth('OPERATOR')).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/products?domain=INVENTED').set('Authorization', auth('OPERATOR')).expect(400);
    await request(app.getHttpServer()).get('/api/v1/internal/products?enabled=maybe').set('Authorization', auth('OPERATOR')).expect(400);
  });

  it('13. no DELETE route exists — deprecation is a status transition, never erasure', async () => {
    await request(app.getHttpServer()).delete('/api/v1/internal/products/WALLET_TRANSFER').set('Authorization', auth('PRIVILEGED')).expect(404);
    expect(await rowCount('products')).toBe(7);
  });

  // ── 6. financial isolation & snapshot compatibility ──

  it('14. catalogue operations never mutate wallets, ledger, limit usage/reservations or snapshots', async () => {
    const before = await financialTables();
    await service.createProduct({ code: 'ISOLATION_PROBE', name: 'Probe', domain: 'PLATFORM' }, 'test');
    await service.updateProduct('ISOLATION_PROBE', { enabled: true, status: 'DISABLED', version: 1 }, 'test');
    const list = await service.listProducts({});
    expect(list.total).toBe(8);
    const after = await financialTables();
    expect(after).toEqual(before);
  });

  it('15. historical safety: catalogue changes never rewrite or endanger commercial decision snapshots', async () => {
    // record a fee-free snapshot referencing WALLET_TRANSFER (foundation from V1-COMMERCIAL-DECISION-01)
    const snapshotInput = {
      idempotencyKey: `comm-02:${randomUUID()}`,
      product: 'WALLET_TRANSFER',
      direction: 'OUTGOING',
      channel: null,
      principalType: 'CUSTOMER',
      principalId: randomUUID(),
      currency: 'NGN',
      principalAmountMinor: '100000',
      transactionReference: `TXN-${randomUUID().slice(0, 12)}`,
      correlationId: null,
      journalId: null,
      decisionStatus: 'FINAL' as const,
      feeDecision: feeNotConfigured('NGN', '100000'),
      commissionDecision: commissionNone(),
      rewardDecision: rewardNone(),
      limitDecision: limitNotEvaluated(),
      revenueDecision: null,
      configurationVersion: 'CFG-COMM02-1',
      createdBy: 'test-suite',
    };
    const created = await snapshotService.recordDecision(snapshotInput);
    const snapshotId = created.snapshot.id as string;

    // mutate the catalogue: rename, disable, deprecate the product
    await service.updateProduct('WALLET_TRANSFER', { name: 'Renamed Product', version: 1 }, 'test');
    await service.updateProduct('WALLET_TRANSFER', { enabled: false, status: 'DEPRECATED', version: 2 }, 'test');

    // the snapshot is byte-identical: catalogue changes cannot make the old decision ambiguous
    const rows: Array<Record<string, unknown>> = await dataSource.query(`SELECT * FROM commercial_decision_snapshots WHERE id=$1`, [snapshotId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.product).toBe('WALLET_TRANSFER'); // product identity preserved as recorded
    expect(rows[0]!.configuration_version).toBe('CFG-COMM02-1');
    expect((rows[0]!.fee_decision as any).status).toBe('NOT_CONFIGURED');

    // snapshots remain immutable at the DB layer (no UPDATE/DELETE behavior was added)
    await expect(dataSource.query(`UPDATE commercial_decision_snapshots SET product='OTHER' WHERE id=$1`, [snapshotId])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
    await expect(dataSource.query(`DELETE FROM commercial_decision_snapshots WHERE id=$1`, [snapshotId])).rejects.toThrow(
      /commercial_decision_snapshots is immutable/,
    );
  });

  it('16. canonical identity check: catalogue codes are the exact runtime product codes (no competing system)', async () => {
    const codes: Array<{ code: string }> = await dataSource.query(`SELECT code FROM products ORDER BY code`);
    const catalogueCodes = codes.map((c) => c.code);
    // identical to the codes flows pass to limit enforcement / commercial snapshots
    for (const runtime of ['WALLET_TRANSFER', 'WALLET_TO_CASH', 'CASH_TO_WALLET', 'CASH_TO_CASH', 'CUSTOMER_FUNDING', 'AGENT_FUNDING', 'AGENT_DEFUNDING']) {
      expect(catalogueCodes).toContain(runtime);
    }
    // code pattern stays compatible with limit_rules.product consumption
    for (const code of catalogueCodes) {
      expect(code).toMatch(/^[A-Z0-9_][A-Z0-9_.-]{1,79}$/);
    }
    // snapshot + catalogue agree on the same product identity
    const created = await snapshotService.recordDecision({
      idempotencyKey: `comm-02-canonical:${randomUUID()}`,
      product: catalogueCodes[0]!,
      principalType: 'CUSTOMER',
      principalId: randomUUID(),
      currency: 'NGN',
      principalAmountMinor: '1',
      transactionReference: `TXN-${randomUUID().slice(0, 10)}`,
      feeDecision: feeNotConfigured('NGN', '1'),
      commissionDecision: commissionNone(),
      rewardDecision: rewardNone(),
      limitDecision: limitNotEvaluated(),
      createdBy: 'test-suite',
    } as any);
    expect(created.replayed).toBe(false);
    const lookup = await snapshotService.findByReference(catalogueCodes[0]!, created.snapshot.transaction_reference as string);
    expect(lookup!.product).toBe(catalogueCodes[0]!);
  });
});
