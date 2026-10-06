/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
/**
 * V1-HARDEN-01 — SupportAuthenticationService.provision() concurrent-duplicate-username race
 * (real PostgreSQL).
 *
 * Context: the audit found that provision()'s existence pre-check (`findOne`) and its insert
 * are not atomic. Two concurrent calls for the same username can both pass the pre-check and
 * race on the DB's partial unique index (uq_support_workforce_users_username_active). Before
 * the fix, the service did not catch the resulting unique-violation, so the losing call(s)
 * surfaced as a raw, uncaught `QueryFailedError` instead of the same `ConflictException` the
 * non-racing duplicate path already returns. The client-visible symptom was an avoidable
 * generic 500 (GlobalExceptionFilter redacts the raw Postgres error, so nothing leaked to the
 * client — this is a correctness/availability defect, not an information-disclosure one) for
 * what is really a benign duplicate-identity condition.
 *
 * Reproduced directly against the service (bypassing the HTTP layer, where per-request
 * overhead happens to widen the race window enough to usually mask it in this environment)
 * with real concurrent PostgreSQL transactions — no mocks.
 */
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { SupportAuthenticationService } from '../src/support-authentication/support-authentication.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

describe('V1-HARDEN-01 SupportAuthenticationService.provision() concurrent-duplicate-username race (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let moduleRef: any;
  let supportAuthentication: SupportAuthenticationService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1harden01raceprov');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    supportAuthentication = moduleRef.get(SupportAuthenticationService);
  }, 180000);

  afterAll(async () => {
    if (moduleRef) await moduleRef.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  it('every losing concurrent provision() call for the same username fails with ConflictException, never a raw QueryFailedError', async () => {
    const username = `race.support.${randomUUID().slice(0, 8)}`;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }).map(() =>
        supportAuthentication.provision({ username, actor: 'test-operator' }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) {
      // Before the fix, most of these were raw TypeORM QueryFailedError instances
      // ("duplicate key value violates unique constraint ..."), not ConflictException.
      expect(r.reason).toBeInstanceOf(ConflictException);
      expect(r.reason).not.toBeInstanceOf(QueryFailedError);
    }

    const rows: Array<{ count: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS count FROM support_workforce_users WHERE username = $1`,
      [username],
    );
    expect(rows[0]!.count).toBe('1');
  }, 30000);
});
