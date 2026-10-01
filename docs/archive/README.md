# Documentation archive — historical development records

This directory preserves MonieNaija's development-era documentation **verbatim**. These documents
are retained for provenance: they record how V1 was designed, phased, verified, and accepted, and
authoritative documents elsewhere still cite them as evidence (decision registers, staleness
reconciliations, UAT provenance).

**They do not automatically represent current V1 requirements.** Product scope, architecture,
security, commercial, deployment, and acceptance truth lives **outside** this archive — start at
[`../README.md`](../README.md) (documentation index) or this tree's authority record,
[`../V1/V1-DOCUMENTATION-AUDIT-01.md`](../V1/V1-DOCUMENTATION-AUDIT-01.md).

## Subtrees (by era)

| Subtree | Contents |
|---|---|
| [`a1-consolidation/`](a1-consolidation/) | A1T-era consolidation: baseline inventories, ownership matrix, historical roadmaps/phase plan, cross-document maps, A1 process packages (25 files) |
| [`m-milestones/`](m-milestones/) | Foundation-era milestone docs and manual verifications M3–M9 (8 files) |
| [`p1-customer-foundation/`](p1-customer-foundation/) | P1.0–P1.10 customer-foundation product milestone docs (10 files) |
| [`phases-a2-a7/`](phases-a2-a7/) | A2–A7 phase packages: baselines, contracts, plans, checklists, review statuses, integration matrices, route-exposure records, recovery runbooks, handoffs (96 files) |
| [`phases-b1-b2/`](phases-b1-b2/) | B1 commercial, B2 public-API/finance, and B2F finance-accounting contracts and packages (48 files) |
| [`agent-blockers/`](agent-blockers/) | Pre-build fail-closed agent-domain blocker records a8–a11 (4 files) |
| [`v1-implementation/`](v1-implementation/) | V1 implementation lineage: per-feature verification reports and audits (funding, limits, commercial, commission/reward, hardening 01–09, onboarding, S-FIX-01, SMS-V1, app-hardening A24–A26) (57 files) |

## Notes for readers

- Documents were moved here with `git mv` (history preserved); contents were **not rewritten**.
- Statements such as "HEAD `…`", "pushed", or relative links between archived files describe their
  own era. Relative links *within* a subtree still resolve; links that crossed into documents now
  held in the current (non-archive) tree may not — consult the index instead.
- If a document here appears to conflict with a current document, the current document controls
  (or see the audit's conflict register, §5 of `../V1/V1-DOCUMENTATION-AUDIT-01.md`).
