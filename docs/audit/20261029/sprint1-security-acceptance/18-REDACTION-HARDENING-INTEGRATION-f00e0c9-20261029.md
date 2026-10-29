# 18 — Redaction Confidentiality/Availability Hardening: Integration Record

- **Date:** 2026-10-29
- **Integration branch (pinned):** `arena/8e59e188-monienaija`
- **Baseline integrated SHA before this change:** `f00e0c939dba632a3323f39750a8b3fe83ab4aec`
- **Source implementation commit (Arena 4 branch `arena/870f970d-monienaija`):** `d12587e`
- **Source docs commit:** `3514342` (confirmed docs-only: 1-line fix inside report 17)
- **Source report:** `docs/audit/20261029/sprint1-security-acceptance/17-REDACTION-CONFIDENTIALITY-AVAILABILITY-HARDENING-f00e0c9-20261029.md` (at `d12587e`)
- **Arena 4 acceptance report of the baseline:** report 16 at `f14391e` (docs-only, +177 lines)

## 1. Ancestry verification (performed before any modification)

- `d12587e` parent chain: `f14391e` ← `d5699d1` ← `70cbc7d` ← `35aeda0` ← `507a099` ← `cfc0dc9`.
- `cfc0dc9` is the merge-base with this branch. **`f00e0c9` is NOT an ancestor of `d12587e`.**
- The Arena 4 branch tree is built on the older application base (79-line regex-era redaction
  module, 315 spec files). It never contained this branch's integration waves
  (`aef51dd`, `d59689e`, `f00e0c9` and the provider-config/disclosure/delivery-auth work).
- `git diff f00e0c9 d12587e` (tree-to-tree): 115 files, +3,473/−22,260 — the delta is dominated
  by application/test files **missing from their tree**, not by changes to them.

## 2. Integration method and rationale

A literal `git cherry-pick d12587e` was evaluated and **rejected**: the commit's patch is
computed against the 79-line old-base module and against spec files absent from their tree,
so it would conflict massively (module rewrite context) and add/add-collide on specs,
risking loss of this branch's report-13/14/15 coverage.

Report 17 states the implementation was **developed and validated against the exact baseline
`f00e0c9`** (their baseline validation: tsc/build/lint pass; full unit **210 suites / 2169
tests**; focused PG **9 suites / 111 tests**), then committed equivalently onto their divergent
branch. Independent evidence confirms the committed file contents are baseline-derived:

- Their module preserves this branch's architecture and naming (`TEXT_SENSITIVE_KEYS`,
  `PROVIDER_REF_KEYS`, layered text pipeline) and retains the report-15 shape-pattern fix
  `(?!\\["'])` verbatim.
- Their `test/sensitive-data-redaction-adversarial.spec.ts` is **assertion-identical** to the
  baseline version (verified by prettier-normalized diff: one typed-variable refinement,
  zero assertion changes; all 35 tests and titles match).
- Their `test/http-exception-filter.spec.ts` differs from baseline by exactly **one fixture
  character** (see §6).

Integration therefore used **file-level adoption of the four implementation files from
`d12587e`** into this branch's tree — semantically equivalent to cherry-picking the commit
content with the correct (f00e0c9-derived) base:

```
git checkout d12587e -- src/common/sensitive-data-redaction.ts \
  test/report16-redaction-hardening.spec.ts \
  test/sensitive-data-redaction-adversarial.spec.ts \
  test/http-exception-filter.spec.ts
```

All existing Arena 3 history is preserved (no rebase, no history rewrite, no force-push).
Sibling branches were fetched read-only and never modified. The Arena 4 report/docs commits
(`d12587e`'s report file, `f14391e`, `3514342`) remain canonical on their own branch and were
intentionally **not** duplicated into this application branch; this record references them by SHA.

## 3. Changed files (this integration)

| File | Change |
|---|---|
| `src/common/sensitive-data-redaction.ts` | Replaced 683-line layered scanner with the 971-line bounded, fail-closed hardening implementation (same public API). |
| `test/report16-redaction-hardening.spec.ts` | New (239 lines): bounded-redaction confidentiality/availability spec from `d12587e`. |
| `test/sensitive-data-redaction-adversarial.spec.ts` | Adopted their formatting-normalized version; assertion-identical to baseline (35 tests). |
| `test/http-exception-filter.spec.ts` | Adopted their version; one fixture adaptation documented in §6 (23 tests). |
| `docs/audit/20261029/sprint1-security-acceptance/18-REDACTION-HARDENING-INTEGRATION-f00e0c9-20261029.md` | This record. |

Public API is unchanged: `REDACTED_VALUE`, `redactSensitiveData`, `redactRecord`,
`redactSensitiveText`; canonical provider-ref regex unchanged
(`^pvr1:(robase|brevo|resend|external):[0-9a-f]{32}$`i). Consumers (GlobalExceptionFilter,
audit service, notification provider config, F-01 disclosure paths) required no changes.

## 4. Security review of the implementation (mission checklist)

Verified by direct source review of the adopted module plus executed tests:

1. **JWT/Basic authorization disclosure** — `authorization`/`proxyauthorization` values are
   consumed as a complete region to an explicit safe boundary (`findUnquotedFieldEnd`); no
   token-shape heuristic decides whether a recognized Authorization value is secret.
   Scheme follow-ups (`Bearer`/`Basic` + next run) are absorbed (`findGenericSecretEnd`).
2. **Key-less provider-ref credential suffixes** — `redactKeylessProviderRegions` +
   `inspectProviderSuffix`: a complete standalone canonical `pvr1:` token followed by a safe
   boundary is preserved; credential-shaped suffixes (JWT-dotted, ≥32-char opaque,
   ≥24-hex, `robe_`/`re_`/`xkeysib`/`xsmtpsib` markers, UPPER_SNAKE sentinels) remove the
   whole region. Bounded: 1,024 candidates, 8,192-char lookahead, 8 suffix parts.
3. **Duplicate JSON properties incl. unicode-escaped keys** — `JsonTextRedactor` is a
   span-preserving tokenizer that processes **every raw property occurrence** (duplicates are
   never collapsed), decodes `\uXXXX` in property names, and re-emits unchanged source slices
   byte-identically. The raw text scanner (`scanTextKey`) also decodes unicode escapes.
4. **Deeply nested JSON stack overflow** — no `JSON.parse` on untrusted input; tokenizer depth
   cap 32 (`bumpNode` throws), text recursion cap 12; direct-object traversal (`redactObjectValue`)
   has the same depth cap. Exhaustion → generic `[REDACTED]`, never a crash.
5. **Large JSON memory amplification** — total input cap 256 KiB (over-cap → `[REDACTED]`
   immediately), 12,000-node budget, 1,000,000 scanner-operation budget, 2,048 sensitive-key
   match cap. Their measured baseline: 262,144-char secret value → ~9 ms, +6 MiB RSS.
6. **Ambiguous `code` without destroying HTTP diagnostics** — values named `code` are readable
   only for recognized diagnostics: integers 100–599, the 21 enumerated HTTP error names
   (`SAFE_JSON_DIAGNOSTIC_CODES`), and `E_[A-Z0-9_]{1,32}` shapes; `statusCode`/`errorCode`/
   `requestId`/`traceId` etc. are safe diagnostic keys. All other `code` values redact
   conservatively (documented inherent ambiguity). The baseline F5 fidelity tests pass unchanged.
7. **Previously accepted R-03/R-04 protections** — the full 35-test adversarial matrix from
   reports 13/14/15 passes **assertion-identical** (quoted-value read-through, escaped-quote
   contexts, alternate separators, unicode keys, key suffix normalization, false-positive matrix).
8. **F-01 historical provider-ref sanitization** — `applyCredentialShapes` retains every
   historical shape pattern (`MNNPS1:`, `robe_`/`re_`, `xkeysib`/`xsmtpsib`, `pvr1:` attached
   suffix) including the report-15 `(?!\\["'])` boundary lookahead verbatim. The F-01 unit spec
   and sensitive-data-protection spec pass; the PG disclosure suite result is recorded in §7.

**Bounded processing + fail-closed:** every public entry wraps processing in try/catch and
returns `REDACTED_VALUE` on any failure; oversized input, depth/node/operation/match budget
exhaustion, unprovable raw-scan results, and ambiguous escaped-quote ownership all resolve to
the generic `[REDACTED]` — **no failure path returns original text and `redactSensitiveText`
never throws**, so `GlobalExceptionFilter` can neither crash nor leak on malformed input.
Malformed JSON-start input is offered to the separately bounded raw scanner and returns
sanitized text only when that scan provably completed.

## 5. Test-count discrepancy resolution (mission deliverable)

Report 17 recorded: target baseline **210 suites / 2169 tests** (unit) and focused PG
**9 / 111**, vs their active branch **204 / 2101** and PG **6 / 101**. Cause determined:

- **Missing files in their branch tree — not discovery, not configuration, not lost tests.**
  Exactly 12 spec files exist at `f00e0c9` but not at `d12587e`:
  - Unit-mode (6): `src/admin/admin-notification.controller.spec.ts`,
    `test/customer-compliance-route-policy.spec.ts`,
    `test/f01-historical-provider-ref-security.unit.spec.ts`,
    `test/notification-direct-security-logging.unit.spec.ts`,
    `test/notification-provider-config.unit.spec.ts`,
    `test/notification-reliability.unit.spec.ts`
    → 210 − 6 = **204 suites** on their branch; their 68-test delta comes from these files.
  - Integration-mode (6): `test/customer-compliance-authorization.integration.spec.ts`,
    `test/notification-reliability.integration.spec.ts`,
    `test/transfer-notification-producer-01.integration.spec.ts`,
    `test/v1-notification-provider-configuration-01.integration.spec.ts`,
    `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts`,
    `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`
    → their focused PG battery could only discover 6 of its 9 files on their branch (**6 / 101**);
    they re-ran the full 9 (**9 / 111**) against the exact `f00e0c9` baseline instead.
- **This integrated tree contains all 12 files plus their new report-16 spec** — no security or
  reliability test is lost. The full unit run on the integrated tree reproduces their baseline
  numbers exactly: **210 / 2169** (§7). The full PG run executes all 15 integration files.

## 6. Spec compatibility adjudication

- **Adversarial spec:** assertion-identical to baseline (prettier-normalized diff shows only
  line-wrap formatting and one `as { msg: string }` typing refinement). All report-13/14/15
  cases survive verbatim. Accepted as-is.
- **Filter spec:** exactly one substantive change — the fixture
  `"…authorization: Bearer BEARER_HTTP_SENTINEL_999 for request"` gained a `;` before
  `" for request"`. Reason: under the hardened fail-closed region semantics an **unquoted**
  Authorization credential absorbs trailing prose up to an explicit safe boundary (`,`, `;`,
  `}`, `]`, `)`, quotes, newline, next key:value), so the original fixture's
  `expect(logged).toContain('for request')` prose-preservation assertion is only satisfiable
  after a delimiter. All three assertions (sentinel absent, `[REDACTED]` present, trailing
  prose after delimiter readable) are retained; the security posture is **stricter**, not
  weaker — this matches their documented residual risk #3. Accepted as a documented trade-off;
  no security assertion was weakened to obtain green.
- No other committed spec (F-01 unit, sensitive-data-protection, notification provider config,
  production readiness, provider security, audit/outbox, admin controller) required any change:
  the module is API-compatible and passed the entire pre-existing suite (§7).

## 7. Verification results on the integrated tree (all executed in this environment)

Environment: `npm ci` from lockfile (979 packages), Node v22.22.3, embedded PostgreSQL 18.4
(fresh initdb, synthetic credentials `monienaija/monienaija-pw`, disposable `mn_it_*` databases).

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS (0 errors) |
| `npm run build` | PASS |
| ESLint — 4 adopted files | PASS (0 problems) |
| ESLint — repo-wide | 1,386 errors / 80 warnings vs **1,389 / 80 on pristine `f00e0c9`** (worktree-verified): integration introduced **zero** new lint errors and removed 3 pre-existing ones via spec reformatting. Repo-wide lint debt is pre-existing baseline noise. |
| Redaction-focused unit (adversarial, filter, report16-hardening, f01-unit, sensitive-data-protection) | **5/5 suites, 96/96 tests** |
| Full backend unit suite (`npm run test`) | **210/210 suites, 2169/2169 tests** — reproduces report 17's baseline numbers exactly |
| Admin Web `ts:check` | PASS |
| Admin Web tests | **27/27 suites, 188/188 tests** |
| Full PG integration (`PG_TEST_CONCURRENCY=1 node scripts/run-pg-integration-tests.js`, run id `r4bb19186d6ed`) | **9/9 batches, 125/125 integration files — all passed (runner exit 0, ~36 min)**. Includes every suite of report 17's focused 9-file battery (F-01 disclosure, provider-config-01, delivery-authorization, notification-reliability, transfer-producer-01, customer-compliance-authorization, hardening-09, migration-chain, notification-migration-upgrade-01). Per-batch jest totals are emitted per batch (tail-captured batches 8–9: 147/147 and 13/13); the runner aggregates pass/fail at batch/file level. |

## 8. Remaining limitations (carried from report 17, confirmed by review)

1. Fail-closed replacement trades some malformed-input diagnostic detail for a generic
   `[REDACTED]` message (availability of diagnostics, not of the service).
2. Unquoted header values without an explicit delimiter absorb trailing prose into the
   redacted region; a `;` (or other safe boundary) preserves it.
3. Bare numeric values remain inherently ambiguous; the `code` policy conservatively redacts
   unrecognized values.
4. `redactRecord` returns `{}` when the redacted payload is not a record (e.g. budget
   exhaustion) — callers already treat it as opaque scrubbed metadata.
5. Repo-wide ESLint debt (~1,386 pre-existing errors) is untouched by this mission.

## 9. Handoff

The integrated correction is committed to `arena/8e59e188-monienaija` on top of `f00e0c9`.
The exact new SHA is reported in the integration chat report for Arena 4 independent
acceptance. Technical security acceptance is **not** declared here.
