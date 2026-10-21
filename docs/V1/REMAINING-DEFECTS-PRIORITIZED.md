# Remaining Defects — Prioritized (after V1 Full Admin Web fix 2026-10-21)

**Baseline:** `arena/edba26d6-monienaija` with ledger route fix + 7 new Admin Web screens + Layout 8→15  
**Method:** Each defect traced to code (route → controller → service → DB), classification per `V1-SCOPE-CHALLENGE-01` (P0 blocks V1 acceptance, P1 gaps that still allow V1 workflows via other surfaces, P2/Future explicitly out of V1 scope).

## P0 — None (V1 acceptance not blocked)

All V1-required administrative workflows now have a reachable backend route + functional Admin Web screen + authorization gate at least at the route layer, and the two previously **BROKEN** modules (Ledger, Transaction observability) are unblocked. Dashboard fallback defect closed.

## P1 — Fix soon (functional but not least-privilege at controller layer)

### R3. Generic `internal/*` and `workforce-observability` surfaces lack controller-level function checks

- **Seen:** `GET /internal/agents`, `/internal/customers`, `/internal/support/tickets`, `/internal/reconciliation/*`, `/transfers/:id`, `/deposits/:id` etc. return 200 for any `WORKFORCE_SESSION` (SUPPORT/OPERATOR/PRIVILEGED) even without the catalogue function. Example: FINANCE_PREPARER (no `agent.view`) can list agents; OPERATIONS (no `ledger.view`) gets 403 only because LedgerController was hardened — other controllers still return 200.
- **Root cause:** `route-policy-registry` generic `internal-route` branch + new `workforce-observability` branch both allow `allowedPrincipalTypes: [SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` without `requiredScopes`. Controllers `AdminAgentController`, `AdminCustomerController`, `SupportInternalController`, `ReconciliationController` only check `requireWorkforce(req)` (type check), not `requireFunction('agent.view'|'customer.view'|'reconciliation.view'|...)`. LedgerController was hardened in this task as the CRITICAL_FINANCIAL example.
- **Risk:** A compromised FINANCE_PREPARER token can enumerate agents/customers even though catalogue says it should not; an OPERATIONS token can read reconciliation even though decision says only SUPER_ADMIN/FINANCE_AUDITOR/TREASURY should. Not a data leak across customers (no PII beyond safe projections), but violates least-privilege.
- **Fix:** Add `AuthorizationService.requireFunction` calls to each controller, mirroring `AdminAgentLifecycleController` pattern (function + allowedPrincipalTypes AND-combined). Tests: extend `v1-admin-authorization-hardening-01` with `agent.view`, `customer.view`, `reconciliation.view` denial cases for PREPARER/CONTROLLER, and `transaction.view` for non-holders. Effort: ~1 day, no schema change, no migration.

### R4. Transfer/deposit/withdrawal/wallet/fee observability has no function gate

- **Seen:** `GET /transfers/:id` etc. under new `workforce-observability` returns 404 (not 403) for FINANCE_PREPARER who lacks `transaction.view` — should be 403. Current controllers (`TransferController`, `DepositController`, `WithdrawalController`, `WalletController`, `FeeController`) are customer/agent-facing and have no workforce function check at all.
- **Root cause:** Same as R3 — route fix unblocked them from impossible `internal:access`, but did not add `requireFunction('transaction.view')` etc. for workforce principals. Customer/agent access still works via `route-policy-registry` `customer` branch (customerAccess SELF) which bypasses workforce checks.
- **Fix:** In each controller, detect `req.authorizationPrincipal` workforce type and `requireFunction('transaction.view')` (or `fee_rule.view`, `wallet.view`) before returning, else let customer/agent path proceed without workforce check (preserve existing customer flows). Add regression test per role (PREPARER/CONTROLLER denied, AUDITOR/OPERATIONS allowed).

### R7. Agent financial position uses generic internal, not fine-grained

- **Seen:** `GET /internal/agents/:id/financial-position` returns 200 for FINANCE_PREPARER even though `agent.view` VIEW is not held by PREPARER — should be denied or require `agent.view`. Same generic-internal gap.
- **Fix:** Part of R3 hardening (add `agent.view` check to `AdminAgentController`).

## P2 — Nice to have (UI completeness, not functional block)

### R8. Customer Directory PII tabs hidden

- **Seen:** Backend `GET /customers/:id/addresses`, `/contact-methods`, `/identity-documents`, `/kyc` exists (C3 catalogue), but `CustomerDirectoryScreen` shows only wallets/KYC/status, not full PII tabs. Data exists but not surfaced.
- **Fix:** Add tabs to detail drawer calling those endpoints, gated by `customer.view_address / view_contact_methods / view_identity_documents` (OPERATIONS, COMPLIANCE, SUPER_ADMIN). ~half day.

### R9. Compliance/Risk screens require manual UUID entry

- **Seen:** `ComplianceScreen` and `RiskFraudScreen` require pasting customer UUID; they cannot pick from directory list directly.
- **Fix:** Link drawer from `CustomerDirectoryScreen` (add “Open compliance” button that navigates with `customerId` prop). ~2h.

### R10. Commercial Rules is read-only

- **Seen:** Fee/commission/reward/product/limit registries are definition registries with maker/checker (PREPARER INITIATE, CONTROLLER APPROVE). Screen shows definitions via `GET /internal/fee-rules` etc. but has no “Propose / Approve” buttons; those still require direct API or Dashboard governance.
- **Fix:** Add maker/checker proposal flows (POST propose, POST approve) with confirmation/success states, gated by `fee_rule.create` INITIATE vs APPROVE. ~1 day, needs integration test for separation.

## Future / V2 (correctly out of V1, not defects)

- **F1 Aggregator login / scoped financial position** (Decision 8 — no aggregator session in V1)
- **F2 Reconciliation-break resolver workflow** (Decision 3 — reporting exists, resolve pending)
- **F3 Operations reversal workflow** (Decision 4 — primitive exists, full workflow pending)
- **F4 Commission settlement payout rail / external bank/NIBSS** (V2)
- **F5 Per-agent granular permissions, audit export, two-step KYC review**

## Verification of remaining items (not suppressed)

- Reconciliation WARNING for `failed_transfer_attempts` and `customer_financial_account_binding_integrity` is **correct** on DB with synthetic FAILED transfers / inconsistent bindings — not suppressed, surfaced in widget + Breaks desk.
- `PATCH /customers/:id` 403 for SUPPORT is **correct** (UAT-DEFECT-001), alias via `PATCH /customers/me/profile` works.
- `internal:access` no longer blocks ledger/transfers; remaining open-access gaps documented above as R3/R4, not re-suppressed.

