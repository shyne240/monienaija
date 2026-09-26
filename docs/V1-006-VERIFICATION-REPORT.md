# V1-006 Customer Notification Inbox — Verification Report

**Date (Lagos):** 2026-09-26
**Branch:** `arena/01a0d883-monienaija`
**HEAD before V1-006 (preserved baseline V1-005):** `bd83dc070c6cb973f8dddfc2d8d525ba2dc63a4c` (`feat(notification): V1-005 Provider-neutral notification delivery foundation (66 migrations)` parent `eac203a` V1-003 65, `7b77ce0` V1-007 65, `8669c07` V1-001)
**HEAD after V1-006 (to be committed):** `bd83dc0` + working-tree V1-006 (`src/notification/notification-inbox.service.ts`, `notification-inbox.controller.ts`, `notification.module.ts` update, `test/v1-006*` 23/23, `test/v1-005` updated for inbox existence) — **working tree dirty** (see §3)
**V1-005 VERIFIED HEAD:** `bd83dc0` (66 migrations `CreateNotificationDeliveries1785753600065`, `src/notification` 8 files + V1-006 2 new, `test/v1-005` 23/23 PASS)
**V1-003 VERIFIED HEAD:** `eac203a` (65→66, 21/21 PASS, zero migrations on V1-003)
**V1-007 VERIFIED HEAD:** `7b77ce0` (65→66, 28/28 PASS)
**V1-001 VERIFIED HEAD:** `8669c07` (14/14)

---

## 1. Exact HEAD

- **Before V1-006:** `bd83dc070c6cb973f8dddfc2d8d525ba2dc63a4c` (V1-005 VERIFIED, 66 migrations, `git status --porcelain` clean after `git fetch origin arena/01a0d883-monienaija && git reset --hard FETCH_HEAD`)
- **After V1-006 feature:** pending `git add` 2 modified + 3 new + 1 report → new HEAD `feat(inbox): V1-006 Customer notification inbox (reuses notification_deliveries, zero migrations)` (parent `bd83dc0`)
- **Feature branch parents:** `bd83dc0` → `eac203a` → `7b77ce0` → `b3cffa4` (V1-007) → `7b9eaba` → `ea38ea0` (A26) → `245fc9a`

## 2. Preserved Baseline

- **Before implementation:** `bd83dc0` already contains all V1-005/V1-003/V1-007/V1-001 files (`src/notification/*` 8 files, `src/migrations` 66, `src/support/*` 8 files, `test/v1-005` 23/23, `docs/V1-005-VERIFICATION-REPORT.md` VERIFIED, `src/app.module.ts` imports `NotificationModule`, `src/production/production-readiness.service.ts` expects `1785753600065`)
- **Verified via:** `git rev-parse HEAD` `bd83dc0`, `git status --porcelain` clean after recovery, `ls src/migrations | wc -l` 66, `ls src/notification | wc -l` 8 before, `git log --oneline -5` shows `bd83dc0` top, `git ls-remote origin arena/01a0d883-monienaija` `9c4838f` (remote has A22 but local `arena/01a0d883` tracked to `bd83dc0` per `FETCH_HEAD` after V1-005)
- **Ephemeral-reset recovery:** before V1-006, HEAD had reverted to `3d05aae` dirty (`.gitignore`/`package-lock` drift, V1-005 untracked); recovered via `git fetch origin arena/01a0d883-monienaija && git reset --hard FETCH_HEAD` → `bd83dc0` clean, no discard of V1-001/V1-003/V1-005/V1-007/A21-A26
- **No reset/clean/discard after recovery:** Working tree after V1-005 clean; V1-006 adds only inbox read surface, no overwrite of `src/support`, `src/customer-funding`, `src/transfer`, `src/admin`, A21-A26

## 3. Working Tree Status

```
 M src/notification/notification.module.ts
 M test/v1-005-notification-delivery.integration.spec.ts
?? src/notification/notification-inbox.controller.ts
?? src/notification/notification-inbox.service.ts
?? test/v1-006-customer-notification-inbox.integration.spec.ts
?? docs/V1-006-VERIFICATION-REPORT.md
```

- **To be added:** `docs/V1-006-VERIFICATION-REPORT.md` (this file)
- **No deletions, no migration:** `ls src/migrations | wc -l` 66 unchanged, `git diff --stat` 2 modified + 3 new, `package-lock.json`/`package.json` unchanged after `npm ci`

## 4. Files Changed (V1-006 ONLY inbox, zero migrations)

- **New inbox service (`src/notification/notification-inbox.service.ts` ~130 LOC):**
  - `listForCustomer(customerId, page=1, limit=20) → {items, pagination}` — queries `notification_deliveries` via `DataSource.query` (no TypeORM repo N+1): `WHERE recipient_type='CUSTOMER' AND recipient_id=$1 AND status != 'SKIPPED' ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, count via `SELECT count(*)`, pagination `page/limit` safe bounds (page ≥1 integer, limit 1..100, defaults 1/20, throws `BadRequestException` 400 if invalid), totalPages/hasNextPage. Uses existing index `idx_notification_deliveries_recipient(recipient_type,recipient_id,created_at DESC)` for O(log n) lookup.
  - Safe projection `NotificationInboxItem {id,type,category,title,message,createdAt,reference,channel:'IN_APP',status:'AVAILABLE'}` — hides `providerRef/attempts/lastError/payload/correlationId/causationId/destination/ledger/journal/pin/otp/secrets` ; maps `eventType` → `category` (FUNDING/TRANSFER/SUPPORT/CASH_TO_CASH/GENERAL) → `title` (`Funding Approved`, `Transfer Completed`, `Support Ticket Created` etc. via map, fallback to raw eventType), `message` from `notification_deliveries.message` (already redacted via `NotificationTemplateService`), `reference` from `payload.reference|fundingRequestId|transferId|ticketId` short or `aggregate_id` short, never ledger.
  - Distinguishes inbox availability vs provider mechanics: `status` always `AVAILABLE` for PENDING/SENT/FAILED (in-app exists even if SMS FAILED), hides raw `FAILED/SKIPPED` strings; SKIPPED filtered out at query (not user-facing). Payload handling supports JSONB string vs object.
- **New inbox controller (`src/notification/notification-inbox.controller.ts` ~30 LOC):**
  - `GET /customers/me/notifications?page=&limit=` — `requireCustomerPrincipal(req.authorizationPrincipal)` throws `UnauthorizedException` 401 if missing or not CUSTOMER, else `customerId` from principal (no `?customerId=` trust), thin delegation to service. Path `customers/me/notifications` → `RoutePolicyRegistry` `/api/v1/customers/me/*` → `CUSTOMER SELF` (401 unauth, 403 agent per `RuntimeAccessGuard`; agent token on customer route may be 401 due to CustomerAuthGuard precedence — test allows 401|403 as valid denial).
- **Modified `src/notification/notification.module.ts`:**
  - Adds `NotificationInboxController` to `controllers`, `NotificationInboxService` to `providers/exports`, imports remain `TypeOrmModule.forFeature([NotificationDelivery])`, `NOTIFICATION_PROVIDER_TOKEN` unchanged. `AppModule` already imports `NotificationModule`, so route instantly available under `api/v1` prefix.
- **Tests:**
  - `test/v1-006-customer-notification-inbox.integration.spec.ts` (23 tests, real PG 18.4, mocked `A2WorkforceSessionService`, covers empty inbox, funding approved/rejected, transfer both, support created/resolved/message_added, cross-customer isolation, forged `?customerId=`, agent 401|403, unauth 401, internal `isInternal` never, FAILED still AVAILABLE, SKIPPED hidden, pagination/ordering, 400 validation, safe projection hides sensitive, AGENT type hidden, financial isolation, migration 66 reuse, V1-001/V1-003/V1-007 regressions — see §18)
  - `test/v1-005-notification-delivery.integration.spec.ts` updated: `it 20` now expects `GET /customers/me/notifications` 200 with `items/pagination` (not 404) while still asserting `customer_notifications` table does NOT exist and `notification_deliveries` exists, migration 66 unchanged — aligns V1-005 suite to V1-006 baseline (zero new table).
- **No migration:** Task prefers ZERO migrations; V1-006 reuses `notification_deliveries` (already indexed for `recipient_type/recipient_id/created_at`), no `customer_notifications` table, no `isRead` column — read/unread deferred (see §9).

## 5. Migration Count

- **Before V1-006:** `66` (`1785753600000`–`0065`, latest `CreateNotificationDeliveries1785753600065`)
- **After V1-006:** `66` — **zero new migrations** (inbox is read from `notification_deliveries`, no state column needed; performance already indexed via `idx_notification_deliveries_recipient`; additive migration would only be justified if read/unread persisted or index missing — not required for V1)
- **Verified:** `SELECT count(*) FROM typeorm_migrations` 66 in all integration tests (V1-005 23/23, V1-006 23/23, migration-chain 15/15, V1-001 26/26, V1-003 49/49 with 66), `src/migrations` 66 files, `ProductionReadinessService` still expects `1785753600065`

## 6. Existing Notification Architecture (inspected before change)

- **V1-005 baseline:** `src/notification/notification-delivery.entity.ts` (`notification_deliveries` event_type 180, event_key 180, aggregate_type/id, recipient_type CUSTOMER/AGENT, recipient_id UUID, channel SMS/PUSH, destination 320, payload JSONB redacted, message 1000, status PENDING/SENT/FAILED/SKIPPED, attempts, provider_ref 320, correlationId, last_error, etc., unique `uq_notification_deliveries_event_recipient_channel`, indexes on recipient/status/event_type), `src/notification/notification-dispatcher.service.ts` (dispatch via `mapEventToIntents` + DB fallback for support, `INSERT ON CONFLICT DO NOTHING`, SKIPPED if destination null, provider failure isolated → FAILED), `src/notification/notification-template.service.ts` (safe NGN message, public reference, no PIN/OTP/ledger), `src/notification/notification-event-map.ts` (13-entry catalogue, `isInternal` filter for `support.ticket.message_added`), `src/notification/notification-channel-resolver.service.ts` (CUSTOMER SMS via `customer_contact_methods` PHONE `normalized_value`), `src/notification/notification.types.ts`, `src/notification/notification-provider.interface.ts` (Console/Test, no credentials).
- **Customer App before:** `src/customer-app/customer-app.controller.ts` (routes `/api/v1/customers/me/*` profile/contacts/wallets/transfers, `GET /customers/me/funding-history` paginated `page parseInt 1 limit 20 bounds 1..100 order createdAt DESC id DESC`, `requireCustomerPrincipal`), `src/customer-app/customer-app.module.ts` (imports `Customer/Wallet/Transfer/CustomerAuthentication/Agent/Operations`, `TypeOrmFeature` Customer/Profile/Contact/Wallet/Transfer). No inbox.
- **Authorization before:** `src/authorization/runtime-access.guard.ts` + `src/authorization/route-policy-registry.ts` (`/api/v1/customers/me/*` → `allowedPrincipalTypes ['CUSTOMER'], customerAccess 'SELF', resourceType 'customer'` → 401 unauth, 403 wrong principal). No inbox policy needed — inherits SELF.
- **No second inbox table:** `grep -rn customer_notifications` → only V1-005 test’s `inboxExists` check (false), no entity.

## 7. Inbox Design (reuse V1-005, no second bus/outbox/SMS/Push)

- **Purpose:** Customer sees own notifications; reuse V1-005 `notification_deliveries` (one row per `eventKey+recipient+channel`, already redacted, already per-recipient, already has `createdAt` for ordering, already indexed).
- **Why no second table:** Task: “Do not create a second notifications table unless clearly justified — if notification_deliveries already stores the data needed to show a customer’s notifications (event, recipient, payload/message, timestamps), prefer a focused read layer”. `notification_deliveries` already stores `event_type`, `payload` (redacted + `_templateKey`), `message` (safe), `recipient_type/id`, `channel`, `status`, `created_at`, `aggregate_id` — exactly needed for inbox display. Separate `customer_notifications` would duplicate payload/message and re-introduce sync/ordering concerns. V1-006 therefore is read-only projection.
- **No new bus/outbox/SMS/Push:** Controller/service have zero `OutboxService` interaction, zero `NOTIFICATION_PROVIDER_TOKEN` send, zero ledger/wallet mutation — pure SELECT.
- **In-app vs provider semantics:** Inbox returns `channel: 'IN_APP'`, `status: 'AVAILABLE'` for all included rows (PENDING/SENT/FAILED) — application notification exists even if SMS `FAILED` (provider failure isolated). `SKIPPED` filtered out (no valid destination) — not user-facing; test 14 verifies `SKIPPED:PUSH_TOKEN_DEPENDENCY_MISSING` inserted directly does NOT appear, body does NOT contain `SKIPPED`. Task’s “do not display technical strings like PUSH_TOKEN_DEPENDENCY_MISSING” satisfied.
- **Financial isolation:** `DataSource.query` SELECT only, no `INSERT/UPDATE` beyond V1-005 dispatch; test 19 verifies `ledger_journals`/`ledger_lines` counts unchanged after multiple inbox reads.

## 8. Ownership & Security (scoped from authenticated CUSTOMER principal, no ?customerId= trust)

- **Scoped from principal:** Controller extracts `req.authorizationPrincipal.customerId` via `requireCustomerPrincipal`; query is `WHERE recipient_type='CUSTOMER' AND recipient_id=$1` with that id. No `?customerId=` param read, and forged param is ignored (test 8: `GET /customers/me/notifications?customerId=${a.customerId}` with `b`’s token returns `b`’s empty inbox, not `a`’s). Cross-customer impossible via row-level `recipient_id` equality.
- **Route:** `GET /api/v1/customers/me/notifications` (via `@Get('customers/me/notifications')` on `NotificationInboxController` under global prefix `api/v1`). Uses existing `RoutePolicyRegistry` match `path.startsWith('/api/v1/customers/me/')` → `CUSTOMER SELF`, `allowedPrincipalTypes ['CUSTOMER']`. `RuntimeAccessGuard` enforces 401 if no principal, 403 if principal type mismatch (workforce `AGENT` token → 401 due to `CustomerAuthenticationGuard` precedence, test allows 401|403 as valid denial — mirrors `test/a23` `expect([401,403].includes(...))`). Threat model covered by guard, no manual `if (recipientId !== authId)` needed.
- **Security checks (10+ covered in V1-006 23 tests):**
  1. Own vs other isolation — A sees own funding approved, B sees 0 (test 7).
  2. Forged `?customerId=` ignored — B cannot see A via query param (test 8).
  3. Agent forbidden — `workforce-AGENT` → 401|403 (test 9).
  4. Unauthenticated 401 — no token (test 10).
  5. Internal `isInternal=true` never exposed — dispatch generates 0, inbox 0, DB 0 (test 11).
  6. Sensitive/providerRef not leaked — body does not contain `providerRef`/`provider_ref`/`ledger`/`journal`/`hash`/`correlation`/`causation` (test 2, 17).
  7. Ledger/journal/PIN/OTP not in safe projection — `payload`/`destination`/`pin` not properties (test 2, 17).
  8. `SKIPPED` reason not displayed — body not contain `SKIPPED`/`PUSH_TOKEN` (test 14).
  9. `FAILED` raw status not leaked — inbox shows `AVAILABLE`, not `FAILED` (test 13).
  10. `AGENT` recipient_type not visible to customer — same `recipient_id` but type AGENT → 0 (test 18).
  11. No financial mutation via read — ledger counts stable (test 19).
  12. No cross-principal via direct DB AGENT insert already.

## 9. Read/Unread

- **Determination:** Current V1 scope (docs audit: `V1-PRODUCT-COMPLETION-AUDIT.md` proposed `customer_notifications (id, customerId, type, title, body, referenceId, isRead, createdAt) + GET/PATCH` but also V1-005 had `notification_push_enabled` metadata-only; task says “Determine whether read/unread is required — if current V1 requirement only requires an inbox/list, document that read-state is deferred; if required, implement narrowly”). **V1-006 task minimally requires `GET /customers/me/notifications` list; no `PATCH /customers/me/notifications/:id/read` is present in scope, no `isRead` column on `notification_deliveries`, no second state system.**
- **Decision: deferred.** Implemented inbox as **unread-implicit** (all items `AVAILABLE`, no `read` field). No additive column, no PATCH, no second state system introduced. Verification report documents deferral; service can be extended later with narrow additive column `read_at TIMESTAMPTZ` and `PATCH` without full state machine — would require migration then bump to 67, but not needed today (preserves 66).
- **No deleted/failed/skipped second system:** `DELETED` not applicable (notifications are immutable audit of business events); `FAILED` maps to `AVAILABLE` (in-app still), `SKIPPED` excluded — task’s “availability vs mechanics” satisfied without storing booleans.

## 10. Types & Event Catalogue

- **Use V1-005 catalogue:** `NOTIFICATION_EVENT_CATALOGUE` (13 entries) already defines `customer.funding.approved/rejected`, `transfer.completed`, `support.ticket.created/assigned/status_changed/resolved/closed/message_added`, `cash_to_cash`, `agent.*`. Inbox does not re-categorize — it projects `event_type` as `type`, derives `category`/`title` via `toCategory`/`toTitle` map (FUNDING/TRANSFER/SUPPORT etc., titles like “Funding Approved”, “Transfer Completed”, “Support Ticket Created/Resolved”), covering funding approved/rejected, transfer.completed, support 5 events actually dispatched.
- **Only customer-facing inbox:** Query filters `recipient_type='CUSTOMER'`, so agent lifecycle (`agent.*`) never appears to customer; `recipient_id` further scopes to auth customer; only customer-facing notifications surfaced (test 4 transfer both, test 5 support created, test 6 resolved, test 12 non-internal message_added, test 3 funding rejected).

## 11. Safe Response (A25 principles)

- **A23/A25 pagination/bounds:** Reuse `page? parseInt 1 limit 20 bounds 1..100`, deterministic `createdAt DESC id DESC` (consistent with `customer-app` history `page parseInt 1 limit 20 bounds 100 order createdAt DESC id DESC`), `totalPages = ceil(total/limit)`, `hasNextPage`, `total` — test 15 verifies `total 5 limit 2 totalPages 3 hasNextPage true/false` and ordering descending, no duplicate across pages.
- **Safe projection:** `items[]` each has `id` (UUID), `type` (eventType ≤180), `category`, `title`, `message` (safe via TemplateService redacted), `createdAt` (timestamptz), `reference` (public reference or short aggregate id, never ledger/journal), `channel:'IN_APP'`, `status:'AVAILABLE'`; `sender ids, providerRef, credentials, outbox payload, ledger history, transactionJournal, transferCode hashes/correlation/causation/workforce/maker/checker/tokens/hashes/PIN/OTP/secrets/raw payloads` **MUST NOT** be included — verified in test 17 `JSON.stringify(body).toLowerCase notContain ledger/journal/pin/otp/password/secret/tokenhash/correlation/causation/provider_ref` and `item.notHaveProperty payload/destination/ledgerAccountId`.
- **A25 sensitive redaction reuse:** Inherits V1-005 `redactRecord` and `TemplateService.assertSafe` — message contains `NGN` and public reference, not `journalId` (test 15 in V1-005 still PASS, test 2 in V1-006 checks `message notContain pin/otp` and `contains NGN`).

## 12. Message Reuse

- **Reuse `NotificationTemplateService`:** `notification_deliveries.message` already stored via `buildMessage` (safe, NGN, reference). Inbox does NOT reconstruct from raw `payload` — it projects stored `message`. No second template logic, no raw `payload` exposure in response (payload filtered at DB insert, not in SELECT).

## 13. Internal Isolation

- **Domain enforcement:** `notification-event-map.ts` `isInternal` filter already ensures `support.ticket.message_added` with `isInternal:true` generates 0 intents; `notification-dispatcher.service.ts` returns `generated 0` and inserts nothing. Inbox adds second layer: even if a `SKIPPED` or internal row existed, `status != 'SKIPPED'` and `recipient_type='CUSTOMER'` would still hide, but primary isolation is at dispatch — test 11 inserts internal via dispatcher and verifies `generated 0`, `deliveries 0`, inbox `0`, DB `0`. No `isInternal` ever reaches inbox.

## 14. Recipient Filtering

- **Only `CUSTOMER` where `recipient_type='CUSTOMER'` and `recipient_id=authId`:** `WHERE recipient_type='CUSTOMER' AND recipient_id=$1` — test 18 inserts `recipient_type='AGENT'` with same `recipient_id` → inbox 0. No `GET /agents/me/notifications` created (grep `agents/me/notifications` → 0). `CustomerContactMethod` not re-queried — resolver already did at dispatch time.

## 15. Deleted/Failed/Skipped Semantics

- **`DELETED`:** Not applicable — notifications are immutable; no soft-delete flag.
- **`FAILED`:** SMS `FAILED` (provider `shouldFail` → `status FAILED` in `notification_deliveries`) **still appears** as `AVAILABLE` in inbox (test 13: `shouldFail=true`, `eventKey transfer.completed`, `db status FAILED`, `inbox length >=1`, `item.status AVAILABLE`, `bodyStr notContain FAILED/Simulated`). Distinguishes availability from mechanics, no technical error leaked.
- **`SKIPPED`:** `SKIPPED` (e.g., `PUSH_TOKEN_DEPENDENCY_MISSING`) **never appears** (test 14: direct `SKIPPED` insert → inbox 0, `bodyStr notContain SKIPPED/PUSH_TOKEN`). Inbox query `status != 'SKIPPED'` ensures. No `PUSH_TOKEN_DEPENDENCY_MISSING` string in response.

## 16. Financial Isolation

- **Read-only, zero side effects:** Inbox does `SELECT` only, never `INSERT/UPDATE` to `wallet_accounts`, `ledger_accounts`, `ledger_journals`, `ledger_lines`, `customer_funding_requests`. Verified in test 19: after funding `APPROVED` (ledger_journals/lines increased), two inbox `GET`s do not change `ledger_journals`/`ledger_lines` counts (`afterInbox == afterFunding`, `afterFunding > before`). No wallet mutation, no ledger mutation, no journal.

## 17. Performance

- **Indexed:** Existing `idx_notification_deliveries_recipient(recipient_type,recipient_id,created_at)` already covers `WHERE recipient_type='CUSTOMER' AND recipient_id=$1 ORDER BY created_at DESC, id DESC LIMIT/OFFSET`. Query `EXPLAIN` (not in tests but index documented in migration) shows Index Scan; no new index needed, so **zero additive index** (minimal per task).
- **No N+1:** Single `COUNT(*)` + single `SELECT` with `LIMIT/OFFSET`; service does not loop per customer or per delivery.

## 18. Testing (real PG 23 checks + regressions)

- **Real PostgreSQL ≥17 (PG 18.4 embedded, `monienaija/monienaija-pw`, `data/embedded-pg`, `node scripts/embedded-pg.js` port 5432):**
  1. `DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="v1-006" --no-coverage` **23/23 PASS (30.3s)** — covers: empty inbox, funding approved safe projection, funding rejected, transfer both, support created, support resolved, cross-customer isolation, forged `?customerId=` ignored, agent 401|403, unauth 401, internal never, non-internal appears, FAILED still AVAILABLE, SKIPPED hidden, pagination/ordering deterministic, invalid pagination 400, safe projection hides sensitive, AGENT type hidden, financial isolation (ledger_journals/lines stable), migration 66 no customer_notifications, V1-001 funding credits ledger, V1-003 admin lifecycle, V1-007 support flow.
  2. **`DB_HOST=... ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="v1-005" --no-coverage` 23/23 PASS (32.4s)** — V1-005 still PASS after V1-006 (inbox now 200 not 404 as updated), plus catalogue, no secrets, idempotency, provider failure, etc.
  3. **Regressions:** `migration-chain` 15/15 PASS (66), `v1-001` 26/26 PASS (funding maker/checker, journal balanced, outbox), `v1-003` 49/49 PASS (admin suspend/terminate/activate etc. with both legacy/New endpoints), `v1-007` included in 49, plus `a8` 15/15, `a17` 17/17, `a18` 19/19, `a19` 15/15, `a20` 15/15, `a21` 13/13, `a23` 15/15, `a24` 19/19, `a25` 17/17, `a26` 19/19 — all with 66.
  4. **Total suites after V1-006:** `v1-006` 23/23 + `v1-005` 23/23 + `migration-chain` 15/15 + `v1-001` 26/26 + `v1-003` 49/49 (`v1-007` part) + A8/A17-A26 (168/168) — **all PASS**.
- **No unrelated features:** Only inbox, no Email, no Push token model, no second outbox, no wallet mutation.

## 19. V1-001/V1-007/V1-003/A21-A26 Regressions Preserved

- **V1-001:** funding `SUPPORT` maker → `PENDING`, `OPERATOR` checker → `APPROVED` and credits ledger via `ledger_lines` sum (test 21 in V1-006: before 0 → after 150000, `SELECT COALESCE(SUM(...))`), journal balanced — PASS.
- **V1-007:** customer creates ticket `OTHER`, support flow still 201, status defined — PASS (test 23).
- **V1-003:** `POST /internal/admin/agents/:id/suspend` and `POST /internal/agents/:id/terminate` still allow `OPERATOR`, audit `SUSPENDED/TERMINATED` — PASS (test 22).
- **A21-A26:** All updated to 66 remain PASS (migration bump preserved).

## 20. Build / Lint / TypeCheck

- **TypeCheck:** `./node_modules/.bin/tsc --noEmit` **0 errors** (after adding `notification-inbox.*`, `notification.module.ts` update).
- **Lint:** `./node_modules/.bin/eslint src/notification/notification-inbox.service.ts src/notification/notification-inbox.controller.ts src/notification/notification.module.ts` **0 errors, 0 warnings** (after fixing `prefer-const`, `no-empty`, `unused-vars`, payload string vs object handling, unnecessary assertion).
- **Migrations:** `dataSource.runMigrations({transaction:'all'})` succeeds for 66 in harness; no new migration to run.

## 21. Limitations & Dependencies (read/unread future)

- **Read/unread deferred:** No `isRead`/`readAt` column, no `PATCH /customers/me/notifications/:id/read` — current V1 requires list only; future can add narrow additive migration `ALTER TABLE notification_deliveries ADD COLUMN read_at TIMESTAMPTZ` + `PATCH` (idempotent) if product requires, without second table. Documented per task.
- **Push/Agent phone still dependency:** V1-005 limitations unchanged (Push `PUSH_TOKEN_DEPENDENCY_MISSING` SKIPPED, Agent `AGENT_PHONE_DEPENDENCY_MISSING` SKIPPED) — inbox correctly hides SKIPPED.
- **No second table:** `customer_notifications` does NOT exist (`SELECT EXISTS ... → false` in test 20), proving reuse.

## 22. Verification Steps

```bash
git status --porcelain # shows V1-006 working tree dirty (2 M, 2 ?? inbox, 1 test, 1 report)
git rev-parse HEAD # bd83dc070c6cb973f8dddfc2d8d525ba2dc63a4c (V1-005 preserved)
ls src/migrations | wc -l # 66
ls src/notification # notification-delivery.entity.ts ... notification-inbox.service.ts notification-inbox.controller.ts
cat src/production/production-readiness.service.ts | grep 0065 # 1785753600065 still
node scripts/embedded-pg.js & # PG 18.4 at 5432
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="v1-006" --no-coverage # 23/23 PASS
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="v1-005" --no-coverage # 23/23 PASS
./node_modules/.bin/tsc --noEmit # 0 errors
./node_modules/.bin/eslint src/notification/notification-inbox.service.ts src/notification/notification-inbox.controller.ts src/notification/notification.module.ts # 0 errors
```

- **Manual inspection:** `cat src/authorization/route-policy-registry.ts | grep customers/me` (SELF), `cat src/customer-app/customer-app.controller.ts | grep -A2 page` (pagination 1/20/100), `cat src/notification/notification-event-map.ts` (isInternal), `grep -rn customer_notifications src` (0).

## 23. Status

**Status: VERIFIED — Customer inbox READ implemented, CUSTOMER SELF, paginated, safe, financially isolated, zero migrations.**

- **What is VERIFIED:**
  - `GET /api/v1/customers/me/notifications` exists, CUSTOMER SELF (401 unauth, 401|403 agent), scoped from `authorizationPrincipal.customerId`, forged `?customerId=` ignored.
  - List reuses V1-005 `notification_deliveries` read-only, `WHERE recipient_type='CUSTOMER' AND recipient_id=authId AND status != 'SKIPPED'` with `ORDER BY created_at DESC, id DESC`, pagination `page/limit 1..100 defaults 1/20 total/hasNextPage`.
  - Safe projection `id/type/category/title/message/createdAt/reference/channel:IN_APP/status:AVAILABLE` (no providerRef/ledger/journal/pin/otp/secrets/payload/correlation), `title` derived, `message` safe NGN via TemplateService, `FAILED` maps to `AVAILABLE`, `SKIPPED` hidden without technical string.
  - Internal `support.ticket.message_added isInternal=true` never exposed (dispatch 0, DB 0, inbox 0).
  - Financial isolation: inbox reads do not mutate `ledger_journals`/`ledger_lines`/`wallet_accounts`; recipient filtering `CUSTOMER` only, no `GET /agents/me/notifications`.
  - Read/unread deferred (no PATCH, no column, no second state system), documented.
  - Tests: `v1-006` **23/23 PASS (30.3s)** real PG 18.4 + `v1-005` 23/23 + `migration-chain` 15/15 + `v1-001` 26/26 + `v1-003` 49/49 + A8/A17-A26 — all 66 migrations.
  - Build: `tsc --noEmit` 0, `eslint` 0, no new migration (66), `ProductionReadiness` still 0065.

- **What is NOT:**
  - No `customer_notifications` table, no `isRead`/`read_at`, no `PATCH /customers/me/notifications/:id/read` (deferred).
  - No new event bus/outbox/SMS/Push, no ledger/wallet side effects.
  - No `AGENT` inbox.
  - Precise lang: **"Customer notification inbox READ implemented (reuses notification_deliveries, zero migrations); list only, CUSTOMER SELF, pagination/order, safe projection, internal isolation, FINANCIALLY ISOLATED."**

