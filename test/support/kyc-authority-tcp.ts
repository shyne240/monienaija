import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

export interface KycAuthorityConnections {
  runtime: DataSource;
  authority: DataSource;
  cleanup(): Promise<void>;
}

/**
 * Governance-authority connections that work against *either* PostgreSQL transport.
 *
 * `createKycAuthorityConnections` (kyc-isolated-authority.ts) is intentionally bound to the
 * socket-only disposable cluster, because the isolated KYC suites assert on that cluster's
 * provenance. The main `test:pg` matrix runs against a loopback TCP cluster instead, so a shared
 * suite that needs to drive the real maker/checker services (rather than forging an APPROVED row,
 * which the protected-authority triggers now correctly reject) needs the same two-login shape over
 * TCP.
 *
 * The split is the point: `monienaija_runtime` may not write protected checker evidence, and
 * `monienaija_authority_core` may. Both group roles are created by migration 1785753600300, so this
 * helper only creates the per-run LOGIN role wrappers and grants them group membership — no
 * privilege model is redefined here.
 */
export async function createKycAuthorityConnectionsOverTcp(
  admin: DataSource,
  options: { schema?: string } = {},
): Promise<KycAuthorityConnections> {
  if (admin.options.type !== 'postgres') throw new Error('PostgreSQL is required');
  const schema = options.schema ?? 'public';
  const suffix = randomUUID().replace(/-/g, '');
  const runtimeRole = `kyc_rt_${suffix}`;
  const authorityRole = `kc_au_${suffix}`;
  const host = admin.options.host as string;
  const port = admin.options.port as number;
  const database = admin.options.database as string;

  // A loopback TCP cluster authenticates with scram/md5, unlike the socket-only isolated cluster
  // (local trust). The password is generated per run, never committed and never logged.
  const password = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

  const connect = (username: string) =>
    new DataSource({
      type: 'postgres',
      host,
      port,
      database,
      username,
      password,
      synchronize: false,
      migrationsRun: false,
      logging: false,
      extra: { options: `-c search_path=${schema}` },
    });

  const runtime = connect(runtimeRole);
  const authority = connect(authorityRole);

  await admin.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await admin.query(
    `CREATE ROLE "${authorityRole}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await admin.query(`GRANT monienaija_runtime TO "${runtimeRole}"`);
  await admin.query(`GRANT monienaija_authority_core TO "${authorityRole}"`);

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
