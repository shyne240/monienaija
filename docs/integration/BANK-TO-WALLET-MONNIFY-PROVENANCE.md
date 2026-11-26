# Bank → Wallet (Monnify reserved accounts) — provenance and ownership checkpoint

Status: **draft / implementation in progress / production enablement disabled**

## Exact SHAs inspected

| Item | Exact SHA | State / meaning |
| --- | --- | --- |
| Current working branch at start of this run | `85b8a953eb3563d800f5a50118c4dddbdaf04965` | `arena/27ec64e3-monienaija`, clean tree, no stash, no commit ahead of base. |
| Latest `arena/5-main-web-integration` fetched this run | `85b8a953eb3563d800f5a50118c4dddbdaf04965` | `git fetch origin arena/5-main-web-integration`; `FETCH_HEAD` equals the local base. Merge of PR #31. |
| PR #27 (Products & Pricing) GitHub head | `d953fcc1f83ac0d15e8772c1621777018c290110` | OPEN draft. PR body also records the earlier base `41edf587c262edafbd3eb2cc1b3042c614a9730e` and previously verified head `1354d5d`. |
| PR #23 (unified Transaction History) GitHub head | `f9b14d589707989db517bdf0899157fc90a87d87` | OPEN draft. Its PR body was last edited at an earlier implementation head `44f42ca7357e80873c2921a72c4d314d06ee25e2`; both are recorded because the body text and the GitHub `headRefOid` differ. |
| PR #24 (tier defaults / effective fee & limit visibility) GitHub head | `6985fe8ff4f3c7e3f985c1b4a54da1921a82cc0f` | OPEN WIP; relevant to fee/limit policy visibility, not merged here. |
| PR #18 (BVN/NIN verification outcomes) GitHub head | `7f105f0526f1284add5791c9b061196d052248e2` | OPEN; BVN/NIN policy remains independently configurable. |
| PR #17 (customer onboarding / mobile states) head | `43fe6772c4dbb107fd449912cc97d029574092d9` | MERGED into the integration line; this is the merged Customer App onboarding work, not an open dependency. |
| Draft PR for this branch | none | `gh pr list --head arena/27ec64e3-monienaija --state all` returned no PR at checkpoint time. |

Stopped-run inspection: `git status --short --branch` showed only the branch line, `git stash list` was empty, and `HEAD` was the integration tip. No usable uncommitted work had to be preserved.

## Ownership boundaries / overlap coordination

- **PR #27** owns `src/product-catalog/*`, fee/limit *view* services, `src/virtual-account/inbound-funding.service.ts`, `src/banking/banking-transfer-pricing.controller.ts` and its commercial evidence docs. This branch only *reads* the governed fee resolver (`FeeRuleResolverService` / `FeeRuleCalculatorService`) and does not edit those files. No line-level overlap is taken.
- **PR #23** owns `apps/admin-web/**` Transaction History UI, `apps/admin-web/src/screens/authenticated/Layout.tsx`, and `docs/transaction-history/**`. This branch does not edit those files. The Admin Web lookup here is a backend, institution-scoped reference search; PR #23 remains an unmerged dependency for the corresponding staff UI surface.
- **Customer App onboarding (PR #17, merged)** and any active onboarding work own `apps/customer-mobile/src/screens/unauthenticated/**`, registration/activation services, and KYC screens. This branch touches only the authenticated Add Money / banking response and deposit-state mapping plus its focused tests.
- **PR #24 and PR #18** remain unmerged dependencies for tier-ceiling alignment and BVN/NIN outcome policy respectively. Neither branch's files are edited here.

Coordination rule applied: never resolve an overlap by copying another session's unlanded implementation. Where an unmerged branch supplies the staff UI or a policy decision, this branch records the exact SHA and keeps the backend contract provider-independent.

## What this branch implements

- **Reserved account issue/retrieve.** `BankingVirtualAccountService` persists the provider assignment against the wallet and returns the persisted account on retry. A legacy reservation without an assignment is recovered with the documented status enquiry using the SAME `accountReference`; no second provisioning submission is made. `virtual_accounts.reference` is the stable `MN<digits>` reference used for webhook/reference matching. BVN/NIN may be re-presented from independently verified KYC evidence through `MonnifyIdentityAssertionService`; only SHA-256 digests are stored in this journey.
- **Inbound verification through the Monnify adapter.** `MonnifyProvider.verifyInboundPayment` calls the documented `GET /api/v2/merchant/transactions/query?transactionReference=` endpoint, interprets `paymentStatus`, `amountPaid`, `fee`, `settlementAmount`, `currencyCode` and `paymentReference`, and maps major units to integer minor units. The documented `paymentSourceInformation` is the **payer's** account and is deliberately not used as our destination.
- **One durable reference and one credit.** Intake generates `B2W-<sha256(provider|environment|provider transaction reference|institution|receiving account)>`; it is carried through the inbound row, credit, settlement, exception, ledger journal metadata, customer deposit view and the staff lookup. `verifyAndPost` uses a SERIALIZABLE transaction plus an advisory lock, checks provider reference/amount/currency/destination against the persisted assignment, resolves fee rules and limits, calls the existing customer-wallet boundary, and posts one `SETTLEMENT_ASSET → wallet` journal.
- **Traceable exceptions.** Unmatched, unverifiable, mismatched, identity/eligibility-blocked, limit-blocked and posting-restricted payments are retained with a reason and a permitted next action. Release/return is a `FINANCE_PREPARER → FINANCE_CONTROLLER` governed decision with a consumed approval bound to (exception id, decision, reason). Release additionally requires confirmed provider settlement evidence and posts a second journal; RETURN is recorded as **authorised only**, because no provider payout adapter or external confirmation exists.
- **Separate money chain.** Gross paid, Monnify deduction, merchant settlement, MonieNaija charge and customer wallet credit are distinct columns everywhere. An explicit zero fee rule resolves as `RESOLVED` with fee `0`; absence of a rule is `NOT_CONFIGURED` and is preserved in `fee_ref`. No rate, charge authority or settlement destination is seeded by this PR.
- **Production stays off.** `BANK_TO_WALLET_ENABLED` defaults to false. `BANK_TO_WALLET_PRODUCTION_ENABLED` is a second, separately authorised flag and production is refused without it. All proof uses synthetic data and a deterministic in-memory Monnify transport; no live transfer, sandbox credential or real money movement was used.

## Evidence (fully migrated disposable PostgreSQL)

Cluster: embedded PostgreSQL 18.4, loopback TCP, freshly initialised for this task; full TypeORM migration chain applied (`npm run migration:run` ended with `BankToWalletMonnifyJourney1785753600900 has been executed successfully`). Integration suites use the repository's per-run disposable-database harness.

| Check | Command | Result |
| --- | --- | --- |
| Migration chain | `npm run migration:run` | PASS, new head `1785753600900` applied. |
| Core Bank → Wallet, duplicate/concurrent replay, exceptions, Finance decisions, Customer App view/history | `PG_TEST_RUN_ID=b2w26fin2 npx jest --config jest.integration.config.js --runInBand test/bank-to-wallet-pg.integration.spec.ts test/banking-virtual-account-service.integration.spec.ts test/banking-inbound-service.integration.spec.ts test/banking-webhook-ingestion.integration.spec.ts` | PASS, 45/45 tests across 4 suites. The Bank→Wallet suite alone passed 10/10 (`b2w26gov3`); five concurrent `verifyAndPost` calls produced exactly one credit and one settlement row; replays returned the original decision without a second provider call. |
| Reserved-account retry and unknown-provisioning guard | `PG_TEST_RUN_ID=b2w26reg3 npx jest --config jest.integration.config.js --runInBand test/banking-virtual-account-service.integration.spec.ts` | PASS, 5/5. |
| Inbound recording/verification and webhook signature rules | `PG_TEST_RUN_ID=b2w26final npx jest --config jest.integration.config.js --runInBand test/banking-inbound-service.integration.spec.ts test/banking-webhook-ingestion.integration.spec.ts` | PASS. |
| Monnify adapter mapping against documented response | `npx jest --runInBand test/monnify-provider.unit.spec.ts test/monnify-inbound-verification.spec.ts` | PASS, 27/27. |
| Customer App UI states | `cd apps/customer-mobile && npm test -- --runInBand` | PASS, 26 suites / 239 tests. `npm run ts:check` PASS. |
| Backend compilation/lint | `npx tsc --noEmit -p tsconfig.json`; `npm run lint` | PASS (one pre-existing unused eslint-disable warning in `test/b9-custom-role.integration.spec.ts`). |
| Root unit suite | `npm test` | PASS, 311 suites / 3601 tests. |

The root suite initially killed the `module-di-wiring.spec.ts` worker with SIGKILL under this sandbox's memory pressure; the final full `npm test` run passed 311/311 suites and 3601/3601 tests. This is a harness resource limit, not a wiring failure.

A full `npm run test:pg:bounded` run was started with a fresh namespace (`b2w26all`). Five of 34 sequential batches completed green (1070/1070 tests) before the 30-minute shell budget expired; the remaining batches were intentionally stopped and their temporary databases dropped. This is a sandbox time limit, not a test failure. All Bank→Wallet, inbound, VA, webhook, Customer App and root-suite checks were separately rerun to completion, as recorded above.

**Device/emulator evidence: not run.** The Customer App check is React Native unit/render evidence against real backend response shapes, not a physical device or emulator session. No emulator screenshot, push notification or device-notification claim is made here.

## Admin Web History contract (PR #23)

PR #23's `BANK_TO_WALLET` history key is the immutable bank-intake UUID (`banking_inbound_payments.id`), as documented in its `docs/transaction-history/FINANCE-DETAIL-LINK-CONTRACT.md` at `f9b14d589707989db517bdf0899157fc90a87d87`. This branch therefore:

- exposes the customer history `id` as the intake UUID and keeps `reference` as the durable `B2W-…` reference;
- writes `bankIntakeId` and `businessReference` into the posted journal metadata;
- sets `ledger_transaction_id` to the posted journal ID so a detail lookup can find the ledger link;
- provides an institution-scoped backend lookup at `GET /api/v1/internal/banking/bank-to-wallet/transactions?businessReference=…`.

PR #23's draft SQL still derives `BANK_TO_WALLET` status from legacy float receipts (`identitySource: BANK_INTAKE`) and would show `VERIFIED` rather than `CREDITED` for this new credit path until it also recognises `resolution_state='CREDITED'` and `credit_journal_id`. That mapping belongs to the PR #23 owner; this branch does not edit that SQL. It is the first contract dependency to resolve before staff History is end-to-end green. The History → journal `onOpenJournal(journalId)` / guarded `handleNav('ledgerExplorer', { journalId })` contract remains unchanged.

## Monnify documented behaviour relied upon

- Reserved Accounts: `POST /api/v2/bank-transfer/reserved-accounts` requires BVN and/or NIN; duplicate `accountReference` and more than one active account per customer email are documented errors; `getAllAvailableBanks=true` is needed for all partner banks. Sandbox does not support real bank transfers, so a simulator is required if access is granted.
- Webhooks: configure Transaction Completion/Settlement URLs and whitelist `35.242.133.146`; the production `monnify-signature` header is HMAC-SHA512 over the raw body with the client secret and is absent in sandbox. The payload `transactionHash` uses a different scheme and must not be used as the header signature. Callbacks are untrusted; acknowledge quickly, then verify server-side and deduplicate.
- Verify Transactions: `GET /api/v2/merchant/transactions/query` by our `paymentReference` or Monnify's `transactionReference`; `PAID` is creditable, `PENDING` is not, `PARTIALLY_PAID`/`OVERPAID` are conflicts. Always compare `amountPaid` with the expected amount before fulfilling.
- Settlements: settlement is a merchant-wallet/bank cycle reported by Monnify (default 10 PM cycle; Express Settlement is dashboard-only with limits). Settlement retrieval does **not** establish a replacement receiving-account product.

## Cutover, transition and authority gaps

- Monnify is **interim only**. NIBSS NIP access by itself does not establish who would issue replacement receiving account numbers. The NIP/partner-bank service that will issue those accounts must be confirmed and its reserved-account lifecycle verified before new bank transfers are routed there. This PR does not implement NIBSS or production cutover.
- During transition, payments sent to old Monnify accounts must continue to be credited or held through the same provider-verified, reference-bound path. Any outstanding collections/settlements must be reconciled per provider transaction and settlement reference before Monnify is retired; `bank_to_wallet_settlements` retains gross, deduction, settlement and charge amounts with `PENDING_PROVIDER_SETTLEMENT`/`RECONCILED`/`OUTSTANDING`/`RETURN_REQUIRED` states for that workflow. Finance decides release/return using the existing maker-checker approval; this branch does not invent payout authority.
- Provider routing/adapter boundaries are provider-specific; ledger posting, fee rules, limits, business references, customer history and reconciliation controls remain shared. The NIBSS cutover should therefore replace the adapter/registration and account issuer, not these controls.
- BVN/NIN verification stays independently configurable from the bank-transfer provider (PR #18 remains an unmerged policy dependency).

## Contract dependencies and outstanding decisions

1. **Reserved Accounts entitlement** for the production Monnify contract must be confirmed by the provider owner; no entitlement is assumed.
2. **Webhook URLs and client secret** must be configured by the deployment owner; production signature validation fails closed without them. Sandbox omits the signature header, so sandbox cannot prove production webhook authenticity.
3. **Settlement destination and reconciliation authority** must be confirmed. The platform records settlement evidence but does not move merchant settlement funds.
4. **Controlled live test** requires separate authorisation. It has not been requested or performed here; sandbox has no real bank transfers.
5. **Fee/charge policy** including an explicit zero rate and any statutory treatment needs owner approval before enablement. The code supports configured zero but seeds no rate or authority.
6. **Return execution authority** is missing: there is no Monnify payout/refund adapter or externally confirmed return evidence. RETURN is recorded as an approved decision only.
7. **PR #23 History mapping** must read this branch's `resolution_state`/`credit_journal_id` for a posted `BANK_TO_WALLET` row. See the Admin Web History section above.
8. **Overlap with PR #23** also exists in `src/customer-app/customer-transaction-history.service.ts`; this branch adds only the `BANK_TO_WALLET` union member, count, row source and safe projection. Neither branch's other history logic was copied or rewritten.
9. **Workforce preservation:** no role, password, credential or the 11 workforce accounts were changed. `KYC_OWNERSHIP_KEY_BASE64` is read from configuration; no key material was added.
10. **Device/emulator evidence** and real provider sandbox evidence remain separately gated and are not claimed.
