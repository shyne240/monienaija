# A1 Decision Approval Checklist

- **Task:** A1T10 — Draft ADR-0020 and ADR-0021
- **Status:** Draft review checklist; not an approval record
- **Scope:** ADR-0020 Foundation Closure and Scope Boundary; ADR-0021 Customer Domain Canonical Model and Ownership Rules
- **Application code, API, entity, migration, and configuration changes:** None
- **Decision owners:** Architecture, Engineering, Security, Risk, Compliance, Finance, Operations, Product, and accountable release owners

## 1. Review instructions

This checklist records the evidence and approvals required for ADR-0020 and ADR-0021. A checked evidence item means that the document exists and was reviewed; it does not mean that an accountable owner has approved the ADR. Approval fields remain `Pending` until the named owner records a decision through the architecture governance process.

The checklist must be read with:

- [`ADR-0020-Foundation-Closure-and-Scope-Boundary.md`](ADR/ADR-0020-Foundation-Closure-and-Scope-Boundary.md)
- [`ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md`](ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md)
- [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md)
- [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](CUSTOMER-ADJACENT-OVERLAP-REVIEW.md)
- [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](RISK-COMPLIANCE-AUTHORITY-REVIEW.md)
- [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)
- [`ROADMAP.md`](ROADMAP.md), [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md), and [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)

## 2. ADR-0020 closure and scope checklist

| Review item                  | Evidence / acceptance condition                                                                                                             | Owner                             | Status  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| A1 purpose                   | ADR-0020 defines A1 as Foundation Consolidation and not a Product Roadmap milestone                                                         | Architecture / Product            | Pending |
| Baseline boundary            | M0-M9 and P1.0-P1.10 are treated as the current baseline                                                                                    | Engineering / Product             | Pending |
| Product roadmap preservation | Product Roadmap P1.0-P1.15 names remain exact and unchanged                                                                                 | Product / Architecture            | Pending |
| ADR chronology               | ADR-0001 through ADR-0019 remain cross-referenced; reconstructed ADR-0012 is identified as reconstructed                                    | Architecture                      | Pending |
| A1 non-goals                 | No runtime identity, account binding, policy engine, financial activation, external integration, API, migration, or module work is included | Engineering / Security            | Pending |
| Ownership package            | A1T02-A1T08 artifacts identify owners, projections, dependencies, and prohibited edges                                                      | Architecture / Domain owners      | Pending |
| A2-A8 boundaries             | Future phases have explicit responsibilities and entry dependencies                                                                         | Architecture / Release owners     | Pending |
| Decision change control      | Later changes require an approved ADR or architecture decision-log entry                                                                    | Architecture governance           | Pending |
| Approval state               | ADR-0020 is approved, rejected, or returned with comments by accountable owners                                                             | Architecture / accountable owners | Pending |

## 3. ADR-0021 ownership checklist

| Review item                  | Evidence / acceptance condition                                                                                                  | Owner                             | Status  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| Customer authority           | `customer` owns Customer UUID/reference, profile, contacts, addresses, identity documents, and KYC metadata                      | Customer Engineering / Risk       | Pending |
| Financial authority          | `ledger` owns accounts, journals, lines, balances, and posted financial truth; `wallet` owns the financial facade                | Ledger / Finance                  | Pending |
| Customer-wallet boundary     | `CustomerWallet` is provisioning metadata and requires an explicit A3 binding; it does not own balances                          | Customer Wallet / Ledger          | Pending |
| Beneficiary disposition      | P1.6 `customer-beneficiary` is the preferred customer-owned transfer-facing authority; legacy data becomes compatibility/history | Payments Risk / Operations        | Pending |
| Funding-instrument boundary  | Customer funding instruments remain registration metadata until A6 provider/settlement decisions                                 | Payments Risk / Compliance        | Pending |
| Risk and eligibility         | P1.3 remains current eligibility/restriction source until A4; P1.10 is preferred manual risk evidence                            | Risk / Compliance                 | Pending |
| Compliance boundary          | Compliance cases remain investigation/workflow evidence and are not an AML, sanctions, fraud, or monitoring engine               | Compliance / Risk                 | Pending |
| Authentication boundary      | P1.8 metadata remains separate from A2 runtime authentication, sessions, authorization, and privileged actions                   | Security                          | Pending |
| Preference boundary          | Preferences remain customer intent; notification delivery owns separate delivery state                                           | Product / Operations              | Pending |
| Operations boundary          | Audit, idempotency, outbox, metrics, diagnostics, and readiness use shared Operations primitives                                 | Operations / Production           | Pending |
| Reconciliation boundary      | Reconciliation remains an independent read-only financial control                                                                | Finance / Reconciliation          | Pending |
| Projection rule              | Projections and policy decisions cannot write to their source authorities                                                        | Architecture / Domain owners      | Pending |
| Identifier/privacy alignment | A1T07 rules for canonical IDs, references, classification, retention, legal holds, and external sharing are not contradicted     | Security / Compliance / Legal     | Pending |
| Ownership completeness       | Every major concept in the canonical matrix has one owner, metadata/projection status, target phase, and disposition             | Architecture / Domain owners      | Pending |
| Approval state               | ADR-0021 is approved, rejected, or returned with comments by accountable owners                                                  | Architecture / accountable owners | Pending |

## 4. Scope protection checklist

The following must remain true while ADR-0020 and ADR-0021 are reviewed:

- [ ] No application source file is modified.
- [ ] No API, DTO, controller, service, entity, module, migration, test, or runtime configuration is added or changed.
- [ ] No ledger balance, journal, or line is copied into customer metadata.
- [ ] No current internal route is declared production-public.
- [ ] No automated policy, AML, sanctions, fraud, transaction-monitoring, authentication, authorization, account-binding, transfer, or external-provider behavior is implemented.
- [ ] No existing ADR is deleted or silently replaced.
- [ ] No Product Roadmap milestone is renumbered or renamed.

## 5. Review record

| ADR      | Decision              | Reviewer / accountable owner | Date    | Comments / follow-up |
| -------- | --------------------- | ---------------------------- | ------- | -------------------- |
| ADR-0020 | Pending formal review | Pending                      | Pending | Pending              |
| ADR-0021 | Pending formal review | Pending                      | Pending | Pending              |

This checklist is an A1T10 decision-approval input. The final A1 review package in A1T14 must carry forward unresolved comments, named owners, decision dates, and the final ADR review status.
