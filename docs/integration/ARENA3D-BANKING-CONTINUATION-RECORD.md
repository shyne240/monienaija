# Arena 3D — Banking integration continuation record

Durable, tracked continuation record for the **banking provider, settlement, reconciliation and
agent funding** mission. Updated before approaching tool-call limits so completed implementation is
never left in an uncommitted working tree.

**Active branch:** `arena/defdd0fd-monienaija`
**Starting checkpoint:** `5b9cd3e6` (accepted KYC documentation checkpoint; local == remote verified)
**Accepted KYC application checkpoint:** `e9609925`

---

## 1. Baseline verification

| Question                     | Answer                                                 |
| ---------------------------- | ------------------------------------------------------ |
| Local HEAD at mission start  | `5b9cd3e6944d35ed58a8b7c81d315b67616b0499`             |
| Remote HEAD at mission start | `5b9cd3e6944d35ed58a8b7c81d315b67616b0499` (identical) |
| Working tree                 | clean                                                  |
| Frozen branches              | read-only; `arena/5b239ff5` still `004dd800`           |

### 1.1 Accepted KYC baseline preserved

| Gate                   | Result                             |
| ---------------------- | ---------------------------------- |
| Full PostgreSQL matrix | 153/153 suites, 2751 tests, exit 0 |
| Root unit suite        | 257/257 suites, 2981/2981 tests    |
| Isolated KYC sweep     | 11/11 suites, 149/149 tests        |

### 1.2 The 256-versus-257 documentation inconsistency — corrected

Two stale figures existed in `ARENA3D-CONTINUATION-RECORD.md`:

- the §7.4 "where the numbers now stand" table reported **256/256 suites, 2978 tests**, superseded by
  the fixture-race regression test. Corrected to the recorded transcript figure **257/257, 2981**;
- §7.2 recorded 256/2978 as though current. It is correct _for commit `a34574c5` only_, so it is kept
  as history with an explicit "Superseded" note naming the current figure and the cause of the delta.

Both corrections are taken from the recorded transcripts, not from arithmetic.

---

## 2. Migration allocation — decided before any migration was written

The institutional governance sequence occupies `1785753600300`–`1785753600505`. Migrations apply in
filename order and a published identifier is never reused or renumbered.

**Allocation for banking integration: `1785753600600`–`1785753600699`.**

Verified free before use:

```
$ ls src/migrations/ | grep -cE "^17857536006"
0
```

No collision with any published identifier. Every migration added is listed in §6 as it lands.

---

## 3. Provider documentation references

Fetched page content is not persisted, so the contracts that later decisions depend on are recorded
here. `docs.monnify.com` returned **HTTP 522** during this session; nothing was invented to fill the
gap, and anything unconfirmed is marked as such.

| Capability            | Endpoint / contract                                                                                                                                                                                             | Source                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Authentication        | `POST /api/v1/auth/login`, `Authorization: Basic base64(apiKey:secretKey)` → `accessToken`, `expiresIn`                                                                                                         | Monnify docs                                 |
| Reserved account      | `POST /api/v2/bank-transfer/reserved-accounts`                                                                                                                                                                  | Confluence "Reserve An Account (V2)"         |
| Reserved account read | `GET /api/v2/bank-transfer/reserved-accounts/{accountReference}`                                                                                                                                                | Monnify Go SDK constants                     |
| Reserved acct dealloc | `DELETE /api/v1/bank-transfer/reserved-accounts/reference/{accountReference}`                                                                                                                                   | Monnify Go SDK constants                     |
| Reserved acct txns    | `GET /api/v1/bank-transfer/reserved-accounts/transactions?accountReference=&page=&size=`                                                                                                                        | Monnify Go SDK constants                     |
| Reserved acct KYC     | `PUT /api/v1/bank-transfer/reserved-accounts/{accountReference}/kyc-info`                                                                                                                                       | Monnify Go SDK constants                     |
| Bank directory        | `GET /api/v1/sdk/transactions/banks` → `[{name, code, ussdTemplate, baseUssdCode, transferUssdTemplate}]`                                                                                                       | Confluence "Get Banks With USSD Short Code"  |
| Account-name enquiry  | `GET /api/v1/disbursements/account/validate?accountNumber=&bankCode=` → `{accountNumber, accountName, bankCode}`                                                                                                | Monnify OpenAPI                              |
| Single disbursement   | `POST /api/v2/disbursements/single`                                                                                                                                                                             | Monnify Go SDK constants                     |
| Disbursement OTP      | `POST /api/v2/disbursements/single/validate-otp`                                                                                                                                                                | Monnify Go SDK constants                     |
| Transfer status       | `GET /api/v2/disbursements/single/summary?reference=`                                                                                                                                                           | Monnify Go SDK constants                     |
| Transaction status    | `GET /api/v2/transactions/{transactionReference}`                                                                                                                                                               | Monnify Go SDK constants                     |
| Settlement lookup     | `GET /api/v1/transactions/find-by-settlement-reference?reference=`                                                                                                                                              | Monnify Settlements API                      |
| Settlements list      | `GET /api/v1/settlements`                                                                                                                                                                                       | Monnify Settlements API                      |
| Wallet balance        | `GET /api/v1/disbursements/wallet-balance?walletId=` — documented **deprecated**                                                                                                                                | Confluence "Get Wallet Balance (Deprecated)" |
| Refunds               | `POST /api/v1/refunds/initiate-refund`, `GET /api/v1/refunds/{refundReference}`                                                                                                                                 | Monnify "Transaction Refunds"                |
| Webhook               | header `monnify-signature`; events `SUCCESSFUL_TRANSACTION`, `SUCCESSFUL_DISBURSEMENT`, `FAILED_DISBURSEMENT`, `REVERSED_DISBURSEMENT`, `SETTLEMENT`, `SUCCESSFUL_REFUND`, `FAILED_REFUND`, `LOW_BALANCE_ALERT` | developers.monnify.com/docs/webhooks         |

### 3.1 Four documented caveats that shape the implementation

These separate an integration that works against the docs from one that works against the provider.
Each is encoded in the adapter rather than assumed:

1. **The webhook signature prose is wrong.** The docs say `SHA-512(client secret + request body)`.
   Monnify's own published example hash only reproduces as **`HMAC-SHA512(key = client secret,
message = raw body)`**. Implementing the prose yields a check that never passes. The adapter
   implements HMAC-SHA512 over the **raw bytes** and proves it against the documented example digest.
2. **Sandbox webhooks carry no signature header.** Production does. Requiring the header
   unconditionally makes sandbox untestable; permitting its absence unconditionally is a forgery hole
   in production. The adapter treats a missing signature as **invalid** in `production` always, and in
   sandbox accepts it only from the controlled fixture transport.
3. **The per-payload `transactionHash` is a different scheme.**
   `SHA512(clientSecret|paymentReference|amountPaid|paidOn|transactionReference)`, pipe-separated, no
   spaces. It is **not** the `monnify-signature` header and the two are never substituted for
   one another.
4. **A HTTP 200 with `requestSuccessful:false` is a provider rejection.** Status is read from
   `responseCode`/`responseMessage`, never inferred from the HTTP status.

Further constraints: `wallet-balance` is documented **deprecated** (advertised, flagged deprecated,
nothing financial depends on it); disbursement is **two-factor**, so an OTP challenge is _not_ an
accepted transfer; and reserved accounts and disbursements are merchant products — agency-banking
float custody and third-party wallet issuance are separately regulated and are **not** claimed.

### 3.2 Commercial boundary

The product owner is pursuing provider activation. That is **not** evidence of commercial
entitlement, financial licensing, or institutional approval, and nothing here asserts otherwise.
Alternative providers (Anchor, Paystack) are referenced only to justify the provider-independent
boundary; **no speculative alternative-provider contract is implemented.**

---

## 4. Implementation groups

| #   | Group                                                      | State                          |
| --- | ---------------------------------------------------------- | ------------------------------ |
| 1   | Provider capability contracts + registry                   | done                           |
| 2   | Monnify transport, auth, token coordination, error mapping | done                           |
| 3   | Banking provider governance (protected, maker/checker)     | done                           |
| 4   | Bank directory + account-name enquiry                      | done (adapter + HTTP)          |
| 5   | Virtual account provisioning lifecycle                     | done + HTTP + customer mobile  |
| 6   | Webhook ingestion + signature verification                 | done + real-HTTP tests         |
| 7   | Inbound deposits (A7 integration)                          | wired (institution + verifier  |
|     |                                                            | bound; suspense unavailable)   |
| 8   | Outbound transfers (A6) + durable dispatch                 | wired + worker tested          |
| 9   | Transfer status + financial recovery                       | done + HTTP + mobile recovery  |
| 10  | Fees and authorization binding                             | done (9/9, migration …604)     |
| 11  | Settlement verification                                    | deliberately unsupported       |
| 12  | Reconciliation engine + exception management               | done + admin HTTP + admin UI   |
| 13  | Admin banking workspace                                    | done (879/879 admin-web)       |
| 14  | Customer mobile banking                                    | done (196/196 customer-mobile) |
| 15  | Agent funding account + agent mobile                       | done (7/7 HTTP, 317/317 agent) |
| 16  | KYC residual machine code                                  | done (6 codes, 5 regressions)  |
| 17  | Consolidated acceptance                                    | **in progress**                |

Legend: **done** = implemented, tested and pushed; **schema done** = migration and structural
assertions landed, service layer outstanding; **adapter done** = provider-side call implemented and
unit-tested against documented response shapes, caller wiring outstanding; **unsupported** = the
adapter deliberately refuses because no documented response schema exists for this capability, so
guessing one would be an invented contract.

---

## 5. Tests executed

| Suite                                                    | Result | Command                                                                                         |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `banking-provider-registry.unit.spec.ts`                 | 6/6    | `npx jest --config jest.config.js --runTestsByPath test/banking-provider-registry.unit.spec.ts` |
| `monnify-token-manager.unit.spec.ts`                     | 14/14  | `npx jest --config jest.config.js --runTestsByPath test/monnify-token-manager.unit.spec.ts`     |
| `monnify-http-allowlist.unit.spec.ts`                    | 9/9    | `npx jest --config jest.config.js --runTestsByPath test/monnify-http-allowlist.unit.spec.ts`    |
| `monnify-webhook-signature.unit.spec.ts`                 | 12/12  | `npx jest --config jest.config.js --runTestsByPath test/monnify-webhook-signature.unit.spec.ts` |
| `monnify-provider.unit.spec.ts`                          | 24/24  | `npx jest --config jest.config.js --runTestsByPath test/monnify-provider.unit.spec.ts`          |
| `banking-provider-governance-schema.integration.spec.ts` | 9/9    | full PostgreSQL chain, see command below                                                        |

Banking unit total: **65/65** (registry 6 + token 14 + allowlist 9 + webhook 12 + adapter 24).
Governance schema assertions: **9/9** against a real PostgreSQL database built by the real migration
chain, configured exactly as the KYC matrix was:

```
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<id> \
  DB_HOST=127.0.0.1 DB_PORT=44679 DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
  node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js \
  --config jest.integration.config.js --runInBand \
  --runTestsByPath test/banking-provider-governance-schema.integration.spec.ts
```

**A real defect the error-mapping tests caught.** The credential scrubber used `\S+`, which stops at
the first space. `authorization: Bearer abc.def` was therefore rewritten to
`[REDACTED] abc.def` — the credential **survived**, and the output looked sanitised, which is worse
than not scrubbing because it stops anyone looking. The pattern now consumes an optional scheme word
plus the whole token run. This is exactly the class of bug that a test written against the intended
behaviour catches and a code review does not.

The registry tests are not decoration — two of them encode rules that are otherwise easy to erode:

- a provider that **advertises** `OUTBOUND_TRANSFER_SUBMIT` without implementing
  `submitOutboundTransfer` is refused at registration, so the failure cannot surface at 3am during a
  real transfer;
- `require('unknown')` throws and `supports()` returns false. There is deliberately **no** `getAny()`
  or fallback, because silently rerouting to a different provider is the one thing this architecture
  must never do.

## 6. Migration inventory

| Migration                                 | Purpose                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1785753600600-BankingProviderGovernance` | protected banking-provider configuration: heads, proposals, append-only versions, protected decision evidence, immutable-approved-record triggers, and emergency operational disablement                                     |
| `1785753600601-BankingOperationRecords`   | durable provider-facing records: virtual-account reservations (with `UNKNOWN` as a first-class outcome), inbound payments (gross/fee/credited kept separate), outbound operations (operation reference immutable, no DELETE) |

Within the reserved allocation `1785753600600`–`1785753600699`; no published identifier was reused.
Verified to apply by running the full real migration chain (the PG template database is built by
running every migration), then exercised structurally by
`banking-provider-governance-schema.integration.spec.ts`.

## 7. Remaining implementation

| Group | Outstanding work                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| 3     | service layer over migration `1785753600600`: propose / approve / version publication, reusing              |
|       | `ProtectedAuthorityService`; the schema, its triggers and its protected-decision table are already in place |
| 4     | wire the adapter's directory and enquiry calls into an application service; nothing provider-side remains   |
| 5     | reserved-account persistence and lifecycle; adapter calls exist, storage does not                           |
| 7–9   | inbound deposits, outbound dispatch, transfer status and recovery — the money-moving core                   |
| 10–12 | fees, settlement verification (blocked, see below) and the reconciliation engine                            |
| 13–15 | admin, customer and agent surfaces                                                                          |
| 16–17 | KYC residual machine code and consolidated acceptance                                                       |

Groups 2, 3 and 6 are complete; group 1's contracts and registry are complete and stable. Groups 4 and
5 are complete **only** on the provider side: the adapter is written and unit-tested, but no
application code calls it yet, so nothing in this repository can move money today. Group 3 governs
_who may be engaged_; it does not yet gate a live call, because no live call exists.

## 7.0e Group 6 (ingestion half) — the webhook endpoint

`src/banking/banking-webhook.service.ts` connects the signature verification from §8.2 to the inbound
record. The ordering is the control: verify over the **raw bytes**, acknowledge quickly and dedupe on
the provider's own reference, then require server-to-server verification before anything is money.

Asserted: a valid signature records the payment `UNVERIFIED` (a webhook is not verification); a forged
signature, a body tampered with after signing, and the _documented-but-wrong_ `SHA512(secret + body)`
prose formula are all rejected; a missing signature is rejected in production and in sandbox unless the
fixture transport explicitly vouched for it; oversized bodies are refused; unknown event types and
payloads with no reference or no amount are acknowledged and ignored rather than guessed at; a replay
returns `alreadyRecorded`; and the failure reason returned to the caller is deliberately coarse
(`Signature verification failed`) so a forgery attempt learns nothing about how close it was.

## 7.0d Group 12 — reconciliation that cannot move money

`1785753600602` + `src/banking/banking-reconciliation.service.ts`. The design constraint is that
reconciliation has **no ability to change a financial record**. It observes, compares, and raises
exceptions. Asserted structurally, so a future change cannot quietly add the ability:

- observations are append-only: UPDATE and DELETE are refused by trigger _and_ withheld by grant;
- an exception's raising evidence (kind, subject, observation, both amounts) is immutable, so a
  difference cannot be edited to look smaller;
- the resolution vocabulary is `MATCHED | ACCEPTED_DIFFERENCE | ESCALATED` — there is no `ADJUSTED`,
  and `banking_reconciliation_runs` has no `adjust`/`journal`/`ledger` column at all;
- a resolved exception cannot be reopened; a new difference is a new exception;
- **an unverifiable check becomes an exception, not a pass.** This is how Monnify's missing settlement
  schema stays honest: `UNVERIFIABLE` is loud in the worklist rather than silently absent from it;
- one open exception per subject and kind (partial unique index), so repeated runs record fresh
  evidence without duplicating the question;
- no amount comparison is invented when one side has no amount to compare.

**A defect the tests caught:** the run's `observations` counter only incremented when an exception was
raised, so a run that checked a thousand clean records reported checking none. Fixed by counting every
observation. The test that found it asserted the counter's _meaning_, not its existence.

## 7.0c Group 5 — virtual accounts, where a retry creates a second NUBAN

`src/banking/banking-virtual-account.service.ts`. The dangerous case is a provisioning timeout: the
account may exist. Reacting by provisioning again gives the customer two NUBANs, and one of them will
keep collecting money nobody reconciles. So:

- an `UNKNOWN` reservation **blocks further provisioning for that wallet** — the service returns the
  existing reservation without calling the provider, and a partial unique index makes the same refusal
  hold against a future code path;
- an unreliable provider yields `UNKNOWN`, never `REJECTED`. Only `PROVIDER_REJECTED`/`VALIDATION`
  becomes `REJECTED`, because only then can the customer safely correct details and retry;
- no account number is ever stored or returned unless the provider issued one. `PENDING` returns an
  empty account list, so the customer is never shown a NUBAN that cannot receive funds;
- resolution is `enquire()` by the same account reference — it never submits;
- the `PENDING` path initially failed against PostgreSQL with `inconsistent types deduced for
parameter $2`, because the same parameter was used both as a bare `varchar` and inside a `CASE`.
  An explicit cast fixes it; worth recording because the failure only appears against a real server.

## 7.0b Group 7 core — inbound deposits, where the input is untrusted

`src/banking/banking-inbound.service.ts`. A webhook is unauthenticated input from the internet, so a
claim is recorded `UNVERIFIED` and only becomes `VERIFIED` after the provider confirms it
server-to-server. Specific behaviours asserted:

- deduplication is on the provider's transaction reference (unique constraint), so a replayed webhook
  returns the existing record. A replay carrying **different amounts does not restate the record** —
  that is evidence of a problem, not permission to edit history;
- a provider outage, a provider failure result, or a `PENDING` provider status all leave the payment
  `UNKNOWN`. None of them is treated as received;
- where the provider reports an amount that disagrees with the webhook, the record is `REJECTED`
  rather than adjusted — two conflicting accounts of what a customer paid are a human's problem;
- `CONFLICT` is a dispute, not a payment;
- `verifiedUnposted()` returns only `VERIFIED` rows with no ledger entry, so the posting path cannot
  consume an unproven webhook. This service does **not** post to the ledger; posting belongs to the
  governed financial path.

## 7.0a Groups 8–9 core — the outbound path, where uncertainty costs money

`src/banking/banking-outbound.service.ts` is the money-moving core. It is split into `prepare()` and
`dispatch()` precisely so a crash between the two leaves an inspectable record rather than an
invisible attempt:

- the operation reference is **derived** from `(institution, wallet, idempotencyKey)` rather than
  random, so two concurrent callers derive the _same_ reference and the unique constraint turns the
  second into a no-op instead of a second transfer. A random reference would make that collision
  undetectable — this is the difference between uniqueness and safety;
- `prepare()` commits the record first; `dispatch()` refuses to run for anything not in `CREATED`,
  which is the actual mechanism behind "never retry an uncertain submission" — it is not a comment;
- timeout, transport fault, an adapter that throws, or an unclassifiable outcome all resolve to
  `UNKNOWN`. Only an explicit `PROVIDER_REJECTED`/`VALIDATION` becomes `FAILED`;
- `NOT_SENT` returns the record to `CREATED`, and is the _only_ state from which a second dispatch is
  possible — because the adapter is certain nothing reached the provider;
- there is no `resubmit()` and no `markSuccessful()`. Recovery is `enquire()`, which asks the provider
  using the same reference, and `escalateToReview()`, which accepts no target state at all.

`NOT_FOUND` from an enquiry leaves the operation `UNKNOWN` on purpose: the provider having no record
is not proof that no transfer happened.

Asserted by 14 PostgreSQL tests, including the concurrency case (three simultaneous `prepare()` calls
⇒ one record, one provider call) and a timeout followed by a second `dispatch()` that must not reach
the provider.

## 7.0 Group 5 — persistence, and a defect that would have leaked evidence

Migration `1785753600601` adds three record families. The design rule throughout is that the database
must be able to answer "what did we ask the provider, and what do we actually know" without
consulting application memory:

- `banking_virtual_account_reservations` records the provider conversation, including attempts that
  produced nothing. `outcome='UNKNOWN'` is a normal state, and a **partial unique index permits at
  most one UNKNOWN reservation per wallet** — two unknowns would mean two possible accounts at the
  provider, which must be resolved by enquiry, never by resubmitting.
- `banking_inbound_payments` keys on the provider's transaction reference, so a replayed webhook
  collides instead of crediting twice. Gross, fee and credited are three columns with
  `credited = gross - fee` as a CHECK, because collapsing them is how fee reconciliation quietly
  loses money.
- `banking_outbound_operations` is what makes "never generate a fresh reference to retry an uncertain
  submission" enforceable: a trigger refuses any change to `operation_reference`, refuses to rewrite a
  recorded provider transaction reference, and refuses DELETE outright.

**The defect the tests caught.** The outbound trigger was written `BEFORE UPDATE OR DELETE` but
checked `TG_OP='DELETE'` _after_ two `OLD`/`NEW` comparisons. On DELETE, `NEW` is NULL, so those
comparisons evaluate to NULL rather than true and the delete fell through — a trigger whose entire
purpose was "financial records are never deleted" silently permitted deletion. The test failed with
"expected delete to reject"; the fix moves the DELETE branch first. The same latent hazard was checked
in the inbound trigger, which already had it first.

This is the second time in this mission that the ordering of a guard, rather than its presence,
was the bug. Both were caught by asserting the _effect_ rather than the existence of the control.

## 7.1 Group 3 — the three defects the service tests caught

The governance schema passed its structural assertions on the first run, which was misleading: the
schema was correct but **unusable**, and only driving it from a service exposed that.

1. **The migration granted the protected role nothing to write to.** `monienaija_authority_core` owned
   the decision table but had no privilege on the four `public` tables the decision procedure must
   touch, so every approval failed with `permission denied for table
banking_provider_configuration_proposals`. The institutional KYC migration already granted these
   (`1785753600504`, §"privileges"); the banking migration simply omitted them. It now mirrors that
   model exactly — authority writes, runtime reads, `PUBLIC` revoked.
2. **The decision guard compared a payload digest that could never match.** The trigger required
   `p.fingerprint = NEW.payload_digest`, where `fingerprint` is a sha256 of the _command_ computed in
   TypeScript and `payload_digest` is the database recomputing the _stored row_. Those are different
   values by construction, so no legitimate approval could ever be recorded — the control was
   unsatisfiable, not strict. It now compares `NEW.payload_digest` against
   `protected_authority.banking_provider_payload_digest(NEW.proposal_id)`, exactly as the KYC guard
   does, and additionally pins `assurance_level`, `expires_at` and expiry-to-clock.
3. **Idempotent replay ignored the reason.** A request id replayed with identical payload but a
   different justification returned `replay: true` and silently discarded the new reason. Reason is
   part of the decision evidence, so it is now part of the replay comparison.

None of these were caught by the structural suite, which is precisely why it is not sufficient alone:
a schema can refuse every wrong thing and still refuse the right thing too.

## 8. Exact next action

**Group 17 — consolidated acceptance and the final handoff.** Everything before it is landed and
pushed: application wiring, the authenticated API surface, the A6/A7 financial lifecycles, the durable
dispatch worker, webhook ingress, customer virtual accounts, agent funding, fee binding, reconciliation
operations, and all three clients (admin workspace, customer mobile, agent mobile).

## 8. Exact next action

Run the consolidated acceptance matrix (group 17) sequentially against the disposable PostgreSQL
cluster, then write the final handoff.

1. `npx tsc --noEmit` (root), `npm run lint`, `npx prettier --check`
2. unit suite (`npx jest --config jest.config.js --runInBand`)
3. integration suites, sequentially, with
   `PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560`
4. per-app gates: admin-web (`tsc` + jest), customer-mobile (`tsc` + jest), agent-mobile (`tsc` + jest)
5. `git diff --check`
6. Extend `MONIENAIJA-BANKING-PROVIDER-SETTLEMENT-AND-RECONCILIATION-HANDOFF.md` with the full matrix,
   the eight-way capability distinction and the exact blockers.

Do not re-run an individual suite inside the final matrix; the matrix result supersedes it. Do not edit
application source while the matrix executes — a source change invalidates the evidence.

### 8.00 Group 17 acceptance evidence (as executed)

| Gate                          | Command                                               | Result                |
| ----------------------------- | ----------------------------------------------------- | --------------------- |
| Root typecheck                | `npx tsc --noEmit`                                    | see §8.4              |
| Root lint                     | `npm run lint`                                        | see §8.4              |
| Root unit suite               | `npx jest --config jest.config.js --runInBand`        | 3053/3053, 263 suites |
| Agent banking HTTP            | `test/arena3d-agent-banking-http.integration.spec.ts` | 7/7                   |
| Fee binding (group 10)        | `test/banking-fee-binding.integration.spec.ts`        | 9/9                   |
| Dispatch worker               | `test/banking-dispatch-worker.integration.spec.ts`    | 10/10                 |
| Cash-to-cash codes (group 16) | `test/agent-cash-to-cash-precondition-codes.spec.ts`  | 5/5                   |
| Admin web                     | `npx tsc --noEmit` + `npx jest --watchAll=false`      | 879/879, 87 suites    |
| Customer mobile               | `npx tsc --noEmit` + `npx jest --watchAll=false`      | 196/196, 23 suites    |
| Agent mobile                  | `npx tsc --noEmit` + `npx jest --watchAll=false`      | 317/317, 21 suites    |

### 8.0 Where the banking money path now stands

| Stage                                              | Enforced by                                                 | Tested by                       |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| Eligibility, KYC, limits, PIN, destination binding | A6 `FinancialCommitmentService` (unchanged)                 | existing A6 suites              |
| Institutional entitlement + provider approval      | `BankingWithdrawalExecutionAuthority`                       | readiness unit tests            |
| Durable dispatch intent                            | `BankingCommitmentBridgeService`, inside the A6 transaction | dispatch-worker suite (3 cases) |
| Single submission under concurrency                | `banking_dispatch_leases` fence                             | dispatch-worker suite           |
| Provider outcome proven                            | `BankingExternalOperationStatusVerifier`                    | verifier + A6 settlement suites |
| Ledger effect                                      | `ExternalSettlementService` (unchanged)                     | A6 settlement suite (20 cases)  |
| Customer-safe presentation                         | `BankingCustomerController`                                 | banking HTTP suite (13 cases)   |

No controller submits a transfer. No worker dispatches without a persisted commitment row: the
worker's query only selects existing `banking_outbound_operations`, and that table can only gain a
banking-provider row from the bridge, which runs inside A6's transaction.

### 8.1 What is landed and safe

| Commit     | Content                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6dd25a1d` | Banking continuation record, migration allocation `1785753600600-0699` verified free, provider contracts recorded, 256/2981 documentation figure corrected |
| `afa50a11` | Provider capability contracts + registry (6 tests)                                                                                                         |
| `0f418084` | Normalized Monnify errors + coordinate token refresh (14 tests)                                                                                            |
| `d5869436` | Hardened transport + exact-segment path allowlist (9 tests)                                                                                                |
| `6b01141b` | Continuation record checkpoint                                                                                                                             |
| `ff663319` | Webhook signature verification, HMAC-SHA512 (12 tests)                                                                                                     |
| `26c7feba` | Banking governance migration `1785753600600` + 9 PostgreSQL structural assertions                                                                          |
| `935513f6` | Monnify banking adapter, all capabilities (24 tests)                                                                                                       |
| `b5ad1d32` | Protected banking-provider governance service (15 PostgreSQL tests)                                                                                        |
| `009f6983` | Durable operation records, migration `1785753600601` (16 PostgreSQL tests)                                                                                 |
| `f33c7d8a` | Outbound execution core with durable dispatch (14 PostgreSQL tests)                                                                                        |
| `6213298d` | Inbound deposits with provider-confirmed verification (14 PostgreSQL tests)                                                                                |
| `685ea253` | Virtual account provisioning that refuses to double-provision (8 PostgreSQL tests)                                                                         |
| `5dc54806` | Reconciliation that cannot move money, migration `1785753600602` (15 PostgreSQL tests)                                                                     |
| `d312f304` | Webhook ingestion tied to signature verification (13 PostgreSQL tests)                                                                                     |
| `8be5e699` | Final handoff document                                                                                                                                     |
| `d667995a` | Application wiring: module, DI, controllers, policy registry, verifiers                                                                                    |
| `f3821386` | Authoritative wallet ownership, raw-body ingress, honest webhook status (5 defects fixed)                                                                  |
| `1b26e72a` | A6 dispatch-intent wiring, A7 inbound seams, dispatch worker acceptance (10 tests)                                                                         |

All pushed; local == remote verified after each. Unit suite 3048/3048 across 262 suites; banking HTTP
acceptance 13/13; dispatch worker 10/10; A6 settlement lifecycle 20/20; eslint, prettier and tsc clean.

### 8.2 Two real defects already caught by those tests

Worth carrying forward because they show the test strategy is working:

1. the credential scrubber's `\S+` left `Bearer abc.def` intact after `[REDACTED]`, so a leaked token
   would have looked sanitised;
2. the path allowlist accepted `/validateX` by prefix, and then refused the legitimate reserved-account
   reference path — one bypass and one false negative in the same matcher;
3. **the adapter classified HTTP 5xx as a business rejection** (§8.3). This one matters most.

### 8.3 The 5xx defect, and why it was worth chasing

The adapter originally judged every non-401/403 response by the Monnify envelope alone. That is
correct for the documented `200 + requestSuccessful:false` pattern, but it silently swept server
faults into the same bucket: a `503` carrying `requestSuccessful:false` became
`PROVIDER_REJECTED`, and `PROVIDER_REJECTED` is what `enquireAccountName` and `getTransferStatus`
translate into `NOT_FOUND`.

The consequence would have been ugly and quiet. An account-name check during a provider outage would
have answered "this account does not exist" — a business fact, cached and acted on — when the truth
was "nobody knows right now". For a disbursement the same path would have read as a refused transfer
while the money may in fact have moved.

The fix has three parts, each pinned by its own test:

- `5xx` ⇒ `MONNIFY_TRANSPORT_FAILED` / category `TRANSPORT`, never `PROVIDER_REJECTED`;
- `404` ⇒ a dedicated `MONNIFY_NOT_FOUND` code, so "no such record" is a _distinct_ verdict rather
  than an alias for "was refused";
- an outbound submission that hits a `5xx` resolves to `UNKNOWN`, because a gateway that accepted the
  request and then failed has not told us anything about whether the money moved.

Two smaller defects fell out of the same pass. `login()` returned `String(body.accessToken ?? '')`,
so a malformed login yielded an empty bearer that the token manager would happily cache, turning one
bad response into a run of confusing 401s; it now throws `MONNIFY_MALFORMED_RESPONSE`. And the
`monnify-signature` absence rule from group 6 is unchanged: absent is only tolerated for a trusted
fixture transport, never in production.

## 9. Genuine external blockers

| Blocker                              | Consequence                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs.monnify.com` returned HTTP 522 | Contracts recorded from official Confluence pages, the Monnify OpenAPI description and Monnify's own SDK constants (§3). No endpoint invented; unconfirmed items are marked unconfirmed. |
| No provider credentials              | No sandbox or live call is made. Every provider interaction in acceptance uses controlled fixtures.                                                                                      |
| No commercial entitlement            | Production activation blocked; see §3.2.                                                                                                                                                 |
