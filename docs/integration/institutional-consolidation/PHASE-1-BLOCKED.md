# Institutional consolidation: Phase 1 blocked

> **SUPERSEDED — historical record.** This document describes a state that has since been
> resolved and is retained for provenance only. It is **not** current acceptance evidence.
> Current status and results: [INSTITUTIONAL-CONSOLIDATION-STATUS.md](INSTITUTIONAL-CONSOLIDATION-STATUS.md).
> Phases 1–5 are accepted at the local/disposable-PostgreSQL level (Phase 1 `2cfeda6`,
> Phase 5 `a52602d`). Do not cite this file as evidence of the current implementation.

## Decision and preserved baseline

**Do not integrate Phase 1 yet.** Independent real-PostgreSQL tests found approval-integrity and database-governance failures described below. The accepted application checkpoint `1acdf5085c77b3b299dea24f2b3eed614efeb8a1` is preserved; this report commit adds documentation and evidence only. Stages 2–5 were not started, and their acceptance and final consolidated regression are **NOT VERIFIED**.

The local checkout initially appeared at base `3d05aae` with 196 tracked modifications and 414 untracked status entries (1,837 individual files). Before advancing to the accepted remote tip, all of that state was preserved in the named Git stash `arena3-preserve-pre-institution-checkout-2026-10-26` (stash object `4e8db5fdc5646892c40086dbcb9cfdc2d89013e4`). The tested but unsafe Phase 1 candidate, including the independent tests, is separately preserved in stash `arena3-phase1-candidate-blocked-approval-integrity` (object `0baed9c3b067912ac4eac8953c3871c1bc3188c4`). Neither stash was applied to the accepted baseline. A candidate diff also remains in the workspace at `/home/user/institution-phase1-candidate.patch`.

## Source and integration boundary

- Phase 1 candidates inspected: `f3ebc9a33beed1176d80d3fcbe083fa100dc128e` and `ca5b38d5ae01c270ae79c17f0af05ef5cd5be172`. They are ancestors of `origin/arena/5ee539a0-monienaija`; they were applied only to the temporary candidate, **not integrated into the branch**.
- Arena 4 is based on Arena 1 `81793dd7956963c40e823a4f6b2d2d9186fbce43`, which is not an ancestor of the accepted branch; the common ancestor is `780ec761245851cd6a1c201663ce0bc3777a5549`. We did not merge its intervening unfinished financial work or 0117.
- Phase 2 pins resolved to `1cf6ac75b18a2af68dfbd33389d1f2e5fb7f32f2` and `684271e9d972edc629d629b73e66cd719d759117`. Phase 3 pins resolved to `0b3138f5a5171023136765b23155e0786e7ecd37`, `97c9154efe9f9009da95bf4529e78934076c33dd` and **`26f5fb4110d303224f2fe45f9a57eeecfe35c57b`**. Phase 1 precedes Phase 2, which precedes Phase 3, in the source ancestry. None of these later commits was integrated.
- Candidate conflict resolutions: `a8`, `a19`, `a20` migration allow-lists retained 0118 and added 0400 without importing 0117; readiness set head 0400. The historical 0118-upgrade tests were adapted to apply only migrations through 0118, avoiding accidental early application of 0400. Arena 4's architecture proposal was not imported just to resolve a modify/delete documentation conflict. The candidate was stashed rather than committed once blockers were established.

## Independently reproduced blockers

### 1. Changed-payload replay returns success

In `f3ebc9a:src/institution/institution-affiliation.service.ts` lines 213–216, an already `CONSUMED` approval returns its prior governed record before the fingerprint check at lines 231–237. After a legitimate assignment, an authorized checker replayed the same approval with a different evidence reference. Real HTTP returned **201**, not the expected **403**. This returns success for a different request; the test did not observe a second affiliation mutation, so this is specifically an approval-integrity and misleading-idempotency defect, not a demonstrated second write. The original source test 8 itself generates a new random evidence reference for its replay and expects success.

The lifecycle service has the same structural defect: `f3ebc9a:src/institution/financial-institution.service.ts` lines 340–342 returns the current institution before checking the fingerprint at lines 345–352. After a legitimate suspension, replaying its consumed approval with target `APPROVED` and a different reason returned **201**, not **403**. The observed replay did not itself change status; it falsely accepted a different payload. Replay must bind to the originally approved full request even after the current state has advanced.

### 2. Consumed lifecycle approval can be reused by direct SQL

The migration's `fn_institution_approval_consumed` checks only consumed status, action, resource type and institution ID (migration 0400 lines 263–275). The lifecycle trigger checks that the new approval ID differs from the immediately preceding one, but does not prove that the approval authorizes the new transition or was not used earlier (lines 317–325).

Reproduction: use the real HTTP maker/checker flow to approve an institution, then independently approve and execute suspension. With database write access, update the suspended row to `APPROVED`, clear the suspension columns, and set `lifecycle_approval_id` to the **previously consumed approval for the original approval transition**. PostgreSQL accepted the update (`[[], 1]`) instead of rejecting it. This is a database-level protection failure; it requires SQL write privileges and is not presented as an unauthenticated HTTP exploit. It invalidates the requested direct-database governance guarantee and can reverse suspension without a new governed reactivation.

The [reproduction patch](phase1-approval-integrity-repro.patch) adds all three negative cases to the Phase 1 source integration suite. Apply the zero-context patch with `git apply --unidiff-zero`, then run it only against a disposable PostgreSQL cluster and the selected temporary candidate, not against production data. It is evidence, not an integrated or skipped test.

## Evidence and verification limits

All test data and transactions were synthetic on local disposable PostgreSQL 18.4; the network guard was enabled. Resource-intensive checks were sequential.

| Run                                                 | Result                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate TypeScript                                | `tsc --noEmit -p tsconfig.json`: exit 0.                                                                                                                                                                                                                                    |
| Candidate foundation + governed-action unit suites  | 2/2 suites, 19/19 tests.                                                                                                                                                                                                                                                    |
| Candidate original targeted PostgreSQL run          | 7/7 suites, 127/127 tests; [per-suite summary](phase1-targeted-results.json). Includes original Phase 1 18/18, wallet ownership 20/20, migration-chain 19/19, readiness migration sync 3/3, a8 23/23, a19 21/21 and a20 23/23. This is **not** a full PostgreSQL inventory. |
| Independent augmented Phase 1 suite, run `instsec3` | 1 suite failed: **18 passed, 3 failed, 21 total**. Each failure is described above. Full local log: `/home/user/institution-phase1-independent-final.log`.                                                                                                                  |
| Accepted baseline prior mission                     | PostgreSQL 140/140 suites and 2,538/2,538 tests; backend 238/238 and 2,840/2,840 tests; isolated KYC/session 9/9 and 98/98; mobile 14/14 and 125/125. These are historical baseline results, not a new full institutional regression.                                       |

The original suite exercises lifecycle changes, affiliations, resolver outcomes, aggregation without authority inference, role restrictions, concurrency between competing approvals and unchanged wallet/journal data. Those passing assertions do not resolve the independent negative findings. Full cross-transaction locking/revalidation, production readiness, and every Stage 1 acceptance item are **NOT VERIFIED** for a corrected candidate. In particular, the source reads institution status without a row lock during affiliation change; a suspension/affiliation concurrency race needs a deterministic test and review before acceptance.

## Required follow-up

1. Correct both replay paths so the exact approved payload remains bound to idempotent replay; preserve identical replay and maker/checker restrictions. Replace the source's replay test that unintentionally uses a different random evidence reference with distinct exact-replay and tampered-replay assertions.
2. Add a durable, transactionally enforced one-time lifecycle execution binding to the approved transition, including database-level rejection of reuse and mismatched payload. Coordinate any new migration identifier; do not silently rewrite an already-published migration or existing history. Test both fresh installation and upgrade paths.
3. Verify institution lifecycle/affiliation concurrency with transactional row locks and revalidation. Re-run the full Stage 1 acceptance, including these negative cases, before pushing an implementation checkpoint.
4. Only after a safe Phase 1 checkpoint, proceed with Phases 2 and 3, then the separately requested migration inventory/readiness work and full sequential regressions. No migration-inventory mechanism has been implemented in this blocked attempt. Dedicated assignable authorization functions and SUPER_ADMIN execution policy remain governance decisions.

No main merge, deployment, live provider call, real financial transaction, legacy-registration reopening, or unfinished financial implementation was performed.
