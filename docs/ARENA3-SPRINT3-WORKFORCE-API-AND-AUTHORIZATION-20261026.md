# ARENA 3 — Sprint 3: Workforce API and Authorization (Backend)

- **Repo/branch:** `shyne240/monienaija` @ `arena/8e59e188-monienaija`
- **Baseline:** `3428e37e02e7ea55b431f8d2d461fb2356a418de` (Sprint 2 final integration report commit; verified fast-forward from `3d05aae`, complete Sprint 2 integration history preserved: `dc8c109` → `8012250` → `d6c7cb6` → `66fb383` → `f4ecbc7` → `4d05ddf` (A1) → `941b3a0` (A4) → `e561953` (A2) → `652b20d` (a16 reconciliation) → `3428e37`)
- **Sprint 3 commits (this document covers all of them):**
  - `8d4b465` — V1-SPRINT3-AGENT-HISTORY-API-01 (P1): workforce unified agent transaction history endpoint
  - `967a1ca` — V1-SPRINT3-GUARD-01 (P2): declared-gate enforcement in the WORKFORCE_SESSION guard branch + 12-test HTTP suite
  - `affd8a9` — V1-SPRINT3-SEC-SWEEP-01 (P3): limit-assignment function gates + sweep tests
  - (this report) — P4 policy handoff + delivery record
- **Scope discipline:** backend only. No production deployment, no migration execution, no merge to main. ARENA 1's Cash-to-Cash settlement code was audited but NOT modified.

---

## 1. Priority 1 — [IMPLEMENTED] Unified Agent transaction history for workforce

### 1.1 Architecture investigated (six-service history, verified)

The Agent history read-side is a **pure projection** owned by
`AgentTransactionHistoryService.listUnified()` (`src/agent/agent-transaction-history.service.ts`,
V1-AGENT-HISTORY-01). It never mutates and never synthesizes; it projects six canonical
types from their authoritative stores:

| Canonical type | Authoritative source | Agent scoping in every query |
|---|---|---|
| `CASH_IN` | `ledger_journals` + `ledger_lines` with `metadata->>'canonicalService'='CASH_IN'` | line's `ledger_account_id` ∈ the Agent's own `wallet_accounts.ledger_account_id` set |
| `CASH_OUT` | same, `canonicalService='CASH_OUT'` | same |
| `AGENT_FUNDING` | journals with `metadata->>'direction'='FUND'` | wallet ledger accounts **AND** `metadata->>'agentId' = :agentId` |
| `AGENT_DEFUNDING` | same, `direction='DEFUND'` | same |
| `CASH_TO_CASH` | `cash_to_cash_transfers` rows (initiated lifecycle) | `agent_id = :agentId` |
| `CASH_TO_CASH_CLAIM` | `audit_events` (`entity_type='AGENT_CASH_TO_CASH_CLAIM'`, `action='CASH_TO_CASH_CLAIMED'`) LEFT JOIN the settling journal | `actor = :agentId` |

The six write-side services (cash-in/cash-out processing, funding execution, C2C start,
claim, expiry) were left untouched — no accounting event is double-counted, because the
workforce endpoint calls the *same read-only service* the Agent-self route already calls.

### 1.2 New endpoint

`GET /api/v1/internal/agents/:id/transactions` — `AdminAgentController.getTransactions`
(`src/admin/admin-agent.controller.ts`), the workforce investigation surface that
admin-web's `AgentUnifiedHistoryPanel` (ARENA 2, commit `b604565`) has been calling since
Sprint 2 — previously every request 404'd (verified cross-team finding).

Controller flow: `requireWorkforce` (AGENT/CUSTOMER/AGGREGATOR principals rejected;
missing principal 401) → `requireFunction('agent.view')` (allowed principal types
`SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, matching the sibling reads on the same controller)
→ `assertUuid(id)` (400 `id must be a UUID`) → Agent existence (404 `Agent not found`) →
`historyService.listUnified({ agentId: id, page, limit, type })`.

Registry: a declared branch in `src/authorization/route-policy-registry.ts`
(WORKFORCE_SESSION, `OPERATOR/SERVICE/PRIVILEGED`, `requiredFunctions: ['agent.view']`,
resourceType `agent-transaction-history`) — so the P2 guard change enforces the same gate
as defense in depth. `AgentModule` now exports `AgentTransactionHistoryService`
(`AdminModule` already imports `AgentModule`; no cycle).

### 1.3 EXACT contract for ARENA 2 (replaces the 404 the panel currently gets)

**Request**

```
GET /api/v1/internal/agents/{agentId}/transactions?page={int}&limit={int}&type={enum}
Authorization: Bearer <workforce session token>
```

- `agentId` (path, required): UUID. Non-UUID → **400** `{"message":"id must be a UUID",...}`.
  Unknown UUID → **404** `{"message":"Agent not found",...}`.
- `page` (query, optional): integer ≥ 1, default `1`. Non-integer/<1 silently normalizes to 1.
- `limit` (query, optional): integer 1..100, default `20`. Outside range silently normalizes to 20.
- `type` (query, optional): one of `CASH_IN | CASH_OUT | CASH_TO_CASH | CASH_TO_CASH_CLAIM |
  AGENT_FUNDING | AGENT_DEFUNDING`. Any other value → **400**
  `{"message":"type must be one of CASH_IN,CASH_OUT,CASH_TO_CASH,CASH_TO_CASH_CLAIM,AGENT_FUNDING,AGENT_DEFUNDING",...}`.
  Empty/absent → all six types merged.

**Authorization outcomes**

| Caller | Result |
|---|---|
| Workforce role holding catalogue function `agent.view` (SUPER_ADMIN, AGENT_NETWORK_MANAGER, ADMINISTRATOR, FINANCE_AUDITOR) | **200** |
| Workforce role without `agent.view` (OPERATIONS, FINANCE_CONTROLLER, TREASURY, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, FINANCE_PREPARER) | **403** `{"message":"Authorization denied: FUNCTION_MISSING"}` |
| Agent session token (even the Agent's own id) | **403** (workforce route; Agents use `GET /agents/me/transactions`) |
| No/garbage token | **401** |

**Response 200** — byte-identical shape to `GET /api/v1/agents/me/transactions` (same service):

```jsonc
{
  "items": [
    {
      "id": "uuid-or-transfer-id",        // ledger journal id / cash_to_cash_transfers.id / claim journal id
      "type": "CASH_IN",                  // the six canonical types above
      "status": "COMPLETED",              // ledger/claim rows: always COMPLETED.
                                          // CASH_TO_CASH rows carry the transfer lifecycle:
                                          // UNCLAIMED | CLAIMED | EXPIRED
      "amountMinor": "10000",             // STRING (minor units, no floats)
      "currency": "NGN",
      "direction": "DEBIT",               // CASH_IN: DEBIT | CASH_OUT: CREDIT |
                                          // AGENT_FUNDING: CREDIT | AGENT_DEFUNDING: DEBIT |
                                          // CASH_TO_CASH: DEBIT | CASH_TO_CASH_CLAIM: CREDIT
                                          // (AGENT_CASH redemption) else UNKNOWN
      "createdAt": "2026-10-26T12:00:00.000Z",
      "completedAt": "2026-10-26T12:00:00.000Z", // null for UNCLAIMED/EXPIRED-without-settlement C2C rows
      "reference": "S3-CASHIN",           // journal/transfer reference or null
      "narration": "Cash-in",             // journal description; C2C rows: null;
                                          // claims: "Cash→Cash cash payout" (AGENT_CASH) or
                                          // "Cash→Cash wallet redemption"
      "feeMinor": "0",                    // STRING; transfer fee_minor for C2C, "0" for ledger rows
      "counterparty": { "type": "CUSTOMER" },
                                          // CASH_IN/CASH_OUT: {type:"CUSTOMER"} |
                                          // funding: {type:"WORKFORCE"} or
                                          //   {type:"AGGREGATOR", aggregatorId} when aggregator-funded |
                                          // C2C + claim: {type:"CUSTOMER", beneficiaryPhone:"803..."} |
                                          // null when unmapped
      "commission": null,                 // or {commissionMinor:"...", payable:true|false, treatment:string|null}
                                          // from this Agent's OWN allocation in the commercial
                                          // decision snapshot (no cross-agent data)
      "failureCode": null,                // reserved; always null in the current projection
      "failureMessage": null
    }
  ],
  "pagination": {
    "page": 1, "limit": 20, "total": 6,   // total = count across the selected type(s)
    "totalPages": 1, "hasNextPage": false
  }
}
```

Ordering: global deterministic merge — `createdAt DESC, id DESC` — stable across pages
(pagination test proves no duplicates/loss). No journal internals, ledger account ids,
request hashes, PIN/OTP material or workforce identity appear in items.

### 1.4 Tests

`test/v1-sprint3-agent-history-workforce.integration.spec.ts` (real PostgreSQL, HTTP-level,
12 tests): full six-type projection with exact field assertions; consistency with the Agent
SELF route (identical item-ID sets via a real Agent login); type filtering + 400; pagination
across 4 pages with ordering proof; the complete authorization matrix above; 404/400 paths.

---

## 2. Priority 2 — [IMPLEMENTED] Workforce authorization defense-in-depth (V1-SPRINT3-GUARD-01)

### 2.1 Finding confirmed and scoped

Sprint 2's V1-HARDEN-01 Part D verified that `RuntimeAccessGuard`'s WORKFORCE_SESSION branch
admitted any authenticated workforce principal without consulting `route.policy` requirements.
Part D also verified that enforcing the policy's `allowedPrincipalTypes` in the guard broke
five suites via 401→403 status drift and was therefore NOT applied. Sprint 3 implements the
carefully scoped slice: **the guard now enforces only what a route policy explicitly DECLARES
— `requiredFunctions` / `requiredRoles` / `requiredScopes`** — via `AuthorizationService.evaluate()`
(no second audit record; the controller's `requireFunction` remains the authoritative audited
decision). Denial mirrors `requireFunction`'s default exactly: **403**
`Authorization denied: <FUNCTION_MISSING|ROLE_MISSING|SCOPE_MISSING>`. Principal-type
allow-lists are deliberately NOT duplicated in the guard (their status conventions — e.g.
`agent-lifecycle`'s documented `deniedStatus: 401` — remain controller-owned).

### 2.2 Complete parity map (declared WORKFORCE_SESSION gates vs controller enforcement)

| Registry branch | Declared gate | Controller gate today | Relation |
|---|---|---|---|
| POST `/internal/agents/:id/(fund\|defund\|fund-request\|defund-request)`; POST `/internal/aggregators/:a/agents/:id/(fund\|defund)` | `requiredFunctions` [`agent.fund` or `agent.defund` by direction] | `AgentFundingController.requireFunction` same fn + service-level Decision 7 maker/checker/MFA | controller stricter |
| GET `/internal/agents/funding-requests` (inbox) | `requiredRoles` [FINANCE_CONTROLLER] + `requiredFunctions` [`agent.fund`,`agent.defund`] | `requireFundingChecker` + `assertCheckerPrincipal` | equal/stricter |
| GET `/internal/agents/:id/funding-requests` | none declared | service checks | untouched by design |
| POST `/internal/agents/funding-requests/:id/(execute\|reject)` | `requiredRoles` [FINANCE_CONTROLLER] + both functions | `requireFundingChecker` | equal/stricter |
| POST `/internal/aggregators/:a/agents/:id/(outlets\|terminals)`; `/internal/agents/:id/(outlets\|terminals)`; `/internal/outlets/*`, `/internal/terminals/*` non-GET | `agent.manage_outlets_terminals` | `OutletController.requireManage` same fn | equal |
| `/internal/aggregators/*` non-GET | `aggregator.manage` | `AggregatorController.requireManage` same fn | equal |
| GET `/internal/agents/:id/receiving-number` | `agent.view` | controller `requireFunction('agent.view')` (Sprint 2) | equal |
| `/internal/agents/classes` GET / non-GET | `agent.view` / `agent.manage_classes` | `AgentClassController` same | equal |
| GET `/internal/agents/:id/transactions` (NEW, §1) | `agent.view` | `AdminAgentController.requireFunction('agent.view')` | equal |
| catch-all default branch | `requiredScopes` [`internal:access`] | guard `authorize()` already | out of scope |

**Zero-drift conclusion:** every declared gate is backed by an equal-or-stricter controller
gate, so the guard check can only deny a principal the matching controller would deny
milliseconds later, with the same 403 status. The only observable message change: on the
funding checker routes a non-FINANCE_CONTROLLER with both functions (ANM/SUPER_ADMIN) now
receives `Authorization denied: ROLE_MISSING` from the guard instead of the controller's
custom message — same 403 status; no test asserted those messages (verified by grep;
`a19:374`'s `Decision 7 requires AGENT_NETWORK_MANAGER` assertion is service-level and
unaffected). Routes using `deniedStatus: 401` (`customer.controller`, `agent-lifecycle.controller`)
declare no required* gates and are untouched. SUPER_ADMIN keeps its explicitly approved
behavior; Agent SELF scoping, service-principal restrictions and maker-checker separation
are unchanged (guard change is confined to the WORKFORCE_SESSION branch and appended AFTER
authentication, SELF binding and the Part C read-only method gate).

### 2.3 Tests (same spec file, §1.4)

- **Guard precedence proven:** ANM → POST `funding-requests/:id/execute` gets 403
  `Authorization denied: ROLE_MISSING` from the guard *before* the controller's custom
  message — same status as Sprint 2.
- **Legitimate flows:** ANM maker `fund-request` 201; FC inbox 200; ANM classes POST 201;
  SUPER_ADMIN `agent.view` read 200.
- **Canonical denial:** OPERATIONS outlet POST → 403 `Authorization denied: FUNCTION_MISSING`
  (identical status+message to the pre-change controller denial).
- **Gate ordering:** FINANCE_AUDITOR classes POST → 403 `Read-only principal may not perform
  this operation` (Part C method gate still fires first).
- **No regression:** Sprint 2 receiving-number gate passes (200 NONE view for `agent.view` holder).
- **Drift regression run:** the 8 highest-risk existing suites — `v1-funding-approvals-inbox`,
  `p0-p1-security-remediation`, `phase1-agent-security`, `a20-outlets-terminals`,
  `a22-admin-foundation`, `v1-agent-receiving-number-authorization`, `v1-agent-history-01`,
  `v1-capability-registry` — all pass unchanged: **156/156**.

---

## 3. Priority 3 — [FIXED + AUDITED] Workforce Agent operational-endpoint security sweep

### 3.1 Verified defect fixed: limit-assignment reads/non-Agent writes had no function gate

`LimitAssignmentController` (`src/limit-catalog/limit-assignment.controller.ts`) passed every
GET with the bare `requireWorkforce` principal-type check: **any** workforce principal —
including TREASURY (holds only `reconciliation.view`) and OPERATIONS (holds no `limit.*`
function) — could read Agent-scoped limit assignments via
`GET /internal/limit-assignments/agent/:id` (unauthorized cross-agent read of Agent limit
configuration), and any OPERATOR-typed role could create/patch non-Agent assignments. The
sibling `LimitCatalogController` already gates the same domain with `limit.view`/`limit.modify`,
and the AGENT write path here was already stricter (`agent.assign_limit`) — the reads and
non-Agent writes were the inconsistent gap.

**Fix (commit `affd8a9`):** all seven GET routes require `limit.view`; POST/PATCH non-Agent
branches require `limit.modify`; `requireWorkforce` still runs first so its documented
401/403 type-denial behavior and messages are unchanged; the AGENT write branch is untouched
(`agent.assign_limit`, per the p0-p1 pin "agent-level limit assignment follows
agent.assign_limit, not limit.modify"). Every `agent.assign_limit` holder (ANM, SUPER_ADMIN)
also holds `limit.view`, so no legitimate Agent-limits flow loses access. Note one intended
tightening: ANM creating **non-Agent** (GLOBAL/SEGMENT/CUSTOMER) assignments now requires
`limit.modify`, which ANM does not hold — consistent with the catalogue's separation of
Agent-scoped assignment authority from limit-domain writes (and with the p0-p1 pin that ANM
assignment authority does not grant limit-catalogue authority).

Tests: positive (FINANCE_AUDITOR/ANM/FINANCE_CONTROLLER 200 on agent-scoped reads;
FINANCE_CONTROLLER passes the `limit.modify` gate) and negative (OPERATIONS/TREASURY/
COMPLIANCE 403 `FUNCTION_MISSING` on reads; OPERATIONS 403 on a DTO-valid non-Agent create)
in the Sprint 3 spec. Regression: `v1-limit-02-limit-assignment`,
`v1-harden-01-limit-catalog-check-constraint-boundary`, `p0-p1-security-remediation` all
pass unchanged (76/76 across the four suites).

### 3.2 Audited — no defect / intentionally unchanged

| Surface | Result |
|---|---|
| `AdminAgentController` list/get/financial-position | `agent.view`-gated; UUID-bound; safe projections; Agent entity has no sensitive columns (raw list rows ≡ safe projection fields) |
| `AdminAgentCredentialsController` issue/reissue | `agent.manage_credentials` + OPERATOR/SERVICE/PRIVILEGED; temporary password is a documented ONE-TIME delivery value, never stored/logged |
| `AdminAgentLifecycleController` + `AgentLifecycleController` | per-function gates (suspend/terminate/reactivate/activate/review_application); the legacy controller keeps its documented `deniedStatus: 401` convention (pinned by a8 tests) — preserved |
| `AgentApplicationAdminController` | `agent.review_application` on all five routes |
| Classes / funding / outlets-terminals / aggregators / receiving-number | Sprint 2 parity map (§2.2) — all equal-or-stricter; no new defect |
| `AgentCashToCashOperationsController` (ARENA 1 surface) | GET transfers requires `transaction.view` — gated; **audit only, not modified** per mission constraint |
| Pagination/filtering authorization | history endpoint validates `type` server-side (400), clamps `limit`, and every projection query is Agent-bound at the SQL boundary; commission evidence is filtered to the Agent's OWN allocation |
| Sensitive response fields | history items exclude journal internals/hashes/PIN material; limit-assignment service returns safe projections; wallet route hides `ledgerAccountId` |
| `AdminAggregatorController` list + `AggregatorController` GET `:id`/`:aggregatorId/agents` | type-gated only (no `aggregator.view` function check). This is long-standing design pinned by `a22-admin-foundation` test 4, whose legacy privileged fixtures deliberately exclude `aggregator.view` — changing it would rewrite pinned expectations without an approved policy delta. Recorded as governance follow-up (§5, item 3), not silently changed |

---

## 4. Priority 4 — Policy handoff: governance decisions required before implementation

Documentation only. Nothing below is implemented, and no authorization or
identity-verification procedure is invented; each item lists the exact decisions an owner
must approve, grounded in the verified current state (Sprint 2 report §3.2/§3.3, re-verified
this sprint — no reclassification surface and no PIN-recovery ceremony exist in code or
approved docs).

### 4.1 Post-activation Agent reclassification

Verified state: class **definition** administration exists (`/internal/agents/classes`,
`agent.manage_classes`, ANM+SUPER_ADMIN per Decision in Sprint 2 §1.3). Class **assignment**
happens exactly once, at application time (`agent_applications.agent_class_id` → activation
copies it to the Agent). No PATCH/reclassification surface exists on any agent resource; no
approved policy document defines one (`reclassif*` search across docs finds only unrelated
accounting contexts).

Reclassification of a live financial principal changes derived capabilities
(`applicableServices`), limits (`applicableLimits`) and lifecycle semantics, so the following
decisions are required **before** implementation:

1. **Entitlement:** which catalogue function gates a reclassification (reuse
   `agent.manage_classes`, or a new function e.g. `agent.reclassify`)? Which role(s) hold it,
   with which access type (INITIATE/APPROVE/EXECUTE)?
2. **Maker-checker:** does reclassification require the Decision-7-style maker/checker split
   (and which checker role), or single-actor EXECUTE like class definition edits? If
   maker-checker: does it reuse the fingerprint-bound funding approval workflow or the
   privileged-action approval service?
3. **In-flight transaction rules:** what happens to PENDING/UNCLAIMED C2C transfers, pending
   funding requests and in-progress sessions when capabilities change mid-flight — freeze,
   drain, or grandfather?
4. **Limit-migration invariants:** when `applicableLimits` shrink, are existing
   `limit_assignments` and already-consumed daily counters re-evaluated, and what denies
   first (new class limits vs. existing agent-specific assignments precedence)?
5. **Lifecycle semantics:** may a reclassification change status (e.g. force SUSPENDED), and
   which lifecycle audit events (`audit_events` entity_type/action vocabulary) are mandatory?
6. **Capability/limit/lifecycle invariants (mission constraint):** explicit statement that
   reclassification must preserve them — e.g. no capability grant that exceeds the class
   catalogue, no limit decrease below already-committed obligations.
7. **Audit contract:** previous/new class, actor, approval references, correlation ids.

Implementation pattern once approved: `agent.manage_classes`-style `requireFunction` +
approval workflow + audit, exactly as the existing class/funding surfaces do.

### 4.2 Administrative transaction PIN unlock/reset

Verified state: 5 failed PIN attempts → `agent_transaction_pins.account_locked` (atomic;
tested by `v1-agent-05-transaction-pin-security` + phase1 concurrency). While locked, even
the correct PIN is rejected and `POST /agents/me/transaction-pin/change` answers 403
"…Contact support to proceed." `docs/V1/V1-AGENT-05-TRANSACTION-PIN-SECURITY-01.md` §7
**deliberately removed** insecure self-service reset and requires "an operational/support
path". Agent Mobile's LOCKED state shows only "Contact Support" (ticket prefill category
`PIN`). The support-ticket intake exists, but **no backend recovery ceremony is specified
anywhere**: the catalogue has zero PIN-related functions, no workforce role is designated,
and no identity-verification/approval/audit policy is documented.
`AgentAuthenticationService.unlockCredential` (login credentials, not PIN) exists at service
level and is unexposed on any route.

Implementing an unlock/reset API without that policy would be exactly the "privileged
bypass" the mission forbids. Required decisions:

1. **Entitled role(s) + catalogue function:** name the new function (e.g.
   `agent.manage_pin_recovery`) and which role(s) hold it, with access type; decide whether
   `agent.manage_credentials` holders (ANM/SUPER_ADMIN) inherit it or it is deliberately
   separate (e.g. CUSTOMER_SERVICE/SUPPORT-facing).
2. **Identity-verification evidence:** exactly what must be verified before an unlock/reset
   (support-ticket binding? government-ID/KYC re-check? registered-phone OTP? in-person
   aggregator attestation?) and which system of record stores the evidence.
3. **Maker-checker/approval:** does unlock require dual control (maker performs identity
   verification, checker approves)? Which approval engine (privileged-action approvals vs.
   funding-style fingerprint-bound workflow)? Is SUPER_ADMIN excluded as in Decision 7?
4. **Unlock vs. reset semantics:** does the ceremony merely clear `account_locked`
   (failed-attempt counter reset, existing PIN kept), or also force a PIN reset — and if
   reset, is the new PIN agent-set (preferred: never workforce-known) via a one-time
   out-of-band token like the existing temporary-credential pattern?
5. **Cooldown/rate limits:** per-agent and per-actor cooldowns, daily caps, and behavior on
   repeated lockouts (e.g. escalate to suspend after N recoveries).
6. **Audit contract:** mandatory `audit_events` vocabulary (entity_type/action), recorded
   evidence references, actor + approver identities, correlation to the support ticket.
7. **Support-path wiring:** whether the existing `prefillCategory: 'PIN'` ticket becomes the
   mandatory entry point (ticket id required in the API call) or workforce may act without
   a ticket.

Implementation pattern once approved: `requireFunction` + approval workflow + audit +
rate limiting — all established in the funding/credential surfaces.

---

## 5. Remaining blockers / cross-team follow-ups (NOT merge defects)

1. **P4 §4.1 reclassification** — blocked pending owner governance decisions (list above).
2. **P4 §4.2 PIN unlock/reset** — blocked pending approved recovery policy (list above).
3. **Aggregator read gating** (AdminAggregatorController list; AggregatorController
   GET `:id` / GET `:aggregatorId/agents`): type-gated only, by long-standing design pinned
   in a22 test 4. Recommend a governance decision on requiring `aggregator.view` for these
   reads (catalogue function already exists; holders: SUPER_ADMIN, FINANCE_AUDITOR,
   OPERATIONS, ADMINISTRATOR); implementing it requires updating the a22 legacy fixture
   expectations, which needs explicit approval because it rewrites pinned behavior.
4. **ARENA 2 frontend:** the panel's contract is now live (§1.3). Note `limit` >100 silently
   normalizes to 20 and invalid `page`/`limit` normalize rather than 400 — only invalid
   `type` 400s. Amounts are STRINGS in minor units.

## 6. Files changed (Sprint 3)

- `src/admin/admin-agent.controller.ts` — new `GET :id/transactions` + `AgentTransactionHistoryService` injection
- `src/agent/agent.module.ts` — export `AgentTransactionHistoryService`
- `src/authorization/route-policy-registry.ts` — declared branch for the new route
- `src/authorization/runtime-access.guard.ts` — V1-SPRINT3-GUARD-01 declared-gate enforcement (WORKFORCE_SESSION branch only)
- `src/limit-catalog/limit-assignment.controller.ts` — V1-SPRINT3-SEC-SWEEP-01 `limit.view`/`limit.modify` gates
- `test/v1-sprint3-agent-history-workforce.integration.spec.ts` — NEW, 13 HTTP integration tests (real PostgreSQL)
- `docs/ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md` — this report

## 7. Test evidence (own execution, this sprint)

- Backend build (`npm run build`): PASS (0 errors).
- Unit suite (`npm run test`): **191/191 suites, 1959/1959 tests PASS**.
- New Sprint 3 spec: **13/13 PASS** (real PostgreSQL, HTTP-level).
- Targeted PG drift/regression runs: 8-suite guard-risk batch **156/156 PASS**; 4-suite
  limit batch **76/76 PASS** (overlaps the 13).
- Full PG integration regression (`scripts/run-pg-integration-tests.js`, concurrency 1):
  see `sprint3-full-pg.log` — result recorded in §7.1 below.
- Lint: per-file parity — `admin-agent.controller.ts` 15 pre-existing errors before and
  after (0 new); `limit-assignment.controller.ts` 2 pre-existing before and after (0 new);
  new/changed guard/registry/module/test files clean.
- Frontend apps: NOT modified this sprint (backend-only scope); Sprint 2 gates
  (admin-web tsc+jest 24/24 · 161/161 + vite build; agent-mobile tsc+jest 19/19 · 284/284)
  remain the last verified state.

### 7.1 Full PostgreSQL regression result

`PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=s3full node scripts/run-pg-integration-tests.js`
(log: `sprint3-full-pg.log`, gitignored; runner exit code 0):

- **Test Suites: 116 passed, 116 total** (Sprint 2's 115 + the new Sprint 3 spec)
- **Tests: 2222 passed, 2222 total** (Sprint 2's 2209 + the 13 new HTTP tests)
- **0 failed suites, 0 failed tests.**

## 8. Delivery record

- Commits: `8d4b465` (P1), `967a1ca` (P2), `affd8a9` (P3), + this report commit (P4).
- Remote: `origin/arena/8e59e188-monienaija` (each milestone pushed after verification).
- No merges to main, no migrations executed against shared environments, no production
  deployment. Embedded PostgreSQL 18.4 used for all PG runs (test-only).
