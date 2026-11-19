'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, reusable } = require('./p2p-acceptance-pg.cjs');
const file = 'test/a.integration.spec.ts';
const full = `/archive/${file}`;
const json = { success: true, numTotalTestSuites: 1, numPassedTestSuites: 1, numPassedTests: 2,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: 2,
  testResults: [{ name: full, status: 'passed' }] };
test('missing, wrong-file and inconsistent structured results are not passes', () => {
  for (const [j, name] of [[undefined, full], [json, file], [{ ...json, numTotalTests: 5 }, full]]) {
    assert.equal(classify(j, name, 0, null).status, 'NO_RESULT');
  }
});
test('requires both a clean process exit and a full Jest suite pass', () => {
  for (const [j, code, sig] of [[json, null, 'SIGKILL'], [json, 1, null],
    [{ ...json, success: false, numPassedTestSuites: 0 }, 0, null],
    [{ ...json, numTodoTests: 1, numTotalTests: 3 }, 0, null]]) {
    assert.equal(classify(j, full, code, sig).status, 'FAIL');
  }
  assert.equal(classify(json, full, 0, null).status, 'PASS');
});
test('resume accepts only firsthand complete results with identical provenance', () => {
  const profile = { source: 'a', inventory: 'b' };
  const s = { ...classify(json, full, 0, null), exit: 0, signal: null };
  const report = { profile, suites: { [file]: s } };
  assert.ok(reusable(report, profile, file));
  assert.throws(() => reusable(report, { ...profile, source: 'c' }, file));
  for (const change of [{ status: 'RUNNING' }, { status: 'REUSED' }, { exit: 1 }, { skipped: 1 }, { passed: 0 }]) {
    assert.ok(!reusable({ ...report, suites: { [file]: { ...s, ...change } } }, profile, file));
  }
});
