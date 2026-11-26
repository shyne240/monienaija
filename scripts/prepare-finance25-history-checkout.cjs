#!/usr/bin/env node
'use strict';
// Build an ignored integration snapshot without creating/switching/merging any branch.
// This intentionally supports only the known Layout conflict at the recorded PR heads.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const [pr23, pr25] = process.argv.slice(2);
if (![pr23, pr25].every((sha) => /^[a-f0-9]{40}$/.test(sha || ''))) {
  throw new Error(
    'Usage: node scripts/prepare-finance25-history-checkout.cjs <PR23 SHA> <PR25 SHA>',
  );
}
if (
  pr23 !== '3c7f5c98fee27cb7164ee27f75605aeb58226c51' ||
  pr25 !== '891a1c1777855b9e921cfc50c962f2626d7eecf8'
) {
  throw new Error(
    'This diagnostic template is pinned to the recorded heads; review mappings/assertions before testing newer heads',
  );
}
const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options });
for (const sha of [pr23, pr25]) git(['cat-file', '-e', `${sha}^{commit}`]);
const destination = path.join(root, 'data/validation/finance25-combined');
if (fs.existsSync(destination))
  throw new Error(`Refusing to overwrite existing checkout: ${destination}`);
const merge = spawnSync('git', ['merge-tree', '--write-tree', pr23, pr25], {
  cwd: root,
  encoding: 'utf8',
});
if (![0, 1].includes(merge.status)) throw new Error(merge.stderr);
const combinedTree = merge.stdout.split('\n')[0];
if (!/^[a-f0-9]{40}$/.test(combinedTree)) throw new Error(merge.stdout);
const conflicts = [...merge.stdout.matchAll(/^\d{6} [a-f0-9]{40} [123]\t(.+)$/gm)].map((m) => m[1]);
const layout = 'apps/admin-web/src/screens/authenticated/Layout.tsx';
if (conflicts.some((file) => file !== layout))
  throw new Error(`Unexpected conflicts: ${conflicts.join(', ')}`);
let resolved = git(['show', `${combinedTree}:${layout}`]);
if (conflicts.length) {
  const start = resolved.indexOf('<<<<<<< ');
  const end = resolved.indexOf('\n', resolved.indexOf('>>>>>>> ', start));
  if (start < 0 || end < 0) throw new Error('Expected Layout conflict markers missing');
  const conflict = resolved.slice(start, end);
  if (!conflict.includes("case 'cashIn':") || !conflict.includes("case 'cashOut':")) {
    throw new Error('Layout conflict changed; resolve and review manually');
  }
  // Keep PR23 unified routes, not PR25's retired separate cashIn/cashOut cases.
  resolved = resolved.slice(0, start) + resolved.slice(end);
}
if (/^(<<<<<<<|=======|>>>>>>>)/m.test(resolved)) throw new Error('Unresolved Layout conflict');
fs.mkdirSync(destination, { recursive: true });
const indexPath = path.join(destination, 'integration.index');
const env = { ...process.env, GIT_INDEX_FILE: indexPath };
try {
  git(['read-tree', combinedTree], { env });
  const blob = git(['hash-object', '-w', '--stdin'], { input: resolved }).trim();
  git(['update-index', '--cacheinfo', `100644,${blob},${layout}`], { env });
  const resolvedTree = git(['write-tree'], { env }).trim();
  const archive = spawnSync(
    'bash',
    [
      '-o',
      'pipefail',
      '-c',
      `git archive ${resolvedTree} | tar -x -C "$1"`,
      'archive',
      destination,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (archive.status !== 0) throw new Error(archive.stderr);
  fs.writeFileSync(
    path.join(destination, 'integration-provenance.json'),
    JSON.stringify(
      {
        pr23,
        pr25,
        combinedTree,
        resolvedTree,
        resolution:
          'Retain PR23 unified routes; drop obsolete PR25 cashIn/cashOut conflict block; no other product edits',
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(destination, 'integration-merge-output.txt'), merge.stdout);
  fs.copyFileSync(
    path.join(
      root,
      'docs/transaction-history/fixtures/finance25-history-roundtrip.integration.spec.ts.template',
    ),
    path.join(destination, 'test/finance25-history-roundtrip.integration.spec.ts'),
  );
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'));
  fs.symlinkSync(
    path.join(root, 'apps/admin-web/node_modules'),
    path.join(destination, 'apps/admin-web/node_modules'),
  );
  if (fs.existsSync(path.join(root, '.env')))
    fs.symlinkSync(path.join(root, '.env'), path.join(destination, '.env'));
  console.log(JSON.stringify({ destination, pr23, pr25, combinedTree, resolvedTree }, null, 2));
} finally {
  fs.rmSync(indexPath, { force: true });
}
