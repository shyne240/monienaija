# 07 — Recommended Integration Acceptance Gate

## Gate 0 — Decisions and change ownership

- Record Q-01 through Q-08 in an approved policy/decision record, especially notification-support access and limit function-vs-type policy.
- Assign compliance (Arena 1), notification (Arena 2), limits (Arena 3); route P0-04 actor identity to an accountable backend/security owner.
- No arena should alter another arena's boundary or role grants without explicit coordination.

## Gate 1 — Review each branch before merge

For each implementation branch:

1. Pin exact branch tip and merge base; inspect full diff against the integrated application SHA.
2. Check controller and route-policy enforcement; client/UI visibility is never sufficient.
3. Inspect catalogue function codes and role grants, principal types, resource/category/customer scoping and mismatch behavior.
4. Verify audit actor comes from verified auth context; reject/ignore caller identity fields.
5. Inspect exact negative tests in an HTTP app with real guard and realistic seeded role/function mappings.
6. Verify DB no-side-effects on denied calls and safe persisted/read projections.

Classification per criterion: **PASS** only when source and test evidence both satisfy it; **FAIL** if contradicted; **UNVERIFIED** if not exercised or evidence incomplete. Keep pending policy decisions visibly pending.

## Gate 2 — Combined integrated candidate

- Review conflicts in shared `route-policy-registry.ts`, authorization seeds, customer path policies, notification controller/test, and limit tests.
- Confirm route specificity/order and guard auth mode after all three changes.
- Run four focused suites: compliance HTTP authorization/category+actor; notification deliveries HTTP auth/projection; limit diagnostics HTTP auth/scope; a combined guard/cross-module regression.
- Run full sequential PostgreSQL integration, backend unit tests, Admin typecheck/component tests/build on one common candidate SHA. Record exact commit and logs.
- Verify Admin visibility per approved role and direct API denial independent of React.

## Gate 3 — Independent acceptance result

A P0 is accepted only if every applicable row in `01-P0-ACCEPTANCE-MATRIX.md` passes and product/security decisions are recorded. P0-04 is a separate required condition for compliance writes. Any `UNVERIFIED`, unresolved role policy, or failed DB/browser-API auth test blocks overall acceptance.

**Current gate result: BLOCKED / PENDING.** No current implementation branch reviewed; baseline PG service evidence does not cover new endpoint authorization; full PG test environment was unavailable in the prior run. No merge/deployment decision can be issued from this source-only review.
