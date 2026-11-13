# Institutional governance remediation — work in progress, NOT ACCEPTED

The last accepted application checkpoint remains `1acdf5085c77b3b299dea24f2b3eed614efeb8a1`. The preceding blocker documentation checkpoint is `d013ddf8dde5f8587620add22b3036119bfcf32c`. **No corrected Phase 1 checkpoint is accepted or released.** Phases 2 and 3, consolidated migration readiness and the full regression matrix remain NOT VERIFIED. This document and the attached patch preserve work; they do not integrate the patch into the application.

## Recovery and allocation

The prior sandbox reset removed the original candidate stash. Phase 1 was reconstructed from the exact recorded source commits (`f3ebc9a33beed1176d80d3fcbe083fa100dc128e` and `ca5b38d5ae01c270ae79c17f0af05ef5cd5be172`), including the documented allow-list conflict resolutions and independent reproduction tests, not restored from that lost stash. A further sandbox reset occurred and the reconstruction was repeated. The current pre-existing dirty snapshot was separately stashed as `debb54a9530a52d181600eb6b686f262b467fc4b`; earlier sandbox resets show that local stashes may not survive, so do not claim this stash is durable. No unrelated changes were intentionally imported.

The user confirmed Arena 3's 0300–0399 allocation and explicitly authorized the 0500–0599 exception for the correction after 0400. See [the allocation register](MIGRATION-ALLOCATION.md). At the time of the check the fetched accepted, Arena 1, Arena 2 and Arena 4 branch trees had no 0500-series filenames. Recheck all branches and the final integrated registry before release.

## Candidate and evidence

The unaccepted [WIP patch](phase1-remediation-WIP.patch) includes the reconstructed source and additional work, SHA-256 `ae8d86376583c6e0b19b375204f911fe3cd2bf20108398937d2de8a7ce62e0b1`. On a clean checkout of this documentation checkpoint, it can be reconstructed with `git apply --unidiff-zero docs/integration/institutional-consolidation/phase1-remediation-WIP.patch`. It is intentionally not committed as application code. Do not deploy it or describe it as a green Phase 1 checkpoint.

The candidate adds exact-payload checks and original execution snapshots for consumed lifecycle and affiliation replay; institution locking during affiliation execution; a post-0400 migration with transition evidence, one-time-use and deferred transaction checks; and preserves all three original independent reproductions. It additionally reserves *all* existing institutional approvals on the 0400-to-0500 upgrade, including pending ones, because 0400 did not immutably bind their request metadata. The candidate refuses their subsequent replay or execution rather than inventing trustworthy historical evidence; a fresh approval is required. This is a consequential upgrade behavior requiring review and explicit compatibility coverage before acceptance.

An additional independent reproduction showed that direct SQL could reuse a consumed affiliation assignment approval to reactivate a suspended affiliation: run `instfix3`, 1 failed, 24 skipped, the mutation returned `[[], 1]`. After the candidate guard was added the case passed in the 27-test suite. Another reproduction showed mutable approval payload metadata in the candidate (`instfix8`, 1 failed, 25 skipped), and a further reproduction showed that forged affiliation evidence digest could be committed (`instfix10`, 1 failed, 26 skipped). Candidate guards were subsequently added; both cases passed in the final focused suite. These tests use disposable database owner credentials; protection under an independently provisioned, least-privileged application role is **not yet verified**.

| Check | Result |
|---|---|
| Backend TypeScript, before the final identifier-only rename | passed (`tsc --noEmit -p tsconfig.json`) |
| Foundation and governed-action unit suites, after candidate changes | 2/2 suites, 19/19 tests |
| Sequential targeted PostgreSQL run `instfix12`, before final legacy-column rename and historical test addition | 7/7 suites, 136/136 tests, including the 27-case augmented foundation suite, wallet ownership, agent lifecycle/funding/outlets, migration chain, and readiness sync |
| Focused PostgreSQL `instfix14`, after the rename and 0400-upgrade test | 2/2 suites, 47/47 tests: foundation 27/27 and migration chain 20/20 |
| Fresh database migrations | covered by the migration-chain suite; pending 0400/0500 chain runs from empty |
| Historical 0400 → 0500 | one disposable upgrade test covered ledger order and reserved one consumed and one requested lifecycle approval; it did not cover all historical states, affiliations, or 0401 |
| Earlier baseline full runs | historical only; see `PHASE-1-BLOCKED.md`; not evidence of a full run on this WIP |

The original conflict/ambiguity resolver test now first asserts the corrupt direct write is rejected; it then disables just the new trigger using the disposable test database owner to simulate historical corruption, restores the trigger in `finally`, and retains the resolver's original fail-closed assertions. This is a test-only corruption fixture, not a production bypass.

## Outstanding before accepting Phase 1

- Validate database enforcement under a separately created least-privileged **application** DB role, not only the disposable database owner. Verify attempted direct writes and evidence tampering, transaction rollback, one-time use and permissions; review whether the DB threat model allows changing approval status/approver directly. The candidate assumes the existing approval subsystem is responsible for legitimate maker/checker identity and MFA; the new trigger alone cannot authenticate the SQL caller as an independently verified checker.
- Review the SQL/JavaScript canonical digest agreement for escaped text, non-ASCII data, normalization and nulls. Add direct forged-fingerprint and pre-0500 pending approval cases, test historical affiliation evidence, old replays after subsequent transfer/termination, and valid newly approved reactivation.
- Deterministically test suspension-versus-affiliation races, same-approval concurrency and rollback for both execution paths, cross-institution denial and all MFA/maker-checker restrictions. The tests above do not establish all of these acceptance requirements.
- Expand upgrade coverage for 0400 and 0401 in all supported sequences, including collision checks and historical data. Synchronize the actual migration inventory and fail-closed readiness rather than relying on the latest migration only. Do not import unintegrated 0117 or silently rewrite existing history.
- Repeat the complete targeted phase matrix after any changes and only then create a verified implementation checkpoint. Integrate Phase 2 and Phase 3 selectively from the pinned source commits, test their acceptance requirements, and run the requested full regression matrix sequentially. No production readiness, provider, deployment, transaction, cutover or main-merge claim is made.

Last completed check before preserving this WIP: foundation/governed-action unit command, 2 suites and 19 tests passed. There is no claim that later stages were attempted or passed.
