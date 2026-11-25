# Unified Transaction History — current release status

PR #23 remains **draft; not release-ready**. Base: `41edf587c262edafbd3eb2cc1b3042c614a9730e`. No mobile, credential or grant changes.

## Implemented scope

One unified page with nine stable TYPE values:

- `WALLET_TRANSFER`: transfer UUID; historical journal institution only.
- `CASH_IN`: Cash to Wallet, original canonical journal UUID.
- `CASH_OUT`: Wallet to Cash, original canonical journal UUID.
- `CASH_TO_CASH`: parent transfer UUID throughout claim/expiry.
- `WALLET_TO_BANK`: customer or agent commitment UUID.
- `BANK_TO_WALLET`: immutable bank intake UUID; proven float receipts bind durably and preserve their old detail aliases. Legacy wallet receipts keep their own UUID until complete matching evidence exists.
- `CUSTOMER_FUNDING`: staff request UUID; pending/rejected visible when governed custody was captured at creation, posted legacy records use their journal.
- `AGENT_FUNDING`: governed request UUID (native platform requests require platform visibility), or standalone institutional float receipt UUID.
- `AGENT_DEFUNDING`: native governed platform request UUID throughout its lifecycle.

No generic Deposit/Withdrawal types or separate product pages. Existing four-product keys are unchanged. See [current coverage](FOLLOWUP-COVERAGE.md) for execution sources and historical-scope restrictions. Unposted Customer Funding with trustworthy captured custody is now scoped before posting; unproven/platform funding stays withheld from institution readers. There is no historical backfill. See [request-time funding scope](UNPOSTED-FUNDING-SCOPE.md).

## API and access

`GET /api/v1/internal/admin/transaction-history` and `/:type/:id` require real workforce sessions and `transaction.view`. List/detail/reference reads enforce ACTIVE institution assignments, except existing platform attribution authority. Journal IDs additionally require `ledger.view`. No grants were expanded; `transaction.search` remains reserved/nonassignable.

Filters (`type`, `status`, exact `reference`, Lagos `from`/`to`) are ANDed before pagination. `limit` is 1–100; opaque keyset cursors retain microsecond time, TYPE and UUID. Hash contract and Finance limitations: [Finance contract](FINANCE-DETAIL-LINK-CONTRACT.md).

## Latest local validation

The follow-up volume test runs the full migration chain and real AppModule against an independently created disposable PostgreSQL cluster. All six local-role integration tests pass, including authentication of all 11 existing fixture accounts, unchanged hashes, institution isolation, direct/reference denial and immediate revocation. The local-role suite is HTTP-only. New Bank to Wallet identity browser evidence is recorded separately below. Prior Bank to Wallet browser evidence remains in `evidence/real-workforce-results.json`; the latest HTTP run is recorded separately in `evidence/real-workforce-http-results.json`.

`evidence/migrated-query-plan.json` now contains ANALYZE/BUFFERS plans for the full combined UNION and type, exact-reference, type/status/Lagos-date and keyset predicates. Fixture: **20,002 inbound rows**, evenly split across two institutions; other source tables are empty. Latest timings are in the regenerated plan artifact; this turn did not add a mixed-product workload or tune those queries. These are diagnostic single runs, not production SLOs or representative mixed-product certification. Verified rows are never deleted to clean up; the harness drops its disposable database.

## Unclosed merge gates

1. Request-time Customer Funding custody capture is implemented in migration 0807 and tested with real workforce sessions. Legacy/unproven requests stay withheld; native agent funding remains platform-only. Institutional customer/agent funding execution and historical backfill need the explicit authority/evidence decisions in UNPOSTED-FUNDING-SCOPE.md.
2. Bank intake → verification → proven institutional float identity is implemented and verified in a real workforce browser; see [durable inbound identity](INBOUND-IDENTITY.md). Legacy wallet receipts lack environment context and suspense has no resolution execution/binding contract; these unsupported records stay unlinked. Historical/concurrent link reconciliation needs a reviewed workflow.
3. Real workforce browser matrix for Wallet to Bank, Customer Funding, Agent Funding and Agent Defunding: outstanding. Prior real browser proof covers Bank to Wallet only.
4. Combined real-session Finance #25 bidirectional links: outstanding. Inspected Finance head `891a1c1777855b9e921cfc50c962f2626d7eecf8`; its existing combined DOM harness mocks API responses and its adapter supports only the original four types. It was not merged into this branch.
5. Representative mixed-product volume plans and tuning: outstanding; inbound-only volume plans are a useful but bounded improvement.
6. Exact new-head CI must be explicitly checked. New saved-URL identity browser proof is in `evidence/inbound-identity-results.json` and before/after PNGs; the remaining browser matrix is not claimed.

The [initial packet](INITIAL-REVIEW-PACKET.md) is historical provenance only, not current coverage or authorization policy. No governance approval is implied by implementation choices.

## Inbound identity verification in this turn

Fully migrated disposable PostgreSQL: **9 suites / 104 tests passed**, including actual OPERATIONS browser login and saved Bank to Wallet URL reopening after `UNVERIFIED → VERIFIED → CREDITED`. Another institution cannot read the detail or receipt alias; all-type reference search returns one canonical row; bank/float replay does not double-credit. A further **4 suites / 68 tests passed** for migrated compatibility. Controlled sandbox verification/policy boundaries are declared in [INBOUND-IDENTITY.md](INBOUND-IDENTITY.md); no production funding approval is implied. All 11 local-role passwords authenticated and hashes remained unchanged.

## Unposted funding scope follow-up

Migration 0807 captures existing governed customer-wallet custody at request INSERT, independent of later enrolment. Real-session PostgreSQL evidence proves pending/rejected isolation, immutable request identity, no retrospective scope, and one request row after supported platform posting. Institutional customer posting remains safely refused by the existing platform settlement rail; no new funding authority was invented. Agent FUND/DEFUND platform lifecycles stay hidden from institution staff even after affiliation changes. See UNPOSTED-FUNDING-SCOPE.md and the two funding-scope JSON artifacts. No additional browser matrix is claimed.
