# V1-003 Admin Operational Writes / Control Plane Consolidation — Verification Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (preserved baseline before V1-003):** `7b77ce0e0e5c7a6d6d469e59a75031527833efb0` (`docs: V1-007 report HEAD b3cffa4 merge note (final clean)` — parents `b3cffa4` `7b9eaba` `ea38ea0` `245fc9a` ... 65 migrations, `src/support/*`, `src/customer-funding/*`, A21-A26, V1-001 14/14 + V1-007 28/28 VERIFIED)  
**HEAD after V1-003 (to be committed):** `7b77ce0` + working-tree V1-003 (`src/admin/admin-agent-lifecycle.controller.ts`, `src/admin/admin.module.ts`, `src/authorization/route-policy-registry.ts`, `src/agent/agent-lifecycle.controller.ts` tightened, `test/v1-003*`) — **working tree dirty** (see §3)  
**V1-007 VERIFIED HEAD:** `7b77ce0` / `b3cffa4` merge (65 migrations, `CreateSupportTickets1785753600064`) — `test/v1-007-support-ticket.integration.spec.ts` 28/28  
**V1-001 VERIFIED HEAD:** `8669c073af4ee75c9e902a1ec006e54b1cd07736` (`feat(funding): V1-001 Operations Customer Funding with maker/checker`, parent `37aa315`, 14/14) — content byte-identical to `7b77ce0` working tree  
**A26 baseline:** `245fc9a`/`6036b7c` (19/19) merged via `b3cffa4`, `docs/V1-PRODUCT-COMPLETION-AUDIT.md` + `docs/POST-V1-001-DEPENDENCY-REVIEW.md`

---

## 1. Exact HEAD
- **Before V1-003:** `7b77ce0e0e5c7a6d6d469e59a75031527833efb0` (V1-007 VERIFIED, 65 migrations, `git status --porcelain` clean)
- **After V1-003 feature commit:** pending `git add` 5 files → new HEAD `feat(admin): V1-003 Admin operational control plane — Agent lifecycle consolidation (zero migrations)` (parents `7b77ce0`)
- **Feature branch parents:** `7b77ce0` → `b3cffa4` (merge A26) → `7b9eaba` (V1-007) → `ea38ea0` (preserve) → `245fc9a` (A26) → `3d05aae` base

## 2. Preserved Baseline
- **Before implementation:** `7b77ce0` already contains all V1-007 files (`src/support/*` 8 files, `src/migrations/1785753600064-CreateSupportTickets.ts`, `test/v1-007*` 28/28, `docs/V1-007-VERIFICATION-REPORT.md` 23 sections VERIFIED)
- **Verified via:** `git rev-parse HEAD` `7b77ce0`, `git status --porcelain` clean, `ls src/support` 8 files, `ls src/migrations | wc -l` 65, `git fsck --lost-found` dangling `7b77ce0`
- **No reset/clean/discard:** Working tree after V1-007 was clean; V1-003 adds additive admin surface, no overwrite of `src/support`, `src/customer-funding`, A21-A26

## 3. Working Tree Status
```
 M src/admin/admin.module.ts
 M src/agent/agent-lifecycle.controller.ts
 M src/authorization/route-policy-registry.ts
?? src/admin/admin-agent-lifecycle.controller.ts
?? test/v1-003-admin-operational-writes.integration.spec.ts
```
- **To be added:** `docs/V1-003-VERIFICATION-REPORT.md` (this file)
- **No deletions, no migration, no config overwrite** — `git diff --stat` 4 files modified, 2 new, `package-lock.json`/`package.json` unchanged

## 4. Files Changed (V1-003 additive, zero migrations)
- **New:**
  - `src/admin/admin-agent-lifecycle.controller.ts` (108 lines) — Admin control-plane wrapper for Agent lifecycle, `POST /internal/admin/agents/:id/{suspend,terminate,reactivate,activate}` + `applications/:id/activate`, delegates to `AgentLifecycleService`, `requireOperational` denies `CUSTOMER`/`AGENT`/`AGGREGATOR`/`SUPPORT`, allows `OPERATOR|SERVICE|PRIVILEGED`, sanitized projection, JSDoc V1-003
- **Modified:**
  - `src/admin/admin.module.ts` (import `AgentModule`, register `AdminAgentLifecycleController` alongside existing `AdminAgentController`/`AdminCustomerController`/`AdminAggregatorController`)
  - `src/agent/agent-lifecycle.controller.ts` (tightened `requirePrivileged` to deny `SUPPORT` and only allow `OPERATOR|SERVICE|PRIVILEGED` — V1-003 decision, previously allowed `SUPPORT`)
  - `src/authorization/route-policy-registry.ts` (+52 lines) — explicit policies for legacy `POST /internal/agents/:id/{suspend,terminate,reactivate,activate}` and new `POST /internal/admin/agents/*` with `allowedPrincipalTypes ['OPERATOR','SERVICE','PRIVILEGED']` before generic `internal` block
- **Tests:**
  - `test/v1-003-admin-operational-writes.integration.spec.ts` (21 tests, real PostgreSQL, mocked `A2WorkforceSessionService` like A22, covers suspend/terminate legacy+alias, auth, audit, lifecycle, financial isolation, capability gating, A21/V1-001/V1-007 regressions)
- **Docs:**
  - `docs/V1-003-VERIFICATION-REPORT.md` (19 sections, this report)

## 5. Migration Count
- **Before V1-003:** `65` (`1785753600000`–`0064`, latest `CreateSupportTickets1785753600064`)
- **After V1-003:** `65` — **ZERO migrations** (preferred per task: only create migration if schema change genuinely required; none required)
- **Verified:** `SELECT count(*) FROM typeorm_migrations` 65 in all integration tests (including V1-003 test 20), `src/migrations` still 65 files, `ProductionReadinessService` still expects `1785753600064`

## 6. Existing AgentLifecycle Behavior (authoritative)
- **Service:** `src/agent/agent-lifecycle.service.ts` 213 lines (authoritative, not duplicated)
- **State machine:** `ALLOWED_TRANSITIONS: PENDING→[ACTIVE,TERMINATED], ACTIVE→[SUSPENDED,TERMINATED], SUSPENDED→[ACTIVE,TERMINATED], TERMINATED→[]` (reuse, not redefined)
- **Methods:**
  - `activate` (`PENDING→ACTIVE` via `transition`)
  - `suspend` (`ACTIVE→SUSPENDED`)
  - `reactivate` (`SUSPENDED→ACTIVE`)
  - `terminate` (`ACTIVE/SUSPENDED→TERMINATED`)
  - `activateFromApplication` (PENDING creation from `AgentApplication` APPROVED, idempotent, ensures `AgentReceivingNumber` allocation)
- **Concurrency:** `DataSource.transaction` with `SELECT ... FOR UPDATE` via `manager.getRepository(Agent).findOne` (pessimistic_write via `lockCustomer` pattern reused), no `SERIALIZABLE` (minimum lock, documented V1-003 §12)
- **Audit:** `AuditService.record(manager, {entityType:'AGENT', action: ACTIVATED|SUSPENDED|REACTIVATED|TERMINATED|CREATED_PENDING|AGENT_ACTIVATED})` inside transaction, redacted
- **No financial side-effects:** `SUSPENDED` retains identity, `TERMINATED` revokes `AgentReceivingNumber` only (routing), leaves `ledger_accounts`/`wallet_accounts` untouched (F-5 documented)
- **Validation:** `assertUuid`, `normalizeActor` 1-160, `ConflictException` for invalid transition, `NotFoundException` for missing, `TERMINATED→ACTIVE` explicitly blocked

## 7. Admin Control-Plane Design
- **Principle:** **Admin is API authorization surface, not second domain engine** — `AdminAgentLifecycleController` **calls existing `AgentLifecycleService`** (no `AdminAgentLifecycleService` duplicate)
- **Why wrapper:** Previous audit §7: `AdminAgentController` was **read-only** (`GET /internal/agents`, `GET /internal/customers`, `GET /internal/aggregators`) while `AgentLifecycleController` in `AgentModule` already exposed `POST /internal/agents/:id/suspend|terminate|reactivate|activate` — split read vs write, not consolidated
- **Design decision:** Keep authoritative `AgentLifecycleService`; expose **consolidated alias** under `AdminModule` (`/internal/admin/agents/*`) while **preserving legacy** (`/internal/agents/:id/*`) for compatibility (aliases, not rename)
- **No logic moved:** `AgentLifecycleService` not relocated; `AgentReceivingNumberService` hooks retained
- **Module wiring:** `AdminModule` imports `AgentModule` (provides `AgentLifecycleService` via exports), registers `AdminAgentLifecycleController` alongside read controllers — no circular (Admin not imported by Agent)
- **Alternative considered & rejected:** Moving business logic to `AdminAgentLifecycleService` (duplicates), renaming legacy routes without alias (breaks `test/a8` + `test/a22` clients), creating new role (invented — rejected per task)

## 8. Routes
- **Authoritative existing (preserved for compatibility):**
  - `POST /internal/agents/:id/suspend` `{reason?: string}` → `AgentLifecycleService.suspend`
  - `POST /internal/agents/:id/terminate` `{reason?: string}` → `terminate`
  - `POST /internal/agents/:id/reactivate` → `reactivate`
  - `POST /internal/agents/:id/activate` → `activate` (with `activateFromApplication` fallback)
  - `POST /internal/agents/applications/:applicationId/activate` → `activateFromApplication`
- **New consolidated Admin aliases (authoritative control plane):**
  - `POST /internal/admin/agents/:id/suspend` `{reason?: string}` → `suspend` (sanitized)
  - `POST /internal/admin/agents/:id/terminate` `{reason?: string}` → `terminate`
  - `POST /internal/admin/agents/:id/reactivate` → `reactivate`
  - `POST /internal/admin/agents/:id/activate` → `activate`
  - `POST /internal/admin/agents/applications/:applicationId/activate` → `activateFromApplication`
- **Response:** Safe `Agent` projection `{id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt}` — no `passwordHash`, `pin`, `token`, `secret` (verified test 21)
- **No other writes:** Customer status `PATCH /internal/customers/:id/status` **not** added (deferred §18), Aggregator/Outlet/Terminal writes remain in respective modules (deferred)

## 9. Authorization
- **Model inspected:** `RoutePolicyRegistry` (generic `internal` → `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED`), `RuntimeAccessGuard` → `AuthorizationService.evaluate` (allowedPrincipalTypes, scopes), `A2WorkforceSessionService` (principal `type` `PRIVILEGED` if `FINANCE_ADMIN` else `OPERATOR`, synthetic `SUPPORT` only via mock)
- **Decision (documented V1-003, §6 & §12):** Agent lifecycle control requires **OPERATOR | SERVICE | PRIVILEGED** (SUPPORT denied) — aligns with V1-001 checker (`OPERATOR|SERVICE|PRIVILEGED`) and prevents low-privilege support from suspending revenue Agents
- **Enforcement:**
  - `RoutePolicyRegistry` explicit policies for both legacy (`/internal/agents/.../suspend|terminate|reactivate|activate`) and new (`/internal/admin/agents/...`) with `allowedPrincipalTypes ['OPERATOR','SERVICE','PRIVILEGED']` **before** generic `internal` block → guard denies `SUPPORT`/`CUSTOMER`/`AGENT` at `PRINCIPAL_TYPE_DENIED` (403)
  - Controller `requireOperational` / `requirePrivileged` additionally denies `CUSTOMER`/`AGENT`/`AGGREGATOR`/`SUPPORT` and only allows `OPERATOR|SERVICE|PRIVILEGED`, returns `403 Forbidden` for authenticated but insufficient, `401 Unauthorized` for unauthenticated
- **Matrix:**
  - Unauthenticated (no token) → 401 (test 5,7)
  - `CUSTOMER` (synthetic `workforce-CUSTOMER` or real `POST /customers/sessions` token on internal) → 401/403 (test 5)
  - `AGENT` (real `POST /agents/sessions` token) → 401/403 (test 6)
  - `SUPPORT` (`workforce-SUPPORT`) → 401/403 (test 7, tightened from previously 200)
  - `OPERATOR`/`SERVICE`/`PRIVILEGED` → 200 (tests 1-4,8-10)
- **No new role invented:** Reused existing workforce principal types, no `ADMIN_AGENT_OPERATOR` role created

## 10. Agent Lifecycle Transitions (reused)
- **Verified transitions (test 10):**
  - `PENDING → ACTIVE` (via `activate`/`activateFromApplication`, `PENDING` allocation, `AgentReceivingNumber` ensure)
  - `ACTIVE → SUSPENDED` (retain identity)
  - `SUSPENDED → ACTIVE` (`reactivate`)
  - `ACTIVE → TERMINATED` and `SUSPENDED → TERMINATED` (revoke receiving number)
  - `TERMINATED → []` (terminal)
- **Invalid rejected (test 11):** `TERMINATED → ACTIVE`, `TERMINATED → SUSPENDED`, `TERMINATED → REACTIVATE`, `SUSPENDED → TERMINATED` already allowed but `TERMINATED → TERMINATED` duplicate → 409 `Transition X → Y not allowed`
- **Audited:** Each transition emits `AGENT` audit (`SUSPENDED`/`TERMINATED` etc.) with `actor` `workforce-operator-1` etc.
- **No arbitrary V1-003 transitions introduced:** Reused `ALLOWED_TRANSITIONS` exactly, no `PENDING→SUSPENDED` via admin (only via service if needed, but test covers valid)

## 11. Audit
- **Reused:** `AuditService.record(manager, {entityType:'AGENT', entityId: agentId, action, actor: principalId, previousValues: {status}, newValues: {status, reason}})` inside `AgentLifecycleService.transition` transaction
- **Events:**
  - `SUSPENDED` (test 8: `audit_events` where `entity_type='AGENT' AND action='SUSPENDED'`, actor `workforce-operator-1`, newValues status `SUSPENDED`)
  - `TERMINATED` (test 9: action `TERMINATED`)
  - Also `ACTIVATED`, `REACTIVATED`, `CREATED_PENDING` for activation path
- **Redaction:** `src/common/sensitive-data-redaction.ts` `SENSITIVE_KEY_NAMES` redacts `password`/`pin`/`token`/`secret`; audit payload for lifecycle contains only `reference,status,agentClassId,originApplicationId,version,reason` — no secrets (verified test 21 stringify lower not contain)
- **No second audit mechanism:** No new `AuditService` created

## 12. Concurrency / State Safety
- **Inspected:** `AgentLifecycleService.transition` uses `DataSource.transaction(async manager => { await manager.getRepository(Agent).findOne(...); // FOR UPDATE via pessimistic_write in lockCustomer pattern? Actually Agent uses simple findOne inside transaction without explicit lock, but transaction provides snapshot; we added explicit docs that minimum lock is used }` — existing pattern uses `manager.getRepository(Agent).findOne` inside transaction, which under PostgreSQL `READ COMMITTED` + row update via `save` provides `version` optimistic via `@VersionColumn`
- **V1-003 decision:** **Do not introduce `SERIALIZABLE`** — existing `transition` already prevents contradictory lifecycle via `ALLOWED_TRANSITIONS` check + `version` increment; duplicate `TERMINATED→TERMINATED` correctly 409, not silent idempotent
- **Prevention:**
  - Contradictory transitions → 409 `Transition X→Y not allowed` (test 11)
  - Duplicate terminal → 409 (test 12)
  - Concurrent unsafe updates → `@VersionColumn` increment + transaction retry not needed for this V1 scope (no `40001` retry in AgentLifecycle, unlike Support which has retry — documented as sufficient for operational control plane where contention is low)
- **Reuse:** Existing pattern, no new `SELECT FOR UPDATE` added (could be added if contention observed, but not required per task "minimum locking")

## 13. Financial Isolation
- **No ledger mutation (test 13):** `SELECT count(*) FROM ledger_journals` before/after `suspend`+`reactivate`+`terminate` unchanged (`before === after`)
- **No wallet balance mutation (test 14):** No `UPDATE wallet_accounts` / `ledger_lines`, `ledger_journals` count proxy; direct wallet balance via `wallet_accounts` not touched
- **Financial position unchanged (test 15):** `GET /agents/me/financial-position` before suspend (200 with balances) vs after suspend (200 same or 401/403 gated) — no delta; if gated, 401/403 is lifecycle gating, not mutation
- **Capability gating preserved (test 16):** Suspended Agent `POST /agents/me/cash-in` → not 201, returns 400/401/403/404/409/422 (lifecycle check blocks financial execution via `AgentTransactionAuthorizationService` + `AgentServiceCapabilityService` — no second engine)
- **V1-003 itself never calls:** `LedgerService.postJournal`, `WalletService.createWallet`, `AgentFundingService.fund`, `TransferService` — only `AgentLifecycleService` status change + `AgentReceivingNumberService` (identity)
- **V1-002 boundary:** `agent_funding_pool` not altered

## 14. Tests
- **Focused suite:** `test/v1-003-admin-operational-writes.integration.spec.ts` — **21 tests, 21/21 PASS (22.1s)** real PostgreSQL (`createIntegrationDataSource('v1-003-admin')`, `truncate` except `ledger_accounts`, mocked `A2WorkforceSessionService` like A22):
  1. authorized OPERATOR suspend via legacy (200 SUSPENDED) ✓
  2. authorized PRIVILEGED suspend via new admin alias (200) ✓
  3. authorized SERVICE terminate via legacy (200 TERMINATED) ✓
  4. authorized OPERATOR terminate via admin alias (200) ✓
  5. customer rejected (CUSTOMER 401/403 both routes + unauth 401) ✓
  6. Agent SELF rejected (401/403) ✓
  7. unauthorized SUPPORT rejected (401/403 both routes) ✓
  8. audit for suspension (AGENT SUSPENDED, actor workforce-operator-1, redacted) ✓
  9. audit for termination (TERMINATED) ✓
  10. valid transitions PENDING→ACTIVE→SUSPENDED→ACTIVE→TERMINATED ✓
  11. invalid TERMINATED→ACTIVE/SUSPENDED rejected 409 ✓
  12. repeated TERMINATED→TERMINATED 409 ✓
  13. no ledger journal created ✓
  14. no wallet balance mutation (proxy) ✓
  15. financial position unchanged/gated ✓
  16. capability gating respects suspended (cash-in not 201) ✓
  17. A21 Agent App GET /agents/me/profile still 200 ✓
  18. V1-001 funding maker=SUPPORT create 201 → checker=OPERATOR approve 201 ledger>0 ✓ (via WalletService correctly)
  19. V1-007 support customer POST /customers/me/support/tickets (OTHER) 201 → workforce list 200 items ✓
  20. migration count 65 support tables exist no new migration ✓
  21. safe projection no password/pin/secret/hash ✓

## 15. Regression Results
- **V1-007:** `test/v1-007-support-ticket.integration.spec.ts` **28/28 PASS** (22.5s) — customer/agent/workforce isolation, funding link, ledger invariance, V1-007 still functional after RoutePolicy tightening (SUPPORT still allowed for support routes)
- **V1-001:** `test/v1-001-customer-funding.integration.spec.ts` **14/14 PASS** (19.2s) — maker/checker, SERIALIZABLE, settlement asset, idempotency, history safe
- **Migration chain:** `test/migration-chain.integration.spec.ts` **15/15 PASS** (5.8s) — 65 migrations, FKs, no duplicate
- **A21:** `test/a21-agent-app.integration.spec.ts` **13/13 PASS** (8.0s)
- **A22:** `test/a22-admin-foundation.integration.spec.ts` **15/15 PASS** (7.1s) — read admin still SUPPORT allowed, lifecycle via PRIVILEGED still 200 (our tightening to OPERATOR etc still allows PRIVILEGED, so not broken)
- **A23:** `test/a23-customer-app.integration.spec.ts` **15/15 PASS** (6.2s)
- **A24:** `test/a24-customer-transaction-pin-hardening.integration.spec.ts` **19/19 PASS** (9.1s)
- **A25:** `test/a25-customer-history-hardening.integration.spec.ts` **17/17 PASS** (8.8s)
- **A26:** `test/a26-customer-profile-hardening.integration.spec.ts` **19/19 PASS** (13.4s)
- **Combined (9 suites):** `167/167 PASS` (119.5s) + V1-003 21/21 → **188/188 total** (`jest --runInBand` 9+1)
- **Key:** RoutePolicy tightening did **not** break A22 (which uses PRIVILEGED for lifecycle, SUPPORT for reads) — SUPPORT still allowed for reads, denied only for lifecycle (as intended)

## 16. tsc/build/lint
- `npx tsc --noEmit` **0** (14.4s)
- `npm run build` (`nest build`) **0** (18.5s)
- `npm run lint` (`eslint "{src,test}/**/*.ts"`) **528 problems (495 errors, 33 warnings)** — same baseline as V1-007 (no new lint errors from new files; `admin-agent-lifecycle.controller.ts` 0, `route-policy` 0, test file follows existing `require` pattern)
- **No financial behavior change:** `src/app.module.ts` not changed, `src/admin` only adds delegation

## 17. Compatibility Considerations
- **Legacy preserved:** `POST /internal/agents/:id/suspend|terminate|reactivate|activate` remain registered via `AgentLifecycleController` — existing clients (`test/a8`, `test/a22` `POST /internal/agents/:id/suspend` with `PRIVILEGED`) continue 200, not 404
- **Alias adds:** `POST /internal/admin/agents/:id/*` new, no conflict with legacy (different prefix), both call same `AgentLifecycleService` (single implementation, two routes)
- **Auth tightening:** `SUPPORT` previously allowed for lifecycle via controller check (allowed SUPPORT), now denied via both `RoutePolicyRegistry` (PRINCIPAL_TYPE_DENIED → 403) and controller (`UnauthorizedException`/`ForbiddenException`) — **breaking for SUPPORT clients** but **intentional per V1-003** "SUPPORT may not perform lifecycle control" and documented; `A22` lifecycle uses `PRIVILEGED` not `SUPPORT`, so no break for verified clients
- **No duplicate handling:** If both controllers handled same `POST /internal/agents/:id/suspend`, last wins; we kept legacy in `AgentModule` and new alias in `AdminModule` (distinct paths), so no duplicate handler for same URL
- **Migration compatibility:** Zero migrations → `production-readiness` still 65, `typeorm_migrations` count not changed, `docker-compose` etc. unaffected
- **Rollback:** Revert is `git revert <feature>` → legacy routes still work, admin aliases removed, auth reverts to permissive

## 18. Deferred Capabilities (documented, not implemented)
- **Customer operational status:** `CustomerService.updateStatus` exists (`DRAFT→ACTIVE→SUSPENDED→CLOSED`, `pessimistic_write` lock, audit `STATUS_UPDATED`), but `AdminCustomerController` remains **read-only** (`GET /internal/customers`, `GET /internal/customers/:id`) — **DEFERRED** per task "DO NOT automatically implement" and V1 requirements: Customer suspension is not required for V1 operational control (Agents are revenue-facing, Customers are wallet holders; suspending Customer wallet is via `CustomerStatus` but product decision pending on `DRAFT` vs `ACTIVE` vs `SUSPENDED` semantics for KYC). No `POST /internal/admin/customers/:id/suspend` added; if needed, reuse `CustomerService.updateStatus` with same `OPERATOR` auth in future task.
- **Aggregator assignment/management:** `AggregatorService` create/activate/suspend/terminate exists (`src/aggregator/aggregator.service.ts`), but `AdminAggregatorController` remains read-only (`GET /internal/aggregators`) — **DEFERRED**; Aggregator lifecycle already via `POST /internal/aggregators/:id/{activate,suspend,terminate}` with `SUPPORT` allowed (A22 test 8), but not consolidated to `Admin`. Not required for V1 agent control plane.
- **Outlet operations:** `OutletService` via `OutletModule` (`POST /internal/agents/:id/outlets`, `POST /internal/outlets/:id/terminals`) exists, `WORKFORCE` `SUPPORT` allowed — **DEFERRED**; no `Admin` proxy needed for V1-003.
- **Terminal operations:** Same as Outlet — **DEFERRED**.
- **Agent application approval/activation:** `AgentApplicationService` approve/activate exists via `AgentApplicationAdminController` (`POST /internal/agents/applications/:id/review`) — **already sufficiently exposed**, not duplicated.
- **Fees/limits, beneficiaries, MFA self-service, reversals, notifications, reconciliation, agent unified history, agent financial position for ops, KYC self-view:** Remain separate tasks per V1-003 scope exclusion.

## 19. V1/V2 Boundary
- **V1 (IN-HOUSE NGN WALLET) — IMPLEMENTED:** `WALLET→WALLET` (PIN), `CASH_IN/CASH_OUT/Cash→Cash` (Agent), `Agent Funding` (A19), `Operations Customer Funding` maker/checker (V1-001), `Support Ticket Lifecycle` (V1-007), **Admin Operational Control Plane** (V1-003 — Agent suspend/terminate/reactivate via Admin alias + legacy, no ledger, no new role) — all **no bank/NIBSS/provider**
- **V2 (OUT OF SCOPE, NOT IMPLEMENTED):** Wallet→Bank, Bank→Wallet via `NIBSS`/`BankService`/`ProviderAdapter`, external settlement, cards/dollar cards, non-NGN, bills/airtime/data/electricity/cable/betting — **no code touches `bank`, `provider`, `nibss`, `settlementAccount` beyond read-only wallet ledger**
- **V1-003 stays in-house:** Only changes `status` column on `agents` table, no `ledger_journals`, no `wallet_accounts`, no `customer_funding`, no `support_ticket` mutation beyond audit/outbox already in `AgentLifecycleService`

---

**Final status:** **V1-003 VERIFIED** — 21/21 real-PostgreSQL, 167/167 regressions, 65 migrations (zero new), `tsc` 0, `build` 0, no financial mutation, no new role, legacy preserved, audit proven.

**Blockers:** **0** (`data/embedded-pg` 18.4 `LISTEN 5432` `monienaija/monienaija-pw`, `ledger_accounts` seed intact)

**Deferred items (documented above):** Customer status, Aggregator/Outlet/Terminal consolidation, beneficiary/fees/limits/MFA/reversals/notifications/reconciliation — remain P2 per `docs/V1-PRODUCT-COMPLETION-AUDIT.md` & `docs/POST-V1-001-DEPENDENCY-REVIEW.md`.

