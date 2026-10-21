# V1-UAT-RECOVERY-01 — Recovery Report (Interrupted UAT Execution)

**Date:** 2026-10-01 · **Branch:** `arena/01a0d883-monienaija`
**Executive authority:** `docs/V1-UAT-MASTER-01.md` @ `67a842a` (183 functional + 8 CFG = 191 catalogue items)
**Mandate:** determine what the interrupted UAT execution actually produced, establish a safe checkpoint, recommend dependency-aware continuation batches. **No re-execution, no defect fixes, no app changes performed in this task.**

---

## 1. Interruption / crash summary

A toolchain/sandbox crash occurred mid-session with the sandbox in detached-HEAD state
(`HEAD` = `3d05aae`, working tree dirty as an un-committed overlay of branch content). This is the
known crash signature for this workspace. What happened, in order:

| Phase | Duration | Outcome |
|---|---|---|
| Harness construction (temp spec) + bootstrapping runs | ~1.5 h | Multiple short (12–30 s) failed runs while the harness was being corrected (OTP regex escaping, phone-generator uniqueness, agent-class services list, funding DTO). **No results ledger persisted from these; beforeAll failed before any card executed.** |
| **Full catalogue run** | **703.2 s (~11.7 min)** | **jest exit OK — Test Suites 1/1 passed, Tests 176/176 passed** (175 executed cards + 1 N/A-registration test). Ledger persisted to `uat-run-results.jsonl` (192 records: 175 card executions + 17 NOT-APPLICABLE registrations). |
| Post-run failure triage (source-level root-cause analysis of the 48 FAIL records) | ~20 min | 38 of 48 root-caused to **harness fault / environment artifact** (evidence-invalidated, requires re-execution), 10 left **unresolved** (needs adjudication). Two harness-only corrections were applied to the temp spec (session-bound `issueOtp`; C2W-007 local baseline) **but never re-run**. |
| **Crash** | — | Crash occurred during this triage phase (after the full run had completed and persisted). |

**Key point:** the 191-item execution **did complete** in the sense that every catalogue item was
attempted and a record persisted for each — the later crash happened during *triage*, not mid-run.
However, per the evidence rules, only 127 records qualify as reliable results today; 48 fail
records exist, of which at least 38 are provably *executor-side* faults (harness misconfiguration
or environment artifact), meaning those cases were **not validly executed** against the
application and must be re-executed under the corrected harness.

---

## 2. Repository state after recovery

| Item | Value |
|---|---|
| Recovered HEAD | `67a842aefe82d08f2598d92e692792fc17cef449` (`docs: add V1 master UAT catalogue`) |
| Remote truth (`git ls-remote origin arena/01a0d883-monienaija`) | `67a842a` — **identical** |
| `origin/HEAD` | `refs/remotes/origin/main` |
| Working tree | **clean** except two *untracked, intentional* execution artifacts (below) |
| New commits made by the interrupted task | **none** |
| Recovery action performed (environment repair only) | re-attached `arena/01a0d883-monienaija` ref to the fetched remote commit; `git reset --hard`; `npm ci` (node_modules had been wiped by the crash; package-lock untouched — no manifest change) |

**Files created by the interrupted task (both untracked, intentional, non-source):**

| File | Contents | Status |
|---|---|---|
| `uat-run-results.jsonl` (repo root) | 192 result records — **the sole persisted evidence** of the completed run (md5 `3b75282b…`) | **checkpointed** to `docs/uat-evidence/V1-UAT-RUN-01-results.jsonl` (byte-identical) |
| `test/tmp-uat-exec-01.integration.spec.ts` (1,978 lines) | temporary real-PG UAT execution harness (all 175 executed cards + N/A registrations). **Note:** file is at revision R+1 — two harness-only hunks (session-bound `issueOtp`, C2W-007 local baseline) were applied *after* the run that produced the ledger (which ran at revision R). | keep for continuation; not committed |

**Migration head:** `src/migrations/1785753600079-AddCustomerCredentialRotation.ts` (79 V1
migrations + 1 base = 80 migration files; head = `079`). No migration added/modified by the
interrupted task; same head as the catalogue commit.

---

## 3. What evidence exists and what it proves

Evidence rules applied (per recovery mandate): a case is *completed* **only** if reliable evidence
exists from the interrupted execution; otherwise NOT EXECUTED / re-execution required. No
FAIL→PASS conversion, no NOT-EXECUTED→PASS conversion.

### 3.1 Cases definitely completed — reliable PASS evidence: **127**

Persisted ledger rows with status `PASS`, each executed against real PostgreSQL + real HTTP via the
embedded in-repo stack (embedded Postgres 18.4, NestJS test app, `TestNotificationProvider` SMS
capture). Financial cards record BEFORE/AMOUNT/FEE/VAT/AFTER/transaction-id deltas.

| Group | Executed | Reliable PASS |
|---|---|---|
| REG | 12 | 10 |
| ONB | 8 | 6 |
| AUTH | 12 | 10 |
| PIN | 10 | 3 |
| CUST | 10 | 7 |
| W2W | 14 | 10 |
| W2C | 12 | 4 |
| C2W | 13 | 11 |
| C2C | 16 | 15 |
| AGENT | 14 | 13 |
| FUND | 6 | 1 |
| LIM | 6 | 6 |
| FEE | 6 | 3 |
| COMM | 4 | 4 |
| ADMIN | 12 | 10 |
| SEC | 12 | 6 |
| NIG (executed subset) | 5 | 5 |
| CFG (executed subset) | 3 | 3 |
| **Total executed** | **175** | **127** |

PASS by priority: **P0 65 · P1 42 · P2 20**.

### 3.2 Cases with insufficient / unreliable evidence — re-execution required: **38**

Persisted FAIL records whose failure root cause has been traced **by reading application source**
to be executor-side (harness misconfiguration or single-IP test-environment artifact), **not** an
observed application defect. These executions are **invalid**; the cases are NOT-VALIDLY-EXECUTED
and carry no pass/fail meaning as-is. They are categorised so the corrected harness can re-run
exactly this set:

- **Harness SQL shape (4):** `UAT-REG-003`, `UAT-ADMIN-005` (queried table `wallets`; actual
  `wallet_accounts`), `UAT-ONB-003`, `UAT-ONB-008` (SQL seed used `kyc_level='LEVEL_0'`; constraint
  allows `NONE/LEVEL_1/2/3`).
- **Harness DTO/API shape (8):** `UAT-CUST-009` (support ticket needs `category`+`description`),
  `UAT-AGENT-012` (same DTO family), `UAT-C2W-003` (reject field is `reason`, not
  `rejectionReason`), `UAT-FUND-001/002/004/006` (fund/defund `idempotencyKey` is a **body** field,
  not header — FUND-004's 400 masked the intended SUPPORT-role refusal check), `UAT-FUND-005`
  (aggregator create needs `reference`/`code`/`corporateName`).
- **Harness MFA seeding (7):** `UAT-W2C-001/002/003/005/006/008/010` — harness `issueOtp` created
  challenges without `session_id`; the execution service's `assertPrincipal` rejects them
  ("Authenticated principal is invalid"). This is the known `X-Transaction-Pin`/MFA session
  binding shape; harness-only seed must bind the caller's live authentication session.
- **Harness data reuse / assertion math (3):** `UAT-W2W-008` (beneficiary identifier reused
  across CUST-003/W2W-008 → 409 duplicate), `UAT-C2W-007` (assertion baseline predated
  C2W-004/005's interleaved +500/+500 credits — arithmetic, not double-credit), `UAT-C2C-002`
  (claim DTO additionally requires `customerId` + `mfaChallengeId` + `otp`).
- **Environment artifact — single-source-IP rate budgets (7 primary):** `UAT-PIN-001`,
  `UAT-PIN-004`, `UAT-W2W-012`, `UAT-SEC-009` (registration `CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP`
  bucket, capacity 20/h — apps' real fail-closed rate limiter, exhausted because the harness is one
  IP; the limiter itself working is *correct*, not a defect), `UAT-W2W-006`, `UAT-W2C-004`,
  `UAT-SEC-011` (same class of security-OTP bucket).
- **Cascades of the 429s inside the shared-world run (9):** `UAT-PIN-002/003/005/006`
  (provisioning token undefined after PIN-001/004's 429), `UAT-W2W-014`, `UAT-FEE-001`,
  `UAT-FEE-006` (fee/vat fields unavailable after the aborted upstream transfer), `UAT-SEC-008`
  (consolidation card that aggregates W2W/W2C results — inherits their outcomes).

### 3.3 FAIL records still unresolved — adjudication required, NOT yet defects: **10**

These were observed failing but were **not fully root-caused** before the crash. They must be
adjudicated (harness re-read vs catalogue expectation) during continuation **before** being
recorded as defects. None has been confirmed as an application defect.

- `UAT-REG-008` — "assert failed: record exists" (anti-enumeration evidence shape needs re-read).
- `UAT-AUTH-006` — `password_expires_at` expected on issued credential (column/shape review pending).
- `UAT-AUTH-011` — credential reissue returned 409 (may be documented policy; expectation unchanged).
- `UAT-PIN-010` — password change returned 403 (unresolved).
- `UAT-CUST-004` — transaction-detail fee/vat view: `fee=0, vat=undefined` (shape review pending).
- `UAT-CUST-006` — "verified on creation" flag `undefined` in read-back (mapping review pending).
- `UAT-FEE-002` — "zero-fee evidences present" assert (pending review).
- `UAT-ADMIN-011` — support lifecycle step returned 200 where refusal expected (**candidate defect**).
- `UAT-SEC-001` — cross-subject B→A detail returned 400 (a posture was observed; expectation re-read pending).
- `UAT-SEC-005` — PATCH on restricted customer returned 200 (**candidate defect — highest priority for adjudication**).

### 3.4 Cases not reached: **0** (every catalogue item was attempted; "not reached" does not
apply to this run — but 48 attempts above did not produce valid executions under §3.2/§3.3).

### 3.5 NOT APPLICABLE registrations (justified per catalogue Section 13/14): **17**

`UAT-NIG-001/002/003/008/010` (external rails/providers, Section 13), `UAT-NIG-005-PHYSICAL`
(physical-cash sub-branch, companion tag), `UAT-UX-001..006` (human/apk review lanes, Section 12/13),
`UAT-CFG-001/002/003/004/006` (deployment/infra checks outside in-process harness).

### 3.6 Reliable result totals recovered

| Bucket | Count |
|---|---|
| Reliable PASS | **127** (P0 65 / P1 42 / P2 20) |
| Confirmed genuine-defect FAIL | **0** (no confirmed defect recorded) |
| Unresolved FAIL candidates → adjudication | **10** |
| Invalid (executor-side) executions → re-execution | **38** |
| BLOCKED (environment-missing) | **0** |
| NOT APPLICABLE (justified) | **17** |

Per §15.4, the V1 gate is **not yet evaluable**: 98-case P0 base is only partially satisfied
(65 reliable P0 PASSes; remaining P0s sit in the re-execute/adjudicate buckets).

---

## 4. Test-data / runtime state

| Item | State |
|---|---|
| Runtime databases at crash | All `mn_it_*` per-PID databases **erased by the crash** (the embedded-PG data dir was wiped along with `node_modules`; on recovery, `scripts/embedded-pg.js` re-initialised a fresh cluster — only `postgres` + `monienaija` exist). **No leftover test data** anywhere; no seeded tables in the main `monienaija` DB (the UAT never used it; every run uses its own per-PID database, and the completed run's after-All dropped its database normally). |
| Application/runtime usability | **Healthy & unmodified.** Verification: the catalogue run itself exercised the full app against real PG end-to-end (176/176 jest green); after recovery `npm ci` restored dependencies byte-for-byte from an unmodified lockfile; embedded PG restarts cleanly; `npx tsc --noEmit` passed immediately pre-crash. |
| Secrets handling | No secrets/credentials appear in the ledger (evidence strings are `k=v` with masked/generated material only). |
| Jest console output of the run | **Not persisted** (streamed to tool stdout only). Recovery gap — see §6 recommendations. |
| `.env` | Recreated after crash (gitignored): DB_HOST=127.0.0.1, DB_PORT=5432, DB_NAME=monienaija, DB_USER/PASSWORD=monienaija/monienaija-pw, LOG_LEVEL=silent. |

---

## 5. Exact recovery point

- **Branch:** `arena/01a0d883-monienaija` @ `67a842a` (== remote), clean tree, `npm ci` done.
- **Evidence checkpoint:** `docs/uat-evidence/V1-UAT-RUN-01-results.jsonl` (192 records, md5
  `3b75282b00b78a6cdc2dacf6e9f4240e`); working copy also at repo-root `uat-run-results.jsonl`.
- **Harness:** `test/tmp-uat-exec-01.integration.spec.ts` (untracked, temp; revision R+1).
- **Embargo:** application source, migrations, and committed tests untouched; no commits made.
- **Embedded PostgreSQL:** running (fresh cluster), credential parity with `.env`.

---

## 6. Recommended continuation batch structure

Mandate constraint honored: **no single execution runs all 191 cases.** All batches execute against
the *same, corrected* harness; each batch is independently executable (fresh per-PID database,
self-provisioning world via the harness's beforeAll) and dependency-ordered so cascades cannot
propagate across batches.

### Prep batch B0 — harness correction & smoke (execution-prep, no app change)

Apply the re-execution fixes encoded in §3.2 to the temp harness **(test file only — application
code remains untouched):**
1. `wallet_accounts` table name (REG-003, ADMIN-005); kyc seed `NONE` (ONB-003/008).
2. DTO shapes: support tickets (`category`+`description`), reject (`reason`), fund/defund
   (`idempotencyKey` in body), aggregator (`reference`/`code`/`corporateName`), C2C claim
   (`customerId`+`mfaChallengeId`+`otp`).
3. Session-bound `issueOtp` (already applied post-run — R+1) and C2W-007 local baseline (applied).
4. **Rate-budget isolation for single-IP artifacts:** rotate synthetic `X-Forwarded-For` (after
   enabling `trustProxy` on the *test-harness's* Fastify adapter — harness-side only) for cards
   that do **not** themselves evaluate per-IP limits; `UAT-REG-011` (per-IP rate-limit card) keeps
   a fixed IP and stays last-of-batch as before.
5. Unique beneficiary identity for W2W-008 (fresh persona).
6. Persistence hardening (recovery lesson): `tee` jest console to
   `docs/uat-evidence/<batch>.log` and append ledger atomically per card with a `runId` column.
7. **Adjudication-first rule for §3.3:** re-read catalogue expectation + app contract for the 10
   unresolved cases **before** re-executing them; if genuine defect → record FAIL, keep executing
   independent cases, do not fix (rule 13).

### Execution batches (re-execution of the 48 + adjudication of the 10; no full-catalogue rerun)

| Batch | Contents | Cases | Dependency rationale |
|---|---|---|---|
| **B1** | REG-003, ONB-003, ONB-008, AUTH-006, AUTH-011 (+ adjudication of REG-008) | 5 re-exec + 1 adjudication | Needs only registration/onboarding world (customer factory). Fastest validation of the repaired OTP/IP plumbing. |
| **B2** | PIN-001..006, PIN-010, CUST-004, CUST-006, CUST-009 (+ adjudication of SEC-005, SEC-001) | 9 re-exec + 2 adjudication | Depends on B1's provisioning quality; PIN cards must run before SEC consolidation. |
| **B3** | W2W-006, W2W-008, W2W-012, W2W-014, FEE-001, FEE-002, FEE-006 | 7 | Depends on B2 (world.a/b + PIN trust). Financial ledgers re-verified with before/after evidence. |
| **B4** | W2C-001..006, W2C-008, W2C-010 (session-bound MFA path) | 8 | Depends on B0 step-3 fix; W2C OTP execution path is the biggest single root cause. |
| **B5** | C2W-003, C2W-007, C2C-002 | 3 | Depends on B0 DTO fixes; funding/pclaim flows re-verify idempotency with local baselines. |
| **B6** | FUND-001/002/004/005/006, AGENT-012 | 6 | Agent funding world; aggregator DTO validated. |
| **B7** | ADMIN-005, ADMIN-011 (+ adjudication/closure of ADMIN-011), SEC-007/008/009/011 | 6 | Last: consolidation card SEC-008 must run only after B2/B3/B4 pass. |
| **B8 — final gate** | Summary-card recomputation + final §15.4 verdict only (no new executions) | — | Produces §15.1–15.3 counters and PASS/CONDITIONAL verdict once B1–B7 complete. |

Each batch targets ≤ ~25 card-executions and a bounded runtime (B0 smoke < 2 min; each of B1–B7
est. 3–8 min), keeping every Arena execution well below the ~12 min single-run envelope that
preceded the crash. Failures inside a batch do not invalidate other batches: worlds are per-batch.

### Standing confirmation for continuation
- Section 13 exclusions and Section 14 known observations remain out of scope for defects (already
  enforced in the harness and in the 17 NOT APPLICABLE registrations).
- CUSTOMER_FUNDING/AGENT_FUNDING/AGENT_DEFUNDING remain non-fee-bearing per V1 policy; intentional
  fail-closed postures (e.g., catalogued CONTRA_REVENUE fallback, per-IP rate-limit refusals) are
  **evidence, not defects**.
- No application source, migration, API, business-logic, or committed-test change is part of any
  batch; harness corrections touch only the untracked temporary spec.

---

## 7. What was NOT done (per mandate)

- No UAT case was re-executed in this recovery task.
- No defect was fixed (no genuine defect has even been confirmed yet — §3.3 remains candidates).
- No catalogue/expectation/user-visible documentation was rewritten.
- No commits, no pushes; branch and remote remain exactly at `67a842a`.

**STOP** per task instruction. Continuation begins at batch **B0** on the next mandate.
