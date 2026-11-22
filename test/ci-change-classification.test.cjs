'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPaths } = require('../scripts/classify-ci-changes.cjs');

test('documentation-only changes skip app and PostgreSQL jobs', () => {
  assert.deepEqual(classifyPaths(['README.md', 'docs/CI-POLICY.md']), {
    backend: false,
    admin_web: false,
    agent_mobile: false,
    customer_mobile: false,
    full_regression: false,
  });
});

test('frontend-only changes run that app without backend PostgreSQL suites', () => {
  assert.deepEqual(classifyPaths(['apps/admin-web/src/App.tsx', 'apps/admin-web/__tests__/App.test.tsx']), {
    backend: false,
    admin_web: true,
    agent_mobile: false,
    customer_mobile: false,
    full_regression: false,
  });
  assert.deepEqual(classifyPaths(['apps/customer-mobile/src/login.tsx']), {
    backend: false,
    admin_web: false,
    agent_mobile: false,
    customer_mobile: true,
    full_regression: false,
  });
});

test('backend-risk changes run all clients and full backend regression', () => {
  for (const path of [
    'src/migrations/20261122000000-AddJournalIndex.ts',
    'src/ledger/transfer.service.ts',
    'src/auth/session.service.ts',
    '.github/workflows/ci.yml',
    'scripts/new-shared-task.cjs',
  ]) {
    assert.deepEqual(classifyPaths([path]), {
      backend: true,
      admin_web: true,
      agent_mobile: true,
      customer_mobile: true,
      full_regression: false,
    }, path);
  }
});

test('mixed documentation and frontend changes remain frontend-only', () => {
  assert.equal(classifyPaths(['docs/operations.md', 'apps/agent-mobile/App.tsx']).backend, false);
  assert.equal(classifyPaths(['docs/operations.md', 'apps/agent-mobile/App.tsx']).agent_mobile, true);
});

test('release milestones force comprehensive regression', () => {
  assert.deepEqual(classifyPaths([], true), {
    backend: true,
    admin_web: true,
    agent_mobile: true,
    customer_mobile: true,
    full_regression: true,
  });
});
