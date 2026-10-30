# 20 — Report-19 Final Error-Boundary Disclosure Remediation

- **Date:** 2026-10-29
- **Assigned agent:** Arena 3
- **Branch (pinned):** `arena/8e59e188-monienaija`
- **Baseline application SHA:** `b303a490130e67d600799af93a9247623666738b`
- **Audit driving this remediation:** report 19 at `0beed42c86fdb3db05563a3b6afa9876efaa713c`
  (`docs/audit/20261029/sprint1-security-acceptance/19-FINAL-INDEPENDENT-SECURITY-ACCEPTANCE-b303a490-20261029.md`,
  verdict NO-GO with three demonstrated disclosure findings)
- **Scope discipline:** targeted remediation only — no general scanner rewrite. All pre-existing
  complexity limits (256 KiB input cap, depth 32/12, 12,000 nodes, 1,000,000 scan operations,
  2,048 key matches, 1,024 key-less candidates, 8,192-char lookahead, 8 suffix parts) unchanged.

## 1. Failing reproductions captured BEFORE any application change

New permanent spec `test/report19-final-error-boundary.spec.ts` (22 tests) was written first and
executed against the unmodified baseline. Result: **20 failed / 2 passed**, including the three
exact report-19 reproductions:

- **Finding A (exact input):**
  `Opaque provider reference: pvr1:brevo:0123456789abcdef0123456789abcdefsuffix eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature`
  → `redactSensitiveText` returned `Opaque provider reference: [REDACTED] eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature`
  (JWT visible); the same JWT reached the 4xx body `message` and the 5xx `logger.error`
  `errorMessage`. ✕ direct / ✕ 4xx / ✕ 5xx reproductions all failed as documented.
- **Finding B (exact input):**
  `new BadRequestException({ message: 'Ordinary validation failure', error: 'apiKey=ERROR_FIELD_SECRET_SENTINEL' })`
  → 400 body contained `"error":"apiKey=ERROR_FIELD_SECRET_SENTINEL"` unchanged. ✕ failed as documented.
- **Finding C (exact input):** 5xx with request URL
  `/api/v1/lookup?access_token=PATH_QUERY_SECRET_SENTINEL` → both the 500 body `path` and the
  structured-log `path` contained the raw query with the sentinel. ✕ failed as documented.
- Adjacent variants also failed pre-fix: newline/long-opaque suffixes after an attached fragment;
  JWT-valued `details.error`; non-string `details.error`; percent-encoded, repeated, mixed-case
  query parameters; fragments; malformed URLs; key/value inside the path segment; client-controlled
  `x-correlation-id`/`x-trace-id` sentinels echoed into body/headers/logs; hostile exception
  `toString()` (pre-fix this **crashed the filter before any response was sent** — the harness had
  to raise `filter did not send a response`).
- The 2 pre-fix passes were the two preservation guards (attached fragment + ordinary prose;
  query-free URL echoed exactly), confirming the reproductions were not trivially "fixed" by
  destroying everything.

## 2. Corrections

### Finding A — `src/common/sensitive-data-redaction.ts`, `inspectProviderSuffix`

Root cause: the key-less provider-reference suffix scanner required whitespace before the first
suffix part, so a fragment **attached** to the canonical token (`…abcdefsuffix`) terminated the
scan immediately; `applyCredentialShapes` then redacted only token+attachment (its class stops at
whitespace) and the following JWT survived.

Fix: the attached fragment is now consumed as the **first suffix part** of the same region
(guarded: not whitespace, not a text delimiter, not a key/value start), and scanning then
continues through the existing whitespace-separated parts within the existing budgets
(8 parts, 8,192-char lookahead, shared 1M-operation budget). If any part is credential-shaped,
the complete region `pvr1:…` → end-of-credential becomes `[REDACTED]`.

Preservation: standalone canonical references, delimiter/quote/key-value boundaries, ordinary
prose after the reference, and attached-fragment-only inputs behave exactly as before (the
over-redaction guard test asserts the exact output
`Opaque reference: [REDACTED] was delivered to the recipient`). The keyed `providerRef` path,
malformed keyed references, whitespace-suffix regions and all other credential shapes are
untouched — the complete report-13/14/15 adversarial matrix (35 tests) and report-16 suite pass
unmodified.

### Finding B — `src/http-exception.filter.ts`, `error` field + boundary rule

- `error: details.error ?? code` → `error: typeof details.error === 'string' ? redactSensitiveText(details.error) : code`.
  A string `error` passes the sanitization boundary; any non-string value fails closed to the
  canonical code (`BAD_REQUEST`, …). Legitimate static labels (`Bad Request`) and canonical codes
  pass through `redactSensitiveText` unchanged (diagnostic fidelity preserved; asserted).
- Boundary audit of every field the filter emits:
  - `message` / validation-array items: already sanitized (unchanged); non-string items already
    fail closed via the `typeof` guard in `redactSensitiveText`.
  - 5xx `errorMessage`: sanitized (unchanged) and now built through `safeExceptionText()` — a
    hostile `toString()`/message getter can no longer crash the filter before the response is
    sent; it yields the generic `[REDACTED]`.
  - `path` (body **and** 5xx log): see Finding C.
  - `requestId`/`correlationId`/`traceId` (body, response headers `X-Request-Id`/`X-Correlation-Id`/
    `X-Trace-Id`, and the 5xx log spread): these can echo client-supplied headers (validated only
    as printable ASCII ≤255), so they now pass `sanitizeRequestContext()` — ordinary ids are
    byte-identical, sensitive key/value content is redacted at every emission point.
  - Trusted/internal fields left unsanitized deliberately: `statusCode`, `code`, `timestamp`
    (internal), `operationName` (`request.method` — constrained by Fastify to known tokens).
- Adjacent variant fixed at the shape layer: a **bare key-less JWT** (e.g. `Bearer eyJ…` copied
  into a diagnostic field) previously survived the text scanner because JWTs were only redacted
  in key/region/provider-ref contexts. `applyCredentialShapes` gained one bounded shape:
  `\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}` (three base64url segments with
  the universal `eyJ` = `{"` header marker), placed **after** the `pvr1:` attached-suffix shape so
  region logic still acts on raw text first. Ordinary prose is not matched by this shape; no
  existing fixture outside the new spec contains an `eyJ` token expected to be preserved
  (verified by grep across all specs).

### Finding C — `src/http-exception.filter.ts`, `path` field (response + 5xx log)

Query strings carry credentials routinely (signed links, integration callbacks, misconfigured
clients) and have no diagnostic value in error bodies/logs. No existing test, consumer or Admin
Web surface asserts a query inside the error `path` (verified by grep), so the response contract
allows the mission-preferred policy: **the diagnostic path excludes everything from the first
`?` or `#`**, and the remainder still passes `redactSensitiveText` (catching key/value content
inside path segments). Implementation is pure string operations — malformed URL strings cannot
throw; over-cap input fails closed via the existing 256 KiB bound. Percent-encoded parameter
names/values, repeated parameters, mixed-case keys and fragments are neutralized by exclusion
rather than by a denylist of secret parameter names. Query-free paths are echoed byte-identically.

## 3. Regression results on the final tree (all executed in this environment)

Environment: `npm ci` (979 packages), Node v22.22.3, embedded PostgreSQL 18.4 (fresh initdb,
synthetic credentials, disposable `mn_it_*` namespaces, run ids `r19bat1a`/`r19bat2a`).

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm run build` | PASS |
| ESLint (3 changed files) | PASS (0 problems) |
| Report-19 spec + redaction/filter focused suites (report19, filter, adversarial, report16, f01-unit, sensitive-data-protection) | **6/6 suites · 118/118 tests** |
| Full backend unit suite | **211/211 suites · 2191/2191 tests** (= previous 210/2169 + new 1 suite/22 tests; zero pre-existing tests changed or lost) |
| PostgreSQL — report 19's exact 11-suite relevant battery, batch 1 (F-01 disclosure, customer-compliance-authorization, provider-config-01, delivery-authorization, notification-reliability, transfer-producer-01) | **6/6 suites · 76/76 tests** |
| PostgreSQL — batch 2 (hardening-09 diagnostics, v1-005-notification-delivery, migration-chain, notification-migration-upgrade-01, notification-registry) | **5/5 suites · 73/73 tests** |
| PostgreSQL total | **11/11 suites · 149/149 tests** (matches report 19's independently executed set) |
| Admin Web `ts:check` | PASS |
| Admin Web tests | **27/27 suites · 188/188 tests** |

Evidence of no unrelated behavior change: `git diff --stat` shows exactly 2 modified source files
(+80/−11) plus 1 new spec and this record; no pre-existing spec file was touched (no assertion
weakened); the full 2169-test pre-existing unit corpus, the 149-test PG corpus and the Admin Web
corpus pass unchanged; query-free paths, legitimate ids, Nest error labels and diagnostic codes
are asserted byte-identical in the new spec.

## 4. Remaining limitations

1. A key-less **malformed** `pvr1:`-like prefix (e.g. `pvr1:brevo:not-a-reference <JWT>`) does not
   match the canonical region regex; the JWT in that secondary report-19 probe is now removed by
   the `eyJ` shape (verified: output `pvr1:brevo:not-a-reference [REDACTED]`), but the malformed
   prefix text itself remains readable (it is not a credential and carries no secret). Report 19
   classified the primary reproduction as the acceptance-relevant case.
2. A bare key-less JWT is redacted only when it carries the `eyJ` header marker and three
   base64url segments; JWTs whose header does not encode `{"` (non-standard) fall back to
   key/region/authorization-context redaction as before.
3. Bare `Basic <base64>` credentials with **no** key/authorization context remain a text-shape
   gap by design (a global `Basic …` shape would destroy ordinary prose); every demonstrated
   report-19 path (Authorization-keyed, error-field JWT) is closed.
4. Query exclusion changes the error-body `path` contract to pathname-only. Any hypothetical
   consumer relying on query echoes in error bodies (none found in repo) would see the shorter
   path; this is the mission-preferred policy.
5. Sensitive values inside **non-sensitive JSON string values**: every JSON string value is
   recursively sanitized by the text pipeline, so `eyJ`-marked JWTs are redacted there too
   (verified). Non-JWT opaque secrets appearing only as unkeyed, shape-less, region-less
   non-sensitive JSON string values (e.g. `{"note":"<40-char-random>"}`) remain readable — the
   pre-existing, accepted diagnostic-fidelity design of the bounded tokenizer (keys, shapes and
   regions drive value redaction).
6. Pre-existing repo-wide ESLint debt (~1,386 errors on the baseline) is untouched by this
   mission; the changed files are lint-clean.

## 5. Handoff

Remediation is committed to `arena/8e59e188-monienaija` on top of `b303a490…`. The exact new
application SHA is reported in the remediation chat report for Arena 4 independent acceptance.
Technical security acceptance is **not** declared here. No sibling branch was modified; no
force-push; no provider activation; no deployment; no real credentials; no production migrations.
