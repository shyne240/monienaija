#!/usr/bin/env node
'use strict';
// Compile, do not execute, the cross-workspace client imports of the isolated eligibility
// suite. Run from the installed, frozen test archive. Use the archive's *own* Jest config,
// transformer and cache writer, not a hand-emitted replacement for any module under test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function main() {
  const root = process.cwd();
  const load = createRequire(path.join(root, 'package.json'));
  const guard = path.join(root, 'test/support/mission-25c-network-guard.cjs');
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS || '').split(/\s+/)];
  if (process.env.NODE_ENV !== 'test' || !require.cache[guard] ||
      !flags.includes('--max-old-space-size=1536')) {
    throw new Error('Use NODE_ENV=test, the preloaded archive network guard and the 1536 MiB cap');
  }
  const testFile = 'test/batch2c-eligibility.isolated-pg.test.ts';
  const argv = await load('jest-cli').buildArgv([
    '--config', path.join(root, 'jest.isolated-kyc.config.js'), '--runInBand',
    '--runTestsByPath', testFile, '--json', '--outputFile', path.join(root, 'jest-result.json'),
  ]);
  const { configs: [config] } = await load('jest-config').readConfigs(argv, [root]);
  if (config.rootDir !== root || !config.cache || config.transform.length !== 1 ||
      config.transform[0][1] !== load.resolve('ts-jest') ||
      config.transform[0][2]?.tsconfig !== 'tsconfig.json') {
    throw new Error('Unexpected isolated-suite transform configuration');
  }
  const transformer = await load('@jest/transform').createScriptTransformer(config);
  // Same CJS transform options as the locked jest-runtime. Nothing is instrumented,
  // transpile-only mode is not enabled and TypeScript diagnostics are not disabled.
  const options = { isInternalModule: false, supportsDynamicImport: typeof vm.SourceTextModule === 'function',
    supportsExportNamespaceFrom: false, supportsStaticESM: false, supportsTopLevelAwait: false, instrument: false };
  for (const relative of ['config/index', 'services/secure-storage', 'services/api-client',
    'services/agent-api', 'services/pending-operation']) {
    const file = path.join(root, 'apps/agent-mobile/src', `${relative}.ts`);
    const result = transformer.transformSource(file, fs.readFileSync(file, 'utf8'), options);
    if (!result.code || !result.sourceMapPath || !fs.existsSync(result.sourceMapPath)) {
      throw new Error(`Jest did not produce its normal transform for ${relative}`);
    }
    console.log(`Prepared original Jest transform: ${relative}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
