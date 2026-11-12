'use strict';
// Synthetic-only child process: credential comes from stdin, never arguments or logs.
//
// This worker runs in a separate OS process, so it re-derives the disposable-cluster provenance
// itself rather than trusting the parent. The contract is the same one the Jest suites use
// (test/support/kyc-isolated-cluster.ts): marker at the run-directory root, cluster.json manifest,
// socket-only listener, and the manifest's data_directory actually served. It deliberately names
// no machine-specific path.
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { KycRegistrationSessionService } = require('../../src/kyc-verification/kyc-registration-session.service');

const MARKER = '.kyc-isolated-disposable-cluster';
const MANIFEST = 'cluster.json';

function assertDisposableCluster(socketDirectory, port) {
  if (typeof socketDirectory !== 'string' || !path.isAbsolute(socketDirectory)) {
    throw new Error('Unsafe test target');
  }
  const resolved = path.resolve(socketDirectory);
  if (!path.basename(resolved).startsWith('socket')) throw new Error('Unsafe test target');
  const runDirectory = path.dirname(resolved);
  if (!fs.existsSync(path.join(runDirectory, MARKER))) throw new Error('Unsafe test cluster');
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, MANIFEST), 'utf8'));
  if (path.resolve(manifest.socketDirectory) !== resolved) throw new Error('Unsafe test cluster');
  if (!path.isAbsolute(manifest.dataDirectory)) throw new Error('Unsafe test cluster');
  const numericPort = Number(port ?? manifest.port);
  if (!Number.isInteger(numericPort) || numericPort <= 0 || numericPort > 65535) {
    throw new Error('Unsafe test cluster');
  }
  return { manifest, port: numericPort };
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  let db;
  try {
    const value = JSON.parse(input);
    if (!/^kyc_api_test_[0-9a-f]{32}$/.test(value.schema)) throw new Error('Unsafe test target');
    const { manifest, port } = assertDisposableCluster(value.socket, value.port);
    db = new DataSource({
      type: 'postgres',
      host: path.resolve(value.socket),
      port,
      username: 'kyc_synthetic',
      database: 'postgres',
      logging: false,
      extra: { options: `-c search_path=${value.schema}` },
    });
    await db.initialize();
    const directory = await db.query('SHOW data_directory');
    const listen = await db.query('SHOW listen_addresses');
    if (path.resolve(directory[0].data_directory) !== path.resolve(manifest.dataDirectory)) {
      throw new Error('Unsafe test cluster');
    }
    if (listen[0].listen_addresses !== '') throw new Error('Unsafe test cluster');
    const service = new KycRegistrationSessionService(db, { name: 'synthetic', send: () => Promise.reject(new Error('disabled')) }, { consume: () => Promise.reject(new Error('disabled')) });
    const result = await service.status(value.id, value.token);
    process.stdout.write(result.status);
  } catch (error) {
    process.stderr.write(`Synthetic worker failed: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    if (db?.isInitialized) await db.destroy();
  }
});
