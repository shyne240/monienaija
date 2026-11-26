# Ledger deep-link contract (Finance #25 → PR #23 navigation owner)

Status: **proposed by Finance #25, not implemented in this branch.** PR #23 owns
`Layout.tsx` and `TransactionHistoryScreen.tsx`, so the History → journal half must land there.
This document is the coordination artefact; Finance #25 supplies the journal → history return half
and does not resolve the Layout merge.

## Why

The real-session combined run at PR23 `3c7f5c9` + PR25 `891a1c1` (and the rerun with the Bank to
Wallet fix) shows the History detail drawer renders a posted journal UUID as `<code>` text. There is
no guarded way to open that journal, so the forward half of “History → journal → same transaction”
is blocked even though the Finance half now works for both products.

## Proposed shell contract

```text
#ledger-journal/<journal UUID>
```

- Recognised by the shell on initial load and on `hashchange`, exactly like the existing
  `#transaction-history/<TYPE>/<UUID>` route.
- Routes to the existing `ledgerExplorer` view with `initialJournalId` — the same guarded Finance
  screen a user reaches from the Finance menu. No new journal page, no second ledger implementation.
- Requires `ledger.view` in the client and on the server. A principal without it must not see the
  journal UUID, must not be offered the action, and must receive the existing permission message.
- An out-of-scope, nonexistent or unauthorised journal keeps the existing anti-probe behaviour:
  the server returns 404, never a hint that the record exists.
- Leave-workspace guards and re-authentication behaviour are the shell's existing ones; the hash
  must survive refresh and re-authentication like the transaction-history hash does.
- The History drawer should render the journal as a link/action only when `journal.view` is
  available and the journal ID is present; otherwise keep today's plain text. Do not derive the
  link from a reference prefix, event, approval, bank commitment or reversal journal.
- `TransactionHistoryScreen` already knows the originating TYPE/ID; the shell should preserve it so
  the Finance screen can return to `#transaction-history/<TYPE>/<ID>` through its existing
  source-resolution adapter. No extra query parameters or tokens in the URL.

## What Finance #25 provides

- `transaction-history-link.ts` resolves the return target from persisted source evidence only:
  - `WALLET_TRANSFER/<transfers.id>` for wallet transfers (unchanged, verified in the combined run);
  - `CASH_IN`/`CASH_OUT` by the original canonical-service journal ID (unchanged);
  - `BANK_TO_WALLET/<banking_inbound_payments.id>` when the posted float receipt is bound by
    `banking_inbound_float_links`; legacy CREDITED receipts keep `BANK_TO_WALLET/<receipt UUID>`;
    standalone float receipts, unlinked receipts and suspense stay unavailable;
  - unsupported products render “link unavailable” with the reason.
- The server never emits a `BANK_TO_WALLET` source for a receipt, journal or reference prefix.
  When this deployment has no durable-link relation yet, the adapter reports no proven source.
- Authorization is untouched: `ledger.view` still gates journal reads; `transaction.view` plus real
  workforce scope still gates history.

## Not claimed

- The History → journal click is **not** verified: PR23 `3c7f5c9` has no such control. The combined
  run records that as a blocker and does not treat a manual Finance lookup as the forward half.
- No Layout or navigation change is made by Finance #25; the merged-tree Layout resolution for
  verification is taken from PR #23 content.
