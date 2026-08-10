# ADR-0087 — B2 Finance Control Policy and Segregation of Duties

- **ADR ID:** ADR-0087
- **Platform:** B2 — Finance Platform
- **Task:** B2F06
- **Status:** Accepted; internal runtime implemented with no active default policy
- **Contract:** [`docs/B2F-FINANCE-CONTROL-CONTRACT.md`](../B2F-FINANCE-CONTROL-CONTRACT.md)
- **Migration:** `1785753600048-CreateB2FFinanceControlTables.ts`

## Context

A2 already owns runtime authorization and privileged approval, including role/scope checks, MFA, maker/checker self-approval rejection, resource/action fingerprint binding, expiry, and single-use consumption. B2F04 and B2F05 consume A2 but lacked Finance-specific roles, action controls, materiality bands, approval-count requirements, and exception evidence.

No repository-approved monetary thresholds or final regulatory role matrix exist. B2 must not invent them or become IAM.

## Decision

1. Implement versioned/effective Finance control policies and immutable deterministic control decisions.
2. Define Finance role semantics: preparer, approver, controller, and auditor; role assignment remains A2/B9-owned.
3. Define action controls for journal, period, mapping, override, and exception actions.
4. Require exactly three configurable contiguous bands: standard, elevated, and material. Seed no policy and no threshold amounts.
5. Require A2-consumed approval provenance and enforce maker/checker separation, checker roles, approval count, exact resource/version/hash, and override evidence.
6. Deny every decision when no active/effective policy exists.
7. Reuse shared idempotency/audit and serializable/locked/versioned persistence.
8. Integrate B2F04 transitions and B2F05 posting after A2 approval but before state/value effects.
9. Extend A2 approval views with their existing immutable policy payload; do not create or copy an approval vault.
10. Expose only an internal read-only policy/evaluation consumer port.

Exact production thresholds, legal requirements, multi-approval workflows above one checker, and final B9 role administration are **NOT VERIFIED / REQUIRES REVIEW**.

## Consequences

- Finance actions now fail closed under deterministic Finance controls.
- A2 remains the approval/authorization authority.
- B2F04/B2F05 cannot proceed when control policy denies.
- No active policy means production actions are intentionally blocked.
- Policy history and decision provenance are durable/auditable.
- A5/B1/A6/A7 remain unchanged.

## Alternatives rejected

- Hard-code industry-standard thresholds: not repository-authorized.
- Build Finance users/roles/approval records: duplicates A2/B9.
- Rely only on generic A2 approval: lacks Finance materiality/action policy.
- Let B2F04/B2F05 proceed without active policy: fails open.
- Create public control APIs: outside B2F06/B10-owned.

## Verification

- [x] ADR-0087 follows ADR-0086.
- [x] Role/action/materiality policy and deterministic decisions implemented.
- [x] A2 evidence consumed and self-approval/SoD enforced.
- [x] B2F04/B2F05 integrated.
- [x] No default thresholds or active policy invented.
- [x] No ledger, commercial, settlement, product, IAM, API, frontend, or B2F07 authority introduced.
