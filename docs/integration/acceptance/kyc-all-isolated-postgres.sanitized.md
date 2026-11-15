# KYC isolated PostgreSQL acceptance — full focused set

- Date: 2026-11-15 UTC
- Branch: `arena/5b239ff5-monienaija`
- Repository HEAD: `75300342666b7acc25207667a4a262fb23d4e191`; working tree was uncommitted.
- Database: disposable socket-only PostgreSQL cluster owned and removed by `scripts/run-isolated-kyc-tests.js`.
- Provider calls: none. All provider fixtures were synthetic; no external endpoint was contacted.
- Successful raw transcript: `kyc-all-isolated-postgres-rerun.raw.log`.
- First failed attempt retained at `kyc-all-isolated-postgres.raw.log`.

## Command

```sh
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes NODE_ENV=test \
  node scripts/run-isolated-kyc-tests.js \
  test/kyc-foundation.isolated-pg.test.ts \
  test/kyc-provider-governance.isolated-pg.test.ts \
  test/kyc-registration-api.isolated-pg.test.ts \
  test/kyc-registration-session.isolated-pg.test.ts \
  test/kyc-tier-policy.isolated-pg.test.ts \
  test/kyc-tier-transition.isolated-pg.test.ts
```

## Successful result

```text
PASS test/kyc-registration-api.isolated-pg.test.ts (16.546 s)
PASS test/kyc-tier-transition.isolated-pg.test.ts
PASS test/kyc-foundation.isolated-pg.test.ts
PASS test/kyc-registration-session.isolated-pg.test.ts
PASS test/kyc-provider-governance.isolated-pg.test.ts
PASS test/kyc-tier-policy.isolated-pg.test.ts

Test Suites: 6 passed, 6 total
Tests:       77 passed, 77 total
Snapshots:   0 total
Time:        22.126 s, estimated 25 s
```

## First-attempt diagnosis

The initial six-suite attempt failed in two test fixtures, not in a provider call or production database. The registration API's manually assembled Nest test module lacked the newly injected `ProtectedAuthorityService`; the tier-transition test schema had not applied the new provider-governance and protected-authority migrations. Both fixtures were updated, then the full six-suite group passed. The unsuccessful transcript is retained separately and is not represented as a pass.
