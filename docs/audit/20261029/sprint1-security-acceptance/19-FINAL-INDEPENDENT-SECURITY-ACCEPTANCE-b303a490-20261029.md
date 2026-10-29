# Report 19 — Final independent security acceptance of redaction integration

- **Reviewer:** Arena 4 (independent retest)
- **Repository:** `shyne240/monienaija`
- **Pinned documentation branch:** `arena/870f970d-monienaija`
- **Exact integrated application SHA tested:** `b303a490130e67d600799af93a9247623666738b`
- **Integration branch containing that application SHA:** `arena/8e59e188-monienaija`
- **Parent / source baseline:** `f00e0c939dba632a3323f39750a8b3fe83ab4aec`
- **Integration record reviewed:** `docs/audit/20261029/sprint1-security-acceptance/18-REDACTION-HARDENING-INTEGRATION-f00e0c9-20261029.md`
- **Review actions:** read-only inspection and tests only; no application code or test files were modified.

## Executive verdict

**Overall technical security acceptance: NO-GO.** The core bounded parser/scanner passed its focused confidentiality and availability tests, and F-01 historical provider-reference protections remained intact in the selected real-PostgreSQL HTTP tests. However, independent probes found three disclosure paths:

1. R-03 residual: an attached non-credential fragment before a whitespace-separated JWT causes only the provider-reference/attached fragment to be redacted; the JWT suffix remains visible in 4xx response messages and 5xx error logs.
2. R-04 diagnostic boundary: `GlobalExceptionFilter` copies a custom `HttpException` response's `error` field to the 4xx body without redaction.
3. R-04 diagnostic boundary: the filter copies `request.url` (including query strings) to the response and 5xx log without redaction.

These findings are based on synthetic values and the exact application SHA above. They are not the unrelated R-01/R-02/D-01/D-04 or operational prerequisites; those are not used as the reason for the technical NO-GO.

## 1. Exact baseline and integration integrity

Fetched and tested exact commit `b303a490130e67d600799af93a9247623666738b`; its parent is the requested `f00e0c939dba632a3323f39750a8b3fe83ab4aec`. The target worktree remained detached/read-only during verification.

Verified in the integrated tree:

- The bounded implementation is present in `src/common/sensitive-data-redaction.ts` with the same public exports: `REDACTED_VALUE`, `redactSensitiveData`, `redactRecord`, and `redactSensitiveText`.
- The report-16 regression suite and report-13/14/15 adversarial and filter specs are present.
- All 12 additional baseline spec files identified in report 18 are present at `b303` and `f00e0c9`, and absent at `d12587e`: six unit-mode and six integration-mode specs. This independently confirms the stated reason for the earlier 204/2101 versus 210/2169 unit-count difference. The full suite at `b303` reproduced 210/2169.
- The F-01 historical unit and HTTP/PostgreSQL integration specs are present and pass in the selected runs.
- `git diff --name-status f00e0c9 b303a49` shows the application-source change is confined to `src/common/sensitive-data-redaction.ts`; other changed paths are the integration report and the three redaction/filter specs. No unrelated application module was removed or replaced. Existing consumer APIs remain unchanged.
- The integration diff of the existing specs is formatting-only except for one filter fixture gaining an explicit semicolon before trailing prose and a type annotation. No assertion was removed. The semicolon makes the test's prose-preservation assertion unambiguous under the complete-region Authorization policy.

## 2. Independent R-03 / R-04 retests

### R-03 — canonical, malformed, attached, whitespace, JWT, and escaped provider references

**PASS cases:** a standalone canonical reference remains intact; canonical references with directly attached opaque/JWT suffixes, space/tab/newline-separated JWTs, dot/underscore/hyphen variants, backslash variants, and JSON-escaped newlines are redacted. A keyed malformed `providerRef` is redacted. These were checked both by the existing focused suites and by an independent 18-assertion synthetic script.

**FAIL — suffix scanner stops too early after an attached ordinary fragment.** Exact synthetic input:

```text
Opaque provider reference: pvr1:brevo:0123456789abcdef0123456789abcdefsuffix eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature
```

Observed from direct `redactSensitiveText`:

```text
Opaque provider reference: [REDACTED] eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature
```

Observed 4xx `GlobalExceptionFilter` body `message` is the same string. With the same input in a 5xx `Error`, `logger.error` receives the same leaked JWT in `errorMessage` (while the HTTP response message itself is generic).

A second malformed-keyless probe, `pvr1:brevo:not-a-reference <JWT>`, also leaves both the malformed prefix and JWT unchanged. The primary reproduction above is sufficient for the acceptance failure: a credential-shaped suffix later in the provider-reference region is not consumed if an ordinary fragment is attached immediately to the canonical token. `applyCredentialShapes` redacts the canonical token plus the attached fragment only up to whitespace; the JWT after that whitespace survives.

- **Affected boundary:** direct redaction, 4xx response message, 5xx structured error log.
- **Severity:** **Medium, conditional disclosure.** Requires malformed/composed provider-reference diagnostic text containing an attached ordinary fragment followed by a JWT-like credential. Error text may include provider/adapter diagnostics; once present, the credential is exposed to the caller and/or log readers. No live credential was used.

### R-04 — Authorization, escaped/mixed-case keys, duplicate JSON, and nested JSON

**Core tests pass:** realistic synthetic Bearer JWT and Basic values; mixed-case Authorization/Proxy-Authorization; quoted/unquoted and multiple fields; Unicode-escaped and mixed-case sensitive names; duplicate sensitive JSON properties; nested and doubly stringified JSON. The focused direct-redaction and filter suites found no credential escape in those cases.

**FAIL — unredacted `details.error` field in 4xx response.** Reproduction:

```ts
new BadRequestException({
  message: 'Ordinary validation failure',
  error: 'apiKey=ERROR_FIELD_SECRET_SENTINEL',
});
```

Observed 400 response fields:

```json
{
  "message": "Ordinary validation failure",
  "error": "apiKey=ERROR_FIELD_SECRET_SENTINEL"
}
```

The filter sanitizes `message`, but sends `details.error ?? code` directly. The synthetic credential reaches the response unchanged.

- **Affected boundary:** 4xx response body.
- **Severity:** **Medium, conditional on a custom exception response populating `error` with sensitive/dynamic text.** Standard Nest error labels and current enumerated internal failure codes are generally static; nevertheless, the global boundary does not enforce redaction for the field it returns.

**FAIL — raw query string in error response and logs.** Reproduction: throw a synthetic 5xx while the request URL is `/api/v1/lookup?access_token=PATH_QUERY_SECRET_SENTINEL`.

Observed 500 response `path` and structured-log `path`:

```text
/api/v1/lookup?access_token=PATH_QUERY_SECRET_SENTINEL
```

Both body and log contain the token. This field bypasses `redactSensitiveText` entirely.

- **Affected boundary:** all exception response `path` fields and 5xx structured-log `path`.
- **Severity:** **Medium, conditional on credentials or other secrets being placed in query parameters.** Such values are discouraged, but may occur in signed links, integrations, or misconfigured clients; the server persists the unredacted URL in logs and reflects it to the requester.

### F-01 — historical disclosure

**PASS for the tested F-01 contract.** `test/f01-historical-provider-ref-security.unit.spec.ts` and `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts` pass. The PostgreSQL/HTTP suite exercises authorized delivery history reads, safe `pvr1:` values, raw provider sentinels across HTTP diagnostics, duplicate dispatch, `listDeliveriesForEventKey()`, ORM loads, logs, audit projections, and unauthorized caller rejection. No raw historical provider sentinel escaped in the executed suite.

This pass does not override the separate R-03 malformed-suffix finding or the filter's unrelated `error`/URL fields.

## 3. Availability and diagnostic fidelity

### JSON availability/resource exhaustion — PASS within tested bounds

The implementation passed the report-16 suite and the independent synthetic challenge for:

- 1,800-level nested arrays and direct object graphs, without uncaught stack overflow.
- Oversized JSON, large malformed input, escaped/mixed-case keys, embedded/doubly stringified JSON, and 3,000 duplicate sensitive properties.
- 2,049 sensitive text-key matches, exercising the match budget and generic fallback.
- Multiple sensitive fields in one message and direct object-depth exhaustion.

The tested fallback was `[REDACTED]` for over-size and match-budget cases; malformed/deep input either produced bounded sanitized output or the generic fallback. No tested failure returned the original sensitive content or threw through `GlobalExceptionFilter`.

Independent built-module measurement at the 262,144-character cap: **8.30 ms**, 17-character redacted output, process RSS high-water **45,352 KiB** before and **52,152 KiB** peak (**+6,800 KiB**). This is process-level RSS, not scanner-only attribution. No out-of-memory or machine-exhausting inputs were used.

### Diagnostic fidelity — PASS for tested safe distinctions, with the filter-path exception above

`code: 400`, `statusCode`, `errorCode`, ordinary nested JSON, valid JSON formatting, and explicitly delimited trailing diagnostics were preserved in the focused/custom tests. `codeHash`, recovery/transfer/challenge code values and non-diagnostic `code` values were redacted. A context-free number in the HTTP range can still be either a status diagnostic or an OTP; this is an unavoidable schema/context ambiguity, not by itself a demonstrated defect.

The `path` and `details.error` leaks above are not diagnostic-fidelity false positives; they are unredacted response/log fields.

## 4. Independent execution totals

All results below were executed in the isolated worktree at exact SHA `b303a490130e67d600799af93a9247623666738b`, with synthetic credentials only:

| Check                                                                                                                  | Independent result                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit -p tsconfig.json`                                                                                    | PASS                                                                                                      |
| `npm run build`                                                                                                        | PASS                                                                                                      |
| Focused redaction/filter/F-01 suites (`report16`, adversarial, exception filter, F-01 unit, sensitive-data protection) | **5 suites / 96 tests passed**                                                                            |
| Full backend unit (`jest --runInBand`)                                                                                 | **210 suites / 2,169 tests passed**                                                                       |
| Relevant PostgreSQL integration suites                                                                                 | **11 suites / 149 tests passed**                                                                          |
| Additional adversarial synthetic assertions                                                                            | **18 assertions passed**, plus the explicit failing filter/provider suffix reproductions documented above |

PostgreSQL files independently executed:

1. `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts`
2. `test/customer-compliance-authorization.integration.spec.ts`
3. `test/v1-notification-provider-configuration-01.integration.spec.ts`
4. `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`
5. `test/notification-reliability.integration.spec.ts`
6. `test/transfer-notification-producer-01.integration.spec.ts`
7. `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`
8. `test/v1-005-notification-delivery.integration.spec.ts`
9. `test/migration-chain.integration.spec.ts`
10. `test/notification-migration-upgrade-01.integration.spec.ts`
11. `test/notification-registry.integration.spec.ts`

A full 125-file PostgreSQL battery and Admin Web 27-suite battery were **not** independently run; this review ran the directly relevant 11 PostgreSQL suites and did not modify Admin Web. Report 18's 125-file and Admin Web totals remain Arena 3 results, not independent results from this report.

## 5. Required dispositions

| Area                                  | Disposition                                     | Basis                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 historical disclosure            | **PASS for tested paths**                       | F-01 unit and real-PostgreSQL HTTP/history suite pass; no raw provider sentinel escaped.                                                      |
| R-03 provider-reference disclosure    | **FAIL**                                        | Attached ordinary suffix followed by a JWT leaks the JWT through redaction, 4xx message, and 5xx error log.                                   |
| R-04 sensitive-key disclosure         | **FAIL**                                        | `details.error` and raw query-bearing `request.url` bypass redaction into response/log fields. Core Authorization/JSON-key tests pass.        |
| JSON availability/resource exhaustion | **PASS within tested limits**                   | Controlled deep, large, malformed, duplicate-heavy, escaped, and budget-exhaustion tests fail closed without crash or observed secret return. |
| Diagnostic fidelity                   | **PASS for tested safe distinctions**           | Known diagnostic codes, structured JSON, and delimited trailing prose preserved; context-free numeric ambiguity documented.                   |
| Overall technical security acceptance | **NO-GO**                                       | The direct R-03 and R-04 disclosure reproductions remain open. This is not based solely on R-01/R-02/D-01/D-04 or operational prerequisites.  |
| Operational readiness                 | **NOT ESTABLISHED / NO-GO to assert readiness** | This review did not execute or verify operational readiness gates.                                                                            |
| Production authorization              | **NO-GO / NOT AUTHORIZED**                      | No production activity was authorized or performed; do not deploy or activate based on this review.                                           |

## 6. Safety and review boundaries

No provider calls, real credentials, production migrations, deployment, activation, or financial actions occurred. All attack strings were synthetic. The audit is documentation-only; it does not modify application code or tests.
