# Socket-only PostgreSQL Integration — Isolated KYC Lane

- **Run:** `KYC_ISOLATED_CONFIRM_DISPOSABLE=yes NODE_OPTIONS="--max-old-space-size=3072 --require=.../mission-25c-network-guard.cjs" node scripts/run-isolated-kyc-tests.js --json --outputFile=/tmp/isolated-kyc.json`
- **Candidate:** e9e5651d (source identical to 06ce279e evidence-only drift)
- **Result:** 11/11 suites PASSED, 149/149 tests, 0 failed, socket-only disposable cluster per suite
- **Completed:** 2026-11-20T14:01 UTC, duration 188.9s
- **Provenance:** socket-only, trust auth, marker `.kyc-isolated-disposable-cluster`, `listen_addresses=''`
