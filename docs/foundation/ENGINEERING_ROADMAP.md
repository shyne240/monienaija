# Engineering Roadmap

## Roadmap guardrails
Milestones are decision gates, not dates or promises. Advancement requires signed evidence, risk acceptance by accountable owners, and applicable legal/compliance review. No customer-money feature is released solely because code is complete.

| Milestone | Outcome | Exit evidence |
|---|---|---|
| **M0 — Foundation** | Shared product, architecture, quality, security, contribution, and ADR rules. | This documentation approved; owners and decision forums named. |
| **M1 — Discovery & regulatory design** | Domain model, licensing path, customer-protection, data-classification, provider and operating-model requirements understood. | Reviewed requirements, risk register, control map, regulatory/compliance sign-off where required. |
| **M2 — Platform architecture** | Bounded contexts, trust boundaries, ledger invariants, API/event contracts, resiliency and multi-region strategy designed. | Threat model, capacity model, disaster-recovery objectives, architecture review and ADRs. |
| **M3 — Engineering enablement** | Reproducible delivery, environments, identity/access, secrets, observability, CI quality gates, and incident practices designed/implemented. | Access review, pipeline evidence, audit logging, runbook and restore exercises. |
| **M4 — Core money domain readiness** | Wallet, double-entry ledger, customer lifecycle, limits, fees, idempotency and reconciliation designs are proven in controlled environments. | Invariant/property tests, independent reconciliation, failure/recovery drills, finance and risk approval. |
| **M5 — Controlled payment capabilities** | Approved rails and channels (for example virtual accounts, transfers, agents, QR, bills, airtime/data) are enabled only per product and regulatory scope. | Partner certification, security testing, operational readiness, customer support and rollback plans. |
| **M6 — Expanded financial products** | Savings, loans, cards, merchant/POS, bulk/payroll, and treasury capabilities are added behind explicit governance. | Product-specific legal, credit/risk, settlement, disclosure, and monitoring approvals. |
| **M7 — Scale & resilience** | Horizontal scale, event processing, active regional strategy, settlement/reconciliation operations, fraud/compliance controls mature. | Load/chaos tests, DR exercise, RTO/RPO proof, regional failover evidence, operational audit. |
| **M8 — Production launch** | A bounded, monitored production release is ready. | Go/no-go approval from engineering, security, risk/compliance, operations, support, and executive accountable owners. |
| **M9 — Production maturity** | Safe iteration, audits, incident learning, controls monitoring, and capacity evolution. | Post-launch review, SLO results, reconciliation and control attestations, prioritised improvement plan. |

## Sequencing rules
1. Regulatory and risk constraints set the release envelope.
2. The ledger and reconciliation are prerequisites for value movement; they are never retrofitted after launch.
3. Observability, support tooling, and recovery paths ship with each capability.
4. Pilot scope, limits, cohorts, and rollback conditions are explicit and reversible.
5. Later milestones may be researched in parallel, but production dependencies cannot be skipped.

## Production definition
Production means a customer-impacting service operating with approved legal/regulatory posture, monitored controls, on-call ownership, tested recovery, support procedures, reconciled financial records, and authorised release governance—not merely deployed software.
