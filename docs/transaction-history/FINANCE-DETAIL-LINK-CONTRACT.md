# Finance → Transaction History detail-link contract

Status: published for review; combined real-session acceptance remains outstanding. Finance #25 head `891a1c1777855b9e921cfc50c962f2626d7eecf8` was inspected, not merged. Its adapter supports the original four types; its combined browser harness mocks API responses. Neither proves the five added types or real bidirectional authorization.

## Link

```ts
// Exported from apps/admin-web/src/screens/authenticated/TransactionHistoryScreen.tsx
transactionDetailLink(type, id);
// => #transaction-history/<TYPE>/<UUID>
```

Original TYPE values (unchanged): `WALLET_TRANSFER`, `CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`.

Use the **business transaction key**, not an arbitrary ledger-line, event or journal ID:

- Wallet transfer: `transfers.id`.
- Cash-to-cash: `cash_to_cash_transfers.id` even if the link originates from claim/expiry investigation.
- Cash-in/out: original posted canonical-service journal ID; never reversal journal ID.

Do not infer a transaction TYPE from a reference prefix. Finance must resolve ownership from its actual source record. For added products, use the mappings below only when the source identity is proven. The Finance adapter does not yet implement those mappings; show unavailable rather than guessing. Do not link bank commitment IDs as wallet transfers.

Example:

```tsx
<a href={transactionDetailLink('CASH_TO_CASH', cashToCashTransferId)}>Transaction details</a>
```

The shell recognizes hash links on initial load and subsequent hash navigation. Subsequent navigation uses existing leave-workspace guards. In another browser tab, prefix with the Admin Web deployment's own origin and pathname, not the API origin. Refresh/re-authentication preserves the hash. No bearer tokens or customer/party details belong in the URL.

The drawer reads `GET /api/v1/internal/admin/transaction-history/:type/:id` independently of the list. `transaction.view` + real workforce session + institution scope are mandatory. Out-of-scope and nonexistent keys return the same 404. Extra `ledger.view` is required to return ledger IDs. A Finance role's ability to open ledger/reconciliation screens does **not** grant transaction history rights; do not weaken permissions to make a link appear to work.

References are display/search values, not globally unique keys. Exact-reference lookup uses the scoped list endpoint and can return multiple records. Never select the first globally matching reference without checking TYPE + UUID.

## Requested coordination

1. Finance: acknowledge this key contract and use source business keys in future link integrations.
2. Navigation owner: retain legacy view aliases but do not reintroduce separate Transfers/Deposits/Withdrawals/Cash-to-cash menu entries.
3. Authorization owner: decide whether list uses existing `transaction.view` (this draft) or a newly activated `transaction.search`; no entitlement changes made here.
4. Product + Finance: review posted operational float coverage and approve any future unposted attribution/backfill; generic primitives remain excluded.

## Follow-up added products

Additional keys: `WALLET_TO_BANK` (financial commitment UUID for customer OR agent), `BANK_TO_WALLET` (immutable bank intake UUID; legacy wallet receipt UUID remains separate without environment evidence), `CUSTOMER_FUNDING` (staff funding request UUID), `AGENT_FUNDING` (governed request UUID or standalone institutional float receipt UUID; linked float receipt UUID remains a detail alias), `AGENT_DEFUNDING` (governed request UUID).

`CASH_IN` and `CASH_OUT` now display **Cash to Wallet** and **Wallet to Cash** without changing stored keys. Cash to Cash remains on its parent. No generic deposit/withdrawal type.

Authorization decision: bounded list and detail both require existing `transaction.view`; no role grants added and `transaction.search` remains reserved/non-assignable. See FOLLOWUP-COVERAGE.md for cross-pipeline inbound identity limitations and withheld unscoped records. Do not promise new inbound lifecycle links beyond tested mappings until that draft gate is resolved.

## Proven inbound keys and preserved aliases

Bank intake → verification → proven float credit keeps `BANK_TO_WALLET/<banking UUID>`. Migration 0806 persists the exact institution/provider/environment/reference/account/currency/net-amount match to the posted float receipt. The linked float receipt is not a second list row. `AGENT_FUNDING/<float receipt UUID>` remains a detail alias, resolved within the institution-scoped query; its response contains canonical `BANK_TO_WALLET` TYPE/UUID. This includes receipt-first arrival. Finance must not derive these aliases from reference prefixes.

Legacy wallet receipts have no environment and keep `BANK_TO_WALLET/<receipt UUID>` independently. Hash-only bank/receipt matching was removed. Suspense has no implemented resolution/binding contract and is not presented as resolved. No inferred historical alias backfill occurs. See [INBOUND-IDENTITY.md](INBOUND-IDENTITY.md) for exact evidence and unsupported transitions. The original four Finance mappings remain unchanged; Finance #25 combined round-trip acceptance remains a separate gate.
