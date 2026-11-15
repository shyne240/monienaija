# KYC provider and tier-decision unit acceptance

- Date: 2026-11-15 UTC
- Branch: `arena/5b239ff5-monienaija`
- Base/working HEAD at execution: `75300342666b7acc25207667a4a262fb23d4e191` (uncommitted working tree)
- Provider transport: test doubles only; no external or live provider calls.
- Raw transcript: `kyc-provider-and-tier-unit.raw.log` (Jest output; synthetic fixtures only).

## Command

```sh
node -r ./test/support/mission-25c-network-guard.cjs \
  ./node_modules/jest/bin/jest.js --runInBand \
  test/dojah-verification.unit.spec.ts \
  test/monnify-verification.unit.spec.ts \
  test/kyc-foundation.unit.spec.ts \
  test/kyc-tier-decision.unit.spec.ts
```

## Result

```text
PASS test/dojah-verification.unit.spec.ts (8.404 s)
PASS test/monnify-verification.unit.spec.ts
PASS test/kyc-foundation.unit.spec.ts
PASS test/kyc-tier-decision.unit.spec.ts

Test Suites: 4 passed, 4 total
Tests:       65 passed, 65 total
Snapshots:   0 total
Time:        9.393 s, estimated 15 s
Ran all test suites matching test/dojah-verification.unit.spec.ts|test/monnify-verification.unit.spec.ts|test/kyc-foundation.unit.spec.ts|test/kyc-tier-decision.unit.spec.ts.
```
