# Mixed-product Transaction History query validation

## Exact provenance / scope

- Fetched PR23 head: **`46e9ff703884dff6aa4d9b520a1b6817c8c5b705`**.
- Final clean-head test: **`7d2c0412494ebdfe6344cffd08cf29dc76484c17`**;
  `workingTreeClean: true` in after.json. Publication adds evidence/docs only.
- Baseline used the fetched head's production controller unchanged (SHA-256 verified
  against Git); the newly written volume harness was uncommitted. Do not describe
  the baseline harness as an already-committed test or reuse earlier inbound-only plans.
- Fresh disposable PostgreSQL **18.4**, full **171-migration** chain through 0807.
  Baseline seeded the entire corpus; final comparison cloned that explicitly kept
  disposable database into a **new current-run-owned** database. Same record IDs,
  timestamps and distribution on both sides; no pre-existing customer database used.
- Real AppModule and real workforce credential/session sign-in, not synthetic bearer
  authorization. **FINANCE_AUDITOR** supplies platform scope; **OPERATIONS** has an
  ACTIVE assignment to institution A only. No permission/grant changes.

Raw [before plans](evidence/mixed-volume/before.json),
[after plans/results](evidence/mixed-volume/after.json),
[summary](evidence/mixed-volume/summary.json), and
[test result](evidence/mixed-volume/test-results.txt) are attached.

## Workload and distribution

**90,300 business rows; all nine supported TYPE values.**
This is an explicit representative synthetic *mixed read workload*, not a claim
that a production histogram, production hardware/SLO, or every lifecycle branch
was supplied. It exercises large and small tenants, selective/nonselective reads,
90 days of history, many tied timestamps and microsecond cursor boundaries.

| TYPE | Rows | Status / historical attribution |
| --- | ---: | --- |
| BANK_TO_WALLET | 40,000 | 26,667 VERIFIED / 13,333 UNVERIFIED bank intakes; four institutions; verification is not posted credit |
| WALLET_TRANSFER | 10,000 | COMPLETED, original posted journal institution |
| CASH_IN | 10,000 | POSTED canonical journals, operator label Cash to Wallet |
| CASH_OUT | 10,000 | POSTED canonical journals, operator label Wallet to Cash |
| CASH_TO_CASH | 10,000 | UNCLAIMED parent identities, posted original journal |
| CUSTOMER_FUNDING | 10,000 | 5,000 PENDING / 5,000 REJECTED; governed request-time scope captured by trigger |
| WALLET_TO_BANK | 100 | RESERVED real agent commitments, platform/unattributed journal scope |
| AGENT_FUNDING | 100 | EXECUTED governed native platform requests |
| AGENT_DEFUNDING | 100 | EXECUTED governed native platform requests |

The 90,000 institutional rows are distributed consistently per source:

| Institution | Share | Rows | OPERATIONS access |
| --- | ---: | ---: | --- |
| A | 60% | 54,000 | Own |
| B | 25% | 22,500 | Denied |
| C | 10% | 9,000 | Denied |
| D | 5% | 4,500 | Denied |
| Platform / unattributed | — | 300 | Denied |

Exact institution UUIDs and per-type/status/institution counts are in both raw
artifacts. Native agent/outbound records remain platform-scoped: current agent
affiliation is **not** converted into historical access. Bank-funded float receipts
and legacy inbound receipts are not volume-populated here; the bank-intake branch
represents Bank to Wallet. Earlier posted-journal round trips remain separate
proof, not volume coverage of every inbound transition.

Institutions, customer eligibility/enrolment and wallet attribution use the existing
governed fixture. Native funding and commitments use existing services/approval
paths. Bulk synthetic journals have balanced posting lines; business rows are
read-model fixtures, not certification of all product executions. **No trigger,
constraint, immutability guard or protected execution boundary is disabled.**

## Method

`test/transaction-history-mixed-volume.integration.spec.ts` is opt-in with
`HISTORY_MIXED_VOLUME=yes` (ordinary PG CI reports it skipped, not measured).
Each of four cases runs for both actual session scopes, with **three**
`EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON)` samples:

1. Combined list, descending `created_at, type, id`, limit 101 for a 100-row page.
2. Exact reference `MIX-WALLET_TRANSFER-1000` across all types.
3. ANDed BANK_TO_WALLET / VERIFIED / Lagos 2026-11-02 through 2026-11-24.
4. Deep keyset predicate on the complete `(created_at,type,id)` tuple at
   `2026-10-15T12:00:00.000001Z`.

Plans use the actual production CTE and **full production list projection**, including
amount/fee/reference and microsecond cursor timestamp—not the earlier ID-only
projection. Filter constants are equivalent to API-bound values; HTTP checks below
also exercise the actual parameterized controller. Artifacts include exact SQL,
scope parameters, server version and settings. No EXPLAIN ANALYZE write query ran.

Settings: shared_buffers 128 MiB; work_mem 4 MiB; effective_cache_size 4 GiB;
random_page_cost 4; JIT enabled; max_parallel_workers_per_gather 2. Measurements are
warm-cache medians on this disposable host. OS cache was not flushed, hardware was
not production-sized, and no cold-cache/concurrency/load-test SLO is asserted.

## Measured improvement

| Session / case | Before median ms | After median ms |
| --- | ---: | ---: |
| Platform / combined | 637.429 | 256.800 |
| Institution / combined | 660.570 | 213.599 |
| Platform / exact reference | 15.107 | 13.640 |
| Institution / exact reference | 14.765 | 13.584 |
| Platform / type + status + date | 74.439 | 30.855 |
| Institution / type + status + date | 71.255 | 28.323 |
| Platform / deep cursor | 360.524 | 167.225 |
| Institution / deep cursor | 353.735 | 144.525 |

### Narrow change made

The shared history template now generates:

- `HISTORY_SQL`: unchanged detail investigation JSON, journal IDs and aliases.
- `HISTORY_LIST_SQL`: the **same joins, scope predicate, identities, amounts and
  fees**, with detail-only investigation expressions replaced by `NULL::jsonb`.

The list never returns investigation JSON. Before plans nevertheless carried these
expressions through the UNION, including the C2C audit lookup, for candidate rows
before sorting. Removing that unnecessary work avoids changing the API response,
authorization rules, paging, financial execution or journal navigation.

This cuts combined-list median time by about **60% platform / 68% institution**
and cursor time by about **54% / 59%**. Buffer footprints remain essentially
unchanged: this is primarily a CPU/projection improvement, not an I/O claim.

### Scans/sorts still observed; no unjustified index migration

- Combined list still scans/appends **90,300** candidates platform-wide and retains
  **54,000** after institutional scope filtering. Global top-N heapsort consumes
  those candidates; its memory is approximately **62–63 KiB** for 101 outputs.
- Deep cursor still handles **48,951** eligible platform candidates / **28,991**
  scoped candidates before top-N sorting. Keyset correctness does not imply an
  index seek across the full heterogeneous UNION.
- Exact reference still sequentially checks approximately **40,305 ledger journals**
  for canonical cash metadata/reference and **10,000 transfer/C2C source rows**;
  COALESCE source references limit use of simple reference indexes. Median remains
  around 14 ms here. Type/date pruning reduces other source work, but joined bank
  posting state remains part of status evaluation.
- Representative combined root buffer counts are **9,129/9,130 shared hits**;
  deep cursor **8,216/8,217**; reference **2,562/2,563**. Median samples report
  **zero physical reads and zero temporary writes**. No disk-spilling sort observed.

No new index is added: the dominant measured cost was unnecessary detail projection,
and an index on a single timestamp/reference cannot by itself establish a bounded,
scoped merge across these joined sources. Adding many expression indexes without
write-cost/production-selectivity evidence would exceed this narrow change. The
remaining O(N) scan/sort is explicitly a scaling limitation, not declared fixed.
Further larger-scale/concurrent testing may justify source-local ordered bounds,
reference-expression indexes or a separately governed read model. None is silently
introduced or certified by this run.

## Correctness and preservation checks

**Final exact-head volume integration: PASS (23.036 seconds on the cloned corpus).**
Fresh baseline migration/seed/test passed in 313.888 seconds. Additional unit suite:
**4 tests pass**; the separate real-workforce five-product HTTP regression also passes (28.394 seconds, browser flag off). Backend TypeScript, changed-file ESLint and formatting pass.

- For every plan case and both scopes, optimized projected rows equal the full
  detail read model's projected rows in the same exact order.
- Ten real HTTP pages / **1,000 rows per session** exactly match the full sorted
  scoped oracle, with no duplicates, exercising timestamp ties, TYPE tie-breaks,
  UUID tie-breaks and PostgreSQL microseconds. Counts remain 90,300 / 54,000.
- Independent known own/foreign fixture references verify exact-reference isolation
  and direct-detail **404** for all six populated institutional TYPEs.
- Native Agent Funding, Agent Defunding and Wallet to Bank list/detail are visible
  to platform authority and absent/404 for institution OPERATIONS.
- Combined type/status/Lagos date filtering remains ANDed and within both bounds.
- All nine TYPE detail keys resolve. Posted examples retain journal UUIDs; verified
  unposted bank intake correctly has no journal. Customer custody evidence remains
  present. No journal-link frontend file differs from fetched `46e9ff7`.
- All **11 exact local role passwords** authenticate; credential hashes and
  role-function grants are unchanged after the run.

## Reproduction / remaining work

With installed dependencies and a separately verified disposable PostgreSQL:

```sh
# Create local test placeholders if needed; never overwrite an existing .env.
node scripts/prepare-pg-test-env.js --create-if-missing

NODE_ENV=test PG_TEST_RUN_ID=mixedrepro \
PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
DB_HOST=127.0.0.1 DB_PORT=55440 DB_USER=monienaija DB_PASSWORD=monienaija-pw \
NOTIFICATION_WORKER_ENABLED=false CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false \
HISTORY_MIXED_VOLUME=yes HISTORY_MIXED_OUT=data/validation/mixed-repro \
npx jest --config jest.integration.config.js --runInBand \
  test/transaction-history-mixed-volume.integration.spec.ts
```

The credential values above are disposable local defaults, not production secrets.
Allow several minutes for the trigger-preserving bulk ledger seed. To compare the
same corpus, explicitly set `MN_IT_KEEP_DATABASE=1` on that first run; an opt-in
`HISTORY_MIXED_REUSE_DB=<kept mixed fixture name>` clones it into a current-run-owned
DB, validates its marker/count, and never drops or writes the source. Normal runs
drop their own DB; stopping the disposable cluster removes retained fixtures.
Generated large fixture data stays out of Git; only the plan/result packet is attached.

**PR23 remains draft and unmerged.** This completes the documented local mixed-volume
query validation, not production-volume or concurrent SLO certification. Existing
integration adoption and unresolved inbound-path/attribution items remain open.
**CSV/PDF export is separate work and was not touched.**
