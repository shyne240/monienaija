# Report 25 — Independent acceptance of Report 23 remediation

- **Reviewer:** Arena 4 (independent retest)
- **Repository:** `shyne240/monienaija`
- **Documentation branch:** `arena/870f970d-monienaija`
- **Exact application SHA audited:** `af486bcd133ab56c911286c121e06219665b9135`
- **Application branch:** `arena/8e59e188-monienaija`
- **Parent:** `683fd409494cbe0207ecd7d4bf0880b76a6c9770`
- **Previous independent audit:** Report 23, commit `68391d0a38f5d31cfa29b91dfbab006e0b2d7c51`
- **Implementation report reviewed:** `docs/audit/20261029/sprint1-security-acceptance/24-REPORT23-SHORT-SCHEME-AND-REVOKED-PROXY-REMEDIATION-683fd40-20261029.md`
- **Review method:** isolated detached worktree at the exact application SHA; source, test and report review; direct redactor and `GlobalExceptionFilter` probes with synthetic values; source-level tracing of request-context wiring; build/type checks and independent unit/integration suites. No application code or tests were modified.

## Executive verdict

**Overall technical security acceptance: NO-GO.** The exact Report 23 examples `Basic dTpw` and canonically-cased `Bearer abcdefgh` are redacted by the updated standalone redactor and by the tested `GlobalExceptionFilter` path; the revoked-Proxy message-array crash is fixed in the tested hostile-object matrix. But they are **not fully fixed at the application boundary**: the live Fastify `onRequest` hook copies client-controlled context IDs directly to response headers, while Pino request custom properties and the `onResponse` log copy those IDs without redaction. Therefore the exact canonical credentials still reach application headers/logs through that separate path. In addition, the new credential heuristic remains case- and length-dependent:

- `bearer abcdefgh` and mixed-case `bEaReR abcdefgh` survive because the lowercase/mixed scheme branch requires an uppercase/digit/Base64 marker in the token.
- `Bearer abc` survives because the canonical branch requires a run of at least four characters, although RFC 6750 Bearer `b64token` syntax permits one or more token characters.

These are not context-free opaque strings. I confirmed that `x-correlation-id` and `x-trace-id` values are accepted by application request-context code and flow to response headers, request/response logs, and the global exception response/log boundary. Thus both the unredacted `main.ts` echo and lower-case free-text cases have reachable application diagnostic boundaries. Values inside a keyed `Authorization` field remain protected by the keyed redaction path; that does not cover IDs or free-text diagnostics.

The revoked-Proxy fix passed independent adversarial probes; JSON/resource budgets and the requested regression suites passed within tested limits. Diagnostic fidelity has a notable conservative false-positive caveat (`Basic auth`, `Bearer token`, and related prose are redacted); no matching emitted phrase was found in the searched application source. That caveat is not the basis for the NO-GO. Operational readiness remains unestablished and production is not authorized.

## 1. Baseline and review scope

Fetched the application branch and verified the exact commit object. SHA `af486bcd133ab56c911286c121e06219665b9135` has parent `683fd409494cbe0207ecd7d4bf0880b76a6c9770`. The target worktree remained detached at this SHA.

Reviewed the complete target changes in:

- `src/common/sensitive-data-redaction.ts`
- `src/http-exception.filter.ts`
- `test/report23-scheme-and-revoked-proxy.spec.ts`
- the Report 24 implementation report
- Report 23's independent audit at commit `68391d0a38f5d31cfa29b91dfbab006e0b2d7c51`

The remediation adds two scheme regex branches and moves `Array.isArray()` inside the message-sanitization `try/catch`; it adds one 18-test spec and does not modify the prior permanent tests. The redaction budgets are unchanged. The implementation report itself documents lowercase markerless and short Bearer limitations; this audit independently tests those limitations at application diagnostic boundaries rather than treating them as acceptable solely because of lowercase prose ambiguity.

Earlier application protections remain present: Report 19/21/23 tests and the adversarial redaction, F-01, and Report 16 bounded-processing suites are present and passed in the independent runs below. The exact provider-reference, error-field and query-path regressions were retested through those suites.

## 2. R-04 — short/case-varied Basic and Bearer credential probes

### Report 23 exact cases: **PASS in canonical scheme casing**

Direct calls to `redactSensitiveText()` returned `[REDACTED]` for:

```text
Basic dTpw
Bearer abcdefgh
```

The direct values were also redacted in quoted, JSON-string, escaped-JSON, tab-separated, newline-separated, and multiple-credential probes when the scheme used canonical casing. `basic dTpw` and `BaSiC dTpw` are also caught by the marker-bearing branch. A keyed value such as `authorization: bearer abcdefgh` remains fully redacted by the sensitive-key path.

**Application-level bypass for these exact values:** the filter unit harness is not the only header-emission path. `createRequestContext()` accepts printable ASCII values up to 255 characters and returned these synthetic values unchanged:

```text
x-correlation-id: Basic dTpw  -> context.correlationId: Basic dTpw
x-trace-id: Bearer abcdefgh   -> context.traceId: Bearer abcdefgh
```

At the exact target SHA, `src/main.ts`'s Fastify `onRequest` hook passes those context fields directly to `reply.header('X-Correlation-Id', ...)` and `reply.header('X-Trace-Id', ...)` without invoking the redactor. It also sends the same raw fields in its `SERVICE_DRAINING` response path. `src/main.ts`'s `onResponse` logger and `src/app.module.ts`'s Pino `customProps` likewise copy the request context directly. Thus the exact Report 23 canonical examples still reach normal application response headers and request logs, independently of the corrected global exception filter. This is a source-level live-path trace plus executed `createRequestContext()` probe; the full app was not booted in this review. This application-hook bypass is newly identified in Report 25; prior reports exercised the exception-filter harness, not the separate raw `main.ts` request-context header/log path.

### New residual R-04 — case-insensitive scheme with lowercase token: **FAIL**

HTTP authentication scheme names are case-insensitive. The lowercase spelling below is valid Bearer syntax and is materially identical to the now-fixed canonical spelling:

```text
bearer abcdefgh
```

It is returned unchanged by `redactSensitiveText()`. The same is true of mixed-case `bEaReR abcdefgh`, because Branch A only recognizes `Bearer`/`BEARER` and Branch B's marker lookahead does not match an all-lowercase token. The unredacted value is a valid Bearer `b64token`, not an arbitrary string.

**Actual application diagnostic boundary:** `src/production/request-context.ts:createRequestContext()` accepts printable ASCII `x-correlation-id`/`x-trace-id` values up to 255 characters without rejecting scheme-labeled values. `src/main.ts`'s Fastify `onRequest` hook assigns this context and immediately echoes its IDs in `X-Correlation-Id` / `X-Trace-Id`; `src/app.module.ts` configures Pino `customProps` from the same `getRequestContext()`. The global exception filter separately redacts and reflects/logs these IDs, but the lower-case heuristic lets the value pass through there too. The main hook/log wiring is an application-level path, not just a hypothetical call to the pure scanner.

Independent execution of the built `GlobalExceptionFilter` with synthetic request headers produced:

```text
x-correlation-id: bearer abcdefgh
x-trace-id: bearer abc
```

Observed 500 response body fields, response headers and structured log context retained those values verbatim:

```text
body.correlationId = "bearer abcdefgh"
body.traceId       = "bearer abc"
X-Correlation-Id   = "bearer abcdefgh"
X-Trace-Id         = "bearer abc"
logger.error correlationId / traceId = same values
```

The error log message `upstream auth failed: bearer abcdefgh` also remained unchanged as `errorMessage`. A synthetic 400 `BadRequestException({ message: 'bad input', error: 'bearer abcdefgh' })` returned the same value in its `error` body field. Ordinary JSON diagnostic text containing the same string likewise remains unsanitized.

The source path at `main.ts` is stronger than the filter-only reproduction: the on-request hook echoes the raw accepted IDs for normal application requests, and Pino adds them to request log properties. I did not boot the full application or claim a production HTTP request; the actual hook and logger wiring were inspected at the exact SHA, and the filter/context functions were executed locally with synthetic input.

### New residual R-04 — Bearer credential shorter than four characters: **FAIL**

The canonical branch requires at least four token characters. This does not cover all syntactically valid Bearer credentials: RFC 6750's `b64token` production permits a token run beginning with one or more allowed token characters. The following valid short examples remain unchanged:

```text
Bearer abc
Bearer a
```

`bearer abc` and `BEARER a` also remain unchanged. A synthetic `x-trace-id: bearer abc` was reflected in the exception response body/header/log as shown above. Bearer tokens are normally longer in production, so this subcase is less likely than the eight-character reproduction; it nevertheless demonstrates an avoidable syntax gap in a function intended to redact scheme-labeled credentials.

### Basic/Bearer case, whitespace, malformed, and prose matrix

| Input / class | Observed result | Assessment |
|---|---|---|
| `Basic dTpw`; `basic dTpw`; `BaSiC dTpw`; `BASIC dTpw` | `[REDACTED]` | PASS; previous Basic credential is now caught across tested scheme casing. |
| `Bearer abcdefgh`; `BEARER abcdefgh` | `[REDACTED]` | PASS for these two exact recognized scheme spellings. |
| `bearer abcdefgh`; `bEaReR abcdefgh` | unchanged | FAIL; valid credential and case-insensitive scheme forms. |
| `Bearer abc`; `Bearer a`; `bearer abc`; `BEARER a` | unchanged | FAIL; valid Bearer token syntax below the four-character floor. |
| `Bearer\tabcdefgh`; `Bearer\nabcdefgh` | `[REDACTED]` | PASS for canonical casing. |
| `bearer\nabcdefgh` | unchanged | FAIL; lowercase scheme plus line break bypasses both branches. |
| `"Bearer abcdefgh"`; JSON and escaped-JSON values | canonical form redacted | PASS for tested canonical forms; lowercase markerless forms remain subject to the same gap when the raw scanner sees them. |
| Multiple canonical Basic/Bearer values | each canonical value redacted | PASS in direct probes and permanent tests. |
| `Bearer !!!` / non-token punctuation variants | no claim of valid credential; malformed test strings do not establish a new leak | Not treated as a finding. |
| Context-free `abcdefgh`, `dTpw`, ordinary lower-case prose | preserved | Correct; no claim is made that arbitrary context-free strings must be classified. |
| `the bearer of good news`; `basic authentication is configured` | preserved | PASS for lowercase prose preservation. |
| `Basic auth is configured`; `This uses Basic authentication`; `Bearer token refresh failed`; `Bearer authorization required` | `[REDACTED] is configured`; `This uses [REDACTED]`; `[REDACTED] refresh failed`; `[REDACTED] required` | Conservative false positives; documented below. |

- **Affected boundary:** direct text redaction; custom 4xx `error`; 5xx `errorMessage`; client-controlled correlation/trace IDs in response headers, response bodies and structured logs. In addition to lowercase free-text bypasses, the exact canonical `Basic dTpw` and `Bearer abcdefgh` values pass through the actual `main.ts` request hook/Pino context path, which bypasses `redactSensitiveText()` entirely.
- **Severity:** **Medium, conditional credential disclosure.** The scheme labels are explicit and the token forms are syntactically valid; a lowercased normalizer, an upstream error message, or a credential-populated diagnostic ID can reach shared response/log channels. A normal `Authorization` header remains keyed and redacted, which limits direct exposure from that header alone. No claim is made that a caller can retrieve another party's token merely by choosing its own correlation ID; the risk is persistence/echo of a credential that has entered a free-text or client-controlled diagnostic field.
- **Finding status:** the filter-level exact canonical `Basic dTpw` and `Bearer abcdefgh` reproductions are fixed, but application-level exposure remains through unredacted `main.ts` context echo/log wiring. Case-insensitive and sub-four-character Bearer gaps remain in the sanitizer itself. These are residuals of the same R-04 credential finding.

## 3. Exception-filter availability — **PASS for tested hostile values**

The Report 23 revoked-Proxy regression now passes. In `sanitizeMessageValue()`, both `Array.isArray()` and array mapping are inside the same `try/catch`. Independent built-module probes showed the filter returned a response and did not throw for:

- revoked Proxy as the exception itself: canonical 500; log message `[REDACTED]`;
- revoked Proxy as the entire `getResponse()` value: 400 fallback `Request failed` / `BAD_REQUEST`;
- revoked Proxy (object or array target) as the `message` value: 400 with `[REDACTED]`;
- revoked Proxy as an individual element of a legitimate validation array: preserves sibling text, substitutes `[REDACTED]`, and retains `VALIDATION_ERROR`;
- nested validation-error objects: fail closed to `[REDACTED]` rather than traversing untrusted properties;
- response `message`/`error` getters and a Proxy throwing when `message` is read: safe canonical fallbacks and a sent 400 response.

Ordinary validation arrays remain arrays with per-item content and `VALIDATION_ERROR`. In these probes no untrusted value was serialized or logged. This is a pass for the exercised exception/message/accessor cases; hostile Fastify host/reply transport objects remain outside the claimed boundary, consistent with the implementation report.

## 4. Regression, resources and fidelity

### F-01 historical disclosure: **PASS for tested paths**

The F-01 unit spec and `v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts` passed. This is the exercised historical provider-reference disclosure contract; it does not assert every possible provider or production configuration.

### R-03 provider-reference disclosure: **PASS for tested variants**

Report 19/21 adversarial redaction coverage and the existing provider-reference suffix cases passed in focused and full backend tests. No recurrence of the Report 21 attached-fragment/JWT leak was observed. This disposition is test-bounded.

### R-04 prior protections and related controls: **PARTIAL**

- The previous full-length Basic reproduction `Basic dXNlcjpwYXNzd29yZA==` is redacted in the regression suite.
- The exact Report 23 `Basic dTpw` and canonical `Bearer abcdefgh` are redacted by the direct function and tested `GlobalExceptionFilter` error paths. They are **not** redacted by the separate application `main.ts` request-context response-header/Pino path; see §2.
- The prior custom `details.error` key/value and query-bearing path disclosures remain fixed in Report 19 tests.
- JWT/Bearer-JWT shape tests, Unicode-escaped sensitive keys, duplicate JSON property cases, and correlation-ID tests passed.
- **Not accepted overall:** case-insensitive lowercase/mixed-case `bearer` plus markerless token and valid Bearer tokens shorter than four characters pass through free-text/context-ID redaction, as detailed in §2.

### Resource exhaustion protections: **PASS within tested limits**

The existing Report 16 budget suite passed. Direct built-module probes returned generic `[REDACTED]` for input over 256 KiB, depth-40 JSON and a 12,020-node JSON array. At the 256 KiB boundary, a plain input was processed unchanged in 12.32 ms; a 256,000-character repeated marker-miss challenge completed in 15.81 ms; the 12,020-node challenge returned the generic fallback in 11.14 ms. An input of 262,145 characters failed closed in 0.01 ms. These are single-process local timings, not benchmark or memory/DoS certification. The remediation did not alter the documented parser/scanner budgets, and no exception or unredacted over-budget fallback was observed.

### Diagnostic fidelity: **PASS WITH CAVEAT**

Ordinary lowercase prose and unaffected safe metadata remain readable in tested cases. The new canonical-casing branch intentionally redacts any adjacent run of four or more characters, without requiring credential composition. It therefore removes meaningful phrases such as `Basic auth`, `Basic authentication`, and `Bearer token` when the scheme word has canonical casing, including sentence-initial phrases. This is a real false positive and can reduce troubleshooting detail. A search of `src/` and `apps/` found no matching emitted diagnostic phrase in this target; on the checked codebase the trade-off is bounded and not independently demonstrated to break an application diagnostic. It is documented rather than ignored. Future emitted prose using these phrases would be degraded.

The false-positive caveat does not justify accepting the false negative: lowercase/mixed-case HTTP scheme names are valid, and the markerless Bearer token is explicit credential syntax. The technical NO-GO is based on that residual disclosure, not on context-free arbitrary strings.

## 5. Required independent dispositions

| Area | Disposition | Basis |
|---|---|---|
| F-01 historical disclosure | **PASS for tested paths** | F-01 unit and PostgreSQL/HTTP history suite passed. |
| R-03 provider-reference disclosure | **PASS for tested variants** | Prior provider-reference/JWT suffix regressions and adversarial tests passed. |
| R-04 Basic/Bearer and diagnostic disclosure | **FAIL** | Exact canonical credentials are still copied raw by `main.ts` context/header/log wiring; lowercase/mixed-case `bearer abcdefgh` and valid short `Bearer abc` also survive sanitizer/filter paths. These values reach response headers/body and log fields. |
| Exception-filter availability | **PASS for tested hostile values** | Revoked Proxies as exception/response/message/array element and throwing getters no longer prevent a response; ordinary validation arrays retain shape. |
| Resource exhaustion protections | **PASS within tested limits** | Existing bounded tests plus local size/depth/node challenges completed and failed closed as expected; not a load test. |
| Diagnostic fidelity | **PASS WITH CAVEAT** | Safe prose is preserved, but canonical `Basic auth`/`Bearer token` language is over-redacted; no such emitted diagnostic was found in searched application code. |
| Overall technical security acceptance | **NO-GO** | R-04 remains open for valid, case-insensitive Bearer syntax at real diagnostic boundaries. |
| Operational readiness | **NOT ESTABLISHED** | No operational-readiness checklist, incident exercise, deployment, provider activation or production migration was conducted. |
| Production authorization | **NOT AUTHORIZED** | This audit grants no production permission; no production activity occurred. |

**R-01, R-02, D-01 and D-04:** remain separate and were not reassessed by this targeted audit. No new pass/fail status is assigned to them, and they are not the basis for the technical NO-GO. Operational prerequisites are likewise separate and remain unverified.

## 6. Independent execution record

All results below were independently executed against exact application SHA `af486bcd133ab56c911286c121e06219665b9135`; Arena 3's reported totals are not substituted for these runs.

| Gate | Independent result |
|---|---|
| Backend `npm ci` | PASS; 979 packages installed (npm reported 8 low-severity audit findings) |
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm run build` | PASS |
| ESLint on `src/common/sensitive-data-redaction.ts`, `src/http-exception.filter.ts`, and `test/report23-scheme-and-revoked-proxy.spec.ts` | PASS; no errors |
| Focused security battery (Report 23 spec, Report 21, Report 19, exception filter, adversarial redaction, Report 16, F-01 unit, sensitive-data protection) | **8 suites / 156 tests passed** |
| Full backend Jest (`jest --runInBand`) | **213 suites / 2,229 tests passed** |
| Relevant embedded-PostgreSQL integration set | **11 suites / 149 tests passed** |
| Admin Web `npm ci` | PASS; 497 packages installed (npm reported 7 low, 1 moderate, 1 high audit findings) |
| Admin Web `npm run ts:check` | PASS |
| Admin Web Jest | **27 suites / 188 tests passed** |
| Additional synthetic direct/filter probes | Reproduced lowercase/mixed-case and short Bearer leaks; verified body/header/log propagation; tested revoked Proxy variants, safe fallbacks, false positives and bounded-input fallbacks. |

The PostgreSQL suites were the F-01 historical disclosure, customer-compliance authorization, notification provider configuration, delivery authorization, notification reliability, transfer producer, admin notification diagnostics, v1-005 notification delivery, migration chain, notification migration upgrade, and notification registry tests. PostgreSQL was a fresh disposable embedded instance with synthetic data. A full repository PostgreSQL battery and full application process boot were not claimed. No production database or migration was touched.

## 7. Safety and constraints

All credential-shaped values were synthetic. No provider activation, deployment, live credential, financial transaction or production migration occurred. No application code or tests were modified. The review used an isolated detached worktree; the dirty root checkout `/home/user/monienaija` was left untouched. This report is documentation-only. R-01/R-02/D-01/D-04 and operational prerequisites remain separate as stated above.
