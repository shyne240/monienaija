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
| Group 12                                    | `3e0c9985`    | Backup and restore exercise, executed and verified.                                     |
| Groups 9, 10, 11                            | `62368a3b`    | Secret resolution and rotation, runtime/authority separation proof, migration workflow. |
| Groups 13, 14                               | `cc6392a7`    | Recovery objectives and resume policy; outbox leases and dead letters.                  |
| Group 15                                    | `f8bb5fdd`    | Worker supervision without a second scheduler.                                          |
| Group 16                                    | `6451a5c2`    | Sink-level log redaction; compound secret names.                                        |
| Group 17                                    | `40766952`    | Operational metrics; DLQ and worker signals finally have a consumer.                    |
| Group 18                                    | `f2a63c0d`    | Integrity snapshots and drift detection.                                                |
| Group 19                                    | _this commit_ | Alert contract, deduplication, flap suppression, dark delivery default.                 |

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

Groups 20–40 remain: admin operations
centre, operational security, break-glass, fraud/risk, compliance, complaints, disputes, mobile support,
SMS/email, privacy/retention, performance harness, CI release gates, the PostgreSQL matrix, sandbox
readiness, mobile release, browser acceptance, readiness gate, journeys A–J, consolidated acceptance, and
the final handoff.

Known gaps carried forward: no secret-manager backend is selected (the contract exists; the environment
backend satisfies it); a restore requires a superuser; off-site backup storage, encryption at rest,
retention and point-in-time recovery are infrastructure decisions; no fixture seeds all eleven backup
categories in one database.

Known gaps carried forward from Group 12: no fixture seeds all eleven backup categories in one database;
the restore requires superuser; and off-site storage, encryption at rest, retention and point-in-time
recovery are infrastructure decisions that are not implemented.

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
