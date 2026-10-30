# Sprint 1 — Fresh Independent Security Acceptance

**Reviewed application SHA:** `fe06ea8f7f6345db1542a17995c1d17b2aa07631`
**Integrated documentation HEAD:** `08b8329e6f0f8f2e81ee8702ad2855d17f1d3852` (its parent is the reviewed application SHA)
**Arena 2 remediation:** `7d703a3e830baf3fafd876b663a442b541af8f2a`
**Arena 4 report branch before this report:** `arena/870f970d-monienaija` at `c3535601eaf36aa883be1d9b0ad488b1e6678309`
**Review date:** 2026-10-28

## Executive verdict

**Overall technical acceptance: FAIL / NO-GO. Production readiness: NO-GO.** This was a fresh review of the exact application SHA, not an acceptance of the integration record or another agent’s results. The core F-02, F-03 and F-04 remediations independently withstood the probes below. Two acceptance failures remain:

1. **F-01 (HIGH):** upstream success identifiers (`id`, `messageId`) are still treated as safe `providerRef` values. A response-shaped credential/financial sentinel was returned in test-send HTTP, FULL status, provider-config overview, PostgreSQL, audit JSON and Brevo logs. The remediation sanitizes error codes but not successful provider identifiers.
2. **F-05 (MEDIUM):** wrong types and missing required `enabled` are rejected, but omitting any one of the optional `spfConfigured`, `dkimConfigured`, or `dmarcConfigured` fields still returns 201 and creates a proposal. That contradicts the requested missing-boolean 400/no-mutation acceptance criterion.

The complete sequential PostgreSQL run was independently attempted with a **30-minute cap** and did not finish. Five batches (75 suites/1,739 tests) completed; two more suites in the partial sixth batch reported PASS and were rerun independently (2/2 suites, 32/32 tests). Thus **77/122 unique integration files and 1,771 tests** have independently confirmed results from that run, with no failures in those completed results; 45 files remain unexecuted in the sequential run. This is not a complete-suite pass.

No application code was changed. Temporary probe edits to test files were restored. No real provider request, credential, financial operation, production migration, production configuration change, or deployment was used.

## Per-surface verdicts

| Surface | Verdict | Severity / evidence summary |
|---|---|---|
| **F-01 — provider error/data non-disclosure** | **FAIL** | **High.** Error-code sentinel battery passes, but attacker/provider-controlled successful `providerRef` values leak across HTTP, FULL status, provider-config API, DB, audit and Brevo logs. Resend’s adapter also returns an arbitrary response `id` unchanged. |
| **F-02 — pinned egress / SSRF / redirects / DNS** | **PASS** | **High-risk control verified.** Exact canonical vendor origins only; deceptive hosts, userinfo, ports, paths/encoding and IP literals rejected; redirect and DNS-rebinding probes did not open an unapproved socket. Malicious persisted URLs failed closed in test-send and worker retry paths. All transports were fake/local; no vendor call. |
| **F-03 — quota atomicity** | **PASS** | Two prior requests plus eight simultaneous HTTP requests, alternated across two independently initialized app instances sharing PostgreSQL, produced exactly three further 201s and five 429s; only five provider-bound calls total. Failed sends and post-send DB persistence failures still consumed quota. |
| **F-04 — delivery-view MINIMAL status** | **PASS** | Delivery-only caller received the exact five-key top-level MINIMAL object and one-key `{available}` channel objects. No provider/configuration/lifecycle/sender/fingerprint/worker/test/provider identity or diagnostic fields. Seven seeded roles were denied; FULL remained limited to provider-view holders. |
| **F-05 — strict booleans/integers** | **FAIL against the stated acceptance criterion** | **Medium.** Malformed supplied booleans/integers and missing required `enabled` returned 400 with no proposal rows. Each of the three optional DNS booleans, when omitted individually, instead returned 201 and inserted a proposal. |
| **Admin Web provider permission gate** | **PASS (narrow evidence)** | The provider tab and workspace are hidden for a delivery-only principal deep-linked to `providerConfig`; no provider-config endpoint or quick-jump is rendered/called. UI permission predicate now requires `notification.provider.view`; API role matrix passed. No browser UAT claimed. |
| **Provider audit-read auditability** | **PASS** | Fresh HTTP/PG probes confirmed both `ALLOWED` and `DENIED` `AUTHORIZATION_DECISION` records for broad/targeted provider-audit reads. Provider and compliance audit filters remained composed under broad, exact-entity and entity-ID queries. |
| **P0-01 — compliance authorization/audit filtering** | **CONDITIONAL PASS** | Focused real-PG compliance and cross-audit composition probes passed; D-01, D-04 and the global case-number collision signal remain open product/security decisions (details below). |
| **P0-02 — delivery diagnostics** | **PASS, narrow scope** | Rendered message/raw `last_error` are not returned by the delivery diagnostics endpoint; unknown provider errors render as `UNCLASSIFIED`. The separate `outbox.view` surface and stored-message retention caveats remain. F-01 above is a separate provider/test-send path. |
| **P0-03 — limit diagnostics** | **PASS** | Focused real-PG limit suite passed; function gate and read-only behavior remain intact; no existing limit grants were expanded. |
| **Migration 100 compatibility** | **PASS for focused verification** | Provider-configuration schema/readiness and clean-install/098→100 upgrade suite passed on embedded PostgreSQL. No production migration was run. |
| **Technical acceptance** | **FAIL / NO-GO** | F-01 and F-05 remain open; full sequential PG run incomplete; Admin Web development-tool advisories remain. |
| **Production readiness** | **NO-GO** | Operational key, vendor, DNS/domain, monitoring, staging and dark-launch prerequisites were not independently satisfied. No live integration or production exercise was performed. |

## Evidence and findings

### F-01 — HIGH: successful provider identifiers bypass the error-code sanitizer

The existing error-path probe injected credential-shaped and financial sentinels into fake Robase/Brevo error envelopes. On the reviewed SHA, `/test-send`, verification, provider status/overview, diagnostic columns, audit values and captured warn/error logs contained only the expected fixed error codes. That confirms the closed error-code allowlists and unknown-error normalization on those error paths.

I then extended the real-HTTP/embedded-PG test temporarily (and restored it afterwards) so the fake 2xx Robase response returned the sentinel as `id` and the fake 2xx Brevo response returned it as `messageId`. The selected test passed only because the probe asserted the observed disclosure:

- test-send response returned the raw value as `providerRef` for both channels;
- FULL `/internal/notifications/provider-status` returned it as `lastTest.providerRef`;
- `/internal/notifications/provider-config` overview returned it;
- `notification_provider_configurations.last_test_provider_ref` stored it;
- `NOTIFICATION_TEST_SEND.new_values.providerRef` stored it;
- captured Brevo success logs included it.

A separate no-network Resend adapter probe returned an arbitrary credential/financial sentinel as `providerRef` unchanged. Resend currently emits no adapter log, but its result enters the shared controller/service persistence path. Source inspection confirms the controller's `safeProviderRef` only truncates to 255 characters before returning, persisting, and auditing; Brevo similarly truncates `messageId` and logs the resulting `providerRef`; Robase and Resend return arbitrary accepted response IDs. Truncation is not content sanitization.

**Risk:** provider-controlled success data can carry key-like strings, financial identifiers, or other sensitive content into application logs and durable operational records. A provider that receives a credential can reflect it into its message identifier. This also means the broader F-01 “no sentinel leak” criterion is not met even though error envelopes are now safe.

**Required disposition:** treat every provider response field as untrusted. Do not return, log, audit, or persist raw IDs without a separately reviewed safe representation (for example, an opaque fixed digest or a narrowly validated vendor ID). Add permanent success-response sentinel tests for Robase, Brevo and Resend across test-send, FULL status, overview, DB, audit and logs.

### F-02 — PASS: pinned destinations hold on proposal, transport and persisted-row paths

Independent real-HTTP/PG negative proposals rejected arbitrary public hosts, deceptive suffixes, userinfo, explicit/default and unusual ports, query/fragment/path variants, HTTP, wrong-vendor hosts and IPv4/IPv6 literals. Unit probes also exercised encoded path material and the private/link-local/loopback/NAT64/6to4 IPv4/IPv6 denylist. The transport resolves all addresses, rejects the request before `https.request` if any result is forbidden, pins the checked address at connection time, sets TLS SNI to the pinned hostname, and leaves Node certificate hostname verification enabled. Redirects are returned as 3xx and blocked; credentials are not forwarded to a redirect target.

The real-HTTP test tampered a persisted Robase `base_url`; test-send returned `PROVIDER_BASE_URL_UNTRUSTED` with no outbound transport call. A separate temporary worker-retry probe tampered persisted SMS and EMAIL base URLs after queuing failed deliveries. Worker retries remained FAILED, the fake transport observed zero calls, and restoring canonical URLs allowed the normal retry. A direct Resend probe rejected attacker hosts, lookalikes, userinfo, encoded path and custom/default ports and returned `RESEND_EGRESS_BLOCKED` without invoking the injected fetch. No request was made to a live vendor or real unapproved destination.

**Limit:** DNS rebinding was tested with injected DNS and socket/request spies, not with live vendor DNS. TLS hostname handling was source-reviewed; no live TLS session to a vendor was attempted.

### F-03 — PASS: quota is durable across concurrency and failure paths

The real-HTTP/PG quota case was independently extended to create a second Nest application instance over the same PostgreSQL database and deterministic fake provider transport. With two accepted attempts already reserved, eight simultaneous EMAIL test-sends alternated across both app instances produced exactly **3 HTTP 201 / 5 HTTP 429**; only five provider calls were recorded including the two prior attempts. The original integration case also exercised a separate principal with ten simultaneous requests, provider failures, a trigger-injected post-send configuration persistence failure, and a later 429. The quota is therefore not merely process-local and failures do not release provider-reaching reservations.

### F-04 — PASS: exact delivery-only MINIMAL response

The real-HTTP/PG role-matrix test asserted equality to the exact MINIMAL object, checked exact object keys, and checked absent provider identity, enabled/configured/lifecycle/readiness, worker, sender, fingerprints, URLs, last-test diagnostics, destination and provider references. Seven seeded roles without either relevant view function received `403 FUNCTION_MISSING`; the delivery-only principal received MINIMAL; the provider-view roles received FULL with credentials masked. No disclosure was observed in MINIMAL.

### F-05 — FAIL: omitted optional flags still create proposals

The real-HTTP probe supplied strings, numbers, null, arrays and objects for booleans; omitted required `enabled`; supplied malformed `expectedVersion`/`requestTimeoutMs` values (including strings, null, arrays, objects, fractions and out-of-range integers). All those invalid values returned 400 and left the proposal table empty.

A separate explicit missing-field probe removed `spfConfigured`, `dkimConfigured`, and `dmarcConfigured` one at a time from otherwise valid Brevo proposals. **Each request returned 201**, and PostgreSQL contained three new proposal rows. `enabled` remains required and omission of it correctly returns 400, but these three flags are parsed as optional. Because the acceptance instruction explicitly required 400/no DB mutation for missing booleans, F-05 is not accepted as written. If product/API owners intend those three DNS flags to be optional, that must be an explicit scope decision and the acceptance criterion revised; this review made no such change.

### Admin Web and audit authorization

The Admin Web provider-workspace test deep-linked a delivery-only principal using `initialTab="providerConfig"`; the component fell back to overview, rendered neither tab nor workspace, did not call provider-config APIs, and omitted the provider quick-jump. Source review confirms `canViewProviderConfig` requires exactly `notification.provider.view`; propose/approve/activate remain gated by the provider configure function plus the maker/checker role. The API's real-PG role matrix was independently exercised. Admin Web checks are component/type/build only, not browser UAT.

For audit reads, the provider-view unfiltered read produced an `ALLOWED` authorization decision for `notification.provider.view`. A targeted read by a caller without that entitlement produced a `DENIED` decision while returning no provider rows. A temporary real-PG composition probe inserted a compliance audit sentinel and confirmed it remained absent from broad provider-view listings and from generic plus exact-entity/entity-ID queries made by unentitled callers; provider audit rows remained inaccessible to compliance-only callers. Authorized scoped provider reads still returned provider records. Both temporary test changes were restored.

## P0 regression gates and unresolved caveats

- **P0-01 — CONDITIONAL PASS.** The focused real-PG compliance authorization suite passed, as did the provider/compliance audit-composition probe. Actor attribution and case/customer/category authorization paths remain as tested in the existing compliance suite; no compliance implementation was edited by the provider remediation. Acceptance stays conditional on unresolved **D-01** (exact role/function scope, per-worker/customer assignment and per-action read grants) and **D-04** (category taxonomy/future-category governance, including AML/SANCTIONS overlap). Current valid function holders remain global within allowed categories; no worker-to-customer assignment check was established. Global case-number uniqueness still permits a cross-customer/category duplicate to reveal a collision via 409. These are open policy/security decisions, not resolved by this code review.
- **P0-02 — PASS, narrow.** The independently run diagnostics suite verified that rendered `message` and raw `last_error` do not appear in the delivery-list response; unknown provider errors map to `UNCLASSIFIED`, with the safe code retained. The UI remains error-code-only. Caveats: rendered messages remain stored in `notification_deliveries` for retry/safety behavior, with retention policy separate; the existing generic `GET /internal/outbox` still projects payload and fixed-code `lastError` to `outbox.view` holders and was outside this diagnostics route's scope. F-01 is a distinct provider configuration/test-send disclosure.
- **P0-03 — PASS.** The focused real-PG limit diagnostics suite passed. Authorization precedes diagnostics reads; read endpoints remain read-only and reservation release remains separately privileged. No existing `limit.view` grant/role membership expansion was observed in the reviewed remediation diff.
- **Maker-checker, MFA, encryption and key rotation.** The provider integration suite independently passed migration 100 constraints, AES-256-GCM ciphertext-at-rest/key-version behavior, key rotation/readiness reset, fail-closed missing-key behavior, SUPER_ADMIN maker / independent FINANCE_CONTROLLER checker, MFA, self-approval denial and secret non-disclosure. Provider audit restrictions also passed. These controls do not mitigate F-01 success-ID leakage or the F-05 omission behavior.

## Independently executed test/build evidence

All commands were run against the exact SHA in `/home/user/independent-review-fe06`; PG integration tests used the embedded local PostgreSQL harness and fake provider transports.

| Gate | Independent result |
|---|---|
| Backend `npx tsc --noEmit -p tsconfig.json` | PASS |
| Backend `npm run build` | PASS |
| Backend full unit Jest suite | **204/204 suites; 2,060/2,060 tests passed** |
| Admin Web `npm run ts:check` | PASS |
| Admin Web full Jest suite | **27/27 suites; 187/187 tests passed** |
| Admin Web `npm run build` | PASS; Vite reported a 1.24 MB minified main chunk (>500 KB advisory) and CJS Node API deprecation warning |
| Focused sequential real-PG regression battery | **10/10 suites; 165/165 tests passed**: provider config, compliance authorization, delivery authorization/diagnostics, limit diagnostics, migration 100 upgrade, delivery/worker/email/registry and operational audit suites |
| Additional targeted probes | Multi-instance F-03 passed; malicious persisted-URL worker retry passed; unauthorized provider-audit read decision passed; cross-compliance/provider audit-filter composition passed; extended malformed-value F-05 probe passed; missing optional-boolean probe **failed acceptance** (3 × 201/proposal insertion); success-providerRef F-01 probe **confirmed disclosure** |
| Full sequential PostgreSQL runner | **30-minute timebox; incomplete.** Five complete batches: 75 suites/1,739 tests passed. Two further suites from the interrupted sixth batch had PASS lines and were rerun: 2/2 suites/32/32 tests passed. Unique confirmed total: 77/122 integration files, 1,771 tests. No completed/rerun test failed; 45 files were not executed in the sequential run. **Do not describe this as a complete suite pass.** |

The integration-record claim of 122 suites/2,331 tests is owner-supplied and was not accepted as independent evidence. These counts above are this review’s runs only.

## Runtime/dependency review

- Backend `npm audit --omit=dev --audit-level=moderate`: **0 production dependency vulnerabilities**. Full backend audit reported 8 low-severity development-tool findings, including `deepmerge` via Jest/Nest CLI; no application changes were made.
- Admin Web `npm audit --omit=dev`: **0 production dependency vulnerabilities**. Full Admin Web audit reported 9 development-tool vulnerabilities (7 low, 1 moderate, 1 high): `deepmerge@4.3.1` prototype-poisoning advisory (`GHSA-gcqx-w48m-w2h4`), `esbuild@0.21.5` dev-server cross-origin request advisory (`GHSA-67mh-4wv8-2f99`), and multiple high-severity Vite advisories affecting the installed `vite@5.4.21` (including `GHSA-9jrq-w75r-8gcw` and related advisories). Production dependency audit was clean; these remain build/test/dev-server supply-chain risks, not evidence of a vulnerable deployed bundle. `npm audit fix --force` proposed breaking major-version changes; no audit fix was applied.
- Admin production build emits a large-chunk warning; consider code splitting separately from this security acceptance. No performance or browser profiling was done.

## Production readiness / release gates — NO-GO

No live Robase, Brevo or Resend requests, real credentials, real DNS or sender-domain verification, production database migration, financial operation, production configuration change, or deployment was performed. Before any staging/production activation, independently complete credential custody and keyring backup/rotation/recovery, governed maker-checker provisioning of real credentials, vendor sender/domain authentication (SPF/DKIM/DMARC), explicit worker/dark-launch decisions, staging test-send with independent approval, monitoring/alerting and incident/revocation runbooks. Notification activation remains off; no mobile work or automatic expired C2C disposition is authorized by this review. Preserve backend/Admin Web before mobile, configurable SMS/email templates, no sensitive transfer credentials in beneficiary notifications, no automatic expired C2C disposition absent an explicit decision, and manual notification retry remains deferred.

**Required next step:** remediate/resolve F-01 and F-05, add permanent regressions for success-response provider IDs and the agreed missing-boolean contract, then submit a new application SHA for fresh acceptance. Keep production at NO-GO until a separate operational readiness review clears the prerequisites above.

---

**Report-only artifact.** No application implementation or persistent test code was changed. This report is committed and pushed only to the existing Arena 4 report branch `arena/870f970d-monienaija`; previous reports and other branches are preserved.
