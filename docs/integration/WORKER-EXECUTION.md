# Worker execution

Group 37. Scope: the standing requirement carried in the continuation record since Group 15 — *a deployable,
tested mechanism that guarantees the essential background workers are invoked in a running deployment, without
introducing competing job ownership or financial execution authority.*

## What was actually missing

Every worker in this application starts from `onModuleInit` in whichever process boots `AppModule`. Until now that
was only ever the HTTP process, so "are the workers running?" and "is the API serving?" had the same answer because
they were the same process. That is not an architecture, it is a side effect, and it produces two named problems:

- an API replica count of four means four replicas of every worker, each with its own timers, and the deployment
  says nothing about whether that is intended;
- a worker that dies silently takes an API down with it, and an API restart restarts every worker mid-tick.

Group 15 built supervision, which observes. It could not start anything, and the record said so in the plainest
terms available. This group builds the missing half.

## The mechanism

One image, three roles, chosen by `PROCESS_ROLE`:

| Role          | Serves HTTP | Starts worker drivers | Intended for                                        |
| ------------- | ----------- | --------------------- | --------------------------------------------------- |
| `all-in-one`  | yes         | yes                   | development, single-instance deployments (default)   |
| `api`         | yes         | **no**                | an API replica in a fleet                            |
| `worker`      | **no**      | yes                   | the process that owns background execution           |

```bash
# the worker process: no HTTP listener, same readiness gate
PROCESS_ROLE=worker node dist/main.js

# an API replica in a fleet: serves HTTP, starts no worker timers
PROCESS_ROLE=api node dist/main.js
```

`docker-compose.yml` now passes `PROCESS_ROLE` through (`${PROCESS_ROLE:-all-in-one}`), so the shipped manifest can
express both shapes without changing its default.

The default is deliberately `all-in-one`: changing it would silently stop running workers for anyone who upgrades.
The role a production fleet *should* use is documented, not imposed.

## Where the worker process is gated

The worker runs the **same** `verifyStartup()` gate as the API — the eight unverified financial dependencies, the
schema head, the authority boundary. There is no worker-specific override, because a worker that processes real
queue items against a schema the API refuses to serve is worse than a worker that does not start.

Order is asserted, not assumed: **create → initialise → verify → announce**. Announcing first would mean a refused
process logs success immediately before exiting.

## Shutdown

`SIGTERM` and `SIGINT` close the context exactly once, then exit `0`. A second signal does not close twice or exit
twice. A close that has not finished within 30 seconds exits `1` with the elapsed deadline in the log, because a
`SIGTERM` that hangs is a deployment that hangs: the orchestrator waits, then kills the process mid-transaction.
The compose file's `stop_grace_period` is 45s, comfortably above the 30s deadline.

## The guards

| Guard                                                             | Why                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `PROCESS_ROLE=worke` throws, naming the allowed values             | a typo must not silently become `all-in-one`, discarding the operator's intent |
| `PROCESS_ROLE=api` with `KYC_TIER_WORKER_ENABLED=true` throws       | one of the two is a mistake; silently preferring either produces a deployment nobody can reason about |
| `PROCESS_ROLE=api` sets each worker flag to `false`                | otherwise the "split" is cosmetic and every replica still ticks         |
| `startWorkerRuntime` rejects a non-worker role                     | reaching it with `api` is a wiring error, not a bad environment variable |

## What is proven, and how

`test/worker-execution.spec.ts` — 15 cases:

- role resolution: default, the three roles, case/space insensitivity, and refusal of a typo;
- role composition: an API process turns every worker flag off; a contradiction throws; `worker` and `all-in-one`
  change nothing;
- runtime: initialise-before-verify ordering, announce-after-verify, **refusal closes the context and exits 1**
  (a refused process must not hold a connection pool or a lease), no signal handlers registered when refused;
- shutdown: closes once, exits 0, idempotent under two signals, and exits non-zero when close exceeds its deadline;
- authority: the runtime and role modules import no ledger, banking or agent module, contain no `DataSource`, and add
  no leader election — the database leases and financial authority from Groups 3 and 14 remain the only authority;
- routing: `main.ts` resolves the role **before** any HTTP adapter exists, and the worker bootstrap contains no
  `FastifyAdapter`, no `NestFastifyApplication` and no `app.listen`.

## What this does NOT prove, and the record says so

- **No deployment has been observed running the worker role.** The mechanism is proven; the execution is not. The
  release gate carries this as `worker_execution_not_observed_in_deployment` — narrowed from the previous
  `worker_automated_execution_unproven`, not removed.
- **No orchestrator manifest was validated.** There is no container runtime here, so neither the image nor the
  compose file was executed. The compose change is a passed-through variable and a documented command; it is not
  evidence that `docker compose up` works.
- **No liveness probe is defined for the worker role.** A process with no HTTP listener cannot answer an HTTP
  healthcheck; an orchestrator needs a process-level probe. That is a deployment decision this repository does not
  make, and `PROCESS_ROLE=api` replicas are unaffected.
- **Fleet-wide liveness is still unanswerable from inside any one process** — Group 15's limitation stands. The
  database lease and the queue remain the authority on whether work is progressing.

## Honest summary

The obligation said: supervision observes, it does not start anything; resolve it with a documented, deployable and
tested invocation mechanism without adding a second scheduler. That mechanism now exists, is readiness-gated,
shuts down within a deadline, adds no authority of its own, and is tested across the paths that matter — including
the refusal path, which is the one that must never be skipped.

What remains is the part no sandbox can supply: a deployment actually running it.
