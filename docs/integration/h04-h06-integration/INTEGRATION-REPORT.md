# Mission H-04 / H-06 — Controlled Integration and Verification Report

**Arena 3 · transaction-notification configuration controls**

| Field | Value |
|---|---|
| Integration verdict | **PASS** |
| Integration branch | `integration/h04-h06-transaction-notification-controls` |
| Application-code commit | `5b051aa5ff8e33aae0401d48c699dbd84b73bfc5` (merge commit; application tree identical to source `e2c294b3`) |
| Integration tree | `3b271a06fca7caf22f940e3666c6cc9463c5ef97` |
| Source implementation | `e2c294b3d0cae8f3017d5a9670475cdf05b26b58` |
| Source parent | `7997543e81575825bdea1bd9670273b1c7d611f2` |
| Earlier backend implementation | `377b1207905909867dbce75cf78717fa5015b90a` |
| Integration baseline | `integration/mission-25p-h07-credential-integrity` @ `9f4b7489f205fc958392a52a575379b179168180` |
| Pinned application SHA of baseline | `f1570810d4b7b1ac6d8816fb2b9f89d3d83aa4e0` |
| Date (UTC) | 2026-11-02 |
| Environment | 2 vCPU / 3,939 MB · Node v22.22.3 · npm 10.9.8 · tsc 5.9.3 · jest 30.1.3 · eslint 9.36.0 · disposable embedded PostgreSQL 18.4 |

This was a **controlled integration and regression verification**. It did not initiate a new
security audit, did not deploy, did not activate a provider and did not merge to `main`.

---

## 1. Verdict

**PASS.** The verified source integrates exactly, every gate exits 0, migration 103 is proven on a
real 102→103 upgrade, and no previously integrated behavior regressed.

## 2. Integration branch

`integration/h04-h06-transaction-notification-controls`, created from the accepted integration
baseline `integration/mission-25p-h07-credential-integrity` at tip `9f4b748`. That tip is the 25P
branch; its application code is the pinned `f157081`. **The tip was used rather than `f157081`
directly so that 25P's committed evidence is preserved in the integrated history** — the application
tree of `9f4b748` and `f157081` is identical, so this changes no code.

## 3. Exact application-code commit

`5b051aa5ff8e33aae0401d48c699dbd84b73bfc5` — the `--no-ff` merge of `e2c294b3` into `9f4b748`.

```
$ git diff --name-only e2c294b3 HEAD -- src apps test scripts package.json package-lock.json
(no output — 0 files)
```

The integrated application code is byte-identical to the verified source. The merge commit exists
only to record the integration event.

## 4. Verified remote tip

Stated with the same caveat used in 25P: this report is a file in the branch tip, so the tip SHA
cannot be written into it without changing it. The evidence commit's parent **is** verified:

```
$ git ls-remote origin integration/h04-h06-transaction-notification-controls
<tip> refs/heads/integration/h04-h06-transaction-notification-controls
$ git rev-parse HEAD          # local
<tip>                         # matched remote exactly after push
```

The push was a plain fast-forward on a new branch: no force, no rewrite. The application-code
commit `5b051aa` is immutable and is the SHA to pin.

## 5. Source and baseline ancestry

Verified independently against freshly fetched refs:

```
e2c294b3  parent: 7997543e81575825bdea1bd9670273b1c7d611f2
7997543   parent: 377b1207905909867dbce75cf78717fa5015b90a
377b120   parent: 8fa35c1d46c9afb7dbd6b3fb81049e0f4d18155d    # = Mission 25O tip, inside 25P
merge-base(25P tip 9f4b748, source e2c294b3) = 8fa35c1d46c9afb7dbd6b3fb81049e0f4d18155d
```

So the source is a **strict linear descendant** of the 25O tip that 25P already integrated. The
source and the integration baseline had diverged only by 25P's three documentation/evidence commits,
which is why the merge was clean.

Remote refs confirmed before integrating:

| Ref | SHA |
|---|---|
| `arena/92fd33dd-monienaija` (source) | `e2c294b3…` — matches the brief's final source SHA |
| `integration/mission-25p-h07-credential-integrity` | `9f4b748…` |
| `integration/mission-25k-frontend-security-alignment` | `21b1827…` (unchanged) |
| `main` | `39a9e504…` (unchanged) |

## 6. File inventory and conflict resolutions

`9f4b748 → HEAD`: **34 modified, 39 added, 0 deleted**, 9,746 insertions / 404 deletions.

| Area | Files | Content |
|---|---|---|
| `src/notification/` | 9 | `notification-defaults-v2.ts` **(new)**; event map, registry, dispatcher, delivery processor, inbox, template, types, security constants |
| `src/migrations/` | 1 | `1785753600103-ConfigureTransactionNotificationEvents.ts` **(new)** |
| `src/production/` | 1 | production-readiness migration expectations |
| `test/` | 23 | 3 new H-04/H-06 suites; 20 amended notification/agent/limit/migration suites + `test/support/pg-harness.ts` |
| `apps/admin-web/` | 6 | event-master controls in the notification screen, domain and API services, auth store, 2 test files (1 new) |
| `docs/integration/h04-h06*` | 33 | source handover doc + its evidence tree (32 files), plus this mission's report and evidence |

**Conflict resolutions: none.** `git merge --no-ff e2c294b3` completed with zero conflicts and zero
manual edits; no side was discarded because no side required reconciliation. The only tree difference
from the source is 25P's preserved documentation, which the source never touched.

**Preserved behavior — all zero diff from the 25O tip through the source:**

| Guard | Changed files |
|---|---|
| `src/notification/notification-credential-binding.service.ts` (H-07) | 0 |
| `src/notification/notification-secret-encryption.service.ts` (AES-GCM) | 0 |
| `src/notification/provider-security.ts` | 0 |
| `src/authorization/privileged-action-approval.service.ts` (maker-checker) | 0 |
| `src/migrations/1785753600102-AddNotificationCredentialBinding.ts` | 0 |
| `src/migrations/1785753600101-NotificationReliability.ts` | 0 |
| `src/ledger/` | 0 |
| `src/customer-preference/` | 0 |

H-07 was additionally **re-executed**, not merely diffed: see §7.

## 7. Complete regression results

Every gate completed and exited 0.

| Gate | Exit | Result |
|---|---|---|
| backend `tsc --noEmit` | 0 | no type errors |
| backend `npm run build` | 0 | compiled |
| admin-web `npm run ts:check` | 0 | no type errors |
| admin-web `npm run build` | 0 | built in 3.34 s |
| backend unit suite | 0 | **231/231 suites, 2,757/2,757 tests**, 0 fail, 0 skip, 49.1 s |
| PG integration matrix @ concurrency 1 | 0 | **136/136 suites, 2,482/2,482 tests, 10/10 batches**, 0 fail, 0 skip, 0 timeout, 42 m 08 s |
| admin-web suite | 0 | **38/38 suites, 308/308 tests**, 0 fail, 0 skip, 28.7 s |

| Baseline delta | 25P baseline | Integrated | Delta |
|---|---|---|---|
| backend unit | 230 suites / 2,728 tests | 231 / 2,757 | +1 suite, +29 tests |
| PG integration | 134 suites / 2,475 tests | 136 / 2,482 | +2 suites, +7 tests |
| admin-web | 37 suites / 284 tests | 38 / 308 | +1 suite, +24 tests |

Every delta is H-04/H-06's own new coverage. Nothing else changed shape.

**Focused regressions** (exit 0 throughout):

| Focus | Result |
|---|---|
| notification integration, 8 provider/governance/delivery files | 102/102 |
| notification unit, 4 files | 56/56 |
| H-04/H-06 + registry, verbose behaviour map | 12/12 |
| admin-web notification screens | 43/43 |
| H-07 credential binding, independent harness re-run | **39/39** |

The full matrix includes the Agent V1, financial-ledger, limit, workforce-authz, customer-preference,
notification-reliability and migration-chain suites; none regressed.

### A resource-contention incident, recorded rather than hidden

My first attempt ran the backend unit suite and the admin-web suite **concurrently** on this 2 vCPU /
3,939 MB sandbox. The kernel OOM killer struck:

```
[991.563348] Out of memory: Killed process 2549 (node) … global_oom
/proc/vmstat → oom_kill 1
```

PID 2549 was the jest worker for `test/module-di-wiring.spec.ts`, which failed with *"A jest worker
process was terminated by another process: signal=SIGKILL"*; one admin-web test also exceeded its 5 s
timeout in a suite that took 842.7 s versus 28.7 s when isolated.

Both were re-run **serially on the identical tree with no source change**: backend 231/231 suites
exit 0 in 49.1 s; admin-web 38/38 suites exit 0 in 28.7 s; `oom_kill` stayed at 1. The cause was my
own harness concurrency, not the application. Both raw runs — the failing and the passing — are
committed (`03b`, `05c` and `03`, `05`) so this judgement can be checked rather than trusted.

## 8. Migration 103 results

Two independent lines of evidence.

**(a) Inside the matrix** — `migration-chain.integration.spec.ts`,
`notification-migration-upgrade-01.integration.spec.ts`, `h04-h06-notification-upgrade.integration.spec.ts`,
`mission-25o-credential-binding-upgrade.integration.spec.ts` and the production-readiness
migration-sync suite all pass on fresh disposable databases, so 103 applies cleanly, readiness
agrees with the migration set, and 102 and 103 coexist.

**(b) Genuine 102→103 upgrade, independently authored for this mission — 24/24 PASS.** The real chain
was built and stopped at 102 (confirmed pre-103: no `EVENT` in the channel CHECK, no EVENT rows
possible), seeded with pre-103 state, then upgraded by applying the real 103 class:

| Required check | Evidence |
|---|---|
| Fresh chain through 103 | full chain migrates a bare database |
| Upgrade from 102 | 103 applies over an existing 102 database and is recorded in `typeorm_migrations` |
| Preservation of existing notification settings | a governed channel choice at version 4 survives untouched; an ordinary event keeps its EVENT-enabled default; a custom template version is preserved, not replaced |
| Financial-lock repair and audit | a wrongly SECURITY-classified, locked financial row is repaired (`is_locked=false`, class restored), version bumped, attributed to `SYSTEM_MIGRATION_0103`, and audited as `NOTIFICATION_FINANCIAL_LOCK_REMOVED` |
| SECURITY lock preservation | a real SECURITY row keeps its class and lock; it cannot be modified at all; no SECURITY event gained an ordinary EVENT control row |
| Guarded rollback | `down` is refused; governed EVENT rows and schema survive the refusal |
| Additional | `transfer.unknown` inherits `transfer.failed`'s channel setting exactly once; deposit/withdrawal events exist unlocked but start disabled; the configuration guard trigger is re-armed and still requires `version+1`; configurations remain undeletable |

## 9. Functional verification

Verified by four independent routes: the source's own suites, my governance-invariant harness
(**16/16 PASS**), the verbose behaviour map, and the admin-web screen tests.

| # | Required check | Result |
|---|---|---|
| 1 | EVENT, SMS, EMAIL independently configurable per event | PASS — three separate rows per ordinary event; `EVENT` is a control row, not a channel |
| 2 | Event disabled suppresses both channels | PASS — event-wide disable flips only the EVENT row; both channels remain representable and delivery requires event **and** channel enabled |
| 3 | Re-enabling preserves channel settings | PASS — channel rows and their versions are untouched across disable/enable |
| 4 | SMS-only, email-only, both, neither | PASS — all four combinations representable and independent (verified in DB and in the admin UI) |
| 5 | Changing one event does not change another | PASS — byte-identical snapshot of other events before/after |
| 6 | Versioned maker-checker approvals enforced | PASS — distinct checker required, `expectedVersion` fencing, immutable versioned audit; DB refuses unversioned changes and version jumps |
| 7 | Pending vs effective distinguished | PASS — approved-but-unconfirmed, stale-at-execution, and cancelled/expired/unknown statuses are not treated as effective |
| 8 | Conflicts and partial submissions handled | PASS — partial multi-target failure retains only unsubmitted drafts; concurrent channel change is not overwritten; stale versions surface without retry |
| 9 | Unauthorized users cannot bypass governance | PASS — role alone insufficient; SERVICE, missing registry scope, password-only assurance, read-only session and non-`NONE` customer access all fail closed, with zero API calls |
| 10 | Unrelated SECURITY locks intact | PASS — SECURITY rows keep locks, are non-editable, and admins never query them |
| 11 | Customer preferences and verified-contact rules enforced | PASS — event toggles applied on new SMS and retry while retaining customer preference and idempotency; email requires an eligible verified contact |
| 12 | Deposit/withdrawal retain original semantics | PASS — recipients derived from the committed payment's wallet, not the outbox payload; mismatched aggregate/status/payment identity is quarantined; payloads omit journal IDs, amounts and raw failure text; ledger untouched |
| 13 | H-07 credential binding intact | PASS — 39/39 independent harness checks re-executed on the integrated tree, plus 102's constraints verified alongside 103 |

## 10. Known limitations

Recorded accurately; **not** fixed, because fixing them would exceed the mission.

1. **Events without live producers.** `transfer.unknown`, `cash_to_cash.claimed` and
   `cash_to_cash.expired` are fully configurable but have **no identified production outbox
   producer** — their services write audit actions only. Configuring them does not imply they are
   sent. No speculative producer was added.
2. **`cash_to_cash.created` is phone-only.** An unregistered phone-only beneficiary has no
   authoritative email address, so email cannot be sent without an eligible CUSTOMER recipient with a
   verified email contact. This is existing product semantics, not a defect.
3. **Approval indicators are limited to the loaded queue page.** The pending/approved indicator does
   not page beyond what is currently loaded, so a proposal not on the loaded page is not reflected.
4. **Stale source documentation.** `docs/integration/h04-h06-transaction-notification-controls.md`
   still states that Admin Web "does **not** yet provide an event-master toggle" and carries a
   "Frontend completion item" section. **That is no longer true**: commit `e2c294b3` implements the
   toggle (`channel: 'EVENT'` proposal path, `draftEventEnabled` state) and adds
   `notification-event-master.test.tsx`. The same staleness affects
   `docs/integration/h04-h06/evidence/test-summary.json`, whose `frontend_gap` field and lint/`jest_runs`
   figures predate the Admin Web commit. I did not rewrite the source's evidence — that would falsify
   an audit record — so this report supersedes those fields. It is a documentation-accuracy gap, not
   a code gap.
5. **Rollback is governed, not mechanical.** Migration 103's `down` refuses by design: an older
   binary cannot enforce event-wide controls, so rollout and any rollback need coordinated
   worker/fleet upgrades, stop/drain and egress fencing, and a separately authorized recovery plan.
6. **H-07 gates still apply in full** — key custody, binding, reapproval and provider activation are
   unchanged by this mission and remain prerequisites for any production use.

## 11. Evidence locations

`docs/integration/h04-h06-integration/evidence/` on the integration branch (22 files). Logs are
gzipped so they survive the repository's `*.log` ignore rule.

| File | Contents |
|---|---|
| `01-environment-and-pins.txt` | environment, all pins, tree hashes |
| `02-ancestry-scope-inventory.txt` | raw ancestry, merge result, scope guards, full file inventory |
| `03-backend-unit-suite.log.gz` | passing backend unit run |
| `03b-backend-unit-contended-run.log.gz` | the OOM-contended run, for audit |
| `04-pg-integration-matrix.log.gz` | complete 136-suite matrix |
| `04-pg-matrix-start-utc.txt`, `04-pg-matrix-end-utc.txt` | matrix window |
| `05-adminweb-suite.log.gz` | passing admin-web run |
| `05b-adminweb-baseline.log.gz` | admin-web on the 25P baseline (37/284) |
| `05c-adminweb-contended-run.log.gz` | the contended run, for audit |
| `06-focused-notification-integration.log.gz` | 102 focused tests |
| `07-focused-behavior-map-verbose.log.gz` | 12 verbose behavior assertions |
| `08-adminweb-notification-focused.log.gz` | 43 admin-web screen tests |
| `09-independent-migration103-upgrade.cjs` / `-results.json` | 102→103 upgrade proof, 24/24 |
| `10-independent-governance-invariants.cjs` / `-results.json` | event/channel/SECURITY invariants, 16/16 |
| `11-independent-h07-reverify.cjs` / `-results.json` | H-07 re-execution, 39/39 |
| `12-lint-comparison.json` | scoped and repo-wide lint comparison |
| `13-gate-summary.txt` | every gate, exit code, totals, and the contention incident |

The source's own evidence remains untouched at `docs/integration/h04-h06/` (32 files).

### Lint

| Scope | Baseline | Integrated | Delta |
|---|---|---|---|
| Backend changed files (`src/**`, `test/**`) | 132 errors / 8 warnings / 29 files | 132 / 8 / 34 files | **0**, 0 per-file profile differences |
| Backend repo-wide `{src,test}/**/*.ts` | 1,351 errors / 80 warnings / 1,405 files | 1,351 / 80 / 1,410 files | **0 errors, 0 warnings** |
| Added backend files (5) | — | 0 diagnostics each | **0** |

The 132/8 backlog is pre-existing across ten legacy test files and is **baseline debt, not an
H-04/H-06 defect**. No repository-wide cleanup was performed. **Admin Web has no ESLint
configuration and sits outside the root config's `files` scope**, so it cannot contribute lint
regressions; its TypeScript is instead gated by `ts:check`, which exits 0. This differs from the
source's reported `admin_adapted_errors: 112`, which came from applying the backend config ad hoc —
I did not repeat that, since it measures a configuration the repository does not have.

## 12. Confirmation of no main merge or production operations

None of the following occurred:

* **no merge into `main`** — `main` remains `39a9e504…`, unchanged and untouched;
* **no deployment** to any environment, **no provider activation**, and **no live SMS or email** —
  every dispatch ran against fake/in-memory transports with no vendored network path;
* **no production database change** — every database was disposable, created and dropped per run;
* **no external financial transaction** — ledger and payment semantics are untouched (zero diff) and
  all financial suites pass;
* **no force-push or history rewrite** — the branch was created and pushed as a fast-forward;
* **no invented products, no speculative producers, no financial-accounting changes**, and no H-04/H-06
  policy expansion beyond the verified source;
* **no new security audit** and no production rollout were initiated.

All previously accepted baselines and branches are preserved: `arena/92fd33dd-monienaija` `e2c294b3`,
`integration/mission-25p-h07-credential-integrity` `9f4b748`, `integration/mission-25k-frontend-security-alignment`
`21b1827`, `integration/mission-23-fast-uri-security` `019de99`, `main` `39a9e504`.

## Completion

Integration and verification are complete; the mission stops here. Results are preserved for the
consolidated pre-release assessment.
