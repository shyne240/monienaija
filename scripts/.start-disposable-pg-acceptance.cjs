'use strict';

const EmbeddedPostgres = require('embedded-postgres').default;
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const markerName = '.arena-disposable-pg-acceptance';
const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-pg-acceptance-'));
const dataDirectory = path.join(runDirectory, 'pgdata');
const socketDirectory = path.join(runDirectory, 'socket');
const logPath = path.join(runDirectory, 'postgres.log');
fs.mkdirSync(dataDirectory);
fs.mkdirSync(socketDirectory);
fs.writeFileSync(path.join(runDirectory, markerName), `pid=${process.pid}\n`);

function choosePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No loopback port assigned'))));
    });
  });
}

let cluster;
let stopping = false;

async function cleanup() {
  if (stopping) return;
  stopping = true;
  try {
    if (cluster) await cluster.stop();
  } catch (error) {
    process.stderr.write(`disposable-pg: stop failed: ${String(error)}\n`);
  }
  if (fs.existsSync(path.join(runDirectory, markerName))) {
    fs.rmSync(runDirectory, { recursive: true, force: true });
  }
  process.exit(0);
}

async function main() {
  const port = await choosePort();
  cluster = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    port,
    user: 'arena_pg_test',
    password: 'arena-disposable-test-only',
    persistent: false,
    postgresFlags: [
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      `unix_socket_directories=${socketDirectory}`,
    ],
    onLog: (message) => fs.appendFileSync(logPath, `${message}\n`),
    onError: (message) => fs.appendFileSync(logPath, `${String(message)}\n`),
  });
  await cluster.initialise();
  await cluster.start();
  process.stdout.write(`DISPOSABLE_PG_READY ${JSON.stringify({ host: '127.0.0.1', port })}\n`);
  process.once('SIGTERM', () => void cleanup());
  process.once('SIGINT', () => void cleanup());
  setInterval(() => {}, 60_000);
}

main().catch(async (error) => {
  process.stderr.write(`disposable-pg: ${error instanceof Error ? error.stack : String(error)}\n`);
  try {
    if (cluster) await cluster.stop();
  } catch {}
  if (fs.existsSync(path.join(runDirectory, markerName))) {
    fs.rmSync(runDirectory, { recursive: true, force: true });
  }
  process.exit(1);
});
