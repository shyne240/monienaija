# ARENA 3 — Notification Platform: EMAIL Delivery Infrastructure

- **Date:** 2026-10-27
- **Branch:** `arena/8e59e188-monienaija`
- **Integrated baseline:** `5206d8f52b0deccba31149c6e600d9e0d774a6cb` (expiry-worker integration report; merge `823293e`)
- **Implementation commits:** `4f9d99f` (infrastructure + unit tests), `145fd8e` (integration suite), `15a46e8` (lint parity), `1c2062c` (worker constructor back-compat fix), plus this document
- **Predecessor audit:** `docs/ARENA3-NOTIFICATION-INFRASTRUCTURE-AUDIT-20261027.md` (findings F-M1…M9, F-S1…S7; "email entirely absent")
- **Mission:** extend the existing reliable notification infrastructure (outbox → dispatcher → delivery rows → bounded-retry worker) to support **EMAIL** alongside SMS, without breaking any existing SMS/PUSH behaviour or security-critical direct-delivery path.

---

## 1. Executive summary

EMAIL is now a first-class channel across the whole notification pipeline:

| Layer | Change | SMS/PUSH impact |
|---|---|---|
| Channel model | `NotificationChannel = 'SMS' \| 'PUSH' \| 'EMAIL'` (types + entity `@Check`) | none |
| Database | Migration `1785753600097-AddEmailNotificationChannel` replaces the CHECK in place | existing rows untouched |
| Providers | `NOTIFICATION_EMAIL_PROVIDER_TOKEN` seam: `NoneEmailProvider` (dark default), `ConsoleEmailProvider` (dev/test), `TestEmailProvider`, `ResendEmailProvider` (production adapter) | SMS keeps `NOTIFICATION_PROVIDER_TOKEN` exclusively |
| Templates | `NotificationEmailTemplateLookup` seam (`NOTIFICATION_EMAIL_TEMPLATE_TOKEN`) + code-backed default; text body byte-identical to SMS `buildMessage` | SMS template switch untouched |
| Event map | `mapEventToIntents` **unchanged**; new `appendCustomerEmailIntents` invoked by the dispatcher only when email is configured | zero behaviour change while dark |
| Resolver | EMAIL branch: `notification_email_enabled` opt-out (same security-critical bypass as SMS), `customer_contact_methods` type=EMAIL, `CUSTOMER_EMAIL_MISSING` / `AGENT_EMAIL_DEPENDENCY_MISSING` | SMS/PUSH branches untouched |
| Dispatcher | Channel-routed provider selection; EMAIL renders subject/text/html; idempotent insert unchanged (`event_key, recipient_id, channel`) | SMS send path byte-identical |
| Worker | EMAIL retries route to the email provider, re-render subject/html from the persisted redacted payload, re-check email opt-out; bounded retries + `FOR UPDATE SKIP LOCKED` unchanged | SMS retry path untouched |
| APIs | New `AdminNotificationProviderController`: `GET internal/notifications/provider-status`, `POST internal/notifications/test-send` | diagnostics `VALID_CHANNELS` gains EMAIL |
| Catalogue | New function `notification.test_send` (OPERATIONS, EXECUTE, SUPER_ADMIN + OPERATIONS) | seed is insert-missing → propagates to existing DBs |

**Dark-by-default posture:** `NOTIFICATION_EMAIL_PROVIDER` defaults to `none`. While dark, the dispatcher generates **no EMAIL intents at all** (no SKIPPED-row churn, no table growth, existing `generated`/`dispatched`/`skipped` counts byte-identical — proven by the untouched v1-005 and hardening-09 suites), and the worker fails closed on any legacy FAILED EMAIL row (`WORKER_NO_EMAIL_PROVIDER_CONFIGURED`).

**Requirement 7 (acceptance vs delivery):** an EMAIL row reaching `SENT` means **"accepted by the provider API"** (providerRef = provider message id). Confirmed recipient delivery (bounce/delivered webhooks or status polling) is **not** implemented and is recorded as an outstanding integration requirement — exactly mirroring the existing Robase SMS posture.

---

## 2. Provider architecture

### 2.1 Seam

```ts
// notification.constants.ts
export const NOTIFICATION_EMAIL_PROVIDER_TOKEN = 'NOTIFICATION_EMAIL_PROVIDER';
export const NOTIFICATION_EMAIL_TEMPLATE_TOKEN = 'NOTIFICATION_EMAIL_TEMPLATE';
```

Both tokens are bound in `NotificationModule` and consumed via `@Optional()` injection by the dispatcher and worker. Email adapters implement the **existing** `NotificationProvider` interface (`send(NotificationSendRequest) → NotificationSendResult`), extended with optional EMAIL-only fields `subject?` / `html?` (ignored by SMS/PUSH providers). This keeps the outbox + dispatcher + delivery-row + retry machinery 100% shared — no second pipeline.

### 2.2 Adapters

| Adapter | `name` | Purpose | Behaviour |
|---|---|---|---|
| `NoneEmailProvider` | `none` | Default; email dark | `send()` → `{success:false, error:'EMAIL_PROVIDER_NOT_CONFIGURED'}` (fail-closed for worker retries after config rollback) |
| `ConsoleEmailProvider` | `console` | dev/test | logs + in-memory `sent[]`; **rejected in production** by the environment schema; never invents credentials |
| `TestEmailProvider` | `test` | integration tests | in-memory `sent[]`, `shouldFail`/`failMessage` simulation, rejects non-EMAIL channels |
| `ResendEmailProvider` | `resend` | production | HTTP adapter (below) |

### 2.3 ResendEmailProvider (production adapter)

Mirrors the `RobaseNotificationProvider` discipline point-for-point:

- `POST {RESEND_API_BASE_URL}/emails` (default `https://api.resend.com`), `Authorization: Bearer re_…` (key prefix enforced fail-fast by the environment schema).
- Body: `{from, to:[destination], subject, text, html?, reply_to?}` — `from`/`reply_to` from verified configuration; `text` bounded to 4 000 chars; `html` bounded to 64 000 chars.
- `Idempotency-Key: {eventKey}:{recipientId}:{channel}` (≤255) — identical deterministic identity to the delivery-row unique key, so even an adversarial double-submit is idempotent at the provider.
- Success: 2xx with string `body.id` → `providerRef`. 2xx without a usable id → `RESEND_UNRECOGNIZED_SUCCESS_RESPONSE` (never claims a false SENT).
- Failure: **stable bounded codes only** — `RESEND_HTTP_<status>:<name>` (name must match `^[a-zA-Z0-9._-]{1,80}$`, else `unknown`), `RESEND_TIMEOUT` (AbortController at `RESEND_REQUEST_TIMEOUT_MS`), `RESEND_NETWORK:<ErrorName>`, `RESEND_UNSUPPORTED_CHANNEL:<ch>`, `RESEND_INVALID_DESTINATION`, `RESEND_MISSING_SUBJECT`, `RESEND_EMPTY_BODY`. Response prose/bodies are never surfaced, logged, stored or thrown.
- Local destination validation (`^[^@\s,;"'<>()\\]+@[^@\s,;"'<>()\\]+\.[^@\s,;"'<>()\\]{2,63}$`, ≤254) — malformed addresses never reach the network.
- Subject sanitization (`sanitizeHeader`): CR/LF/control chars → space, whitespace collapsed, ≤300 (header-injection protection at the transport edge, in addition to the template layer).
- **Never throws** into dispatch/retry paths; notification failure never touches financial state (existing isolation contract preserved).
- The API key exists only in the `Authorization` header; it never appears in any result, error, log line, delivery payload or audit record (unit-test enforced).

> **Contract basis / outstanding verification:** the endpoint path, field names and idempotency semantics follow Resend's published HTTP API as understood at implementation time. The live provider documentation could not be re-fetched from this build sandbox (network allowlist). **Before production enablement, operations must re-verify against the provider's current docs and execute a controlled `POST internal/notifications/test-send`.** Recorded in §9.

### 2.4 Template rendering seam (Arena 1 coordination — requirement 10)

**No competing template registry was built.** The seam:

```ts
// notification.types.ts
export interface NotificationEmailTemplateLookup {
  buildEmail(templateKey: NotificationTemplateKey, payload: NotificationTemplatePayload): RenderedEmail;
}
export interface RenderedEmail { subject: string; text: string; html: string; }
```

- `templateKey` values are the existing 20-case `NotificationTemplateService` switch keys (`NotificationTemplateKey` union now declared in `notification.types.ts`).
- Payload keys are the existing **redacted** payload contract from `notification-event-map.ts` (plus `_templateKey`, already persisted by the dispatcher for retry re-render).
- **Integration point for Arena 1:** when the Arena 1 database-backed template registry lands, its email renderer implements `NotificationEmailTemplateLookup` and is bound to `NOTIFICATION_EMAIL_TEMPLATE_TOKEN` (replacing the `useExisting: CodeNotificationEmailTemplateService` binding in `NotificationModule`). Dispatcher, worker, idempotency, retry and channel resolution require **zero changes**.

Default implementation `CodeNotificationEmailTemplateService` (requirement 5):

- `text` = `NotificationTemplateService.buildMessage(templateKey, payload)` — **byte-identical to the SMS body** (SMS parity; integration-test enforced).
- `subject` = curated per-event map for live events; **generic fallback `'MonieNaija notification'`** for any unmapped key — internal event names never leak into customer-visible email (fixes the F-S3 class for the EMAIL channel), then `sanitizeEmailSubject` (no CR/LF/control, ≤200).
- `html` = fixed minimal inline-styled layout: doctype + charset, no scripts, no external resources, no dynamic CSS; every dynamic line entity-escaped via `escapeHtml` (`& < > " '`); template-injection markers (`{{…}}`) survive only as inert escaped text (unit-test enforced with hostile payloads).
- HTML email always carries the equivalent plain-text body (`text` never empty).

---

## 3. Channel model + database (requirements 1, 6)

### 3.1 Migration `1785753600097-AddEmailNotificationChannel`

```sql
-- up
ALTER TABLE notification_deliveries DROP CONSTRAINT chk_notification_deliveries_channel;
ALTER TABLE notification_deliveries ADD CONSTRAINT chk_notification_deliveries_channel
  CHECK (channel IN ('SMS', 'PUSH', 'EMAIL'));
```

- **Additive only:** same constraint name, no column/type changes, existing SMS/PUSH rows untouched (constraint replacement never rewrites data).
- **down() refuses** while any EMAIL row exists (delivery evidence — idempotency identities, provider refs — must never be destroyed to satisfy a downgrade; same discipline as the cash-to-cash locator migration), otherwise restores the narrower CHECK.
- Entity `@Check` and channel unions kept in sync (`notification-delivery.entity.ts`, `notification.types.ts`).
- Idempotency, bounded retries and concurrency safety are **inherited unchanged**: unique key `(event_key, recipient_id, channel)` now simply includes EMAIL as a distinct channel identity; `ON CONFLICT DO NOTHING`; worker claim via `UPDATE … FOR UPDATE SKIP LOCKED` with exponential backoff on `attempts < SMS_RETRY_MAX_ATTEMPTS`.
- Production-readiness marker synced: `EXPECTED_MIGRATION_TIMESTAMP='1785753600097'`, `EXPECTED_MIGRATION_NAME='AddEmailNotificationChannel1785753600097'` (`src/production/production-readiness.service.ts` + `test/production-readiness.spec.ts` fixture). Stale-head allowlists updated in `a8`, `a19`, `a20`, `v1-003`, `v1-007`, `v1-limit-02`. `agent-application-access-migration-upgrade` is scoped ≤095 (unaffected); count assertions elsewhere are `>=`-style (unaffected).

### 3.2 Resolver EMAIL branch

| Recipient | Resolution | SKIPPED reasons |
|---|---|---|
| CUSTOMER | preference `notification_email_enabled` (honored **before** contact lookup; security-critical events bypass opt-out — identical policy to SMS-V1-01, no new semantics) → `customer_contact_methods` type=EMAIL `normalized_value`, `ORDER BY is_primary DESC, verified_at DESC NULLS LAST, created_at ASC LIMIT 1` | `EMAIL_OPT_OUT`, `CUSTOMER_EMAIL_MISSING` |
| AGENT | none — `agent_applications.contact_email` is application-contact, **not** a verified delivery identity; using it would be inventing policy | `AGENT_EMAIL_DEPENDENCY_MISSING` (documented dependency) |

### 3.3 Event map

`mapEventToIntents` is **byte-preserved** (SMS/PUSH only). `appendCustomerEmailIntents(eventType, intents)` appends `{...intent, channel:'EMAIL'}` copies for **CUSTOMER** intents of already-live wired events only: `customer.funding.requested|approved|rejected`, `transfer.completed|failed|unknown`, `support.ticket.*` (six events, internal-note filtering inherited). `cash_to_cash.*` and `agent.*` are deliberately **not** augmented (beneficiary wiring out of mission scope; agent email is a dependency). The dispatcher invokes the helper **only when `emailProvider.name !== 'none'`**.

---

## 4. Delivery + retry execution (requirements 6, 7, 11)

**Dispatcher:** per intent — resolve destination → render (EMAIL via seam; SMS/PUSH via existing service) → idempotent insert (`message` column stores the plain-text body ≤1000 for **all** channels; subject/html are ephemeral render inputs, never persisted) → channel-routed send (`EMAIL → NOTIFICATION_EMAIL_PROVIDER_TOKEN`, everything else → `NOTIFICATION_PROVIDER_TOKEN`) → conditional SENT/FAILED update with `attempts+1`. SKIPPED rows keep the `SKIPPED:<reason>` destination convention.

**Worker retry:** claim SQL unchanged (FAILED, attempts<max, destination NOT LIKE 'SKIPPED:%', exponential backoff lease on `updated_at`). Per claimed row:
- SMS rows: unchanged path (opt-out re-check → `this.provider.send`).
- EMAIL rows: `notification_email_enabled` re-check at retry time (post-failure opt-out honored → SKIPPED `EMAIL_OPT_OUT`) → re-render subject/html from persisted `payload._templateKey` (fallback `event_type`) + persisted redacted payload via the template seam → send via the **email provider only**. Missing email provider binding → `WORKER_NO_EMAIL_PROVIDER_CONFIGURED`; missing template binding → `WORKER_NO_EMAIL_TEMPLATE_CONFIGURED` (both fail closed, bounded, auditable).
- EMAIL rows can never be re-sent through the SMS provider and vice versa (integration-test enforced both directions).

**Failure classification:** identical semantics — provider failure is isolated (FAILED + bounded retries + terminal auditable FAILED with `last_error`), never throws into financial flows, never reverses state.

---

## 5. Configuration + enablement runbook (requirement 3)

```bash
# .env — email stays DARK until explicitly configured
NOTIFICATION_EMAIL_PROVIDER=none            # none | console | resend (default none)
RESEND_API_BASE_URL=https://api.resend.com
RESEND_API_KEY=                             # re_… live key (server-side only)
RESEND_REQUEST_TIMEOUT_MS=10000             # 1000–60000
NOTIFICATION_EMAIL_FROM=                    # verified sender, e.g. MonieNaija <notifications@monienaija.ng>
NOTIFICATION_EMAIL_REPLY_TO=                # optional
```

Fail-fast validation (`validateEnvironment`, startup):
1. `NOTIFICATION_EMAIL_PROVIDER=resend` **requires** `RESEND_API_KEY` (≥16 chars) with the `re_` prefix **and** `NOTIFICATION_EMAIL_FROM` containing `@` — invalid config aborts startup, never degrades silently.
2. `NODE_ENV=production` **rejects** `console` (log-only adapter in production would write message bodies to stdout and deliver nothing). `none` remains legal in production: email is dark until operations enable it — unlike SMS, no OTP-gated flow depends on email today, so forcing a live email provider would exceed the mission.
3. `NOTIFICATION_EMAIL_REPLY_TO`, when set, must contain `@`. Bounds: base URL valid https URL ≤2048; timeout 1000–60000.

**Enablement procedure (production):**
1. Provision a verified sending domain/identity with the provider; obtain a live `re_…` API key (server-side secret store only — never in Admin Web, mobile clients, or repositories).
2. Set `NOTIFICATION_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `NOTIFICATION_EMAIL_FROM` (+ optional `REPLY_TO`); restart — startup fails fast on any misconfiguration.
3. `GET /api/v1/internal/notifications/provider-status` (workforce session with `notification.view_deliveries`) → confirm `email.provider='resend'`, `email.configured=true`, fingerprint `****<last4>`.
4. `POST /api/v1/internal/notifications/test-send` (workforce session with `notification.test_send`) to an operations-owned mailbox → confirm `status:'SENT'` + providerRef; **re-verify the live provider contract at this point** (§9).
5. Observe `GET /internal/notifications/deliveries?channel=EMAIL` for SENT/FAILED/SKIPPED mix; worker retries pick up FAILED rows automatically (bounded).
6. Rollback = set `NOTIFICATION_EMAIL_PROVIDER=none` and restart: dispatch stops generating EMAIL intents immediately; in-flight FAILED EMAIL rows fail closed at retry (`WORKER_NO_EMAIL_PROVIDER_CONFIGURED`/`EMAIL_PROVIDER_NOT_CONFIGURED`); existing SENT rows remain auditable.

---

## 6. API contracts (requirements 4, 8, 9)

New controller `src/admin/admin-notification-provider.controller.ts`, `@Controller('internal/notifications')`, registered in `AdminModule` (separate file to keep `admin-notification.controller.ts` and the Arena 1 merge surface stable). Both endpoints: workforce-authenticated principals only (CUSTOMER/AGENT/AGGREGATOR identities → 401) **plus fail-closed server-side function-scope checks** (403 `FUNCTION_MISSING`).

### 6.1 `GET /api/v1/internal/notifications/provider-status`

- **Auth:** workforce + `notification.view_deliveries` scope (same function that gates delivery diagnostics).
- **Read-only, non-secret.** Response (200):

```jsonc
{
  "channels": ["SMS", "PUSH", "EMAIL"],
  "sms":   { "provider": "console|robase", "baseUrl": "…|null", "configured": true|false,
             "keyFingerprint": "****<last4>|null", "timeoutMs": 10000 },
  "email": { "provider": "none|console|resend", "baseUrl": "…|null", "configured": true|false,
             "keyFingerprint": "****<last4>|null", "from": "…|null", "replyTo": "…|null", "timeoutMs": 10000 },
  "worker": { "enabled": false, "pollIntervalMs": 5000, "batchSize": 10,
              "retryMaxAttempts": 3, "retryBaseDelaySeconds": 60 }
}
```

- **Credential hygiene (requirement 4):** only the last-4 fingerprint of each key is exposed; full keys, Authorization headers and secret-ish field names never appear (integration-test scans every response body for `re_`, `robe_`, `bearer`, `apikey`, `api_key`). `configured` is computed from env truth, so it never implies delivery capability that isn't there.

### 6.2 `POST /api/v1/internal/notifications/test-send`

- **Auth:** workforce + **new catalogue function `notification.test_send`** (domain OPERATIONS, sensitivity OPERATIONAL, access EXECUTE, assignable, seeded to SUPER_ADMIN + OPERATIONS; catalogue seeding is insert-missing, so the function + assignments propagate to already-seeded databases on boot — unlike the capability registry, no manual refresh needed).
- **Request:** `{ "channel": "EMAIL" | "SMS", "destination": "<email ≤254 | E.164-ish phone>" }` — strict validation, 400 on anything else (multi-address, quoted, whitespace, control-char or over-length emails; malformed phones). Validation failures consume **no** rate-limit quota and write **no** audit rows.
- **Gate order:** auth (401) → function scope (403) → body validation (400) → provider availability (`EMAIL` + dark → 400 `PROVIDER_NOT_CONFIGURED`) → rate limit (429) → send → audit.
- **Rate limit (requirement 9):** 5 provider-reaching attempts per principal per rolling hour, counted durably from `audit_events` (`entity_type='NOTIFICATION_TEST_SEND'`, actor, `created_at` window) — survives restarts, no new table. 429 `NOTIFICATION_TEST_RATE_LIMITED`. Per-principal budgets are independent.
- **Content:** FIXED safe text (subject `MonieNaija notification test`; body states it is a controlled connectivity test with no financial content + the correlationId). Never template-driven, never renders event/financial data. EMAIL sends carry the escaped fixed layout html.
- **Routing:** EMAIL → email provider binding; SMS → existing SMS provider binding. Cross-channel routing is impossible (adapters reject foreign channels).
- **Response (201):** `{ "status": "SENT"|"FAILED", "channel", "correlationId", "destination": "<masked>", "provider", "providerRef": "…|null", "errorCode": "<bounded stable code>|null" }`.
- **Audit trail:** every provider-reaching attempt writes one `audit_events` row: `entity_type='NOTIFICATION_TEST_SEND'`, action `NOTIFICATION_TEST_SENT`/`NOTIFICATION_TEST_FAILED`, actor = principalId, correlationId, `new_values = {channel, destination: <masked: `te***@domain` / `+234*******678`>, provider, providerRef, errorCode}` — raw destinations never persisted.
- **No delivery row:** `notification_deliveries.recipient_id` is a CUSTOMER/AGENT uuid identity; workforce principals are neither, and inventing one would pollute delivery diagnostics and the inbox projection. The audit trail is the evidence (integration-test asserts zero delivery rows).
- `GET /internal/notifications/deliveries?channel=EMAIL` filter added (`VALID_CHANNELS` widened) — hardening-09 test 19 updated accordingly (EMAIL now 200; genuinely unknown channels still 400).

---

## 7. Security review against mission prohibitions

- **Credentials** (req 3, 4): server-side env only; fail-fast validation; last-4 fingerprint maximum exposure; unit + integration tests scan adapter results, HTTP responses, log-facing errors, delivery payloads and audit records for key material — none found. Redacted-payload discipline (`redactRecord`) unchanged for EMAIL rows.
- **Rendering** (req 5): entity escaping on every dynamic value; fixed layout; no scripts/external resources/dynamic styles; subject header-injection sanitization at **two** layers (template + adapter); text always accompanies html.
- **Opt-out parity** (req 11): EMAIL honors `notification_email_enabled` with the **same** security-critical bypass as SMS — no new opt-out policy invented; SMS/PUSH preference handling untouched. Direct-delivery security paths (desk OTP, registration OTP, temp credentials) do not use the dispatcher/event map and were not modified.
- **Not touched:** Admin Web (`apps/admin-web`), Agent Mobile (`apps/agent-mobile`), `capability.seed.ts` (Arena 1 conflict surface — email capability metadata recorded as a follow-up), cash-to-cash beneficiary wiring, agent locator, Arena 1 settlement code.

---

## 8. Test evidence (from own execution only)

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` | PASS (clean) |
| Unit (full) | `npm run test` | **196/196 suites, 2000/2000 tests** (baseline was 194/1974; +2 suites: `resend-email-provider.unit.spec` 19 tests incl. env-schema refinements, `notification-email-template.unit.spec` 7 tests) |
| New integration suite | `v1-email-notification-01.integration.spec.ts` (real PostgreSQL) | **21/21** — migration/constraint, dark posture, dispatch e2e + text parity, opt-out independence, missing-email skip, agent dependency, idempotency, worker retry routing/re-render/bounds/opt-out, SMS retry preservation, inbox projection, provider-status 401/403/200 + zero key material, test-send 401/403/400×8/429-after-5/audit-masked/no-delivery-row/SMS-routing/failure-code/hygiene |
| SMS regression (targeted) | `v1-005` (23), `v1-hardening-09` (21, incl. updated test 19) | **44/44 PASS** |
| Stale-head suites (targeted) | `a8` + `a19` + `v1-limit-02` | **60/60 PASS** |
| Lint | per-file eslint on all new/changed sources | no new errors/warnings vs baseline (dispatcher `prefer-const` warning proven identical at baseline `5206d8f`; migration type-import error matches 096 baseline parity) |
| Full sequential PostgreSQL regression | `PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=eml02full node scripts/run-pg-integration-tests.js` | **117/117 suites, 2262/2262 tests, EXIT=0** (§8.1) |

### 8.1 Full PostgreSQL regression result

`PG_TEST_CONCURRENCY=1 NODE_ENV=test node scripts/run-pg-integration-tests.js` (8 sequential batches, each suite on its own real PostgreSQL database; log `email-full-pg-2.log`):

- **117/117 suites PASSED, 2262/2262 tests PASSED, runner EXIT=0** (pre-mission baseline: 116 suites / 2241 tests — delta is exactly the new `v1-email-notification-01` suite, +21 tests).
- Includes every suite touched by this mission: `v1-email-notification-01` (21/21), `v1-005-notification-delivery` (23), `v1-hardening-09` (21), `sms-v1-01` (12), `a8`, `a19`, `a20`, `v1-003`, `v1-007`, `v1-limit-02`, `v1-release-01-production-readiness-migration-sync`, `agent-application-access-migration-upgrade` — all PASS.
- First full-run attempt (`email-full-pg.log`, 116 PASS / 1 FAIL) caught one real defect: `sms-v1-01` constructs `NotificationWorkerService` directly with 4 arguments, which the widened constructor rejected at compile time (TS2554). Fixed in `1c2062c` by defaulting the EMAIL bindings to `null` (existing direct constructions compile byte-unchanged; DI still injects real bindings; missing EMAIL binding still fails closed at retry). The clean rerun above is the authoritative evidence.

**No browser/device UAT was performed** (out of environment scope); no live provider calls were made (no credentials in this environment) — recorded in §9.

---

## 9. Outstanding integration requirements (recorded, not hidden)

1. **Live provider contract re-verification:** the Resend HTTP contract (endpoint path, request/response field names, idempotency semantics, error envelope) is implemented per the provider's published docs as understood at build time; the docs host is outside this sandbox's network allowlist. Before production enablement: re-verify against current provider docs + execute controlled test-sends (both a success and a deliberate failure) — §5 step 4.
2. **Arena 1 template registry binding:** when Arena 1's DB-backed registry merges, implement `NotificationEmailTemplateLookup` there and rebind `NOTIFICATION_EMAIL_TEMPLATE_TOKEN` (single `useExisting` swap in `NotificationModule`). Per-event email enablement/disablement configuration belongs to that registry (today: the fixed `EMAIL_ENABLED_CUSTOMER_EVENTS` set).
3. **Confirmed-delivery receipts (requirement 7 boundary):** bounce/delivered/complaint webhooks or status polling to distinguish provider acceptance from recipient delivery; a `delivered_at`/receipt status column would be additive.
4. **Agent EMAIL dependency:** `AGENT_EMAIL_DEPENDENCY_MISSING` until an authoritative verified agent email identity exists (deliberately NOT `agent_applications.contact_email`).
5. **Capability registry metadata:** email capability entries in `capability.seed.ts` deferred (Arena 1 is actively editing that file — conflict avoidance); catalogue function seeding needed no such deferral (insert-missing semantics).
6. **Inbox grouping:** EMAIL SENT rows project into the customer inbox alongside SMS rows (same event ⇒ two items). Product decision on per-event grouping/dedup belongs to the inbox/Arena 1 surface; behaviour documented and test-asserted as-is.
7. **Event coverage:** `deposit.*`/`withdrawal.*` remain enqueued-unmapped and `cash_to_cash.*`/`agent.*` remain never-enqueued (pre-existing audit findings F-M2/F-M4) — EMAIL inherits exactly the SMS event coverage, by design.

---

## 10. Requirements coverage matrix

| # | Requirement | Where |
|---|---|---|
| 1 | Channel model + DB constraints for EMAIL, SMS/PUSH records unbroken | §3.1; suite test 1 |
| 2 | Email provider abstraction compatible with outbox + dispatcher | §2.1–2.2 |
| 3 | Production-capable adapter, secure server-side credentials, fail-fast config | §2.3, §5 |
| 4 | Credentials out of responses/logs/payloads/audit | §6.1, §7; suite tests 14, 21; unit spec tests 3, 7 |
| 5 | Safe HTML + text rendering, output encoding, injection protection | §2.4; template unit spec tests 3–7 |
| 6 | Idempotent records, bounded retries, concurrency safety, failure classification | §3.1, §4; suite tests 7, 8, 9 |
| 7 | Provider acceptance vs confirmed delivery distinguished | §1, §9.3 |
| 8 | Read-only non-secret provider config/status API | §6.1 |
| 9 | Controlled test-send: authz, rate limit, destination validation, audit | §6.2; suite tests 15–20 |
| 10 | Coordinate with Arena 1; no competing template registry | §2.4, §9.2 |
| 11 | Existing SMS behaviour + direct-delivery paths preserved | dark posture §1; suite tests 2, 11; v1-005/hardening-09/a8/a19 regressions |
| 12 | Migration/unit/PostgreSQL tests + operational documentation | §8, this document |
