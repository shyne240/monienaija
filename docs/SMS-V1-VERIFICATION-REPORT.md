# SMS-V1-01 Verification Report — Production SMS Integration for V1

- **Task:** SMS-V1-01 (continue from verified HEAD `e467954`)
- **Provider:** Robase — official contract per https://docs.robase.dev (fetched 2026-09-28)
- **Branch:** `arena/01a0d883-monienaija`

---

## 1. Starting HEAD

`e467954` (docs: add V1 commercial implementation audit (CIA-01)). Workspace recovered via the standard rollback protocol (fetch + `git reset --hard FETCH_HEAD`), tree clean before any edit.

## 2. Final HEAD

Recorded in the final commit message of this task set; see Git confirmation in §17/§19 and the chat report. (Filled at push time — commit `— see closing section 19 —`).

## 3. Provider: Robase

**Decision provenance:** user instruction states the agreed initial provider is Robase (Termii retained as alternative/fallback; automatic multi-provider failover NOT implemented — the existing single-provider adapter architecture does not support failover without a policy decision, and none was made).

**Verified official contract** (docs.robase.dev + robase.dev/docs, fetched 2026-09-28; nothing invented):

| Contract element | Verified fact |
|---|---|
| Base URL | `https://api.robase.dev` |
| Authentication | `Authorization: Bearer robe_<64 hex>` (live keys carry the `robe_` prefix) |
| Transactional send | `POST /v1/sms/send` — body `{ "phone_number": "+E164", "message": "...", "metadata": {} }` |
| Success (200) | `{ id, phone_number, country_code, credit_cost, status: "pending", created_at, segments, encoding, sanitized }` |
| Idempotency | `Idempotency-Key` header; 24h replay returns original response (`Idempotent-Replayed: true`). Adapter always sends a deterministic key per delivery row. |
| Errors | `{ "error": { "type": "<stable>", "message": "<prose>" } }` — adapter consumes `error.type` only |
| Delivery status | Robase-side transitions `pending → sent → delivered (or failed)`; `GET /v1/sms/{id}` and webhooks `sms.sent/.delivered/.failed` exist |
| Sender identity | **No sender-id field exists in the verified `/v1/sms/send` contract** — sender identity is workspace-level Robase account configuration (operational dependency, §13/§18) |
| OTP endpoints | `/v1/otp/send` + `/v1/otp/verify` exist provider-side but are NOT used (no OTP generation machinery in V1 — §7) |

No SDK dependency added: ~60 lines of provider-neutral HTTP behind the existing `NotificationProvider` abstraction (no new packages).

## 4. Architecture preserved

`Outbox → NotificationDispatcher → NotificationProvider adapter → notification_deliveries` — unchanged, verified in code and tests. No second notification system, no redesign:

- `RobaseNotificationProvider` (`src/notification/robase-notification-provider.ts`) implements the existing `NotificationProvider` interface — identical shape as Console/Test adapters.
- **No Robase (or any provider) code inside** TransferService, CashIn/CashOut, Funding, Support, or Authentication services — verified by construction (adapter imported only in `notification.module.ts`) and grep.
- Provider selected by configuration: `NOTIFICATION_SMS_PROVIDER=console|robase` (default `console` keeps dev/test provider-neutral).
- Dispatcher, event map, template service, inbox, outbox enqueue points in financial/support flows: untouched except the dispatcher passing `eventType` through to the resolver (opt-out taxonomy).

## 5. Exact V1 SMS events implemented

Event classification re-verified against executable code at current HEAD (grep of outbox enqueues + event map). The full 10-event audit matrix (§11.3 of the CIA-01 audit) was confirmed accurate; implementation truth:

| Event | Class | Channel | Emission today | Status after this task |
|---|---|---|---|---|
| `customer.funding.requested` / `.approved` / `.rejected` | REQUIRED FOR V1 | SMS (+in-app inbox) | `customer-funding.service.ts:221/496/579` in-transaction outbox | **Implementable end-to-end**: worker drain → resolve → adapter → delivery rows (integration test 10 proves FULL path) |
| `transfer.completed` / `transfer.failed` | REQUIRED FOR V1 | SMS (+inbox) | `transfer.service.ts:422/567` in-transaction outbox | Same (test 12b/11 dispatch paths prove it) |
| Support tickets (created/assigned/status_changed/resolved/closed/message_added, internal notes filtered) | REQUIRED FOR V1 (customer half) | SMS (+inbox) | `support.service.ts` 5 event types enqueued | Same pipeline (customer intent; agent intent remains SKIPPED `AGENT_PHONE_DEPENDENCY_MISSING` per dependency, §6) |
| `cash_to_cash.claimed/expired/created` | OPTIONAL FOR V1 | SMS ONLY when adopted | **No outbox emission exists** (verified) | Left disabled per §6 |
| Agent lifecycle (6 mapped) | NOT REQUIRED | n/a | No emission; catalogue `possible:false` | Left disabled per §6 |
| Registration OTP / login SMS MFA / transaction OTP | OPTIONAL FOR V1 | n/a | **No such flows exist** (verified; see §7) | No build; no suppression risk (§8 taxonomy) |
| Wallet→Cash authorization notice | OPTIONAL FOR V1 | n/a | No emission | Left disabled |
| Reward granted notice | OPTIONAL FOR V1 | n/a | Event does not exist (policy-gated) | N/A |

Opt-out taxonomy applies to all customer SMS intents (§8). PUSH remains impossible (no device-token substrate) — every `SMS+PUSH` cell degrades to SMS ONLY.

## 6. Events deliberately left disabled and why

| Event area | Why disabled | Exact dependency to enable |
|---|---|---|
| AGENT-directed SMS (all) | **No authoritative Agent phone exists** (`AGENT_PHONE_DEPENDENCY_MISSING`; agent entity carries no phone; resolver returns SKIPPED). Not invented — per task instruction | `agent_contact_methods` table + model (audit SMS-4; V1-005 next-steps names it verbatim) + product decision ratifying an agent-required event |
| PUSH (all events) | No device-token table; resolver SKIPs `PUSH_TOKEN_DEPENDENCY_MISSING` | `push_device_tokens` + registration endpoints (audit SMS-5) |
| Cash-to-cash notifications | No outbox emission in `agent-cash-to-cash*.service.ts` (verified by grep); catalogue marks `required:false` | Product decision + emission wiring (audit SMS-11), both outside this task's required set |
| OTP SMS events | No OTP generation/verification machinery exists in V1 at all (§7) | Standalone product decisions (auth-audit carried) — deliberately NOT created here |

No SMS was enabled "for every event": only events that the flows already emit and that the audit classified REQUIRED FOR V1 are production-path-active; everything else remains SKIPPED-with-reason or un-emitted, exactly as today.

## 7. OTP behavior

**A/B distinction implemented and tested.**

- **A. Informational/transactional SMS (all current events):** financial execution never depends on delivery. Provider failure → auditable FAILED delivery row; outbox still marked PUBLISHED; no financial mutation (integration test 14: funding APPROVED, wallet balance 25000, exactly one journal before and after SMS failure + recovery).
- **B. OTP/security SMS:** **no OTP flow exists in V1** (verified: registration has none; W↔W authorization uses transaction PIN; cash-to-cash claim uses a hashed transfer code shared out-of-band; MFA `issueChallenge` lacks any delivery channel; only the cash-to-cash "transfer-code" primitive exists — shared agent-to-supplier, not via SMS). Consequences:
  - There is no OTP request anywhere that a provider failure could falsely "deliver" — the failure class cannot arise.
  - No OTP verification semantics exist to preserve or weaken; none were added.
  - The mandatory/security bypass mechanism (`SECURITY_CRITICAL_NOTIFICATION_EVENT_TYPES`) is implemented and proven (integration test 13) with an **intentionally empty set** so no current notification is mis-classified.
- Robase `/v1/otp/*` endpoints are NOT used (adopting a provider-side OTP authority would be a security-architecture decision; not made).

## 8. Opt-out behavior

- **Mechanism:** `NotificationChannelResolverService` honors the authoritative `customer_preferences.notification_sms_enabled` **before** phone lookup, for SMS channel only (PUSH opt-out already existed). Suppressed deliveries are persisted as SKIPPED rows with `destination='SKIPPED:SMS_OPT_OUT'` and `last_error='SMS_OPT_OUT'` (auditable; hidden from inbox per existing V1-006 semantics).
- **Three documented classes** (`src/notification/notification-security.constants.ts`): (1) SECURITY-CRITICAL (mandatory — opt-out can never suppress; set intentionally empty today), (2) TRANSACTIONAL REQUIRED (funding/transfer/support — opt-out honored), (3) OPTIONAL INFORMATIONAL (opt-out honored). No arbitrary new categories created; the constant is the single documented taxonomy point.
- **Late opt-out honored at retry time:** the worker re-checks the preference before every retry attempt and converts retry-eligible FAILED rows to SKIPPED `SMS_OPT_OUT` without sending (integration test 12b).
- **Known limitation (documented, consistent with narrowest-change mandate):** opted-out customers also lose the in-app inbox copy of the suppressed notification because the inbox is a projection of delivery rows and SKIPPED rows are hidden. Restoring inbox-only delivery for opted-out SMS requires a new IN_APP channel row per event — an architecture change explicitly out of scope. The in-app surfaces (history, support, funding views) remain the system of record.
- Security-critical messages can never be opt-out-suppressed (empty set today; mechanism tested).

## 9. Retry behavior

- **Delivery-level, bounded, exponential:** a FAILED delivery is retry-eligible while `attempts < SMS_RETRY_MAX_ATTEMPTS` (default 3) and `updated_at <= NOW() − (SMS_RETRY_BASE_DELAY_SECONDS × 2^(attempts−1))` (default base 60s → retries at +60s, +120s).
- **Terminal auditable state:** on exhaustion the row remains FAILED with `last_error` and a WARN log line ("terminally FAILED after N attempts") — never re-claimed (integration test 5), no silent loss, no infinite retry.
- **Semantics:** attempts count actual provider submissions; claim updates lease without consuming attempts; provider failures persist redacted error strings only (e.g. `ROBASE_HTTP_402:insufficient_credits`).
- **Outbox-level behavior unchanged:** FAILED outbox rows re-become available per existing +60s discipline; delivery-level idempotency (unique key) means re-dispatch is a no-op — full compatibility with the new retry layer.
- **No flight risk:** retry never reverses financial state (invariant asserted in test 14).

## 10. Worker behavior

`NotificationWorkerService` (`src/notification/notification-worker.service.ts`) — the narrowest provider-neutral mechanism (no @nestjs/schedule/bull dependency added; a guarded `setInterval` lifecycle service + one claim query):

- **Enable/loop:** `NOTIFICATION_WORKER_ENABLED` (default false — no behavior change for existing suites/environments), `NOTIFICATION_WORKER_POLL_INTERVAL_MS` (default 5000), `NOTIFICATION_WORKER_BATCH_SIZE` (default 10). Non-reentrant per instance; interval timer `unref`'d; tick errors are caught/ logged and never crash the process.
- **Per tick:** (1) drain pending outbox via existing `processPendingOutboxEvents` (dispatch → idempotent delivery insert, `ON CONFLICT (event_key, recipient_id, channel) DO NOTHING`); (2) claim and retry FAILED deliveries.
- **Claiming (concurrent-worker safe):** `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED …)` in a short transaction; the claim bumps `updated_at`, which doubles as a lease (rows become re-eligible only after their backoff from `updated_at`). Disjoint partition proven under two racing worker instances (integration test 6/7: claimed sets union exactly 6 of 6, each row retried exactly once).
- **Idempotent at three layers:** (a) delivery unique key (no duplicate rows even under replay/re-dispatch), (b) backoff-gated lease (no duplicate claims), (c) deterministic Robase `Idempotency-Key` (`eventKey:recipientId:channel`) — provider-side dedupe even against an adversarial double-submit (24h replay window per verified contract). Re-running after SENT does nothing (test 6/7).
- **Records:** attempts, `provider_ref` (Robase message id or adapter ref), `sent_at`/`failed_at`, redacted `last_error`; correlation/causation carried from outbox → delivery (unchanged columns).
- **Credentials:** worker holds none; provider instance is the module-bound adapter. **Finances:** worker writes nothing outside `outbox_events` + `notification_deliveries` (asserted by test 14 and by construction).
- **Not a general-purpose job platform:** two loops, one claim query, zero new tables.

## 11. Delivery status semantics

| Status | Meaning (unchanged) |
|---|---|
| PENDING | Inserted, no provider submission yet (subset: claimable crash window — recovered by retry gate) |
| SENT | **The provider adapter accepted the submission** (Robase 200 + message id → `provider_ref`; Robase-side status `pending`). NOT handset delivery/read confirmation. |
| FAILED | Submission attempted and failed (bounded retries apply); terminal-auditable after exhaustion |
| SKIPPED | Delivery suppressed with machine-readable reason (`CUSTOMER_PHONE_MISSING`, `AGENT_PHONE_DEPENDENCY_MISSING`, `PUSH_TOKEN_DEPENDENCY_MISSING`, `PUSH_OPT_OUT`, **`SMS_OPT_OUT`** new) |

SENT redefinition explicitly avoided. **Robase delivery receipts** (`GET /v1/sms/{id}` poll / `sms.*` webhooks) are recorded as a **separate enhancement** (§18): adding receipt ingestion requires an authenticated callback endpoint or polling loop — architecture work deliberately not smuggled into SENT semantics.

## 12. Security controls

- **Secrets:** API key exists only in env (`ROBASE_API_KEY`, validated secret-typed ≥16 chars, `robe_` prefix enforced) and the outgoing Authorization header. The adapter has **no logger**; errors are machine strings built from status code + stable `error.type` only; unit test 15 proves key material never appears in any returned surface across failure modes (including adversarial prose containing the key).
- **Phone numbers:** adapter normalizes from the single authoritative source (`customer_contact_methods.normalized_value`; `^\+?[1-9]\d{7,14}$` — the repository's existing normalization, no second phone source, no duplicate storage). Numbers appear in delivery rows exactly as the existing V1-005 model already stored them (destination column is the designated delivery address).
- **Payload redaction:** existing `redactRecord` (PIN/OTP/token/secret/key/hash vocabulary) still applies before persistence; `_templateKey` audit marker unchanged. Test 15 asserts the persisted surface carries no `robe_`/key/secret/PIN material.
- **OTP content:** none exists in the system (§7); messages are template-rendered from non-secret reference/amount fields only (existing template service untouched).
- **Authorization:** inbox stays customer-self-only (isolation proven in test 11); workforce diagnostics controller authorization untouched. No authorization surface changed.
- **Opt-out vs mandatory:** security-critical bypass (§8) prevents customers from breaking their own required authorization flows.

## 13. Configuration requirements

All new keys live in the zod-validated environment schema (`src/config/environment.ts`) — startup validation fails fast when Robase is selected without credentials (unit tests 1a–1d). **No real values are in the repository.**

| Env var | Required when | Default | Notes |
|---|---|---|---|
| `NOTIFICATION_SMS_PROVIDER` | — | `console` | `console` (dev/test, existing adapter) or `robase` |
| `ROBASE_API_KEY` | provider=`robase` | — | Live key `robe_` + 64 hex (prefix enforced by validation); obtain via Robase dashboard; store in environment/secrets manager — never in repo |
| `ROBASE_API_BASE_URL` | — | `https://api.robase.dev` | Verified base URL |
| `ROBASE_REQUEST_TIMEOUT_MS` | — | `10000` | 1000–30000 |
| `NOTIFICATION_WORKER_ENABLED` | production delivery | `false` | `true` activates the delivery worker |
| `NOTIFICATION_WORKER_POLL_INTERVAL_MS` | — | `5000` | 500–60000 |
| `NOTIFICATION_WORKER_BATCH_SIZE` | — | `10` | 1–100 |
| `SMS_RETRY_MAX_ATTEMPTS` | — | `3` | 1–10 (total send attempts incl. initial) |
| `SMS_RETRY_BASE_DELAY_SECONDS` | — | `60` | 5–86400 (backoff doubles per attempt) |

**Sender ID:** the verified `/v1/sms/send` contract has **no sender-id request field** — sender identity is workspace/account configuration on the Robase side. Per task instruction, it is documented here as an **operational configuration dependency** (obtain/register the branded sender in the Robase workspace as part of production onboarding) rather than invented as repository configuration.

## 14. Tests

New suites (real local PostgreSQL for integration — embedded PG 18.4, per-suite database, no mocks of persistence):

**`test/robase-notification-provider.unit.spec.ts`** (12 tests): env validation (missing key fail / prefix enforcement / defaults fill / default console neutral) · successful submission (endpoint, auth header, idempotency key, E.164 body, metadata hygiene) · typed failure envelopes (HTTP status + stable error.type; non-JSON) · timeout · network error · destination normalization (+E.164 add/preserve/reject) · PUSH rejection · no secrets in any returned surface.

**`test/sms-v1-01.integration.spec.ts`** (12 tests, covers all 17 mandated focus areas): worker drains pending outbox end-to-end (10: funding approved → SENT + inbox) · provider failure → FAILED with attempts/error/timestamps (4/8/9) · backoff gate blocks early retry · retry → SENT with providerRef, attempts=2, error cleared (4/8/9) · **retry exhaustion** terminal + never re-claimed + zero sends after recovery (5) · **concurrent worker claiming** — two instances partition 6 rows disjointly, exactly-once retry (6) · **idempotent processing** — SENT rows never re-sent, duplicate dispatch no-ops (7) · **delivery + provider reference persistence** (8/9) · **customer phone resolution** primary-preferred from authoritative contact methods (10) · **customer notification isolation** (11) · **SMS opt-out** suppressed at dispatch with reason + provider untouched + inbox-hidden (12) · late opt-out honored at retry (12b) · **security-critical bypass** (13) · **informational SMS failure does not affect financial completion** — balance/journal/status invariants before+after failure+recovery (14) · **no secrets in persisted surfaces** (15) · **Console/Test behaviors intact + worker disabled by default** (16).

**Regression run (task-mandated suites):** v1-005 notification delivery (33) · v1-006 inbox (13) · a14 OTP hardening · v1-001 customer funding · a5 transfer lifecycle — details in §15.

Financial-mutation check: notification processing was verified to write only `outbox_events`/`notification_deliveries` (test 14 asserts ledger lines count, balances, funding status identical across failure + retry + recovery).

## 15. Real-PG results

| Suite | Result |
|---|---|
| `test/sms-v1-01.integration.spec.ts` | **12/12 PASS** (430–630ms/test class) |
| `test/robase-notification-provider.unit.spec.ts` | **12/12 PASS** |
| v1-005 notification delivery (integration) | **33/33 PASS** |
| v1-006 inbox (integration) | **13/13 PASS** |
| a14 OTP hardening + v1-001 funding + a5 transfer lifecycle | **54/54 PASS** |
| Full unit suite (`npx jest --silent`) | **1778/1780 PASS** — the 2 failures (`test/external-reconciliation.service.spec.ts`, A6 certification/PASS-status expectations) reproduced identically on pristine base `e467954` after `git stash -u` → **pre-existing, unrelated to this task** |

## 16. TypeScript / build / lint results

- `npx tsc --noEmit -p tsconfig.json` → **PASS** (exit 0)
- `npx nest build` → **PASS** (exit 0)
- ESLint on all changed/added files → **0 errors** (2 warnings: unused eslint-disable directives in the existing dispatcher banner and the new spec banner — same pre-existing style as the repository's existing files)

## 17. Capability registry status

Only `NOTIFICATION_DELIVERY_ARCHITECTURE` was touched — its description had become **objectively** incomplete ("Console/Test" no longer the only adapters; no worker mention). Changes: description updated to reflect Robase adapter + worker + retry + opt-out; implementation/test/documentation references extended (`robase-notification-provider.ts`, `notification-worker.service.ts`, `test/sms-v1-01.integration.spec.ts`, `test/robase-notification-provider.unit.spec.ts`, this report); version 1→2; `notes` records the remaining ops dependencies. **Status deliberately NOT upgraded:** lifecycle stays FULLY_ENABLED (accurate for the architecture), configurationStatus unchanged — the entry distinguishes backend-implemented/worker-operational (done) from provider-configured/production-credentials (ops, §18). No "SMS fully enabled" claim is made anywhere. `NOTIFICATION_INBOX` and all other entries untouched.

## 18. Remaining operational dependencies

1. **Robase production credentials:** `ROBASE_API_KEY` (live `robe_` key from the Robase dashboard) provisioned into the deployment environment — no key exists in the repo by design.
2. **Activation:** `NOTIFICATION_SMS_PROVIDER=robase` + `NOTIFICATION_WORKER_ENABLED=true` per environment.
3. **Workspace sender identity:** sender id/branding configured at Robase workspace level (contract has no per-request field — §13); any regulator/operator registration is external ops work.
4. **Robase account balance:** prepaid credits monitored externally (Robase refunds credits when all upstreams fail; the adapter surfaces `insufficient_credits` as a typed failure → FAILED rows + WARN logs).
5. **Delivery receipts (documented separate enhancement):** authenticated webhook ingestion (`sms.sent/.delivered/.failed`) or `GET /v1/sms/{id}` polling to model terminal delivery truth; SENT semantics must not be quietly redefined when implemented (callback endpoint + signature verification = new architecture slice).
6. **Agent phone source** (`agent_contact_methods`) before any agent-directed SMS class is ratified; **push device tokens** before PUSH channels exist (§6).
7. **Ops runbook addendum (recommended, not built):** alert on terminal-FAILED deliveries (the WARN log) and on sustained `ROBASE_TIMEOUT`/network typed failures.

## 19. VERIFIED or BLOCKED

**VERIFIED** — with the following boundary statement: everything implementable from code, configuration, tests, and verified external documentation is complete and green (§15/§16). What intentionally remains open is purely operational (§18: credentials, activation flags, workspace sender setup) and policy-gated items outside this task's mandate (agent phone source, PUSH substrate, OTP product decisions, cash-to-cash emission ratification). The final commit hash and local==remote confirmation are reported in the closing Git report of this task set.

— End of SMS-V1-01 Verification Report —
