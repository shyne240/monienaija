# ARENA 3 — Sprint 3 FINAL INTEGRATION AND REGRESSION REPORT

- **Date:** 2026-10-27
- **Integration branch:** `arena/8e59e188-monienaija` (this branch only; no merge to main, no deployment, no production migration)
- **Role:** ARENA 3 (backend) — designated integrator for Sprint 3
- **Common Sprint 3 baseline:** `3428e37e02e7ea55b431f8d2d461fb2356a418de` (verified ancestor of all four source HEADs and of the final integrated HEAD)

---

## 1. Phase 1 — Verified sources

Fetched from `origin` and verified **exactly** (no discrepancy found):

| Workstream | Branch | Verified remote HEAD |
|---|---|---|
| ARENA 1 (backend C2C six-digit redemption) | `arena/92fd33dd-monienaija` | `d0d8f6c61a2d243dda69e45c342195ae4526c098` |
| ARENA 2 (frontend admin-web + agent-mobile) | `arena/ea070127-monienaija` | `3ace1511374ea250c9c14d86ceb957f2e5f51081` |
| ARENA 3 (workforce API + authorization, own work) | `arena/8e59e188-monienaija` | `bad1b9b2b521af96644329a73491f32c8b50680b` |
| ARENA 4 (UAT / release evidence, docs-only) | `arena/870f970d-monienaija` | `270cf8fa50b9f12c5c82610e6b531faa7d9c63ba` |

Sandbox-reset recovery (repeat of the Sprint 3 Phase 0 anomaly): the local checkout was
found stale at `3d05aae` with a dirty mid-sprint snapshot; remote history was intact.
Recovered by `git fetch` + ancestry verification (`3d05aae` is an ancestor of `bad1b9b`,
pure fast-forward) + local-only `git reset --hard bad1b9b`. No force-push, no history
rewrite, no other branch touched. Environment rebuilt (root `npm ci` 552 pkgs, admin-web,
agent-mobile 1076 pkgs; `.env` regenerated; embedded PostgreSQL 18.4 reinitialized).

## 2. Phase 2 — Merge sequence and ancestry proof

Normal `git merge --no-ff`, in order, onto ARENA 3's `bad1b9b`:

| Merge commit | Source | Files | Conflicts |
|---|---|---|---|
| `8cf6648` | ARENA 1 `d0d8f6c` (3 commits: `da3a3b5`, `e81f5f7`, `d0d8f6c`) | 15 files, +927/−12 | **none** |
| `a6e6518` | ARENA 2 `3ace151` (3 commits: `1c0251d`, `592733e`, `3ace151`) | 32 files, +4282/−555 | **none** |
| `49ac0ac` | ARENA 4 `270cf8f` (1 commit, docs-only) | 1 file, +105 | **none** |

Pre-merge pairwise file-overlap analysis across all four deltas (including ARENA 3's own
7 files): **zero overlapping paths** — no textual conflict was possible. All Sprint 2
integration history (`dc8c109` → … → `652b20d` → `3428e37`) and every source commit are
preserved in ancestry.

**Ancestry proof (executed after `49ac0ac`):** `git merge-base --is-ancestor` returned true
for all four source HEADs (`d0d8f6c`, `3ace151`, `bad1b9b`, `270cf8f`) against the
integration HEAD, and for baseline `3428e37` against each source.

Post-merge integration commits (semantic reconciliation — see below):
- `18a9686` — Admin Web unified-history panel ↔ backend projection shape reconciliation (+ bridge test)
- `449ff8d` — migration-head assertion reconciliation for approved `1785753600096` (7 suites)
- `845b027` — lint-parity cleanup of the migration-upgrade suite
- (this report)

## 3. Phase 3 — Six-digit Cash-to-Cash audit (12-point checklist)

Contract sources: `docs/APPROVED-C2C-SIX-DIGIT-REDEMPTION-CONTRACT.md` (approved,
supersedes the 128-bit proposal in `ARENA1-SPRINT3-C2C-REDEMPTION-CONTRACT-20261026.md`)
and `docs/ARENA2-SPRINT3-FINAL-FRONTEND-INTEGRATION-20261027.md`. Verified against merged
code and executed tests — frontend and backend agree on all 12 points:

1. **Initiation `POST /api/v1/agents/cash-to-cash` with required `senderPhone`** — backend
   `CashToCashDto.senderPhone` required (`@IsString @Length(1,20)`, canonicalized to ten
   digits beginning 7/8/9 in the service, `BadRequest` on invalid); mobile
   `AgentCashToCashRequest.senderPhone` required and explicitly collected from the sending
   customer (never inferred from Agent A's phone). Phase 7 spec proves the exact serialized
   mobile payload validates and that a missing `senderPhone` is rejected at runtime.
2. **Six-character `transferNumber`, leading zeros preserved** — allocation
   `crypto.randomInt(0,1_000_000).toString().padStart(6,'0')` inside the SERIALIZABLE
   initiation transaction; DTOs `@Matches(/^[0-9]{6}$/)` on a JSON string; mobile serializes
   it as a trimmed 6-char string and renders it as text (a16 test "six-digit locators
   preserve leading zeros…"; Phase 7 spec rejects `'42'`, `'0000422'`, `'00004a'`, numeric 42).
3. **`POST /api/v1/agents/cash-to-cash/claim-by-number`** — exists (claim controller),
   session-Agent-bound, resolves the immutable pair through database-backed rate budgets and
   delegates to the SAME `AgentCashToCashClaimService.execute()` (single settlement path).
4. **`POST /api/v1/agents/cash-to-cash/claims/recover-by-number`** — exists; requires the
   same claiming Agent's current session plus the ORIGINAL financial idempotency key
   (mismatch → generic 404); never consumes OTP or replays the secret code/PIN.
5. **Claim DTO fields + method-specific validation** — `CashToCashLocatorClaimDto` =
   shared claim fields + `senderPhone` + `transferNumber` + `@IsEmpty() transferId` (supplying
   transferId is a validation error — proven in Phase 7 spec); mobile always sends
   `redemptionMethod`, adds `agentPin` (untrimmed secret) only for `AGENT_CASH`, and strips
   any stray `transferId` client-side. AGENT_CASH PIN/eligibility checks remain in the
   canonical claim service.
6. **Authenticated Agent ownership and idempotency** — `requireAgent` binds
   `principal.type==='AGENT'` and `agentId===principalId`; canonical idempotency unchanged;
   locator fields do not create a second financial fingerprint (number-route and UUID-route
   requests with identical financial parameters converge on the same journal — a16 "number
   and UUID claims racing settle exactly once").
7. **404 `C2C_CLAIM_NOT_AVAILABLE`** — exact message `Claim not available`, uniform for
   unknown pair/wrong code/phone/customer/OTP/KYC/PIN/capability/lockout/expiry/claimed/
   foreign recovery/wrong key (a16 "locator failures are non-enumerating…").
8. **429 `C2C_LOCATOR_RATE_LIMITED`** — shared budgets 20/60s per Agent, 100/60s per
   canonical sender phone, 10/60s per pair; atomic PostgreSQL upserts charged before pair
   resolution, persisting outside settlement transactions (a16 rate-limit coverage).
9. **409 `C2C_LOCATOR_UNAVAILABLE`** — initiation collision exhaustion after 32 CSPRNG
   retries; whole transaction (journal, transfer, limits, idempotency reservation) rolls
   back; mobile retains the persisted idempotency key on 409 per contract.
10. **503 `C2C_RETRY_REQUIRED` + ambiguous-outcome recovery** — non-4xx failures inside the
    locator adapter raise 503 `Claim outcome unavailable; recover before retrying`; mobile
    recovers via `recover-by-number` with the ORIGINAL key, locks the redemption method and
    hides "change payout method" after any ambiguous outcome; 100 ms scheduling floor
    equalizes cheap unknown-vs-invalid timings (documented as not a constant-time guarantee).
11. **Public locator copy/share never exposes the secret transfer code** —
    `buildPublicCashToCashLocatorShareText` and `receiptFromCashToCashResult` (AgentReceipt)
    include only number/sender/beneficiary/amount; code stays in the separate display-once
    card; `SafeCashToCashResult` omits `transferCode` by type; backend
    `NotificationTemplateService` renders number+canonical sender phone for
    `cash_to_cash.created` without UUID or secret code (A1 locator-contract unit test).
12. **Legacy UUID claim/recovery compatibility** — `POST …/claim` (transferId) and
    `GET …/claims/:transferId` unchanged; historical transfers have no guessed/backfilled
    pair and remain redeemable via the UUID contracts; mobile keeps `agentCashToCashClaim`/
    `getAgentCashToCashClaim` and never substitutes `transferNumber` into `transferId`.

**Accounting behavior (both methods retain existing semantics — no second settlement
implementation):** the locator adapter calls the one canonical claim service. CUSTOMER_WALLET:
debit Cash-to-Cash unclaimed liability, credit the verified beneficiary wallet. AGENT_CASH:
debit unclaimed liability, credit Agent B float, WITHOUT additionally crediting the
beneficiary wallet. Verified by a16's persisted-ledger assertions (independent
journal/line/balance reads): both redemption methods with exact journal effects,
exactly-once settlement per transfer/idempotency scope, atomic five-attempt secret-code
lockout (incl. concurrent bad-code races: "S2 atomic bad-code counting…", "S2 an in-flight
valid claim cannot bypass concurrent lockout"), purpose-bound OTP (replay/expiry rejected),
Agent B transaction PIN + lifecycle/class/CASH_TO_CASH eligibility, KYC expiry,
transaction-bound session/credential revocation during posting, deadline re-check after
acquiring the posting lock (test 39), transfer expiry, and rollback/limit-failure paths
with fresh-OTP same-key retry. All 87 a16 tests + a15 + a17 + mfa-api pass on the merged
tree (149/149 targeted run, re-verified inside the full regression).

## 4. Phase 4 — Migration validation (`1785753600096-CreateCashToCashLocators`)

Validated against **fresh isolated PostgreSQL 18.4 databases** created per-suite by the
project's approved harness (`createIntegrationDataSource` applies the full chain, ordered,
to a namespaced empty database; databases destroyed afterwards). No production database
touched; no migration executed outside the disposable harness.

- **Applies cleanly:** every integration suite in the full regression initializes a fresh
  database through the complete chain ending at `…096` (116-suite run — §7).
- **Uniqueness enforced in the database:** `CONSTRAINT uq_cash_to_cash_locator
  UNIQUE(sender_phone, transfer_number)`; digit CHECK constraints on both columns
  (`^[789][0-9]{9}$`, `^[0-9]{6}$`); `transfer_id` PK + FK `ON DELETE RESTRICT` to the
  canonical transfer.
- **Immutable, never recycled:** `BEFORE UPDATE OR DELETE` trigger raises
  `Cash-to-Cash locators are immutable`; a16 proves retry-on-collision never recycles
  history (including against an expired transfer).
- **Concurrent creation cannot duplicate pairs:** allocation is
  `INSERT … ON CONFLICT(sender_phone,transfer_number) DO NOTHING RETURNING` inside the same
  SERIALIZABLE initiation transaction as the financial posting, with ≤32 CSPRNG retries and
  whole-transaction rollback on exhaustion; a15/a16 concurrent-initiation and
  number-vs-UUID race tests pass.
- **Historical UUID transfers remain functional:** migration is purely additive (two new
  tables + trigger function; no touch of `cash_to_cash_transfers`); a16's UUID-route claim/
  recovery tests pass on migrated databases containing pre-locator-style rows.
- **Upgrade compatibility:** `agent-application-access-migration-upgrade` proves a database
  at head `…094` upgrades to `…095` with exactly one pending migration and zero row loss;
  every other suite proves `…095`→`…096` applies additively on top (harness order). The
  suite is now scoped to the 0095-head chain so it remains a faithful point-in-time
  reproduction as the chain grows (see §2 `449ff8d`).
- **Rollback restrictions behave as documented:** `down()` raises `Cannot remove issued
  Cash-to-Cash locators` when any locator exists (a16 asserts the rejection); with zero
  issued locators it drops the additive objects only.

**Migration ordering / deployment prerequisites (for release, from the approved contract):**
1. `…096` is the chain head and must be applied through the approved deployment process
   BEFORE activating the updated backend/frontend six-digit flows (it was executed only by
   the disposable local test harness, never in production).
2. Application rollback may retain the additive tables; do NOT run the destructive
   `down()` once any locator has been issued — use a forward fix or a separately approved
   preservation plan (stale receipts must never identify new transfers).
3. Frontend rollout must ship together with (or after) the backend: new public initiations
   REQUIRE `senderPhone`; legacy responses without the pair must not advertise a number
   handoff (mobile already omits the locator card cleanly when fields are absent).
4. Operations: monitor `cash_to_cash_locator_attempts` growth and arrange approved cleanup
   of expired budget rows; never clean up permanent locator reservations.

## 5. Phase 5 — Workforce Admin Web integration

Verified in merged code + executed tests (A2's `1c0251d`/`3ace151` against ARENA 3's
`bad1b9b` contract):

- **Endpoint consumption:** `AgentUnifiedHistoryPanel` calls
  `GET /internal/agents/{id}/transactions?page&limit&type` with client-side clamping
  (page ≥ 1; limit ∈ {10,20,50} within 1..100; type restricted to the six canonical values)
  — matching the backend contract in `ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md` §1.3.
- **agent.view authorization + workforce principal restrictions:** screen gate
  `canViewUnifiedHistory = hasFn('agent.view') && type ∈ [OPERATOR, SERVICE, PRIVILEGED]`
  (SUPER_ADMIN/ANM/ADMINISTRATOR/FINANCE_AUDITOR eligible; SUPPORT excluded pre-flight;
  FINANCE_CONTROLLER keeps funding-inbox operation without `agent.view`) — identical to the
  backend registry branch and controller gate.
- **FOUND AND FIXED — the one real API mismatch of Sprint 3 (`18a9686`):** the panel modeled
  `counterparty` as `{ownerType, display, identifierMasked}` and `commission` as
  `{amountMinor, currency, status}`, but the authoritative backend projection (shared with
  Agent Mobile's `/agents/me/transactions`) emits `counterparty {type, beneficiaryPhone?,
  aggregatorId?} | null` and `commission {commissionMinor, payable, treatment} | null`.
  Against the live backend the panel rendered `—` for every counterparty (beneficiary phones
  lost) and `undefined` commission amounts. Fixed in the FRONTEND (the backend shape is the
  published V1-AGENT-HISTORY-01 contract and was not changed): a normalizer inside
  `fetchAdminAgentUnifiedHistory` maps the real payload into the panel view model (type →
  ownerType; beneficiaryPhone/aggregatorId → masked identifier; commissionMinor →
  amountMinor with item-currency fallback; treatment → status, else PAYABLE/NOT_PAYABLE),
  passing through already-normalized fixtures so every existing ARENA 2 test is preserved.
  New bridge test feeds the exact shapes captured from real PostgreSQL responses and asserts
  masked-phone/ownerType rendering, commission rendering (POSTED and PAYABLE), WORKFORCE
  counterparty, verbatim status/narration, and zero `undefined` text.
- **Pagination / type filtering:** server-side round-trip asserted (page 2 → Previous →
  page 1; per-type filter issues `type=` query; totals/totalPages/hasNextPage consumed).
- **Minor-unit amounts/fees:** string minor units rendered via BigInt formatting
  (`NGN 5,000.00`, `Fee: NGN 100.00`); no float coercion.
- **403 fail-closed:** forbidden state clears data, shows the not-authorized notice,
  disables controls and never retries 403s; receiving-number 403 likewise clears protected
  data (A2 suite, 25/25 passing on merged tree).
- **Existing views preserved:** `transaction.view`-gated Wallet Transfers and Cash-to-Cash
  Transfers panels remain in `AgentNetworkScreen` (partial-failure resilience via
  `Promise.allSettled`); policy-blocked Reclassify/PIN panels remain visibly disabled.
- **Global funding inbox compatibility:** A2's live inbox uses
  `GET /internal/agents/funding-requests?status=PENDING|EXECUTED|REJECTED&direction&limit(1..50)&page`
  with pre-flight non-SUPER_ADMIN FINANCE_CONTROLLER + MFA + both funding functions and no
  `agent.view` requirement — exactly the backend maker-checker contract (Decision 7). The
  backend `v1-funding-approvals-inbox` suite passes on the merged tree.
- **No unexpected 401/403 drift from the WORKFORCE_SESSION hardening:** the guard change
  enforces only DECLARED required* gates, every one of which is backed by an
  equal-or-stricter controller gate (full parity map in the ARENA 3 Sprint 3 report §2.2);
  the 8 highest-risk suites (funding inbox, p0-p1, phase1, a20, a22, receiving-number,
  agent-history, capability-registry) pass on the merged tree — 156/156 targeted, and all
  re-verified in the full regression (§7).

## 6. Phase 7 — Cross-surface verification

`test/v1-sprint3-cross-surface-payloads.spec.ts` (NEW, 8 tests, commit `3e6e614`): the exact JSON shapes serialized by
Agent Mobile's typed client and confirm screens (initiation; claim-by-number for both
redemption methods incl. trimmed senderPhone/transferNumber, stripped transferId, always-present
redemptionMethod, AGENT_CASH-only untrimmed agentPin; recover-by-number with the ORIGINAL
idempotency key; legacy UUID claim) are run through the real backend class-validator DTOs
under the same whitelist+transform options as the global ValidationPipe. All positive shapes
validate with zero errors; missing `senderPhone`, stray `transferId`, and non-six-digit /
numeric `transferNumber` variants are rejected. This complements the HTTP-level PostgreSQL
suites (a15/a16/a17 + v1-agent-mfa-api-01, 149 tests) that exercise the same routes
end-to-end with real sessions, OTP, PIN and ledger state.

**Limitation (recorded, not claimed otherwise):** no real browser or Android/iOS environment
exists in this sandbox (ARENA 4 documented the missing Chromium NSS/NSPR libraries and
absent adb/emulator/KVM/Xcode). No browser or native-device UAT was executed by any
workstream this sprint; Jest/component tests are NOT represented as device verification.

## 7. Phase 6 — Complete regression (exact counts, own execution, merged tree)

Environment: Node v22, embedded PostgreSQL 18.4 (disposable, namespaced databases),
`PG_TEST_CONCURRENCY=1` sequential runner (memory-safe on the 3.9 GB sandbox).

| Gate | Command | Result |
|---|---|---|
| Backend production build | `npm run build` | **PASS** (0 errors) |
| Backend complete unit suite | `npm run test` | **193/193 suites, 1969/1969 tests PASS** (baseline 191/1959 + A1 locator-contract 1/2 + Phase 7 cross-surface 1/8) |
| Backend complete PostgreSQL integration | `scripts/run-pg-integration-tests.js`, `PG_TEST_RUN_ID=intfull2` | **see §7.1** |
| Six-digit C2C explicit tests | a15 + a16 + a17 + v1-agent-mfa-api-01 targeted | **4/4 suites, 149/149 tests PASS** (a16 = 87 incl. locator/claim/recovery/race/lockout/down-refusal) |
| Locator contract (unit) | `cash-to-cash-locator-contract` | **2/2 PASS** |
| Authorization / maker-checker regression | 8-suite targeted batch (funding inbox, p0-p1, phase1, a20, a22, receiving-number, agent-history, capability-registry) | **156/156 PASS** (pre-merge) + all re-run inside §7.1 |
| Sprint 3 workforce suite | `v1-sprint3-agent-history-workforce` | **13/13 PASS** (inside §7.1) |
| Migration-head reconciled suites | v1-007, v1-limit-02, a8, a19, a20, v1-003, migration-upgrade | **7/7 PASS** targeted after `449ff8d`/`845b027` |
| Production readiness sync | `v1-release-01-production-readiness-migration-sync` | **3/3 PASS** targeted after `d23c51b`; `npm run build` re-verified PASS |
| Admin Web | `npm ci` (integrated lockfile) → `ts:check` → `npm test -- --runInBand` → `npm run build` | deps installed clean; **tsc 0 errors**; **25/25 suites, 167/167 tests PASS** (A2's 166 + 1 bridge); **Vite production build PASS** (pre-existing chunk-size/CJS warnings only) |
| Agent Mobile | `npm ci` (integrated lockfile) → `ts:check` → `npm test -- --runInBand` | deps installed clean; **tsc 0 errors**; **20/20 suites, 297/297 tests PASS** |
| Lint | per-file parity vs pre-edit blobs (`npx eslint` / `--stdin`) | backend changed files: parity (admin-agent 15/15 pre-existing, limit-assignment 2/2 pre-existing, guard/registry/module/new specs clean); 6/7 reconciled test files parity, migration-upgrade cleaned to 0 (`845b027`). Root eslint cannot type-lint `apps/**/tsx` (pre-existing config limitation — identical crash on unmodified HEAD blobs); admin-web gate = tsc+jest+build, all green. No new lint problems introduced anywhere |

### 7.1 Full PostgreSQL regression (integrated tree, final fixed state)

`PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=intfull3 node scripts/run-pg-integration-tests.js`
(log: `sprint3-integration-full-pg.log`, gitignored; runner `integrated-full-pg-regression-au-ad98ae22`):

- **Test Suites: 116 passed, 116 total** (0 failed; every suite on the merged tree, including all Sprint 2 history, ARENA 1's a15/a16/a17 locator suites, ARENA 3's workforce suites, and v1-release-01)
- **Tests: 2237 passed, 2237 total** (baseline pre-integration full run was 2222; +15 from ARENA 1's locator coverage merged into a15/a16/a17 and related suites)
- **Runner exit code: 0**
- Backend unit suite re-verified AFTER all integration commits on the final tree: **193/193 suites, 1969/1969 tests PASS**.

Discovery runs preceding the authoritative attempt: `intfull` (stopped after 32 suites:
2 FAIL — v1-007, v1-limit-02, stale migration-head allowlists) and `intfull2` (stopped
after 76 suites: 1 FAIL — `v1-release-01`, the production-readiness marker drift, §8.A.1).
All eight affected suites were fixed (`449ff8d`, `845b027`, `d23c51b`) and verified green
in targeted batches (7/7 + 3/3) before the authoritative run above was started on the
final tree.

## 8. Phase 8 — Release-readiness review

**A. Verified functional or security defects (found and FIXED this sprint):**
1. **Production startup blocker (Category A, production code):**
   `ProductionReadinessService` pins the expected migration head
   (`EXPECTED_MIGRATION_TIMESTAMP/NAME`) and refuses to start with
   `schema_incompatible` unless the database matches. The merged tree (with approved
   `…096` as chain head) would have failed readiness on EVERY correctly-migrated
   production database — caught only by the full integrated regression
   (`v1-release-01`), which neither per-workstream run executed. Fixed by the exact
   synchronization the file's own comment mandates (`d23c51b`); no product contract
   changed; suite 3/3 green.
2. Admin Web unified-history panel consumed non-existent counterparty/commission field
   names (live-data rendering defect: masked beneficiary phones and commission amounts
   lost / `undefined` rendered) — fixed frontend-side with normalizer + bridge test
   (`18a9686`). Backend contract unchanged.
3. Seven baseline integration suites hardcode pre-`…096` migration-head sets — combined-run
   breakage, reconciled without weakening intent (`449ff8d`, `845b027`).
No other functional or security defect was found in the merged tree; the full regression is
the evidence. (Sprint 3's own pre-integration fixes — workforce history endpoint 404 gap,
WORKFORCE_SESSION declared-gate enforcement, limit-assignment function gates — are
delivered in `bad1b9b` and re-verified here.)

**B. Unresolved API mismatches:** none remaining. All ARENA 2 typed requests match backend
runtime validation (Phase 7 spec + 149-test HTTP evidence); the funding inbox, receiving
number, and unified history contracts are aligned; error envelopes (404/409/429/503 codes)
match the approved C2C contract verbatim.

**C. Database migration and deployment prerequisites:** §4 items 1–4 (apply `…096` via the
approved deployment process before enabling the flows; never run destructive `down()` after
issuance; coordinated frontend/backend rollout because initiation now REQUIRES
`senderPhone`; monitor attempts-table growth). No production migration was executed here.

**D. Dependency vulnerability findings (npm audit on the integrated tree, 2026-10-27):**
root workspace **0**; admin-web **2** (moderate `esbuild ≤0.24.2` dev-server CORS
GHSA-67mh-4wv8-2f99; high `vite` — fix requires breaking `vite@8`); agent-mobile **21**
(14 moderate, 6 high, 1 critical — critical: transitive `tar` arbitrary file
creation/overwrite; high: `expo` (direct), `@expo/cli`, `xmldom`, `cacache`, `image-size`,
`node-forge`). These are advisory findings in build/dev toolchains, not confirmed runtime
exploits; no upgrades performed (lockfile stability during integration). Security-owner
reachability review required before native-app release (carries ARENA 4's recommendation;
counts differ from their baseline-day measurement due to advisory-DB updates and ARENA 2's
`uuid@11.1.1` override).

**E. Browser and mobile device UAT gaps:** unchanged from ARENA 4's verified assessment —
no browser journey and no Android/iOS journey has EVER executed for these flows in this
sandbox (missing Chromium NSS/NSPR libs; no adb/emulator/KVM/Xcode). Prerequisites are
listed in `docs/A4-SPRINT3-BROWSER-UAT-AND-RELEASE-EVIDENCE-20261026.md` §3–4. Automated
Jest/component/HTTP tests are NOT device UAT.

**F. Outstanding policy decisions (owner approval required; nothing implemented or invented):**
1. **Human cash handover** (physical C2C handover requirements/attestation) — open since
   ARENA 1 Sprint 2; untouched by the locator contract.
2. **Expired funds disposition** (refund/forfeiture path for EXPIRED transfers) — open;
   expiry mechanics work, disposition policy missing.
3. **Fees and commissions** (C2C fee/VAT policy and commission allocation governance) —
   mechanics exist; policy decisions open.
4. **Wallet KYC assessment freshness** (legacy wallet customers / KYC re-assessment expiry)
   — open (ARENA 1 Sprint 2 report).
5. **Agent reclassification** — blocked pending the seven governance decisions enumerated in
   `ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md` §4.1 (entitlement,
   maker-checker, in-flight transactions, limit migration, lifecycle semantics, invariants,
   audit). UI remains visibly policy-blocked.
6. **Administrative PIN recovery/unlock** — blocked pending the seven decisions in §4.2 of
   the same report (entitled role+function, identity-verification evidence, dual control,
   unlock-vs-reset semantics, cooldowns, audit, support-ticket wiring). No privileged bypass
   exists or was created; UI remains visibly policy-blocked.
7. **Aggregator read gating** (governance follow-up from the Sprint 3 sweep: type-gated-only
   aggregator reads; requiring `aggregator.view` would rewrite a22-pinned fixtures and needs
   an approved policy delta).
8. **Beneficiary SMS delivery for the locator** (contract §6): the template renders the
   public pair, but no recipient/outbox workflow is wired; notification ownership must
   approve separately if SMS handoff is a release gate.

**G. Other nonblocking improvements:** browser-capable runner image + Playwright journeys
against an isolated seeded API; native emulator/device CI; response-socket fault injection
for true post-commit disconnect testing; `cash_to_cash_locator_attempts` retention job;
vite@8 / expo-toolchain dependency uplifts behind owner review; admin-web bundle chunking
warnings.

## 9. Phase 9 — Delivery record

Integrated commit sequence on `arena/8e59e188-monienaija` (all pushed to this branch only):

| SHA | Content |
|---|---|
| `8cf6648` | Merge ARENA 1 (`d0d8f6c`) — six-digit C2C redemption backend + approved contract |
| `a6e6518` | Merge ARENA 2 (`3ace151`) — frontend C2C redemption + unified history + funding inbox |
| `49ac0ac` | Merge ARENA 4 (`270cf8f`) — UAT/release-evidence documentation |
| `18a9686` | Panel ↔ backend projection reconciliation + bridge test (Phase 5 fix) |
| `3e6e614` | Sprint 3 integration Phase 7: cross-surface payload validation spec — `test/v1-sprint3-cross-surface-payloads.spec.ts` |
| `449ff8d` | Migration-head assertion reconciliation (7 suites) for approved `…096` |
| `845b027` | Lint-parity cleanup (migration-upgrade suite) |
| `d23c51b` | **Category-A production fix:** sync production-readiness migration marker to approved head `…096` |
| `c4b037a` | `test/production-readiness.spec.ts` compatible-head fixture synced to `…096` (companion to `d23c51b`; full unit suite re-verified 193/193 on final tree) |
| (final) | This report |

- **Final integrated HEAD (this report commit's parent):** `c4b037a049acbe4097e6e2d79084550f76f10030`
  The report itself is the last commit of the sequence; at delivery, local HEAD ==
  `origin/arena/8e59e188-monienaija` with a clean working tree (both verified after push).
- Local HEAD == `origin/arena/8e59e188-monienaija`; working tree clean at delivery.
- All four source HEADs verified as ancestors (§2).
- No merge to main, no deployment, no production migration, no other branch modified, no
  reset/rebase/force-push/cherry-pick of shared history.

## 10. Recommended Sprint 4 priorities

1. **Close the UAT gap (E):** provision a browser-capable runner (NSS/NSPR libs or approved
   Playwright cache) and an Android emulator/KVM image; execute the Admin Web workforce
   journeys (login, unified history, funding inbox maker-checker separation, receiving-number
   entitlement) and the mobile six-digit send/claim/recover journeys against an isolated
   seeded API; capture traces + DB reconciliation extracts.
2. **Policy sprint (F):** obtain owner decisions for the eight items in §8.F — highest
   operational value: expired-funds disposition, beneficiary SMS delivery decision, PIN
   recovery ceremony, reclassification governance. Each decision unblocks a bounded
   implementation with established patterns (requireFunction + approval workflow + audit).
3. **Dependency uplift (D):** security-owner review of the mobile critical/high advisories
   (tar via expo toolchain, node-forge, xmldom) and the admin-web vite@8 breaking upgrade,
   behind a dedicated lockfile-change sprint with full regression.
4. **Aggregator read gating decision (F7):** approve/deny `aggregator.view` on aggregator
   reads; if approved, update the a22 pinned fixtures in the same change.
5. **Locator operations tooling:** approved retention/cleanup job for
   `cash_to_cash_locator_attempts` + rollout monitoring dashboards for the 429/409 budgets.
