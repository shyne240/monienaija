# ARENA 4 — Cash-to-Cash notification and locator contract

## Initiation event and delivery

`AgentCashToCashService.execute()` persists `cash_to_cash.created` with `OutboxService.enqueueOnce()` inside the existing SERIALIZABLE initiation transaction. Its key is `cash_to_cash.created:<transferId>`. The event only becomes visible if the journal, transfer, idempotency record, and outbox row all commit. An idempotency replay returns before enqueueing; notification processing never calls financial services.

Event payload / template-variable contract:

- `beneficiaryPhone`: canonical Nigerian 10-digit destination; used by the event map to create a `PHONE` / SMS intent.
- `amountMinor`, `currency`: principal copied from the committed transfer row values (`NGN`).
- `senderDisplayName`: KYC-approved customer's legal name only when the sender phone matches a verified phone contact; otherwise `A MonieNaija customer`.
- `locatorUrl`: optional `CASH_TO_CASH_LOCATOR_URL`, validated as HTTPS without embedded credentials.
- `transferId` is aggregate/event evidence only. No `transferNumber`, `senderPhone`, `transferCode`, journal ID, reference, or recipient phone is passed as a template variable. The created-event delivery/provider payload is allowlisted to sender display name, amount, currency, and valid locator URL; the recipient phone is stored only in the delivery destination and recipient key.

The message says a sender sent the committed NGN amount and directs the beneficiary to an active outlet. It never renders transfer identifiers, sender phone, or the one-time collection code. The previous pair-disclosing created-event message is retired. Existing provider/outbox worker behavior is unchanged and disabled by default (`NOTIFICATION_WORKER_ENABLED=false`); this change does not configure or enable a production provider/worker.

## Arena 1 / Arena 3 integration notes

- The current source tree does not contain Arena 1's proposed DB-backed shared notification template registry. This change uses the existing `NotificationTemplateService` and its event switch; it does not introduce a second registry. When the shared registry is integrated, move the explicit safe-variable allowlist into that shared contract.
- Arena 3's existing notification delivery schema only accepts CUSTOMER/AGENT UUID recipients. This change extends the existing delivery table additively: `PHONE` recipient type and text `recipient_id` for the canonical phone, preserving the existing `(event_key, recipient_id, channel)` unique key. Verified registered phone contacts still honor their customer SMS opt-out; unregistered numbers need no customer UUID. Before production enablement, Arena 3 should review/accept this recipient representation and provider contract.

## Public outlet locator

`GET /api/v1/public/agents/cash-to-cash-outlets?state=<state>&city=<city>&page=1&limit=50`

Returns a paginated read-only projection of outlets where the outlet and agent are ACTIVE, the associated agent class is active and permits `CASH_TO_CASH`, and the outlet is in NG. State and city filters are case-insensitive exact matches. The response includes only outlet display name (or a generic fallback), outlet address, city, state, and country; it does not expose agent IDs/references, outlet codes, contacts, balances, credentials, or transfer information. Page size is capped at 100. No distance or nearest-agent calculation is claimed because the model has no reliable coordinates/location-search facility.

The locator URL sent in SMS is deployment configuration, not a hard-coded production URL. Leave it blank until a public-facing locator page is hosted and configured.
