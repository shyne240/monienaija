/**
 * Combined Banking + reconciliation migration resolution (real PostgreSQL).
 *
 * Independent candidates extend the integration schema:
 *
 *   1785753600810  CustomerTierDefaultClassMappings   (PR #50, appended after 0813 was published)
 *   1785753600811  LimitRuleUnlimited                  (PR #50, same append)
 *   1785753600812  CustomerRestrictionConfigurationReview (PR #50, same append)
 *   1785753600900  BankToWalletMonnifyJourney          (PR #40 Banking adapter migration)
 *   1785753600901  BankToWalletReturnRefunds           (governed Bank→Wallet return refunds)
 *   1785753600910  SettlementReportReconciliation      (PR #51, Arena 10)
 *
 * They were authored on separate branches, and the first three were published *below* an already
 * published head (0813). The resolution therefore has to prove — not assert — that:
 *
 *  - every published identity keeps its exact timestamp and class name (nothing is renumbered);
 *  - a **fresh install** applies the whole chain once, in timestamp order, and a replay is a no-op;
 *  - an **upgrade from the current integration schema** (175 identities, 0813 head) applies exactly
 *    the three Banking/reconciliation identities;
 *  - an **upgrade from the pre-#50 integration schema** (172 identities, 0813 head) applies the
 *    three tier-default identities and then the three Banking/reconciliation identities, in
 *    timestamp order, without touching anything already recorded.
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

const TIER_DEFAULTS = [
  'CustomerTierDefaultClassMappings1785753600810',
  'LimitRuleUnlimited1785753600811',
  'CustomerRestrictionConfigurationReview1785753600812',
] as const;
const BANKING = 'BankToWalletMonnifyJourney1785753600900';
const RETURN_REFUNDS = 'BankToWalletReturnRefunds1785753600901';
const RECONCILIATION = 'SettlementReportReconciliation1785753600910';
const INTEGRATION_HEAD = 'CreatePlatformFundsBankComparisons1785753600813';
const COMBINED_HEAD = '1785753600910';
const BANKING_AND_RECONCILIATION = [BANKING, RETURN_REFUNDS, RECONCILIATION] as const;
const APPENDED = [...TIER_DEFAULTS, ...BANKING_AND_RECONCILIATION] as const;

const INTEGRATION_SCHEMA_SIZE = 175;
const LEGACY_INTEGRATION_SCHEMA_SIZE = 172;
const COMBINED_SCHEMA_SIZE = 178;

interface MigrationFile {
  timestamp: number;
  name: string;
}

function filesystemMigrations(): MigrationFile[] {
  return readdirSync(join(__dirname, '../src/migrations'))
    .filter((file) => /^\d{13}-.+\.ts$/.test(file))
    .map((file) => {
      const timestamp = Number(file.slice(0, 13));
      // Class name in this repository is `<Name><timestamp>`; the filename prefixes the timestamp.
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
function withoutMigrations(ds: DataSource, excluded: readonly string[]): void {
  ds.migrations.splice(
    0,
    ds.migrations.length,
    ...ds.migrations.filter((migration) => !excluded.includes(migration.name ?? '')),
  );
}

describe('Banking + settlement-reconciliation migration resolution (real PostgreSQL)', () => {
  it('publishes every appended identity on the exact timestamp its branch authored', () => {
    const onDisk = filesystemMigrations();
    const byName = new Map(onDisk.map((migration) => [migration.name, migration.timestamp]));
    expect(byName.get(TIER_DEFAULTS[0])).toBe(1785753600810);
    expect(byName.get(TIER_DEFAULTS[1])).toBe(1785753600811);
    expect(byName.get(TIER_DEFAULTS[2])).toBe(1785753600812);
    expect(byName.get(BANKING)).toBe(1785753600900);
    expect(byName.get(RETURN_REFUNDS)).toBe(1785753600901);
    expect(byName.get(RECONCILIATION)).toBe(1785753600910);

    // Nothing was renumbered: the tier-default identities sit below the published integration head,
    // and the three Banking/reconciliation identities are the last three in the chain.
    const integrationHead = byName.get(INTEGRATION_HEAD)!;
    for (const name of TIER_DEFAULTS) expect(byName.get(name)!).toBeLessThan(integrationHead);
    expect(integrationHead).toBeLessThan(1785753600900);
    expect(onDisk.at(-3)!.name).toBe(BANKING);
    expect(onDisk.at(-2)!.name).toBe(RETURN_REFUNDS);
    expect(onDisk.at(-1)!.name).toBe(RECONCILIATION);

    // Ordered, unique identities across the whole chain.
    expect(onDisk.map((migration) => migration.timestamp)).toEqual(
      [...onDisk.map((migration) => migration.timestamp)].sort((left, right) => left - right),
    );
    expect(new Set(onDisk.map((migration) => migration.timestamp)).size).toBe(onDisk.length);
    expect(new Set(onDisk.map((migration) => migration.name)).size).toBe(onDisk.length);
  });

  it('fresh install applies all 178 identities once, in order, ending at 0910; replay applies nothing', async () => {
    const onDisk = filesystemMigrations();
    expect(onDisk).toHaveLength(COMBINED_SCHEMA_SIZE);
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

  it('upgrades the current integration schema by applying exactly 0900, 0901 and 0910', async () => {
    const ds = await createEmptyIntegrationDataSource('bankreconup');
    try {
      await ds.initialize();
      const full = [...ds.migrations];
      withoutMigrations(ds, BANKING_AND_RECONCILIATION);
      await ds.runMigrations({ transaction: 'all' });
      const before = await appliedLedger(ds);
      expect(before).toHaveLength(INTEGRATION_SCHEMA_SIZE);
      expect(before.at(-1)!.name).toBe(INTEGRATION_HEAD);
      for (const name of BANKING_AND_RECONCILIATION) {
        expect(before.map((migration) => migration.name)).not.toContain(name);
      }

      // Hand the same database the combined application, exactly as a deployment would.
      ds.migrations.splice(0, ds.migrations.length, ...full);
      const upgraded = await ds.runMigrations({ transaction: 'all' });
      expect(upgraded.map((migration) => migration.name)).toEqual([...BANKING_AND_RECONCILIATION]);

      const after = await appliedLedger(ds);
      expect(after).toHaveLength(COMBINED_SCHEMA_SIZE);
      // Every identity the database already had is preserved, in the same order.
      expect(after.slice(0, INTEGRATION_SCHEMA_SIZE)).toEqual(before);
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

  it('upgrades the pre-#50 integration schema by applying the tier defaults and then Banking in timestamp order', async () => {
    const ds = await createEmptyIntegrationDataSource('bankreconlegacy');
    try {
      await ds.initialize();
      const full = [...ds.migrations];
      withoutMigrations(ds, APPENDED);
      await ds.runMigrations({ transaction: 'all' });
      const before = await appliedLedger(ds);
      expect(before).toHaveLength(LEGACY_INTEGRATION_SCHEMA_SIZE);
      expect(before.at(-1)!.name).toBe(INTEGRATION_HEAD);

      ds.migrations.splice(0, ds.migrations.length, ...full);
      const upgraded = await ds.runMigrations({ transaction: 'all' });
      // Timestamp order, not authoring order: 0810-0812 were published below the existing head.
      expect(upgraded.map((migration) => migration.name)).toEqual([...APPENDED]);

      const after = await appliedLedger(ds);
      expect(after).toHaveLength(COMBINED_SCHEMA_SIZE);
      // The ledger is ordered by timestamp, so the newly applied 0810-0812 rows land *before* the
      // already-published 0813 head. Every earlier identity must still be present exactly once.
      for (const migration of before) {
        expect(after.filter((row) => row.name === migration.name)).toEqual([migration]);
      }
      expect(after.at(-1)!.name).toBe(RECONCILIATION);
      await expect(ds.showMigrations()).resolves.toBe(false);
      await expect(ds.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
    } finally {
      await destroyIntegrationDataSource(ds);
    }
  }, 300_000);
});
