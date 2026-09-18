import type { DataSource } from 'typeorm';

import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
} from './support/pg-harness';

/**
 * Real-PostgreSQL migration-chain coverage.
 *
 * Executes the complete migration chain against a genuinely empty database. This is the
 * suite that would have caught the duplicate-unique-index defect in migrations 031-038 and
 * the foreign-keys-onto-non-unique-column defect in migrations 043/044, both of which are
 * invisible to unit tests.
 */
describe('migration chain (real PostgreSQL)', () => {
  let dataSource: DataSource;
  const expectedMigrations = 53;

  beforeAll(async () => {
    dataSource = await createEmptyIntegrationDataSource('migchain');
    await dataSource.initialize();
  }, 120000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  it('starts from a genuinely empty database', async () => {
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('executes every migration from empty in a single atomic chain', async () => {
    const executed = await dataSource.runMigrations({ transaction: 'all' });
    expect(executed).toHaveLength(expectedMigrations);
  });

  it('leaves zero pending migrations', async () => {
    await expect(dataSource.showMigrations()).resolves.toBe(false);
  });

  it('records exactly the discovered migrations in the ledger', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT count(*)::text AS count FROM typeorm_migrations',
    );
    expect(Number(firstRow(rows, 'migration ledger count').count)).toBe(expectedMigrations);
    expect(dataSource.migrations).toHaveLength(expectedMigrations);
  });

  it('creates every foreign key in a validated state', async () => {
    const unvalidated: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`,
    );
    expect(unvalidated).toEqual([]);
    const counts: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text AS count FROM pg_constraint WHERE contype = 'f'`,
    );
    expect(Number(firstRow(counts, 'foreign key count').count)).toBeGreaterThan(100);
  });

  it('declares no duplicate relation names between constraints and indexes', async () => {
    const duplicates: Array<{ relname: string }> = await dataSource.query(
      `SELECT relname FROM pg_class WHERE relkind = 'i' GROUP BY relname HAVING count(*) > 1`,
    );
    expect(duplicates).toEqual([]);
  });

  describe('B2 API consumer identity (migration 043)', () => {
    it('constrains consumer_id uniquely so its foreign keys are creatable', async () => {
      const rows: Array<{ contype: string }> = await dataSource.query(
        `SELECT contype FROM pg_constraint
          WHERE conrelid = 'b2_api_consumer'::regclass
            AND conname = 'uq_b2_api_consumer_consumer_id'`,
      );
      expect(rows).toEqual([{ contype: 'u' }]);
    });

    it('keeps all three declared foreign keys pointing at consumer_id', async () => {
      const rows: Array<{ conname: string }> = await dataSource.query(
        `SELECT conname FROM pg_constraint
          WHERE contype = 'f' AND confrelid = 'b2_api_consumer'::regclass
          ORDER BY conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual([
        'fk_b2_api_credential_consumer',
        'fk_b2_api_quota_consumer',
        'fk_b2_rate_limit_consumer',
      ]);
    });

    it('quotes the reserved word "window" in b2_api_quota', async () => {
      const rows: Array<{ column_name: string }> = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'b2_api_quota' AND column_name = 'window'`,
      );
      expect(rows).toHaveLength(1);
      await expect(
        dataSource.query(`SELECT "window" FROM b2_api_quota WHERE false`),
      ).resolves.toEqual([]);
    });
  });

  describe('B2 webhook identity (migration 044)', () => {
    it('constrains registration_id uniquely so its foreign key is creatable', async () => {
      const rows: Array<{ contype: string }> = await dataSource.query(
        `SELECT contype FROM pg_constraint
          WHERE conrelid = 'b2_webhook_registration'::regclass
            AND conname = 'uq_b2_webhook_registration_registration_id'`,
      );
      expect(rows).toEqual([{ contype: 'u' }]);
    });

    it('keeps the delivery foreign key pointing at registration_id', async () => {
      const rows: Array<{ conname: string }> = await dataSource.query(
        `SELECT conname FROM pg_constraint
          WHERE contype = 'f' AND confrelid = 'b2_webhook_registration'::regclass`,
      );
      expect(rows.map((r) => r.conname)).toEqual(['fk_b2_webhook_delivery_registration']);
    });
  });

  describe('A5 transfer accounting unit (migration 001/023)', () => {
    it('exposes the column in snake_case only', async () => {
      const rows: Array<{ column_name: string }> = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'transfers' AND lower(column_name) = 'accounting_unit'`,
      );
      expect(rows).toEqual([{ column_name: 'accounting_unit' }]);
    });

    it('has no camelCase counterpart that the entity could drift onto', async () => {
      const rows: Array<{ column_name: string }> = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'transfers' AND column_name = 'accountingUnit'`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('A6T08 settlement posting constraint (migration 029)', () => {
    it('permits the reversal reference only once status is REVERSED', async () => {
      const defs: Array<{ def: string }> = await dataSource.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'chk_external_settlements_posted_journal'`,
      );
      const { def } = firstRow(defs, 'A6T08 posted-journal constraint');
      expect(def).toContain("'REVERSED'");
      expect(def).toContain('reversal_journal_id IS NOT NULL');
      expect(def).toContain('reversal_journal_id IS NULL');
    });
  });

  it('keeps the TypeORM entity metadata consistent with the migrated schema', async () => {
    const missing: string[] = [];
    for (const meta of dataSource.entityMetadatas) {
      const rows: Array<{ table_name: string }> = await dataSource.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1`,
        [meta.tableName],
      );
      if (!rows.length) {
        missing.push(meta.tableName);
        continue;
      }
      for (const column of meta.columns) {
        const col: Array<{ column_name: string }> = await dataSource.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [meta.tableName, column.databaseName],
        );
        if (!col.length) missing.push(`${meta.tableName}.${column.databaseName}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
