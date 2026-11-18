# Arena 2C → frozen Arena 3D: integration assessment (no merge)

**Recommendation: retain both histories and all migration identities.** The migration classes compose on disposable PostgreSQL. The *applications* have not been integrated, built, tested or released together. Neither branch's test counts transfer to the eventual consolidation commit.

## Objects inspected

| Object | Exact Git commit |
|---|---|
| Common ancestor (`git merge-base`) | `e20b31167f50f251ff84a6cdce662eb63b49b820` |
| 2B recovered | `3db04703bfad39488b5b9e34c88c49f73d81389b` |
| 2C contact/cross-flow checkpoint | `d9635748bc7e391529a6901dba10767e09f77ca4` |
| 2C final application/test source | `fa9ec89e5c5e989ca8ca6f8b15e4d6cd4ab04849` |
| 3D application/test source | `75e17690d0c69ee9c5c5b7ab7369b6c60e52e139` |
| `arena/defdd0fd-monienaija` frozen head | `6816a760bd460df2a5347016d7d84f5c62cab642` |

Read the 3D handoff with `git show 6816a760:docs/integration/ARENA3D-FINAL-HANDOFF.md`. The final 3D tree differs from its application commit only in integration documents/consolidated evidence. The common base already includes the 3D banking/funding work through 0605; do not cherry-pick a second copy. Inspection used Git objects; 3D was not checked out, edited, rebased, merged or pushed.

## Direct overlap (intersection of changed paths relative to the common ancestor)

| Path | What to preserve / what to verify on the integration commit |
|---|---|
| `.env.example`, `src/config/environment.ts` | Keep the 2C validated `WALLET_TRANSFER_QUOTE_TTL_SECONDS` with **no** commercial production default, and 3D's optional recovery objectives, worker/alert/operational configuration and fail-closed behavior. Re-generate and verify 3D's environment inventory from the **combined** schema; no secrets or guessed policy values. |
| `src/agent/agent-cash-to-cash.service.ts` | The 3D diff here wraps one exception for formatting. Keep the 2C non-locking suspense lookup + same-ID transactional revalidation, and propagation of DB errors. Do not replace the file wholesale. Re-run A16 including initiation/claim races and the 3D expiry worker tests. |
| `src/production/production-readiness.service.ts` | 3D exports `FINANCIAL_DEPENDENCY_BLOCKERS` for its release gate and pins 0614. Preserve its export and **all eight** entries. Preserve 2C's exact, nonempty loaded/applied inventory, cardinality, uniqueness and 0802 head. Retain runtime role and protected-authority checks. `verifyStartup()` must refuse both API and worker when dependencies are missing, even with a current schema. |
| `test/migration-inventory.spec.ts` | Keep the 0600–0605 contiguous banking assertion, scope that assertion to its range as 3D does, then assert the nine appended 0606–0614 identities and the three 0800–0802 identities. Pin the **actual latest** to 0802, not an allowlist. Also update the full expected sequence in `migration-chain.integration.spec.ts` (includes earlier names, not just the tail). Retain 2C's A8/A19/A20 and Stage 8/10 exact-head corrections. |
| `test/a3d-agent-float-funding.integration.spec.ts` | Both sides correct double destruction after Nest closes the injected DataSource. Prefer 2C's `destroyIntegrationDataSource` after app close: it can drop the run-owned DB even when `isInitialized` is already false. Preserve 3D's harness isolation and explicit drill-only keep mode; keep mode must be **off** in regression. Verify all 14 bodies **and teardown**. |

These are six paths, not six textual merge conflicts. For reproduction: intersect the sorted outputs of `git diff --name-only e20b311 fa9ec89e` and `git diff --name-only e20b311 6816a760`. Non-overlapping files can still have conflicting contracts. The final A14 Cash-Out and shared KYC eligibility corrections add **no** shared paths or migrations. Re-run same-customer concurrent OTP withdrawals plus session, KYC, limit and worker transitions; true serialization/deadlock errors must reach the bounded transaction owner without pretending the policy is missing.

## Full migration inventory and compatibility

[All 164 timestamp/name pairs and per-branch Git blob IDs](./evidence/p2p-parity/migration-inventory.tsv). Count `.ts` migrations only, not `.gitkeep`. Of 152 common identities, 151 are byte-identical. `1785753600504-InstitutionKycTierLimitGovernance` has 3D formatter changes around the same SQL calls, not a second migration. There is no timestamp reused for different names. Parity has **155**, frozen 3D **161**, their union **164**. `17857536006xx` is not a contiguous global-series requirement: preserve existing gaps/allocations elsewhere.

| Added after common ancestor | Timestamp suffixes (prefix `178575360`) and purpose |
|---|---|
| 3D | `0606` OutboxLeasesAndDeadLetters; `0607` IntegritySnapshots; `0608` EmergencyAccessReviewRequirement; `0609` FraudRiskSignals; `0610` ComplianceRegister; `0611` ComplaintsAndDisputes; `0612` MobileClientSupport; `0613` NotificationDeliveryReceipts; `0614` PrivacyAndRetention. |
| Parity | `0800` BindWalletTransferQuotes: immutable binding of existing quotes and a checked, unique transfer link. `0801` AgentVerifiedPhone: consumed OTP proof and live-contact uniqueness; no inference from allocated numbers. `0802` ExtendBeneficiaryOwnership: exactly one customer/agent owner, typed immutable recipient for new saves; no retrofit of legacy identity. |

**Executed**, not just compared filenames: [a2cmig01](./evidence/p2p-parity/migration-rehearsal.json), PostgreSQL 18.4. `scripts/p2p-migration-rehearsal.cjs` loads the branch migrations, reads the frozen 3D-only classes (and its formatted 0504) from Git into a private scratch directory and uses the real TypeORM migration executor. Three newly created run-scoped DBs, no synthetic applied markers:

| From | Actual migrations applied first | Actual new migrations applied | Result |
|---|---:|---:|---|
| Empty | 0 | 164 | All identities exact; re-run 0 pending. |
| 3D 0614 | 161 | 3 | Same 164; original unbound beneficiary remains unbound. |
| Parity 0802 | 155 | 9 | Missing **lower** 0606–0614 timestamps applied; same 164; no renumbering or retroactive identity change. |

The overall head remains `1785753600802:ExtendBeneficiaryOwnership1785753600802`. A head comparison alone would pass the third case **before** adding nine required migrations. Conversely, 3D's `scripts/migration-workflow.js` uses timestamp sets for its operational status/verify report; that does not prove exact names or duplicates. Retain its advisory apply lock and no-revert workflow, but require the stronger 2C identity check too. Several parity `down()` methods refuse evidence destruction. Do not fake applied rows, rewrite old migrations or suggest running `revert` against financial evidence. This rehearsal was not an application boot, production-role trial, backup/restore drill, timings at volume or certification of an existing deployment.

For a repeat, on a disposable checkout with the repository-generated ignored test `.env` and a **new, explicitly confirmed** `scripts/embedded-pg.js` cluster, run `NODE_ENV=test DB_HOST=127.0.0.1 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=a2cmig02 node scripts/p2p-migration-rehearsal.cjs`. It verifies the server data directory before using the namespaced DB harness. Do not run concurrently with the full PG runner. [Published allocation scan](./evidence/p2p-parity/published-allocation-scan.json): 42 heads, 40 distinct head commits inspected, unchanged on reread; only 2B and 2C carried 0800–0802. [Recheck after the final application freeze](./evidence/p2p-parity/published-allocation-recheck.json) again found 42 stable published heads, 40 distinct commits (39 distinct root trees), the same two publishing branches and the unchanged frozen 3D head. Unpublished or subsequent work is not covered; recheck actual integration candidates immediately beforehand.

## Indirect contracts — required consolidation tests

| Boundary | Assessment and integration gate |
|---|---|
| Worker execution | 3D `src/production/{process-role,worker-runtime}.ts`, `src/main.ts`: `api` suppresses drivers, `worker` has no HTTP listener, `all-in-one` preserves defaults. Keep readiness refusal, role/flag contradiction checks, shutdown deadline and DB leases/fencing. A role does not grant transfer or agent-self authority. Check timers do not process a parity event from both API and worker as competing owners; supervise the existing notification, banking, expiry and KYC drivers. Deployment topology, process-level liveness and observed operation remain open. |
| Outbox and notifications | 2C `transfer-events.ts`/dispatcher require one `transfer.*` v1 customer or `wallet_transfer.*` typed event, exact key, committed row, authoritative participants. 3D `worker-lease.service.ts`, outbox diagnostics/redaction and receipt migration 0613 must not change event keys or scrub the *stored evidence needed to reconcile*. Use the existing subscriber, delivery/attempt leases and UNKNOWN handling. Exercise lost lease, disabled event, changed contact, duplicate dispatch/receipt, dead letter and replay. 3D `notification-receipt.service.ts` records later provider facts separately; a SENT attempt is not a delivered receipt, a recorded receipt is not ledger authority. Do not assume all its suppression data is wired into every egress path. No actual callback or external delivery observed by 2C. |
| Reconciliation, privacy and audit | `src/reconciliation/transfer-{reconciliation.service,commercial-reconciliation}.ts` verifies posted facts read-only. 3D `integrity-monitoring.service.ts` persists its **own** snapshots/drift of reports, not balancing entries. Preserve WARNING/ERROR, related principal/commercial journal IDs and immutability; don't assume the global snapshot already incorporates every transfer discrepancy. Verify combined reporting explicitly. 3D erasure covers specific customer fields and retains finance; `BENEFICIARY_DETAILS` is not an implemented anonymizer. Decide agent verified-contact, proof and typed-beneficiary retention with privacy/compliance; no cascade delete of quotes, postings or consent history. |
| Financial authority | `TransferService` posts with the two wallets and their existing ledger accounts. `financial-context-resolver`, class/KYC/limits, session and PIN remain necessary at execution. 3D's bank funding/verified inbound, dispatch and banking reconciliation are separate obligations, not a second operating balance or a fallback when pricing, attribution or funding evidence is missing. Test isolation of beneficiary/agent/customer/workforce principals, same-institution accounts, fee/netting/payable legs, reversal restrictions, holds and funded/overcommitted races on the combined source. No provider or payment rail activation. |
| Runtime/CI | 3D changes the root scripts, test DB harness, role boot, CI, Vite/nginx, agent mobile endpoint config, build/manifest gates and env inventory. Keep both strict PG safety gates, the parity runner's per-process/record semantics and 3D's **separate** socket-only isolated runner. Frozen 3D contains 180 `*.integration.spec.ts` paths (Group 30 documented 179 at its checkpoint) and 11 `*.isolated-pg.test.ts`; parity has 168 normal PG suites. Re-discover on the combined source; neither number nor the 11 CI declarations imply a combined pass. Re-run TypeScript/build, lint, unit, both PG lanes, migrations from each head, role/lease/notification/recon journeys, customer/agent RN, admin and readiness/release gates. Recompute evidence instead of copying a green report. |

## Release posture

3D reports 282 unit suites/3,343 tests, 10/10 journeys (263 assertions) and 27 Chromium checks, **on 3D**, not on parity. Its release gate was `NOT_READY`, exit 1: eight unverified financial dependencies and eight unobserved/unverified capabilities, plus four conditions. These include trusted KYC/consent/keys, governance/routing/ownership/tier policies and financial authorization; also deployment/worker execution, real alert delivery, container, DR, provider, mobile release and broader browser/accessibility evidence. Do not edit its blocker list to green. **Conditional engineering compatibility; integration and production release blocked** until the actual combined source is authorized, integrated and independently verified. No branch merge, staging/production activation, provider call or financial operation is authorized by this assessment.
