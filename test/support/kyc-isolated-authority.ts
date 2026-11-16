import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { IsolatedKycCluster } from './kyc-isolated-cluster';

export interface KycAuthorityConnections {
  runtime: DataSource;
  authority: DataSource;
  cleanup(): Promise<void>;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Create disposable LOGIN roles against the isolated socket-only KYC cluster. The migrations under
 * test have already created the two NOLOGIN groups and granted their table privileges. This uses
 * distinct real PostgreSQL sessions so service tests exercise the same ordinary-runtime versus
 * protected-authority split as the production wiring, without copying credentials into fixtures.
 */
export async function createKycAuthorityConnections(
  admin: DataSource,
  cluster: IsolatedKycCluster,
  schema: string,
): Promise<KycAuthorityConnections> {
  if (admin.options.type !== 'postgres') throw new Error('PostgreSQL is required');
  const suffix = randomUUID().replace(/-/g, '');
  const runtimeRole = `kyc_rt_${suffix}`;
  const authorityRole = `kyc_au_${suffix}`;
  const runtime = new DataSource({
    type: 'postgres',
    host: cluster.socketDirectory,
    port: cluster.port,
    database: admin.options.database,
    username: runtimeRole,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { options: `-c search_path=${schema}` },
  });
  const authority = new DataSource({
    type: 'postgres',
    host: cluster.socketDirectory,
    port: cluster.port,
    database: admin.options.database,
    username: authorityRole,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { options: `-c search_path=${schema}` },
  });

  await admin.query(
    `CREATE ROLE "${runtimeRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await admin.query(
    `CREATE ROLE "${authorityRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await admin.query(`GRANT monienaija_runtime TO "${runtimeRole}"`);
  await admin.query(`GRANT monienaija_authority_core TO "${authorityRole}"`);
  // The production post-migration provisioner grants ordinary DML to the protected authority
  // login. Isolated suites only inherit migration-time minimal grants, so add the one UPDATE
  // privilege PostgreSQL requires for SELECT ... FOR SHARE when their schema includes institutions.
  const [institutionTable] = await admin.query<Array<{ table_exists: boolean }>>(
    `SELECT to_regclass(format('%I.financial_institutions', $1::text)) IS NOT NULL AS table_exists`,
    [schema],
  );
  if (institutionTable?.table_exists) {
    await admin.query(
      `GRANT UPDATE ON TABLE ${quoteIdentifier(schema)}.financial_institutions TO ${quoteIdentifier(authorityRole)}`,
    );
  }

  const cleanup = async () => {
    if (runtime.isInitialized) await runtime.destroy().catch(() => undefined);
    if (authority.isInitialized) await authority.destroy().catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS "${authorityRole}"`).catch(() => undefined);
  };
  try {
    await runtime.initialize();
    await authority.initialize();
    return { runtime, authority, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
