# Unified Transaction History — current release status

PR #23 remains **draft; not release-ready**. Base: `41edf587c262edafbd3eb2cc1b3042c614a9730e`. No mobile, credential or grant changes.

## Implemented scope

One unified page with nine stable TYPE values:

- `WALLET_TRANSFER`: transfer UUID; historical journal institution only.
- `CASH_IN`: Cash to Wallet, original canonical journal UUID.
- `CASH_OUT`: Wallet to Cash, original canonical journal UUID.
- `CASH_TO_CASH`: parent transfer UUID throughout claim/expiry.
- `WALLET_TO_BANK`: customer or agent commitment UUID.
- `BANK_TO_WALLET`: banking evidence or credited receipt UUID; **cross-pipeline identity is not yet durable**.
- `CUSTOMER_FUNDING`: posted staff funding request UUID.
- `AGENT_FUNDING`: posted governed request or institutional float receipt UUID.
- `AGENT_DEFUNDING`: posted governed request UUID.

No generic Deposit/Withdrawal types or separate product pages. Existing four-product keys are unchanged. See [current coverage](FOLLOWUP-COVERAGE.md) for execution sources and historical-scope restrictions. Unposted funding remains withheld from institution readers; there is no approved historical backfill.

## API and access

`GET /api/v1/internal/admin/transaction-history` and `/:type/:id` require real workforce sessions and `transaction.view`. List/detail/reference reads enforce ACTIVE institution assignments, except existing platform attribution authority. Journal IDs additionally require `ledger.view`. No grants were expanded; `transaction.search` remains reserved/nonassignable.

Filters (`type`, `status`, exact `reference`, Lagos `from`/`to`) are ANDed before pagination. `limit` is 1–100; opaque keyset cursors retain microsecond time, TYPE and UUID. Hash contract and Finance limitations: [Finance contract](FINANCE-DETAIL-LINK-CONTRACT.md).

## Latest local validation

The follow-up volume test runs the full migration chain and real AppModule against an independently created disposable PostgreSQL cluster. All six local-role integration tests pass, including authentication of all 11 existing fixture accounts, unchanged hashes, institution isolation, direct/reference denial and immediate revocation. Latest run is **HTTP only**, not new browser evidence. Prior Bank to Wallet browser evidence remains in `evidence/real-workforce-results.json`; the latest HTTP run is recorded separately in `evidence/real-workforce-http-results.json`.

`evidence/migrated-query-plan.json` now contains ANALYZE/BUFFERS plans for the full combined UNION and type, exact-reference, type/status/Lagos-date and keyset predicates. Fixture: **20,002 inbound rows**, evenly split across two institutions; other source tables are empty. Latest measured execution times on this disposable instance: combined 107.405 ms, type 106.61 ms, reference 0.363 ms, type/status/date 6.976 ms, keyset 89.268 ms. These are diagnostic single runs, not production SLOs or representative mixed-product certification. Verified rows are never deleted to clean up; the harness drops its disposable database.

## Unclosed merge gates

1. Durable request-time attribution, approval binding and evidence-backed historical backfill: proposal only, no owner approval supplied.
2. Durable inbound identity/aliases across banking, receipt, suspense resolution and float: not implemented or demonstrated. Current hash matching lacks environment proof and can select an ID that changes later. Do not promise saved-link stability.
3. Real workforce browser matrix for Wallet to Bank, Customer Funding, Agent Funding and Agent Defunding: outstanding. Prior real browser proof covers Bank to Wallet only.
4. Combined real-session Finance #25 bidirectional links: outstanding. Inspected Finance head `891a1c1777855b9e921cfc50c962f2626d7eecf8`; its existing combined DOM harness mocks API responses and its adapter supports only the original four types. It was not merged into this branch.
5. Representative mixed-product volume plans and tuning: outstanding; inbound-only volume plans are a useful but bounded improvement.
6. Exact new-head CI and browser evidence: must be explicitly checked; prior-head CI/browser results are not new-head proof.

The [initial packet](INITIAL-REVIEW-PACKET.md) is historical provenance only, not current coverage or authorization policy. No governance approval is implied by implementation choices.
