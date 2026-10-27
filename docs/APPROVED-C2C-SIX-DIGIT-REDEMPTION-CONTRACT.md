# Approved Cash-to-Cash six-digit redemption contract

Status: **implemented backend contract**, approved by the product owner after Sprint 3 investigation. This supersedes the unapproved 128-bit locator proposal in `ARENA1-SPRINT3-C2C-REDEMPTION-CONTRACT-20261026.md`; the findings about ambiguous display references remain valid. That report and commit `da3a3b57ed5994efe9b19cf58bc9334288ce268e` remain in history.

## 1. Identifiers and invariants

Three different values must remain distinct:

- `transferId`: canonical internal UUID. Existing claim/recovery APIs retain it.
- `senderPhone` + `transferNumber`: customer-facing public locator. Number is a **six-character decimal string**, including leading zeros. Neither field is an entitlement credential.
- `transferCode`: existing, separate secret credential. Fresh initiation only; never stored plaintext, replayed, logged or placed in generic notifications.

`reference` remains a nonunique display/posting reference. It is NOT the transfer number or a selector.

The sending customer's phone is collected by Agent A; it is **not inferred from Agent A's contact/login phone**. The product requirement does not establish sender identity verification, so the entered phone is not represented as verified identity evidence. Claim entitlement still binds to the beneficiary's verified primary phone, KYC and Customer OTP.

Phone canonicalization is the existing Nigerian convention: accept local `08031234567`, international `+2348031234567` / `2348031234567`, or canonical `8031234567`; persist the canonical ten digits beginning 7, 8 or 9. Confirm the sender phone before sending: issued pairs cannot be edited.

## 2. ARENA 2 — exact endpoint and DTO handoff

All routes below use the Agent's bearer session. Clients never supply the authenticated Agent ID or session ID in these DTOs.

### A. Initiation — existing endpoint, new required sender field

`POST /api/v1/agents/cash-to-cash` → HTTP **201**.

```json
{
  "senderPhone": "08031234567",
  "beneficiaryPhone": "08035556677",
  "amountMinor": "2000",
  "currency": "NGN",
  "idempotencyKey": "<stable send key>",
  "agentPin": "<Agent A transaction PIN>"
}
```

Existing optional `reference`, `description`, `correlationId`, `metadata` remain supported. **Sender phone is now required by the public HTTP DTO. Coordinate frontend rollout.** Trusted legacy service-level callers without senderPhone remain UUID-only; no other production initiation controller bypasses the HTTP DTO.

Existing initiation response fields remain; added fields:

```json
{
  "status": "COMPLETED",
  "transferId": "<canonical UUID>",
  "senderPhone": "8031234567",
  "transferNumber": "000042",
  "transferCode": "<separate display-once secret>",
  "reference": "<nonunique display reference>",
  "replayed": false
}
```

The example omits unchanged amount/journal/customer-phone/correlation/hash/timestamp fields for brevity. Replays retain the same transferId, senderPhone and transferNumber but never return transferCode. Normalized sender phone is part of the initiation request fingerprint; equivalent formatting replays, changing sender phone under the same key conflicts. Collision retries never change the financial request/key.

Display and hand over the full number **as text**, together with the sender phone. Keep the secret code in its existing separately labelled display-once card and existing secret-handling discipline. Do not convert the number to a JavaScript number, pad an arbitrary user-entered numeric value, or truncate it.

### B. Claim using the approved public locator — NEW

`POST /api/v1/agents/cash-to-cash/claim-by-number` → HTTP **200**.

```json
{
  "senderPhone": "+2348031234567",
  "transferNumber": "000042",
  "beneficiaryPhone": "08035556677",
  "transferCode": "<existing 8–20 digit secret code>",
  "customerId": "<beneficiary Customer UUID>",
  "mfaChallengeId": "<claim-purpose challenge UUID>",
  "otp": "<Customer OTP>",
  "idempotencyKey": "<stable claim key>",
  "redemptionMethod": "CUSTOMER_WALLET"
}
```

For **AGENT_CASH**, set `redemptionMethod: AGENT_CASH` and add `agentPin` belonging to authenticated Agent B. For **CUSTOMER_WALLET**, omit agentPin. Omitted method still defaults to CUSTOMER_WALLET, matching the UUID contract. Existing optional `reference`, `description`, `correlationId`, `metadata` remain; `reference` is claim posting narration, never the sending locator. Supplying transferId on this route is rejected by validation.

Number must match `^[0-9]{6}$` and must be a JSON string. No whitespace, numeric coercion, fuzzy or partial matching. Customer OTP issuance is unchanged: `POST /api/v1/agents/me/mfa-challenges` with `{customerId, purpose: 'CASH_TO_CASH_CLAIM'}`; no OTP is returned by that endpoint.

Success returns the **existing `AgentCashToCashClaimResult`**, unchanged:

```json
{
  "status": "COMPLETED",
  "transferId": "<canonical UUID>",
  "journalId": "<claim journal UUID>",
  "beneficiaryPhone": "8035556677",
  "principalMinor": "2000",
  "currency": "NGN",
  "amountMinor": "2000",
  "claimantCustomerId": "<Customer UUID>",
  "redemptionMethod": "CUSTOMER_WALLET",
  "idempotencyKey": "<same claim key>",
  "requestHash": "<canonical financial hash>",
  "replayed": false,
  "reference": "<claim posting reference>",
  "claimedAt": "<ISO timestamp>"
}
```

`correlationId` is optional. Exact idempotent replay returns `status: REPLAYED`, `replayed: true`, same journal. Locator fields do not create a second financial fingerprint: number-route and UUID-route requests with identical financial parameters/key converge on the same canonical transfer scope and journal. The returned UUID is available only after successful authorized settlement/replay, not through a locator lookup.

### C. Lost-response recovery by number — NEW

`POST /api/v1/agents/cash-to-cash/claims/recover-by-number` → HTTP **200**.

```json
{
  "senderPhone": "08031234567",
  "transferNumber": "000042",
  "idempotencyKey": "<original claim key>"
}
```

Requires a current session of the **same claiming Agent** and the original financial key. Returns the existing claim result with `status: REPLAYED`, `replayed: true`. Does not consume an OTP or require the used secret code/PIN. Another Agent, wrong key, missing record or unknown pair receives the same generic 404. A 404 is not proof that an in-flight request cannot later commit.

### D. Existing UUID compatibility

Unchanged:

- `POST /api/v1/agents/cash-to-cash/claim` with `transferId` and existing fields.
- `GET /api/v1/agents/cash-to-cash/claims/:transferId` for same-Agent committed receipt recovery.

Historical transfers have no guessed/backfilled sender pair. They remain redeemable/recoverable through those UUID contracts. An old display reference or its six-digit suffix is never reinterpreted as a locator. Pre-upgrade pending initiation requests lacking senderPhone must be reconciled through existing response/history evidence; do not create a new send key to work around an uncertain old outcome. Adding a sender phone to an old key is not retroactive alias issuance.

## 3. Error contract for number routes

Read the HTTP status and `code` when present. Nest authentication/validation responses keep their ordinary `{statusCode,message,error}` envelope; custom responses below use `{code,message}` and the HTTP status.

| HTTP | Code / meaning | Client behavior |
|---|---|---|
| 400 | Ordinary DTO validation error; numeric/non-six-digit number, malformed required fields, simultaneous transferId | Correct input. No transfer existence information. |
| 401 / 403 | Existing guard/session/Agent identity errors evaluated before locator lookup | Reauthenticate or resolve access; not evidence about the transfer. |
| 404 | `C2C_CLAIM_NOT_AVAILABLE`, message exactly `Claim not available` | Same response for unknown pair, wrong code/phone/Customer/OTP, KYC/PIN/capability failure, code lockout, expiry, already claimed/conflicting request, foreign recovery or wrong recovery key. Do not display an invented detailed reason or assert nonexistence. |
| 429 | `C2C_LOCATOR_RATE_LIMITED`, message `Too many locator requests; retry later` | Wait for the fixed window to reset; do not change keys/methods or continually resend OTP. |
| 503 | `C2C_RETRY_REQUIRED`, message `Claim outcome unavailable; recover before retrying` | Recover first; do not infer rollback from an unavailable/ambiguous outcome. |

Within the number adapter, transfer-specific 4xx details from the canonical service are intentionally masked; the existing UUID API's errors are unchanged. Session/PIN revocation discovered during posting still denies settlement but is masked as 404 on the public-number flow. Financial/transient infrastructure errors are not falsely reported as a committed success. On definite rollback, obtain a **fresh claim-purpose OTP** and retry unchanged financial parameters/key. On uncertain response, recover before retrying.

Initiation collision exhaustion uses HTTP 409 `C2C_LOCATOR_UNAVAILABLE`: `Unable to allocate transfer number; retry unchanged request`. The whole initiation transaction rolls back.

## 4. Security and rate budgets

There is no lookup endpoint. The resolver validates a current Agent session, consumes database-backed budgets, resolves the immutable pair internally and calls the **existing claim service**. No second settlement implementation, arbitrary wallet selection or code search across candidate transfers.

Existing controls remain authoritative: verified primary beneficiary phone, Customer identity/KYC and explicit expiry, purpose-bound OTP, transfer-code hash + atomic five-attempt lockout, Agent B lifecycle/class/CASH_TO_CASH eligibility and PIN for cash mode, transaction-bound session/credential/PIN locks, SERIALIZABLE transfer locking, canonical idempotency, limit reservations, deadline checks, journal/audit/history and rollback.

Shared claim/recovery budgets, charged for known and unknown locators alike:

- **20 requests / 60 seconds / authenticated Agent**.
- **100 requests / 60 seconds / canonical sender phone**, across Agents.
- **10 requests / 60 seconds / canonical sender-phone/number pair**, across Agents.

Counters use atomic PostgreSQL upserts, persist outside settlement transactions and do not reset on success or rollback. Agent budget is charged before resolving/querying any pair; spelling variants normalize to the same sender/pair budget. Fixed windows start at first charge. Malformed DTOs fail validation without a lookup. Existing outer authentication/security middleware still applies. Keys are SHA-256 pseudonyms, not encrypted phone storage or entropy proofs. Number alone is low entropy; budgets and retained secret code/beneficiary factors are required.

Number-claim commands have a 100ms minimum scheduling floor to reduce cheap unknown-vs-invalid-code timing differences. This is **not a constant-time network guarantee**. Operational monitoring and abuse/load testing remain required; distribution across malicious authenticated Agents must be reviewed at rollout.

## 5. Migration and historical safety

New migration: `1785753600096-CreateCashToCashLocators.ts`.

- `cash_to_cash_locators`: one alias per transfer (`transfer_id` PK + FK to canonical transfer), canonical `sender_phone varchar(10)` and `transfer_number varchar(6)` with strict digit checks, UNIQUE `(sender_phone,transfer_number)`.
- Immutable UPDATE/DELETE trigger. Pairs are **never recycled**, including after claim/expiry. The FK restricts deletion of an aliased transfer. No new financial account or ledger model.
- Existing historical rows are untouched. No unreliable sender inference or rewriting display references.
- `cash_to_cash_locator_attempts`: SHA-256 bucket key PK, database-clock fixed-window start, positive attempt counter. Stale windows reset on next use. Operations should monitor table growth and arrange approved cleanup of expired budget rows; never clean up permanent locator reservations.

Allocation uses `crypto.randomInt(0, 1_000_000).toString().padStart(6,'0')`. Inside the same SERIALIZABLE initiation transaction as the financial posting, `INSERT ... ON CONFLICT(sender_phone,transfer_number) DO NOTHING RETURNING ...` reserves the pair. A collision retries with a new CSPRNG candidate up to **32 times**; serialization/deadlock errors retain existing bounded whole-transaction retries. Exhaustion rolls back the journal, transfer, limits and idempotency reservation. No arbitrary historical reuse on pool pressure; a sender has a finite million-pair lifetime namespace and exhaustion must fail closed.

**Deployment requirement:** apply the migration through the approved deployment process before activating updated backend/frontend flows. It was executed only by the disposable local PostgreSQL test harness, never in production. `down()` refuses if any locator has been issued, because dropping alias history would permit stale receipts to identify new transfers after reinstallation. Use a forward fix or separately approved preservation plan, not destructive downgrade. Application rollback can retain the additive tables.

New public initiations require senderPhone; ARENA 2 must update its send DTO and display flow before enabling this backend change for end users. Legacy direct service callers without senderPhone remain UUID-only for compatibility/testing; all production HTTP initiation uses the validated DTO. Do not advertise a number handoff when those optional legacy result fields are absent.

## 6. Notifications and delivery limits

Initiation result, stored redacted idempotency result and initiation audit evidence include the public pair. `NotificationTemplateService` now renders the full six-digit number and canonical sender phone for `cash_to_cash.created` payloads containing both valid fields, without UUID or secret code, and without truncation. Legacy payloads retain their old template.

This change does **not** invent a new recipient mapping, guarantee an SMS was sent or start a parallel notification delivery pipeline. The repository's initiation service does not currently emit that generic created notification. The approved immediate handoff is the authenticated initiation response/receipt presented by Agent A; ARENA 2 must surface the pair. If automated beneficiary SMS is required as a release gate, notification ownership must approve/wire the recipient/outbox workflow separately, using the public pair and never persisting the secret transfer code in generic notification payloads.

## 7. Actual verification and files

Backend build: PASS. Unit tests: **192 suites / 1,961 tests PASS**.

Targeted PostgreSQL regression: **7 suites / 181 tests PASS** (A15 initiation, A16 claim, A17 expiry/migration chain, Agent history, Agent MFA API, Admin Cash-to-Cash monitoring, Cash-to-Cash commercial snapshots). Final A16 rerun after adding initiation-limit-failure coverage: **87 tests PASS**.

New evidence covers:

- String validation and leading zeros; full public notification rendering without secret or UUID.
- Normalized equivalent phones; CSPRNG number format; immutable unique pairs, including a collision against an expired transfer.
- Concurrent initiation collision handling; bounded retry exhaustion with no partial posting; destructive downgrade rejected once aliases exist.
- HTTP initiation idempotency and stable public number, no secret code on replay, sender mutation rejected.
- Both number redemption methods with exact journal/balance effects, UUID-route replay and number-route recovery; wrong-key OTP replay rejected.
- Same-Agent recovery vs foreign-Agent denial.
- Uniform unknown/wrong-code/expired errors; persisted failure count; five-attempt secret-code lockout through the new adapter.
- Atomic parallel per-Agent rate limiting across unknown numbers.
- Number-vs-UUID claim race and single settlement.
- Session revocation during OTP through the adapter; existing full transaction-bound security tests remain passing.
- Claim limit failure rollback/fresh-OTP same-key retry and initiation limit failure rollback/same-key retry.

One first broad run caught the missing migration `name` property in the new migration; added the standard explicit name (no stale assertion weakened) and reran to the passing results above. No full-platform PostgreSQL regression or deployment/UAT sign-off is claimed.

Implementation files:

- `src/agent/agent-cash-to-cash.controller.ts`
- `src/agent/agent-cash-to-cash.service.ts`
- `src/agent/agent-cash-to-cash.types.ts`
- `src/agent/agent-cash-to-cash-claim.controller.ts`
- `src/agent/agent-cash-to-cash-claim.service.ts`
- `src/agent/dto/cash-to-cash.dto.ts`
- `src/agent/dto/cash-to-cash-claim.dto.ts`
- `src/migrations/1785753600096-CreateCashToCashLocators.ts`
- `src/notification/notification-template.service.ts`
- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`
- `test/v1-agent-mfa-api-01.integration.spec.ts` (senderPhone in three existing initiation fixtures)
- `test/cash-to-cash-locator-contract.spec.ts`

Documentation: this contract plus links in the mobile specification and prior Sprint 3 report. No frontend code changes.

## 8. Delivery and remaining decisions

Implementation milestone: `e81f5f7` on `arena/92fd33dd-monienaija`. Prior Sprint 3 commit is preserved as an ancestor. Follow-up documentation commit is recorded in the final delivery report.

Branch: https://github.com/shyne240/monienaija/tree/arena/92fd33dd-monienaija

Still separate from this locator approval: human physical cash-handover requirements, legacy wallet KYC freshness policy, expired-fund disposition, fees and commissions. No policy was invented or changed for those. Sender-phone entry is not represented as verified identity; SERVICE KYC provenance is not human-supervisor inspection. Operational migration/frontend rollout, retention/monitoring and combined device UAT remain required.
