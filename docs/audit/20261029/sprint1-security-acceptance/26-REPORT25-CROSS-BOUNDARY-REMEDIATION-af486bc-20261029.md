# 26 — Report 25 Cross-Boundary Security Remediation Record

- **Date:** 2026-10-29
- **Branch:** `arena/8e59e188-monienaija` (pinned)
- **Pre-remediation baseline:** `af486bcd133ab56c911286c121e06219665b9135`
- **Audit addressed:** Arena 4 report `25-FINAL-INDEPENDENT-SECURITY-ACCEPTANCE-af486bc-20261029.md` (audit commit `bf7bffd0ab95e915cef2eb9792f4bb430c9cd430`, verdict **NO-GO**, R-04 FAIL)
- **Scope:** credential disclosure, diagnostic sanitization, and closely related availability safety across EVERY application-controlled output boundary. No financial accounting, Ordinary Agent V1 contract, D-01/D-04, provider activation, migration, or deployment changes. All credentials in tests are synthetic.

This record contains: the source-referenced boundary inventory (Phase 1), the pre-remediation failing reproductions (Phase 2), the implementation summary (Phase 3), the documented assertion supersession, the end-to-end coverage matrix (Phase 5), validation results (Phase 6), and residual risks. Acceptance is NOT self-declared; Arena 4 assesses.

---

## 1. Boundary inventory (Phase 1)

Every path by which client-controlled diagnostic data or credentials can reach an HTTP response, response header, or log line. "Gap" = state at baseline `af486bc`; the exception filter was NOT assumed to protect hooks or the logger, and it does not (they are separate code paths).

| # | Untrusted source | Transformation(s) at baseline | Sink | Existing protection at baseline | Gap at baseline | Remediation |
|---|---|---|---|---|---|---|
| 1 | `x-request-id` / `x-correlation-id` / `x-trace-id` request headers | `createRequestContext` → `safeHeader` (printable ASCII ≤255, shape only) | `X-Request-Id` / `X-Correlation-Id` / `X-Trace-Id` response headers via `main.ts` onRequest hook | shape validation only | Raw echo: `x-correlation-id: bearer abcdefgh` reflected verbatim (audit-confirmed) | Sanitize-at-creation choke point (`safeIdentifier`) — every consumer downstream receives already-sanitized values |
| 2 | same headers | same | `SERVICE_DRAINING` 503 response body (`requestId`/`correlationId`/`traceId`) via onRequest hook | shape validation only | Raw credentials in availability-path body | same choke point; availability semantics (503, tracker accounting) unchanged |
| 3 | same headers | same | onResponse hook `request.log.info({...context, operationName, …})` | shape validation only | Raw context spread into log line (note: production `FastifyAdapter` runs without a fastify-level logger, so this sink is a silent no-op today — latent, not inert; see §7) | same choke point; sink made observable and permanently tested in the E2E harness |
| 4 | same headers | same | pino `customProps` (every pino-http request log) + `genReqId` (`AppModule` pinoHttp wiring) | shape validation only | Raw context copied into every structured request log (audit-confirmed) | same choke point + `req.headers.x-request-id` / `x-correlation-id` / `x-trace-id` added to pino `redact.paths` |
| 5 | ALL raw request headers | pino-http default `req` serializer (`req.headers` wholesale) | every pino-http request log | `redact.paths`: `authorization`, `cookie`, `x-api-key` | identity headers and `proxy-authorization` not censored | redact.paths extended (`x-request-id`, `x-correlation-id`, `x-trace-id`, `proxy-authorization`) |
| 6 | `request.url` query string | pino-http default `req` serializer (`url` raw with query; parsed `query` object) | every pino-http request log | none (report-19 excluded query from *exception* payloads only) | Raw query logged (`"url":"/api/v1/...?type=FUNDING"` observed in integration logs); credential carrier | custom `serializers.req`: `query` dropped entirely, `url` → `redactRequestUrl` (query/fragment excluded, percent-decoded, redacted), `params` values sanitized; `req.query` retained as a permanent fail-safe redact path |
| 7 | `request.url` (raw, with query) | onResponse `operationName: request.routeOptions?.url ?? request.url` fallback | request log | route template is application-controlled; only the fallback is untrusted | Fallback logs raw URL incl. query; reachable whenever no route matched (404 — fastify leaves `routeOptions` undefined) | fallback → `redactRequestUrl(request.url)` (shared boundary) |
| 8 | exception content (message, custom `error` field, response objects) | `GlobalExceptionFilter` bounded redaction | 4xx/5xx bodies, response headers, 5xx error log | full report-19/21/23 architecture (bounded, fail-closed, hostile-object safe) | inherited sanitizer gaps only (case/length scheme bypasses) | unified scheme rule (see path 9) + sanitized context flow; filter architecture untouched |
| 9 | free-text `basic`/`bearer` credentials in any diagnostic string | `redactSensitiveText` → `applyCredentialShapes` Branch A (canonical casing, ≥4 chars) + Branch B (any casing, marker-gated, ≥4 chars) | every redaction sink above | report-21/23 shapes | Audit-confirmed survivors: `bearer abcdefgh`, `bEaReR abcdefgh` (casing), `Bearer abc`, `Bearer a`, `bearer abc`, `BEARER a` (length floor; RFC 6750 b64token permits 1+) | single unified case-insensitive rule, no marker, no length floor (see §3) |
| 10 | context identifiers read via `getRequestContext` | POA controller → service → DB audit persistence | persisted audit records | shape validation only | Raw credential could be persisted (echo/persistence risk called out by the audit) | fixed at creation by the choke point — all consumers (HTTP, persistence, background workers reusing `correlationId`) inherit sanitized values |
| 11 | provider request/response content (brevo, resend, robase, dispatcher) | `sanitizeDeliveryErrorCode` allowlist; structured enum fields only (`msg` codes, `eventType`, `eventKey`, `formatSafeHttpStatus`); `correlationId` from context | provider diagnostic logs / delivery records | **safe by design**: provider prose (`message`) and destination addresses are never echoed (`src/notification/provider-security.ts`, `brevo-email-provider.ts`) | none found; context-sourced `correlationId` inherits the path-1 gap | no change needed; context identifiers now sanitized upstream |
| 12 | `req.body` sensitive fields | pino `redact.paths` (~25 fields) | request logs | report-19/20 baseline | none | preserved verbatim in extracted `buildPinoHttpOptions()` |

Grep-confirmed: the codebase has **no interceptors or middleware** in `src/` — the hooks, the exception filter, and the pino wiring are the entire HTTP boundary. No other `.header()` sinks take client input (POA download headers come from stored internal metadata; partner-service headers are input-side).

---

## 2. Pre-remediation failing reproductions (Phase 2)

Written and executed BEFORE any sanitization change (only the two verbatim extractions — §3 items E1/E2 — were in place, verified behavior-neutral: tsc, build, and the 146-test focused battery all green at that point).

**Permanent specs:**
- `test/report25-scheme-case-gaps.spec.ts` (15 tests) — pre-fix result: **11 failed / 4 passed**
  - Failing: all six audit survivor strings; `basic dtpw`; tab/newline variants; JSON-embedded credential; free-text prose credential; both `createRequestContext` audit probes; `x-request-id`/`request.id` probe; filter 500 harness (body/headers/log context verbatim `bearer abcdefgh` / `bearer abc`); filter 400 harness (`error` field verbatim).
  - Passing (as expected): preservation policy tests, legitimate identifier preservation, traceparent preservation, multi-credential string (marker-bearing tokens were already caught by Branch B).
- `test/report25-cross-boundary-e2e.spec.ts` (10 tests) — pre-fix result on the original 8: **6 failed / 2 passed**
  - Failing: credential-bearing identity headers echoed **verbatim** into response headers (captured evidence: `Expected: "[REDACTED]"`, `Received: "bearer abcdefgh"`), bodies and request logs; SERVICE_DRAINING 503 leak; 5xx `errorMessage` leak (`upstream auth failed: bearer abcdefgh` verbatim in the filter's error log); 4xx `error` field leak; query-string sentinel in request logs; percent-encoded route-param sentinel in request logs.
  - Passing (as expected): legitimate lifecycle; `Authorization` header guard (already protected).

**Potency proofs (mutation checks):** with the `operationName` fix temporarily reverted, the 404 fallback E2E test **fails** (raw URL with query sentinel logged) and passes with the fix restored — the permanent test genuinely exercises sink 7. During this investigation two lifecycle facts were established and encoded in the harness: fastify matches routes BEFORE `onRequest` hooks (so `routeOptions.url` is defined even for short-circuited draining responses — the 404 path is the reachable form of the fallback), and production's `FastifyAdapter` has no fastify-level logger (hook `request.log` is a no-op today), so the harness wires fastify's `loggerInstance` into the capture stream with the production serializers to make sinks 3/7 observable and permanently tested.

---

## 3. Implementation summary (Phase 3)

**Extractions (verbatim, behavior-preserving; required because `main.ts` executes `bootstrap()` at module load and is not importable from tests):**
- **E1** `src/production/request-hooks.ts` — `registerRequestContextHooks(http, { requestTracker, apiVersion })`: the exact onRequest/onResponse hooks previously inlined in `bootstrap()`. `main.ts` now calls it with the same tracker and `environment.API_VERSION`.
- **E2** `src/production/pino-config.ts` — `buildPinoHttpOptions()`: the exact pino-http wiring previously inlined in `AppModule` (`LoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions() })`). Verified faithful: `nestjs-pino` passes the options object straight to `pinoHttp(...)`, which builds its pino instance from the same options, so `redact`/`serializers` land on the real production logger.

**Fixes:**
- **F1 — unified scheme rule** (`src/common/sensitive-data-redaction.ts`, `applyCredentialShapes`): both report-23 branches replaced by one rule — word-bounded `basic`/`bearer` in ANY casing (spelled via character pairs), any whitespace run, then a run of at least ONE token character (`[^\s"',;:()[\]{}|\\`]*[A-Za-z0-9+/=_-]`), redacted as a complete region. No casing discriminator, no marker requirement, no length floor. Linear backtracking; bounded-input and fail-closed architecture untouched. Colon-blocked prose (`Basic: …`), bare scheme words (`tokenType: Bearer,`), and context-free strings remain preserved.
- **F2 — sanitize-at-creation choke point** (`src/production/request-context.ts`): new `safeIdentifier()` = existing `safeHeader` validation THEN `redactSensitiveText`, applied to the `request.id` parameter and all three header-derived identifiers. Internally generated `randomUUID()` values and traceparent-extracted hex remain trusted. Fixes sinks 1–4 and the persistence path (10) in one place for every present and future consumer.
- **F3 — pino redact.paths + custom `req` serializer** (`src/production/pino-config.ts`): paths added for `x-request-id`, `x-correlation-id`, `x-trace-id`, `proxy-authorization`, plus `req.query` as a permanent fail-safe; `serializers.req` drops `query`, normalizes `url` via `redactRequestUrl`, sanitizes `params` values, and passes `headers` by reference so fast-redact still censors them.
- **F4 — operationName fallback** (`src/production/request-hooks.ts`): `request.routeOptions?.url ?? redactRequestUrl(request.url)`.
- **F5 — shared URL boundary** (`src/common/sensitive-data-redaction.ts`): exported `redactDiagnosticPath` (moved verbatim from the filter's private `diagnosticPath`), new `redactRequestUrl` (query/fragment stripped, percent-decoded with throwing-decode fallback to raw, then redacted), new `sanitizeDiagnosticParams` (hostile/revoked-Proxy values fail closed to `[REDACTED]`; `Array.isArray` and joins guarded).
- **F6 — filter** (`src/http-exception.filter.ts`): local `diagnosticPath` replaced by the shared `redactDiagnosticPath` import (identical behavior). No structural changes to the filter — its bounded, fail-closed, hostile-object-safe architecture from reports 19–23 is untouched, and it now also receives already-sanitized context (F2).

Policy properties preserved: bounded processing and fail-closed defaults (unchanged architecture), legitimate correlation/traceability (legitimate identifiers pass through byte-identical), normal NestJS/Fastify behavior (extractions verified behavior-neutral), no destructive global redaction of context-free strings (preservation tests green).

---

## 4. Documented assertion supersession (mission-mandated policy change)

The unified rule intentionally overrides TWO prose-preservation assertions that encoded the pre-report-25 casing/marker discrimination. Per the mission — "where prose conflicts with credential recognition, document and enforce the policy preferring explicit credentials over ambiguous prose" — both tests were UPDATED (not deleted) to pin the new policy, with in-file comments marking them `SUPERSEDED BY REPORT 25`:

1. `test/report23-scheme-and-revoked-proxy.spec.ts` — "preservation: lowercase prose scheme words keep their ordinary runs" → "report-25 policy: prose runs directly after a scheme word are conservatively redacted".
2. `test/report21-basic-scheme-and-proxy-safety.spec.ts` — "ordinary prose around the scheme word is preserved" → "report-25 policy: ordinary prose directly after the scheme word is conservatively redacted".

Effect on prose: `'a basic understanding of the system is required'` → `'a [REDACTED] of the system is required'`; `'the bearer of good news arrived'` → `'the [REDACTED] good news arrived'`. These were exactly the shapes the audit exploited (`bearer abcdefgh`), so the exemption could not survive. **No security assertion was weakened or removed anywhere**; every other preservation assertion (colon-blocked prose, bare scheme words, context-free tokens/Base64, the report-23 pinned caveat `Basic Authentication is disabled` → `[REDACTED] is disabled`) still passes unchanged.

---

## 5. Security-boundary coverage matrix (Phase 5)

Every inventory path maps to at least one PERMANENT test. Specs: `test/report25-scheme-case-gaps.spec.ts` (U), `test/report25-cross-boundary-e2e.spec.ts` (E), plus the standing suites.

| # | Source → sink | Permanent test(s) |
|---|---|---|
| 1 | identity headers → response headers | U "exact audit probe: canonical…", U "exact audit probe: lowercase/short…", U "x-request-id header and the request.id parameter…", E "exact audit reproduction: scheme credentials in identity headers…" |
| 2 | identity headers → SERVICE_DRAINING 503 body | E "SERVICE_DRAINING 503 responses and headers stay clean with credential ids" (body + headers + tracker accounting) |
| 3 | identity headers → onResponse hook log | E "exact audit reproduction…" (logText assertions over the harness that observes hook log lines), E "a short-circuited draining response keeps every log line clean" |
| 4 | identity headers → pino customProps/genReqId | E "exact audit reproduction…" (all captured log lines), U context-creation probes (same values feed customProps) |
| 5 | raw headers → pino `req.headers` | E "exact audit reproduction…" (identity headers), E "the Authorization header value never appears in request logs" (regression guard) |
| 6 | query string → pino `req.url`/`req.query` | E "a credential in the query string is absent from every structured request log" (+ path diagnostic fidelity assertion) |
| 7 | raw URL fallback → operationName | E "an unmatched route (404) never logs the raw-URL operationName fallback with its query" — **potency-proven** by revert mutation (§2) |
| 7b | percent-encoded param/url credential | E "a percent-encoded credential in a route parameter is absent from every structured request log" |
| 8 | exception content → filter body/headers/log | U "500: credential-bearing correlation/trace ids are clean in body, headers and log context", U "400: a credential in the custom error field is redacted…", E "5xx…", E "4xx…", plus standing suites: `report23-scheme-and-revoked-proxy` (18), `report21-basic-scheme-and-proxy-safety` (20), `report19-final-error-boundary` (22), `http-exception-filter`, `sensitive-data-redaction-adversarial` (35), `report16-redaction-hardening`, `sensitive-data-protection` |
| 9 | free-text scheme credentials → redactor | U "exact audit reproductions: non-canonical casing…", U "…valid short credentials (1-3 chars)…", U "lowercase scheme with all-lowercase marker-free token…", U "tab/newline separated…", U "multiple credentials in one string…", U "credentials inside structured diagnostic fields…", U "free-text error prose…", U "policy preservation…", + updated report-21/23 policy tests (§4) |
| 10 | context → persistence (POA/audit) | U context-creation probes (choke point upstream of every consumer); POA/compliance behavior re-verified by the PG integration battery (11/11) |
| 11 | provider diagnostics | Safe by design (structured enums + allowlist); standing provider unit suites (`brevo-email-provider`, `resend-email-provider`, `robase-notification-provider`, dispatcher) green in the full unit run |
| 12 | `req.body` → pino redact.paths | wiring preserved verbatim (E2); full unit + PG notification suites green |
| — | legitimate lifecycle preserved | E "a clean request keeps status, body, identity headers, logs and tracker accounting", U "legitimate correlation and traceability identifiers are preserved exactly", U "W3C traceparent-derived trace ids remain untouched" |

No boundary in the inventory is left unprotected or untested; nothing is claimed secure without a permanent executed test.

---

## 6. Validation results (Phase 6 — all counts from this session's own execution)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `tsc --noEmit -p tsconfig.json` | PASS |
| Build | `npm run build` | PASS |
| Lint (changed files) | `eslint` on all 11 touched files | PASS (0 errors) |
| Format (changed files) | `prettier --check` | PASS |
| Report-25 repro specs (post-fix) | `jest test/report25-*.spec.ts` | 25/25 (15 unit + 10 E2E) |
| Focused security battery | 9 suites (report19/21/23/25, filter, adversarial, report16, sensitive-data-protection) | 169/169 |
| Full backend unit suite | `npm run test` | **215/215 suites, 2254/2254 tests** (baseline 213/2229 + new 25; 2 tests superseded-in-place per §4) |
| PG integration battery 1 | `PG_TEST_RUN_ID=r25bat1a`, 6 suites, `--runInBand` | **6/6 suites, 76/76 tests** |
| PG integration battery 2 | `PG_TEST_RUN_ID=r25bat2a`, 5 suites, `--runInBand` | **5/5 suites, 73/73 tests** (PG total 11/11 · 149/149, matching the report-23/audit relevant set) |
| admin-web | `npm run ts:check` + `npm run test` | PASS + **27/27 suites, 188/188 tests** |

Pre-fix captures (for the audit trail): unit repro **11F/4P**, E2E repro **6F/2P** — detailed in §2.

PG suites executed (identical set to reports 19/21/23 missions): `v1-sprint1-f01-historical-delivery-disclosure`, `customer-compliance-authorization`, `v1-notification-provider-configuration-01`, `v1-sprint1-notification-delivery-authorization`, `notification-reliability`, `transfer-notification-producer-01` (batch 1); `v1-hardening-09-admin-notification-delivery-diagnostics`, `v1-005-notification-delivery`, `migration-chain`, `notification-migration-upgrade-01`, `notification-registry` (batch 2). Embedded PostgreSQL started for the batteries and stopped afterwards; disposable `mn_it_*` databases only.

---

## 7. Residual risks and limitations (explicitly unresolved or accepted)

1. **Prose over-redaction (accepted, documented policy).** Any ordinary word directly after a `basic`/`bearer` scheme word + whitespace is redacted (`the bearer of good news` → `the [REDACTED] good news`). This is the mission-mandated trade-off (§4); the report-23 fidelity caveat (`Basic Authentication is disabled` → `[REDACTED] is disabled`) remains pinned. Context-free strings are untouched.
2. **Production fastify logger is disabled.** `new FastifyAdapter()` runs without a fastify-level logger, so fastify's own request logs and the onResponse hook's `request.log` are silent no-ops in production today (sink 3 is latent). The E2E harness deliberately enables it (with the production redact/serializers) so the sink is permanently tested; if the logger is ever enabled in production, the wiring is already clean. `main.ts` was not changed to enable it (out of scope; availability/logging posture unchanged).
3. **`redactRequestUrl` decodes percent-encoding before redaction.** A path containing a literal encoded `%3F` is truncated at the decoded `?` — a fidelity-only loss in a diagnostic string, in the fail-safe direction. Malformed escapes fall back to the raw path (still redacted); decoding cannot throw.
4. **Identity-header censoring in pino `redact.paths` is belt-and-braces.** Because F2 sanitizes identifiers at creation, the header paths mainly censor the RAW inbound header values in `req.headers` logs; legitimate correlation ids remain traceable via `customProps` and the hook log line (asserted by the E2E legitimate-lifecycle test).
5. **Persistence path (10) is protected at the choke point but has no dedicated DB-persistence assertion** in this mission's new specs; it is covered indirectly by the creation-time probes plus the green PG compliance/POA suites. A dedicated persistence regression test remains a reasonable future addition.
6. **Provider diagnostics (11)** rely on the pre-existing structured-fields-only design; no new provider-side tests were added because no gap was found (grep-verified: enum codes, allowlisted error classification, no prose/destination echo).
7. **No self-declared acceptance.** Arena 4 performs the independent verification; all counts above come solely from executions in this session on the pinned branch.

---

## 8. Files changed

- New: `src/production/request-hooks.ts`, `src/production/pino-config.ts`, `test/report25-scheme-case-gaps.spec.ts`, `test/report25-cross-boundary-e2e.spec.ts`, this record.
- Modified: `src/common/sensitive-data-redaction.ts` (F1, F5), `src/production/request-context.ts` (F2), `src/http-exception.filter.ts` (F6), `src/main.ts` (E1 consumer), `src/app.module.ts` (E2 consumer), `test/report21-basic-scheme-and-proxy-safety.spec.ts` + `test/report23-scheme-and-revoked-proxy.spec.ts` (§4 supersession only).
