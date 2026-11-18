# Migration workflow

Operational procedure for applying schema changes to the monienaija database.

This document is normative. It describes what the tooling enforces, why, and what an operator does when
a migration fails. It is written to be followed at 3am by someone who did not write the migration.

---

## 1. The tool

`scripts/migration-workflow.js` is the only supported way to apply migrations outside a test harness.

```bash
# What is the state of this database relative to the repository?
node scripts/migration-workflow.js status

# Apply pending migrations, holding an exclusive lock for the whole run.
node scripts/migration-workflow.js apply

# Fail the build if the schema and the repository disagree. Use in a release gate.
node scripts/migration-workflow.js verify
```

Exit codes:

| Code | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| 0    | Success.                                                                   |
| 1    | Verification failed — pending migrations, orphans, or an incomplete apply. |
| 2    | The migration lock is held by another process. No changes were made.       |
| 3    | Usage error.                                                               |

### What `status` reports, and why orphans are separate

`status` compares `src/migrations/*.ts` against the `typeorm_migrations` table by **timestamp**, which is
the same key TypeORM uses to decide what to run. It reports three numbers and, when relevant, two
detail lists:

- **repository** — migration files in this build;
- **applied** — rows in `typeorm_migrations`;
- **pending** — in the repository, not applied. These are what `apply` will run.

It also reports **applied but not in this repository** as a distinct, louder category. That state means
the database has a migration this build has never heard of: the schema is _ahead_ of the code. Deploying
this build against it can write rows the newer schema rejects, or read columns it does not know about.
This is not a cosmetic mismatch and `verify` fails on it.

---

## 2. Locking

`apply` takes a PostgreSQL **advisory lock** (`pg_advisory_lock(7348120945001337)`) for the entire
migration run.

Before this existed, two release jobs could both read the same pending set and both attempt it. Each
migration runs in its own transaction, so the loser typically aborts on a duplicate object — leaving
`typeorm_migrations` recording a partial truth and an operator unsure whether to retry, roll forward, or
restore. The lock makes a second runner **wait** rather than interleave.

- **Default:** wait up to 300 seconds for the lock. A release that waits for an in-flight migration is
  usually correct behaviour.
- **`--no-wait`:** fail immediately with exit 2. Use this in CI so a pipeline fails fast rather than
  queueing behind a hung deploy. When the lock is unavailable, the tool lists the sessions holding
  connections so the operator can see what is actually running.

The wait is bounded (`statement_timeout`), because a release that waits forever is not a release.

This lock is **per database**, not per cluster. Two databases on the same server migrate independently
and correctly.

---

## 3. There is no revert. This is deliberate.

`migration:revert` exists in TypeORM, and 126 of the 152 migrations implement `down()`. Running it against
a production database would be a mistake, and this workflow provides no command for it.

**Why the `down()` methods are not a safety net.**

1. **They are not data-safe inverses.** Several migrations seed ledger accounts, governance roles and the
   protected-authority structures. By the time anyone wants to revert, other rows reference those rows.
   `down()` deletes them: a foreign-key error at best, destroyed financial evidence at worst.
2. **A revert is a schema change with no data plan.** The data present after a migration is not the data
   present before it — that is what the migration was for. Rolling the schema back under data that has
   already moved produces a database that satisfies neither shape.
3. **An available command gets run.** "The tool exists but you must not use it under pressure" is not a
   safeguard. The only reliable safeguard is that the command does not exist.

**Recovery is roll-forward.** See §4.

---

## 4. When a migration fails

The state after a failed run is one of two things, and the first step is always to determine which.

### 4.1 It failed before anything committed

TypeORM runs each migration inside a transaction. If a migration raised — a constraint violation, an
advisory-lock conflict, a timeout — that migration's transaction rolled back and **no later migration
ran**. `typeorm_migrations` reflects the set that committed.

```bash
node scripts/migration-workflow.js status   # confirm: N applied, M pending, chain looks sane
```

Fix the cause, then run `apply` again. This is the ordinary path and needs no drama.

### 4.2 It failed after a partial run

Some migrations are not transactional (index builds, `CREATE INDEX CONCURRENTLY`, anything the author
declared `transaction = false`). A failure part-way leaves the schema between the two states.

**Do not re-run blindly.** Determine the exact boundary:

```sql
SELECT timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 5;
```

Compare against what the failing migration was doing. Then:

- **Idempotent and safe to resume** — the migration guards its own object creation (`IF NOT EXISTS`).
  Re-run `apply`. Most schema-creation migrations here are written this way.
- **Not resumable** — the correct action is a **new, forward migration** that brings the database to the
  intended shape from wherever it actually is. Write it, review it, apply it. Do not hand-edit the schema
  to "match" and do not delete rows from `typeorm_migrations` to make the runner retry: that record is
  the only evidence of what has been applied, and falsifying it turns a recoverable incident into an
  unknowable one.

### 4.3 Never

- Never `DELETE FROM typeorm_migrations` to force a re-run.
- Never `migration:revert` in production.
- Never restore a backup to recover from a _failed_ migration unless data was actually lost. A restore
  rewinds every financial fact written since the backup; a migration failure usually has not lost
  anything at all. Recovering with the heaviest available tool is how a schema incident becomes a data
  incident.

---

## 5. Expand / contract, so a rollback is never needed

The way to make roll-back unnecessary is to make each step forward tolerant of the old code. Every schema
change that has to be deployed alongside a running application follows three releases:

1. **Expand.** Add the new column / table / index. Nullable, or with a default. Nothing reads it yet. The
   current build is unaffected.
2. **Migrate.** Deploy the build that writes both old and new. Backfill existing rows in a migration or a
   background job. Old code still works against the new schema.
3. **Contract.** Once nothing reads the old shape — verified, not assumed — drop it in a later release.

This is why the honest answer to "can we roll back the deploy?" is _yes_: roll the **application** back to
the previous build, which the still-expanded schema supports. The schema never moves backwards, so no
data has to move backwards with it.

A migration that cannot be expressed in this shape — a column rename, a type change — needs an explicit
plan reviewed with the same rigour as a financial change, because it is one.

---

## 6. Release gate

`verify` is the gate. It exits non-zero on pending migrations, on a database ahead of the code, and on a
database that has never been migrated.

Intended use, in order:

```bash
node scripts/migration-workflow.js verify   # before building the release: schema matches code
node scripts/migration-workflow.js apply    # during deploy, as the one-shot migrate step
node scripts/migration-workflow.js verify   # after deploy: nothing left pending
```

`docker-compose.yml` runs the apply step as a one-shot `migrate` service that the backend depends on, so
the backend never starts against a schema it does not expect.

---

## 7. What is not automated

Stated plainly so it is not assumed to exist:

- **No automatic pre-migration backup.** The backup/restore drill (`scripts/backup-restore-drill.js`)
  demonstrates that a backup can be restored; it is not wired into the deploy as an automatic step. Doing
  so requires a storage decision (see the outstanding items in the continuation record).
- **No migration dry-run.** PostgreSQL DDL is largely transactional, so a dry run would be a real run.
  Review is the control.
- **No automatic rollback of a failed deploy.** Because there is no destructive rollback, recovery is a
  human decision made from the state §4 describes.
