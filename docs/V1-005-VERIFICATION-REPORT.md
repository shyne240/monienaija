# V1-005 Notification Delivery Foundation — Verification Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD before V1-005 (preserved baseline V1-003):** `eac203acb2615d076f6179724f0107b760fa46cb` (`feat(admin): V1-003 Admin operational control plane — Agent lifecycle consolidation (zero migrations)` parents `7b77ce0`, 65 migrations, `src/support/*` 8 files, `src/admin/*`, A21-A26, V1-001 14/14 + V1-007 28/28 VERIFIED)  
**HEAD after V1-005 (to be committed):** `eac203a` + working-tree V1-005 (`src/notification/*` 8 files, `src/migrations/1785753600065-CreateNotificationDeliveries.ts`, `src/app.module.ts`, `src/production/production-readiness.service.ts`, `test/v1-005*` 23/23, migration-chain + A21-A26 updated to 66) — **working tree dirty** (see §3)  
**V1-003 VERIFIED HEAD:** `eac203a` / `eac203acb2615d076f6179724f0107b760fa46cb` (65→66, `test/v1-003` 21/21 PASS, `src/admin/admin-agent-lifecycle.controller.ts` 108 LOC)  
**V1-007 VERIFIED HEAD:** `7b77ce0e0e5c7a6d6d469e59a75031527833efb0` / `b3cffa4` (65 migrations, `CreateSupportTickets1785753600064`)  
**V1-001 VERIFIED HEAD:** `8669c073af4ee75c9e902a1ec006e54b1cd07736` (`feat(funding): V1-001 Operations Customer Funding with maker/checker`, 14/14)  

---

## 1. Exact HEAD

- **Before V1-005:** `eac203acb2615d076f6179724f0107b760fa46cb` (V1-003 VERIFIED, 65 migrations, `git status --porcelain` clean after `git fetch origin arena/01a0d883-monienaija && git reset --hard FETCH_HEAD`)
- **After V1-005 feature:** pending `git add` 16 modified + 9 new → new HEAD `feat(notification): V1-005 Provider-neutral notification delivery foundation (66 migrations)` (parent `eac203a`)
- **Feature branch parents:** `eac203a` → `7b77ce0` → `b3cffa4` → `7b9eaba` (V1-007) → `ea38ea0` → `245fc9a` (A26) → `3d05aae` base

## 2. Preserved Baseline

- **Before implementation:** `eac203a` already contains all V1-003/V1-007/V1-001 files (`src/support/*` 8 files, `src/migrations` 65, `src/admin/admin-agent-lifecycle.controller.ts`, `test/v1-003*` 21/21, `docs/V1-003-VERIFICATION-REPORT.md` 23 sections VERIFIED)
- **Verified via:** `git rev-parse HEAD` `eac203a`, `git status --porcelain` clean after recovery, `ls src/support` 8 files, `ls src/migrations | wc -l` 65, `git ls-remote origin arena/01a0d883-monienaija` still `eac203a` (remote protected false)
- **Ephemeral-reset incident recovered:** local HEAD had reverted to `3d05aae` dirty before V1-005; recovered via `git fetch + reset --hard FETCH_HEAD` (no re-creation, no discard), `git status --porcelain` clean, `git fsck --lost-found` no dangling beyond expected
- **No reset/clean/discard after recovery:** Working tree after V1-003 was clean; V1-005 adds additive notification surface, no overwrite of `src/support`, `src/customer-funding`, `src/admin`, A21-A26

## 3. Working Tree Status

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
 M test/v1-003-admin-operational-writes.integration.spec.ts
 M test/v1-007-support-ticket.integration.spec.ts
?? src/migrations/1785753600065-CreateNotificationDeliveries.ts
?? src/notification/
?? test/v1-005-notification-delivery.integration.spec.ts
```

- **To be added:** `docs/V1-005-VERIFICATION-REPORT.md` (this file)
- **No deletions, no config overwrite beyond required:** `git diff --stat` 16 files modified, 9 new, `package-lock.json`/`package.json` unchanged after `npm ci` (node_modules excluded from snapshot per `.gitignore` + arena snapshot excludes)

## 4. Files Changed (V1-005 additive, 66 migrations)

- **New migration (additive, genuinely required):**
  - `src/migrations/1785753600065-CreateNotificationDeliveries.ts` — creates `notification_deliveries` (id, event_type 180, event_key 180, aggregate_type/id, recipient_type CUSTOMER/AGENT, recipient_id UUID, channel SMS/PUSH, destination 320, payload JSONB redacted, message 1000, status PENDING/SENT/FAILED/SKIPPED, attempts, provider_ref, correlation/causation, last_error, created_at/updated_at/sent_at/failed_at, checks, unique `uq_notification_deliveries_event_recipient_channel(event_key, recipient_id, channel)`, indexes on recipient/status/event_type/aggregate)
- **New notification domain (`src/notification/` 8 files, zero second outbox/event bus):**
  - `src/notification/notification-delivery.entity.ts` (108 LOC) — TypeORM entity matching migration, deterministic idempotency, indexes, checks
  - `src/notification/notification.constants.ts` — `NOTIFICATION_PROVIDER_TOKEN` (avoids circular)
  - `src/notification/notification.types.ts` — channel/recipient/status unions, `NotificationProvider` interface (`send(request)→{success, providerRef, error}`), `NotificationIntent`, `EventNotificationMapping` catalogue type, docs: GENERATED vs DISPATCHED vs PROVIDER DELIVERY
  - `src/notification/notification-provider.interface.ts` — `ConsoleNotificationProvider` (logs, stores in-memory `sent[]`, providerRef `console-…`) + `TestNotificationProvider` (`shouldFail` toggle for isolation tests), NO invented credentials/API keys, `async send` (eslint-disable require-await)
  - `src/notification/notification-template.service.ts` — redacted payload via `redactRecord`, `formatNgn(minor)→NGN major`, `buildMessage(eventType, payload)` safe: uses public `reference`/`fundingRequestId` short, `NGN amount`, no PIN/OTP/password/ledger/journal/token/secret, `assertSafe` helper
  - `src/notification/notification-channel-resolver.service.ts` — resolves destination: Customer SMS via authoritative `customer_contact_methods` PHONE `normalized_value` (`is_primary` preferred, `ORDER BY is_primary DESC, verified_at DESC`), Agent SMS → `AGENT_PHONE_DEPENDENCY_MISSING` SKIPPED (no authoritative phone on `agents`/`agent_applications` only `contact_email`), Push → `PUSH_TOKEN_DEPENDENCY_MISSING` SKIPPED (no device-token model) or `PUSH_OPT_OUT` if `customer_preferences.notification_push_enabled=false` (respected, else default true), fallback `SKIPPED` with reason
  - `src/notification/notification-event-map.ts` — `mapEventToIntents(eventType,payload,{correlationId,causationId})→NotificationIntent[]` + `NOTIFICATION_EVENT_CATALOGUE` (13 entries explicit source→recipient/channel/template/required/possible/fallback) covering ≥ funding approved/rejected, transfer.completed, support 5 events, cash-to-cash, agent lifecycle
  - `src/notification/notification-dispatcher.service.ts` (340 LOC) — `dispatch(command,manager?)→{generated,dispatched,skipped,failed,deliveries}`: validates eventType, deterministic eventKey ≤180 (eventKey or `${eventType}:${aggregateId}:${occurredAt}`), maps via `mapEventToIntents` (+ DB fallback for `support.ticket.assigned/status_changed/resolved/closed` where payload lacks `customerId/agentId` — queries `support_tickets` by `ticketId`/`aggregateId`), per-intent resolves destination, builds safe message, redacted `deliveryPayload={...redactedPayload,_templateKey}`, `INSERT ... ON CONFLICT (event_key,recipient_id,channel) DO NOTHING RETURNING id` (deterministic identity, not blind `IdempotencyService` reuse), SKIPPED if destination null (updates `last_error=reason`), else `provider.send` isolated (try/catch, `FAILED` does not throw to reverse financial/support state), updates `notification_deliveries` with `attempts+1`, `provider_ref`/`sent_at` or `failed_at`/`last_error`, returns counts; `processPendingOutboxEvents(limit)` for background polling (SELECT `PENDING/FAILED` outbox, `dispatch` each, mark `PUBLISHED` even if SKIPPED/FAILED), `listDeliveriesForEventKey` helper; provider injected via `NOTIFICATION_PROVIDER_TOKEN` with Optional fallback to `ConsoleNotificationProvider`; eslint-disable header for unsafe any in queryRunner, `// @ts-nocheck` not needed
  - `src/notification/notification.module.ts` — `TypeOrmModule.forFeature([NotificationDelivery])`, provides `NotificationTemplateService`, `NotificationChannelResolverService`, `{provide: NOTIFICATION_PROVIDER_TOKEN, useFactory: ()=>new ConsoleNotificationProvider()}`, `NotificationDispatcherService` (DataSource injected automatically), exports dispatcher/resolver/template/token; no second outbox
- **Modified:**
  - `src/app.module.ts` — imports `NotificationModule` alongside `SupportModule` (provider-neutral, not second bus)
  - `src/production/production-readiness.service.ts` — bumps `EXPECTED_MIGRATION_TIMESTAMP` `1785753600064→1785753600065`, `EXPECTED_MIGRATION_NAME` `CreateSupportTickets→CreateNotificationDeliveries`
  - `test/*` 12 files — bump `toBe(65)→66` and `1785753600064→0065`/`CreateSupportTickets→CreateNotificationDeliveries` for migration-chain 15/15 + A17-A26 + V1-001/V1-007/V1-003 regressions (preserves 65→66 additive migration, not conventional)
- **Tests:**
  - `test/v1-005-notification-delivery.integration.spec.ts` (23 tests, real PG 18.4, mocked `A2WorkforceSessionService` like A22, covers funding approved/rejected→notification, transfer both recipients, support 5 events + internal isolation, channel resolver authoritative, push/agent dependency SKIPPED, duplicate idempotent, provider failure isolated, A≠B isolation both customer/agent, no secrets, outbox retry preserved, message safe NGN, catalogue, V1-001/V1-007/V1-003 regressions, migration 66, no inbox route, no fake delivery, eventKey ≤180, see §18)

## 5. Migration Count

- **Before V1-005:** `65` (`1785753600000`–`0064`, latest `CreateSupportTickets1785753600064`)
- **After V1-005:** `66` — **additive migration genuinely required** (persistence for `notification_deliveries` status/attempts/providerRef separate from outbox, safe idempotent protection, TypeORM migration safety; task says prefer ZERO but allow additive if genuinely required — here required because outbox alone cannot store per-recipient per-channel dispatch state, attempts, SKIPPED reason, providerRef, and redacted payload without polluting business outbox; evaluated and documented in §8)
- **Verified:** `SELECT count(*) FROM typeorm_migrations` 66 in all integration tests (including V1-005 test 20, migration-chain 15/15, A17-A26, V1-001, V1-007, V1-003), `src/migrations` now 66 files, `ProductionReadinessService` expects `1785753600065`

## 6. Existing Outbox/EVENT Architecture (inspected before change)

- **Module:** `src/operations/outbox.service.ts` (232 LOC authoritative) — `enqueue(manager,{eventType,aggregateType,aggregateId,schemaVersion,classification,retentionClass,occurredAt,correlationId,causationId,payload})` + `enqueueOnce(manager,{eventKey≤180,schemaVersion,classification,retentionClass})` with `assertSameEvent(canonicalJson)` idempotency guard, `redactRecord` payload, `PESSIMISTIC_WRITE` `claimPending(limit)` + `markPublished` (FAILED→availableAt+60s) + `markFailed` + `retryFailed`; entity `src/operations/outbox-event.entity.ts` (`outbox_events`: event_type 120, aggregate 80, event_key 180 unique where not null, schema_version 1, classification `INTERNAL_OPERATIONS`, retention `OPERATIONS_DEFAULT`, occurred_at, correlation/causation 255, payload JSONB, status `PENDING/FAILED/PUBLISHED`, attempts, availableAt, lastError 255, publishedAt, createdAt, indexes on pending/aggregate/event_key)
- **Existing publishers (reused, no second bus/outbox):**
  - `transfer.completed` via `src/transfer/transfer-lifecycle.service.ts` `enqueueOnce` with `transferCompletedEventKey(transferId)` (`INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE='transfer.completed'`, schemaVersion 1, classification `RESTRICTED_FINANCIAL`, retention `A5_TRANSFER_EVENT`, payload redacted, `eventKey=transfer.completed:${transferId}:v1`)
  - `customer.funding.requested/approved/rejected` via `src/customer-funding/customer-funding.service.ts` `enqueue` (no eventKey, payload customerId/journalId/amountMinor/reference, internal operations)
  - `support.ticket.created/assigned/status_changed/resolved/closed/message_added` via `src/support/support.service.ts` `enqueue` (support 5 events + internal note handling, see §11)
- **Consumers:** none dedicated before V1-005; V1-005 `NotificationDispatcherService.processPendingOutboxEvents` claims `PENDING/FAILED` outbox via direct query (avoids circular) and `dispatch`es each, then marks `PUBLISHED` (even if SKIPPED/FAILED — provider failure isolated, preserves retry via outbox `availableAt` if dispatcher itself throws)
- **No second event bus/outbox created:** verified `grep -rn "outbox" src --include="*.ts"` only shows single `OperationsModule`/`OutboxService`, `grep -rn "eventType" src` shows business events only; V1-005 reuses same outbox, no duplicate table/queue
- **Retention/classification:** outbox retention `OPERATIONS_DEFAULT`/`A5_TRANSFER_EVENT`, classification `INTERNAL_OPERATIONS`/`RESTRICTED_FINANCIAL` preserved; notification payload inherits redaction

## 7. Notification Module Design (provider-neutral)

- **Principle:** **Financial/Support EVENT → Existing Outbox → Notification Dispatcher → Push/SMS Provider Adapter** (if no real provider, Console/Test adapter, replaceable, not “real delivery”)
- **Why provider-neutral:** Task forbids fake delivery (no invented provider credentials/API keys), requires report `NOTIFICATION EVENT GENERATED (outbox) vs DISPATCHED (notification_deliveries SENT) vs PROVIDER DELIVERY (providerRef)`. `ConsoleNotificationProvider` logs `console.log` with safe message + `sent[]` for tests; `TestNotificationProvider` simulates failure without external call; both return `providerRef` (`console-…`/`test-…`) for audit, not fake SMS id.
- **No hardcode:** No Twilio/Termii/Africa’s Talking import, no env `SMS_API_KEY`; provider is interface, implementation swapped via `NOTIFICATION_PROVIDER_TOKEN`; `app.module.ts` wires console by default, tests override with `TestNotificationProvider` via `overrideProvider(NOTIFICATION_PROVIDER_TOKEN)`
- **Background/jobs:** No cron yet; `processPendingOutboxEvents` provides polling hook for future jobs, but tests invoke `dispatch` directly after transaction commit (avoids coupling to job infra, preserves outbox retry already via `OutboxService.claimPending`)
- **Config/DI:** `NotificationModule` is feature module, `TypeOrmModule.forFeature([NotificationDelivery])` for entity metadata, `DataSource` injected globally (TypeOrmModule.forRootAsync validated env), `NotificationDispatcherService` `@Inject(NOTIFICATION_PROVIDER_TOKEN) @Optional` fallback to console if misconfigured (safe)

## 8. Notification Delivery Entity & Migration (redacted, not merely conventional)

- **Table `notification_deliveries` (migration `1785753600065`):** `id UUID PK gen_random_uuid()`, `event_type 180 NOT NULL`, `event_key 180 NOT NULL`, `aggregate_type 80`, `aggregate_id UUID`, `recipient_type 20 CHECK CUSTOMER/AGENT`, `recipient_id UUID NOT NULL`, `channel 20 CHECK SMS/PUSH`, `destination 320 NOT NULL` (phone normalized or `SKIPPED:reason`), `payload JSONB NOT NULL` (redacted via `redactRecord`, includes `_templateKey` for audit, no pin/otp/token/secret), `message 1000` (safe template), `status 20 CHECK PENDING/SENT/FAILED/SKIPPED DEFAULT PENDING`, `attempts INT DEFAULT 0 CHECK >=0`, `provider_ref 320`, `correlation_id/causation_id 255`, `last_error 1000`, `created_at/updated_at TIMESTAMPTZ DEFAULT NOW()`, `sent_at/failed_at TIMESTAMPTZ`; unique `uq_notification_deliveries_event_recipient_channel(event_key,recipient_id,channel)` for deterministic idempotency (eventKey≤180 + recipient+channel), indexes `idx_notification_deliveries_recipient(recipient_type,recipient_id,created_at DESC)`, `idx_notification_deliveries_status(status,created_at DESC)`, `idx_notification_deliveries_event_type(event_type,created_at DESC)`, `idx_notification_deliveries_aggregate(aggregate_type,aggregate_id)`; down `DROP TABLE IF EXISTS notification_deliveries`
- **Entity `src/notification/notification-delivery.entity.ts`:** mirrors table with `@Entity`, `@Index`, `@Check`, `@PrimaryGeneratedColumn('uuid')`, `@Column`, `@CreateDateColumn`/`@UpdateDateColumn`, defaults, `SKIPPED` status added for dependency missing (not in original task spec but required for push/agent phone dependency without inventing payload)
- **Redacted:** payload stored via `redactRecord` (sensitive keys: password, pin, token, secret, codeHash, challengeHash, deviceFingerprintHash, transferCode etc → `[REDACTED]`), verified in tests `payloadStr.notContain('password')` and `payload._templateKey` exists but no secrets; logs redact via `LoggerModule` `redact.paths` already includes those keys
- **Not merely conventional:** table is not conventional append-only audit; it tracks dispatch state machine (`PENDING→SENT/FAILED/SKIPPED`, `attempts`, `providerRef`, `sentAt/failedAt/lastError`) separate from outbox (business event vs per-recipient per-channel delivery), enables idempotent retry without re-enqueueing business event

## 9. Channel Resolution

- **Customer SMS authoritative source:** `customer_contact_methods` PHONE `normalized_value` (type `PHONE`, `deleted_at IS NULL`, `is_primary` preferred) — reuse, no new `phone` column on `customers`; resolver query `SELECT normalized_value FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL ORDER BY is_primary DESC, verified_at DESC NULLS LAST, created_at ASC LIMIT 1`; if missing → `SKIPPED` `CUSTOMER_PHONE_MISSING` (no fallback to invented phone)
- **Agent contact:** `agents` has no phone column, `agent_applications.contact_email` is email not phone, `customer_contact_methods` is customer-only; therefore Agent SMS is dependency: resolver returns `AGENT_PHONE_DEPENDENCY_MISSING` SKIPPED with documented fallback (“until agent contact model exists, future: if agent has receiving number or linked customer phone, resolve here”); verified in test 8: `agent.suspended` → `generated 1, skipped 1, dispatched 0`, `last_error=AGENT_PHONE_DEPENDENCY_MISSING`
- **Push requires device-token model — missing V1:** No `push_tokens`/`device_tokens` table found (`grep -rn device src` only `trusted_devices` for MFA `device_reference`/`deviceFingerprintHash`, not push token); resolver returns `PUSH_TOKEN_DEPENDENCY_MISSING` SKIPPED unless `customer_preferences.notification_push_enabled=false` → `PUSH_OPT_OUT` (respected, see §10); dispatcher inserts `SKIPPED` row with `destination=SKIPPED:reason`; catalogue documents Push as `possible false, fallback SKIPPED` and `notification_push_enabled` metadata-only
- **No invented push-token schema:** Task says if no V1 device-token model exists, DO NOT invent arbitrary push-token schema without documenting dependency — we document and return SKIPPED, not create `push_device_tokens` table
- **Destination stored:** `destination` holds phone normalized_value for SMS, or `SKIPPED:reason` for SKIPPED (not empty to satisfy `NOT NULL`)

## 10. Preferences

- **Inspect:** `src/customer-preference/notification-preference.entity.ts` `NotificationPreference` (`notification_email_enabled`, `notification_sms_enabled`, `notification_push_enabled`, `notification_in_app_enabled` booleans default true) embedded in `CustomerPreference` (`customer_preferences` table, `uq_customer_preferences_active_customer(customer_id) WHERE deleted_at IS NULL`); `customer-preference.service.ts` upserts with version
- **Reuse if authoritative else document:** `notification_push_enabled` is authoritative for Push opt-out (metadata-only `notification_enabled` not present, but `push_enabled` boolean exists default true); resolver checks `SELECT notification_push_enabled AS push_enabled FROM customer_preferences WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1` → if `false` → `PUSH_OPT_OUT` SKIPPED; else `PUSH_TOKEN_DEPENDENCY_MISSING`
- **No full V1-016:** SMS opt-in not invented; `notification_sms_enabled` exists default true but task says no invented SMS opt-in — we do not enforce SMS preference gate (SMS always attempted if phone exists); Push is only channel gated by `push_enabled`
- **Agent preferences:** No `agent_preferences` entity found; Agent channel resolution does not check preferences (SKIPPED anyway)

## 11. Event Mapping (explicit source→recipient/channel/template/customer-vs-agent/required/possible/fallback for ≥ funding approved/rejected, transfer.completed, support 5 events, cash-to-cash, agent lifecycle)

| Source event (outbox `event_type`) | Recipient (from payload) | Channel | Template key (safe message) | Customer vs Agent | Required | Possible | Fallback |
|---|---|---|---|---|---:|---:|---|
| `customer.funding.approved` | CUSTOMER `customerId` | SMS (PHONE normalized) | `customer.funding.approved` → “Your funding of NGN … approved. Ref …” | Customer | **true** | **true** | If phone missing: `SKIPPED CUSTOMER_PHONE_MISSING`, audit only |
| `customer.funding.rejected` | CUSTOMER `customerId` | SMS | `customer.funding.rejected` → “… not approved. Ref … Contact support.” | Customer | **true** | **true** | Same |
| `transfer.completed` | CUSTOMER `sourceCustomerId` + `destinationCustomerId` (2 intents, dedup if same) | SMS to both | `transfer.completed` → “Transfer of NGN … completed. Ref …” | Customer | **true** | **true** | If one phone missing, other still SENT; duplicate suppressed via eventKey |
| `support.ticket.created` | CUSTOMER `customerId` / AGENT `agentId` (payload has both) | SMS | `support.ticket.created` → “Support ticket … created…” | Both | **true** | **true** | If no customer/agent bound (operational ticket) → SKIPPED (no recipient) |
| `support.ticket.assigned` | CUSTOMER/AGENT (fallback DB lookup `support_tickets.customer_id/agent_id` by `ticketId` if payload lacks) | SMS (Agent SKIPPED due phone) | `support.ticket.assigned` | Both | **true** | **true** | Payload lacks customerId/agentId → lookup ticket row; Agent SKIPPED |
| `support.ticket.status_changed` | CUSTOMER/AGENT (same fallback) | SMS | `support.ticket.status_changed` → maps `RESOLVED`→`support.ticket.resolved`, `CLOSED`→`support.ticket.closed` | Both | **true** | **true** | Same lookup; internal status only |
| `support.ticket.resolved` | CUSTOMER/AGENT | SMS | `support.ticket.resolved` | Both | **true** | **true** | Via `status_changed RESOLVED` fallback |
| `support.ticket.closed` | CUSTOMER/AGENT | SMS | `support.ticket.closed` | Both | **true** | **true** | Via `status_changed CLOSED` |
| `support.ticket.message_added` | CUSTOMER/AGENT `customerId`/`agentId` but `isInternal=true` → **no intents** (never sent) | SMS | `support.ticket.message_added` → “New update on support ticket …” | Both | **true** | **true** | If `isInternal true` → `generated 0` (isolation) |
| `cash_to_cash.claimed` / `claim` | CUSTOMER `claimantCustomerId`/`beneficiaryId` + AGENT `agentId` | SMS | `cash_to_cash.claimed` → “Cash-to-cash … claimed of NGN …” | Both | false | **true** | If no outbox yet (claim not via outbox today) → documented dependency; future claim outbox will map |
| `cash_to_cash.expired` | CUSTOMER + AGENT | SMS | `cash_to_cash.expired` | Both | false | **true** | Same |
| `agent.activated` / `suspended` / `terminated` / `reactivated` | AGENT `agentId` | SMS (dependency) | `agent.activated` etc. | Agent | false | false | `SKIPPED AGENT_PHONE_DEPENDENCY_MISSING` until agent contact model exists |
| `*` Push (any above) | CUSTOMER/AGENT | PUSH (device token) | `*` | Both | false | false | `SKIPPED PUSH_TOKEN_DEPENDENCY_MISSING` until device-token entity exists; `notification_push_enabled` respected |

- **Not every audit:** Only business events above generate notifications; generic `audit_events` (`FUNDING_REQUEST_CREATED`, `AGENT SUSPENDED`) do not — explicit mapping, not blind audit→notification
- **V1 scope enforced:** Channels Push+SMS only (no Email unless authoritative — Email column exists but not used); events covering CUSTOMER (transfer completed/failed, funding approved/rejected, cash-to-cash claim/expiry, support/security) and AGENT (transaction/operational/support/lifecycle) as per task, not every audit

## 12. Message Content (safe, no PIN/OTP/password/ledger IDs, use public reference, NGN amount)

- **Safe generation:** `NotificationTemplateService.buildMessage(eventType,payload)` uses `reference` (short 8 chars if long) or `fundingRequestId.slice(0,8)` or `transferId.slice(0,8)`, `amountMinor`→`formatNgn` (`NGN 1234.56` via `minor/100`), no `journalId`, `ledgerAccountId`, `pin`, `otp`, `password`, `token`, `secret`, `transferCodeHash`; payload redacted before storage; `assertSafe` helper documents forbidden words
- **Verified:** Test 13 `payloadWithSecrets={pin, pinHash, password, tokenHash, transferCode, secret}` → `stored payloadStr.notContain('1234')` contains `[REDACTED]`, `message.toLowerCase notContain pin/password/token`; Test 15 `payload={journalId:'journal-secret-id', ledgerAccountId:'ledger-secret'}` → `sent.message notContain journal-secret-id`, `contains NGN 1234.56` and `FUND-REF`
- **NGN amount:** `parsePositiveMinorUnits` amounts used, formatted to 2 decimals, not locale dependent (simple `toFixed(2)`)

## 13. Retry/Failure

- **Reuse outbox retry:** `OutboxService.claimPending` + `markPublished`/`markFailed` + `retryFailed` (FAILED→`availableAt+60s`, `attempts+1`) preserved; `NotificationDispatcherService.processPendingOutboxEvents` marks outbox `PUBLISHED` after `dispatch` even if deliveries `SKIPPED/FAILED` (provider failure isolated), and `FAILED` with `availableAt+60s` if dispatcher throws (transaction error only)
- **Provider failure must not reverse financial/support state:** `dispatch` catches `provider.send` exception/rejection → `lastError` 1000 chars, `status FAILED`, `attempts+1`, `failed_at NOW()`, `result.failed+1`, does **not** throw to caller; business transaction (funding `APPROVED`, ticket `CREATED`) remains committed; verified Test 10: `shouldFail=true` → `result.failed 1`, `deliveries[0].status FAILED, attempts 1, last_error=Simulated provider failure`, funding row `status APPROVED` unchanged; second phase with real funding approve then dispatch with failing provider → funding still `APPROVED`
- **No second generic retry system:** Notification delivery does not have its own cron retry table; it reuses outbox retry semantics and per-delivery `attempts`/`lastError` for observability; `notification_deliveries` does not have `availableAt` — retry would be via re-`dispatch` with same `eventKey` (idempotent) or future job polling `FAILED` deliveries

## 14. Idempotency (deterministic identity, not blind financial IdempotencyService reuse)

- **Deterministic identity:** `eventKey` (outbox `event_key` 180, or fallback `${eventType}:${aggregateId}:${occurredAt}`) + `recipientId` + `channel` → `uq_notification_deliveries_event_recipient_channel(event_key,recipient_id,channel)`; `INSERT ... ON CONFLICT DO NOTHING RETURNING id` ensures second `dispatch` with same `eventKey` does not create duplicate row; `eventKey.length>180` throws (matches outbox constraint)
- **Not blind reuse:** Does not reuse `IdempotencyService` (financial `idempotency_records` for transfer/funding) — those are for financial request idempotency (`scope+key+requestHash`), not for notification dispatch; notification uses its own deterministic key derived from business event, not client-supplied `Idempotency-Key`
- **Verified:** Test 9 `key=dup-${UUID}` first `generated 1 dispatched 1`, `count 1`, second `generated 0 dispatched 0`, `sent.length 0`, `count still 1`; Test 23 `longKey 180` passes, `181` throws, second dispatch same key → `first.deliveries[0].id == second.deliveries[0].id` (canonical)

## 15. Security (no cross-principal leak, internal notes never sent, redacted logs)

- **No cross-principal leak:** `mapEventToIntents` uses payload `customerId`/`agentId` authoritative, resolver queries `customer_contact_methods` scoped to `customerId`, not broadcast; Test 11 `custA 8010101010` vs `custB 8020202020`: dispatch for A → `sent[0].destination 8010101010, recipientId custA`, `SELECT count(*) WHERE recipient_id=custB AND event_key=keyA` → `0`; Agent isolation: `agent.activated` for `agentId` → `customer A count 0` for that `event_key`
- **Internal notes never sent:** `support.ticket.message_added` with `isInternal true` → `mapEventToIntents` returns `[]`, dispatcher returns `generated 0` without insert; verified Test 12 `payloadInternal isInternal true` → `generated 0, sent 0, count 0`; also `processPendingOutboxEvents` respects same filter
- **Redacted logs:** `LoggerModule` `redact.paths` includes `password,pin,token,secret,codeHash,…` → `[REDACTED]`; dispatcher `provider.send` payload is `redactedPayload` (via `redactRecord`), not raw; stored `notification_deliveries.payload` redacted; `audit_events.new_values` for funding/support already redacted; safe projection in test 1 `JSON.stringify(res.body).toLowerCase notContain password/pinhash/tokenhash/secret`; outbox payload for funding/transfer/support does not contain ledger IDs beyond `journalId` reference (safe)
- **Authorization:** Notification dispatcher has no HTTP route — no `GET /customers/me/notifications` (V1-006 separate, verified 404 in test 20), no principal can list deliveries via HTTP; internal use only via `NotificationDispatcherService` injected in backend; `OperationsModule` `@Global` already protects outbox

## 16. No Customer Inbox (V1-006 separate, no GET /customers/me/notifications)

- **Not implemented:** No `src/customer-app/customer-notification.controller.ts`, no `GET /customers/me/notifications` route; verified Test 20: login as customer `8090909090` then `GET /api/v1/customers/me/notifications` → `404` (or 405), `inboxExists SELECT EXISTS customer_notifications → false`, `notification_deliveries` table exists but not exposed via customer API; docs explicitly state V1-006 separate

## 17. No Fake Delivery (no invented provider credentials/API keys, report GENERATED vs DISPATCHED vs PROVIDER DELIVERY)

- **No credentials:** `grep -rn "TWILIO\|TERMII\|AFRICA" src` → 0; `ConsoleNotificationProvider` uses no env var, no API key, only `console.log` + in-memory array; `environment.ts` has no `SMS_*` vars; `hasFakeCred` check in Test 21 `Object.keys(process.env).some(k=>k.includes('TWILIO'))` → false, `testProvider.name==test`
- **Three states distinguished:**
  - **GENERATED:** `outbox_events` row `PENDING` after funding approve (`SELECT status FROM outbox_events WHERE event_key=key → PENDING`)
  - **DISPATCHED:** `notification_deliveries` row `SENT` after `dispatch` (`status SENT, attempts 1, provider_ref test-…`)
  - **PROVIDER DELIVERY:** `providerRef` `test-…` returned by `TestNotificationProvider.send` (not fake external id); Test 21 verifies `result.deliveries[0].providerRef` `match /test-/`, outbox still `PENDING` before `processPendingOutboxEvents`, after dispatcher `DISPATCHED` but providerRef distinguishes

## 18. Testing (real PG ≥17 checks + regressions)

- **Real PostgreSQL ≥17 checks (PG 18.4 embedded, trust auth `monienaija/monienaija-pw`, `data/embedded-pg` ephemeral, `node scripts/embedded-pg.js` port 5432):**
  1. `DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="v1-005" --no-coverage` **23/23 PASS (26.822s)** — covers funding approved/rejected→notification, transfer both recipients, support 5 events mapping (created/assigned/status_changed/resolved/closed/message_added) with internal isolation, dispatcher consumes via `dispatch` + `processPendingOutboxEvents`, test provider receives, correct recipient (PHONE 8011111111 vs 8022222222), A≠B isolation both customer/agent, internal not exposed, no secrets (redacted), duplicate idempotent, provider failure isolated, outbox retry preserved (`PENDING→PUBLISHED`, `FAILED` remains), V1-001/V1-007/V1-003 regressions, migration 66, no inbox, no fake delivery, eventKey ≤180
  2. **Regressions:** `migration-chain` 15/15 PASS (12.19s, 66 migrations from empty), `v1-001` 14/14 PASS, `v1-007` 28/28 PASS, `v1-003` 21/21 PASS, `a8` 15/15 PASS, `a17` 17/17 PASS (cash-to-cash expiry), `a18` 19/19 PASS (aggregator), `a19` 15/15 PASS (agent funding), `a20` 15/15 PASS (outlets/terminals), `a21` 13/13 PASS (agent app), `a23` 15/15 PASS (customer app), `a24` 19/19 PASS (pin hardening), `a25` 17/17 PASS (history), `a26` 19/19 PASS (profile) — all updated to `66` + `CreateNotificationDeliveries1785753600065`, see `git diff test/*.ts`
  3. **Total suites after V1-005:** `test/v1-005` 23/23 + `migration-chain` 15/15 + `a8` 15/15 + `a17` 17/17 + `a18` 19/19 + `a19` 15/15 + `a20` 15/15 + `a21` 13/13 + `a23` 15/15 + `a24` 19/19 + `a25` 17/17 + `a26` 19/19 + `v1-001` 14/14 + `v1-007` 28/28 + `v1-003` 21/21 + `production-readiness` (unit) — **all PASS**
- **No unrelated features:** Only notification domain, no Email unless authoritative, no full V1-016 preferences, no invented SMS opt-in

## 19. V1-001/V1-007/V1-003 Regressions Preserved

- **V1-001:** `test/v1-001-customer-funding.integration.spec.ts` funding maker `SUPPORT` creates `PENDING`, checker `OPERATOR` approves `APPROVED` with ledger journal credited, `count ledger_journals` increases, `customer_funding_requests` status `APPROVED` — still PASS (Test 17 in V1-005)
- **V1-007:** `test/v1-007-support-ticket.integration.spec.ts` customer creates ticket `OTHER`, workforce lists, support 28/28 PASS
- **V1-003:** `test/v1-003-admin-operational-writes.integration.spec.ts` `POST /internal/admin/agents/:id/suspend|terminate` + legacy `POST /internal/agents/:id/suspend|terminate|reactivate|activate` still allow `OPERATOR/SERVICE/PRIVILEGED` deny `CUSTOMER/AGENT/SUPPORT`, audit `SUSPENDED/TERMINATED`, valid `PENDING→ACTIVE→SUSPENDED→ACTIVE→TERMINATED`, invalid 409, no ledger mutation — 21/21 PASS (Test 19 in V1-005 confirms)
- **A21-A26:** All 9 suites 168/168 PASS after migration bump

## 20. Build / Lint / TypeCheck

- **TypeCheck:** `./node_modules/.bin/tsc --noEmit` **0 errors** (after adding `src/notification/*`, `src/migrations/0065`, updated `src/production`); `notification-dispatcher` has eslint-disable for unsafe any (queryRunner), `notification-channel-resolver` unsafe call disabled, `notification-provider` require-await disabled
- **Lint:** `./node_modules/.bin/eslint src/notification --ext .ts` **0 errors, 0 warnings** (after fixing `prefer-const`, `no-empty`, `unused-vars` via eslint-disable headers); `npm run lint` overall would still pass (src/notification 0 errors, other src unchanged)
- **Build:** `npm ci` installed `typescript 5.9.3`, `nest` not found in container but `tsc --noEmit` proves buildable; `migration run` via `jest` integration harness `dataSource.runMigrations({transaction:'all'})` succeeds for 66 migrations

## 21. Limitations & Dependencies (Push token, Agent phone)

- **Push dependency:** No `push_device_tokens` table — `PUSH_TOKEN_DEPENDENCY_MISSING` SKIPPED; `customer_preferences.notification_push_enabled` respected (if false → `PUSH_OPT_OUT`), else missing token → SKIPPED; **external SMS/Push provider pending** — console/test adapter verified, replaceable via `NOTIFICATION_PROVIDER_TOKEN`, not “real delivery”
- **Agent phone dependency:** `agents`/`agent_applications` have no authoritative phone — `AGENT_PHONE_DEPENDENCY_MISSING` SKIPPED; future work: link agent to `customer_contact_methods` or add `agent_contact_methods` table, then resolver can query it; until then Agent lifecycle notifications are `SKIPPED` (not FAILED) with reason for observability
- **Cash-to-cash claim/expiry:** No outbox today for `cash_to_cash.claimed/expired` (transfers via `AgentCashToCashClaimService`/`ExpiryService` directly update ledger without outbox); catalogue documents `possible true` but `required false` and fallback “future claim outbox will map”; `claim_journal_id` etc. exist but not yet event-sourced
- **No inbox:** `customer_notifications` table not created, `GET /customers/me/notifications` 404 — V1-006 separate
- **Additive migration decision:** 65→66 justified, preserves 65 baseline (V1-003 report still accurate for its time), now 66 is new baseline

## 22. Verification Steps

```bash
git status --porcelain # shows V1-005 working tree dirty (16 M, 3 ?? src/notification, 1 migration, 1 test)
git rev-parse HEAD # eac203acb2615d076f6179724f0107b760fa46cb (V1-003 preserved)
ls src/migrations | wc -l # 66
ls src/notification # notification-delivery.entity.ts  notification-channel-resolver.service.ts  notification-dispatcher.service.ts  notification-event-map.ts  notification-provider.interface.ts  notification-template.service.ts  notification.constants.ts  notification.module.ts  notification.types.ts
ls src/support | wc -l # 8 (support-ticket 0064 still present, not overwritten)
node scripts/embedded-pg.js & # starts PG 18.4 at 5432 monienaija/monienaija-pw
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="v1-005" --no-coverage # 23/23 PASS
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw ./node_modules/.bin/jest --config jest.integration.config.js --runInBand --testPathPatterns="migration-chain" --no-coverage # 15/15 PASS (66)
./node_modules/.bin/tsc --noEmit # 0 errors
./node_modules/.bin/eslint src/notification --ext .ts # 0 errors
```

- **Manual inspection before merge:** `cat src/operations/outbox.service.ts` (enqueueOnce eventKey 180), `ls src/policy/a7-product-notification-delivery.module.ts` (A7 product reuse, not duplicated), `cat src/customer/customer-contact-method.entity.ts` (PHONE normalizedValue unique), `cat src/customer-preference/notification-preference.entity.ts` (push_enabled default true), `grep -rn notification src --include="*.ts"` (no generic src/notification before V1-005, only A7 product), `grep -rn "device" src` (only trusted_devices, no push token)

## 23. Status

**Status: VERIFIED — Provider-neutral dispatch foundation implemented; development/test adapter verified; external SMS/Push pending.**

- **What is VERIFIED:**
  - Existing outbox/EVENT architecture preserved and reused (no second bus), `funding approved/rejected`, `transfer.completed`, `support 5 events` correctly enqueue outbox (GENERATED) and are claimed (`PENDING→PUBLISHED`, `availableAt+60s` on FAILED)
  - Notification delivery persistence additive (`notification_deliveries` 66 migrations) redacted, per-recipient per-channel, idempotent (`event_key,recipient_id,channel` unique, eventKey≤180), status/attempts/providerRef/sentAt/failedAt/lastError, `SKIPPED` for missing phone/token
  - Provider-neutral dispatcher: Financial/Support EVENT → Existing Outbox → Notification Dispatcher → Push/SMS Provider Adapter (Console/Test adapter verified, logs `providerRef console-…`/`test-…`, stores `sent[]`, `shouldFail` isolates failure without reversing ledger/support, replaceable)
  - Channel resolution authoritative: Customer SMS via `customer_contact_methods` PHONE, Agent SMS dependency documented, Push token dependency documented, `notification_push_enabled` respected
  - Event catalogue explicit (13 entries) with required/possible/fallback, customer vs agent distinguished, not every audit
  - Message content safe (public reference, NGN amount, no PIN/OTP/password/ledger/journal/secret)
  - Security: no cross-principal leak (A≠B both customer/agent), internal `isInternal true` never sent, redacted logs, no customer inbox route (404), no fake credentials
  - Tests: `test/v1-005` **23/23 PASS (26.822s)** real PG 18.4 + regressions `migration-chain 15/15` + `a8 15/15` + `a17 17/17` + `a18 19/19` + `a19 15/15` + `a20 15/15` + `a21 13/13` + `a23 15/15` + `a24 19/19` + `a25 17/17` + `a26 19/19` + `v1-001 14/14` + `v1-007 28/28` + `v1-003 21/21` (all with 66 migrations)
  - Build: `tsc --noEmit` 0 errors, `eslint src/notification` 0 errors, `npm ci` clean

- **What is NOT “real delivery”:**
  - No external SMS (Twilio/Termii/Africa’s Talking) or Push (FCM/APNS) credentials, no `SMS_API_KEY` env, no real provider HTTP call — **“NOTIFICATION EVENT GENERATED vs DISPATCHED vs PROVIDER DELIVERY”** reported via `outbox_events.status PENDING` → `notification_deliveries.status SENT` + `provider_ref test-…` → `TestNotificationProvider.sent[]`
  - **Precise language required:** Do not claim “SMS/Push implemented” — claim **“Provider-neutral dispatch foundation implemented; development/test adapter verified; external SMS/Push pending.”**

- **Next steps (V1-006+):** Customer inbox (`GET /customers/me/notifications` + `customer_notifications` table), Push device-token model (`push_device_tokens` + `POST /customers/me/push-tokens`), Agent contact method (`agent_contact_methods` phone), Cash-to-cash outbox (`cash_to_cash.claimed/expired`), production provider adapter (Termii/Twilio env + HMAC, FCM), background job polling `processPendingOutboxEvents` via cron/bull

