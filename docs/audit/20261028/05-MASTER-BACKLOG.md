# 05 — Master Backlog

The machine-readable source of truth for work IDs, priorities, exact references, owners, acceptance criteria, dependencies, and decision requirements is `master-backlog.csv` (23 rows). Priorities rank risk before breadth. The list separates policy decisions, engineering, deployment/operations, and test evidence. Do not start decision-gated implementation as a workaround for an unresolved policy.

## P0 — Security boundary before broad Admin rollout

1. **P0-01 — Customer compliance authorization and subject scoping** (`F-01`). Agree exact role/function policy, enforce across all case subresources, and add no-scope/cross-customer negative API tests. Owner suggestion: ARENA 3 + security.
2. **P0-02 — Notification delivery list permission** (`F-02`). Apply/verify server-side read scope and safe projection; preserve independent provider-status/test-send and registry policies. Owner suggestion: ARENA 3.
3. **P0-03 — Limit diagnostics permission parity** (`F-03`). Decide broad workforce allowlist vs `limit.view`, enforce that decision server-side, and keep reservation recovery separately privileged. Owner suggestion: ARENA 3.

## P1 — Close material product and functional gaps

- **P1-01–02:** server-side fraud/category isolation; then complete the intended compliance case Admin workflow only after P0 authorization and transition-policy decision.
- **P1-03–04:** governed Admin workspaces for fee/commission/product/limit; decide if reward rules have a V1 runtime credit effect or are registry-only. Verify the consumer/effect, not just persistence.
- **P1-05:** configure/operate/monitor C2C expiry worker in intended deployments. This does not alter the no-automatic-disposition rule for expired funds.
- **P1-06:** run full Admin notification maker-checker/execute/reload path in browser against a real test DB; the existing source/test evidence is inherited, no live provider send.
- **P1-07:** product decision on a general approval queue; a known-ID lookup is not one.
- **P1-08:** current end-to-end Admin agent onboarding/funding maker-checker evidence (distinct makers/checkers, persisted ledger/history reload).

## P2 — Workflow boundaries, authorization and operational evidence

Support lifecycle definition; workforce enable/reactivation permission decision; dashboard settings authoring scope; sensitive-route authorization parity; browser UAT; disposable test DB migration-chain evidence; truthful notification operational status/retry/receipt disclosure; and cross-screen PII/secret projection review.

## P3 — Clarity and readiness

Read-only labels; structured config UX/diffs; separate dependency/release review; refresh claim-to-evidence documentation after decisions and verified tests.

## Suggested assignment

- **ARENA 1:** canonical money/limit/reward runtime and expiry worker operation/evidence.
- **ARENA 2:** Admin Web workflows, navigation UX, browser UAT.
- **ARENA 3:** backend authorization, policy/catalogue integration, route tests, governed APIs.
- **ARENA 4:** source inventory, cross-surface test strategy, release evidence and claim-to-source reconciliation.
- **Product/security/operations owners:** policy choices and deployment gates listed in the CSV; engineering must not invent them.

Acceptance is testable, but this backlog is not an authorization to change financial behavior, enable customer notifications, add manual retry, decide expired-fund disposition, or begin mobile work.
