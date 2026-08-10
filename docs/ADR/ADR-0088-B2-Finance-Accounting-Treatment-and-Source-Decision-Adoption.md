# ADR-0088 — B2 Finance Accounting Treatment and Source Decision Adoption

- **ADR ID:** ADR-0088
- **Platform:** B2 — Finance Platform
- **Task:** B2F07
- **Status:** Accepted; internal runtime implemented
- **Contract:** [`docs/B2F-ACCOUNTING-TREATMENT-CONTRACT.md`](../B2F-ACCOUNTING-TREATMENT-CONTRACT.md)
- **Migration:** `1785753600049-CreateB2FFinanceAccountingTreatments.ts`

## Context

B1 exposes durable by-reference commercial, billing/invoice, recognition/tax/cost, profitability, and commercial-reconciliation records. A6 exposes settlement/suspense read methods. A7 product financial effects lack a verified immutable by-reference consumer method. B2F03–B2F06 provide classification, period, journal governance, and controls.

Finance needs to adopt source decisions without recomputing or replacing them.

## Decision

1. Persist immutable deterministic Finance accounting treatments distinct from source decisions and A5 journals.
2. Verify B1 records through existing by-reference services and A6 settlement/suspense through existing read methods.
3. Fail closed for A7 product financial effects until an authoritative by-reference read interface exists.
4. Require exact source owner/category/reference/version/hash/currentness and NGN/customer-funds compatibility.
5. Consume B2F04 period admission, B2F06 treatment control, and B2F05 draft journal governance.
6. Preserve B2F03 classification/mapping references and canonical A5 UUIDs; create no account/mapping authority.
7. Never call A5 posting from treatment adoption.
8. Use shared idempotency/audit, deterministic hashes, and one treatment version per source version.
9. Expose internal read-only treatment/source-verification ports only.

## Consequences

- B1/A6 business meaning stays source-owned.
- Finance treatment is explicit, versioned, and auditable.
- Source mismatch/staleness/ambiguity fails before journal governance.
- A7 adoption and durable mapping verification remain production blockers.
- Posting remains B2F05/A5-controlled.

## Alternatives rejected

- Re-run B1/A6/A7 logic in Finance: duplicate authority.
- Trust caller-supplied A7 snapshots: unverifiable provenance.
- Post directly from treatment: bypasses B2F05/A5 controls.
- Infer mappings by classification/code: violates B2F03.
- Create public adoption API: B10-owned and out of scope.

## Verification

- [x] ADR-0088 follows ADR-0087.
- [x] B1/A6 verified read-only adoption implemented.
- [x] A7 fails closed and is documented for review.
- [x] B2F03–B2F06 integrations enforced.
- [x] No A5 posting, source mutation, reconciliation duplication, API, frontend, or B2F08 introduced.
