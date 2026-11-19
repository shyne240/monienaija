import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';

import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
} from './support/pg-harness';

/**
 * ARENA 5 Group 3 — combined-chain verification on the consolidated sources.
 *
 * The two frozen predecessors contributed disjoint migration sets to the same combined 164-identity
 * chain: Arena 3D added 0606–0614, Arena 2C added 0800–0802, and the shared 152 identities are
 * byte-identical in both freezes (verified by filesystem diff against both frozen trees). Re-applying
 * history is how a ledger gets two copies of a fact, so this suite proves the three upgrade paths the
 * consolidated application will actually meet, against real PostgreSQL — never against a template or a
 * mock:
 *
 *  1. upgrade from an Arena 3D database (chain applied through 0614) — the combined application must
 *     apply exactly 0800–0802 on top of it, in order, and nothing else;
 *  2. upgrade from an Arena 2C database (chain applied through 0802) — the combined application must
 *     apply exactly 0606–0614 on top of it, in order, and nothing else;
 *  3. a full fresh install plus idempotent replay, with the applied ledger compared identity-for-identity
 *     against the migration files on disk — 164 timestamp/name pairs, unique, head 1785753600802.
 *
 * No migration is renumbered, rewritten or skipped anywhere in this suite; the only variable is which
 * subset of the real configured chain a database has already applied.
 */

const ARENA3D_ONLY = [
  'OutboxLeasesAndDeadLetters1785753600606',
  'IntegritySnapshots1785753600607',
  'EmergencyAccessReviewRequirement1785753600608',
  'FraudRiskSignals1785753600609',
  'ComplianceRegister1785753600610',
  'ComplaintsAndDisputes1785753600611',
  'MobileClientSupport1785753600612',
  'NotificationDeliveryReceipts1785753600613',
  'PrivacyAndRetention1785753600614',
] as const;

const ARENA2C_ONLY = [
  'BindWalletTransferQuotes1785753600800',
  'AgentVerifiedPhone1785753600801',
  'ExtendBeneficiaryOwnership1785753600802',
] as const;

const COMBINED_HEAD_TIMESTAMP = 1785753600802;
const COMBINED_HEAD_NAME = 'ExtendBeneficiaryOwnership1785753600802';

interface MigrationFile {
  timestamp: number;
  name: string;
}

function filesystemMigrations(): MigrationFile[] {
  return readdirSync(join(__dirname, '../src/migrations'))
    .filter((f) => /^\d{13}-.+\.ts$/.test(f))
    .map((f) => {
      const timestamp = Number(f.slice(0, 13));
      // Class name in this repository is `<Name><timestamp>`; the filename prefixes the timestamp.
      const name = `${f.slice(14, -'.ts'.length)}${String(timestamp)}`;
      return { timestamp, name };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function appliedLedger(ds: DataSource): Promise<Array<{ timestamp: number; name: string }>> {
  const rows: Array<{ timestamp: string; name: string }> = await ds.query(
    `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp ASC, name ASC`,
  );
  return rows.map((row) => ({ timestamp: Number(row.timestamp), name: row.name }));
}

async function expectLedgerMatchesFilesystem(ds: DataSource): Promise<void> {
  const onDisk = filesystemMigrations();
  expect(onDisk).toHaveLength(164);
  const applied = await appliedLedger(ds);
  expect(applied).toHaveLength(onDisk.length);
  expect(applied).toEqual([...onDisk].sort((a, b) => a.timestamp - b.timestamp));
  // Uniqueness is load-bearing: the ledger must record each identity exactly once.
  expect(new Set(applied.map((m) => m.timestamp)).size).toBe(applied.length);
  expect(new Set(applied.map((m) => m.name)).size).toBe(applied.length);
  expect(applied[applied.length - 1]!.timestamp).toBe(COMBINED_HEAD_TIMESTAMP);
  expect(applied[applied.length - 1]!.name).toBe(COMBINED_HEAD_NAME);
}

async function migrationNames(ds: DataSource): Promise<string[]> {
  return (await appliedLedger(ds)).map((row) => row.name);
}

describe('ARENA 5 combined migration chain (real PostgreSQL)', () => {
  it('the filesystem carries exactly the union of both predecessors: 152 common + 9 (3D 0606–0614) + 3 (2C 0800–0802) = 164', () => {
    const onDisk = filesystemMigrations();
    expect(onDisk).toHaveLength(164);
    const names = onDisk.map((m) => m.name);
    for (const name of [...ARENA3D_ONLY, ...ARENA2C_ONLY]) {
      expect(names).toContain(name);
    }
    // Disjoint contribution sets: the two freezes share nothing they both added.
    const threeD = new Set<string>(ARENA3D_ONLY);
    expect(ARENA2C_ONLY.filter((name) => threeD.has(name))).toEqual([]);
    expect(onDisk[onDisk.length - 1]!.name).toBe(COMBINED_HEAD_NAME);
  });

  it('upgrades an Arena 3D database to the combined head by applying exactly 0800–0802', async () => {
    const ds = await createEmptyIntegrationDataSource('ar5up3d');
    try {
      await ds.initialize();
      const all = [...ds.migrations];
      ds.migrations.splice(
        0,
        ds.migrations.length,
        ...all.filter((m) => {
          const name = m.name ?? '';
          return !(ARENA2C_ONLY as readonly string[]).includes(name);
        }),
      );
      const firstLeg = await ds.runMigrations({ transaction: 'all' });
      expect(firstLeg).toHaveLength(161); // the 3D freeze's own chain
      expect(await migrationNames(ds)).not.toContain('ExtendBeneficiaryOwnership1785753600802');

      // Now hand the database the combined application, exactly as the consolidated deployment would.
      ds.migrations.splice(0, ds.migrations.length, ...all);
      const secondLeg = await ds.runMigrations({ transaction: 'all' });
      expect(secondLeg.map((m) => m.name)).toEqual([...ARENA2C_ONLY]);

      // Idempotent replay: nothing remains pending and nothing is re-applied.
      await expect(ds.showMigrations()).resolves.toBe(false);
      await expect(ds.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      await expectLedgerMatchesFilesystem(ds);

      // 2C's beneficiary-ownership migration must have extended the 3D-era ownership table, not replaced it.
      const ownerships = await ds.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('beneficiary_ownerships','customer_beneficiaries')`,
      );
      expect(firstRow(ownerships, 'beneficiary table count').count).toBe('2');
    } finally {
      await destroyIntegrationDataSource(ds);
    }
  }, 180_000);

  it('upgrades an Arena 2C database to the combined head by applying exactly 0606–0614', async () => {
    const ds = await createEmptyIntegrationDataSource('ar5up2c');
    try {
      await ds.initialize();
      const all = [...ds.migrations];
      ds.migrations.splice(
        0,
        ds.migrations.length,
        ...all.filter((m) => {
          const name = m.name ?? '';
          return !(ARENA3D_ONLY as readonly string[]).includes(name);
        }),
      );
      const firstLeg = await ds.runMigrations({ transaction: 'all' });
      expect(firstLeg).toHaveLength(155); // the 2C freeze's own chain
      expect(await migrationNames(ds)).not.toContain('OutboxLeasesAndDeadLetters1785753600606');

      ds.migrations.splice(0, ds.migrations.length, ...all);
      const secondLeg = await ds.runMigrations({ transaction: 'all' });
      expect(secondLeg.map((m) => m.name)).toEqual([...ARENA3D_ONLY]);

      await expect(ds.showMigrations()).resolves.toBe(false);
      await expect(ds.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      await expectLedgerMatchesFilesystem(ds);

      // The 2C head migration (beneficiary ownership extension) must survive the 3D-set upgrade untouched.
      const columns = await ds.query<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'beneficiary_ownerships'`,
      );
      expect(columns.length).toBeGreaterThan(0);
    } finally {
      await destroyIntegrationDataSource(ds);
    }
  }, 180_000);

  it('fresh install from an empty database applies the full 164-identity chain exactly once; replay applies nothing', async () => {
    const ds = await createEmptyIntegrationDataSource('ar5fresh');
    try {
      await ds.initialize();
      const executed = await ds.runMigrations({ transaction: 'all' });
      expect(executed).toHaveLength(164);
      await expect(ds.showMigrations()).resolves.toBe(false);
      await expect(ds.runMigrations({ transaction: 'all' })).resolves.toEqual([]);
      await expectLedgerMatchesFilesystem(ds);
    } finally {
      await destroyIntegrationDataSource(ds);
    }
  }, 180_000);
});
