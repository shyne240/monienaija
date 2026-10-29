# Independent security acceptance — report-15 remediation at `f00e0c9`

**Review date:** 2026-10-29 (Africa/Lagos)  
**Repository:** `shyne240/monienaija`  
**Exact application SHA reviewed:** `f00e0c939dba632a3323f39750a8b3fe83ab4aec`  
**Application parent:** `d59689ebc15eb9e6ff2db59a444d8414f9e8e431`  
**Previous independent audit commit:** `d5699d152a642c269de79a48f847f2536c289d07`  
**Previous report:** `docs/audit/20261028/sprint1-security-acceptance/15-FINAL-INDEPENDENT-R03-R04-RETEST-d59689e-20261029.md`  
**Scope:** independent acceptance only. No application, test, configuration, or infrastructure changes were retained. Synthetic values only; no live providers/credentials/calls, production migration, activation, deployment, or financial operation.

## Executive verdicts

| Criterion | Verdict | Evidence/qualification |
|---|---|---|
| **F-01 historical disclosure** | **PASS — tested historical paths** | Nine focused PostgreSQL-backed regression suites passed, including historical delivery disclosure, diagnostics, provider configuration, reliability, and authorization. This does not make generic exception-text redaction complete. |
| **R-03 malformed provider-reference disclosure** | **FAIL** | Report-15 sentinel-shaped suffixes and backslash-attached forms are redacted. A key-less JWT-shaped lowercase suffix and duplicate `providerRef` JSON properties still leak through the global response/log boundary. |
| **R-04 sensitive-key disclosure** | **FAIL** | Unicode-escaped single keys are sanitized, but a realistic JWT/Basic credential after unquoted `Authorization` leaks. Duplicate JSON properties can preserve an earlier `apiKey` secret. Bare `code` values are also left unredacted by the text path. |
| **Report-15 F1 — Unicode-escaped JSON keys** | **PASS for the exact single-key case; incomplete for duplicate-key variants** | Single escaped `apiKey`/`providerRef` examples are decoded and redacted at 4xx and 5xx boundaries. Duplicate decoded property names defeat the byte-preserve optimization (new finding below). |
| **Report-15 F2 — unquoted Authorization** | **FAIL** | Sentinel-style credential segments pass, but realistic JWT and Base64 Basic credentials survive in 5xx structured logs after only the scheme word is replaced. |
| **Report-15 F3 — key-less provider-reference suffix** | **FAIL — partial** | The uppercase/underscore sentinel and backslash-attached cases pass. A whitespace-separated JWT-shaped lowercase suffix remains in the 4xx response (and the same redaction function is used for 5xx logs). Ordinary prose alone is not treated as a finding. |
| **Report-15 F4 — nested JSON diagnostic fidelity** | **PASS for tested valid nested JSON** | Sensitive inner values were removed while non-sensitive siblings, trailing prose, and outer JSON parseability were preserved. |
| **Report-15 F5 — ordinary diagnostic false positives / sensitive codes** | **PARTIAL** | `code: 400`, `statusCode`, `errorCode`, `codeHash`, `recoveryCode`, `transferCode`, and `challengeHash` behaved as intended. A sensitive-looking value under bare `code` remains visible; that key is excluded from text redaction. |
| **Overall technical security acceptance** | **NO-GO** | Reproducible credentials/sentinels remain in HTTP/log output, and malformed/deep structured input can make the global exception filter throw. |
| **Operational readiness** | **NO-GO / not established** | Open operational and governance prerequisites listed below remain unresolved or unverified. They are distinct from the demonstrated technical findings. |
| **Production authorization** | **NO-GO** | Keep provider activation dark. No production action was taken. |

## Report-15 finding retests

The report-15 remediation added structured JSON parsing/walking, bounded embedded-fragment scanning, an unstructured key/value scanner, a key-less provider-reference pass, and credential-shape patterns in `src/common/sensitive-data-redaction.ts`. I reviewed the source at the pinned application SHA, exercised direct scanner probes, and drove representative cases through the actual `GlobalExceptionFilter`.

### F1 — Unicode-escaped JSON keys

**Exact single-property cases: PASS.** These valid JSON inputs are parsed with their decoded property names and sanitized:

```json
{"api\u004Bey":"F1_API_SECRET"}
{"provider\u0052ef":"pvr1:brevo:0123456789abcdef0123456789abcdef F1_REF_SUFFIX"}
```

An independent boundary probe confirmed the `apiKey` value and the whitespace-suffixed `providerRef` value were replaced in both a `BadRequestException` response and an `Error` 5xx `errorMessage` log.

**Residual duplicate-property variant: FAIL.** `JSON.parse()` collapses duplicate names to the last property, and `walkValue()` returns the original bytes when it believes no change was needed. This creates a raw-text bypass:

```json
{"apiKey":"DUPLICATE_SECRET_SENTINEL","apiKey":null}
```

`redactSensitiveText()` returned the input unchanged; the 4xx body and 5xx log both retained `DUPLICATE_SECRET_SENTINEL`. The same occurs when the last value is already `[REDACTED]`. Unicode decoding does not close the duplicate case:

```json
{"api\u004Bey":"DUPLICATE_SECRET_SENTINEL","apiKey":null}
```

A provider-reference variant also reproduced at both boundaries:

```json
{"providerRef":"LEGACY_RAW_PROVIDER_REF_SENTINEL","providerRef":"pvr1:brevo:0123456789abcdef0123456789abcdef"}
```

The last value is considered a complete safe canonical reference, so the “unchanged” path returns the original string, including the first raw reference. Duplicate JSON property names are discouraged and parser behavior is ambiguous, but `JSON.parse()` accepts them and this is a realistic defense-in-depth failure for untrusted serialized error/provider text. **Severity: Medium / P2, conditional error/log disclosure.** Parse with duplicate detection/lossless tokens or fail safe by redacting every raw occurrence before applying a byte-preserving shortcut.

### F2 — Unquoted Authorization headers

**Sentinel-style committed cases pass, realistic credentials fail.** The scanner replaces the first whitespace-delimited word (`Bearer` or `Basic`) and only extends through subsequent runs matching a narrow underscore/all-caps-plus-digit heuristic. Actual credentials do not necessarily match that heuristic.

Independent 5xx `GlobalExceptionFilter` outputs:

| Input exception text | `errorMessage` output | Result |
|---|---|---|
| `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature` | `Authorization: [REDACTED] eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature` | **JWT remains** |
| `authorization: Basic dXNlcjpwYXNzd29yZA==` | `authorization: [REDACTED] dXNlcjpwYXNzd29yZA==` | **Base64 credential remains** |
| `Authorization=>Bearer <same JWT>` | Scheme replaced; JWT remains | **JWT remains** |

Mixed-case `aUtHoRiZaTiOn` is matched, but the credential still leaks. A multiple-value test confirmed a neighboring `apiKey=UNRELATED_API_KEY_SENTINEL` is redacted while the JWT is not. This is not an arbitrary-string concern: a JWT-shaped value with two dot-separated base64url segments and a Basic base64 `user:password` credential are recognizable credential formats after a recognized sensitive header name. **Severity: Medium / P2, conditional 5xx log or 4xx error-text disclosure.** Redact the entire value for recognized Authorization header keys (including scheme and credential), terminating at a reliable header/message boundary rather than guessing based on token capitalization.

### F3 — Key-less provider-reference suffixes

**Exact report-15 sentinel and backslash-attached cases pass.** The standalone canonical reference followed by `KEYLESS_SENTINEL_SUFFIX` was redacted at both 4xx and 5xx boundaries. The attached form `pvr1:brevo:<digest>\LOWERCASE_SENTINEL` was also redacted by the retained malformed-reference shape pattern.

**Lowercase credential-shaped suffix: FAIL.** The heuristic preserves ordinary prose, but it does not recognize a JWT-like suffix as suspicious:

```text
Opaque reference pvr1:brevo:0123456789abcdef0123456789abcdef eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig
```

The entire string, including the JWT-shaped suffix, survived `redactSensitiveText()` and both synthetic 4xx and 5xx boundaries (the latter in the structured `errorMessage` log). An independent direct probe also left a lowercase hexadecimal run untouched. I do **not** classify lowercase words or random prose after a provider reference as a credential finding merely because they are unknown; the JWT-like suffix is the demonstrated credential-shaped case. The uppercase/underscore sentinel cases pass, so the defect is specifically the limited run classifier, not universal failure of the key-less pass. **Severity: Medium / P2, conditional error-text disclosure.** Add credential-format recognition or fail safe for ambiguous suffixes without indiscriminately deleting ordinary prose.

### F4 — Nested JSON diagnostic truncation

**PASS for tested valid structures.** I independently tested an outer JSON object whose `message` is a stringified JSON object containing `apiKey`, a non-sensitive `next` field, a sibling `statusCode`, and surrounding `before`/`after` text. The inner secret was replaced; `next`, both trailing text portions, the ordinary sibling, and outer JSON parseability were preserved. The committed focused tests for nested strings and embedded object text also passed. This closes the specific report-15 truncation reproduction in tested shapes.

### F5 — Ordinary diagnostics and sensitive code-family values

**Ordinary diagnostic fidelity: PASS for the specified examples.** `The code: 400`, `statusCode`, and `errorCode` remain readable. `codeHash`, `recoveryCode`, `transferCode`, and `challengeHash` remain redacted.

**Bare `code` key: conditional gap.** The text key set deliberately removes `code` to avoid redacting HTTP/application diagnostics. Consequently:

```json
{"code":"OTP_SECRET_123456"}
```

is returned unchanged and the sentinel crossed a synthetic 4xx response. The structured-object redactor still includes the bare `code` key, but the free-form exception-text layer does not. A bare `code` can be a diagnostic status/error code or an OTP/verification code; this is an ambiguity, not evidence that a current endpoint emits an OTP in an exception. It should be resolved explicitly in policy and tested with both diagnostic and one-time-code contexts. **Disposition: F5 partial, conditional medium concern; do not silently treat every numeric or unknown code string as sensitive.**

## Additional architecture findings

### A1 — Duplicate JSON properties bypass redaction

The duplicate-key examples above are confirmed at both 4xx and 5xx boundaries for `apiKey`, and at both boundaries for `providerRef`. The vulnerable control flow is the valid-JSON path in `redactTextAtDepth()` plus `walkValue()`'s `changed` result: duplicate keys are discarded by `JSON.parse`; if the final value is null, `[REDACTED]`, or a canonical provider reference, `changed` remains false and the original untrusted JSON bytes are returned. This is a demonstrated disclosure, separate from whether duplicate-key JSON is recommended. **Severity: Medium / P2.**

### A2 — Structural depth limit is not applied to object/array recursion

`MAX_STRUCTURE_DEPTH` is checked in `redactTextAtDepth()`, `walkString()`, and fragment traversal, but not in recursive `walkValue()` object/array traversal (`src/common/sensitive-data-redaction.ts`, approximately lines 186–225). A valid JSON value consisting of 1,800 nested arrays around a string is only about 3.6 KB. Passing it as a `BadRequestException` message makes `GlobalExceptionFilter.catch()` throw `RangeError: Maximum call stack size exceeded` instead of sending its response. The same direct test at depth 1,500 also throws.

This is an error-boundary availability failure, not a confidentiality finding. Exposure is conditional on a deeply nested string reaching the filter (for example, an upstream/raw error payload or an exception that embeds untrusted request data); no specific production route doing so was identified. **Severity: Medium / P2, conditional availability/DoS.** Enforce the depth cap in every recursive object/array walk and define a safe fallback that still redacts known secrets without propagating the exception.

### A3 — Whole-input size is unbounded; per-character word building amplifies memory

The fragment scanner has `MAX_FRAGMENT_CANDIDATES = 128` and `MAX_FRAGMENT_LENGTH = 65,536`, but the whole-valid-JSON path has no input-size cap. In `scanWordRun()` (approximately lines 361–382), `raw` and `decoded` are repeatedly concatenated one character at a time. Isolated synthetic inputs containing one long JSON string produced the following sandbox measurements:

| Input string size | Elapsed redaction time | Observed RSS increase |
|---:|---:|---:|
| 1 MB | ~176 ms | ~55 MB |
| 5 MB | ~1.33 s | ~337 MB |

These are process RSS deltas in this runtime, not guaranteed production multipliers. They demonstrate substantial allocation amplification; repeated/concurrent large error messages could pressure memory. No concrete route that can place a multi-megabyte string into this filter was established, so this is a conditional availability hardening finding rather than a claimed current remote exploit. **Severity: Medium / P2 if attacker-controlled or upstream-controlled large text can reach the filter.** Add a total input budget and use indexed slices/builders rather than per-character concatenation; fail safely without bypassing redaction when over budget.

## Focused acceptance and regression tests

The new application passes the targeted regression cases it added, including the exact report-15 sentinels. Independent probes found cases outside those committed expectations, especially actual JWT/Basic formats, duplicate JSON properties, and depth overflow.

### Independently executed

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **PASS** |
| `npm run build` | **PASS** |
| Complete backend `./node_modules/.bin/jest --runInBand` | **209 suites / 2,140 tests passed** |
| Focused redaction, exception-filter, and F-01 unit files (`test/sensitive-data-redaction-adversarial.spec.ts`, `test/http-exception-filter.spec.ts`, `test/f01-historical-provider-ref-security.unit.spec.ts`) | **3 suites / 63 tests passed** |
| Those three plus `test/notification-direct-security-logging.unit.spec.ts` | **4 suites / 69 tests passed** |
| Focused PostgreSQL integration run | **9 suites / 111 tests passed**; suite list below |
| Temporary independent adversarial boundary probe | **3 tests passed**; assertions intentionally confirmed JWT/Basic leaks, duplicate-key leaks, and depth-triggered filter failure, while checking the exact F1/F3 and F4/F5 cases. Temporary file removed immediately. |
| Additional direct HTTP/log probes | F1 exact escaped keys sanitized at 4xx and 5xx; F3 sentinel suffix sanitized at 4xx and 5xx; realistic JWT/Basic leaked in 5xx logs; duplicate `apiKey`/`providerRef` leaked in both boundaries; bare OTP-like `code` value leaked in 4xx. |
| Large-input probes | 1 MB and 5 MB timings/RSS deltas shown above; 20 MB same-process probe took ~6.7 s and showed ~998 MB RSS growth (less suitable as an isolated multiplier; not used for the table). |
| Admin Web suite | **Not run**; no Admin Web files changed at this application SHA. The supplied 27-suite/188-test claim remains unverified. |
| Complete PostgreSQL suite | **Not run**; no inference from prior runs. |
| Live provider calls/credentials, production migration, deployment/activation, financial operations | **Not run / prohibited** |

The nine focused PostgreSQL suites were:

1. `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts`
2. `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`
3. `test/v1-notification-provider-configuration-01.integration.spec.ts`
4. `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`
5. `test/notification-reliability.integration.spec.ts`
6. `test/transfer-notification-producer-01.integration.spec.ts`
7. `test/v1-005-notification-delivery.integration.spec.ts`
8. `test/notification-migration-upgrade-01.integration.spec.ts`
9. `test/notification-registry.integration.spec.ts`

They cover F-01 historical disclosure; F-02–F-05 provider configuration, diagnostics, and authorization; reliability; delivery producer; and migration/registry regressions. All nine passed. The developer-reported total was **9 suites / 117 tests**; my independently selected nine required suites yielded **9 / 111**, so I do not certify the reported 117 as reproduced. Likewise, the reported 91 “redaction-adjacent” tests were not reproduced as a named grouping; the directly selected unit grouping above was 69 tests. The backend 209/2,140 claim was independently reproduced exactly.

## Separate outstanding matters

This code review does not resolve or independently re-open the prior decisions on:

- **R-01:** provider-reference rotation/cross-rotation correlation policy;
- **R-02:** `available_at` notification not-before behavior;
- **D-01/D-04:** compliance/governance decisions;
- monitoring and alerting, UNKNOWN/DEAD/QUARANTINED reconciliation/redrive, receipt retention/legal hold, operational runbooks, dark-launch controls, and other production prerequisites.

These remain **open/not demonstrated**, independently of the technical redaction failures. No current finding should be misrepresented as resolving or deciding those policies.

## Final disposition

The layered architecture fixes the exact F1 single-key, F3 sentinel, F4 truncation, and F5 ordinary-diagnostic cases exercised in report 15. It does **not** yet satisfy technical acceptance: realistic unquoted JWT/Basic Authorization credentials leak; lowercase JWT-shaped suffixes leak from key-less references; duplicate JSON properties can return earlier sensitive values verbatim; deep JSON can make the global exception filter throw; and a bare OTP-like `code` field is intentionally not redacted by the text path. The latter resource and bare-code risks are conditional, with no specific current production route established; the Authorization and duplicate-key leaks were reproduced through the existing 5xx log/4xx response boundary.

F-01 is **PASS for tested historical database/read protections**. R-03 and R-04 are **FAIL**. Overall technical security is **NO-GO** until the disclosure defects are addressed and boundary-tested, with depth/size handling also hardened. Operational readiness and production authorization remain **NO-GO** for their separate open prerequisites. This report alone is intended for the pinned Arena 4 branch.
