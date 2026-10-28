# Sprint 1 P0 — Final Independent Re-acceptance

**Review date:** 2026-10-28
**Reviewer:** Arena 4 independent follow-up
**Integration branch:** `arena/8e59e188-monienaija`
**Application SHA tested:** `56ee049ca4c04c0914e29508f5dd36c120603f0d`
**Integration documentation HEAD:** `b39a2efc7b25dfca3c5868f669cf13661e9570ce`
**Prior application SHA:** `5a5ad8a5e130da1dc598508914a0a14e48c8735f`
**Prior Arena 4 report:** `08-FINAL-INDEPENDENT-ACCEPTANCE-20261028.md` (Arena 4 tip `773c028620c5df693204d8cd53880f19300ad028`)
**Remediation record:** `docs/SPRINT1-P0-02-REMEDIATION-20261028.md`
**Overall recommendation:** **CONDITIONAL GO — technical P0 re-acceptance only; not production approval.**

## 1. Executive decision

I independently checked the exact application SHA, its ancestry and the P0-02 remediation diff; reran the backend and Admin Web gates; reproduced the sensitive-data sentinel checks against real HTTP and PostgreSQL; and reran the focused authorization/diagnostics integration battery.

**P0-02 is now accepted at the delivery-diagnostics response boundary.** The earlier real-HTTP/PostgreSQL reproduction returned the stored rendered message and raw provider error. On this target, the controller no longer selects `message`; it maps stored `last_error` to a closed set of fixed operational codes, `UNCLASSIFIED`, or `null`; and the real-PG HTTP sentinel regression tests passed. The Admin Web delivery table and inspector use `errorCode`, not message or raw provider error.

P0-01 and P0-03 remain at their prior technical verdicts: P0-01 **CONDITIONAL PASS**, P0-03 **PASS**. Their relevant behavior was unchanged in this remediation diff and their focused real-PG suites passed again. D-01/D-04 and the global case-number collision behavior remain open, exactly as documented in the prior report.

The repository's complete PostgreSQL suite did **not** complete in my independent rerun: the 1,800-second command limit was reached while a subsequent Jest batch was still running. Five complete batches reported 75 suites/1,775 tests passed; the next batch had begun but produced no final aggregate. I stopped the remaining child and disposable database after the timeout. The integration owner's report claims a complete 121-suite/2,319-test pass on this SHA; that claim is recorded as owner-supplied evidence, not as my independently completed full-suite result.

### Per-P0 verdicts

| Finding | Independent verdict | Basis and limit |
|---|---|---|
| **P0-01 — Compliance authorization** | **CONDITIONAL PASS** | Prior independent adversarial real-PG/HTTP probes and current focused suite remain valid; remediation diff did not alter compliance code. D-01/D-04, global-within-category access and assignment-scope decision remain unresolved. |
| **P0-02 — Notification delivery diagnostics** | **PASS** | Exact prior leak is removed from the admin delivery response; real-HTTP/PG SMS/EMAIL/PHONE sentinels, raw error mapping, authorization, filters/pagination and masking passed. No full-PG aggregate is claimed. |
| **P0-03 — Limit diagnostics** | **PASS** | Route/controller authorization and read-only boundary were unchanged; current focused real-PG limit diagnostics suite passed. |

**Overall: CONDITIONAL GO for technical P0 re-acceptance only.** Before treating Sprint 1 as unconditionally accepted, complete the full PostgreSQL regression suite and obtain the recorded product/security decisions for P0-01. This report does not approve production readiness, provider activation, deployment, or live notification delivery.

## 2. Provenance and scope

The integration ref was independently fetched and checked. At review time, `arena/8e59e188-monienaija` was at documentation HEAD `b39a2efc7b25dfca3c5868f669cf13661e9570ce`; its parent is the application SHA under test, `56ee049ca4c04c0914e29508f5dd36c120603f0d`. The application target descends from the prior reviewed application SHA `5a5ad8a5e130da1dc598508914a0a14e48c8735f`. The remediation is an application commit; the following documentation commit adds its verification record without changing application code.

The direct application diff `5a5ad8a..56ee049` contains **10 files, 404 insertions and 33 deletions**. I inspected the controller, controller tests, real-PG specs and Admin Web contract/surfaces. No compliance, limit, authorization catalogue/grant, provider configuration, migration, financial operation or production configuration was changed in this delta. No source branch was reset, rebased, force-pushed, or modified by this review.

Arena 2's distinct provider-configuration work was not included. The explicitly identified Arena 2 commit `1f6decdf96491d548e7cabecb7ff7ed18ef8d2d2` is not an ancestor of application SHA `56ee049`; the current Arena 2 ref observed during this review advanced to `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5` (parent `1f6decdf`, provider-status/audit/error-sanitization work). Neither commit is an ancestor of the review target and neither was merged or cherry-picked.

The review and test execution used an isolated detached worktree at the application SHA. The main checkout was not cleaned, staged, switched, or modified. This report is documentation-only and is committed only on the existing Arena 4 branch `arena/870f970d-monienaija`.

## 3. P0-02 — authorization and projection re-acceptance

### Authorization: PASS

`GET /api/v1/internal/notifications/deliveries` still invokes `requireFunction('notification.view_deliveries')` before parsing filters or executing either SQL query. The role/function matrix and route policy were not broadened by this fix. The focused real-PG/HTTP battery reconfirmed authorized access, 401/403 behavior, rejection of non-entitled workforce and customer/agent/aggregator/support identity shapes, and denial before database reads for missing entitlement. Invalid filter/query variants do not bypass the function check.

Pagination, filters, deterministic ordering, and the existing approved operational metadata remain available. PHONE recipient IDs remain masked (for example, `*******777`); the raw phone and delivery `destination` are not returned. No permission expansion was found.

### P0-02 leak: remediated and independently retested

The controller query no longer selects `notification_deliveries.message`. It reads `last_error` only to derive `errorCode`; the response object does not contain `message` or `lastError`. A fixed allowlist passes through known first-party operational codes; any other non-empty stored value becomes exactly `UNCLASSIFIED`; null or blank values become null. The response does not expose message preview, destination, or delivery payload.

The focused real-HTTP/PostgreSQL tests exercised the original reproduction and distinct sentinel values spanning SMS and EMAIL, SENT/FAILED/SKIPPED rows, a PHONE recipient, financial/transaction content, OTP-like content, recipient destinations, customer identifiers, payload metadata, and provider-credential-like/raw error strings. Assertions checked the **entire serialized response body**, not only selected fields. They verified:

- the exact prior reproduction text `Your funding of NGN 5,000.00 has been approved.` is absent;
- no message, `lastError`, destination, payload, or raw PHONE destination appears in delivery rows;
- arbitrary provider/error prose and provider-key-like sentinels are absent and classified as `UNCLASSIFIED`;
- fixed allowlisted codes remain fixed codes, and a successful row with no error maps to null;
- safe metadata, filters, pagination and PHONE masking remain intact.

The SQL still fetches `last_error` internally for classification; this is not a claim that the raw value was removed from database storage. The data-minimization guarantee accepted here is the admin delivery HTTP response and its UI, not server-side storage or direct database access.

### Admin Web and adjacent surface inspection

The notification delivery domain type no longer models `message` or raw `lastError`; it exposes `errorCode`. The notification-management delivery table and inspector no longer render a message preview or raw error. System Health's delivery table likewise renders `errorCode`. No alternate Admin Web delivery-detail endpoint or inspector source for the removed fields was found.

I separately checked adjacent surfaces and preserved their distinct contracts:

- The controlled test-send API is a separate route with fixed safe content and bounded `errorCode`; the Admin Web adapter maps the optional rendered-message/error fields to null and does not populate them from provider prose.
- Provider-status diagnostics are separate and display masked fingerprints, not provider destinations or credentials.
- The generic outbox route remains separately gated by `outbox.view`. Its notification failure value is written as the fixed `NOTIFICATION_DISPATCH_FAILED` code; the rendered delivery message is created later and is not in that outbox payload. This adjacent route was not broadened or changed by P0-02. Its distinct payload/visibility policy is not a blanket acceptance of all outbox data.
- Notification registry/template governance and customer self-inbox are separate surfaces, not alternate Admin Web delivery diagnostics.

## 4. P0-01 and P0-03 status

The application diff since `5a5ad8a` does not modify the compliance or limit authorization implementations, authorization role/function seeds, or audit visibility logic. Their earlier independent source review and probes therefore remain applicable. Current focused real-PG execution again included the compliance authorization spec and limit diagnostics spec (as well as the existing Sprint 1 notification authorization spec).

- **P0-01 — CONDITIONAL PASS:** the workforce guard, active role/function/access-type intersection, category split, customer/case binding, session-derived audit actors, audit/dashboard scoping and fail-closed category handling were not altered. Earlier real-HTTP/PG tests verified denied-role behavior, live grant revocation, audit rollback, category separation and cross-customer behavior. However, valid function holders remain global within their permitted case category; worker-to-customer assignment is not checked. D-01 (including per-action/read grants and assignment scope) and D-04 (fraud/category taxonomy and future change policy) remain open. A real case-number duplicate across customers still produces the documented 409 existence oracle. These are policy/acceptance constraints, not silently treated as fixed by this P0-02 patch.
- **P0-03 — PASS:** exact limit diagnostics route policy and the controller's independent `limit.view` check remain in place before filter/query processing. Diagnostic GETs remain read-only; release remains separately gated and is not conferred by `limit.view`. The focused real-PG limit diagnostics tests passed.

For the full role/function matrix, 11-route compliance map, and detailed assignment/case-number/audit/UX risk analysis, see §§3, 5 and 7 of the prior report `08-FINAL-INDEPENDENT-ACCEPTANCE-20261028.md`.

## 5. Independent verification executed

All application checks below ran against exact target SHA `56ee049ca4c04c0914e29508f5dd36c120603f0d` in `/tmp/monienaija-reaccept-56ee`. Backend and Admin Web dependencies were installed from lockfiles. The embedded local PostgreSQL instance was disposable and was stopped after tests.

| Gate | Result |
|---|---|
| Backend unit suite: `./node_modules/.bin/jest --runInBand` | **203 suites / 2,044 tests passed** |
| Backend production build: `npm run build` | Passed |
| Backend TypeScript: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | Passed |
| Admin Web suite: `npm test -- --runInBand` | **26 suites / 181 tests passed** |
| Admin Web TypeScript: `npm run ts:check` | Passed |
| Admin Web production build: `npm run build` | Passed; Vite emitted its CJS API deprecation and >500 kB chunk advisories only |
| Focused real-HTTP/PostgreSQL: compliance authorization, Sprint 1 notification delivery authorization, admin notification diagnostics hardening, limit diagnostics | **4 suites / 75 tests passed** |

The focused PG run covered the P0-02 real-response sentinels and original reproduction, P0-02 authorization and safe projection, plus the unchanged P0-01 and P0-03 targeted controls. An expected injected audit-failure message was logged by the passing compliance rollback test; it was not a suite failure. Other expected test-generated database/diagnostic errors were not interpreted as failures absent a failing test.

### Complete PostgreSQL suite: attempted, not independently completed

I ran `PG_TEST_CONCURRENCY=1 PG_TEST_RUN_ID=ar4full02 node scripts/run-pg-integration-tests.js` against the disposable embedded PostgreSQL instance. The tool's 1,800-second limit expired before a runner-level final result. The captured output contained five completed 15-file batches with summaries of **634, 307, 362, 237 and 235 passing tests** respectively: 75 suites / 1,775 tests reported passed across those completed batches. Output then showed a subsequent Jest batch executing, but there was no final result for that batch or the remaining batches. Its child process was terminated after the tool timeout and the database was stopped. **This was not a complete suite pass; no overall count, zero-failure aggregate, or completion claim is made.**

The integration remediation record reports an owner-executed complete sequential PostgreSQL run of 121 files / 2,319 tests. That is useful corroborating owner evidence, but it does not substitute for my timed-out independent full-suite run. The full suite remains an explicit condition before unconditional acceptance.

## 6. Outstanding decisions, caveats, and production boundary

| Item | Status / required treatment |
|---|---|
| D-01 — compliance role/action and assignment scope | Open. Product/Security must decide whether access is global within category or constrained by worker/team/customer assignment, and whether a separate read-only function is required. P0-01 remains conditional until recorded. |
| D-04 — fraud/category taxonomy | Open. Current explicit category lists fail closed for unknown categories; obtain owner ratification and approved future-category process. |
| Worker-to-customer assignment | Not implemented. If required by D-01, enforce assignment on list and every case/child query before acceptance under that policy. |
| Case-number 409 oracle | Unchanged. Cross-customer duplicate case number yields a global conflict signal. Obtain an approved identifier/uniqueness contract; do not expose case details. |
| Scoped audit visibility and compliance UX | Prior findings remain: generic audit filters restricted compliance records, while a dedicated approved scoped audit surface and access-type-aware UI remain follow-up. Backend authorization is authoritative. |
| Notification dark launch | No live SMS/email credentials or deliveries were used; no provider activation, worker activation, or deployment was performed. No production notification approval is implied. |
| Product constraints | Backend/Admin Web before mobile; configurable SMS/email templates; no sensitive transfer credentials in beneficiary notifications; no automatic expired C2C disposition absent explicit decision; notification changes require independent approval/MFA; manual retry remains deferred; no production notification activation. All remain in force. |
| Production readiness | **Not assessed / not approved.** No production settings, infrastructure, database, migrations, live financial transactions, external provider credentials, customer operations or deployment were used. |

## 7. Required next steps

1. Complete the full sequential PostgreSQL integration suite on this exact application SHA (or a later reviewed SHA) and retain the runner's final aggregate/log. Do not infer a pass from partial batches or the owner-reported run.
2. Record Product/Security outcomes for D-01 and D-04. If assignment scope is required, implement and retest the full list/detail/child-resource boundary.
3. Resolve and document the case-number collision policy; review the separate scoped audit and Admin UX follow-ups before broad enablement.
4. Keep notification delivery dark-launched. Any provider configuration, test-send, activation, retry, or production work requires its separate approvals; this acceptance did not authorize it.

## 8. Documentation scope and branch handling

This document is an independent acceptance artifact only, stored under `docs/audit/20261028/sprint1-security-acceptance/`. No application implementation was altered. It is committed/pushed only to the existing Arena 4 branch `arena/870f970d-monienaija`, based on its verified remote tip `773c028620c5df693204d8cd53880f19300ad028`. No integration, main, or peer branch was modified; no reset, rebase, force-push, or history rewrite was performed. The exact documentation commit and remote verification are reported with the delivery summary.
