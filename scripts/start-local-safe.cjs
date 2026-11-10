'use strict';
// Opt-in launcher; no file or connection setting is changed. The guard is defense in depth,
// not an OS firewall, and cannot detect a production service forwarded to loopback.
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadEffectiveEnv, run } = require('./local-preflight.cjs');

const root = path.resolve(__dirname, '..');
const env = loadEffectiveEnv(root);
run(env).then(() => {
  const child = spawn(process.execPath, [
    '-r', path.join(root, 'test/support/mission-25c-network-guard.cjs'),
    path.join(root, 'dist/main.js'),
  ], { cwd: root, env, stdio: 'inherit' });
  child.on('error', () => { console.error('Could not start backend. Run npm run build first.'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}).catch((error) => { console.error(`Local safe start refused/failed:\n${error.message}`); process.exitCode = 1; });
