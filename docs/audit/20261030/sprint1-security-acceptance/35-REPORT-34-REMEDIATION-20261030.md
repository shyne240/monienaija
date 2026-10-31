# Report 34 remediation — HEAD method parity (H-01-R1), audit least privilege (H-01-R2), readiness side-effect correction (R-01)

**Date:** 2026-10-30
**Branch:** `integration/main-backend-frontend-20261030`
**Starting commit (Report 34 pinned target):** `0c828eada712c76b1a0ff9760e145248f386e788`
**Report remediated:** `docs/audit/20261030/sprint1-security-acceptance/34-INTEGRATION-0C828EA-REPORT33-INDEPENDENT-REACCEPTANCE-20261030.md`

Scope: authorization policy, the explicit SUPPORT audit exception, authorization tests and documentation accuracy. No frontend, no mobile, no migrations, no financial business rules, no ledger/posting/fee/balance logic, no provider activation, no deploy, no merge into `main`, no Report 30 implementation, no readiness decoupling.

---

## 1. Findings closed

| Report 34 finding | Status |
|---|---|
| **H-01-R1** — `HEAD` bypasses the new internal operational function gates (resolved through the generic, un-gated `/internal/*` policy) | **Closed.** `HEAD` now resolves through the `GET` policy for every route in the application, at one choke point. |
| **H-01-R2** — `GET /internal/audit` declared no function gate, so every workforce type (incl. OPERATIONS without `audit.view`) was admitted | **Closed.** The route now requires `audit.view`; the approved SUPPORT exception is preserved as an explicit, narrow, per-route exemption. |
| **R-01** — remediation report overstated readiness as strictly read-only | **Corrected.** Documentation now states the operation is *financially* read-only but writes an operational duration metric. Behaviour unchanged; no decoupling implemented. |
| Requirement 4 — other GET-backed endpoints with the same alias pattern | **Reviewed; no second bypass existed.** One global fix covers them all. |

---

## 2. H-01-R1 — HEAD must never receive weaker authorization than GET

### 2.1 Root cause

`RoutePolicyRegistry.resolve()` matched policies by an exact `"<METHOD> <path>"` key. Only `GET` entries exist, so a `HEAD` request matched nothing and fell through to the generic `/api/v1/internal/*` branch — `allowedPrincipalTypes: [SUPPORT, OPERATOR, SERVICE, PRIVILEGED]`, **no** `requiredFunctions`. Fastify serves the matching GET handler for `HEAD` (default `exposeHeadRoutes: true`) and suppresses only the body, so a SUPPORT session could execute the readiness/deployment/configuration/version handlers through `HEAD` while the `GET` path denied it. `ProductionController` has no second check, so those four handlers were directly reachable; `OperationsController` still denied SUPPORT via its own `requireFunction` calls, which is why the gap was inconsistent rather than uniformly exploitable.

### 2.2 Fix — one normalization, applied to every matching condition

`src/authorization/route-policy-registry.ts`:

```ts
const method = input.method.toUpperCase();
const lookedUpMethod = method === 'HEAD' ? 'GET' : method;
```

* `PUBLIC_ROUTES` lookup, the `INTERNAL_OPERATIONAL_ROUTE_POLICIES` lookup and the audit branch all use `lookedUpMethod`.
* **All 36 method comparisons in the matcher now use `lookedUpMethod`**, including the read-versus-write discrimination inside the aggregator, agent-class and outlet/terminal branches (`lookedUpMethod === 'GET' ? read policy : write policy`). Without this, `HEAD` would have been treated as a *write* in those branches — stricter, but inconsistent with GET; with it, `HEAD` receives exactly the GET policy.
* `action` still records the **real** request method (`HEAD:/api/v1/internal/readiness`) so audit records remain accurate.
* Fastify never routes `HEAD` to a POST/PUT/PATCH/DELETE handler, so non-GET-only routes are unaffected.

This is a pure restriction: no route gains reach, and the alias can no longer diverge from GET anywhere in the application — not just on `/internal`.

### 2.3 Requirement 4 — review of the rest of the surface

| Reviewed | Result |
|---|---|
| `RuntimeAccessGuard` (gate construction, read-only principal check) | Only method-aware logic outside the registry. `SAFE_HTTP_METHODS = [GET, HEAD, OPTIONS]` already treats HEAD as a read; correct and unchanged. The gate now also forwards the audit exemption (§3). |
| `src/customer-compliance/customer-compliance-access.guard.ts` | Treated `HEAD` as a read (`['GET','HEAD'].includes(...)`) — already consistent with GET; no bypass (Fastify cannot route HEAD to a mutating handler). Unchanged. |
| Controllers | None performs a method-conditional authorization decision (`grep` for `.method` in `src/**/*.controller.ts`: no hits). |
| `src/production/http-security.ts` | `CORS_ALLOWED_METHODS` omits HEAD — a browser-preflight allow-list, not server-side authorization. Not an authorization bypass; unchanged (adding HEAD there would be a permission-broadening change with no security benefit). |
| Everything else GET-backed (`/customers/me/*`, `/wallets`, `/deposits`, `/ledger`, `/agents/*`, `/health`, …) | Covered automatically by the global normalization; asserted by the new registry-parity test over 20 representative paths. |

**No second HEAD-style bypass found. No permissions broadened.**

---

## 3. H-01-R2 — audit requires `audit.view`, with the approved SUPPORT exception

The previous policy declared only a principal-type allow-list, so OPERATIONS (which holds `metrics.view`, `diagnostics.view` and `outbox.view` but **not** `audit.view`) was admitted to the generic audit listing.

### 3.1 Policy

`/api/v1/internal/audit` now declares:

```ts
allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
requiredFunctions: ['audit.view'],
requiredFunctionsExemptPrincipalTypes: ['SUPPORT'],
```

* **SUPPORT** — preserved exactly as approved: SUPPORT is not catalogue-governed and holds no function codes, so the exemption keeps its documented, tested audit read.
* **OPERATOR / SERVICE / PRIVILEGED** — must hold `audit.view` (catalogue: SUPER_ADMIN, FINANCE_AUDITOR). OPERATIONS is denied.
* **CUSTOMER / AGENT / AGGREGATOR** — unchanged: excluded by principal type.
* The controller-level `notification.provider.view` filter for provider-config audit rows is **unchanged** and is still exercised by a real SUPPORT session (§6).

### 3.2 Mechanism (smallest change that supports a real exception)

| File | Change |
|---|---|
| `src/authorization/authorization.types.ts` | New optional `AuthorizationPolicy.requiredFunctionsExemptPrincipalTypes` — per-route, per-type exemption from the **function** gate only. Never relaxes principal type, scopes, roles, audience, assurance or customer/agent/aggregator scoping. Default (absent) = no exemption. |
| `src/authorization/authorization.service.ts` | `evaluate()` skips the `requiredFunctions` check when the principal's type is listed in that field. It is evaluated **after** every other gate, so nothing else is bypassed. |
| `src/authorization/runtime-access.guard.ts` | The guard rebuilds a policy object for its gate evaluation; it now forwards the exemption field. Without this the approved SUPPORT exception would have silently become a denial (caught by the new tests). |

This avoids the trap Report 34 warned about — a blanket `requiredFunctions` gate that would have blocked the expressly approved SUPPORT principal — without inventing a second, parallel authorization mechanism.

### 3.3 Approved consequence (decision C — strict, recorded not hidden)

`notification.provider.view` is held by SUPER_ADMIN, FINANCE_AUDITOR, **FINANCE_CONTROLLER and OPERATIONS**; `audit.view` only by SUPER_ADMIN and FINANCE_AUDITOR. Under the strict gate, FINANCE_CONTROLLER and OPERATIONS lose provider-config audit oversight (they can no longer reach the route on which the provider filter is applied). This was raised explicitly, and the approved decision is to implement the strict gate and record the gap:

> **OPEN PRODUCT ITEM (not silently dropped):** provider-audit oversight is now reachable only by SUPER_ADMIN and FINANCE_AUDITOR. Proposed follow-up (requires approval, **not** implemented here): a dedicated provider-audit read route gated on `notification.provider.view`, or an explicit product decision that SUPER_ADMIN/FINANCE_AUDITOR are the intended oversight owners.

The SUPPORT exemption keeps the controller's provider-filter branch live and tested, so the protection is not orphaned.

---

## 4. R-01 — readiness documentation corrected (no behaviour change)

`GET /internal/readiness` and `GET /internal/deployment` run `ReconciliationService.runReconciliation()`:

* ledger/customer-financial queries execute inside `REPEATABLE READ` + `SET TRANSACTION READ ONLY` — **no** journal, balance, wallet or reconciliation-record write;
* **after** that transaction, `runReconciliation()` calls `MetricsService.observeDuration('reconciliation.duration_ms', …)`, which performs `INSERT … ON CONFLICT DO UPDATE` on `operational_metrics` through the standalone `DataSource`.

Accurate statement, now used everywhere: **the readiness scan is financially read-only but writes one operational duration metric per invocation.**

A correction addendum was appended to `33-REPORT-32-REMEDIATION-20261030.md`. **No code was changed**: the metric write is left in place, and the readiness/readiness-decoupling proposal from Report 33 remains unimplemented pending approval.

---

## 5. Files changed

| File | Change |
|---|---|
| `src/authorization/route-policy-registry.ts` | HEAD→GET policy normalization (all matching conditions); audit policy now `audit.view` + SUPPORT-only exemption |
| `src/authorization/authorization.types.ts` | `requiredFunctionsExemptPrincipalTypes` policy field + rationale |
| `src/authorization/authorization.service.ts` | Function-gate exemption applied after all other gates |
| `src/authorization/runtime-access.guard.ts` | Forwards the exemption into the gate evaluation |
| `test/authorization-http-matrix.spec.ts` | New HEAD parity block (policy-level + real-HTTP allow/deny for anonymous, CUSTOMER, SUPPORT, OPERATIONS, FINANCE_AUDITOR, retired-scope and no-scope principals) and audit least-privilege block |
| `test/runtime-access.guard.spec.ts` | Registry assertions for the audit gate; HEAD≡GET parity over 20 paths incl. non-internal routes |
| `test/a22-admin-foundation.integration.spec.ts` | (unchanged this round; still green) |
| `test/v1-admin-authorization-read-surface-01.integration.spec.ts` | D1 rewritten (TREASURY 403 GET+HEAD), D2 (OPERATIONS 403), D3 (FINANCE_AUDITOR 200 GET+HEAD) |
| `test/v1-notification-provider-configuration-01.integration.spec.ts` | Test 7 rewritten: denied roles (incl. OPERATIONS and FINANCE_CONTROLLER) get 403 on GET/HEAD; provider filtering proven with a real SUPPORT session; oversight limited to SUPER_ADMIN/FINANCE_AUDITOR |
| `test/customer-compliance-authorization.integration.spec.ts` | Audit assertions moved to the entitled role; OPERATIONS denial asserted |
| `docs/.../33-REPORT-32-REMEDIATION-20261030.md` | R-01 correction addendum |
| `docs/.../35-REPORT-34-REMEDIATION-20261030.md` | This report |

**Unchanged:** all controllers/services behind the routes (including `OperationsController.getAudit` and its provider filter), `ProductionReadinessService`, `ReconciliationService`, `MetricsService`, all migrations, all financial logic, frontend, mobile.

---

## 6. Test results

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | **PASS**, 0 errors |
| `npm test` (full unit/component suite) | **PASS — 222/222 suites, 2,571/2,571 tests** (was 2,495; +76 new assertions) |
| `jest test/runtime-access.guard.spec.ts` | **PASS — 11/11** |
| `jest test/authorization-http-matrix.spec.ts` | **PASS — 160/160** (was 85) |
| PG `v1-admin-authorization-read-surface-01` (updated D1–D3) | **PASS — 19/19** |
| PG `a22-admin-foundation` | **PASS — 15/15** |
| PG `v1-notification-provider-configuration-01` (rewritten test 7) | **PASS — 14/14** |
| PG `customer-compliance-authorization` | **PASS — 21/21** |
| PG `a2-workforce-session`, `v1-harden-01-runtime-access-guard-boundary`, `v1-harden-01-support-adversarial`, `s-fix-01-customer-lifecycle-authorization`, `v1-admin-authorization-hardening-01` | **PASS — 74/74** |
| PG `v1-admin-p1-authorization-hardening`, `v1-admin-configurable-dashboard-platform-01`, `v1-003-admin-operational-writes`, `v1-007-support-ticket`, `v1-customer-09-support-workforce-boundary`, `v1-admin-full-surface-audit-01-auth-propagation` | **PASS — 155/155** |
| PG `a23-customer-app`, `a5-transfer-lifecycle`, `transfer-notification-producer-01`, `migration-chain`, `v1-release-01-production-readiness-migration-sync` | **PASS — 54/54** |

**Totals:** unit 222 suites / 2,571 tests; PostgreSQL **20 suites / 352 tests**; **no failing assertions remain** in anything executed. The full 126-suite PostgreSQL matrix was not re-run; the 20 suites chosen cover authorization, audit, support boundary, operational and financial-contract behaviour.

### New coverage detail (requirement 3)

For each of `readiness, deployment, configuration, version, diagnostics, metrics, outbox, audit` over **both GET and HEAD**:

| Principal | Expected |
|---|---|
| anonymous | 401 |
| CUSTOMER | 403 |
| SUPPORT | 403 on the seven gated routes; 200 on audit (approved exception) |
| OPERATIONS (no `reconciliation.view`) | 403 on readiness/deployment; 403 on audit; 200 on metrics/diagnostics/outbox/configuration/version |
| OPERATIONS (HEAD) | same as GET for every route |
| FINANCE_AUDITOR | 200 on all eight |
| principal holding only the retired `internal:access` | 403 |
| scope-less workforce principal | 403 |

Every denial also asserts the protected service was never invoked (`getReadiness`, `getVersionMetadata`, `getSafeConfiguration`, `getDiagnostics`, `getMetrics`, `outboxService.list`, `auditService.list`, `listWithNotificationProviderOversight`). Policy-level parity (`HEAD` ≡ `GET` resolution) is asserted over 20 paths, including non-internal routes.

---

## 7. Environment-related testing limitation

Embedded PostgreSQL cannot start in this sandbox from a clean install: `initdb` fails with `libpq.so.5: cannot open shared object file` (the same limitation Report 34 hit, which is why it could not run any PG suite).

Resolution used here (environment-only; no repository change):

```bash
cd node_modules/@embedded-postgres/linux-x64/native/lib
ln -sf libpq.so.5.18 libpq.so.5
for f in *.so.*.*; do base=${f%%.so.*}; ln -sf "$f" "${base}.so.$(echo $f | sed -E 's/.*\.so\.([0-9]+)\..*/\1/')"; done
LD_LIBRARY_PATH="$PWD/node_modules/@embedded-postgres/linux-x64/native/lib" node scripts/embedded-pg.js
```

The symlinks live in `node_modules` (not tracked), so they must be re-applied after any dependency reinstall. This is worth fixing at the image/tooling level so reviewers can run PostgreSQL directly.

---

## 8. Remaining security findings

1. **Open product item (approved decision C, not a defect):** provider-audit oversight is now limited to SUPER_ADMIN and FINANCE_AUDITOR; OPERATIONS and FINANCE_CONTROLLER lost it under the strict `audit.view` gate. Proposed remedy (needs approval): a dedicated provider-audit route gated on `notification.provider.view`.
2. **Readiness scan cost (R-01):** a plain GET still performs a full-ledger scan and writes one operational metric. Documented accurately; decoupling NOT implemented (awaiting approval, proposal in Report 33 §6).
3. **Unchanged, previously recorded, out of scope:** OI-01 mobile FundWallet/Withdraw remain unregistered pending mobile-owner disposition; Admin Web and Product Owner ratifications outstanding.

No new authorization bypass, permission broadening, financial-rule change or migration was introduced.

---

## 9. Ready for independent Arena 4 re-review?

**Yes for the security-remediation scope.** H-01-R1 is closed at a single choke point that covers every GET-backed route, H-01-R2 is closed with the approved exception preserved and the operational consequence explicitly recorded, R-01 is corrected in documentation with behaviour unchanged, and the previously untested HEAD surface now has positive and negative real-HTTP coverage for all six principal classes plus denial-proof that protected handlers never run.

Overall integration acceptance remains separate: OI-01, Admin Web/PO ratifications and the full final test gate are still outstanding. This document authorizes no merge to `main`, deployment, production migration, provider activation or Report 30 work.

---

## 10. Branch note

Applied on `integration/main-backend-frontend-20261030`, the branch Report 34 reviewed and the branch this mission named. The session lineage branch `arena/8e59e188-monienaija` is untouched at `06dc30b`; it is an ancestor of this branch, so the fix reaches it on merge, or via `git cherry-pick <this-commit>`.

## 11. Reproduction

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/jest --runInBand test/runtime-access.guard.spec.ts test/authorization-http-matrix.spec.ts
npm test

# PostgreSQL (see §7 for the library symlinks first)
node scripts/embedded-pg.js
NODE_ENV=test PG_TEST_RUN_ID=r34fixa ./node_modules/.bin/jest \
  --config jest.integration.config.js --runInBand \
  test/v1-admin-authorization-read-surface-01.integration.spec.ts \
  test/v1-notification-provider-configuration-01.integration.spec.ts
```
