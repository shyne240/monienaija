# Historical review packet — not current coverage

Retained for provenance only. See [README.md](README.md) for current status.

# Transaction History workspace — implementation and review packet

> **Current follow-up:** [FOLLOWUP-COVERAGE.md](FOLLOWUP-COVERAGE.md) supersedes the initial four-type scope, authorization decision and real-session blockers below. The original packet is retained as historical evidence; do not treat its omissions as current implementation status.

## Base and ownership

- Base: `arena/5-main-web-integration` at **`41edf587c262edafbd3eb2cc1b3042c614a9730e`**. Verified with `git ls-remote origin refs/heads/arena/5-main-web-integration` before editing. No newer base existed at that check.
- Working branch: `arena/19545571-monienaija` (separate branch supplied by Arena; no branch switching).
- Owns global Admin Web history navigation, list/detail UI, and its new read controller. Mobile applications, money-moving commands, workforce grants, local role accounts and passwords are unchanged.
- Shared files: `Layout.tsx`, `navigation-access.ts`, `admin.module.ts`, `route-policy-registry.ts`. Navigation retains existing `transfers` key to avoid breaking Customer 360/dashboard callers. Legacy `cashIn`, `cashOut`, `cashToCashOps`, `transactions` aliases resolve to the same guard. Only **Transaction History** appears in the menu.
- Finance integration contract is published in [FINANCE-DETAIL-LINK-CONTRACT.md](FINANCE-DETAIL-LINK-CONTRACT.md). Finance acknowledgement is still required; no other package owner has been impersonated or treated as having approved it.

## Inspected sources and product/type mapping

This is a **four-type implementation, not yet an exhaustive platform-wide money-movement inventory**. Missing types below are explicit pre-merge work/product gates; they are not silently mapped to Deposit/Withdrawal.

| Proposed history type                                       | Actual product behavior and source                                                                                                     | Lifecycle / counting rule                                                                                                                                                 | Exposure in this patch                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WALLET_TRANSFER`                                           | `transfer.service.ts`, `transfers`; existing customer/agent unified history also uses this vocabulary                                  | One transfer ID regardless of posting lines; `PENDING`, `PROCESSING`, `PENDING_RECOVERY`, `UNKNOWN`, `COMPLETED`, `FAILED`, `CANCELLED` from `transfer.enums.ts`          | Yes. Payment reference preferred over legacy reference. Posted-journal institution is authoritative; unposted rows use source wallet institution.                                                                                                                                                    |
| `CASH_IN`                                                   | Cash→Wallet; `agent-cash-in.service.ts` and `agent-financial-execution.service.ts`; posted journal with canonicalService `CASH_IN`     | One original journal, not a row per debit/credit. Only successful posted operations have these journals; no pending/failed history is fabricated.                         | Yes. Native ledger status `POSTED`; recorded metadata amount, zero applied fee/VAT in this V1 path.                                                                                                                                                                                                  |
| `CASH_OUT`                                                  | Wallet→Cash; `agent-cash-out.service.ts`; canonicalService `CASH_OUT`; intents/OTP attempts are not completed financial transactions   | One original journal, excluding reversal journals; same posted-only limitation as cash-in. Pending/cancelled cash-out intents are not counted as additional transactions. | Yes. `POSTED`, not relabelled as a fabricated completion event.                                                                                                                                                                                                                                      |
| `CASH_TO_CASH`                                              | Agent initiation in `agent-cash-to-cash.service.ts`, claim/cancellation/expiry services, `cash_to_cash_transfers`                      | One transfer ID. `UNCLAIMED` → `CLAIMED`, `EXPIRED` or `CANCELLED`. Initiation and claim journals remain references, never two history items.                             | Yes. Masked beneficiary, agent, claimant, redemption method, claim reference, expiry deadline, claimed/expired/updated timestamps, recorded principal/fee/VAT/total retained in detail. No code/hash/OTP/idempotency secrets.                                                                        |
| `CASH_TO_CASH_CLAIM`                                        | Agent history exposes a claim as an incoming wallet perspective                                                                        | Same business C2C transfer as initiation, not an independent global transaction                                                                                           | Deliberately NOT a selectable global type: avoids double counting. Redemption information belongs in C2C detail.                                                                                                                                                                                     |
| `FUNDING`                                                   | `customer_funding_requests`, `customer-funding.service.ts`; actual customer funding with pending/approved/rejected lifecycle           | One funding request; approved posting must not also appear as a generic deposit                                                                                           | **Not yet integrated.** Product must approve user-facing name/channel taxonomy; pending/rejected requests lack direct durable institution attribution. Need a scoped projection, not customer-current-affiliation inference.                                                                         |
| `EXTERNAL_BANK_TRANSFER`                                    | `financial_commitments` + `financial_authorizations`, `banking_outbound_operations`; actual customer AND agent outbound bank transfers | One commitment, not reservation + resolution journals + provider callbacks. Existing customer history maps RESERVED/SETTLED/RELEASED to PENDING/COMPLETED/REVERSED        | **Known implemented product, missing from this patch.** Must implement/test scoped projection including fee bindings, provider vs platform references and reserved/resolved lifecycle before claiming exhaustive history. This is remaining implementation, not an assertion the product is unclear. |
| `AGENT_FUNDING` / `AGENT_DEFUNDING`                         | `agent_funding_requests`, `agent-funding.service.ts`, agent history funding journal metadata                                           | One governed funding request; PENDING/REJECTED/EXECUTED lifecycle; never both request and journal                                                                         | **Not yet integrated.** Product/Finance decision: include operational float movements in this workspace or keep in Finance/funding investigations? If included, implement request-based scope and retain approval references.                                                                        |
| Generic `DEPOSIT` / `WITHDRAWAL`                            | `deposit` / `withdrawal` modules expose primitive records, distinct from cash-in/out product paths                                     | Cannot safely assume every deposit = agent cash-in or every withdrawal = cash-out                                                                                         | **Not exposed.** Product decision required on any legacy/imported primitives and their channel semantics. Do not rename primitives into product types or union their journals blindly.                                                                                                               |
| Ledger reversal / commission / fee / reward / bank callback | Accounting entries or events, not necessarily independent customer business transactions                                               | Attach to owning business transaction; Finance owns ledger commands                                                                                                       | Not standalone types. Future detail enrichment must preserve this rule.                                                                                                                                                                                                                              |

### API contract

- `GET /api/v1/internal/admin/transaction-history`
- `GET /api/v1/internal/admin/transaction-history/:type/:id`
- Query: `from`, `to` (`YYYY-MM-DD`), `type`, `status`, `reference` (exact, max 255 chars), `limit` (1–100, default 20), `cursor`.
- All supplied filters are ANDed in SQL **before** `LIMIT`. List returns `{items,nextCursor}`; no misleading aggregate count from journal lines.
- Dates: inclusive Lagos midnight start; exclusive midnight after `to`. Example 24 Nov 2026 is `[2026-11-23T23:00:00Z, 2026-11-24T23:00:00Z)`. Explicit UTC+01 is valid for contemporary Africa/Lagos dates; server/browser timezone never defines filtering.
- Keyset order: `(created_at DESC, type DESC, id DESC)`. Cursor preserves PostgreSQL microseconds as a string (not JS Date milliseconds). Browser keeps a cursor stack for Previous/Next. Cursor is not an authorization token; replay/tampering cannot expand institution access. Filtering changes restart paging.
- Pagination is an ordered live read, **not a repeatable database snapshot**. Existing immutable creation keys are traversed once; status changes, deletions or backdated inserts between requests can change membership. Snapshot export semantics and large-volume performance are not certified.
- Detail never returns raw entities. Parties/receipt fields are allowlisted; only masked beneficiary phone. Missing timestamps/parties are shown as not recorded. Ledger IDs require additional `ledger.view`; raw journal lines are not fetched by the new workspace.

## Authorization coordination

New routes use `WORKFORCE_SESSION` at the shared route registry and `AuthorizationService.requireFunction(transaction.view)` in the controller. Allowed principal types match existing C2C operations: OPERATOR / SERVICE / PRIVILEGED. Customer/agent tokens cannot become workforce tokens just by knowing a reference.

Both new endpoints apply the **same SQL scope** before returning rows: explicit `institution.attribution.view` grants platform visibility, otherwise a current ACTIVE `workforce_institution_assignments` row must match the recorded institution. No role-name platform bypass, no default institution, no cached assignment IDs. Unknown and forbidden detail IDs both return 404. Unattributed history is visible only with explicit platform authority.

Also hardened the old `/internal/admin/cash-to-cash/transfers` read path with the same ACTIVE assignment predicate, so older clients do not retain an unscoped C2C listing after the menu is removed.

**Governance decision needed before merge:** `transaction.search` exists in the catalogue but is FUTURE / non-assignable. This draft reuses `transaction.view`, consistent with the existing C2C listing, without changing any grants or local accounts. Authorization owner must approve that boundary or activate the dedicated search function with an explicit entitlement/migration plan. Do not silently broaden Finance roles; e.g. FINANCE_PREPARER/CONTROLLER currently do not gain transaction.view in this patch.

## Verification and evidence

- [Automated acceptance report](evidence/acceptance.json): 9 PostgreSQL acceptance scenarios + Chromium workflow.
- [Mixed history](evidence/mixed-history.png): C2C, wallet transfers, cash-in and cash-out; single menu entry.
- [Page 2](evidence/page-2.png).
- [Combined date/type/status/reference filters](evidence/combined-filters.png).
- [Claimed cash-to-cash detail](evidence/cash-to-cash-detail.png).
- [Test command/results summary](evidence/test-results.md).

Tests use a disposable embedded PostgreSQL database with a minimal schema shaped from the source entities and synthetic rows only. The real controller SQL and AuthorizationService run; audit sink is stubbed. Browser drives the full Vite SPA with requests to that controller over HTTP, using a test-only bearer adapter. **This is NOT production workforce-session guard, login, full migration or live local-account evidence.** No existing local database was available/configured in this checkout; no password/account seed was altered to compensate.

### Completed workflow checklist

- [x] One global Transaction History navigation destination, legacy in-app aliases retained.
- [x] Supported four-type mixed history includes cash-to-cash exactly once.
- [x] Combine date + type + status + exact reference on backend.
- [x] Verify Lagos start/end boundaries, including just-before start and next-midnight exclusions.
- [x] Page tied/microsecond timestamp records without duplicates or omissions (46 scoped transactions, page size 7).
- [x] Open detail; retain masked C2C receipt/investigation fields and permission-gated journal IDs.
- [x] Restricted role cannot list/search foreign reference or fetch its direct detail key; assignment revocation takes effect immediately.
- [x] Loading, empty, error, no-permission states and late-response isolation implemented; browser workflow screenshots captured.
- [x] Frontend complete suite: 99 suites / 996 tests pass; focused backend: 2 suites / 6 tests pass; backend and Admin Web builds and typecheck pass.
- [x] Preserve local role accounts/passwords and leave mobile apps untouched.
- [ ] Full real workforce-session/login test on a fully migrated isolated application database, with seeded role accounts.
- [ ] External bank transfers and scoped customer funding projection integrated/tested (known omissions above).
- [ ] Product decisions for float funding/defunding and generic primitive taxonomy.
- [ ] Authorization owner approval for search capability boundary; Finance acknowledgement of link contract.
- [ ] Large-data EXPLAIN/index validation and any required read-index migration.
- [ ] Full backend regression suite (only focused backend suites run here).

## Reproduce the bounded acceptance

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix apps/admin-web
(cd node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js)
# start Vite separately (binds 0.0.0.0, same-origin /api/v1 proxy):
ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:3099 npm run dev --prefix apps/admin-web
# In another terminal, Linux x64 browser runtime libraries:
node -e "require('@sparticuz/chromium').inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br')"
LD_LIBRARY_PATH="$PWD/node_modules/@embedded-postgres/linux-x64/native/lib:/tmp/al2023/lib" \
  node scripts/transaction-history-acceptance.cjs --browser
```

The harness owns disposable port 55439 and loopback test API port 3099, then closes both. It never reads `.env` or connects to an existing application database. The bearer adapter is test-only code in this script, never mounted by AppModule. Without `--browser`, no HTTP adapter is started.
