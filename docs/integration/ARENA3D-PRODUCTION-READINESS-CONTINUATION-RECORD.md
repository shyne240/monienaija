# ARENA 3D — Production Infrastructure, Operational Readiness and Financial Completion

Continuation record. Updated as each group lands; the workspace is the source of truth.

---

## 1. Checkpoints

| Point                                       | Commit        | Notes                                                                                   |
| ------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| Mission start (accepted banking checkpoint) | `e0e0d550`    | Conditional engineering acceptance of the banking mission. Local == remote, clean tree. |
| Groups 3, 2, 4/5                            | `e20b3116`    | Financial completeness and unresolved-funds visibility.                                 |
| Group 7                                     | `9b04c45c`    | Containers, admin-web loopback guard, mobile fail-closed endpoint.                      |
| Group 8                                     | `5670bc97`    | 152/152 environment keys inventoried and classified; completeness test.                 |
| Group 12                                    | _this commit_ | Backup and restore exercise, executed and verified.                                     |

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

Groups 13–40 remain: DR/BC, worker consolidation, scheduling, logging, metrics/health, integrity
monitoring, alerting, admin operations centre, operational security, break-glass, fraud/risk, compliance,
complaints, disputes, mobile support, SMS/email, privacy/retention, performance harness, CI release gates,
the PostgreSQL matrix, sandbox readiness, mobile release, browser acceptance, readiness gate, journeys
A–J, consolidated acceptance, and the final handoff.

Known gaps carried forward: no secret-manager backend is selected (the contract exists; the environment
backend satisfies it); a restore requires a superuser; off-site backup storage, encryption at rest,
retention and point-in-time recovery are infrastructure decisions; no fixture seeds all eleven backup
categories in one database.

Known gaps carried forward from Group 12: no fixture seeds all eleven backup categories in one database;
the restore requires superuser; and off-site storage, encryption at rest, retention and point-in-time
recovery are infrastructure decisions that are not implemented.

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
