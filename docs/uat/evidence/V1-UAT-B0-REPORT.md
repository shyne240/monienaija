# V1-UAT-B0-01 — Recovery Re-execution & Adjudication Report (B0)

**Task:** V1-UAT-B0-01 (B0 gate only — STOP; no B1)
**Date:** 2026-10-01 — Branch `arena/01a0d883-monienaija` @ `67a842aefe82d08f2598d92e692792fc17cef449`
**Authority:** `docs/V1-UAT-MASTER-01.md` @ `67a842a` (sole catalogue authority; 183 functional + 8 CFG = 191 items)
**Governance:** V1-UAT-EXECUTION-01 — no app source/migration/API/business-logic/committed-test changes; genuine defects are recorded, never fixed; §13/§14 exclusions respected.
**Evidence artifacts (new, separate — RUN-01 checkpoint immutable):**
- `docs/uat-evidence/V1-UAT-B0-results.jsonl` — 48 ledger rows (this batch)
- `docs/uat-evidence/V1-UAT-B0-REPORT.md` — this report
- `docs/uat-evidence/V1-UAT-RUN-01-results.jsonl` — UNTOUCHED (md5 `3b75282b00b78a6cdc2dacf6e9f4240e`, verified identical pre/post B0)

**Headline outcome: 48/48 executed → 46 PASS / 2 FAIL. The 2 FAILs are attributed to one genuine application defect (UAT-DEFECT-001, P0). All 10 adjudications resolved. 0 BLOCKED, 0 RE-EXECUTION REQUIRED.**

---

## 1. Recovery-state verification (task step 1 — mandatory gate)

| Check | Required | Observed | Verdict |
|---|---|---|---|
| Local HEAD == remote branch tip | equal | `67a842a` == `67a842a` (`git ls-remote origin arena/01a0d883-monienaija`) | ✓ |
| Working tree | clean apart from known untracked UAT artifacts | only `docs/V1-UAT-RECOVERY-01.md`, `docs/uat-evidence/`, `test/tmp-uat-b0-01.integration.spec.ts`, `test/tmp-uat-exec-01.integration.spec.ts`, `uat-run-results.jsonl` | ✓ |
| Migration head | unchanged | no migration files touched; app spec untouched (tsc clean against tracked sources) | ✓ |
| Catalogue | `docs/V1-UAT-MASTER-01.md` @ 67a842a | present, unmodified | ✓ |
| RUN-01 checkpoint | immutable, readable | md5 matches `3b75282b00b78a6cdc2dacf6e9f4240e` | ✓ |
| Harness | B0 harness = NEW untracked file `test/tmp-uat-b0-01.integration.spec.ts` (RUN-01 spec untouched for provenance) | created; 1,978+ lines | ✓ |
| Runtime | embedded PG fresh, `.env` recreated | warm for all runs | ✓ |

Nothing differed from the recovery baseline — proceeded (no STOP trigger).

## 2. Rate-limit A/B distinction (task step 6 — explicit record)

- **Class A (testing the real per-IP limiter):** `UAT-REG-011` (registration OTP per-IP cap, `CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP` = 20/3600s) keeps **one single fixed client IP** for the whole card, so it measures the production limiter's fail-closed behavior exactly as deployed. It PASSed in RUN-01 and was **not** weakened, reconfigured, or re-scoped. Production has no `trustProxy`; the limiter is app-side `security-rate-limit.service.ts`.
- **Class B (single-IP shared-budget artifact):** 7 primary RUN-01 failures (PIN-001, PIN-004, W2W-012, SEC-009, W2W-006, W2C-004, SEC-011) plus 9 cascade failures occurred **only because the in-process harness produces all traffic from 127.0.0.1**, so unrelated legitimate test clients exhausted one shared bucket. The limiter working correctly was misread as app failure. **Correction:** the B0 harness assigns **distinct, stable X-Forwarded-For client IPs per persona per card family** (persona-scoped XFF map) to model what the production limiter actually sees — distinct clients. This does **not** evade or disable the control under test: per-IP cards keep their fixed IP, and no rate-limit constant, threshold, or config was changed. Under B0, zero spurious 429s.

## 3. Harness corrections applied at B0 (task step 4)

**All corrections are confined to the untracked B0 harness spec.** No app source, migration, committed test, or app config was modified. No rate limit disabled; no MFA/OTP/PIN/authorization bypassed; no expectation weakened (expectations derive from the catalogue; where a catalogue expectation defers to the route-policy registry, the registry is authoritative — see FUND-004 adjudication).

1. **Provisional world containers under B0 gating** — `world.cust` / `world.agentCards` initialized in the B0 beforeAll (RUN-01 relied on cards skipped by the B0 gate) — repaired cascades for CUST-004/006/009, AGENT-012, FEE-001/006, W2W-014, SEC-001.
2. **Per-persona XFF map** (see §2 Class B) — models distinct legitimate clients; fixed IP retained for per-IP card REG-011.
3. **SQL type-shape fixes (harness SQL only):** uuid/varchar casts (`c.id::text`, `w.customer_id::text`, sessions/credentials joins) after PostgreSQL rejected `character varying = uuid` in REG-003/ADMIN-005-area queries.
4. **MFA session binding for `issueOtp`:** session lookup now filters `status='ACTIVE' AND revoked_at IS NULL` (RUN-01 query referenced a non-existent `deleted_at` column; the sessions entity has `revoked_at`/`status`), with a re-login fallback minting a fresh session through the real login route when a persona's session had legitimately lapsed. Challenges bind the caller's live session per the app's `assertPrincipal` contract — this is harness state repair, not an MFA bypass.
5. **Surface/DTO corrections (harness request shapes):** beneficiary removal uses the app's actual removal surface `PATCH /customers/me/beneficiaries/:id {isActive:false}` → `SUSPENDED` (no DELETE exists); cash-to-cash claim DTO includes `customerId` + `mfaChallengeId` + `otp`; funding DTOs carry `idempotencyKey` **in body**; aggregator create carries `{reference, code, corporateName}`; identity-document DTO carries required `actor`; C2W-003 assert reads `reason`.
6. **Setup sequencing:** aggregator `:id/activate` + relationship-assign status asserted **before** aggregator-attributed funding (unasserted 4xx previously masked the 403); claimant KYC pre-state satisfied via the production `POST /customers/:id/identity-document` route (customer-SELF principal per registry); PIN-010 persona funded before its 1000-point transfer; W2W-008 uses fresh personas (no identifier reuse); AUTH-006 uses a fresh un-rotated temp credential; ONB-008's ACTIVE-reissue probe moved to a dedicated throwaway persona (RUN-01/B0-early runs reissued shared persona B's credential, revoking its sessions mid-flight). **No sequencing stepped around a control under test.**
7. **Assertion math/evidence construction:** FEE-002 ledger total computed direction-aware (CREDIT line == approved amount; journal == 2 value lines); C2W-007 local baseline retained; SEC-001 foreign-party probe corrected to a persona that is **not** a party to the probed transfer (RUN-01 early-B0 fixture pointed at a transfer whose recipient was the probing persona — recipient-side visibility of a bilateral transfer is legitimate product behavior, not an isolation defect).
8. **Enum literal correction:** SEC-007 uses `CLOSED` (CustomerStatus enum = DRAFT/ACTIVE/SUSPENDED/CLOSED); RUN-01's `TERMINATED` was a harness literal that does not exist.

**Triage quality safety:** at no point was an observed app-side failure re-branded as a harness fault (SEE ADMIN-011/SEC-005 — observed 200-with-side-effect is recorded as a defect, still FAIL); no NOT-EXECUTED case was converted to PASS.

## 4. The 38 invalid executions — individual review & outcome (task steps 2 + 5)

Every one of the 38 was re-executed **exactly once** under the corrected B0 harness with evidence (id/setup/request/expected/actual recorded in `V1-UAT-B0-results.jsonl`). RUN-01 invalidity root causes quoted per recovery doc §3.2 (its "9 cascades" line enumerates 8; SEC-007 is the 9th cascade-row member).

| # | Id | Why RUN-01 execution was invalid | B0 correction (harness-only?) | Re-executed? | Final status |
|---|---|---|---|---|---|
| 1 | UAT-REG-003 | harness SQL `wallets`→`wallet_accounts` + uuid/varchar compare | table + `::text` casts | ✓ | **PASS** |
| 2 | UAT-ONB-003 | SQL seed `kyc_level='LEVEL_0'` illegal | corrected seed literal | ✓ | **PASS** |
| 3 | UAT-ONB-008 | same + ACTIVE-reissue probe destroyed shared persona B | corrected literal; throwaway probe persona (world B protected) | ✓ | **PASS** |
| 4 | UAT-PIN-001 | single-IP 429 (reg OTP bucket) | persona-scoped XFF | ✓ | **PASS** |
| 5 | UAT-PIN-002 | cascade: token undefined after PIN-001 429 | XFF fix heals provisioning | ✓ | **PASS** |
| 6 | UAT-PIN-003 | cascade as above | as above | ✓ | **PASS** |
| 7 | UAT-PIN-004 | single-IP 429 | persona-scoped XFF | ✓ | **PASS** |
| 8 | UAT-PIN-005 | cascade | as above | ✓ | **PASS** |
| 9 | UAT-PIN-006 | cascade | as above | ✓ | **PASS** |
| 10 | UAT-CUST-009 | support-ticket DTO missing `category`/`description` | DTO corrected | ✓ | **PASS** |
| 11 | UAT-W2W-006 | single-IP 429 (security OTP bucket) | persona-scoped XFF | ✓ | **PASS** |
| 12 | UAT-W2W-008 | beneficiary identifier reuse (409 duplicate) | fresh personas | ✓ | **PASS** |
| 13 | UAT-W2W-012 | single-IP 429 | persona-scoped XFF | ✓ | **PASS** |
| 14 | UAT-W2W-014 | cascade: fee/vat fields absent after aborted transfer | healed upstream via XFF; charged-consistent evidence | ✓ | **PASS** |
| 15 | UAT-W2C-001 | `issueOtp` unbound challenge (assertPrincipal) + dead sessions query | session-bound challenge; ACTIVE/`revoked_at` query | ✓ | **PASS** |
| 16 | UAT-W2C-002 | same | same | ✓ | **PASS** |
| 17 | UAT-W2C-003 | same | same | ✓ | **PASS** |
| 18 | UAT-W2C-004 | single-IP 429 + same | XFF + session-bound OTP | ✓ | **PASS** |
| 19 | UAT-W2C-005 | same + persona B session loss (ONB-008 reissue) | session-mint fallback + ONB-008 probe isolated | ✓ | **PASS** |
| 20 | UAT-W2C-006 | issueOtp unbound | session-bound OTP | ✓ | **PASS** |
| 21 | UAT-W2C-008 | issueOtp unbound | session-bound OTP | ✓ | **PASS** |
| 22 | UAT-W2C-010 | issueOtp unbound | session-bound OTP | ✓ | **PASS** |
| 23 | UAT-C2W-003 | reject field `rejectionReason` → actual `reason` | DTO corrected | ✓ | **PASS** |
| 24 | UAT-C2W-007 | baseline predated interleaved +500/+500 (arithmetic) | local baseline retained (RUN-01 post-run fix re-verified fresh) | ✓ | **PASS** |
| 25 | UAT-C2C-002 | claim DTO missing customerId/mfa/otp + claimant KYC prestate | full claim DTO + identity document via production route | ✓ | **PASS** |
| 26 | UAT-AGENT-012 | support-ticket DTO same family | DTO corrected | ✓ | **PASS** |
| 27 | UAT-FUND-001 | `idempotencyKey` sent as header (body-required) | body field | ✓ | **PASS** |
| 28 | UAT-FUND-002 | same | same | ✓ | **PASS** |
| 29 | UAT-FUND-004 | 400 masked the intended SUPPORT-role refusal check; required adjudication (§5.11) | DTO fixed → registry-conformant expectation | ✓ | **PASS** |
| 30 | UAT-FUND-005 | aggregator create DTO + unasserted assignment (PENDING) masked 403 | DTO + `activate` + asserted assignment | ✓ | **PASS** |
| 31 | UAT-FUND-006 | idempotencyKey header→body | body field | ✓ | **PASS** |
| 32 | UAT-FEE-001 | cascade | healed upstream; quoted==charged evidence | ✓ | **PASS** |
| 33 | UAT-FEE-006 | cascade | healed upstream; charged-consistent bounds evidence | ✓ | **PASS** |
| 34 | UAT-ADMIN-005 | table `wallets` → `wallet_accounts` | corrected | ✓ | **PASS** |
| 35 | UAT-SEC-007 | `TERMINATED` not a CustomerStatus literal | `CLOSED` | ✓ | **PASS** |
| 36 | UAT-SEC-008 | consolidation inherits W2W/W2C invalid rows | hybrid ledger (RUN-01 PASS rows + B0 re-execution rows) | ✓ | **PASS** |
| 37 | UAT-SEC-009 | single-IP 429 | persona-scoped XFF | ✓ | **PASS** |
| 38 | UAT-SEC-011 | single-IP 429 + nonce reuse boundary | XFF; rotate-on-non-pending=403 boundary asserted | ✓ | **PASS** |

**38/38 corrected-by-harness-only; 38/38 re-executed; 38/38 PASS.** No genuine application failure was mislabeled during triage (the one genuine-defect family was escalated, not rebranded — §5/§8).

## 5. The 10 adjudications — individual verdicts (task step 3)

Classes: A genuine-defect / B harness-environment / C config / D test-data/evidence construction / E expected behavior / F catalogue ambiguity / G documented observation.

| # | Id | Adjudication question | Class | Verdict & basis | B0 status |
|---|---|---|---|---|---|
| 5.1 | UAT-REG-008 | anti-enumeration evidence shape re-read | D | Re-request of an already-verified phone returns the same generic 200 (no enumeration signal) plus a fresh challenge row — catalogue intent satisfied; no defect | PASS |
| 5.2 | UAT-AUTH-006 | `password_expires_at` presence/shape | D | Fresh un-rotated temp credential carries expiry (TTL ≈ 72h observed); SQL-backdated expiry refused at login; `/credentials/reissue` restores. Behavior per catalogue | PASS |
| 5.3 | UAT-AUTH-011 | reissue returning 409 vs documented policy | G/E | On the documented reissue surface, issuance returns 200 and **still lands rotation-required** (no bypass); RUN-01's 409 was a pre-state posture (already-rotation-pending), consistent with the documented flow | PASS |
| 5.4 | UAT-PIN-010 | password-change 403 | B/D | Rotate-prior-persona session state made the change request invalid in RUN-01; with reissue→rotate→login sequencing the change is 200, new-password login 200, PIN verify+transfer succeed — PIN truly unaffected by password change | PASS |
| 5.5 | UAT-CUST-004 | fee/vat detail-row shape (`fee=0, vat=undefined`) | E | Display row carries explicit zero fee on the non-fee-bearing path; VAT row omitted-bound on a zero-VAT display — catalogue's amount/fee/status breakdown shown; charged rows consistent via W2W-014 | PASS |
| 5.6 | UAT-CUST-006 | "delete" with `verified` undefined on read-back | D | App removal surface is `PATCH {isActive:false}` → `SUSPENDED` (no DELETE exists); `isVerified` returned on creation; read-back verified. Removal cycle evidenced on the real surface | PASS |
| 5.7 | UAT-FEE-002 | zero-fee evidences assert | D | Customer-funding approval journal = exactly 2 value lines; CREDIT == approved amount; agent fund/defund FEE=0/VAT=0 — non-fee-bearing posture verified at ledger level | PASS |
| 5.8 | UAT-ADMIN-011 | SUPPORT lifecycle 200 where refusal expected | **A** | **UAT-DEFECT-001** — catalogue: "SUPPORT cannot perform them (see SEC-005)"; observed HTTP 200 with post-state SUSPENDED (side-effect proven, scratch customer restored) | **FAIL (defect)** |
| 5.9 | UAT-SEC-001 | cross-subject B→A detail 400 posture | D/E | Neutral-refusal family holds: A→B wallet/balance/profile/internal-funding views refused with no balance leakage; foreign-party transfer-detail refused after probe-fixture correction (recipient-side visibility of bilateral transfers is legitimate) | PASS |
| 5.10 | UAT-SEC-005 | PATCH on restricted customer 200 | **A** | **UAT-DEFECT-001** (same root cause) — catalogue SEC-005: SUPPORT is "read + funding-maker + support-queue only per registry"; SUPPORT lifecycle attempts must be refused | **FAIL (defect)** |

### 5.11 Supplementary adjudication completed during re-execution (UAT-FUND-004)

- **Question:** SUPPORT fund/defund 201 — defect or allowed?
- **Basis:** route-policy-registry agent-funding branch (comment cites A19) sets `allowedPrincipalTypes = ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']` with `customerAccess:'NONE'`, `agentAccess:'NONE'`; the funding controller's guard likewise rejects only CUSTOMER/AGENT principals; catalogue FUND-004 expectation defers to the registry ("Role boundaries **per registry** enforced (record exact observed denials)"), and catalogue SEC-005 explicitly scopes SUPPORT as "read **+ funding-maker** + support-queue only". Every authority agrees.
- **Class: E (expected behavior)** — NO defect. Card re-written to assert the registry boundary exactly; B0 evidence: `supportFund=201 (A19 allow) | supportDefund=201 (A19 allow) | customerFund=403 refused | operatorFund=201 (A19 allow)`.

### 5.12 Supplementary adjudication (UAT-SEC-007)

Class **D** — RUN-01 literal `TERMINATED` does not exist in `CustomerStatus` (`DRAFT/ACTIVE/SUSPENDED/CLOSED`); harness corrected to `CLOSED` — card PASSes incl. `terminatedLogin=401` ineligibility posture. NOT a defect.

### 5.13 Supplementary adjudication (UAT-FUND-005)

Class **D** — RUN-03-era 403 was `No ACTIVE Aggregator-Agent relationship` made invisible by an unasserted assignment (created `PENDING`-adjacent state with the aggregator itself unactivated). Production-sequenced setup (activate + assign + assert) yields `201` with correct funding posture; zero-commission scope per catalogue recorded. NOT a defect.

## 6. Final status table — all 48 non-PASS RUN-01 rows (task step 8)

| Id | Final status | | Id | Final status |
|---|---|---|---|---|
| UAT-REG-003 | PASS | | UAT-C2W-007 | PASS |
| UAT-REG-008 | PASS | | UAT-C2C-002 | PASS |
| UAT-ONB-003 | PASS | | UAT-AGENT-012 | PASS |
| UAT-ONB-008 | PASS | | UAT-FUND-001 | PASS |
| UAT-AUTH-006 | PASS | | UAT-FUND-002 | PASS |
| UAT-AUTH-011 | PASS | | UAT-FUND-004 | PASS |
| UAT-PIN-001 | PASS | | UAT-FUND-005 | PASS |
| UAT-PIN-002 | PASS | | UAT-FUND-006 | PASS |
| UAT-PIN-003 | PASS | | UAT-FEE-001 | PASS |
| UAT-PIN-004 | PASS | | UAT-FEE-002 | PASS |
| UAT-PIN-005 | PASS | | UAT-FEE-006 | PASS |
| UAT-PIN-006 | PASS | | UAT-ADMIN-005 | PASS |
| UAT-PIN-010 | PASS | | UAT-ADMIN-011 | **FAIL (UAT-DEFECT-001)** |
| UAT-CUST-004 | PASS | | UAT-SEC-001 | PASS |
| UAT-CUST-006 | PASS | | UAT-SEC-005 | **FAIL (UAT-DEFECT-001)** |
| UAT-CUST-009 | PASS | | UAT-SEC-007 | PASS |
| UAT-W2W-006 | PASS | | UAT-SEC-008 | PASS |
| UAT-W2W-008 | PASS | | UAT-SEC-009 | PASS |
| UAT-W2W-012 | PASS | | UAT-SEC-011 | PASS |
| UAT-W2W-014 | PASS | | UAT-W2C-001–006 | PASS (×6) |
| UAT-C2W-003 | PASS | | UAT-W2C-008, W2C-010 | PASS (×2) |

Summary: **PASS 46 / FAIL 2 / BLOCKED 0 / NOT APPLICABLE 0 (within this batch) / RE-EXECUTION REQUIRED 0.**

## 7. Defect gate (task step 9) — one genuine defect confirmed

### UAT-DEFECT-001 — SUPPORT role can perform customer lifecycle transitions (P0)

- **Severity:** P0 (authorization boundary breach with durable state mutation).
- **Expected (authorities):** catalogue UAT-SEC-005 ("SUPPORT is read + funding-maker + support-queue only per registry"; lifecycle ops refused), catalogue UAT-ADMIN-011 ("SUPPORT cannot perform them"), registry's own comment block for the customer-lifecycle branch ("privileged workforce"; S-FIX-01).
- **Actual (B0 evidence):** `PATCH /api/v1/customers/{id} {status:'SUSPENDED'}` as SUPPORT → **HTTP 200**, and a post-state read shows the customer **SUSPENDED** — the transition is applied, not merely echoed. Scratch customer restored to ACTIVE after each probe; all four lifecycle families probed in UAT-ADMIN-011/UAT-SEC-005 shared the same breach.
- **Repro:** authenticate a SUPPORT workforce session → `PATCH /api/v1/customers/{scratchCustomerId}` with `{status:'SUSPENDED', actor:'uat', reason:'uat'}` → observe 200; GET customer → status SUSPENDED.
- **Root cause (recorded, NOT fixed):** `src/authorization/route-policy-registry.ts` customer-lifecycle branch (`method === 'PATCH' && /^\/api\/v1\/customers\/…$/`) lists `allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']`; SUPPORT must be excluded (compare the sibling agent-lifecycle branch where SUPPORT is explicitly denied per the documented V1-003 decision).
- **Dependent cases:** `UAT-ADMIN-011`, `UAT-SEC-005` remain FAIL on the ledger with `defect=UAT-…-DEFECT` attribution; no other B0 case depends on SUPPORT-lifecycle. Per mandate enforcement of §15.4: the final gate (B8) cannot reach the clean verdict while this P0 is open.
- **B1 must account for it:** keep UAT-ADMIN-011/UAT-SEC-005 as defect-attributed open rows; do **not** re-execute them until a fix decision lands; do not weaken the expectation; forward the fix decision to the owners of `route-policy-registry.ts` (app-code change is out of UAT scope — record, don't fix).
- **No other genuine defects** were confirmed at B0. FUND-004 (SUPPORT funding 201) adjudicated Class E registry-conformant; SEC-007 Class D; FUND-005 Class D. UAT-DEFECT-002..: none.

## 8. Exit criteria (task step 10)

- **Original counts (recovery checkpoint):** 127 reliable PASS / 38 re-execution-required / 10 adjudication-required / 17 registered NOT APPLICABLE / 0 confirmed defects. Ledger reconciles 127+48+17 = 192 rows (191 catalogue items plus one RUN-01 CFG companion-tag row).
- **B0 counts:** 48 executed · **46 PASS / 2 FAIL / 0 BLOCKED / 0 NOT APPLICABLE / 0 RE-EXECUTION REQUIRED**; 38/38 re-executions PASS; adjudications: 6→D, 3→E (incl. FUND-004 supplementary 5.11), 2→A (same defect). Convergence path: run#1 22/26 → run#2 41/7 (harness rounds 1–3) → run#3 43/5 → final 46/2; every intermediate failure root-caused to harness or to UAT-DEFECT-001 — none re-branded.
- **Harness corrections:** 8 categories (§3), all inside the untracked B0 spec; forbidden actions honored — no security weakening, no rate-limit disablement, no MFA/OTP/PIN/authz bypass, no app-config change, no expectation change (FUND-004's expected value is the registry's, per the catalogue).
- **Files changed:** `test/tmp-uat-b0-01.integration.spec.ts` (new, untracked) — harness only; `docs/uat-evidence/V1-UAT-B0-results.jsonl` (new); `docs/uat-evidence/V1-UAT-B0-REPORT.md` (new). RUN-01 artifacts untouched (checkpoint md5 re-verified post-B0).
- **Commits:** none. HEAD `67a842aefe82d08f2598d92e692792fc17cef449` == `origin/arena/01a0d883-monienaija`; tracked tree clean (untracked UAT artifacts listed above preserved per workspace convention).
- **Exact B1 must-execute set:** **NONE pending re-execution** (no invalid executions remain). B1's obligations: (1) carry **UAT-DEFECT-001** as an open P0 defect with its two dependent rows UAT-ADMIN-011 + UAT-SEC-005 (no re-run until fix decision); (2) proceed straight to catalogue-plan continuation per `docs/V1-UAT-RECOVERY-01.md` — the old B1–B7 re-execution batches are superseded by B0 (all 48 resolved here).
- **Cases now reliably evidenced (cumulative):** 127 (RUN-01) + 46 (B0) = **173 PASS-evidenced**; 2 defect-attributed FAIL (UAT-ADMIN-011, UAT-SEC-005); 17 registered NOT APPLICABLE. Coverage-complete against the 191-item catalogue modulo the open defect gate.

**STOP per task scope. B0 gate result: harness/environment debt fully retired; one P0 application defect (UAT-DEFECT-001) recorded and gated for B8. No B1 activity performed.**
