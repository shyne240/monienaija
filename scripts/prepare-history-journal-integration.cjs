#!/usr/bin/env node
'use strict';
// Build an ignored integration snapshot without creating/switching/merging any branch.
// Pinned PR23-owned Layout resolution plus explicit Finance loader compatibility resolution.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const [pr23, pr25] = process.argv.slice(2);
if (![pr23, pr25].every((sha) => /^[a-f0-9]{40}$/.test(sha || ''))) {
  throw new Error(
    'Usage: node scripts/prepare-history-journal-integration.cjs <PR23 SHA> <PR25 SHA>',
  );
}
if (
  pr23 !== 'bdbc7ceed188f7a9902d497fb4a5104ddb2ff370' ||
  pr25 !== '8301fa245e686c68a2fdce611c93cc191e2106d3'
) {
  throw new Error(
    'This diagnostic template is pinned to the recorded heads; review mappings/assertions before testing newer heads',
  );
}
const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options });
for (const sha of [pr23, pr25]) git(['cat-file', '-e', `${sha}^{commit}`]);
const destination = path.join(root, 'data/validation/finance25-journal-open');
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
const ledger = 'apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx';
if (conflicts.some((file) => ![layout, ledger].includes(file)))
  throw new Error(`Unexpected conflicts: ${conflicts.join(', ')}`);
let resolved = git(['show', `${combinedTree}:${layout}`]);
resolved = resolved.replace(
  /^<<<<<<< .*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .*$/gm,
  (_block, ours, theirs) => {
    if (ours.trim()) throw new Error('Unexpected non-empty PR23 Layout conflict');
    if (theirs.includes("case 'cashIn':") && theirs.includes("case 'cashOut':")) return '';
    if (theirs.trim() === 'initialReference={navContext.ledgerReference}') return theirs.trimEnd();
    throw new Error('Unexpected Layout conflict; review manually');
  },
);
// Both PRs introduce journalId in NavContext; retain Finance's documented declaration.
resolved = resolved.replace(
  '  transactionKey?: string;\n  journalId?: string;',
  '  transactionKey?: string;',
);
if (/^(<<<<<<<|=======|>>>>>>>)/m.test(resolved)) throw new Error('Unresolved Layout conflict');
if (
  !resolved.includes('onOpenJournal={(journalId)') ||
  !resolved.includes('initialJournalId={navContext.journalId}') ||
  !resolved.includes('initialReference={navContext.ledgerReference}')
)
  throw new Error('Finance context contract missing');
if (/case ['"]cash(In|Out)['"]/.test(resolved)) throw new Error('Obsolete product routes restored');
fs.mkdirSync(destination, { recursive: true });
const indexPath = path.join(destination, 'integration.index');
const env = { ...process.env, GIT_INDEX_FILE: indexPath };
try {
  git(['read-tree', combinedTree], { env });
  const blob = git(['hash-object', '-w', '--stdin'], { input: resolved }).trim();
  git(['update-index', '--cacheinfo', `100644,${blob},${layout}`], { env });
  // Finance owns the richer Ledger workspace. Its initialJournalId loader supersedes
  // PR23's compatible minimal loader; retain Finance metadata/search/reversal features.
  let financeLedger = git(['show', `${pr25}:${ledger}`]);
  // Preserve Finance's loader/context logic, but use PR23's re-entrant initial-ID
  // effect. A one-shot ref skips the second StrictMode effect after generation
  // cleanup invalidates the first request, leaving the journal blank.
  financeLedger = financeLedger
    .replace('  const autoOpened = useRef(false);\n', '')
    .replace(
      '    if (autoOpened.current || !canViewLedger) return;\n',
      '    if (!canViewLedger) return;\n',
    )
    .replace('    autoOpened.current = true;\n', '');
  const ledgerBlob = git(['hash-object', '-w', '--stdin'], { input: financeLedger }).trim();
  git(['update-index', '--cacheinfo', `100644,${ledgerBlob},${ledger}`], { env });
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
          'PR23-owned Layout resolution: unified History + journal callback; no cashIn/cashOut cases; retain all Finance contexts including journalId and ledgerReference. Ledger workspace retains PR25 implementation with PR23 re-entrant initialJournalId effect (no one-shot StrictMode ref).',
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(destination, 'integration-merge-output.txt'), merge.stdout);
  fs.copyFileSync(
    path.join(
      root,
      'docs/transaction-history/fixtures/finance25-journal-open.integration.spec.ts.template',
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
