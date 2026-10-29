# Redaction confidentiality and availability hardening — `f00e0c9` — 2026-10-29

## Scope and disposition

This change hardens the shared error/log redaction boundary against credential disclosure and parser/scanner resource exhaustion. The implementation was developed against the exact requested baseline `f00e0c939dba632a3323f39750a8b3fe83ab4aec` and validated both there and on the active Arena session branch `arena/870f970d-monienaija`.

No provider calls or credentials, production migration, deployment, activation, accounting change, notification semantic change, or financial operation was performed. Migration 101 and provider configuration were not changed. Admin Web was not affected.

The task named `arena/8e59e188-monienaija` as pinned, while the active session branch is `arena/870f970d-monienaija`. The workspace routing requires the active session branch; this report records that discrepancy rather than claiming work was pushed to the other branch.

## Changed files

- `src/common/sensitive-data-redaction.ts` — bounded structured-text parser, fail-closed scanner, provider-reference suffix handling, credential and diagnostic policies, and guarded direct-object traversal.
- `test/report16-redaction-hardening.spec.ts` — permanent synthetic regressions for Authorization/Proxy-Authorization, provider-reference suffixes, duplicate JSON keys, malformed/deep/oversized inputs, exception-filter bodies/logs, stringified JSON, and `code` ambiguity.
- `test/sensitive-data-redaction-adversarial.spec.ts` — adversarial scanner compatibility and boundary regressions from the requested baseline.
- `test/http-exception-filter.spec.ts` — synthetic 4xx/5xx surface regressions; the Authorization prose case now uses an explicit `;` boundary so the preserved diagnostic is distinguishable from an unbounded header value.
- This report.

## Implementation and safety properties

1. **Structured JSON:** a bounded, span-preserving tokenizer processes each raw property occurrence (including duplicate keys), decodes escaped/mixed-case property names for matching, and preserves unchanged JSON formatting. Nested and doubly stringified JSON are processed recursively within one capped text-depth budget. It does not rely on `JSON.parse` object semantics that discard duplicate properties.
2. **Text and headers:** a bounded raw scanner handles sensitive key/value pairs in prose, quoted and unquoted values, mixed-case header names, and multiple fields. Recognized Authorization and Proxy-Authorization regions fail closed through an explicit safe boundary; credential portions are not partially retained. Known ordinary diagnostics remain readable when separated by safe delimiters.
3. **Provider references:** historical canonical `pvr1:` references remain preservable when complete and standalone. A reference followed by a credential-shaped suffix (JWT-like dotted, underscore/hyphen variants, long opaque suffixes, or synthetic secret markers) is removed as a region. Keyed provider-reference fields use stricter suffix handling than ordinary prose.
4. **Malformed/complex inputs:** parse/scan failure never returns the original structured input. If bounded raw sanitization cannot prove a safe result, output is the generic `[REDACTED]` message. The exception filter remains protected by the redaction function's no-throw boundary.
5. **Direct object traversal:** sensitive-key redaction now has depth/node guards, avoids eagerly materializing whole arrays/object-entry lists, and returns a generic redacted value when its budget is exceeded.

### Resource limits

- Total text input: **256 KiB**; larger input immediately yields `[REDACTED]`.
- JSON/object nesting: **32 levels**; textified JSON recursion: **12 levels**.
- JSON/object nodes: **12,000**.
- Text scanner operations: **1,000,000**; sensitive key matches: **2,048**.
- Key-less provider candidates: **1,024**; suffix lookahead: **8,192 characters**; joined suffix parts: **8**.
- Oversize/text-depth, direct-object, or raw-scanner budget exhaustion returns the generic message. When the structured parser hits a depth/node limit or malformed JSON, it may still return bounded raw-scanner output if that scan completes and establishes safe redaction; otherwise it returns `[REDACTED]`. No path returns unexamined input after parser/scan failure. Output assembly is linear in input size and bounded by the input cap.

A focused Node measurement against the built module used a maximum-size 262,144-character `apiKey=` value: **9.16 ms**, redacted output length **17**, and process RSS high-water increase of **6,176 KiB** over the post-module-load baseline (45,348 KiB baseline, 51,524 KiB peak). This is a process-level measurement, not a claim that all memory belongs to the scanner.

## Permanent reproductions

The new suite uses synthetic-only values and verifies direct redaction plus 4xx response and 5xx structured-log surfaces:

- Realistic Bearer JWT and Basic credentials; mixed-case `Authorization` / `Proxy-Authorization`; quoted/unquoted values and multiple fields.
- Canonical key-less provider references followed by dotted JWTs and dot-to-underscore/hyphen, tab, newline, and backslash variants.
- Duplicate sensitive JSON properties, escaped Unicode key spellings, and mixed-case spellings, including an unsafe first value followed by a safe duplicate.
- 1,800-level nested JSON and direct object graphs, malformed JSON, and input above the total-size cap.
- Doubly stringified JSON, while retaining parseable JSON at both layers.
- Diagnostic `code: 400` and known diagnostic codes remain readable; `codeHash`, recovery/transfer/challenge code families and non-diagnostic code values are redacted.

**Context-free code ambiguity:** values named `code` are treated as diagnostics only for recognized HTTP status/error codes and enumerated diagnostic strings. Other values are conservatively redacted. A bare numeric value in the HTTP range can also be an OTP, while a non-HTTP number can be a legitimate application diagnostic; without schema/context those meanings cannot be perfectly distinguished. The implementation does not claim otherwise.

## Validation evidence

### Exact requested baseline `f00e0c939dba632a3323f39750a8b3fe83ab4aec`

- TypeScript: `npx tsc --noEmit -p tsconfig.json` — passed.
- Build: `npm run build` — passed.
- ESLint and Prettier on all changed TypeScript files — passed.
- Focused redaction / exception-filter / historical-provider-reference / notification-log suites: **5 suites, 98 tests passed**.
- Full backend unit suite: **210 suites, 2,169 tests passed**.
- Focused embedded-PostgreSQL F-01/history, diagnostics, provider-configuration, delivery authorization, reliability, transfer-producer, delivery, registry, and migration-upgrade suites: **9 suites, 111 tests passed**.

### Active session branch `arena/870f970d-monienaija`

- TypeScript and Nest build — passed.
- Focused redaction, exception-filter, and adversarial scanner suites: **3 suites, 82 tests passed**.
- Full backend unit suite: **204 suites, 2,101 tests passed**.
- Available focused embedded-PostgreSQL notification diagnostics, migration-upgrade, registry, delivery, email, and inbox suites: **6 suites, 101 tests passed**.

The target baseline contains additional F-01/provider-reference and notification reliability/transfer-producer PostgreSQL suites that are not present on the earlier documentation branch; those suites were run against the exact target baseline as listed above. No PostgreSQL suite failed in the final runs.

## Residual risks and acceptance request

- Fail-closed fallback can replace an otherwise useful malformed/over-complex diagnostic with `[REDACTED]`; this is an intentional availability/readability trade-off to prevent disclosure and unbounded work.
- Unquoted values without an explicit delimiter may absorb trailing prose as part of a credential region. A safe delimiter (for example `;`) preserves trailing diagnostics. No partial credential is favored over speculative prose recovery.
- Bare numeric/code meanings remain inherently ambiguous without field schema or caller context.

**Request:** Arena 4, please independently review the parser/scanner and this report, verify that no original sensitive input can escape on parse/limit failures, and independently rerun the listed synthetic redaction and exception-filter probes. This request is a technical acceptance request only; it does not authorize provider or production activity.
