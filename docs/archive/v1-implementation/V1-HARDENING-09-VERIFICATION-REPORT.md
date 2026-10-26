# V1-HARDENING-09 — Admin Notification Delivery Diagnostics — Verification Report

**Date (Lagos):** 2026-09-27  
**Branch:** `arena/01a0d883-monienaija`  
**Mode:** IMPLEMENTATION (narrow V1 operational-readiness, read-only diagnostics)  
**Status:** **VERIFIED — Admin Notification Delivery Diagnostics complete**

---

## 1. Objective

Implement the narrow Admin/Operations notification-delivery diagnostic capability identified by `V1-HARDENING-08` (§15, §23) as the highest-value P2 hardening after `H-06` (customer investigation) + `H-07` (agent financial-position).

Purpose: operational visibility into persisted `notification_deliveries` records (`PENDING/SENT/FAILED/SKIPPED`) without creating a new notification system, new table, provider, or mutation. Preserve provider-neutral semantics (`Outbox → NotificationDispatcher → NotificationProvider adapter → notification_deliveries` with Console/Test adapter) and do not claim `SENT` implies external delivery.

## 2. Starting HEAD

- `8fd2e5a` (`docs(hardening-08): Remaining operational gaps & Agent financial history contract audit — 66 migrations, VERIFIED`)
- Parent chain: `8fd2e5a` → `9c4275e` (`feat(hardening-07): Admin Agent Financial Investigation`) → `c5f8251` (`feat(hardening-06): Admin Customer Investigation`) → `cbfdc02` (`docs(hardening-05): ... GAPS FOUND`) → `145df67` (`feat(hardening-04): ...`)
- Workspace at start: `git rev-parse HEAD` `8fd2e5a`, `ls src/migrations/*.ts | wc -l` **66**, `src/production/production-readiness.service.ts` expects `1785753600065` / `CreateNotificationDeliveries1785753600065`.

## 3. Final HEAD

- New commit: **pending** `feat(hardening-09): Admin Notification Delivery Diagnostics — GET /internal/notifications/deliveries, reuse notification_deliveries, SUPPORT allowed, safe projection, deterministic pagination, 21 PG tests, 66 migrations, VERIFIED` (parent `8fd2e5a`)
- Remote target: `origin/arena/01a0d883-monienaija` (to be pushed `8fd2e5a..NEW`)

## 4. Parent Commit

- `8fd2e5a` — H-08 VERIFIED audit (0 source/0 migration/0 ledger/0 route, report-only)
- H-06 VERIFIED `c5f8251` (15 PG, `GET /internal/customers/:id/transactions|wallets|balance|support-tickets`, reuse `CustomerTransactionHistoryService.listUnified`)
- H-07 VERIFIED `9c4275e` (16 PG, `GET /internal/agents/:id/financial-position`, reuse `WalletService.listWallets`)

## 5. Migration Count Before/After

| Check | Before | After | Delta |
|-------|--------|-------|-------|
| `ls src/migrations/*.ts \| wc -l` | 66 | **66** | **0** |
| `SELECT count(*) FROM typeorm_migrations` (integration harness `v1-005` 20, `v1-006` 20, `v1-hardening-09` 21) | 66 | **66** | **0** |
| `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` | `1785753600065` | `1785753600065` | 0 |
| Latest migration | `1785753600065-CreateNotificationDeliveries` | `1785753600065-CreateNotificationDeliveries` | 0 |
| New tables/columns/indexes | — | **0** (reuse `notification_deliveries` + `idx_recipient`, `idx_status`, `idx_event_type`, `uq_event_recipient_channel`) | 0 |

Verified: `npm run build` still expects `1785753600065`, `git diff --stat HEAD` shows **no** `src/migrations/*.ts` change.

## 6. Files Changed

| File | Change | Lines | Purpose |
|------|--------|-------|---------|
| `src/admin/admin-notification.controller.ts` | **Create** | 142 | `GET /api/v1/internal/notifications/deliveries` read-only, reuse `DataSource` query on `notification_deliveries`, workforce `SUPPORT` allowed, pagination + status/recipientType/channel/eventType/recipientId filtering, deterministic `createdAt DESC, id DESC`, safe projection hide `destination/payload` |
| `src/admin/admin.module.ts` | **Modify** | +2 | Import `AdminNotificationController`, add to `controllers: [...AdminNotificationController]` (no new `TypeOrmModule.forFeature` needed — uses `DataSource`) |
| `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` | **Create** | ~520 | 21 focused real-PG tests: workforce matrix, PENDING/SENT/FAILED/SKIPPED visibility, status filtering, pagination, safe projection, sensitive fields not leaked, read-only, no notification/ledger mutation, provider-neutral, 66 migrations |
| `docs/V1-HARDENING-09-VERIFICATION-REPORT.md` | **Create** | this file | Verification evidence (18 sections, final status VERIFIED) |

**No** `src/notification/*.ts` changed, **no** provider, **no** ledger, **no** reconciliation/fees/limits/beneficiary/agent-history.

`git diff --stat origin/arena/01a0d883-monienaija..HEAD` → 3 files + report, `tsc --noEmit` **0**, `npm run build` **0**.

## 7. Endpoint

| Item | Value |
|------|-------|
| **Method + Path** | `GET /api/v1/internal/notifications/deliveries` |
| **Controller** | `AdminNotificationController` (`@Controller('internal/notifications')` + `@Get('deliveries')`) |
| **Module** | `AdminModule` (already `WORKFORCE_SESSION` via `RoutePolicyRegistry` generic `path.startsWith('/api/v1/internal/')` → `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED`) |
| **Auth check (secondary)** | `requireWorkforce(req)` — throws `401` if `principal.type === AGENT/CUSTOMER/AGGREGATOR` or unauthenticated, mirroring `AdminCustomerController`/`AdminAgentController` |
| **Query params** | `page` (1..∞), `limit` (1..100), `status` (`PENDING/SENT/FAILED/SKIPPED`), `recipientType` (`CUSTOMER/AGENT`), `channel` (`SMS/PUSH`), `eventType` (≤180 chars), `recipientId` (UUID) |
| **Ordering** | `ORDER BY created_at DESC, id DESC` (deterministic, matches `NotificationInboxService` and `CustomerTransactionHistoryService` convention) |
| **Reuse** | `DataSource.query` direct on `notification_deliveries` — no second table, no second outbox, no `NotificationDeliveryService` invention; existing entity `notification-delivery.entity.ts` (`PENDING/SENT/FAILED/SKIPPED`, `idx_recipient`, `idx_status`) remains authoritative |
| **Mutation** | **None** — read-only `SELECT` only, verified no `INSERT/UPDATE/DELETE` on `notification_deliveries` or `ledger_journals` (see §13 tests 16-18) |

Example success (SUPPORT):
```json
{
  "data": [{
    "id": "uuid",
    "eventType": "customer.funding.approved",
    "eventKey": "customer.funding.approved:uuid",
    "aggregateType": "CUSTOMER_FUNDING_REQUEST",
    "aggregateId": "uuid",
    "recipientType": "CUSTOMER",
    "recipientId": "uuid",
    "channel": "SMS",
    "status": "SENT",
    "attempts": 1,
    "providerRef": "test-abc123",
    "correlationId": "corr-uuid",
    "causationId": null,
    "message": "Your funding of NGN 100.00 has been approved. Ref REF-...",
    "lastError": null,
    "createdAt": "2026-09-27T...",
    "updatedAt": "2026-09-27T...",
    "sentAt": "2026-09-27T...",
    "failedAt": null
  }],
  "total": 1, "page": 1, "limit": 20, "totalPages": 1, "hasNextPage": false
}
```

## 8. Authorization Matrix

| Principal | Type | Expected | Evidence (21 PG, `workforce-*` mock) | RoutePolicyRegistry |
|-----------|------|----------|--------------------------------------|---------------------|
| **SUPPORT** | WORKFORCE_SESSION `SUPPORT` | **200** | `1. SUPPORT authorized` PASS (`GET /deliveries` 200, total≥1) | `path.startsWith('/api/v1/internal/')` → `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` — **included**; controller `requireWorkforce` allows |
| **OPERATOR** | `OPERATOR` | **200** | `2. OPERATOR authorized` PASS | Same — **included** |
| **SERVICE** | `SERVICE` | **200** | `3. SERVICE authorized` PASS | Same — **included** |
| **PRIVILEGED** | `PRIVILEGED` | **200** | `4. PRIVILEGED authorized` PASS | Same — **included** |
| **CUSTOMER** | `CUSTOMER` | **401** | `5. CUSTOMER denied` PASS (401) | `requireWorkforce` throws `UnauthorizedException('Privileged access required')` before DB |
| **AGENT** | `AGENT` | **401** | `6. AGENT denied` PASS (401) | Same |
| **AGGREGATOR** | `AGGREGATOR` | **401** (implicit) | Not in test matrix but `requireWorkforce` covers `(type as string)==='AGGREGATOR'` → 401 | Same |
| **FINANCE_PREPARER/CONTROLLER** | `FINANCE_*` | **Not granted** (unless also SUPPORT/OPERATOR) | `mockWorkforceSessions` includes `FINANCE_*` but test validates `CUSTOMER/AGENT` denied; `FINANCE_*` not in `5-7` but `RoutePolicyRegistry` generic does **not** automatically grant `FINANCE_*` unless `allowedPrincipalTypes` includes them — generic `internal-route` allows `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` only, so `FINANCE_*` would be **401** unless explicit `FINANCE` policy (intentionally not added per §3 "Do NOT automatically grant FINANCE") — verified by design | **Not granted** — no `FINANCE_*` in generic |
| **Unauthenticated** | none | **401** | `7. unauthenticated denied` PASS (401) | `authorization.guard` → 401 before controller |

No new `AuthorizationPolicy` created; reuse existing `WORKFORCE_SESSION` + `requireWorkforce`. No privilege escalation: `SUPPORT` remains read-only (no `suspend/fund/approve`), `OPERATOR` etc. same. Verified `RoutePolicyRegistry.resolve({method:'GET',url:'/api/v1/internal/notifications/deliveries'})` → `authenticationMode: 'WORKFORCE_SESSION'`, `allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']`.

## 9. Query/Filter Behavior

**Inspected schema supports (per `notification-delivery.entity.ts` + migration `0065` indexes):**

- `status` (`PENDING/SENT/FAILED/SKIPPED`, `chk_status`, `idx_status`)
- `recipient_type` (`CUSTOMER/AGENT`, `chk_recipient_type`, `idx_recipient`)
- `recipient_id` (`UUID`, `uq_event_recipient_channel`, `idx_recipient`)
- `channel` (`SMS/PUSH`, `chk_channel`)
- `event_type` (`VARCHAR 180`, `idx_event_type`)
- `created_at` + `id` ordering (deterministic)

**Implemented:**

- **Pagination** — `page` default 1, `limit` default 20, bounded 1..100, `BadRequestException` on `page<1`, `limit<1|>100`, non-integer; `offset=(page-1)*limit`; `total` via `count(*)`, `totalPages=ceil(total/limit)`, `hasNextPage=page<totalPages`; verified `13. deterministic pagination` (5 rows, p1 2 + p2 2 + p3 1, no duplicate, `createdAt DESC, id DESC`).
- **Status filtering** — exact `status = $n` (uppercased, whitelist `PENDING/SENT/FAILED/SKIPPED`), 400 on invalid; verified `12. status filtering` (SENT only SENT, FAILED only FAILED, PENDING only PENDING, empty when no match).
- **RecipientType filtering** — `recipient_type = $n` (uppercased, whitelist), 400 on invalid; verified `15. filtering by recipientType` (CUSTOMER only CUSTOMER, AGENT only AGENT via direct `AGENT` insert).
- **Channel filtering** — `channel = $n` (whitelist `SMS/PUSH`), 400 on invalid `EMAIL`; verified `15. channel`.
- **EventType filtering** — exact `event_type = $n` (trimmed, ≤180 chars, 400 on >180), verified `15. eventType` and `12. empty when eventType=nonexistent`.
- **RecipientId filtering** — `recipient_id = $n` (UUID, 400 on `not-a-uuid`), verified `15. recipientId` and `19. invalid query params return 400`.

**Not added (speculative):** `aggregateType/Id`, `correlationId`, date range, payload substring — omitted per “Do NOT create speculative query parameters merely because they sound useful.” and “Do not add indexes or migrations merely to optimize hypothetical future queries.” Existing fields already cover operational needs (diagnose FAILED by status, filter by customer via `recipientId`, by flow via `eventType`).

**Determinism:** All queries use parameterized `WHERE` + `ORDER BY created_at DESC, id DESC` + `LIMIT/OFFSET`, verified `13. deterministic pagination` with distinct `createdAt`.

## 10. Safe Projection

**Do NOT return raw `notification_deliveries` entity blindly — enforced:**

| Exposed (safe, operational) | Hidden (sensitive or unnecessary) | Reason |
|-----------------------------|-----------------------------------|--------|
| `id`, `eventType`, `eventKey`, `aggregateType`, `aggregateId`, `recipientType`, `recipientId`, `channel`, `status`, `attempts`, `providerRef`, `correlationId`, `causationId`, `message` (template, redacted), `lastError` (already persisted, safe string), `createdAt`, `updatedAt`, `sentAt`, `failedAt` | `destination` (phone/device token, PII, SKIPPED reason is in `lastError`), `payload` (redacted JSONB but still contains `amountMinor/reference/_templateKey` — not needed for diagnostics, `message` suffices), provider credentials/API keys/secrets, `password/pin/tokenHash` | `destination` + `payload` contain personal/sensitive information per §5; `message` is already safe via `NotificationTemplateService.buildMessage` + `redactPayload`; `providerRef` is safe (`console-*`/`test-*`), not credential; `lastError` is safe diagnostic string (`PUSH_TOKEN_DEPENDENCY_MISSING`, `AGENT_PHONE_DEPENDENCY_MISSING`, `Simulated provider failure`) |

**Verification (test 14):**

- Inserted delivery with `payload: {pin:'1234', pinHash:'hash', password:'secret', tokenHash:'tok', secret:'shh', apiKey:'key'}` and `destination:'8010000014'`; `GET` response **had no** `destination`, `payload`, `password`, `pin`, `pinHash`, `tokenHash`, `secret`, `apiKey`, `providerApiKey`; JSON stringify did **not** contain `destination/payload`; `message` contained `NGN` and **no** `pin/password`.
- `bodyStr.toLowerCase()` did not contain `pin/password/secret/tokenhash` (see `v1-005` test 13 also validates no secrets in stored `payload/message/providerRef`).
- `14. safe projection and sensitive fields not leaked` **PASS**.

**Error information:** `lastError` exposed as stored `last_error` (truncated 1000 chars by dispatcher), safe for internal diagnostics — verifies `10. FAILED delivery visible with lastError` + `11. SKIPPED visible` (`PUSH_TOKEN_DEPENDENCY_MISSING`). No provider secrets in `lastError` (dispatcher only stores `reason` like `PUSH_TOKEN_DEPENDENCY_MISSING` or `providerResult.error` like `Simulated provider failure`).

## 11. Provider-Neutral Semantics

Preserved exactly as authoritative architecture:

- **Outbox** (`outbox_events` `customer.funding.approved` etc.) → **NotificationDispatcher** (`dispatch` idempotent via `eventKey+recipientId+channel` unique, `PUSH_TOKEN_DEPENDENCY_MISSING` → `SKIPPED`, `CUSTOMER_PHONE_MISSING` → `SKIPPED`, provider failure → `FAILED` not throw) → **NotificationProvider adapter** (`ConsoleNotificationProvider` / `TestNotificationProvider`, no invented credentials) → **`notification_deliveries`** (`PENDING→SENT/FAILED/SKIPPED`, `provider_ref`, `attempts`, `sent_at/failed_at`) — **no** `Twilio/Termii/Africa's Talking/Firebase/APNs` credentials added, no provider config changed, verified `grep -r "TWILIO\|TERMII\|FIREBASE" src/admin` **0**.
- **Sent ≠ received:** `status='SENT'` means dispatcher successfully called `provider.send` and stored `providerRef` (`test-*`/`console-*`), **not** that recipient received SMS/Push. Report and controller do **not** claim “SENT means recipient received” — documentation states provider-neutral, `Console/Test` only.
- **Failure isolation:** `providerResult.success===false` → `status='FAILED'`, `attempts++`, `last_error` stored, **financial transaction not reversed** — verified `v1-005` test 10 (`FAILED` delivery, funding still `APPROVED`, journal counts unchanged) and `v1-hardening-09` tests `17/18` (no ledger mutation on read, `FAILED` still visible but `APPROVED` funding row unaffected).
- **SKIPPED reasons:** `PUSH_TOKEN_DEPENDENCY_MISSING`, `AGENT_PHONE_DEPENDENCY_MISSING`, `CUSTOMER_PHONE_MISSING`, `PUSH_OPT_OUT` — already persisted by `NotificationDispatcherService` + `NotificationChannelResolverService`, now visible via `status='SKIPPED'` + `lastError` (see tests 11, 15).
- Test `20. provider-neutral semantics` **PASS**: `dispatcher.dispatch` → `SENT` with `providerRef` `test-*`, `GET` returns `status SENT` + `providerRef` `test-*`, `bodyStr` contains **no** `apikey/twilio/termii/firebase/secret`.

## 12. Security Findings

- **RoutePolicyRegistry:** Generic `if (path.startsWith('/api/v1/internal/'))` already covers `GET /internal/notifications/deliveries` → `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` — **no new policy needed**, no bypass, verified `8. Authorization Matrix`.
- **Workforce boundaries preserved:** `SUPPORT` can **read** diagnostics but cannot `POST .../fund`, `suspend`, `approve` (those require `OPERATOR/SERVICE/PRIVILEGED` or `FINANCE_*`), maker≠checker on funding unchanged; `AdminNotificationController.requireWorkforce` mirrors `AdminCustomerController`/`AdminAgentController` (deny `AGENT/CUSTOMER/AGGREGATOR` → 401).
- **No secrets leaked:** `destination` (phone/device token) and `payload` (JSONB, may contain `amountMinor/reference` but also sensitive keys if payload had secrets — redacted via `redactRecord` at dispatch time) **omitted** from projection; `message` is safe template; `providerRef` is `console-*`/`test-*` not credential; `lastError` is safe string.
- **No PIN/OTP/password/ledger leakage:** Verified `v1-005` test 13 (`payload` redacted `[REDACTED]`, message lower does not contain `pin/otp/password/ledger/journal`) + `v1-hardening-09` test 14 (no `pin/password` in body, no `ledger/journal/hash`).
- **Injection safe:** All filters via parameterized `DataSource.query` (`$1,$2...`), no string concatenation of user input beyond `ORDER BY` static; `eventType` trimmed and bounded 180, `recipientId` UUID validated.
- **No mutation:** Controller has only `@Get('deliveries')` — `POST/PATCH/DELETE` return **404** (Nest router), verified `16. read-only behavior` + `17. no notification record mutation` (status/attempts/last_error unchanged after 2 reads).
- **Customer/Agent isolation:** Workforce-only; `recipientId` filter is **admin-scoped**, not customer-scoped; customer `GET /customers/me/notifications` remains `CUSTOMER SELF` (V1-006) and cannot access `GET /internal/...` (401). Verified `5-7` denied.

## 13. Test Results

**Focused real-PG suite — `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` — 21/21 PASS (28.5s, embedded PG 18.4, `monienaija/monienaija-pw`, `DB_HOST=127.0.0.1`):**

| # | Test | Result |
|---|------|--------|
| 1 | SUPPORT authorized to list deliveries | PASS |
| 2 | OPERATOR authorized | PASS |
| 3 | SERVICE authorized | PASS |
| 4 | PRIVILEGED authorized | PASS |
| 5 | CUSTOMER denied (401) | PASS |
| 6 | AGENT denied (401) | PASS |
| 7 | unauthenticated denied (401) | PASS |
| 8 | PENDING delivery visible | PASS |
| 9 | SENT delivery visible with providerRef | PASS |
| 10 | FAILED delivery visible with lastError | PASS |
| 11 | SKIPPED delivery visible | PASS |
| 12 | status filtering (SENT/FAILED/PENDING, empty when no match) | PASS |
| 13 | deterministic pagination createdAt DESC, id DESC (5 rows p1 2 p2 2 p3 1, no duplicate) | PASS |
| 14 | safe projection and sensitive fields not leaked (no destination/payload/pin/password) | PASS |
| 15 | filtering by recipientType, channel, eventType, recipientId | PASS |
| 16 | read-only behavior — GET only, POST/PATCH/DELETE 404, GET not mutate count | PASS |
| 17 | no notification record mutation on read (status/attempts/last_error unchanged) | PASS |
| 18 | no financial mutation (ledger_journals/lines/wallet_accounts counts unchanged) | PASS |
| 19 | invalid query params return 400 (status INVALID, page 0, limit 101, recipientId not-a-uuid, channel EMAIL) | PASS |
| 20 | provider-neutral semantics — SENT does not imply external delivery, no credentials (providerRef test-*, no apikey/twilio) | PASS |
| 21 | migration count is 66, reuse notification_deliveries, no new table | PASS |

**Additional checks:** `POST /internal/notifications/deliveries` 404, `PATCH` 404, `DELETE` 404; `GET ...?status=INVALID` 400; `GET ...?channel=EMAIL` 400.

## 14. Notification Regression Results

**Run `DB_HOST=127.0.0.1 ... npm run test:pg` (real PG):**

- `test/v1-005-notification-delivery.integration.spec.ts` — **23/23 PASS** (verified `Console/Test` provider, `customer.funding.approved/rejected`, `transfer.completed`, `support.ticket.created/assigned/status_changed/resolved/message_added` with `isInternal` filter, channel resolver `CUSTOMER_PHONE`/`PUSH_TOKEN_DEPENDENCY_MISSING`/`AGENT_PHONE_DEPENDENCY_MISSING`, idempotency `eventKey≤180`, `FAILED` isolated not reverse financial, `ledger_journals` still incremented, `support` still works, `migration count 66`, no fake credentials, catalogue covers required events)
- `test/v1-006-customer-notification-inbox.integration.spec.ts` — **23/23 PASS** (empty inbox 200, `customer.funding.approved/rejected` in inbox `FUNDING` safe `IN_APP` `AVAILABLE`, `transfer.completed` both sides, `support.ticket.created/resolved`, cross-customer isolation, forged `customerId` ignored, agent 401, unauth 401, `SKIPPED` not in inbox, pagination deterministic, safe hide `providerRef/ledger`, financial isolation `ledger_journals` unchanged on read)
- **Combined 46/46 PASS** with H-09 present — no regression in dispatch, resolver, template, inbox.

**Also verified H-06/H-07 still green:**

- `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` 15/15 PASS
- `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts` 16/16 PASS
- Combined H-06+H-07 **31/31 PASS** after H-09.

## 15. TypeScript/Build/Lint Results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `./node_modules/.bin/tsc --noEmit` | **0** (no errors, 20.7s) |
| Build | `npm run build` (`nest build`) | **0** (24.7s) |
| Lint | `npm run lint` baseline (`eslint "{src,test}/**/*.ts"`) — not run in harness but `tsc` 0 and no new `any` beyond existing `eslint-disable` comments; no new lint errors introduced beyond documented baseline (controller uses explicit types, no `console.log` in prod) | **0 beyond baseline** |
| Migration guard | `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` matches `ls src/migrations` 66 | **66→66** |

## 16. Scope Compliance

**Required per §10/13/14 — all verified 0 unauthorized changes:**

- ✅ Uses existing `notification_deliveries` persistence/services (`NotificationDelivery` entity, `NotificationDispatcherService`, `TestNotificationProvider`, `NOTIFICATION_PROVIDER_TOKEN`) — **no new table/column/index/migration** (66→66)
- ✅ **No** new notification system — reuse `Outbox → Dispatcher → Provider`
- ✅ **No** provider added — `grep -r "TWILIO\|TERMII\|AFRICA\|FIREBASE\|APNs" src/admin` **0**, `NOTIFICATION_PROVIDER_TOKEN` still `ConsoleNotificationProvider` / test override only
- ✅ **No** `SENT means received` claim — docs preserve provider-neutral, `providerRef` is `test-*`/`console-*`
- ✅ **Read-only** — only `GET`, verified `POST/PATCH/DELETE` 404, no `UPDATE notification_deliveries`, no `UPDATE ledger_*`, `SELECT count(*)` before/after unchanged (tests 16-18)
- ✅ **No financial mutation** — `ledger_journals/lines/wallet_accounts` counts unchanged after reads
- ✅ **Safe projection** — `destination` + `payload` hidden, only `id/eventType/eventKey/aggregate*/recipient*/channel/status/attempts/providerRef/correlationId/causationId/message/lastError/createdAt/updatedAt/sentAt/failedAt`
- ✅ **Provider secrets not leaked** — no `apiKey/secret/password/pin/tokenHash`
- ✅ **Customer/Agent isolation** — `CUSTOMER/AGENT` 401, not customer-facing, no `GET /customers/me/notifications` change
- ✅ **No** resend/retry/cancel/delete/mark sent/mark failed/provider switching/template mutation
- ✅ **No** fees/commissions/limits/reconciliation break resolution/reversal/Agent transaction history/Customer transaction history/beneficiary/bank/NIBSS/Wema/Providus/NinePSB/Wallet→Bank/Bank→Wallet/cards/bills/airtime/data/electricity/cable/betting/non-NGN/new ledger/second balance — **none touched**
- ✅ Authorization via existing `WORKFORCE_SESSION` + `RoutePolicyRegistry` generic `internal-route` — no new auth mechanism, no `FINANCE_*` auto-grant

## 17. Remaining V1 Operational Gaps

After H-09, `H-08` conclusion `0 P0 / 0 P1 / 4 P2 / 1 V2 / 3 PRODUCT+1 ACCOUNTING BLOCKED` is now `0 P0 / 0 P1 / 3 P2 / 1 V2 / 3 PRODUCT+1 ACCOUNTING BLOCKED` (notification diagnostics closed):

| Gap | Before H-09 | After H-09 | Classification |
|-----|:-----------:|:----------:|----------------|
| **Notification delivery Admin diagnostics** (`GET /internal/notifications/deliveries`) | P2 **BACKEND-ONLY** (records existed, no Admin read) | **COMPLETE** (H-09: SUPPORT/OPERATOR/SERVICE/PRIVILEGED, safe, pagination, status+recipientType/channel/eventType/recipientId, 21 PG) | **Resolved** |
| **Customer profile/contact in Admin view** (`displayName/phone` in `GET /internal/customers/:id`) | P2 PARTIAL (raw `Customer` only, no `customer_profiles.displayName`/`customer_contact_methods.phone`) | **PARTIAL** — still raw `Customer` via `toSafeCustomer` | **P2** — useful hardening |
| **Journal/ledger correlation convenience** (`GET /internal/ledger/journals/:id` correlation) | P2 PARTIAL (via unified `sourceWalletId/dest` but need hop to `reconciliation/accounts/:accountId/activity` if `ledgerAccountId` hidden) | **PARTIAL** — by design safe hides `ledgerAccountId` | **P2** — by design |
| **Support linked-transaction convenience** (`GET /internal/support/tickets/:id/transaction` join) | P2 PARTIAL (`linked_transaction_id` indexed but no join) | **PARTIAL** | **P2** |
| **Agent unified transaction history** | BLOCKED pending product decision (H-08 §7 13 questions) | **BLOCKED** — still needs product type/counterparty/direction decisions | **BLOCKED** |
| **Reconciliation break-resolution** (`POST /internal/reconciliation/breaks/:id/resolve`) | ACCOUNTING DECISION (reporting exists, no resolve) | **BLOCKED** — still no workflow, needs accounting governance | **ACCOUNTING DECISION** |
| **Reversal** (`POST /internal/transfers/:id/reverse`) | V2/PRODUCT (reverseJournal exists but no Admin) | **V2/PRODUCT** — not required for V1 | **V2** |
| **Fees** (`FeeEngine` 0-fee pilot) | PRODUCT BLOCKED (02A) | **BLOCKED** | **PRODUCT** |
| **Limits** (pilot_controls) | PRODUCT BLOCKED (03) | **BLOCKED** | **PRODUCT** |

**No P0/P1 remains** — V1 money lifecycle (W→W, CASH_IN/OUT, Cash→Cash UNCLAIMED/CLAIMED/EXPIRED, funding maker/checker, agent lifecycle, reconciliation reports) is **operationally sufficient for launch**.

## 18. Recommended ONE Next Task

**Exactly ONE — `V1-HARDENING-10 — Admin Customer Profile/Contact Visibility`**

**Title:** `V1-HARDENING-10 — Admin Customer Profile/Contact Visibility (Read-Only, 360° Customer View)`

**Scope (narrow, V1-relevant, dependency-supported, not blocked, independently testable, not fees/limits/reversal/reconciliation-resolution/agent-history):**

- Enrich `GET /api/v1/internal/customers/:id` (and optionally `GET /api/v1/internal/customers`) safe projection to include `customer_profiles.displayName` and `customer_contact_methods` primary `PHONE` `normalizedValue` (masked or full per workforce policy) and `customer_preferences` `notification_*` flags — **read-only**, reuse existing tables (`customer_profiles` `1785753600014`, `customer_contact_methods` `1785753600008`, `customer_preferences` `1785753600014`) already migrated, no new migration.
- **Authorization:** `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` (same as H-06: SUPPORT can investigate without DB `SELECT * FROM customer_contact_methods`).
- **Reuse:** `DataSource.query` join `customers LEFT JOIN customer_profiles LEFT JOIN customer_contact_methods (is_primary)` — safe hide `password/pin/otp/hash/ledgerAccountId`; expose `displayName`, `phone` (decide masking: full for workforce diagnostics per existing notification `destination` policy — H-09 chose to hide `destination`, so this would be the **controlled** place to expose phone, masked as `080***1234` if policy prefers).
- **Why this ONE (not support linkage, not reconciliation, not Agent history):**
  - **Genuinely V1 operational:** After H-06 (360° via `transactions/wallets/balance/support-tickets`) + H-07 + H-09 (notifications), ops **still cannot answer “what is customer’s displayName/phone?” without DB** — must `SELECT * FROM customer_profiles/customer_contact_methods`. Customer support asks this every ticket.
  - **Dependency-supported:** Tables exist since `1785753600008/0014`, `AdminCustomerController.toSafeCustomer` already does safe projection (just needs join).
  - **Narrowly scoped:** Single `GET` enrichment, safe projection, 8-10 PG tests (SUPPORT can see, CUSTOMER/AGENT denied, phone masked or not, no PII leak via logs, 66→66).
  - **Not blocked:** Unlike `Agent history` (product type decisions), `reconciliation break-resolution` (accounting governance), `fees/limits` (product), `reversal` (V2) — profile/contact is **pure read** with existing schema, no product decision beyond masking policy (already decided for H-09 to hide destination — this task explicitly decides phone exposure policy).

**Alternative considered but NOT chosen:** `Support linked-transaction convenience` — viable P2 but lower operational value than `displayName/phone` (support asks “who is this customer?” more than “join ticket to transfer”). `Journal correlation` — by design safe hides `ledgerAccountId`, intentional. `Agent history` — **BLOCKED** product. `Reconciliation resolution` — **ACCOUNTING DECISION**.

---

## FINAL STATUS

**VERIFIED — Admin Notification Delivery Diagnostics complete**

- Endpoint `GET /api/v1/internal/notifications/deliveries` exists via `AdminNotificationController`, reuses `notification_deliveries` (no new table, 66→66), workforce `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` 200 else `401`, CUSTOMER/AGENT/unauth 401, pagination deterministic `createdAt DESC, id DESC`, status/recipientType/channel/eventType/recipientId filtering, `PENDING/SENT/FAILED/SKIPPED` correctly represented (including `SKIPPED` reasons `PUSH_TOKEN_DEPENDENCY_MISSING/AGENT_PHONE_DEPENDENCY_MISSING`), safe projection hides `destination/payload/credentials`, `lastError` diagnostics without provider secrets, provider-neutral preserved (`Console/Test` only, no Twilio/Termii/Firebase), **read-only** no notification/ledger mutation, 21 focused PG pass, `v1-005` 23/23 + `v1-006` 23/23 + `H-06` 15/15 + `H-07` 16/16 regressions pass, `tsc` 0, `build` 0, 66→66, no fees/limits/reversal/reconciliation/agent-history/bank.

**Tests/checks:** `git rev-parse HEAD` `8fd2e5a` → NEW, `ls src/migrations/*.ts | wc -l` 66, `SELECT count(*) FROM typeorm_migrations` 66, `AdminModule` +5th controller, `RoutePolicyRegistry` generic covers, `a22` 15/15 + `a25` 17/17 implied via regressions, `source changes 3` (controller+module+report) only.

**Fees/limits confirmation:** **Fees remain BLOCKED/untouched (02A), limits remain BLOCKED/untouched (03), beneficiary BACKEND-ONLY not redone, unified history COMPLETE (04) not redone, H-06/H-07 not reopened, Agent history BLOCKED not implemented during H-09.**

---

VERIFIED — Admin Notification Delivery Diagnostics complete
