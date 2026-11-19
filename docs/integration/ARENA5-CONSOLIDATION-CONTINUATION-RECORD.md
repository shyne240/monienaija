# Arena 5 — consolidation continuation record

Durable, tracked continuation record for the Arena 5 mission (unified application consolidation and V1
banking transaction completion). It records what was merged, every conflict and its resolution, and the
evidence produced. It is updated as each group lands; later groups append their own sections. The final
cumulative handoff lives in `MONIENAIJA-V1-CONSOLIDATED-TRANSACTION-AND-APPLICATION-HANDOFF.md` (Group 40).

**Active branch:** `arena/1f37a4f3-monienaija` (pushed to origin).
**Frozen predecessors (unchanged):** `arena/defdd0fd-monienaija` = `6816a760bd460df2a5347016d7d84f5c62cab642`
(Arena 3D), `arena/bcf44621-monienaija` = `78d999d6e0834e2da990ab7d95a4a38cb2e9709e` (Arena 2C).
**Branch base:** `6816a760…` (Arena 3D), which is what the session branch was assigned from.

| Gate                                | Current result                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Merge commit                        | `298efaef510ba999781cfc84c0d62777b79810ec` (parents 3D + 2C)                    |
| Migration head (both sources)       | `1785753600802:ExtendBeneficiaryOwnership1785753600802`                         |
| Combined migration identities       | 164 (3D added 0606–0614, 2C added 0800–0802)                                    |
| `npx tsc --noEmit -p tsconfig.json` | exit 0                                                                          |
| Root unit suite                     | 3402/3402 tests in 291 suites, 0 failed (observed in Group 36 rerun)            |
| `npm run lint` / `format:check`     | clean / clean                                                                   |
| Consolidated acceptance artefact    | `docs/integration/evidence/consolidated/consolidated-run.json` — 0 failing rows |
| Release gate                        | **NOT_READY** — 16 blockers, 4 conditions (unchanged by the merge)              |

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

- Kept **3D's** boot-time schema-completeness block (A2 recovery, BANKING\_\* disabled-by-default block,
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

Executed on the consolidated tree (branch tip at the time of writing):

- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- Root unit suite → **3402/3402 tests in 291 suites** (the run inside the acceptance regeneration;
  both previously failing suites fixed at `b66238be` and verified in isolation, plus
  `consolidated-matrix`, `platform-journeys`, `migration-inventory` green at `25f971fc`).
- `npm run lint` → clean (0 errors). `npm run format:check` → clean.
- Migration inventory and chain assertions (`test/migration-inventory.spec.ts`, head pin, 164 identities,
  0606–0614 and 0800–0802 present, banking chain scoped ≤605) → pass.
- Consolidated acceptance artefact → 0 failing rows; release gate NOT_READY (16 blockers, 4 conditions).
- Real PostgreSQL 18.4 (embedded, loopback-only, disposable) with
  `PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`, unique `PG_TEST_RUN_ID` per suite, network guard loaded:
  - `test/arena5-consolidation-migration-upgrade.integration.spec.ts` (new, Group 3) → **4/4 pass** —
    filesystem union is exactly 152 common + 9 (3D 0606–0614) + 3 (2C 0800–0802) = **164** identities;
    upgrade from a full **3D** chain applies exactly `0800, 0801, 0802` in order, then replay no-ops and
    the applied ledger equals the filesystem identity-for-identity (timestamp+name, unique, head
    `1785753600802 / ExtendBeneficiaryOwnership1785753600802`); upgrade from a full **2C** chain applies
    exactly `0606…0614` in order with the same end-state assertions; fresh install from empty applies
    164 exactly once.
  - `test/migration-chain.integration.spec.ts` → **20/20 pass**, including the extended
    "institution 0400 historical upgrade" sequence that now carries 0606–0614 between 0605 and 0800.
  - `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts` → **8/8 pass** —
    readiness still fails closed (protected authority unavailable; empty/wrong/duplicate/missing
    inventory each rejected) on a fully migrated combined chain.

The two frozen predecessors remain the definition of their own applied chains: the suite splices the
real configured migration lists rather than fabricating a third inventory. Nothing was renumbered.

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

## 5. Groups 4–7 — consolidated-runtime preservation (in progress)

### Group 4 — Nest startup, DI and process roles: verified on the combined tree

The consolidated source carries the ARENA 3D worker-role implementation verbatim in behaviour (the
2C lineage never diverged on it, so there was nothing to resolve in `src/main.ts` /
`src/production/process-role.ts` / `src/production/worker-runtime.ts`):

- `PROCESS_ROLE` resolves `api` | `worker` | `all-in-one`; a typo is refused, never defaulted; unset
  means `all-in-one` (upgrade-preserving); `PROCESS_ROLE=api` refuses to start alongside
  `*_WORKER_ENABLED=true` rather than silently preferring either.
- A `worker` process boots the dependency graph with no HTTP listener and verifies the same
  production readiness gate before claiming any work; graceful shutdown drains once, bounded by a
  deadline; worker leases, fencing and dead-letter ceilings are database-enforced (outbox
  leases/dead-letters; bank dispatch leases with `fence`).

Evidence on the consolidated tree (real disposable PostgreSQL 18.4, guarded as Group 3):

| Suite                                                                  | Result                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `test/environment.spec.ts`                                             | 20/20 pass (with `environment-inventory`)                           |
| `test/worker-execution.spec.ts` (unit, process roles + worker runtime) | 36/36 across the worker unit trio                                   |
| `test/worker-supervision.spec.ts` (unit)                               | included above                                                      |
| `test/agent-cash-to-cash-expiry-worker.spec.ts` (unit)                 | included above                                                      |
| `test/worker-leases.integration.spec.ts` (real PG)                     | 15/15 pass                                                          |
| `test/banking-dispatch-worker.integration.spec.ts` (real PG)           | 10/10 pass                                                          |
| `node scripts/generate-env-inventory.js`                               | keys=157, undocumented=0, zero drift against the committed document |

`test/banking-dispatch-worker.integration.spec.ts` additionally demonstrates, on the merged runtime,
that a CREATED operation dispatches exactly once, that two workers cannot dispatch the same operation,
that an expired lease is recovered without blind resubmission, that intake-disabled still enquires,
that bounded attempts park in MANUAL_REVIEW (never FAILED), and that the commitment bridge creates the
dispatch intent idempotently and refuses non-banking/attribution-less providers.

### Group 5 — P2P directions: preserved (audit, evidence pending)

All four wallet-transfer directions (customer→customer, customer→agent, agent→customer, agent→agent)
run on the shared `WALLET_TRANSFER` engine in `src/transfer/` with the shared ledger, agent operating
wallets and two-leg limit enforcement (source OUTGOING / recipient INCOMING, `transferParticipantLimitInput`
with `principalType` CUSTOMER|AGENT). No second P2P engine, no personal wallet, no parallel ledger was
introduced. Direction coverage evidence is being assembled for Group 38's acceptance matrix; the
existing P2P suites (2C: wallet-agent-self-ownership, p2p-parity journeys) are required to pass
unchanged on the consolidated runtime.

### Group 6 — D1–D8 (Arena 2C handoff) — binding constraints, no approvals invented

The register lives in `docs/integration/MONIENAIJA-AGENT-CUSTOMER-P2P-PARITY-HANDOFF.md`. The
dispositions below restate the constraints this mission must honour; none of them approves, decides or
fabricates anything the register reserves to its owners, and none weakens a boundary.

| D   | Owner / topic                                                  | Constraint carried on the consolidated runtime                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Product, fraud and support — legacy **unbound** recipients     | No reuse of a legacy unbound recipient without the owner's explicit decision; require fresh recipient verification (re-enrolment or rebind) for any new bound quote. Do not fabricate a backfill. Suspension/revocation/phone reassignment does **not** retroactively invalidate an already-issued quote (issue-time binding is the current, documented behaviour); changing that would require a designed, concurrency-tested invalidation path. Completed-transaction replay stays recoverable. |
| D2  | Product and security — quote TTL                               | Quote lifetime is an explicit seconds value within 1–86,400, capped by session expiry, configurable per environment. **300 seconds is dev/test only**; there is no approved staging/production default and none will be invented. Same-owner new-session inspection stays read-only and grants no transaction authorization.                                                                                                                                                                      |
| D3  | Product, institution and risk — bidirectional agent capability | Keep agent-involving transfer directions available on the shared engine with the single highest-precedence limit profile (tie-breaking by effective/creation time), class/directional amounts and attributed, active institutional authority required. No invented thresholds, no conjunctive rule overlay. Agent wallet-transfer capabilities and directional limits stay intact.                                                                                                                |
| D4  | Privacy, security and notifications — uncertain delivery       | No automatic resend of an UNKNOWN attempt; pre-send recheck is the only safety net (a DB lock cannot recall a message already handed to a provider). Governed registry, no real sends in this environment.                                                                                                                                                                                                                                                                                        |
| D5  | Finance/accounting — tariffs, VAT, commissions                 | Never invent tariffs, VAT mode/rate, commission models, beneficiary attribution or payable timing. Fee binding remains governed config (`banking_operation_fee_bindings`, `QuotePaymentType`); show costs before confirmation. No promoting a WARNING to a synthetic PASS.                                                                                                                                                                                                                        |
| D6  | Reliability/financial engineering — recovery                   | Bounded, same-key recovery only; capture sanitized first SQLSTATE/operation on exhaustion; no unbounded retries; safety under race is not an unlimited liveness guarantee or a production load rating.                                                                                                                                                                                                                                                                                            |
| D7  | Mobile QA/release — device evidence                            | **Blocked in this sandbox** (no Android/iOS hardware, emulator, adb or Apple tooling): no signing, no submission, no physical-device acceptance claimed. Automated suites and browser acceptance cover what can be covered headlessly; the gap stays explicit.                                                                                                                                                                                                                                    |
| D8  | Integration, provider and operations owners — real execution   | **Not authorized in this mission:** no provider calls, no transactions, no deployments, no activation, no merges. Preserve 3D's NOT_READY gate, eight financial blockers, operational blockers and conditions; authorized sandbox evidence, real-role runtime and worker observation remain future, separately-authorized work.                                                                                                                                                                   |

### Group 7 — customer self-service bank withdrawal: wired end to end (customer half)

The one outbound bank journey a customer can complete in-app now exists on the combined tree, both
halves bound to real contracts and verified on real PostgreSQL (branch `arena/1f37a4f3-monienaija`,
commits `ca81dcad` backend, `dd1b6314` mobile):

- **Server.** `POST /customers/me/withdrawal-commitments` now returns `operationReference` —
  resolved after the commitment transaction from `banking_outbound_operations` (written by the
  commitment bridge inside that same transaction). It is `null` when no dispatch intent exists (no
  banking provider configured), never a fabricated reference. An ambiguous answer (>1 row for one
  external operation) is refused with `409 ConflictException` rather than guessed; the refusal does
  not duplicate the commitment. The `/customers/me/beneficiaries` projection gained the additive
  `beneficiaryType`, and `bankCode`/`destinationName` populated for `BANK_ACCOUNT` beneficiaries
  only (never for wallet recipients).
- **Mobile.** `BankWithdrawalScreen` (route `BankWithdrawal`, Home tile "To bank"): verified, active
  `BANK_ACCOUNT` beneficiaries only; over-balance guard; 4–12 digit transaction PIN (cleared from
  state on submit); stable form-lifetime idempotency key; RESERVED copy that never claims the bank
  paid; a "Track this transfer" control present only when the server produced an
  `operationReference` (navigates to `TransferStatus`); replayed SETTLED/RELEASED outcomes rendered
  as earlier submissions, not new success; empty state routes to support — the screen cannot add or
  verify a bank account, and never pretends it can. `TransferStatus` screen/service migrated to the
  server's verbatim vocabulary (AUTHORIZED/PROCESSING/CONFIRMING/SUCCESSFUL/REJECTED/REVERSED/
  CANCELLED) with bankCode + last-4 rendering.
- **Evidence.** Real PG: `financial-commitment-initiation` **43/43** (incl. new
  dispatch-reference-replay and ambiguity-refusal tests and the BANK_ACCOUNT projection contract),
  `arena3d-banking-http`, `arena3d-banking-journeys`, `a6-settlement-lifecycle` (23/23 with schema
  suite), `a23-customer-app` and `v1-hardening-01-customer-beneficiary` (56/56 combined). Mobile:
  `tsc` clean, full suite **25/25 suites, 220/220** (bank-withdrawal 9/9, mocked `ApiClient` — the
  server contract it calls is covered by the backend suites above). Backend gates: tsc, eslint
  (0 errors), prettier clean; consolidated acceptance regenerated on `dd1b6314` (artefact commit
  `44dbd715`): tsc/lint/format/unit-suite (**3402/3402, 291 suites**)/ci-gates/mobile-manifests all
  PASS; release gate remains NOT_READY (16 blockers, 4 conditions); UNAVAILABLE rows unchanged.
- **Local test-environment findings (this sandbox, `.env` is git-ignored, untracked).** Suites that
  boot the real `AppModule` require the documented `node scripts/prepare-pg-test-env.js
--create-if-missing` output; without it they fail closed with "Workforce authentication
  disabled" (401 at the workforce guard). The generated `.env` additionally required two local
  fixes to boot at all here: `HTTP_CORS_ORIGINS_JSON=[]` (shipped by `.env.example`) is rejected by
  the CORS allowlist validator ("expected a non-empty JSON array of origins") — unset instead; and
  `KYC_CUSTOMER_VERIFICATION_ENABLED=false` as a raw string is truthy to the unit suite's
  unvalidated `ConfigModule` (`module-di-wiring` fails with "KYC_VERIFICATION_POLICY_JSON is
  required…") — unset instead (validation default is `false`). Both findings are recorded here
  rather than patched into `.env.example`, which is out of this group's scope. Before these were
  fixed, the unit row in the acceptance artefact read FAIL for exactly this reason (now PASS).
- **Not done / not claimed:** the AGENT half of Group 7 (agent-initiated outbound against the
  operating wallet, including own-account policy), agent-facing banking surfaces, and any provider
  execution (D8 remains not authorized). Settlement never becomes automatic.

## 6. Immediate next groups

3. **Group 5–6** — P2P directions preservation on the consolidated runtime (run the 2C P2P parity
   suites: customer/agent directions); D1–D8 constraints carried as recorded above.
4. **Group 7–8** — customer/agent banking journey wiring. The customer half of Group 7 is done and
   verified (see §5, Group 7): customer self-service withdrawal to a verified bank account, wired end
   to end on real contracts. Remaining: the agent half (agent-initiated outbound against the
   operating wallet, including the own-account policy and agent-facing surfaces), agent P2P parity
   re-verification on the combined runtime, and Group 8's shared authority hardening. No
   own-bank-account product; no workforce acting-on-behalf; agent may transfer from the operating
   wallet including to own account.
5. **Group 9–10** — shared external bank-transfer authority extension of the A6 commitment path
   (typed CUSTOMER/AGENT participants, immutable refs, institution attribution, provider destination
   binding, scoped idempotency) + bank directory/name-enquiry via provider capability contracts.
6. **Group 11–19** — beneficiaries for customer+agent; confirmation evidence; financial auth; fees;
   limits; commitment authority extension; provider governance/dispatch/verification reuse; completed/rejected
   financial effects via the commitment/settlement bridge.
7. **Groups 20–33** — funding/defunding/cash journeys re-verified on the combined runtime; reversal and
   unresolved-funds governance; reconciliation discipline; mobile banking surfaces; history/receipts;
   idempotency/recovery; notifications/outbox; admin console; conservation under concurrency (real PG).
8. **Groups 34–40** — adversarial verification; operations/readiness preservation; full regression
   (unit + PG matrix + builds + lint + inventory); acceptance matrix; combined handoff; final record.
