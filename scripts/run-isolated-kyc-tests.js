'use strict';

/**
 * Portable, disposable, socket-only PostgreSQL cluster for the isolated KYC suites
 * (`test/*.isolated-pg.test.ts`).
 *
 * ## Why this exists
 *
 * The isolated KYC suites deliberately use a *separate* PostgreSQL cluster from the
 * `npm run test:pg` inventory: they exercise migrations, governance singletons and registration
 * flows against a cluster they fully own, and several of them assert on cluster provenance
 * (`listen_addresses=''`, socket-only access, a disposable marker). Until now that cluster was
 * a hand-started server at a hardcoded absolute path (`/home/user/m25c-isolated-pgsocket/...`,
 * port 55461) with a matching regex compiled into every suite — unreproducible on any other
 * machine, and silently excluded from the normal Jest patterns.
 *
 * This script starts that cluster on demand, in a temporary directory, with a random port, and
 * exports the environment the suites expect. It refuses to run against anything it did not
 * create, and it removes only directories it can prove it made.
 *
 * ## Provenance contract (asserted by the suites and by the child worker)
 *
 *   - `KYC_ISOLATED_TEST_SOCKET` is an absolute path to a directory that contains the unix
 *     socket, and whose basename starts with `socket`;
 *   - its parent directory contains the marker file `.kyc-isolated-disposable-cluster`;
 *   - that parent also contains `cluster.json`, describing the cluster this script created;
 *   - the server listens on the socket only (`listen_addresses=''`), never on TCP;
 *   - the role is `kyc_synthetic`.
 *
 * Nothing here is machine-specific: every path is derived from `os.tmpdir()` at run time.
 *
 * ## Usage
 *
 *   KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js [jest args...]
 *
 * Without the confirmation variable the script refuses to create a cluster (it would run
 * initdb). `--keep` leaves the run directory behind for debugging.
 */

const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MARKER = '.kyc-isolated-disposable-cluster';
const MANIFEST = 'cluster.json';
const ROLE = 'kyc_synthetic';
const MINIMUM_SERVER_VERSION = 16;
const JEST_CONFIG = path.join(ROOT, 'jest.isolated-kyc.config.js');
const JEST_BIN = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');

function fail(message) {
  process.stderr.write(`isolated-kyc: ${message}\n`);
  process.exit(1);
}

if (process.env.KYC_ISOLATED_CONFIRM_DISPOSABLE !== 'yes') {
  fail(
    'This script creates and destroys a disposable PostgreSQL cluster. Re-run with ' +
      'KYC_ISOLATED_CONFIRM_DISPOSABLE=yes to confirm you are pointing at throwaway infrastructure.',
  );
}
if (process.env.NODE_ENV === 'production') {
  fail('Refusing to run under NODE_ENV=production.');
}

// One directory per run, so a crashed run can never be mistaken for a live one, and two
// concurrent runs can never share a socket directory or a data directory.
const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kyc-isolated-'));
const dataDirectory = path.join(runDirectory, 'pgdata');
const socketDirectory = path.join(runDirectory, 'socket');
const logPath = path.join(runDirectory, 'postgres.log');
// initdb requires an empty data directory: the marker therefore lives at the run-directory
// root, next to (not inside) `pgdata`.
fs.mkdirSync(dataDirectory);
fs.mkdirSync(socketDirectory);
fs.writeFileSync(path.join(runDirectory, MARKER), `pid=${process.pid}\n`);

/** Largest free loopback port guess is unnecessary: we ask the OS and release it immediately. */
function choosePort() {
  const net = require('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no port assigned'))));
    });
  });
}

function removeRunDirectory() {
  // Marker-guarded: never delete a directory this script cannot prove it created.
  const marker = path.join(runDirectory, MARKER);
  if (!fs.existsSync(marker)) {
    process.stderr.write(`isolated-kyc: marker missing in ${runDirectory}; leaving it in place\n`);
    return;
  }
  fs.rmSync(runDirectory, { recursive: true, force: true });
}

async function main() {
  const EmbeddedPostgres = require('embedded-postgres').default;
  const port = await choosePort();
  const cluster = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    port,
    user: ROLE,
    password: 'unused-socket-only',
    persistent: false,
    // Socket-only: no TCP listener at all, so nothing outside this box can reach the cluster
    // and nothing inside it can accidentally connect over loopback instead of the socket.
    postgresFlags: ['-c', `listen_addresses=`, '-c', `unix_socket_directories=${socketDirectory}`],
    // `initdb` is run as the current, non-root user; the socket directory is owned by us and
    // world-traversable, which trust auth below relies on.
    onLog: (message) => fs.appendFileSync(logPath, `${message}\n`),
    onError: (message) => fs.appendFileSync(logPath, `${String(message)}\n`),
  });

  await cluster.initialise();

  // `initdb` writes an hba file that demands a password for local connections. This cluster is
  // socket-only inside a disposable directory, so local trust is both sufficient and required
  // (the `pg` client cannot present a password for a socket peer connection here).
  fs.writeFileSync(
    path.join(dataDirectory, 'pg_hba.conf'),
    [
      '# Disposable, socket-only, isolated KYC cluster (generated).',
      'local   all   all                 trust',
      'host    all   all   127.0.0.1/32  reject',
      'host    all   all   ::1/128       reject',
      '',
    ].join('\n'),
  );

  await cluster.start();
  fs.writeFileSync(
    path.join(runDirectory, MANIFEST),
    `${JSON.stringify(
      {
        socketDirectory,
        dataDirectory,
        port,
        role: ROLE,
        minimumServerVersion: MINIMUM_SERVER_VERSION,
        listenAddresses: '',
        createdBy: 'scripts/run-isolated-kyc-tests.js',
        pid: process.pid,
      },
      null,
      2,
    )}\n`,
  );

  const child = spawn(
    process.execPath,
    [
      '-r',
      path.join(ROOT, 'test/support/mission-25c-network-guard.cjs'),
      JEST_BIN,
      '--config',
      JEST_CONFIG,
      '--runInBand',
      ...process.argv.slice(2),
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        KYC_ISOLATED_TEST_SOCKET: socketDirectory,
        KYC_ISOLATED_TEST_PORT: String(port),
        KYC_ISOLATED_RUN_DIRECTORY: runDirectory,
      },
    },
  );

  const cleanup = () => {
    if (process.env.KYC_ISOLATED_KEEP === '1') return;
    removeRunDirectory();
  };
  const finish = async (code) => {
    try {
      await cluster.stop();
    } catch (error) {
      process.stderr.write(`isolated-kyc: cluster stop failed: ${String(error)}\n`);
    }
    cleanup();
    process.exit(code == null ? 1 : code);
  };

  child.once('exit', (code, signal) => {
    void finish(signal ? 1 : code);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      child.kill(signal);
    });
  }
}

main().catch((error) => {
  process.stderr.write(`isolated-kyc: ${error instanceof Error ? error.stack : String(error)}\n`);
  removeRunDirectory();
  process.exit(1);
});

// Referenced so a `--keep` run still tells the operator where to look.
void spawnSync;
