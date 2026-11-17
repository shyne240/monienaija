# Migration allocation register

- Arena 3 allocation: `1785753600300`–`1785753600399` (confirmed by the user for this mission).
- Arena 4 allocation: `1785753600400`–`1785753600499`; published foundation `1785753600400` and institutional financial ownership `1785753600401` retain their identifiers.
- **Explicit exception granted by the user:** Arena 3 may use `1785753600500`–`1785753600599` for the institutional governance correction because it depends on 0400. Reserve `1785753600500-InstitutionGovernanceExecutionIntegrity` for this correction. A tree search found no 0500-series migration in the accepted branch or the fetched current Arena 1, Arena 2, and Arena 4 branch heads. Future integration must recheck the registry and live branches before release.

## Protected checker authority correction

- `1785753600501-ProtectedAuthorityBoundary` uses the same user-authorized `1785753600500`–`1785753600599` exception. It depends on `1785753600400`/`1785753600500` and preserves every published identifier; no migration was renumbered. It reuses 0500's evidence tables and adds `protected_authority` (schema, checker decisions, approval consumptions, refusal triggers, row level security, role grants).
- The 0500-series reservation remains limited to this institutional correction; it is not a general-purpose allocation. Re-check the register and all live Arena branch heads before release.

## ARENA 3 KYC provider/tier protected authority

- Reserved and used `1785753600300-KycGovernanceProtectedAuthority` for the KYC governance boundary. The complete repository migration inventory was checked before finalizing this identifier; it is within Arena 3's `0300`–`0399` range and does not renumber or replace any published migration. The migration reuses existing provider/tier proposal tables and the shared `protected_authority` schema.
- Keep `0500`–`0599` limited to the previously authorized institutional-governance correction; this KYC migration does not use that exception. Recheck the complete migration registry and all live Arena branch heads before release.

## ARENA 4 Phase 2 integration

- `1785753600401-CreateInstitutionalFinancialOwnership` (source pins `1cf6ac75b18a2af68dfbd33389d1f2e5fb7f32f2`, `684271e9d972edc629d629b73e66cd719d759117`) is integrated inside its published range. It is additive: institution ownership columns, enrolment/attribution tables and guards.
- `1785753600502-ProtectedAuthorityInstitutionalOwnership` extends the 0501 boundary to the two Phase 2 governed actions. It is a corrective migration under the same user-authorized `0500`–`0599` exception and does not renumber anything.
- Migration `1785753600117` remains intentionally absent. The Phase 2 source branch's allow-lists referenced it; this branch excludes it (and its 0120–0132 siblings) because they belong to unfinished Arena 1 work.

## Arena 2 customer/agent wallet-transfer parity

- Reserve the user-proposed `1785753600800`–`1785753600899` range for this branch's P2P parity changes. On 2026-11-17, the current checkout had no migration in that range and the recursive trees of all 39 distinct published branch-head commits (41 branch names) had no matching migration path; the set of branch heads was unchanged on immediate recheck. Active unpublished work is not observable, so coordinate with other active owners and recheck both this register and live published trees immediately before introducing a migration or integrating branches.
- Arena 3D's `1785753600600`–`1785753600699` range and its published `0605` head are untouched. A later 0800-series migration would become the overall readiness head; reconcile the head with concurrent Arena 3D changes rather than overwriting its migrations or ignoring its updated inventory.
