# ARENA 1 — Sprint 3 Cash-to-Cash redemption handoff

## Decision: contract blocked; do not reinterpret an ambiguous reference

**Status: verified investigation, regression evidence and concrete proposal delivered. No new reference-based claim route is implemented or approved.** The handoff remains a UAT blocker until the UUID handoff is surfaced using the existing contract or a new public locator contract is approved.

The task explicitly requires stopping short of inventing a claim contract if the specifications do not authorize it. The committed mobile specification expressly requires `transferId:UUID`; no examined contract authorizes selecting a claim by the existing display `reference`. Worse, that reference is demonstrably ambiguous even for one sender and one beneficiary. Choosing the first matching record, trying codes against all matching records, or silently imposing uniqueness on historical references would be unsafe changes to the financial contract.

## Baseline and preservation

Fetched `arena/8e59e188-monienaija` and verified its exact tip `3428e37e02e7ea55b431f8d2d461fb2356a418de`. The restored workspace again had old HEAD `3d05aae` plus uncommitted restored files, so the first merge refused to overwrite them. Saved a named safety stash, fetched the assigned branch's prior tip `6fdcc0d`, safely fast-forwarded to it, then merged the common baseline using `git merge --no-edit` (also a fast-forward). Verified baseline ancestry before changes. No reset, rebase, force-push, branch switch or other-agent branch modification. The safety stash is retained.

## 1. Verified existing journey and identifier availability

| Surface | Evidence | Conclusion |
|---|---|---|
| Agent A initiation result | `src/agent/agent-cash-to-cash.service.ts`, result construction: `transferId`, `reference`, fresh-only `transferCode` | Full UUID already exists in the authenticated initiation response. The code is omitted from stored idempotency response and is not recoverable on replay. |
| Agent A mobile display | `apps/agent-mobile/src/screens/authenticated/cash-to-cash/CashToCashSuccessScreen.tsx`, `AgentReceipt` | Secret code has a separate display-once card; receipt exposes the display reference. This investigation did not edit the frontend. The handoff screen does not supply the receiver's required UUID as a dedicated handoff locator. |
| Agent B claim assist | `docs/V1/V1-AGENT-MOBILE-APPLICATION-SPEC-01.md` §2 financial commands and §3 screens; `CashToCashClaimRecipientScreen.tsx` | Explicitly asks for transferId plus code, beneficiary phone, customer identity and OTP. It does not define reference resolution. |
| Existing Agent API contract | `docs/V1/A21-AGENT-APP-CONTRACT.md` financial mapping | Reuses the existing claim/OTP/expiry semantics, not a public-reference resolver. Broader human-facing references in UAT documents do not define a unique selector or override the explicit DTO. |
| Notification templates | `src/notification/notification-template.service.ts`, `cash_to_cash.created/claimed/expired` | Renders public reference; long references are shortened to eight characters. Does not render full transfer UUID or code. A short SMS reference must not be treated as a unique claim selector. |
| Notification recipients | `src/notification/notification-event-map.ts` Cash-to-Cash branch | Recognizes claimant/beneficiary customer IDs and agentId, not a raw beneficiary phone or an Agent B routing field. An initiation payload with sender agentId is not a guaranteed delivery to the unregistered beneficiary or receiving agent. A mapping case is not proof that the initiation service emits the event or that SMS was delivered. |
| Initiation event emission | `src/agent/agent-cash-to-cash.service.ts` | Creates financial row, snapshot and audit event; no direct `cash_to_cash.created` notification publication in this service. No evidence of a guaranteed full-UUID SMS handoff. |
| Customer notification inbox | `src/notification/notification-inbox.service.ts` safe projection | Own-customer inbox exposes a reference or shortened fallback, not a full transferId property. |
| Customer unified history | `src/customer-app/customer-transaction-history.service.ts`, `customer-app.controller.ts` | `GET /api/v1/customers/me/transactions?type=CASH_TO_CASH` can expose the transfer UUID as item `id`, scoped to customer/beneficiary-phone matching. It is not an Agent B lookup and not proof of a documented UUID-sharing journey. Do not claim the UUID is absent from *all* customer APIs. |
| Admin monitoring | `src/agent/agent-cash-to-cash-operations.controller.ts` | Supports exact `reference` filtering and returns transfer IDs, but is a workforce `transaction.view`-authorized monitoring list. Not an Agent B redemption lookup; do not grant agents monitoring privileges as a workaround. |
| Same-Agent receipt recovery | `AgentCashToCashClaimController` / `recoverClaimForAgent` | UUID route for a previously committed claim belonging to the claiming Agent; cannot discover an unclaimed transfer by reference. |

**Cross-cutting finding for the history owner:** the current Customer history phone query filters `type='PHONE'` and `deleted_at IS NULL` but does not require `verified_at` or primary-phone status. Do not promote that history read-model into an identity-proof or unrestricted claim-resolution mechanism. This sprint did not alter the history owner's eligibility semantics; claim settlement independently requires the verified primary beneficiary phone.

## 2. Reference uniqueness, immutability and scope

- `CashToCashTransfer.reference` is nullable `varchar(255)`. Migration `1785753600057-CreateCashToCashTransfers.ts` indexes sender/idempotency and journal uniquely, not reference.
- Initiation accepts a caller-provided trimmed reference; default is `CASH_TO_CASH-${idempotencyKey}`. Initiation idempotency is sender-scoped, so even the generated default does not establish global reference uniqueness.
- New PostgreSQL test creates two legitimate transfers with the **same reference, same sender and same beneficiary**, using separate idempotency keys. Both succeed and have different UUIDs. Neither reference alone nor sender+reference nor sender+phone+reference is a safe unique locator.
- Existing production writes do not update the initiation `reference`; claim writes a separate `claim_reference`. This is application-path stability, **not a database immutability guarantee**: no immutable-column constraint/trigger establishes it.
- The optional claim DTO `reference` is the claim journal/reference narration field. It is **not the sending reference or a selector**. Relabelling it on the client would not resolve a transfer.
- No reviewed runtime Agent route securely resolves an initiation reference to an unclaimed UUID. `/recipients/resolve*` resolves participant identity, not Cash-to-Cash transfers.

## 3. Existing security and accounting remain intact

`AgentCashToCashClaimService.execute` remains the single settlement implementation; no runtime source was changed.

- UUID input validation; beneficiary phone canonicalization and transfer phone equality.
- Customer's own verified, primary, nondeleted phone must match beneficiary; a typed phone or public reference is not identity proof.
- Transfer code hash verification; atomic per-transfer failed-code increments and five-attempt lockout.
- Claim-purpose desk OTP issued to the Customer's verified primary phone through `POST /api/v1/agents/me/mfa-challenges` with `purpose: CASH_TO_CASH_CLAIM`. OTP cannot be replaced by the reference. Existing legacy NULL-purpose challenge compatibility is not removed here.
- Agent HTTP session authentication and transaction-bound credential/session SHARE locks; wall-clock validity rechecked after posting work.
- AGENT_CASH requires authenticated claiming Agent, lifecycle/class CASH_TO_CASH eligibility, transaction PIN and locked matching PIN evidence. Wallet mode retains its existing no-Agent-PIN contract.
- KYC gates and explicit assessment expiry, with evidence locked through posting. No submitted-document-as-verification shortcut or SERVICE-as-human-review claim.
- SERIALIZABLE transfer locking, shared financial request fingerprint/idempotency scope, exact-once state transition, limit-usage commit rollback and late-deadline gate.
- CUSTOMER_WALLET debits unclaimed liability and credits verified beneficiary Customer wallet. AGENT_CASH debits the same liability and credits authenticated Agent B NGN float. No alternate ledger logic or accounting policy introduced.

**Existing error caveat:** UUID claim currently has distinguishable unknown, expired, wrong-phone, wrong-code and locked errors. It must not be exposed verbatim behind a new public-reference search adapter. A new contract needs an explicit non-enumerating error boundary. This report does not claim the existing UUID endpoint already satisfies the proposed public-reference error contract.

## 4. Exact current frontend contract (live, verified)

### Claim

`POST /api/v1/agents/cash-to-cash/claim`, bearer Agent session, HTTP 200 on success.

```json
{
  "transferId": "<full transfer UUID from authenticated initiation result>",
  "beneficiaryPhone": "<Nigerian beneficiary phone>",
  "transferCode": "<8–20 decimal digits>",
  "customerId": "<beneficiary Customer UUID>",
  "mfaChallengeId": "<claim-purpose challenge UUID>",
  "otp": "<customer OTP>",
  "idempotencyKey": "<1–255 characters; persist unchanged for this financial request>",
  "redemptionMethod": "CUSTOMER_WALLET"
}
```

For AGENT_CASH set `redemptionMethod: AGENT_CASH` and include `agentPin`. Do not include `agentPin` for CUSTOMER_WALLET. Omitted redemptionMethod defaults to CUSTOMER_WALLET. Other optional existing fields: `reference` (claim posting reference, **not lookup**), `description`, `correlationId`, `metadata`. Never send the session ID in this DTO; server authentication supplies it.

Response (existing type `AgentCashToCashClaimResult`):

```json
{
  "status": "COMPLETED",
  "transferId": "<UUID>",
  "journalId": "<UUID>",
  "beneficiaryPhone": "<canonical ten digits>",
  "principalMinor": "2000",
  "currency": "NGN",
  "amountMinor": "2000",
  "claimantCustomerId": "<UUID>",
  "redemptionMethod": "CUSTOMER_WALLET",
  "idempotencyKey": "<same key>",
  "requestHash": "<server hash>",
  "replayed": false,
  "reference": "<claim posting reference>",
  "claimedAt": "<ISO timestamp>"
}
```

`correlationId` is optional. Idempotent replay returns `status: REPLAYED`, `replayed: true`, same journal identity.

### Recovery

`GET /api/v1/agents/cash-to-cash/claims/:transferId`, bearer session of the **same claiming Agent**. HTTP 200 with existing claim result, REPLAYED semantics. HTTP 404 if not committed/visible to this Agent; 404 is not proof that an in-flight request can never commit. Recover before resubmitting after an uncertain response. After definite rollback obtain a fresh purpose-bound OTP and retain the financial request/key.

### Existing errors

Nest envelope `{statusCode, message, error}`; validation may use a message array. Most errors have **no stable application `code`**. Do not invent codes in ARENA 2.

| HTTP | Existing examples |
|---|---|
| 400 | missing/non-UUID transferId (`transferId must be a UUID`); malformed fields; phone mismatch; OTP invalid/expired/used |
| 401 | no/invalid session, transaction-bound session invalidation, invalid/locked/stale Agent cash PIN, invalid transfer code |
| 403 | Agent/class/capability denied; KYC denied; transfer-code lockout |
| 404 | missing transfer or unverified/nonmatching Customer identity; same-Agent recovery not found |
| 409 | expired/already-claimed transfer; idempotency financial parameters conflict; inactive destination; contention |

Contention has the existing explicit `TRANSACTION_CONTENTION_RETRY_EXHAUSTED` code. Other limit/ledger errors retain their existing domain contracts; this sprint adds no taxonomy.

### Existing-contract handoff option for ARENA 2

The fresh initiation response already contains `result.transferId`. Surfacing that complete value on an authenticated sending-agent handoff card (separate from display `reference`, with secret code separately display-once) fits the documented UUID claim DTO without adding a lookup or settlement implementation. Do not put the secret code in share text, logs, navigation state or durable storage. UI/product should confirm the intended customer handoff; this report does not claim the UI is changed or the customer has already received that UUID.

## 5. Proposed public-reference contract — NOT LIVE, requires decision

### Required product/security decision

Choose either **A: surface the existing UUID handoff** above, or **B: approve a new unique public redemption locator and its issuance/delivery contract**. Existing display `reference` is not suitable. Explicitly decide legacy-transfer treatment, full-locator delivery, identifier normalization, privacy/error semantics and operational rate limiting. No backend implementation should proceed by assuming these decisions.

Recommended B design for approval:

1. Introduce a distinct opaque `redemptionReference`, server-generated using at least 128 bits of randomness, globally UNIQUE, NOT NULL for newly issued aliases, immutable and mapped one-to-one to transfer UUID. Preserve display `reference` unchanged. Use a dedicated alias table or additive column with reviewed constraints; do not silently rewrite or enforce uniqueness on existing display references. Collision handling is generation/retry under a unique constraint.
2. Define a full, exact-match, case-sensitive ASCII locator (proposed `C2C-` plus 32 uppercase hexadecimal characters); no prefixes, fuzzy search, SMS-shortened values or candidate iteration. Final format needs approval before frontend implementation.
3. Add authenticated `POST /api/v1/agents/cash-to-cash/claim-by-reference` with the existing claim fields except replace `transferId` by required `redemptionReference`; reject supplying both selectors. Keep optional `reference` clearly named/documented as claim posting narration, not the locator. No GET lookup yielding UUID before successful authorized settlement.
4. Server privately resolves the unique alias, then invokes the **existing** claim service. Canonical UUID, not the alias or route name, must determine financial scope, fingerprint and journal idempotency. UUID-route and alias-route races must converge on the same transfer lock and settlement. Existing PIN/session/KYC/phone/OTP/code controls must not be bypassed or forked.
5. Return the existing successful `AgentCashToCashClaimResult`, optionally adding the alias if approved. A UUID in a successful, fully authorized settlement response is not an unrestricted lookup. Do not expose candidate identities, code state or balances before entitlement checks.
6. Proposed stable public errors: 400 `C2C_REQUEST_INVALID` for syntactic DTO errors; 401 `C2C_AGENT_AUTHENTICATION_REQUIRED` for session/PIN failures independent of transfer existence; 403 `C2C_AGENT_NOT_PERMITTED` for independently evaluated Agent capability/lifecycle; **404 `C2C_CLAIM_NOT_AVAILABLE` with identical message/body for unknown alias, wrong reference/code/phone/ownership, locked/expired/already-claimed-by-another-Agent cases**. Keep transfer-specific failure details only in redacted authorized audit. Do not let an adapter blindly pass through existing UUID-route exceptions. Financial idempotency conflicts may use 409 `C2C_IDEMPOTENCY_CONFLICT` only after entitlement is established; preserve explicit contention/retry semantics. Review response/timing/rate-limit behavior, not only text equality.
7. Unknown aliases do not mutate a guessed transfer. A bad code for a privately resolved, correctly phone/identity-bound transfer still increments the existing atomic counter exactly once; do not validate the code solely in the resolver and accidentally bypass lockout. Ambiguous legacy references must never select an arbitrary candidate or test a code against a candidate set.
8. Lost-response recovery proposal: authenticated `POST /api/v1/agents/cash-to-cash/claims/recover-by-reference` with `{redemptionReference, idempotencyKey}`. Server filters committed claims by authenticated claiming Agent and canonical key; same public 404 for unknown, uncommitted and foreign-Agent records. Return the existing receipt on success; do not require a consumed OTP or PIN to read a prior receipt. Existing UUID recovery remains supported.
9. Add the full locator to the authenticated initiation result and approved receipt/handoff/SMS contract without truncation. Never persist or redisplay the secret transfer code via generic notifications. Do not infer notification delivery from an outbox mapping.
10. Legacy transfers need an explicit migration/backfill or authorized alias-issuance decision. No production migration was created or executed here. No automatic refund, expired-fund disposition, fee, commission or human-handover policy is implied.

### Required acceptance tests after B approval (not claimed executed)

Both methods successful via alias; unknown alias and wrong alias/code pairs indistinguishable; unrelated phone/Customer and session/Agent denied; same-Agent recovery and foreign-Agent denial; UUID-vs-alias concurrent claims produce one journal; expired and locked aliases indistinguishable from unknown; OTP replay with unchanged key recovers only the original result; changed financial parameters rejected; posting/limit failure rolls back all financial state; fresh OTP retry retains canonical key. Reuse existing service tests for low-level invariants rather than clone settlement logic.

## 6. Actual verification in this sprint

New A16 tests:

- Legitimate duplicate display reference accepted for the same sending Agent and beneficiary under two independent keys, with different transfer UUIDs.
- Authenticated HTTP CUSTOMER_WALLET and AGENT_CASH requests using reference but no transferId are rejected with 400 before OTP consumption, failure counting, claim linkage or financial posting; no UUID is disclosed by the error.

Existing A16 coverage was rerun rather than duplicated: positive UUID redemption for both methods, wrong codes/identity, competing methods, expiry, OTP replay, idempotency, lost-response receipt recovery, cross-Agent denial, session/PIN/KYC races, rollback, exact journal/balance assertions.

Results:

- `npm run build`: PASS.
- `npx jest --runInBand`: **191 suites / 1,959 tests PASS**.
- PostgreSQL sequential run of A15, A16, A17, Agent history and admin Cash-to-Cash monitoring: **5 suites / 144 tests PASS**.
- `git diff --check`: PASS.
- An initial overlapping unit/integration run hit sandbox resource pressure and was stopped; those interrupted logs are not counted as verification. Reran both sequentially to the passing results above. No full PostgreSQL regression or successful reference-based redemption is claimed.

## 7. Changed files and delivery

- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`: optional reference in fixture and three contract-investigation regressions.
- `docs/ARENA1-SPRINT3-C2C-REDEMPTION-CONTRACT-20261026.md`: findings, current ARENA 2 handoff and explicitly unapproved proposal.

No runtime financial code, DTO, route, migration, frontend or other-agent-owned module changed. Common baseline remains an ancestor of HEAD. Verified work is committed/pushed only to `arena/92fd33dd-monienaija`.

Branch: https://github.com/shyne240/monienaija/tree/arena/92fd33dd-monienaija
