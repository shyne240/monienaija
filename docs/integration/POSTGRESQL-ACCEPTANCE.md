# Full PostgreSQL acceptance

Group 30. Scope: whether every database suite in this repository is actually executed by something, and what the
matrix does and does not prove.

## What was already good

The matrix runner (`scripts/run-pg-integration-tests.js`) is genuinely engineered:

- **179 integration suites**, each in a **dedicated, uniquely-named database**, driven by `test/support/pg-harness.ts`.
- **Sequential batches in separate OS processes**, because a single long-lived Jest process accumulates heap across
  suites (measured: ~720 MB → ~1.4 GB over 19 files, then OOM) from ts-jest artifacts and per-suite Nest DI
  containers. Batching is memory management, not a reduction in coverage — every batch still runs `--runInBand`.
- **All batches always run**, so failures are reported together; the process exits non-zero if any batch failed.
- **A pid-scoped migration template database**, so a run reuses one migrated schema instead of re-running 160+
  migrations per suite, and concurrent runs cannot collide.
- A **real PostgreSQL 16 service container** in CI, applying the compiled migrations first.

None of that needed replacing. The gap was elsewhere.

## The gap: eleven suites nothing ran

`jest.integration.config.js` matches `.*\.integration\.spec\.ts$`. Eleven files are named `*.isolated-pg.test.ts`
and therefore match nothing. They are run by `scripts/run-isolated-kyc-tests.js`, a careful script that creates a
disposable **socket-only** cluster in a temp directory, with a provenance contract several suites assert on.

**Nothing in CI invoked that script.** By hand they ran. On every push they did not. Between them they guard:

| Suite                                                                              | What it guards                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `kyc-foundation`                                                                   | the KYC foundation schema and transitions                    |
| `kyc-provider-governance`                                                          | provider governance singletons                               |
| `kyc-tier-policy`, `kyc-tier-transition`, `kyc-tier-limit-enforcement`             | tier policy and limit enforcement                            |
| `kyc-registration-api`, `kyc-registration-session`                                 | registration API and session lifecycle                       |
| `governed-ledger-reversal`                                                         | governed reversal against the ledger's immutability triggers |
| `batch2-legacy-registration`, `batch2c-eligibility`, `batch2c-session-remediation` | legacy registration and session remediation                  |

A suite nothing runs is worse than no suite: it inflates the appearance of coverage while asserting nothing.

**Fixed:** a `test:pg:isolated-kyc:ci` script (the wrapper adds `KYC_ISOLATED_CONFIRM_DISPOSABLE=yes`; the
underlying script is unchanged for local use), and a `backend-postgres-isolated` CI job that installs the
PostgreSQL server binaries, creating the disposable cluster the suites expect.

## Inventory as a checkable claim

`src/deployment/postgres-acceptance.service.ts` walks `test/`, classifies each suite by naming convention, and
reports any suite that needs a database but that **no configured runner executes**. A suite counts as claimed only
when its npm script exists **and** a workflow actually invokes it — a script nobody calls executes nothing, and
that is precisely the failure being corrected.

One subtlety, found by a failing test: `npm run test:pg` is a strict **prefix** of `npm run test:pg:isolated-kyc`.
A naive `includes` check let the integration pattern claim the isolated suites, making everything look wired up.
The matcher now requires the command to be a whole `run:` value.

Mutations confirming it is load-bearing:

- Removing the `test:pg:isolated-kyc` script → 11 unclaimed suites, verdict `ERROR`.
- Changing the CI step to `echo skipped` → 11 unclaimed suites, verdict `ERROR`.
- Removing `test:pg` → over 150 unclaimed suites.

Exclusions are listed in code with a written reason and asserted to reference **files that do not exist**, so an
exclusion cannot quietly hide a real suite.

## What this accepts

Static inventory: every database suite is claimed by a runner that exists and is invoked by CI. The integration
suites were also **run** during this programme — the five most recent suites (privacy, performance, notification
receipts, mobile support, disputes) pass **126/126** against a real cluster here.

## What this does not accept

- **The isolated suites were not executed in this environment.** There is no `initdb` or `pg_ctl` here, so the
  cluster they require cannot be created. They are wired into CI, and that is the claim — not that they passed.
- **CI has not run.** Nothing in this sandbox can execute GitHub Actions; see Group 29.
- **Not acceptance at production volume.** Suites run against small, purpose-built datasets. Behaviour at millions
  of rows is Group 28's plan-shape question, not this one.
- **Not concurrency acceptance.** `--runInBand` is deliberate, and concurrent batches are opt-in. Neither
  reproduces production contention.
- **Not a substitute for a soak test.** No long-running stability run.
- **Not a disaster-recovery drill.** That is Group 18's declared-vs-measured record, which says plainly that no
  restore was performed at production scale.
- **Not every database object is exercised.** Coverage of suites is not coverage of schema.

## Reproducing

```
PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes npm run test:pg          # 179 integration suites
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes npm run test:pg:isolated-kyc # 11 isolated suites
```
