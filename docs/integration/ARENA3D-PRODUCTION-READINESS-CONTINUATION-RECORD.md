# ARENA 3D — Production Infrastructure, Operational Readiness and Financial Completion

Continuation record. Updated as each group lands; the workspace is the source of truth.

---

## 1. Checkpoints

| Point                                       | Commit     | Notes                                                                                   |
| ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Mission start (accepted banking checkpoint) | `e0e0d550` | Conditional engineering acceptance of the banking mission. Local == remote, clean tree. |
| Latest pushed                               | `e20b3116` | Groups 3, 2, 4/5 visibility complete.                                                   |

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

## 4. Outstanding

Groups 1 (baseline — done implicitly, record in handoff), 6 (topology document), 8–40 remain.

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
