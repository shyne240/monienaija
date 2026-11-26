'use strict';
// Jest's default reporter omits a per-file line for a fully skipped suite.
// Only explicit, nonempty, wholly pending assertions in its JSON report count as SKIP.
exports.skippedSuites = (report, files, root, reported) =>
  (report.testResults || []).filter((suite) =>
    files.includes(suite.name) &&
    suite.status === 'skipped' &&
    suite.assertionResults?.length > 0 &&
    suite.assertionResults.every((test) => test.status === 'pending') &&
    !reported.some((result) => result.file === suite.name.replace(`${root}/`, ''))
  ).map((suite) => ({status: 'SKIP', file: suite.name.replace(`${root}/`, ''), durationSeconds: null}));
