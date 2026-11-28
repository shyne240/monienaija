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

## Admin Web History compatibility after PR #23 merged (follow-up)

Fetched SHAs:

- Integration tip: `de83c7b3047a47627b702c283ea03b3c32af7c9d` (its ancestry contains the PR #23 merge `39e0811d928c54537d120a5efad94cc76afb71ca` and PR #35 `Merge pull request #35 from shyne240/codex/custom-role-dashboard-assignment`).
- PR #40 head before this update: `cfb6ca219bf63f55b6e4d4c544b2945ab4cd1471`.
- Combined tree at the merge of those heads: `0c1953f5481cd02a48a4dcf61bfb896ed53d19f8`.

**Gap confirmed on that exact combined tree.** A deposit posted through `BankToWalletService.verifyAndPost` was absent from `type=BANK_TO_WALLET&status=CREDITED` History: PR #23's `BANK_TO_WALLET` intake branch still derived status from `agent_float_funding_receipts` linked through `banking_inbound_float_links`, and a direct Monnify credit has no float receipt. Pre-fix `b2wgap1` expected one row and received zero; see `docs/integration/evidence/bank-to-wallet-history-compatibility/gap-verification.txt`.

Compatibility fix (no PR #23 code or grant was reverted):

- `src/admin/transaction-history.controller.ts` adds a second `BANK_TO_WALLET` source for rows with `resolution_state='CREDITED'` and a non-null `credit_journal_id`. It uses the journal's `institution_id` for scope, exposes `[credit_journal_id]` only to `ledger.view`, and keeps `b.id` (immutable bank intake UUID) as the history key. The display/exact-search reference prefers `business_reference`, falling back to the legacy provider reference; legacy receipt and unverified/direct-intake rows otherwise keep their existing projection. Direct credits are excluded from the old branch so one posted deposit appears exactly once.
- `src/finance-operations/finance-operations.service.ts` resolves the reverse journal → source link from the journal's persisted `bankIntakeId` and `businessReference` (`DIRECT_CREDIT_JOURNAL`), so Finance returns to the same `#transaction-history/BANK_TO_WALLET/<intake UUID>`. The existing `DURABLE_INBOUND_LINK`, legacy receipt and generic JOURNAL_ID mappings keep priority/behavior.
- Pending (`UNVERIFIED`, the schema's pending verification state) and return-authorised (`resolution_state='EXCEPTION'` / exception state `APPROVED_FOR_RETURN`) rows are still projected, but never with `CREDITED` status. No payout or settlement authority was invented.

Evidence: `test/bank-to-wallet-history-compatibility.integration.spec.ts` posts a real #40 credit against a fresh fully migrated disposable PostgreSQL database with a deterministic Monnify transport, then asserts (1) exactly one CREDITED row with `businessReference`, intake UUID and credit journal, (2) a Finance journal source with `linkedBy=DIRECT_CREDIT_JOURNAL`, (3) pending and return-authorised rows excluded from CREDITED while remaining visible with their own states, (4) `ledger.view` and institution scope enforced (no journal id for OPERATIONS, 403 on the journal API, 404 for a foreign institution), and (5) unchanged 11 local credentials and role-function grants. `HISTORY_COMPAT_BROWSER=yes` additionally drives real Admin Web sign-in, filters, detail, **Open journal**, the Finance return link and negative CREDITED filters in headless Chromium against the real backend.

Screenshots and machine-readable results: `docs/integration/evidence/bank-to-wallet-history-compatibility/`. No role, password, institution grant or production toggle was changed; all records are synthetic. No live provider, emulator or device claim is made.

## Return / refund execution checkpoint (stacked lifecycle work)

- A governed `RETURN` decision (`FINANCE_PREPARER` request → independent `FINANCE_CONTROLLER` approval → consumed approval) authorizes **one** `bank_to_wallet_return_refunds` row. The row carries the original MonieNaija business reference, the original Monnify transaction reference, the deterministic MonieNaija `return_reference` and the Monnify `refund_reference`.
- `APPROVED` means authority exists; `SUBMITTED`/`PENDING` means one provider instruction was sent; `FAILED` means the provider refused/confirmed failure; `RETURNED` means the provider confirmed money returned. Late or duplicate updates cannot overwrite `RETURNED` or `FAILED`.
- A timeout, transport fault or documented duplicate-code (`R9`/`D07`) response resolves to `UNKNOWN`; the only next action is authoritative `getRefundStatus` under the original reference. There is no resubmit method.
- Live refunds remain fail-closed: `BANK_TO_WALLET_RETURN_EXECUTION_ENABLED=false` and `MonnifyProvider.refundsEnabled` defaults to false. The PG evidence injects a deterministic in-memory transport and an explicitly enabled test service; no live call was made.

### Owner decisions still required
1. Confirm Monnify refund entitlement/activation for the production contract (and any per-transaction fee such as the documented ₦10 wallet transfer fee).
2. Confirm the Monnify wallet is funded to cover refunds and name the operational owner of that float.
3. Decide the policy for payments received from third-party accounts: verified destination account/bank must be supplied for a non-virtual-account refund; Monnify refuses refunds to virtual account numbers. No destination is guessed by the adapter.
4. Confirm the settlement destination and reconciliation authority for inbound collections under the Reserved Accounts contract.
