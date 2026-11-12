import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { DataSource } from 'typeorm';

/**
 * Shared provenance contract for the isolated KYC suites.
 *
 * These suites must only ever run against the disposable, socket-only cluster created by
 * `scripts/run-isolated-kyc-tests.js`. The previous implementation encoded that as a regex over
 * one developer's absolute path (`/home/user/m25c-isolated-pgsocket/kyc-batch1-*`) plus a
 * hardcoded port, which was unverifiable anywhere else and silently unreachable in CI.
 *
 * The contract below is portable and strictly stronger, because it checks *evidence* rather
 * than spelling:
 *
 *   1. `KYC_ISOLATED_TEST_SOCKET` is an absolute path to a directory whose name starts with
 *      `socket` (the runner creates `<run>/socket`);
 *   2. the run-directory root — `dirname(socket)` — contains the marker file
 *      `.kyc-isolated-disposable-cluster` that only the runner writes;
 *   3. the run-directory root contains `cluster.json`, whose `socketDirectory` resolves to the
 *      same directory and whose `dataDirectory` is absolute;
 *   4. once connected, `current_setting('data_directory')` still matches `cluster.json`, so the
 *      server actually answering is the one the manifest describes;
 *   5. `listen_addresses` is empty (socket-only: no TCP listener to reach by mistake);
 *   6. the server version is at least `minimumServerVersion` (default 16).
 *
 * No machine-specific path appears anywhere in the check.
 */

export const ISOLATED_MARKER = '.kyc-isolated-disposable-cluster';
export const ISOLATED_MANIFEST = 'cluster.json';

export interface IsolatedClusterManifest {
  socketDirectory: string;
  dataDirectory: string;
  port: number;
  role: string;
  minimumServerVersion: number;
  listenAddresses: string;
}

export interface IsolatedKycCluster {
  /** Directory containing the unix socket; also `DataSource.host`. */
  socketDirectory: string;
  /** Port the socket is served from (unix sockets still carry a port in the file name). */
  port: number;
  runDirectory: string;
  manifest: IsolatedClusterManifest;
}

const DEFAULT_PORT = 5432;

function requireAbsoluteSocket(value: string | undefined): string {
  if (!value) {
    throw new Error(
      'Disposable KYC socket required: run the isolated KYC suites via ' +
        '"KYC_ISOLATED_CONFIRM_DISPOSABLE=yes npm run test:pg:isolated-kyc", which creates the ' +
        'cluster and exports KYC_ISOLATED_TEST_SOCKET.',
    );
  }
  if (!isAbsolute(value)) {
    throw new Error(`KYC_ISOLATED_TEST_SOCKET must be an absolute path, got ${JSON.stringify(value)}`);
  }
  const socket = resolve(value);
  if (!basename(socket).startsWith('socket')) {
    throw new Error(`KYC_ISOLATED_TEST_SOCKET must point at the runner's socket directory, got ${socket}`);
  }
  return socket;
}

/** Resolves and validates the cluster described by the environment. Throws when unprovable. */
export function isolatedKycCluster(): IsolatedKycCluster {
  const socketDirectory = requireAbsoluteSocket(process.env.KYC_ISOLATED_TEST_SOCKET);
  const runDirectory = dirname(socketDirectory);

  if (!existsSync(join(runDirectory, ISOLATED_MARKER))) {
    throw new Error(
      `Socket directory has no disposable-cluster marker (${ISOLATED_MARKER}) at ${runDirectory}; ` +
        'refusing to use a cluster this project did not create.',
    );
  }
  const manifestPath = join(runDirectory, ISOLATED_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new Error(`Disposable cluster manifest missing at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IsolatedClusterManifest;
  if (!isAbsolute(manifest.dataDirectory ?? '')) {
    throw new Error('Disposable cluster manifest has no absolute dataDirectory');
  }
  if (resolve(manifest.socketDirectory ?? '') !== socketDirectory) {
    throw new Error(
      `Disposable cluster manifest socketDirectory (${manifest.socketDirectory}) does not match ` +
        `the socket in use (${socketDirectory})`,
    );
  }
  const parsePort = (value: string | undefined): number => {
    const port = Number(value ?? manifest.port ?? DEFAULT_PORT);
    return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
  };

  return {
    socketDirectory,
    port: parsePort(process.env.KYC_ISOLATED_TEST_PORT),
    runDirectory,
    manifest,
  };
}

/**
 * Confirms the server that will answer on this socket is the one the manifest describes. Call
 * once, immediately after `dataSource.initialize()` and before an assertion runs.
 */
export async function assertIsolatedKycCluster(
  dataSource: DataSource,
  cluster: IsolatedKycCluster,
): Promise<void> {
  const rows: Array<{ data_directory: string; listen_addresses: string; server_version: string }> =
    await dataSource.query(
      `SELECT current_setting('data_directory') AS data_directory,
              current_setting('listen_addresses') AS listen_addresses,
              current_setting('server_version') AS server_version`,
    );
  const row = rows[0];
  if (!row) throw new Error('Isolated cluster provenance check returned no rows');
  if (resolve(row.data_directory) !== cluster.manifest.dataDirectory) {
    throw new Error(
      `Connected to the wrong cluster: data_directory is ${row.data_directory}, manifest expects ` +
        `${cluster.manifest.dataDirectory}`,
    );
  }
  if (row.listen_addresses !== '') {
    throw new Error(
      `Isolated cluster must be socket-only (listen_addresses=''), got ${JSON.stringify(row.listen_addresses)}`,
    );
  }
  const minimum = cluster.manifest.minimumServerVersion ?? 16;
  if (parseInt(row.server_version, 10) < minimum) {
    throw new Error(
      `Isolated cluster server_version ${row.server_version} is below the required ${minimum}`,
    );
  }
}
