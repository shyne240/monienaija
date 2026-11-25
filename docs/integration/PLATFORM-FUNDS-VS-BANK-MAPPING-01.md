# Platform Funds vs. Bank Balance — comparison contract (V1)

**Status:** implemented on `arena/751ace82-monienaija` (stacked on Finance PR #25)
**Owners:** Finance engineering + Finance Controller
**Code:** `src/platform-funds/platform-funds-mapping.ts` (pure classifier),
`src/platform-funds/platform-funds.service.ts` (evidence + governance)

This document is the **contract** between the ledger and the comparison screen. Changing the
classifier without changing this document is a defect. Where the two disagree, the screen is wrong,
not the ledger.

## 1. What the comparison is — and is not

**Is:** the Finance maker records that a specific bank or settlement account holds an actual
balance, that Finance verified from an external source (statement, branch certificate, zero-balance
letter) at a stated cutoff. The server computes what the **ledger expects** MonieNaija to hold in
that account as of a stated ledger cutoff, maps that expectation back to the posted accounts that
produce it, records timing items, and shows the remaining unexplained difference. An independent
FINANCE_CONTROLLER signs the comparison off (or rejects it) through the governed approval machinery.

**Is not:** an automated provider reconciliation. It does not read provider statements, it does not
call any bank API, and it never moves money, posts a journal, or adjusts an allocation. The
automated provider surface remains `/internal/finance-operations/reconciliation/*` with its own
`NOT_PERFORMED` semantics; this surface never claims provider agreement.

## 2. Scope and eligibility

| Scope | Selected account | Universe (non-selected accounts) | Control line (must net to zero) |
| --- | --- | --- | --- |
| `PLATFORM` | Platform settlement asset: `institutional_scope IN (UNATTRIBUTED, PLATFORM)`, `account_type = ASSET`, code `PAYMENT-SETTLEMENT_ASSET-%` | All `UNATTRIBUTED`/`PLATFORM` `CUSTOMER_FUNDS` accounts in the same currency | All `INSTITUTION`-scope accounts (the other books) |
| `INSTITUTION` | Institution settlement account: `institutional_scope = INSTITUTION`, purpose `SETTLEMENT` | All institution accounts of that institution (same currency, `CUSTOMER_FUNDS`) | All `UNATTRIBUTED`/`PLATFORM` accounts |

Both totals are **per currency** and per `accounting_unit = 'CUSTOMER_FUNDS'`. V1 supports NGN only;
the classifier refuses to mix currencies, and the screen always shows the currency beside both
totals. The institution scope predicate is re-resolved from `workforce_institution_assignments` on
every request; out-of-scope identifiers are `404`, never `403` (anti-probe). PLATFORM comparisons
are visible to the whole finance audience (`ledger.view`), mirroring unattributed journal visibility
in Finance Operations — decided 2026-11-25, recorded in the PR body.

## 3. The conservation identity (why the math is exact)

Every posted journal is balanced (Σ debits = Σ credits), so for a selected settlement asset `S`:

```
expected(S) = debits(S) − credits(S)                     (house normal-balance convention)
            = −Σ_{a ≠ S} signed(a)                        signed(a) = debits(a) − credits(a)
            =  Σ_{a ≠ S} (credits(a) − debits(a))         "contribution" := credits − debits
```

Hence, provided every in-unit journal is fully contained in the unit (enforced at posting time),

```
expected(S) = Σ lines (contribution)                       (breakdownTotal)
            + Σ other books (contribution)                 (controlContribution)
```

The classifier's obligation is therefore exact, not approximate:

1. **Every non-selected account in the universe maps to exactly one bucket** (`assignments[]`).
2. **The control line (the other books) must net to exactly zero.** It is exactly zero whenever the
   institutional guard triggers held, because an institutional journal cannot mix institution and
   platform books. A non-zero control line is a hard blocker
   (`INSTITUTION_SUBLEDGER_NOT_CONSERVED` / `PLATFORM_BOOKS_NOT_CONSERVED`) — it means
   the ledger itself is broken and no bank comparison may be signed off.
3. **Sign-off is blocked while any blocker exists.** `mappingComplete = (blockers.length === 0)`.

## 4. Bucket mapping (the contract table)

Contribution = credits − debits, expressed in minor units. Positive contribution = the bucket
explains part of the expected bank holding.

| Bucket | Contents | Sign behaviour |
| --- | --- | --- |
| `CUSTOMER_WALLETS` | Wallet-linked accounts whose owner class is `CUSTOMER` | + liability, increases expected |
| `AGENT_FLOAT` | Wallet-linked accounts whose owner class is `AGENT` (includes commissions already credited to agent wallets — counted **once**, here) | + liability |
| `UNPAID_AGENT_COMMISSIONS` | Commercial family `COMMISSION_PAYABLE` (accrued, unsettled) | + liability |
| `PLATFORM_EARNINGS_HELD` | Commercial families `FEE_REVENUE` (+) and `COMMISSION_EXPENSE` (−, debit-normal). Net platform earnings recognised but not yet remitted | mixed; expense deducted once |
| `OTHER_HELD` | `VAT_PAYABLE` (charges awaiting remittance), `PAYMENT-SYSTEM_SUSPENSE-%` (unallocated funds pending review), `PAYMENT-WITHDRAWAL_RESERVE-%` (withdrawals reserved), `CASH_TO_CASH-UNCLAIMED-%` / `C2C-UNCLAIMED-%` (unclaimed transfers), `AGENT_FUNDING_POOL-%` (internal funding pool, not CBN/NIBSS), institution-purpose `SUSPENSE` accounts | + obligations |
| `SETTLEMENT_CLEARING` | `PAYMENT-SETTLEMENT_CLEARING-%` and institution-purpose `CLEARING` accounts — provider settlement in transit; **not yet in the bank** | + in-transit |
| `SECONDARY_SETTLEMENT_ASSETS` | `FINANCE-ACCOUNTS_RECEIVABLE-%` (owed, not yet collected) and instruction-scope `SETTLEMENT` asset accounts other than the selected one | − reduces expected |
| `UNMAPPED` | Any account with no approved mapping. Carried in the totals verbatim (never dropped) and accompanied by a blocker | ⇒ sign-off blocked |
| `CONTROL` (line) | The other books, reported net-zero | must equal 0 |

Resolution order inside the classifier: wallet linkage → commercial family → institution purpose →
code pattern → **else UNMAPPED + blocker**. A `PLATFORM`-designated account
(`institutional_scope = PLATFORM`) is never auto-classified — it has no approved bucket in this
contract, so it is always `UNMAPPED` with blocker `PLATFORM_ACCOUNT_NOT_CLASSIFIED` until Finance
approves treatment here.

Notes (not blockers) are emitted when a commercial family is not provisioned in this environment
(e.g. fresh deployments before migration `1785753600076`): the bucket reports zero and says so,
rather than guessing.

## 5. The two rules Finance cares about, restated as journal identities

**Commission counted once.** Commission payable accrues on the agent-funding journal
(DR commission expense / CR commission payable). When it settles into the agent wallet, the journal
debits commission payable and credits the wallet (or the agent withdraws against the credited
wallet balance). Either way the value sits in exactly one bucket at a time:
`UNPAID_AGENT_COMMISSIONS` before settlement, `AGENT_FLOAT` after. The classifier cannot
double-count because the payable family account and the wallet are distinct accounts in distinct
buckets, and the journal moves the value between them.

**Wallet→platform-earnings fee transfer moves no bank cash.** Journal: DR customer wallet,
CR fee revenue (and CR VAT payable if applicable). The wallet contribution falls by the fee;
`PLATFORM_EARNINGS_HELD` rises by the same amount. The settlement asset is untouched, so
`expected(S)` is unchanged — the unit test in `test/platform-funds-mapping.spec.ts` pins this.

## 6. Sign-off governance

- Governed action: `PLATFORM_FUNDS_BANK_COMPARISON` (resourceType `PLATFORM_FUNDS_COMPARISON`),
  registered in `src/authorization/governed-action.registry.ts`. Maker: `FINANCE_PREPARER` (MFA).
  Checker: independent `FINANCE_CONTROLLER` (MFA). Self-approval prohibited. Explicitly **not** a
  protected-authority action (no decision is taken on money or protected resources); consumption of
  the approval is the recorded review decision itself.
- Routes are registered in `route-policy-registry.ts` (`WORKFORCE_SESSION`, gate `ledger.view`,
  `auditDeniedWorkforceFunction: true`) and re-check the same function in the controller.
- Evidence snapshots (`platform_funds_comparison_snapshots`) are versioned, hash-bound
  (sha256 of the canonical evidence core), append-only, and written at CREATED / UPDATED /
  SUBMITTED / REVIEW_APPROVED / REVIEW_REJECTED. Timing items are mutable only while the parent
  comparison is `DRAFT`; decided comparisons are immutable in the database (triggers in migration
  `1785753600810-CreatePlatformFundsBankComparisons.ts`).
- The fingerprint of the governed approval binds: selected account, currency/unit, both cutoffs,
  statement reference, bank balance, expected/difference/timing totals, the full timing-item set,
  and the evidence hash. If the ledger evidence drifts between submit and approve (a posted
  journal at or before the cutoff is added or reversed), approval is refused until the maker
  revises and resubmits.

## 7. Known limits (V1)

- NGN only; one comparison per currency/unit.
- `SETTLEMENT_CLEARING` is in transit — it counts toward `expected` but is *not* cash; Finance
  must treat it as an explanation for a bank shortfall, never as cash on hand.
- The automated provider check remains `NOT_PERFORMED` here by design.
- `COMMISSION_PAYABLE` et al. are resolved from `commercial_accounting_registry` with well-known
  code fallbacks (`FINANCE-<FAMILY>-<CCY>`); a registry miss is reported in `notes`, never silently.
- Institution-assigned Finance cannot see or compare platform rows of another institution; platform
  rows (the platform bank) are visible to all finance callers by decision (see §2).
- Changing this contract = editing the classifier + this document + the unit tests in the same PR.
