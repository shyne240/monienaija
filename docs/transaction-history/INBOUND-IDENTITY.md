# Durable inbound identity — PR #23

## Persisted evidence and supported transitions

| Stage / path | Persisted evidence | History identity / supported transition |
| --- | --- | --- |
| Banking intake | `banking_inbound_payments.id`, immutable institution/provider/environment/provider transaction reference, receiving account, currency, gross/fee/net and recorded time | `BANK_TO_WALLET/<banking UUID>` is the permanent intake business key, not a generated read-time hash. UNVERIFIED / UNKNOWN / REJECTED / VERIFIED remain provider verification states, not credits. |
| Banking verification | Same banking row; `BankingInboundService.verify` checks the configured provider environment and the returned exact provider transaction reference; rejects a conflicting currency or gross amount when supplied | Same UUID and URL. No posting is inferred from VERIFIED. |
| Institution float credit | Immutable `agent_float_funding_receipts` includes institution, provider, environment, exact provider transaction reference, funding account number, currency, amount, policy, wallet and posted journal | New immutable `banking_inbound_float_links` binds the intake UUID to one receipt only when all identity terms agree and the receipt journal is POSTED under the same institution. Same `BANK_TO_WALLET` UUID becomes CREDITED; linked receipt is not another list row. |
| Float receipt first, banking later | Same complete evidence, once the later banking observation is VERIFIED | Existing `AGENT_FUNDING/<receipt UUID>` remains a detail alias. It returns the canonical `BANK_TO_WALLET` row without changing or leaking the saved URL. Before proof, both source records remain independent; after proof, one list row. |
| Legacy wallet-credit intake / receipt | `inbound_funding_observations`: provider/reference hash/evidence hash, bank/account/amount/currency. `inbound_funding_receipts`: immutable receipt UUID, provider/reference hash/evidence hash, destination, journal, CREDITED or SUSPENSE | These paths have **no persisted environment**. Provider/hash/institution is not sufficient evidence to combine them with banking sandbox/production rows. CREDITED legacy receipts keep `BANK_TO_WALLET/<receipt UUID>` and are no longer dynamically assigned a banking UUID. No bank suppression based only on a hash. |
| Suspense | Immutable SUSPENSE receipt, original posted journal, credit account and evidence hash | No supported suspense-resolution command or immutable receipt → resolution journal → destination binding exists in this checkout. `receive` replays the original receipt; it does not resolve it. No resolution is fabricated. These receipts remain outside the institution Bank to Wallet credited projection; platform accounting/review evidence remains intact. |

A receipt is not linked just because an operator supplies a UUID or because a journal ID happens to match. Missing receiving account, different institution/provider/environment/reference/currency/net amount, non-VERIFIED intake or conflicting journal binding leaves it unlinked. Records without trustworthy historical institution scope remain inaccessible to institution readers.

## Migration / write guarantees

Migration **`1785753600806-DurableInboundIdentity.ts`** is additive. It does not mutate receipts, journals, credentials, role grants or historical scope. It does not run an inferred historical backfill.

- The banking row is the durable parent. Its original UUID is retained; no migration rewrites an existing transaction URL.
- `banking_inbound_float_links.payment_id` is a primary key, and `float_receipt_id` is unique. Both have restrictive foreign keys. A validation trigger independently checks all persisted matching terms, including the posted journal institution; direct invalid inserts fail too.
- Links cannot be updated/deleted. Banking UUID, institution, provider, environment, receiving account and intake timestamp become immutable alongside the already-immutable amounts/reference/currency. Once linked, verification/journal-binding changes cannot invalidate the link.
- Link capture runs on new banking insert/verification events and new float receipts in the same database transaction. Bounded advisory-lock stripes prevent a bulk intake from exhausting one lock per payment; constraints remain authoritative. Runtime has SELECT/INSERT only on the link table, with trigger validation and immutability. No additional approval or money-moving capability is granted.
- Legacy matching records are not automatically backfilled merely by deploying the migration. A future reviewed reconciliation/backfill can only insert links passing the same validator. No operational command for that backfill is introduced here.
- Independent concurrent transactions which cannot observe each other's committed evidence may remain unlinked; this is fail-closed, not a licence to choose a read-time match. Automatic cross-transaction reconciliation and historical alias backfill are not claimed by this change.

## Compatibility / authorization

All original four-product IDs remain unchanged. Native governed agent funding IDs remain unchanged. Bank intake detail URLs remain valid. Float receipt detail URLs remain valid through a proven link, including receipt-first arrival. Detail aliases are resolved **inside the scoped history query**, not before authorization. They return the canonical TYPE/UUID; clients must not assume an alias's TYPE equals the returned canonical TYPE.

List, reference and detail still require `transaction.view`, a real workforce session and ACTIVE historical institution scope, except existing explicit platform attribution authority. The alias grants no cross-institution access. `ledger.view` still controls journal IDs. No workforce catalogue grants or passwords change.

Previously published dynamic bank/legacy-receipt hash matches were not persisted and cannot be reconstructed reliably (especially across environments). Both underlying saved UUID URLs remain readable subject to their own source's institution scope, but this change does **not** assert that an old ambiguous banking URL now proves ownership of a legacy wallet receipt. Such records stay separate; hiding one would repeat the unsafe inference.

## Exact missing evidence / decisions

1. **Legacy wallet receipt ↔ bank intake:** a trusted provider/environment context captured at verification, an immutable explicit intake/receipt binding, agreement on institution/reference/account/currency/net terms, and an evidence-backed historical alias/backfill policy. The legacy verifier API itself currently accepts only provider key/reference/correlation, so an environment cannot be honestly recovered by adding a nullable UI field.
2. **Suspense → wallet / float:** an approved resolution execution path retaining the original receipt UUID, governing authorization/policy, resolution journal UUID, destination binding and exactly-once replay contract. The immutable original receipt must not be edited to pretend it was originally CREDITED.
3. **Unmatched institutional float:** missing account or conflicting persisted terms requires investigation, not automatic merge. Standalone float remains `AGENT_FUNDING/<receipt UUID>` until proof is captured.
4. **Historical/concurrent reconciliation:** a reviewed retry/backfill workflow for evidence that was committed independently or before this migration. No governance approval for such a workflow is claimed.

## Verification evidence

`test/a3d-agent-float-funding.integration.spec.ts` now executes the supported transition with a real AppModule, fully migrated disposable PostgreSQL and real local-admin workforce login. It authenticates all 11 existing fixture passwords and compares hashes unchanged. Institution registration/activation/account opening and workforce scope use the existing governed fixture. The provider verifier and sandbox float policy authority are controlled test boundaries; ledger posting, receipt creation, identity triggers, sessions and history authorization are real. This is not production funding authority.

Chromium signs in as OPERATIONS, captures the detail URL at UNVERIFIED, then reopens that exact URL after real verification and policy-backed float credit. HTTP assertions prove the canonical payment appears once across all types, state changes, old float URLs resolve, another institution receives empty reference results / detail and alias 404, and replay causes no additional credit. Additional cases reject mismatched reference/account/environment/amount/institution links, reject a provider verification response for a different reference, and test receipt-first arrival.

Artifacts:

- `evidence/inbound-identity-results.json`: original saved URL, before/after detail, one-row result and declared test boundaries; no session tokens.
- `evidence/inbound-identity-before.png` and `inbound-identity-after.png`: actual local-admin browser detail before/after.
- Latest migrated regression command and counts are recorded in `evidence/test-results.md`.

This closes the tested bank-intake → verification → proven institutional float identity path. It does not claim unsupported legacy wallet or suspense-resolution transitions work. PR remains draft; unposted funding attribution, remaining product browser matrix, mixed-product plans and Finance #25 round trip remain subsequent-turn checklist items.
