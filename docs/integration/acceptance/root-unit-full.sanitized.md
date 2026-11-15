# Root unit-suite acceptance

- Date: 2026-11-15 UTC
- Branch: `arena/5b239ff5-monienaija`
- Repository HEAD: `75300342666b7acc25207667a4a262fb23d4e191`; working tree was uncommitted.
- Network: the repository's `mission-25c-network-guard.cjs` was preloaded; the suite passed with synthetic fixtures and mocked transports.
- Successful raw transcript: `root-unit-full-rerun.raw.log`.
- Initial failed transcript: `root-unit-full.raw.log`.

## Command

```sh
node -r ./test/support/mission-25c-network-guard.cjs \
  ./node_modules/jest/bin/jest.js --runInBand
```

## Successful result

```text
Test Suites: 251 passed, 251 total
Tests:       2938 passed, 2938 total
Snapshots:   0 total
Time:        74.26 s, estimated 126 s
Ran all test suites.
```

The first full run had one module-wiring suite with seven failures because `KycTierModule` used `ProtectedAuthorityService` without importing the module that provides it. `KycTierModule` now explicitly imports `ProtectedAuthorityModule`; the focused wiring test then passed all 8 tests, and the complete root suite passed on rerun.
