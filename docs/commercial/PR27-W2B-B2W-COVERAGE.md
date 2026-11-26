# PR #27 — Wallet to Bank / Bank to Wallet commercial coverage

Status: **implemented this turn**, branch `arena/41dde913-monienaija`, base
`arena/5-main-web-integration@41edf587c262edafbd3eb2cc1b3042c614a9730e`.

Pinned to code by two suites:

- `test/v1-commercial-bank-direction-coverage.spec.ts` — the static coverage contract (23 cases,
  including the all-nine-product checklist).
- `test/v1-bank-direction-preview-runtime-parity.integration.spec.ts` — preview vs runtime parity on
  disposable PostgreSQL with real workforce sessions (12 cases, including statutory-charge
  zero-vs-missing and the three-way zero / missing / inapplicable-recipient distinction).
- `test/v1-bank-commission-runtime.integration.spec.ts` — commission applied at settlement on
  disposable PostgreSQL through the real commitment and settlement services (6 cases: nonzero parity,
  explicit zero, no rule, released transfer, replay, wrong-agent attribution).

Machine-readable result: `docs/commercial/evidence/pr27-bank-direction-parity.json`.

## The decision this turn took

The previous revision of this document recorded four gaps. All four had the same root cause: **no
canonical product for either bank direction.** They are now closed by naming one product per
direction, once, and making every surface read it.

| Direction                | Canonical product                                              | Authoritative record (PR #23)                    | Fee                                                                                                  | Limit                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet → Bank (outbound) | `WALLET_TO_BANK` — ACTIVE, enabled, for **customer and agent** | `financial_commitments.id`                       | `fee_rules` in force for `WALLET_TO_BANK`; bound at commitment, previewed at `bank-transfer-preview` | Enforced for both lanes at commitment under `WALLET_TO_BANK`; legacy `WITHDRAWAL` / `EXTERNAL_BANK_TRANSFER` rules resolve as aliases |
| Bank → Wallet (inbound)  | `BANK_TO_WALLET` — seeded **DISABLED**                         | `inbound_funding_receipts.id` (bank intake UUID) | `NOT_APPLICABLE_INBOUND_CREDIT` — no customer service fee, by decision                               | Enforced on the credit path when a credit posts; previewable now                                                                      |

Both identities live in `src/product-catalog/banking-product-identities.ts` with their fee
disposition, principal types, execution entry point and execution blockers, so the catalogue, the
resolvers, the preview and Admin Web cannot disagree about what a direction _is_.

## Why one product, not one per principal type

A customer wallet→bank transfer and an agent wallet→bank transfer are the same commercial route:
same wallet debit, same dispatch, same settlement. PR #23 already records both under the single
transaction-history type `WALLET_TO_BANK`, keyed by `financial_commitments.id`, and states there is
**no second agent-external-bank-transfer type**. Adding an `AGENT_BANK_TRANSFER` product purely to
mirror the legacy `EXTERNAL_BANK_TRANSFER` limit string would duplicate a product identity and split
one tariff across two codes. So:

- `EXTERNAL_BANK_TRANSFER` remains what it always was — an **agent capability/service code**
  (`AgentService.EXTERNAL_BANK_TRANSFER`), never a catalogue product;
- it is declared a **legacy limit alias** of `WALLET_TO_BANK`, alongside `WITHDRAWAL`;
- the alias is honoured at **read time** in the one shared applicability module
  (`limit-catalog/limit-rule-applicability.ts`). No approved rule was rewritten: changing the meaning
  of an approved limit rule in place would be a governed change, not a code deploy.

## What changed, surface by surface

| Surface                          | Before                                                                                                                              | Now                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Catalogue seed                   | `WALLET_TO_BANK` / `BANK_TO_WALLET` in the _out-of-scope guard list_                                                                | Both seeded; outbound ACTIVE, inbound DISABLED. Guard list carries neither        |
| Commitment limit (customer lane) | `product: 'WITHDRAWAL'`                                                                                                             | `WALLET_TO_BANK.productCode`                                                      |
| Commitment limit (agent lane)    | `product: 'EXTERNAL_BANK_TRANSFER'`                                                                                                 | `WALLET_TO_BANK.productCode` (same product)                                       |
| Customer limit view              | 5 product pairs, **no bank pair** — a customer could be refused by a limit they could not see                                       | 7 pairs incl. `WALLET_TO_BANK` OUT and `BANK_TO_WALLET` IN                        |
| Agent limit view                 | `EXTERNAL_BANK_TRANSFER` OUT                                                                                                        | `WALLET_TO_BANK` OUT; legacy rules still resolve                                  |
| Limit usage lookup (both views)  | `product = <canonical>` — reported **zero consumption** for rules authored under the alias                                          | sums every key of the route; two spellings are one allowance                      |
| Fee binding at commitment        | "whichever single product in the currency has a live rule", else refuse — configuring a second product made bank transfers unpriced | selects only `WALLET_TO_BANK` rules                                               |
| Fee preview endpoint             | selected `r.payment_type`, **a column `fee_rules` does not have** — the endpoint failed with a SQL error for every call             | shares one selector with the binding; payment type is a constant of the route     |
| Inbound credit                   | no fee and **no limit decision**                                                                                                    | canonical `BANK_TO_WALLET` limit enforced inside the posting transaction          |
| Effective-configuration preview  | no bank product to ask about                                                                                                        | resolves both; reports inbound fee as not applicable rather than `NOT_CONFIGURED` |

Two defects were found and fixed while wiring this, both worth calling out because they were
invisible:

1. **The bank-transfer fee preview never worked.** `banking-transfer-pricing.controller.ts` selected
   `r.payment_type`, which does not exist on `fee_rules`. Every request errored. That is why the
   product-agnostic pricing never surfaced as a customer-visible inconsistency: nobody could reach
   it. The selector now lives in `banking/banking-fee-rule-selection.ts` and is shared with the
   binding.
2. **Limit consumption was invisible under the alias.** `limit_usages` rows are keyed by the product
   **spelling on the rule that created them**. Once the runtime passed the canonical code, a rule
   authored as `EXTERNAL_BANK_TRANSFER` consumed a row the view never looked at, so a spent limit
   displayed as untouched. Both views now aggregate across every key of the route.

## Bank → Wallet: why the fee is "not applicable", not "not configured"

A bank credit is money the customer did not instruct us to spend. Charging a service fee on it is a
commercial decision nobody has taken, so none is seeded and none is invented — and the product is
seeded **DISABLED**, which is what keeps that visible in the catalogue rather than silently free. The
only fee evidence the inbound path carries is `provider_fee_minor` on the receipt: the provider's own
charge, which is external cost, not revenue.

The **limit** is different: a limit on a credit is a real control, so `BANK_TO_WALLET` rules are
enforced on the credit path. `InboundFundingService.enforceInboundLimit` evaluates the canonical
product inside the same SERIALIZABLE transaction that posts the credit, using the same
`LimitEnforcementService`. It uses `requireConfiguration: true` (evidence is pinned) but not
`strictConfiguredRules`: a bank credit cannot be refused at the till the way a customer-initiated
debit can, because the money has already arrived, and the suspense policy that would hold it is
deliberately unavailable. If a rule _is_ configured and the credit breaches it, the rule's own
refusal stands and the ledger credit rolls back with it.

## Supported vs unavailable — stated explicitly

| Execution path                   | State                                                                                     | What it needs                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet → Bank (customer + agent) | **Supported.** Commitment → fee binding → limit → dispatch intent, all in one transaction | —                                                                                                                                                                                                        |
| Bank → Wallet credit execution   | **Unavailable by design.** Preview and rules exist; no credit can post                    | An approved `A7_INBOUND_EXECUTION_AUTHORITY` implementation registered in place of `UnavailableA7InboundExecutionAuthority`, and an approved `INBOUND_SUSPENSE_POLICY` for funds that cannot be credited |
| Live provider calls (NIBSS etc.) | **Not enabled**                                                                           | Provider registration, credentials and operational readiness; none exist in this repository state                                                                                                        |

No provider is named in the identity module, no rate is invented, and no regulatory ceiling is
asserted — synthetic values are used only in tests.

## Demonstration (this turn)

`test/v1-bank-direction-preview-runtime-parity.integration.spec.ts`, 8/8:

- **Wallet → Bank fee**: preview `RESOLVED`, computed `fee 100 / vat 0 / total 250100`; the runtime
  selector returns the **same `fee_rule` row id**; 0 journals.
- **Wallet → Bank limit**: preview rule ids equal the runtime `ruleRefs` id for the within-limit case;
  a breach is refused by both.
- **Legacy alias**: a rule stored as `WITHDRAWAL` previews and decides identically to one stored as
  `WALLET_TO_BANK` — the compatibility guarantee.
- **Agent lane**: same product, legacy `EXTERNAL_BANK_TRANSFER` rule; no agent-specific catalogue
  product exists (asserted against `products`).
- **Bank → Wallet limit**: preview rule ids equal the **synthetic runtime** decision the credit path
  makes (documented as synthetic because no execution authority exists); a breach is refused.
- **Bank → Wallet fee**: product reported DISABLED, fee section not `RESOLVED`, blockers listed.

## Commissions and statutory charges — the exact remaining gaps

The full trace is product → fee → **commission** → **statutory charges** → limit → runtime decision.
Fees and limits are wired (above). The last two are not, and this is what each one needs.

### Commission: outbound applies at settlement; inbound has no eligible recipient

| Direction     | Rules authorable?                                                    | Preview                                                                         | Runtime                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet → Bank | **yes** — `commission_rules.product_code` is a FK to `products.code` | resolves, and states the event: applied **at settlement**, not at authorization | **applied.** `external-settlement.service.ts` calls `recordWalletToBankCommissionInTransaction` after the commitment becomes `SETTLED`; the snapshot is bound to the commitment id |
| Bank → Wallet | **yes** (same product row)                                           | `NOT_APPLICABLE` + `COMMISSION_RECIPIENT_NOT_APPLICABLE` BLOCKER                | **never.** No eligible recipient, no attribution column on the inbound receipt, and no execution event to attach a decision to                                                     |

**Wallet → Bank, where and why.** Commission is decided at the single event that proves the money left:
the `RESERVED → SETTLED` transition, inside the settlement transaction, after the provider outcome is
independently verified. Authorizing is not earning — a commitment can still be released or rejected
afterwards, and accruing at authorization would pay commission on transfers that never happened and
then require reversal accounting to undo. Three guarantees follow from that placement alone:

| Event                   | Commission decision                          | Accounting legs                  |
| ----------------------- | -------------------------------------------- | -------------------------------- |
| Authorized (`RESERVED`) | none — nothing recorded                      | none                             |
| Released / rejected     | none — the release path never reaches it     | none                             |
| Settled (`SETTLED`)     | exactly one, `wallet-to-bank:<commitmentId>` | accrual per configured treatment |
| Replayed settlement     | refused as a duplicate; snapshot idempotent  | none new                         |

**Recipient attribution** comes from the commitment's own financial authorization (the acting agent and
their class), read in the same locked transaction. A rule targeted at a different agent does not match,
and a customer-initiated transfer produces no agent recipient — that is attribution, not a gap. The
`beneficiaryId` the engine leaves null for class-targeted rules is filled from the acting agent, since
they are the only possible recipient of their own transfer's commission.

**Three fee realities stay three.** Unpriced (no binding — no approved rule priced the route),
explicitly free (a bound zero) and charged (a bound non-zero) are distinct in the recorded decision;
the settlement path previously collapsed them, and a NOT_CONFIGURED fee is now recorded as exactly
that rather than a zero nobody authored.

**Bank → Wallet stays unavailable, and the reason is now precise.** It is not "the wiring is missing":
a bank credit has **no eligible commission recipient**. The recipient is the wallet-owning customer, no
agent performs the movement, and `inbound_funding_receipts` carries no agent attribution to key a
beneficiary on. Even if a rule could name one, inbound execution is deliberately unavailable
(`A7_INBOUND_EXECUTION_AUTHORITY` is bound to the unavailable adapter) and there is no settlement event
to attach a decision to. The preview therefore reports `NOT_APPLICABLE` with
`COMMISSION_RECIPIENT_NOT_APPLICABLE` — deliberately distinct from both an authored **zero** (a rule
that computes to 0) and **missing configuration** (no rule at all), so an operator is never sent to
author a rule that could not apply.

The exact missing piece for inbound, stated once: **a recipient model for receiver-side commission.**
That needs a policy decision about who earns on an incoming credit (and on what basis) plus an
attribution column on the inbound receipt — neither of which exists, and neither of which is invented
here.

### Statutory charges: VAT is modelled, everything else is absent

| Charge                 | Modelled?                                     | Where                                                                                                                              |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| VAT on our service fee | **yes**, authored per `fee_rules.vat_bps`     | computed on the clamped fee; stored as `tax_minor` on the banking binding                                                          |
| Stamp duty             | **no** — no column, table, resolver or engine | reported under `notModelled`, **never** as a zero rate                                                                             |
| Regulatory levy        | **no**                                        | reported under `notModelled`                                                                                                       |
| Provider fee           | **no**, and not statutory                     | outbound: unknown at authorization, never added to the customer debit. inbound: preserved as receipt evidence `provider_fee_minor` |

The preview exposes this as a first-class `statutoryCharges` section, separate from `fee`, so the
zero-vs-missing distinction is visible: an authored `vat_bps: 0` reports `RESOLVED` with
`provenance: AUTHORED`; no rule at all reports `NOT_APPLICABLE` / "missing rule, not a zero charge";
and `BANK_TO_WALLET` reports `NOT_APPLICABLE` because it carries no fee for VAT to attach to.

## Still open in PR #27 (draft)

- [ ] Limit-profile authoring screens in Admin Web (this turn wires resolution, not authoring UI).
- [ ] Browser verification — no Playwright/browser binaries in the sandbox; blocked, recorded in PR.
- [ ] PR #24 tier-ceiling alignment: the institution KYC tier path still resolves product mappings by
      product code, so a `WALLET_TO_BANK` tier mapping is authorable but has not been reconciled with
      that PR's ceiling model.
- [x] **Commission on Wallet → Bank**: applied at settlement, bound to the commitment, proven on
      disposable PostgreSQL (`test/v1-bank-commission-runtime.integration.spec.ts`).
- [ ] **Commission on Bank → Wallet**: no eligible recipient exists. Needs a receiver-side commission
      policy decision + inbound agent attribution. Recorded as `COMMISSION_RECIPIENT_NOT_APPLICABLE`.
- [ ] **Commission settlement rail**: accruals post to `COMMISSION_PAYABLE`; paying them out is V2 scope
      (`ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED`).
- [ ] **Statutory charges beyond VAT**: absent from the data model. Needs a real schema + a regulatory
      decision, not a configuration entry.
- [ ] Inbound execution authority + suspense policy: the two blockers above.
