# MONIENAIJA ONE — Controlled staging acceptance

## Decision: NOT YET ACCEPTED — BLOCKED

Audit baseline: **`c598790193a128e8b4f5b39d893833cb40109b24`**. Frontend fix candidate: **`092ffd392e170e77578d6c02e2e9f36a5671abae`**; backend candidate: **`c598790193a128e8b4f5b39d893833cb40109b24`** (backend, root dependencies and Dockerfile unchanged at the frontend commit). For a single-checkout deployment both may be built at the frontend candidate SHA; neither candidate establishes a deployed version. **No staging endpoint or identity has been supplied, and no staging access, provisioning, deployment, mutation or external delivery has been attempted.** There is no staging acceptance or production-release decision. An unknown condition below is **blocked/unverified**, not an asserted failure.

The previous [final acceptance audit](FINAL-ACCEPTANCE-AUDIT.md) is local synthetic evidence only. The historical infrastructure audit describes an embedded/local environment and an unresolved proposed public hostname; it does not establish a currently available hosted staging deployment or present isolation. The historical local verification directory is not present here. Older claims that the backend lacks CORS are superseded by current configurable exact-origin CORS (`src/production/http-security.ts`); neither source nor historical documents verify effective staging configuration. Local Compose and the ignored local environment file are not evidence of staging; the latter was not used.

## Repository and GitHub deployment inventory (read-only)

| Item | What is actually configured or observed |
|---|---|
| Environments | `NODE_ENV` supports development, test, staging and production (`src/config/environment.ts`); these are application profiles, not evidence of separate hosted environments. `.env.example` is a template, not live configuration. The ignored local `.env` was not read or used. |
| Hosting / workflows | No provider-specific frontend/backend deployment, IaC, DNS, TLS, container registry or hosted infrastructure configuration was found in the tracked working tree. Root `Dockerfile` builds a Node 22 Alpine backend image with `npm ci`, non-root runtime and `/api/v1/health` liveness; it does **not** host the Admin SPA. `.github/workflows/ci.yml` tests/builds only, including an ephemeral PostgreSQL 16 CI service; it does not deploy. GitHub lists CI and a separate temporary diagnostics workflow (the latter is not present in this checked-out tree); neither is evidence of a deployment. |
| Database | `docker-compose.yml` defines local PostgreSQL 16 with a persistent local volume and published port, not isolated staging. Backend configuration uses `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` and `DB_SSL_REJECT_UNAUTHORIZED`; `src/config/database.config.ts` disables `synchronize` and `migrationsRun`. Migrations are explicit operations, not authorized here. |
| GitHub metadata | GitHub API returned **zero repository environments and zero deployment records** accessible to this integration, and repo homepage is unset; Pages reports disabled/404. Repository Actions variables and secrets metadata returned **403 permission denied**; their contents or even names cannot be inferred. A deployment outside GitHub, an unregistered environment, or inaccessible resources may still exist. |
| Existing references | `docs/V1/V1-INFRA-01-STAGING-DEPLOYMENT-AUDIT.md` describes historical embedded PostgreSQL and local backend; `docs/V1/V1-AGENT-MOBILE-16-STAGING-DEPLOYMENT-UAT.md` proposes `https://staging-api.monienaija.ng`, explicitly unresolved at that time. This turn did not contact it, verify DNS, or establish its current status. Mobile EAS preview configs contain `.example.invalid` placeholders, not deployment URLs. No current staging URL or deployed SHA can be established from available evidence. |

## Reproducible staging candidate and isolation design — proposal only

- **Version:** exact audited backend source candidate is `c598790193a128e8b4f5b39d893833cb40109b24`; the frontend candidate is **`092ffd392e170e77578d6c02e2e9f36a5671abae`**, the baseline plus the tested API-client fix. Before any proposed build/deployment, confirm a clean checkout and build both artifacts from that frontend SHA (backend source is unchanged by this fix), or use the stated backend baseline for the backend; record image/artifact digests, lockfiles, exact Node/npm and builder image digest, effective non-secret settings and migration head. Do not represent baseline `c598790` as containing the fix. The prior browser sweep and local build are not deployed-artifact evidence.
- **Build approach:** backend root `npm ci && npm run build` / root `Dockerfile`; Admin Web `cd apps/admin-web && npm ci && ADMIN_WEB_API_BASE_URL=/api/v1 ADMIN_WEB_DEV_AUTH_MOCK=false npm run build`. The frontend imports shared root source and requires the complete checkout. Pin exact toolchain/image digest and preserve both lockfiles; validate no unintended `ADMIN_WEB_*` env files override the intended input. Docker build context must be reviewed for secrets: `.dockerignore` excludes `.env` but not every possible `.env.*` filename. Never put secrets into images, build args, artifacts, logs or this report. These commands describe a future reproducible process; no staging build or deployment was performed.
- **Routing:** recommended private/restricted HTTPS Admin SPA origin and reverse proxy forwarding `/api/v1` unchanged to the staging backend, with `ADMIN_WEB_API_BASE_URL=/api/v1`; the Vite dev proxy is not a deployed reverse proxy. If separately hosted, use the explicitly approved HTTPS API base and exact `HTTP_CORS_ORIGINS_JSON` frontend origin; never use wildcard CORS or assume existing routing. `/api/v1/health` is public liveness; `/api/v1/internal/readiness` and operational routes require authorized `internal:access` (see `docs/DEPLOYMENT.md`).
- **Profile/configuration:** `NODE_ENV=staging`, `API_VERSION=v1`, `APP_VERSION` pinned to immutable application SHA; explicitly disable `NOTIFICATION_WORKER_ENABLED`, `CASH_TO_CASH_EXPIRY_WORKER_ENABLED`, `A6_PARTNER_ENABLED` and `POA_UPLOADS_ENABLED` initially, use `NOTIFICATION_EMAIL_PROVIDER=none`; for staging SMS use `NOTIFICATION_SMS_PROVIDER=console` only if owner approves simulated non-delivery and all direct paths are assessed. The current console adapter logs a simulated event, not the payload; other code paths/logging must still be reviewed. The production profile rejects console SMS and staging must not weaken production safeguards. Do not configure live provider credentials or activate managed provider configuration. These flags are defense in depth, **not proof** all sends, schedulers or direct side effects are disabled.
- **Isolation:** separate network/project, service accounts/secrets, synthetic-only PostgreSQL, queues, caches, object storage and audit/log sinks; no production routes or credentials. Require verified TLS with `DB_SSL=true` and `DB_SSL_REJECT_UNAUTHORIZED=true` where supported. Deny outbound network by default at infrastructure boundary, allow only specifically needed isolated DB and approved staging identity/JWKS/DNS/observability endpoints; deny real financial, notification, webhook and provider destinations, including retries. Confirm no direct or asynchronous side-effect path escapes; restrict or block dangerous routes independently of application roles. Initial synthetic fixtures are prepared only after explicit approval, never copied from production. POA remains blocked until a separately approved isolated storage/scanner/key design is verified.
- **Identity and safety:** staging OIDC issuer/JWKS/audience/client and role/policy config require a policy-compliant isolated identity service; local-admin seeding/login are restricted to development/test by `src/local-admin-authentication`, not a staging shortcut. A00 remains policy-blocked. No change to bypass authentication, maker/checker or policy gates. Config validation, risk assessment, synthetic data, migration run, identity/bootstrap, egress rules, deployment and runtime verification each require their own appropriate approval and operator. Configuration values and provider/platform remain unverified and cannot be honestly specified exactly until the inventory identifies a target.

The compatibility note in `docs/design-discovery-20261029/m1/acceptance/integration-prep.md` recorded earlier wider-guard test failures. The current local tests explicitly configure `/api/v1` for those multipart/blob tests, retain the full POA component suite, and test an absolute base as well. No UI or POA authorization behavior was weakened. The normal full suite passes; when forced to `NODE_ENV=production`, the three API-client suites passed (9 tests) but the React POA component suite cannot run because production React does not support the testing library's `act()`; it passed in the standard Jest test environment. No real upload/download or deployed production-bundle browser test was performed.

## Staging availability and indicative cost

**Availability: unknown, not verified absent.** GitHub currently returns zero visible deployment records and zero repository environments, and no hosting/DNS connection is identified. This excludes a GitHub-recorded deployment in the visible metadata, not an independently deployed service. Reuse cannot be recommended until its owner demonstrates synthetic-only data, isolation, side-effect controls and correct artifact SHAs. A new environment is only a contingency if that review finds no safe reusable one; its necessity is not established.

An illustrative, single-instance, non-HA option — **not a provider selection or authorization** — is a separate DigitalOcean project/VPC with one 2 GiB/1 vCPU Droplet hosting the backend, reverse proxy and static SPA, plus separate managed PostgreSQL restricted to the staging app. Limit HTTPS ingress to approved operator networks; do not expose database or unrestricted admin SSH. Use a staging-only identity/SSO integration and secrets, default-deny outbound rules with only verified staging dependencies, disable integrations/workers and provision only synthetic data. Review all public and private IPv4/IPv6 paths; DigitalOcean [documents](https://docs.digitalocean.com/products/networking/vpc/how-to/add-resources/) cloud-firewall coverage of VPC traffic and separately recommends database VPC/trusted-source restrictions. Default console firewall suggestions allow outbound traffic, so explicit restrictive rules and independent validation are essential ([documentation](https://docs.digitalocean.com/products/networking/firewalls/getting-started/quickstart/)). Deployments, database migrations, firewall changes and identity/fixture setup remain unauthorized.

| Example recurring charge, USD | Monthly assumption |
|---|---:|
| 2 GiB/1 vCPU basic Droplet | $12.00 ([provider pricing](https://www.digitalocean.com/pricing/droplets)) |
| Small single-node managed PostgreSQL | from $15.00 ([provider pricing overview](https://www.digitalocean.com/resources/articles/digitalocean-vs-linode)) |
| Optional weekly Droplet backups at 20% | $2.40 ([provider pricing](https://www.digitalocean.com/pricing/droplets)) |
| **Illustrative total** | **from $27.00/month**, or **$29.40 with weekly Droplet backup** |

This is an indicative 24/7 base estimate, not a quote: confirm region, availability, resource sizing and current provider prices. It excludes tax, domain/DNS, identity/SSO, VPN or access gateway, logging/monitoring, additional storage, egress above included allowances, disaster recovery/HA and operator time. App VM sizing is untested; a production-grade or independently isolated access gateway can increase cost substantially. Database backup/restore and retention, TLS, access and egress controls must be designed and verified, not assumed from price. No provider account was accessed and no purchase, provisioning or deployment occurred.

## Current evidence and boundaries

| Check | Local result | Staging status |
|---|---|---|
| Source/build | Before the fix, 12 selected Admin Web suites / **159 tests passed**. After the fix, the full Admin Web suite passed **83 suites / 852 tests**; `npm run ts:check` passed. Production build passed with hypothetical `ADMIN_WEB_API_BASE_URL=/api/v1` and `ADMIN_WEB_DEV_AUTH_MOCK=true`; source/tests specify mock is disabled for builds. Not evidence of a deployed build or actual runtime route. | BLOCKED: deployed SHA, artifact, build inputs, routing, origin, authentication and mock status unknown. |
| Backend security unit tests | 4 suites / **86 tests passed**: `test/http-security.spec.ts`, `test/production-readiness.spec.ts`, `test/report16-redaction-hardening.spec.ts`, `test/sensitive-data-redaction-adversarial.spec.ts`. Test mode, notification and cash-to-cash expiry workers disabled, test network guard enabled. Unit behavior is not a staging configuration or end-to-end security finding. | BLOCKED: deployed enforcement, policies, redaction and CORS unknown. |
| Prior browser/roles | [Synthetic manifest](evidence/final-acceptance/manifest.json): source `1a893d3`, 28 destinations × 1440/768/375, seven role-menu inventories, 18 interaction types at each width, sampled 401/403. [Provider retest](evidence/final-acceptance-provider/manifest.json) at `a97a0dd`. Screenshots and results are **not staging evidence**. | BLOCKED: none of the 28 or staging roles has been exercised. |
| Session/identity | Local API-client test exercises simulated 401 and clearing stored session. Production builds disable development mock. | BLOCKED: real identity, expiration, invalidation and direct API behavior unknown; A00 production sign-in remains policy-blocked. |
| Build size | Local build main JS **1,631.74 kB**, **433.27 kB gzip**, >500 kB Vite warning. | BLOCKED: no actual staging latency, transfer, error or device measurement. Size alone is not a measured performance regression. |
| Database and side effects | CI config is an isolated test setup, not staging evidence. Worker defaults/source do not prove effective settings. | BLOCKED: DB target, absence of production data, separation of queues/object storage/secrets, worker and integration/egress controls unverified. |
| Workflow/a11y/visual | Prior synthetic browser and unit evidence only. | BLOCKED: real staging writes, independent approvals/audit/recovery, physical devices, assistive technology and owner visual sign-off. |

Reproduce local checks from repository root (no staging contact):

```sh
(cd apps/admin-web && npm test -- --runInBand __tests__/production-auth-safety.test.ts __tests__/local-dev-api-config.test.ts __tests__/auth-store.test.ts __tests__/api-client.test.ts __tests__/api-client-request.test.ts __tests__/menu-visibility-11-roles.test.tsx __tests__/m2-system-audit.test.tsx __tests__/m2-dashboard-settings.test.tsx __tests__/m2-recovery.test.tsx __tests__/provider-configuration.test.tsx __tests__/notification-management.test.tsx __tests__/workspace-filter-overflow.test.tsx && npm run ts:check && ADMIN_WEB_API_BASE_URL=/api/v1 ADMIN_WEB_DEV_AUTH_MOCK=true npm run build)
NODE_ENV=test NOTIFICATION_WORKER_ENABLED=false CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false NODE_OPTIONS="--require $PWD/test/support/mission-25c-network-guard.cjs" npx jest --runInBand test/http-security.spec.ts test/production-readiness.spec.ts test/report16-redaction-hardening.spec.ts test/sensitive-data-redaction-adversarial.spec.ts
```

## Findings and retest ledger

Severity is provisional, not a staging incident assertion. P0/P1 = urgent security/operational release stop, P2 = material functional or configuration risk, P3 = lower-impact concern. Any failure of the mandatory isolation/authorization gates stops acceptance regardless of severity.

| ID | Severity | Finding / evidence | Disposition and retest |
|---|---|---|---|
| S-01 | **P2 conditional** | At `c598790`, unset API base made ordinary JSON reject, but form and blob requests used same-origin `/internal/...`; the POA panel uses both. Reproduced locally with mocked fetch and a failing regression test; no staging exploit was established. | **Fixed in the frontend candidate, not deployed.** The same guard now applies to all three paths. Tests cover unset base without fetch and configured relative/absolute URLs, form headers/body/idempotency/signal, blob headers/signal, and 401 session clearing. Full Admin Web suite passes. Explicit correct deployed API base and proxy remain required. Staging retest blocked. |
| S-02 / F-05 | P3 | Large local production JS chunk; Vite warning above. | Open for profiling; capture actual staging timings before choosing code splitting. Not alone a staging rejection. |
| S-03 | Decision blocker, not graded as defect | Current staging existence/topology/SHA, safe isolation, approved identities and egress safeguards are unknown. | Obtain owner attestation plus independently reviewable, non-secret evidence, then run gates below. Do not interpret the absence of evidence as verified safety. |

Prior fixed items F-01–F-04 and product/backend dependencies are recorded in the [final audit](FINAL-ACCEPTANCE-AUDIT.md). Unified action counts/flagged queue, agent/support free-text global search and support assignee directory remain backend dependencies. Policy blocks A00, E05, E08 and E09 remain in force. No owner visual acceptance has been granted.

## Gates before any environment access

An authorized staging owner must provide and attest, with non-secret evidence:

1. Staging URL, API base and routing/topology, environment owner, access window and approved access route; deployed frontend/backend artifact SHA and build provenance. Compare both with the target SHA and document intentional differences. If deployment is required or the target differs, **propose the exact deployment action and stop for separate approval**; do not deploy automatically.
2. Database/environment identifiers and independent evidence of a dedicated isolated staging database, containing only synthetic/non-production data, with no production read/write route, shared credentials, queues, caches, buckets, webhooks or tenants that could reach production. Confirm safe backup/restore and cleanup owner; do not put connection strings or secrets in this report.
3. Effective backend and frontend configuration, not just defaults: configured API base and same-origin proxy or exact allowed CORS origin, authentication issuer/audience and account isolation, production-build mock disabled, audit and redaction configuration. Provide redacted configuration/provenance, not tokens or secret values.
4. Effective worker/scheduler, outbound network, provider and integration inventory and controls. Demonstrate that notifications, provider activation, real payment/financial routes, real messaging, external webhooks and other unintended delivery are disabled or safely stubbed and cannot escape, including retries/queues/schedulers. Merely disabling two named workers is insufficient. If any action could reach a live provider or production data, stop.
5. Explicit approval for the read-only scope below (including authentication/session creation and normal audit/log entries), and separately for the exact disposable provisioning and each proposed staging mutation. Provide disposable role accounts via a secure channel, not chat/report; do not create accounts or change permissions until specifically approved. If no appropriate policy-compliant staging identity path exists, record blocked rather than bypassing A00.

## Execution matrix — all staging work blocked

For each destination: use the listed authorized role as the baseline, verify expected navigation, read-only data/API contract and safe empty/loading/error behavior; then test an appropriate lower-privilege role for hidden navigation and server-side denial. A visible menu is not an authorization check. Compare allowed/denied expectations with the actual role/scope policy, not just the synthetic manifest. Cover 1440/768/375 widths and record status, timestamp, deployed SHA, role, sanitized request path/status and evidence reference. The listed baseline roles reproduce the previous local coverage, not a claim of exclusive access. More role combinations may be required by policy.

| Destination (manifest key) | Baseline role | Authorized staging read | Restricted/direct API check |
|---|---|---|---|
| `dashboard` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `dashboardSettings` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `customers` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `agents` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `agentClasses` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `support` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `transfers` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `cashIn` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `cashOut` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `cashToCashOps` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `ledgerExplorer` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `reconciliation` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `feeRules` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `commissionRules` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `rewardRules` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `productCatalogue` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `limitCatalogue` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `limitAssignments` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `kycQueue` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `complianceCases` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `workforceAccess` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `roleGovernance` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `notifications` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `systemHealth` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `auditEvents` | `SUPER_ADMIN` | BLOCKED | BLOCKED |
| `approvalsInbox` | `FINANCE_CONTROLLER` | BLOCKED | BLOCKED |
| `superAdminRecovery` | `ADMINISTRATOR` | BLOCKED | BLOCKED |
| `fraudCases` | `RISK_FRAUD` | BLOCKED | BLOCKED |

Representative additional roles: `OPERATIONS`, `CUSTOMER_SERVICE`, `COMPLIANCE` and `FINANCE_CONTROLLER`, plus `SUPER_ADMIN`, `ADMINISTRATOR` and `RISK_FRAUD`; include any policy-required roles/scopes not covered. Use the manifest's role inventories as a local comparison only. For each, record actual permission set and intentional differences. Never elevate a role or expose restricted data to make a test pass.

## Authorized read-only test protocol

After gates and explicit read-only approval only:

- Confirm browser origin and non-secret build metadata against approved target; inspect network requests to verify intended staging API only, no production origins or unintended external destinations. Do not enable routes or alter headers to bypass controls. Stop immediately on any unexpected destination or real-data exposure.
- Authenticate via the approved staging path for each disposable identity; verify failed login safely, logout, refresh and expiry using an owner-provided short-lived session or natural expiry. Verify server rejection after expiry/revocation, client session removal, safe reauthentication and lack of sensitive cached data. Logout/session issuance can create records and are included in the access approval. Never store credentials, bearer tokens, cookies or raw personal information in evidence.
- For each representative role, directly request approved read-only endpoints with no token, expired token and insufficient role/scope, and exercise the UI. Expect policy-appropriate 401/403, no sensitive body and no forbidden data. Check approved object-level cross-scope access and redaction in response, UI, audit/log views and exports only where permitted; use synthetic fields. Do not attempt privilege escalation, fuzzing or penetration tests beyond agreed requests.
- Use approved safe test responses or observe naturally occurring staging failures to check 401/403, unavailable API, timeout, loading, empty and retry states without changing infrastructure or inducing disruption. Record expected/actual status, correlation ID if safe and sanitized screenshot; avoid retrying writes or operations with uncertain outcomes.
- Inspect keyboard Tab/Shift-Tab, visible focus, Escape and focus return, dialog containment, scrollable tables/filters, labels/errors and responsive layouts. Check 1440, 768 and 375 viewport widths, supported browser versions and actual zoom; separately schedule physical desktop/tablet/mobile and screen-reader checks (e.g. VoiceOver/Safari and NVDA/Firefox or Chrome where available). Headless emulation is not a substitute. Document browser/device/AT version and failures.
- On the actual production artifact, record cold/warm page load, API latency/error rate and bundle/network transfer using agreed test device/network and thresholds; note sample count, browser, cache and deployment SHA. Check accessibility and owner visual comparison to [approved references](reference/). Avoid repeated load or stress testing without separate authorization.

## Disposable fixture and mutation proposal — separate approval required

This is a plan, **not an instruction to provision or execute now**. Owner first chooses specific supported, non-financial workflows with no external effects and verifies all prerequisites above. Do not use any disabled/policy-blocked action or enable real providers. If a workflow cannot be shown safe, leave it blocked.

1. Owner approves a unique run ID, narrowly scoped fixture inventory, API routes/actions, expected effect, audit visibility and cleanup method. Provision only through approved staging-supported mechanisms, never production or shared identity. Use fabricated records with reserved non-deliverable contacts; no production copies, real accounts, real funds or external messages. Keep a private owner-held mapping of IDs; include only redacted references in evidence.
2. Provision distinct disposable maker and checker identities with the minimum allowed scopes and an unauthorized control identity; neither may share the same principal. Add only the minimum synthetic record(s) required for one reversible, approved governed draft/proposal and its independent review. Confirm the checker is permitted, maker cannot approve their own action, and direct API checks enforce the same rule. Do not change workforce policy itself to create coverage.
3. Before each mutation, recheck environment/tenant/record ID, endpoint, selected principal, safeguards, expected before state and owner approval. Exercise cancellation and required confirmation/reason first; submit only the exact approved safe draft. Verify receipt, state, actor, timestamp, correlation, reason and immutable audit record with redacted evidence. Attempt only the specifically approved negative maker-as-checker check; then approve/reject using the separate checker only when explicitly authorized. No real financial operation, provider activation or notification send.
4. For conflict/uncertain outcomes, inspect current record and audit independently; do not blindly retry. Only test idempotency, concurrency, failure or recovery if the owner has approved a specific safe staging method and its cleanup. Recovery execution, privilege changes and destructive restore need their own explicit approval; otherwise validate documentation/read-only state and mark execution blocked.
5. Verify approved cleanup/expiry of disposable data and sessions and audit preservation with the owner. Record before/after identifiers, approvals, timestamps, outcomes, cleanup status and outstanding artifacts, without secrets. If cleanup is unsafe or unsupported, stop and escalate rather than delete audit or shared data.

## Closure criteria and requested next action

Acceptance requires: all environment and side-effect gates evidenced; target deployment verified; each matrix entry executed or explicitly dispositioned by the owner; representative role/session/direct API/redaction results; separately approved safe workflow and audit/recovery evidence or formally accepted exclusions; responsive, keyboard, device/AT and owner visual review; measured performance/API errors; and every finding assigned, fixed/retested or explicitly accepted by an authorized owner. Capture sanitized evidence links and mark each check PASS / FAIL / BLOCKED / NOT APPLICABLE with rationale. Current status of **every staging check is BLOCKED**, not passed.

**Next action:** the user has authorized strictly read-only hosting/DNS inventory, but no hosting or DNS provider connection or account has been identified in the available repository metadata or conversation. Identify the provider/account and make an approved read-only connection available, or have its owner provide the non-secret staging inventory. No secrets or credentials are requested. Repository Actions variables/secrets metadata returned permission denied; do not bypass it. Once the inventory establishes whether staging is reusable, separately approve the exact target, source SHAs, configuration, costs and any provisioning/deployment; later approve authentication/read checks and named synthetic mutations. Do not act on the historical hostname or assume an environment exists.
