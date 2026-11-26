# Migration identity coordination: 1785753600806

Two open PRs against `arena/5-main-web-integration` claimed the same migration timestamp.

| PR | Migration | Outcome |
| --- | --- | --- |
| Transaction History (inbound identity) | `1785753600806-DurableInboundIdentity` | **unchanged** |
| This PR (approval independence) | `AgentApplicationSubmitterAttribution` | **moved 1785753600806 → 1785753600809** |

## Inventory at the time of coordination

Scanned every branch under `refs/remotes/origin/*` and every open PR head, not just the two PRs
named, because a third PR could have taken the slot:

| Identity | Claimed by |
| --- | --- |
| 1785753600806 | `DurableInboundIdentity` **and** `AgentApplicationSubmitterAttribution` (collision) |
| 1785753600807 | `CaptureCustomerFundingScope` (same PR as inbound identity) |
| 1785753600808 | **free** |
| 1785753600809 | **free** |
| 1785753600810–0812 | `CustomerTierDefaultClassMappings`, `LimitRuleUnlimited`, `CustomerRestrictionConfigurationReview` (Tier-1 defaults PR) |

So the free window behind 0807 was 0808–0809, and the next occupied block starts at 0810.

## Why this PR moved, and why to 0809 rather than 0808

1. **The other PR keeps its identity.** It holds 0806 rather than merely 0807, and it is the more
   entangled pair (0807 `CaptureCustomerFundingScope` is its own follow-on work; moving 0806 would
   have left a gap in the middle of that PR's sequence for no benefit).
2. **This PR is already 0807's successor.** Before this coordination, this PR's migration sorted
   directly after `1785753600807`. Landing later therefore has to mean landing after 0807, never
   before it. Taking 0809 (not 0808) keeps a one-slot buffer between the two PRs so a future
   follow-on in the other PR can still take 0808 without re-colliding.
3. **The direction of the move is the safe one.** Renumbering *upward* into free space is safe under
   every merge order: if the other PR lands first this PR simply appends; if this PR lands first the
   other PR still appends after it (0806 and 0807 both sort below 0809). Renumbering the other PR
   *downward* would invert the collision instead of resolving it.

## Merge order

**Either order is now safe**, which is the point of moving into free space rather than swapping.

- Other PR first, then this one: `…0805 → 0806 → 0807 → 0809`. Preferred, because it preserves the
  "0807 immediately precedes 0809" adjacency this PR was designed around.
- This PR first, then the other: `…0805 → 0809`, then `0806`, `0807` are inserted by timestamp, so a
  database in that state applies `0806 → 0807` *after* `0809`. Nothing in this PR's migration reads
  or writes anything the other two create, and the other two read nothing this one creates, so the
  behaviour is identical. The ledger's timestamp order will show the insertion, which the readiness
  inventory tolerates because it validates identity sets, not provenance.

## Where the old identity was applied

The superseded identity is `1785753600806:AgentApplicationSubmitterAttribution1785753600806`.

**It was never published to a shared environment.** Before this rename it existed only in:

- this PR's own branch history, and
- disposable local development databases created while building and reviewing this PR.

Any such database is in one of two states, and both are handled automatically:

| State | What happens on upgrade |
| --- | --- |
| Ledger has the old name, `submitted_by` exists | Migration re-runs, every step is conditional, then it deletes the superseded ledger row. Ends identical to a clean install. |
| Ledger has the old name, `submitted_by` absent (hand-rolled) | Migration re-runs and creates the column, index and trigger. |

If you are not sure which state a database is in, this reports it:

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='agent_applications' AND column_name='submitted_by') AS has_column,
  (SELECT count(*) FROM typeorm_migrations
    WHERE name='AgentApplicationSubmitterAttribution1785753600806')             AS superseded_ledger_rows;
```

## Why this is not a no-op, and what would have broken

TypeORM decides which migrations are pending by comparing **name**, not timestamp —
`MigrationExecutor.executePendingMigrations` does
`executedMigrations.find(e => e.name === migration.name)`. A database that recorded
`AgentApplicationSubmitterAttribution1785753600806` therefore looks, to TypeORM, like it has never
run `AgentApplicationSubmitterAttribution1785753600809`, and TypeORM re-executes it.

A plain `ALTER TABLE … ADD COLUMN submitted_by` would then fail with *column already exists* and
abort the upgrade for that installation. Two things fix it, and both are required:

1. **The migration is idempotent** — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
   `CREATE OR REPLACE FUNCTION`, and a catalogue check before `CREATE TRIGGER` (rather than
   `CREATE TRIGGER IF NOT EXISTS`, which needs PG14+). It also takes a transaction-scoped advisory
   lock so two instances starting together cannot race the DDL.
2. **It retires the superseded ledger row** — `DELETE … WHERE timestamp = 1785753600806 AND
   name = 'AgentApplicationSubmitterAttribution1785753600806'`. Left in place, that row fails
   readiness twice over: the old name is no longer a loaded migration (reported as `unexpected`)
   while the new identity appears to be at the wrong timestamp. Only the collision's own row is
   touched.

Covered by `test/migration-identity-renumber-upgrade.integration.spec.ts`.

## Readiness pin and exact-head tests

`EXPECTED_MIGRATION_TIMESTAMP` / `EXPECTED_MIGRATION_NAME` in
`src/production/production-readiness.service.ts` now point at `1785753600809`. The pinned
identities in `migration-inventory`, `arena5-consolidation-migration-upgrade`, `migration-chain`,
`stage8`, `stage10`, `migration-0804-owner-authority`, `a8`, `a19` and `a20` were updated with it
(identity count is unchanged at 170 — this is a rename, not an addition).

## Combined-sequence verification

The combined chain was executed once, on real PostgreSQL, with **all three** coordinated migrations
loaded together — this branch's `1785753600809` plus the transaction-history PR's unmodified
`1785753600806` and `1785753600807`, taken straight from that PR's head and byte-identical to it.
The transcript is committed as
[`evidence/combined-sequence-run.log`](./evidence/combined-sequence-run.log) — that reference was
dangling before (the file was cited but never committed), and the committed transcript restores it for
exactly this claim.

It proved:

- a clean install applies the combined chain once, in timestamp order, ending at
  `1785753600809:AgentApplicationSubmitterAttribution1785753600809`, with
  `1785753600806` belonging solely to `DurableInboundIdentity`;
- an upgrade from the integration baseline (through 0805) applies **only** the three appended
  identities;
- submitter attribution still works, and is still write-once, after the combined chain;
- inbound identity still works: `banking_inbound_float_links` exists with both of its triggers armed
  and still refuses a forged link.

**That run needed the other PR's two migration files in this working tree, so it was a one-off
verification and its spec is deliberately not committed here.** Shipping those files on this branch
would duplicate two identities the other PR owns — the exact defect this document exists to prevent,
and `test/migration-identity-renumber-upgrade.integration.spec.ts` fails if it happens. The
repeatable, committed proof of the coordination invariant is instead
`test/migration-identity-renumber-upgrade.integration.spec.ts`, which exercises the same 0806 slot
from this branch alone: this branch's chain must apply 0809, must never itself occupy `0806` (the
slot belongs to the other PR's `DurableInboundIdentity`, and the spec now asserts the slot's owner
rather than its emptiness, so it stays correct once that PR merges), and must upgrade correctly from
an installation that recorded the superseded identity.

### Slot discipline, as a committed invariant

The combined tree can only be reached by loading both PRs' migration files at once, so no spec can own
that state. What *is* committed, and what keeps working in either tree, are the properties below —
each now asserted in a form that stays correct **after** the other PR lands:

| Property | Where | Why it is written this way |
| --- | --- | --- |
| This branch never occupies `1785753600806`, and only `DurableInboundIdentity` ever does | `migration-identity-renumber-upgrade` | It previously asserted that **nothing** loaded ends with `0806`. That is true only while this branch is measured alone; once the other PR merges, its migration legitimately holds the slot and the assertion fails on a correct integration — a merge blocker for the exact end state it exists to allow. It now asserts the slot's *owner*, that `0808` stays empty, and that the slot never holds two identities at once. |
| The superseded identity is retired | same spec | Every ledger read and write about the superseded row is scoped by timestamp **and** name, because the timestamp alone is shared with that PR's migration once it lands. |
| Applied order stays `…0805 → 0806 → 0807 → 0809` | `migration-chain` | Its expected list includes whichever of `0806`/`0807` are present, in applied order, instead of asserting them absent. This branch's `0809` is still asserted unconditionally, and still last. |

## Pre-upgrade attribution audit (measured, not estimated)

Taken on the disposable development database immediately before `npm run migration:run` was executed
against it, i.e. while it still carried the superseded `…0806` ledger row. This is the state any
downstream installation upgraded across this change can expect to be in, so it is recorded rather
than assumed. It is a development database with synthetic rows — it is **not** a production census,
and no number here should be copied into a production change record.

| Status | Applications | `submitted_by IS NULL` |
| --- | --- | --- |
| APPROVED | 24 | 21 |
| DRAFT | 6 | 6 |
| SUBMITTED | 1 | 1 |
| **Total** | **31** | **28** |

Only the **SUBMITTED** row is actually blocked by the new guard. `APPROVED` rows are already decided
and cannot be approved again; `DRAFT` rows are not checked until submission, and submitting them
through the console records the submitter. **No backfill was written** — 28 rows remain unattributed
by design, because inferring a submitter would manufacture the evidence the guard checks.

The remedy for a blocked row is staff procedure, not a data fix:
[`../agent-onboarding/UNATTRIBUTED-APPLICATIONS-RUNBOOK.md`](../agent-onboarding/UNATTRIBUTED-APPLICATIONS-RUNBOOK.md).
It was proved end to end on this database: an unattributed draft (`AGENT-APP-1E0BF731`) submitted by
an authenticated principal recorded `submittedBy`, and then the *same* principal's approval attempt
for that application returned **403** with the separation-of-duties message — the submission is what
creates the evidence, and the guard reads it immediately.
