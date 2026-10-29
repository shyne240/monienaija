# Report 21 — Independent security acceptance of Report 20 remediation

- **Reviewer:** Arena 4
- **Repository:** `shyne240/monienaija`
- **Pinned documentation branch:** `arena/870f970d-monienaija`
- **Exact application SHA audited:** `4ea7f1b2ea702624bdfba8ff001d2ba920cc637f`
- **Application branch:** `arena/8e59e188-monienaija`
- **Parent:** `b303a490130e67d600799af93a9247623666738b`
- **Previous independent audit:** `0beed42c86fdb3db05563a3b6afa9876efaa713c` (Report 19)
- **Implementation report reviewed:** `docs/audit/20261029/sprint1-security-acceptance/20-REPORT19-ERROR-BOUNDARY-REMEDIATION-b303a49-20261029.md`
- **Review method:** isolated detached worktree at the exact application SHA; source/test review and synthetic-only execution. No application code or tests were modified.

## Executive verdict

**Overall technical security acceptance: NO-GO.** The three Report 19 disclosure reproductions are closed in the tested forms: attached-fragment provider-reference JWT suffixes are consumed, custom `details.error` strings are sanitized/fail-closed, and query-bearing paths are stripped. F-01 tests, duplicate-key/Unicode handling, bounded-input tests, context IDs containing labeled sensitive fields, and the complete tested unit/PostgreSQL/Admin Web batteries pass.

Two independent residual findings remain:

1. **R-04 credential disclosure (Medium, conditional):** an explicit unkeyed `Basic <base64-credentials>` value still passes through custom 4xx error fields, 5xx error logs, and client-controlled correlation IDs. This is not an arbitrary opaque string: the `Basic` authentication scheme prefix identifies it as a credential.
2. **Exception-filter availability (Low-to-Medium, conditional):** `GlobalExceptionFilter` still throws before sending a response for a Proxy exception with a throwing `getPrototypeOf` trap, and for an `HttpException` whose response object has a throwing `error` getter. `safeExceptionText()` protects `toString()` / `message` access only; other exception/response property reads remain unguarded.

These are distinct from R-01/R-02/D-01/D-04 and operational prerequisites, which are not the basis for this technical NO-GO.

## 1. Exact baseline, source and integration review

Fetched and tested exact SHA `4ea7f1b2ea702624bdfba8ff001d2ba920cc637f`; its parent is exact Report 19 target `b303a490130e67d600799af93a9247623666738b`. Confirmed the implementation and permanent `test/report19-final-error-boundary.spec.ts` are present.

Reviewed the actual changes in:

- `src/common/sensitive-data-redaction.ts` — attached fragments are now scanned as the first provider-reference suffix part; a bounded `eyJ` three-segment JWT shape is redacted after provider-region processing.
- `src/http-exception.filter.ts` — adds query/fragment-free diagnostic paths, sanitizes string `details.error` and request-context IDs, fails closed on non-string `error`, and uses `safeExceptionText()` for 5xx error messages.
- `test/report19-final-error-boundary.spec.ts` — 22 permanent tests cover the three former findings plus query variants, sensitive context IDs and a throwing `toString()` exception.

The application API for redaction is unchanged. `git diff --stat b303a49 4ea7f1b` shows the only application source changes are those two files; additions are the Report 19 test and implementation report. No unrelated application functionality was removed in this remediation. The integration commit parent and previous-report ancestry match the supplied hashes.

## 2. Report 19 findings retested

### R-03 — attached provider-reference fragment followed by JWT: **PASS for tested variants**

The exact Report 19 input now returns:

```text
Opaque provider reference: [REDACTED]
```

The JWT no longer appears in direct redaction, 4xx response bodies or 5xx `logger.error` records. Independent additional cases passed for lowercase attached fragments; multiple attached/whitespace-separated fragments; spaces, tabs, newlines and punctuation; JWT dot/underscore/hyphen forms; attached backslash variants; JSON-escaped newline input; and malformed key-less `pvr1:`-like prefixes followed by an `eyJ` JWT. In the malformed-key-less case, the noncanonical prefix remains readable, but the JWT is redacted; the prefix itself is not a credential.

The region scanner retains its existing candidate, lookahead, suffix-part and operation caps. I found no surviving JWT in the tested 4xx/5xx surfaces for these variants.

### R-04 — custom HTTP error field: **PASS for required cases; residual Basic-scheme gap below**

The prior `error: 'apiKey=ERROR_FIELD_SECRET_SENTINEL'` reproduction is now redacted. Additional independent checks passed for nested non-string error objects (which fall back to canonical error codes), arrays of validation messages, Unicode-escaped/mixed-case JSON keys, malformed JSON text, and Bearer JWTs. Sensitive values did not survive in tested response bodies.

**Residual credential gap:** a string `details.error` containing an explicit Basic credential is passed unchanged by `redactSensitiveText`:

```ts
new BadRequestException({
  message: 'failed',
  error: 'Basic dXNlcjpwYXNzd29yZA==',
});
```

Observed 400 body field:

```text
error: "Basic dXNlcjpwYXNzd29yZA=="
```

The same credential also survives in a 5xx error log (`errorMessage: "upstream returned Basic dXNlcjpwYXNzd29yZA=="`) and when supplied as `x-correlation-id`, where it is echoed in the response body, `X-Correlation-Id` header and structured log. The value is synthetic; it represents the conventional `Basic` scheme with Base64-encoded `user:password`.

- **Affected boundaries:** custom 4xx `error`, 5xx `errorMessage`, client-controlled correlation-ID body/header/log fields.
- **Severity:** **Medium, conditional disclosure.** The affected content is explicitly scheme-labeled authentication material, not an arbitrary context-free opaque value. The implementation report acknowledges this shape gap, but the scheme prefix supplies relevant context; it can expose credentials to API callers and log readers when such diagnostics/IDs are populated.

### R-04 — URL/query credential disclosure: **PASS for tested variants**

The previous `/api/v1/lookup?access_token=PATH_QUERY_SECRET_SENTINEL` reproduction now yields `/api/v1/lookup` in both response and log. Percent-encoded parameter names/values, repeated and mixed-case query parameters, fragments, malformed URL strings, and query-free paths behaved as intended. A raw `apiKey=...` path segment was redacted by the text boundary; an ordinary query-free path remained byte-identical.

## 3. Additional exception and client-context challenges

### Hostile exception stringification

**PASS:** an object whose `toString()` throws, and a null-prototype object, both produce a 500 response; the log message is `[REDACTED]` and no sentinel leaks. A normal `Error` with a hostile `message` accessor is guarded by `safeExceptionText()` when the filter reaches that call.

**FAIL — unguarded exception/response property traps.** Two controlled malformed-object reproductions still prevent the filter from sending a response:

1. Exception value:

```ts
new Proxy(
  {},
  {
    getPrototypeOf() {
      throw new Error('proxy getPrototypeOf');
    },
  },
);
```

Observed: `GlobalExceptionFilter.catch()` throws `proxy getPrototypeOf` before sending a response. The unguarded `exception instanceof HttpException` at `src/http-exception.filter.ts` evaluates the Proxy prototype trap before `safeExceptionText()` runs.

2. Response object:

```ts
const response = new Proxy(
  { message: 'safe' },
  {
    get(target, key, receiver) {
      if (key === 'error') throw new Error('error getter trap');
      return Reflect.get(target, key, receiver);
    },
  },
);
const exception = new HttpException(response, 400);
```

Observed: `GlobalExceptionFilter.catch()` throws `error getter trap` while evaluating `details.error` for the response, before `send()`.

- **Affected boundary:** global exception handling / response availability; an error raised while handling an exception escapes the filter.
- **Severity:** **Low-to-Medium, conditional availability failure.** Requires an internally thrown Proxy/custom exception response with a hostile prototype/property trap; ordinary JSON request bodies cannot directly carry JavaScript Proxies. It nevertheless fails the requested malformed/unusual exception-object robustness criterion. The `details.message` getter has the same unguarded access pattern.
- No secret was emitted in these cases; the demonstrated impact is filter failure, not credential disclosure.

### Client-controlled diagnostic IDs

**PASS for labeled key/value secrets:** `apiKey=...`, `token=...` and `secret=...` values in `x-request-id`, `x-correlation-id` and `x-trace-id` were redacted consistently in response body, response headers and logs. Ordinary client IDs remained usable and unchanged. Bearer/JWT values are also caught by the JWT shape.

**FAIL for explicit Basic-scheme content:** `x-correlation-id: Basic dXNlcjpwYXNzd29yZA==` is preserved across body, header and logs, as shown above. This is included in the R-04 credential disclosure finding, not treated as a separate arbitrary-string ambiguity.

## 4. Preserved guarantees and diagnostic fidelity

- **F-01 historical disclosure — PASS for tested paths.** The F-01 unit and real-PostgreSQL historical delivery HTTP/read suite passed. It exercises authorized historical delivery access, safe canonical refs, raw provider sentinel absence across diagnostics, logs and projections, and unauthorized caller rejection.
- Bearer JWT and Basic values in explicitly keyed Authorization/Proxy-Authorization fields remain redacted; quoted/unquoted, mixed-case, multiple fields, Unicode-escaped sensitive keys and duplicate JSON properties pass the focused suite.
- Deep JSON, oversized/malformed text, duplicate-heavy JSON and scanner-budget fallback remain bounded and fail closed in the executed tests. No stack overflow or unredacted fallback was observed.
- `code: 400`, `statusCode`, `errorCode`, valid nested JSON, ordinary query-free paths and ordinary IDs remain readable in tested cases. Recovery/authentication fields remain protected. Context-free arbitrary strings remain inherently ambiguous; this verdict is based on the syntactically explicit `Basic` scheme and concrete exception-filter crash reproductions, not on a claim that every opaque string must be classified.

## 5. Independent execution totals

All commands below were independently run against exact application SHA `4ea7f1b2ea702624bdfba8ff001d2ba920cc637f`, using synthetic values and disposable local PostgreSQL:

| Gate                                                                                                         | Independent result                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`                                                                          | PASS                                                                                                                   |
| `npm run build`                                                                                              | PASS                                                                                                                   |
| Focused security (`report19`, report16, adversarial, exception filter, F-01 unit, sensitive-data protection) | **6 suites / 118 tests passed**                                                                                        |
| Full backend unit (`jest --runInBand`)                                                                       | **211 suites / 2,191 tests passed**                                                                                    |
| Relevant PostgreSQL integrations                                                                             | **11 suites / 149 tests passed**                                                                                       |
| Admin Web `ts:check`                                                                                         | PASS                                                                                                                   |
| Admin Web Jest                                                                                               | **27 suites / 188 tests passed**                                                                                       |
| Additional manual synthetic variants                                                                         | Report 19 exact reproductions, URL/ID/exception matrix and Basic-scheme residual reproduced; details and outputs above |

The independent PostgreSQL files were the F-01 historical disclosure, customer-compliance authorization, provider configuration, notification-delivery authorization, reliability, transfer producer, admin notification diagnostics, v1-005 delivery, migration chain, notification migration-upgrade and notification registry suites. No full 125-file PostgreSQL battery was executed; this review ran the 11 directly relevant suites. No production PostgreSQL or migrations were touched.

Independent maximum-size measurement against the built module: 262,144 input characters, 17-character redacted output, **12.43 ms**, process RSS high-water **45,360 KiB** baseline / **50,248 KiB** peak (**+4,888 KiB**). This is a process-level measure, not scanner-only attribution.

## 6. Required verdicts

| Area                                           | Disposition                                                        | Basis                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| F-01 historical disclosure                     | **PASS for tested paths**                                          | F-01 unit and PostgreSQL/HTTP history suites passed.                                                                        |
| R-03 provider-reference disclosure             | **PASS for tested variants**                                       | Exact attached-fragment/JWT reproduction and added suffix variants no longer expose the JWT in direct, 4xx or 5xx surfaces. |
| R-04 sensitive-field and credential disclosure | **FAIL**                                                           | Explicit bare `Basic <base64>` content in custom errors, 5xx messages and client correlation IDs survives.                  |
| HTTP exception-boundary safety                 | **FAIL**                                                           | Hostile Proxy prototype trap and response getter escape `catch()` and prevent a response.                                   |
| Availability/resource exhaustion               | **PASS within tested text/object limits; exception-filter caveat** | Parser/scanner cases bounded; malformed Proxy/response accessor cases separately fail filter availability.                  |
| Diagnostic fidelity                            | **PASS for tested safe distinctions**                              | Safe codes, valid JSON, query-free paths and ordinary IDs preserved.                                                        |
| Overall technical security acceptance          | **NO-GO**                                                          | R-04 Basic credential exposure and exception-filter crash remain.                                                           |
| Operational readiness                          | **NOT ESTABLISHED / NO-GO to assert readiness**                    | No operational gate was independently assessed.                                                                             |
| Production authorization                       | **NO-GO / NOT AUTHORIZED**                                         | This is not production authorization; no deployment, provider activation, migration or financial action was performed.      |

R-01, R-02 and D-01/D-04 remain separate from these direct technical findings and are not the basis for the NO-GO.

## 7. Safety and scope

All values were synthetic. The review changed no application code or test files. No provider calls, real credentials, production migration, deployment, activation, or live financial transaction occurred.
