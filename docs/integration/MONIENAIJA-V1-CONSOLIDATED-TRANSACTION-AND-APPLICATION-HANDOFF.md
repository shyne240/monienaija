# MonieNaija — V1 Consolidated Transaction & Application Handoff (Arena 5)

Branch `arena/1f37a4f3-monienaija`, base `6816a760` (Arena 3D freeze), merged with `78d999d6` (Arena 2C freeze) via virtual-base union at `298efaef`. This document is the Arena 5 consolidated handoff required by Group 40. It records exact source, migration inventory, executed evidence, group verdicts, architecture, remaining decisions, and release verdict. No provider calls, real funds, deployments, or main-branch merges occurred.

## 1. Source register

| Branch | Tip at handoff | Role |
|---|---|---|
| `arena/1f37a4f3-monienaija` | `e185d7a4` | Consolidated candidate |
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
- `npm run test` — **3403/3403 in 291 suites** (0 failed) at `2a57be1f` after hardening; `test/h04-h06-event-map` 35/35 at `e185d7a4`
- `npx tsc --noEmit` — **0** at `e185d7a4`
- `npx tsc --noEmit -p tsconfig.json` equivalent — 0

### PostgreSQL integration (disposable, `fin1` run-id, prior to this continuation)
| Suite | Tests |
|---|---|
| `agent-bank-transfer-commitment` | 11/11 |
| `financial-commitment-initiation` | 43/43 |
| `bank-transfer-commercial-settlement` | 6/6 |
| `migration-0804-owner-authority` | 6/6 |
| `funding-defunding-conservation` | 4/4 |
| `banking-mobile-journeys` (customer+agent directory/enquiry/initiation/preview/transfer-status/PIN/idempotency) | 10/10 |
| `external-operation-lifecycle.service` (unit, now 8/8) | 8/8 |
| `production-readiness` (head 0804) | 13/13 |
| **New-suite subtotal** | **26/26** |

Full `npm run test:pg` matrix not yet executed as a single frozen-candidate run in this continuation — see Outstanding.

### Mobile
- `apps/customer-mobile` — **25/25 suites 220/220** at `e185d7a4` (bank-withdrawal 9/9 mocked ApiClient); `BankWithdrawalScreen` + `BankTransferAddBeneficiarySheet` + `BankDirectoryApi` + `BankTransferPricingApi` + `pending-bank-withdrawal` durable intent with 24h TTL safety (stale must not auto-authorize new submission) shipped
- `apps/agent-mobile` — **24/24 suites 340/340** at `e185d7a4` (after `AmountInput` + `presentation.ts` + `surface.cream` theme fix; navigation.test.tsx now green); `BankWithdrawalScreen` + `BankDirectoryApi`/`AgentBankWithdrawalApi`/`AgentBankTransferPricingApi`/`pending-bank-withdrawal` + `AppNavigator`/`HomeScreen` capability-gated `nav-bank-withdrawal` shipped
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
| 20 | Unified history — customer | **PASS** | `customer-transaction-history` projects `financial_commitments` RESERVED→PENDING/SETTLED→COMPLETED/RELEASED→REVERSED as `EXTERNAL_BANK_TRANSFER` with fee/vat/total from `banking_operation_fee_bindings`, masked last4, operationReference (provider-issued `banking_outbound_operations.operation_reference` not internal `target_mapping_reference`), bankCode; counted, paginated, never reservation-as-settlement; degraded only on 42P01 missing-table otherwise thrown |
| 21 | Unified history — agent | **PASS** | `agent-transaction-history` parity via `fa.agent_id` principal_type AGENT, same fee binding + reference isolation + masking |
| 22 | Receipts (owner-scoped, masked) | **PASS** | Customer `GET /customers/me/banking/transfers/:operationReference` + Agent `GET /agents/me/banking/transfers/:operationReference` both owner-scoped (wallet owner check), masked last4, state CONFIRMING never failure; unified history items carry `external_operation_id`/`operationReference` linkage |
| 23 | Interrupted-operation recovery | **PASS (server) / PASS (mobile TTL hardened)** | Server `operationReference` null vs trackable, `replayed` flag, `pending-bank-withdrawal` 24h TTL with stale-must-not-authorize-new-submission guard (`hasStalePending*` blocks silent new key while prior may be unresolved); headless PG verified, physical-device restart gap per D7 remains genuine external blocker |
| 24 | Notifications | **PASS** | `external_bank_transfer.pending/settled/reversed` outbox events emitted at commitment/settlement/release with owner-resolved payload (fa fallback wallet_accounts.owner_class), `notification-event-map` intents for CUSTOMER/AGENT, catalogue + FINANCIAL + email parity, `notification-defaults-v2` bodies |
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
| 37 | Reversal & compensation | **INFRA PRESENT** | `releaseReservedWithdrawal` (rejection→RELEASED) verified; provider refund distinction preserved |
| 38 | Mobile regression (customer) | **PASS** | 25/25 220/220 |
| 39 | Mobile regression (agent) | **PASS** | 24/24 340/340 after AmountInput/surface/presentation fix |
| 40 | Consolidated acceptance programme & handoff | **IN PROGRESS** | This record; full PG matrix pending final bounded runner pass |

## 5. Architecture notes

- One financial engine: `financial_commitments` → `banking_outbound_operations` (bridge, same SERIALIZABLE tx) → dispatch worker → settlement service (verified only). No second ledger.
- History is read-side projection only: `financial_commitments` + `financial_authorizations` + `external_operations` + `banking_operation_fee_bindings` + `banking_outbound_operations` + `customer_beneficiaries`. Institution scoping via `fa.principal_type` + `wallet_accounts.owner_class` + `destinationInstitution`.
- Operation references: `banking_outbound_operations.operation_reference` (deterministic `OP<hash>`, immutable) is the provider-issued trackable reference; `external_operations.target_mapping_reference` (`a6-target:<hash>`) is internal routing and never presented as provider-issued. Receipts and history expose only the former.
- Notifications: governed outbox with `FINANCIAL_COMMITMENT` aggregate, `CONFIDENTIAL/FINANCIAL_CONTROL` classification, `eventType:aggregateId:v1` key, exactly-once via idempotency, participant resolution via `fa` with `wallet_accounts` fallback, verified contacts, enablement, consent, masking, no real delivery.

## 6. Outstanding before final acceptance

Items 4 (dedicated PG notification suite), 5 (integrity monitoring via existing architecture), 6 (mixed concurrency/adversarial), 7 (inbound synthetic funding), 8 (full frozen-candidate matrix with boot/HTTP/Chromium) remain deferred per user — none except physical-device/real-provider/prod-creds are externally blocked; all require bounded `npm run test:pg` + Chromium admin execution. Current tip `e185d7a4` has `tsc` 0, customer 25/25 220/220, agent 24/24 340/340, h04-h06 35/35; PG banking suites previously 26/26 on `fin1` but not yet re-executed on this tip.

All restrictions honored: no provider calls, real funds, notification sends, deployments, predecessor modifications, or main merges.
