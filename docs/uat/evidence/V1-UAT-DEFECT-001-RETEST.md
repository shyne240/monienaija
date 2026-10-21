# V1-UAT-DEFECT-001 — Fix & Retest Evidence (V1-UAT-DEFECT-001-FIX)

**Task:** V1-UAT-DEFECT-001-FIX — correct SUPPORT customer-lifecycle authorization boundary.
**Date:** 2026-10-01 · Branch `arena/01a0d883-monienaija` · Base HEAD `67a842aefe82d08f2598d92e692792fc17cef449`
**Final disposition: DEFECT FIXED AND VERIFIED** (evidence below; one focused commit `fix(auth): close support customer lifecycle authorization`).

---

## 1. Defect description

- **UAT-DEFECT-001 (P0):** a WORKFORCE-**SUPPORT** session could execute customer lifecycle
  transitions on `PATCH /api/v1/customers/{id}`. Body `{status:'SUSPENDED'}` returned **HTTP 200**
  and the customer's **persisted** post-state became `SUSPENDED`.
- Independently proven by **UAT-ADMIN-011** and **UAT-SEC-005** during V1-UAT-B0
  (pre-fix ledger: 46 PASS / 2 FAIL; see §6 provenance note).

## 2. Original failing behavior

From the B0 evidence rows (pre-fix):
- UAT-ADMIN-011: `error=assert failed: SUPPORT lifecycle must be refused (catalogue + S-FIX-01):
  got HTTP 200; post-state=SUSPENDED; defect V1-DEFECT-001 …`
- UAT-SEC-005: `error=assert failed: SUPPORT must be refused: PATCH {customerId} => 200 …`
- Persisted state side-effect proven: customer row flipped to `SUSPENDED` (harness restored it).

## 3. Root cause (two layers, both corrected)

Layer A — **declared route policy**: `src/authorization/route-policy-registry.ts`
customer-lifecycle branch (`method === 'PATCH' && /^/api/v1/customers/[^/]+$/`) listed
`allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']`, contradicting the
authoritative V1 UAT catalogue (UAT-SEC-005: SUPPORT = *read + funding-maker + support-queue
only*; UAT-ADMIN-011: "SUPPORT cannot perform them"), the branch's own S-FIX-01 comment, and the
V1-003 agent-lifecycle decision whose sibling branch already excludes SUPPORT.

Layer B — **runtime enforcement**: on `WORKFORCE_SESSION` routes the runtime guard authenticates
and attaches the principal but does **not** call the policy-decide path; the lifecycle route's
effective authorization check lives in `CustomerController.requireWorkforce`, which rejected only
AGENT/CUSTOMER/AGGREGATOR types and admitted every workforce type **including SUPPORT**. This
mirrors the pre-V1-003 agent-lifecycle controller — that controller's `requirePrivileged` solves
the identical class by additionally rejecting SUPPORT (`'Privileged access required'`), which is
the established house convention for this boundary.

Two committed tests had encoded the defective boundary (strictly necessary to flip; both now
assert the corrected boundary):
- `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts` (policy pin + SUPPORT-suspend=200 leg).
- `test/v1-customer-onboarding-02.integration.spec.ts` (SUPPORT-activate=200 leg; activation is in
  the SEC-005 lifecycle list "suspend/terminate/reactivate/activate").

## 4. Exact code change (minimal, in-architecture)

1. `src/authorization/route-policy-registry.ts` — removed `'SUPPORT'` from the
   customer-lifecycle branch `allowedPrincipalTypes` → `['OPERATOR','SERVICE','PRIVILEGED']`;
   comment updated to record the UAT-DEFECT-001 boundary decision. No other branch touched;
   authorization still flows through the existing route-policy + session + controller architecture.
2. `src/customer/customer.controller.ts` — `requireWorkforce` (used **only** by the lifecycle
   `@Patch(':id')` handler — verified single-use) now also rejects `principal.type === 'SUPPORT'`
   with `UnauthorizedException('Privileged access required')` (401), exactly mirroring the V1-003
   agent-lifecycle tightening precedent. No other endpoint behavior on this controller changed
   (SUPPORT reads, funding-maker, support queue untouched).
3. `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts` — policy pin updated to
   `['OPERATOR','SERVICE','PRIVILEGED']`; SUPPORT-suspend leg now expects **401 "Privileged access
   required"**, `status stays ACTIVE`, audit count unchanged (no side effect).
4. `test/v1-customer-onboarding-02.integration.spec.ts` — SUPPORT-activate leg now expects **401**,
   status stays `DRAFT`, then OPERATOR activates the same DRAFT (authorized-role proof preserved).
   SUPPORT **read** assertions inside the same suite unchanged.

**Not changed:** financial behavior, customer lifecycle state machine, authentication, Agent
permissions, workforce role definitions, migrations, app config.

## 5. Retest procedure & results (real PostgreSQL, real HTTP)

### 5.1 Exact defect scenarios (UAT harness cards, real PG)

| Card | Post-fix HTTP (SUPPORT) | Persisted customer state | Authorized-role check | Verdict |
|---|---|---|---|---|
| **UAT-ADMIN-011** | **401** `{"message":"Privileged access required"}` | **ACTIVE (unchanged)** — proven before/after via SQL | OPERATOR transitions 200; `auditEvents=4` | **PASS** |
| **UAT-SEC-005** | **401** on lifecycle PATCH; agent-suspend 403; credential-issue 403; **checker approve 403** | **before=ACTIVE after=ACTIVE** | SUPPORT **funding-maker** still allowed (201) by design; OPERATOR rejects probe request in cleanup | **PASS** |

Ledger: `docs/uat-evidence/V1-UAT-D1-RETEST-results.jsonl` — **48/48 PASS** (full V1 UAT
re-execution post-fix, runId `V1-UAT-D1-RETEST`), up from pre-fix 46/2 with no other row changed
from PASS.

### 5.2 Authorization boundary matrix (S-FIX-01 suite, 7/7)

| Principal | Lifecycle PATCH result | State mutation? |
|---|---|---|
| SUPPORT | **401** | none (status unchanged, no new audit row) |
| CUSTOMER (self / masquerade) | 403 / 401 | none |
| AGENT (real session) | 403 | none |
| OPERATOR | 200 + audit | as intended |
| PRIVILEGED | reaches service (404 on missing id) | gate passage proven |
| No token / unknown token | 401 | none |

Onboarding-02 suite (9/9): OPERATOR activates DRAFT+verified-phone with full audit row; SUPPORT
denied 401; fail-closed phone-verification gate (400 on unverified) unchanged; CUSTOMER/AGENT 403;
SUPPORT read of the phone-verification review surface still 200.

### 5.3 Regression results

| Suite | Result |
|---|---|
| `s-fix-01-customer-lifecycle-authorization.integration` (7 tests, defect surface) | **7/7 PASS** |
| `runtime-access.guard.spec` + `production-readiness.spec` (unit) | **14/14 PASS** |
| `v1-001-customer-funding.integration` (SUPPORT maker / maker≠checker) | **39/39 PASS** (with v1-customer-credentials-01) |
| `v1-customer-onboarding-01/02` + `a22-admin-foundation` | **39/39 PASS** (9/9 corrected onboarding-02) |
| `v1-003-admin-operational-writes.integration` (agent lifecycle sibling branch) | **21/21 PASS** |
| V1 UAT harness re-execution (48 cards incl. SUPPORT flows FUND-001/002/004=201 by design) | **48/48 PASS** |
| Build/typecheck (`npx tsc --noEmit`) | **0 errors** |

No legitimate SUPPORT operation was impacted: funding-maker (201), customer read surfaces,
support-queue scope all continue to pass. No FUND-004/SEC-007/FUND-005 area was touched
(B0-closed, not defects — honored).

## 6. UAT evidence provenance note (transparency)

During this task the B0 harness overwrote `docs/uat-evidence/V1-UAT-B0-results.jsonl` once
(46/2 pre-fix ledger superseded by post-fix rows). Handling:
- The post-fix contents were preserved under `V1-UAT-D1-RETEST-results.jsonl` (runId relabelled,
  rows untouched).
- The historical slot was honestly repopulated by a **replay of the identical B0 batch against the
  stashed pre-fix code** (fix stashed → run → fix restored), runId `V1-UAT-B0-REPLAY`: it
  reproduces the exact B0 signature **46 PASS / 2 FAIL**, with the two FAILURE rows showing the
  same defect semantics (SUPPORT 200 + post-state SUSPENDED). Transient identifiers (UUIDs) differ
  from the lost original; verdicts and evidence semantics match the B0 record, whose authoritative
  contemporaneous summary remains `docs/uat-evidence/V1-UAT-B0-REPORT.md` (untouched).
- `docs/uat-evidence/V1-UAT-RUN-01-results.jsonl` remains byte-identical (md5
  `3b75282b00b78a6cdc2dacf6e9f4240e`).
- The harness now carries an **immutable-ledger guard**: writing to an existing RUN-01/B0 ledger
  path throws; all future retest runs write env-specified paths.

## 7. Commit

- Commit: **`bae409fe85e5a38ad60f4d23cedd015cc4a37a0c`** — `fix(auth): close support customer lifecycle authorization` (pushed; local HEAD == `origin/arena/01a0d883-monienaija`, tracked tree clean).
- Files changed by the fix commit (exactly 4): `src/authorization/route-policy-registry.ts`,
  `src/customer/customer.controller.ts`,
  `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts`,
  `test/v1-customer-onboarding-02.integration.spec.ts`.
- No unrelated changes bundled; UAT harness (`test/tmp-uat-b0-01.integration.spec.ts`) and this
  evidence directory remain untracked per workspace convention.

## 8. Final decision

**DEFECT FIXED AND VERIFIED.** The exact defective request —
SUPPORT `PATCH /api/v1/customers/{id} {status:'SUSPENDED'}` — now returns **HTTP 401
"Privileged access required"** with the customer's persisted status provably unchanged and no
audit side-effect, at both UAT cards and the committed authorization suite; authorized roles
(OPERATOR/SERVICE/PRIVILEGED) continue to perform lifecycle transitions with audit; all
SUPPORT-permitted capabilities (funding-maker, reads, queue) remain intact; full V1 UAT
re-execution is 48/48 PASS. **No new genuine V1 defect was introduced or observed.** Stopped after
this report — no B8, no documentation cleanup, no V2 work, no unrelated changes.
