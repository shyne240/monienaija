# PR #27 — Wallet to Bank / Bank to Wallet commercial coverage

Status: **draft evidence**, branch `arena/41dde913-monienaija`, base
`arena/5-main-web-integration@41edf587c262edafbd3eb2cc1b3042c614a9730e`.

Pinned to code by `test/v1-commercial-bank-direction-coverage.spec.ts` (9 cases). If any of the
statements below stop being true, that suite fails.

## Why this document exists

The bank directions must be named explicitly rather than implied by "the catalogue covers
transfers". Each row therefore states the product code, whether a fee preview exists, whether a
limit preview exists, whether a runtime decision exists, and — where an answer is "no" — the
specific missing integration.

## The coverage table

| Direction | Product code that prices it | Fee preview | Limit preview | Runtime fee decision | Runtime limit decision |
|---|---|---|---|---|---|
| Wallet → Bank (outbound) | **None authoritative.** `WALLET_TO_BANK` exists only as a V2/PLANNED capability and in the seed out-of-scope guard list. Runtime prices against **whichever single fee rule is active for the currency** (product-agnostic). | **Yes, with a caveat** — `GET customers/me/banking/bank-transfer-preview` and `GET agents/me/banking/bank-transfer-preview` return `pricingSource: APPROVED_RULE` with `feeRuleId` + `productCode`, or `AMBIGUOUS_PRICING` with zero fee when more than one product has a live rule. | **No direction-specific preview.** No preview endpoint reads the limit catalogue for bank transfer; the admin effective-configuration preview only resolves limit profiles for the product codes you ask about, and no bank product code exists to ask about. | **Yes** — `FinancialCommitmentService` calls `BankingFeeBindingService.bindForCommittedOperationInTransaction()` inside the authorization transaction and refuses when the bound total ≠ the authorized debit. | **Yes** — but under the limit products `WITHDRAWAL` (customer) and `EXTERNAL_BANK_TRANSFER` (agent), enforced through `LimitEnforcementService.enforceWithManager` with `requireConfiguration: true`. |
| Bank → Wallet (inbound) | **None.** `BANK_TO_WALLET` is neither seeded, nor a capability row, nor referenced by runtime code. | **No** — `BankingInboundService` has no fee-rule read at all. | **No** — the inbound posting path never calls `LimitEnforcementService`. | **No** — the only "fee" inbound understands is `provider_fee_minor` (the bank/provider's own charge), stored as immutable receipt evidence. There is no platform fee decision. | **No** — no limit read, no reservation, no usage diagnostic on this path. |

### The four gaps, stated concretely

1. **Wallet → Bank has no product identity.** `OUT_OF_SCOPE_PRODUCT_CODES` in
   `src/product-catalog/product-catalog.seed.ts` carries `WALLET_TO_BANK`, and the capability
   registry marks it `V2 / PLANNED / NOT_EXPOSED` with the blocker
   "V2 out-of-scope: bank/provider integration". Meanwhile the runtime prices the direction from
   whatever single product happens to have a live rule for the currency. So the fee an Admin Web
   authoring screen would need to scope cannot be scoped today: **there is no approved mapping from
   "wallet → bank" to a fee-rule `product_code`.** Adding that mapping is a commercial decision, not
   a test change.
2. **Wallet → Bank has no direction-specific limit preview.** Enforcement is real but keyed on
   `WITHDRAWAL` / `EXTERNAL_BANK_TRANSFER`, neither of which is a catalogue product code. An
   operator authoring a limit profile cannot see which of those two keys applies to a bank transfer,
   so preview and enforcement are joined only inside the runtime service.
3. **Bank → Wallet has no commercial surface at all.** No fee rule, no limit rule, no preview. Its
   product identifier is absent from the catalogue and from the capability registry, so there is
   nothing even to author against. The provider fee is evidence, not policy.
4. **Bank → Wallet identity work exists elsewhere.** Inbound receipt identity, float links and
   duplicate-credit protection are covered by PR #23 (`docs/transaction-history/INBOUND-IDENTITY.md`,
   `evidence/inbound-identity-results.json`). That work is payment-evidence and reconciliation
   scope; it deliberately does **not** create a fee or limit decision, and this PR does not claim it
   does.

### Is the seed exclusion a release-scope decision?

**No, and it is recorded here as a carry-over.** `OUT_OF_SCOPE_PRODUCT_CODES` is a foundation-era
guard list ("must NEVER be enabled by this foundation") with a comment about the seed, not a
product-owner statement that V1 excludes bank transfers. Two independent sources say the directions
are intended work:

- the capability registry lists `WALLET_TO_BANK` with `owner: 'Wallet'` and a real implementation
  reference (`src/partner/partner.service.ts`), and `NIBSS_INTEGRATION` declares
  `dependencies: ['WALLET_TO_BANK']` — i.e. the capability graph expects it;
- the runtime already charges and limits the outbound direction (see the table), so the *behaviour*
  exists without the *catalogue identity*.

The honest V1 position is therefore: **outbound has runtime behaviour but no governable product
identity; inbound has neither.** Both stay on the V1 checklist below.

## What this turn proved for the bank direction (and what it did not)

The fee demonstration in PR #27 is on **Wallet Transfer** (`WALLET_TRANSFER`), not a bank direction.
That was deliberate: `WALLET_TRANSFER` has a complete, seedable synthetic execution path
(real customer session → `TransferQuoteService.create()` → serializable pricing), so the applied fee
can be compared to an actual runtime quote. Wallet → Bank has no equivalent synthetic end-to-end
execution available in this sandbox: it needs an approved provider/bank integration and an external
operation, and `BankingFeeBindingService` refuses to pick a product when the currency has more than
one live rule. Using it for the maker/checker/executor demonstration would prove the governance
wrapper, not the fee.

## V1 checklist (unchanged priorities, now with owners for the gaps)

- [ ] Approve the fee-rule `product_code` that governs Wallet → Bank (commercial decision), and
      replace the product-agnostic single-rule check with that explicit mapping.
- [ ] Approve the limit product keys for bank transfer (`WITHDRAWAL` for customers,
      `EXTERNAL_BANK_TRANSFER` for agents) as reviewable catalogue identity, so a limit preview can
      show them.
- [ ] Decide whether Bank → Wallet carries a platform fee and/or a limit; without that decision
      there is nothing to author, preview, or enforce.
- [ ] Keep provider/bank integration, NIBSS and inbound identity out of this PR's scope; they are
      tracked in PR #23 and the capability registry.
