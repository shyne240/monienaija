# 03 — Negative-Test Requirements

These are acceptance scenarios for the Arena implementation branches. Prefer real HTTP through `RuntimeAccessGuard` and a disposable PostgreSQL database. Unit tests may supplement but cannot prove route gates, principal resolution, subject scope or DB side effects.

## Compliance case boundary (P0-01)

### Principal/function matrix

For every case route and action, test no token; CUSTOMER; AGENT; AGGREGATOR; SUPPORT; OPERATOR; SERVICE; PRIVILEGED; FINANCE_PREPARER; FINANCE_CONTROLLER; FINANCE_AUDITOR; COMPLIANCE; RISK_FRAUD; SUPER_ADMIN. Use real seeded roles/functions or a harness that accurately binds roles/scopes. Do not fabricate a principal with `type='OPERATOR'` and implicit privileges.

Expected denies, subject to policy ratification:

- Any workforce principal without the function for its requested category/action.
- RISK_FRAUD with `risk_fraud.manage_fraud_case` requesting AML/KYC/SANCTIONS rows or mutations.
- COMPLIANCE with `compliance.manage_case` requesting FRAUD rows or mutations.
- SUPER_ADMIN using only `compliance.manage_case` on FRAUD rows; do not assume role elevation bypasses category grant.
- Customer self-service if the route is workforce-only; if customer-owned reads are approved, wrong customer IDs are denied and mutations remain denied.
- Cross-customer path: authorized case UUID under a different `:id`; case/list child routes must not disclose existence or write records.

### Spoofing and no-side-effect checks

- Call create/update/comment/assignment/evidence with `actor` or `uploadedBy` set to another valid analyst ID, a SUPER_ADMIN, arbitrary email/name, whitespace, or omitted. Actor in `audit_events`, `compliance_case_history`, `assigned_by` and `uploaded_by` must be authenticated principal ID (or request rejected). Client values must never override it.
- Attempt FRAUD category create and non-FRAUD create with principals holding only the opposite category function.
- Attempt list endpoints with mixed-category rows and assert unauthorized category rows are absent at SQL/service response, not merely hidden by React.
- On each denied write, compare case, comments, evidence, assignments, history and audit row counts before/after; no mutation is permitted.
- Verify successful actions remain atomic: a failure creating audit/history must roll back the business change.
- DTO mass-assignment: unknown fields such as `customerId`, `openedBy`, `assignedBy`, `actor`, `deletedAt`, `caseId`, or privileged category overrides are rejected/ignored according to global validation contract.

## Notification deliveries (P0-02)

- Missing bearer: 401.
- CUSTOMER, AGENT, AGGREGATOR principal types: deny (add explicit AGGREGATOR case; baseline integration test covers only CUSTOMER/AGENT/no token).
- Workforce types SUPPORT, OPERATOR, SERVICE, PRIVILEGED, FINANCE_PREPARER and FINANCE_CONTROLLER with **no** approved delivery function/role: deny if the selected policy is function-gated. Test both `type` and roles/scopes separately.
- Allowed catalogue role with and without exact scope: only approved mapping succeeds. A broad `notification.*` UI permission, `privileged:approve`, `outbox.view`, metrics or diagnostics must not accidentally imply delivery permission unless owner approved that relationship.
- Enumerate query variants: recipientId of a different customer/agent; omit filters and page through results; ensure authorization is unchanged and no unauthorized count/metadata returned.
- Data projection tests include sent message text, recipient UUID, event/aggregate IDs, `lastError`, providerRef; secrets, destination, payload, credentials and bearer tokens must not appear. Assess whether message text/recipient UUID are permitted to each role.
- GET is read-only: assert delivery/outbox rows, attempts, status, retry timestamps and provider state unchanged.
- Adjacent path checks: `/internal/outbox` without `outbox.view` denied and with it returns only contractually safe/redacted content; provider status/test-send remain separately gated; no retry route is exposed or silently added.

## Limit diagnostics (P0-03)

- Existing principal-type cases must be repeated against actual role/scope setup. If `limit.view` is selected: OPERATOR/SERVICE/PRIVILEGED without scope denied; a principal with `limit.view` but disallowed type denied; SUPPORT and all non-workforce types denied. If type-based is selected: every allowed type/role is enumerated and mapped to approved jobs; types not named are denied.
- Add explicit AGGREGATOR and wrong audience/session cases; current test names mention only SUPPORT/CUSTOMER/AGENT/no auth.
- Subject tests: a limit viewer cannot query another customer/agent principalId outside its approved scope; test no principalId (global listing) as well as guessed ID and pagination enumeration.
- Safeguard projection: `request_hash` and secrets never returned; idempotency/correlation identifiers and amount/count details are tested against data classification policy.
- Denied/read tests must not write to `limit_usages`, `limit_reservations`, ledger, balances or audit unless the product contract explicitly audits denied reads.
- Verify `/internal/limit-reservation-recovery/release` remains a separate privileged action; wrong type, missing reason, non-existent/released reservation and replay behavior are tested without broadening it via the read permission.
- Verify `/internal/limit-assignments`, profile/rule reads and agent self-service routes keep their existing independent scopes.

## Minimum combined test command/evidence

- Run focused controller/guard integration specs for all modified endpoints against PostgreSQL.
- Run the complete sequential PG integration suite, backend unit suite and Admin typecheck/tests/build on the **same merge-candidate SHA**.
- Ensure tests are not using only mocked ApiClient, manually injected fake scopes, or service-only invocations to prove route authorization.
- Store test run identifier, exact SHA, result and DB environment in the acceptance record. The last baseline audit's PG harness was unavailable (`ECONNREFUSED`), so new actual DB execution must be arranged; do not mark pending tests PASS from source presence.
