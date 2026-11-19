#!/usr/bin/env node
'use strict';
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const JEST_BIN = path.join(ROOT, 'node_modules/jest/bin/jest.js');
const CONFIG = path.join(ROOT, 'jest.integration.config.js');
const NETWORK_GUARD = path.join(ROOT, 'test/support/mission-25c-network-guard.cjs');

const BATCH_SIZE = parseInt(process.env.PG_TEST_BATCH_SIZE || '3', 10);
const RUN_ID_PREFIX = process.env.PG_TEST_RUN_ID_PREFIX || 'f04b';
const MANIFEST_PATH = process.env.PG_MANIFEST_PATH || path.join(ROOT, 'docs/integration/evidence/pg-resumable-manifest.json');
const CANDIDATE = process.env.CANDIDATE || require('node:child_process').execSync('git rev-parse HEAD', {cwd: ROOT}).toString().trim().slice(0,8);

function listTests() {
  const r = spawnSync(process.execPath, ['-r', NETWORK_GUARD, JEST_BIN, '--config', CONFIG, '--listTests'], {cwd: ROOT, encoding:'utf8'});
  if (r.status!==0) throw new Error(`listTests failed: ${r.stderr}`);
  return r.stdout.split('\n').map(s=>s.trim()).filter(Boolean);
}
function chunk(arr,size){ const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }

function runBatch(files, batchIndex) {
  const runId = `${RUN_ID_PREFIX}${String(batchIndex+1).padStart(2,'0')}`; // e.g., f04b01
  const outFile = `/tmp/batch-${runId}.json`;
  const start = Date.now();
  const args = ['--max-old-space-size=1536', '-r', NETWORK_GUARD, JEST_BIN, '--config', CONFIG, '--runInBand', '--json', `--outputFile=${outFile}`, ...files];
  console.log(`\n=== Batch ${batchIndex+1} runId=${runId} ${files.length} files ===`);
  const child = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PG_TEST_RUN_ID: runId, NODE_ENV: 'test', DB_HOST: '127.0.0.1', PG_TEST_CONFIRM_DISPOSABLE_CLUSTER: 'yes' },
    maxBuffer: 64*1024*1024,
    timeout: 600000 // 10 min per batch max
  });
  const durationMs = Date.now()-start;
  let json = null;
  try { if (fs.existsSync(outFile)) json = JSON.parse(fs.readFileSync(outFile,'utf8')); } catch(e){ console.error(`Failed to parse ${outFile}: ${e.message}`); }
  const exitCode = child.status;
  const signal = child.signal;
  // Parse from json if available
  let passed=0, failed=0, skipped=0, total=0;
  let suitesPassed=[], suitesFailed=[];
  if (json) {
    for (const tr of json.testResults) {
      const suitePath = tr.name.replace(ROOT+'/', '');
      if (tr.status==='passed') { passed+= tr.numPassingTests; suitesPassed.push(suitePath); }
      else if (tr.status==='failed') { failed+= tr.numFailingTests; suitesFailed.push(suitePath); }
      total+= tr.numPassingTests + tr.numFailingTests + tr.numPendingTests;
      skipped+= tr.numPendingTests;
    }
    // More accurate: use assertionResults
    if (json.numPassedTests!==undefined) { passed=json.numPassedTests; failed=json.numFailedTests; total=json.numTotalTests; skipped=json.numPendingTests; }
  }
  const manifestEntry = {
    batch: batchIndex+1,
    runId,
    suitePaths: files.map(f=>f.replace(ROOT+'/','')),
    command: `PG_TEST_RUN_ID=${runId} NODE_ENV=test DB_HOST=127.0.0.1 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes node ${JEST_BIN} --config ${CONFIG} --runInBand --json --outputFile=${outFile} ${files.map(f=>f.replace(ROOT+'/','')).join(' ')}`,
    env: { PG_TEST_RUN_ID: runId, NODE_ENV: 'test', DB_HOST: '127.0.0.1', PG_TEST_CONFIRM_DISPOSABLE_CLUSTER: 'yes', PG_TEST_BATCH_SIZE: String(BATCH_SIZE), candidate: CANDIDATE },
    exitCode,
    signal,
    durationMs,
    passed,
    failed,
    skipped,
    total,
    suitesPassed,
    suitesFailed,
    completedAt: new Date().toISOString(),
    candidate: CANDIDATE
  };
  // Retry logic for SIGABRT/OOM/timeout: if exitCode null or signal set, treat as incomplete
  if (signal || exitCode===null) {
    manifestEntry.status = 'INCOMPLETE';
    manifestEntry.note = `Process terminated with signal ${signal} or timeout, not passing`;
  } else if (exitCode!==0) {
    manifestEntry.status = 'FAILED';
  } else {
    manifestEntry.status = 'PASSED';
  }
  return manifestEntry;
}

async function main(){
  if (process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER!=='yes') throw new Error('PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes required');
  const allFiles = listTests();
  console.log(`Discovered ${allFiles.length} suites, batch size ${BATCH_SIZE}, ${Math.ceil(allFiles.length/BATCH_SIZE)} batches`);
  const batches = chunk(allFiles, BATCH_SIZE);
  let manifest = [];
  // Load existing manifest if exists to resume — handle both legacy array and current object-with-batches formats
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(MANIFEST_PATH,'utf8'));
      if (Array.isArray(loaded)) manifest = loaded;
      else if (loaded && Array.isArray(loaded.batches)) manifest = loaded.batches;
      else manifest = [];
      console.log(`Resuming from existing manifest with ${manifest.length} batches`);
    } catch {}
  }
  const startBatch = manifest.length; // resume from next batch
  for (let i=startBatch; i<batches.length; i++) {
    const entry = runBatch(batches[i], i);
    manifest.push(entry);
    // Persist after every batch
    fs.mkdirSync(path.dirname(MANIFEST_PATH), {recursive:true});
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ candidate: CANDIDATE, runIdPrefix: RUN_ID_PREFIX, batchSize: BATCH_SIZE, totalBatches: batches.length, totalSuites: allFiles.length, batches: manifest, completed: manifest.length, remaining: batches.length - manifest.length, lastUpdated: new Date().toISOString() }, null, 2));
    console.log(`Batch ${entry.batch} ${entry.status} exit=${entry.exitCode} signal=${entry.signal} passed=${entry.passed} failed=${entry.failed} duration=${entry.durationMs}ms`);
    if (entry.status==='INCOMPLETE') {
      console.log(`Batch ${entry.batch} incomplete due to ${entry.signal}, will retry each suite individually`);
      // Retry each suite individually
      for (const file of batches[i]) {
        const singleRunId = `${RUN_ID_PREFIX}${String(i+1).padStart(2,'0')}s${path.basename(file).slice(0,2)}`;
        const singleOut = `/tmp/batch-${singleRunId}.json`;
        const singleArgs = ['--max-old-space-size=1536', '-r', NETWORK_GUARD, JEST_BIN, '--config', CONFIG, '--runInBand', '--json', `--outputFile=${singleOut}`, file];
        const singleStart = Date.now();
        const singleChild = spawnSync(process.execPath, singleArgs, {cwd: ROOT, encoding:'utf8', env: {...process.env, PG_TEST_RUN_ID: singleRunId.slice(0,15), NODE_ENV:'test', DB_HOST:'127.0.0.1', PG_TEST_CONFIRM_DISPOSABLE_CLUSTER:'yes'}, maxBuffer: 64*1024*1024, timeout: 300000});
        let singleJson=null; try{ if(fs.existsSync(singleOut)) singleJson=JSON.parse(fs.readFileSync(singleOut,'utf8')); }catch{}
        const singleEntry = {
          batch: `${i+1}.1`,
          runId: singleRunId.slice(0,15),
          suitePaths: [file.replace(ROOT+'/','')],
          command: `PG_TEST_RUN_ID=${singleRunId.slice(0,15)} node ${JEST_BIN} --runInBand ${file.replace(ROOT+'/','')}`,
          exitCode: singleChild.status,
          signal: singleChild.signal,
          durationMs: Date.now()-singleStart,
          passed: singleJson? singleJson.numPassedTests:0,
          failed: singleJson? singleJson.numFailedTests:0,
          status: singleChild.status===0 ? 'PASSED':'FAILED',
          candidate: CANDIDATE
        };
        console.log(`  Single ${file.replace(ROOT+'/','')} ${singleEntry.status} exit=${singleEntry.exitCode}`);
      }
    }
    // Avoid running next batch immediately if memory pressure: small pause
    await new Promise(r=>setTimeout(r, 1000));
  }
  console.log(`\n=== All batches complete: ${manifest.length}/${batches.length} ===`);
  const totals = manifest.reduce((acc,e)=>{ acc.passed+=e.passed; acc.failed+=e.failed; acc.total+=e.total; acc.batchesPassed+= e.status==='PASSED'?1:0; acc.batchesFailed+= e.status==='FAILED'?1:0; acc.batchesIncomplete+= e.status==='INCOMPLETE'?1:0; return acc; },{passed:0,failed:0,total:0,batchesPassed:0,batchesFailed:0,batchesIncomplete:0});
  console.log(`Totals: batchesPassed=${totals.batchesPassed} failed=${totals.batchesFailed} incomplete=${totals.batchesIncomplete} testsPassed=${totals.passed} failed=${totals.failed} total=${totals.total}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
