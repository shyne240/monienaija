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

### Checkpoint C1 — customer bank-withdrawal vertical slice (mission scope G9–G15; intermediate, not group sign-off)

> **Numbering note.** This slice was integrated ahead of the formal group order. In the original
> 40-group mission it belongs to G9 (shared external bank-transfer architecture), G10 (bank directory
> and account resolution) and G11–G15 (beneficiaries, confirmation, fees, financial authorization).
> It is therefore recorded as a checkpoint, not as "Group 7". Group 7 in the original mission is
> **customer banking contract inventory** and Group 8 is **agent banking contract inventory** — both
> are now produced as standalone artefacts (see §5 Group 7/Group 8 entries below). The
> implementation is preserved and extended there; its evidence remains intermediate, not acceptance.

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
- **Local test-environment findings — exact rejected values vs their working replacements (this
  sandbox; `.env` is git-ignored and was never committed).** Suites that boot the real `AppModule`
  require the documented `node scripts/prepare-pg-test-env.js --create-if-missing` output; without
  it they fail closed with "Workforce authentication disabled" (401 at the workforce guard). The
  generated `.env` additionally required two local fixes to boot at all:

  | Variable                            | Rejected value (as shipped)           | Observed failure                                                                                                                                                                                    | Working replacement                                                                                          |
  | ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `HTTP_CORS_ORIGINS_JSON`            | `[]` (from `.env.example`)            | `Invalid environment configuration: HTTP_CORS_ORIGINS_JSON: expected a non-empty JSON array of origins` at every `AppModule` boot                                                                   | unset (empty cross-origin allowlist is the documented safe default; the validator accepts unset, never `[]`) |
  | `KYC_CUSTOMER_VERIFICATION_ENABLED` | `false` (string, from `.env.example`) | was: unit-suite `module-di-wiring` failed with `KYC_VERIFICATION_POLICY_JSON is required when customer KYC is enabled`; the config layer now normalises raw booleans safely (see triage note below) | unset (validation default is `false`) or leave as-is (safe either way after the hardening)                   |

  `.env.example` was deliberately NOT edited in this mission; changing the committed example (and the
  `docs/integration/ENVIRONMENT-CONFIGURATION-INVENTORY.md` counts it feeds) is an owner decision.

  **Raw-string boolean investigation (requested): is this a production configuration defect?**
  No. The validated configuration path rejects malformed booleans at startup:
  `src/config/environment.ts` parses `KYC_CUSTOMER_VERIFICATION_ENABLED` (and every other flag) with
  `z.enum(['true','false']).transform(v => v === 'true')` under `validateEnvironment`, which is
  wired into boot twice (`AppModule` `ConfigModule.forRoot({ validate })` and `main.ts`
  `validateEnvironment(process.env)` before any listener is bound). In that path `'false'` is
  `false`, and any other non-listed string is a startup error, never silently truthy. The failure
  reproduced only in `test/module-di-wiring.spec.ts`'s _own_ test `ConfigModule`, which is
  deliberately unvalidated, so `config.get(...)` there returns raw strings and the KYC tier-module
  factory (typed `ConfigService<Environment, true>`) saw `'false'` as truthy. Raw `process.env`
  reads elsewhere in `src/` were reviewed and do none of this: the rate-limit JSON reader validates
  strictly and throws; `PROCESS_ROLE` refuses typoes by name; `KYC_OWNERSHIP_KEY_BASE64/VERSION` are
  shape-checked and fail closed; `LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES` and the pino/build
  informationals parse with explicit fallbacks. **Conclusion: the hazard was confined to the
  unit-test harness — there is no production path that treated a raw boolean string as truthy.** A
  follow-up hardening landed anyway, because a `ConfigService<Environment, true>` cast relying on
  "the caller validated it" is only as strong as the caller: `customerKycConfigurationFromEnvironment`
  now normalises the flag itself — unvalidated `'false'`/`'0'`/`'no'` are disabled, unvalidated
  `'true'`/`'1'`/`'yes'` are enabled, and any other non-boolean value throws
  (`KYC_CUSTOMER_VERIFICATION_ENABLED must be a validated boolean`). It never _enables_ anything that
  validation did not already enable; it can only refuse to treat a string as an inversion of a
  security gate, and the production path (validated `boolean`) is byte-for-byte unchanged. Regression
  coverage added in `test/kyc-customer-verification.config.spec.ts`. Environment validation was NOT
  weakened; `.env.example` was NOT edited (both remain the owner's decision). The durable rule for
  future providers is unchanged: read configuration only through the validated `Environment`, and
  treat the P0-A harness's unvalidated `ConfigModule` as untrusted input.

- **Not done / not claimed:** the AGENT half of Group 7 (agent-initiated outbound against the
  operating wallet, including own-account policy), agent-facing banking surfaces, and any provider
  execution (D8 remains not authorized). Settlement never becomes automatic.

## 5a. Group 7 — customer banking contract inventory (original numbering restored)

Produced at `docs/integration/ARENA5-GROUP7-CUSTOMER-BANKING-CONTRACT-INVENTORY.md`. Summary of
verified truth at `6a47a6d5`:

- IMPLEMENTED: virtual-account view/provision (`customers/me/banking/virtual-account`), deposit
  history, outbound commitment (`POST /customers/me/withdrawal-commitments`, `operationReference` on
  response), transfer tracking (`GET /customers/me/banking/transfers/:operationReference`),
  wallet-recipient beneficiaries CRUD, transaction PIN, settlement lifecycle internals, commercial
  accounting/reconciliation internals.
- PARTIAL/MISSING: customer-facing bank directory, account-name enquiry, self-service BANK_ACCOUNT
  beneficiary creation (backend `createBeneficiary` exists, no HTTP self-service route),
  server-authoritative principal/fee/VAT/total-debit confirmation for the bank flow, durable
  interrupted-submission recovery for the bank flow (client-side form-lifetime key only), unified
  bank-transfer history/receipt, customer notifications for outbound bank outcomes.
- Binding decision honored: no own-account restriction anywhere; workforce-only `/api/v1/banks`
  remains workforce-only; no fabricated provider references; RESERVED never rendered as settled.

## 5b. Group 8 — agent banking contract inventory (original numbering restored)

Produced at `docs/integration/ARENA5-GROUP8-AGENT-BANKING-CONTRACT-INVENTORY.md`. Summary of
verified truth at `6a47a6d5`:

- IMPLEMENTED: funding account view/provision/deposit history (`agents/me/banking/funding-account*`),
  wallet-recipient beneficiaries, agent transaction PIN + A11 authorization + A10 class-of-service
  capability evaluation, `AgentFinancialExecutionService` operating-wallet execution boundary, agent
  pending-operation SecureStorage pattern.
- MISSING: agent-initiated outbound bank transfer end-to-end (no service vocabulary code, no
  commitment binding, no beneficiary self-service for BANK_ACCOUNT, no confirmation surface, no
  mobile experience), agent-facing bank directory and account-name enquiry, bank-transfer
  tracking/history/receipt, outcome notifications.
- Hard constraint carried forward: agent uses the operating wallet only; no separate personal wallet;
  no second financial engine; not a workforce treasury action; not restricted to own account.

## 5c. Raw-boolean triage verdict (Group 6 deliverable, completed 2026-11-19)

The `KYC_CUSTOMER_VERIFICATION_ENABLED` raw-string finding is **test-harness-local, not a production
defect**: the validated boot path (`validateEnvironment` in `AppModule` and `main.ts`) parses the
flag with `z.enum(['true','false']).transform(v => v === 'true')`, so `'false'` cannot be truthy in
production and any other value fails at startup. The unvalidated unit-test `ConfigModule` was the
only path that inverted the gate. A config-layer hardening now normalises raw booleans at the
consumption site as well (`false/0/no → disabled`, `true/1/yes → enabled`, anything else throws),
with regression coverage in `test/kyc-customer-verification.config.spec.ts` (unit suite 3403/3403).
Environment validation was not weakened and `.env.example` was not edited.

## 6. Groups 9–10 — shared external bank-transfer authority + bank directory (in progress)

### Group 9 — shared authority (customer + agent, one engine)

Completed at `1785753600803:GeneralizeFinancialAuthorizationsForAgents`. The A6 commitment/authorization
architecture was extended from customer-only to typed CUSTOMER/AGENT without a second financial engine:

- `financial_authorizations` now carries `agent_id` (nullable FK→agents, RESTRICT), `customer_id` nullable,
  `principal_type IN ('CUSTOMER','AGENT')`, and `chk_financial_authorizations_owner` binding type↔principal_id↔owner column.
  The `session_id` FK was dropped because one column cannot reference two session tables; the validation trigger
  is the sole authority for session validity in both lanes (as it already was for customers).
- `validate_financial_authorization()` was replaced with a dual-lane function: the CUSTOMER branch is byte-for-byte
  the prior predicate; the AGENT branch requires ACTIVE undeleted agent, ACTIVE agent-api session + ACTIVE credential
  (no lock, no rotation, live password, issued_at ≥ password_changed_at), an unlocked agent_transaction_pins row
  and a matching `AGENT_TRANSACTION_PIN/PIN_VERIFIED` audit binding requestHash+sessionId+pinVersion, plus an
  AGENT wallet via `wallet_owner_class()`.
- `validate_financial_commitment()` now matches `o.customer_id = a.principal_id::uuid` so both lanes bind the same
  provider operation column; all reservation/settlement/release evidence rules are unchanged.
- `validate_financial_commitment_destination()` was updated to accept both customer-owned and agent-owned
  BANK_ACCOUNT beneficiaries, with the target-reference hash now using `COALESCE(b.customer_id,b.agent_id)`.
- `FinancialCommitmentService` now exposes `initiate()` (customer) and `initiateForAgent()` (agent) sharing one
  `ParticipantPlan` and one transactional `initiateWithin()`: source-wallet ownership, beneficiary ownership,
  institution/provider routing, limits, PIN, idempotency, reservation, fee binding and immutable destination are
  all shared; only the session/credential/PIN lane differs. The agent lane resolves the source wallet from the
  authenticated agent's authority (exactly one ACTIVE NGN operating wallet when not explicitly located) and
  re-validates the agent lane inside the SERIALIZABLE transaction.
- `WalletFinancialBoundaryService.requireAgentWallet()` and `BankingWithdrawalExecutionAuthority` participant-kind
  branching were added so the agent operating wallet is the only wallet the agent lane can debit.

Evidence: `test/migration-inventory.spec.ts` 10/10 (165 identities, head 0803), `test/migration-chain.integration.spec.ts`
20/20, `test/arena5-consolidation-migration-upgrade.integration.spec.ts` 4/4 (3D→0800-0803, 2C→0606-0614, fresh 165),
`test/financial-commitment-initiation.integration.spec.ts` 43/43 including customer-lane destination-change guard,
all run on disposable PostgreSQL via `PG_TEST_RUN_ID`. `npx tsc --noEmit` exit 0.

Route `POST /agents/me/banking/bank-transfers` (`AgentBankTransferCommitmentController`) is the agent-self counterpart
to `POST /customers/me/withdrawal-commitments`; it takes the agent id+session from the authenticated principal,
never from the body, and the optional `walletAccountId` is only a locator for the agent's own operating wallet.

### Group 10 — bank directory and account-name enquiry (G10)

The authoritative directory is the stored `banks` table; the provider directory is operational observability,
not a customer source of truth. G10 exposes the stored directory to self-service and gates name enquiry on the
provider's `enquireAccountName` capability:

- `GET /customers/me/banking/banks?search=` and `GET /agents/me/banking/banks?search=` — ACTIVE+NIP_SUPPORTED
  subset from `BankingDirectoryService`, ordered by bank_name.
- `POST /customers/me/banking/account-enquiry {bankCode,accountNumber,walletId?}` and
  `POST /agents/me/banking/account-enquiry` — validates format, checks bank exists and is ACTIVE+NIP_SUPPORTED,
  resolves the caller institution from their wallet, then delegates to a usable provider's
  `enquireAccountName`. The result is `RESOLVED` (with `accountName`), `NOT_FOUND`, or `UNAVAILABLE`;
  `establishesAccountOwnership` is always false. No provider configured → UNAVAILABLE, never a guess.
- `POST /customers/me/banking/beneficiaries/bank-accounts {bankCode,accountNumber,nickname?,walletId?}` and
  `POST /agents/me/banking/beneficiaries/bank-accounts` — creates a verified ACTIVE BANK_ACCOUNT beneficiary
  only after the enquiry above returns RESOLVED; otherwise refuses (NOT_FOUND/UNAVAILABLE). Duplicate
  destinations are rejected; the binding is immutable per `guard_beneficiary_owner_binding`.
- Mobile durable recovery: `apps/customer-mobile/src/services/pending-bank-withdrawal.ts` and
  `apps/agent-mobile/src/services/pending-bank-withdrawal.ts` persist the idempotency key via
  `SecureStorage` so process termination/lost responses never cause a fresh key for the same attempt;
  `BankDirectoryApi` clients added for both mobiles.

Remaining for the banking journey: server-authoritative principal/fee/VAT/total-debit confirmation surface,
idempotency-key survival assertion in PG, unified history/receipt with operationReference, settlement/rejection
commercial effects already internal but need customer/agent visible confirmation, and full mobile screens
(bank selection → enquiry → beneficiary create → confirmation → PIN → tracking).

## 6a. Groups 11–15 — confirmation, settlement, and owner authority (current pass)

**Group 11 — beneficiary surfacing** verified: `customer_beneficiaries` + `beneficiary_ownerships` with
`guard_beneficiary_owner_binding` immutable; both mobiles list via `BankWithdrawalApi.listBankBeneficiaries`
filtering `BANK_ACCOUNT+verified+active`.

**Group 12 — server-authoritative pricing** completed: `GET customers/me/banking/bank-transfer-preview` and
`GET agents/me/banking/bank-transfer-preview` via `BankingTransferPricingController` + `BankingFeeBindingService`
immutable `FeeBinding` snapshot (`pricingSource APPROVED_RULE|NO_FEE_RULE|AMBIGUOUS`). Mobile preview cards
wired in both `BankWithdrawalScreen` components (principal/fee/VAT/totalDebit, pricingSource).

**Group 13 — mobile journey wiring** completed: customer `BankWithdrawalScreen` now includes inline
`BankTransferAddBeneficiarySheet` (directory→enquiry→save) + pricing preview; agent `BankWithdrawalScreen`
created with same stages plus capability-gated Home entry (`nav-bank-withdrawal` visible only when
`EXTERNAL_BANK_TRANSFER` allowed). Both use `getCustomerId`/`SecureStorage` durable intent + `Track`
via `TransferStatus` by `operationReference`.

**Groups 14–15 — commercial settlement** covered by `test/bank-transfer-commercial-settlement.integration.spec.ts`:
reservation journal, settlement→destination, rejection→RELEASED, duplicate provider ref idempotency,
concurrent spending, stale beneficiary rejection. Both lanes tested.

**Group 16 — migration 0804 owner authority** covered by `test/migration-0804-owner-authority.integration.spec.ts`:
orphan owner trigger rejection, customer/agent beneficiary ownership validation, unbound financial authorization
rejection, wallet_accounts owner_class generalization, historical preservation, head pin.

**Group 17 — funding/defunding conservation** covered by `test/funding-defunding-conservation.integration.spec.ts`:
customer+agent funding journal balance, concurrent idempotent funding, governed defunding inbox/execute boundary.
Agent `BankDirectoryApi` + `AgentBankWithdrawalApi` + `pending_agent_bank_withdrawal_intent` added.

Evidence in this pass: `npx tsc --noEmit` 0. New PG suites introduced (disposable cluster):
`banking-mobile-journeys` (customer directory/enquiry/initiate/preview/transfer-status + agent
directory/bank-transfers/preview + PIN/idempotency), `bank-transfer-commercial-settlement` (6),
`migration-0804-owner-authority` (6), `funding-defunding-conservation` (4). Remaining: Groups 20–33
full reconciliation/notifications/admin operational slices, Groups 34–40 adversarial + full regression +
acceptance matrix + consolidated handoff. No deployment, real provider, real funds, or production
activation; release gate still NOT_READY.

## 6b. Enforcement hardening — ExternalOperationLifecycleService (checkpoint 2a57be1f → current)

`ExternalOperationLifecycleService.transitionWithinTransaction` SUBMITTING path now enforces wallet ownership via `wallet_accounts.owner_class` → `requireAgentWallet` vs `requireCustomerWallet` plus `requireWithdrawalOperation`, identical to the financial-commitment gate. The previous fix that conditionally skipped the `manager.query` when the manager was a mock weakened prod enforcement. Reverted to unconditional `manager.query` and fixed the test double `FakeManager` to implement `query() → [{owner_class:'CUSTOMER'}]` and `testWalletFinancialBoundary` to expose `requireAgentWallet`. Verification: `external-operation-lifecycle.service.spec.ts` 8/8, unit suite `3403/3403` (291 suites), financial controls preserved fail-closed on real PG.

`production-readiness.service.ts` head pinned to `1785753600804:GeneralizeExternalOperationsForAgents1785753600804` (was 0803) — the applied-migration ledger check previously reported `schema_incompatible` on a freshly migrated 166-identity chain; `production-readiness.spec.ts` now 13/13.

## 7. Consolidated status of the original 40 groups (honest, evidence-backed)

The original 40-group mission was defined in the Arena/Arena 3D handoffs. The mapping below preserves that numbering. Where predecessor acceptance existed, it is cited and not re-claimed as consolidated acceptance unless re-executed on the merged tree.

| Group | Mission requirement | Verdict on `arena/1f37a4f3-monienaija` tip | Evidence |
|---|---|---|---|
| 1 | Repo consolidation (unrelated histories) | **PASS** | merge commit `298efaef`, §1–2 above, migration union 166 |
| 2 | Environment & config inventory | **PASS** | 157 keys, 0 undocumented, `environment.spec.ts` 20/20 |
| 3 | Migration inventory & upgrade rehearsals (both predecessors) | **PASS** | `migration-inventory` 10/10, `migration-chain` 20/20, `arena5-consolidation-migration-upgrade` 4/4 on disposable PG; head `1785753600804` |
| 4 | Nest startup, DI, process roles (api/worker/all-in-one) | **PASS** | `worker-execution` 36/36, `worker-leases` 15/15, `banking-dispatch-worker` 10/10 on PG |
| 5 | P2P preservation (4 directions, single engine) | **PASS** | `transfer` suites, `wallet-agent-self-ownership` on PG; no second engine |
| 6 | D1–D8 binding constraints | **HONORED** | register cited, no approvals invented; `NOT_READY` preserved |
| 7 | Customer banking contract inventory | **DELIVERED** | `ARENA5-GROUP7-*.md`, §5a |
| 8 | Agent banking contract inventory | **DELIVERED** | `ARENA5-GROUP8-*.md`, §5b |
| 9 | Shared external bank-transfer authority (customer+agent, one engine) | **PASS** | migration 0803, `financial-authorizations` dual lane, `agent-bank-transfer-commitment` 11/11 on PG |
| 10 | Bank directory + account-name enquiry + beneficiary creation (both lanes) | **PASS** | customer/agent `BankingDirectoryService` ACTIVE+NIP_SUPPORTED, `BankingAccountEnquiryService` (RESOLVED/NOT_FOUND/UNAVAILABLE, `establishesAccountOwnership:false`), beneficiary `BANK_ACCOUNT ACTIVE verified` gate, mobile `BankDirectoryApi` both lanes |
| 11 | Bank-account beneficiary management | **PASS** | beneficiary ownership immutable, mobile `BankWithdrawalApi.listBankBeneficiaries` filter, `customer_beneficiary` suites |
| 12 | Server-authoritative pricing (principal/fee/VAT/total) | **PASS** | `GET .../bank-transfer-preview` via `FeeEngine` → `FeeBinding` snapshot, mobile preview cards, `financial-commitment-initiation` fee checks |
| 13 | Mobile journey wiring (selection→enquiry→beneficiary→amount→preview→confirm→PIN→submit→tracking) | **PASS (mocked native)** | customer `BankWithdrawalScreen.tsx` + `BankTransferAddBeneficiarySheet` (447 lines → extended), agent `BankWithdrawalScreen.tsx` new, `AppNavigator` wired, `pending-bank-withdrawal` durable intents, `banking-mobile-journeys` 10/10 PG (directory/enquiry/initiate/preview/status both lanes + PIN/idempotency) |
| 14 | Settlement bridge (commitment→dispatch intent) | **PASS** | `banking-outbound.service` deterministic `operation_reference`, UNKNOWN handling, `financial-commitment-initiation` 43/43 |
| 15 | Commercial settlement (reservation/settlement/rejection, both lanes) | **PASS** | `bank-transfer-commercial-settlement` 6/6 (reservation, settlement→destination, rejection→RELEASED via `releaseReservedWithdrawal`, duplicate ref, concurrent, stale beneficiary) |
| 16 | Migration 0804 owner authority | **PASS** | `DROP fk_external_operations_customer` + `validate_external_operation_owner()` trigger, `migration-0804-owner-authority` 6/6 |
| 17 | Funding/defunding conservation | **PASS** | `funding-defunding-conservation` 4/4 (customer+agent journal balance, concurrent idempotency, governed defunding boundary) |
| 18 | Limits & capability (customer+agent) | **PASS** | `limit-enforcement` `strictConfiguredRules:true` fail-closed, capability-gated `HomeScreen` nav, `agent-bank-transfer-commitment` capability+missing-limit cases |
| 19 | Provider governance/dispatch/verification reuse | **PASS** | `BankingProviderRegistry`, `BANKING_RUNTIME`/`READINESS`/`OUTBOUND`, `banking-dispatch-worker` 10/10, verifier abstraction |
| 20 | Unified history: external ops into customer transaction history | **PASS** | `customer-transaction-history` now projects `financial_commitments` (RESERVED→PENDING, SETTLED→COMPLETED, RELEASED→REVERSED) as EXTERNAL_BANK_TRANSFER with masked last4, operationReference, bankCode; `financial_commitments`+`financial_authorizations` CUSTOMER join, counted in pagination |
| 21 | Unified history: agent transaction history | **PASS** | `agent-transaction-history` parity via `fa.agent_id` principal_type AGENT, same status mapping and masking; counted |
| 22 | Receipts (owner-scoped, masked, status-accurate) | **PASS** | Customer `GET /customers/me/banking/transfers/:opRef` + Agent `GET /agents/me/banking/transfers/:opRef` both owner-scoped (wallet owner_class check), masked `accountNumberLast4`, state `CONFIRMING` never failure; unified history carries `external_operation_id` linkage |
| 23 | Interrupted-operation recovery (pending/unknown surfaced, replay safe) | **PASS (server), PARTIAL (mobile E2E external)** | Server `operationReference` null vs trackable, `replayed`, `pending-bank-withdrawal` 24h TTL durable intent; headless PG verified; physical-device restart gap per D7 is genuine external blocker |
| 24 | Notifications (outbox→worker→governance→receipt) | **PASS** | `external_bank_transfer.pending` (commitment) + `.settled` + `.reversed` (release) outbox events emitted with owner-resolved payload; `notification-event-map` intents for CUSTOMER/AGENT, catalogue + FINANCIAL + email parity; `notification-defaults-v2` bodies; dispatched via existing outbox/worker/governance |
| 25 | Admin: provider governance & capability visibility | **PASS** | `GET /internal/banking/providers?institutionId` + `GET /internal/banking/capabilities` + `governance/:id` (proposal/approve) + readiness per-institution; workforce `banking.provider.view` gate — already existed, now documented as PASS |
| 26 | Admin: customer & agent banking activity / external operation tracking | **PASS** | `GET /internal/customers/:id/transactions` + `GET /internal/agents/:id/transactions` reuse same unified history services as SELF, now include EXTERNAL_BANK_TRANSFER (masked, paginated) |
| 27 | Admin: reservations & settlement / reconciliation runs & exceptions | **PASS** | `GET /internal/banking/reconciliation/:id/runs` + `/exceptions` + `institution/:id/unresolved-funds` + POST `reconciliation/run`/`resolve`; institution-scoped, capability-gated, no force-settlement — already existed |
| 28 | Admin: unknown & unresolved outcomes | **PASS** | `UNKNOWN→CONFIRMING` + `MANUAL_REVIEW` fencing + `unresolved-funds` & exception queues expose unresolved; read-only, no invented resolution — already existed |
| 29 | Admin: governed funding/defunding + support investigations | **INFRA PRESENT** | `a3d-agent-float-funding` 14/14 on ledger; funding/defunding inbox/execute governed by `FINANCE_CONTROLLER` + maker-checker; support ticket surfaces exist. |
| 30 | Admin: approval workflows & audit history | **PASS (generic)** | `audit_*`, `protected-authority`, limit/capability approvals audited; banking-specific approval workflow inherits it. |
| 31 | Operational: worker execution/supervision, leases/fencing, retry/dead-letter | **PASS** | `worker-*` 36/36 unit + `worker-leases` 15/15 PG + `banking-dispatch-worker` 10/10 PG; outbox leases/dead-letters DB-enforced. |
| 32 | Operational: integrity monitoring, diagnostics, alerting | **INFRA PRESENT** | Integrity snapshots, `operations-centre`, alerting docs exist; banking-specific integrity checks not yet added. |
| 33 | Operational: production readiness gates & runtime role separation | **PASS** | `production-readiness` 13/13 (head 0804), `PROCESS_ROLE` api/worker/all-in-one verified. |
| 34 | Adversarial: participant/param substitution | **PARTIAL (bank lane)** | `agent-bank-transfer-commitment` covers foreign beneficiary, wallet substitution via idempotency `409`, stale session, missing capability/limit. Broader substitution matrix not yet exhaustive. |
| 35 | Adversarial: session/principal/institution/operation substitution & DB bypass | **PARTIAL** | `agent-bank-transfer-commitment` expired session (401), DB bypass `a.principal_id::uuid` owner check, customer→agent endpoint 401/403. Full matrix not yet. |
| 36 | Mixed-transaction concurrency & conservation | **PARTIAL (bank lane)** | `bank-transfer-commercial-settlement` concurrent bank commitments + `funding-defunding-conservation` concurrent funding idempotency + `agent-bank-transfer-commitment` concurrent spending. Full mixed wallet+bank adversarial matrix not yet. |
| 37 | Reversal & compensation disposition | **INFRA PRESENT** | `releaseReservedWithdrawal` (rejection→RELEASED) verified; governed ledger reversal vs provider refund distinction preserved per `EXTERNAL_BANK_TRANSFER` policy (no invented refund contracts). Inbound return not applicable to outbound. |
| 38 | Mobile regression (customer) | **PASS (mocked native)** | `apps/customer-mobile` unit suite 25/25 (bank-withdrawal 9/9 with mocked ApiClient); server contract covered by PG suites. Physical-device acceptance blocked per D7. |
| 39 | Mobile regression (agent) & admin-web | **PARTIAL** | Agent `BankWithdrawal` new screen + nav wired; agent-mobile unit suite not yet independently green in this branch's CI matrix; admin-web Chromium acceptance not re-run in this pass. |
| 40 | Consolidated acceptance programme & handoff | **IN PROGRESS** | This record + `MONIENAIJA-V1-CONSOLIDATED-TRANSACTION-AND-APPLICATION-HANDOFF.md` (next commit). Full PG discovery matrix (all `*.integration.spec.ts`) not yet executed in a single guarded `PG_TEST_RUN_ID` run in this pass — unit + 4 new PG suites verified; remaining PG matrix pending final runner pass. |

### Immediate next actions (post 20-24,25-28 completion)

1. Execute the full guarded PG matrix (`npm run test:pg` bounded) + `customer-mobile`/`agent-mobile`/`admin-web` suites + boot/HTTP + Chromium admin as a single frozen-candidate run, then publish the consolidated handoff with exact commit matrix (see §40) — remaining PASS evidence for 29,31-33 already present, 34-36 bank-lane partial requires owned mixed-matrix design, 37 infra present, 38-39 mobile mocked/native gap per D7 is genuine external blocker.
2. Harden 32 integrity monitoring: add banking-specific `operations-centre` integrity check for `financial_commitments` vs `banking_outbound_operations` cardinality (implementable, low risk) — deferred only if audit defines check sum.
3. Adversarial full-matrix (34-36) remains PARTIAL (bank lane) — exhaustive mixed wallet+bank substitution requires additional owned attack design; current coverage (foreign beneficiary, 409 idempotency, expired session, DB bypass, concurrent conservation) is the executable acceptance for bank lane.
4. No new provider, real funds, notification sends, predecessor mutation, or main-branch merge; production remains NOT_READY by gate 0804 (16 blockers + 4 conditions) until formal audit + credential provisioning.

No deployment, provider calls, real funds, notification sends, predecessor mutation, or main-branch merge.
