# KYC governance/tier-policy isolated PostgreSQL acceptance — rerun

- Date: 2026-11-15 UTC
- Branch: `arena/5b239ff5-monienaija`
- Base/working HEAD at execution: `75300342666b7acc25207667a4a262fb23d4e191` (uncommitted working tree)
- PostgreSQL: isolated disposable socket-only cluster created by the repository runner.
- Provider calls: none. Dojah behavior was asserted only through governance/runtime routing code; no network transport was invoked.
- Raw transcript: `kyc-governance-tier-policy-dojah-candidate-rerun.raw.log`.
- Failed first attempt retained at `kyc-governance-tier-policy-dojah-candidate-first-attempt.sanitized.md` and its referenced raw transcript.

## Command

```sh
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes NODE_ENV=test \
  node scripts/run-isolated-kyc-tests.js \
  test/kyc-provider-governance.isolated-pg.test.ts \
  test/kyc-tier-policy.isolated-pg.test.ts
```

## Result

```text
PASS test/kyc-provider-governance.isolated-pg.test.ts (9.901 s)
PASS test/kyc-tier-policy.isolated-pg.test.ts

Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total
Snapshots:   0 total
Time:        10.95 s
Ran all test suites matching test/kyc-provider-governance.isolated-pg.test.ts|test/kyc-tier-policy.isolated-pg.test.ts.
```
