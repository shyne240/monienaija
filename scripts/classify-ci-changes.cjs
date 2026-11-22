#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function classifyPaths(paths, fullRegression = false) {
  if (fullRegression) {
    return { backend: true, admin_web: true, agent_mobile: true, customer_mobile: true, full_regression: true };
  }

  // Markdown is documentation regardless of its directory. All other unmatched paths are
  // intentionally backend-risk: new/shared code, configs, migrations, workflows and scripts
  // must not accidentally opt out of the PostgreSQL safeguards.
  const files = paths.filter((path) => !path.endsWith('.md'));
  if (files.length === 0 && paths.length > 0) {
    return { backend: false, admin_web: false, agent_mobile: false, customer_mobile: false, full_regression: false };
  }

  const scopes = {
    backend: false,
    admin_web: false,
    agent_mobile: false,
    customer_mobile: false,
    full_regression: false,
  };

  for (const file of files) {
    if (file.startsWith('apps/admin-web/')) scopes.admin_web = true;
    else if (file.startsWith('apps/agent-mobile/')) scopes.agent_mobile = true;
    else if (file.startsWith('apps/customer-mobile/')) scopes.customer_mobile = true;
    else scopes.backend = true;
  }

  // Backend/API/shared or unclassified changes can affect every client. The full PostgreSQL
  // suites remain mandatory for those changes; frontend-only changes stay isolated.
  if (scopes.backend) {
    scopes.admin_web = true;
    scopes.agent_mobile = true;
    scopes.customer_mobile = true;
  }
  return scopes;
}

function main(argv) {
  const arg = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const fullRegression = arg('--full') === 'true';
  const base = arg('--base');
  const head = arg('--head') || process.env.GITHUB_SHA;
  const outputPath = arg('--output') || process.env.GITHUB_OUTPUT;

  let changedPaths = [];
  if (!fullRegression) {
    if (!base || !head) throw new Error('Both --base and --head are required outside release mode.');
    changedPaths = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    // An empty diff is unexpected in CI. Treat it conservatively, rather than skipping regression.
    if (changedPaths.length === 0) changedPaths = ['__unclassified_empty_diff__'];
  }

  const scopes = classifyPaths(changedPaths, fullRegression);
  const values = Object.entries(scopes).map(([key, value]) => `${key}=${value}`);
  if (outputPath) fs.appendFileSync(outputPath, `${values.join('\n')}\n`);
  else console.log(values.join('\n'));
}

module.exports = { classifyPaths };
if (require.main === module) main(process.argv.slice(2));
