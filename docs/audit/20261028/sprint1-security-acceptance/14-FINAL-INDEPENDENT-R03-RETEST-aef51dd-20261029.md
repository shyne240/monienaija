# Final independent R-03 retest — `aef51dd`

**Review date:** 2026-10-29 (Africa/Lagos)
**Repository:** `shyne240/monienaija`
**Exact application SHA reviewed:** `aef51ddabe78c7dd52b72f5c5446eff77aa220ce`
**Parent:** `549f6d6b7b2d8abe01a91f6981ebb5e64bd8f319`
**Prior independent report:** `docs/audit/20261028/sprint1-security-acceptance/13-FINAL-INDEPENDENT-F01-ACCEPTANCE-30c3445-20261029.md`
**Scope:** focused, documentation-only security retest. No application or retained test changes; no live provider credentials/calls, production migration, activation, or deployment.

## Verdicts

1. **F-01 historical provider-reference disclosure: PASS** for historical delivery rows across tested HTTP, dispatch, event-key, TypeORM, audit, and logging/read projections. The original raw database-reference disclosure remains closed in the tested boundaries.
2. **R-03 error-text redaction: FAIL.** The prior exact colon-suffix exploit is closed, but a sensitive suffix separated by whitespace inside the provider-reference value is still exempted as though the canonical token were the whole value. It leaks in the global 4xx response and 5xx log. A separate generic JSON-quoted sensitive-key text-redaction limitation also reproduced (R-04).
3. **Overall technical security acceptance: NO-GO.** R-03 does not satisfy the requested error-text/log zero-sentinel condition; R-04 is an additional conditional error/log disclosure weakness.
4. **Operational readiness: NO-GO.** R-01 and R-02 and the prior monitoring, reconciliation/redrive, retention/legal-hold and dark-launch prerequisites remain open/not demonstrated.
5. **Production authorization: NO-GO.** Keep provider activation dark. No production operation was performed.

## R-03 retest — exact exploit, variants and bypass review

The source change in `src/common/sensitive-data-redaction.ts` replaced the old valid-prefix exemption with an assertion that the canonical token is followed by a delimiter/end of value. This fixes the prior colon-suffix case. The new committed tests cover colon suffixes, appended credential text, semicolon/hyphen suffixes, quoted JSON with a colon suffix, arrays of validation messages, malformed digest/scope cases, and exact canonical tokens. They do not cover a sensitive suffix separated by whitespace *inside a quoted providerRef value*.

### Independent variant results

| Input shape | Independent `redactSensitiveText()` result | Disposition |
|---|---|---|
| `providerRef=pvr1:brevo:0123456789abcdef0123456789abcdef:F01_SUFFIX_SENTINEL_TX_NGN_999000` | `providerRef=[REDACTED]`; sentinel absent | PASS; exact previous R-03 colon exploit closed |
| Canonical-looking prefix plus `-SENTINEL_HYPHEN...` | Complete providerRef value replaced; sentinel absent | PASS |
| Canonical-looking prefix plus `;SENTINEL_SEMI...` | Complete providerRef value replaced; sentinel absent | PASS |
| JSON-quoted `providerRef` with colon suffix | Complete value replaced; JSON remains parseable | PASS |
| `providerRef=<canonical-token> SENTINEL_SPACE_TX_NGN_999000` | Entire string unchanged; sentinel present | **FAIL** |
| `{"providerRef":"<canonical-token> SENTINEL_JSON_SPACE_TX_NGN_999000"}` | Entire JSON string unchanged; sentinel present inside the quoted value | **FAIL** |
| Malformed scope (`pvr1:mailgun`), malformed digest (31/33 hex, non-hex), wrong version and uppercase token prefix | Replaced; credential/financial suffix absent | PASS |
| Exact canonical tokens for robase, brevo, resend and external scopes | Preserved unchanged in tested separator forms | PASS |

**Why whitespace is a real missed case:** the regex's value class terminates at whitespace. Its exemption therefore accepts the canonical prefix as the entire value before checking whether the closing quote is reached. In JSON, the quote—not the embedded space—marks the end of the field value. The test suite's whitespace test treats a valid token followed by prose as a complete token and expects the whole message to remain unchanged; that expectation does not test or protect a malformed quoted field containing a whitespace suffix.

### GlobalExceptionFilter reproduction

A temporary, uncommitted Jest probe exercised the actual `GlobalExceptionFilter` with:

- `BadRequestException('providerRef=<canonical-token> SPACE_SUFFIX_SENTINEL_TX_NGN_998000; {"apiKey":"JSON_KEY_SENTINEL_123"}')`
- `Error('providerRef=<canonical-token> SPACE_SUFFIX_SENTINEL_TX_NGN_998000; {"apiKey":"JSON_KEY_SENTINEL_123"}')`

The 400 response body retained the whitespace suffix and JSON-quoted API-key sentinel. The 500 `logger.error` call retained both in `errorMessage`. The temporary test asserted these leaks, passed, and was removed immediately. No implementation or test edit remains in the review worktree.

A separate direct output probe confirmed the canonical-colon, hyphen and semicolon suffixes are redacted, while plain and JSON-quoted whitespace suffixes survive. The permanent `test/http-exception-filter.spec.ts` 4xx/5xx tests passed for the original colon exploit and JSON-quoted colon suffix; the validation-array test passed for that same colon shape. Whitespace-in-value is the remaining R-03 failure. The same filter maps validation message arrays through `redactSensitiveText`; the canonical-prefix/whitespace bypass therefore also applies to an array item. The new permanent tests do not assert this whitespace variant.

**Severity:** Medium / P2, conditional disclosure through a generic error/log projection. No current notification route was identified that directly interpolates a raw historical provider reference into an exception. However, when an error message contains this malformed quoted field, the global boundary leaks it; this is within the explicit retest acceptance criterion.
**Owner:** Notification Security / Platform HTTP error-handling owner.
**Acceptance:** parse or capture the complete quoted value through its matching quote and exempt only if that whole value equals a canonical token; redact the whole malformed value otherwise. For unquoted prose, define and test unambiguous value boundaries. Add permanent response, 5xx structured-log and validation-array tests for whitespace, newline, quote and alternate-separator suffixes. Do not preserve an incomplete token prefix as a safe exception.

## R-04 — MEDIUM: generic sensitive-key text redaction misses JSON-quoted keys

`redactSensitiveText()`'s generic secret-key regex in `src/common/sensitive-data-redaction.ts` matches names such as `apiKey`, `authorization`, `secret` and `token` when written as bare text followed by `:` or `=`, but it does not consume the closing quote between a JSON property name and colon. Thus an error string such as `{"apiKey":"SECRET_JSON_KEY_SENTINEL_123"}` is not redacted. This is separate from the providerRef-specific regex.

**Reproduction:** the temporary `GlobalExceptionFilter` probe above included `{"apiKey":"JSON_KEY_SENTINEL_123"}`. The 400 body and 500 error log both retained the sentinel. Directly calling `redactSensitiveText()` on JSON-quoted `apiKey` and `authorization` values likewise returned the secret-bearing string unchanged. `redactSensitiveData()` on a structured object has a separate key-aware path; this finding concerns exception/error **text** already serialized as JSON, which the global filter passes through `redactSensitiveText()`.

**Exploitability qualification:** this demonstrates a real gap in the generic exception/log redaction contract, not a confirmed current endpoint that serializes a provider credential into an exception. It is actionable defense-in-depth because credentials placed into a JSON-formatted exception message can cross both HTTP and server-log boundaries.
**Severity:** Medium / P2, conditional secret disclosure via error text.
**Owner:** Platform HTTP error-handling / Security.
**Acceptance:** handle JSON-quoted key/value pairs safely (prefer structured parsing where the string is valid JSON, or a quote-aware parser/regex that consumes the complete quoted value); add both 4xx response and 5xx log tests for `apiKey`, `authorization`, `secret`, and `token` keys. Preserve normal non-secret messages and prove the entire sensitive value is replaced.

## F-01 historical disclosure and related regression evidence

The independently executed historical-delivery regression suite continues to pass for seeded Robase, Brevo, Resend and unknown-provider historical values across:

- authorized delivery diagnostics HTTP projection;
- unauthorized/non-workforce and workforce-without-function denials;
- duplicate dispatch/idempotency result and event-key lookup;
- TypeORM entity reads;
- audit write/read projections;
- application and processor log capture;
- P0-02 message/raw-error restriction and safe error-code projection;
- deterministic restarts with a fixed keyring, opaque stored-token preservation through synthetic rotation, and fail-closed production secret handling.

This passes the **historical provider-reference disclosure** question; it does not cure the separately reproduced R-03/R-04 error-text cases.

## Other acceptance checks

- **F-02 egress/SSRF/redirect/DNS controls:** provider-configuration integration suite passed its controlled fake-transport tests. No live vendor traffic.
- **F-03 quota:** provider-configuration suite passed concurrent quota and failure-persistence cases.
- **F-04 P0-02 diagnostics:** hardening-09 suite passed restricted projection and authorization tests; rendered message and raw last_error remain absent.
- **F-05 strict Brevo booleans:** provider-configuration suite passed omitted/mistyped SPF/DKIM/DMARC rejection and explicit-false cases.
- Reliability receipts, retries, fencing, UNKNOWN/DEAD, ambiguous-acceptance protections, verified contacts/preferences, E.164 normalization, transfer recipient producer contract, accounting invariants, and migration 100→101 regression checks passed in the focused PostgreSQL set listed below.
- **R-01:** fixed-key restart determinism and stored opaque-token stability across synthetic rotation are tested. Raw legacy values re-hash under the current key and can change across rotation. Policy for cross-rotation correlation remains open; no production rotation was run.
- **R-02:** `available_at` remains ignored as a notification not-before gate; the existing independent-consumer behavior is unchanged. Contract remains open.
- **D-01/D-04:** compliance governance decisions remain open; this review makes no role, assignment, taxonomy or AML/SANCTIONS decision.
- Operational monitoring, alerting, UNKNOWN/DEAD/QUARANTINED reconciliation/redrive, receipt retention/legal hold, runbooks and dark-launch controls remain unverified/open.

## Independent command and result record

All execution was on a clean detached worktree at `aef51ddabe78c7dd52b72f5c5446eff77aa220ce`, with disposable embedded PostgreSQL where required and synthetic test values only. No complete PostgreSQL run was attempted for this focused retest.

| Check | Independently executed result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` and `npm run build` | PASS |
| `./node_modules/.bin/jest --runInBand` | **208 suites / 2,093 tests passed**, including `test/http-exception-filter.spec.ts` and `test/f01-historical-provider-ref-security.unit.spec.ts` |
| `./node_modules/.bin/jest --runInBand test/http-exception-filter.spec.ts test/f01-historical-provider-ref-security.unit.spec.ts` | **2 suites / 16 tests passed** |
| Focused `jest.integration.config.js --runInBand` run ID `r03independent` | **11 suites / 171 tests passed** |
| Temporary whitespace/JSON GlobalExceptionFilter probe | **1 test passed**, where the assertions intentionally confirmed suffix/API-key sentinels leaked in 4xx body and 5xx error log; file removed |
| Complete PostgreSQL suite | **Not run**, per focused scope; no inference from Arena 3 reported 2,355 tests |
| Admin Web suite | Not rerun; no Admin Web files changed in this retest |
| Live provider calls/credentials, production migration, deployment, financial operations | Not run / prohibited |

The focused PostgreSQL files were:

`test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts`, `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`, `test/v1-notification-provider-configuration-01.integration.spec.ts`, `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`, `test/notification-reliability.integration.spec.ts`, `test/transfer-notification-producer-01.integration.spec.ts`, `test/a5-payment-lifecycle.integration.spec.ts`, `test/a5-transfer-lifecycle.integration.spec.ts`, `test/migration-chain.integration.spec.ts`, `test/notification-migration-upgrade-01.integration.spec.ts`, and `test/customer-compliance-authorization.integration.spec.ts`.

## Final action

The prior high-severity historical raw-reference HTTP/DB disclosure is independently accepted as fixed for the tested read/write boundaries. The new R-03 redactor still leaks whitespace-suffixed malformed quoted provider references; R-04 generic JSON-quoted sensitive keys also leak if serialized into exception text. Both need permanent tests and correction before technical security GO. R-01, R-02, D-01/D-04 and operational prerequisites remain open. Only this report is to be committed and pushed to `arena/870f970d-monienaija`; no source changes are part of the report.
