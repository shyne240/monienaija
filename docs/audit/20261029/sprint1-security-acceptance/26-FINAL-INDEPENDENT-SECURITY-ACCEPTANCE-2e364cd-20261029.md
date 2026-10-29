# Report 26 — Independent security acceptance of Report 25 remediation

- **Review date:** 2026-10-29
- **Repository:** `shyne240/monienaija`
- **Documentation branch:** `arena/870f970d-monienaija`
- **Exact application commit reviewed:** `2e364cd93cc58edf6240017615a3be1cc9c5bf37`
- **Application branch:** `arena/8e59e188-monienaija` (isolated, detached target worktree)
- **Prior independent audit:** Report 25, audit commit `bf7bffd0ab95e915cef2eb9792f4bb430c9cd430`
- **Implementation report reviewed:** `docs/audit/20261029/sprint1-security-acceptance/26-REPORT25-CROSS-BOUNDARY-REMEDIATION-af486bc-20261029.md`
- **Method:** pinned-source and test review; independent type/build, backend, PostgreSQL, and Admin Web runs; synthetic direct probes; and an in-memory NestJS/Fastify app using the production request hooks, `GlobalExceptionFilter`, and the Pino options actually installed by `AppModule`. No application code or tests were changed.

## Executive decision

**Overall technical security acceptance: NO-GO.** The Report 25 work materially closes the reported short/case-varied Basic/Bearer redaction gaps at the tested sanitizer and exception-filter boundaries. Its extracted Pino configuration is genuinely used by `AppModule`; in a real NestJS/Fastify lifecycle probe, production-configured Pino request logs omitted raw query strings, including on successful, 4xx, 5xx, and unmatched-route requests. The exception filter returned responses for the exercised malformed/hostile metadata, and the revoked-Proxy regression remains covered by the passing suite.

Two independent residual paths prevent acceptance:

1. **N-01 — unmatched-route response query reflection (Low-to-Medium, conditional):** a real NestJS/Fastify 404 response body contains the raw query string. Arbitrary parameter values and an encoded Bearer-shaped value survive; a keyed `access_token` query parameter is redacted. This is an HTTP response disclosure, not a Pino/Fastify request-log leak. The existing 404 regression checks logs and does not assert the response body.
2. **N-02 — body-supplied `correlationId` bypasses the request-context choke point (Medium, conditional):** `AgentCashInController` forwards `CashInDto.correlationId` from the request body to `AgentCashInService`, which passes it into financial execution and audit persistence and returns it. The DTO accepts a synthetic `Bearer abcdefgh` unchanged. `AgentCashToCashService` similarly writes the optional caller-supplied ID into audit and outbox records; the notification consumer maps the persisted outbox ID to notification intents/delivery records. These values are not created by `createRequestContext()` and therefore are not covered by `safeIdentifier()`. No financial action was executed; source tracing and isolated DTO/event-map probes establish the path, while a dedicated database persistence assertion is absent.

These paths were absent from the submitted 12-path inventory. Thus the request-context fixes are accepted for the paths they cover, but the cross-boundary inventory is incomplete, R-04 is **FAIL**, and technical acceptance is **NO-GO**. Operational readiness remains unestablished; production is not authorized.

## 1. Scope, pinning, and safety

The target worktree was verified at exactly `2e364cd93cc58edf6240017615a3be1cc9c5bf37`; the source/test review and all independent checks below used that detached target, not the prior Report 24 worktree. The documentation branch was independently clean at prior audit commit `bf7bffd0ab95e915cef2eb9792f4bb430c9cd430` before this report was added. The dirty root checkout `/home/user/monienaija` was not modified.

All credentials and identifiers used in probes were synthetic. No provider was activated, no provider test-send was made, no production deployment or migration occurred, no production credential was used, and no financial transaction was executed. The embedded PostgreSQL instance used only disposable integration-test databases and was stopped after the test run.

## 2. Independent reconstruction of the HTTP and diagnostic boundary

### Production logger and request lifecycle

At the pinned target:

- `src/app.module.ts` passes `buildPinoHttpOptions()` into `LoggerModule.forRoot({ pinoHttp: ... })`. `nestjs-pino` therefore installs the production `pino-http` middleware and its custom request serializer, redaction paths, `genReqId`, and `customProps`.
- `src/main.ts` constructs `new FastifyAdapter()` without a Fastify logger instance. The production Fastify adapter's own `request.log` is consequently not a configured Fastify logging sink. This is distinct from the NestJS-Pino/pino-http logger, which is configured and active.
- `src/production/request-hooks.ts` contains the production `onRequest` and `onResponse` hooks. The onRequest hook creates context, sets response identity headers, starts request tracking, and creates the draining response. The onResponse hook calls `request.log.info`; with the production adapter this hook logger is a no-op unless Fastify logging is enabled. The hook was exercised in the independent lifecycle harness with a capture logger to verify its payload handling, but that harness observation is not presented as a production Fastify log sink.
- The lifecycle harness separately configured `LoggerModule` with the exact `buildPinoHttpOptions()` production object and captured actual pino-http request logs. This is the relevant production request-log evidence.
- `GlobalExceptionFilter` independently sanitizes exception response fields, operation names, response headers, and 5xx log context. It does not sanitize every string that Nest's unmatched-route adapter may place in the default 404 message.

### Independent boundary inventory

Statuses refer to independent review of the exact target. **NOT VERIFIED** means the relevant sink assertion was not directly exercised; it is not equivalent to proof of exposure. Items 13–15 are additions to the submitted 12-path inventory.

| # | Source → sink | Target protection / independent exercise | Reachability and regression coverage | Disposition |
|---|---|---|---|---|
| 1 | `x-request-id`, `x-correlation-id`, `x-trace-id` and Fastify request ID → `X-Request-Id`, `X-Correlation-Id`, `X-Trace-Id` response headers | `createRequestContext()` applies `safeIdentifier()` to the selected IDs; actual lifecycle requests with synthetic canonical, lower/mixed-case, short and legitimate IDs were exercised. | Matched success/error requests are reachable; Report 25 context and lifecycle regressions cover redaction and preservation. | **PASS** |
| 2 | Same identity headers → `SERVICE_DRAINING` 503 body | The same request-context choke point feeds the 503 fields; production hook exercised with a draining tracker. | Matched-route draining is reachable; status/body/header and tracker accounting are covered by the Report 25 E2E test. | **PASS** |
| 3 | Context + route/URL → `onResponse` `request.log.info` completion line | IDs are sanitized at creation; route template is used when available and raw-URL fallback passes through `redactRequestUrl()`. Hook logger exercised with a Fastify capture logger. | The payload is safe in the harness. Production `FastifyAdapter` has no Fastify logger, so this is **not** a live production log sink under current wiring; do not conflate it with Pino. | **PASS WITH SINK CAVEAT** |
| 4 | Request context → pino-http `genReqId` and `customProps` | Actual production `buildPinoHttpOptions()` used by `AppModule`; IDs originate in the sanitized request context. | Real request logs captured in the Nest lifecycle probe; short/case-varied credential regressions also pass. | **PASS** |
| 5 | Raw request headers → pino-http `req.headers` | `redact.paths` includes `authorization`, `cookie`, `x-api-key`, identity headers, and `proxy-authorization`; Authorization and Proxy-Authorization synthetic values were checked in captured logs. | pino-http is the production logger. Fastify's disabled logger is not used as evidence for this path. | **PASS** |
| 6 | `request.url` and parsed query → pino-http request serializer | Production `serializers.req` emits `redactRequestUrl(source.url)`, omits `query`, sanitizes params, and keeps `req.query` as a fail-safe redaction path. | Query sentinels and credential-shaped query values were absent from actual production-configured request logs across the exercised lifecycle cases; permanent Report 25 log tests cover query and route-param cases. | **PASS for logs** |
| 7 | Raw `request.url` fallback → `operationName` in completion diagnostics | `routeOptions.url ?? redactRequestUrl(request.url)`; direct unmatched-route lifecycle was exercised. | Fallback log path is reachable on unmatched route. The fallback is query-free in hook/Pino logs; potency/regression assertion exists. | **PASS for logs** |
| 8 | Exception messages, custom `error`, response objects, headers and exception logs → `GlobalExceptionFilter` | Bounded redaction, safe getters, fail-closed hostile-object handling; real lifecycle 4xx/5xx plus existing hostile exception tests were reviewed/run. | Tested response fields and logs were sanitized; malformed metadata did not prevent a response. The separate 404 raw-query message sink is recorded in row 13. | **PASS for exercised filter cases** |
| 9 | Free-text Basic/Bearer credential text → redactor and exception boundary | Direct probes and Report 25 regression tests cover short tokens and case variants; `Basic dTpw`, canonical/lowercase/mixed-case Bearer and short `Bearer abc` redact. | Direct/filter paths pass. Percent-encoded separator in an unmatched-route raw URL is not equivalent to a literal scheme-space-token input and survives in row 13. | **PASS for tested text shapes; residual in N-01** |
| 10 | Request-context IDs → POA/audit database persistence | Context IDs are sanitized before `getRequestContext()` consumers. Reviewed target persistence source and ran the relevant compliance/POA PostgreSQL suites. | No dedicated assertion writes a credential-shaped request-context ID through the real POA/audit sink and reads it back. The implementation report also acknowledges this. | **NOT VERIFIED at persistence sink** |
| 11 | Provider diagnostics and delivery records → logs/database | Provider response prose/destinations are constrained; provider-unit suites and notification suites passed. Context-derived IDs inherit request-context protection. | No provider was activated. Outbound provider behavior was not exercised. This row does not cover body-supplied business correlation IDs, which are separately recorded at row 14. | **PASS for reviewed structured diagnostic design; provider activation NOT VERIFIED** |
| 12 | Sensitive request-body fields → pino request logs | Production custom request serializer deliberately emits only selected request properties (not body); redaction paths retain the existing body-field defenses. | Pino logger was captured in the real Nest lifecycle harness; no request body was emitted in the serialized request object. `correlationId` business fields are not a sensitive-body-key rule and are assessed as a persistence source in row 14. | **PASS for pino request logging** |
| 13 | Unmatched request raw URL/query → Nest/Fastify default 404 `message` in HTTP body | Actual NestJS/Fastify app returned the default unmatched-route message; the global boundary redacted a known `access_token` key but did not remove arbitrary query parameters or decode an encoded scheme separator. | Reachable through a real HTTP lifecycle; the Report 25 unmatched-route test asserts that query values are absent from logs, not from the JSON response body. | **FAIL — N-01** |
| 14 | Caller-supplied DTO `correlationId` → business execution, audit/outbox and downstream delivery persistence | `CashInDto` accepts a ≤255-character string; controller forwards it; service passes it to financial execution/audit and returns it. Cash-to-cash passes it into audit/outbox; dispatcher maps persisted outbox `correlationId` to an intent and stores a delivery correlation ID. None is routed through `safeIdentifier()`. | Independent DTO validation probe accepted synthetic `Bearer abcdefgh` with zero validation errors; independent event-map probe propagated it unchanged. Static source trace establishes the controller/service/persistence path. No financial action or provider was invoked, and no dedicated real DB read-back assertion exists. | **FAIL — N-02; database persistence exercise NOT VERIFIED** |
| 15 | Pre-remediation persisted diagnostic IDs → later audit/list/provider consumers | No targeted cleanup/backfill was part of this remediation; existing records are not sanitized on read by the creation-time choke point. Report 25 documented raw context acceptance before this change. | Whether any deployed database contains such a value, and whether a particular historical row reaches a consumer, cannot be established in this sandbox. No production DB was examined. | **NOT VERIFIED; conditional legacy-data risk** |

The submitted inventory's paths 1–12 are broadly accurate for their stated sources, but not complete as a source-to-sink map: it treats all correlation IDs as if they originate in `createRequestContext()` and it does not include Nest's unmatched-route response message. Rows 13–15 are independent additions, not claims that Arena 3's test totals are invalid.

## 3. New findings and evidence

### N-01 — unmatched-route 404 reflects query string into the response body

**Severity: Low-to-Medium, conditional query/credential reflection. Reachability: CONFIRMED in real in-memory NestJS/Fastify HTTP lifecycle.**

The independent harness booted NestJS with a real `FastifyAdapter`, production request hooks, the production `GlobalExceptionFilter`, and `LoggerModule` configured from `buildPinoHttpOptions()` (Fastify's own logger was left unset, matching production). The unmatched-route request produced a 404 JSON message containing the raw URL/query. Synthetic observations included:

```text
GET /api/v1/no-such?x=QSECRET_SENTINEL
404 message: Cannot GET /api/v1/no-such?x=QSECRET_SENTINEL

GET /api/v1/no-such?foo=opaque-secret-987654321
404 message: Cannot GET /api/v1/no-such?foo=opaque-secret-987654321

GET /api/v1/no-such?e=bearer%20abcdefgh
404 message includes: ?e=bearer%20abcdefgh
```

The encoded space is retained as `%20`; the credential-shaped value is therefore still recoverable by decoding the URL. A recognized `?access_token=ACCESSSECRET_SENTINEL` was redacted in the response, confirming keyed query protection, but this does not protect arbitrary parameter names or a credential in a generic parameter. The request URL/query sentinels were absent from the production-configured pino-http logs, and the structured path/operation-name fields remained query-free. This finding is deliberately limited to the HTTP 404 response body; it is **not** evidence that production request logs retain queries.

The requester supplied the value, so this is not a demonstrated cross-user token retrieval. The security impact is conditional reflection into a server-generated error response, where client telemetry, browser history/error capture, proxy diagnostics, or downstream response logging may persist the query. It also contradicts the intended no-query diagnostic boundary. The current E2E regression exercises the unmatched-route log fallback but does not assert that the 404 body excludes arbitrary query data.

**R-04 disposition:** **FAIL** for the complete HTTP boundary. The standalone scheme sanitizer and tested exception fields now redact short/case-varied forms, but the raw URL-derived 404 message bypasses full query removal and allows an encoded credential-shaped value through.

### N-02 — body-supplied business `correlationId` is outside the request-context control

**Severity: Medium, conditional credential persistence. Reachability: source-to-sink route confirmed; direct DB read-back intentionally not exercised.**

The Report 25 remediation centralizes sanitization of request ID headers and Fastify request IDs. It does not validate every field named `correlationId` in application requests. For Agent cash-in:

1. `CashInDto.correlationId` accepts an optional string with a maximum length of 255 and no credential-shape constraint (`src/agent/dto/cash-in.dto.ts`).
2. `AgentCashInController` forwards `dto.correlationId` to `AgentCashInService` (`src/agent/agent-cash-in.controller.ts`).
3. `AgentCashInService` trims but does not sanitize it, passes it to financial execution, records it through `auditService.record`, includes it in audit values, and returns it (`src/agent/agent-cash-in.service.ts`). `AuditService.record()` writes the supplied correlation ID to the audit entity (`src/operations/audit.service.ts`).

A local DTO probe using synthetic `Bearer abcdefgh` returned that value unchanged and `validateSync()` returned no validation errors. No transaction was executed. The source-level route is reachable when the authenticated cash-in operation otherwise succeeds; successful financial/audit persistence is not independently asserted with that credential-shaped value in this review.

The analogous cash-to-cash path is also present: `AgentCashToCashController` forwards its DTO field; `AgentCashToCashService` writes the caller value to audit and to the `cash_to_cash.created` outbox row. `mapEventToIntents()` copies the outbox ID into notification intents, and `NotificationDispatcherService` persists correlation IDs in delivery rows. A direct synthetic event-map probe showed `Bearer abcdefgh` survives unchanged. No notification worker/provider was run.

This path is not proof that a different caller can read the value. It is proof that a caller-controlled value labelled as a diagnostic ID can become durable audit/outbox/delivery metadata and, in the cash-in response, is returned as-is. That materially differs from the sanitized header-derived context described in the remediation report. Durable storage of credentials is an avoidable confidentiality risk even when the caller initially knows the supplied value; privileged audit/operations consumers and future diagnostic integrations can expose it. The absence of a focused persistence assertion means the database sink remains independently unverified, not presumed safe.

**R-04 disposition:** **FAIL** for end-to-end diagnostic identifiers. Creation-time sanitization is effective for request-context IDs but does not cover body-supplied business correlation IDs. This is separate from N-01.

## 4. Retests of the requested security properties

- **Short/case-varied Basic/Bearer:** independent direct probe plus the target's permanent Report 25 tests confirmed redaction of `Basic dTpw`, lowercase/mixed-case Bearer, and short values such as `Bearer abc`. The tested sanitizer no longer has the prior four-character floor or case/marker bypass.
- **Query-bearing URLs and request logs:** actual Pino request records from success, 4xx, 5xx, and unmatched-route lifecycle requests omitted raw query strings. Route params and diagnostic URL fallbacks use the shared redaction helpers. N-01 is a separate response-body reflection.
- **HTTP error fields and exception logs:** real 4xx/5xx lifecycle cases and existing filter tests confirmed the body/error/log sanitizer remains active. No raw synthetic credential was found in the exercised filter output. The default unmatched 404 message requires separate query stripping.
- **Revoked Proxy and malformed metadata:** existing adversarial/filter suites passed; exercised hostile values failed closed without making the filter throw or preventing the response. This is bounded to the tested exception/response shapes, not arbitrary hostile Fastify transport objects.
- **Provider diagnostics:** source review and provider/notification suites confirmed closed error classifications and structured diagnostics; no provider activation or live request was performed. Context-derived correlation IDs inherit the request-context fix. The body-supplied correlation issue is documented separately and was traced through audit/outbox/delivery persistence; external provider-log reachability was not asserted.
- **Operation-name fallback:** actual unmatched-route lifecycle logs used the query-safe fallback, while the HTTP response body still contained query data. These outcomes are not contradictory; they are different sinks.
- **Diagnostic-ID persistence:** the target has no dedicated regression asserting credential-shaped context ID write/read behavior at the audit sink; the implementation report says so. Independent review also found caller-supplied DTO IDs, which bypass the context choke point. No real database was queried for existing production rows; the legacy-data concern remains NOT VERIFIED.

## 5. Distinct required verdicts

| Area | Independent verdict | Evidence / boundary |
|---|---|---|
| F-01 historical disclosure | **PASS for tested paths** | The F-01 unit and historical-delivery PostgreSQL integration coverage passed independently. No broader production-data claim is made. |
| R-03 provider-reference disclosure | **PASS for tested variants** | Provider-reference suffix/JWT and related standing adversarial suites passed; no provider activation occurred. |
| R-04 Basic/Bearer and diagnostic disclosure | **FAIL** | N-01 query-bearing 404 response and N-02 body-supplied correlation persistence bypass the complete intended boundary. |
| Exception-filter availability | **PASS for exercised hostile cases** | Revoked Proxy, malformed/hostile metadata and 4xx/5xx filter tests returned safe responses; arbitrary host/reply object certification is not claimed. |
| Bounded processing | **PASS within existing tested limits** | Report 16/adversarial bounded-processing tests passed in the focused and full suites. This is not a production load or memory benchmark. |
| Diagnostic fidelity | **PASS WITH CAVEAT** | The revised scheme rule intentionally redacts ordinary phrases, e.g. `Basic Authentication is disabled` → `[REDACTED] is disabled` and `the bearer of good news arrived` → `the [REDACTED] good news arrived`. Direct independent probes reproduced the caveat; accepted policy favors explicit credential recognition. No operational outage is inferred from this false positive. |
| Submitted 12-path inventory completeness | **FAIL** | Omits unmatched-route 404 response-body reflection and caller-supplied body correlation IDs; also leaves historical persisted rows unverified. This report adds rows 13–15. |
| Overall technical security acceptance | **NO-GO** | R-04 and inventory completeness fail due N-01/N-02; persistence assertions are incomplete. |
| Operational readiness | **NOT ESTABLISHED** | No deployment/rollback exercise, production configuration review, provider controlled test-send, on-call/alerting readiness, incident exercise, or production data review was performed. The implementation scope explicitly excludes provider activation and deployment. |
| Production authorization | **NOT AUTHORIZED** | This independent acceptance grants no production permission. No production activity occurred. |

**R-01, R-02, D-01, and D-04 remain separate.** They were not reassessed here, no new disposition is assigned, and none is substituted for the R-04/technical-security decision above.

## 6. Independent validation record

All results below were independently executed against exact application SHA `2e364cd93cc58edf6240017615a3be1cc9c5bf37`. They are separate from Arena 3's implementation-report totals, even where the counts happen to match.

| Gate | Independent result |
|---|---|
| Backend install | `npm ci` passed; 979 packages installed. npm reported 8 low-severity audit findings. |
| Backend typecheck | `npx tsc --noEmit -p tsconfig.json` — **PASS** |
| Backend build | `npm run build` — **PASS** |
| Focused security battery | **10 suites / 181 tests passed** (selected Report 25, scheme/filter, adversarial redaction, bounded-processing, and standing security suites). This is independent of Arena 3's reported 9 suites / 169 tests. |
| Full backend Jest | Direct `./node_modules/.bin/jest --runInBand` — **215 suites / 2,254 tests passed**. The first `npm test -- --runInBand` invocation conflicted with the package script's existing `--maxWorkers=2`; the direct Jest invocation succeeded. |
| Relevant PostgreSQL integration set | **11 suites / 149 tests passed** in a fresh embedded PostgreSQL instance; same relevant suite set as the implementation report, but independently run. Disposable `mn_it_*` databases only; process stopped afterwards. |
| Admin Web install/typecheck | `npm ci` passed (497 packages); `npm run ts:check` — **PASS**. npm reported 7 low, 1 moderate, and 1 high audit findings. |
| Admin Web tests | `npm test -- --runInBand` — **27 suites / 188 tests passed**, independently run. |
| Real HTTP lifecycle probe | In-memory NestJS/Fastify app with actual production hook functions, `GlobalExceptionFilter`, `LoggerModule` and production Pino options: success, 4xx, 5xx and unmatched-route logs exercised; raw query absent from Pino logs; unmatched 404 body query reflection reproduced. Fastify's own logger remained unset. |
| Synthetic DTO/event probes | `CashInDto` accepted synthetic `Bearer abcdefgh` unchanged with zero validation errors; cash-to-cash notification event mapping propagated the synthetic correlation ID unchanged. No financial operation, database write, worker, or external provider was invoked by these probes. |

Arena 3's claimed focused **9/169**, backend **215/2,254**, PostgreSQL **11/149**, and Admin Web **27/188** are not used as independent evidence; independent executions are recorded separately above.

## 7. Review outcome and limits

The remediation is effective for sanitized request-context identifiers, structured Pino request logs, the exercised global exception-filter cases, and the tested bounded redaction behaviors. The production logger distinction is material: a Fastify hook log captured only because the test harness enables a Fastify logger is not evidence of production Fastify logging; the independently observed production sink is NestJS-Pino. The new 404 response and body-correlation findings remain real regardless of whether Fastify's own logger is enabled.

The report does not claim that a caller can retrieve another user's submitted value, that a production database contains a credential, or that a live provider has logged one. N-01 is conditional reflection to the requesting client and possible downstream response capture. N-02 is a confirmed application source-to-persistence path with direct DTO acceptance, but database read-back and external consumer exposure were not exercised. Both are sufficient to reject complete technical acceptance because explicit credential-shaped values cross boundaries that the submitted inventory and tests claim to cover.

No application code or tests were modified. This report is documentation-only. Operational readiness and production authorization remain separate decisions, and R-01/R-02/D-01/D-04 remain outside this review.
