# Independent security re-acceptance of Report 35

**Review date:** 2026-10-30  
**Target branch:** `integration/main-backend-frontend-20261030`  
**Pinned target:** `3b488caddc2f68c28a5f06d1571dfd4311656a64`  
**Remediation report reviewed:** `docs/audit/20261030/sprint1-security-acceptance/35-REPORT-34-REMEDIATION-20261030.md`  
**Security-remediation verdict:** **PASS**  
**Overall integration acceptance:** **Separate; not granted by this review**

This is a documentation-only independent review. The target was fetched and reviewed in a detached worktree. No application source, tests, migrations, production data, provider, or deployment was changed. The Report 30 architecture was not implemented.

## Executive decision

I independently verified the Report 35 authorization changes and reran the focused HTTP/authorization tests, TypeScript compilation, and selected PostgreSQL integration tests. The new `HEAD`→`GET` normalization is applied centrally before route matching; all matcher comparisons use the normalized method, while audit actions keep the actual method. No remaining branch in `RoutePolicyRegistry.resolve()` compares the raw method except the normalization itself and action logging. The real-HTTP HEAD tests exercise anonymous, CUSTOMER, SUPPORT, OPERATIONS, FINANCE_AUDITOR, legacy-scope and no-scope cases; the policy parity tests cover 20 representative internal and non-internal GET routes.

The audit exception is limited to `SUPPORT` on the one static `/internal/audit` route. `AuthorizationService.evaluate()` checks principal validity, route principal-type allow-list, audience, assurance, scopes and roles before applying the function exemption; customer/agent/aggregator resource checks remain afterward. The route registry uses the field only once, for SUPPORT on audit. An independent evaluator probe confirmed that the exception does not bypass missing scopes, required roles, audience, MFA, or allowed-principal-type checks. OPERATIONS, TREASURY and other catalogue workforce principals without `audit.view` are denied.

Provider-specific audit filtering remains intact: the focused PostgreSQL tests confirmed SUPPORT receives general audit rows but not provider-specific records or sensitive sentinels; unentitled OPERATIONS/FINANCE_CONTROLLER are denied; and FINANCE_AUDITOR/SUPER_ADMIN with both `audit.view` and `notification.provider.view` can view filtered oversight records with the live secret absent. A deliberate product/access consequence remains: OPERATIONS and FINANCE_CONTROLLER previously held `notification.provider.view`, but now cannot reach the audit endpoint because they lack `audit.view`. Report 35 records that as an open product item. It is not an over-grant or a security bypass, but should be explicitly resolved by Product before declaring the overall integration accepted.

The readiness behavior and documentation are now accurately characterized: reconciliation’s ledger/customer-financial queries run in a read-only transaction, and each invocation writes one duration metric to `operational_metrics` after that transaction. The service code is unchanged and the proposed decoupling is not implemented.

**No remaining security-remediation finding was identified in the reviewed scope.** This PASS is limited to the Report 35 remediation. Mobile screens/owner ratification, Product’s provider-audit oversight decision, Admin Web ratification and the full final integration gate remain separate.

## Independent verification details

### 1. HEAD policy parity across the application

`RoutePolicyRegistry.resolve()` computes `lookedUpMethod = method === 'HEAD' ? 'GET' : method` before any public-route, authentication-mode, resource-policy, or financial/operational route matching. Inspection of the complete method body confirmed all method-conditioned routing decisions use `lookedUpMethod`; the remaining uses of the original `method` preserve the actual method in `AuthorizationPolicy.action`. This also preserves read-versus-write distinctions in the agent/class, outlet/terminal and aggregator branches. Fastify’s HEAD-to-GET handler mapping therefore receives the GET authorization decision rather than falling through to the generic internal policy or a different write policy.

I independently ran the new parity assertions in `test/runtime-access.guard.spec.ts` for 20 representative paths: internal readiness/deployment/configuration/version/metrics/diagnostics/outbox/audit, internal agents/customers/aggregators, customer `/me` routes, generic wallets/deposits/withdrawals, ledger, agent `/me`, and health. The comparison intentionally normalizes the `action` value because the real action should retain `HEAD` for audit accuracy. The HTTP matrix additionally exercises every one of the eight internal operational/audit paths with HEAD requests.

The other method-sensitive authorization points identified in Report 35 were reviewed:

- `RuntimeAccessGuard` treats HEAD as a safe read for read-only principals;
- `CustomerComplianceAccessGuard` already treated GET and HEAD equivalently;
- controller source contains no separate raw-method authorization branch that would diverge from the registry;
- CORS’s omission of HEAD is a browser preflight allow-list, not server-side authorization.

### 2. Unauthorized HEAD requests cannot invoke restricted handlers

The focused HTTP matrix exercises real Fastify/Nest routing and the real registry, guard and authorization evaluator. For all eight operational/audit paths, it tests anonymous and CUSTOMER denial; SUPPORT is denied on all seven restricted routes and is allowed only on audit; OPERATIONS is denied readiness/deployment where it lacks `reconciliation.view`; and scope-less/legacy-scope principals are denied. The test asserts protected service mocks were not called on denied SUPPORT cases. Positive HEAD cases prove FINANCE_AUDITOR access, OPERATIONS access only where its declared functions permit it, and the approved SUPPORT audit exception.

The PostgreSQL-backed read-surface, notification-provider and customer-compliance suites also exercise HEAD cases, including denied catalogue roles and approved roles. No evidence of a handler invocation following a denied HEAD request was found.

### 3. `requiredFunctionsExemptPrincipalTypes` safety

The new property is in the authorization policy type, evaluator and guard forwarding path. The evaluator applies the exemption only at the `requiredFunctions` check. All of the following remain enforced before that point: valid principal, `allowedPrincipalTypes`, audience, minimum assurance, required scopes (including internal scopes), and required roles. Customer/agent/aggregator resource scoping remains enforced after it. The route-registry search found exactly one production use: `GET`/`HEAD /api/v1/internal/audit`, with `['SUPPORT']` as the exemption and `['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']` as the route’s allowed types. No request-controlled input can add a route policy or alter the exemption list.

I performed a direct evaluator probe against a policy with an exempt SUPPORT type plus required function, scope, role, audience and MFA. The function-only exception allowed the principal only when all other requirements were satisfied; missing scope returned `SCOPE_MISSING`, missing role returned `ROLE_MISSING`, wrong audience returned `AUDIENCE_MISMATCH`, missing assurance returned `MFA_REQUIRED`, and a principal type outside the allow-list returned `PRINCIPAL_TYPE_DENIED`.

### 4–6. SUPPORT audit capability and provider-specific filtering

The explicit audit policy requires `audit.view` and exempts only SUPPORT. HTTP tests prove:

- real SUPPORT can read the general audit list;
- FINANCE_AUDITOR can read it;
- OPERATIONS, TREASURY, legacy `internal:access` and no-scope principals receive 403 on GET and HEAD and do not reach either audit-listing service;
- CUSTOMER/AGENT/AGGREGATOR are excluded by the route’s workforce principal allow-list.

The PostgreSQL provider-configuration suite exercises a provisioned and authenticated real SUPPORT user. SUPPORT sees a general audit sentinel, but not provider configuration/test-send events, provider proposal approvals, provider email/name/comment sentinels, masked key fingerprints, or sensitive destinations. Provider-type filters return an empty result for SUPPORT; an entity-ID filter does not expose provider-associated records. AuditService’s default query excludes provider record types and provider proposal approvals unless its private oversight marker is set.

Provider oversight is still available to FINANCE_AUDITOR and SUPER_ADMIN, which hold both `audit.view` and `notification.provider.view`. Their filtered results include the approved audit sentinel and masked fingerprint (`****Key1`) but exclude the live Brevo key and `MNNPS1:` secret envelope. The controller still requires `notification.provider.view` for provider-targeted filters and uses the oversight list method only after that authorization decision.

**Open product/access item, not a security bypass:** Report 35 intentionally narrows provider-audit access to SUPER_ADMIN and FINANCE_AUDITOR. OPERATIONS and FINANCE_CONTROLLER hold `notification.provider.view` but lack `audit.view`; the new route gate denies them. The PostgreSQL test explicitly encodes this. Product should confirm whether the reduced oversight set is intended or approve a separately gated provider-audit route. Do not remove the `audit.view` control to restore access implicitly.

### 7. Financial routes, customer ownership and OTP registration

The remediation diff does not alter financial controllers/services. The matrix still denies generic customer `POST /deposits`, `/withdrawals`, `/transfers` and generic collections/reads; denied commands do not call movement services. The dedicated customer self-service API remains the customer-facing path. The customer transfer controller derives the `CUSTOMER_SELF` ownership binding from the authenticated principal; `TransferService` checks source-wallet ownership both on a new transfer and on idempotency replay. The PostgreSQL `a23-customer-app` suite passed, including a foreign source-wallet attempt returning not-found, and verified customer wallet/read isolation. No direct-ledger bypass was introduced.

Only the OTP registration routes remain public in the registry: request OTP, verify OTP, and complete registration. Bare `POST /customers` remains non-public/workforce-owned. The OTP verification token is bound to the normalized phone, expiry/attempt/cooldown and token-consumption checks remain in the registration service. The three selected PostgreSQL suites for customer onboarding and credential exchange passed.

### 8. Readiness and metric write

The Report 35 addendum to Report 33 accurately says: the readiness reconciliation scan is **financially read-only** but writes one operational duration metric per invocation. I verified `ReconciliationService` uses `REPEATABLE READ` and `SET TRANSACTION READ ONLY` for its ledger/customer-financial queries, then calls `MetricsService.observeDuration()` after that transaction; `MetricsService.increment()` writes to `operational_metrics`. The remediation commit changes neither service. The proposed readiness decoupling is documentation-only and has not been implemented.

## Test results and environment notes

| Check | Independent result |
|---|---|
| `npx jest --runInBand test/runtime-access.guard.spec.ts test/authorization-http-matrix.spec.ts` | **PASS: 2 suites, 171 tests** (160 authorization matrix + 11 registry/guard) |
| `npx tsc --noEmit -p tsconfig.json` | **PASS: 0 errors** |
| PostgreSQL: `a22-admin-foundation`, `v1-admin-authorization-read-surface-01`, `v1-notification-provider-configuration-01`, `customer-compliance-authorization`, `a23-customer-app` | **PASS: 5 suites, 84 tests** |
| PostgreSQL: `v1-customer-onboarding-01`, `v1-customer-onboarding-02`, `v1-customer-credentials-01` | **PASS: 3 suites, 42 tests** |
| PostgreSQL selected total | **PASS: 8 suites, 126 tests**; full 126-suite PG matrix not rerun |

The first PostgreSQL invocation initially failed during test-module configuration because the generated local workforce-test `.env` was not present. I then used the repository’s `scripts/prepare-pg-test-env.js` to create the ignored local test environment and reran the same selected suite set; all 8 suites/126 tests passed. Embedded PostgreSQL also required the documented `libpq.so.5` symlink workaround inside `node_modules`; this workaround and the generated `.env` are untracked/ignored environment artifacts, not repository changes. PostgreSQL was stopped after the runs.

## Verdict and remaining acceptance conditions

**PASS — security-remediation scope.** The HEAD alias now receives the GET policy throughout route matching; denied HEAD requests are covered at HTTP level; the function-exemption mechanism is narrow and preserves the other evaluator gates; SUPPORT retains only the approved audit exception; catalogue roles without `audit.view` are denied; provider audit filtering/redaction is exercised; customer-owned financial transfer protections and OTP registration remain intact; and readiness is correctly documented as financial-read-only with an operational metric write. No security regression was identified in the remediation diff.

**Overall integration acceptance is not determined by this security PASS.** Remaining conditions include Product’s explicit disposition of provider-audit oversight for OPERATIONS/FINANCE_CONTROLLER, the mobile FundWallet/Withdraw owner decision (screens remain dark), Admin Web/mobile owner ratifications, the PO’s selected V1 API-contract ratification, and completion of the full final test gate. Report 35’s selected PG evidence was substantially reproduced, but the full PostgreSQL matrix was not run here. No merge, deployment, production migration, provider activation, or Report 30 implementation is authorized by this report.
