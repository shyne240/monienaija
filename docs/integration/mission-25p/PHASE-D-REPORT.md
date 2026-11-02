# Mission 25P — H-07 Credential Integrity Integration

**Phase D report · controlled integration and regression verification**

| Field | Value |
|---|---|
| Verdict | **PASS — INTEGRATED AND REGRESSION VERIFIED** |
| Integration branch | `integration/mission-25p-h07-credential-integrity` |
| Verified remote SHA | `f1570810d4b7b1ac6d8816fb2b9f89d3d83aa4e0` |
| Pinned application-code SHA | `f1570810d4b7b1ac6d8816fb2b9f89d3d83aa4e0` (tree `aebbcd7c8b0cf3de3a2f0ffaffab888e57fd730b`, byte-identical to 25O tip `8fa35c1`) |
| 25K baseline pin | `587c3763944368b9260c9299d18bce1189ca5919` |
| 25O implementation | `3a0f87eafe86b455e1906d7779f83ca3152b9d00` |
| 25O evidence tip | `8fa35c1d46c9afb7dbd6b3fb81049e0f4d18155d` |
| Report date (UTC) | 2026-11-02 |
| Environment | 2 vCPU / 3,939 MB · Node v22.22.3 · npm 10.9.8 · tsc 5.9.3 · jest 30.1.3 · disposable embedded PostgreSQL 18.4 |

This mission was a **controlled integration and regression verification**. It was not an
independent security audit, and it did not expand into unrelated security investigations or feature
work. Mission 25O's design, threat reasoning and policy decisions were taken as given; 25P
established that the implementation is exactly what was reviewed, that it integrates cleanly onto
the accepted 25K baseline, and that it neither breaks nor is broken by the existing system.

---

## 1. Verdict

**PASS.**

Every gate in this report completed and exited 0. The integrated tree is byte-identical to the
reviewed Mission 25O tip. All 15 required H-07 behaviors were re-verified on the integration branch
by three mutually independent routes — 25O's own suites, a focused verbose run mapped 1:1 to the
required behaviors, and a 25P-authored harness that shares no code with 25O's tests. The complete
backend unit suite and the complete PostgreSQL integration matrix pass at real counts with no
failures, no skips and no timeouts. Lint introduces zero new findings. Migration 102 was proven on a
genuine 101→102 upgrade, not merely on fresh installs.

Two consequences of that verdict are stated explicitly so they cannot be mistaken for omissions:

* **This is not a production-readiness or security-acceptance determination.** Whether H-07 may be
  operated in production remains for the consolidated pre-release security assessment. No Arena 4
  mission was requested, per instruction.
* **Mixed old/new worker fleets remain unauthorized.** See §11 — the older binary does not enforce
  the new binding, so a mixed fleet is unsafe by construction.

## 2. Exact integration branch

`integration/mission-25p-h07-credential-integrity`, branched from the exact 25K pin
`587c3763944368b9260c9299d18bce1189ca5919` — not from a later 25K tip, and not from 25O.

## 3. Verified remote SHA

```
$ git ls-remote origin integration/mission-25p-h07-credential-integrity
f1570810d4b7b1ac6d8816fb2b9f89d3d83aa4e0  refs/heads/integration/mission-25p-h07-credential-integrity
```

Local `HEAD` and the remote tip agree. The push was a new-branch push; no force-push and no history
rewrite was performed at any point in the mission.

## 4. Pinned application-code SHA

`f1570810d4b7b1ac6d8816fb2b9f89d3d83aa4e0`. Its application code is not a new artefact: the tree
hash `aebbcd7c8b0cf3de3a2f0ffaffab888e57fd730b` is identical to that of `8fa35c1`, and

```
$ git diff --name-only 8fa35c1 HEAD
(no output — 0 files)
```

so the code verified in §7 is exactly the code that was reviewed in Mission 25O. The integration
commit adds no source change of its own.

## 5. Git ancestry verification

Verified independently in 25P against freshly fetched refs, not taken from the handover:

```
$ git rev-list --parents -n 1 3a0f87e
3a0f87e… 587c376…            # sole parent = 25K baseline
$ git rev-list --parents -n 1 8fa35c1
8fa35c1… 3a0f87e…            # sole parent = 25O implementation

$ git rev-list --count 587c376..3a0f87e   -> 1
$ git rev-list --count 3a0f87e..8fa35c1   -> 1
```

| Claim | Result |
|---|---|
| Implementation's sole parent is the 25K baseline | **Confirmed** — `3a0f87e` → `587c376`, one commit |
| Evidence's sole parent is the implementation | **Confirmed** — `8fa35c1` → `3a0f87e`, one commit |
| Evidence changes documentation/evidence only | **Confirmed** — 23 files, all `docs/integration/mission-25o/**`; 0 code paths |
| No unrelated source changes | **Confirmed** — see the scope guards in §6 |

Both the implementation branch `arena/92fd33dd-monienaija` and the original 25K integration branch
`integration/mission-25k-frontend-security-alignment` were preserved untouched; all earlier pins
(`main` `39a9e504…`, mission-23 `019de99…`, 25H `5d03416…`, 25J `1049280…`, 25K tip `21b1827…`,
25O `8fa35c1…`, 25M `bde31a0c…`) are unchanged.

**Integration method.** Ancestry was verified first and was exact, so the integration is a
history-preserving merge of `8fa35c1` into a branch pinned at `587c376`. `--no-ff` was used solely to
record the integration event; the merge is fast-forward-equivalent and produced **zero conflicts and
zero file differences** — `git diff --name-only 8fa35c1 HEAD` is empty and the tree hashes are equal.
No conflict resolution, reformatting or "while we're here" edits were performed, because none were
needed.

## 6. Complete integration inventory

`587c376 → 3a0f87e`: **19 modified + 8 added = 27 files**, 1,696 insertions, 238 deletions. This
matches the brief exactly (19 M + 8 new) with evidence held in a separate, documentation-only commit.

| Area | Files |
|---|---|
| `src/` — 8 modified | `notification/notification-provider-config.service.ts`; `notification/notification.types.ts`; `notification/provider-security.ts`; `authorization/privileged-action-approval.service.ts`; `admin/admin-notification-provider.controller.ts`; `common/sensitive-data-redaction.ts`; `config/environment.ts`; `production/production-readiness.service.ts` |
| `src/` — 2 added | `notification/notification-credential-binding.service.ts`; `migrations/1785753600102-AddNotificationCredentialBinding.ts` |
| `test/` — 10 modified | `a19-agent-funding`; `a20-outlets-terminals`; `a8-agent-lifecycle`; `mission-25c-provider-routing.spec`; `notification-migration-upgrade-01`; `notification-provider-config.unit.spec`; `v1-003-admin-operational-writes`; `v1-007-support-ticket`; `v1-limit-02-limit-assignment`; `v1-notification-provider-configuration-01` |
| `test/` — 3 added | `mission-25o-credential-binding.spec.ts`; `mission-25o-credential-binding.integration.spec.ts`; `mission-25o-credential-binding-upgrade.integration.spec.ts` |
| `docs/` — 3 added | `docs/integration/mission-25o/HANDOVER.md`; `PHASE-A-CREDENTIAL-LIFECYCLE-AUDIT.md`; `ROLLOUT-AND-COMPATIBILITY.md` |
| config — 1 modified | `.env.example` |

*(Totals: 19 modified = 8 src + 10 test + `.env.example`; 8 added = 2 src + 3 test + 3 docs.
`notification-secret-encryption.service.ts` is deliberately **not** in this list — it was never
modified.)*

**Scope guards — all zero diff against the 25K baseline:**

| Area | Changed files |
|---|---|
| `src/customer-preference/` (H-04 / workforce-preference denial) | 0 |
| `src/ledger/` (financial ledger) | 0 |
| `src/authorization/route-policy-registry*` | 0 |
| `src/authorization/role-definition-governance.service.ts` | 0 |
| `src/finance-role-administration/` | 0 |
| `src/notification/notification-secret-encryption.service.ts` (AES-GCM) | 0 |
| `src/migrations/1785753600101-*` (migration 101) | 0 |

**Phase A functional confirmations**, read from the diff rather than asserted:

* **Versioned HMAC credential binding** — `HMAC_SHA256_V1` over a domain-separated message
  (`channel ‖ provider ‖ source ‖ secret`, each length-prefixed) with a 64-hex tag compared via
  `timingSafeEqual`; the key version is stored alongside the tag.
* **Approval fingerprint integrity** — `action_fingerprint_version` is versioned and the binding MAC
  is bound into the approval fingerprint, so an approval cannot be replayed against different
  credential material.
* **Maker-checker linkage** — the proposal carries `approval_id`; `approveInTransaction` was added to
  `privileged-action-approval.service.ts` as a purely additive method (no existing path altered).
* **Runtime verification, fail-closed source resolution** — delivery resolves the credential from its
  recorded source only; there is no fallback from `ENCRYPTED_DB` to an environment secret, and
  unbound/legacy configurations fail closed rather than downgrade.
* **Key rotation/retirement** — a keyring (`NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON`) with an
  `ACTIVE_KEY_VERSION`; retained versions verify historical bindings, retired/absent versions fail
  closed with `PROVIDER_CREDENTIAL_INTEGRITY_UNAVAILABLE`.
* **Config-version fencing** — activation fences on the expected configuration version and on the
  approval record, with readiness reset on rotation.
* **Migration 102** — additive columns and CHECK constraints only, with a `down` that refuses while
  governance rows exist.
* **AES-GCM preserved** — the encryption service is untouched; the binding keyring is *rejected* if it
  reuses an encryption key.
* **H-04, H-06, workforce-preference permissions, financial ledger and Ordinary Agent V1 unchanged** —
  zero diff in each area, and the corresponding suites pass in §8.

## 7. H-07 functional results

All 15 required behaviors were verified three ways: 25O's suites (`39/39` focused tests), a verbose
run whose assertion text maps 1:1 onto the required behaviors (`23/23`), and a 25P-authored harness
(`39/39`) that imports only the compiled production service and the real migration classes, sharing
no fixture or helper with 25O's tests.

| # | Required behavior | Verified by | Result |
|---|---|---|---|
| 1 | Correct binding and activation | exact-credential use in a fake adapter; deterministic MAC; binding contains no key or secret | PASS |
| 2 | Substitution before checker approval | same-last-four substitution refused, approval rolled back | PASS |
| 3 | Substitution after approval | refused without consuming the approval | PASS |
| 4 | Credential change after activation | changed **and** missing credentials blocked; vendor never called | PASS |
| 5 | Missing/revoked keys | absent, empty, invalid-JSON, wrong-length, active-absent and retired keyrings all fail closed (`PROVIDER_CREDENTIAL_INTEGRITY_UNAVAILABLE`) | PASS |
| 6 | Rotation with reapproval | rotation requires a fresh governed approval and resets prior readiness evidence | PASS |
| 7 | Reject legacy unbound external configs | fail closed, explicitly **without** environment fallback | PASS |
| 8 | Independent maker-checker approval | self-approval refused even for a dual-role maker; password-only checker refused; mismatched approval fingerprint refused | PASS |
| 9 | Prevent stale approval replay | stale approved proposals and concurrent first activation fenced; expired/cancelled approvals refused; delayed verification cannot promote the next version | PASS |
| 10 | Runtime fail-closed delivery | unconfigured and governed-disabled states make zero external calls; blocked pre-send binding mismatch is durable and retried | PASS |
| 11 | No unauthorized env-source fallback | `ENCRYPTED_DB` never falls back to a configured env secret | PASS |
| 12 | No secret disclosure via APIs/audit | credential, HMAC key and binding tag absent from responses, audit rows and captured logs; redaction enforced | PASS |
| 13 | Config-readiness race protection | readiness not promoted when a test-send completes after a new configuration activates; proposal/activation blocked while keys unavailable (governed disable still allowed) | PASS |
| 14 | Notification retry/idempotency | durable retry and event idempotency preserved for a blocked pre-send mismatch | PASS |
| 15 | Existing AES-GCM compatibility | encryption service untouched; 101→102 upgrade preserves stored ciphertext; binding keyring rejects encryption-key reuse | PASS |

Additional behavior observed and recorded: proposal reasons and approval comments refuse to copy the
effective credential; Brevo and Resend bind independently and forbid cross-provider `KEEP_EXISTING`;
partially populated or malformed binding metadata is refused.

The independent harness's 39 checks decompose into 24 binding-service checks (determinism, scheme tag,
64-hex MAC, no key/secret leakage in emitted binding, secret/channel/provider/source domain
separation, the full verify matrix, rotation to `v2`, retained `v1` still verifies, retired key fails
closed, five distinct malformed-keyring shapes, encryption-key reuse rejected in both single and
keyring forms) and 15 migration checks (see §9).

**Disposable infrastructure only.** Every behavior was exercised against a disposable PostgreSQL
database with in-memory fake adapters. No external provider was activated and no live notification
was sent.

## 8. Full backend and PG results

Every gate below finished and exited 0. Counts are the runners' own totals.

| Gate | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | no type errors |
| `npm run build` (nest build) | 0 | compiled |
| `npm test` — complete backend unit suite | 0 | **230/230 suites, 2,728/2,728 tests**, 0 fail, 0 skip, 89.3 s |
| PG integration matrix, `PG_TEST_CONCURRENCY=1` | 0 | **134/134 files, 2,475/2,475 tests, 9/9 batches**, 0 fail, 0 skip, 0 timeout, 43 m 56 s |
| Focused H-07/provider unit (3 files) | 0 | 60/60 |
| Focused H-07 integration (4 files) | 0 | 39/39 |

**Baseline deltas**, all attributable to Mission 25O:

| Suite | 25K / 25M baseline | 25P | Delta |
|---|---|---|---|
| Backend unit | 229 suites / 2,713 tests | 230 / 2,728 | +1 suite, +15 tests |
| PG integration | 132 files / 2,452 tests | 134 / 2,475 | +2 files, +23 tests |

The matrix ran at concurrency 1 for resource safety on a 2 vCPU / 3.9 GB sandbox, exactly as in 25M.
No failure was reclassified as environmental, and nothing that did not complete is reported as
passing.

## 9. Migration 102 verification

Two distinct things were proven, because a fresh install does not exercise the upgrade path.

**Fresh chain (inside the matrix):** `migration-chain.integration.spec.ts`,
`v1-release-01-production-readiness-migration-sync.integration.spec.ts` and
`notification-migration-upgrade-01.integration.spec.ts` all pass, so 102 applies cleanly and the
readiness/synchronization checks agree with the migration set.

**Genuine 101→102 upgrade (25P-authored, independent):** a disposable database was built with the
real migration chain stopped at 101 — verified to genuinely predate 102 because
`credential_binding_mac` is absent — then seeded with legacy governance rows (active configuration,
approval record, proposal) in the pre-102 shape, and only then upgraded by applying the real 102
class. **15/15 checks passed:**

* 102 is present in the chain and is recorded in `typeorm_migrations`;
* the legacy configuration survives, remains **unbound** (`scheme`/`key_version`/`mac` all NULL) and
  is not silently approved — its `credential_source` and `approved_by` are unchanged;
* the legacy proposal survives with its original status, gains no fingerprint version and is not
  retro-bound;
* on the upgraded database the new constraints are live — partial binding metadata is refused
  (`chk_notif_provider_cfg_binding`), a non-64-hex MAC and source `NONE` are refused, a fingerprint
  version other than `2` is refused, and a complete `ENV_SECRET` binding with all three binding
  columns is accepted;
* the destructive `down` migration is **refused** while governance rows exist, and the refusal leaves
  data and schema intact.

## 10. Regression and lint comparison

**Regression.** Complete backend unit suite and complete PG integration matrix both pass at the counts
in §8. Focused coverage was also run for the areas the brief calls out — customer-preference
authorization, workforce authentication/authorization, notification reliability, and Ordinary Agent
V1 financial/ledger — and all are included in the passing matrix; no suite in those areas failed,
skipped or timed out. Migration upgrade and readiness synchronization were verified in §9.

**Lint.** No new lint regressions, and no repository-wide cleanup was attempted.

| Scope | 25K baseline | 25P | Delta |
|---|---|---|---|
| Changed files (25O's 23 TS files) | 37 errors / 3 warnings / 4 files, exit 1 | 37 errors / 3 warnings / 4 files, exit 1 | **0** |
| Same 18 modified files, per-file rule+severity profile | — | — | **0 mismatches** |
| 5 added files | — | 0 diagnostics each | **0** |
| Repository-wide `{src,test}/**/*.ts` | 1,351 errors / 80 warnings / 1,400 files | 1,351 errors / 80 warnings / 1,405 files | **0 errors, 0 warnings** |

The 37 errors / 3 warnings are pre-existing and confined to four legacy test files
(`a20-outlets-terminals`, `v1-003-admin-operational-writes`, `v1-007-support-ticket`,
`v1-limit-02-limit-assignment`); their per-file profiles are identical between baseline and
integration. The repository-wide backlog (1,351 errors / 80 warnings) is likewise unchanged — it
merely grew by 5 files, all clean. **Recorded for later maintenance: the repo-wide lint backlog is
large and pre-existing; it is not a 25O or 25P regression and was deliberately not touched.**

## 11. Outstanding technical and operational limitations

**Future rollout requires all of the following.** None of it was performed here:

1. **Secure HMAC key custody and distribution.** The binding keyring is supplied via environment
   configuration, so it inherits whatever custody that channel provides. Production needs a real
   secret-management path with access control, rotation authority and audit — and the keyring must not
   reuse encryption keys (the service rejects that, which is why the operational procedure matters).
2. **Coordinated migration 102.** The schema change and the worker rollout must be sequenced: 102
   must be applied by a governed migration run before workers depend on it.
3. **Old-worker and rollback-image fencing.** **Mixed old/new worker fleets are NOT authorized.** An
   older binary does not enforce credential binding and will not populate the new columns, so during a
   mixed-fleet window H-07's guarantees do not hold. Rollback images have the same problem in reverse:
   rolling back after activation leaves bound rows that the older binary ignores, silently restoring
   the weaker behavior. Rollout must be all-or-nothing per fleet, with the rollback story settled
   before activation.
4. **External egress controls.** Fail-closed behavior prevents delivery, but it does not prevent
   network egress. Provider reachability must be constrained at the infrastructure layer.
5. **Fresh governed approvals.** Any credential material carried across environments must be
   re-approved under the new binding; legacy rows are deliberately unbound and will fail closed until
   they are.
6. **Separate production authorization.** Deploying this, provisioning production keys, and enabling
   real providers are each distinct decisions requiring their own authorization.

**Also unresolved by design:** H-04 and H-06 remain unimplemented; the workforce-preference denial is
unchanged; the repository-wide lint backlog in §10 is outstanding. Migration 102's `down` refuses
while governance rows exist, which is intentional but means rollback requires a data decision, not
just a command.

## 12. Evidence paths

`docs/integration/mission-25p/` on the integration branch:

| File | Contents |
|---|---|
| `PHASE-D-REPORT.md` | this report |
| `evidence/01-environment-and-pins.txt` | environment, pins, tree hashes |
| `evidence/02-ancestry-scope-and-integration.txt` | raw ancestry, scope-guard and integration command output |
| `evidence/03-backend-unit-suite.log.gz` | complete backend unit run |
| `evidence/04-pg-integration-matrix.log.gz` | complete PG matrix run (9 batches) |
| `evidence/04-pg-matrix-start-utc.txt` | matrix start timestamp |
| `evidence/05-h07-focused-unit.log.gz` | focused H-07/provider unit run |
| `evidence/06-h07-focused-integration.log.gz` | focused H-07 integration run |
| `evidence/07-h07-behavior-map-verbose.log.gz` | verbose assertion text for the 15 behaviors |
| `evidence/08-gate-summary.txt` | every gate, its exit code and totals |
| `evidence/09-independent-h07-harness.cjs` / `-results.json` | 25P-authored harness, 39/39 |
| `evidence/10-independent-migration102-upgrade.cjs` / `-results.json` | 101→102 upgrade proof, 15/15 |
| `evidence/11-lint-comparison.json` | scoped and repository-wide lint comparison |
| `evidence/11-lint-changed-files-head.txt` | the 23 changed TS files |
| `evidence/11-lint-modified-files-parent.txt` | the 18 modified TS files linted at baseline |

Mission 25O's own evidence remains in `docs/integration/mission-25o/` (23 files) and was not modified.

## 13. Confirmation of prohibited actions

For Mission 25P, none of the following occurred:

* **no deployment** to any environment;
* **no live activation** — no external provider was activated, and every provider interaction was an
  in-memory fake;
* **no production HMAC key provisioning** — test keyrings only, in a disposable sandbox;
* **no live sends** — no SMS or email was transmitted, and unconfigured/provider-disabled paths were
  asserted to make zero external calls;
* **no production database was touched** — every database was disposable and created per run;
* **no merge into `main`** and no force-push or history rewrite;
* **no mixed old/new worker fleets** were authorized — the opposite was documented in §11;
* **no H-04 or H-06 policy changes** and no workforce permission changes;
* **no unrelated source changes** — the 25P commits are documentation and evidence only.

## Completion

All gates pass, so **Mission 25P is complete**. Results are preserved here for the consolidated
pre-release security assessment; no Arena 4 security-audit mission was requested. No genuinely
critical new defect was discovered, so nothing is referred for correction.
