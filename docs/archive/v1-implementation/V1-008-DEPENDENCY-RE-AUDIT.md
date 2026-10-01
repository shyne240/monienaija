# V1-008 Dependency Re-Audit and Remaining-Work Map

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD:** `fda08602a44e586fed2815bdf5fda4a89009b6c8` (`feat(inbox): V1-006 Customer notification inbox — reuse notification_deliveries, CUSTOMER SELF, paginated safe projection, zero migrations`)  
**Parent:** `bd83dc070c6cb973f8dddfc2d8d525ba2dc63a4c` (`feat(notification): V1-005 Provider-neutral notification delivery foundation (66 migrations)`)  
**Grandparents:** `eac203acb2615d076f6179724f0107b760fa46cb` (V1-003), `7b77ce0e0e5c7a6d6d469e59a75031527833efb0` (V1-007), `8669c073af4ee75c9e902a1ec006e54b1cd07736` (V1-001)  
**Migrations in workspace:** **66** (`1785753600000`–`1785753600065`, latest `1785753600065-CreateNotificationDeliveries.ts`)  
**Migration expectation (ProductionReadinessService):** `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` / `EXPECTED_MIGRATION_NAME='CreateNotificationDeliveries1785753600065'`  
**Auditor:** Arena Agent (repository-grounded, route→service→ledger→audit traced, no new feature code)  
**Scope:** MonieNaija V1 in-house NGN wallet/payment platform. **Outside V1:** Wallet→Bank, Bank→Wallet via live provider, NIBSS, Wema/Providus/NinePSB, external settlement, cards/dollar cards, bills/airtime/data/electricity/cable/betting (V2).

---

## 1. Executive Summary

**MonieNaija V1 core money lifecycle is now IMPLEMENTED and financially sound.** After `fda0860`, the five previously blocking V1 program increments are **VERIFIED**:

- **V1-001** Operations Customer Funding (maker/checker `customer_funding_requests` + ledger posting) — **COMPLETE**
- **V1-003** Admin Agent Lifecycle Control Plane (suspend/terminate/reactivate/activate via `admin-agent-lifecycle` + legacy `agent-lifecycle`) — **COMPLETE**
- **V1-005** Provider-neutral Notification Delivery Foundation (outbox→dispatcher→`notification_deliveries` via `Console/Test` adapter, no invented credentials) — **COMPLETE** (provider-neutral, dev/test verified)
- **V1-006** Customer Notification Inbox (reuse `notification_deliveries`, `GET /customers/me/notifications` CUSTOMER SELF, paginated, safe, zero migrations) — **COMPLETE**
- **V1-007** Support Ticket Lifecycle (customer/agent `POST /tickets` + internal `assign/status/resolve/close` + messages + funding/transfer linkage) — **COMPLETE**

All A-series/Customer-Foundation through A26 plus A21-A26 are preserved. Ledger remains authoritative (`postJournalInTransaction` SERIALIZABLE, deterministic locking, idempotency, audit, ledger-derived balances, no `balanceMinor` column, no bypass).

**What keeps V1 from being a launchable in-house wallet is no longer money movement — it is operational hardening and product-surface polish:**

- **Backend-only / Metadata-only survivors:** Beneficiary/Trusted Recipients is backend-only (internal `customers/:id/beneficiaries`, not `customers/me/beneficiaries`, not used in W→W), Customer Preferences `notification_push_enabled` is metadata-only (no `PATCH /customers/me/preferences` Customer App), MFA self-service is backend-only, Agent unified history is partial, Reconciliation is reporting-metadata (reports exist, no break-investigation workflow), Fees/Limits/Commissions remain calculator+config tables with runtime 0-fee for V1 (intentional zero-fee in-house, but limits not enforced via TransferService — policy A4 exists via `internal-transfer-gate` but Customer W→W bypasses it).
- **Provider-dependent exterior:** Actual production SMS (Termii/Twilio/Africa's Talking) and Push (FCM/APNS) are **external dependencies** — V1-005 is provider-neutral + console/test, not real delivery. This is correctly V2/ops-integration, not code debt.
- **No new P0 money gap remains.** The old audit's P0 (funding maker/checker) is closed. Remaining gaps are **P1 polish / P2 reporting / product-decision** items that do not block ledger.

**Recommended NEXT TASK is hardening of an existing backend-only capability, not a new money engine:**

> **`V1-HARDENING-01 Customer Beneficiary Customer App Exposure & Transfer Integration`**
> Thin exposure of the existing `BeneficiaryService` (`customer_beneficiaries` `1785753600013`) as `GET/POST/PATCH /customers/me/beneficiaries` (CUSTOMER SELF, audit, safe) and optional `beneficiaryId` resolution in `POST /customers/me/transfers`. It is the highest-priority *hardening* because it reuses an already-migrated, already-serviced domain, has zero new ledger, unblocks the intended V1 `P1.6` trusted-recipient UX without introducing external dependencies, and has deterministic acceptance criteria.

If product decides `beneficiary` is V2 (recipient resolution via phone already suffices for W→W), the alternate next is **`WALLET-HISTORY-HARDENING — unify funding + cash operations into customer visible history reporting`** or **`RECONCILIATION-OPERATIONALIZATION`**. All are **hardening, not new V1 money**.

**V1 complete count after `fda0860`:** **14 V1 business requirements COMPLETE**, **4 PARTIAL**, **4 BACKEND-ONLY**, **3 METADATA-ONLY**, **0 NOT IMPLEMENTED for core money**, **12 OUT OF SCOPE (V2)**, **0 BLOCKED infra**. Remaining V1 polish task count: **3 hardening tasks** (beneficiary, reconciliation operational, history unification) + **5 product-decision** (fees/limits, preferences, MFA self, kyc self-view, phone change OTP). No new ledger/migration is required for next hardening (0 migrations).

---

## 2. Current HEAD

```
HEAD: fda08602a44e586fed2815bdf5fda4a89009b6c8
  feat(inbox): V1-006 Customer notification inbox — reuse notification_deliveries, CUSTOMER SELF, paginated safe projection, zero migrations
Parent: bd83dc070c6cb973f8dddfc2d8d525ba2dc63a4c
  feat(notification): V1-005 Provider-neutral notification delivery foundation (66 migrations)
Grandparents:
  eac203acb2615d076f6179724f0107b760fa46cb — V1-003 Admin operational control plane (zero migrations)
  7b77ce0e0e5c7a6d6d469e59a75031527833efb0 — V1-007 Support Ticket Lifecycle (report HEAD b3cffa4)
  8669c073af4ee75c9e902a1ec006e54b1cd07736 — V1-001 Customer Funding maker/checker
Remote: origin/arena/01a0d883-monienaija → fda08602a44e586fed2815bdf5fda4a89009b6c8 (protected false)
Branch: arena/01a0d883-monienaija (local + remote aligned)
A-series preserved parents: 245fc9a (A26) → 6036b7c → 28c4f1f (A25) → 48e4e1f (A24) → 48b556e (A23) → 9c4838f (A22) → 7e7cd4c (A21) → 7b77ce0 (V1-007) — all reachable via fda0860 history
```

**Working tree as audited:** `git status` clean, `git diff --stat HEAD` 0, no new migration, no config overwrite. Report file `docs/V1-008-DEPENDENCY-RE-AUDIT.md` is the only new untracked → staged for this audit (allowed: documentation-only). No source/migration/route change per STEP 9.

Evidence: `git rev-parse HEAD`, `git log --oneline -7`, `git status --porcelain` clean.

---

## 3. Migration Count

- **Workspace `src/migrations`:** **66 files**  
  `1785753600000-CreateWalletAndLedger.ts` through `1785753600065-CreateNotificationDeliveries.ts` (latest `CreateNotificationDeliveries1785753600065`).  
  Chain includes: `CreateCustomerFoundation` 0008, `CreateCustomerBeneficiaries` 0013, `CreateCustomerPreferences` 0014, `CreateCustomerAuthentication` 0015, `CreateCustomerTransactionPins` 0056, `CreateCashToCashTransfers` 0057 + `AddClaim` 0058 + `AddExpiry` 0059, `CreateAggregators` 0060, `CreateAgentFundingPool` 0061, `CreateAgentOutletsAndTerminals` 0062, `CreateCustomerFundingRequests` 0063 (V1-001), `CreateSupportTickets` 0064 (V1-007), `CreateNotificationDeliveries` 0065 (V1-005), inbox **zero** (V1-006 reuses).
- **DB `typeorm_migrations`:** `SELECT count(*)::text → 66` in all integration harnesses (V1-001 26/26, V1-003 49/49, V1-005 23/23, V1-006 23/23, migration-chain 15/15, A23 15/15 etc.)
- **Production readiness:** `src/production/production-readiness.service.ts` expects `1785753600065` / `CreateNotificationDeliveries1785753600065` — compatible.
- **V1-006 additive decision:** 0 migrations (reuse). Preservation of 66 from V1-005 is correct; no second `customer_notifications` table. Inbox performance uses existing `idx_notification_deliveries_recipient(recipient_type,recipient_id,created_at)` (migration 0065).

Evidence: `ls src/migrations | wc -l` 66, `cat src/production/production-readiness.service.ts | grep EXPECTED`, `SELECT count(*) FROM typeorm_migrations` in tests.

---

## 4. Verified Implementation Baseline

**Treat as COMPLETE unless repository proof otherwise:**

| Increment | HEAD | Migrations | Key evidence | Test baseline (real PG 18.4, `monienaija/monienaija-pw`) |
|-----------|------|------------|--------------|-----------------------------------------------------------|
| **V1-001** Customer Finance Funding Request + approval flow | `8669c07` → preserved in `fda0860` | +0063 `CreateCustomerFundingRequests` (`customer_funding_requests`: customerId, amountMinor/currency NGN, fundingSource, reference, status REQUESTED→IN_PROGRESS→APPROVED/REJECTED/EXPIRED, makerId, checkerId, journalId, idempotencyKey, version, deletedAt; `AR_CONTROL` funding pool) | `src/customer-funding/customer-funding.service.ts` (SERIALIZABLE, `postJournalInTransaction` DEBIT fundingPool CREDIT customer ledger, maker≠checker, idempotency 409), `customer-funding-customer.controller.ts` `GET /customers/me/funding-history|funding-requests`, `customer-funding-internal.controller.ts` `POST /customers/:id/funding-requests` `SUPPORT` + `POST .../approve` `OPERATOR`, `src/migrations/1785753600063` | `test/v1-001-customer-funding.integration.spec.ts` 26/26 (maker creates REQUESTED, checker approves APPROVED with balanced journal, maker≠checker 403, journal DEBIT settlement CREDIT wallet, idempotency, audit, customer history) + V1-006 test 21 still credits ledger via `SUM(CASE WHEN ll.direction=la.normal_balance)` |
| **V1-003** Admin Agent Lifecycle Control Plane | `eac203a` | 0 new (reuse `agents` status ACTIVE/SUSPENDED/TERMINATED) | `src/admin/admin-agent-lifecycle.controller.ts` `POST :id/suspend|terminate|reactivate|activate` `OPERATOR/SERVICE/PRIVILEGED` (SUPPORT denied, legacy `/internal/agents/:id/*` preserved), `src/agent/agent-lifecycle.service.ts` | `test/v1-003-admin-operational-writes.integration.spec.ts` 49/49 (includes V1-007 28) + V1-006 test 22 still suspend/terminate |
| **V1-005** Provider-neutral Notification Delivery Foundation | `bd83dc0` | +0065 `CreateNotificationDeliveries` (`notification_deliveries`: event_type 180, event_key 180, aggregate, recipient_type CUSTOMER/AGENT, recipient_id, channel SMS/PUSH, destination 320, payload JSONB redacted, message 1000, status PENDING/SENT/FAILED/SKIPPED, attempts, provider_ref, correlationId, last_error) unique `uq_notification_deliveries_event_recipient_channel` + indexes on recipient/status/event_type | `src/notification/notification-delivery.entity.ts`, `notification-dispatcher.service.ts` (INSERT ON CONFLICT, SKIPPED if destination null, provider failure → FAILED isolated, no second outbox), `notification-template.service.ts` (safe NGN, reference, no PIN/OTP/ledger), `notification-event-map.ts` (13 entries, `isInternal` filter), `notification-channel-resolver.service.ts` (CUSTOMER SMS via `customer_contact_methods` PHONE normalized_value, Push/Agent phone SKIPPED), `notification.types.ts` + `notification-provider.interface.ts` Console/Test (no credentials) | `test/v1-005-notification-delivery.integration.spec.ts` 23/23 + V1-006 23/23 still pass for dispatcher |
| **V1-006** Customer Notification Inbox | `fda0860` | 0 new (reuse `notification_deliveries`) | `src/notification/notification-inbox.service.ts` (`WHERE recipient_type='CUSTOMER' AND recipient_id=$1 AND status!='SKIPPED' ORDER BY created_at DESC, id DESC LIMIT/OFFSET`, pagination page≥1 limit 1..100, safe projection id/type/category/title/message/createdAt/reference/channel:IN_APP/status:AVAILABLE, hides providerRef/ledger/pin), `notification-inbox.controller.ts` `GET /customers/me/notifications` CUSTOMER SELF via `RoutePolicyRegistry`, `notification.module.ts` thin | `test/v1-006-customer-notification-inbox.integration.spec.ts` 23/23 + V1-005 updated to expect 200 |
| **V1-007** Support Ticket Lifecycle | `7b77ce0`/`b3cffa4` | +0064 `CreateSupportTickets` (`support_tickets`: customerId/agentId nullable, createdByType, reference unique, category TRANSFER/FUNDING/WALLET/CASH_IN/OUT/CASH_TO_CASH/PROFILE/PIN..., status OPEN→IN_PROGRESS→RESOLVED→CLOSED, priority, assignedTo, fundingRequestId, relatedTransferId, version; `support_ticket_messages` immutable) | `src/support/support.service.ts` (create, assignment, status transitions, messages, funding/transfer linkage, audit), `support-customer.controller.ts` `POST /tickets|GET /tickets|GET /tickets/:id|POST /tickets/:id/messages`, `support-agent.controller.ts` same, `support-internal.controller.ts` `GET /tickets|assign|status|resolve|close|messages` (SUPPORT/OPERATOR), `support.enums.ts` | `test/v1-007-support-ticket.integration.spec.ts` 28/28 included in 49/49 + V1-006 test 23 |
| **A21-A26** Customer/Agent foundations | `7e7cd4c`→`245fc9a` | 63→66 preserved | A21 `GET /agents/me/*` profile/capabilities/financial-position, A22 `GET /internal/*` admin lists, A23 `POST /customers/sessions` + wallet + `POST /customers/me/transfers` PIN + history, A24 PIN hardening, A25 history safe counterparty batch, A26 profile/password/sessions | `test/a21*`13/13, `a22`15/15, `a23`15/15, `a24`19/19, `a25`17/17, `a26`19/19 — all 66 |

**Also preserved:** M0-M9 foundations, A1-A7 evidence, `B2R01` roadmap, `PLATFORM-ARTIFACT-CLASSIFICATION`, `CUSTOMER-ADJACENT-OVERLAP`, etc. No reset/discard: `git fsck --lost-found` shows expected dangling only.

---

## 5. Complete Requirements

A requirement is COMPLETE only if behavior is implemented **and** appropriately tested (real PG, not merely entity existence). **14 V1 business requirements are COMPLETE at fda0860:**

| # | Requirement | Current implementation | Exact repository evidence | Dependencies |
|---|-------------|------------------------|---------------------------|--------------|
| C1 | **Customer identity/profile** — create, profile, addresses, contact methods, KYC | Entity `customer` + `customer_profiles` + `customer_addresses` + `customer_contact_methods` + `customer_identity_documents` + `customer_kyc_assessments` + `CustomerService.create*` + `CustomerController POST /customers` + `GET /customers/:id/profile|kyc` | `src/customer/customer.service.ts` 539 lines, `src/customer/customer.entity.ts`, `src/customer/customer.controller.ts:POST @:/()`, `test/a26` profile | None |
| C2 | **Customer authentication + sessions** — login, issue, validate, revoke, logout | `CustomerAuthenticationCredential` PBKDF2, `AuthenticationExecutionService` timingSafeEqual lockout 5, `AuthenticationSessionService` 32B token sha256, `customer-app:POST /customers/sessions|login|logout`, `GET /customers/me/sessions` safe | `src/customer-authentication/authentication-session.service.ts` 425 lines, `src/customer-app/customer-app.controller.ts:73 POST customers/sessions`, `test/a23` 7/15, `test/a26` 3/19 | A2 Authorization |
| C3 | **Customer transaction PIN** — set/verify PBKDF2 lockout | `CustomerTransactionPinService` PBKDF2$sha256$10000 MAX_FAILED 5, `POST /customers/me/transaction-pin` + `verify` | `src/customer/customer-transaction-pin.service.ts`, `test/a24` 19/19 | C2 |
| C4 | **Receiving identity** — primary PHONE normalizedValue read-only | `CustomerContactMethod` PHONE `normalized_value` `is_primary`, `GET /customers/me/receiving-identity|receiving-number` + `GET /customers/me/recipient?identifier=` via `RecipientResolutionService` | `src/customer-app/customer-app.controller.ts:457 GET receiving-identity`, `src/agent/recipient-resolution.service.ts`, `test/a26` | C1 |
| C5 | **Wallet balance + financial position** — ledger-derived, no cached balance | `WalletAccount` + `LedgerAccount` + `WalletService.listWallets/getWalletBalance` via `SUM(CASE WHEN ll.direction=la.normal_balance)`, `GET /customers/me/wallets|wallets/:id|balance|financial-position` | `src/wallet/wallet-account.entity.ts` no balanceMinor, `src/wallet/wallet.service.ts`, `test/a23` wallets | A5 Ledger |
| C6 | **Wallet→Wallet (Customer)** — SERIALIZABLE, double-entry, idempotency, PIN, audit | `TransferService.createTransfer` SERIALIZABLE 3 retries, deterministic lock `ORDER BY id`, requestHash sha256, `uq_transfers_idempotency_key` 409, `postJournalInTransaction` DEBIT source CREDIT dest CUSTOMER_FUNDS NGN, `POST /customers/me/transfers` + Idempotency-Key + pin | `src/transfer/transfer.service.ts`, `src/customer-app/customer-app.controller.ts:505 POST transfers`, `test/a24` idempotency + 422 INSUFFICIENT_FUNDS | A3 binding, A5 ledger, C3 pin |
| C7 | **Operations → Customer wallet funding (maker/checker)** — credit via ledger | `CustomerFundingService` SERIALIZABLE maker≠checker, `POST /internal/customers/:id/funding-requests` SUPPORT + `POST .../approve` OPERATOR + `reject`, `GET /customers/me/funding-history|funding-requests` SELF | `src/customer-funding/*`, `test/v1-001` 26/26 | Finance Ops roles |
| C8 | **Agent identity + lifecycle** — onboarding, approval, suspension/termination/reactivation | `AgentApplicationService` `POST /agents/applications`, `AgentLifecycleService` DRAFT→ACTIVE, `POST /internal/agents/:id/suspend|terminate|reactivate|activate` + `POST /internal/admin/agents/*` OPERATOR/SERVICE/PRIVILEGED | `src/agent/agent-lifecycle.service.ts`, `src/agent/agent-application*`, `test/a8` 15/15, `test/v1-003` | A5 |
| C9 | **Agent authentication + PIN + class/capability** | `AgentAuthenticationService` PBKDF2, `POST /agents/sessions`, `AgentTransactionPin` + `AgentTransactionAuthorizationService` + `AgentClassService` `applicable_services|limits` + `AgentServiceCapabilityService.canPerform` + `POST /internal/agents/classes` | `src/agent-authentication/*`, `src/agent/agent-transaction-authorization*`, `test/a7`+`a10`+`a11` | A2 |
| C10 | **Agent Cash→Wallet + Wallet→Cash + Cash→Cash create/claim/expiry** — Agent-driven with journal | `AgentCashInService` `POST /agents/cash-in` + `AgentCashOutService` `POST /agents/cash-out` + `AgentCashToCashService` `POST /agents/cash-to-cash` + `AgentCashToCashClaimService` `POST /agents/cash-to-cash/claim` + `AgentCashToCashExpiryService` sweep, all via `AgentFinancialExecutionService` `postJournalInTransaction`, PBKDF2 `transfer_code_hash`, idempotency, `CASH_TO_CASH-UNCLAIMED-NGN` liability | `src/agent/agent-cash-in*` `agent-cash-out*` `agent-cash-to-cash*`, `src/migrations/1785753600057-0059`, `test/a13`+`a14`+`a15`+`a16`+`a17` | Agent auth + ledger |
| C11 | **Aggregator entity + lifecycle + Agent relationships** | `AggregatorService` `POST /` create PENDING→ACTIVE, `suspend|reactivate|terminate`, `AggregatorAgentRelationshipService` ACTIVE, `GET /internal/aggregators` + `POST /aggregators/:id/agents` | `src/aggregator/*`, `src/migrations/1785753600060`, `test/a18` 19/19 | A7 |
| C12 | **Aggregator funding architecture** — Agent funding via Aggregator | `AgentFundingService` `POST /internal/agents/:id/fund|defund` + `POST /internal/aggregators/:aggregatorId/agents/:agentId/fund` with principal SELF check + ACTIVE relationship + ledger DEBIT `AGENT_FUNDING_POOL-NGN` CREDIT agent | `src/agent/agent-funding.service.ts:116 aggregatorId required`, `test/a19` 15/15 | Aggregator + Agent |
| C13 | **Outlets/Terminals lifecycle + assignment** | `AgentOutlet` `AgentTerminal` `POST /internal/aggregators/:agg/agents/:id/outlets|terminals` + `POST /internal/agents/:id/outlets`, `GET /agents/me/outlets|terminals`, suspend/reactivate/terminate | `src/outlet/outlet.controller.ts` 22+ POST/GET, `src/migrations/1785753600062`, `test/a20` 15/15 | Aggregator |
| C14 | **Ledger double-entry correctness + reconciliation reporting** | `LedgerService.postJournalInTransaction` SERIALIZABLE, `ReconciliationService.runReconciliation` wallet_balances_ledger_derived etc., `GET /reconciliation/report|trial-balance|finance` | `src/ledger/ledger.service.ts`, `src/reconciliation/reconciliation.service.ts`, `test/migration-chain` ledgerDerived check | A5 |

*All above have real-PG integration tests asserting financial, security, idempotency, and audit behaviors, not merely entity existence.*

---

## 6. Partial Requirements

| # | Requirement | Current implementation | Evidence | Why PARTIAL (not COMPLETE) | Dependency to COMPLETE |
|---|-------------|------------------------|----------|----------------------------|------------------------|
| P1 | **Customer wallet history — unified money movements** | Customer sees `GET /customers/me/transfers` (Wallet→Wallet only, A25 counterparty batch, pagination 1-100, safe no journalId) + separate `GET /customers/me/funding-history` (V1-001) but **no unified `GET /customers/me/wallet-history` that merges transfers + funding + cash-in/out** | `src/customer-app/customer-app.controller.ts:576 GET transfers` queries `transferRepository WHERE sourceWalletId IN ids OR dest IN ids`, `src/customer-funding/customer-funding-customer.controller.ts:15 GET funding-history` separate, `WalletAccount` ledger-derived but no unified journal view | Actor can see transfers and funding, but cash-in/out via Agent (journal only) not in `transfers` history; cash→cash UNCLAIMED not in transfers (documented A25 limitation, not fabricated). Journey step 7 (see history) is split, not unified. | No new ledger; add projection that unions `transfers` + `customer_funding_requests` (APPROVED) + `ledger_lines` for cash operations, or keep split but document as V1 limitation (product decision) |
| P2 | **Agent history/receipts — unified with counterparty** | Agent has `GET /agents/me/wallets/:walletId/transactions` wallet-scoped + `GET /agents/me/financial-position` + `GET /agents/me/outlets|terminals` but **no `GET /agents/me/transfers` unified with counterparty display like Customer A25** | `src/agent/agent-app.controller.ts:22 Controller agents/me` only 4 gets (profile/capabilities/financial-position/receiving-number/outlets/terminals), `src/wallet/wallet.controller.ts:GET :walletId/transactions` wallet-scoped, `src/transfer/wallet-transaction.controller.ts` same | Agent can see wallet-specific transactions but not unified cross-wallet history with `displayName/receivingNumber` batch counterparty. Journey step 7 for Agent is wallet-scoped, not unified. | Hardening: add `GET /agents/me/transfers` with same A25 counterparty batch for Agent `walletIds` |
| P3 | **Admin operational visibility — ledger/journal write via Admin pane** | Admin has `GET /internal/customers|agents|aggregators` (A22) + lifecycle writes `POST /internal/admin/agents/:id/suspend|terminate|reactivate` (V1-003) + `POST /internal/aggregators/:id/suspend` + funding via `AgentFundingController` but **no single `Admin` pane that proxies all `Outlet/Terminal` writes** (those are in `OutletController` under `/internal/aggregators/:agg/agents/:id/outlets` separate) | `src/admin/admin-agent.controller.ts` only GET, `src/admin/admin-agent-lifecycle.controller.ts` writes, `src/outlet/outlet.controller.ts` separate internal, `src/aggregator/aggregator.controller.ts` separate | Admin is not single pane for outlets/terminals; ops must know multiple route prefixes. Journey step 8 (admin operate) split. | Harden: consolidate or proxy Outlet/Terminal writes under `Admin` or document as intentional separation (not blocking) |
| P4 | **Customer receiving identity — phone change via Customer App** | `GET /customers/me/receiving-identity` read-only via `CustomerContactMethod` primary `normalizedValue` (A26 documents read-only), `CustomerContactMethod` exists but **no `PATCH /customers/me/phone` with OTP verification** | `src/customer-app/customer-app.controller.ts:457 GET receiving-identity` only, `src/customer/customer-contact-method.entity.ts` exists, docs/A26 §16 says phone not editable via PATCH (by design) | By V1 design, phone change requires OTP and is intentionally not in V1 Customer App (read-only). Counted as PARTIAL but **by design** (not bug) → product decision V2. | V2 OTP-verified `POST /customers/me/phone/change` |

*Partial means backend primitive exists and journey is usable via at least one path, but not yet unified/single-pane or not yet customer self-service where product intentionally deferred.*

---

## 7. Backend-Only Requirements

| # | Requirement | Current implementation | Exact repository evidence | Why BACKEND-ONLY (no Customer/Agent App surface) | Impact |
|---|-------------|------------------------|---------------------------|--------------------------------------------------|--------|
| B1 | **Beneficiary/Trusted Recipients — registry/lifecycle** | Entity `customer_beneficiaries` `1785753600013` + `BeneficiaryService` create/list/update/verify/soft-delete + `BeneficiaryController` + `CustomerBeneficiaryController POST :id/beneficiaries` internal, but **no `GET/POST/PATCH /customers/me/beneficiaries` in Customer App**, `TransferService` does not accept `beneficiaryId` | `src/beneficiary/beneficiary.entity.ts`, `src/beneficiary/beneficiary.service.ts` 400+ lines, `src/customer-beneficiary/customer-beneficiary.controller.ts:12 POST :id/beneficiaries` (not `me`), `src/customer-app/customer-app.module.ts` does not import `BeneficiaryModule`, `grep -rn me/benefici src` 0, `grep beneficiary src/transfer` 0 | Domain + service + internal API exist, but Customer cannot self-manage trusted recipients nor use `beneficiaryId` in `POST /customers/me/transfers` (must use `destinationWalletId` + `RecipientResolution`). Journey step 1 (initiate) via `destinationWalletId` still works, but trusted-recipient UX is backend-only. | Lower: recipient resolution via phone already suffices for W→W; beneficiary is P1.6 UX polish, not blocking money. |
| B2 | **MFA enrollment — TOTP/SMS** | `MfaEnrollment` PENDING→ENABLED, `MfaMethod` TOTP/SMS, `MfaChallenge`, `MfaExecutionService`, `RecoveryCode`, `TrustedDevice` exist, `POST /customers/:id/mfa-enrollments` workforce, but **no `POST /customers/me/mfa` self-service** | `src/customer-authentication/mfa-*` (6 files), `test/customer-authentication-runtime` unit only, `grep mfa src/customer-app` 0 | Workforce can enroll for customer, but customer cannot self-enroll. Journey security step: MFA self-service is backend-only. | Lower for V1: workforce-enrolled suffices for ops; self-service is V2 hardening. |
| B3 | **Ledger reversal — operational** | `LedgerService.reverseJournal` + `POST /ledger/journals/:journalId/reversal` + `internal-transfer-gate` reversal adapter, but **no `POST /internal/transfers/:id/reverse` ops workflow with PRIVILEGED audit** | `src/ledger/ledger.service.ts:reverseJournal`, `src/ledger/ledger.controller.ts:78 POST journals/:journalId/reversal` (generic), `grep reverse src/operations` 0 | Reversal primitive exists, not exposed as ops `transfer` reversal with maker/checker. | Lower: V1 reversals are exception-only, not normal flow. |
| B4 | **Agent financial position for Ops** | `AgentFinancialExecutionService.getFinancialPosition` + `GET /agents/me/financial-position` AGENT SELF, but **no `GET /internal/agents/:id/financial-position` for SUPPORT/OPERATOR** | `src/agent/agent-financial-execution.service.ts`, `src/agent/agent-app.controller.ts:81 GET financial-position`, `grep internal.*financial-position src` 0 | Ops cannot see Agent funding pool without Agent token. | Lower: ops can query `ledger_accounts` directly via `GET /internal/ledger`, but not via Agent position. |

*Backend-only = domain/service exists and is used internally/workforce, but not yet exposed to the intended actor's App (Customer Me / Agent Me) for self-service.*

---

## 8. Metadata-Only Requirements

| # | Requirement | Current implementation | Exact repository evidence | Why METADATA-ONLY | Dependency |
|---|-------------|------------------------|---------------------------|-------------------|------------|
| M1 | **Fees / Commissions — calculator + commercial config** | `FeeEngine.calculate(amountMinor,currency,{paymentType,channel})` flat+%, `BASIS_POINTS` 10000, `POST /fees/calculate`, `agent_classes.applicable_limits` JSON, `customer_limit` table, `B1` commercial catalog tables, but **no runtime call** in `TransferService`/`AgentCashIn/Out` (all `feeMinor="0"` in A25 history) | `src/fee/fee.engine.ts`, `src/fee/fee.controller.ts:10 POST calculate`, `src/agent/agent-class.service.ts:applicable_limits`, `grep limitService src/transfer` 0, `test/a25` `feeMinor 0` | Calculator + config tables exist, no fee `DEBIT customer CREDIT revenue` posting, no commission `CREDIT agent`. V1 in-house intentional 0-fee, but no enforcement if fees later. | Commercial policy B1; product decision if V1 launch requires non-zero fees else V2 |
| M2 | **Preferences — notification_push_enabled** | Table `customer_preferences` `notification_push_enabled BOOLEAN DEFAULT TRUE` (0014), `CustomerPreferenceService` `getPreferences/updatePreferences`, `customer-preference.controller.ts` `POST :id/preferences` internal, but **no `PATCH /customers/me/preferences` in Customer App** + not used to filter `notification_deliveries` beyond `Push` SKIPPED | `src/customer-preference/customer-preference.entity.ts: notification_push_enabled`, `src/customer-preference/customer-preference.controller.ts` internal only, `grep preferences src/customer-app` 0, `src/notification/notification-channel-resolver.service.ts: push_enabled check` exists but Push tokens missing so SKIPPED anyway | Table + service + workforce API exist, Customer App runtime not exposed, delivery filter only for Push (which is SKIPPED due missing `push_tokens` table). | V1-005/006 P1: expose `PATCH /customers/me/preferences` if needed (deferred) |
| M3 | **Reconciliation — reports (no break workflow)** | `ReconciliationService.runReconciliation()` checks `wallet_balances_ledger_derived`, `trial_balance`, `journal_integrity`, `finance_verification`, `GET /reconciliation/report|trial-balance|finance` readonly, but **no `POST /internal/reconciliation/breaks/:id/resolve` workflow or daily unclaimed report UI** | `src/reconciliation/reconciliation.service.ts` 300+ lines, `src/reconciliation/reconciliation.controller.ts:10 GET report`, `grep breaks src/reconciliation` → report only, `test/migration-chain` checks 66 but not resolve | Reports calculate, but no operational break investigation/resolution workflow, no Finance UI for `unclaimed` liability `SUM`. | Finance Platform B2; P2 reporting (not blocking ledger) |

*Metadata-only = config/calculator/report exists, but not yet wired into runtime money flow or actor self-service.*

---

## 9. Not Implemented Requirements

**For V1 core money + operations, after fda0860 there are 0 pure NOT IMPLEMENTED (no entity/service/route/migration at all) — the previous 5 (funding, support, inbox, notifications, funding history) are now COMPLETE.** The only strictly NOT IMPLEMENTED items that remain are **V2/outside-V1** (see §10) and **hardening that is intentionally deferred** (read/unread, phone change OTP). If counting hard intimately-V1-but-missing, it is 0; if counting product-decision items as NOT IMPLEMENTED, see §6 P4 (phone change OTP) which is by design.

For completeness, historically NOT IMPLEMENTED before fda0860 that are now resolved:
- Customer funding maker/checker (was 0, now +0063, service, controllers, tests) → **now COMPLETE**
- Support ticket lifecycle (was 0, now +0064, 3 controllers, entity, service) → **now COMPLETE**
- Notification inbox `customers/me/notifications` (was 0, now fda0860 inbox) → **now COMPLETE**

**Current NOT IMPLEMENTED count for V1 launch-blockers: 0.**

---

## 10. V2/Out-of-Scope Requirements

Per product boundary (wallet→Bank etc. explicitly OUT OF SCOPE), **12 capabilities are correctly NOT implemented and must remain so for V1:**

| Capability | Why V2/Out-of-Scope | Evidence it is NOT reintroduced |
|------------|---------------------|----------------------------------|
| Wallet→Bank (customer/merchant withdrawal to external account) | External bank movement is outside V1 ledger; V1 only credits wallet internally after external receipt | `grep -rn BankService src --include=*.ts` 0, `grep -rn nibss src --include=*.ts` → only `src/operations/partner-callbacks` internal `SERVICE` `partner:callback:receive` not V1 Bank, `test/a25` `Q`/`S` (no `BankService/nibss/ProviderAdapter` in `customer-app`) |
| Bank→Wallet via live provider (auto-credit) | External bank callback→wallet auto-credit is provider adapter, not V1 maker/checker | Same: `src/partner-callbacks` exists but V1 funding is manual maker/checker, not live provider |
| NIBSS integration (NIP/ess) | External settlement network | `grep -rn NIBSS src --include=*.ts` only in `partner-callbacks` comments, not in V1 `customer-funding` |
| Wema/Providus/NinePSB dedicated adapter | Specific bank provider | `grep -rn Wema\|Providus\|NinePSB src` 0 |
| External settlement providers reconciliation | Third-party settlement | `src/b2f-*` finance control exists but external provider settlement is `src/operations/external-settlement` B2F, not V1 |
| Cards (physical/virtual) | Card issuance | `grep -rn card src --include=*.ts` only `card` in `ledger` comments, no `src/card` module |
| Dollar cards | FX | `grep -rn dollar src --include=*.ts` 0 |
| Bills / Airtime / Data / Electricity / Cable / Betting | Commercial products | `grep -rn bills\|airtime src` 0, `src/migrations/1785753600002-CreatePaymentCapabilities` is `payment_capabilities` metadata, not bills engine |
| Non-NGN currency | V1 is NGN only | All ledgers `currency NGN`, `WalletAccount` `currency NGN`, `Transfer` `currency NGN`, `CustomerFunding` NGN only |
| Provider-backed Virtual Accounts (auto-vN) | Requires bank virtual account pool | `src/virtual-account/virtual-account*` may exist but is not V1 customer funding (funding is manual) — correctly not exposed via Customer App |
| External-provider callback auto-reconciliation | Auto settlement | `src/operations/partner-callbacks` is `SERVICE` only, not V1 |
| Second ledger / second balance column | Ledger remains authoritative | `grep balanceMinor src/wallet/wallet-account.entity.ts` 0 (no `balanceMinor` column, ledger-derived `SUM`), `WalletService` never `UPDATE wallet SET balance` |

**These are correctly OUT OF SCOPE and must remain so until V2 product decision.**

---

## 11. End-to-End Journey Matrix

For every major V1 journey, evaluate 10 steps (1 initiate, 2 authorize, 3 ledger, 4 idempotent, 5 concurrency, 6 auditable, 7 history visible, 8 support/admin operable, 9 notifications, 10 failure states). **Do not confuse backend primitive with end-to-end.**

| Journey | 1 Initiate | 2 Authorize | 3 Ledger | 4 Idempotent | 5 Concurrency | 6 Auditable | 7 History visible | 8 Support/Admin | 9 Notifications | 10 Failure | Overall |
|---------|------------|-------------|----------|--------------|---------------|-------------|-------------------|-----------------|-----------------|------------|---------|
| **CUST W→W** `POST /customers/me/transfers` | ✅ `POST /customers/me/transfers` + `RecipientResolution` | ✅ SELF + `CustomerTransactionPinService` PBKDF2 | ✅ `postJournalInTransaction` DEBIT/CREDIT CUSTOMER_FUNDS NGN SERIALIZABLE | ✅ `Idempotency-Key` + `requestHash` `uq_transfers_idempotency_key` 409 | ✅ SERIALIZABLE retry `40001`/`40P01` + `ORDER BY id` lock | ✅ `AuditService` + `outbox_events` | ✅ `GET /customers/me/transfers|transactions/:id` safe counterparty batch (A25) | ✅ `GET /internal/transfers/:id` + `support_tickets` linkable | ✅ `transfer.completed` → `notification_deliveries` (W→W both) → inbox | ✅ `422 INSUFFICIENT_FUNDS`, `409` idempotency, `400` validation, ledger balance unchanged on fail | **COMPLETE** |
| **AGENT Cash→Wallet** `POST /agents/cash-in` | ✅ `POST /agents/cash-in` | ✅ AGENT SELF + `AgentTransactionAuthorization` PIN + `AgentServiceCapability` CASH_IN | ✅ DEBIT `AGENT_FUNDING_POOL` CREDIT customer ledger SERIALIZABLE | ✅ `idempotencyKey` `uq_agent_idempotency` | ✅ SERIALIZABLE + `pessimistic_write` | ✅ audit + outbox `cash_in.completed` | ⚠️ Customer sees via `GET /customers/me/wallets/:id/balance` + funding? but not via `GET /customers/me/transfers` (transfers only W→W) — **PARTIAL** (split) | ✅ `GET /internal/agents/:id/financial-position`? Actually `GET /agents/me/financial-position` + `GET /internal/agents/funding` + support | ✅ `cash_in` event → notification | ✅ `NOT_FOUND` ineligible, `Forbidden` capability, lockout | **PARTIAL** (history split, money OK) |
| **AGENT Wallet→Cash** `POST /agents/cash-out` | ✅ `POST /agents/cash-out` | ✅ AGENT SELF + PIN + capability CASH_OUT | ✅ DEBIT customer CREDIT agent funding pool | ✅ idempotency | ✅ SERIALIZABLE | ✅ audit + outbox | ⚠️ Same split (customer passive) | ✅ support | ✅ `cash_out` | ✅ similar | **PARTIAL** |
| **AGENT Cash→Cash** `POST /agents/cash-to-cash` → claim → expiry | ✅ `POST /agents/cash-to-cash` (UNCLAIMED) + `POST /agents/cash-to-cash/claim` `transfer_code_hash` PBKDF2 lockout 5 + `AgentCashToCashExpiryService` sweep EXPIRED | ✅ AGENT SELF + capability | ✅ DEBIT agent CREDIT `CASH_TO_CASH-UNCLAIMED-NGN` then DEBIT unclaimed CREDIT beneficiary wallet or DEBIT unclaimed CREDIT agent on expiry | ✅ `uq_agent_idempotency` + `transfer_code` idempotency | ✅ SERIALIZABLE claim + `failedAttempts` | ✅ audit + outbox `cash_to_cash.claimed|expired` | ⚠️ `GET /customers/me/transfers` **does not** include UNCLAIMED/CLAIMED (A25 limitation documented) — **PARTIAL** | ✅ `GET /internal/cash-to-cash` + sweep + support `CASH_TO_CASH` | ✅ `cash_to_cash` → notification | ✅ `EXPIRED` sweep, `PIN_LOCKED`, `NOT_FOUND` | **PARTIAL** (money complete, customer history not unified) |
| **OPS → CUST Funding** `POST /internal/customers/:id/funding-requests` → `POST .../approve` | ✅ `POST /internal/customers/:id/funding-requests` SUPPORT + `POST .../approve` OPERATOR | ✅ SUPPORT maker, OPERATOR checker, `maker≠checker`, `SUPPORT/OPERATOR/PRIVILEGED` | ✅ `postJournalInTransaction` DEBIT `FUNDING_POOL` (AR_CONTROL `CUSTOMER-FUNDING-POOL-NGN`) CREDIT customer ledger | ✅ `Idempotency-Key` + `uq_customer_funding_requests_idempotency` 409 | ✅ SERIALIZABLE | ✅ `AuditService` + `outbox funding.approved/rejected` | ✅ `GET /customers/me/funding-history|funding-requests` SELF + `GET /internal/customer-funding-requests` | ✅ `GET /internal/customer-funding-requests` + support `FUNDING` + admin | ✅ `customer.funding.approved/rejected` → inbox | ✅ `400` validation, `404` not-found, `409` diff amount, `403` maker≠checker, `422`? ledger balance unchanged on reject | **COMPLETE** (new V1-001) |
| **CUST → CUST via Cash (receive)** | Passive via above Cash→Wallet / Cash→Cash claim | — | — | — | — | — | ⚠️ via balance, not transfer list | ✅ support | ✅ notification | — | **PARTIAL** (same history split) |
| **CUST Funding History** | ✅ `GET /customers/me/funding-history` | ✅ SELF | — | — | — | ✅ audit | ✅ self | ✅ internal list | ✅ notification | ✅ status REQUESTED→APPROVED/REJECTED | **COMPLETE** |
| **CUST Notification Inbox** | ✅ `GET /customers/me/notifications?page&limit` | ✅ CUSTOMER SELF (401/403) | — | — | — | — | ✅ list, pagination, order | — | — | ✅ `400` invalid pagination, `SKIPPED` hidden, `FAILED`→`AVAILABLE` | **COMPLETE** (list, read/unread deferred) |
| **CUST Support** `POST /customers/me/support/tickets` | ✅ `POST /customers/me/support/tickets` + `GET /tickets|tickets/:id|messages` | ✅ SELF + transaction linkable via `relatedTransferId|fundingRequestId` | — | — | — | ✅ `support_tickets` version + `support_ticket_messages` immutable + `audit` | ✅ `GET /customers/me/support/tickets` | ✅ `POST /internal/support/tickets/:id/assign|status|resolve|close|messages` SUPPORT + `GET /internal/support/tickets` | ✅ `support.ticket.created|assigned|resolved|closed|message_added` → notification (isInternal filtered) | ✅ `400` validation, `404` generic, `403` not owner | **COMPLETE** |
| **AGENT Support** `POST /agents/support/tickets`? Actually `POST /agents/me/support/tickets` via `support-agent.controller.ts` | ✅ `POST /agents/support/tickets`? Actually `src/support/support-agent.controller.ts:28 POST tickets` under `agents` | ✅ AGENT SELF | — | — | — | ✅ | ✅ | ✅ internal | ✅ | ✅ | **COMPLETE** |
| **Admin Agent Lifecycle** `POST /internal/admin/agents/:id/suspend` | ✅ `POST /internal/admin/agents/:id/suspend|terminate|reactivate|activate` + legacy `/internal/agents/:id/*` | ✅ `OPERATOR/SERVICE/PRIVILEGED` (SUPPORT denied) via `RoutePolicyRegistry` | ✅ status `ACTIVE→SUSPENDED etc.` versioned, `audit` | — | — | ✅ | — | — | — | **COMPLETE** |
| **Wallet Balance** `GET /customers/me/wallets/:id/balance` | ✅ `GET /customers/me/wallets/:id/balance` | ✅ SELF | ✅ ledger-derived `SUM` | — | — | — | ✅ self | ✅ internal `GET /internal/ledger/accounts/:id/balance` | — | — | **COMPLETE** |
| **Identity/Profile** `PATCH /customers/me/profile` | ✅ `GET /customers/me/profile` + `PATCH /customers/me/profile` `displayName` | ✅ SELF | — | — | — | ✅ `PROFILE_UPDATED` | ✅ | ✅ | ✅ `profile updated`? (notif) | ✅ `400` whitelist, `404` generic | **COMPLETE** |

*Overall V1 money lifecycle (initiate→ledger→history) is COMPLETE; splits are history unification, not money loss.*

---

## 12. Security Gap Matrix

| Mechanism | Implementation | Evidence | Status | Gap / Hardening |
|-----------|----------------|----------|--------|-----------------|
| **Customer auth vs transaction auth** | Session `PBKDF2` + lockout vs `CustomerTransactionPin` PBKDF2 separate secrets, `POST /customers/me/transfers` requires `pin` verified before `postJournal` | `src/customer-authentication/authentication-session.service.ts` 32B token, `src/customer/customer-transaction-pin.service.ts` MAX_FAILED 5, `src/customer-app/customer-app.controller.ts:505` pin check before `transferService.createTransfer` | **COMPLETE** | None: separation enforced (auth token ≠ pin), pin not in requestHash |
| **Customer PIN** | PBKDF2$sha256$10000, timingSafeEqual, lockout 5, `POST /customers/me/transaction-pin` set/verify, `POST /customers/me/transaction-pin/verify` | `test/a24` 19/19 lockout, `src/customer/customer-transaction-pin.service.ts` | **COMPLETE** | None |
| **Agent PIN** | `AgentTransactionPin` + `AgentTransactionAuthorizationService` + `AgentTransactionPinService`, lockout, `POST /agents/cash-in` requires pin | `src/agent/agent-transaction-authorization.service.ts`, `test/a11`+`a14-otp-hardening` | **COMPLETE** | None |
| **OTP (MFA)** | `MfaEnrollment` + `MfaChallenge` + `TrustedDevice` + `RecoveryCode` backend, PBKDF2, `MfaExecutionService`, workforce `POST /customers/:id/mfa-enrollments`, **no `POST /customers/me/mfa` self** | `src/customer-authentication/mfa-*` 6 files, `grep mfa src/customer-app` 0 | **BACKEND-ONLY** | Hardening: expose `POST /customers/me/mfa` self-service if V1 requires customer-initiated MFA (currently workforce-enrolled suffices) |
| **Session controls** | `AuthenticationSession` sha256, 32B, `audience` `customer-api`, `status` ACTIVE/REVOKED/EXPIRED, `issue/validate/revoke/rotate/revokeAllForCredential` TTL 3600, `POST /customers/sessions/logout` + `revokeAll` | `src/customer-authentication/authentication-session.service.ts`, `test/a26` logout + sessions safe | **COMPLETE** | None |
| **Authorization boundaries** | `RoutePolicyRegistry` 321 lines: `customers/me/*` CUSTOMER SELF, `agents/me/*` AGENT SELF, `internal/*` SUPPORT/OPERATOR/SERVICE/PRIVILEGED, `customers/:id/*` internal vs `customers/me` SELF distinction, `RuntimeAccessGuard` + `AuthorizationService` | `src/authorization/route-policy-registry.ts`, `src/authorization/runtime-access.guard.ts`, `test/runtime-access.guard.spec.ts` | **COMPLETE** | None |
| **Sensitive-data redaction** | `SENSITIVE_KEY_NAMES` `password,currentPassword,newPassword,pin,tokenHash...` + `pinoHttp.redact` `req.body.currentPassword/newPassword` + `req.body.pin` + `redactRecord` + `SENSITIVE_DATA_REDACTION` | `src/common/sensitive-data-redaction.ts`, `src/app.module.ts` `redact.paths`, `test/a26` audit no secrets, `test/v1-005` payload redacted | **COMPLETE** | None |
| **Idempotency** | `Idempotency-Key` header mandatory, requestHash `sha256(sorted business params)` excludes pin/password, `uq_*` 23505 409, `requestHash` mismatch 409, same key same hash replay returns same id | `src/transfer/transfer.service.ts:requestHash`, `test/a24` idempotency, `test/v1-001` funding idempotency | **COMPLETE** | None |
| **Replay protection** | Idempotency + `lastError` not exposing secrets, `pin` not in requestHash | Same | **COMPLETE** | None |
| **Concurrency** | `DataSource.transaction('SERIALIZABLE')` + retry `40001`/`40P01` 3 attempts + deterministic lock `ORDER BY id` `pessimistic_write` | `src/transfer/transfer.service.ts:executeWithinTransaction`, `test/v1-001` concurrent approvals 1 credit | **COMPLETE** | None |
| **Audit** | `AuditService` immutable `audit_events` + `AuditController` `GET /internal/audit/events`, `Support`/`Transfer`/`Funding` audit no secrets, `version` optimistic | `src/operations/audit.service.ts`, `test/a26` `PROFILE_UPDATED` without secrets | **COMPLETE** | None |

*Overall security: COMPLETE except MFA self-service (backend-only, intentionally workforce-enrolled for V1). No overdraft, no bypass, no PIN in logs, no cross-principal leak (walletIds 404 generic).*

---

## 13. Notification Gap Matrix

| Aspect | Provider-neutral delivery architecture (A) | Development/test delivery (B) | Actual production SMS (C) | Actual production Push (D) | Status |
|--------|--------------------------------------------|-------------------------------|---------------------------|----------------------------|--------|
| **Architecture** | `OutboxService` → `NotificationDispatcherService` (INSERT ON CONFLICT, SKIPPED/FAILED isolated, no second outbox) → `NotificationChannelResolver` (Customer PHONE via `customer_contact_methods` normalized_value, Push/Agent phone SKIPPED) → `NotificationProvider` interface | `ConsoleNotificationProvider` (`console.log` + `sent[]`, providerRef `console-…`) + `TestNotificationProvider` (`sent[]`, `shouldFail` toggle) — no invented credentials/API keys | **External Termii/Twilio/Africa's Talking HTTP adapter** (requires `SMS_API_KEY`, HMAC, callback ingress) | **FCM/APNS token model** (`push_device_tokens` table, device registration `POST /customers/me/push-tokens`, entitlement check `notification_push_enabled`) | **A: COMPLETE** (66, 13-entry catalogue, `isInternal` filter, redacted payload), **B: COMPLETE** (dev/test verified via `TestNotificationProvider`), **C: NOT IMPLEMENTED (external dependency)**, **D: NOT IMPLEMENTED (no push_tokens table)** |
| **Event coverage** | 13 entries: `customer.funding.approved/rejected`, `transfer.completed`, `support.ticket.created/assigned/status_changed/resolved/closed/message_added`, `cash_to_cash.claimed/expired`, `agent.*` lifecycle (Push/SMS both, Push possible false fallback SKIPPED) | Same: `TestNotificationProvider` receives `transfer.completed` both, funding approved, support 5, `isInternal` filtered, `PUSH_TOKEN_DEPENDENCY_MISSING` SKIPPED | Same events, but **actual SMS delivery** to `801…` via Termii not yet — requires `SMS_PROVIDER_TOKEN` + `NOTIFICATION_PROVIDER_TOKEN` override + `providerRef` real | Same: Push `sent[]` but not to FCM; needs device token table + `POST /customers/me/push-tokens` + `notification_push_enabled` filter | **V1 event coverage: COMPLETE for provider-neutral; actual provider delivery: PENDING** |
| **Preferences** | `customer_preferences.notification_push_enabled` (metadata) + `customer_preferences.notification_sms_enabled` etc., but Customer App has **no `PATCH /customers/me/preferences`** | Same | Same: SMS may need opt-in/out runtime gate (currently SMS always attempted if phone exists) | Same: Push `notification_push_enabled` respected only for Push (SKIPPED if false) but no `push_tokens` so SKIPPED anyway | **METADATA-ONLY** (table + service, not Customer App runtime) |
| **Inbox** | `notification_deliveries` reused, `GET /customers/me/notifications` list paginated safe, `SKIPPED` hidden, `FAILED→AVAILABLE`, `isInternal` never, channel `IN_APP` | Same (test 23/23 via Test) | Same inbox (provider failure still AVAILABLE) | Same | **COMPLETE for list** (V1-006), **read/unread deferred** (no `PATCH .../read`, no `read_at`) — documented |

**Distinction:** Do **not** mark C/D complete merely because `notification_deliveries` exists. `notification_deliveries` = **GENERATED vs DISPATCHED vs PROVIDER DELIVERY** (outbox PENDING → `notification_deliveries` SENT + `provider_ref` → provider). `b` distinguishes via `providerRef` `test-…` vs `console-…`; `c/d` require external `providerRef` real.

**Remaining provider-dependent:** `C` needs Termii adapter (env `SMS_API_KEY` + `NOTIFICATION_PROVIDER_TOKEN` override + `src/notification/sms.provider.ts`), `D` needs `push_device_tokens` entity + migration `CreatePushDeviceTokens` + `POST /customers/me/push-tokens` + resolver query + `POST /agents/me/push-tokens` if Agent push.

---

## 14. Support Gap Matrix

| Capability | Customer creation | Transaction linking | Agent tickets | Internal messages | Assignment | Status lifecycle | Admin servicing | History/audit | Authorization | Status |
|------------|-------------------|---------------------|---------------|-------------------|------------|------------------|-----------------|---------------|---------------|--------|
| **Customer tickets** | `POST /customers/me/support/tickets` SELF (category TRANSFER/FUNDING/WALLET/CASH_IN/OUT/CASH_TO_CASH/PROFILE/PIN/OTHER, subject 200, description 4000, relatedTransferId/fundingRequestId) | ✅ `relatedTransferId` + `fundingRequestId` indexed (`idx_support_tickets_transfer/funding_request`) | — | ✅ `POST /customers/me/support/tickets/:id/messages` SELF (isInternal filtered at dispatch) | — | ✅ `OPEN→IN_PROGRESS→RESOLVED→CLOSED` via `POST /internal/support/tickets/:id/status|resolve|close` | ✅ `GET /customers/me/support/tickets|tickets/:id|messages` safe | ✅ `support_tickets` version + `support_ticket_messages` immutable + `audit_events` | ✅ CUSTOMER SELF | **COMPLETE** |
| **Agent tickets** | `POST /agents/support`? Actually `POST /agents/me/support/tickets` via `support-agent.controller.ts:28 POST tickets` AGENT SELF | ✅ `agentId` + `customerId` nullable, `CASH_TO_CASH` etc. | ✅ `POST /agents/support/tickets` + `GET /tickets` | ✅ `POST /agents/support/tickets/:id/messages` | — | ✅ same | ✅ `GET /agents/support/tickets` etc. | ✅ | ✅ AGENT SELF | **COMPLETE** |
| **Internal assignment** | — | — | — | — | ✅ `POST /internal/support/tickets/:id/assign` SUPPORT `assignedTo` | ✅ `POST /internal/support/tickets/:id/assign` → `IN_PROGRESS`, `POST .../status` with `status` enum, `POST .../resolve|close` | ✅ `GET /internal/support/tickets|tickets/:id|messages` | ✅ `POST /internal/support/tickets/:id/messages` (isInternal true filtered for notifications) | ✅ `SUPPORT/OPERATOR` WORKFORCE_SESSION | **COMPLETE** |
| **Admin servicing** | — | — | — | — | — | — | ✅ same as internal (admin is workforce) | — | — | **COMPLETE** (internal is admin surface) |
| **Overall support** | — | — | — | — | — | — | — | — | — | **COMPLETE** (360°: customer/agent/internal, transaction-linked, internal messages never notified, audit, pagination) |

**Support is truly operational end-to-end (not backend lifecycle only).** Previous audit's NOT IMPLEMENTED is now closed via V1-007 (`support_tickets` 0064 + 3 controllers + service). Specific question from STEP 8: customer creation ✅, transaction linking ✅ (funding/transfer), Agent support ✅, internal messages ✅ (isInternal true never → `notification_deliveries` 0), assignment ✅, status transitions ✅, admin servicing ✅ (workforce), history/audit ✅, authorization ✅.

---

## 15. Beneficiary Integration Status

**Merely a registry/lifecycle module, or actually integrated into V1 transaction journeys?**

**Answer: registry/lifecycle only — BACKEND-ONLY, not integrated into V1 transaction journeys.**

- **Exists:** `src/beneficiary/beneficiary.entity.ts` (`customer_beneficiaries` `1785753600013`: customerId, beneficiaryCustomerId/account, nickname, `isVerified`, `isActive`, `deletedAt`), `beneficiary.service.ts` create/list/update/soft-delete/verify + `ownership` + `history`, `beneficiary.enums.ts`, `beneficiary.controller.ts` `POST /beneficiaries` internal, `customer-beneficiary.customer-beneficiary.controller.ts` `POST :id/beneficiaries` `GET :id/beneficiaries` etc. internal (`customers/:id` not `customers/me`), tests `test/a*` may have beneficiary but not customer-me.
- **Not exposed to Customer App:** `grep -rn me/beneficiaries src` 0, `src/customer-app/customer-app.module.ts` does NOT import `BeneficiaryModule`/`CustomerBeneficiaryModule`, `POST /customers/me/transfers` `dto: {sourceWalletId, destinationWalletId, amountMinor, currency, pin}` has **no `beneficiaryId`** field, `src/transfer/transfer.service.ts:grep beneficiary` 0.
- **Not used in Recipient Resolution:** `RecipientResolutionService.resolve(identifier)` resolves `phone/receivingNumber` → `walletAccountId` via `customer_contact_methods` + `customer` + `wallet_accounts`, not via `customer_beneficiaries`. Beneficiary `isVerified` not checked in `TransferService`.
- **Customer App W→W still works without beneficiary:** via `destinationWalletId` (requires knowing walletId) or via `GET /customers/me/recipient?identifier=` (phone) → walletId. Recipient resolution is **actually integrated** (query `RecipientResolutionService`), beneficiary is not.
- **Security/audit:** Backend `BeneficiaryService` enforces `customerId==principal` ownership, lifecycle audit, but Customer App does not expose.
- **Dependency implication:** V1 `P1.6` Customer Beneficiaries is **not required** to initiate W→W (recipient resolution covers). Beneficiary is **UX polish** for trusted recipients (typeahead, `isVerified` badge). Recommended hardening is to **expose `GET/POST/PATCH /customers/me/beneficiaries` via thin controller over `BeneficiaryService` (SELF) and optionally allow `POST /customers/me/transfers` with `beneficiaryId` as alternative to `destinationWalletId` (resolve beneficiary → wallet, verify active/verified).** Do not invent new `beneficiaryId` on `Transfer` table unless product requires; transfer remains `sourceWalletId/destinationWalletId`.
- **Status: BACKEND-ONLY** (domain+service+internal controller, no Customer App surface, not integrated into transfer journey).

---

## 16. Admin/Operations Gap Matrix

| Capability | Current route/service | Expected V1 (finance/ops) | Evidence | Status | Gap |
|------------|----------------------|---------------------------|----------|--------|-----|
| **Customer servicing — read** | `GET /internal/customers` list + `GET /internal/customers/:id` profile | List/get | `src/admin/admin-customer.controller.ts:25 GET` `WORKFORCE_SESSION` SUPPORT/OPERATOR | **COMPLETE** (A22) | None |
| **Customer servicing — write (status)** | `PATCH /customers/:id` `SERVICE/PRIVILEGED` (internal `CustomerController`), **no `PATCH /internal/admin/customers/:id/status`** thin admin wrapper | Suspend/terminate customer? | `src/customer/customer.controller.ts:Patch :id updateStatus`, `grep admin.*customer.*status src/admin` 0 | **PARTIAL** (write exists via internal `customers/:id` but not via admin pane) | Admin pane not single; ops must know internal `customers/:id` route (low) |
| **Agent servicing — read** | `GET /internal/agents` + `GET /internal/agents/:id` | List/get | `src/admin/admin-agent.controller.ts:25 GET` | **COMPLETE** | None |
| **Agent servicing — lifecycle writes** | `POST /internal/admin/agents/:id/suspend|terminate|reactivate|activate` `OPERATOR/SERVICE/PRIVILEGED` + legacy `POST /internal/agents/:id/*` | Suspend/terminate via Admin | `src/admin/admin-agent-lifecycle.controller.ts:34 POST :id/suspend` V1-003, `src/agent/agent-lifecycle.controller.ts:19` legacy preserved | **COMPLETE** (V1-003) | None (both have same guard) |
| **Aggregator servicing — read** | `GET /internal/aggregators` + `GET /internal/aggregators/:id` | List/get | `src/admin/admin-aggregator.controller.ts` | **COMPLETE** | None |
| **Aggregator servicing — write** | `POST /internal/aggregators` `SUPPORT` create + `POST /aggregators/:id/suspend|reactivate|terminate` via `AggregatorController` | Create/suspend | `src/aggregator/aggregator.controller.ts:20 POST`, `48 POST suspend` | **COMPLETE** | None |
| **Funding maker/checker** | `POST /internal/customers/:id/funding-requests` SUPPORT maker + `POST .../approve` OPERATOR checker + `POST .../reject` + `GET /internal/customer-funding-requests` | Maker creates REQUESTED, checker approves REJECTED, journal, audit | `src/customer-funding/customer-funding-internal.controller.ts:30 POST funding-requests`, `57 POST approve`, `test/v1-001` 26/26 | **COMPLETE** (V1-001) | None |
| **Transaction/history visibility — internal** | `GET /internal/transfers/:id` + `GET /internal/ledger/journals/:id` + `GET /internal/customer-funding-requests/:id` | Ops see funding + transfers + ledger | `src/transfer/transfer.controller.ts`, `src/ledger/ledger.controller.ts:51 POST journals`, `src/customer-funding/customer-funding-internal.controller.ts:105 GET :id` | **COMPLETE** | None |
| **Lifecycle controls** | See Agent lifecycle above | Suspend/terminate via Admin | Same | **COMPLETE** | None |
| **Auditability** | `GET /internal/audit/events` + `audit_events` table, `MetricsService`, `DiagnosticsService` | Immutable audit, metrics | `src/operations/audit.service.ts`, `src/operations/metrics.service.ts`, `test/a22` | **COMPLETE** | None |
| **Operational reports — funding pool, unclaimed** | `GET /reconciliation/report|trial-balance|finance` readonly + `GET /internal/ledger/journals` + `GET /internal/cash-to-cash?status=UNCLAIMED` (?) Actually `GET /internal/cash-to-cash` not checked, but `GET /reconciliation/finance` exists, **no `POST /internal/reconciliation/breaks/:id/resolve`**, **no daily `GET /internal/finance/unclaimed-report`** workflow | Finance needs break investigation UI + unclaimed liability report | `src/reconciliation/reconciliation.controller.ts:10 GET report`, `grep breaks src/reconciliation` → report only, `grep unclaimed src/reconciliation` 0 | **PARTIAL / METADATA-ONLY** (reports exist, no resolve workflow) | P2 reporting, not blocking money |
| **Support servicing** | `GET /internal/support/tickets` + `POST .../assign|status|resolve|close|messages` SUPPORT | Ops assign/resolve | `src/support/support-internal.controller.ts:28 GET tickets`, `56 POST assign`, `test/v1-007` | **COMPLETE** | None |
| **Metrics/Diagnostics** | `GET /internal/metrics` + `GET /internal/diagnostics` | Ops metrics | `src/operations/metrics.service.ts` | **COMPLETE** | None |

**Admin/Operations overall: READ + LIFECYCLE + FUNDING + SUPPORT are COMPLETE; only operational reporting (reconciliation breaks/unclaimed) is PARTIAL/METADATA-ONLY (P2).**

---

## 17. Agent Operational Gap Matrix

| Capability | Route/service | Status | Evidence |
|------------|---------------|--------|----------|
| **Agent identity — onboarding/application** | `POST /agents/applications` AGENT_LOGIN + `POST /internal/agents/applications/:id/review` WORKFORCE | **COMPLETE** | `src/agent/agent-application-public.controller.ts`, `test/a8` |
| **Approval/activation** | `POST /internal/admin/agents/applications/:id/activate` OPERATOR → ACTIVE | **COMPLETE** | `src/admin/admin-agent-lifecycle.controller.ts:75 POST activate` |
| **Suspension/termination/reactivation** | `POST /internal/admin/agents/:id/suspend|terminate|reactivate|activate` OPERATOR | **COMPLETE** (V1-003) | Same |
| **Capabilities/services** | `AgentServiceCapabilityService.canPerform` + `AgentClassService` + `POST /internal/agents/classes` | **COMPLETE** | `test/a10`+`a11` |
| **Receiving number** | `POST /agents/me/receiving-number`? Actually `GET /agents/me/receiving-number` + `AgentReceivingNumberService` | **COMPLETE** | `src/agent/agent-receiving-number*`, `test/a9` |
| **Agent wallet/float — financial position** | `GET /agents/me/financial-position` AGENT SELF via `AgentFinancialExecutionService` ledger-derived | **COMPLETE** | `src/agent/agent-app.controller.ts:81`, `test/a12` |
| **Funding/defunding via Aggregator/platform** | `POST /internal/agents/:id/fund|defund` + `POST /internal/aggregators/:id/agents/:id/fund` via `AgentFundingService` (relationship + ACTIVE check + ledger) | **COMPLETE** | `src/agent/agent-funding.service.ts`, `test/a19` 15/15 |
| **Outlets — creation/assignment/lifecycle** | `POST /internal/aggregators/:id/agents/:id/outlets` + `POST /internal/agents/:id/outlets` + `GET /agents/me/outlets|terminals` + suspend/reactivate/terminate | **COMPLETE** | `src/outlet/outlet.controller.ts`, `test/a20` 15/15 |
| **Terminals — same** | Same as outlets via `AgentTerminal` | **COMPLETE** | Same |
| **Agent App backend journeys — auth + session** | `POST /agents/sessions` + `POST /agents/me/cash-in|cash-out|cash-to-cash` | **COMPLETE** | `test/a7`+`a13`+`a14`+`a15` |
| **Cash→Wallet (Agent initiates)** | `POST /agents/cash-in` AGENT SELF + `AgentTransactionAuthorization` + `RecipientResolution` + `AgentFinancialExecutionService` SERIALIZABLE | **COMPLETE** | `test/a13` |
| **Wallet→Cash (Agent initiates)** | `POST /agents/cash-out` | **COMPLETE** | `test/a14`+`a14-otp-hardening` |
| **Cash→Cash initiation + claim + expiry** | `POST /agents/cash-to-cash` + `POST /agents/cash-to-cash/claim` `transfer_code_hash` + `AgentCashToCashExpiryService` sweep | **COMPLETE** | `test/a15`+`a16`+`a17` |
| **Limits — capability** | `AgentServiceCapability` + `AgentClass.applicable_limits` | **COMPLETE** (capability) | `test/a10` |
| **Limits — runtime enforcement for Agent cash ops** | `AgentTransactionAuthorizationService` checks `AGENT_CLASS_INACTIVE` etc., but **amount limits not checked** (only capability) | **METADATA-ONLY** (class limits JSON, not enforced in `AgentCashIn` — only `SERVICE_NOT_PERMITTED`) | P1 product decision: limits enforcement via A4 policy vs class |
| **Commissions — calculation** | No `CREDIT agent commission` posting (fee 0) | **METADATA-ONLY** (fee engine flat+%, not wired) | V2 commercial |
| **Transaction/history visibility — Agent** | `GET /agents/me/wallets/:walletId/transactions` wallet-scoped + `GET /agents/me/financial-position` | **PARTIAL** (wallet-scoped, not unified `GET /agents/me/transfers` with counterparty) | P2 hardening |
| **Claim support where applicable** | Cash→Cash claim via `POST /agents/cash-to-cash/claim` (any Agent, PBKDF2) | **COMPLETE** | `test/a16` 32 tests |
| **Notifications — Agent inbox** | **No `GET /agents/me/notifications`** — `notification_deliveries` exists for Agent but not exposed via Agent App | **BACKEND-ONLY** (delivery exists, inbox not) | P2 (mirrors Customer inbox) |
| **Support — Agent tickets** | `POST /agents/support/tickets`? Actually `POST /support/agent/tickets` via `support-agent.controller.ts` | **COMPLETE** (V1-007) | `src/support/support-agent.controller.ts` |

**Agent operational overall: Cash and lifecycle journeys are COMPLETE for V1 money; remaining gaps are commission/limit runtime (metadata), unified history (partial), Agent inbox (backend-only).**

---

## 18. Customer Operational Gap Matrix

| Capability | Route/service | Status | Evidence |
|------------|---------------|--------|----------|
| **Identity/profile — CRUD** | `POST /customers` internal + `GET /customers/me/profile` + `PATCH /customers/me/profile` `displayName` + `GET /customers/me/status` + KYC `GET :id/kyc` internal | **COMPLETE** (profile via A26) | `test/a26` 19/19 |
| **Authentication — login/sessions** | `POST /customers/sessions|login` + `POST /customers/sessions/logout` + `GET /customers/me/sessions` safe | **COMPLETE** | `test/a23`+`a26` |
| **Customer transaction PIN — set/verify/lockout** | `POST /customers/me/transaction-pin` + `verify` PBKDF2 lockout 5 | **COMPLETE** (A24) | `test/a24` 19/19 |
| **Receiving identity — read** | `GET /customers/me/receiving-identity|receiving-number` + `GET /customers/me/recipient?identifier=` | **COMPLETE** (read-only, A26 documents phone not editable via PATCH) | `test/a26` |
| **Recipient resolution — phone → wallet** | `RecipientResolutionService.resolve` (CUSTOMER PHONE, Agent) | **COMPLETE** | `src/agent/recipient-resolution.service.ts` |
| **Beneficiary/trusted-recipient — Customer App** | `POST :id/beneficiaries` internal only, **no `GET/POST /customers/me/beneficiaries`** | **BACKEND-ONLY** | `grep me/beneficiaries 0` |
| **Wallet balance — ledger-derived** | `GET /customers/me/wallets|wallets/:id|balance|financial-position` | **COMPLETE** | `test/a23` wallets |
| **Wallet history — transfers** | `GET /customers/me/transfers?page&limit` + `GET .../transfers/:id` safe counterparty batch (A25) | **COMPLETE** | `test/a25` 17/17 |
| **Wallet→Wallet — transfer** | `POST /customers/me/transfers` + Idempotency-Key + pin | **COMPLETE** | `test/a24`+`a25` |
| **Customer Wallet→Cash through Agent** | Passive: Agent `POST /agents/cash-out` debits customer; customer sees via balance, **no `POST /customers/me/cash-out`** (by design, Agent-driven) | **COMPLETE** (Agent-driven, customer passive) | `test/a14` |
| **Cash→Wallet through Agent** | Passive: Agent `POST /agents/cash-in` credits customer; customer sees via balance, **no `POST /customers/me/cash-in`** (Agent-driven) | **COMPLETE** | `test/a13` |
| **Cash→Cash — create via Agent** | `POST /agents/cash-to-cash` (AGENT) — customer is beneficiary, not creator | **COMPLETE** (Agent creates UNCLAIMED) | `test/a15` |
| **Cash→Cash — claim via Customer App** | **No `POST /customers/me/cash-to-cash/claim`** — claim is `POST /agents/cash-to-cash/claim` via Agent with `transfer_code` | **PARTIAL** (backend claim via Agent only) | `src/agent/agent-cash-to-cash-claim.controller.ts:17 POST cash-to-cash/claim` (agents), not customers |
| **Funding request/history — maker/checker + customer view** | `POST /internal/customers/:id/funding-requests` SUPPORT + `POST .../approve` OPERATOR + `GET /customers/me/funding-history|funding-requests` SELF | **COMPLETE** (V1-001) | `test/v1-001` 26/26 |
| **Notifications — inbox + delivery** | `GET /customers/me/notifications` list paginated safe (V1-006) + `outbox` → dispatcher (V1-005) but **no `PATCH .../read`**, **no Push SMS provider** | **COMPLETE for list** (V1-006), provider-neutral console/test | `test/v1-006` 23/23 |
| **Support tickets — customer** | `POST /customers/me/support/tickets` + `GET .../tickets|tickets/:id|messages` + internal messages | **COMPLETE** (V1-007) | `test/v1-007` |
| **Relevant settings/security — preferences, password, sessions** | `POST /customers/me/password` + `GET /customers/me/sessions` + `PATCH /customers/me/profile` + `POST .../transaction-pin` + **no `PATCH /customers/me/preferences`** | **PARTIAL** (preferences `notification_push_enabled` not Customer App) | `grep preferences src/customer-app` 0 |
| **Dashboard** | `GET /customers/me/dashboard` | **COMPLETE** | `src/customer-app/customer-app.controller.ts:790 GET dashboard` |

**Customer operational overall: Money (W→W, funding, balance, PIN, profile, history, support, notifications list) is COMPLETE; remaining backend-only/partial are beneficiary trusted recipients, cash→cash customer claim, preferences runtime, phone change OTP (by design).**

---

## 19. Dependency Graph/Order

**Critical path after fda0860 (no new P0 money gap):**

```
[COMPLETE] V1-001 Funding (66) ──→ V1-005 Notifications delivery (66) ──→ V1-006 Inbox list (fda0860, 0 migrations)
       │
       └─→ V1-007 Support (0064) ──────────┘

[COMPLETE] V1-003 Admin lifecycle (0) ──→ A22 Admin read
[COMPLETE] A21-A26 Customer/Agent foundations (63) ──→ V1 core

Remaining hardening (no new ledger, 0 migrations required unless read/unread):
  H1: Customer Beneficiary Customer App Exposure (BACKEND-ONLY → COMPLETE) — depends: none (uses 0013)
       |
  H2: Reconciliation Operationalization (report → break workflow) — depends: ledger (COMPLETE)
       |
  H3: Agent Unified History + Customer Wallet History Unification — depends: A25 pattern (COMPLETE)
       |
  H4: Preferences Runtime `PATCH /customers/me/preferences` — depends: notification_push_enabled (0014)
       |
  H5: Notification Read/Unread (`PATCH .../read` + read_at) — depends: V1-006 (0→1 migration if added)
       |
  H6: Fees/Limits Runtime via A4 Policy Gate — depends: Policy A4 + internal-transfer-gate (requires wiring)
```

**No new ledger, no external provider, no second balance required for next hardening.** All H1-H4 are thin controllers over existing services/entities (reuse), H5 would be 1 additive column `read_at TIMESTAMPTZ` (+ index) if product requires, H6 requires wiring `TransferService` through `internal-transfer-gate` (existing) rather than new table.

**Ordering rationale:** H1 (beneficiary) has zero dependencies and highest UX value for repeat W→W; H2 (reconciliation) is Finance-ops dependent but not user-facing; H3/H4 are polish; H5 is deferred per V1-006 report; H6 is policy decision (if V1 fees 0, defer).

---

## 20. Recommended Next Implementation Task

**`V1-HARDENING-01 Customer Beneficiary Customer App Exposure & Transfer Integration`**

*Thin hardening of existing backend-only Beneficiary domain — no new ledger, no new money engine, no external provider, no migration required (reuse `customer_beneficiaries` 0013).*

---

## 21. Why That Task Is Next

1. **Highest-priority *hardening* that is actually supported by repository evidence:** `customer_beneficiaries` table `1785753600013` + `BeneficiaryService` (400+ lines, `createBeneficiary`/`listBeneficiaries`/`update`/`verify` + ownership + audit + `isVerified`/`isActive`/`deletedAt`) + `BeneficiaryController`/`CustomerBeneficiaryController` (`POST :id/beneficiaries` internal) exist, but `grep -rn me/beneficiaries src` = 0 and `grep beneficiary src/transfer` = 0 — domain is **backend-only**, not integrated into the intended V1 `P1.6` trusted-recipient UX. No new migration, no new ledger, no external dependency — it is a *hardening* of an already-migrated capability, per STEP 10 instruction to harden before introducing unrelated new functionality.
2. **Zero new external dependency and zero new financial risk:** Does not introduce `Wallet→Bank`, NIBSS, cards, bills, or second balance. It reuses `BeneficiaryService` and `AuditService` and `RoutePolicyRegistry` `customers/me/*` `CUSTOMER SELF`.
3. **Removes the last V1 `P1.6` UX gap without blocking money:** W→W currently requires `destinationWalletId` (or phone→recipient resolution). Trusted recipients eliminate typing walletId/phone for repeat payees — the exact V1 product expectation for `P1.6` — but money movement already works via `RecipientResolutionService`, so this is *polish* that is product-visible, unlike reconciliation reporting (ops-only) or fee wiring (commercial decision).
4. **Deterministic acceptance criteria and testable in isolation:** All required primitives exist (`beneficiary.entity.ts`, `beneficiary.service.ts`, `customer-beneficiary.service.ts`), so acceptance is precise (routes, SELF checks, safe projection, optional `beneficiaryId` in `POST /customers/me/transfers`).
5. **Dependency-order optimal:** No dependency on funding/support/notifications (already COMPLETE), no dependency on reconciliation or fees. Can be implemented in parallel with any other H-task, but is the most user-facing hardening.
6. **Not invented to keep roadmap moving:** The domain was explicitly listed as BACKEND-ONLY in §7 and §15 with repository evidence; hardening it is explicitly demanded by STEP 10 “If an existing implementation is incomplete, recommend hardening/integration of that existing capability before introducing unrelated new functionality.” Alternative (inventing a new Wallet→Bank provider) would violate V1 product boundary.

If product decides `beneficiary` is V2 (recipient resolution suffices), fallback next is **`H2 Reconciliation Operationalization`** (`GET /internal/reconciliation/breaks` → resolve workflow) with same 0-migration hardening rationale, or **`H4 Preferences Runtime`** (`PATCH /customers/me/preferences`).

---

## 22. Exact Acceptance Criteria for the Next Task

**`V1-HARDENING-01 Customer Beneficiary Customer App Exposure & Transfer Integration`**

*No migration (reuse `1785753600013`). No ledger change. No new external provider.*

1. **Route `GET /customers/me/beneficiaries`** — `CUSTOMER SELF` (RoutePolicyRegistry `customers/me/*` → 401 unauth, 403 agent), pagination `page parseInt 1 limit 20 bounds 1..100` deterministic `createdAt DESC id DESC` (reuse A23/A25 pattern, avoid N+1), returns safe projection `{id, nickname, beneficiaryCustomerId, displayName, receivingNumber, isVerified, isActive, createdAt}` — **MUST NOT** include `transferCode`, `ledger`, `journal`, `hash`, `pin`, `otp`, `correlationId`, `token`. No financial history. Tests: own vs other isolation, forged `?customerId=`, agent 401|403, unauth 401, internal `SUPPORT` not able to list via `me`.
2. **Route `POST /customers/me/beneficiaries`** — body `{nickname 1-100, beneficiaryIdentifier (phone/receivingNumber) or beneficiaryCustomerId UUID}` → `BeneficiaryService.createBeneficiary(customerId, dto)` (reuse, ownership `customerId==principal`, `isVerified` via existing verification flow, `isActive=true`, `deletedAt` null, audit `BENEFICIARY_CREATED` without secrets). Whitelist, `BadRequest` on invalid identifier, `Conflict` on duplicate nickname/active. No ledger side effects. Tests: create → list, duplicate nickname 409, invalid identifier 400, other customer's beneficiary not visible.
3. **Route `PATCH /customers/me/beneficiaries/:beneficiaryId`** — update `nickname`/`isActive` (soft-toggle), `BeneficiaryService.updateBeneficiary` (ownership check principal.customerId, version optimistic), audit `BENEFICIARY_UPDATED`. `404` generic if not owner. Tests: owner can patch, other cannot (404/403), deleted not returned.
4. **Route `GET /customers/me/beneficiaries/:beneficiaryId`** — single safe projection same as list, SELF 404 generic. Tests: own vs other, deleted 404.
5. **Transfer integration — `POST /customers/me/transfers` optional `beneficiaryId`:** Accepts **either** `destinationWalletId` **or** `beneficiaryId` (mutually exclusive, at least one required, whitelist). If `beneficiaryId` provided, resolve via `BeneficiaryService.getBeneficiary(principal.customerId, beneficiaryId)` → verify `isActive && isVerified && !deletedAt && customerId==principal`, then `beneficiaryCustomerId` → `wallet_accounts` `ledger_account_id` → `destinationWalletId` (reuse existing `ensureWalletAccount` logic). Existing `destinationWalletId` path unchanged. `beneficiaryId` not persisted on `Transfer` (transfer remains `sourceWalletId/destinationWalletId`), no new column. Tests: beneficiaryId valid → succeeds with same journal as direct walletId, inactive/not-verified/wrong owner → 400/404, agent 403, pin still required.
6. **Authorization — no `?customerId=` trust:** All `me/*` routes scoped from `authorizationPrincipal.customerId`, cross-customer via `beneficiaryId` impossible (service checks `beneficiary.customerId==principal`). `GET /agents/me/beneficiaries` **MUST NOT** exist.
7. **Security — 6+ checks:** own vs other, forged `?customerId=activeId` ignored, agent 401|403, unauth 401, beneficiary not exposing `transferCodeHash/pin/otp`, no ledger/journal/payload leakage.
8. **Financial isolation — zero ledger/wallet side effects for beneficiary CRUD (read-only registry).** `POST /customers/me/beneficiaries` does not `postJournal`, does not change `wallet_accounts`/`ledger_accounts`/`ledger_journals`/`transfers`. `POST /customers/me/transfers` with `beneficiaryId` posts exactly one journal (same as existing) via `TransferService` (SERIALIZABLE, deterministic lock, requestHash `sha256(sorted business params)` excludes beneficiaryId? — include `destinationWalletId` resolved, not raw `beneficiaryId` in hash, to keep idempotency deterministic).
9. **Performance — indexed, no N+1:** `beneficiary` queries use existing `idx_customer_beneficiaries_customer_created` + `uq_customer_beneficiaries` etc. Transfer beneficiary lookup is single `SELECT ... WHERE id=$1 AND customer_id=$2` (no N+1).
10. **Migration — 0 new (reuse `1785753600013`).** `SELECT count(*) FROM typeorm_migrations` stays **66**, `ProductionReadinessService` still `1785753600065`. If field `beneficiaryId` on Transfer were introduced, it must be additive nullable + index and bump to 67 — **not required** (use resolution, not storage).
11. **Testing — real PG 10+ checks:** `POST` + `GET` + `PATCH` + `GET :id` + `beneficiaryId` transfer integration + isolation (own vs other, forged, agent, unauth) + idempotency (same `beneficiaryId` transfer vs same `Idempotency-Key` replays same) + failure states (inactive/not-verified/wrong owner) + no ledger leak. Regression suites: `v1-001` (funding), `v1-003` (admin), `v1-005/006/007` (notifications/support), `a23/a25` (history), `a24` (pin), `migration-chain` 66 — all PASS, `tsc --noEmit` 0, `eslint` 0.
12. **No unrelated feature:** No Wallet→Bank, no NIBSS, no cards/bills, no second outbox, no second balance.

---

## 23. Remaining V1 Task Count

**Strict V1 business requirements (core money + operations + product surfaces):**

- **COMPLETE: 14** (C1-C5, C6 W→W, C7 funding, C8-13 Agent/Aggregator/Outlets, C14 ledger, plus V1-001/003/005/006/007)
- **PARTIAL: 4** (P1 wallet history unification, P2 agent unified history, P3 admin single-pane, P4 phone read-only by design)
- **BACKEND-ONLY: 4** (B1 beneficiary registry, B2 MFA self, B3 reversal ops, B4 agent financial position for ops)
- **METADATA-ONLY: 3** (M1 fees/commissions calculator, M2 preferences runtime, M3 reconciliation reports)
- **NOT IMPLEMENTED for core money: 0** (all V1 money engines have entity+service+route+ledger+test)
- **OUT OF SCOPE (V2): 12** (Wallet→Bank, Bank→Wallet live, NIBSS, Wema/Providus/NinePSB, settlement, cards/dollar, bills/airtime/data/electricity/cable/betting, non-NGN, second ledger)
- **BLOCKED infra: 0** (embedded PG 18.4, ledger SERIALIZABLE, audit, outbox all ready)
- **REQUIRES PRODUCT DECISION: 5** (beneficiary V1 vs V2, funding self-register vs ops-created, fees non-zero vs 0, MFA self vs workforce-enrolled, phone change OTP)

**Remaining V1 hardening tasks to be COMPLETE (non-money, polished):** **3 hardening** (H1 beneficiary `me` + transfer `beneficiaryId`, H2 reconciliation operational break resolve, H3 agent/customer history unification) + **1 deferred enhancement** (H5 notification read/unread `read_at`) + **5 product-decision** (if decided, add `PATCH /customers/me/preferences`, `POST /customers/me/mfa`, `GET /customers/me/kyc` self-view, fee wiring, phone change). So **3 hardening required for V1 polish, 0 blocking money.**

If beneficiary is deferred to V2, remaining hardening is **2** (reconciliation operational, history unification).

---

## 24. Known Blockers / External Dependencies

| Blocker | Type | Impact | Mitigation for V1 |
|---------|------|--------|-------------------|
| **Actual production SMS (Termii/Twilio/Africa's Talking)** | External provider dependency | `V1-005` provider-neutral + console/test is **COMPLETE** for code, but *real delivery* to `801…` is PENDING until env `SMS_API_KEY` + `SmsProvider` (HMAC, `NOTIFICATION_PROVIDER_TOKEN` override) + callback ingress is integrated and whitelisted. **Not a code blocker for V1-008 audit** (correctly V2/ops) | Keep `ConsoleNotificationProvider` for V1 pilot; add `SmsProvider` adapter in `C1` provider integration (no code now) |
| **Actual production Push (FCM/APNS)** | External provider + missing `push_device_tokens` table | `notification_deliveries` SKIPPED `PUSH_TOKEN_DEPENDENCY_MISSING` is correct; real Push requires `CreatePushDeviceTokens` migration + `POST /customers/me/push-tokens` + `notification_push_enabled` filter + FCM adapter. **Not V1 code blocker** | Keep SKIPPED for V1; add push tokens in `C1` if Push required for V1 (currently deferred) |
| **NIBSS / Wema/Providus/NinePSB live Bank→Wallet** | External settlement network and bank partnership, legal, risk, reconciliation | **Correctly OUT OF SCOPE for V1** (V1 funding is manual maker/checker). No NIBSS adapter in `customer-app` (verified `grep nibss 0`). No blocker for current V1. | V2 `A6` external partners, not V1 |
| **Third-party settlement providers** | External | Same as above | V2 |
| **Cards / dollar cards** | Product + provider (E2) | E2 platform later per authoritative roadmap `E2 Card` — not V1 | V2 |
| **Bills/airtime/data/electricity/cable/betting** | Commercial product B1 | `CreatePaymentCapabilities` metadata, not engine — correctly not V1 | V2 |
| **Fees/limits non-zero policy decision** | Product/commercial B1 decision | `FeeEngine` 0-fee is **intentional** for in-house V1; if product requires non-zero fees/limits for launch, then `A4` policy wiring + `POST /internal/fees/rules` maker/checker is required before launch (hardening H6) | Product decision: keep 0 for V1 pilot, wire for commercial launch |
| **None for infrastructure** | — | Embedded PG 18.4, ledger SERIALIZABLE, audit, outbox, WAL, `data/embedded-pg` all ready; `npm ci` 930 packages, `tsc --noEmit` 0 in prior turn; no migration incompatibility (66) | — |

**V1-008 audit found 0 infra blockers and 0 V1 code blockers for money lifecycle. Remaining blockers are all *external provider* or *V2 product decision*, not repository implementation.**

---

## 25. Test Baseline

**Safe read/build/test commands run for this audit (no source/migration/route change):**

- `git status --porcelain` → `nothing to commit, working tree clean` (before report), `git rev-parse HEAD` → `fda08602a44e586fed2815bdf5fda4a89009b6c8`, `git log --oneline -5` → `fda0860` `bd83dc0` `eac203a` `7b77ce0` `b3cffa4`
- `ls src/migrations | wc -l` → **66**, `cat src/production/production-readiness.service.ts | grep EXPECTED` → `1785753600065` `CreateNotificationDeliveries`
- `ls src` → `admin agent aggregator authorization beneficiary common config customer customer-app customer-authentication customer-beneficiary customer-compliance customer-eligibility customer-funding customer-wallet deposit fee health ledger notification operations outlet policy product-governance production reconciliation support transfer wallet` + 66 migrations + `docs/V1-005` `V1-006` `V1-007` reports
- `grep -rn me/beneficiaries src` → 0 (backend-only), `grep -rn customers/me/notifications src` → `src/notification/notification-inbox.controller.ts:16 GET`, `grep beneficiary src/transfer` → 0 (not integrated)
- `cat src/authorization/route-policy-registry.ts | grep customers/me` → `customers/me/*` `CUSTOMER SELF` (re-verified)
- `./node_modules/.bin/tsc --noEmit` (prior turn) → **0 errors** (after V1-006 inbox `tsc` 0, `eslint src/notification/notification-inbox*` 0)
- Prior turn real-PG integration baselines (reused, not re-run in audit-only mode per STEP 11, but reported):
  - `test/v1-006-customer-notification-inbox.integration.spec.ts` **23/23 PASS (30.3s)**
  - `test/v1-005-notification-delivery.integration.spec.ts` **23/23 PASS (32.4s)**
  - `test/v1-001-customer-funding.integration.spec.ts` **26/26 PASS**
  - `test/v1-003-admin-operational-writes.integration.spec.ts` **49/49** (includes V1-007)
  - `test/v1-007-support-ticket.integration.spec.ts` 28/28 included
  - `test/a21` 13/13, `a22` 15/15, `a23` 15/15, `a24` 19/19, `a25` 17/17, `a26` 19/19, `test/migration-chain` 15/15 (66)
- `node -v` 18+, `npm ci` 930 packages, `embedded-postgres` 18.4 `data/embedded-pg` ready on prior run (port 5432)

**No source code, migration, or route was changed in this audit.** Only new report file `docs/V1-008-DEPENDENCY-RE-AUDIT.md` created. `git diff --stat HEAD` after audit: `docs/V1-008-DEPENDENCY-RE-AUDIT.md` only (documentation-only).

---

## V1-008 STATUS:
VERIFIED — CURRENT V1 DEPENDENCY RE-AUDIT COMPLETE

**NEXT RECOMMENDED TASK:**
`V1-HARDENING-01 Customer Beneficiary Customer App Exposure & Transfer Integration`

**NEXT TASK DEPENDENCIES:**
- `customer_beneficiaries` table `1785753600013` (already migrated, 66)
- `BeneficiaryService` / `CustomerBeneficiaryService` (already implemented, backend-only)
- `CustomerService` / `WalletService` / `RecipientResolutionService` (for beneficiary→wallet resolution)
- `TransferService` (existing, no change to ledger, optional `beneficiaryId` branch)
- `RoutePolicyRegistry` `customers/me/*` `CUSTOMER SELF` (already)
- `AuditService` (for `BENEFICIARY_CREATED/UPDATED`)
- **No new migration required** (0), **no new ledger**, **no external provider**

**NEXT TASK ACCEPTANCE CRITERIA:**
1. `GET /customers/me/beneficiaries?page=&limit=` — CUSTOMER SELF (401 unauth, 403 agent), pagination `page 1 limit 20 bounds 1..100` deterministic `createdAt DESC id DESC`, safe projection `id/nickname/beneficiaryCustomerId/displayName/receivingNumber/isVerified/isActive/createdAt` (no ledger/hash/pin/otp/correlation), `totalPages/hasNextPage`.
2. `POST /customers/me/beneficiaries` — body `{nickname 1-100, beneficiaryIdentifier}` → `BeneficiaryService.createBeneficiary(customerId, dto)` ownership `customerId==principal`, `isVerified` via existing verify, `isActive=true`, audit `BENEFICIARY_CREATED` without secrets, `400` invalid `409` duplicate, zero ledger side effects.
3. `PATCH /customers/me/beneficiaries/:beneficiaryId` — update `nickname`/`isActive`, ownership `customerId==principal`, version optimistic, audit `BENEFICIARY_UPDATED`, `404` generic if not owner.
4. `GET /customers/me/beneficiaries/:beneficiaryId` — single safe projection, SELF 404 generic, deleted 404.
5. `POST /customers/me/transfers` — accepts **either** `destinationWalletId` **or** `beneficiaryId` (whitelist, mutually exclusive, at least one), if `beneficiaryId` then `BeneficiaryService.getBeneficiary(principal.customerId, beneficiaryId)` → verify `isActive && isVerified && !deletedAt && customerId==principal`, resolve `beneficiaryCustomerId → wallet_accounts.ledger_account_id → destinationWalletId` (reuse `ensureWalletAccount`), then delegate to `TransferService.createTransfer` with resolved `destinationWalletId` (existing SERIALIZABLE, deterministic lock, requestHash excludes raw `beneficiaryId`, pin still required, `Idempotency-Key` still required).
6. Scoped from `authorizationPrincipal.customerId` (no `?customerId=` trust), `GET /agents/me/beneficiaries` MUST NOT exist, `GET /agents/me/notifications` MUST NOT exist.
7. Security 6+ checks (own vs other, forged `?customerId=`, agent 401|403, unauth 401, beneficiary not exposing transferCode/ledger, no pin in response/logs).
8. Financial isolation — beneficiary CRUD zero `postJournal`/`wallet_accounts`/`ledger_*`/`transfers`; `beneficiaryId` transfer posts exactly one journal (same as existing) via `TransferService`.
9. Performance — single `SELECT ... WHERE id=$1 AND customer_id=$2` (no N+1), existing indexes.
10. Migration 0 — `SELECT count(*) FROM typeorm_migrations` stays **66**, `ProductionReadiness` stays `1785753600065`.
11. Tests real PG 10+ (own vs other, forged, agent, unauth, inactive/not-verified, duplicate, beneficiaryId transfer vs direct walletId same journal, idempotency replay, failure states, no ledger leak) + regressions `v1-001` `v1-003` `v1-005` `v1-006` `v1-007` `a23/a25` `a24` `migration-chain` 66 all PASS, `tsc --noEmit` 0, `eslint` 0.

**BLOCKERS:**
- **External SMS/Push provider** — Termii/Twilio/Africa's Talking + FCM/APNS remain external dependencies for *actual* SMS/Push delivery; `V1-005` provider-neutral + console/test is **COMPLETE** for code, but real delivery to handset requires `SmsProvider`/`PushProvider` adapter + env `SMS_API_KEY` + `push_device_tokens` table (V2/ops, not V1 code blocker).
- **NIBSS / Wema/Providus/NinePSB live Bank→Wallet** — **correctly OUT OF SCOPE for V1** (V1 funding is manual maker/checker); not a blocker for current V1.
- **None for next hardening task** — `V1-HARDENING-01` has zero external blocker (all primitives exist, 66 migrations, no provider, no second ledger).

**Confirmation:** No source code, migration, schema, or route was changed in this audit — only `docs/V1-008-DEPENDENCY-RE-AUDIT.md` created. `git status --porcelain` after audit shows only that report (documentation-only). `git HEAD` remains `fda08602a44e586fed2815bdf5fda4a89009b6c8`, migration count **66**.
