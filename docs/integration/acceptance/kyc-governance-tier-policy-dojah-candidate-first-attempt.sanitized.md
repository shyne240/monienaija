# KYC governance/tier-policy isolated PostgreSQL acceptance — failed attempt

- Date: 2026-11-15 UTC
- Branch: `arena/5b239ff5-monienaija`
- Base/working HEAD at execution: `75300342666b7acc25207667a4a262fb23d4e191` (uncommitted working tree)
- PostgreSQL: isolated disposable socket-only cluster created by the repository runner.
- Raw transcript: `kyc-governance-tier-policy-dojah-candidate-isolated-pg.raw.log`.
- Provider calls: none.

## Command

```sh
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes NODE_ENV=test \
  node scripts/run-isolated-kyc-tests.js \
  test/kyc-provider-governance.isolated-pg.test.ts \
  test/kyc-tier-policy.isolated-pg.test.ts
```

## Result: FAIL (not a product-code claim)

- `kyc-tier-policy.isolated-pg.test.ts` passed.
- Provider governance had 3 test failures / 12 passes. The newly added Dojah fail-closed test published a provider version before later tests that intentionally assume versions 2 and 3. This was test-order contamination. The Dojah test was moved to the end of the file; the same isolated group must be rerun and its result recorded separately.
- This transcript is retained as the original failed execution; it is not replaced by a later pass.
