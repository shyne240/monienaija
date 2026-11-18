# ARENA 3D — Production Infrastructure, Operational Readiness and Financial Completion

Continuation record. Updated as each group lands; the workspace is the source of truth.

---

## 1. Checkpoints

| Point                                       | Commit        | Notes                                                                                    |
| ------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| Mission start (accepted banking checkpoint) | `e0e0d550`    | Conditional engineering acceptance of the banking mission. Local == remote, clean tree.  |
| Groups 3, 2, 4/5                            | `e20b3116`    | Financial completeness and unresolved-funds visibility.                                  |
| Group 7                                     | `9b04c45c`    | Containers, admin-web loopback guard, mobile fail-closed endpoint.                       |
| Group 8                                     | `5670bc97`    | 152/152 environment keys inventoried and classified; completeness test.                  |
| Group 12                                    | `3e0c9985`    | Backup and restore exercise, executed and verified.                                      |
| Groups 9, 10, 11                            | `62368a3b`    | Secret resolution and rotation, runtime/authority separation proof, migration workflow.  |
| Groups 13, 14                               | `cc6392a7`    | Recovery objectives and resume policy; outbox leases and dead letters.                   |
| Group 15                                    | `f8bb5fdd`    | Worker supervision without a second scheduler.                                           |
| Group 16                                    | `6451a5c2`    | Sink-level log redaction; compound secret names.                                         |
| Group 17                                    | `40766952`    | Operational metrics; DLQ and worker signals finally have a consumer.                     |
| Group 18                                    | `f2a63c0d`    | Integrity snapshots and drift detection.                                                 |
| Group 19                                    | `0fe477bc`    | Alert contract, deduplication, flap suppression, dark delivery default.                  |
| Group 20                                    | `90b06a4f`    | Operations centre: one ranked read-only view of what needs attention.                    |
| Group 21                                    | `7420586a`    | Break-glass post-incident review, enforced by constraint rather than convention.         |
| Group 22                                    | `596b4a6b`    | Fraud/risk signals: detection separated from financial authority; no invented threshold. |
| Group 23                                    | _this commit_ | Audit evidence export: keyset pages, recorded every page, no invented retention policy.  |

Branch: `arena/defdd0fd-monienaija`. There is no upstream; push with `git push origin <branch>`.

---

## 2. Mission framing, as executed

This mission has four distinct kinds of work, and conflating them is how infrastructure missions
produce documents instead of software:

1. **Financial completion** (groups 3–5) — close gaps where an authoritative contract and an
   approved controlled policy exist. Where they do not, refuse explicitly and preserve the
   obligation.
2. **Infrastructure** (groups 6–12) — deployment, containers, configuration, secrets, database
   operations, migrations, backup/restore, disaster recovery. All of it must be _executable here_,
   not aspirational.
3. **Operations** (groups 13–29) — workers, scheduling, observability, integrity monitoring,
   alerting, admin centre, security, access, risk, compliance, support, disputes, notifications,
   privacy.
4. **Acceptance** (groups 30–38) — performance, CI, the consolidated matrix, provider sandbox
   readiness, mobile release, browser acceptance, the readiness gate, journeys A–J, the final
   matrix.

The standing constraint across all four is the mission's own refusal list: no invented provider
contracts, no invented settlement evidence, no invented financial policy, no weakened protected
authority, no automatic ledger adjustment. Those refusals are implemented as code that refuses,
not as documentation that warns.

---

## 3. Completed work

### Group 3 — Agent operating float funding

**The gap.** Three refusals, each individually correct, together made institution agent float
impossible to raise:

- `BankingAgentFundingService` provisions a funding account and reports
  `VERIFIED_AWAITING_FLOAT_CREDIT`; it never credits, because a bank transfer alone cannot
  distinguish float from a customer cash-in.
- `AgentFundingService` refuses to fund an institution-attributed agent, because
  `AGENT_FUNDING_POOL-NGN` is an unattributed platform liability and posting it into an
  institution-attributed wallet would invent an institution-bound funding rail.
- Nothing else existed.

**How it was closed.** By building the missing rail, not by relaxing either refusal. Both still
hold and both are still asserted by their own suites.

```
DEBIT   institution SETTLEMENT asset     (its bank balance grew — the money arrived)
CREDIT  the agent's float account        (the institution now owes the agent that float)
```

Both legs are institution-scoped in the same accounting unit. That is enforced by the ledger, not
by a comment: `LedgerService.resolveJournalInstitution` refuses a journal that mixes an
institution-attributed account with an unattributed one, so the mixed posting this service could
otherwise produce is rejected by the database layer.

**Files.**

| Path                                                                 | Role                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/migrations/1785753600605-CreateInstitutionAgentFloatFunding.ts` | Policy, receipt and obligation tables; four triggers.                                                                                                                                                                                    |
| `src/banking/agent-float-funding-authority.ts`                       | `AgentFloatFundingAuthority` contract; `UnavailableAgentFloatFundingAuthority` (shipped, approves nothing); `PolicyAgentFloatFundingAuthority` (reads approved policies, exercised in acceptance, deliberately not the runtime default). |
| `src/banking/agent-float-funding.service.ts`                         | The ledger effect, idempotency, obligation preservation.                                                                                                                                                                                 |
| `src/banking/banking.module.ts`                                      | Wiring. The runtime authority approves nothing.                                                                                                                                                                                          |
| `test/a3d-agent-float-funding.integration.spec.ts`                   | 14 acceptance cases.                                                                                                                                                                                                                     |

**Design decisions.**

- _Policy is separate from verification and from posting._ `AgentFloatFundingAuthority` answers
  only "does an approved policy permit this payment to credit this agent". Merging that into
  verification would make every verified payment into a funding account automatically float.
- _The shipped authority approves nothing._ The policy-reading implementation exists and is
  exercised, but is not the runtime default: a database row must not be able to authorize money
  movement by itself.
- _Production is withheld_ even with an ACTIVE production policy (`PRODUCTION_EXECUTION_WITHHELD`).
  A sandbox policy proves the lifecycle; it does not authorize real money.
- _A verified payment that is not credited is preserved_ as a durable obligation with a closed-set
  reason. "The agent was suspended so we did not credit" and "we lost the payment" must not look
  the same to operations.
- _Exactly-once is a constraint, not a loop._ The unique key on
  `(provider_key, environment, provider_reference_hash)` is what makes duplicate webhooks, racing
  workers and restarts collapse onto one credit. The retry loop only handles serialization failures.

**Triggers added** (each closes a way the system could otherwise lie):

1. A policy's settlement asset must be _that same institution's_ `SETTLEMENT` account, in the
   policy's currency, and active.
2. Funding receipts are immutable — no update, no delete.
3. An obligation cannot be resolved as credited unless a funding receipt exists for its reference.
   Operations cannot declare money moved.
4. `last_observed_at` advances on every re-observation, so a repeatedly-seen uncredited payment is
   visibly accumulating rather than frozen.

**Acceptance — 14/14** (`test/a3d-agent-float-funding.integration.spec.ts`, real PostgreSQL, real
application instance, institutions created through the authenticated console):

| Case                                   | Proves                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Balanced journal and immutable receipt | Both legs moved by the full amount; receipt records the accounts.          |
| Duplicate delivery                     | Three calls, one credit, replays return the original receipt.              |
| Ten concurrent attempts                | One `CREDITED`, nine `REPLAYED`, one credit in the ledger.                 |
| Conflicting terms                      | Same reference, different amount → refused; original credit stands.        |
| No active policy                       | `OBLIGATION / NO_ACTIVE_POLICY`, zero ledger movement, obligation visible. |
| Production withheld                    | ACTIVE production policy → `PRODUCTION_EXECUTION_WITHHELD`, zero movement. |
| Policy authority, sandbox              | Credits under an approved sandbox policy.                                  |
| Suspended agent                        | `AGENT_INELIGIBLE`, payment preserved.                                     |
| Wrong funding account                  | `ACCOUNT_NOT_AGENT_FUNDING_ACCOUNT`, zero movement.                        |
| Customer wallet                        | `WALLET_NOT_AGENT_OWNED`; a deposit booked as float is refused.            |
| Obligation closed by later credit      | Status becomes `RESOLVED_CREDITED` against the real receipt.               |
| Obligation cannot claim credit         | Database refuses `RESOLVED_CREDITED` without a receipt.                    |
| Receipts immutable                     | Update and delete both refused by trigger.                                 |
| Cross-institution settlement asset     | Refused by trigger.                                                        |

**Verification.** Root unit suite 3053/3053 unchanged; migration-chain 20/20; migration-inventory
7/7; eslint and prettier clean on every touched file.

---

### Group 2 — banking handoff correction

The handoff opened by claiming nothing could move money because no caller was wired. Quoted and
corrected rather than deleted, and replaced with §1.1: a table of the terminal financial state each of
the seven banking journeys actually reaches, plus the three conflations it exists to prevent (provider
acknowledgement ≠ settlement; `VERIFIED_AWAITING_FLOAT_CREDIT` ≠ credited float; verified incoming
payment ≠ credited customer funds).

### Groups 4 and 5 — inbound customer funding and unresolved-funds visibility

The A7 inbound path was already complete end to end (customer command → admission → verified
observation → execution authority → receipt). What was missing was operational sight of the cases it
does not resolve. Added `OperationalFundsVisibilityService` and
`GET /internal/banking/institution/:id/unresolved-funds` on the existing `reconciliation.view`
function — deliberately not a new catalogue function, because widening the catalogue to serve a screen
is what the mission forbids.

The response is built around the difference between an **empty list** and an **unavailable source**. A
dashboard rendering `[]` for both tells an operator "we checked and it is clean" when the truth is "we
have no way to check". Provider settlement evidence, provider balance and refund/return therefore
return `UNSUPPORTED` with a reason, never `count: 0`.

Read-only by construction; a test asserts the service's prototype carries no write method.

Acceptance: 5/5 (`test/a3d-operational-funds-visibility.integration.spec.ts`).

### Group 7 — containerization and reproducible builds

**Container runtime is unavailable in this environment** (`docker`, `podman` and `buildah` are all
absent). This is recorded as a blocker, and every executable portion was validated independently
instead — see §5.

Delivered:

| Artefact                                       | Purpose                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                                   | Three-stage backend build. Pinned `node:22.22.3-alpine3.20`, `npm ci`, dev deps pruned from runtime, non-root `node` user, `tini` as PID 1 so SIGTERM reaches the graceful-shutdown hook, no secrets, explicit `node dist/main.js`, liveness-only healthcheck. |
| `docker-compose.yml`                           | postgres + one-shot `migrate` + backend + admin-web + TLS proxy. Deliberately no Kubernetes/broker.                                                                                                                                                            |
| `infra/postgres/init/01-runtime-privileges.sh` | Provisions the least-privilege runtime role: `NOSUPERUSER NOCREATEDB NOCREATEROLE`, no table ownership, `TRUNCATE` revoked, `protected_authority` schema explicitly revoked.                                                                                   |
| `infra/nginx/default.conf`                     | TLS termination, port 80 redirect-only, per-route rate limits, 12m body cap, security headers, logs without query strings.                                                                                                                                     |
| `infra/nginx/proxy-headers.inc`                | Shared proxy headers with `X-Forwarded-Proto` hard-coded to `https`.                                                                                                                                                                                           |
| `apps/admin-web/Dockerfile` + `nginx.conf`     | Unprivileged static nginx on 8080; **build fails if the emitted bundle references a loopback endpoint**.                                                                                                                                                       |
| `apps/agent-mobile/src/config/index.ts`        | Production builds now fail closed instead of falling back to the emulator loopback address.                                                                                                                                                                    |

**Executable validation performed** (runtime absent, so these stand in for a container run):

1. `npm run build` succeeds and emits `dist/main.js` and `dist/config/data-source.js` — the exact paths
   the container's `CMD` and the `migrate` job reference.
2. `docker-compose.yml` parses under a real YAML parser; services, networks, volumes and the security
   posture (`read_only`, `cap_drop: [ALL]`) verified programmatically.
3. The compiled artifact boots against real PostgreSQL and **its startup validation fires correctly**:
   first `NOTIFICATION_SMS_PROVIDER` (refusing the console provider in production), then the missing
   encryption keyring. Both are the intended refusals, not defects.
4. With configuration satisfied and migrations applied, readiness reports `database: ok`,
   `migrations: 152/152 compatible` with `1785753600605` as head, and `financial_dependencies: error`
   listing the eight documented blockers — indicating the gates work and are unoverridable.
5. The production role check rejected the superuser test role (`runtime_database_role_unsafe`), then
   passed once a `NOSUPERUSER` role was used, then correctly stopped at
   `protected_checker_authority_not_configured`.
6. The admin-web bundle passes the loopback guard, **and the guard was verified to detect a loopback
   reference when one was injected** — a check that has never failed is not evidence.

agent-mobile 323/323 (was 317; +6 new endpoint cases).

### Group 8 — environment inventory and startup validation

**Deliverables.** `scripts/generate-env-inventory.js` derives the inventory from the Zod schema in
`src/config/environment.ts` rather than from a hand-written list, so a key cannot be added to the schema
without appearing in the table. `docs/integration/ENVIRONMENT-CONFIGURATION-INVENTORY.md` holds 152 rows.
`test/environment-inventory.spec.ts` (7 cases) fails if the schema and the document diverge in either
direction, and asks the real `validateEnvironment()` whether each value would be accepted in production.

Classification counts: INTERNAL 39, OPERATIONAL 38, SECRET 18, ENVIRONMENT_SPECIFIC 33,
PROVIDER_SPECIFIC 17, FINANCIAL_POLICY_DEPENDENT 7. `.env.example` went from 108 to 152 documented keys.

**Two corrections worth keeping.** The first classification put `DB_HOST` and
`A6_PARTNER_SIGNING_ALGORITHM` in SECRET because both _matched_ a secret-shaped pattern;
`BANKING_MONNIFY_CONTRACT_CODE` was missed for the opposite reason. The rules were reordered by
specificity and both directions are now asserted by name.

The completeness test originally failed on `DB_PASSWORD=change-me-local-only`, which looks like a leaked
credential in an example file. It is not: the value is on the schema's own `PLACEHOLDER_SECRETS` blocklist
and production refuses it — verified against the compiled validator, not assumed. The test therefore
asserts against `validateEnvironment()` instead of a second hand-maintained string list, which would have
been a copy of the rule rather than the rule itself.

### Group 12 — backup and executed restore exercise

`scripts/backup-restore-drill.js` performs a full cycle: backup → fresh database → schema from the real
migration chain → restore → verify. `pg_dump`, `pg_restore` and `psql` are **absent from this
environment** (confirmed by searching the whole filesystem), so the drill implements the same operation
over the wire. Durability, off-site storage, encryption at rest and retention remain infrastructure
decisions and are listed as outstanding rather than simulated.

**Executed, not merely written.** Two runs, both `BACKUP RESTORE VERIFIED`:

| Source database                   | Rows | Tables | FKs checked | Ledger lines | Unbalanced | Orphans | Categories |
| --------------------------------- | ---- | ------ | ----------- | ------------ | ---------- | ------- | ---------- |
| `mn_it_fcinit_g19drill_1806328`   | 2030 | 50     | 86          | 190          | 0          | 0       | 10/11      |
| `mn_it_a3dfloat_g19float_1807347` | 984  | 50     | 86          | 14           | 0          | 0       | 10/11      |

No single available fixture populates all eleven categories, and the drill reports exactly that rather
than implying coverage it did not exercise. Between the two runs every category the mission names is
restored and verified; a fixture seeding all eleven in one database remains outstanding.

**Seven defects found by executing it.** Each came from a restore attempt that actually failed:

1. **JSON silently rounds money.** `json_agg` renders `numeric` as a bare JSON number and `JSON.parse`
   makes it a double — `12345678901234567890` → `...567000`, observed. `numeric`/`bigint` are now
   projected through `::text`, so exact decimal strings travel and PostgreSQL casts them back on insert.
2. **Deferred ledger constraints need one transaction.** `ledger_journal_must_balance` and
   `ledger_lines_must_balance_journal` are `DEFERRABLE INITIALLY DEFERRED` and fire at COMMIT. Under
   autocommit a journal cannot precede its balancing lines, so every journal would be rejected and a
   perfectly good backup would look un-restorable.
3. **Governance evidence lives outside `public`.** Restoring approvals failed with _"Protected approval
   must be requested through the protected authority"_: the guard demands matching rows in
   `protected_authority.checker_decisions` / `approval_consumptions`. A `public`-only backup **cannot be
   restored at all**. Both are now backed up and restored.
4. **Some tables are derived and cannot be copied.** `governed_institution_lifecycle_executions` refuses
   INSERT unless `pg_trigger_depth() >= 2`; `kyc_evaluation_refresh` is a work queue the KYC triggers
   repopulate during the restore. Both are regenerated by the transition that produces them.
5. **Four ledger accounts are provisioned non-deterministically.** `CASH_TO_CASH-UNCLAIMED-NGN`,
   `AGENT_FUNDING_POOL-NGN`, `FINANCE-FEE_REVENUE-NGN` and `FINANCE-VAT_PAYABLE-NGN` are seeded with
   `gen_random_uuid()`; verified to differ across two independently migrated databases. **This is a real
   production recovery defect**: ledger lines in a backup reference the source's ids, so a restore either
   fails the foreign key or silently re-attaches those lines to a different account object carrying the
   same code — and no balance check would reveal it. The drill resolves every collision up front,
   rewrites the references deliberately, and names each one in its output and `verification.json`.
6. **jsonb `[]` was restoring as `{}`.** node-postgres serialises a JS array as a PostgreSQL array
   literal, which the jsonb input function reads as an empty object — `scopes: []` on a role assignment
   would have become `scopes: {}`. JSON columns are now explicitly stringified.
7. **Three supporting tables were missing from the backup set.** The referential sweep found 75 dangling
   references to `banks`, `customer_beneficiaries` and `authentication_sessions`. They are not one of the
   eleven categories, but the categories cannot be restored without them.

**How the guards are handled, and why that is not a shortcut.** The guards are written for operations,
not restores: `approval_authority_guard` requires `expires_at > clock_timestamp()`, which a genuine
historic approval can never satisfy (all 15 in the fixture had expired; their digests matched exactly);
the execution-evidence guard requires trigger depth. PostgreSQL draws the same line itself —
`pg_restore --disable-triggers` exists so a restore reproduces _state_ without re-running _policy_. The
drill does the same (`session_replication_role = replica`) and pays for it by re-establishing integrity
from the data rather than trusting the guards it just bypassed: every backed-up row compared against the
**live source** by server-computed fingerprint, a full foreign-key sweep (86 FKs, 0 broken), every journal
balanced, and the ledger's total debit and line count unchanged.

Two consequences stated plainly rather than buried: a restore requires a role permitted to set
`session_replication_role` (a superuser), which narrows who may perform one; and the first verification
attempt compared rows against the serialized file, where a `timestamptz` is a JSON string and the driver
returns a `Date` — hundreds of false failures that would have buried a real one. Comparison is now
database-to-database.

`test/backup-restore-drill.spec.ts` (11 cases) pins each of these properties. The guards were verified to
fail when the corresponding code is broken, so they are tests rather than restatements.

A `MN_IT_KEEP_DATABASE=1` switch was added to `test/support/pg-harness.ts` so a finished suite's real
application-written rows can be harvested as a fixture. It is opt-in and only ever affects a database the
run already owns.

---

### Group 9 — secret resolution and rotation

`src/config/secret-resolver.ts` puts a resolution layer in front of the environment. No secret manager
was selected (that is a product-owner decision, and inventing a provider entitlement is forbidden); what
exists is the **contract** such a backend must satisfy, an environment-backed implementation that
satisfies it today, and the guarantees the rest of the application codes against.

What it makes true:

- a secret is resolved **by name**, never passed around as a value;
- every resolved secret carries a **version** and a **fingerprint** (SHA-256, 12 hex characters, one-way),
  so "did the rotation take effect?" and "which version signed this request?" are answerable;
- `rotate(name)` is per-secret and needs no restart; a handle already held by an in-flight request keeps
  the value it resolved, so rotation during traffic does not fail a request halfway;
- `reveal(purpose)` is the only way to obtain the value and records an **access record** with the purpose
  and the version actually used;
- handles are **frozen**, so a caller cannot attach a `value` property and leak it through a later
  serialisation of a structure that happens to contain the handle.

`DB_PASSWORD` is deliberately **absent** from the mapping. Rotating it is a connection-pool operation
bound to a restart; exposing it through a hot-swap interface would advertise a capability that does not
exist and hide a restart requirement behind an API claiming there is none.

`test/secret-resolver.spec.ts` (20 cases) proves rotation works, then tries every route a value could
escape by — `toString`, `JSON.stringify` including nesting, `describe()` health output, error messages,
the known-name list, a caller mutating the handle, and the repository-wide redactor — and asserts the
value is absent from each. A rotation feature that leaks is worse than none, because the leak is silent.

### Group 10 — database operational readiness

The claim tested is narrow and load-bearing: **the ordinary runtime login cannot reach protected
authority, and cannot acquire it through inheritance, session state, or a function it may call.**

`test/database-operational-readiness.integration.spec.ts` (13 cases) provisions a real runtime/authority/
migration split by executing the same `scripts/sql/*.sql` an operator runs, then connects **as the
provisioned runtime login** — a test that connects as a superuser and inspects `pg_roles` proves nothing
about what the runtime can do. Verified:

| Property                                                            | Result |
| ------------------------------------------------------------------- | ------ |
| Three distinct non-superuser logins                                 | proven |
| Group roles are `NOINHERIT` and cannot log in                       | proven |
| Runtime cannot read, write or resolve `protected_authority`         | proven |
| Runtime holds zero grants in that schema                            | proven |
| Runtime cannot `SET ROLE` into the authority group                  | proven |
| Runtime cannot write the 9 governance tables that decide its limits | proven |
| Runtime retains the ordinary reads it needs                         | proven |
| Authority retains the writes runtime is denied (the mirror image)   | proven |
| Authority is not superuser and cannot create databases or roles     | proven |
| `public` is owned by the migrator, not the runtime credential       | proven |
| Runtime cannot create or drop schema objects                        | proven |
| Runtime cannot set `session_replication_role` (trigger bypass)      | proven |
| Runtime cannot `SET SESSION AUTHORIZATION`                          | proven |

The mirror-image assertions matter: a boundary that denies everything is broken provisioning, not a
working boundary. Three of my own initial assumptions were wrong and were corrected against what
PostgreSQL actually does — recorded in the test so the reasoning is not lost.

### Group 32 — mobile release readiness

`src/mobile/mobile-release-readiness.service.ts`, `test/mobile-release-readiness.spec.ts` (21 assertions) and
`docs/integration/MOBILE-RELEASE-READINESS.md`.

**The finding that matters.** Both apps ship `version: "1.0.0"`, `ios.buildNumber: "1"`, `android.versionCode: 1`.
Group 25's build register resolves on `(client, platform, version)`, so two separate products sharing one version
string means "is 1.0.0 supported?" has two answers and a support agent reading a screenshot cannot tell which app
was meant. The register is correct; the artefacts collide.

**The second finding.** Neither app declares `runtimeVersion`. Over-the-air updates are scoped by it — a JS bundle
may only reach a native binary whose native modules it matches — so OTA updates must stay disabled until the field
is decided. Shipping one against an unscoped binary is the classic way to brick an installed base.

Both are `WARNING`, not `ERROR`: neither is a broken manifest, and neither is a decision this mission may make by
invention. Repository report: **`WARNING`** — 4 pass (version format ×2, identifier stability ×2), 4 warn
(cross-app version collision ×2, missing runtime version ×2), 0 error.

**What is checked, and why each matters.** `version-format` (the register accepts only `major.minor.patch`; anything
else leaves the build permanently `UNKNOWN` — served, never governed); `version-consistency` (a manifest disagreeing
with its own `package.json` makes "what is in production?" unanswerable); iOS build number and Android version code
(a store rejects a re-upload of an existing number); `build-number-alignment` (the platforms may diverge, but then
support needs to know the platform); `identifier-uniqueness` (two apps cannot share a bundle or package identifier —
unrecoverable after the first publication); `identifier-stability` (`ESTABLISHED_IDENTIFIERS` pins
`ng.monienaija.agent` and `ng.monienaija.customer`, because changing one orphans every installed app rather than
renaming it); `cross-app-version-collision`; `runtime-version`.

**Verification.** Every risky rule is exercised against **synthetic releases** — `evaluateManifests` is a pure
function over already-read manifests — because the failure cases cannot be created by editing the real files: an
unparseable version, two versions for one artefact, a changed bundle identifier, two apps sharing an identifier, a
build number a store would refuse, and platform drift. A genuinely consistent release is asserted to come back
`PASS`, so the suite cannot pass by warning about everything. Mutation-verified: pointing the agent's iOS bundle
identifier at `ng.monienaija.customer` produced **2 failures, 19 passes**; restored and re-read from disk.

A real parsing hazard was fixed while writing it: `String(value)` on an `unknown` yields `"[object Object]"`, which
passes a non-empty check and then matches nothing. Fields go through a `text()` helper that returns the empty string
for anything that is not a string or a finite number, so a malformed field reads as **missing**, never as present.
`no-base-to-string` caught four instances.

**Not certified:** no native build, no signing, no store submission, no installation on a device or emulator, no OTA
published or delivered, no store review. A `PASS` on `version-format` means the version is *registerable*, not
registered — Group 25 deliberately seeds nothing, because the support floor is a product decision. The two warnings
are recorded, not resolved.

**Decisions required:** the per-app version scheme; the `runtimeVersion` policy and whether OTA is enabled at all;
and whether either app has already been submitted, since that fixes the next build number.

### Group 31 — sandbox integration readiness

`test/sandbox-integration-readiness.integration.spec.ts` (11 integration assertions) and
`docs/integration/SANDBOX-INTEGRATION-READINESS.md`.

**The finding that matters.** Booting the compiled application against a fully migrated database exits with
`Application startup failed: Production readiness failed: financial_dependencies_not_ready`. Not because the
database is missing — the schema is current, reconciliation is healthy and the runtime role is safe — but because
eight financial dependencies have never been independently verified: trusted KYC provider activation, KYC consent
notice and policy, identity key versions, effective KYC policy, provider governance and routing, wallet ownership
governance, institution KYC tier limit governance, financial authorization dependencies.

**That is the gate working, and it is asserted rather than worked around.** The obvious "fix" — a flag that skips
readiness in development — would skip it in production too. A sandbox that boots is not evidence of any of those
eight. The suite asserts the distinction directly: `database.status === 'ok'` and `migrations.compatible === true`
at the same moment the verdict is `error`, so the refusal is dependency policy rather than broken infrastructure.

**What the suite does prove.** It boots the **entire `AppModule`** — not the handful of services a focused suite
instantiates — with the real Fastify adapter, the real `api/v1` prefix and the real validation pipe, mirroring
`main.ts`. Eleven assertions: provider graph resolves; a substantial route surface registers; routes mount under
`api/v1` **and 404 at the root** (a route that answers 404 in the container can pass every in-process test);
liveness answers unauthenticated; readiness answers; a protected route refuses an anonymous caller; a 404 is
structured with no stack trace; the gate refuses; every blocker is named individually; the database is
simultaneously healthy; no live provider credential is exported.

The suite caught a real error in itself: the first run asserted `/api/v1/health/live`, which 404s — liveness is
`/api/v1/health`. Asserting a path from memory rather than from the router is how a smoke test becomes fiction;
the comment recording it is left in place.

**Not certified:** not a deployment, not `docker compose` (no container runtime here), not production
configuration, not live provider connectivity, not browser acceptance (Group 33), not a load or soak test, not the
mobile apps (Group 32), and none of the eight dependencies verified.

### Group 30 — full PostgreSQL acceptance

`src/deployment/postgres-acceptance.service.ts`, `test/postgres-acceptance.spec.ts` (12 assertions), the
`backend-postgres-isolated` CI job, the `test:pg:isolated-kyc:ci` script and
`docs/integration/POSTGRESQL-ACCEPTANCE.md`.

**What was already good needed no replacing.** The matrix runner is genuinely engineered: 179 integration suites,
each in a dedicated database; sequential batches in separate OS processes because a single long-lived Jest process
accumulates heap across suites (measured ~720 MB → ~1.4 GB over 19 files, then OOM) — batching is memory
management, not reduced coverage; every batch always runs so failures are reported together; a pid-scoped
migration template database so a run reuses one migrated schema instead of 160+ migrations per suite.

**The gap was eleven suites nothing ran.** `jest.integration.config.js` matches `*.integration.spec.ts`; eleven
files are named `*.isolated-pg.test.ts` and match nothing. They are run by `run-isolated-kyc-tests.js` — a careful
script that creates a disposable socket-only cluster with a provenance contract several suites assert on — and
**nothing in CI invoked it**. On every push they did not run. Between them they guard the KYC foundation schema,
provider governance singletons, tier policy and limit enforcement, registration API and session lifecycle,
governed ledger reversal, and legacy registration/session remediation. A suite nothing runs is worse than no
suite: it inflates apparent coverage while asserting nothing.

Fixed with a `:ci` wrapper script and a `backend-postgres-isolated` job that installs the server binaries. An
inventory service classifies every suite by naming convention and reports any that no configured runner executes
— claimed only when the npm script exists **and** a workflow invokes it, because a script nobody calls executes
nothing.

One subtlety a failing test caught: `npm run test:pg` is a strict **prefix** of `npm run test:pg:isolated-kyc`, so
a naive `includes` let the integration pattern claim the isolated suites and everything looked wired up. The
matcher now requires a whole `run:` value.

Mutations: removing the isolated script → 11 unclaimed; changing the CI step to `echo skipped` → 11 unclaimed;
removing `test:pg` → over 150 unclaimed.

**Not accepted:** the isolated suites were **not executed here** (no `initdb`/`pg_ctl` in this sandbox — they are
wired into CI, and that is the claim, not that they passed); CI has not run; not at production volume; not
concurrency; not a soak test; not a DR drill (Group 18's declared-vs-measured record stands). The five most recent
integration suites do pass **126/126** against a real cluster here.

### Group 29 — CI and deployment gates

`.github/workflows/ci.yml`, `src/deployment/ci-gate.service.ts`, `test/ci-gates.spec.ts` (15 assertions),
`package.json` (`lint` split) and `docs/integration/CI-AND-DEPLOYMENT-GATES.md`.

A workflow already existed. Five real problems:

1. **`npm run lint` — the first step of the first job — aborted with an out-of-memory kill.**
   `eslint "{src,test}/**/*.ts"` is a single invocation over ~1,750 files; with `projectService` and
   `recommendedTypeChecked` it builds one TypeScript program over both trees and dies before reporting a single
   finding. The consequence is worse than slowness: **the gate could never pass**, so it was either ignored or
   worked around, and it said nothing about the code either way. Measured: `src` alone ~60 s, `test` alone ~70 s,
   both together exceed the 3 GB runner. Split into `lint:src` + `lint:test`; `npm run lint` now exits 0.
2. **That broken gate was hiding eight genuine lint errors**, two of them in migrations written during this
   programme (unsafe `any` from `QueryRunner.query` in the Group 19 and Group 20 migrations). Fixed rather than
   suppressed, except where suppression is correct (a deliberate `require()` that must load a module lazily, and
   a triple-slash reference that needs global scope).
3. **`npm run format:check` was failing on six files** predating this programme. Now green repo-wide.
4. **`apps/agent-mobile` was not in the workflow at all** — 323 passing unit tests and a clean `tsc` that never
   ran on any push. A suite CI does not execute is not a gate.
5. **The Dockerfile was never built.** A careful multi-stage non-root production image that no pipeline compiled.

The container job claims only that the image **builds** (`push: false, load: false`); it does not run the image
and does not execute `docker compose`. No container runtime exists in this sandbox, so the build's success is a
GitHub-side fact, not one asserted here.

**Gates as code.** A workflow is a document that does not defend itself, so `ci-gate.service.ts` reads the file
and asserts each required job, its required steps, and every npm script those steps call. Mutations confirm it
works: deleting the `agent-mobile` job produces 3 failures; removing `npm run test:pg` reports
`job:backend-postgres` missing; deleting the container job reports it missing; removing the `test:pg` script
reports `script:test:pg` missing. There is also an assertion that the PostgreSQL job does not contain
`continue-on-error: true` — a gate allowed to fail is not a gate. The extractor reads job indentation from the
file so a reformatted workflow does not produce false "gate missing" failures.

**Deliberately absent, as unmade decisions:** no deploy job, no registry push, no digest pin, no coverage
threshold (a number invented to pass), no security scanning/SBOM/signing, no environment configuration, no branch
protection (those live in repository settings and cannot be asserted from a file).

### Group 28 — performance acceptance

`src/performance/performance-acceptance.service.ts`, `src/performance/performance.module.ts`,
`test/performance-acceptance.integration.spec.ts` (10 integration assertions) and
`docs/integration/PERFORMANCE-ACCEPTANCE.md`.

**There was no performance harness.** The obvious deliverable — a table of p99 latencies and throughput figures —
would be fabricated: one Postgres instance, synthetic data, no network, no pool contention, no concurrent load.
Publishing those numbers as acceptance evidence is the performance equivalent of an alert channel reporting a
delivery it never performed.

**What is measured instead: query plan shape.** A statement that seq-scans at 1,000 rows seq-scans at 10 million;
the plan is a property of schema, indexes and query text, all identical between here and production. What is
_not_ identical is how long the same plan takes. So "does this hot query use an index?" has a truthful answer
here and "how fast is it?" does not. Eight hot paths are planned, including the outbox claim query, which runs
every worker tick whether or not there is work — a seq scan there is a permanent tax, not a slow page.

**Three rules keep it honest.** (1) Below a declared `minRows` threshold a finding is `NOT_MEASURED`, never
`PASS`, because Postgres correctly seq-scans small tables and calling that a pass claims a validation that never
happened. (2) Parameters are realistic values, never `NULL` — substituting `NULL` lets the planner prove the
predicate is unsatisfiable and return a `Result` node touching no table, so the harness "measures" nothing while
appearing to succeed. **Verified by mutation:** forcing every parameter to `NULL` failed exactly the four
plan-shape tests. (`PREPARE`/`EXECUTE` was tried first and does not work: Postgres rejects bound parameters in an
`EXECUTE` argument list.) (3) `EXPLAIN` without `ANALYZE`, so the harness plans queries and never executes them,
making it safe against data that matters.

**The harness can fail.** Dropping `idx_audit_events_entity_time` turns the entity lookup from `PASS` to `ERROR`
with a sequential scan, and drags the aggregate verdict with it. The report also confirms the Group 23 range
index is the one the evidence export uses — an index nobody uses is only write amplification.

Explicitly **not** measured, recorded in the report rather than omitted: latency, throughput, concurrency and
contention, worker tick cost under a real backlog, index bloat, end-to-end user-perceived latency, connection-pool
sizing. A structural test asserts the report contains no timing field and no latency or throughput value.

### Group 27 — privacy and retention

`src/migrations/1785753600614-PrivacyAndRetention.ts`, `src/privacy/erasure.service.ts`,
`src/privacy/privacy.module.ts`, `test/privacy-retention.integration.spec.ts` (27 integration assertions),
3 unit assertions in `test/operations-centre.spec.ts`, and `docs/integration/PRIVACY-AND-RETENTION.md`.

**Nothing could answer a data-subject request.** Searches for "retention", "erasure", "anonymise", "right to" and
"data subject" returned only unrelated hits; `customers` has a soft-delete timestamp, which hides data rather
than erasing it.

**Why a request workflow and not a delete.** Ledger records are immutable by trigger precisely so money movement
cannot be edited — an erasure routine reaching into them would fail or, worse, succeed because someone relaxed
the trigger. Statutory retention periods are not mine to invent: deciding a Nigerian customer's KYC evidence may
go after 30 days carries criminal liability. And an erasure must be auditable without retaining the data.

**The safety property: no policy means no erasure.** `privacy_retention_policies` ships empty, `erasable`
defaults to false, and a category with no policy row is held with the gap recorded. **Verified by mutation** —
defaulting a missing policy to `erasable: true` failed exactly that test and nothing else.

**Refusing is a first-class outcome.** `HELD_UNDER_RETENTION` with the legal basis recorded is the correct answer
to most real requests in a financial institution, and a system that can only say "done" or "failed" cannot give
it. `PARTIALLY_COMPLETED` is deliberately **not** terminal — it means the part that can be done is done and the
rest is still owed, so closing it would end the tracking of what the customer is waiting for. A schema conflict
during development revealed my first constraint treated it as terminal; the workflow won and the constraint
changed.

**Verification gates erasure.** An unverified claimant cannot erase a customer's data — that is a denial of
service against the customer, not a service to them.

**Anonymisation, never deletion, and never the ledger.** Targets are fixed and enumerated per category, with no
dynamic SQL and no caller-supplied table name. Rows survive because the financial history still needs an owner.
`city`/`state`/`country` are NOT NULL so they are replaced rather than nulled — nulling would fail the update and
leave the data in place while the log claimed otherwise; that too was caught by a test. `BENEFICIARY_DETAILS`,
`AUTHENTICATION_CREDENTIALS` and `RISK_FACTORS` are reported as `NOT_IMPLEMENTED` with zero rows touched rather
than approximated: they need their own decisions. A test asserts `ledger_journals` is unchanged and that no
action row names a ledger table.

**The record of erasure is evidence but does not contain what was erased** — a log that kept a copy would defeat
the erasure. Claim fields are immutable, requests cannot be deleted, `down()` refuses while any request exists.

Known gaps from Group 27: no HTTP surface (raise/approve/execute are three authorization decisions and the
approver must not be the requester); retention is registered but **not enforced** — nothing sweeps old data
because no period is configured; `minimum_age_days` is stored but not consulted, because "the age of the data"
per category needs a definition that depends on the retention rule itself; three categories cannot be erased; no
export/portability counterpart; no consent register.

### Group 26 — SMS and email delivery receipts

`src/migrations/1785753600613-NotificationDeliveryReceipts.ts`,
`src/notification/notification-receipt.service.ts`, `test/notification-receipts.integration.spec.ts`
(27 integration assertions), 4 unit assertions in `test/operations-centre.spec.ts`, and
`docs/integration/SMS-AND-EMAIL-DELIVERY.md`.

**The pipeline already sent correctly; nothing could learn what happened next.** The dispatcher, the leased
delivery processor with bounded retries, the Brevo/Resend/SMS adapters and the opt-out resolver with its
security-critical bypass were all already there and were not rebuilt. But `email-provider.interface.ts` said in
its own comment that confirmed delivery was "a documented future enhancement": `SENT` meant _the provider
accepted it_. A dead destination was retried forever, "did the customer receive the OTP that mattered" was
unanswerable, and bounce/complaint rates — the signals that get a sending domain blocked — were invisible.

**A receipt never rewrites the original verdict.** A delivery marked `SENT` stays `SENT`; a later bounce is a
separate fact with its own timestamp, so the history reads "accepted at 10:00, bounced at 10:00:04". Collapsing
the two would erase the distinction between _the system could not know_ and _the system knew and continued_ —
the same declared-versus-measured discipline that governs recovery and alerting here. A test asserts the
delivery row is untouched after a hard bounce lands against it.

**Suppression is the most dangerous write in the group**, because it stops messages that deliberately bypass
opt-out. It requires permanent evidence (hard bounce, spam complaint, unsubscribe) **and** an authenticated
receipt. Deferrals and soft bounces never suppress: a greylisted server or a full mailbox is temporary, and
suppressing there cuts off a customer whose only problem was timing. An `UNVERIFIED` receipt — a public webhook
is forgeable — is recorded but cannot suppress, enforced by a table `CHECK`. **Verified by mutation:** removing
that `CHECK` failed exactly the DB-layer test and nothing else; restoring returned 27/27.

`(channel, provider_event_id)` is unique, so the same webhook arriving five times is one bounce rather than
letting whichever provider retries hardest dominate the reputation calculation. Destinations are stored as hash
plus masked form, because a bounce dashboard must not become a readable list of customer phone numbers.

`notification_security_delivery_posture` answers "how many security notices did we _know_ reached the
recipient". `no_receipt` is deliberately **not** a failure — most providers do not report every message, and
alerting on it would be a permanent signal that trains operators to ignore the area. Only `knownUndelivered`
produces an operations-centre item, and it is `IMMEDIATE`.

Known gaps from Group 26: **no webhook HTTP endpoint** — the service is tested but nothing exposes a public
route, which needs per-provider signature verification and no provider webhook secret exists in this
environment; no provider signature scheme implemented (`verification` is set by the caller); no status-polling
fallback; **suppression is advisory, not enforced** — `isSuppressed()` exists but the delivery processor does not
call it, because wiring it in changes send behaviour and needs the interaction with the security-critical
bypass decided deliberately; open/click receipts are stored but not aggregated; `down()` refuses once any
receipt exists.

### Group 25 — customer and agent mobile client support

`src/migrations/1785753600612-MobileClientSupport.ts`, `src/mobile/mobile-client-support.service.ts`,
`src/mobile/mobile.module.ts`, `test/mobile-client-support.integration.spec.ts` (23 integration assertions),
and `docs/integration/MOBILE-CLIENT-SUPPORT.md`.

**Both mobile surfaces already worked; nothing knew what was talking to them.** `CustomerAppController` and the
agent controllers serve the clients, and `ApiVersionService` reports a version list — but nothing reads the
`X-API-Version` header it advertises, `deprecated` is hard-coded empty, and `APP_VERSION` describes the
_server_. So "a customer is running a build from eight months ago — is that acceptable?" had no answer:
no build register, no support floor, no degradation policy, no adoption visibility.

**Four states instead of a boolean.** `DEPRECATED` is advisory and does **not** refuse money: an old app that
still works is not a security event, and refusing a transaction because someone has not updated is a worse
outcome than a stale UI. `UNKNOWN` is served rather than blocked, because an empty register is the normal case
and a malformed version usually means a client parsing bug — blocking there turns a cosmetic defect into an
outage for every user of that build. A build above every registered version is reported `UNKNOWN` rather than
`SUPPORTED`, because the register has not seen it.

**The floor is read from the register, never from the client's own row.** A release engineer raises the floor on
the newest build; if the floor came from the matching row, an old client would keep its own old floor forever —
exactly the failure a force-update prevents. `evaluate()` takes the highest floor across the client/platform.

**Versions compare numerically, verified by mutation.** Comparing labels puts `9.10.0` below `9.9.0`, silently,
and the bug appears only on the release that crosses a double-digit component. Mutating `compare()` to lexical
comparison failed exactly that test and nothing else.

**A blocked build must state why** (`floor_rationale`, enforced in service and schema): an unexplained block is
the kind of thing that becomes a complaint. The register is a release fact — identity immutable, `DELETE`
refused, `down()` refused while builds exist — so a past force-update stays explainable.

**Adoption visibility stores no identities**: sessions per build per day, with a test asserting the table has no
`device_id`, `customer_id` or `request_id`. Blocked and deprecated shares are reported separately because they
call for opposite decisions. Telemetry failure is swallowed: a metric is never worth failing a customer
request.

Known gaps from Group 25: **no request-path enforcement yet** — the service is tested but no controller calls
it, because whether an endpoint should enforce `allowed` or merely surface the advisory is a per-endpoint
decision this group did not make for existing routes; no push notification of a required update; no staged
rollout; no app-store reconciliation; no device attestation.

### Group 24 — complaints and transaction disputes

`src/migrations/1785753600611-ComplaintsAndDisputes.ts`, `src/disputes/dispute.service.ts`,
`src/disputes/disputes.module.ts`, `test/disputes.integration.spec.ts` (39 integration assertions),
4 unit assertions in `test/operations-centre.spec.ts`, and `docs/integration/COMPLAINTS-AND-DISPUTES.md`.

**`SupportService` is a helpdesk, not a disputes register.** It has tickets, categories, assignment, threads and
status, and `related_transfer_id` even points at a transaction. But a ticket is a conversation; a dispute is a
claim with a decidable outcome against an identified transaction, for a stated amount, under a stated grounds,
where a refusal is a first-class outcome and where closing requires the claimant to have been told. Searches
for "complaint", "redress" and "chargeback" returned nothing outside commercial-governance constants, so the
object was genuinely missing.

**A dispute cannot move money, and the schema makes that structural.** An upheld decision credits nobody and
touches no journal; it records an amount owed and points at the governed path — `LedgerReversalGovernance` or
the approval machinery — that must execute it. There is no journal, wallet or credit-account column anywhere in
the table, `remedy_execution_reference` is a pointer and never an authorization, and `DisputesModule`
deliberately does not import `LedgerModule`. A test completes a full upheld lifecycle and asserts that
`ledger_journals` and `ledger_lines` are unchanged. The alternative is the hole this avoids: a support agent
with dispute rights would hold an unaudited path to customer funds that bypasses reversal governance.

**An upheld award needs two people, enforced by CHECK.** The adjudicator must differ from the raiser and from
the investigator; removing the constraint failed exactly the DB-layer test and nothing else, so the guard is
load-bearing rather than decorative. A rejection has no such requirement: a decision owing nothing is not a
financial act.

**The award must match the outcome** (full = claim, partial strictly between zero and the claim, rejected and
withdrawn = zero), in the service and in the schema. **The claim is immutable** — otherwise the award rules
could be satisfied by editing the claim instead of honouring it, a full uphold of 1 naira against a rewritten
claim. **The decision is final**: outcome, award and adjudicator cannot change after the fact.

**Closure requires that the claimant was told**, and that any award was executed. This is the substantive rule
of the group: an un-informed customer is not a resolved case, it is the regulatory complaint, and closure is
the moment everyone stops looking. Correspondence distinguishes an internal note from a communication to the
customer, because conflating them is how a bank convinces itself it informed someone who heard nothing.

The operations centre reports **three separate populations** — undecided, decided-not-informed,
awarded-not-executed — each `IMMEDIATE` except undecided-until-a-week-old. Collapsing them into one "open
disputes" number would hide the two that are actual failures.

Known gaps from Group 24: no HTTP surface (customer-raise and staff-decide need different authorization
policies, and an upheld decision needs a financial-control policy — all access decisions this group does not
make); `recordRemedyExecution` records a reference but cannot verify the ledger execution without trusting its
own write; no appeal or regression claim; no card-scheme or ombudsman escalation; no dispute SLA (age is
reported, the correct deadline is a regulatory decision); no customer-facing status view; `down()` refuses once
any dispute exists.

### Group 23 — compliance readiness: evidence export and case age

`src/migrations/1785753600610-ComplianceRegister.ts`, `src/compliance/compliance-audit-export.service.ts`,
`src/compliance/compliance.module.ts`, `test/compliance-audit-export.integration.spec.ts` (29 integration
assertions), 3 unit assertions in `test/operations-centre.spec.ts`, and
`docs/integration/COMPLIANCE-READINESS.md`.

**The trail was already trustworthy and the case workflow already real.** `audit_events` has had a
`BEFORE UPDATE OR DELETE` trigger since `1785753600005`, and `CustomerComplianceService` handles category,
severity, assignment, comments, evidence and history. Neither was rebuilt.

**The gap was that the first question an auditor asks could not be answered.** `AuditService.list()` has no
date bound at all — it filters by entity, entity id and correlation, and caps at 1,000 rows — so "show me
everything between these two dates" was unanswerable through any interface and could not be assembled by
widening a filter. There was also no index on `occurred_at` alone, so even a hand-written range query would
seq-scan an append-only table.

**Paging is keyset on `(occurred_at, id)`, not `OFFSET`.** The trail is being appended to continuously; an
offset page shifts when a row lands before the cursor, silently repeating one row and skipping another, and
for evidence a skipped event is the worst available failure. The composite cursor also makes a page
reproducible, which is what makes it usable as evidence.

**The `id` tiebreak was not load-bearing in my first test, and I found that by mutating it.** My initial
data had unique timestamps, so removing the composite comparison left the suite green. Nine events on the
same instant — which is what a batch write or a replay produces — made the mutation fail exactly that test.
Recorded because a passing mutation is the only reliable signal that a test was measuring the thing I
thought it was.

**Every page is registered, and the register is append-only.** Taking a copy of the trail is itself
security-relevant, so `compliance_audit_exports` records requester, principal type, range, applied filters,
cursor, row count, observed bounds and a **required** stated purpose. Constraints require a whole cursor or
none, keep reported bounds inside the requested range, and refuse a blank purpose. The page read and the
register write share one transaction; a refused export writes nothing because it took no evidence. The
register records **pages, not sessions**, because the system cannot know whether a caller meant to continue
and claiming a completed session would be worse than reporting pages.

**Deadlines are configured and missing ones are reported as missing.** `compliance_case_sla` is seeded with
**no rows**: the right deadline for an AML case versus a document case is a regulatory decision, and a
seeded number would present an invented policy as an implemented control. The operations centre therefore
reports breaches as `IMMEDIATE` and categories with no deadline as a separate `ROUTINE` gap — explicitly not
as zero breaches, because a compliance view showing zero breaches because nothing was configured is the same
failure as a supervisor reporting healthy when it measured nothing.

Known gaps from Group 23: no controller (who may export is an open access-policy decision); no scheduled
export (the outstanding Group 15 invocation requirement again); no cryptographic commitment proving an export
equals the trail at a point in time; no case-scoped export helper; `down()` refuses once any export exists,
so the schema cannot be rolled back after evidence has been produced.

### Group 22 — fraud and risk signals

`src/migrations/1785753600609-FraudRiskSignals.ts`, `src/fraud/fraud-detection.service.ts`,
`src/fraud/fraud.module.ts`, `test/fraud-detection.integration.spec.ts` (22 integration assertions),
4 unit assertions in `test/operations-centre.spec.ts`, and `docs/integration/FRAUD-AND-RISK.md`.

**Risk was already enforced; pattern detection was absent.** `CapabilityPolicyService.evaluateRisk` consumes
`CustomerRiskProfileService` and DENY/PENDING_REVIEWs on `CRITICAL`, stale, missing or legacy-`PROHIBITED`
levels — real enforcement, not duplicated here. `LimitEnforcementService` enforces fixed pre-approved ceilings
including `DAILY_COUNT`/`DAILY_AMOUNT`. What did not exist: velocity, duplicate-shape, or any record of what
fired and how it was dispositioned. A daily limit is a ceiling, not a signal — five transfers of 10,000 under
a 100,000 limit are invisible.

**Detection is separated from financial authority.** A finding cannot stop money. Blocking remains with
limits, capability policy, balances and authorization. The migration has **no blocking verdict value** —
`escalation` is `OBSERVE` or `REVIEW_QUEUE` only — because a heuristic that also refused transfers would be a
second unaccountable authority over customer funds whose behaviour changes when a threshold is tuned, and
velocity/duplicate rules have predictable false positives (salary in three parts, institutional bulk pay).

**Findings dedupe at the source, not at the aggregation layer.** Group 20 fixed that class of bug by filtering
duplicates downstream; here `dedupe_key` is unique and a repeat observation refreshes the open finding. Two
consequences: a refresh is **not** counted as a new finding (`xmax = 0` distinguishes the insert branch from
the update branch — without it the run summary over-reports), and `observed_count` rising on one finding shows
escalation that duplicate rows would hide.

**A corrected test caught a test that would have passed for the wrong reason.** The dedupe test initially gave
all three runs the same `now`, so a dedupe key that wrongly included the run time would still have collided
and the suite stayed green under mutation. Advancing the clock between runs made the mutation fail exactly the
two dedupe tests; restoring returned 22/22. Recorded because "green under mutation" is not the same as "the
guard is load-bearing", and the first mutation I tried (`DO NOTHING`) also left the suite green because it
returns no row at all — a bad mutation looks exactly like a good guard.

**A run that did not look is not a clean run.** `fraud_evaluation_runs` records every evaluation including
failures. The operations centre reports detection that never completed as `FRAUD` `unavailable` (forcing
`partial`, never `clear`) and a stalled evaluator as a separate `IMMEDIATE` item from finding volume — folding
staleness into the findings item would make "no findings" look like good news.

**Findings are append-only evidence:** DELETE refused by trigger; observation columns immutable; disposition
changeable; `DISMISSED`/`ESCALATED` cannot return to `OPEN`; dismissal needs a reason; reviewed status needs a
named reviewer and timestamp; a dismissed finding is not re-raised by the same rule and bucket. `down()`
refuses while any finding exists.

**Thresholds are configuration, and out of the box the system detects nothing — and says so.** All windows,
counts and amounts live in `fraud_signal_rules`; there is a test asserting `rulesEvaluated: 0` with no rules,
because a hard-coded plausible value would dress an invented policy as an implemented control. `NEW_DESTINATION`
is a declared type that never fires: a genuine new-destination check needs durable first-seen history, and the
approximation would fire on every quiet customer's first payment.

Known gaps from Group 22: no rule is configured until the product owner sets thresholds; no blocking or
automatic hold by design; **no scheduled invocation** — this is the same outstanding Group 15 requirement that
supervision is not execution; no automatic compliance-case creation (`REVIEW_QUEUE` is recorded, not acted on);
no HTTP surface (deciding who may read fraud data is a policy decision); no sanctions/watchlist/device
controls; `MAX_FACTS_PER_RUN` bounds a run to 5,000 facts, so a busy deployment needs windowed evaluation.

### Group 21 — operational security: break-glass review

`src/migrations/1785753600608-EmergencyAccessReviewRequirement.ts`,
`src/authorization/emergency-access-review.service.ts`, `test/emergency-access-review.integration.spec.ts`
(15 integration assertions, all passing), 4 unit assertions in `test/operations-centre.spec.ts`, and
`docs/integration/OPERATIONAL-SECURITY.md`.

**I reviewed break-glass before adding anything, and it was already sound.** `activateEmergencyAccess` requires
the distinct `privileged:break-glass` permission plus MFA and goes through the same privileged-action approval
machinery; the TTL is clamped between `MIN_EMERGENCY_TTL_SECONDS` and `MAX_EMERGENCY_TTL_SECONDS` by
`normalizeEmergencyTtl`, so no caller can request an unbounded grant; `requiresExpiry`/`applyExpiry` enforce
the end of the window lazily on access, so expiry does not depend on a scheduled job running; revocation
exists; every transition writes both an audit row and a `SecurityEvent`. Adding a second gate there would have
been redundant, and the standing instruction is to review before adding.

**The gap was post-incident review.** The common path from temporary emergency grant to permanent one is not a
failure to expire — it is that the window closes and no named person ever records what happened inside it. An
expired, unreviewed record is indistinguishable from an expired, abused one.

**The obligation is a database constraint, not a dashboard flag.** `chk_emergency_review_complete` requires a
timestamp _and_ a named reviewer _and_ non-empty notes before `REVIEWED` is accepted; `chk_emergency_review_only_for_emergency`
keeps the column meaningful; `chk_emergency_review_after_window` blocks backdating a review to look timely.
A review that lives only in a service method is advisory — anything writing the row directly could leave a
window closed and unreviewed with nothing objecting. **This was verified, not assumed:** removing
`chk_emergency_review_complete` from the migration made exactly two tests fail — the two that attempt the
bypass with direct SQL — and restoring it returned 15/15. The guard is load-bearing.

The **backfill marks closed emergency windows as `PENDING_REVIEW`** and deliberately does not synthesise a
review, reviewer or notes for them: those windows have no recorded review, and inventing one would falsify
security evidence. **Reviews are not amendable** — a review is evidence of what a named person concluded at a
moment, so a wrong review is corrected by a new record, not an overwritten one. `down()` **refuses** to run
while any review record exists, because rolling back would erase security-audit evidence.

The operations centre now surfaces unreviewed emergency access as a `SECURITY` item when the review service is
present. **Urgency escalates with age, not count** — one window forgotten for a week is worse than five
reviewed promptly; past 24 hours outstanding it is `IMMEDIATE`. An unreadable review state is `unavailable` and
forces `partial`, never `clear`. The dependency is `@Optional()` so the centre stays constructible without the
authorization graph; the DI wiring test proved this was required, not defensive.

**No new permission, scope or approval path was invented**, and no reviewer assignment or deadline was
fabricated — who must review, and by when, is a product-owner decision that the system records the obligation
and its age against rather than guessing.

Known gaps from Group 21: no reviewer assignment or SLA; no notification when a review becomes owed
(`NoneAlertChannel` is still dark — the alert-creation/delivery distinction is unchanged); review is
recording-only and triggers no disciplinary or escalation workflow; no review UI.

### Group 20 — operations centre

`src/operations/operations-centre.service.ts`, `test/operations-centre.spec.ts` (15 assertions),
`GET /internal/operations-centre`, and `docs/integration/OPERATIONS-CENTRE.md`.

**The problem was aggregation, not detection.** By Group 19 every signal existed, each behind its own
endpoint: queue depth, dead letters, stalled leases, per-worker state, supervision status, integrity
passes, alert conditions. An operator starting a shift had to know which of a dozen endpoints to call and how
to combine the answers. That is a filing cabinet.

**The rule that shapes it: nothing here decides anything new.** Every item is derived from the service that
already owns the verdict — integrity from Group 18's `lastPasses()`, queue from Group 14's `health()`, worker
state from Group 15's `report()`, conditions from Group 19's `evaluate()`. Re-deriving a verdict in the
aggregator would create a second source of truth that can disagree with the endpoint the operator is
simultaneously looking at, with no way to tell which is right.

**`clear` means measured-and-clear.** It requires an empty `items` list **and** an empty `unavailable` list.
Reporting `clear` while a source was unreadable is the same failure as a supervisor reporting healthy when it
measured nothing.

**Two real duplicates were found by inspecting actual output**, not by writing a test first: the
indeterminate supervision state appeared as both `supervision:indeterminate` and
`alert:worker.supervision-indeterminate`, and a failing worker could appear both individually and as a
generic alert. Both are now suppressed with regression tests. Duplicates are how an operator learns to
distrust a list.

**It is deliberately read-only.** No acknowledge, resolve, retry, requeue or replay — those are audited write
paths needing their own authority decision (Groups 21–22), and requeueing a dead letter re-submits an
external operation. A test asserts the service exposes exactly one method, so adding a mutation surface fails
the suite and forces the authority question to be asked rather than assumed.

Ids are stable across polls (`integrity:<check>`, `queue:dead-letters`, `worker:<name>:<STATE>`), because an
id that changed per poll would make "is this the same problem?" unanswerable — the exact question Group 18
exists to answer. Passing checks are not listed; they would bury the failing ones.

### Group 19 — alerting: the contract, and the suppressions that make it survivable

`src/operations/alerting.types.ts`, `src/operations/alerting.service.ts`, `test/alerting.spec.ts`
(19 assertions), `GET /internal/alerts`, `/internal/alerts/active`, and `docs/integration/ALERTING.md`.

**Severity is not urgency, and the two are separate fields.** 40 dead letters is `CRITICAL` severity but
`ROUTINE` urgency — severe, but a stable backlog is a known condition. A single stalled lease is `CRITICAL`
**and** `IMMEDIATE`, because a worker is dying mid-delivery right now. Collapsing them produces either a
channel that cries wolf or one that under-reports; both are tested.

**The substance is suppression, not detection.** Two mechanisms:

- **Deduplication keys the condition, not the occurrence** — `worker.stale:banking-dispatch`. A key containing
  a timestamp would make every evaluation a new alert and deduplication accomplish nothing.
- **Flap suppression** — a condition that clears and returns within the window is the same incident. An
  oscillating check otherwise produces a stream nobody reads, which trains operators to ignore the channel
  and then hides the real incident.

**Silence is never ambiguous.** `satisfied` and `skipped` are reported alongside `alerts`, so "no alerts" is
distinguishable from "could not check". An unreadable source is `skipped` with a reason, never satisfied. Each
source is evaluated independently: a database failure silences the outbox rules and leaves the worker rules
running, because the worker signal usually explains the database problem.

**Delivery is deliberately dark.** `NoneAlertChannel` records and returns `delivered: false`. No vendor is
integrated, because which paging product to use — and what it costs — is the product owner's decision, and
inventing an integration would invent an entitlement. `deliveryConfigured` and `channel` accompany every
response so an evaluation cannot be mistaken for a notification. **No alert has been delivered to any human
by this system.**

`integrity.regression` is **not** emitted by the evaluator: it comes from `/internal/integrity`, which
performs the drift comparison. Re-running reconciliation inside the evaluator would make alerting a second
caller of a read-only scan and a second source of integrity truth. The rule is reported as `skipped` with
that reason rather than silently omitted.

**A defect the AppModule boot test caught again:** `AlertingService` used `import type { DataSource }`, which
erases the decorator metadata, so Nest saw `Function` at index 0 and failed to resolve. Interface-typed
optional dependencies (`AlertChannel`, `AlertTuning`) had the same class of problem and now carry explicit DI
tokens.

### Group 18 — integrity monitoring: snapshots and drift

`src/operations/integrity-monitoring.service.ts`, `src/migrations/1785753600607-IntegritySnapshots.ts`,
`test/integrity-monitoring.integration.spec.ts` (13 assertions against real PostgreSQL),
`GET /internal/integrity`, `/integrity/history`, `/integrity/last-passes`, and
`docs/integration/INTEGRITY-MONITORING.md`.

**Integrity was already enforced; it was not observable over time.** Write-time triggers refuse an
unbalanced journal and reject ledger mutation, and `ReconciliationService` runs eleven cross-table checks.
Verified against a clean database: all eleven `PASS`. But `runReconciliation()` was **stateless** — it
returned a report and persisted nothing, so two questions were unanswerable: _was this balanced yesterday,
and when did it stop?_ and _is this failure new?_

**Why the second question is the one that matters.** A check showing `ERROR` today and yesterday is a known
problem being worked. The same check flipping `PASS` → `ERROR` between runs is a new incident. From one
report the two are identical, which is how a newly-broken invariant gets triaged as "the same old
reconciliation warning" and sits for a week.

**What was added.** Append-only `integrity_snapshots` + `integrity_check_results` (enforced by a database
trigger — `UPDATE`/`DELETE` raise `restrict_violation`, because the evidence used to judge whether a drift is
new must not be editable), and drift classification:

| Yesterday | Today   | `change`                 |
| --------- | ------- | ------------------------ |
| ERROR     | ERROR   | — (stable, known)        |
| PASS      | ERROR   | `newly-failing`          |
| PASS      | WARNING | `newly-degraded`         |
| ERROR     | PASS    | `recovered`              |
| —         | any     | `new` (not a regression) |

`regressionDetected` is true only for the two new-incident rows, and is the field an alert should key on —
**not** the aggregate status, or a week-old failure pages on every run until the alert is muted.

`finding_count` is stored per check because "3 mismatches" and "3000" call for different responses, and a
bare `ERROR` loses that. `lastPasses()` answers "how long has this been broken?".

**Two design points worth carrying forward.** `record()` never throws: readiness and diagnostics also run
reconciliation, so failing those because the _history_ table is unavailable would convert an observability
problem into an availability problem — instead the report returns `snapshot: null`, and the runbook says a
null snapshot means "history incomplete", not "integrity fine". And monitoring stores verdicts verbatim
rather than recomputing the aggregate, so it never becomes a second, divergent source of integrity truth.

A first-ever observation is reported as `new`, **not** as a regression — otherwise every deployment that
adds a check would fire an alert.

### Group 17 — operational metrics, and the signals that had no consumer

`src/operations/operational-metrics.service.ts`, `test/operational-metrics.spec.ts` (11 assertions),
`GET /internal/operational-metrics`, `GET /internal/metrics/prometheus`, and
`docs/integration/OPERATIONAL-METRICS.md`.

**The gap was not "no metrics".** It was that Groups 14 and 15 built genuine observability primitives and
nothing consumed them: `WorkerLeaseService.health()` (pending, dead-lettered, stalled, oldest age) and
`deadLetters()` had **no callers at all**, and `WorkerScheduler.report()` existed only as a JSON endpoint a
human had to pull. The dead-letter queue — the mechanism added so a poison event could never retry forever —
was invisible unless an operator ran the query by hand.

**What was added.** A collection point: queue gauges read from PostgreSQL, per-worker gauges and counters
from the supervisor, a one-hot `worker_supervision_status`, and a hand-written Prometheus exposition
(no client library — the surface has no histograms and a registry would add lifecycle with no caller).

**Two rules make the output usable, and both are tested:**

- **A missing metric is not a zero metric.** `unavailable[]` names every signal that could not be collected
  and the affected series are **absent**. Verified against a real database with no `outbox_events` table:
  `unavailable: [{signal: "outbox"}]`, 0 outbox samples, **27 worker samples still emitted**. An endpoint
  that 500s because one source failed would remove the wrong information during an incident.
- **Fleet-wide and process-local signals are different.** `outbox_*` is read from the database and is
  fleet-wide; `worker_*` is one process's observation. Mixing them unlabelled would let a dashboard average
  away a dead instance.

Labels are restricted to a closed set (`worker`, `status`) — **no identifier ever appears in a label**, which
is both a cardinality limit and a privacy boundary, asserted in the suite. Label escaping is exercised
through the real formatter, because an unescaped quote produces an exposition a scraper rejects wholesale.

### Group 16 — structured logging and redaction at the sink

`src/production/pino-config.ts`, `src/common/sensitive-data-redaction.ts`,
`test/logging-redaction-at-sink.spec.ts` (11 assertions), and
`docs/integration/STRUCTURED-LOGGING-AND-REDACTION.md`.

**The configuration looked complete.** A long `redact.paths` list covered authorization headers, cookies,
API keys and 31 `req.body.*` fields. Writing one log line and reading it showed two independent problems.

**The paths only reached HTTP logs.** Every entry began `req.` or `res.`, so a service or worker log — which
carries provider payloads, PINs and database coordinates — matched nothing. Measured with a plain pino
instance using the production list, `{ providerApiKey, customerPin, nested: { dbPassword } }` was written
verbatim.

**The object redactor matched exact names only.** Its key list contains `apikey`/`password`/`pin`, so the
compound names this codebase actually uses were invisible: `agentPin` (32 uses in `src/`), `customerPin`
(10), `providerApiKey`, `dbPassword`. This was not only a logging defect: `redactRecord` shares that
function and is used at **30 call sites**, including persisted audit metadata.

**Fixes.** A `formatters.log` hook applies object redaction to every record from every logger — the only
place that covers both HTTP and non-HTTP sinks — and **fails closed**, replacing a record with
`{ redactionFailure: true }` if the redactor returns a non-object rather than emitting it unredacted. A
bounded **prefix** rule over a named qualifier list (`agent`, `customer`, `db`, `provider`, …) is layered on
the unchanged exact-match list. A suffix rule was rejected because it would swallow `pinAttemptCount` and
`tokenCount`; the suite asserts those survive.

**Both fixes were verified to be independently load-bearing** by reverting each: without the hook 5 of 11
fail, without the prefix rule 6 of 11 fail, with both restored 11/11 pass. The tests emit **real log lines
through a real pino instance**; a test that inspected the options object would have passed against the
broken configuration.

**Known limitation, stated in the runbook:** redaction is **name-based, not value-based**. A credential
placed in a generically named field (`note`, `comment`) is not detected.

### Group 15 — worker scheduling and supervision

`src/operations/worker-scheduler.service.ts`, `src/operations/worker-supervisor.service.ts`,
`test/worker-supervision.spec.ts` (16 assertions), `GET /api/v1/internal/workers`, and
`docs/integration/WORKER-SCHEDULING-AND-SUPERVISION.md`.

**The decision that shaped the group.** Group 14 established that the existing ownership mechanisms are
correct — the banking lease with fencing, KYC's `ON CONFLICT DO NOTHING`, and the outbox's
`FOR UPDATE SKIP LOCKED`. A scheduler that "owns" the workers would therefore have created a **second**
authority over the same concern: a scheduler deciding when banking dispatch runs while the database lease
decides who may dispatch. Two authorities over one concern is how double-dispatch bugs are born.

So this group adds **supervision, not scheduling**. Every worker keeps its own driver and its own
cross-process guarantee; the supervisor attaches to each tick as an observer, records timing and outcome,
and returns the result untouched. The attachment is optional — a worker with no supervisor runs exactly as
before, so supervision is never a precondition for financial work.

**What it adds.** One authoritative per-instance view: which workers exist, whether each is enabled and
actually ticking, last success/failure, duration, and consecutive failures. Previously this was scattered
across four `getStatus()` methods with different shapes, of which three did not exist.

**`indeterminate` is load-bearing.** If nothing was measured — every worker disabled, or supervision attached
to a process that is not the driver — the aggregate status is `indeterminate`, not `ok`. A supervisor that
reports `ok` when every worker is switched off is worse than none: it converts an unmeasured system into an
apparently-checked one. `disabled` and `neverObserved` are separate lists because the operator action is
opposite — a configuration decision versus a fault.

**Two real defects were caught by tests that already existed:**

- `WorkerLeaseService` had a defaulted primitive constructor parameter, which Nest reads as a dependency at
  index 0. The unit suite passed (it constructs the class directly); the **AppModule boot test** failed.
  Fixed with `@Optional()` plus a normalised field.
- The registry's first draft guessed that banking's interval key was
  `BANKING_DISPATCH_WORKER_POLL_INTERVAL_MS` by analogy with the other three. It is
  `BANKING_DISPATCH_POLL_INTERVAL_MS`. That failure is silent — the registry reports a default while the
  worker runs on a configured value — so the exact key strings are now pinned in a test. Banking enablement
  also follows `BANKING_DISPATCH_WORKER_ENABLED ?? (BANKING_ENABLED && !test)`, mirroring the module
  factory; both branches are tested.

**Configuration is not duplicated.** The registry reads the same keys through the same `ConfigService` as
each worker. A second set of supervisor keys would let the registry and the worker disagree, and the
registry's answer would look authoritative while being wrong.

**What the report cannot see**, recorded in the payload itself and in the runbook: it is process-local, it is
not a liveness proof for the queue (a worker can be healthy while the queue does not drain), it says nothing
about external submission outcomes, and it does not measure recovery. Declared objectives (Group 13) and
measured recovery performance remain distinct.

### Group 13 — disaster recovery objectives and resume policy

`src/recovery/disaster-recovery.service.ts` and `test/disaster-recovery.spec.ts` (10 assertions).

The two questions a recovery plan has to answer are "how much may we lose, and how long may we be down"
and "when may we resume work that was in flight". This group answers both as **declared configuration**,
not as defaults:

- **RPO/RTO are never invented.** Four objectives (`RECOVERY_RPO_SECONDS`, `RECOVERY_RTO_SECONDS`,
  `RECOVERY_APPLICATION_RTO_SECONDS`, `RECOVERY_PROVIDER_CONNECTIVITY_RTO_SECONDS`) are optional. Unset,
  malformed or negative all yield `objectives-not-configured`, which is a **decision gap** — deliberately
  distinct from `not-ready` (objectives set, some unmet) and `ready` (all four set and met). A service that
  silently assumed `RPO = 0` would be claiming a guarantee it was never given.
- **`readiness()` reports gaps by name**, so an operator is told which variable is missing rather than that
  recovery "is not configured".
- **Resume policy.** Each external-operation lifecycle state is classified exactly once:
  `CREATED` / `FAILED` / `CANCELLED` are `SAFE_TO_RESUME`; `SUBMITTING` / `PENDING_PROVIDER` /
  `PENDING_VERIFICATION` / `UNKNOWN` require verification with the provider first; `MANUAL_REVIEW` goes to
  a human. `RECOVERY_RESUME_STATE_SETS` is exported so a test can assert the classification is total —
  adding a lifecycle state without classifying it fails the suite.

The governing principle: **recovery restores state; it does not replay intent.** An operation that may
have reached the provider must be reconciled with the provider, never re-sent. This is the same reasoning as
the banking dispatch inquiry path, applied at the recovery boundary.

### Group 14 — worker ownership, leases, and dead letters

`src/operations/worker-lease.service.ts`, `src/migrations/1785753600606-OutboxLeasesAndDeadLetters.ts`,
`test/worker-leases.integration.spec.ts` (15 assertions against real PostgreSQL), and
`docs/integration/WORKER-OWNERSHIP-AND-DEAD-LETTERS.md`.

This group began by reading the four workers rather than assuming they all needed the same treatment:

- **Banking dispatch was already correct** — real database lease, fencing counter, database-clock expiry,
  bounded attempts, append-only history. Left alone.
- **KYC reevaluation was already safe without a lease** — `ON CONFLICT DO NOTHING` on
  `kyc_tier_expiry_events` with the insert result gating the effect, so racing instances produce one
  effect. Left alone; a lease would have added a failure mode without removing one.
- **The outbox had two real defects.** `claimPending` used `pessimistic_write` (plain `FOR UPDATE`), so a
  second worker _waited_ for the first worker's rows and then processed them after commit — queueing for
  work that no longer existed. And `markFailed` incremented `attempts` that nothing ever consulted, so a
  permanently failing event retried forever with no terminal state and no way to surface it.

Both are fixed: the claim is now `FOR UPDATE SKIP LOCKED` (verified in the generated SQL, not just in the
lock-mode name), and `DEAD_LETTERED` is a distinct terminal status reached at a configurable ceiling.

Evidence worth carrying forward:

- **The `SKIP LOCKED` guard was proven to discriminate.** Holding a claim transaction open, a second worker
  completes in ~30 ms with `SKIP LOCKED` and **blocks for 120 s and times out** with plain `FOR UPDATE`.
  The first version of the concurrency test passed under both, because row disjointness comes from the
  lease predicate rather than the locking clause — the defect is only observable while a claim is open. A
  guard that cannot fail is not a guard.
- **Dead-lettering fires exactly at the ceiling and stays terminal** (attempts 1, 2 → `PENDING`; 3 →
  `DEAD_LETTERED`; a fourth cycle cannot claim the row).
- **Graceful release does not consume an attempt** — a shutdown is not a failure.
- **The database enforces the invariants**: a dead letter with no timestamp, a half-written lease, and an
  unknown status are all refused by CHECK constraints rather than by convention.
- **`down()` refuses to roll back while dead letters exist**, because rolling back would return them to
  unbounded retry.

`EXPECTED_MIGRATION_TIMESTAMP` / `EXPECTED_MIGRATION_NAME` in the production readiness service were
advanced to the new schema head. That constant is a deliberate gate: a build whose database has not
reached the required migration refuses to serve traffic.

### Group 11 — migration workflow, locking, and non-destructive recovery

`scripts/migration-workflow.js` with `status` / `apply` / `verify`, and
`docs/integration/MIGRATION-WORKFLOW.md` as the runbook.

**Locking.** `apply` holds an advisory lock (`pg_advisory_lock(7348120945001337)`) for the whole run.
TypeORM takes no lock across a migration run, so two release jobs can read the same pending set and both
attempt it; each migration is transactional, so the loser aborts on a duplicate object and leaves
`typeorm_migrations` recording a partial truth. Verified by execution: with the lock held by another
session, a second `apply --no-wait` exits **2** and names the holder rather than interleaving. The wait is
bounded by `statement_timeout` because a release that waits forever is not a release, and the unlock lives
in a `finally` so a failed run cannot strand the next deploy.

**No revert.** There is no `revert` command, and the absence is enforced by test. 126 of 152 migrations
implement `down()`, but they are not data-safe inverses: several seed ledger accounts, governance roles
and protected-authority structures that later rows reference, so `down()` deletes them — a foreign-key
error at best, destroyed financial evidence at worst. Recovery is **roll-forward**, and the runbook
documents the two distinct failure shapes (nothing committed vs partial run) with the action for each,
including the three things never to do: `DELETE FROM typeorm_migrations`, `migration:revert` in
production, and restoring a backup to recover from a migration that lost no data.

**`status` distinguishes three states**, including the dangerous one: applied-but-not-in-this-repository
means the database is _ahead_ of the code, which `verify` fails on. Migrations are compared by
**timestamp**, the key TypeORM itself uses, so a renamed file does not look permanently unapplied.

`test/migration-workflow.spec.ts` (14 cases) pins the absence of revert, the lock's existence and fixed
key, the bounded wait, the `finally` unlock, the re-check after applying, and that the runbook's exit
codes and lock key match the code. Verified to fail when a revert command is added.

---

## 4. Outstanding

Groups 33–40 remain: browser acceptance, the readiness gate, journeys A–J,
consolidated acceptance, and the final handoff.

Known gaps carried forward: no secret-manager backend is selected (the contract exists; the environment
backend satisfies it); a restore requires a superuser; off-site backup storage, encryption at rest,
retention and point-in-time recovery are infrastructure decisions; no fixture seeds all eleven backup
categories in one database.

Known gaps carried forward from Group 12: no fixture seeds all eleven backup categories in one database;
the restore requires superuser; and off-site storage, encryption at rest, retention and point-in-time
recovery are infrastructure decisions that are not implemented.

Known gaps from Group 20: no write actions by design, no history or trend (integrity history is Group 18's
endpoint, suppression state is Group 19's), no financial figures — reconciliation and unresolved-funds data
stay in their own read surfaces with their own permissions, because aggregating money into an operations view
would widen access to it. No scheduling and no UI; this is the API only.

Known gaps from Group 19: no vendor integration and no delivery guarantee, retry or dead-letter for alerts —
a failed delivery is reported in `dispatched[].reason` and then forgotten. No escalation policy, on-call
rotation or acknowledgement. No scheduled evaluation; alerts are evaluated when the endpoint is called.
Suppression state is in-process and not shared across instances, so a fleet would double-report — correct for
a single instance, wrong for a fleet, and named rather than hidden.

Known gaps from Group 18: nothing schedules the checks — snapshots are recorded when the endpoint is called,
so a cron calling it on an interval is Group 15's supervision model applied to a new consumer and is not
wired. `regressionDetected` is returned but sent nowhere (Group 19). No retention or archival: snapshots grow
unbounded, and pruning must respect the append-only trigger. No automatic remediation — every check runs in a
read-only transaction and repair requires a human decision. These checks compare the application's own tables
to each other; provider agreement is external reconciliation, a different service.

Known gaps from Group 17: no scraper, dashboard, retention or histogram — `worker_last_duration_ms` is a
latest observation, not a distribution, so percentiles are not available. Every threshold in the runbook is
a human reading; wiring them to a channel is Group 19. The Prometheus route requires `metrics.view`
authentication; whether an anonymous scrape path should exist is a deployment decision this group does not
make.

Known gaps from Group 16: no log shipping, aggregation, retention policy or sampling — those are deployment
decisions, not implemented here. Redaction is name-based, so a secret in a generically named field is not
caught; `redactionFailure` records are emitted but not counted, alerted on (Group 19) or exported as a metric
(Group 17).

**OUTSTANDING REQUIREMENT (must be resolved before final consolidated acceptance).** Worker _supervision_ does
not establish automated worker _execution_. The four workers each own an `onModuleInit` interval driver, so
they start when the application starts — but nothing in this repository documents, provisions or tests a
deployable mechanism that guarantees essential background workers are actually invoked in a running
deployment. Supervision observes; it does not start anything. This must be resolved with a documented,
deployable and tested invocation mechanism — an internal scheduler, a dedicated worker process, or an
external scheduler — **without** introducing competing job ownership or financial execution authority: the
database leases (Group 14), fencing, idempotency and the existing financial authority remain authoritative.
Do not treat Group 15 as satisfying automated execution readiness.

Known gaps from Group 15: there is no fleet-wide scheduler, leader election or distributed cron, by design —
each instance runs its own timers and correctness rests on the database mechanisms, so the supervisor
observes one process and cannot prove that work is progressing anywhere else. Staleness is pull-only with no
alerting thresholds (Group 19) and no metrics export (Group 17); the supervisor does not retry, restart or
back-pressure a worker, because retries belong to the lease and dead-letter bounds established in Group 14.

Known gaps from Groups 13–14: recovery objectives are configuration with no measurement behind them — the
service classifies and reports, it does not measure actual RPO/RTO, so "ready" means "declared and
structurally satisfied", not "observed". No scheduler runs the workers in this repository (Group 15); the
dead-letter queue has no alerting thresholds (Group 19) and requeueing is a manual, audited operator action
by design; and claim throughput under sustained load is unmeasured beyond the 8-worker contention test.

## 5. External blockers (already known at mission start)

- **Browser / visual acceptance** — two independent causes, both demonstrated: `npx playwright
install chromium` fails with `Download failure, code=1` (egress is restricted to registry, git and
  PyPI hosts), and the binary's system libraries (`libnss3`/`libnspr4`/`libnssutil3`) are absent and
  not installable (`apt-get`: `E: Unable to locate package libnss3`).
- **Provider sandbox acceptance** — no authorized Monnify or Dojah sandbox credentials have been
  supplied, and provider calls are outside this mission's authorization.
- **Container runtime** — to be verified in group 7; if unavailable, the exact blocker must be
  recorded and every executable portion validated independently.

## 6. Exact next action

Continue in group order. Next: **group 8** (environment configuration inventory and startup
validation), then group 9 (secrets management), 10 (database operational readiness), 11 (migration
release workflow), 12 (backup and restoration — must include a real disposable restore).

Add to §5 while continuing: the container-runtime blocker means group 7's startup acceptance is
validated at the artifact level, not by `docker run`. Group 38's matrix must not claim container
acceptance was executed.

## 7. Required product-owner decisions

None yet. Decisions will be recorded here as they arise — each is a question the mission explicitly
forbids answering by invention.
