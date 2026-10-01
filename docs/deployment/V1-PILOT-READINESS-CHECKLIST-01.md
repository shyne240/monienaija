# V1-PILOT-READINESS-CHECKLIST-01 — Production/Pilot Configuration & Verification

**Scope:** the five deployment blockers outstanding from `docs/uat/V1-UAT-FINAL-01.md`
(V1 UAT CONDITIONALLY PASSED): **UAT-CFG-001 (Robase SMS), UAT-CFG-002 (notification worker),
UAT-CFG-003 (sender identity), UAT-CFG-004 (workforce OIDC + bootstrap lockdown),
UAT-CFG-006 (pilot limits).**
**Tested/final code state:** `bae409f` (fix) + `01ca859` (final UAT report); branch
`arena/01a0d883-monienaija`. Every variable name and mechanism below is taken from the repository —
`src/config/environment.ts`, `src/notification/`, `src/authorization/`, `src/limit-catalog/`,
`src/pilot/`, `docs/deployment/config/v1-workforce-bootstrap.env.template`, `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`.
No application/configuration/secret was changed by this task. **No secrets or real values appear
in this document.**

**Legend:** **[REQUIRED]** must exist before pilot · **[OPTIONAL]** safe to omit (defaults shown) ·
**[DECISION REQUIRED]** needs an explicit business/compliance/operations decision — no safe
default exists and none is assumed here.

---

## A. Pre-deployment prerequisites

1. **[REQUIRED]** Deployment target reachable; `npm ci`; `npm run build`; database provisioned.
2. **[REQUIRED]** Migrations applied explicitly — migrations are **not** auto-applied:
   `npm run migration:run` (expected head `1785753600079-AddCustomerCredentialRotation`, 80-chain).
3. **[REQUIRED]** `NODE_ENV=production` set — this is also a security control: the workforce
   `mock-sandbox-token-*` bypass is disabled only when `NODE_ENV=production`
   (`src/authorization/workforce-oidc.service.ts`), and bootstrap JWKs/statements bind to this value.
4. **[REQUIRED]** `A6_PARTNER_ENABLED=false` (V2 NIBSS rail stays inert — CFG-008 sentinel, already UAT-PASS).
5. **[REQUIRED]** `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` reachable; `DB_SSL` per policy
   (`DB_SSL_REJECT_UNAUTHORIZED` default true).
6. **[REQUIRED]** A controlled operator host with this repo for the bootstrap ceremony (offline
   after checkout), a change-ticket reference, a fresh nonce (`openssl rand -hex 16`).

## B. Environment variables / configuration

### B.1 SMS provider (CFG-001)
| Variable | Class | Notes |
|---|---|---|
| `NOTIFICATION_SMS_PROVIDER` | **[REQUIRED]** | `robase` (default is `console` — dev/test only; leaving `console` in production = no real SMS) |
| `ROBASE_API_KEY` | **[REQUIRED — SECRET, never recorded]** | Live key with `robe_` prefix. Startup **fails closed** if absent or prefix mismatch when provider=`robase` (`src/config/environment.ts` validation) |
| `ROBASE_API_BASE_URL` | [OPTIONAL] | Default `https://api.robase.dev` — override only if Robase instructs |
| `ROBASE_REQUEST_TIMEOUT_MS` | [OPTIONAL] | Default `10000` (bounds 1000–30000) |
| `SMS_RETRY_MAX_ATTEMPTS` | [OPTIONAL] | Default `3` (bounded retry for FAILED deliveries) |
| `SMS_RETRY_BASE_DELAY_SECONDS` | [OPTIONAL] | Default `60` (exponential backoff base) |

### B.2 Notification worker (CFG-002)
| Variable | Class | Notes |
|---|---|---|
| `NOTIFICATION_WORKER_ENABLED` | **[REQUIRED]** | `true` (default `false`): the in-process worker starts at app boot without it there is no outbox drain/retry loop |
| `NOTIFICATION_WORKER_POLL_INTERVAL_MS` | [OPTIONAL] | Default `5000` (bounds 500–60000) |
| `NOTIFICATION_WORKER_BATCH_SIZE` | [OPTIONAL] | Default `10` (bounds 1–100) |

### B.3 Workforce OIDC + bootstrap (CFG-004)
Use `docs/deployment/config/v1-workforce-bootstrap.env.template` as the verbatim starting set
(PRODUCTION-REQUIRED + BOOTSTRAP WINDOW sections) per `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`:

| Variable | Class | Notes |
|---|---|---|
| `A2_WORKFORCE_ENABLED` | **[REQUIRED]** | `true`; when `false` the entire workforce plane is disabled (fail-closed) |
| `A2_WORKFORCE_OIDC_ISSUER` | **[REQUIRED]** | IdP issuer URL — HTTPS enforced in production at startup |
| `A2_WORKFORCE_OIDC_JWKS_URI` | **[REQUIRED]** | IdP JWKS URL — HTTPS enforced in production at startup |
| `A2_WORKFORCE_OIDC_AUDIENCE` | **[REQUIRED]** | Audience expected in workforce idTokens |
| `A2_WORKFORCE_OIDC_CLIENT_ID` | **[REQUIRED]** | IdP client id of the workforce console (used for `azp` validation on multi-audience tokens) |
| `A2_WORKFORCE_INTERNAL_AUDIENCE` | **[REQUIRED]** | `workforce-admin` (internal session tokens validated against this on every `/internal/**` call) |
| `A2_WORKFORCE_SESSION_TTL_SECONDS` | [OPTIONAL] | Template value `900` (bounds 60–3600) |
| `A2_FINANCE_ROLES_JSON` | **[REQUIRED]** | Copy from template; tailor scopes only via access-review approval |
| `A2_MAKER_CHECKER_RULES_JSON` | **[REQUIRED]** | Copy from template (MFA-assured maker/checker rules) |
| `A2_WORKFORCE_RATE_LIMITS_JSON` | [OPTIONAL] | Template starting set |
| `A2_TRUSTED_PROXY_ADDRESSES_JSON` | [OPTIONAL] | Only if a proxy fronts the app |
| `A2_BOOTSTRAP_ENABLED` | **[REQUIRED = `false` outside the ceremony]** | `true` **only for the minutes-long one-time window**, then disabled (see §H) |
| `A2_BOOTSTRAP_ISSUER` | bootstrap window | `monienaija-v1-bootstrap-operator` |
| `A2_BOOTSTRAP_AUDIENCE` | bootstrap window | `monienaija-v1-bootstrap` |
| `A2_BOOTSTRAP_JWKS_JSON` | bootstrap window | **PUBLIC key JWK only** — the private key never leaves the offline ceremony host |
| `A2_BOOTSTRAP_ADMIN_SCOPES_JSON` | bootstrap window | `["privileged:execute"]` — must equal FINANCE_ADMIN scopes in `A2_FINANCE_ROLES_JSON` |

### B.4 A5 pilot control (CFG-006 supporting)
| Variable | Class | Notes |
|---|---|---|
| `A5_PILOT_EMERGENCY_STOP` | [OPTIONAL — keep `false`] | Environment kill switch; when `true` every new transfer admission returns `PILOT_EMERGENCY_STOP` (fail-closed). Not writable by customer-facing commands |

## C. Secret provisioning

| Secret | Where it lives | Never |
|---|---|---|
| `ROBASE_API_KEY` (`robe_…`) | Deployment secret store / injected env only | in git, docs, logs, UAT evidence, or this checklist |
| Bootstrap **private** RSA key | Operator offline ceremony host only; shredded after the window (runbook §3) | on any server, in any env file |
| OIDC client credentials (IdP console) | IdP/secret store | in env templates committed to the repo |
| DB password | Deployment secret store | — |

Startup validation guarantees: provider=`robase` without the live key refuses to boot; non-HTTPS
OIDC issuer/JWKS in production refuses to boot; invalid policy JSON blocks fail closed at boot.
Verification of secrets must use **presence/shape checks only** (e.g. "set", prefix) — never print values.

## D. Robase SMS verification (CFG-001)

Mechanism (verified in code): transactional SMS = `POST {ROBASE_API_BASE_URL}/v1/sms/send` with
`Authorization: Bearer <key>` + deterministic `Idempotency-Key`; `sent` means "accepted by Robase";
deliveries record states PENDING→SENT (→FAILED w/ bounded retry).
**Procedure:**
1. Confirm `NOTIFICATION_SMS_PROVIDER=robase` and key present (validation forced at startup).
2. Register a customer with a **real fresh `+234` SIM** → OTP SMS must arrive on that handset.
3. Confirm the Robase console shows production-mode traffic for the send.
4. Confirm the `console` provider is NOT in use (env value, plus the Robase console traffic exists).
**PASS:** SMS arrives from real provider path; provider console shows live traffic; a delivery row
(`GET /api/v1/internal/notifications/deliveries`) exists with the canonical `+234…` destination.
**FAIL:** console/test fallback active, no live traffic, or SMS absent within TTL window.

## E. Notification worker verification (CFG-002)

Mechanism: `NotificationWorkerService` (in-process, started on module init when
`NOTIFICATION_WORKER_ENABLED=true`) drains pending outbox events and performs **bounded** retry of
FAILED deliveries (`attempts < SMS_RETRY_MAX_ATTEMPTS`, exponential backoff); exhausted rows stay
auditable FAILED with `last_error`. It never touches financial state.
**Procedure:**
1. Trigger an SMS event (e.g. registration OTP).
2. Observe `GET /api/v1/internal/notifications/deliveries` (workforce session;
   filters: `status/channel/eventType/recipientId`): delivery row transitions **PENDING→SENT**.
3. Poll twice across the day: pending/backlog counts remain stable (no growth).
4. Forced failure check (optional but recommended): temporarily point a staging instance at an
   invalid recipient → after `SMS_RETRY_MAX_ATTEMPTS` the row must become terminal `FAILED`
   with `last_error` populated and must stop retrying.
**PASS:** transitions observed live; backlog stable; bounded retry terminal behavior demonstrable.
**FAIL:** deliveries accumulate PENDING (worker never started) or retry is unbounded.
**Configured vs merely running:** process presence alone is insufficient — the domain rows must
move (PENDING→SENT) and the retry cap boundary must exhibit (count of attempts ≤ max).

## F. Sender-ID verification (CFG-003)

Mechanism (decisive, from `src/notification/robase-notification-provider.ts:24-25`): **sender
identity is workspace-level configuration on the Robase account; the `/v1/sms/send` contract
carries NO sender-id request field — no app env var controls it.**
1. **[REQUIRED]** On the Robase workspace used by the `robe_` key: register and obtain approval for
   the intended alphanumeric sender identity for Nigerian transactional traffic
   **[DECISION REQUIRED: the exact sender identity string — brand decision made by the operator;
   do NOT invent one here].**
2. Human tester across at least four event classes — registration OTP, customer temporary
   credential, funding-approval advisories, C2C transfers — records the sender shown on the
   physical handset.
**PASS:** every received message displays the same approved identity (no "unknown sender", no
variance across classes).
**FAIL:** generic/gateway sender, unregistered identity, or per-class inconsistency.

## G. Workforce OIDC verification (CFG-004, part 1)

1. Apply §B.3 PRODUCTION-REQUIRED block; restart; confirm boot succeeds (any invalid OIDC/policy
   value would have failed closed at startup).
2. Full OIDC cycle: administrator logs in at the IdP **with MFA**, obtains idToken; exchange at
   `POST /api/v1/internal/a2/workforce/sessions` (`{"idToken": …}`) → `accessToken`; call any
   workforce endpoint with `Authorization: Bearer <accessToken>` → non-401.
3. MFA enforcement negative: idToken **without** `amr:mfa` (or `auth_time` older than 300 s+60 s
   skew) must be refused (no session).
4. TTL observation: after `A2_WORKFORCE_SESSION_TTL_SECONDS` the same token must return 401.
5. Logout/revocation behavior per session contract.
**PASS:** cycle completes only with MFA; expiry returns 401. **FAIL:** non-MFA token accepted,
issuer/audience mismatch tolerated, or expired session accepted.

## H. Bootstrap lockdown verification (CFG-004, part 2)

Mechanism (from `src/authorization/finance-role-administration.service.ts` + runbook §12):
bootstrap requires (a) `A2_BOOTSTRAP_ENABLED=true`, (b) an **MFA-assured** workforce session of the
named principal, (c) a canonical signed statement inside its validity window, (d) a **single-use
nonce**, and (e) "not already completed" (a second `FINANCE_ADMIN` ACTIVE assignment → 409
“Finance bootstrap already completed”).
**Procedure (runbook §§3–7 exactly):**
1. Offline key ceremony → one-time signed statement; env gets `A2_BOOTSTRAP_JWKS_JSON` (PUBLIC key).
2. Open the window: `A2_BOOTSTRAP_ENABLED=true` (+ §B.3 bootstrap vars); restart.
3. Consume via `POST /api/v1/internal/a2/workforce/bootstrap` with the admin's MFA session +
   statement → FIRST FINANCE_ADMIN created.
4. **Close the window IMMEDIATELY:** `A2_BOOTSTRAP_ENABLED=false`; restart. This is **mandatory** —
   bootstrap must never remain open after provisioning.
5. Lockdown proofs: re-POST the bootstrap statement (or any statement) → **403 "Bootstrap
   disabled"**. Also confirm the first FINANCE_ADMIN can sign in and perform its constrained
   first-assignment role provisioning (runbook §10).
**PASS:** bootstrap consumed exactly once; post-lockdown the endpoint returns 403; both
protection layers (config gate + completion gate) are demonstrable.
**FAIL:** bootstrap remains enabled, replays, or consumes a second admin.

## I. Pilot limits verification (CFG-006)

Mechanism (verified): limit enforcement is wired at command time into W→W and agent flows
(`LimitEnforcementService` in `transfer.service.ts`, cash flows, funding). Catalogue =
profiles → rules (dimensions) → assignments, managed on `/api/v1/internal/limit-profiles` (POST,
PATCH, GET), `…/:code/rules` (POST/GET), `/api/v1/internal/limit-assignments` (POST/GET);
runtime reads: `GET /api/v1/internal/limit-usages`, `GET /api/v1/internal/limit-reservations`.
**CRITICAL runtime semantic:** *"If no profile or no rules, returns allowed (unlimited). Never
invents thresholds."* — and **migrations seed no default limit values**. Therefore:

1. **[DECISION REQUIRED]** Business/compliance must supply the approved pilot values (NGN kobo
   minor units). Minimum per the catalogue's CFG-006 step: **one per-transaction cap**
   (`MAX_AMOUNT_PER_TX`) and **one daily/cumulative cap** (`DAILY_AMOUNT` and/or `DAILY_COUNT`) for
   products `WALLET_TRANSFER` (and agent `CASH_IN`/`CASHOUT`/`CASH_TO_CASH` if in pilot scope),
   direction `OUTGOING`/`BOTH`. Also decisions for `AGENT_CLASS` assignment scope vs `GLOBAL`.
   *Do not invent regulatory limits here — none are assumed.*
2. **[REQUIRED]** Provision them via the internal endpoints above (workforce OPERATOR/PRIVILEGED),
   profile kind `CUSTOMER` (+`AGENT` if agent flows in pilot), status `ACTIVE`, scope
   global-with-overrides as decided.
3. **[REQUIRED]** If the A5 admission control is used for the `WALLET_TRANSFER` pilot scope,
   provision the durable `PilotControl` row (`wallet.transfer.create.v1`: min/max per tx, daily
   count/amount, cohort customer ids, `enabled`) through the approved operational path (the
   control is service-level only — **there is no HTTP endpoint**; provisioning must follow the
   change-control path used for other non-HTTP operational state, and `A5_PILOT_EMERGENCY_STOP`
   stays `false`). If the pilot runs without A5 admission control, record that decision too.
4. **Runtime verification:** `GET /api/v1/internal/limit-profiles` + `:code/rules` +
   `/limit-assignments` → values equal the approved policy sheet; attempt one transfer 1 kobo
   above `MAX_AMOUNT_PER_TX` → 422 (no other failure shape); repeat within the day past the daily
   cap → 422; balances unchanged on every refusal; `limit-usages` rows corroborate.
**PASS:** live values equal the policy sheet at both read-back and behavior levels.
**FAIL / mismatch:** any drift → fix configuration, RETEST (per catalogue CFG-006 rule).
**(Pre-check):** with an empty catalogue the engine is unlimited — do not mistake "no rule hit" for "configured".

## J. Exact CFG-001/002/003/004/006 retest procedure (run in production AFTER A–I)

Execute in order, against the production deployment, on real `+234` SIMs + real IdP accounts:
1. **CFG-001** — §D (fresh registration → handset SMS + provider-console traffic + no console provider).
2. **CFG-002** — §E (PENDING→SENT live transitions; backlog stable; bounded-retry terminal FAILED if induced).
3. **CFG-003** — §F (same approved sender identity across OTP/credential/funding/C2C messages on handset).
4. **CFG-004** — §G (OIDC + MFA cycle, TTL expiry) then §H (bootstrap consumed once → `A2_BOOTSTRAP_ENABLED=false` → restart → bootstrap endpoint 403).
5. **CFG-006** — §I (profile/rule/assignment read-back equals policy sheet; over-limit transfer 422; daily-cap 422).
Record each as PASS/FAIL with evidence (§K) into the UAT ledger rows UAT-CFG-001/002/003/004/006
respectively (replacing their current BLOCKED statuses) in a new evidence artifact — do not alter
historical ledgers.

## K. Evidence to capture

- App boot log lines showing successful startup with production config (no secret values).
- `GET /api/v1/health` + `/api/v1/ready` 200 results and readiness report (migration pin …0079).
- Robase-console screenshots of live sends (redact full key; show last 4 at most if organizational policy allows).
- Received-SMS handset photos across the four message classes (mask OTP codes after use).
- `GET /api/v1/internal/notifications/deliveries` snapshots before/after/during CFG-002 (transition proof, counts).
- OIDC login/exchange + post-TTL 401 curl outputs (tokens truncated), MFA-refusal output.
- Bootstrap consumption 2xx, post-lockdown 403 "Bootstrap disabled" output, first FINANCE_ADMIN sign-in proof.
- `/limit-profiles` + `:code/rules` + `/limit-assignments` read-backs + the two 422 refusal responses + unchanged-balance proof.
- Change-ticket references for every bootstrap/limits/production-config action.

## L. Security precautions

1. **Never** print or commit secret values (API key, OIDC secrets, DB password, bootstrap private key); use presence/shape evidence only.
2. Zero trust on env provenance: secrets via the deployment secret manager, not files in the repo; `.env`-style files must stay outside git.
3. Bootstrap private key exists only on the offline ceremony host; shred after the window closes; `A2_BOOTSTRAP_JWKS_JSON` holds the PUBLIC key only.
4. Never distribute the working `robe_` key widely; scope to the pilot workspace; rotate after pilot if mandated by policy.
5. Keep the bootstrap window measured in minutes; an open window is itself a finding.
6. Confirm TLS end-to-end for API and JWKS/issuer traffic; `DB_SSL` per policy; no cleartext SMS of OTP beyond the single allowed delivery (already app-enforced).
7. Do not disable `A6_PARTNER_ENABLED=false`; do not enable push-provider config in V1.
8. Any config change to the five areas requires a change record + RETEST of the affected CFG item.
9. Read-only DB access for evidence where possible; never edit ledger limits/usage rows by hand during verification (fix via catalogue endpoints, then retest).

## M. Final pilot readiness sign-off

| Item | Owner | Evidence link | Status (PASS/FAIL) | Date |
|---|---|---|---|---|
| A/B/C pre-deployment + env + secrets provisioned | DevOps | | | |
| CFG-001 Robase SMS live | Tester + DevOps | | | |
| CFG-002 worker live processing | Tester + DevOps | | | |
| CFG-003 sender identity on handset | Tester | | | |
| CFG-004 OIDC cycle + MFA | Tester + IAM | | | |
| CFG-004 bootstrap consumed exactly once + lockdown 403 | Tester + IAM | | | |
| CFG-006 pilot limits match policy sheet + 422 refusals | Tester + Product/Compliance | | | |
| Decisions recorded (sender identity; pilot limit values; A5 admission control usage) | Product/Compliance | | | |

When all rows PASS, update UAT-CFG-001/002/003/004/006 from BLOCKED → PASS evidence rows in a new
retest artifact and proceed against the final UAT §22/§23 conditions before go-live sign-off.

---
*Documentation-only artifact produced at task V1-PILOT-READINESS-01. No application code,
migrations, configuration values, or secrets were created or modified.*
