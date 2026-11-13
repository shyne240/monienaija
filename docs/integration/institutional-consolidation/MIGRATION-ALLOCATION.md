# Migration allocation register

- Arena 3 allocation: `1785753600300`–`1785753600399` (confirmed by the user for this mission).
- Arena 4 allocation: `1785753600400`–`1785753600499`; published foundation `1785753600400` and institutional financial ownership `1785753600401` retain their identifiers.
- **Explicit exception granted by the user:** Arena 3 may use `1785753600500`–`1785753600599` for the institutional governance correction because it depends on 0400. Reserve `1785753600500-InstitutionGovernanceExecutionIntegrity` for this correction. A tree search found no 0500-series migration in the accepted branch or the fetched current Arena 1, Arena 2, and Arena 4 branch heads. Future integration must recheck the registry and live branches before release.

## Protected checker authority correction

- `1785753600501-ProtectedAuthorityBoundary` uses the same user-authorized `1785753600500`–`1785753600599` exception. It depends on `1785753600400`/`1785753600500` and preserves every published identifier; no migration was renumbered. It reuses 0500's evidence tables and adds `protected_authority` (schema, checker decisions, approval consumptions, refusal triggers, row level security, role grants).
- The 0500-series reservation remains limited to this institutional correction; it is not a general-purpose allocation. Re-check the register and all live Arena branch heads before release.
