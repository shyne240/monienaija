import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

import {
  createEmptyIntegrationDataSource,
  destroyIntegrationDataSource,
} from './support/pg-harness';

const EXPECTED_ACCESS_MIGRATION = 'SecureAgentApplicationAccess1785753600095';
const PREVIOUS_LATEST_MIGRATION = 'AddSecureCustomerProofOfAddressUploads1785753600094';

describe('Agent application access migration upgrade (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let databaseName: string;

  beforeAll(async () => {
    dataSource = await createEmptyIntegrationDataSource('agentappupgrade');
    databaseName = String(dataSource.options.database);
    await dataSource.initialize();
  }, 120_000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => undefined);
  }, 60_000);

  it('upgrades an existing 0094 history without replacing it or losing application rows', async () => {
    const fullChain = [...dataSource.migrations];
    expect(fullChain.some((migration) => migration.name === EXPECTED_ACCESS_MIGRATION)).toBe(true);
    expect(fullChain.some((migration) => migration.name === PREVIOUS_LATEST_MIGRATION)).toBe(true);

    // ARENA 3 Sprint 3 final integration: the repository chain now continues past 0095
    // (1785753600096-CreateCashToCashLocators, ARENA 1's approved six-digit redemption
    // migration). This suite verifies the historical 0094 -> 0095 upgrade exactly as it
    // shipped, so BOTH DataSources below are scoped to the chain as it existed when 0095
    // was head (timestamp <= 1785753600095). Later additive migrations (0096+) are
    // exercised by every other integration suite through the harness's full chain and by
    // the dedicated locator coverage in a15/a16/a17 — scoping keeps this test a faithful
    // point-in-time upgrade reproduction and stable as the chain keeps growing.
    const scopedChain = fullChain.filter(
      (migration) => Number(String(migration.name ?? '').slice(-13)) <= Number(EXPECTED_ACCESS_MIGRATION.slice(-13)),
    );
    expect(
      Math.max(...scopedChain.map((migration) => Number(String(migration.name ?? '').slice(-13)))),
    ).toBe(Number(EXPECTED_ACCESS_MIGRATION.slice(-13)));

    // Build the already-existing schema through its historical latest migration, 0094, using
    // a separate DataSource configured with the historical migration classes only.
    const historicalMigrations = scopedChain
      .filter((migration) => migration.name !== EXPECTED_ACCESS_MIGRATION)
      .map((migration) => migration.constructor);
    const historicalDataSource = new DataSource({
      ...dataSource.options,
      migrations: historicalMigrations,
    });
    await dataSource.destroy();
    dataSource = historicalDataSource;
    await dataSource.initialize();
    const historicalRun = await dataSource.runMigrations({ transaction: 'all' });
    expect(historicalRun).toHaveLength(scopedChain.length - 1);
    const historicalLatest: Array<{ timestamp: string; name: string }> = await dataSource.query(
      `SELECT timestamp::text AS timestamp, name
         FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`,
    );
    expect(historicalLatest).toEqual([
      { timestamp: '1785753600094', name: PREVIOUS_LATEST_MIGRATION },
    ]);

    const columnBeforeUpgrade: Array<{ column_name: string }> = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='agent_applications'
          AND column_name='applicant_access_token_hash'`,
    );
    expect(columnBeforeUpgrade).toEqual([]);

    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name)
       VALUES ($1, $2, 'Pre-upgrade application class') RETURNING id`,
      [`upgrade-class-${randomUUID()}`, `UPGRADE-${randomUUID()}`],
    );
    const agentClassId = classRows[0]?.id;
    if (!agentClassId) throw new Error('The pre-upgrade Agent class fixture was not created');
    const existingApplicationIds: string[] = [];
    for (const suffix of ['one', 'two']) {
      const applicationRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO agent_applications
           (reference, agent_class_id, applicant_reference, created_by)
         VALUES ($1, $2, $3, 'migration-upgrade-test') RETURNING id`,
        [
          `upgrade-application-${suffix}-${randomUUID()}`,
          agentClassId,
          `upgrade-applicant-${suffix}-${randomUUID()}`,
        ],
      );
      const applicationId = applicationRows[0]?.id;
      if (!applicationId) throw new Error(`Pre-upgrade Agent application fixture ${suffix} was not created`);
      existingApplicationIds.push(applicationId);
    }

    // A second DataSource discovers the (0095-head) chain from the same database. TypeORM
    // must see exactly one pending migration and apply only the additive 0095 migration.
    await dataSource.destroy();
    dataSource = new DataSource({
      ...historicalDataSource.options,
      migrations: scopedChain.map((migration) => migration.constructor),
    });
    await dataSource.initialize();
    await expect(dataSource.showMigrations()).resolves.toBe(true);
    const upgradeRun = await dataSource.runMigrations({ transaction: 'all' });
    expect(upgradeRun.map((migration) => migration.name)).toEqual([EXPECTED_ACCESS_MIGRATION]);
    await expect(dataSource.showMigrations()).resolves.toBe(false);

    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(
      `SELECT timestamp::text AS timestamp, name
         FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`,
    );
    expect(latest).toEqual([{ timestamp: '1785753600095', name: EXPECTED_ACCESS_MIGRATION }]);

    const survivingRows: Array<{ id: string; applicant_access_token_hash: string | null }> =
      await dataSource.query(
        `SELECT id, applicant_access_token_hash
           FROM agent_applications WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [existingApplicationIds],
      );
    expect(survivingRows).toHaveLength(2);
    expect(survivingRows.every((row) => row.applicant_access_token_hash === null)).toBe(true);

    const uniqueTokenHash = 'a'.repeat(64);
    await dataSource.query(
      `UPDATE agent_applications SET applicant_access_token_hash=$1 WHERE id=$2`,
      [uniqueTokenHash, existingApplicationIds[0]],
    );
    await expect(
      dataSource.query(
        `UPDATE agent_applications SET applicant_access_token_hash=$1 WHERE id=$2`,
        [uniqueTokenHash, existingApplicationIds[1]],
      ),
    ).rejects.toThrow();
  }, 120_000);
});
