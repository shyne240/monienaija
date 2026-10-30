# Mission 13 — Rate-Limit Serialization Test Expectation Correction

**Date:** 2026-10-30
**Authorised by:** Mission 12 report, §6, at commit `1455aae` (`docs/integration/20261030-FINAL-POSTGRESQL-MATRIX-ACCEPTANCE-RECOVERY.md`)
**Base commit:** `1455aae` (integration branch `integration/main-backend-frontend-20261030`)
**Scope:** one test file. No production code, no retry policy, no migrations, no authorization policy.

---

## 1. Verdict

**Correction applied, verified, and green — submitted for Arena 4's independent review.**

| Check | Result |
|---|---|
| Focused suite `test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts` | **1/1 suite, 5/5 tests passed, exit 0** |
| Complete PostgreSQL matrix (127 suites) | **127/127 suites, 2,382/2,382 tests passed, 0 skipped, exit 0** |
| Typecheck (`tsc --noEmit`) | exit 0, no diagnostics |
| Lint (eslint on the changed file) | exit 0 |
| Production / retry / migration / authorization changes | **none** |
| Files changed | **1** — the spec alone (+30 / −2) |

---

## 2. What changed, and why

The approved defect: the concurrency trial loop asserted

```ts
expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
```

which accepts **only** success and therefore fails on a contract-correct, documented retryable
**409**. Under V1-INFRA-03 Part D, `consume()` deliberately re-throws a `ConflictException` (409)
after `runSerializableWithRetry` exhausts its bounded 3 attempts on `40001`/`40P01`; the caller is
expected to retry. The old assertion treated the designed outcome of the bounded retry as a defect,
so a rare unlucky trial — one caller losing the cold-start race three times while peers commit —
produced Arena 4's intermittent failure.

The assertion now classifies every settled result and accepts exactly `fulfilled` or `http-409`:

```ts
const classify = (r: PromiseSettledResult<void>): string => {
  if (r.status === 'fulfilled') return 'fulfilled';
  const status = (r.reason as { getStatus?: () => number } | undefined)?.getStatus?.();
  return status === undefined ? 'unclassified-rejection' : `http-${status}`;
};
const outcomes = results.map(classify);
const unapproved = outcomes.filter((o) => o !== 'fulfilled' && o !== 'http-409');
expect(unapproved).toHaveLength(0);
```

A named guard for the under-capacity 429 was also added, because in this scenario (capacity 50,
2-3 calls) refusing a request on capacity grounds would itself be a defect:

```ts
const unexpected429s = results.filter(
  (r) => r.status === 'rejected' && (r.reason as { getStatus?: () => number }).getStatus?.() === 429,
);
expect(unexpected429s).toHaveLength(0);
```

Plus a documentation addition to the file header recording the accepted outcome set. Nothing else in
the file was touched.

### Still fatal (unchanged severity)

- **503** — spurious unavailability: the original `unexpected503s` assertion is preserved verbatim.
- **429** — under-capacity refusal: new named assertion.
- **Any other / unclassified rejection** — status 500, a raw `Error` with no `getStatus()`, anything
  that is not `fulfilled` and not exactly 409.

### Preserved untouched

All five tests and every other assertion in the suite: single-call success and decrement; the
intentional 429 business outcome (capacity 1, refill 0.0001); invalid rule → 503; disabled rule →
resolves without touching PostgreSQL; the 2×15-trial loop structure; `capacity: 50`; per-trial fresh
`randomUUID()` bucket keys (bucket isolation); the real-PostgreSQL harness with no mocks.

---

## 3. The guard is not vacuous

Accepting an extra outcome is only safe if the assertion can still fail. The classification and
filter expressions were copied verbatim into a throwaway script (kept outside the repository,
`/home/user/guard-nonvacuity.ts`, never committed) and fed synthetic settled results:

```
all fulfilled (2 calls)                outcomes=[fulfilled, fulfilled]          flagged=[]                     => passes
fulfilled + documented 409             outcomes=[fulfilled, http-409]           flagged=[]                     => passes
spurious 503 present                   outcomes=[fulfilled, http-503]           flagged=[http-503]             => FAILS (correct)
under-capacity 429 present             outcomes=[fulfilled, http-429]           flagged=[http-429]             => FAILS (correct)
unclassified rejection (raw Error)     outcomes=[fulfilled, unclassified-rejection] flagged=[unclassified-rejection] => FAILS (correct)
unapproved status 500                  outcomes=[fulfilled, http-500]           flagged=[http-500]             => FAILS (correct)

GUARD_OK: accepts only fulfilled/409; fails on 503, 429, 500 and unclassified
```

So the correction removes a false negative without removing the suite's ability to detect the defect
it exists to catch.

---

## 4. Verification results

### 4.1 Focused suite

```
PASS test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts (8.049 s)
  ✓ a single consume() call succeeds and decrements the bucket (517 ms)
  ✓ realistic concurrency (2 and 3 simultaneous requests) on the same fresh bucket never produces
    a spurious 503, an under-capacity 429, or any unapproved rejection, across many trials (783 ms)
  ✓ the intentional 429 rate-limit-exceeded outcome is unaffected by the retry wiring (613 ms)
  ✓ a genuinely invalid rate-limit rule configuration still fails safely with 503 (578 ms)
  ✓ a disabled rule never touches PostgreSQL and always resolves (578 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
EXIT=0
```

### 4.2 Complete PostgreSQL matrix

```
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg
=== PG integration suite: 9 batch(es), 127 files, concurrency=1 — all passed ===
EXIT_CODE=0
PASS suite lines: 127
FAIL suite lines: 0
Total tests passed: 2382
Occurrences of "skipped": 0
PASS test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts   (under the full matrix)
```

Environment: Node v22.22.3, Jest 30.2.0, TypeORM 0.3.31, embedded PostgreSQL 18.4, disposable
`mn_it_*` databases. Full extraction: `docs/integration/evidence/20261030-pg-matrix-127-post-correction.txt`
(176 lines); raw log (not committed) at `/home/user/pg-matrix-fix.log`.

The suite and test counts are identical to the Mission 12 acceptance run — **127 suites, 2,382
tests** — confirming the correction changed no test count and removed no coverage. Batch composition
varies between runs (the runner partitions by file), so per-batch totals are not comparable across
runs; the totals are.

### 4.3 Static checks

- `tsc --noEmit -p tsconfig.json` → exit 0, no output.
- `eslint test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts` → exit 0.

---

## 5. Diff

```diff
 test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts | 32 ++++++++++++++++++++--
 1 file changed, 30 insertions(+), 2 deletions(-)
```

The only removed line is the old blanket assertion. Full diff at the commit below.

---

## 6. Commit

| Item | Value |
|---|---|
| Branch | `integration/main-backend-frontend-20261030` |
| Base | `1455aae` |
| Commit | the single commit adding this report on the base above — resolve with `git log -1 --format=%H -- docs/integration/20261030-RATE-LIMIT-SERIALIZATION-TEST-CORRECTION.md` |
| Files | `test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts`, this report, the evidence extract |
| Subject | `test(harden-01): accept documented retryable 409 in rate-limit serialization concurrency assertion` |

The exact SHA is stated in the delivery message accompanying this commit and is verifiable from the
branch; it is deliberately not embedded here so that the document cannot drift out of sync with a
later amend or rebase.

---

## 7. For Arena 4's independent review

1. Fetch `integration/main-backend-frontend-20261030`.
2. Confirm the change is confined to the one spec file:
   `git diff 1455aae..HEAD --stat` → only the spec, plus this report and its evidence extract.
3. Confirm no production surface moved:
   `git diff 1455aae..HEAD -- src/` → empty;
   `git show HEAD:src/common/serializable-transaction.ts | grep MAX_SERIALIZABLE_ATTEMPTS` → `3`, unchanged.
4. Re-run independently:
   `PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg` → expect 127 suites / 2,382 tests / exit 0.
5. Acceptance point: the corrected assertion is now deterministic with respect to the documented
   contract. A future 409 in that suite is a **pass**, not a flake to be re-run; a 503, an
   under-capacity 429, or any other rejection is still a **genuine failure**.

**Residual note, stated plainly:** this change makes the gate deterministic for the 409 case. It does
not and cannot prove the matrix is free of all nondeterminism — the bounded retry still exists, and
other suites were not audited for the same class of expectation mismatch. No such suite failed in
either the Mission 12 or Mission 13 run.

---

## 8. Boundaries honoured

No merge to `main`, no deploy, no provider activation, no production migration, no change to
`MAX_SERIALIZABLE_ATTEMPTS`, retry behaviour, error classification, or authorization policy. No
test was weakened to obtain green: the accepted-outcome set was widened by exactly the one
contract-permitted status, and every previously fatal outcome remains fatal (§3).
