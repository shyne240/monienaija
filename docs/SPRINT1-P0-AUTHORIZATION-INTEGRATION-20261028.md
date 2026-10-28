# Sprint 1 — P0 Authorization Fixes: Integration Record & Arena 4 Handoff

**Date:** 2026-10-28
**Integration vehicle branch:** `arena/8e59e188-monienaija` (pinned session branch — see §1.1)
**Integrated application HEAD:** `5a5ad8a5e130da1dc598508914a0a14e48c8735f` (application); this document is the docs-only commit on top of it
**Audited shared baseline:** `2fe5a2e9c882fe718370e582e13eb539cde8ca74` (docs/audit/20261028 — audit v2; itself a docs-only fast-forward over the ARENA 3 notification-closure head `d93328d`, whose final application SHA was `73eb1ca`)
**Status:** integrated and regression-verified. **NOT accepted** — independent Arena 4 security acceptance is required (§8).

---

## 1. Commit ancestry (exact)

### 1.1 Branch-name note

The mission asked for a new branch `arena/sprint1-p0-integration` created from `2fe5a2e`. The integration agent's session is platform-locked to the pinned branch `arena/8e59e188-monienaija` (creating/pushing any other branch is prohibited, and that branch already contained the Arena 3 fix directly on top of `2fe5a2e`). The integration was therefore performed **on the pinned branch**, which yields identical integrated content. To materialize the requested name without rewriting anything:

```
git fetch origin arena/8e59e188-monienaija
git branch arena/sprint1-p0-integration <`5a5ad8a5e130da1dc598508914a0a14e48c8735f` (application); this document is the docs-only commit on top of it_SHA>   # or: git push origin <sha>:refs/heads/arena/sprint1-p0-integration
```

### 1.2 The three P0 implementation commits (all verified as remote branch tips at integration time)

| Arena | P0 (audit finding) | Implementation SHA | Source branch | Relationship to baseline |
|---|---|---|---|---|
| 1 | F-01 (+F-04 server-side category isolation) — customer compliance case authorization | `22d3ec8254f8e641c0ae4d74c4f905858b417271` | `arena/92fd33dd-monienaija` | single fix commit directly on `2fe5a2e` |
| 2 | F-02 — notification delivery listing authorization | `cdf52030f0cae09f169a1fb333e9292f4d74f135` | `arena/ea070127-monienaija` | single fix commit directly on `2fe5a2e` |
| 3 | F-03 (P0-03) — limit diagnostics authorization | `a7898e20860c721acfcb0fd192ceb980c37f3b9f` | `arena/8e59e188-monienaija` | single fix commit directly on `2fe5a2e`; was already the pinned-branch tip |

### 1.3 Integration topology (all merges `--no-ff`; no reset, rebase, force-push, or history rewrite; all existing branches preserved)

```
2fe5a2e (audited baseline)
├── 22d3ec8 (A1) ──► bebd7bd  merge: integrate ARENA 1 customer compliance authorization
├── cdf5203 (A2) ──► 5a5ad8a  merge: integrate ARENA 2 notification delivery authorization
└── a7898e2 (A3, direct on pinned branch)
Integrated application HEAD: 5a5ad8a
This document:               the docs-only commit adding this file (see `git log -- docs/SPRINT1-P0-AUTHORIZATION-INTEGRATION-20261028.md`) (docs-only, on top of 5a5ad8a)
```

**Merge conflicts: NONE.** Both merges applied cleanly (git reported zero conflicted paths). The only file touched by two arenas was `src/authorization/route-policy-registry.ts` (A1 compliance entries near line 200; A3 limit-diagnostics entries near line 749) — disjoint regions, auto-merged; both blocks were inspected post-merge and are intact, and the compliance entry correctly precedes the generic `/api/v1/customers/` fallback (line 244).

## 2. Files changed vs baseline (`git diff --name-only 2fe5a2e..<HEAD>`)

32 files = A1 (22) + A2 (6) + A3 (5) − 1 shared (`route-policy-registry.ts`).

- **A1 (backend only, by design):** `src/customer-compliance/*` (new `customer-compliance-access.guard.ts` + `customer-compliance-access.ts`; controller, service, module, types, 5 DTOs), `src/authorization/route-policy-registry.ts`, `src/dashboard/{dashboard-widget-data.service.ts,dashboard.controller.ts,dashboard.module.ts}`, `src/maturity/maturity.service.ts`, `src/operations/audit.service.ts`, `src/policy/capability-policy-source-readers.ts`, 3 test files, `docs/ARENA1-CUSTOMER-COMPLIANCE-AUTHORIZATION-20261028.md`.
- **A2:** `src/admin/admin-notification.controller.ts` (+ new `.spec.ts`), `apps/admin-web/src/screens/authenticated/SystemHealthScreen.tsx`, `apps/admin-web/__tests__/notification-management.test.tsx`, `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` (updated), `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts` (new).
- **A3:** `src/authorization/route-policy-registry.ts`, `src/limit-catalog/limit-operations.controller.ts`, `src/capability-registry/capability.seed.ts` (descriptions only), `test/v1-limit-05-diagnostics.integration.spec.ts`, `apps/admin-web/src/screens/authenticated/LimitAssignmentScreen.tsx` (notice text only).

**Unrelated-surface verification (instruction 8):** `git diff --name-only 2fe5a2e..HEAD` contains **no** migration, no `src/config`/environment, no `.env*`, no secrets, no authorization-catalogue seed, no financial/ledger/transaction logic, and no product-catalogue or funding controller files. The only seed file touched is `capability.seed.ts` (two capability *description strings* updated by A3 to state the enforced contract).

## 3. Combined security review (instruction 5 — no permission expansion)

Post-merge inspection of the combined authorization surfaces found **no unintended expansion and no regression**:

1. **Authorization catalogue:** unchanged — no new functions, roles, or grants were introduced by any arena; all three fixes enforce *existing* catalogue functions (`compliance.manage_case`, `risk_fraud.manage_fraud_case`, `notification.view_deliveries`, `limit.view`) with existing grants.
2. **Route policies:** three disjoint additions/retentions, each strictly narrowing:
   - compliance-cases regex entry (WORKFORCE_SESSION, OPERATOR/PRIVILEGED only, customer SELF, dedicated `customer-compliance-case` resource) ordered **before** the generic customer fallback;
   - exact-path GET `limit-usages`/`limit-reservations` entries declaring `requiredFunctions: ['limit.view']` AND the type allowlist, ordered before the generic `limit-` prefix; the prefix entry itself unchanged;
   - A2 changed no route policy (delivery listing keeps its existing policy; enforcement moved into the controller via audited `requireFunction`).
3. **Controller guards:** A1 adds a class-level DB-backed guard (function × access-type intersection against *live* role/function grants; GET needs VIEW|EXECUTE, mutation needs EXECUTE; INITIATE/APPROVE alone grant nothing; OPERATOR/PRIVILEGED only — SERVICE/SUPPORT/CUSTOMER/AGENT/AGGREGATOR denied). A2 replaces the workforce-type-only check on `GET /internal/notifications/deliveries` with audited `AuthorizationService.requireFunction('notification.view_deliveries', …, ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED'])` (type allowlist AND-combined, never replaced). A3 AND-combines the diagnostics type allowlist with `limit.view` (guard declared-gate + authoritative controller check). The `POST limit-reservation-recovery/release` PRIVILEGED-only mutation gate is unchanged and not conflated with reads.
4. **Phone recipient masking (A2):** `redactRecipientId` masks PHONE destinations and emails, preserves only opaque CUSTOMER/AGENT UUIDs; raw destination values are never projected; `PHONE` added to the recipient-type filter set.
5. **Compliance category binding (A1):** explicit allowlists — `compliance.manage_case` → 8 non-fraud categories; `risk_fraud.manage_fraud_case` → `FRAUD` only; union only with two separately active grants; unknown/future categories fail closed (implements V1 Product Owner Decisions 8–9).
6. **Principal-derived audit attribution (A1):** DTO `actor`/`uploadedBy` accepted for wire compatibility but ignored; validated workforce `principalId` is authoritative for case, child, history, and business-audit actors; audit writes are transactional with the business change (failure rolls back the mutation — PG failure-injection tested).
7. **Audit-surface filtering (A1):** `AuditService.list()` hides restricted case-related records and `COMPLIANCE_`-prefixed A4 policy-decision facts from generic `/internal/audit` and the dashboard audit-trail widget (filter-before-limit; records never deleted/rewritten; maturity consumer retains count-only all-events read; no query parameter can opt in).
8. **Admin Web gates:** consistent with backend — SystemHealthScreen deliveries gate mirrors `notification.view_deliveries` (A2); LimitAssignmentScreen diagnostics gate mirrors `limit.view` (A3, already matching; stale "backend only checks type" notice updated); compliance screens intentionally untouched by A1 (their client-side category filters are display-only now that the server returns only authorized categories; the stale Risk/Fraud "no backend isolation" warning revision is flagged as Admin-owner work in the A1 doc §5).
9. **limit.view protection (A3):** intact post-merge — exact-path entries + controller check both present; query parameters cannot influence policy matching (`resolve()` strips query strings before matching).

## 4. Test matrix — executed (all counts from the integrator's own execution on `5a5ad8a`)

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Backend production build | `npm run build` | ✅ clean |
| 2 | Backend TypeScript check | `npx tsc --noEmit -p tsconfig.json` | ✅ clean |
| 3 | **Complete backend unit suite** | `npm run test` | ✅ **203/203 suites · 2042/2042 tests · 0 failures** (baseline 201/2019 + A1 route-policy spec + A2 controller spec + their added tests) |
| 4 | Admin Web TypeScript check | `cd apps/admin-web && npm run ts:check` | ✅ clean |
| 5 | **Complete Admin Web suite** | `cd apps/admin-web && npm test` | ✅ **26/26 suites · 181/181 tests · 0 failures** (+2 from A2) |
| 6 | Admin Web production build | `cd apps/admin-web && npm run build` | ✅ built |
| 7 | **Targeted P0-surface real-PG verification (instruction 7)** | `NODE_ENV=test PG_TEST_RUN_ID=s1p0targ npx jest --config jest.integration.config.js --runInBand <4 paths>` | ✅ **4/4 suites · 74/74 tests** — `customer-compliance-authorization.integration.spec.ts` (21 real-HTTP+PG compliance tests: routes, both category directions, multiple grants, role/principal denial incl. simulated SERVICE/SUPPORT/CUSTOMER/AGENT/AGGREGATOR, customer/case mismatch 404s, real sessions, grant revocation, VIEW/EXECUTE/INITIATE/APPROVE, spoofed-actor rejection, dashboard/audit alternate surfaces, concurrency, transactional rollback), `v1-sprint1-notification-delivery-authorization.integration.spec.ts` (positive/negative `notification.view_deliveries`, masking, filters), `v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` (updated diagnostics contract), `v1-limit-05-diagnostics.integration.spec.ts` (13/13 incl. new 02b function-less 403 FUNCTION_MISSING and 02c query/route-variant bypass probes) |
| 8 | **Complete PostgreSQL integration suite (all files, sequential)** | `PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=s1p0full node scripts/run-pg-integration-tests.js` | ✅ **121/121 files · 2318/2318 tests · 0 failures** — runner verdict: `=== PG integration suite: 9 batch(es), 121 files, concurrency=1 — all passed ===` (run id `s1p0full`, log `full-pg-sprint1-integration.log`, gitignored). 121 files = the 119-file integrated baseline + A1's `customer-compliance-authorization` + A2's `v1-sprint1-notification-delivery-authorization`.

| Batch | Files | Tests | Failures |
|---|---|---|---|
| 1/9 | 15 | 634/634 | 0 |
| 2/9 | 15 | 307/307 | 0 |
| 3/9 | 15 | 362/362 | 0 |
| 4/9 | 15 | 237/237 | 0 |
| 5/9 | 15 | 235/235 | 0 |
| 6/9 | 15 | 224/224 | 0 |
| 7/9 | 15 | 152/152 | 0 |
| 8/9 | 15 | 154/154 | 0 |
| 9/9 | 1 | 13/13 | 0 |
| **Total** | **121** | **2318/2318** | **0** | |

**Unexecuted suites:** none withheld by choice — gates 1–8 are the complete backend/admin-web/PG batteries of this repository. Explicitly **not** claimed (unchanged from the arena reports): browser UAT (no browser automation available), live production provider delivery (SMS/EMAIL test doubles only), production migration execution, and any deployment.

## 5. Preserved documented limitations (instruction 9 — NOT resolved, carried forward verbatim)

1. **D-01 (Product + Security, open):** exact workforce roles/functions and per-subresource read/write entitlements for compliance cases; whether an independent read-only capability is needed; whether workforce access requires customer/team/case assignment. The interim `VIEW`-grant-as-read-only interpretation is NOT an approved grant.
2. **D-04 (Compliance Product + Security, open):** full case-category taxonomy and permitted non-fraud mapping; future categories remain denied by default; AML/SANCTIONS overlap would require an explicit additional function, never a silent broadening of the fraud function.
3. **Missing per-worker customer assignments:** a holder of an applicable compliance function can access that category for **any** valid customer ID; URL-customer/case binding prevents cross-customer case substitution but is NOT an assigned-customer policy. Do not describe this as closure of D-01.
4. **Global case-number collision review:** caller-supplied case numbers remain globally unique; a 409 collision can reveal that a chosen number is in use (across categories/customers). Requires an approved identifier/API policy; unchanged.
5. Generic audit consumers lose visibility of restricted case-related entries until an approved scoped audit surface exists (stored records intact).
6. Admin-side compliance UX (stale Risk/Fraud warning revision, access-type-aware action UI, possible case-workflow UI — F-06) remains Arena 2/Admin-owner follow-up.
7. From the notification closure (still true): no live provider delivery evidence; EMAIL registry-disabled for all events (dark launch); notification workers not activated; `cash_to_cash.claimed/.expired` have no outbox emitters; manual notification retry remains deferred by V1 requirement.

## 6. Remaining risks

- **R1:** the RuntimeAccessGuard's blanket `allowedPrincipalTypes` enforcement for WORKFORCE_SESSION routes remains a recorded defense-in-depth recommendation (V1-HARDEN-01 Part D); only *declared* required* gates are enforced guard-level. All three P0 fixes therefore rely on (and ship) authoritative controller-level checks — verified, but future controllers must keep the same discipline.
- **R2:** `limit.view`-holding legacy `SERVICE`-type principals remain possible in the type allowlist (denied without the grant); whether SERVICE should be grantable at all is catalogue governance.
- **R3:** compliance audit filtering hides restricted records even from authorized workers on generic views until a scoped audit read API is approved (A1 §4).
- **R4:** integration testing proves the merged tree on the embedded-PG harness; it does not prove production configuration, migrations ordering on a live DB, or provider behavior.

## 7. What changed for consumers (integration dependencies)

- Admin Web compliance screens: server now returns only authorized categories; client filters are display-only; 403 must be handled without inferring hidden-case existence; scoped misses return indistinguishable 404s.
- Notification delivery list consumers: require `notification.view_deliveries`; `recipientId` values are redacted (PHONE/email masked); `PHONE` is a valid recipientType filter.
- Limit diagnostics consumers: require `limit.view` in addition to workforce type; reservation release endpoint contract unchanged.
- Audit consumers: restricted case-related records and `COMPLIANCE_*` policy facts are filtered from generic list views (count-only maturity consumer unaffected).

## 8. Arena 4 — independent security acceptance handoff

**Do not treat Sprint 1 as accepted until Arena 4 independently verifies.** Suggested procedure (independent checkout, do not trust this document's claims):

1. `git fetch origin arena/8e59e188-monienaija` and check out `5a5ad8a5e130da1dc598508914a0a14e48c8735f` (application); this document is the docs-only commit on top of it (or the branch tip if later docs-only commits exist — confirm the application tree equals `5a5ad8a`'s tree for source files).
2. Verify ancestry: `git merge-base --is-ancestor {22d3ec8,cdf5203,a7898e2,2fe5a2e} HEAD` — all four must be ancestors; verify branch tips on origin still equal the three implementation SHAs (nothing rewritten).
3. Re-run gates 1–8 of §4 (embedded PG: `node scripts/embedded-pg.js`; env: `npm ci && (cd apps/admin-web && npm install) && node scripts/prepare-pg-test-env.js`).
4. Independent adversarial probes (real HTTP + PG), at minimum:
   - compliance: workforce principal with `kyc.view` but no compliance function → 403; `compliance.manage_case` VIEW-only grant → GET allowed, PATCH/comment/evidence/assignment → 403; fraud function holder → KYC category 404/403 per contract; non-fraud holder → FRAUD 404-equivalent; wrong customer/case pair → same 404 as nonexistent; spoofed `actor` in body ignored; generic `/internal/audit` shows no restricted case records or `COMPLIANCE_*` facts.
   - notifications: deliveries without `notification.view_deliveries` → 403 FUNCTION_MISSING; with → 200 and PHONE/email recipients masked; raw destination never present in any projection.
   - limits: type-permitted workforce without `limit.view` → 403 on both GETs incl. query-filter variants; holder → 200; release POST still PRIVILEGED-only.
5. Confirm §2's unrelated-surface claim independently (`git diff --name-only 2fe5a2e..HEAD`).
6. Record acceptance/rejection with exact SHAs and run outputs; only Arena 4 (or the product owner) may declare Sprint 1 accepted.

## 9. Remote verification record

- Application merges pushed: `a7898e2..5a5ad8a` on `origin/arena/8e59e188-monienaija` **before** this document was committed; remote tip verified equal to local HEAD at push time. The complete PG regression (gate 8) executed on the exact pushed application tree (`5a5ad8a`, clean working tree during the run).
- This document is a docs-only commit on top of `5a5ad8a`; no source file changed after the regression run.
- Source branches preserved untouched: `arena/92fd33dd-monienaija` tip `22d3ec8…`, `arena/ea070127-monienaija` tip `cdf5203…` (verified via `git ls-remote` at integration start). No reset, rebase, force-push, cherry-pick, or history rewrite anywhere; `main` untouched.
- Post-push verification (HEAD == origin tip, clean tree, ancestry of all three implementation SHAs) recorded in the mission log at push time.
