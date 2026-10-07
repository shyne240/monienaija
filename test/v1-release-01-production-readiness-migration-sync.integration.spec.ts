import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { ProductionReadinessService } from '../src/production/production-readiness.service';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

/**
 * V1-RELEASE-01 regression coverage.
 *
 * `ProductionReadinessService` hardcodes the expected latest-migration timestamp/name and
 * compares it against whatever is actually recorded in the database's migrations table at
 * startup, refusing to boot (`schema_incompatible`) on any mismatch. That constant has
 * already drifted from the real latest migration file twice during normal feature work
 * (stayed at 1785753600079 while migrations 080 and 081 were added), and each time it did,
 * a freshly and fully migrated production database would have failed to start — exactly the
 * kind of defect that is invisible to the existing mocked unit test
 * (`test/production-readiness.spec.ts`), because that test's fake DataSource simply returns
 * whatever timestamp/name the test itself hardcodes, so it can never catch the constant
 * falling behind the real migration chain.
 *
 * This suite closes that gap: it runs the complete, real migration chain against real
 * PostgreSQL (the same chain `migration-chain.integration.spec.ts` validates structurally)
 * and then asks the real `ProductionReadinessService`, wired through the real `AppModule`,
 * whether it considers that genuinely-fully-migrated schema compatible. It deliberately uses
 * `createIntegrationDataSourceFromScratch` (full migration run from an empty database) rather
 * than the template-cloning `createIntegrationDataSource`, because running the real migration
 * chain from empty is exactly what this suite exists to prove — cloning an already-migrated
 * template would silently stop testing that. If the constants in
 * production-readiness.service.ts ever again fall behind the newest file in
 * src/migrations/*.ts, this test fails with `schema_incompatible` — the same failure a real
 * production deployment would hit — instead of silently passing.
 */
describe('V1-RELEASE-01 production readiness vs. real migration chain', () => {
  let dataSource: DataSource;
  let readinessService: ProductionReadinessService;

  const latestMigrationFile = readdirSync(join(__dirname, '../src/migrations'))
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .at(-1);

  beforeAll(async () => {
    dataSource = await createIntegrationDataSourceFromScratch('readinesssync');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    readinessService = moduleRef.get(ProductionReadinessService);
  }, 180_000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60_000);

  it('found at least one migration file on disk (guards against the glob matching nothing)', () => {
    expect(latestMigrationFile).toBeDefined();
  });

  it('considers a database migrated by the real, complete migration chain to be schema-compatible', async () => {
    const readiness = await readinessService.getReadiness();

    // The precise assertion that matters: if EXPECTED_MIGRATION_TIMESTAMP/NAME in
    // production-readiness.service.ts ever fall behind the real latest migration file again,
    // `migrations.compatible` becomes false and `status` becomes 'error' with
    // reason 'schema_incompatible' — reproducing, in CI, the exact startup failure a real
    // production deployment would hit on a freshly-migrated database.
    expect(readiness.migrations.compatible).toBe(true);
    expect(readiness.status).not.toBe('error');
    if (readiness.status === 'error') {
      expect(readiness.reason).not.toBe('schema_incompatible');
    }
  });

  it('verifyStartup() does not throw against the real, fully-migrated schema', async () => {
    await expect(readinessService.verifyStartup()).resolves.toBeUndefined();
  });
});
