# Combined Sprint 1 P0 + Robase/Brevo Provider Configuration — Independent Security Review

**Review date:** 2026-10-28
**Reviewer:** Arena 4 independent review
**Application SHA reviewed:** `96cd6e68e61646938cbc3f6e78aa3f00ddc6cb9a`
**Application merge parents:** `b39a2efc7b25dfca3c5868f669cf13661e9570ce` and `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5`
**Accepted Sprint 1 comparison SHA:** `56ee049ca4c04c0914e29508f5dd36c120603f0d`
**Integration documentation commit / remote integration-branch HEAD:** `73326c9116d0b001fb9419d229eb7b5fef405354` (documentation-only child of the reviewed application SHA)
**Arena 2 provider branch remote tip:** `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5`
**Arena 4 report branch remote tip before this report:** `37622a56472ec9b6f9bb47c7f3028c89fb7059cc`
**Overall technical verdict:** **NO-GO**
**Production readiness:** **NO-GO — not demonstrated or approved**

## 1. Decision summary

This is a fresh review of the combined application; the earlier CONDITIONAL GO for `56ee049` does not carry forward. I independently fetched and verified remote refs, reviewed the complete diff from `56ee049` to `96cd6e6`, reran backend and Admin Web tests/build/typechecks, ran focused real-HTTP/PostgreSQL suites, and executed temporary adversarial probes against mocked Robase/Brevo transports and local PostgreSQL. Temporary probe edits were restored. No application source or persistent test was changed.

**Two high-severity findings block acceptance:**

1. Provider-returned error identifiers are treated as safe because they match a character pattern, not a closed stable-code allowlist. A credential-like/financial sentinel supplied as an upstream Robase/Brevo error identifier was returned by test-send, exposed in FULL provider status, written to audit and PostgreSQL diagnostics, and, for Brevo, logged. The delivery-history diagnostic path separately sanitized the same class of failure to `UNCLASSIFIED`; that P0-02 control passed, but it does not cure the provider-configuration leak.
2. Provider configuration accepts arbitrary HTTPS hosts. A governed SMS proposal using `https://attacker-controlled.example.test` was accepted. No outbound request was made during the probe. When such a proposal is approved and activated, provider credentials can be sent to that untrusted endpoint.

A concurrent HTTP probe also demonstrated that the advertised five-per-hour test-send cap is not atomic: with two prior attempts, eight simultaneous requests yielded six additional successes and two 429 responses. The per-principal limit was exceeded. MINIMAL provider status also exposes `provider`, `enabled`, `configured`, `deliveryTested`, `lifecycleState`, and worker-enabled facts to a delivery-view-only principal, contrary to the acceptance requirement to omit secret-adjacent metadata. Finally, malformed boolean strings are coerced to `true` rather than rejected.

### Per-surface verdicts

| Surface | Verdict | Basis |
|---|---|---|
| **P0-01 — Compliance authorization, actor attribution, case/customer/category binding and generic audit filtering** | **CONDITIONAL PASS** | Focused compliance tests passed; relevant compliance guard/service code was not changed. The combined audit-query restrictions compose correctly in an adversarial HTTP/PG probe. D-01/D-04, assignment scope and the global case-number collision behavior remain unresolved policy issues. |
| **P0-02 — Delivery diagnostics leak controls** | **PASS (narrowly)** | SQL does not select rendered `message`; diagnostics map unknown provider failures to `UNCLASSIFIED`; delivery-history inspector remains error-code-only. The finding below is a separate provider-configuration/test-send leak, not a regression in the delivery-history projection. |
| **P0-03 — Limit-view authorization/read-only behavior** | **PASS** | Existing route/function checks and read-only controls remain in place; focused PG limit suites passed. No existing limit grant was expanded. |
| **Provider configuration and test-send** | **NO-GO** | Two high findings, test-send limit race, MINIMAL over-disclosure, and malformed-input coercion. |
| **Migration 100** | **PASS for focused migration/upgrade verification** | Migration 100 constraints/readiness and focused clean-install/upgrade suite passed on local PostgreSQL. The full sequential suite did not complete independently. |
| **Overall technical acceptance** | **NO-GO** | High-severity credential egress/leakage findings remain open; other required controls also need remediation. |
| **Production readiness** | **NO-GO** | No live provider, credential, DNS/domain, production key-operations, deployment or production-database validation was performed. |

## 2. Provenance and reviewed diff

Remote refs were verified with `git ls-remote`:

- `arena/8e59e188-monienaija` → `73326c9116d0b001fb9419d229eb7b5fef405354`; this is the integration record, whose parent is the reviewed application SHA `96cd6e68e61646938cbc3f6e78aa3f00ddc6cb9a`.
- `arena/ea070127-monienaija` → `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5`.
- `arena/870f970d-monienaija` → `37622a56472ec9b6f9bb47c7f3028c89fb7059cc` before this report.

The reviewed merge commit has parents `b39a2efc7b25dfca3c5868f669cf13661e9570ce` and `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5`; `56ee049`, `b39a2ef`, `fa08e71`, and the Arena 2 provider commit `1f6decdf96491d548e7cabecb7ff7ed18ef8d2d2` are ancestors of `96cd6e6`. The integration-record commit `73326c9` is a docs-only child; no application code changed after `96cd6e6` in that record.

The independently computed complete comparison `git diff 56ee049..96cd6e6` is **34 files changed, 9,654 insertions, 216 deletions**. The integration record’s smaller 33-file/9,541-insertion statistic describes its narrower merge delta, not the full comparison from the accepted Sprint 1 SHA. I inspected the full delta and the overlapping `audit.service.ts`, notification Admin Web types/screen, provider controller/service/adapters, encryption service, migration 100, authorization catalogue, diagnostics controller, dispatcher/worker, environment, and tests. No compliance source, `admin-notification.controller.ts` delivery-query implementation, limit authorization implementation, financial business logic, or production configuration was changed. `audit.service.ts` is the important semantic overlap and was exercised end to end. The catalogue adds two provider functions and six intended grants; no existing role/function grant was broadened.

The Arena 4 root checkout was left untouched. Review/testing ran in a detached worktree at the exact application SHA; report writing is isolated from that worktree. No reset, rebase, force-push, peer merge, application edit, deployment, live provider delivery, or production database operation was performed.

## 3. Severity-ranked findings

### F-01 — HIGH: untrusted provider error identifiers leak into HTTP, status, audit, database and logs

**Evidence.** In `src/notification/robase-notification-provider.ts`, the upstream `error.type` is accepted by a broad character regex and concatenated into `ROBASE_HTTP_<status>:<errorType>`. `src/notification/brevo-email-provider.ts` `classifyBrevoErrorCode()` accepts any string matching `SAFE_ERROR_CODE` (`[A-Za-z0-9_.-]` plus length), not a closed vendor-code mapping; the accepted value is returned and logged. `AdminNotificationProviderController.testSend()` forwards `result.error` without normalization into the HTTP response, `recordTestSendOutcome()`, and `NOTIFICATION_TEST_SEND` audit `newValues`. The stored diagnostic is then included in provider snapshots/FULL status. The database columns’ bounded length does not make the content safe.

**Adversarial result.** A temporary real-HTTP/local-PostgreSQL probe used fake credentials and mocked 503 responses with credential-like Robase/Brevo identifiers, including a financial sentinel. The value appeared in `/test-send`, FULL `/provider-status`, provider test-send audit records, `notification_provider_configurations.last_test_error_code`, and Brevo’s warning log. No real credentials or upstream provider were used. The separate delivery-diagnostics path returned `UNCLASSIFIED` for the same class of failure.

**Impact.** An upstream error identifier is attacker-/provider-controlled and can carry credential-like, financial, or other sensitive text across several authenticated and persistent surfaces. The leak defeats the stated no-plaintext-in-HTTP/log/audit/database requirement even though the dedicated credential column is AES-256-GCM ciphertext.

**Required remediation.** Normalize both adapters’ failures through a closed, reviewed enum of fixed error codes. Never persist or log raw upstream identifiers; discard unrecognized values. Apply the mapping before all test-send responses, provider snapshots, verification/test fields, and audit writes. Add permanent real-HTTP/PG tests that inject key-like and financial sentinels and assert absence from the entire serialized response, logs, audit JSON and all diagnostic columns.

### F-02 — HIGH: arbitrary HTTPS base URL can redirect provider credentials to an untrusted host

**Evidence.** `validateProviderBaseUrl()` in `src/notification/notification-provider-config.service.ts` enforces HTTPS and blocks a limited set of obvious local names in production, but it does not vendor-host-allowlist the destination. A temporary real-HTTP/PG probe submitted an SMS proposal with `https://attacker-controlled.example.test`; the proposal was accepted. The probe did not activate the proposal or make any outbound request.

**Impact.** Once approved and activated, the Robase bearer key or Brevo `api-key` header can be sent to a host not operated by the configured vendor. Maker-checker approval is not a substitute for destination trust validation, especially for accidental or socially engineered configuration changes.

**Required remediation.** Pin vendor API hosts (including any explicitly approved regional hosts) or remove user-configurable base URLs. If custom hosts are a product requirement, use a server-side allowlist and robust DNS/IP/redirect protections at connection time and enforce network egress policy. Add real-HTTP/PG negative tests for arbitrary public hosts, alternate ports, redirects, DNS rebinding/private ranges and malformed authorities; do not send credentials to rejected destinations.

### F-03 — MEDIUM: test-send rolling-hour limit is raceable

**Evidence.** `AdminNotificationProviderController.testSend()` counts `audit_events` rows before sending, then calls the provider, records configuration status, and only afterwards writes the audit row. The count-and-send sequence has no atomic reservation, row lock, advisory lock, or transaction spanning concurrent requests. A temporary barrier-controlled real-HTTP/PG probe began with two prior attempts and issued eight simultaneous requests. **Six additional sends succeeded; two were rejected with 429**, exceeding the stated five-per-principal hourly cap by three. The mocked transport observed seven Robase calls including the earlier SMS call; a separate prior email test accounted for the second quota item.

**Impact.** Concurrent callers can exceed provider-reaching test attempts and incur unwanted cost or abuse a test destination. Audit insertion failure after a provider call can also leave a provider-reaching attempt uncounted by this audit-derived limiter.

**Required remediation.** Atomically reserve quota per principal before any provider call (for example, a dedicated durable rate-limit row/counter or transactionally serialized reservation), and record an attempt outcome separately without decrementing quota on failure. Test concurrent requests and injected audit/DB failures; assert no more than five provider-reaching attempts per principal per rolling hour.

### F-04 — MEDIUM: MINIMAL provider-status response discloses secret-adjacent configuration state

**Evidence.** `providerStatus()` returns `provider`, `enabled`, `configured`, `deliveryTested`, `lifecycleState`, and `worker.enabled` to a principal holding only `notification.view_deliveries`. Existing role-matrix test 6 explicitly verifies `configured: true` for delivery-only SMS and email status. It correctly omits fingerprints, sender identity, URLs, diagnostics and last-test details, but the remaining fields reveal provider identity and whether credentials/configuration exist or have passed live testing.

**Impact.** Delivery-view-only users can infer the active provider and credential/configuration lifecycle, contrary to the stated MINIMAL projection requirement that secret-adjacent metadata be omitted.

**Required remediation.** Return only the specifically approved coarse channel availability fields to MINIMAL callers; omit provider identity, configured/tested gates, detailed lifecycle and worker state unless product/security explicitly approves each field. Add negative tests asserting the full response schema, not only absence of selected sensitive strings.

### F-05 — LOW: malformed booleans are coerced instead of rejected

**Evidence.** `parseProposeBody()` applies `Boolean()` to `enabled`, `spfConfigured`, `dkimConfigured`, and `dmarcConfigured`. A temporary real-HTTP/PG probe sent `enabled: "false"`; the API returned 201 with `proposedEnabled: true`.

**Impact.** The API accepts malformed intent and can stage a change as enabled or assert DNS posture contrary to the caller’s string value. Maker-checker still applies; this does **not** bypass the independent approval requirement, but it violates fail-closed malformed-request handling and can mislead reviewers.

**Required remediation.** Strictly require JSON booleans for all boolean fields, reject other types with 400, and add negative HTTP/PG tests for strings, numbers, nulls and missing required fields. Never coerce security/governance inputs with JavaScript truthiness.

### UI note — delivery-only role sees an unusable Provider Configuration affordance

`deriveNotificationPermissions()` lets `notification.view_deliveries` set `canViewProviderConfig`, so a delivery-only user can see the configuration tab/jump button. The configuration API itself requires `notification.provider.view` and denies the request. Configuration and governance actions are still gated server-side and by role/MFA; this is a false affordance/authorization mismatch, not a data disclosure. Align the tab visibility with the actual provider-view API entitlement and retain server-side checks.

## 4. Required security-control rechecks

### P0-01 — compliance authorization and audit filtering: CONDITIONAL PASS

The focused real-PG compliance suite passed. Source review and tests cover live category/function checks, customer/case binding, actor attribution from the authenticated session rather than request-supplied actors, protected case child resources, and restricted audit filtering. The integrated `AuditService.list()` composes the compliance restrictions and provider-audit restrictions independently; the opt-ins are internal, not query parameters.

A temporary adversarial real-HTTP/PG audit-composition extension verified that provider-view callers cannot see compliance records; compliance-only callers cannot see `NOTIFICATION_PROVIDER_CONFIG`, `NOTIFICATION_TEST_SEND`, or linked provider-approval records; and broad listing, exact entity/entity-ID/correlation filters, limited pagination, and the audit-trail dashboard widget do not bypass either category filter. The temporary test change was restored.

Conditional acceptance remains necessary: **D-01** assignment/access scope and per-action/read-grant policy are open; **D-04** compliance category taxonomy ratification and future-category process are open. Current valid function holders remain global within their allowed category, with no worker-to-customer assignment check. The global case-number uniqueness behavior still permits a cross-customer/category duplicate to produce a 409 collision signal. These remain product/security decisions, not resolved code findings.

### P0-02 — delivery diagnostics: PASS, narrowly scoped

`AdminNotificationController` does not select or return rendered message text. The delivery record and inspector remain error-code-only, and arbitrary delivery errors collapse to `UNCLASSIFIED`. The focused delivery authorization/diagnostics PostgreSQL suites passed; the Admin Web delivery history inspector continues to show the safe error/skip code, not `message` or raw `lastError`. This pass does not cover test-send/provider-status, where F-01 applies.

### P0-03 — limit-view authorization: PASS

The reviewed delta does not alter the limit authorization implementation; the migration-count assertion update is test/readiness bookkeeping only. Focused limit authorization and diagnostics tests passed. Function checks occur before query/filter processing, read surfaces remain read-only, and release is separately gated. No existing `limit.view` grant or role was broadened.

### Audit-record separation: PASS for access control

The independent real-HTTP/PG probe exercised broad and filtered audit listings plus dashboard consumption. Provider audit oversight did not bypass compliance filtering, and compliance-only views did not expose provider configuration/test-send or linked proposal-approval records. One auditability caveat remains: `OperationsController.getAudit()` uses non-auditing `evaluate()` for unfiltered/non-provider-specific queries even when a provider-view principal’s generic listing includes provider audit rows. Consider recording the read authorization consistently; this did not bypass the category access controls tested above.

## 5. Provider configuration, cryptography, governance and UI

- **Credential storage:** source inspection confirms AES-256-GCM with random 96-bit IVs, 128-bit authentication tags, 32-byte key material, key-version metadata and channel/version-bound AAD. Missing key versions fail closed. The focused provider suite tested ciphertext-at-rest constraints, rotation/readiness reset and missing-key fail-closed behavior. No plaintext credential was found in the dedicated credential fields. F-01 shows that the broad “no plaintext in DB/logs/audit” requirement is nevertheless not met because provider-controlled error identifiers are persisted in `last_test_error_code` and audit values.
- **Migration 100:** schema `1785753600100-CreateNotificationProviderConfiguration` has channel/provider, timeout, envelope, fingerprint, credential-consistency, version/status and proposal no-self-approval constraints; it adds the two new provider authorization functions/grants without modifying existing entitlements. The focused real-PG migration-upgrade/readiness suite passed. **Migration 100 verdict: PASS for that focused evidence; full-chain/full-suite independent completion remains incomplete.** No production migration was run.
- **Maker-checker/MFA:** SUPER_ADMIN maker and independent FINANCE_CONTROLLER checker are role- and function-checked; self-approval, insufficient MFA, and read-only restrictions are covered by the existing focused provider integration tests. A separate temporary HTTP/PG probe advanced an approval expiry, observed a 403 and persisted `EXPIRED`, then approved a fresh proposal and confirmed a replay returned 409. Role grants added by the integration are limited to the two provider functions and six intended assignments; no existing role grants were expanded.
- **Provider contracts and failure behavior:** mocked Robase/Brevo wire-contract, sender, fixed safe test content, masking, disable/unconfigured, dispatch, retry, provider idempotency and missing-key behavior passed in the focused suite. No real endpoint was contacted. F-01 and F-03 remain blockers despite those passing contract tests.
- **Admin Web:** 27 suites/186 tests, TypeScript check and production build passed. The Provider Configuration workspace holds a typed key in ephemeral component state, clears it on submit, and does not persist it to browser storage. Maker/checker, MFA and action permissions are rendered and enforced server-side. Delivery-history error rendering remains safe. The delivery-view-only visibility mismatch is documented above.
- **FULL/MINIMAL:** the 11-role test matrix passed for its current expected behavior. FULL remains restricted to `notification.provider.view`; MINIMAL omits sender names/addresses, key fingerprints, URLs and last-test diagnostics. It does not meet the newer stricter acceptance criterion because it still reveals provider name and configuration/readiness booleans/state (F-04).

## 6. Independent verification and exact results

All test databases and provider calls were local/mocked. No live Robase/Brevo credential or delivery was used.

| Check | Independently run result | Duration / notes |
|---|---|---|
| Backend unit suite (`npm test`) | **204 suites / 2,057 tests passed** | Jest 33.216 s; shell wall 35 s |
| Backend build (`npm run build`) | Passed | Shell wall 24 s |
| Backend TypeScript (`npx tsc --noEmit -p tsconfig.json`) | Passed | Shell wall 22 s |
| Admin Web suite (`apps/admin-web npm test`) | **27 suites / 186 tests passed** | Jest 20.256 s; shell wall 22 s |
| Admin Web TypeScript (`npm run ts:check`) | Passed | Shell wall 11 s |
| Admin Web production build (`npm run build`) | Passed | Vite 3.29 s; shell wall 4 s; nonfatal >500 kB chunk warning |
| Focused real-HTTP/PostgreSQL suite | **6 suites / 85 tests passed** | 107.845 s; provider configuration, delivery authorization, diagnostics, compliance, limit and migration-upgrade coverage |
| Audit-category composition adversarial probe | Passed | Temporary real-HTTP/PG test extension; no persistent test change; run timing was not retained |
| Provider error-identifier leak probe | Passed as a reproduction | Temporary mocked-HTTP/real-PG sentinels; confirmed leak in test-send/FULL status/audit/DB and Brevo log; no persistent test change; run timing was not retained |
| Arbitrary HTTPS base URL probe | Passed as a reproduction | Temporary real-HTTP/PG proposal probe; accepted attacker-controlled example URL; no outbound request; run timing was not retained |
| Test-send rate concurrency probe | **1 selected integration test passed** | 9.671 s; 8 simultaneous attempts, 6 successes/2 429 after two prior attempts; fake transport barrier |
| Approval expiry/replay probe | **1 selected integration test passed** | 8.737 s; expired approval 403 + EXPIRED status; replay 409 |
| Malformed boolean probe | **1 selected integration test passed** | 9.234 s; `enabled: "false"` accepted as `proposedEnabled: true` |
| Full sequential PostgreSQL runner | **INCOMPLETE — not a pass** | Stopped after 30 min 09 s. Six complete 15-suite batches: 90 suites / 1,878 tests passed, 0 failures. A seventh batch began; `v1-harden-01-limit-catalog-check-constraint-boundary.integration.spec.ts` reported PASS, but no seventh-batch aggregate was emitted and remaining files did not run. No overall full-suite count is claimed. |

No test failure occurred in the successful backend/Admin Web/focused PG runs or the successful temporary behavioral probes. A preliminary full-PG attempt with concurrency 2 was stopped and discarded as evidence; the sequential attempt is the reportable full-suite attempt. One initial temporary probe-file injection had a syntax error in the probe scaffolding, was restored, corrected and rerun successfully; it is not an application test failure. An earlier backend command adding `--runInBand` conflicted with the package’s existing `--maxWorkers=2`; the corrected plain `npm test` passed.

### Owner-supplied evidence (not independently reproduced)

The integration record `73326c9116d0b001fb9419d229eb7b5fef405354` reports backend **204/2,057**, Admin Web **27/186**, and a complete sequential PostgreSQL run of **122 suites / 2,327 tests** on `96cd6e6`. Those are integration-owner claims and are not represented as my full-suite result. They do not override this report’s 30-minute independent run stopping incomplete.

## 7. Production boundary and unresolved requirements

**Production readiness is separately NO-GO.** No live provider verification, real credentials, DNS/domain-auth evidence, production encryption key provisioning/rotation, provider activation, worker activation, production database migration, deployment, customer operation, or financial transaction was performed. The application must remain dark-launched while F-01–F-05 are remediated and independently retested.

The following remain open and are not approved by this review:

- D-01 compliance role/access scope, including whether worker-to-customer assignment and separate read grants are required.
- D-04 category taxonomy, future-category governance, and AML/SANCTIONS overlap decisions.
- Global case-number collision behavior and its cross-customer 409 existence signal.
- Live Robase/Brevo verification using only production-governed credentials and independent approval; no such verification was attempted here.
- Dark-launch gates, notification worker activation, provider DNS/domain authentication, monitoring and provider incident controls.
- Encryption key custody, backup, rotation and recovery operations. AES-GCM mechanics passed code/test review; operational key-management readiness did not.
- No automatic expired C2C disposition absent an explicit decision; `cash_to_cash.claimed/.expired` notification wiring and manual notification retry remain deferred.
- Backend/Admin Web before mobile, configurable SMS/email templates, and no sensitive transfer credentials in beneficiary notifications remain in force.

## 8. Required next action

**Do not activate providers, run production migrations, or release this combined SHA.** The application owner should remediate F-01/F-02 first, then F-03/F-04/F-05, add permanent regression tests for the sentinels, destination validation, quota concurrency, strict MINIMAL schema and malformed requests, and correct the Admin Web tab gate. Preserve current history. Submit a new application SHA for a fresh independent review; require the full sequential PostgreSQL runner to complete with a final aggregate in that review. Record D-01/D-04 and case-number policy decisions separately. Production approval remains a distinct later gate after key operations, real vendor verification and a controlled dark-launch plan are independently evidenced.

## 9. Scope of this report

This is a report-only artifact under `docs/audit/20261028/sprint1-security-acceptance/`. No application implementation or persistent tests were changed. It is to be committed and pushed only to the existing Arena 4 branch `arena/870f970d-monienaija`. No reset, rebase, force-push, other branch, peer merge or production action is authorized by this review.
