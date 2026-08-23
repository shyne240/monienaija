# ADR-0089 — B2 Finance-to-A5 Account Mapping Runtime

- **ADR ID:** ADR-0089
- **Platform:** B2 — Finance Platform
- **Scope:** Bounded B2F03 prerequisite completion
- **Status:** Accepted; durable mapping runtime implemented with no active seed mappings
- **Contract:** [`docs/B2F-CHART-CLASSIFICATION-CONTRACT.md`](../B2F-CHART-CLASSIFICATION-CONTRACT.md)
- **Migration:** `1785753600050-CreateB2FFinanceAccountMappings.ts`

## Context

B2F03 defined Finance classifications and mapping rules but intentionally had no durable runtime. B2F05 therefore validated only mapping-reference shape plus A5 account compatibility. B2F07 cannot safely use an AR control account without an approved, effective mapping resolved to a canonical A5 UUID.

A5 exposes the required read boundary through `LedgerService.getAccount()`. No other Finance-to-A5 mapping authority was found. No canonical A5 receivable account was found in the repository account seeds/contracts.

## Decision

1. Persist only Finance mapping metadata in `b2f_finance_account_mappings`; A5 UUID remains the sole account identity.
2. Verify A5 existence, active state, type, normal balance, NGN currency, `CUSTOMER_FUNDS`, and role-specific negative-balance policy through `LedgerService.getAccount()`.
3. Implement immutable semantic mapping versions and lifecycle `DRAFT`, `PENDING_APPROVAL`, `ACTIVE`, `EXPIRED`, `REVOKED`, and `REJECTED`.
4. Permit many A5 accounts to share a classification but prohibit one A5 account from overlapping active primary classifications in the book. Split/percentage/many-to-many/code-only mapping remains prohibited.
5. Activate/reject/revoke only after A2 privileged approval and B2F06 control decision bound to exact mapping/version/hash/resource.
6. Use `b2.finance.account-mapping.idempotency.v1` for creation and a separate lifecycle scope, shared Operations idempotency, audit, outbox, and metrics.
7. Re-read A5 on activation and every read-only compatibility verification. Snapshot drift fails closed.
8. Expose narrow lookup/verification ports by reference/version, classification, book, and A5 UUID.
9. Require B2F05 to resolve active/effective authoritative mappings before journal-governance creation.
10. Seed or activate no mapping in migration/runtime.

## AR prerequisite result

No existing canonical A5 account was verified for `finance.asset.receivable`. No AR mapping is created or activated. This remains:

> **NOT VERIFIED / REQUIRES REVIEW**

A separately approved A5 account must exist before a mapping proposal can pass. This runtime does not create that account and does not implement B2F07 AR.

## Consequences

- Caller-supplied mapping-reference shape is no longer sufficient for B2F05.
- Historical mappings remain queryable after expiration/revocation.
- A5 metadata drift, inactivity, mismatch, missing mapping, ineffective dates, or overlap blocks Finance use.
- Legacy `PAYMENT-*` candidates remain candidates and require normal lifecycle approval.
- B2F07/B2F08/B2F09 remain separate authoritative tasks.

## Alternatives rejected

- Create/copy Finance accounts: duplicates A5.
- Auto-activate documented legacy candidates: bypasses controls.
- Infer mappings from codes: ambiguous and prohibited.
- Trust caller metadata: bypasses A5.
- Implement AR account creation here: crosses B2F03/A5 boundaries.

## Verification

- [x] ADR-0089 follows ADR-0088 without renumbering.
- [x] Canonical A5 read boundary and absence of another mapping authority verified.
- [x] Durable lifecycle, effective dating, deterministic hashing, idempotency, controls, audit/outbox/metrics, and consumer port implemented.
- [x] B2F05 consumes mapping verification.
- [x] No A5 account, ledger, journal, line, balance, posting, public API, AR/AP, B2F09, or later task implemented.
