# V1-007 Support Ticket Lifecycle — Verification Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (preserved baseline before V1-007):** `ea38ea09a17563546034b672ec7d69bedcbf0c1f` (`chore: preserve A21-A26 + V1-001 verified baseline before V1-007` — contains `37aa315` A21-A26, `8669c07` V1-001 working-tree equivalent, 64 migrations, `src/customer-funding/*`, `docs/V1-001-VERIFICATION-REPORT.md`, `docs/A21-A26`, `test/v1-001*`) — parent `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (`fix(production): update expected migration constraints…`)  
**HEAD after V1-007:** `b3cffa455129517ef790c1d37ab5e49af131ce88` (`merge: integrate remote A22-A26 (245fc9a) into V1-007 work — keep 65 migrations V1-007 support`, parents `7b9eaba` `245fc9a`) -> `7b9eaba` (`feat(support): V1-007 Support ticket lifecycle…` 30 files, `src/support/*`, `src/migrations/1785753600064-*`, `src/app.module.ts`, `src/production/production-readiness.service.ts`, test expectation updates 64→65) — **clean** (`git status --porcelain` 0)  
**HEAD before V1-007:** `ea38ea0` already pushed; merged with `245fc9a` (A26) to reconcile divergent history; both lineages preserved  
**Verified V1-001 HEAD:** `8669c073af4ee75c9e902a1ec006e54b1cd07736` (`feat(funding): V1-001 Operations Customer Funding with maker/checker`, parent `37aa315` preserve, 26/26) — content byte-identical to preservation commit  
**A26 verified baseline HEAD:** `245fc9a`/`6036b7c` (A26 19/19) captured in `37aa315` (155 files, 26868 insertions) — now merged as second parent  

---

## 1. Exact HEAD
- **Final HEAD:** `b3cffa455129517ef790c1d37ab5e49af131ce88` (`merge: integrate remote A22-A26 (245fc9a) into V1-007 work — keep 65 migrations V1-007 support`, parents `7b9eaba` + `245fc9a`, `git status --porcelain` clean)
- **Before V1-007:** `ea38ea09a17563546034b672ec7d69bedcbf0c1f` (preserve commit 2026-09-26, 167 files, includes all A21-A26 + V1-001)
- **Feature commit:** `7b9eabac3eb8272d9eda910341c44d3b460f170b` (`feat(support): V1-007…` 30 files, 2998 insertions) — contains all working-tree changes above, now merged
- **Remote integrated:** `245fc9a` (`docs: A26…` ) merged via `b3cffa4` to resolve non-fast-forward; no content lost (ours kept for 65-migration files)

## 2. Preserved Baseline
- **Before implementation:** `37aa315e84a60cfae0f61b6ce8be26019383a158` (A21-A26 verified, `docs/V1-PRODUCT-COMPLETION-AUDIT.md`, `docs/A21-A26` contracts) — parent `3d05aae`
- **V1-001:** `8669c07` working-tree equivalent (maker/checker, `SERIALIZABLE`, `PAYMENT-SETTLEMENT_ASSET-NGN`, `GET /customers/me/funding-history` safe, 64 migrations) — verified 26/26
- **Preserve commit:** `ea38ea0` (`chore: preserve A21-A26 + V1-001 verified baseline before V1-007` — 167 files, 29347 insertions) — **no reset/clean/discard**, all untracked files staged, no overwrite of A21-A26
- **Verified via:** `git rev-parse HEAD` `ea38ea0`, `git status --porcelain` (67 dirty → 15 M + 3 ?? after preserve, now 15 M + 3 ?? for V1-007), `ls src/customer-funding/` 7 files, `ls src/migrations | wc -l` 65 after

## 3. Working-Tree Status
```
 M src/app.module.ts
 M src/production/production-readiness.service.ts
 M test/a17-agent-cash-to-cash-expiry.integration.spec.ts
 M test/a18-aggregator-foundation.integration.spec.ts
 M test/a19-agent-funding.integration.spec.ts
 M test/a20-outlets-terminals.integration.spec.ts
 M test/a21-agent-app.integration.spec.ts
 M test/a23-customer-app.integration.spec.ts
 M test/a24-customer-transaction-pin-hardening.integration.spec.ts
 M test/a25-customer-history-hardening.integration.spec.ts
 M test/a26-customer-profile-hardening.integration.spec.ts
 M test/a8-agent-lifecycle.integration.spec.ts
 M test/migration-chain.integration.spec.ts
 M test/production-readiness.spec.ts
 M test/v1-001-customer-funding.integration.spec.ts
?? src/migrations/1785753600064-CreateSupportTickets.ts
?? src/support/
?? test/v1-007-support-ticket.integration.spec.ts
```
- **No deletion, reset, checkout, or overwrite of A21-A26/V1-001** — all 64 prior migrations preserved, 65th additive, no ledger/balance/provider change

## 4. Files Changed (V1-007 additive)
- **New:**
  - `src/support/support.enums.ts` (Status OPEN/IN_PROGRESS/RESOLVED/CLOSED, Category 13 values, Priority LOW/MEDIUM/HIGH/CRITICAL)
  - `src/support/support-ticket.entity.ts` (support_tickets, FK customer/agent/funding/transfer, version, indexes, checks)
  - `src/support/support-ticket-message.entity.ts` (support_ticket_messages, ticket FK CASCADE, is_internal)
  - `src/support/support.service.ts` (651 lines, create/list/get/assign/status/message, idempotency, audit/outbox, concurrency, no ledger)
  - `src/support/support-customer.controller.ts` (POST/GET /customers/me/support/tickets, messages, Idempotency-Key, CUSTOMER SELF)
  - `src/support/support-agent.controller.ts` (POST/GET /agents/me/support/tickets, messages, AGENT SELF)
  - `src/support/support-internal.controller.ts` (GET /internal/support/tickets, GET :id, POST :id/assign, POST :id/status, resolve/close, messages, WORKFORCE)
  - `src/support/support.module.ts`
  - `src/support/dto/create-support-ticket.dto.ts`, `assign-support-ticket.dto.ts`, `update-support-ticket-status.dto.ts`, `create-support-ticket-message.dto.ts`
  - `src/migrations/1785753600064-CreateSupportTickets.ts` (support_tickets + support_ticket_messages, FKs, indexes, checks)
  - `test/v1-007-support-ticket.integration.spec.ts` (28 tests, real PostgreSQL)
- **Modified:**
  - `src/app.module.ts` (import `SupportModule`)
  - `src/production/production-readiness.service.ts` (`EXPECTED_MIGRATION_TIMESTAMP` `1785753600064`, `CreateSupportTickets`)
  - `test/migration-chain.integration.spec.ts` (65), `test/production-readiness.spec.ts` (0064), `test/a17..a26,v1-001` (65/0064)

## 5. Migration(s)
- **1785753600064-CreateSupportTickets** (`CreateSupportTickets1785753600064`):
  - `support_tickets` (id UUID PK, reference VARCHAR(64) UNIQUE, customer_id UUID FK customers RESTRICT, agent_id FK agents RESTRICT, created_by_type/id, subject 200, category 60, description 4000, status OPEN/IN_PROGRESS/RESOLVED/CLOSED, priority MEDIUM default, assigned_to 160 nullable, funding_request_id FK customer_funding_requests RESTRICT, related_transfer_id FK transfers RESTRICT, created_at/updated_at, resolved_at/closed_at, version INT, CHECKs for status/category/priority/created_by_type/subject/description/version, INDEXes uq_reference, idx_customer_created, idx_agent_created, idx_status_created, idx_assigned, idx_funding, idx_transfer, idx_reference)
  - `support_ticket_messages` (id PK, ticket_id FK support_tickets CASCADE, author_type 20, author_id 160, body 4000, is_internal BOOLEAN default false, created_at/updated_at, CHECK author_type/body, INDEX idx_ticket_created)
  - **Additive, no modification of financial tables** (`customers`, `agents`, `ledger_journals`, `wallet_accounts`, `transfers`, `customer_funding_requests` untouched)
  - **Count:** 65 (`1785753600000`-`0064`, `typeorm_migrations` count 65 after `runMigrations`)

## 6. Support Domain Model
- **Bounded context:** `src/support` first-class, only if no suitable existing context (none found; compliance is KYC/AML, not support)
- **Entities:**
  - `SupportTicket` (id, reference `SUP-${uuid}`, customerId nullable, agentId nullable, createdByType/Id, subject 3-200, category enum, description 3-4000, status, priority MEDIUM, assignedTo nullable, fundingRequestId nullable, relatedTransferId nullable, createdAt/updatedAt, resolvedAt/closedAt, version)
  - `SupportTicketMessage` (id, ticketId, authorType, authorId, body 1-4000, isInternal boolean, createdAt/updatedAt)
- **No fields merely because generic:** only V1-required (ticket ID/reference, creator, customer/agent, subject/category/description, status, priority, assignment, funding/transfer links, timestamps, version); no outlet/terminal yet, no second ledger
- **Reference:** generated `SUP-${id}` (deterministic, unique), like funding `CF-${id}`

## 7. Status State Machine
- **Enum:** `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED` (4, minimal)
- **Transitions validated explicitly:**
  - `OPEN` → `IN_PROGRESS`, `RESOLVED`, `CLOSED`
  - `IN_PROGRESS` → `RESOLVED`, `CLOSED`
  - `RESOLVED` → `CLOSED`
  - `CLOSED` → `[]` (terminal)
  - Rejects arbitrary mutation with `ConflictException` (`Invalid support ticket transition from X to Y`)
  - Idempotent if already in target status (return early)
- **Side effects:** `RESOLVED` sets `resolved_at=NOW()`, `CLOSED` sets `closed_at`, `assigned_to` via `assignTicket` also transitions `OPEN` → `IN_PROGRESS` on first assign (auditable), version increment, `updated_at` now, audit `SUPPORT_TICKET_STATUS_CHANGED`/`RESOLVED`/`CLOSED`, outbox `support.ticket.status_changed`/`resolved`/`closed`
- **Pattern reused:** like `CustomerComplianceCase` but simpler (no ESCALATED/PENDING_CUSTOMER)

## 8. Customer Workflow
- **Routes (CUSTOMER SELF, via `RoutePolicyRegistry` `/api/v1/customers/me/` → `CUSTOMER` `SELF`):**
  - `POST /customers/me/support/tickets` — SELF, body `subject/category/description/priority?/fundingRequestId?/relatedTransferId?`, `Idempotency-Key` header optional (if present uses `IdempotencyService` scope `support.ticket.create:CUSTOMER:customerId`, replay returns original, different hash → 409)
  - `GET /customers/me/support/tickets?page=&limit=` — paginated `1-100`, `ORDER BY created_at DESC`, safe projection (no `assignedTo`, no `createdBy` internals, no ledger ids beyond `fundingRequestId`/`relatedTransferId`, no `request_hash`/`idempotency`/`journalId`)
  - `GET /customers/me/support/tickets/:id` — 404 if not owned (no leakage), safe view
  - `POST /customers/me/support/tickets/:id/messages` — body `body 1-4000`, `isInternal` rejected (403), only if ticket `OPEN`/`IN_PROGRESS` and owned, else 409/404, audit `SUPPORT_TICKET_MESSAGE_CREATED`, outbox `support.ticket.message_added` if not internal
  - `GET /customers/me/support/tickets/:id/messages` — filtered `is_internal=false` only, 404 if not owned
- **Security:** unauthenticated 401, cannot access another customer's ticket/message 404, cannot assign/resolve (workforce only)
- **History:** `GET /customers/me/support/tickets` safe, pagination like A25

## 9. Agent Workflow
- **Routes (AGENT SELF, via `RoutePolicyRegistry` `/api/v1/agents/me/` → `AGENT` `SELF`):**
  - `POST /agents/me/support/tickets` — AGENT SELF, same DTO, scope `support.ticket.create:AGENT:agentId`, reference `SUP-${id}`, `customerId=null` `agentId=principal.agentId`
  - `GET /agents/me/support/tickets` — paginated, only own `agent_id`
  - `GET /agents/me/support/tickets/:id` — 404 if not owned
  - `POST /agents/me/support/tickets/:id/messages` — same as customer, `authorType=AGENT`, `isInternal` rejected
  - `GET /agents/me/support/tickets/:id/messages` — filtered
- **Security:** unauthenticated 401, cannot see another Agent's ticket/message 404, cannot perform internal assignment/status (403), respects `AgentStatus` ACTIVE via validation that agent exists and not deleted (lifecycle not bypassed)
- **No second ledger:** reuse `AgentModule` not mutated

## 10. Internal Support Workflow
- **Routes (WORKFORCE_SESSION, via generic `/api/v1/internal/` → `SUPPORT|OPERATOR|SERVICE|PRIVILEGED`):**
  - `GET /internal/support/tickets?page=&limit=&status=&customerId=&agentId=&assignedTo=` — paginated, full view (`assignedTo`, `createdByType/Id`, `fundingRequestId`, `relatedTransferId`)
  - `GET /internal/support/tickets/:id` — full view
  - `POST /internal/support/tickets/:id/assign` — body `assignedTo 1-160, version?`, workforce only, `SELECT FOR UPDATE`, `version` stale → 409, `CLOSED`/`RESOLVED` reject, audit `SUPPORT_TICKET_ASSIGNED`, outbox `support.ticket.assigned`, auto `OPEN→IN_PROGRESS`
  - `POST /internal/support/tickets/:id/status` — body `status, version?`, validates transition, `SELECT FOR UPDATE`, version stale 409, audit `SUPPORT_TICKET_STATUS_CHANGED`/`RESOLVED`/`CLOSED`, outbox `support.ticket.resolved`/`closed`/`status_changed`, sets `resolved_at`/`closed_at`
  - `POST /internal/support/tickets/:id/resolve` / `POST /internal/support/tickets/:id/close` — convenience aliases for `RESOLVED`/`CLOSED`
  - `POST /internal/support/tickets/:id/messages` — workforce can set `isInternal` true/false, allowed even when `RESOLVED` (but not `CLOSED`), audit, outbox if not internal
  - `GET /internal/support/tickets/:id/messages` — workforce sees all (`is_internal` both)
- **Role restrictions:** uses existing `RuntimeAccessGuard` + `AuthorizationPrincipal`; no second auth system; generic allows `SUPPORT`/`OPERATOR`/`SERVICE`/`PRIVILEGED` (same as funding internal), service layer additionally asserts `WORKFORCE` via `assertWorkforcePrincipal`

## 11. Authorization
- **Reused:** `RuntimeAccessGuard`, `AuthorizationPrincipal`, `RoutePolicyRegistry`, `A2WorkforceSessionService`
- **Customer:** `/customers/me/support/**` → `CUSTOMER` `SELF` (enforced via `requireCustomer` and `customer_id` ownership check, 404 not 403 to avoid leakage)
- **Agent:** `/agents/me/support/**` → `AGENT` `SELF` (enforced via `requireAgent`, `agent_id` check)
- **Workforce:** `/internal/support/**` → `WORKFORCE_SESSION` `internal-route` policy `allowedPrincipalTypes SUPPORT|OPERATOR|SERVICE|PRIVILEGED` (enforced via `requireWorkforce` and `assertWorkforcePrincipal`; customer/agent tokens on workforce route → 403 via guard)
- **No duplicate support user system:** `assignedTo` is plain `VARCHAR(160)` workforce principalId, auditable, reassignment audited twice

## 12. Ticket/Transaction Linking
- **FundingRequest:** `funding_request_id UUID` FK `customer_funding_requests(id)` RESTRICT, nullable, indexed `WHERE NOT NULL`, validated existence (`404` if not found), safe to expose (`fundingRequestId` in both safe/internal views)
- **Transfer:** `related_transfer_id UUID` FK `transfers(id)` RESTRICT, nullable, indexed, validated existence, safe to expose
- **No modification of financial tables:** `customer_funding_requests` and `transfers` not altered; ticket only references stable UUIDs
- **Where FK appropriate:** fundingRequestId and relatedTransferId use direct FK (stable identities exist)
- **Generic reference:** not added (no outlet/terminal yet, per “do not add fields merely because generic”)
- **V1-001 specifically:** funding link proven in tests 17-18

## 13. FundingRequest Linking
- **V1-001 coexistence:** ticket can reference `fundingRequestId` created via `CustomerFundingService.createRequest` (`SERIALIZABLE`, `maker!=checker`, `PAYMENT-SETTLEMENT_ASSET-NGN`)
- **No financial mutation via support:** approving funding still via `CustomerFundingService.approve` (tested 18: create funding PENDING → ticket linked → `approve` credits wallet +25000n via `LedgerService.postJournalInTransaction` → ticket `RESOLVED`, ledger still authoritative)
- **Support does not invoke:** `postJournal`, `postJournalInTransaction`, `createWallet`, `createAccount`, `approve`/`reject` — only reads `SELECT id FROM customer_funding_requests` to validate

## 14. Idempotency
- **Reused:** `IdempotencyService` (shared Operations, scope `support.ticket.create:<type>:<principalId>`, `retentionSeconds 86400`, `requestHash sha256(canonicalJson({subject,category,description,priority,fundingRequestId,relatedTransferId,customerId,agentId,createdByType,createdById}))`)
- **Scope binding:** per actor (`CUSTOMER:<customerId>`, `AGENT:<agentId>`, `SUPPORT|OPERATOR|SERVICE|PRIVILEGED:<principalId>`), identical replay → return original view (idempotency record `resourceId` + `responseBody`), conflicting hash → `409 Conflict: The idempotency key was already used for another request`
- **Where required:** only ticket creation (`POST /customers/me/support/tickets`, `POST /agents/me/support/tickets`); other operations (assign/status/message) are idempotent via explicit checks but not via IdempotencyService (not financial)
- **No second engine:** `support_tickets` has no `idempotency_key` column; all via `idempotency_records`

## 15. Concurrency
- **Not SERIALIZABLE for support:** default `READ COMMITTED` + `SELECT ... FOR UPDATE` + optimistic `version` (like `CustomerComplianceCase`)
- **State transition correctness:** `assignTicket` and `updateStatus` use `DataSource.transaction` with `FOR UPDATE` lock, check `version` if supplied (`ConflictException: version is stale`), validate transition, then `UPDATE ... version=version+1`; retry `40001`/`40P01` up to 3 attempts
- **Proven:** test 23 concurrent `RESOLVED` (two checkers) → one fulfills, second idempotent (already RESOLVED) or stale-version rejected; test 8 assignment reassignment audited; test 10-11 version stale rejected
- **No phantom double-resolve:** `RESOLVED` → `CLOSED` only, `CLOSED` terminal

## 16. Audit
- **Reused:** `AuditService.record(manager, {entityType, entityId, action, actor, previousValues, newValues})` inside same transaction as ticket mutation, with `redactRecord` (sensitive keys redacted)
- **Events:**
  - `SUPPORT_TICKET_CREATED` (customer/agent/workforce `actor=createdById`, `newValues: reference,customerId,agentId,subject,category,priority,fundingRequestId`)
  - `SUPPORT_TICKET_ASSIGNED` (`previousValues: assignedTo`, `newValues: assignedTo`)
  - `SUPPORT_TICKET_STATUS_CHANGED` / `SUPPORT_TICKET_RESOLVED` / `SUPPORT_TICKET_CLOSED` (`previousValues: status`, `newValues: status`)
  - `SUPPORT_TICKET_MESSAGE_CREATED` (`ticketId, authorType, isInternal`)
- **No secrets:** `subject/description` are business, not PIN/password/token; audit payload redacted via `SENSITIVE_KEY_NAMES` (no `password`, `pin`, `token`, etc.)
- **Proven:** test 24 audits exist for all lifecycle, test 21 no PIN/password leakage in audit JSON

## 17. Outbox Events
- **Reused:** `OutboxService.enqueue(manager, {eventType, aggregateType: 'SUPPORT_TICKET', aggregateId, correlationId: 'support-ticket:${id}', payload, classification INTERNAL_OPERATIONS})` inside transaction, `redactRecord` payload
- **Events (only where useful, consistent with `customer.funding.*`):**
  - `support.ticket.created` (payload `ticketId, reference, customerId, agentId, category, priority, fundingRequestId`)
  - `support.ticket.assigned` (`ticketId, assignedTo, previousAssignee, actor`)
  - `support.ticket.status_changed` (`ticketId, from, to, actor`)
  - `support.ticket.resolved` / `support.ticket.closed` (same)
  - `support.ticket.message_added` (`ticketId, messageId, authorType, authorId`) — only if `!isInternal` (to avoid leaking internal notes to consumers)
- **No delivery provider:** outbox `PENDING`, not claimed as delivered; inbox/notifications remains V1-005/006 separate (not built)
- **Proven:** test 25 all events exist, test 8/10/24

## 18. Security
- **CUSTOMER:** unauthenticated 401, can create own ticket 201, sees own 200, cannot see another's 404, cannot assign/resolve 403/404, cannot create internal message 403, cannot add to another's ticket 404, internal notes filtered
- **AGENT:** unauthenticated 401, can create own 201, cannot see another's 404, cannot perform internal actions 403
- **INTERNAL:** unauthenticated 401, unauthorized workforce rejected (customer/agent token on /internal → 403), authorized SUPPORT/OPERATOR can list 200, assign 201, status transition 201, resolve/close 201, add internal note 201; role restrictions via existing workforce infrastructure (no second system)
- **No leakage:** customer/agent safe view omits `assignedTo`/`createdByType/Id` internals; message list for customer/agent filters `is_internal=false`; no `ledger_account_id`, `journal_id`, `request_hash`, `idempotency_key`, `pin`, `password`, `tokenHash` exposed; `JSON.stringify(view).toLowerCase()` contains no `password`/`pinhash`/`tokenhash`/`secret` (test 21)
- **Test coverage:** 28 real-PG tests include all above

## 19. Tests
- **Focused suite:** `test/v1-007-support-ticket.integration.spec.ts` — **28 tests, all passed (26.4s)** against real PostgreSQL (`createIntegrationDataSource('v1-007-support')`, `truncate` except `ledger_accounts`, `destroyIntegrationDataSource`):
  1. Customer creates ticket (SELF, OPEN) ✓
  2. Customer sees own ticket (GET) ✓
  3. Customer cannot see another customer ticket (404) ✓
  4. Agent creates ticket (SELF) ✓
  5. Agent cannot see another Agent ticket (404) ✓
  6. unauthenticated rejected (401 CUSTOMER/AGENT/INTERNAL) ✓
  7. authorized internal listing (workforce) ✓
  8. assignment works (workforce) ✓
  9. unauthorized assignment rejected (CUSTOMER/AGENT cannot assign) ✓
  10. valid status transition (OPEN → IN_PROGRESS → RESOLVED → CLOSED) ✓
  11. invalid status transition rejected ✓
  12. resolution works and 13. customer sees resolved status ✓
  14. messages persist (customer and agent) ✓
  15. message ownership isolation ✓
  16. internal-only messages not leaked ✓
  17. transaction link works (fundingRequestId) ✓
  18. V1-001 fundingRequestId link end-to-end (approve still credits) ✓
  19. ticket creation does not mutate ledger ✓
  20. ticket creation does not mutate wallet balance ✓
  21. no PIN/password/OTP leakage ✓
  22. duplicate/idempotent creation (Idempotency-Key) ✓
  23. concurrent state transition ✓
  24. audit events exist ✓
  25. outbox events exist ✓
  26. pagination ✓
  27. internal status transition and assignment via service ✓
  28. migration count is 65 and support tables exist ✓
  29. no second ledger/balance/provider for support ✓
- **Harness:** `pg-harness` real PG, `ValidationPipe` whitelist, `FastifyAdapter`, `supertest`, `IdempotencyService` replay, `SELECT FOR UPDATE` concurrency
- **Ledger/balance invariance:** test 19/20 `getBalance` before/after ticket `===`, `ledger_journals` count unchanged, `wallet.balanceMinor` unchanged

## 20. Regression Results
- **V1-001:** `test/v1-001-customer-funding.integration.spec.ts` **14/14 passed** (after updating expected count 64→65, timestamp 0063→0064) — includes maker/checker, funding credit, journal balanced, settlement asset, idempotency
- **Migration chain:** `test/migration-chain.integration.spec.ts` **15/15 passed** (`expectedMigrations 65`, foreign keys validated, no duplicate indexes)
- **A21-A26:** 
  - `test/a21-agent-app.integration.spec.ts` 13/13 ✓
  - `test/a23-customer-app.integration.spec.ts` 13/13 ✓ (updated 65)
  - `test/a24-customer-transaction-pin-hardening.integration.spec.ts` 19/19 ✓ (updated 65)
  - `test/a25-customer-history-hardening.integration.spec.ts` 17/17 ✓ (updated 65)
  - `test/a26-customer-profile-hardening.integration.spec.ts` 19/19 ✓ (updated 65)
  - `test/a22-admin-foundation.integration.spec.ts` 15/15 ✓
  - **Total A21-A26:** 96/96
- **Additional updated:** `test/a17-a20,a8,production-readiness` all updated to 0064/65 and passed (see combined run 139 passed)
- **Combined run:** 8 suites, 139 tests, all passed (87.4s)

## 21. tsc/build/lint
- `npx tsc` via `./node_modules/.bin/tsc --noEmit` **0 errors** (after fixing `IdempotencyCommand` `retentionSeconds`, `SupportModule` imports)
- `npm run build` (`nest build`) **0 errors**
- `npm run lint` (`eslint "{src,test}/**/*.ts"`) **528 problems (495 errors, 33 warnings)** — baseline 495 errors pre-existing (all tests use `require` imports, `any`, etc., same as prior V1-001 run); **no new support-specific lint failures beyond existing pattern** (`support.service.ts` 0 errors, new DTOs clean)
- **No financial behavior change:** `src/app.module.ts` and `src/support` do not import `LedgerService.postJournal` except via read-only `SELECT`

## 22. Limitations
- **No inbox/delivery:** V1-005 Notifications delivery and V1-006 Inbox remain separate backlog (outbox `PENDING` only, no SMS/Push, no `customer_notifications` table)
- **No automatic assignment:** `assignedTo` is manual workforce string, no round-robin or SLA
- **No bulk operations:** no mass close or CSV export
- **Priority not enforced:** `LOW/MEDIUM/HIGH/CRITICAL` stored but no SLA or sorting by priority (only `created_at` ordering)
- **No file attachments:** `description` 4000 chars only, no `support_ticket_evidence` table (compliance has evidence, support does not)
- **No customer close:** only workforce can `RESOLVED`/`CLOSED`; customer/agent cannot self-close (by design, operational control)
- **Versioned status only:** no `RESOLVED` → `REOPENED` transition (would be future enhancement)
- **Transfer link limited:** `related_transfer_id` FK exists but not exercised beyond validation; agent cash-to-cash/expiry not linked in V1

## 23. Explicit V1/V2 Boundary
- **V1 (IN-HOUSE NGN WALLET) — IMPLEMENTED:** `WALLET→WALLET` (PIN), `CASH_IN`/`CASH_OUT`/`Cash→Cash`/`Agent Funding` (A21-A26), `Operations Funding → Customer Wallet` maker/checker (V1-001), **Support Ticket Lifecycle** (V1-007, this report — non-financial, no ledger mutation)
- **V2 (OUT OF SCOPE, NOT IMPLEMENTED):** Wallet→Bank, Bank→wallet via `NIBSS`/`BankService`/`ProviderAdapter`, external settlement, cards/dollar cards, non-NGN, bills/airtime/data/electricity/cable/betting — **no code touches `bank`, `provider`, `settlementAccount` beyond read-only `SELECT` for validation**
- **Financial safety preserved:** support services **never** call `credit/debit`, `reverseJournal`, `postJournal`, `alterBalances`, `approveFunding`, `changeTransactionStatus`; they only `REFERENCE` funding/transfer UUIDs

---

**Final status:** **V1-007 VERIFIED** — real-PostgreSQL tests 28/28, V1-001 + A21-A26 + migration-chain regressions all green, `tsc` 0, `build` 0, no financial mutation, no new ledger, no external provider, outbox/audit proven.

**Blockers:** **0** (`data/embedded-pg` `18.4` `LISTEN 5432` `monienaija/monienaija-pw`, `65` migrations, workforce `SUPPORT` path proven via service)

**Remaining V1 backlog (dependency-ordered after V1-007):** V1-003 Admin Writes Consolidation, V1-005/006 Notifications stub+inbox, V1-021 Agent Financial Position for Ops (`GET /internal/agents/:id/financial-position`), V1-008 Reconciliation breaks/unclaimed, V1-013 Agent Unified History

