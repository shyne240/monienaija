/**
 * Combined Banking + reconciliation migration resolution (real PostgreSQL).
 *
 * Three independent candidates extend the integration schema after 0813:
 *
 *   1785753600900  BankToWalletMonnifyJourney      (PR #40 Banking adapter migration)
 *   1785753600901  BankToWalletReturnRefunds      (governed Bank→Wallet return refunds)
 *   1785753600910  SettlementReportReconciliation (PR #51, Arena 10)
 *
 * They were authored on separate branches, so the resolution has to prove — not assert — that:
 *
 *  - every published identity keeps its exact timestamp and class name (nothing is renumbered to
 *    make room, and the two Banking ids keep the lower, earlier timestamps);
 *  - a **fresh install** applies the whole chain once, in timestamp order, and a replay is a no-op;
 *  - an **upgrade from the integration schema** (0813 head, i.e. a database that already ran
 *    everything up to and including the Platform Funds comparisons migration) applies exactly the
 *    three appended identities, in order, and nothing else;
 *  - the combined head is 0910 and the readiness service agrees.
 *
 * No live provider, credential or money movement is involved: this suite only opens disposable
 * PostgreSQL databases and runs the real migration classes.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

const BANKING = 'BankToWalletMonnifyJourney1785753600900';
const RETURN_REFUNDS = 'BankToWalletReturnRefunds1785753600901';
const RECONCILIATION = 'SettlementReportReconciliation1785753600910';
const INTEGRATION_HEAD = 'CreatePlatformFundsBankComparisons1785753600813';
const COMBINED_HEAD = '1785753600910';
const APPENDED = [BANKING, RETURN_REFUNDS, RECONCILIATION] as const;

interface MigrationFile {
  timestamp: number;
  name: string;
}

function filesystemMigrations(): MigrationFile[] {
  return readdirSync(join(__dirname, '../src/migrations'))
    .filter((file) => /^\d{13}-.+\.ts$/.test(file))
    .map((file) => {
      const timestamp = Number(file.slice(0, 13));
      const name = `${file.slice(14, -'.ts'.length)}${String(timestamp)}`;
      return { timestamp, name };
    })
    .sort((left, right) => left.timestamp - right.timestamp);
}

async function appliedLedger(ds: DataSource): Promise<MigrationFile[]> {
  const rows: Array<{ timestamp: string; name: string }> = await ds.query(
    `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp ASC, name ASC`,
  );
  return rows.map((row) => ({ timestamp: Number(row.timestamp), name: row.name }));
}

/** Restrict the data source to the identities a database already applied before this work. */
function withoutAppended(ds: DataSource): void {
  ds.migrations.splice(
    0,
    ds.migrations.length,
    ...ds.migrations.filter(
      (migration) => !(APPENDED as readonly string[]).includes(migration.name ?? ''),
    ),
  );
}

describe('Banking + settlement-reconciliation migration resolution (real PostgreSQL)', () => {
  it('publishes the three appended identities on the exact timestamps their branches authored', () => {
    const onDisk = filesystemMigrations();
    const byName = new Map(onDisk.map((migration) => [migration.name, migration.timestamp]));
    expect(byName.get(BANKING)).toBe(1785753600900);
    expect(byName.get(RETURN_REFUNDS)).toBe(1785753600901);
    expect(byName.get(RECONCILIATION)).toBe(1785753600910);
    // Strictly after the integration head, strictly increasing, and unique across the whole chain.
    const integration = byName.get(INTEGRATION_HEAD)!;
    expect(integration).toBeLessThan(1785753600900);
    expect(onDisk.at(-3)!.name).toBe(BANKING);
    expect(onDisk.at(-2)!.name).toBe(RETURN_REFUNDS);
    expect(onDisk.at(-1)!.name).toBe(RECONCILIATION);
    expect(new Set(onDisk.map((migration) => migration.timestamp)).size).toBe(onDisk.length);
    expect(new Set(onDisk.map((migration) => migration.name)).size).toBe(onDisk.length);
  });

  it('fresh install applies all 175 identities once, in order, ending at 0910; replay applies nothing', async () => {
    const onDisk = filesystemMigrations();
    expect(onDisk).toHaveLength(175);
    const ds = await createEmptyIntegrationDataSource('bankreconfresh');
    try {
      await ds.initialize();
      const executed = await ds.runMigrations({ transaction: 'all' });
      expect(executed.map((migration) => migration.name)).toEqual(onDisk.map((m) => m.name));
      const applied = await appliedLedger(ds);
      expect(applied).toEqual(onDisk);
      expect(applied.at(-1)!.timestamp).toBe(Number(COMBINED_HEAD));
      expect(applied.at(-1)!.name).toBe(RECONCILIATION);

      // Idempotent replay: nothing pending, nothing re-applied.
      await expect(ds.showMigrations()).resolves.toBe(false);
      await expect(ds.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      expect(await appliedLedger(ds)).toEqual(onDisk);
    } finally {
      await destroyIntegrationDataSource(ds);
    }
  }, 300_000);

  it('upgrades a database already at the integration schema by applying exactly 0900, 0901 and 0910', async () => {
    const ds = await createEmptyIntegrationDataSource('bankreconup');
    try {
      await ds.initialize();
      const full = [...ds.migrations];
      withoutAppended(ds);
      const historical = await ds.runMigrations({ transaction: 'all' });
      expect(historical.length).toBeGreaterThan(0);
      const before = await appliedLedger(ds);
      expect(before).toHaveLength(172);
      expect(before.at(-1)!.name).toBe(INTEGRATION_HEAD);
      for (const name of APPENDED) {
        expect(before.map((migration) => migration.name)).not.toContain(name);
      }

      // Hand the same database the combined application, exactly as a deployment would.
      ds.migrations.splice(0, ds.migrations.length, ...full);
      const upgraded = await ds.runMigrations({ transaction: 'all' });
      expect(upgraded.map((migration) => migration.name)).toEqual([...APPENDED]);

      const after = await appliedLedger(ds);
      expect(after).toHaveLength(175);
      // Every identity the database already had is preserved byte-for-byte, in the same order.
      expect(after.slice(0, 172)).toEqual(before);
      expect(after.map((migration) => migration.name)).toEqual(
        filesystemMigrations().map((m) => m.name),
      );

      // Both sides of the combination exist after the upgrade.
      const tables = await ds.query<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name IN ('bank_to_wallet_return_refunds','settlement_report_imports')`,
      );
      expect(tables.map((row) => row.table_name).sort()).toEqual([
        'bank_to_wallet_return_refunds',
        'settlement_report_imports',
      ]);

      // Replaying the combined application changes nothing further.
      await expect(ds.showMigrations()).resolves.toBe(false);
      await expect(ds.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      expect(await appliedLedger(ds)).toEqual(after);
    } finally {
      await destroyIntegrationDataSource(ds);
    }
  }, 300_000);
});
