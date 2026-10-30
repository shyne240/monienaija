# 27 — Report 26 Remediation Record: 404 Query Reflection (N-01) and Business Correlation IDs (N-02)

- **Application baseline under remediation:** `2e364cd93cc58edf6240017615a3be1cc9c5bf37`
- **Independent audit addressed:** `b7fdc9a70b374d572d01caee7c61c4f6f9b4182e` — `docs/audit/20261029/sprint1-security-acceptance/26-FINAL-INDEPENDENT-SECURITY-ACCEPTANCE-2e364cd-20261029.md` (verdict NO-GO; findings **N-01** row 13, **N-02** row 14, **NOT VERIFIED** rows 10 and 15)
- **Branch:** `arena/8e59e188-monienaija` (pinned; no sibling branch touched)
- **Date:** 2026-10-29
- **Credentials in this record and all tests are synthetic sentinels only** (`Bearer abcdefgh`, `bearer abc`, `Basic dTpw`, `QSECRET_SENTINEL_R26`, `opaque-secret-987654321-r26`, `ACCESSSECRET_SENTINEL_R26`, `corr-biz-r26-42`). No live financial operation, provider activation, production database access, or production migration was performed.
- This document is an implementation record. **It does not declare independent technical security acceptance**; verification remains with the independent acceptance authority (A4).

---

## 1. Updated source-to-sink inventory (Phases 1 + 4)

Row numbers refer to the Report 26 inventory. "Ingestion" = caller-supplied value sanitized at the service boundary; "choke point" = shared persistence/mapping boundary sanitizes regardless of caller; "read boundary" = persisted legacy values masked when projected to consumers.

| # | Source → sink | Protection now in place | Where |
|---|---|---|---|
| 13 (N-01) | Unmatched-route raw URL/query → Nest/Fastify default 404 `message` → HTTP JSON body | `stripDiagnosticUrlQueries()` applied to non-HttpException 404-style messages at the centralized `GlobalExceptionFilter` boundary: removes `?query` and `#fragment` from path- and scheme-shaped URL tokens (including percent-encoded carriers such as `?e=bearer%20abcdefgh`), preserves query-free `Cannot GET /path` diagnostics, correct status codes, and existing keyed-redaction for messages that already contain credential text | `src/http-exception.filter.ts`, `src/common/sensitive-data-redaction.ts` |
| 14 (N-02) | DTO `correlationId` (cash-in/out, cash-to-cash, claim, funding, customer-funding, ledger post-journal) → financial execution → audit/outbox → response echo | Bounded, deterministic `sanitizeDiagnosticIdentifier()` at every service ingestion point **and** at the shared persistence choke points (double coverage): agent cash-in/cash-out/cash-to-cash/claim/expiry, agent funding, funding governance, financial execution entry (normalizes the whole command), desk OTP, customer funding (3 ingestion points), ledger `create` + `postJournal` compose | `src/agent/*.service.ts`, `src/ledger/ledger.service.ts`, `src/customer-funding/customer-funding.service.ts` |
| 14 (N-02) | audit/outbox persistence (`AuditService.record`, `OutboxService.record/enqueue/enqueueOnce`) | Choke-point sanitization of `correlationId`/`requestId`/`causationId` before INSERT parameters; audit `list()` lookup sanitizes the query side with the same deterministic function (symmetric) | `src/operations/audit.service.ts`, `src/operations/outbox.service.ts` |
| 14 (N-02) | Persisted outbox `correlationId` → notification intent map → delivery rows | `mapEventToIntents()` entry normalizes `outbox.correlationId`; dispatcher INSERT parameter sanitized | `src/notification/notification-event-map.ts`, `src/notification/notification-dispatcher.service.ts` |
| 10 | Request-context IDs (`X-Correlation-Id`, `X-Request-Id`, `X-Trace-Id` headers) → POA/audit persistence | Report-25 sanitize-at-creation choke point (`createRequestContext` → `safeIdentifier` + bounded redaction) re-verified with **new dedicated real-PostgreSQL read-back tests** through the exact POA audit-context shape (`{ correlationId: context.correlationId, requestId: context.requestId }`) — this closes the "no dedicated assertion writes a credential-shaped request-context ID through the real sink and reads it back" gap | `src/production/request-context.ts` (unchanged), new tests in `test/report26-correlation-persistence.integration.spec.ts` |
| 15 | Pre-remediation persisted diagnostic IDs → later audit-list / outbox-view / delivery-list / provider consumers | **Read-boundary protection, no backfill** (production data modification is prohibited): legacy raw `correlation_id` values are masked with `sanitizeDiagnosticIdentifier()` in `AuditService.list()` projections, `OutboxService` view projections, `NotificationDispatcherService.listDeliveriesForEventKey()`, and in the delivery processor's provider-send read boundary (the exact command handed to `provider.send`). Stored legacy rows are left untouched | audit/outbox/dispatcher/processor as listed |
| 11/12 | Provider diagnostics, pino request logs | Unchanged from Report 25/26 assessment (PASS); context-derived IDs inherit request-context protection; N-02 caller-supplied IDs are now sanitized before persistence, so downstream provider/log consumers only ever see sanitized values (processor read boundary adds defense in depth) | — |

**Additional correlation-ID sources traced in Phase 4 (beyond the HTTP request-context choke point):**

| Source | Origin of its correlation ID | Conclusion |
|---|---|---|
| B1 policy/commercial/billing/referral/campaign/fee/revenue engines (`src/policy/b1-*`, 400+ references) | Downstream of `AgentFinancialExecutionService` context (`ctx.input.correlationId`) or `command.requestContext.correlationId` | Covered by the execution-entry normalization and the request-context choke point; their persistence flows through `AuditService`/`OutboxService` choke points |
| `src/partner/external-settlement.service.ts` | `command.requestContext.correlationId` → `outboxService.enqueue` | Covered twice (context + outbox choke point) |
| `src/customer-registration/customer-registration.service.ts` | Internally generated `randomUUID()` | Trusted; not caller-supplied |
| `src/notification/notification-provider-config.service.ts`, `src/authorization/role-definition-governance.service.ts`, `commercial-rule-governance.service.ts`, `workforce-administration.controller.ts` | `requestContext.correlationId` / internal `randomUUID()`; sinks are audit/outbox | Covered (context choke point + persistence choke points) |
| DTOs with `correlationId` fields (`post-journal.dto`, `cash-in/out`, `cash-to-cash(+claim)`, `fund-agent`, customer-funding create/review) | Caller-supplied | Every consuming service ingestion point is listed in row 14 above and patched |

**Historical/legacy persisted values (row 15 disposition):** existing rows written before this remediation may contain unsanitized diagnostic IDs. Per the mission prohibition on production data modification/backfill, they are protected by the read-boundary masking listed above (audit lists, outbox views, delivery listings, provider-send commands), which covers every consumer path identified in the audit. A future controlled cleanup (a bounded, reviewed migration/backfill job that rewrites legacy `correlation_id` values through the same deterministic sanitizer) remains optional hygiene; it is **not required** for consumer safety because every read path is now masked, and it was deliberately not performed here.

---

## 2. Pre-remediation failing reproductions (Phase 2)

Both permanent reproduction specs were written first and executed against the unmodified baseline `2e364cd`. Result: **9 failed / 9 passed of 18** (the 9 passes are pre-existing report-25 guards and legitimate-behavior positive controls). Re-verified after all other work in a pristine `2e364cd` worktree with the identical result. Failing tests:

`test/report26-notfound-query-reflection.spec.ts` (real NestJS + Fastify lifecycle via `app.init()`/`inject`, production `GlobalExceptionFilter`, production pino config):

1. ✕ `exact audit reproduction: arbitrary parameter value is not echoed in the 404 message` — GET `/api/v1/no-such?x=QSECRET_SENTINEL` returned a 404 JSON body whose `message` contained `Cannot GET /api/v1/no-such?x=QSECRET_SENTINEL` (raw untrusted query echoed).
2. ✕ `exact audit reproduction: opaque secret in an unknown parameter is not echoed` — `?foo=opaque-secret-987654321` echoed verbatim.
3. ✕ `exact audit reproduction: percent-encoded bearer credential is not echoed or recoverable` — `?e=bearer%20abcdefgh` echoed; the encoded space never matched the literal-whitespace scheme rule, so the value survived both keyed redaction and the scheme rule, and decoding the message recovered the credential shape.
4. ✕ `a Cannot-message with an arbitrary query is stripped to the query-free path` — unit-level probe of the filter: the default unmatched-route message was not query-stripped.
5. ✕ `messages already carrying credential text remain fully redacted` — a message embedding both a URL query and credential text was only partially redacted.

`test/report26-business-correlation-ids.spec.ts` (fake-manager capture at the real persistence APIs):

6. ✕ `exact audit reproduction shape: a credential-shaped correlationId is sanitized before the audit entity is written` — `AuditService.record` persisted `Bearer abcdefgh` verbatim into the captured `AuditEvent` entity.
7. ✕ `the short/lowercase credential variant is sanitized too` — `bearer abc` persisted verbatim.
8. ✕ `a credential-shaped correlationId is sanitized before the outbox event is written` — `OutboxService` persisted the raw value.
9. ✕ `exact audit reproduction: the event map propagates a credential-shaped id unchanged today and must sanitize it` — `mapEventToIntents` copied the persisted raw value into notification intents unchanged.

Passing pre-fix (preserved behavior): keyed `access_token` 404 redaction, query-free pino logs for unmatched routes, matched-route/legitimate-404 behavior, absolute-URL query stripping in existing redaction, prose question marks untouched, legitimate business IDs preserved byte-for-byte (audit + outbox + event map), and the documented `CashInDto` acceptance policy (≤255-char string, sanitization downstream).

---

## 3. Implementation summary (Phase 3)

### 3.1 N-01 — 404 query reflection (centralized correction at the HTTP error boundary)

- New bounded helper `stripDiagnosticUrlQueries(text)` in `src/common/sensitive-data-redaction.ts`: removes `?…`/`#…` runs from tokens shaped like URLs (scheme-prefixed `https?://…` or path-shaped `/…`) wherever they appear after a boundary character. Ordinary prose with `?` is untouched; `:`/`;` remain legal inside path/query runs; the helper is fail-closed (non-string → canonical `REDACTED_VALUE`) and bounded (single regex pass, no recursion).
- `GlobalExceptionFilter` applies it, in addition to existing redaction, to the response `message` of non-`HttpException` errors and to default unmatched-route messages — the exact boundary where Nest/Fastify injects the raw URL. Status codes, headers, existing keyed/scheme redaction, and pino log behavior (already query-free per report-25 guards) are unchanged; the filter still never throws before responding.
- Useful diagnostics preserved: `Cannot GET /api/v1/no-such` (query-free path), matched-route errors, and custom `HttpException` messages keep working — asserted by permanent tests.

### 3.2 N-02 — caller-supplied business correlation IDs

**Policy (consistent, bounded, deterministic):** `sanitizeDiagnosticIdentifier(value)` — non-string/empty-after-trim/>255 chars → `undefined` (treated as absent, mirroring the legacy `?.trim() || null` idiom); otherwise `redactSensitiveText(trim(value))`. Legitimate identifiers (UUIDs, `corr-…`, `CASH_IN-…`, namespaced references) contain no credential shape and pass through **byte-for-byte**; credential shapes collapse to the canonical `[REDACTED]` marker.

**Equality/lookup investigation performed BEFORE implementing** (mission requirement). Findings and the resulting design:

- `AuditService.list({ correlationId })` looks rows up **by** correlation ID → the query side is sanitized with the same deterministic function as the write side, so lookups remain symmetric (a legitimate ID finds its row; a credential-shaped ID finds the `[REDACTED]` row exactly as the writer stored it). Verified by a dedicated PG read-back test.
- `OutboxService.enqueueOnce` retry equality compares an existing row against the incoming command → the comparison uses the **normalized** command (both sides sanitized), so identical credential-shaped retries deduplicate instead of falsely conflicting. Verified by a dedicated PG test.
- Notification delivery and outbox deduplication keys are `event_key`/recipient/channel-based and **exclude** correlation IDs → sanitization cannot break idempotency there.
- Business idempotency keys are a **separate field** (`idempotencyKey`) with their own validation and request-hash logic — untouched by this change.
- Documented trade-off: distinct credential-shaped IDs collide onto `[REDACTED]`. This is the intended fail-closed behavior (they are not legitimate correlation values); legitimate IDs never collide.

**Enforcement points (double coverage):** service ingestion (12 services, listed in §1) **and** shared choke points (`AuditService.record`, `OutboxService.record/enqueue/enqueueOnce`, `mapEventToIntents` entry, dispatcher INSERT, `AgentFinancialExecutionService.execute` entry which normalizes the whole incoming command). The DTO contract is deliberately unchanged (`CashInDto` still validates a credential-shaped `correlationId` with zero errors — asserted), so no legitimate caller behavior changes; the credential never reaches execution, persistence, response echo, notification mapping, or providers.

### 3.3 Row 15 — legacy persisted values: read-boundary protection (no backfill)

Legacy raw values stored before this remediation are masked at every consumer projection: `AuditService.list()`, `OutboxService` view/list projections, `NotificationDispatcherService.listDeliveriesForEventKey()`, and the delivery processor's provider-send read boundary (the command handed to `provider.send` carries the sanitized value even when the claimed row is legacy-raw). Stored rows are never rewritten. Each of the four read boundaries has a dedicated PG test that inserts a legacy raw row via SQL and asserts the consumer view is masked while the stored row remains untouched.

### 3.4 Row 10 — request-context → POA/audit persistence read-back

Two new real-PostgreSQL tests write through the exact POA audit-context shape: a credential-shaped `X-Correlation-Id` header is already `[REDACTED]` at `createRequestContext()` (report-25 choke point) and remains clean through `AuditService.record` into the persisted row; a legitimate header value survives creation and persistence byte-for-byte.

---

## 4. Database persistence verification (Phase 3 requirement — actual evidence)

`test/report26-correlation-persistence.integration.spec.ts` — **16/16 passed** against real embedded PostgreSQL 18.4 (disposable `mn_it_*` databases via `createIntegrationDataSource('r26corr')`; safe mocks only: capturing provider/resolver/execution doubles, no external provider, no live financial operation — the cash-in tests mock authorization/execution and assert persistence, never posting real value):

- **Audit sink (real `AuditService` + real DB):** credential-shaped ID persisted as `[REDACTED]` (SELECT read-back); legitimate ID byte-for-byte; symmetric `list()` lookup by correlation ID both directions; legacy raw row masked in `list()` while the stored row is untouched; row-10 request-context shapes (credential + legitimate).
- **Outbox sink (real `OutboxService` + real DB):** sanitized write; `enqueueOnce` ×2 with the same raw credential-shaped ID and same event key → same row ID, exactly 1 row, stored value sanitized (retry equality holds); legitimate ID byte-for-byte; legacy raw row masked in list views.
- **Notification mapping + delivery persistence (real `NotificationDispatcherService` + real DB):** `dispatch()` with a credential-shaped ID → delivery row `correlation_id = '[REDACTED]'`; legitimate ID → preserved; legacy raw row masked in `listDeliveriesForEventKey()`; **real `NotificationDeliveryProcessor`** claims a legacy raw PENDING row and the captured `provider.send` command carries `correlationId: '[REDACTED]'` (no `abcdefgh` in any provider command).
- **Service boundary (`AgentCashInService` with real audit persistence):** credential-shaped `correlationId` → sanitized in the service result, in the captured execution command, in the persisted `audit_events.correlation_id`, and in the persisted `new_values` JSON; a legitimate ID flows through execution, audit and response unchanged.

---

## 5. Security-boundary coverage matrix (Phase 5)

U = unit spec, E = real-lifecycle E2E/unit harness, P = PostgreSQL integration spec.

| Boundary | Audit evidence demand | Permanent tests |
|---|---|---|
| 404 body, arbitrary param | Row 13 N-01 | E "exact audit reproduction: arbitrary parameter value is not echoed in the 404 message" |
| 404 body, opaque unknown param | Row 13 | E "…opaque secret in an unknown parameter is not echoed" |
| 404 body, percent-encoded bearer | Row 13 | E "…percent-encoded bearer credential is not echoed or recoverable" |
| 404 message query stripping (unit) | Row 13 | U "a Cannot-message with an arbitrary query is stripped…", U stripper suite (5 tests) |
| Mixed credential text + URL query | Row 13 | U "messages already carrying credential text remain fully redacted" |
| 404 diagnostics/logs preserved | Report-25 guard | U "keyed access_token protection still holds", U "Pino request logs remain query-free for unmatched routes", U "matched routes and legitimate 404 diagnostics keep working" |
| Audit persistence (caller ID) | Row 14 N-02 | U ×2 (fake manager) + P ×4 (real DB incl. symmetric lookup, legacy masking) |
| Outbox persistence (caller ID) | Row 14 | U ×2 + P ×4 (incl. enqueueOnce retry equality, legacy masking) |
| Event map → intents → delivery rows | Row 14 | U ×2 + P ×4 (dispatch, legacy masking, processor provider boundary) |
| Cash-in service boundary end-to-end | Row 14 | P ×2 (credential redacted everywhere; legitimate preserved) |
| Request-context ID → POA/audit sink read-back | Row 10 | P ×2 (credential + legitimate) |
| Legacy persisted rows → consumers | Row 15 | P ×4 read-boundary masking tests (audit/outbox/deliveries/provider send) |
| DTO contract unchanged | Business semantics | U "CashInDto still validates a credential-shaped correlationId with zero errors" |
| Sanitizer determinism/bounds/fail-closed | Policy | U suite ×5 (credential collapse, byte-for-byte preservation, idempotence, fail-closed, trim) |

Standing regression list (F-01, R-03, prior R-04, report-19/21/23/25 protections, filter availability, bounded redaction, diagnostic fidelity, request/pino protections) is exercised by the focused battery in §6 — no assertion was weakened, and no existing spec was modified except where a documented supersession was already recorded in doc 26 (none in this mission).

---

## 6. Validation results (Phase 6 — all counts from this session's own execution)

| Gate | Command / identifier | Result |
|---|---|---|
| Pre-fix reproduction capture | Both repro specs at pristine `2e364cd` worktree | **9 failed / 9 passed of 18** (§2); re-verified post-implementation |
| TypeScript | `tsc --noEmit -p tsconfig.json` | PASS (0 errors) |
| Build | `npm run build` | PASS |
| Report-26 repro specs (post-fix) | `jest test/report26-notfound-query-reflection.spec.ts test/report26-business-correlation-ids.spec.ts` | **27/27** (18 original + 9 new sanitizer/stripper unit tests) |
| Focused security battery | 11 suites: report26 ×2, report25 ×2, report23, report21, report19, http-exception-filter, redaction-adversarial, report16, sensitive-data-protection | **11/11 suites · 198/198 tests** |
| Full backend unit suite | `npm run test` | **217/217 suites · 2281/2281 tests** (baseline 215/2254 + 27 new) |
| PG battery 1 | `PG_TEST_RUN_ID=r26bat1g`, 7 suites (6 prior + new report26 persistence), `--runInBand` | **7/7 suites · 92/92 tests** |
| PG battery 2 | `PG_TEST_RUN_ID=r26bat2a`, 5 suites, `--runInBand` | **5/5 suites · 73/73 tests** |
| PostgreSQL total | 12 suites (prior relevant 11 + new persistence spec) | **12/12 · 165/165** |
| admin-web | `npm run ts:check` + `npm run test` (in `apps/admin-web`) | PASS + **27/27 suites · 188/188 tests** |
| Lint (changed files) | `eslint` on all 21 touched/new files | **0 new errors**: the 3 new spec files are fully clean; the 4 touched src files carry pre-existing errors (120 total: customer-funding 112, financial-execution 5, cash-to-cash 2, c2c-claim 1) — a pristine `2e364cd` worktree lint of the same files yields the **identical 120 errors on identical lines**, none introduced by this change. Repo-wide `npm run lint` has 1409 pre-existing errors at baseline (not a gate this mission introduced) |
| Format (changed files) | `prettier --check` | 3 new spec files: clean. 14 touched src files show pre-existing prettier drift — identical `--check` failures at pristine `2e364cd`; deliberately **not** reformatted to avoid unrelated churn. The 4 files touched by report-25-era work (`http-exception.filter`, `sensitive-data-redaction`, `outbox.service`, `ledger.service`) pass both at HEAD and now |

PG suites executed (prior relevant set identical to reports 19/21/23/25 missions): `v1-sprint1-f01-historical-delivery-disclosure`, `customer-compliance-authorization`, `v1-notification-provider-configuration-01`, `v1-sprint1-notification-delivery-authorization`, `notification-reliability`, `transfer-notification-producer-01`, **`report26-correlation-persistence`** (battery 1); `v1-hardening-09-admin-notification-delivery-diagnostics`, `v1-005-notification-delivery`, `migration-chain`, `notification-migration-upgrade-01`, `notification-registry` (battery 2). Embedded PostgreSQL started for the batteries and stopped afterwards; disposable `mn_it_*` databases only. Note: the first battery-1 attempt failed 6 suites for a missing local `.env` (sandbox artifact, git-ignored, never committed); after `node scripts/prepare-pg-test-env.js` regenerated it, both batteries passed as recorded.

---

## 7. Residual risks and limitations (explicitly unresolved or accepted)

1. **Credential-shaped ID collision:** distinct credential-shaped correlation IDs collapse onto `[REDACTED]`; callers using credentials as correlation values lose per-request distinction. Intended fail-closed trade-off; legitimate IDs are unaffected.
2. **Legacy rows are masked, not rewritten:** raw values remain at rest in `audit_events`/`outbox_events`/`notification_deliveries` written before this remediation (row 15). All identified consumer paths mask them on read; direct unmediated SQL access by an operator would still see raw values. A future controlled cleanup job remains optional (see §1 disposition); no production data was modified.
3. **Provider activation not exercised:** delivery-processor tests use capturing mock providers; no real SMS/email vendor call was made (mission prohibition).
4. **No live financial operations:** cash-in boundary tests mock authorization/execution; real journal posting paths are covered by the existing A12–A19 PG suites, which pass unchanged.
5. **404 reflection scope:** the fix strips queries/fragments from URL-shaped tokens in default unmatched-route-style messages and redacts credential text everywhere; it does not attempt to reconstruct or normalize the path segment itself (paths are not attacker-secret carriers and remain useful diagnostics).
6. **Pre-existing lint/prettier drift** in touched files (customer-funding in particular: 112 pre-existing eslint errors) was left untouched; fixing it is out of this mission's scope and would create unrelated diff churn.

---

## 8. Files changed (18 source + 3 new specs)

Source (18): `src/common/sensitive-data-redaction.ts` (helpers), `src/http-exception.filter.ts` (N-01), `src/operations/audit.service.ts`, `src/operations/outbox.service.ts`, `src/notification/notification-dispatcher.service.ts`, `src/notification/notification-event-map.ts`, `src/notification/notification-delivery-processor.ts`, `src/agent/agent-cash-in.service.ts`, `src/agent/agent-cash-out.service.ts`, `src/agent/agent-cash-to-cash.service.ts`, `src/agent/agent-cash-to-cash-claim.service.ts`, `src/agent/agent-cash-to-cash-expiry.service.ts`, `src/agent/agent-funding.service.ts`, `src/agent/agent-funding-governance.service.ts`, `src/agent/agent-financial-execution.service.ts`, `src/agent/agent-desk-otp.service.ts`, `src/ledger/ledger.service.ts`, `src/customer-funding/customer-funding.service.ts` — diffstat: 169 insertions(+), 37 deletions(−).

New tests (3): `test/report26-notfound-query-reflection.spec.ts` (9 tests), `test/report26-business-correlation-ids.spec.ts` (18 tests), `test/report26-correlation-persistence.integration.spec.ts` (16 tests, PostgreSQL).

No existing spec was weakened, superseded, or deleted; no migration, entity, contract, fee, ledger-posting, or reconciliation logic was altered.
