# 22 — Report-21 Targeted Remediation: Basic-Scheme Credentials and Hostile-Object Filter Safety

- **Date:** 2026-10-29
- **Assigned agent:** Arena 3
- **Branch (pinned):** `arena/8e59e188-monienaija`
- **Baseline application SHA:** `4ea7f1b2ea702624bdfba8ff001d2ba920cc637f`
- **Audit driving this remediation:** report 21 at `3e7908cc976912b8153cf8c0033a84979a69c34f`
  (`docs/audit/20261029/sprint1-security-acceptance/21-FINAL-INDEPENDENT-SECURITY-ACCEPTANCE-4ea7f1b-20261029.md`,
  verdict NO-GO with two residual findings)
- **Scope discipline:** targeted remediation — the redaction architecture is unchanged (same
  layers, same budgets: 256 KiB input cap, depth 32/12, 12,000 nodes, 1,000,000 scan operations,
  2,048 key matches, 1,024 key-less candidates, 8,192-char lookahead, 8 suffix parts). No
  previous protection was weakened; no existing spec file was modified.

## 1. Failing reproductions captured BEFORE any application change

New permanent spec `test/report21-basic-scheme-and-proxy-safety.spec.ts` (20 tests) executed
against the unmodified baseline: **16 failed / 4 passed**. The 4 pre-fix passes are the
preservation/regression guards (context-free Base64 preserved, ordinary prose preserved, the
already-guarded Error message accessor, ordinary-exception fidelity), confirming the failures
are genuine gaps rather than blanket breakage.

- **Finding 1 (exact reproduction):** `new BadRequestException({ message: 'failed', error:
  'Basic dXNlcjpwYXNzd29yZA==' })` → 400 body contained `error: "Basic dXNlcjpwYXNzd29yZA=="`
  unchanged; the same credential survived a 5xx `errorMessage` structured log
  (`upstream returned Basic dXNlcjpwYXNzd29yZA==`) and an `x-correlation-id` header value
  echoed into body, `X-Correlation-Id` header and log. ✕ across all boundaries, plus ✕ for
  case variants, whitespace variants, quoted/JSON/escaped-JSON values, multiple credentials,
  mixed Bearer/Basic and malformed Base64.
- **Finding 2 (exact reproductions):**
  - `new Proxy({}, { getPrototypeOf() { throw new Error('proxy getPrototypeOf'); } })` as the
    exception → `catch()` threw `proxy getPrototypeOf` before any response (the unguarded
    `exception instanceof HttpException` evaluates the prototype trap). ✕
  - `new HttpException(new Proxy({ message: 'safe' }, { get(t,k){ if (k === 'error') throw …; … } }), 400)`
    → `catch()` threw `error getter trap` while evaluating `details.error` inside the
    `send()` argument list, before the response. ✕
  - Adjacent variants also failed pre-fix: throwing `message` getter, throwing `getStatus`
    trap, hostile validation-message array (throwing element access during `.map`), and a
    throwing `logger.error` preventing the response.

## 2. Corrections

### Finding 1 — `src/common/sensitive-data-redaction.ts`: scheme-context credential shape

`applyCredentialShapes` gained one bounded pattern between the `pvr1:` attached-suffix shape
and the `eyJ` JWT shape (region logic acts first; `Bearer <JWT>` collapses as one region):

```
\b(?:Basic|Bearer case-folded)[ \t]+
  (?=[^\s"',;:()[\]{}|\\`]*[A-Z0-9+/=_])      # run must carry a token marker
  [^\s"',;:()[\]{}|\\`]{7,}[A-Za-z0-9+/=_-]   # ≥8 chars, ends on a token char
```

Policy: the explicit authentication scheme prefix **is** the credential context (report 21's
position). Scheme word (any case, spelled out character-class case-folded so the marker
lookahead stays case-sensitive) + horizontal whitespace + a token-like run is redacted as a
complete region — replaced with `[REDACTED]` — when the run contains at least one
`[A-Z0-9+/=_]` marker. Runs stop at quotes, commas, semicolons, colons, brackets, braces,
parens, pipes, backslashes and backticks, so JSON structure and escaped-JSON boundaries stay
byte-intact; JSON string values are covered through the tokenizer's existing per-value
recursion.

Deliberately **not** redacted (anti-over-redaction, asserted by tests): context-free Base64
strings without a scheme prefix; all-lowercase prose runs after the scheme word
(`a basic understanding of the system`, `the bearer of good news`); short runs (<8 chars).
Because every JSON string value is recursively sanitized, the shape also closes bare
key-less scheme credentials inside non-sensitive JSON values.

### Finding 2 — `src/http-exception.filter.ts`: trap-guarded exception processing

Every untrusted operation in the filter is now guarded, per the audited operation classes:

| Operation class | Guard | Fallback on trap |
|---|---|---|
| `instanceof HttpException` / `instanceof Error` (prototype-chain traps) | `isHttpExceptionValue()` / `isErrorValue()` try/catch | treated as non-Http / non-Error → canonical 500 path |
| `exception.getStatus()` | `safeStatusCode()` try/catch + integer 100–599 validation | canonical 500 |
| `exception.getResponse()` | `safeExceptionResponse()` try/catch | `undefined` → canonical fields |
| `details.message` / `details.error` getter reads | `safeGet()` returning a `THROWING` sentinel distinct from "absent" | message → `'Request failed'`; error → canonical `code` |
| validation-array `.map` (element access traps) | `sanitizeMessageValue()` try/catch | single `[REDACTED]` |
| `String(exception)` / `exception.message` accessor | `safeExceptionText()` (pre-existing, now with guarded `instanceof`) | `[REDACTED]` |
| `request.url` / `request.method` / request-context extraction | `safeDiagnosticPath()` / `safeOperationName()` / `safeRequestContext()` try/catch | `[REDACTED]` canonical values |
| `this.logger.error(...)` invocation | try/catch around the logging call | logging skipped; **response always sent** |

Fidelity under partial hostility is preserved field-by-field: a throwing `error` getter on an
otherwise-legitimate 400 keeps status 400 and the readable `message` while only the `error`
field fails closed to `BAD_REQUEST`. Normal NestJS/Fastify flows are untouched (ordinary
exceptions keep full diagnostic fidelity — asserted). Trusted internal values (`statusCode`,
`code`, `timestamp`, canonical messages) are not sanitized. The response body/headers/log
spread now use only values produced by guarded helpers, so no unguarded untrusted read remains
on the response path. Hostile Fastify `reply`/`host` objects themselves remain out of scope:
if the transport provided by the framework throws, there is no channel through which to
respond (not demonstrated by the audit and not reachable from request payloads).

## 3. Permanent tests added

`test/report21-basic-scheme-and-proxy-safety.spec.ts` — 20 tests: the two exact report-21
reproductions per finding plus adjacent adversarial variants (case-insensitive schemes,
whitespace variations, quoted/JSON/escaped-JSON values, multiple credentials, mixed
Bearer/Basic, malformed Base64 incl. unpadded and symbol-corrupted; throwing
`getPrototypeOf`/`getStatus`/`message`/`error`/array-element/logger traps), and four
preservation guards (context-free Base64, lowercase prose, already-guarded message accessor,
ordinary-exception fidelity incl. Nest `Bad Request` label and readable 5xx `errorMessage`).

## 4. Regression results on the final tree (all executed in this environment)

Environment: `npm ci` (979 packages), Node v22.22.3, embedded PostgreSQL 18.4 (fresh initdb,
synthetic credentials, disposable `mn_it_*` namespaces, run ids `r21bat1a`/`r21bat2a`).

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm run build` | PASS |
| ESLint (3 changed files) | PASS (0 problems) |
| Focused battery (report21, report19, filter, adversarial, report16, f01-unit, sensitive-data-protection) | **7/7 suites · 138/138 tests** |
| Full backend unit suite | **212/212 suites · 2211/2211 tests** (= previous 211/2191 + new 1 suite/20 tests; zero pre-existing tests changed or lost) |
| PostgreSQL — report 21's relevant 11-suite set, batch 1 (F-01 disclosure, customer-compliance-authorization, provider-config-01, delivery-authorization, notification-reliability, transfer-producer-01) | **6/6 suites · 76/76 tests** |
| PostgreSQL — batch 2 (hardening-09 diagnostics, v1-005-notification-delivery, migration-chain, notification-migration-upgrade-01, notification-registry) | **5/5 suites · 73/73 tests** |
| PostgreSQL total | **11/11 suites · 149/149 tests** (same set report 21 independently executed) |
| Admin Web `ts:check` | PASS |
| Admin Web tests | **27/27 suites · 188/188 tests** |

Preserved guarantees verified green: F-01 historical disclosure (unit + PG), R-03
provider-reference matrix (35-test adversarial spec unchanged), report 19's three resolved
findings (22-test spec unchanged), JWT/Bearer protection, duplicate JSON keys, unicode-escaped
keys, bounded processing/fail-closed (report-16 spec unchanged), query-string exclusion,
correlation-ID sanitization, safe HTTP codes and diagnostic metadata.

## 5. Independent limitations / residual risks

1. **Scheme-shape trigger rule:** a scheme-prefixed run is redacted only when it carries an
   `[A-Z0-9+/=_]` marker and is ≥8 characters. A hypothetical credential that is entirely
   lowercase-alphabetic and short would be preserved (prose-safety trade-off); real Base64 of
   credential material practically always contains digits/uppercase/padding.
2. **Capitalized-word trade-off:** a capitalized ≥8-char word directly after a bare
   `Basic `/`Bearer ` in free prose (e.g. `Basic Authentication`) is redacted as a credential.
   Lowercase prose forms are preserved. Credential-safety was preferred; no application-emitted
   diagnostic string in the repository matches this pattern (verified by grep).
3. **Scheme + newline:** the bare shape requires horizontal whitespace (`[ \t]+`); a scheme
   word separated from its credential by a newline is only covered in keyed contexts
   (`authorization:` regions already span newlines). Newline-separated bare scheme credentials
   in free prose remain a documented gap.
4. **Hostile-object degradation:** a Proxy with a throwing `getPrototypeOf` trap degrades to
   the canonical non-HTTP 500 path even if it "was" HttpException-like; `getStatus` results
   outside integer 100–599 degrade to 500; hostile validation arrays yield a single
   `[REDACTED]` message and `BAD_REQUEST` (not `VALIDATION_ERROR`) code. Availability and
   fail-closed posture preferred over fidelity under active hostility.
5. **Transport out of scope:** hostile Fastify `reply`/`host` objects are not guarded (no
   response channel would exist); not reachable from request payloads and not demonstrated.
6. Pre-existing repo-wide ESLint debt (~1,386 baseline errors) untouched; the changed files
   are lint-clean.

## 6. Handoff

Remediation is committed to `arena/8e59e188-monienaija` on top of `4ea7f1b2…`. The exact new
application SHA is reported in the remediation chat report for Arena 4 independent acceptance.
Technical security acceptance is **not** declared here. No sibling branch was modified; no
force-push; no provider activation; no deployment; no real credentials; no production
migrations.
