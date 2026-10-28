# 07 — Phases and Dependencies

## Phase 0 — Establish boundaries

1. Confirm exact current SHA and clean source baseline.
2. Product/security owners decide the P0-01 to P0-03 authorization model.
3. Add route-specific negative tests before expanding UI access or presenting any access boundary as secure.

**Exit:** approved scopes and reproducible unauthorized/authorized tests for compliance, notification delivery and limit diagnostics.

## Phase 1 — Security and data isolation

1. Close compliance case API scope/resource enforcement (P0-01).
2. Close notification delivery diagnostics function scope and safe DTO (P0-02).
3. Close limit diagnostics scope alignment (P0-03).
4. Implement server-side category query/isolation (P1-01), dependent on compliance policy.

**Exit:** route-level tests, cross-resource tests, redaction assertions and audit verification.

## Phase 2 — Workflow scope and Admin coverage

1. Decide support, workforce enable, dashboard settings and general approval queue scope (D-06 to D-09).
2. Build compliance actions only after Phase 1 and case-transition policy.
3. Design governed commercial Admin forms against existing backend contracts; add typed UI, maker/checker, audit, reload and consuming effect tests.
4. Decide whether reward behavior is runtime-in-scope.

**Exit:** for each workflow, either an explicit scope deferral or browser + real DB acceptance with authorization and read-after-write evidence.

## Phase 3 — Operational and financial evidence

1. Configure expiry worker only through release control, validate bounded/idempotent processing and alerting; do not alter expired balance liability.
2. Test agent onboarding and funding with independent workforce identities, real test DB and ledger/history reload.
3. Validate database migration chain only in disposable/test environments; release pipeline separately records deployed migration state.
4. Preserve notification dark launch; validate status and controlled test-send only in the approved non-production environment.

**Exit:** operations runbooks, test artifacts, rollback/alert criteria, no production activation without owner sign-off.

## Phase 4 — Browser UAT and evidence closure

Run the approved Admin workflows against a stable test API and database, capture traces/screenshots and include errors, loading, permission-denied, concurrency and recovery behavior. Mark observability pages read-only; no assumption of reversal/settlement operations. Record all evidence against `73eb1ca` or a later explicit SHA. Browser UAT is distinct from staging deployment and production.

## Ownership and dependency order

`P0 auth → P1 category/case UI → governed Admin forms → real DB/effect tests → browser UAT → release decisions`. ARENA 3 owns backend auth; ARENA 2 owns Admin workflows; ARENA 1 owns ledger/reward/expiry runtime; ARENA 4 owns integrated evidence. Product, Finance, Security and Operations own the explicit decisions in `06-PRODUCT-DECISION-REGISTER.md`.
