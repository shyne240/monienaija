# Mission 25F — Independent assessment

**Reviewed:** candidate **`integration/mission-25e-notification-integration`** at **`e0d604fad255629a1362c4ff62abd60eb7f85b6f`**, against accepted baseline **`integration/mission-23-fast-uri-security`** at **`019de996950b07e9312af455ce0d9b840e6e14f1`**.

## Verdict: **FAIL for security/technical acceptance**

The integration structure and notification-specific implementation are largely sound, but I found a **high-severity customer-preference authorization defect** that the UI tests do not cover. It allows authenticated workforce users without the relevant customer-view permission to read—and, for non-read-only users, change—another customer’s preferences through the API. This is not a newly introduced backend regression: the affected controller and generic route policy are unchanged from the accepted baseline. But the integrated Admin Web deliberately presents preferences as restricted/read-only, and the candidate leaves that boundary unenforced at the API. That gap blocks acceptance of this integrated customer-preference surface.

This verdict is **not** a finding that the financial integration is corrupted or that an unauthorized maker-checker action was demonstrated. H-06 and H-07 remain policy/security limitations; H-04 remains safely quarantined but incomplete. Nothing in this review authorizes deployment, provider activation, real sends, or production operations.

## Integration integrity and scope

I verified the exact candidate and baseline pins and reviewed the candidate’s ancestry. The Mission 25C backend and Mission 25D Admin Web arms are present, with their integration merges. The worktree at the candidate pin is clean.

The **37 implementation files** described as the 25C/25D union appear within the expected backend and Admin Web scope. I found no changes to authorization seeds or route-policy code, package/dependency manifests, migrations, or financial ledger/settlement code. The rest of the candidate diff consists of committed Mission 25E report and evidence artifacts: the **full baseline-to-candidate diff is 88 files, +6,455/−979**, not 37 files. The report’s 37-file count describes the implementation inventory, not the complete committed diff; its inventory/diffstat should not be read as a complete candidate-tree count.

The integration preserves the reported 11-role notification-console access model and maker-checker separation: the evidence records 11/11 role logins, role-scoped UI behavior, and independent approval/execution. The integration did not alter the underlying roles or grants. These findings support **integration integrity**, but do not cure the preference API authorization defect.

## Findings

### High — Customer preferences: API access and mutation exceed the UI’s stated boundary

The Admin Web intentionally withholds preference data from **`CUSTOMER_SERVICE`** and makes no request. Its browser evidence shows that behavior; it does **not** establish API authorization. Mission 25E separately records **`CUSTOMER_SERVICE`** receiving **HTTP 200** from the direct preference API.

Source inspection shows the problem is broader than the report’s characterization:

- **`CustomerPreferenceController`** has unauthored **`POST`**, **`GET`**, **`PATCH`**, and history handlers with no action-level function check (**`src/customer-preference/customer-preference.controller.ts:11–29`**).
- The generic **`/api/v1/customers/:id`** route allows **`CUSTOMER`**, **`OPERATOR`**, **`SERVICE`**, and **`PRIVILEGED`**, but declares no **`requiredFunctions`** (**`src/authorization/route-policy-registry.ts:419–432`**).
- For a route with **`customerAccess: 'SELF'`**, **`AuthorizationService.checkCustomerScope()`** accepts a non-**`CUSTOMER`** principal after the route’s principal-type gate; it does not bind that workforce principal to the target customer (**`src/authorization/authorization.service.ts:258–290`**).
- The GET response includes notification opt-ins, security-alert and biometric settings, language/theme, version and timestamps; history exposes prior/new values and its recorded actor (**`src/customer-preference/customer-preference.service.ts:259–300`**).
- The create/update DTOs accept an **`actor`** supplied by the request (**`src/customer-preference/dto/create-customer-preference.dto.ts:23–27`**; **`update-customer-preference.dto.ts:42–46`**). That actor is used in audit/history writes (**`customer-preference.service.ts:39–45, 112–118`**).

**Exploitability:** a workforce principal of an allowed type can address another customer’s ID directly. The source policy therefore reaches roles without **`customer.view`**; the existing customer-read regression suite tests **`/customers/:id`** and **`/profile`**, not these preference routes. Non-read-only workforce users can also reach preference creation/update without a preference-specific function gate. A read-only safeguard protects read-only principals from unsafe methods, but does not protect the other workforce roles.

The write impact is not merely a UI inconsistency: an operator can alter customer communication/security settings and supply the audit actor string. This may suppress preference-aware ordinary notifications where those preferences are consumed. I do **not** infer from this that the three H-06 events are currently mandatory or that these settings disable mandatory security OTPs.

**Required before acceptance:**

- **Arena 1 — backend:** after product authorization decisions, enforce explicit policies on preference GET, history, POST, and PATCH. Bind customer access to the authenticated customer or an explicitly authorized workforce scope; do not let generic **`SELF`** grant workforce access to arbitrary IDs. Derive the audit actor from the authenticated principal, not the request body. Keep customer self-service separate from workforce operations. Add API regression tests for unauthorized reads, history, create, update, cross-customer IDs, spoofed actors, and the approved role’s exact access.
- **Product/security owner:** decide which workforce roles, if any, may read these fields; whether history is separately restricted; and whether workforce users may modify customer-controlled preferences at all. Do not simply copy the current broad API policy or infer that the UI restriction is approved policy.
- **Arena 2 — Admin Web:** retain or adjust the UI gate only after that policy is ratified; UI hiding is not a substitute for server authorization.

The UI’s **`customer.view`** gate and **`CUSTOMER_SERVICE`** exclusion do not create an API boundary. Also, the accepted catalogue describes **`customer.view`** as profile/KYC-tier access, not necessarily authorization for these preference and security-alert fields.

### H-06 — Ordinary-event locks: real policy divergence, not an authorization bypass

Backend seeding sets ordinary notification configurations to **`is_locked=false`**; the SECURITY defaults are seeded locked (**`src/notification/notification-defaults-v1.ts:146–178`**). Backend proposal and execution paths enforce the database lock only when **`is_locked`** is true (**`src/notification/notification-registry.service.ts:298–303, 485–490`**).

The Admin Web statically labels these events locked:

- **`customer.funding.approved`**
- **`customer.funding.rejected`**
- **`transfer.completed`**

(**`apps/admin-web/src/services/notification-domain.ts:1134–1165`** and the corresponding transfer entry.)

The API probe for funding-approved SMS returned **201**, creating a proposal that the harness deliberately left unapproved and unexecuted. Separately, the existing PostgreSQL registry test explicitly exercises approving and executing a disable of **`customer.funding.approved`**, then verifies delivery suppression/retry behavior (**`test/notification-registry.integration.spec.ts`**, “enforces event toggles…”). So the backend can ultimately disable it through its ordinary governed flow.

**H-06 verdict: unresolved product/governance decision.** The maker still needs the authorized permission and MFA, and an independent checker must approve and execute. This is not demonstrated privilege escalation. If the owner rules any of these outcomes mandatory, however, allowing a checker-approved disable would be a consequential policy-enforcement gap. The UI cites D-N8, but the inspected Mission 25A/C contract material says D-N8 is unresolved; I found no approved source that establishes those three as mandatory.

**Product owner/Arena 3 must decide, per event and channel:** whether the trigger is globally non-disableable or configurable; which recipient/outcome is covered; and whether “mandatory” concerns global event configuration, customer channel opt-out, or both. The current UI itself distinguishes funding-approved SMS opt-out from other required outcome wording, so that distinction needs an explicit decision.

Then:

- **Arena 1:** if mandatory, enforce the lock in the backend at both proposal and execution, including existing rows and pending approvals; changing only seed defaults would not update rows already present. Add tests for rejected new proposals and stale/pending proposals at execution. If configurable, preserve the governed maker-checker path.
- **Arena 2:** make the UI reflect that approved backend policy. Remove the static mandatory-lock claim if the owner decides the events are configurable; otherwise show the backend-enforced lock.

The reported real-HTTP probe establishes proposal creation, not HTTP execution of the H-06 proposal. The existing PostgreSQL test supplies the execution evidence.

### H-07 — `ENV_SECRET` approval does not bind the exact credential

At proposal time, the service computes a masked four-character fingerprint and includes that value in the action fingerprint (**`src/notification/notification-provider-config.service.ts:1050–1063, 1072–1085`**). At activation it rereads the environment secret and stores a fingerprint for the then-current value, but consumes the checker approval using the stored proposal action fingerprint; it does not verify that the currently resolved secret matches the credential proposed for approval (**`:1447–1476`**). At runtime, **`resolveRowSecret()`** rereads and format-validates the environment secret but does not compare it to the stored row fingerprint (**`:2516–2528`**).

Thus, after an **`ENV_SECRET`** proposal is approved, a different valid-shaped environment secret could be activated or used at runtime without a new approval binding that exact secret. This is a **conditional credential-integrity/approval bypass** for an external provider configured with **`ENV_SECRET`**, not evidence that a secret was exposed or that any provider was live in this review.

**H-07 verdict: unresolved, and a production-use blocker for `ENV_SECRET`.** Mission 25E’s fail-closed evidence is useful for the *unconfigured* provider case. It does not prove exact-secret binding or safe rotation.

- **Arena 1/security:** design a separately reviewed binding and rotation flow. Bind approval to an immutable secret-manager version or a cryptographic keyed fingerprint of the exact secret; compare that binding at activation and runtime; fail closed on mismatch. Require a new governed approval to rotate, and reset/reverify readiness when rotating.
- Add regression tests for secret change between proposal and activation, change after activation, same-secret activation, successful governed rotation, missing/invalid secret, and no outbound request on mismatch. Do not treat a last-four display fingerprint as cryptographic proof.

### H-04 — Deposit/withdrawal notification coverage remains safely quarantined

The four events **`deposit.completed`**, **`deposit.failed`**, **`withdrawal.completed`**, and **`withdrawal.failed`** have producer-side financial facts, but no notification catalogue/mapping or approved customer-recipient/content contract. The integration reports them absent from the catalogue and refuses a configuration proposal for **`deposit.completed`**. Its consumer evidence directly probes **`deposit.completed`** and **`withdrawal.failed`**, which are quarantined as **`EVENT_TYPE_UNSUPPORTED`** with zero delivery rows. Source inspection confirms no mapping for the four named events; the committed end-to-end quarantine evidence is for two representative events, not four separate dynamic probes.

**H-04 verdict: safe containment verified; feature incomplete and policy-blocked.** No notification was invented. Before implementation, the product owner/security and event owners must decide, for each event: recipient(s), channels, customer opt-out treatment, approved content and disclosure fields, and which service owns the event/notification contract. Do not infer that a journal ID, provider failure code, or transaction payload is customer-safe. **Arena 1** should add mapping only against that approved contract and test all four facts for quarantine before approval and correct delivery behavior afterward. Until then, retain quarantine and no provider activation for these events.

## Test evidence and confidence

The candidate evidence reports:

- Backend unit/regression: **228 suites / 2,701 tests**
- PostgreSQL matrix: **131 suites / 2,433 tests**
- Admin Web: **37 suites / 284 tests**
- Notification API: **61/61**
- Notification console browser: **57/57**
- Customer-preference browser: **8/8**
- Backend/Admin Web type checks and builds: reported clean

These counts are from the committed Mission 25E evidence; I reviewed the summaries and probes but did not rerun the suites. The backend dependency directories are absent in the detached review worktree. I therefore treat those results as reported evidence, not my own executions.

The evidence is credible for the specific covered behaviors—maker/checker, console role rendering, simulated delivery, fail-closed unconfigured provider, and quarantine—but it does **not** demonstrate complete end-to-end notification readiness:

- The 8/8 preference browser checks prove that the UI does not fetch preferences for **`CUSTOMER_SERVICE`**; they do not test the direct API authorization. The API matrix’s preference checks are not a multi-role authorization matrix.
- H-07 tests found in the candidate cover governed **`ENV_SECRET`** routing with a fake transport, not exact credential binding across approval/activation/runtime rotation.
- H-04’s HTTP/config evidence probes **`deposit.completed`**; outbox-consumer evidence covers two of the four unsupported financial events.
- No real vendor send, vendor account, sender-domain/DNS verification, receipt, bounce, or complaint path was exercised. Console simulation is not delivery.
- The report records six initial harness assertion failures and says they were corrected. Final **`61/61`** API and **`57/57`** browser result files are green, and the main browser harness uses row-level receipt assertions. However, the committed auxiliary **`browser-recheck-results.json`** still records **11/12**, with a failure caused by reading the whole section’s text—including status-select option labels—to decide whether a filtered result contains **`MATERIALIZED`**. That is a harness false positive, not evidence of a product filter failure; the row-level quarantine evidence reports three quarantined rows and no materialized row. It does leave a non-passing recheck artifact that should not be represented as a clean rerun.
- The candidate’s summary files report larger suite totals, but the raw unit/PG logs they reference are outside the committed evidence directory.

## Deferred capabilities and release restrictions

H-04 event coverage, independent in-app delivery policy, Agent recipient resolution, PUSH tokens/provider, customer opt-out editing, manual retry execution, receipt ingestion, and bounce/complaint automation remain deferred or incomplete in the candidate evidence. These are not delivered by the console simulation or by provider fail-closed tests.

**Production authorization: not granted.** Do not deploy this candidate as accepted customer-preference functionality until the API authorization defect is corrected and covered. Do not activate an external provider using **`ENV_SECRET`** until H-07 binding/rotation is resolved. Do not claim the three H-06 events are locked until D-N8 is decided and enforced consistently. Keep H-04 events quarantined until their notification policy is approved.

**Final disposition:** integration provenance and implementation scope are broadly sound, but the unresolved high-severity preference API exposure means the candidate **fails security/technical acceptance** as reviewed. No code, schema, policy, deployment, provider, or financial-boundary changes were made during this read-only assessment.