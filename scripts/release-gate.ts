#!/usr/bin/env ts-node
/**
 * ARENA 3D Group 34 — print the release gate.
 *
 * Reads the repository and prints the verdict, every blocker and every condition. Exits 1 when the
 * verdict is `NOT_READY`, so it can be a step in a pipeline rather than a document nobody opens.
 *
 * It deploys nothing, promotes nothing and contacts nothing. It has no flag to waive a blocker.
 *
 *   npm run gate:release
 */

import { join } from 'node:path';

import { evaluateRepositoryReleaseGate } from '../src/readiness/release-gate.service';

const report = evaluateRepositoryReleaseGate(join(__dirname, '..'));

console.log(`\nRELEASE GATE: ${report.verdict}`);
console.log(`${report.blockers.length} blocker(s), ${report.conditions.length} condition(s)\n`);

console.log('Input gates');
for (const gate of report.gates) {
  console.log(`  ${gate.verdict.padEnd(8)} ${gate.gate} — ${gate.detail}`);
}

if (report.blockers.length > 0) {
  console.log('\nBlockers');
  for (const blocker of report.blockers) {
    console.log(`  [${blocker.category}] ${blocker.id}`);
    console.log(`      ${blocker.summary}`);
    console.log(`      see ${blocker.evidence}`);
  }
}

if (report.conditions.length > 0) {
  console.log('\nConditions a human must accept');
  for (const condition of report.conditions) {
    console.log(`  ${condition.id}: ${condition.summary}`);
    console.log(`      see ${condition.evidence}`);
  }
}

console.log('\nNot performed by this gate');
for (const item of report.notPerformed) {
  console.log(`  - ${item}`);
}
console.log('');

process.exit(report.verdict === 'READY' ? 0 : 1);
