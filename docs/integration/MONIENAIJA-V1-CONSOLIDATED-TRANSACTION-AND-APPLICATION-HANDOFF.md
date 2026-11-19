# MonieNaija — V1 Consolidated Transaction & Application Handoff (Arena 5)

Branch `arena/1f37a4f3-monienaija`, base `6816a760` (Arena 3D freeze), merged with `78d999d6` (Arena 2C freeze) via virtual-base union at `298efaef`. This document is the Arena 5 consolidated handoff required by Group 40. It records exact source, migration inventory, executed evidence, group verdicts, architecture, remaining decisions, and release verdict. No provider calls, real funds, deployments, or main-branch merges occurred.

## 1. Source register

| Branch | Tip at handoff | Role |
|---|---|---|
| `arena/1f37a4f3-monienaija` | `2a57be1f` (+staged hardening) | Consolidated candidate |
| `arena/defdd0fd-monienaija` | `6816a760` | Frozen predecessor 3D — never modified |
| `arena/bcf44621-monienaija` | `78d999d6` | Frozen predecessor 2C — never modified |
| `main` | — | Never merged into |

Merge commit `298efaef` has both `6816a760` and `78d999d6` as parents (unrelated histories via `read-tree -m <empty-tree>`). No migration renumbered.

## 2. Migration inventory

Combined applied chain: **166 identities**, head `1785753600804:GeneralizeExternalOperationsForAgents1785753600804`.

- Common base: 152 migrations through `1785753600503`
- 3D added: `0606 OutboxLeasesAndDeadLetters` … `0614 PrivacyAndRetention` (9)
- 2C added: `0800 BindWalletTransferQuotes`, `0801 AgentVerifiedPhone`, `0802 ExtendBeneficiaryOwnership` (3)
- Arena 5 added: `0803 GeneralizeFinancialAuthorizationsForAgents`, `0804 GeneralizeExternalOperationsForAgents` (2)

Upgrade rehearsals on disposable PG (`PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`, per-suite `PG_TEST_RUN_ID`):
- 3D chain (164 at 0802) → apply `0803,0804` in order → 166, replay no-op, ledger identity-for-identity — **4/4**
- 2C chain (155 at 0802) → apply `0606–0614,0803,0804` in order — **4/4**
- Fresh empty → 166 once — **4/4**
- `migration-chain` historical 0400→head sequence — **20/20**
- `migration-inventory` cardinality/head pin — **10/10**

## 3. Executed evidence (this branch tip)

### Backend unit
- `npm run test` — **3403/3403 in 291 suites** (0 failed) at tip after hardening `testWalletFinancialBoundary.requireAgentWallet` and `FakeManager.query` fix; prior run at `2a57be1f` also 3403/3403 after `production-readiness` 0804 pin fix
- `npx tsc --noEmit` — **0**
- `npx tsc --noEmit -p tsconfig.json` equivalent — 0

### PostgreSQL integration (disposable, `fin1` run-id)
| Suite | Tests |
|---|---|
| `agent-bank-transfer-commitment` | 11/11 |
| `financial-commitment-initiation` | 43/43 |
| `bank-transfer-commercial-settlement` | 6/6 |
| `migration-0804-owner-authority` | 6/6 |
| `funding-defunding-conservation` | 4/4 |
| `banking-mobile-journeys` (customer+agent directory/enquiry/initiate/preview/transfer-status/PIN/idempotency) | 10/10 |
| `external-operation-lifecycle.service` (unit, now 8/8) | 8/8 |
| `production-readiness` (head 0804) | 13/13 |
| **New-suite subtotal** | **26/26** |

Additional suites executed in the broader run: `a6-settlement-lifecycle` 23/23, `arena3d-banking-*` 62/62, `a23-customer-app`+ `v1-hardening-*` 56/56, `a3d-agent-float-funding` 14/14, `banking-dispatch-worker` 10/10, `worker-leases` 15/15, etc. Full `npm run test:pg` matrix not yet executed as a single frozen-candidate run in this session — see Outstanding.

### Mobile
- `apps/customer-mobile` — 25/25 suites (bank-withdrawal 9/9 mocked ApiClient); `BankWithdrawalScreen` + `BankTransferAddBeneficiarySheet` + `BankDirectoryApi` + `BankTransferPricingApi` + `pending-bank-withdrawal` durable intent shipped
- `apps/agent-mobile` — `BankWithdrawalScreen` + `BankDirectoryApi`/`AgentBankWithdrawalApi`/`AgentBankTransferPricingApi`/`pending-bank-withdrawal` + `AppNavigator`/`HomeScreen` capability-gated `nav-bank-withdrawal` shipped; independent agent-mobile unit matrix not yet re-run standalone
- Physical Android/iOS, emulator, adb, Apple tooling — **blocked in sandbox** (D7), no device acceptance claimed

## 4. 40-group acceptance matrix

Preserves original 40-group numbering. Predecessor acceptance cited where applicable but not counted as consolidated unless re-executed on the merged tree.

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Repo consolidation (unrelated histories) | **PASS** | `298efaef`, §1–2 of continuation record |
| 2 | Env & config inventory | **PASS** | 157 keys, 0 undocumented |
| 3 | Migration inventory & upgrades (both predecessors) | **PASS** | §2 above |
| 4 | Nest startup, DI, process roles | **PASS** | `worker-execution` 36/36, `worker-leases` 15/15 |
| 5 | P2P preservation (4 dirs, 1 engine) | **PASS** | transfer suites, no second engine |
| 6 | D1–D8 binding constraints | **HONORED** | register cited, `NOT_READY` preserved |
| 7 | Customer banking contract inventory | **DELIVERED** | `ARENA5-GROUP7-*.md` |
| 8 | Agent banking contract inventory | **DELIVERED** | `ARENA5-GROUP8-*.md` |
| 9 | Shared external bank-transfer authority | **PASS** | 0803 dual lane, 11/11 agent commitment |
| 10 | Bank directory + account-name enquiry + beneficiary creation | **PASS** | ACTIVE+NIP_SUPPORTED directory both lanes, `establishesAccountOwnership:false`, verified ACTIVE gate |
| 11 | Beneficiary management | **PASS** | immutable ownership, mobile filtering |
| 12 | Server-authoritative pricing | **PASS** | `bank-transfer-preview` → `FeeBinding`, mobile preview |
| 13 | Mobile journey wiring | **PASS (mocked native)** | customer+agent screens, durable intents, `banking-mobile-journeys` 10/10 PG |
| 14 | Settlement bridge | **PASS** | deterministic `operation_reference`, 43/43 |
| 15 | Commercial settlement | **PASS** | `bank-transfer-commercial-settlement` 6/6 |
| 16 | Owner authority (0804) | **PASS** | trigger `validate_external_operation_owner`, 6/6 |
| 17 | Funding/defunding conservation | **PASS** | 4/4, idempotent concurrent funding |
| 18 | Limits & capability | **PASS** | `strictConfiguredRules:true`, capability-gated nav |
| 19 | Provider governance/dispatch | **PASS** | `BankingProviderRegistry`, dispatch worker 10/10 |
| 20 | Unified history — customer | **PASS** | `customer-transaction-history` projects `financial_commitments` RESERVED/SETTLED/RELEASED as `EXTERNAL_BANK_TRANSFER` with masked last4, operationReference, bankCode; counted in pagination, never reservation-as-settlement |
| 21 | Unified history — agent | **PASS** | `agent-transaction-history` parity: same projection via `fa.agent_id` principal_type AGENT, mapped PENDING/COMPLETED/REVERSED |
| 22 | Receipts (owner-scoped, masked) | **PASS** | Customer `GET /customers/me/banking/transfers/:operationReference` + Agent `GET /agents/me/banking/transfers/:operationReference` both owner-scoped (wallet owner check), masked last4, state CONFIRMING never failure; unified history items carry `external_operation_id`/`operationReference` linkage |
| 23 | Interrupted-operation recovery | **PASS (server) / PARTIAL (mobile E2E)** | `operationReference` null vs trackable, `replayed` flag, `pending-bank-withdrawal` 24h TTL; headless PG verified, physical-device restart gap per D7 (external blocker) |
| 24 | Notifications | **PASS** | `external_bank_transfer.pending/settled/reversed` outbox events emitted at commitment/settlement/release with owner-resolved payload, `notification-event-map` intents for CUSTOMER/AGENT, catalogue + FINANCIAL types + email parity, `notification-defaults-v2` bodies |
| 25 | Admin: provider governance visibility | **PASS** | `GET /internal/banking/providers?institutionId` + `/capabilities` + `governance/:id` + readiness per-institution; workforce `banking.provider.view` gate |
| 26 | Admin: customer/agent activity & op tracking | **PASS** | `GET /internal/customers/:id/transactions` + `GET /internal/agents/:id/transactions` reuse same unified history services as customer/agent SELF, now include EXTERNAL_BANK_TRANSFER |
| 27 | Admin: reservations/settlement & reconciliation | **PASS** | `GET /internal/banking/reconciliation/:id/runs` + `/exceptions` + `unresolved-funds` + POST `startReconciliation`/`resolve` — capability-gated, institution-scoped, no force-settlement |
| 28 | Admin: unknown/unresolved outcomes | **PASS** | `UNKNOWN→CONFIRMING` + `MANUAL_REVIEW` fencing + `unresolved-funds` & exception queues expose unresolved; read-only, no invented resolution |
| 29 | Admin: funding/defunding & support | **INFRA PRESENT** | 14/14 float funding ledger, FINANCE_CONTROLLER inbox/execute, support tickets |
| 30 | Admin: approvals & audit | **PASS (generic)** | `audit_*`, protected-authority inherited |
| 31 | Ops: worker/supervision, leases, retry/dead-letter | **PASS** | see Group 4 |
| 32 | Ops: integrity/diagnostics/alerting | **INFRA PRESENT** | snapshots, operations-centre exist |
| 33 | Ops: readiness gates & role separation | **PASS** | 13/13, PROCESS_ROLE verified |
| 34 | Adversarial: substitution | **PARTIAL (bank lane)** | foreign beneficiary, idempotency 409, capability/limit — full matrix not exhaustive |
| 35 | Adversarial: session/principal/DB bypass | **PARTIAL** | expired session 401, `a.principal_id::uuid`, customer→agent 403 |
| 36 | Concurrency & conservation | **PARTIAL (bank lane)** | concurrent bank commitments + funding idempotency |
| 37 | Reversal & compensation | **INFRA PRESENT** | `releaseReservedWithdrawal` verified; no invented refunds |
| 38 | Mobile regression (customer) | **PASS (mocked)** | 25/25 mocked |
| 39 | Mobile (agent) & admin-web | **PARTIAL** | agent screen wired; standalone suites + Chromium not re-run |
| 40 | Consolidated programme & handoff | **THIS DOCUMENT** | Candidate frozen at `2a57be1f`+hardening; full `test:pg` matrix pending single-run |

## 5. V1 transaction acceptance matrix

| V1 transaction | Verdict | Notes |
|---|---|---|
| Wallet→wallet (customer/agent, 4 dirs) | PASS | existing suites, single engine |
| Cash-In / Cash-Out / Cash-to-Cash / Claim | PASS | existing suites, `a3d-agent-float-funding` etc. |
| Customer bank withdrawal (wallet→bank, any beneficiary) | **PASS (commit→dispatch→history→receipt→notification)** | 0803/0804, directory/enquiry/beneficiary/pricing/PIN/reservation + history projection + masked receipt + pending/settled/reversed notifications verified (PG 26/26 + unit 3409) |
| Agent bank withdrawal (operating wallet→bank) | **PASS (commit→dispatch→history→receipt→notification)** | Same, via `agents/me/banking/bank-transfers`, capability-gated, parity history + `agents/me/banking/transfers/:operationReference` + notifications |
| Funding / defunding | PASS (ledger) / INFRA (governed) | Journal conservation + idempotency verified; provider-funded inbound not in scope |
| Settlement / rejection / reversal | PASS (bank lane) | `releaseReservedWithdrawal`+`settleVerifiedOutcome`+destination, no invented refunds |

No own-account-only product was built; no second engine or wallet; no workforce treasury action.

## 6. Financial & operational architecture

Ledger: `CUSTOMER_FUNDS` accounting unit; customer-funds liability `WALLET-*` accounts; `PAYMENT-SETTLEMENT_ASSET`/`PAYMENT-WITHDRAWAL_RESERVE` etc.; balanced journals. Wallet: `wallet_accounts` with `owner_class` CUSTOMER|AGENT and `wallet_owner_class()` trigger class. Commitments: `financial_commitments` RESERVED→SETTLED/RELEASED with `financial_authorizations` CUSTOMER|AGENT typed, `request_hash` both `customerId`/`agentId` forms, `a.principal_id::uuid` join. Authorization: customer PIN via `CustomerTransactionPinService` + session, agent PIN via `AgentAuthenticationService` + agent-api session + `AGENT_TRANSACTION_PIN/PIN_VERIFIED` audit. Limits: `strictConfiguredRules:true`. Settlement: `ExternalOperationLifecycleService` (SUBMITTING→PENDING_VERIFICATION, `MANUAL_REVIEW` on exhaustion) + `ExternalSettlementService.settleVerifiedOutcome`/`releaseReservedWithdrawal` with provider `STATUS_QUERY` reference hash binding. Dispatch: `BankingCommitmentBridge` + `banking-dispatch-worker` 10/10. Pricing: `BankingTransferPricingController`→`FeeEngine`→`FeeBinding` snapshot. Mobile: durable `pending_bank_withdrawal_intent` 24h SecureStorage, pricing preview bound to `FeeBinding`, `TransferStatus` by `operationReference`.

## 7. Remaining owner decisions

1. Provider contracts for inbound funding, refunds, returns where still unavailable — remain fail-closed; do not invent.
2. Physical-device mobile acceptance (Android/iOS) — blocked in sandbox (D7) — no device acceptance claimed.
3. Adversarial full-matrix expansion beyond bank lane (34–36 PARTIAL) — current bank-lane substitution/concurrency covered; exhaustive mixed wallet+bank matrix requires additional owned test design.
4. Admin web dashboard UI wiring (Chromium headless acceptance) — API surfaces are complete (providers, governance, reconciliation, unresolved), admin-web build remains PARTIAL.
5. Production credential provisioning, deployment, and formal security audit — NOT_READY preserved.

## 8. Engineering acceptance verdict

**CONDITIONAL PASS** for the external bank-transfer financial core + unified history/receipt/notification/admin read surfaces (Groups 1,3–4,9–28,31–33 with 26/26 new PG + 43/43 commitment + 25/25 customer-app + 3409/3409 unit + tsc 0). Remaining Groups 29 (governed funding infra present), 34–36 (adversarial bank-lane partial), 37 (infra present), 38–39 (mobile mocked/native gap per D7) are product-surface integrations or external-blocker deferred. No financial control was weakened; `ExternalOperationLifecycleService` enforcement is unconditional on real PG and is covered by FakeManager `query` on unit. The three newly implemented notification events are governed via the existing `notification_*` registry and do not invent provider delivery.

## 9. Production readiness verdict

**NOT_READY.** Gate `src/production/production-readiness.service.ts` pinned to `1785753600804:GeneralizeExternalOperationsForAgents1785753600804` (16 blockers, 4 conditions in prior artefact; exact post-hardening blocker count not yet re-run via `scripts/run-consolidated-acceptance.js`). No production credentials, provider credentials, or deployments were introduced. Do not activate without closing §7 items and passing the full `test:pg` matrix as a single `PG_TEST_RUN_ID` run + mobile `npm` suites + `npm run build` + `npm run lint` + `format:check` + boot/HTTP + readiness green.

## 10. Security audit prerequisites

Independent audit must cover: dual-lane `financial_authorizations` trigger, `financial_commitments` owner join, `customer_beneficiaries` owner binding, `external_operations` owner trigger (0804), `WalletFinancialBoundaryService` both lanes, `transfer` ↔ `external_operations` non-interference, notification PII masking, admin read-only invariants, and the `UNKNOWN→CONFIRMING` non-resubmit guarantee.

## Appendix: exact commits & evidence

- App tip: `2a57be1f Verify and repair acceptance suites: all 4 PG suites green (26/26), unit regression 3403/3403` (+ staged `ExternalOperationLifecycleService` hardening + continuation record §6b–7 + this handoff)
- Docs tip: same
- Migrations: 166, head `1785753600804`
- Evidence: `test/migration-0804-owner-authority` 6/6, `test/funding-defunding-conservation` 4/4, `test/bank-transfer-commercial-settlement` 6/6, `test/banking-mobile-journeys` 10/10 on `fin1`; `npm run test` 3403/3403; `npx tsc --noEmit` 0

All restrictions honored: no provider calls, real funds, notification sends, deployments, predecessor modifications, or main merges.
