# ARENA 3 — SMS AND EMAIL NOTIFICATION INFRASTRUCTURE AUDIT

- **Date:** 2026-10-27
- **Audited source SHA (mission baseline):** `b8a5b94ee55aad7407dd78068428b3e97236ce8e`
- **Tree actually inspected:** `e90a208d0a3f25b66a8f4b3d967b6866ef4587f5` = baseline + the documentation-only Ordinary Agent V1 completion audit (zero application-code delta; `git diff b8a5b94..e90a208 --stat` touches only `docs/ordinary-agent-v1/**`). All source findings below are therefore findings at the mission baseline.
- **Type:** READ-ONLY application audit. No application code, migration, configuration or existing test was modified. Documentation-only commit at the end (SHA recorded in §9).
- **Sandbox note:** a workspace reset was recovered before the audit by fetch + ancestry verification + local-only fast-forward reset to the pushed origin tip (`e90a208`); no history was rewritten.

---

## 1. Existing infrastructure inventory

### 1.1 SMS pipeline (implemented, tested, provider-neutral)

**Flow:** domain service enqueues an outbox event **inside its own committed database transaction** → `NotificationWorkerService` (opt-in background poller) drains the outbox → `NotificationDispatcherService` maps event → recipient intents → resolves destination → renders message → inserts an idempotent `notification_deliveries` row → provider send → status transition. Provider failure is isolated and never reverses financial state.

| Component | File | Status |
|---|---|---|
| Outbox (single, shared — "no second outbox/event bus") | `src/operations/outbox.service.ts`, `outbox-event.entity.ts` | IMPLEMENTED. `enqueue`/`enqueueOnce` (eventKey-unique, ≤180 chars, same-event assertion), `claimPending`, `markPublished/markFailed`, `retryFailed`; payload redacted at enqueue (`redactRecord`); classification/retention columns from migration `1785753600024-AddOutboxEventContract` |
| Worker | `src/notification/notification-worker.service.ts` | IMPLEMENTED. `setInterval` poller gated by `NOTIFICATION_WORKER_ENABLED` (**default false**); batch `NOTIFICATION_WORKER_BATCH_SIZE` (default 10, max 100); drains PENDING+FAILED outbox via `dispatcher.processPendingOutboxEvents`; bounded retry of FAILED deliveries: eligible while `attempts < SMS_RETRY_MAX_ATTEMPTS` (default 3, max 10) and `updated_at <= NOW() - SMS_RETRY_BASE_DELAY_SECONDS * 2^(attempts-1)` (default 60s, exponential); retry claim is one atomic `UPDATE … FOR UPDATE SKIP LOCKED` — multi-worker/instance safe; tick failures never crash the process |
| Dispatcher | `src/notification/notification-dispatcher.service.ts` | IMPLEMENTED. Deterministic eventKey (provided or `type:aggregate:occurredAt`); redacts payload; `mapEventToIntents`; support-event DB fallback (resolves customer/agent from `support_tickets` when payload lacks ids); delivery insert `ON CONFLICT DO NOTHING` on unique `(event_key, recipient_id, channel)` → duplicate dispatch sends nothing twice; outbox marked PUBLISHED even when deliveries SKIPPED/FAILED (isolation), FAILED only when dispatch itself throws (then retried after 60s) |
| Channel resolver | `src/notification/notification-channel-resolver.service.ts` | IMPLEMENTED with documented limits. Customer SMS destination = authoritative `customer_contact_methods` PHONE `normalized_value` (primary preferred). **Agent SMS: no authoritative agent phone model → AGENT-recipient deliveries always SKIPPED (documented dependency).** PUSH: always `PUSH_TOKEN_DEPENDENCY_MISSING` (no device-token model, V2 by record). Preferences honored BEFORE destination lookup: `notification_sms_enabled=false` → SKIPPED `SMS_OPT_OUT`; push opt-out → `PUSH_OPT_OUT`; security-critical events bypass opt-out |
| Delivery persistence | `src/notification/notification-delivery.entity.ts`, migration `1785753600065-CreateNotificationDeliveries` | IMPLEMENTED. `notification_deliveries`: event_type/event_key, aggregate, recipient_type (`CUSTOMER|AGENT` CHECK), channel (`SMS|PUSH` CHECK), destination, redacted jsonb payload, rendered message (≤1000), status (`PENDING|SENT|FAILED|SKIPPED` CHECK), attempts, provider_ref, correlation/causation ids, last_error, created/updated/sent_at/failed_at; unique `(event_key, recipient_id, channel)`; indexes on recipient, status, event_type |
| Providers | `src/notification/notification-provider.interface.ts`, `robase-notification-provider.ts` | IMPLEMENTED: `ConsoleNotificationProvider` (dev default — logs, stores in memory, NOT a fake delivery: no invented credentials), `TestNotificationProvider` (failure injection), `RabaseNotificationProvider` (production SMS; verified official contract in file header: `POST https://api.robase.dev/v1/sms/send`, `Authorization: Bearer robe_<64hex>`, `Idempotency-Key: eventKey:recipientId:channel` (24h provider-side replay), E.164 normalization reusing the repository's canonical phone rule, message ≤1000 chars, metadata = event_type only, timeout via AbortController, **only stable `error.type` consumed — prose/bodies never surfaced or logged, key never logged/thrown/returned**, failure returns `success:false` — never throws into financial execution). **`SENT` strictly means "accepted by Robase"** — provider delivery-status polling (`GET /v1/sms/{id}`) and webhooks (`sms.sent/delivered/failed`) exist in the Robase API but are NOT implemented (documented enhancement). **No sender-id field exists in the Robase send contract — sender identity is workspace-level configuration on the Robase account.** |
| Provider selection & credentials | `src/notification/notification.module.ts`, `src/config/environment.ts` | IMPLEMENTED, environment-only. `NOTIFICATION_SMS_PROVIDER` (`console` default | `robase`); `ROBASE_API_BASE_URL` (default api.robase.dev), `ROBASE_API_KEY` (fail-fast: required when provider=robase; must carry `robe_` live-key prefix), `ROBASE_REQUEST_TIMEOUT_MS` (default 10s). **Production guard: `NODE_ENV=production` with provider≠robase fails startup** ("console never delivers real SMS"). No database credential storage, no runtime provider configuration API |
| Templates | `src/notification/notification-template.service.ts` | IMPLEMENTED as a **hardcoded switch** (20 event cases + generic default) with safe-field extraction (public reference truncated to 8 chars, NGN minor→major formatting via `formatNgn`) and payload redaction. **No DB-backed templates, no editable content, no per-channel variants, no subjects (no email), no versioning, no variable registry, no preview.** See §3 finding F1 for the `assertSafe()` no-op and F2 for the C2C template conflict |
| Event → intent catalogue | `src/notification/notification-event-map.ts` | IMPLEMENTED as **code** (pure function `mapEventToIntents`): `customer.funding.approved/rejected` (+requested), `transfer.completed/failed` (both parties), `support.ticket.created/assigned/status_changed(→resolved/closed template mapping)/resolved/closed/message_added` (**internal notes never sent** — filtered), `cash_to_cash.created/claimed/expired` (mapping exists: claimantCustomerId → beneficiaryId → agentId intents), `agent.activated/suspended/terminated/reactivated/application.approved/rejected` (annotated "future outbox events"; UUID-validated agentId or no intent). Unknown events → no intents (outbox still published). A documentation catalogue in the same file records required/possible/fallback per event |
| Security-critical direct path (never outbox) | `src/notification/notification-security.constants.ts` + senders | IMPLEMENTED. Three events send DIRECTLY through `NOTIFICATION_PROVIDER_TOKEN`, deliberately bypassing dispatcher/outbox because an outbox/delivery record would **persist the rendered OTP/credential**: `customer.registration.phone_verification` (`customer-registration.service.ts`), `customer.credentials.temporary_credential` (`admin-customer-credentials.controller.ts`), `agent.desk.customer_otp` (`agent-desk-otp.service.ts` — Wallet→Cash + C2C claim OTPs, delivered to the CUSTOMER's verified primary phone, never the agent). These bypass customer SMS opt-out by design (mandatory class). Taxonomy rule documented: any future dispatcher-routed security flow must be registered here at design time |
| Customer inbox | `src/notification/notification-inbox.controller.ts` / `.service.ts` | IMPLEMENTED. `GET customers/me/notifications` (CUSTOMER SELF, paginated) as a **projection over `notification_deliveries`** (no second table); SKIPPED hidden; raw delivery mechanics mapped to user-facing `AVAILABLE`; friendly titles per event type (incl. `cash_to_cash.expired`). **No agent inbox route exists** |
| Customer preferences | `src/customer-preference/*` | IMPLEMENTED. `notification_preferences`: `notification_email_enabled` (default true — **unused: no email channel exists**), `notification_sms_enabled`, `notification_push_enabled`; SMS/push honored by the resolver; email flag honored by nothing |
| Admin diagnostics API | `src/admin/admin-notification.controller.ts` | IMPLEMENTED (read-only). `GET internal/notifications/deliveries` — `requireWorkforce`, strict filter validation (400 on invalid), pagination 1..100, filters status/recipientType/channel/eventType/recipientId(UUID); projection includes rendered `message`, `last_error`, `provider_ref`, attempts, timestamps — **excludes `destination`** (phone numbers not exposed to diagnostics) |
| Admin Web surface | `apps/admin-web/src/screens/authenticated/SystemHealthScreen.tsx` | IMPLEMENTED (read-only). Notification-deliveries section gated by scope `notification.view_deliveries`; list + filters + pagination against the diagnostics endpoint; partial-failure resilient. **This is the ONLY notification admin UI** |
| A7 product-notification-delivery policy module | `src/policy/a7-product-notification-delivery.*` (+4 spec suites) | IMPLEMENTED as a product-platform **contract/policy layer** (A7T06) over the shared Operations idempotency/audit/outbox services and customer preferences — governance machinery for product-bound notification delivery, distinct from (and not a replacement for) the runtime pipeline above |

### 1.2 Which events are ACTUALLY triggered today (enqueue sites verified in source)

| Event | Enqueued by | Notification outcome today |
|---|---|---|
| `transfer.completed` / `transfer.failed` | `transfer.service.ts` (:509/:733), `transfer-lifecycle.service.ts` (:537, same `transfer.completed` type) | SMS to both customer parties (real) |
| `customer.funding.requested/approved/rejected` | `customer-funding.service.ts` (:235/:531/:617) | SMS to customer (real; the sms-v1-01 end-to-end test uses funding approved) |
| `support.ticket.created/assigned/status_changed/resolved/closed/message_added` | `support.service.ts` (6 sites) | SMS to bound customer and/or agent ids (agent leg SKIPPED — no agent phone model); internal notes filtered |
| `deposit.completed/failed`, withdrawal events, AR-provisioning, partner-settlement | `deposit.service.ts`, `withdrawal.service.ts`, `ar-control-account-provisioning.service.ts`, `external-settlement.service.ts` | Enqueued to the shared outbox but **not present in the notification event map → zero notification intents** (outbox marked PUBLISHED; other consumers/audit only) |
| `cash_to_cash.created/claimed/expired` | **NOTHING — no enqueue site exists in any agent service** | Templates + intent mapping exist but are dead at runtime. Additionally the `created` mapping cannot resolve a recipient even if enqueued: at initiation there is no `claimantCustomerId`/`beneficiaryId` (the beneficiary may be unregistered; only `senderPhone`/`beneficiaryPhone` strings exist) and **phone-based recipient resolution is not implemented** |
| `agent.*` lifecycle (6 events) | **NOTHING** (event-map comment: "future outbox events") | Templates + mapping exist; dead at runtime; AGENT SMS destination unresolvable anyway (§1.1) |
| Registration OTP / temporary credential / agent-desk customer OTP | Direct provider sends (never outbox, by design) | Real SMS when provider=robase; the only notification traffic that reaches AGENT-flow customers for money operations |

### 1.3 Email

**No email notification capability exists at any layer.** `NotificationChannel = 'SMS' | 'PUSH'` (type + DB CHECK constraint); no email provider, adapter, subject handling, SMTP/API configuration, or email template; the resolver never returns an email destination. Vestigial email artifacts only: `notification_email_enabled` preference column (default true, honored by nothing), `EMAIL` values in contact-method/MFA-method/preference enums, and `customer_contact_methods` EMAIL rows (usable as a future verified email destination source). Requirements 3, 4 (email templates/subjects) and the email half of 1, 2, 5–11 are **entirely new builds**, not gaps in an existing email system.

### 1.4 Push

Channel type exists end-to-end but every PUSH intent resolves to `SKIPPED PUSH_TOKEN_DEPENDENCY_MISSING` (no device-token model, no FCM/APNS). Documented V2 by the scope-challenge record. Out of scope for this SMS/email mission except as a compatibility constraint (do not break the SKIPPED semantics).

### 1.5 Test and enforcement evidence (executed green at the audited SHA — full run 116/116 suites, 2237 tests)

| Suite | Tests | What it actually enforces |
|---|---|---|
| `test/sms-v1-01.integration.spec.ts` | 14 | Worker end-to-end (funding approved → outbox → SENT delivery → inbox entry); provider failure → FAILED → bounded retry → SENT with providerRef and attempts counted; retry exhaustion terminal (never re-claimed); concurrent workers claim disjoint rows; idempotent reprocessing never re-sends; SMS opt-out → SKIPPED `SMS_OPT_OUT` with provider never called and inbox hidden; opt-out recorded after initial failure honored at retry; security-critical bypass of opt-out; primary-phone preference; inbox cross-customer isolation; **informational SMS failure never reverses or mutates financial state**; persisted surfaces carry no secrets and no provider key material; worker disabled by default |
| `test/v1-005-notification-delivery.integration.spec.ts` | 24 | Delivery foundation: intent mapping, deterministic eventKey idempotency, unique delivery identity, SKIPPED reasons, payload/message redaction, internal support-note filtering |
| `test/v1-006-customer-notification-inbox.integration.spec.ts` | 24 | Inbox projection: SELF-only, pagination, SKIPPED exclusion, availability mapping, no second table |
| `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` | 22 | Admin diagnostics: workforce gating, strict filter/pagination validation, projection excludes destination |
| `test/robase-notification-provider.unit.spec.ts` | 12 | Robase adapter: auth header, idempotency key derivation, E.164 normalization/rejection, message truncation, metadata minimization, stable-error-only extraction, timeout handling, PUSH refusal, never throws |
| `test/a7-product-notification-delivery.*.spec.ts` | 4 suites | A7 policy-contract layer |
| `test/cash-to-cash-locator-contract.spec.ts` | 2 | Current C2C `created` template renders the public pair without UUID/secret code (see F2 — this behavior is what the new requirement changes) |

---

## 2. Backend / API / Admin Web capability matrix vs the approved product requirements

Legend: ✔ implemented+tested · ◐ partial · ✖ absent. "Runtime" = actually triggered in production paths, not just code-present.

| # | Approved requirement | Backend | API | Admin Web | Runtime evidence | Notes |
|---|---|---|---|---|---|---|
| 1 | View notification events + configured channels | ◐ | ◐ | ◐ | Event map is CODE, not data — no event-catalogue endpoint; deliveries list shows event_type/channel per row | Viewing *configured* channels per event requires the catalogue to become data (§4.2) |
| 2 | Create/edit templates for supported events | ✖ | ✖ | ✖ | Templates are a hardcoded switch | Entirely new build (§4.1) |
| 3 | Separate SMS and email templates | ✖ | ✖ | ✖ | No email channel exists at all | New build incl. EMAIL channel (§4.3) |
| 4 | Email subjects | ✖ | ✖ | ✖ | — | New build with email template rows |
| 5 | Manage approved template variables | ✖ | ✖ | ✖ | Variables are implicit payload extractions in code | Variable registry per event, secret-exclusion by construction (§4.1/§5-F4) |
| 6 | Preview rendered notifications with sample data | ✖ | ✖ | ✖ | — | Server-side preview endpoint rendering DB template + sample payload; never sends |
| 7 | Enable/disable notification triggers | ◐ | ✖ | ✖ | Per-customer opt-out (SMS/push preferences) exists and is enforced; **no administrative per-event trigger toggle exists**; security-critical bypass is fixed by design and must remain non-toggleable | Event-configuration rows (§4.2) |
| 8 | Configure SMS/email provider settings securely | ◐ | ✖ | ✖ | Env-only configuration with fail-fast validation (robase + `robe_` prefix; production refuses console provider); key never logged/persisted outside env | No runtime config API — decide storage model (§4.4, decision D-N3) |
| 9 | Sender identities + delivery options | ✖ | ✖ | ✖ | Robase send contract has NO sender-id field (workspace-level on the provider account); no sender-identity storage anywhere | Partly provider-bound; admin surface can hold documented workspace config + future provider abstraction (§4.4) |
| 10 | Controlled test notifications | ✖ | ✖ | ✖ | No test-send capability (TestNotificationProvider is jest-only, not an admin feature) | New governed endpoint (§4.5) |
| 11 | View delivery attempts, statuses, failures, retries | ✔ | ✔ | ✔ | `GET internal/notifications/deliveries` + SystemHealthScreen section; status/attempts/provider_ref/last_error/timestamps; destination excluded; hardening-09 22 tests | COMPLETE for SMS; extend automatically to EMAIL rows. Provider delivery-receipt status (delivered vs accepted) is a documented enhancement (§6 P3) |
| 12 | Template-change audit records | ✖ | ✖ | ✖ | No runtime-editable templates exist → nothing to audit; delivery/outbox rows are auditable, code templates are git-tracked only | Comes with §4.1 (AuditService on every template/config mutation) |
| 13 | Role/function permissions + maker-checker on sensitive changes | ◐ | ◐ | ◐ | Diagnostics read is workforce+scope gated (`notification.view_deliveries`); catalogue has no notification-management functions; no maker-checker for notifications anywhere | New catalogue functions + approval workflow reuse (§4.6) |
| C2C | Beneficiary SMS with configurable `{{sender_name}}/{{amount}}/{{agent_locator_url}}` template; never disclose number/sender-phone/code | ✖ | ✖ | ✖ | Nothing enqueues `cash_to_cash.created`; recipient-by-phone resolution absent; `sender_name` is NOT collected or verified anywhere in C2C (only `senderPhone`, explicitly "not represented as verified identity evidence" — contract §1); no agent-locator URL/page/public outlet search exists (outlets have address_line/city/state, **no latitude/longitude**) | Full build path + 4 product decisions (§4.7, §7 D-N1/D-N2/D-N4/D-N5) |
| — | "Templates must not be hardcoded into transaction services" | ◐ | — | — | Satisfied in the weak sense: templates live in ONE central service, never in transaction services; violated in the strong sense: they are hardcoded in code, not configurable | §4.1 closes this |
| — | "Financial notifications triggered safely from committed events; retries never duplicate financial operations" | ✔ | ✔ | — | Outbox enqueue INSIDE the committing transaction; drain is idempotent (`enqueueOnce` eventKey + unique delivery identity + ON CONFLICT); retry touches only `notification_deliveries`/provider — sms-v1-01 test 14 proves informational failure never mutates financial state; dispatcher never calls domain services | Architecture already satisfies this; keep it mandatory in the build |
| — | "Secret codes/PINs/credentials never ordinary template variables" | ✔ | ✔ | — | Structurally enforced today: redactRecord at enqueue + direct-send rule for OTP/credential classes (never persisted) + no-secret-persistence test; must be preserved by the variable-registry design (secrets are unrepresentable as registered variables) | §4.1 makes this a schema property, not a convention |

---

## 3. Missing functionality and security findings

**Functional gaps (build-required):**
- **F-M1 Email channel end-to-end** (type, entity CHECK, provider adapter, destination resolution from verified EMAIL contact methods, subject handling, preference honoring via the existing `notification_email_enabled` column, inbox/title parity decision).
- **F-M2 DB-backed template registry + variable whitelist + preview** (requirements 2/3/4/5/6/12).
- **F-M3 Event-catalogue configuration data + admin trigger toggles** (requirements 1/7) with the security-critical class permanently non-toggleable.
- **F-M4 Provider/sender configuration admin surface** (requirements 8/9) — storage model is decision D-N3.
- **F-M5 Controlled test-send** (requirement 10) with dual control and rate limits.
- **F-M6 Maker-checker + catalogue functions for notification admin** (requirement 13).
- **F-M7 C2C beneficiary SMS**: enqueue at initiation, phone-destination recipient resolution, new safe template, `agent_locator_url` public page + configuration (§4.7).
- **F-M8 Agent-destination SMS**: no authoritative agent phone model exists — every AGENT-recipient delivery SKIPPED today. Agent lifecycle/ticket notifications remain impossible until an agent contact-model decision (D-N6).
- **F-M9 Dead triggers**: `deposit.*`/withdrawal outbox events have no notification mapping (either map them or document them as non-notification outbox consumers); `cash_to_cash.*`/`agent.*` mappings exist but nothing enqueues them (see OA-72/73 of the Ordinary Agent V1 audit — this audit supersedes that row with full pipeline detail).

**Security findings:**
- **F-S1 `NotificationTemplateService.assertSafe()` is a NO-OP stub.** Its loop body is `continue` for every forbidden word; it never throws or sanitizes despite its name and doc comment ("tests will verify" — no test can fail on it). False-assurance dead code. Remediation: delete it or implement real enforcement + tests; until DB templates exist it guards nothing.
- **F-S2 Current `cash_to_cash.created` template conflicts with the new product requirement.** It renders the six-digit `transferNumber` AND canonical `senderPhone` into the SMS body ("Cash-to-cash transfer number 000042 from 8031234567…") — exactly the disclosure the new requirement forbids (SMS must carry sender_name/amount/locator URL only; the pair is communicated by the sender out-of-band). Note this template was built to the approved six-digit contract §6 and is unit-tested (`cash-to-cash-locator-contract`); adopting the new requirement SUPERSEDES that clause for the SMS channel and requires re-baselining those tests. Neither template exposes the secret transfer code (that invariant holds in both).
- **F-S3 Default template branch leaks internal event names** (`Update: ${eventType} — Ref …`) to customer phones for unmapped events. Low severity (event names are not secrets) but a DB-template design should render nothing (or a generic approved fallback) for unconfigured events.
- **F-S4 Persisted rendered messages** (`notification_deliveries.message` ≤1000, exposed in admin diagnostics) are safe today because rendering uses only approved fields; once templates become admin-editable, message content becomes admin-influenced PII surface — preview/test-send and diagnostics must stay destination-redacted, and template variables must remain whitelist-derived from redacted payloads (never free payload access).
- **F-S5 Provider credential handling is strong and must be preserved**: env-only, `robe_` fail-fast, production-refuses-console guard, key never logged/returned; any move to DB-stored provider config (D-N3) requires envelope encryption, write-only masking, and maker-checker — otherwise keep env-only and make the admin surface read-only/status-only.
- **F-S6 OTP/credential classes must never become configurable templates.** The three security-critical direct-send flows bypass the outbox precisely because persistence of the rendered message would persist the secret. The template registry must exclude SECURITY-class events from admin editing (fixed code templates), with the taxonomy in `notification-security.constants.ts` as the enforcement point.
- **F-S7 No test-send exists**, so there is no controlled way to validate live provider configuration — operationally this pushes teams toward sending real events; F-M5 closes this with governance.

---

## 4. Recommended architecture (compatible with the current codebase)

Design rules: keep the single shared outbox (contract: "no second outbox/event bus"); keep the worker/dispatcher/provider seams untouched; keep security-critical direct sends out of the registry; all new persistence is additive migrations; no financial service may gain a synchronous notification dependency.

### 4.1 Template registry (requirements 2/3/4/5/6/12)
- **New table `notification_templates`** (additive migration): `id`, `event_type` (FK-by-value to the catalogue), `channel` (`SMS|EMAIL` — after §4.3 widens the type), `locale` (default `'en-NG'`, single-locale V1), `subject` (nullable, EMAIL only, CHECK: NULL for SMS), `body` (≤1000 SMS / ≤4000 email), `variables` jsonb (ordered whitelist of `{{name}}` tokens allowed for the event), `version` int, `is_active` bool, `created_by/updated_by`, `created_at/updated_at`; UNIQUE `(event_type, channel, locale, version)`; partial unique index enforcing ONE active version per `(event_type, channel, locale)`.
- **Rendering:** replace the hardcoded switch body with: load active template → substitute `{{var}}` ONLY from a per-event **variable resolver** (code-defined function mapping the redacted payload + explicitly approved safe derivations, e.g. `formatNgn(amountMinor)`, `maskReference`) → unknown/missing variable renders empty and records a diagnostic, never the raw token. Fallback when no DB row exists: the current built-in strings (seeded as version 1 by the migration) — zero-downtime adoption.
- **Secret exclusion by construction:** variable resolvers are the ONLY source of substitutable values; `redactRecord` runs before resolution; SECURITY-class events (§F-S6) are excluded from the registry entirely (fixed code templates). A template save API rejects bodies containing tokens outside the event's registered variable list.
- **Audit:** every create/activate/edit writes `audit_events` (actor, previous/next body hash + diff summary, never secrets) — requirement 12.

### 4.2 Event catalogue configuration (requirements 1/7)
- **New table `notification_event_configurations`**: `event_type` PK, `description`, `delivery_class` (`SECURITY|TRANSACTIONAL|INFORMATIONAL` — mirrors the existing constants taxonomy), `sms_enabled`, `email_enabled`, `toggle_locked` bool (true for SECURITY class and for `required:true` catalogue events — enforced in the service, not just UI), `updated_by/at`. Seeded from `notification-event-map.ts`'s existing catalogue (which already records required/possible/fallback per event).
- Dispatcher consults the configuration before generating intents (disabled → SKIPPED with reason `EVENT_DISABLED`, preserving inbox/diagnostics semantics). The code intent-mapping stays authoritative for recipients (data config toggles, code maps structure — no recipient logic becomes admin-editable).
- New read endpoint `GET internal/notifications/events` (catalogue + channels + configuration + template versions) — requirement 1.

### 4.3 Email channel (requirements 3/4)
- Widen `NotificationChannel` to `'SMS'|'PUSH'|'EMAIL'` + additive migration updating the CHECK constraint on `notification_deliveries` (and any delivery-status enum usage).
- `NotificationProvider` interface already fits (`channel` is in the request); add `EmailNotificationProvider` seam + `ConsoleEmailProvider` default and one production adapter behind `NOTIFICATION_EMAIL_PROVIDER` env (provider choice = decision D-N4; the Robase adapter pattern — env key, fail-fast, stable errors, no prose leakage — is the template to copy).
- Resolver: EMAIL destination from authoritative `customer_contact_methods` EMAIL (verified rows only); honor `notification_email_enabled` (already persisted, currently unused) with the same security-class bypass rule; SKIPPED reasons `EMAIL_OPT_OUT`/`CUSTOMER_EMAIL_MISSING`.
- Inbox: email deliveries project into the customer inbox like SMS (title map already event-keyed) — or explicitly excluded by decision (default: include, since the inbox is a delivery projection).

### 4.4 Provider & sender configuration (requirements 8/9)
- **Recommended V1 posture:** keep credentials env-only (F-S5). Admin surface shows NON-SECRET status: selected provider, base URL, key fingerprint (last 4), worker enabled/interval/batch/retry settings, robase workspace sender-identity documentation link. Requirement 9's sender identity is workspace-level at Robase (no API field) — model `notification_sender_identities` only when a provider with per-message sender-id is adopted (decision D-N4/D-N5); do not fake a sender-id capability against Robase.
- If ownership later demands runtime-editable provider config: separate secrets table with envelope encryption (KMS decision), write-only masking, maker-checker, and startup validation identical to the env schema — flagged as a phase-2 option, not V1.

### 4.5 Test send (requirement 10)
- `POST internal/notifications/test-send` — workforce-only, NEW function `notification.test_send`, dual control (approver ≠ requester via the existing privileged-action approval pattern), destination restricted to a verified workforce-owned phone/email entered per request (never a customer's stored destination), template rendered from the ACTIVE version with sample data, delivery row persisted with `event_type='notification.test_send'` + `correlationId`, rate-limited (e.g. 5/hour/principal), fully audited. Uses the real provider path so configuration is genuinely validated.

### 4.6 Authorization (requirement 13)
- New authorization-catalogue functions: `notification.view_events` (read catalogue/config), `notification.manage_templates` (INITIATE), `notification.approve_templates` (APPROVE — maker-checker pair for any change that affects production content), `notification.manage_configuration` (+ approve pair for trigger toggles), `notification.test_send` (dual control), `notification.view_deliveries` (existing). Template/config changes follow the funding maker-checker pattern already proven in this codebase (initiate → independent approve → execute, MFA session assurance on approval). SECURITY-class events and `toggle_locked` rows reject modification regardless of function.

### 4.7 Cash-to-Cash beneficiary SMS (the mission's C2C requirement)
1. **Enqueue:** inside the initiation SERIALIZABLE transaction, `outboxService.enqueueOnce` with `eventType='cash_to_cash.created'`, `eventKey='cash_to_cash.created:<transferId>'` — financial idempotency and notification idempotency share the key; retries can never duplicate the transfer (existing pattern) nor the SMS (unique delivery identity + Robase Idempotency-Key).
2. **Recipient resolution:** new intent branch: destination = the canonical `beneficiaryPhone` itself (the beneficiary may be unregistered — the delivery entity's `recipient_id` uuid constraint forces a schema decision: recommended additive widening `recipient_id` → nullable with a new `recipient_phone_hash`/`recipient_type='BENEFICIARY_PHONE'`, or store the resolved customerId when the phone matches a registered customer and fall back to the phone-recipient row otherwise — decision D-N2). Never store the plaintext phone outside `destination` (already the case for customers) and keep `destination` out of admin projections (already the case).
3. **Template (seeded, admin-editable thereafter):** `"{{sender_name}} sent you {{amount}} via MonieNaija. Locate the nearest authorized agent to collect your money: {{agent_locator_url}}"` — variables resolved as: `amount` = `formatNgn(principal_minor)`; `agent_locator_url` = configured public base URL (env/`notification_sender_identities`-style config key `PUBLIC_AGENT_LOCATOR_BASE_URL`) + optional short token; `sender_name` = **not available today** (decision D-N1: collect an optional sender display name at initiation, or use an approved generic like "A MonieNaija customer"). The template engine's whitelist makes it structurally impossible to add `transferNumber`, `senderPhone` or `transferCode` as variables for this event (they are not registered; the transfer code is additionally redacted at enqueue and never present in the payload).
4. **Superseded template:** the existing pair-rendering `cash_to_cash.created` string is retired for SMS (F-S2); `cash-to-cash-locator-contract` unit tests re-baselined to assert the NEW non-disclosure rule (number/sender-phone/code absent from rendered SMS).
5. **Agent locator page:** new PUBLIC read-only surface (lightweight web page — hosting decision D-N5) backed by a new public endpoint listing ACTIVE agents' outlets eligible for C2C redemption (capability CASH_TO_CASH + ACTIVE lifecycle + ACTIVE outlet), searchable by city/state (existing outlet columns); optional location-based discovery requires latitude/longitude columns on `agent_outlets` (additive migration + capture workflow — phase 2). No agent PII beyond outlet name/displayName/address; no receiving numbers, no balances. Rate-limited and cache-friendly.
6. **claimed/expired SMS:** enqueue `cash_to_cash.claimed` (recipient = beneficiary phone-recipient; message without secrets) and wire `cash_to_cash.expired` emission into the expiry sweep when the OA-40 trigger is built (Ordinary Agent V1 audit backlog B1/B2) — same template registry.

---

## 5. Database and API changes required (summary)

**Additive migrations (no destructive change):**
1. `notification_templates` (§4.1) + seed of current hardcoded strings as version 1.
2. `notification_event_configurations` (§4.2) + seed from the event-map catalogue.
3. `notification_deliveries` channel CHECK widening to include `EMAIL` (§4.3) + recipient widening per D-N2 (§4.7.2).
4. Optional phase 2: `agent_outlets` latitude/longitude (locator discovery), provider-secrets table (only if D-N3 chooses DB storage), agent contact-method model (only if D-N6 approves agent SMS).

**New/changed API surface:**
- `GET internal/notifications/events` (catalogue + config + active template versions).
- `GET/POST/PATCH internal/notifications/templates` (+ `/:id/activate`, maker-checker wrapped), `POST internal/notifications/templates/preview` (renders with sample data; never sends; never persists).
- `PATCH internal/notifications/events/:eventType/configuration` (toggle, `toggle_locked` enforced).
- `POST internal/notifications/test-send` (dual control, rate-limited).
- `GET internal/notifications/provider-status` (non-secret status view).
- Public: `GET /api/v1/public/agent-locator/outlets` (or chosen host) + static locator page (§4.7.5).
- Authorization catalogue: new functions listed in §4.6 (catalogue-driven, following the existing `requireFunction` pattern — no guard drift: declared gates only).

**No change** to: outbox service/contract, worker loop, dispatcher seams, provider interface, security-critical direct sends, customer inbox semantics (except EMAIL projection decision), financial services (they gain at most one `enqueueOnce` call inside existing transactions).

---

## 6. Prioritized implementation backlog

| Rank | Task | Scope | Depends on | Suggested owner |
|---|---|---|---|---|
| P0-1 | Remove or implement `assertSafe()` no-op (F-S1) + default-branch leak fix (F-S3) | Tiny, security hygiene | — | ARENA 1 |
| P1-1 | Template registry migration + resolver-based rendering + seeded v1 templates + audit (F-M2, reqs 2/5/6/12) | Backend | — | ARENA 1 |
| P1-2 | Event configuration table + toggle enforcement + `GET events` (F-M3, reqs 1/7) | Backend | P1-1 (shared admin module) | ARENA 1 |
| P1-3 | Authorization functions + maker-checker for template/config changes (req 13) | Backend | catalogue pattern exists | ARENA 3 |
| P1-4 | Email channel: type widening, provider seam + console adapter, resolver, preference honoring (F-M1, reqs 3/4/8-email) | Backend | P1-1 | ARENA 1 |
| P2-1 | Admin Web notification management screen: event/template list+edit+preview+toggle, provider status, test-send UI, deliveries (extend SystemHealth section) (reqs 1–11 UI) | Frontend | P1-* APIs | ARENA 2 |
| P2-2 | C2C beneficiary SMS: enqueue + phone-recipient resolution + seeded locator template + supersede old template + re-baseline locator-contract tests (F-S2, §4.7.1–4/6) | Backend | P1-1, D-N1, D-N2 | ARENA 1 |
| P2-3 | Public agent-locator page + endpoint (city/state search) (§4.7.5) | Full-stack | D-N5 | ARENA 2 (+1 API) |
| P2-4 | Test-send endpoint with dual control + rate limit (req 10) | Backend | P1-3 | ARENA 3 |
| P3-1 | Robase delivery-receipt polling or webhook ingestion (delivered/failed beyond "accepted") | Backend | provider ops decision | ARENA 1 |
| P3-2 | Agent contact-method model → unblock AGENT SMS destinations (F-M8) | Backend | D-N6 | ARENA 3 |
| P3-3 | Map or formally document `deposit.*`/withdrawal outbox events (F-M9) | Backend/docs | product ruling | ARENA 1 |
| P3-4 | Email production provider adapter | Backend | D-N4 | ARENA 1 |
| P3-5 | Geolocation locator discovery (lat/lng columns + capture) | Full-stack | D-N5 phase 2 | ARENA 2 |

Each task's acceptance criteria must include: real-PostgreSQL integration tests (the sms-v1-01 pattern: enqueue → worker → delivery row → provider capture), no-secret-persistence assertions, opt-out/security-class behavior, maker-checker negatives, and full-regression green. Notification retries must never call financial services (existing invariant, test 14 pattern).

## 7. Dependencies and unresolved product decisions

- **D-N1 `sender_name` source:** C2C collects only `senderPhone` and the approved contract explicitly does NOT treat it as verified identity. Choose: (a) optional sender display name captured at initiation (new DTO field — contract amendment), (b) approved generic wording, (c) beneficiary-registered name when the beneficiary is a known customer (asymmetric). Template cannot ship without this ruling.
- **D-N2 Unregistered-benefit recipient model:** delivery rows require `recipient_id uuid`. Approve schema widening (nullable recipient_id + phone-recipient class) or restrict beneficiary SMS to registered customers only (weakens the product requirement — beneficiaries are explicitly cash-pickup customers).
- **D-N3 Provider credential storage:** keep env-only (recommended V1, preserves fail-fast + no-DB-secret posture) vs DB-stored with envelope encryption + KMS + maker-checker.
- **D-N4 Email provider selection:** no email provider is integrated or chosen; Robase email availability, SES/SendGrid/other — including deliverability/DKIM/SPF operational ownership.
- **D-N5 Agent-locator hosting + URL governance:** which surface hosts the public locator page (new public bundle, admin-web public route, customer-web), the canonical URL/config key, abuse protections (rate limit, no scraping of the full agent list), and whether locator URLs embed a per-transfer short token (privacy vs analytics).
- **D-N6 Agent SMS destinations:** adopt an authoritative agent contact-phone model (unblocks agent lifecycle + support-ticket agent legs, currently all SKIPPED) or ratify "agents receive no SMS in V1".
- **D-N7 Supersession record:** adopting the non-disclosure beneficiary template formally supersedes the approved six-digit contract §6 template behavior for SMS; the contract document and `cash-to-cash-locator-contract` tests must be re-baselined in the same change (audit trail of the product decision required).
- **D-N8 Trigger-toggle blast radius:** which catalogue events are `toggle_locked` beyond the SECURITY class (recommend: all `required:true` events — funding outcomes, transfer outcomes — locked; informational events toggleable).
- Existing recorded decisions still gating adjacent work: beneficiary-SMS-as-release-gate (Ordinary Agent V1 register D8 — this mission effectively answers YES), agent lifecycle notifications (D9 — P3-2 dependency), push (V2 by record).

## 8. Exact source references (index)

`src/notification/{notification.module.ts, notification-provider.interface.ts, robase-notification-provider.ts, notification.types.ts, notification.constants.ts, notification-template.service.ts, notification-event-map.ts, notification-channel-resolver.service.ts, notification-dispatcher.service.ts, notification-worker.service.ts, notification-delivery.entity.ts, notification-inbox.controller.ts, notification-inbox.service.ts, notification-security.constants.ts}` · `src/operations/outbox.service.ts` + `outbox-event.entity.ts` · `src/config/environment.ts:143-217` (provider/worker/retry schema + production guards) · migrations `1785753600024-AddOutboxEventContract`, `1785753600065-CreateNotificationDeliveries` · direct OTP senders: `src/customer-registration/customer-registration.service.ts:124`, `src/admin/admin-customer-credentials.controller.ts:75`, `src/agent/agent-desk-otp.service.ts:88` (+ :209-230 direct-send rule) · enqueue sites: `transfer.service.ts:509,733`, `transfer-lifecycle.service.ts:537`, `customer-funding.service.ts:235,531,617`, `support.service.ts:305,388,625,647,734,863`, `deposit.service.ts:285,363`, `withdrawal.service.ts:335,434`, `ar-control-account-provisioning.service.ts:254`, `external-settlement.service.ts:1111` · admin diagnostics: `src/admin/admin-notification.controller.ts` (`GET internal/notifications/deliveries`, destination excluded) · admin UI: `apps/admin-web/src/screens/authenticated/SystemHealthScreen.tsx:32-95` · preferences: `src/customer-preference/notification-preference.entity.ts` · tests: §1.5 table · C2C template conflict: `notification-template.service.ts` `cash_to_cash.created` branch vs `docs/APPROVED-C2C-SIX-DIGIT-REDEMPTION-CONTRACT.md` §6 vs this mission's requirement.

## 9. Delivery record

- Audited baseline SHA: `b8a5b94ee55aad7407dd78068428b3e97236ce8e` (inspected tree `e90a208d0a3f25b66a8f4b3d967b6866ef4587f5` — documentation-only delta).
- This document is the sole change of the accompanying documentation commit on `arena/8e59e188-monienaija`; its SHA is recorded in the commit output and reported with this delivery. No branch other than the pinned ARENA 3 branch was touched; no merge, reset of shared history, rebase, force-push, deployment or production migration occurred.
