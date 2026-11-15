# KYC governance and tier-policy isolated PostgreSQL acceptance — historical baseline

> This 14-test run predates the Dojah-candidate and protected-authority fixture additions. The current six-suite isolated PostgreSQL result is documented in [the full focused-set handoff](kyc-all-isolated-postgres.sanitized.md); retain this transcript only as historical evidence.

- Date: 2026-11-15 UTC
- Branch: `arena/5b239ff5-monienaija`
- Base/working HEAD at execution: `75300342666b7acc25207667a4a262fb23d4e191` (uncommitted working tree)
- PostgreSQL: disposable socket-only cluster created and owned by `scripts/run-isolated-kyc-tests.js`; no existing or production database was used.
- Provider calls: none.
- Raw transcript: `kyc-governance-tier-policy-isolated-pg.raw.log` (Jest output; no secrets or customer data).

## Command

```sh
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes NODE_ENV=test \
  node scripts/run-isolated-kyc-tests.js \
  test/kyc-provider-governance.isolated-pg.test.ts \
  test/kyc-tier-policy.isolated-pg.test.ts
```

## Result

```text
PASS test/kyc-provider-governance.isolated-pg.test.ts (13.247 s)
PASS test/kyc-tier-policy.isolated-pg.test.ts

Test Suites: 2 passed, 2 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        14.567 s
Ran all test suites matching test/kyc-provider-governance.isolated-pg.test.ts|test/kyc-tier-policy.isolated-pg.test.ts.
```
