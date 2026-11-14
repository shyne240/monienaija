# Arena 2 — Financial Operations Consolidation (integration status)

Branch `arena/8e59e188-monienaija`. Arena 2 frozen source: `arena/ea070127-monienaija`
(never modified, never blindly merged: the whole application range was cherry-picked commit by
commit onto the accepted baseline, resolving every conflict deliberately).

## 1. Integrated commits

| Range              | Content                                                                                                                                                                                                                                                                                      | Result                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `9466cc2..0472687` | 31 Arena 2 commits: persisted cash-out intents, transaction-bound OTP, durable attempt budgets, atomic execution, immutable evidence, supersession/cancellation, lost-response + receipt recovery, reconciliation handoffs, cash-to-cash operation handoffs, agent-mobile recovery contracts | Applied; conflict only in `production-readiness.service.ts` |
| `c492c4b`          | Arena 2 Cash-Out checkpoint                                                                                                                                                                                                                                                                  | 12th applied commit                                         |
| `0472687`          | Arena 2 final application checkpoint                                                                                                                                                                                                                                                         | 31st applied commit                                         |
| `2b4da607`         | Arena 2 documentation checkpoint                                                                                                                                                                                                                                                             | Reference only                                              |

## 2. Institutional seams replaced (this branch's work)

- `CashOutInstitutionResolver` → `requireCashOutInstitutionScope()`: `503` unless the authoritative
  resolver answers `RESOLVED` **for this agent** with a UUID institution. Resolver failures are
  `503`, never a generic `500`; the underlying reason is preserved in the message.
- `AgentCashOutService`: institution scope is resolved _inside_ the financial transaction before any
  receipt/intent query; receipt and intent predicates now bind the resolved institution
  (`institution_scope = $n`) instead of the retired `MONIENAIJA` sentinel.
- `CashToCashFundingAuthority` (was a placeholder that threw `503` unconditionally) is now a real
  authority: it resolves the funding agent's affiliation, the funding wallet's institutional
  attribution and the ledger account scope through `FINANCIAL_CONTEXT_RESOLVER` **inside the
  caller's transaction under SHARE locks**, and derives all four evidence fingerprints from those
  persisted records. `RESOLVED` is the only permissive outcome (`409` incompatible, `503`
  unavailable); no default institution, no aggregator inference, no platform fallback.
- `CashToCashRecoveryService`: an unresolvable authority is `503` (institutional recovery
  unavailable) instead of escaping as `500`.
- `CashToCashWorkforceScope` / `CashToCashClaimFinancialContext`: fail-closed delegation; a caller
  never supplies its own institution, and `hasPlatformAuthority` never grants access implicitly.

## 3. Migrations

`1785753600503-CashOutInstitutionalScope` (new, forward-only): drops the `MONIENAIJA`-bearing checks
on `cash_out_intents`, adds a UUID-regex `cash_out_intents_institution_scope_check`, no FK into
`financial_institutions`, sentinel rows are unreachable but never rewritten. Readiness head is
`1785753600503`. Nothing was renumbered and no history was fabricated; a database migrated only to
`0205` correctly reports `compatible: false` and lists the missing institutional/protected-authority
migrations.

## 4. Acceptance results (this checkpoint)

See `docs/integration/arena2-consolidation-evidence/GROUP-H-stage3-funding-authority.txt`.

| Group                                 | Result                                    |
| ------------------------------------- | ----------------------------------------- |
| TypeScript (root)                     | 0 errors                                  |
| Backend units                         | 247/247 suites, 2,899/2,899 tests, exit 0 |
| Isolated KYC (real PG)                | 9/9 suites, 107/107 tests, exit 0         |
| Institutional PG regression           | 7/7 suites, 108/108 tests, exit 0         |
| agent-mobile                          | 20/20 suites, 310/310 tests, tsc 0        |
| Scoped lint/Prettier on touched files | 0                                         |

## 5. Outstanding — NOT VERIFIED

1. **Legacy cash-out/cash-to-cash PG suites still rely on pre-intent harnesses.** `a14` (40 direct
   `execute` calls with an intent-less MFA challenge), plus `a16`, `a17`,
   `v1-commission-runtime-wiring`, `v1-commercial-accounting-01`, `v1-limit-05-flow-matrix` and
   `v1-commercial-scenario-matrix-01` were already red on the frozen Arena 2 tip: commit `1b95ba5`
   introduced `cash_out_intents` and a mandatory agent-session check without updating those
   suites. They now fail _closed_ on real institutional records (`UNATTRIBUTED_WALLET`,
   `NO_INSTITUTION_CONTEXT`) instead of on a placeholder. A15 moved from 0/23 to 7/23 on that
   change alone.
2. **Institutional fixtures for those suites.** Persisted-record guards make institution,
   affiliation and wallet attribution obtainable only through the protected-authority workflow
   (consumed approvals, checker decisions, trigger-generated execution evidence). The required
   sequence was established concretely:
   - institution: `REGISTERED` → `EVIDENCE_SUBMITTED` → (consumed
     `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE` approval) → `APPROVED`; execution evidence is
     trigger-generated, never inserted;
   - affiliation: consumed `INSTITUTION_AGENT_AFFILIATION_CHANGE` + transition evidence;
   - wallet attribution: consumed `WALLET_INSTITUTION_ATTRIBUTION` + governed receipt, **before**
     the wallet's first ledger line (the ledger guard refuses to attribute an account with posted
     history).
     The correct path is to drive the real services (or a full runtime/authority/migrator split via
     `test/support/protected-authority-provisioning.ts`), not to fabricate approvals.
3. **Full repository PG integration** is therefore not green and is not claimed.
4. **Production policy dependencies** (unchanged and documented): approved institutional policy for
   cash-to-cash funding evidence; explicit approved authority for platform-level reconciliation
   access.

## 6. Non-goals preserved

No Arena 1 A6/A7 or Arena 4 customer-app integration, no ledger-reversal redesign, no automatic
refunds, no transfer-code replacement, no new products, no production credentials, no deployment,
no main merge. Prettier and customer-mobile lockfile defects stay in the release-remediation
register; no repository-wide reformatting was performed.
