# ARENA 4 — Sprint 2 Ordinary Agent V1 UAT Readiness

**Branch:** `arena/870f970d-monienaija`  
**Common Sprint 2 baseline:** `dc8c1098a0b9a660ac3b5a595149de6c8522aeda`  
**Assessment date:** 2026-10-26  
**Scope:** Independent evidence on the common baseline only. No active ARENA 1/2/3 branch changes are assumed or tested.

## 1. Verification record

- Assigned branch is `arena/870f970d-monienaija`; initial worktree was clean and HEAD exactly matched the common Sprint 2 baseline SHA above.
- This baseline retains the earlier plan and execution record (`docs/A4-ORDINARY-AGENT-UAT-PLAN.md` and `docs/A4-ORDINARY-AGENT-UAT-EXECUTION-20261026.md`).
- Newly added authenticated HTTP receipt-recovery case was run through the repository PostgreSQL runner against disposable embedded PostgreSQL 18.4. The runner executed `test/a16-agent-cash-to-cash-claim.integration.spec.ts`: **1 suite / 51 tests passed**. The case itself authenticates Agent B, recovers a previously committed cash claim using the real HTTP GET route after deliberately discarding the command response value, checks a different Agent gets 404, and reconciles persisted journal ID, line accounts, amounts, balances, and agent history.
- The prior baseline-targeted evidence remains in the execution record: 20 PostgreSQL integration suites / 382 tests, backend unit suite 191 / 1,959, agent-mobile tests 18 / 279, admin-web tests 23 / 154, TypeScript checks, and builds. Those are evidence from the previous ARENA 4 turn on the same baseline; only A16 was re-executed for this incremental case.

## 2. Readiness matrix

| Area / priority | Evidence at common baseline | Status / remaining gap |
|---|---|---|
| Agent application, review, activation | A8 lifecycle, A21 agent app, credential issuance suites | Automated API/database integration covered. Human business-review/UAT sign-off not provided. |
| Authentication, credential issue/rotation, session revocation | A7 HTTP authentication, V1 credentials suite, PIN/MFA security suites | Automated backend tests covered. Physical device session UX not run. |
| Transaction PIN, capabilities, authorization | V1 PIN security, A10 capabilities, A11 transaction authorization, A12 execution | Automated checks covered, including denied paths. External workforce IdP certification is not evidenced. |
| Funding / maker-checker role separation | A19 agent funding and supporting authorization tests | Database-backed funding governance covered in integrated tests. Independent finance/operator workflow browser journey remains untested. |
| Cash-to-Cash initiation | A15 and mobile idempotency persistence suite | PostgreSQL tests cover real transaction and idempotency behavior. Mobile UI tests are component-level, not a device journey. |
| Customer-wallet redemption | A16 claim suite and competing-destination test | Persisted wallet credit and exact-once race behavior covered. |
| Agent B cash redemption | A16 cash-payout, capability/PIN and KYC checks | Persisted Agent B credit and unclaimed-liability debit covered. |
| OTP failure, replay, expiry; concurrent claim; expiry rollback | A16/A17 tests | Covered in persisted PostgreSQL tests; covered scenarios pass. |
| Lost-response recovery | Previously, service recovery and unauthenticated HTTP recovery were covered, but the authenticated real HTTP recovery path after a successful settlement was not. New A16 test 50 closes this identified API coverage gap. | New test passes. It models ambiguous response by discarding the commit result before invoking recovery; it does not simulate a TCP connection being severed after server commit. |
| Receipt/history/reconciliation | A16 recovery/history assertions and independent ledger SQL checks | Receipt/history and core postings reconciled in covered scenarios. Broader independent periodic reconciliation remains an operational release exercise. |
| Admin monitoring / audit | Existing A16/A22 and admin-web suites | Existing automated coverage. No real workforce-authenticated browser journey performed. |
| Admin Web browser journey | No browser executable in PATH; Playwright's expected browser cache executable was absent. The bundled `@sparticuz/chromium` can unpack `/tmp/chromium`, but launch fails because host library `libnspr4.so` is unavailable. | **Not run.** Prerequisites: browser runtime dependencies including NSPR/NSS libraries (or a supported Playwright Chromium install), and a seeded isolated backend plus test workforce identity. |
| Agent Mobile device/emulator journey | No `adb`, `emulator`, Android device, or iOS simulator command/device is available. | **Not run.** Prerequisites: Android SDK/emulator or a physical Android device (or macOS/Xcode iOS simulator), Expo native build/runtime, and isolated backend with test agent credentials. |

## 3. Financial invariants independently verified

The new recovery case does not treat the API's recovery body as financial truth. It queries PostgreSQL after settlement and asserts:

- The transfer persisted in the claimed state and identifies one claim journal.
- Exactly two persisted lines exist for the journal: a debit to the Cash-to-Cash unclaimed-liability account and a credit to Agent B's wallet/float account, each equal to the principal amount in NGN.
- Debit sum equals credit sum and both equal the expected amount.
- The persisted unclaimed balance decreased and Agent B's balance increased by exactly the principal amount.
- Recovery returns the same persisted journal and idempotency key; Agent history contains the corresponding completed credit.
- A different authenticated Agent cannot access that claim receipt (404).

The wider existing A16 tests cover customer-wallet credit destination, competing claim concurrency, failure rollback/no partial postings, duplicate/replayed attempts, OTP/expiry failures, and balance/history assertions. The UAT report only claims these invariants for tested cases, not exhaustive proof over all state interleavings.

## 4. Blocker classification

### Critical security / financial blockers

- **Frontend dependency audit requires triage before release.** Previous `npm ci` reported critical and high vulnerability counts in both frontend dependency trees (agent-mobile: 6 total including 1 critical; admin-web: 34 total including 1 critical). This is not a confirmed exploitable defect and no package-level audit was done in this sprint, but a critical dependency alert is a release gate until the owning team identifies affected packages, reachability, and a remediation or documented exception.
- No new financial-control or authorization defect was found by the new test. This is not penetration-test clearance.

### Missing approved product / compliance decisions

ARENA 1's sprint report identifies unresolved decision/review topics: credential-revocation races during in-flight claims; wallet-mode KYC expiry policy; transfer-code attempt atomicity; expired-fund disposition; and human review/controls for physical cash handover. These require product, risk/compliance, or operations owners; ARENA 4 has not inferred approval. See `docs/ARENA1-ORDINARY-AGENT-V1-BACKEND-SPRINT-20261026.md`.

### Functional gaps

- No functional defect was reproduced in the tests run for this assessment.
- Authenticated HTTP receipt-recovery authorization and persistence linkage had a meaningful test gap; new test 50 covers this. Actual network-level post-commit response loss remains a coverage enhancement (see below), not a known defect.

### Environment / test coverage limitations

- No supported browser launch because the runtime lacks `libnspr4.so`; no external browser journey was claimed.
- No physical mobile device, Android emulator, or iOS simulator.
- The new recovery test discards the successful service response rather than forcibly dropping a real HTTP response after commit; full network ambiguity simulation is not implemented.
- Full 113-suite PostgreSQL regression battery was not rerun by ARENA 4 in this Sprint 2 turn. ARENA 3's earlier baseline report remains upstream evidence only.

### Nonblocking improvements

- Add supported Chromium dependencies to the runner image and automate admin-web workforce login, agent review/activation, and funding maker-checker screens against isolated seeded API data.
- Add a test proxy/fault-injection layer that disconnects the client after the server commits, then exercises mobile pending-operation recovery and receipt lookup end-to-end.
- Expand independent journal reconciliation across both redemption destinations and admin dashboards, and preserve machine-readable UAT artifacts per run.

## 5. Exact incremental change

- `test/a16-agent-cash-to-cash-claim.integration.spec.ts` — adds one authenticated HTTP receipt-recovery / cross-agent authorization test with direct persisted-ledger reconciliation.
- `docs/A4-SPRINT2-UAT-READINESS-20261026.md` — this readiness matrix and blocker classification.

No application services, APIs, operational controllers, frontend features, migrations, or fixtures used against production were changed. All test identities and databases are synthetic and isolated.
