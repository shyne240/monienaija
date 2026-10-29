# Final independent R-03/R-04 adversarial retest — `d59689e`

**Review date:** 2026-10-29 (Africa/Lagos)  
**Repository:** `shyne240/monienaija`  
**Exact application SHA reviewed:** `d59689ebc15eb9e6ff2db59a444d8414f9e8e431`  
**Parent:** `aef51ddabe78c7dd52b72f5c5446eff77aa220ce`  
**Prior independent report:** `docs/audit/20261028/sprint1-security-acceptance/14-FINAL-INDEPENDENT-R03-RETEST-aef51dd-20261029.md`  
**Scope:** independent, documentation-only acceptance review. No application, test, configuration, or infrastructure changes were made. Synthetic values only; no provider credentials/calls, production migrations, activation, deployment, or financial operations.

## Executive verdicts

| Criterion | Verdict | Qualification |
|---|---|---|
| **F-01 historical provider-reference protection** | **PASS — tested paths** | Historical disclosure regressions and focused HTTP/diagnostic/provider-configuration suites pass. This does not imply the separate free-form exception-text scanner is complete. |
| **R-03 provider-reference error-text redaction** | **FAIL — partial remediation** | The exact report-14 whitespace-suffix payload is now redacted at 4xx/5xx boundaries. A JSON-escaped `providerRef` property name and key-less canonical-reference-plus-whitespace form still disclose their suffixes. |
| **R-04 JSON-quoted generic sensitive-key redaction** | **FAIL — partial remediation** | The exact report-14 plain JSON keys now pass. A valid JSON `\u`-escaped key and a realistic unquoted `Authorization: Bearer <token>` form still leak. |
| **Technical security acceptance** | **NO-GO** | Reproducible sentinels remain in error response/log surfaces. Passing committed tests do not cover these variants. |
| **Operational readiness** | **NO-GO / not established** | R-01, R-02, D-01/D-04 governance, and previously identified monitoring/reconciliation/redrive/retention/legal-hold/runbook/dark-launch prerequisites remain open or unverified. |
| **Production authorization** | **NO-GO** | Do not activate providers or authorize production operation on this evidence. No production action was taken. |

R-01 rotation/correlation policy, R-02 `available_at` semantics, and D-01/D-04 governance are intentionally distinct from this technical scanner verdict; this retest does not resolve or re-test them.

## Exact report-14 boundary retest

The new value-aware scanner is in `src/common/sensitive-data-redaction.ts`; the global response and 5xx logging call sites remain in `src/http-exception.filter.ts` (lines 40–42 and 50–61 at the reviewed SHA). I independently passed the exact report-14 payloads through `GlobalExceptionFilter`, using a `BadRequestException` for the 4xx body and an `Error` for the 5xx structured error log.

| Exact payload | 4xx response | 5xx `logger.error` record | Result |
|---|---|---|---|
| `{"providerRef":"pvr1:brevo:0123456789abcdef0123456789abcdef SENTINEL_JSON_SPACE_TX_NGN_999000"}` | Provider-reference value replaced; suffix sentinel absent | `errorMessage` replaced; suffix sentinel absent | **PASS; original R-03 reproduction closed** |
| `{"apiKey":"SECRET_JSON_KEY_SENTINEL_123","authorization":"SECRET_AUTH_SENTINEL_456"}` | Both values replaced; sentinels absent | Both values replaced; sentinels absent | **PASS; original R-04 reproduction closed** |

The exact report-14 payloads are therefore fixed at the tested HTTP and log boundaries. This does not establish that the general scanner is safe for all equivalent serialized representations.

## Remaining disclosure findings

### R-03 residual — escaped property names and key-less whitespace suffix

**Severity:** Medium / P2, conditional error-text disclosure.  
**Owner:** Platform HTTP error-handling / Notification Security.

The scanner detects raw ASCII key runs and later has a key-less regex for attached malformed canonical-reference suffixes (`src/common/sensitive-data-redaction.ts`, lines 195–260). It does not decode JSON escapes in property names, and its key-less fallback excludes whitespace from the suffix match.

Independent reproductions:

1. `{"provider\u0052ef":"pvr1:brevo:0123456789abcdef0123456789abcdef SUFFIX_SENTINEL"}` is valid JSON: the decoded property name is `providerRef`. `redactSensitiveText()` left both the provider reference and `SUFFIX_SENTINEL` unchanged. A text scanner that does not parse/decode JSON does not recognize the escaped key, and the final key-less regex stops before the whitespace.
2. `Opaque reference pvr1:brevo:0123456789abcdef0123456789abcdef KEYLESS_SPACE_SENTINEL` passed through `BadRequestException` retained `KEYLESS_SPACE_SENTINEL` in the 4xx body. This is the key-less quoted/prose limitation: the fallback catches attached non-whitespace suffixes, but not a whitespace-separated suffix after a recognizable canonical prefix.

These are residual R-03-like cases: the exemption is no longer incorrectly applied to a complete *quoted keyed value*, but equivalent key spelling and key-less/error-text shapes still allow a sensitive suffix through. The key-less case is less structurally certain than a keyed JSON property, but the scanner's own documented fallback claims to cover malformed key-less canonical-token shapes; its whitespace blind spot is reproducible. Arbitrary key-less values with no recognizable format remain inherently unidentifiable by a generic text redactor.

**Acceptance:** decode JSON property names when parsing valid JSON (with a safe fallback for malformed text), or otherwise recognize escaped spellings without allowing an escaped sensitive key to bypass value redaction. Extend the key-less fallback to fail safe on ambiguous whitespace/newline suffixes while retaining exact canonical token behavior only at explicitly tested safe boundaries. Add permanent 4xx, 5xx-log, and validation-array tests for escaped keys and key-less whitespace/newline suffixes.

### R-04 residual — valid escaped JSON key and multi-token unquoted authorization value

**Severity:** Medium / P2, conditional error/log credential disclosure.  
**Owner:** Platform HTTP error-handling / Security.

Two independent shapes bypass the broader sensitive-key redaction contract:

| Input | Observed result |
|---|---|
| `{"api\u004Bey":"UNICODE_KEY_SECRET_SENTINEL"}` | `redactSensitiveText()` returned the sentinel unchanged. JSON decodes `api\u004Bey` to `apiKey`, but the scanner compares the literal source characters. |
| `authorization: Bearer BEARER_SECRET_SENTINEL` | The 5xx `GlobalExceptionFilter` log contained `BEARER_SECRET_SENTINEL`; the scanner replaced only the first unquoted whitespace-delimited run (`Bearer`) and left the credential token. |
| `apiKey=SECRET_PART_ONE SECRET_PART_TWO` | The scanner replaced only `SECRET_PART_ONE`; `SECRET_PART_TWO` remained. |

The unquoted authorization shape is realistic: authorization values commonly consist of a scheme and a credential separated by whitespace. This is not merely an arbitrary key-less value problem; a recognized sensitive key is present, but unquoted scanning ends the sensitive value at its first whitespace. The same scanner also leaves a key-less arbitrary quoted value when no identifying key or recognized credential prefix exists; such content cannot be reliably classified without more context, but that limitation does not excuse the keyed Bearer leak.

**Acceptance:** for known sensitive keys, consume the full field value using a syntax-aware boundary (or redact through a conservative safe delimiter) rather than treating the first word as the entire credential. Parse/decode valid JSON keys before redaction or handle JSON Unicode escapes. Add permanent response and structured-log tests for Bearer/basic/multi-word authorization and escaped `apiKey`/`authorization`/`secret`/`token` property names. Confirm ordinary error text is not unnecessarily destroyed.

## Truncation, JSON validity, false positives, and performance

The adversarial probes also checked nested objects/arrays, multiple sensitive fields, escaped quotes/backslashes, malformed and embedded JSON, alternate `:`/`=`/`=>` separators, case/separator variations, canonical references, ordinary prose, and hostile input sizes.

- Plain JSON sensitive keys, nested fields/arrays, escaped quotes within an actual quoted value, alternate separators, and multiple fields were redacted in the tested shapes. Valid JSON remained parseable in the exact report-14 cases and the committed focused tests.
- A valid outer JSON object containing a message string that itself contains escaped serialized JSON (`JSON.stringify({message: JSON.stringify({apiKey:'EMBED_SECRET', next:'PRESERVE_ME'})})`) was returned as parseable outer JSON and did not leak `EMBED_SECRET`, but the scanner consumed/truncated the remainder of that message. `PRESERVE_ME`, the rest of the embedded object, and following message text were lost. This is an observed diagnostic-integrity regression, not a secret leak in that probe; add a nested/stringified-JSON test and avoid scanning escaped inner structure as though it were the outer field grammar.
- An ordinary sentence, `The code: 400 was expected`, became `The code: [REDACTED] was expected` because `code` is in the sensitive-key list. `error code: BAD_REQUEST` is likewise redacted. This is a low-severity false positive that can erase useful diagnostics; consider contextual structured parsing or narrow matching, with regression tests.
- Unbalanced malformed text was handled without exposing the tested sensitive sentinel. The malformed input was not made valid JSON; no claim is made that arbitrary malformed input can remain syntactically valid.
- Direct measurements on synthetic hostile values of 200,000, 1,000,000 and 5,000,000 characters took approximately 13.46 ms, 57.01 ms and 128.94 ms respectively in this sandbox. No pathological performance issue was observed in those samples. The committed 20,000-key test also passed in the backend unit suite.

## F-01 and F-02–F-05 regression evidence

F-01 remains accepted for the historical disclosure paths covered by the focused regression tests. The new residuals concern generic error-text representations and do not show a regression in historical delivery read projections.

Focused PostgreSQL-backed suites independently passed:

- `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts` — historical provider-reference disclosure controls;
- `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` — restricted diagnostic projection (F-04);
- `test/v1-notification-provider-configuration-01.integration.spec.ts` — controlled egress/SSRF/redirect controls, quota, and strict Brevo booleans (F-02/F-03/F-05);
- `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts` — authorization boundary regressions.

These four suites passed **59 tests** total. Only controlled fake transports/synthetic values were used; no live vendor traffic. The complete PostgreSQL suite was deliberately not run because the focused regressions passed and the source change is limited to error-text redaction.

## Independent execution record

All application execution was from a detached worktree at exact SHA `d59689ebc15eb9e6ff2db59a444d8414f9e8e431`; the report was authored separately. No retained application/test changes remain in the review worktree.

| Check | Independent result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm run build` | PASS |
| `./node_modules/.bin/jest --runInBand` | **209 suites / 2,122 tests passed** |
| Focused `test/sensitive-data-redaction-adversarial.spec.ts`, `test/http-exception-filter.spec.ts`, `test/f01-historical-provider-ref-security.unit.spec.ts` | **3 suites / 45 tests passed** |
| Focused PostgreSQL integration run (`jest.integration.config.js --runInBand`) | **4 suites / 59 tests passed**; files listed above |
| Temporary independent `GlobalExceptionFilter` probe | **3 tests passed**: exact report-14 sentinels absent from 4xx/5xx; assertions intentionally confirmed escaped-key, unquoted-Bearer, and key-less whitespace disclosure; confirmed embedded-JSON truncation and `code` false positive. Temporary test removed immediately. |
| Direct value-aware scanner/performance probes | Reproduced Unicode-escaped key and unquoted whitespace leaks; 5 MB input completed in ~129 ms; exact R-03/R-04 payloads redacted. |
| Complete PostgreSQL suite | **Not run**; no inference from previous runs or developer-reported counts. |
| Admin Web suite | Not rerun; no Admin Web files changed. |
| Live providers/credentials, production migration/activation/deployment, financial operations | Not run / prohibited. |

The backend unit suite includes the committed R-03/R-04 adversarial tests. Their passing result verifies the implemented cases, but not the independent bypasses documented above.

## Final disposition

The exact report-14 quoted whitespace-suffix and plain JSON-quoted-key reproductions are closed on `d59689e`. **R-03 and R-04 remain FAIL** because valid escaped JSON key spellings, multi-word unquoted authorization values, and the key-less whitespace suffix still disclose sentinels through the redaction API/global error boundaries. The scanner also truncates a nested JSON-in-string diagnostic and can redact ordinary `code` prose.

F-01 is **PASS for tested historical protections**. Overall technical security is **NO-GO** pending correction and permanent boundary tests for the residual disclosures. Operational readiness and production authorization remain **NO-GO** independently of this technical work; keep provider activation dark. R-01, R-02, D-01/D-04, and the open operational prerequisites remain distinct and unresolved. This report is the only intended change to the pinned branch.
