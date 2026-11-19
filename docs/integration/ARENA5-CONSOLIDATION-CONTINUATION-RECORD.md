# Arena 5 — consolidation continuation record

Durable, tracked continuation record for the Arena 5 mission (unified application consolidation and V1
banking transaction completion). It records what was merged, every conflict and its resolution, and the
evidence produced. It is updated as each group lands; later groups append their own sections. The final
cumulative handoff lives in `MONIENAIJA-V1-CONSOLIDATED-TRANSACTION-AND-APPLICATION-HANDOFF.md` (Group 40).

**Active branch:** `arena/1f37a4f3-monienaija` (pushed to origin).
**Frozen predecessors (unchanged):** `arena/defdd0fd-monienaija` = `6816a760bd460df2a5347016d7d84f5c62cab642`
(Arena 3D), `arena/bcf44621-monienaija` = `78d999d6e0834e2da990ab7d95a4a38cb2e9709e` (Arena 2C).
**Branch base:** `6816a760…` (Arena 3D), which is what the session branch was assigned from.

| Gate                              | Current result                                                        |
| --------------------------------- | --------------------------------------------------------------------- |
| Merge commit                      | `298efaef510ba999781cfc84c0d62777b79810ec` (parents 3D + 2C)          |
| Migration head (both sources)     | `1785753600802:ExtendBeneficiaryOwnership1785753600802`               |
| Combined migration identities     | 164 (3D added 0606–0614, 2C added 0800–0802)                          |
| `npx tsc --noEmit -p tsconfig.json` | exit 0                                                              |
| Root unit suite                   | 3402/3402 tests in 291 suites, 0 failed (observed in Group 36 rerun)  |
| `npm run lint` / `format:check`   | clean / clean                                                         |
| Consolidated acceptance artefact  | `docs/integration/evidence/consolidated/consolidated-run.json` — 0 failing rows |
| Release gate                      | **NOT_READY** — 16 blockers, 4 conditions (unchanged by the merge)    |

Sections below are a chronological log. Earlier states are kept as history; anything superseded says so.

---

## 1. Repository shape and why the merge was not ordinary

The two frozen predecessors do not share ancestry inside this repository:

- The Arena 3D freeze (`6816a760…`) is a **squashed single commit** in this object store
  (`git rev-list --count 6816a760…` = 1; `git cat-file -t 75e17690…` — the commit recorded in the 3D
  acceptance evidence — is `missing`). All 3D history beyond the freeze exists only as that tree.
- The Arena 2C freeze (`78d999d6…`) retains a normal history (982 commits).

`git merge` refused (`refusing to merge unrelated histories`). The integration therefore used an
explicit virtual-base `read-tree -m <virtual-base> 3D 2C` strategy with a hand-written `MERGE_HEAD`
so that the resulting merge commit `298efaef` carries **both** as parents — no history was rewritten,
grafted away, or discarded, and no frozen branch reference was touched. The virtual base was the empty
tree: the two lineages are independent imports of the same product, so the merge is a union of two
complete trees, and every differing path had to be resolved deliberately rather than defaulted.

**No blanket `--ours` / `--theirs` was used for any shared path.** Seven paths were touched by both
sides and each was resolved individually; everything else came through as one side's file verbatim,
which is correct because the two lineages evolved different subtrees (3D: banking engine, workers,
readiness; 2C: P2P parity, commercial catalog, migration 0800–0802, mobile/admin journeys).

## 2. Every conflict and its resolution

### 2.1 `.env.example`

Both sides extended the same tail of the file.

- Kept **3D's** boot-time schema-completeness block (A2 recovery, BANKING_* disabled-by-default block,
  database pool/timeouts, Dojah, KYC policy, protected-authority DB identity, HTTP CORS, DR/BCP RPO/RTO
  placeholders left deliberately empty as undecided business decisions) and the regenerable inventory
  pointer.
- Kept **2C's** `WALLET_TRANSFER_QUOTE_TTL_SECONDS=` entry (quote lifetime; explicitly **no approved
  production value** — the 300 s figure appears only as a labelled owner-review fallback for
  dev/test, never as a production default).

Result: a union file. No variable was dropped; nothing here activates any provider or financial
service.

### 2.2 `src/config/environment.ts`

Auto-merged without conflict markers (disjoint hunks: 3D recovery RPO/RTO schema next to 2C quote-TTL
schema). Verified after the merge that both blocks are present and the file compiles
(`tsc --noEmit` exit 0).

### 2.3 `src/production/production-readiness.service.ts`

Both sides had edited the same release-gate logic differently.

- Kept **3D's** `FINANCIAL_DEPENDENCY_BLOCKERS` (exported) and its readiness reporting shape, and the
  3D startup/release-readiness behaviour.
- Adopted **2C's** exact loaded/applied migration identity checks: the release gate now pins the
  applied-migration ledger by **timestamp and name**, enforces **cardinality** and **uniqueness** of
  the banking-chain migration set, and verifies the head both by constant and by exact loaded
  inventory — not by a substring or a count alone.
- Pinned `EXPECTED_MIGRATION_*` head to `1785753600802` / `ExtendBeneficiaryOwnership1785753600802`
  (both sides already pointed at 0802; the pin is now asserted from the consolidated side).
- **The gate still reports NOT_READY (16 blockers, 4 conditions).** Nothing in this resolution removes
  a blocker, widens a capability, or edits the gate to green. Unproven capabilities remain unproven.

### 2.4 `test/a3d-agent-float-funding.integration.spec.ts`

- Adopted **2C's** teardown (`destroyIntegrationDataSource`), which is double-destroy-safe (dropping
  the run-owned database when Nest already closed the injected connection; tolerates already-destroyed
  sources) and kept **3D's** test content (the fourteen ledger-level assertions about funding an agent
  operating float from a verified inbound payment).
- This is the defect the platform-journeys suite pins: an unguarded `db.destroy()` after `app.close()`
  previously threw `CannotExecuteNotConnectedError` and reddened the suite while all assertions passed.

### 2.5 `test/platform-journeys.spec.ts` (post-merge repair, commit `b66238be`)

The suite pinned the literal string `if (db?.isInitialized) await db.destroy()`. The merge correctly
shipped the 2C harness teardown instead, so the pinned text no longer exists. The test was **updated,
not weakened or deleted**: it now asserts the invariant the pin existed for — the suite must not call
an unguarded `db.destroy()` — against the merged implementation (`if (db) await
destroyIntegrationDataSource(db);`), and explicitly forbids the two unsafe forms
(unguarded `await db.destroy();` and the old conditional pattern it was switched away from). 16/16
tests in the suite pass; 3/3 evidence suites pass together with `consolidated-matrix` and
`migration-inventory`.

### 2.6 `test/migration-inventory.spec.ts`

Combined the two inventories rather than choosing one:

- head pinned to `1785753600802` / `ExtendBeneficiaryOwnership1785753600802`;
- banking-chain assertions scoped to the ≤605 chain; 3D's 0606–0614 identities added individually with
  names; 2C's 0800–0802 identities added individually with names;
- exact 164-identity account across the combined chain (no renumbering, no rewriting of either
  source's applied history).

### 2.7 `test/migration-chain.integration.spec.ts`

The "institution 0400 historical upgrade" sequence (a DB that stopped at a historical point is brought
forward) was extended to include 3D's nine migrations in timestamp order:
`OutboxLeasesAndDeadLetters 0606`, `IntegritySnapshots 0607`,
`EmergencyAccessReviewRequirement 0608`, `FraudRiskSignals 0609`, `ComplianceRegister 0610`,
`ComplaintsAndDisputes 0611`, `MobileClientSupport 0612`, `NotificationDeliveryReceipts 0613`,
`PrivacyAndRetention 0614` — then 2C's `BindWalletTransferQuotes 0800`, `AgentVerifiedPhone 0801`,
`ExtendBeneficiaryOwnership 0802`. Order preserved; no migration renumbered or skipped.

### 2.8 `src/agent/agent-cash-to-cash.service.ts`

Both sides had diverged from the same source; the merged file keeps **2C's** concurrency fix
(Arena 2C's Group 2 cash-to-cash hardening):

- the institutional suspense account is located with `findInstitutionCashToCashSuspenseAccount`
  **without** a premature `FOR SHARE` lock (Ledger acquires posting account locks in sorted order;
  holding SHARE here and upgrading to UPDATE inside Ledger could deadlock two initiations on the same
  institutional suspense account); the selected account is revalidated under Ledger's UPDATE lock
  before commit (`requireInstitutionCashToCashSuspenseAccount(manager, institutionId, unclaimedAccount.id)`),
  and a mismatch rolls the provisional journal writes back;
- `QueryFailedError` from sender enrichment is no longer masked as a best-effort `null` (a failed
  statement aborts the enclosing transaction, so swallowing it could make a rollback look like a
  successful initiation); other, non-database enrichment failures remain best-effort.

3D's cash-to-cash content (defaults, digital-asset flows) came through unchanged.

### 2.9 `docs/integration/ENVIRONMENT-CONFIGURATION-INVENTORY.md`

Regenerated from the merged tree, not hand-edited: 157 documented keys —
OPERATIONAL 43 · INTERNAL 39 · ENVIRONMENT_SPECIFIC 33 · SECRET 18 · PROVIDER_SPECIFIC 17 ·
FINANCIAL_POLICY_DEPENDENT 7 — with **0 undocumented variables**. Regenerate with
`node scripts/generate-env-inventory.js`.

### 2.10 `docs/integration/evidence/consolidated/consolidated-run.json` (post-merge repairs)

The 3D freeze squashed history (§1), so the commit recorded in the 3D evidence
(`75e17690…`) does not exist in this object store and the ancestry assertion in
`test/consolidated-matrix.spec.ts` could never pass against it. The test was **not** changed. The
artefact was instead regenerated, by executing the repository's own script
`node scripts/run-consolidated-acceptance.js` on the clean consolidated tree; every executed row was
re-computed from a real run:

`tsc` clean · `eslint` clean · `prettier` clean · unit suite **3402/3402 in 291 suites** ·
CI gates 15/15 · mobile manifests 0 errors · release gate **NOT_READY** (16 blockers, 4 conditions —
preserved) · 10/10 journeys and 27/27 browser checks recorded from artefacts · 8 declared-unavailable
rows retained · **0 failing rows**.

Two transitional seed commits (`35bf9b74`, `c8bac743`) made the regeneration run possible on a clean
tree while the artefact still named a pre-merge commit; both are clearly labelled in their messages and
were fully superseded by commit `25f971fc`, which carries the regenerated artefact computed on the
merged tree. The artefact now records the merged tree's own commit; it is always an ancestor of the
commit that carries it, exactly as the suite's comment describes.

A unit-test consequence of the regeneration is worth naming plainly: the evidence
necessarily predates the commit that carries it, so the ancestry check (not equality) is the correct
invariant and it now holds.

### 2.11 Formatting drift in three Arena 2C files (commit `c8bac743`)

`src/customer-beneficiary/customer-beneficiary.service.ts`,
`test/commercial-transfer-fee-quote.spec.ts` and
`test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` did not match this repository's prettier
style after the union merge (business content unchanged; line-wrapping only). `prettier --write`
normalised them; `format:check` now passes. No semantic change.

## 3. What was verified, and how

Executed on the consolidated tree (branch tip `25f971fc` at the time of writing):

- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- Root unit suite → **3402/3402 tests in 291 suites** (the run inside the acceptance regeneration at
  `c8bac743`; both previously failing suites fixed at `b66238be` and verified in isolation, 16/16,
  plus `consolidated-matrix` and `migration-inventory` green at `25f971fc`).
- `npm run lint` → clean (0 errors). `npm run format:check` → clean.
- Migration inventory and chain assertions (`test/migration-inventory.spec.ts`, head pin, 164 identities,
  0606–0614 and 0800–0802 present, banking chain scoped ≤605) → pass.
- Consolidated acceptance artefact → 0 failing rows; release gate NOT_READY (16 blockers, 4 conditions).

Not yet re-executed on the combined source (tracked for Group 3): the real-PostgreSQL suites —
fresh install from empty, upgrade-from-3D, upgrade-from-2C, idempotent replay, exact applied inventory,
head `…0802`. Those require the guarded disposable cluster (`PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`,
a unique `PG_TEST_RUN_ID`, loopback-only `DB_HOST`) and are the next checkpoint.

## 4. Preservation statements

- Both predecessor freezes are unmodified; only `arena/1f37a4f3-monienaija` was pushed.
- No migration was renumbered, rewritten or fabricated; the combined 164-identity chain is the union of
  both freezes' applied history.
- No financial / security / KYC / institutional / operational boundary was weakened: protected-authority
  decisions remain outside the runtime role; no provider call, real notification, real money, or
  production activation occurred; the release gate was not edited to green; production stays fail-closed.
- No second P2P engine, no second inbound-funding ledger, no personal-wallet or own-bank-transfer
  product was introduced by the merge.
- Interrupted or environment-blocked runs were not counted as passing; the release gate remains
  NOT_READY while its blockers stand.

## 5. Immediate next groups

1. **Group 3** — re-run the PG migration verification on the combined source: fresh install, upgrade
   from 3D, upgrade from 2C, idempotent replay, exact inventory checks; record results here.
2. **Group 4** — Nest startup/DI, PROCESS_ROLE api/worker/all-in-one, worker leases/fencing,
   ENVIRONMENT-CONFIGURATION-INVENTORY regeneration check.
3. **Group 5–6** — P2P directions preservation audit on the consolidated runtime; D1–D8 (2C handoff)
   dispositions (legacy unbound beneficiaries; revocation vs new quotes; quote TTL; read-only recovery).
4. **Group 9+** — extend the A6 commitment path to typed customer/agent participants for external bank
   transfers (no new engine; FinancialCommitmentService is currently CUSTOMER-self only).
