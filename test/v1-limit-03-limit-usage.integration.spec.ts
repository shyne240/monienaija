/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';
import { LimitUsageService } from '../src/limit-catalog/limit-usage.service';
import { LimitWindowType, getLagosWindow } from '../src/limit-catalog/limit-window.util';

describe('V1-LIMIT-03 Limit Usage & Reservation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let usageService: LimitUsageService;

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
      const allowed = ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED','AGENT','CUSTOMER','AGGREGATOR'];
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

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-limit-03');
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
    usageService = app.get(LimitUsageService);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  function hashFor(obj: any): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  async function seedProfile(code: string): Promise<void> {
    await dataSource.query(`INSERT INTO limit_profiles (code, name, kind, created_by) VALUES ($1,$2,'CUSTOMER','test')`, [code, `Profile ${code}`]);
  }

  // 01 Migration creates usage table
  it('01. migration creates limit_usages + limit_reservations (0069, still present after 0070)', async () => {
    const migs: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text as timestamp, name FROM typeorm_migrations ORDER BY timestamp ASC`);
    expect(migs.length).toBeGreaterThanOrEqual(71);
    const usage = migs.find((m) => m.timestamp === '1785753600069');
    expect(usage).toBeDefined();
    expect(usage!.name).toBe('CreateLimitUsages1785753600069');
    // product catalogue (0071) also remains in the chain
    expect(migs.some((m) => m.timestamp === '1785753600071')).toBe(true);
    // head moved forward with the V1-ADMIN-AUTHORIZATION-RUNTIME-01 bootstrap-role-check
    // constraint rename (0084)
    const last = migs[migs.length - 1];
    expect(last.timestamp).toBe('1785753600085');
    expect(last.name).toBe('AddAdministratorRoleAssignmentScope1785753600085');
    const tables: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('limit_usages','limit_reservations','limit_profiles','limit_rules','limit_assignments') ORDER BY tablename`);
    expect(tables.map(t=>t.tablename)).toEqual(expect.arrayContaining(['limit_usages','limit_reservations']));
    const checks: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='limit_usages'::regclass`);
    const n = checks.map(c=>c.conname);
    expect(n).toEqual(expect.arrayContaining(['chk_limit_usages_window_type','chk_limit_usages_dimension','chk_limit_usages_window','chk_limit_usages_used_amount']));
    const idx: Array<{ indexname: string }> = await dataSource.query(`SELECT indexname FROM pg_indexes WHERE tablename='limit_usages'`);
    expect(idx.map(i=>i.indexname)).toEqual(expect.arrayContaining(['uq_limit_usages_window','idx_limit_usages_principal']));
    const rcChecks: Array<{ conname: string }> = await dataSource.query(`SELECT conname FROM pg_constraint WHERE conrelid='limit_reservations'::regclass`);
    expect(rcChecks.map(c=>c.conname)).toEqual(expect.arrayContaining(['chk_limit_reservations_status']));
    // columns presence
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='limit_usages'`);
    const colNames = cols.map(c=>c.column_name);
    expect(colNames).toEqual(expect.arrayContaining(['principal_type','principal_id','limit_profile_code','product','dimension','currency','window_type','window_key','window_start','window_end','used_amount_minor','used_count','reserved_amount_minor','reserved_count','version']));
    const rCols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='limit_reservations'`);
    const rNames = rCols.map(c=>c.column_name);
    expect(rNames).toEqual(expect.arrayContaining(['idempotency_key','request_hash','correlation_id','status','amount_minor','count','limit_usage_id']));
  });

  // 02 Daily window key
  it('02. daily window key deterministic Africa/Lagos', async () => {
    const now = new Date('2026-09-27T10:00:00.000Z'); // Lagos 11:00 same day
    const win = getLagosWindow(now, LimitWindowType.DAILY);
    expect(win.windowType).toBe('DAILY');
    expect(win.windowKey).toBe('2026-09-27:DAILY:Africa/Lagos');
    // window_start should be Lagos midnight -> UTC 23:00 previous day
    expect(win.windowStart.toISOString()).toBe('2026-09-26T23:00:00.000Z');
    expect(win.windowEnd.toISOString()).toBe('2026-09-27T23:00:00.000Z');
    // Helper via service
    const svcWin = usageService.getLagosWindow(now, LimitWindowType.DAILY);
    expect(svcWin.windowKey).toBe(win.windowKey);
  });

  // 03 Weekly window key Monday start
  it('03. weekly window key Monday-start ISO week', async () => {
    // 2026-09-27 is Sunday, Lagos week Monday is 2026-09-21
    const sunday = new Date('2026-09-27T11:00:00.000Z'); // Lagos Sunday 12:00
    const winSun = getLagosWindow(sunday, LimitWindowType.WEEKLY);
    expect(winSun.windowStart.toISOString()).toBe('2026-09-20T23:00:00.000Z'); // Monday 2026-09-21 00:00 Lagos = UTC 2026-09-20 23:00
    expect(winSun.windowEnd.toISOString()).toBe('2026-09-27T23:00:00.000Z'); // Next Monday 2026-09-28 00:00 Lagos
    // Monday itself
    const monday = new Date('2026-09-28T01:00:00.000Z'); // Lagos Monday 02:00
    const winMon = getLagosWindow(monday, LimitWindowType.WEEKLY);
    expect(winMon.windowStart.toISOString()).toBe('2026-09-27T23:00:00.000Z'); // Monday 2026-09-28 00:00 Lagos = UTC 2026-09-27 23:00
    // Check key is ISO week: 2026-09-27 is week 39 or 40? We'll just verify format
    expect(winMon.windowKey).toMatch(/^\d{4}-W\d{2}:WEEKLY:Africa\/Lagos$/);
    expect(winSun.windowKey).toMatch(/^\d{4}-W\d{2}:WEEKLY:Africa\/Lagos$/);
    // Same week: both sunday and monday after should share same weekly key if same ISO week? Actually 2026-09-27 Sunday is still week containing Monday 2026-09-21, while 2026-09-28 Monday is next week, so they should differ
    expect(winSun.windowKey).not.toBe(winMon.windowKey);
    // Tuesday same week as Monday
    const tuesday = new Date('2026-09-29T10:00:00.000Z');
    const winTue = getLagosWindow(tuesday, LimitWindowType.WEEKLY);
    expect(winTue.windowKey).toBe(winMon.windowKey);
    expect(winTue.windowStart.toISOString()).toBe(winMon.windowStart.toISOString());
  });

  // 04 Monthly window key
  it('04. monthly window key calendar month Africa/Lagos', async () => {
    const midMonth = new Date('2026-09-15T10:00:00.000Z');
    const win = getLagosWindow(midMonth, LimitWindowType.MONTHLY);
    expect(win.windowKey).toBe('2026-09:MONTHLY:Africa/Lagos');
    expect(win.windowStart.toISOString()).toBe('2026-08-31T23:00:00.000Z'); // Sep 1 00:00 Lagos
    expect(win.windowEnd.toISOString()).toBe('2026-09-30T23:00:00.000Z'); // Oct 1 00:00 Lagos
    // Edge: Jan, Dec
    const jan = new Date('2026-01-15T00:00:00.000Z');
    const winJan = getLagosWindow(jan, LimitWindowType.MONTHLY);
    expect(winJan.windowKey).toBe('2026-01:MONTHLY:Africa/Lagos');
    const dec = new Date('2026-12-15T12:00:00.000Z');
    const winDec = getLagosWindow(dec, LimitWindowType.MONTHLY);
    expect(winDec.windowStart.toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(winDec.windowEnd.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  // 05 Yearly window key
  it('05. yearly window key calendar year Africa/Lagos', async () => {
    const any = new Date('2026-06-15T10:00:00.000Z');
    const win = getLagosWindow(any, LimitWindowType.YEARLY);
    expect(win.windowKey).toBe('2026:YEARLY:Africa/Lagos');
    expect(win.windowStart.toISOString()).toBe('2025-12-31T23:00:00.000Z'); // Jan 1 2026 00:00 Lagos
    expect(win.windowEnd.toISOString()).toBe('2026-12-31T23:00:00.000Z'); // Jan 1 2027 00:00 Lagos
    const nextYear = new Date('2027-01-01T00:30:00.000Z'); // Lagos 01:30 Jan1 2027
    const win2 = getLagosWindow(nextYear, LimitWindowType.YEARLY);
    expect(win2.windowKey).toBe('2027:YEARLY:Africa/Lagos');
  });

  // 06 Lagos timezone boundary
  it('06. Lagos timezone boundary deterministic', async () => {
    // UTC 2026-09-26T23:00:00Z is exactly Lagos 2026-09-27 00:00
    const exactlyMidnight = new Date('2026-09-26T23:00:00.000Z');
    const justBefore = new Date('2026-09-26T22:59:59.999Z'); // Lagos 2026-09-26 23:59
    const justAfter = new Date('2026-09-26T23:00:00.001Z'); // Lagos 2026-09-27 00:00:00.001
    const winMidnight = getLagosWindow(exactlyMidnight, LimitWindowType.DAILY);
    const winBefore = getLagosWindow(justBefore, LimitWindowType.DAILY);
    const winAfter = getLagosWindow(justAfter, LimitWindowType.DAILY);
    expect(winBefore.windowKey).toBe('2026-09-26:DAILY:Africa/Lagos');
    expect(winMidnight.windowKey).toBe('2026-09-27:DAILY:Africa/Lagos');
    expect(winAfter.windowKey).toBe('2026-09-27:DAILY:Africa/Lagos');
    expect(winMidnight.windowKey).not.toBe(winBefore.windowKey);
    // Same Lagos day: two UTC times that map to same Lagos calendar day should share windowKey
    const lagosSame1 = new Date('2026-09-27T01:00:00.000Z'); // Lagos 02:00 27th
    const lagosSame2 = new Date('2026-09-27T22:00:00.000Z'); // Lagos 23:00 27th
    expect(getLagosWindow(lagosSame1, LimitWindowType.DAILY).windowKey).toBe('2026-09-27:DAILY:Africa/Lagos');
    expect(getLagosWindow(lagosSame2, LimitWindowType.DAILY).windowKey).toBe('2026-09-27:DAILY:Africa/Lagos');
  });

  // 07 Amount reservation
  it('07. amount reservation increments reserved_amount', async () => {
    const profile = 'AMT_PROF_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const idemKey = `idem-amt-${randomUUID()}`;
    const reqHash = hashFor({ subjectId, profile, amount: 500000 });
    const res = await usageService.reserve({
      principalType: 'CUSTOMER',
      principalId: subjectId,
      limitProfileCode: profile,
      product: 'WALLET_TRANSFER',
      dimension: 'DAILY_AMOUNT',
      currency: 'NGN',
      amountMinor: '500000',
      idempotencyKey: idemKey,
      requestHash: reqHash,
      now: new Date('2026-09-27T10:00:00.000Z'),
    });
    expect(res.kind).toBe('NEW');
    expect(res.usage.reservedAmountMinor).toBe('500000');
    expect(res.usage.usedAmountMinor).toBe('0');
    expect(res.usage.windowKey).toBe('2026-09-27:DAILY:Africa/Lagos');
    // Verify DB
    const rows: Array<{ reserved_amount_minor: string; used_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text, used_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_amount_minor).toBe('500000');
    expect(rows[0].used_amount_minor).toBe('0');
    const resRows: Array<{ status: string; amount_minor: string }> = await dataSource.query(`SELECT status, amount_minor::text FROM limit_reservations WHERE idempotency_key=$1`, [idemKey]);
    expect(resRows[0].status).toBe('RESERVED');
    expect(resRows[0].amount_minor).toBe('500000');
  });

  // 08 Count reservation
  it('08. count reservation increments reserved_count', async () => {
    const profile = 'CNT_PROF_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const idem = `idem-cnt-${randomUUID()}`;
    const hash = hashFor({ subjectId, profile });
    const res = await usageService.reserve({
      principalType: 'CUSTOMER',
      principalId: subjectId,
      limitProfileCode: profile,
      product: 'WALLET_TRANSFER',
      dimension: 'DAILY_COUNT',
      currency: 'NGN',
      count: 1,
      idempotencyKey: idem,
      requestHash: hash,
      now: new Date('2026-09-27T10:00:00.000Z'),
    });
    expect(res.kind).toBe('NEW');
    expect(res.usage.reservedCount).toBe(1);
    expect(res.usage.usedCount).toBe(0);
    expect(res.usage.reservedAmountMinor).toBe('0');
    const rows: Array<{ reserved_count: number; used_count: number }> = await dataSource.query(`SELECT reserved_count, used_count FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_count).toBe(1);
    expect(rows[0].used_count).toBe(0);
  });

  // 09 Multiple simultaneous windows (daily/weekly/monthly/yearly amount)
  it('09. multiple simultaneous windows — batch reserves all', async () => {
    const profile = 'MULTI_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const idem = `idem-multi-${randomUUID()}`;
    const hash = hashFor({ subjectId, profile, multi: true });
    const now = new Date('2026-09-27T10:00:00.000Z');
    const batch = await usageService.reserveBatch({
      principalType: 'CUSTOMER',
      principalId: subjectId,
      limitProfileCode: profile,
      reservations: [
        { dimension: 'DAILY_AMOUNT', product: 'WALLET_TRANSFER', currency: 'NGN', amountMinor: '500000' },
        { dimension: 'WEEKLY_AMOUNT', product: 'WALLET_TRANSFER', currency: 'NGN', amountMinor: '500000' },
        { dimension: 'MONTHLY_AMOUNT', product: 'WALLET_TRANSFER', currency: 'NGN', amountMinor: '500000' },
        { dimension: 'YEARLY_AMOUNT', product: 'WALLET_TRANSFER', currency: 'NGN', amountMinor: '500000' },
      ],
      idempotencyKey: idem,
      requestHash: hash,
      now,
    });
    expect(batch.kind).toBe('NEW');
    expect(batch.reservations.length).toBe(4);
    expect(batch.usages.length).toBe(4);
    const windowKeys = batch.usages.map((u:any)=>u.windowKey).sort();
    expect(windowKeys).toEqual(expect.arrayContaining(['2026-09-27:DAILY:Africa/Lagos']));
    // Each usage should have reserved 500000
    for (const u of batch.usages) expect(u.reservedAmountMinor).toBe('500000');
    // Verify 4 rows in DB
    const rows: Array<{ dimension: string }> = await dataSource.query(`SELECT dimension FROM limit_usages WHERE principal_id=$1 ORDER BY dimension`, [subjectId]);
    expect(rows.map(r=>r.dimension).sort()).toEqual(['DAILY_AMOUNT','MONTHLY_AMOUNT','WEEKLY_AMOUNT','YEARLY_AMOUNT']);
    // Also test count batch
    const idem2 = `idem-multi-cnt-${randomUUID()}`;
    const hash2 = hashFor({ subjectId, profile, cnt: true });
    const batch2 = await usageService.reserveBatch({
      principalType: 'CUSTOMER',
      principalId: subjectId,
      limitProfileCode: profile,
      reservations: [
        { dimension: 'DAILY_COUNT', product: 'WALLET_TRANSFER', currency: 'NGN', count: 1 },
        { dimension: 'WEEKLY_COUNT', product: 'WALLET_TRANSFER', currency: 'NGN', count: 1 },
        { dimension: 'MONTHLY_COUNT', product: 'WALLET_TRANSFER', currency: 'NGN', count: 1 },
        { dimension: 'YEARLY_COUNT', product: 'WALLET_TRANSFER', currency: 'NGN', count: 1 },
      ],
      idempotencyKey: idem2,
      requestHash: hash2,
      now,
    });
    expect(batch2.reservations.length).toBe(4);
    for (const u of batch2.usages) expect(u.reservedCount).toBe(1);
  });

  // 10 Multiple concurrent requests same window different idempotency keys
  it('10. multiple concurrent requests same window serialize via FOR UPDATE', async () => {
    const profile = 'CONC_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    const promises = Array.from({ length: 5 }, (_, i) => {
      const idem = `idem-conc-${i}-${randomUUID()}`;
      const hash = hashFor({ subjectId, profile, i });
      return usageService.reserve({
        principalType: 'CUSTOMER',
        principalId: subjectId,
        limitProfileCode: profile,
        product: 'WALLET_TRANSFER',
        dimension: 'DAILY_AMOUNT',
        currency: 'NGN',
        amountMinor: '100000',
        idempotencyKey: idem,
        requestHash: hash,
        now,
      });
    });
    const results = await Promise.all(promises);
    for (const r of results) expect(r.kind).toBe('NEW');
    const rows: Array<{ reserved_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows.length).toBe(1);
    expect(rows[0].reserved_amount_minor).toBe('500000'); // 5 * 100000
  });

  // 11 SERIALIZABLE retry behavior (exercised via concurrent inserts)
  it('11. SERIALIZABLE retry handles concurrent insert race', async () => {
    const profile = 'RETRY_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    // Two concurrent reservations for same window with different keys but same usage row creation race
    // Both will attempt to INSERT the usage row ON CONFLICT DO NOTHING; one will succeed insert, the other will do nothing then SELECT FOR UPDATE
    // This tests that our INSERT ... ON CONFLICT handles race without duplicate error
    const idem1 = `idem-retry-1-${randomUUID()}`;
    const idem2 = `idem-retry-2-${randomUUID()}`;
    const hash1 = hashFor({ idem1 });
    const hash2 = hashFor({ idem2 });
    const [r1, r2] = await Promise.all([
      usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'CASH_IN', dimension: 'DAILY_COUNT', currency: 'NGN', count: 1, idempotencyKey: idem1, requestHash: hash1, now }),
      usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'CASH_IN', dimension: 'DAILY_COUNT', currency: 'NGN', count: 1, idempotencyKey: idem2, requestHash: hash2, now }),
    ]);
    expect(r1.kind).toBe('NEW');
    expect(r2.kind).toBe('NEW');
    const rows: Array<{ reserved_count: number }> = await dataSource.query(`SELECT reserved_count FROM limit_usages WHERE principal_id=$1 AND dimension='DAILY_COUNT'`, [subjectId]);
    expect(rows[0].reserved_count).toBe(2);
  });

  // 12 SELECT FOR UPDATE pessimistic locking (concurrent same-window increments)
  it('12. SELECT FOR UPDATE serializes concurrent increments', async () => {
    const profile = 'LOCK_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    // Sequential reserve to create row
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'MONTHLY_AMOUNT', currency: 'NGN', amountMinor: '1000', idempotencyKey: `idem-lock-init-${randomUUID()}`, requestHash: hashFor({ init: 1 }), now });
    // Now 3 concurrent increments to same row
    const conc = await Promise.all(
      Array.from({ length: 3 }, (_, i) => usageService.reserve({
        principalType: 'CUSTOMER',
        principalId: subjectId,
        limitProfileCode: profile,
        product: 'WALLET_TRANSFER',
        dimension: 'MONTHLY_AMOUNT',
        currency: 'NGN',
        amountMinor: '500',
        idempotencyKey: `idem-lock-${i}-${randomUUID()}`,
        requestHash: hashFor({ i }),
        now,
      }))
    );
    expect(conc.every(c => c.kind === 'NEW')).toBe(true);
    const rows: Array<{ reserved_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1 AND dimension='MONTHLY_AMOUNT'`, [subjectId]);
    expect(rows[0].reserved_amount_minor).toBe('2500'); // 1000 + 3*500
  });

  // 13 Idempotent replay does not double-consume
  it('13. idempotent replay does not double-consume', async () => {
    const profile = 'IDEM_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const idem = `idem-replay-${randomUUID()}`;
    const hash = hashFor({ subjectId, profile, replay: 1 });
    const now = new Date('2026-09-27T10:00:00.000Z');
    const first = await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '200000', idempotencyKey: idem, requestHash: hash, now });
    expect(first.kind).toBe('NEW');
    const second = await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '200000', idempotencyKey: idem, requestHash: hash, now });
    expect(second.kind).toBe('REPLAY');
    const rows: Array<{ reserved_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_amount_minor).toBe('200000'); // not 400000
    // Third replay with same key but different amount should 409? Our service uses IdempotencyService which checks hash, so different hash => 409
    const differentHash = hashFor({ subjectId, profile, replay: 2 });
    await expect(usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '999999', idempotencyKey: idem, requestHash: differentHash, now })).rejects.toThrow();
    const rows2: Array<{ reserved_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows2[0].reserved_amount_minor).toBe('200000'); // still not incremented
  });

  // 14 Reservation release (failure path)
  it('14. reservation release decrements reserved (failure)', async () => {
    const profile = 'REL_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const idem = `idem-rel-${randomUUID()}`;
    const hash = hashFor({ rel: 1 });
    const now = new Date('2026-09-27T10:00:00.000Z');
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '300000', idempotencyKey: idem, requestHash: hash, now });
    let rows: Array<{ reserved_amount_minor: string; used_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text, used_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_amount_minor).toBe('300000');
    expect(rows[0].used_amount_minor).toBe('0');
    const rel = await usageService.release({ idempotencyKey: idem });
    expect(rel.released).toBe(1);
    rows = await dataSource.query(`SELECT reserved_amount_minor::text, used_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_amount_minor).toBe('0');
    expect(rows[0].used_amount_minor).toBe('0');
    const rRows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE idempotency_key=$1`, [idem]);
    expect(rRows[0].status).toBe('RELEASED');
    // idempotent release replay
    const rel2 = await usageService.release({ idempotencyKey: idem });
    expect(rel2.released).toBe(0);
  });

  // 15 Commit/finalize behavior
  it('15. commit moves reserved to used', async () => {
    const profile = 'COM_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const idem = `idem-com-${randomUUID()}`;
    const hash = hashFor({ com: 1 });
    const now = new Date('2026-09-27T10:00:00.000Z');
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_COUNT', currency: 'NGN', count: 1, idempotencyKey: idem, requestHash: hash, now });
    let rows: Array<{ reserved_count: number; used_count: number }> = await dataSource.query(`SELECT reserved_count, used_count FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_count).toBe(1);
    expect(rows[0].used_count).toBe(0);
    const com = await usageService.commit({ idempotencyKey: idem });
    expect(com.committed).toBe(1);
    rows = await dataSource.query(`SELECT reserved_count, used_count FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_count).toBe(0);
    expect(rows[0].used_count).toBe(1);
    const rRows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM limit_reservations WHERE idempotency_key=$1`, [idem]);
    expect(rRows[0].status).toBe('COMMITTED');
    // commit replay
    const com2 = await usageService.commit({ idempotencyKey: idem });
    expect(com2.committed).toBe(0);
  });

  // 16 Concurrent same-window reservations (stress)
  it('16. concurrent same-window reservations sum correctly', async () => {
    const profile = 'STRESS_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    const n = 10;
    const promises = Array.from({ length: n }, (_, i) => {
      const idem = `idem-stress-${i}-${randomUUID()}`;
      return usageService.reserveBatch({
        principalType: 'CUSTOMER',
        principalId: subjectId,
        limitProfileCode: profile,
        reservations: [{ dimension: 'DAILY_COUNT', product: 'WALLET_TRANSFER', currency: 'NGN', count: 1 }],
        idempotencyKey: idem,
        requestHash: hashFor({ i, stress: 1 }),
        now,
      });
    });
    const results = await Promise.all(promises);
    expect(results.every(r => r.kind === 'NEW')).toBe(true);
    const rows: Array<{ reserved_count: number }> = await dataSource.query(`SELECT reserved_count FROM limit_usages WHERE principal_id=$1`, [subjectId]);
    expect(rows[0].reserved_count).toBe(n);
  });

  // 17 Different subjects do not collide
  it('17. different subjects do not collide', async () => {
    const profile = 'SUBJ_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subj1 = randomUUID();
    const subj2 = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subj1, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '100000', idempotencyKey: `idem-s1-${randomUUID()}`, requestHash: hashFor({ s:1 }), now });
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subj2, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '200000', idempotencyKey: `idem-s2-${randomUUID()}`, requestHash: hashFor({ s:2 }), now });
    const rows1: Array<{ reserved_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subj1]);
    const rows2: Array<{ reserved_amount_minor: string }> = await dataSource.query(`SELECT reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1`, [subj2]);
    expect(rows1[0].reserved_amount_minor).toBe('100000');
    expect(rows2[0].reserved_amount_minor).toBe('200000');
  });

  // 18 Different products/rules do not collide
  it('18. different products do not collide', async () => {
    const profile = 'PROD_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '100000', idempotencyKey: `idem-p1-${randomUUID()}`, requestHash: hashFor({ p:1 }), now });
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'CASH_IN', dimension: 'DAILY_AMOUNT', currency: 'NGN', amountMinor: '50000', idempotencyKey: `idem-p2-${randomUUID()}`, requestHash: hashFor({ p:2 }), now });
    const rows: Array<{ product: string; reserved_amount_minor: string }> = await dataSource.query(`SELECT product, reserved_amount_minor::text FROM limit_usages WHERE principal_id=$1 ORDER BY product`, [subjectId]);
    expect(rows.length).toBe(2);
    const map = Object.fromEntries(rows.map(r=>[r.product, r.reserved_amount_minor]));
    expect(map['CASH_IN']).toBe('50000');
    expect(map['WALLET_TRANSFER']).toBe('100000');
    // also test currency separation
    await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: profile, product: 'WALLET_TRANSFER', dimension: 'DAILY_AMOUNT', currency: 'USD', amountMinor: '999', idempotencyKey: `idem-cur-${randomUUID()}`, requestHash: hashFor({ cur:1 }), now });
    const usdRows: Array<{ currency: string }> = await dataSource.query(`SELECT currency FROM limit_usages WHERE principal_id=$1 AND product='WALLET_TRANSFER' AND dimension='DAILY_AMOUNT' ORDER BY currency`, [subjectId]);
    expect(usdRows.map(r=>r.currency).sort()).toEqual(['NGN','USD']);
  });

  // 19 No Tier 1/2/3 assumptions
  it('19. no Tier 1/2/3 assumptions — arbitrary profile codes', async () => {
    const codes = ['ARBITRARY_XYZ', 'TIER_100', 'VIP_PLUS', 'KYC_SUPER_9'];
    for (const c of codes) await seedProfile(c);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    for (const c of codes) {
      const res = await usageService.reserve({ principalType: 'CUSTOMER', principalId: subjectId, limitProfileCode: c, product: 'WALLET_TRANSFER', dimension: 'DAILY_COUNT', currency: 'NGN', count: 1, idempotencyKey: `idem-tier-${c}-${randomUUID()}`, requestHash: hashFor({ c }), now });
      expect(res.kind).toBe('NEW');
    }
    const rows: Array<{ limit_profile_code: string }> = await dataSource.query(`SELECT DISTINCT limit_profile_code FROM limit_usages WHERE principal_id=$1 ORDER BY limit_profile_code`, [subjectId]);
    expect(rows.map(r=>r.limit_profile_code).sort()).toEqual(codes.sort());
    // Verify service file has no hardcoded tier
    const fs = require('node:fs');
    const svc = fs.readFileSync('src/limit-catalog/limit-usage.service.ts','utf8');
    const ent = fs.readFileSync('src/limit-catalog/limit-usage.entity.ts','utf8');
    const win = fs.readFileSync('src/limit-catalog/limit-window.util.ts','utf8');
    for (const bad of ['TIER_1','TIER_2','TIER_3','if (tier','if(tier']) {
      expect(svc).not.toContain(bad);
      expect(ent).not.toContain(bad);
      expect(win).not.toContain(bad);
    }
  });

  // 20 No ledger mutation
  it('20. no ledger mutation — usages do not touch wallets/ledger', async () => {
    const profile = 'LEDG_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const beforeWallets: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM wallet_accounts`);
    const beforeLines: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_lines`);
    const beforeJournals: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_journals`);
    const subjectId = randomUUID();
    const now = new Date('2026-09-27T10:00:00.000Z');
    await usageService.reserveBatch({
      principalType: 'CUSTOMER',
      principalId: subjectId,
      limitProfileCode: profile,
      reservations: [
        { dimension: 'DAILY_AMOUNT', product: 'WALLET_TRANSFER', currency: 'NGN', amountMinor: '100000' },
        { dimension: 'DAILY_COUNT', product: 'WALLET_TRANSFER', currency: 'NGN', count: 1 },
      ],
      idempotencyKey: `idem-ledger-${randomUUID()}`,
      requestHash: hashFor({ ledger: 1 }),
      now,
    });
    const afterWallets: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM wallet_accounts`);
    const afterLines: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_lines`);
    const afterJournals: Array<{ count: string }> = await dataSource.query(`SELECT COUNT(*)::text as count FROM ledger_journals`);
    expect(afterWallets[0].count).toBe(beforeWallets[0].count);
    expect(afterLines[0].count).toBe(beforeLines[0].count);
    expect(afterJournals[0].count).toBe(beforeJournals[0].count);
  });

  // 21 No transaction-flow behavior change
  it('21. no TransferService wiring — usage does not auto-reject transfers', async () => {
    const svc = require('node:fs').readFileSync('src/transfer/transfer.service.ts','utf8');
    expect(svc).not.toContain('LimitUsageService');
    expect(svc).not.toContain('limit_usages');
    const usageSvc = require('node:fs').readFileSync('src/limit-catalog/limit-usage.service.ts','utf8');
    expect(usageSvc).not.toContain('TransferService');
    expect(usageSvc).not.toContain('LedgerService');
    // Ensure WALLET_BALANCE_MAX not used as window
    const ent = require('node:fs').readFileSync('src/limit-catalog/limit-usage.entity.ts','utf8');
    expect(ent).not.toContain('WALLET_BALANCE_MAX');
    // Verify that reserving WALLET_BALANCE_MAX dimension throws
    const profile = 'WALLET_' + randomUUID().slice(0,6).toUpperCase();
    await seedProfile(profile);
    const subjectId = randomUUID();
    await expect(usageService.reserve({
      principalType: 'CUSTOMER',
      principalId: subjectId,
      limitProfileCode: profile,
      product: 'WALLET_TRANSFER',
      dimension: 'WALLET_BALANCE_MAX',
      currency: 'NGN',
      amountMinor: '1000',
      idempotencyKey: `idem-wallet-${randomUUID()}`,
      requestHash: hashFor({ wallet: 1 }),
    })).rejects.toThrow();
  });
});
