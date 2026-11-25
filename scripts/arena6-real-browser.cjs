#!/usr/bin/env node
/**
 * ARENA 6 — the whole real-browser leg, in one command.
 *
 *   ADMIN_WEB_API_BASE_URL=/api/v1 npx --prefix apps/admin-web vite build
 *   DB_* for the disposable PostgreSQL you already use for `npm run test:pg`
 *   node scripts/arena6-real-browser.cjs --executable /tmp/chromium --lib-path /tmp/al2023/lib
 *
 * It starts `arena6-real-browser-backend.ts` as its own process (see that file for why it cannot live
 * inside a jest worker), waits for its ready line, drives the production admin bundle against it through
 * a same-origin proxy, writes screenshots plus `browser-run.json` under `--out`, and then shuts the
 * backend down. Every database variable the backend needs is inherited from the environment, so the
 * disposable-cluster confirmation and the loopback guard are the same ones `npm run test:pg` enforces —
 * nothing here relaxes them, and the production readiness gate is reported, not bypassed.
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

/**
 * Whether the bundle that is already on disk was built with the API base this run needs. A reused bundle
 * built without `ADMIN_WEB_API_BASE_URL` renders a login page that can never sign in — the page says so in a
 * red notice, and the browser leg then reports ninety seconds of waiting for a dashboard that was never
 * reachable. Checking the built asset costs one read and turns that into a rebuild.
 */
function bundleCarriesApiBase(webRoot, apiBase) {
  const assets = path.join(webRoot, 'assets');
  if (!fs.existsSync(assets)) return false;
  return fs.readdirSync(assets).some((file) => {
    if (!file.endsWith('.js')) return false;
    try {
      return fs.readFileSync(path.join(assets, file), 'utf8').includes(apiBase);
    } catch {
      return false;
    }
  });
}

function buildWebIfNeeded(webRoot) {
  const apiBase = process.env.ADMIN_WEB_API_BASE_URL ?? '/api/v1';
  if (fs.existsSync(path.join(webRoot, 'index.html')) && bundleCarriesApiBase(webRoot, apiBase)) {
    return 'reused';
  }
  if (fs.existsSync(path.join(webRoot, 'index.html'))) {
    process.stdout.write(
      `arena6-browser-run: the bundle on disk was not built with ${apiBase}; rebuilding\n`,
    );
  }
  const result = spawnSync('npx', ['vite', 'build'], {
    cwd: path.join(ROOT, 'apps/admin-web'),
    stdio: 'inherit',
    env: {
      ...process.env,
      ADMIN_WEB_API_BASE_URL: process.env.ADMIN_WEB_API_BASE_URL ?? '/api/v1',
    },
    shell: false,
  });
  if (result.status !== 0) throw new Error('the admin bundle could not be built');
  return 'built';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port ?? 4399);
  const proxyPort = Number(args['proxy-port'] ?? port + 1);
  const webRoot = path.resolve(ROOT, args['web-root'] ?? 'apps/admin-web/dist');
  const out = path.resolve(ROOT, args.out ?? 'docs/integration/evidence/arena6-real-browser');
  const email = args.email ?? 'finance-auditor@monienaija.local';
  const password = args.password ?? 'MonieNaija_FINANCE_AUDITOR_123!';
  // On by default, because the negative half of the drill-down is what proves the permissions hold; switched
  // off only by name, and the state is printed so a report can never be read as "no requests" by accident.
  const restricted = !args['no-restricted'];
  const restrictedEmail = args['restricted-email'] ?? 'risk-fraud@monienaija.local';
  const restrictedPassword = args['restricted-password'] ?? 'MonieNaija_RISK_FRAUD_123!';
  fs.mkdirSync(out, { recursive: true });

  const built = buildWebIfNeeded(webRoot);
  process.stdout.write(`arena6-browser-run: admin bundle ${built} at ${webRoot}\n`);
  process.stdout.write(
    `arena6-browser-run: restricted-role leg ${restricted ? 'enabled' : 'DISABLED by --no-restricted'}\n`,
  );

  process.stdout.write(
    'arena6-browser-run: starting the standalone backend (migrates its own database)…\n',
  );
  const backend = spawn('npx', ['ts-node', 'scripts/arena6-real-browser-backend.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      TS_NODE_TRANSPILE_ONLY: '1',
      TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs"}',
      NODE_ENV: 'test',
      NOTIFICATION_WORKER_ENABLED: 'false',
      CASH_TO_CASH_EXPIRY_WORKER_ENABLED: 'false',
      LOCAL_DEV_SEED_CONFIRM: 'disposable-local-database',
      // `test/support/pg-harness.ts` validates the namespace as /^[a-z][a-z0-9]{3,15}$/. A pid in base 16
      // is not always valid there, so the run tag is built from digits.
      PG_TEST_RUN_ID: process.env.PG_TEST_RUN_ID ?? `r${Date.now().toString().slice(-10)}`,
    },
    // stderr is piped, not inherited: a backend that dies early otherwise prints its reason after the
    // runner has already reported "exited early", which leaves the reader with a stack and no cause.
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const ready = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `the backend did not become ready within 300s (last output: ${buffer.slice(-400)})`,
          ),
        ),
      300_000,
    );
    backend.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      buffer += text;
      process.stdout.write(text.endsWith('\n') ? `arena6-backend: ${text}` : text);
      const line = buffer
        .split('\n')
        .find((candidate) => candidate.startsWith('STANDALONE_READY '));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice('STANDALONE_READY '.length)));
      }
    });
    backend.stderr.on('data', (chunk) =>
      process.stderr.write(`arena6-backend: ${chunk.toString()}`),
    );
    backend.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(`the backend exited early with code ${String(code)}: ${buffer.slice(-400)}`),
      );
    });
  });

  const apiTarget = `http://127.0.0.1:${ready.port}`;
  let status = 0;
  try {
    const { run } = require('./arena6-real-session-browser-acceptance.cjs');
    const result = await run({
      apiTarget,
      webRoot,
      port: proxyPort,
      email,
      password,
      restrictedEmail,
      restrictedPassword,
      correlationId: ready.correlationId,
      restricted,
      window: JSON.stringify(ready.window),
      expectTotal: 3,
      out,
      executable: args.executable,
      libPath: args['lib-path'],
    });
    void result;
  } catch (error) {
    status = 1;
    process.stderr.write(
      `arena6-browser-run: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  } finally {
    backend.kill('SIGTERM');
  }

  const reportPath = path.join(out, 'browser-run.json');
  const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {};
  process.stdout.write(
    `ARENA6_BROWSER_SUMMARY ${JSON.stringify({
      passed: report.passed,
      total: report.total,
      realFailures: report.realFailures ?? null,
      advisorySkips: (report.advisoryUnavailable ?? []).length,
      backend: { port: ready.port, seeded: ready.seeded, readinessRefuses: ready.readinessRefuses },
      window: ready.window,
      out,
    })}\n`,
  );
  // Success has three parts, and only the first is about the feature:
  //   • the harness exited cleanly with zero non-advisory misses — a leg this sandbox's Chromium could not
  //     paint is recorded advisory and does NOT fail the run, because it is a statement about the renderer;
  //   • the ledger is at least as long as the legs that always execute (15), so a run that aborted early
  //     cannot read as a short clean run — the harness additionally turns each mandatory leg into a failure
  //     entry when it is missing, which is what catches truncation before this floor ever matters;
  //   • the backend answered, which `ready` already proved by the time we are here.
  const realFailures = report.realFailures ?? 1;
  process.exit(status === 0 && realFailures === 0 && (report.total ?? 0) >= 15 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(
    `ARENA6_BROWSER_RUN_FAILED ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
