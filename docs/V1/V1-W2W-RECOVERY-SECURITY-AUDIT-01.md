# V1-W2W-RECOVERY-SECURITY-AUDIT-01 — Wallet→Wallet Recovery False-Positive Audit

## 1–2. HEAD / Branch

- **Branch:** `arena/01a10374-monienaija`
- **HEAD at time of audit:** `0ab192c91a3edc559b6aa65d9bfa2655435aacb8` (`test: optimize postgres integration suite`)
- The task brief cited `2a05c62` as "current HEAD"; that commit is an ancestor of the actual current HEAD (`0ab192c`), which already includes it. Per the task's own instruction ("independently verify the CURRENT HEAD... repository source is authoritative"), this audit examined the real current HEAD, `0ab192c`, not the brief's stated commit.

## 3. Exact implementation reviewed

A repository-wide search (`grep -rl` across every `.ts`/`.tsx` file, excluding `node_modules`) and a full-history pickaxe search (`git log --all -S"<term>"` for `TransferRecoveryService`, `probeRecovery`, and `UNK-03`, across every branch and every commit this repository has ever had) were both run. Result: **zero matches, anywhere, ever.**

| Symbol from the task brief | Found in current HEAD? | Found anywhere in git history? |
|---|---|---|
| `TransferRecoveryService` | No | No |
| `probeRecovery` | No | No |
| Recovery-intent persistence/creation/clearing | No | No |
| "UNK-03" (as a label) | No | No |
| Heuristic matcher (amount + direction + phone/name/narration against transaction history) | No | No |

**Conclusion of PART 1: the component the task asks to audit does not exist in this repository, at the current HEAD or at any point in its history.** The remainder of this audit therefore documents (a) what actually exists in its place, and (b) why the originally-reported UNK-03 scenario cannot occur in the current codebase — not because a flawed mechanism was fixed, but because no such mechanism was ever built here.

What **does** exist and was reviewed instead, file by file:

| Concern | Actual file / symbol |
|---|---|
| Wallet→Wallet dispatch (mobile) | `apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx` |
| Mobile idempotency-key minting | `SendMoneyScreen.generateNewIdempotencyKey()` (component-local `useState`, never persisted) |
| Mobile HTTP layer | `apps/customer-mobile/src/services/api-client.ts` (`ApiClient`/`request()`) |
| Mobile auth/session persistence + logout | `apps/customer-mobile/src/store/auth-store.ts`, `apps/customer-mobile/src/services/secure-storage.ts` |
| Backend Wallet→Wallet endpoint | `src/customer-app/customer-app.controller.ts` → `CustomerAppController.createTransfer()` |
| Backend transfer + idempotency engine | `src/transfer/transfer.service.ts` → `TransferService.createTransfer()` / `executeWithinTransaction()` / `normalizeCommand()` |
| Backend idempotency storage | `transfers.idempotency_key` (unique constraint `uq_transfers_idempotency_key`), `transfers.request_hash` |
| Backend transaction-history lookup (the only "history query" that exists) | `TransferService.getWalletTransactions()` — plain, unconditional `WHERE sourceWalletId = $1 OR destinationWalletId = $1 ORDER BY createdAt DESC, id DESC`, no amount/phone/name filtering of any kind |
| A different, real, server-side "recovery" concept (unrelated to the task brief) | `TransferStatus.PENDING_RECOVERY` / `transfers.recovery_reference`, `src/transfer/transfer-lifecycle.service.ts`, ADR: `docs/decisions/ADR/ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md` |

## 4. Recovery architecture (what actually exists)

There is no mobile-side "recovery" step at all. The full lifecycle of a Wallet→Wallet send, as implemented today:

1. `SendMoneyScreen` mints a fresh idempotency key in component state when it mounts: `` `tx-transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` ``. This key lives only in React state — it is **never written to SecureStore, AsyncStorage, Zustand, or any other persistent store.**
2. On submit, it `POST`s `/customers/me/transfers` with that key both as the `Idempotency-Key` header and duplicated into the request body's `reference` field, plus `sourceWalletId`, `destinationWalletId`, `amountMinor`, `currency`, `narration`, and `pin`.
3. On success: the PIN is cleared, and the screen navigates to Home. No further "recovery" or confirmation step occurs.
4. On **any** failure — including a genuine network timeout (`NetworkError`, thrown by `ApiClient.request()` when `fetch` rejects) — the screen: clears the PIN, shows a generic error message (`describeTransferError`, which has no special branch for `NetworkError`, only for `ApiError`), and calls `generateNewIdempotencyKey()` to mint a **brand-new** key for the next attempt.
5. There is no probing of transaction history, no matching by amount/phone/name/narration, and no "is this the transfer I just tried to make?" reconciliation step anywhere in this flow.

The separate, real backend concept named `PENDING_RECOVERY` (`transfer.enums.ts`, `transfer-lifecycle.service.ts`, ADR-0044) is architecturally unrelated to the task brief's described mechanism: it is a server-internal state for a transfer whose *own* ledger-post outcome is ambiguous after a PostgreSQL-level commit-timeout, identified and resolved entirely by the transfer's own immutable `id` and a deterministic `sha256(transferId + ":ledger-post")` recovery reference — never by comparing it to a *different* historical transfer by amount/recipient/narration. It is not reachable or triggered by anything in the mobile client's current code path.

## 5. Identity model (PART 2 answers)

1. **What identifies one logical Wallet→Wallet transfer attempt?** The client-generated `Idempotency-Key` header value, combined server-side with a SHA-256 hash of the logical business payload (`requestHash`).
2. **What kind of identifier is it?** A client-generated idempotency key (`tx-transfer-<timestamp>-<random>`), not a server-issued operation ID and not a pre-allocated transaction ID. It is generated once per screen-mount/attempt-cycle and used for the `Idempotency-Key` header.
3. **Is it persisted server-side?** Yes — as the unique `transfers.idempotency_key` column (DB-enforced via `uq_transfers_idempotency_key`), alongside `transfers.request_hash` (SHA-256 of `{sourceWalletId, destinationWalletId, amountMinor, currency, reference, narration}`, canonical-JSON-then-hashed; **PIN is explicitly excluded** from this hash — confirmed by an explicit code comment: *"PIN is never persisted in requestHash/transfer metadata/journal/audit/response/logs"*).
4. **Can recovery query the backend using that identifier?** Only implicitly: re-POSTing the exact same `Idempotency-Key` + exact same body returns the original transfer (see PART 7). There is no dedicated `GET /transfers/by-idempotency-key/:key` lookup route exposed to the mobile client; the only way the client could reconcile today is a manual read of `GET /customers/me/transactions` with its own eyes, since the key itself is lost from memory once the screen unmounts.
5. **Does recovery infer identity from amount/phone/name/narration/time window/direction?** No — because no recovery mechanism of that kind exists. `TransferService.getWalletTransactions()` performs no such filtering; it returns every transfer touching the given wallet, ordered by recency, full stop.
6. **What exact fields are compared (for the real identity check that does exist)?** `idempotencyKey` (exact string equality, enforced by a unique index) and, once a key match is found, `requestHash` (exact string equality) to decide between "replay" (same hash → return the existing transfer) and "conflict" (different hash → `409`).
7. **What exact ordering is used (history)?** `ORDER BY created_at DESC, id DESC` — a fully deterministic, collision-free ordering (the `id DESC` tiebreak prevents ambiguous ordering for same-millisecond rows); again, this ordering is only ever used for *display*, never for *selecting which transfer to treat as the result of a given attempt*.
8. **What happens if multiple historical transfers satisfy the heuristic?** Not applicable — there is no heuristic. The one real identity lookup (`idempotencyKey`) is backed by a database `UNIQUE` constraint, so it is structurally impossible for more than one row to ever match.

## 6. Reproduction (PART 3)

Because the described mechanism does not exist, "Transfer #2 is wrongly matched to Transfer #1 by a heuristic" cannot be reproduced — there is no code path that performs that comparison. Reproduction was instead redirected, per the task's own fallback instruction ("construct the smallest deterministic unit test that demonstrates the matching algorithm using the actual current production code"), toward proving what **does** happen in the literal scenario the brief describes, using real concurrent HTTP requests against real PostgreSQL. A new test file was added:

**`test/v1-w2w-recovery-audit-01.integration.spec.ts`** (3 tests, all against real PostgreSQL via the existing `createIntegrationDataSource` harness, real `CustomerAppController`/`TransferService`/`LedgerService`):

1. **"Two genuinely distinct ₦5,000 transfers to the same recipient are NEVER conflated"** — reproduces the exact literal UNK-03 scenario (Customer A sends ₦5,000 to Amina twice, each a separate logical attempt with its own `Idempotency-Key`). Result: **B — both transfers are correctly, separately recorded.** Two distinct transfer IDs, two separate debits (final balance: 500,000 after funding 1,500,000 and sending 500,000 twice), two separate rows in `GET /customers/me/transactions`. No conflation of any kind occurred.
2. **"The exact same logical request fired twice concurrently"** — the real race a client timeout-then-correct-retry (same `Idempotency-Key`, same body) would trigger. Fired via `Promise.all` as two truly concurrent HTTP POSTs. Result: exactly one `201`-or-`409` pair, both successful responses (when more than one succeeds) carry the identical transfer `id`, exactly one row in `transfers` for that key, exactly one `ledger_journals` row, exactly one debit.
3. **"Reusing an Idempotency-Key for a materially different request (different amount)"** — deterministically rejected with `409 Conflict`, never silently merged into the prior transfer and never silently accepted as a second transfer.

**Test results — run 4 times total (1 initial + 3 repeats) for determinism:** 3/3 passing, every run, identical outcome each time. No flake observed.

## 7. Customer isolation (PART 4)

Inspected `apps/customer-mobile/src/services/secure-storage.ts` and `apps/customer-mobile/src/store/auth-store.ts` directly (SecureStore-backed, falls back to an in-memory `Map` only on native-API failure or in `NODE_ENV=test`).

- **Keys persisted:** exactly three — `auth_session_token`, `auth_customer_id`, `auth_session_data`. There is no fourth key anywhere in the mobile codebase resembling a "pending transfer," "recovery intent," or "last transfer attempt" — because, per PART 4/6, none is ever created.
- **Logout (`useAuthStore.logout()`):** unconditionally removes all three keys in a `finally` block, even if the best-effort server-side revocation call (`POST /customers/sessions/logout`) itself fails. There is no code path that leaves any of the three behind after logout.
- **Namespacing:** the three keys are *not* namespaced by customer ID (they are fixed string keys, not `auth_session_token:<customerId>`), but since logout unconditionally clears them and login unconditionally overwrites them with the newly-authenticated customer's own session data, a second customer logging in on the same device/session context always starts from a guaranteed-clean slate — there is no stale value from a prior customer that could be read, because the only three values that exist are always either fully absent or belong to the currently-authenticated session.
- Because no recovery-intent value is ever created in the first place, there is nothing for a second customer to observe, consume, or recover — **the specific cross-customer recovery-leakage scenario the brief describes cannot occur, as a direct consequence of PART 1's finding, not as a result of any isolation logic being specifically tested for it.**

## 8. Logout-state result

Covered above: all three persisted auth keys are cleared unconditionally on logout. No transfer-recovery-specific state exists to evaluate for logout-survival.

## 9. Backend financial-integrity result (PART 7)

Verified directly against real PostgreSQL (see PART 6/reproduction above, plus the pre-existing `test/a23-customer-app.integration.spec.ts` test #6 and the unit-level `test/transfer.service.spec.ts` "allows only one of two concurrent attempts to spend the same balance" test):

| Question | Answer | Evidence |
|---|---|---|
| Same idempotency key replay (identical body) | Returns the same transfer, no second debit | New test #2 |
| Different idempotency key for a logically-similar second transfer | Creates a genuinely new, separate transfer | New test #1 |
| Concurrent requests, same key | Exactly one financial effect; both responses (when both succeed) report the same transfer id | New test #2, `Promise.all` |
| Duplicate debit prevention | Enforced at the database level (`uq_transfers_idempotency_key` UNIQUE constraint + `SERIALIZABLE` transaction + explicit constraint-violation-recovery catch block in `TransferService.createTransfer`) | Code read (`transfer.service.ts` lines ~114–165) + test #2 |
| Ledger journal count for one logical transfer | Exactly 1 | New test #2 (`SELECT count(*) FROM ledger_journals WHERE id = ...`) |
| Transfer row count for one logical transfer | Exactly 1 | New test #2 (`SELECT ... FROM transfers WHERE idempotency_key = ...`) |
| Resulting wallet balances | Exactly one amount debited/credited, not two | New test #2 (`getWalletBalance`) |
| Idempotency key reused with a different amount | Deterministic `409`, no silent merge or silent second debit | New test #3 |

**The key question the task poses — can the recovery flaw cause actual duplicate financial posting, or does it merely cause the client to display/recover the wrong historical transaction? — has a definitive answer here: neither, because there is no recovery mechanism at all to cause either outcome.** The backend's own idempotency architecture is sound and independently verified above: it is keyed on an immutable client-generated token plus a canonical hash of the exact business parameters, never on a resemblance heuristic.

### A real, adjacent finding (distinct from UNK-03, noted for completeness)

While tracing this flow, one genuine (if much narrower, and purely UX-facing-with-financial-implication) gap was found and is recorded here for transparency, though it is explicitly **out of scope to fix in this audit**: `SendMoneyScreen`'s idempotency key lives only in component `useState` and is **never persisted**, and on *any* failure — including an ambiguous network timeout where the request may have actually succeeded server-side — the screen mints a **brand-new** key for the next attempt (confirmed as the documented, intentional design in `docs/V1/V1-CUSTOMER-02-WALLET-TO-WALLET-AUTHORIZATION-COMPLETION-01.md`, row "Failure/recovery": *"mobile screen clears PIN and regenerates idempotency key on any failed attempt"*). Because the backend's duplicate-protection is scoped to the `Idempotency-Key` actually presented, a customer who sees a timeout error and manually retries with what the app treats as a "new" key is, from the backend's point of view, submitting a **genuinely new, independently valid transfer** — if the original timed-out request had in fact already completed, this retry would result in a real second debit, not a UI display error. This is **not** the UNK-03 mechanism (no history-matching occurs), it does not involve cross-customer leakage, and it does not corrupt the ledger's own accounting (both debits would be real, correctly-posted, auditable transfers) — but it is a legitimate, separate product-reliability gap: the current design cannot safely tell a customer "we don't know if that worked — don't resend" versus "that failed — safe to resend," and simply treats every failure, including an ambiguous one, as "safe to mint a new attempt." Flagging this explicitly as **informational for a possible, separately-scoped future task** (e.g., persisting the in-flight idempotency key and only regenerating it after a *confirmed* non-retryable rejection, not after a timeout) — no change was made here, per PART 10 of the task brief.

## 10. Severity classification (PART 6)

**NOT A DEFECT** for the UNK-03 finding as literally described, because the described mechanism does not exist in this codebase to be defective. Specifically:

- ❌ Duplicate customer debit caused by heuristic recovery matching — not possible (no such matching exists); backend idempotency independently verified safe (PART 9 above).
- ❌ Wrong receipt displayed due to heuristic recovery matching — not possible (no such matching exists; the mobile app shows no receipt reconciliation UI at all today, it just navigates to Home on success or shows a generic error on failure).
- ❌ Customer believing the wrong transfer succeeded, caused by this mechanism — not possible.
- ❌ Cross-customer recovery leakage — not possible (PART 4/7).
- ✅ Customer believing a transfer failed when the underlying request may have actually succeeded, and subsequently submitting a **genuinely new, legitimately-idempotency-keyed** retry that could become a real second debit — **this is a real, separate, narrower gap** (see "adjacent finding" above). If this were being classified on its own, it would be assessed as **P2** (a real reliability/support-burden risk under a specific, low-probability network condition — a correctly-posted timeout-then-retry double send, not a ledger-corruption or security defect, not involving any cross-customer boundary, and mitigable today by the customer checking transaction history or contacting support) — but it is explicitly **out of scope for this audit** to size further, since it is not the finding this task was asked to investigate.
- Support/reconciliation ambiguity — low: `GET /customers/me/transactions` gives a customer (and support staff who can see the same data) an accurate, unconflated list to resolve any confusion manually.
- Financial loss / customer dispute — no mechanism found by which the *audited* UNK-03 behavior could cause either.

## 11. Verdict

**NOT REPRODUCED.**

The previously reported UNK-03 finding describes a `TransferRecoveryService`/`probeRecovery` mechanism using amount/direction/phone-or-name/narration heuristics against transaction history. No such service, function, persisted recovery-intent state, or heuristic-matching logic exists anywhere in the current HEAD (`0ab192c`) of this repository, nor has it ever existed in this repository's git history (verified by exhaustive pickaxe search across all commits on all branches). This audit does not merely fail to find a live instance of the bug — it establishes that the component under audit itself is absent from the codebase. This audit **supersedes the prior report's technical conclusion for the current HEAD** while leaving the historical record (wherever it originated — it does not appear in this repository's own `docs/` tree either) untouched and unmodified.

The real Wallet→Wallet transfer-identity architecture that exists instead (client-generated `Idempotency-Key` + server-side canonical-request-hash, enforced by a unique database constraint under `SERIALIZABLE` isolation) was independently, empirically verified against real PostgreSQL in this audit to correctly: (a) keep two genuinely distinct transfers to the same recipient fully separate, (b) collapse a true concurrent same-key race into exactly one financial effect, and (c) reject a mismatched reuse of a key with a deterministic conflict. This is architecturally the "query/reconcile the exact original logical operation" approach the task brief identifies as the desirable model — it is already what this backend does, not something that needs to be newly built.

## 12. Recommended next action

1. **Treat UNK-03 as closed for this codebase** — it is not reproducible because its described mechanism is not present.
2. **No remediation is required or has been performed**, per PART 10 of this task.
3. **Optional, separately-scoped future task** (not authorized by this audit): address the adjacent finding above — persist the mobile client's idempotency key across the ambiguous-timeout window (e.g., in `SecureStore`, cleared only after a confirmed terminal outcome) so a retry after a genuine network timeout reuses the same key instead of minting a new one, giving the customer the benefit of the backend's existing, already-safe idempotent-replay behavior instead of bypassing it. This would be a mobile-only change; the backend requires no change for this.
4. If the UNK-03 report originated from a different repository, a different branch, or a different historical snapshot of this codebase, that source should be re-examined directly — it does not describe the code currently on `arena/01a10374-monienaija`.
