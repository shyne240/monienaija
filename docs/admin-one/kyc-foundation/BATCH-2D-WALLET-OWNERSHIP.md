> **Source-branch report:** The migration inventory and test results below describe Arena 4’s original branch, which included migration 0117. The Arena 3 integration deliberately excludes 0117; see the [Arena 3 integration report](../../integration/governed-wallet-ownership-integration.md) for its actual migration chain and independent results.

# Governed wallet ownership resolution (REVIEW → CUSTOMER / AGENT / SYSTEM)

**Status:** implemented, migration `1785753600118`, verified against real PostgreSQL 18.4 with real
HTTP. No deployment, no provider call, no real financial transaction, no merge into `main`.

This closes the gap recorded in [BATCH-2C-PARTIAL](BATCH-2C-PARTIAL.md): *"No authoritative system/
operational wallet relationship or governed legacy resolution exists. Noncanonical references,
system wallets and collisions are restricted as `REVIEW` … needs a safe, audited migration/resolution
process"* and *"the existing case-sensitive database uniqueness constraint does not protect arbitrary
direct SQL inserts of differently cased legacy UUIDs"*.

## What the previous state did

Migration `1785753600116` classified every historical wallet owner from authoritative rows only. A
reference that resolved to exactly one customer or one agent was classified; everything else —
non-UUID references, unknown UUIDs, and UUIDs that exist as **both** a customer and an agent — became
`REVIEW` and was frozen by a trigger that refused every ownership mutation. `WalletFinancialBoundary`
blocks all financial lanes for `REVIEW` wallets (journal posting, external operations, customer
wallet binding). Correct, but permanently unusable for legitimate wallets, with no audited escape.

## Implemented

### 1. Governed revision of the classification (migration `1785753600118`)

- `owner_class` catalogue extends to `SYSTEM`; `REVIEW` remains the fail-closed default and is never
  a resolution target.
- `wallet_system_owners` is the **authoritative system-owner registry** (`PLATFORM_SUSPENSE`,
  `PLATFORM_SETTLEMENT`, `PLATFORM_LEGACY`). A SYSTEM resolution may only target a registered,
  active code — never free text.
- `governed_wallet_ownership_resolutions` is the immutable evidence record. One row per wallet,
  keyed by the consumed approval, preserving the **previous owner reference**, the resolved
  class/reference, the server-verified evidence type/reference, its digest and summary, the reason,
  executor and timestamp. UPDATE/DELETE are refused; an insert is accepted only when the referenced
  `privileged_action_approvals` row is `CONSUMED` for action `WALLET_OWNERSHIP_RESOLUTION`, resource
  `WALLET_ACCOUNT`, this exact wallet, and the wallet is still `REVIEW` with the recorded previous
  reference.
- The ownership guard was **replaced, not weakened**. Every ordinary INSERT/UPDATE still derives and
  freezes ownership exactly as before. The single accepted mutation is one `REVIEW` →
  `CUSTOMER|AGENT|SYSTEM` transition, and only when the matching resolution record already exists,
  the ledger account is unchanged, and the new reference genuinely resolves to exactly one
  authoritative customer/agent (or is the canonical `SYSTEM:<code>` form of an **active** registered
  system owner). `ledger_account_id` is immutable in every path.
- UUID owner references are canonicalised to lower case on insert and on governed resolution, and a
  partial unique index (`lower(customer_id), currency` where the reference is a UUID) makes
  differently-cased duplicates structurally impossible — including for direct SQL inserts. Legacy
  non-UUID references are never conflated. Historical rows are canonicalised once; genuine canonical
  collisions **abort the migration loudly** instead of being merged or deleted.
- `down()` refuses: removing this would re-open unrestricted ownership mutation.

### 2. Maker/checker workflow (`WalletOwnershipResolutionService`)

Reuses the existing governance stack, adding no parallel mechanism:

| Concern | Reused infrastructure |
| --- | --- |
| Action/resource registration | `governed-action.registry`: `WALLET_OWNERSHIP_RESOLUTION` on `WALLET_ACCOUNT` |
| Request / approve / consume / audit trail | `PrivilegedActionApprovalService` |
| Deterministic request binding | `governedChangeFingerprint` (server-computed over the actual payload) |
| Execution denial semantics | `governedChangeConsumptionError` (same reasons/status codes as the reversal flow) |
| Administrative trail | `AuditService` (`WALLET_OWNERSHIP_RESOLVED`, previous + new ownership) |

FINANCE_PREPARER requests; an independent FINANCE_CONTROLLER approves; only the approving
FINANCE_CONTROLLER (or a `privileged:execute` principal) may execute; MFA is mandatory and
self-approval is prohibited on both sides.

`POST /api/v1/wallets/:walletId/ownership-resolution/request` (maker) creates the pending request and
changes nothing. `POST /api/v1/wallets/:walletId/ownership-resolution` (checker) consumes it.

Execution order inside **one transaction**: approval row lock → action/resource/fingerprint
validation → wallet row lock + still-`REVIEW` + unchanged reference → re-verification of evidence and
collision → approval consumption → immutable resolution record → owner update (accepted by the guard
only because that record exists) → audit. Any failure rolls back **everything**, leaving the approval
approved-but-unconsumed and the wallet `REVIEW`.

### 3. Evidence is server-verified, never asserted

| Evidence type | Supported class | Verified against |
| --- | --- | --- |
| `CUSTOMER_RECORD_REFERENCE` | CUSTOMER | `customers` row exists, not synthetic, not deleted, `wallet_owner_class` = CUSTOMER (rejects customer/agent ambiguity), and its own `reference` equals the cited reference |
| `CUSTOMER_FINANCIAL_ACCOUNT_BINDING` | CUSTOMER | an `ACTIVE` `customer_financial_account_bindings` row for this wallet **and** ledger account, owned by the target (id cited as the reference) |
| `AGENT_RECORD_REFERENCE` | AGENT | `agents` row exists, not deleted, unambiguous agent, `reference` equals the cited reference |
| `ZERO_LEDGER_ACTIVITY` | SYSTEM | ledger account has **no** posted lines; the cited reference must be that account's code |
| `ZERO_LEDGER_BALANCE` | SYSTEM | ledger account nets to zero across all lines; same code citation |

Evidence is verified at request time (so a maker cannot file an unsupportable request) **and again**
inside the consuming transaction (because authoritative rows can change between approval and
execution). SYSTEM custody therefore can never be used to move customer/agent value: it requires
proof that there is none.

### 4. Preservation and continued restrictions

- Wallet id, ledger account, status, currency, balances and journal/line history are never touched;
  only `customer_id`/`owner_class` change, and the previous reference is preserved in the resolution
  record and the audit trail.
- Unresolved (`REVIEW`) wallets stay blocked by `WalletFinancialBoundaryService` exactly as before.
- SYSTEM custody is explicitly excluded from customer/agent financial lanes in
  `WalletFinancialBoundaryService.requireAccounts`, and the historical `SYSTEM:<code>` reference keeps
  it permanently unreachable by `wallet_owner_class`-derived customer lanes.

### 5. Safe collision handling

A canonical owner may hold at most one wallet per currency. If the target already owns a wallet in
that currency — at request time or (worse) after approval — the resolution is refused with `409`, the
wallet remains `REVIEW`, no wallet is merged, deleted or re-pointed, and the collision is visible to
reconciliation. The approval is left unconsumed.

### 6. Administrative reconciliation visibility

`GET /api/v1/internal/wallets/ownership-review` (existing `reconciliation.view` catalogue function;
workforce session only) returns the counts by owner class, every unresolved wallet with its preserved
reference, a derived review reason (`NON_CANONICAL_REFERENCE`, `AMBIGUOUS_CUSTOMER_AND_AGENT`,
`NO_AUTHORITATIVE_OWNER`), its ledger account, current balance, any colliding wallet and its
restriction state, plus the applied resolutions with approval id, evidence type and executor. It is
read-only and exposes references, not customer PII.

## Rejection matrix (verified)

Unsupported/unauthorized ownership changes are refused, never silently applied:

- non-UUID wallet id, unknown wallet (`400`/`404`);
- `REVIEW` or unknown resolution class, evidence type not allowed for the class, missing/oversized
  evidence reference or reason, `targetOwnerId` on a SYSTEM resolution or `systemOwnerCode` on a
  CUSTOMER/AGENT resolution (`400`);
- target not found, deleted customer/agent, synthetic customer, ambiguous customer/agent UUID,
  unregistered/inactive system owner, wallet that still holds value for SYSTEM custody (`409`);
- already-resolved wallet, wallet whose reference changed while the request was pending, ownership
  collision (`409`);
- maker without FINANCE_PREPARER, checker without FINANCE_CONTROLLER, self-approval, maker execution,
  read-only or non-MFA principals, cross-audience tokens (`401`/`403`);
- execution payload differing from the approved request → fingerprint mismatch (`403`), approval not
  consumed;
- direct SQL owner/class/ledger mutation and resolution records without a consumed approval are
  refused **by PostgreSQL**.

## Verification

Real PostgreSQL 18.4 (disposable embedded cluster, loopback) with real AppModule/Fastify HTTP:

- migration chain from an empty database: **119/119 migrations**, head `1785753600118`, zero pending;
- `test/wallet-ownership-resolution.integration.spec.ts`: **18/18** tests — CUSTOMER, AGENT and SYSTEM
  resolution, both CUSTOMER evidence types, maker/checker denials, tampered payload, evidence
  validation, SYSTEM value refusal, evidence-drift rollback (approval stays `APPROVED`, wallet stays
  `REVIEW`), single consumption + idempotent replay, competing approvals (one winner), concurrent
  replay, canonical uniqueness at the database level, collision refusal (before and after approval),
  direct-mutation refusal, financial-history preservation, reconciliation visibility and unresolved/
  SYSTEM lane restrictions;
- `test/wallet-ownership-resolution.unit.spec.ts`: **11/11** — normalization rejections, fingerprint
  payload binding, executor entitlement, database-guard mapping.

Regression: full backend lint (**0 problems**), TypeScript (**0 errors**), `test/governed-action.registry.spec.ts`
(10), `test/migration-chain.integration.spec.ts`, `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts`,
`test/v1-ledger-reversal-governance.integration.spec.ts` (28 together), `test/a19-agent-funding.integration.spec.ts` (21),
`test/a20-outlets-terminals.integration.spec.ts` (23), `test/a8-agent-lifecycle.integration.spec.ts` (23),
`test/a5-ledger-reversal.integration.spec.ts` (21) — all passing.

Known pre-existing, unrelated failures: suites that assume customer-wallet financial flows succeed
fail closed with `Customer financial policy is unavailable` because the trusted KYC evidence reader is
deliberately unavailable (documented in [BATCH-2C-PARTIAL](BATCH-2C-PARTIAL.md)). Reproduced
identically on the untouched baseline checkpoint `81793dd` (e.g.
`test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts` 5/5 failing there too).

## Remaining integration dependencies

1. **Catalogue function code.** No approved `authorization_functions` row covers wallet ownership
   resolution (`reconciliation.investigate/resolve` are FUTURE and `assignable: false`). The maker is
   therefore role-gated (`FINANCE_PREPARER`) and the checker side falls back to `privileged:approve`,
   exactly like `LEDGER_JOURNAL_REVERSAL`'s unassignable `ledger.approve_adjustment`. Approving a
   dedicated code is a catalogue-owner decision and should replace the role-only gate.
2. **Migration identifier coordination.** `1785753600118` is this branch's identifier; sibling arenas
   adding migrations must not reuse it. If they do, the collision must be renumbered at integration
   before any release.
3. **Admin Web surface.** The maker/checker and reconciliation endpoints are backend-only here; Admin
   Web screens for the approvals inbox and the ownership-review list are a separate UI task.
4. **Pre-existing KYC evidence unavailability** still restricts resolved CUSTOMER wallets at the
   financial boundary until production trusted evidence and policy are available; ownership resolution
   changes classification, never eligibility.
5. **SUPER_ADMIN execution inheritance.** `privileged:execute` holders (including SUPER_ADMIN when that scope is granted) can execute an
   approved resolution, provided the executor is not the maker, mirroring the established `consume()`
   contract and the ledger-reversal flow. If ownership resolution should be limited to the approving
   controller only, that is a governance decision to record and enforce across both flows.
6. **`wallet_system_owners` is a static registry.** Adding/retiring system owners requires a governed
   migration; there is no runtime CRUD (deliberate: no new maker/checker action without approval).
7. **Data migration on real databases.** The one-time canonicalisation and the duplicate-refusal check
   must be rehearsed against a production copy; genuine canonical collisions abort the migration and
   require operator reconciliation, by design.
