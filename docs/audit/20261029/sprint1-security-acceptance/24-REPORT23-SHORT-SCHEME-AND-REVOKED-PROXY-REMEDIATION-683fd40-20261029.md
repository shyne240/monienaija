# 24 — Report-23 Targeted Remediation: Short/Lowercase Scheme Credentials and Revoked-Proxy Filter Safety

- **Date:** 2026-10-29
- **Assigned agent:** Arena 3
- **Branch (pinned):** `arena/8e59e188-monienaija`
- **Baseline application SHA:** `683fd409494cbe0207ecd7d4bf0880b76a6c9770`
- **Audit driving this remediation:** report 23 at `68391d0a38f5d31cfa29b91dfbab006e0b2d7c51`
  (`docs/audit/20261029/sprint1-security-acceptance/23-FINAL-INDEPENDENT-SECURITY-ACCEPTANCE-683fd40-20261029.md`,
  verdict NO-GO with two residual findings)
- **Scope discipline:** targeted remediation — the bounded redaction architecture and all
  complexity budgets are unchanged (256 KiB input cap, depth 32/12, 12,000 nodes, 1,000,000
  scan operations, 2,048 key matches, 1,024 key-less candidates, 8,192-char lookahead,
  8 suffix parts). No previous protection weakened; no existing spec file modified.

## 1. Failing reproductions captured BEFORE any production change

New permanent spec `test/report23-scheme-and-revoked-proxy.spec.ts` (18 tests) executed against
the unmodified baseline: **10 failed / 8 passed** (the 8 pre-fix passes are preservation and
regression guards, confirming the failures are genuine gaps rather than blanket breakage).

- **Finding 1 (exact reproductions):**
  - `redactSensitiveText('Basic dTpw')` returned the input unchanged — `dTpw` is valid unpadded
    Base64 of `u:p` (4 chars) and bypassed the report-21 shape's **≥8-character length floor**.
    ✕ direct, ✕ as custom `BadRequestException` 400 `error` value, ✕ inside a 5xx `Error`
    message copied to the `errorMessage` structured log, ✕ as `x-trace-id` echoed into
    body/header/log.
  - `redactSensitiveText('Bearer abcdefgh')` returned the input unchanged — the valid lowercase
    `b64token` bypassed the report-21 shape's **[A-Z0-9+/=_] marker requirement**. ✕ direct,
    ✕ as `x-correlation-id` echoed into the response body and `X-Correlation-Id` header.
  - Newline boundary: `Basic\ndTpw` and `Bearer\nabcdefgh` unchanged (report-21 shape was
    horizontal-whitespace-only). ✕
  - Case/whitespace/quoted/JSON/escaped-JSON variants of both credentials. ✕
- **Finding 2 (exact reproduction):** an `HttpException` whose overridden `getResponse()`
  returns `{ message: <revoked Proxy of []> }` made `GlobalExceptionFilter.catch()` throw
  `Cannot perform 'IsArray' on a proxy that has been revoked` — `sanitizeMessageValue()` called
  `Array.isArray(message)` **outside** its try block, so the guarded `.map()` path was never
  reached and no response was sent. ✕ (also ✕ for a revoked Proxy of `{}` as the message value).

## 2. Explanation of the fixes

### Finding 1 — `src/common/sensitive-data-redaction.ts`: two-tier scheme-context shapes

Root cause: report-21's single shape required BOTH a `[A-Z0-9+/=_]` marker in the run AND a
minimum run length of 8. `dTpw` fails the length floor; `abcdefgh` fails the marker class;
newline separation failed the `[ \t]+` gap. The audit's position — adopted here — is that an
explicit scheme label is itself sufficient credential context, but ordinary prose must survive:
the audit's own fidelity check preserves `a basic understanding of the system` and
`the bearer of good news`. The discriminator between `Bearer abcdefgh` (credential) and
`the bearer of good news` (prose) is the **casing of the scheme word**: canonical HTTP header
casing (`Basic`/`BASIC`/`Bearer`/`BEARER`) never occurs in the preserved prose forms.

Two shapes now sit in `applyCredentialShapes` (after the `pvr1:` attached-suffix shape, before
the `eyJ` JWT shape; runs still stop at quotes, separators and JSON boundaries and still end on
a token character, so JSON structure stays byte-intact and JSON string values are covered by
the tokenizer's per-value recursion):

- **Branch A — canonical casing, no composition requirement:**
  `\b(?:Basic|BASIC|Bearer|BEARER)\s+` + a run of ≥4 characters. Closes `Basic dTpw`,
  `Bearer abcdefgh`, newline-wrapped header-style values (`\s+` spans newlines), tabs and
  repeated spaces. The ≥4 floor is the shape of a minimal real credential (base64 of the
  shortest `u:p`-style pair is exactly 4 chars) and keeps two-letter prose runs (`of`) safe.
- **Branch B — any casing, marker-bearing runs:** the report-21 rule with the length floor
  relaxed 8→4 and horizontal-whitespace-only gaps: `basic dTpw`, `BaSiC dXNl…` and other
  mixed-case spellings redact whenever the run carries a base64/opaque marker, while
  all-lowercase prose runs after lowercase scheme words are preserved under **both** branches.

No new global rule was introduced: context-free Base64 (`U29tZSBsb25n…==`), context-free short
tokens (`dTpw` alone) and lowercase prose remain byte-identical (asserted). A scheme word
followed by a colon (`Basic: the fundamentals…`) is prose and preserved (no whitespace gap).

### Finding 2 — `src/http-exception.filter.ts`: guarded array normalization

`Array.isArray()` is not trap-free: on a revoked Proxy it throws a TypeError. The array check
and the element mapping now share one try/catch inside `sanitizeMessageValue()`:

- revoked Proxy (array or object target) as the whole message → single `[REDACTED]`
  (fail-closed canonical value — never unredacted text);
- revoked/hostile element **inside** a legitimate array → element-level `[REDACTED]` via
  `redactSensitiveText`'s own type guard, legitimate siblings and the `VALIDATION_ERROR` code
  preserved (asserted);
- legitimate string arrays keep per-item fidelity and `VALIDATION_ERROR`;
- the filter sends a valid response in every case and never throws.

Full audit of remaining hostile-value operations confirmed no other unguarded trap surface:
`typeof` checks never throw (including on revoked Proxies); `instanceof` is guarded
(`isHttpExceptionValue`/`isErrorValue`); `getStatus`/`getResponse` are guarded; property reads
use `safeGet` with the `THROWING` sentinel; `String()`/message accessors are guarded
(`safeExceptionText`); `request.url`/`method`/context extraction are guarded; `logger.error`
is wrapped; and the response body contains only filter-produced strings/numbers, so Fastify
serialization cannot touch a hostile object.

## 3. Permanent tests added

`test/report23-scheme-and-revoked-proxy.spec.ts` — 18 tests: both exact report-23
reproductions per finding; newline, case (`BASIC`/`BEARER`/`basic`/tab/multi-space), quoted,
JSON-embedded and escaped-JSON variants; all demonstrated leak surfaces (direct, 4xx `error`
field, 5xx `errorMessage` log, `x-correlation-id`/`x-trace-id` body/header/log echo); revoked
Proxy as message array, as message value, nested inside a legitimate array, and as the
exception value itself; and six preservation/regression guards (lowercase prose, context-free
tokens/Base64, `Basic:` colon prose, legitimate validation arrays with `VALIDATION_ERROR`,
ordinary-exception fidelity, plus the pinned `Basic Authentication` over-redaction caveat).

## 4. Complete regression results on the final tree (all executed in this environment)

Environment: `npm ci` (979 packages), Node v22.22.3, embedded PostgreSQL 18.4 (fresh initdb,
synthetic credentials, disposable `mn_it_*` namespaces, run ids `r23bat1a`/`r23bat2a`).

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm run build` | PASS (re-verified after final source edit) |
| ESLint (3 changed files) | PASS (0 problems) |
| Focused battery (report23, report21, report19, filter, adversarial, report16, f01-unit, sensitive-data-protection) | **8/8 suites · 156/156 tests** |
| Full backend unit suite | **213/213 suites · 2229/2229 tests** (= previous 212/2211 + new 1 suite/18 tests; zero pre-existing tests changed or lost) |
| PostgreSQL — report 23's exact 11-suite set, batch 1 (F-01 disclosure, customer-compliance-authorization, provider-config-01, delivery-authorization, notification-reliability, transfer-producer-01) | **6/6 suites · 76/76 tests** |
| PostgreSQL — batch 2 (hardening-09 diagnostics, v1-005-notification-delivery, migration-chain, notification-migration-upgrade-01, notification-registry) | **5/5 suites · 73/73 tests** |
| PostgreSQL total | **11/11 suites · 149/149 tests** (same set report 23 independently executed) |
| Admin Web `ts:check` | PASS |
| Admin Web tests | **27/27 suites · 188/188 tests** |

Preserved guarantees verified green: F-01 historical provider-reference protection (unit +
PG), R-03 provider-reference sanitization (35-test adversarial matrix unchanged), R-04 prior
credential/error-field cases (report-21 spec unchanged, 20/20), report 19's query-path
exclusion (22/22), duplicate JSON keys, unicode-escaped keys, bounded CPU/memory processing
(report-16 spec unchanged), fail-closed fallback, correlation-ID sanitization, diagnostic
fidelity and safe HTTP status codes.

## 5. Remaining limitations and realistic exposure

1. **Capitalized-scheme over-redaction (pinned, expanded):** Branch A redacts any ≥4-char run
   after a canonically-cased scheme word — `Basic Authentication is disabled` → `[REDACTED] is
   disabled` (accepted by report 23 as a bounded caveat) and, new with this fix, sentence-start
   prose such as `Basic auth` or a line-wrapped `…uses Basic\nauthentication…` is likewise
   redacted. This is deliberate: canonical scheme casing + adjacent run is treated as
   credential context. No application-emitted diagnostic phrase matching this pattern exists in
   `src/` or `apps/` (grep-verified in report 22; re-verified).
2. **All-lowercase scheme + all-lowercase markerless token** (`bearer abcdefgh`, `basic dtpw`)
   remains preserved as prose. Closing it would destroy the audit-protected prose forms
   (`the bearer of good news`, `a basic understanding`); HTTP Authorization headers and
   header-style diagnostics use canonical casing, so realistic exposure is limited to
   lowercased log normalizers copying raw credentials into free text.
3. **Runs shorter than 4 characters** after a canonical scheme (`Basic dTp`) are preserved;
   base64 of any `user:pass`-shaped credential is ≥4 chars, so shorter runs are not valid
   credentials of the demonstrated class.
4. **Bare key-less non-JWT tokens** without scheme/key/region context remain readable by
   design (diagnostic fidelity; unchanged from prior reports).
5. **Hostile-object degradation:** revoked/trap-bearing values fail closed to `[REDACTED]`
   (whole message) or element-level `[REDACTED]`; a hostile array yields `BAD_REQUEST` rather
   than `VALIDATION_ERROR`. Availability and fail-closed posture preferred over fidelity under
   active hostility. Hostile Fastify `reply`/`host` transport objects remain out of scope (no
   response channel would exist; not reachable from request payloads).
6. Pre-existing repo-wide ESLint debt (~1,386 baseline errors) untouched; changed files are
   lint-clean.

## 6. Handoff

Remediation is committed to `arena/8e59e188-monienaija` on top of `683fd409…`. The exact new
application SHA is reported in the remediation chat report for Arena 4 independent acceptance.
Technical security acceptance is **not** declared here. No sibling branch was modified; no
force-push; no provider activation; no deployment; no real credentials; no production
migrations.
