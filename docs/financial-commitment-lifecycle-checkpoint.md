# Financial commitment lifecycle: intermediate checkpoint

This checkpoint preserves work in progress; it is **not an acceptance or release**.
It requires migration of A6/A7 execution paths and their regression fixtures without
fabricating commitments or weakening authorization. It does not establish a trusted
destination, institutional integration, or governed recovery of settled commitments.
Production external submission and the generic withdrawal endpoint remain disabled.

At checkpoint: financial commitment PostgreSQL acceptance and schema suites passed
20 tests; TypeScript and full lint passed. Full backend regression had 237 passing
suites, one failing suite and **15 failing tests**. Targeted PostgreSQL A6/A7 plus
commitment/schema regression had two failing and two passing suites, **24 failing
and 24 passing tests** (a later commitment/schema run passed 20/20).
Most legacy failures arise because those fixtures construct operations without genuine
commitments; other expectations concern suspense, rollback, or compensation and must
be reviewed individually, not dismissed or weakened.

## Backend failures (15)

- ExternalSettlementService › treats a verifier exception as a retryable dependency outage
- ExternalSettlementService › posts a single balanced Ledger journal for a verified external outcome
- ExternalSettlementService › replays an identical settlement deterministically and does not post a second journal
- ExternalSettlementService › rejects duplicate settlement with a different evidence hash
- ExternalSettlementService › routes unmatched evidence to a suspense entry with named exception ownership
- ExternalSettlementService › propagates retryable evidence unavailability without completing a failed idempotency record
- ExternalSettlementService › rolls back the failed settlement and preserves no journal on Ledger post failure
- ExternalSettlementService › refuses unverified provider outcomes and mismatched verification references
- ExternalSettlementService › posts a compensating entry against an open suspense entry and clears the suspense
- ExternalSettlementService › rejects a compensating entry against a settlement that has no journal
- ExternalSettlementService › rejects a second compensating entry for an already reversed settlement
- ExternalSettlementService › records audit evidence for settlement, suspense, and compensating actions
- ExternalSettlementService › records outbox events for settled, suspense, and compensating actions
- ExternalSettlementService › correlates the settlement record to the Ledger journal via a single journalId
- ExternalSettlementService › keeps external operation, settlement, and journal identities distinct

## Targeted PostgreSQL failures (24)

- A7 Product Financial Effect (real PostgreSQL) › OUTCOME_VERIFIED / SETTLE › rolls back the A7 reservation when settlement reports a temporary dependency outage
- A7 Product Financial Effect (real PostgreSQL) › OUTCOME_VERIFIED / SETTLE › does not treat an uncommitted operation as an eligibility exception
- A7 Product Financial Effect (real PostgreSQL) › OUTCOME_VERIFIED / SETTLE › concurrent settlement creates exactly one journal and replays it
- A7 Product Financial Effect (real PostgreSQL) › OUTCOME_VERIFIED / SETTLE › rejects unverified or mismatched provider success and allows a verified retry
- A7 Product Financial Effect (real PostgreSQL) › OUTCOME_VERIFIED / SETTLE › uses the persisted operation version for settlement
- A7 Product Financial Effect (real PostgreSQL) › OUTCOME_VERIFIED / SETTLE › successfully posts a verified product financial effect mapping to A5 balanced journal
- A7 Product Financial Effect (real PostgreSQL) › Product financial effect reversal › successfully posts compensating entries reversing original directions
- A7 Product Financial Effect (real PostgreSQL) › Product financial effect reversal › concurrent compensation posts once and replays the committed result
- A7 Product Financial Effect (real PostgreSQL) › Product financial effect reversal › keeps exhausted but uncertain outcomes for review until rejection is confirmed
- A7 Product Financial Effect (real PostgreSQL) › Product financial effect reversal › rejects double reversals of the same settlement
- A7 Product Financial Effect (real PostgreSQL) › Idempotency checks › replays identical financial effects and throws on request hash conflict
- A7 Product Financial Effect (real PostgreSQL) › Atomic Rollback Guarantee › rolls settlement and A7 records back after an injected outbox interruption and retries
- A6T08 settlement lifecycle (real PostgreSQL) › settles a verified outcome and posts a balanced journal
- A6T08 settlement lifecycle (real PostgreSQL) › replays an identical settlement without posting a second journal
- A6T08 settlement lifecycle (real PostgreSQL) › rejects the same settlement key carrying different evidence
- A6T08 settlement lifecycle (real PostgreSQL) › rejects evidence belonging to another operation without creating settlement or poisoning retry
- A6T08 settlement lifecycle (real PostgreSQL) › rejects evidence with a forged source
- A6T08 settlement lifecycle (real PostgreSQL) › posts a compensating entry and marks the settlement REVERSED
- A6T08 settlement lifecycle (real PostgreSQL) › keeps the compensating pair net-zero on the customer account
- A6T08 settlement lifecycle (real PostgreSQL) › rejects compensation when the suspense belongs to another operation
- A6T08 settlement lifecycle (real PostgreSQL) › prevents a duplicate compensation for the same settlement
- A6T08 settlement lifecycle (real PostgreSQL) › chk_external_settlements_posted_journal (the A6T08 correction) › still forbids a reversal reference on a POSTED settlement
- A6T08 settlement lifecycle (real PostgreSQL) › chk_external_settlements_posted_journal (the A6T08 correction) › requires a reversal reference once the settlement is REVERSED
- A6T08 settlement lifecycle (real PostgreSQL) › writes audit evidence for the settlement without contacting any partner

## Operational safety

Historical completed operations retain their records; pending and uncertain historical
operations cannot be treated as authorized merely because they have an operation or
provider reference. They require evidence review and controlled reconciliation. The
checkpoint does not retrofit or automatically debit historical obligations. The current
commitment initiation service is internal and takes an untrusted target reference; it is
not a production entry point. A shared authoritative financial-institution model remains
an external dependency. No production submission, deployment, merge, or real financial
transaction is authorized by this checkpoint.
