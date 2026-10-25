# MonieNaija — Agent & Aggregator Scope Archive
Version: 2026-10-25 | Status: Design archive, not implementation approval

> Integrity note: The 72 decisions were reached in prior discussion. Exact numbered text for decisions 01–43 is not fully recoverable from available context. This document preserves their confirmed consolidated scope without fabricating missing item-by-item wording. Decisions 44–72 are numbered summaries.

## 01–43 | Foundational decisions (consolidated, not exact numbered transcripts)

- Agent and Customer accounts are completely separate: distinct credentials, identity, logins, phone numbers and applications; no account linking.
- Agents may apply publicly or be registered by authorized internal staff; both follow a unified approval and verification lifecycle. MonieNaija appoints and verifies Agents.
- Aggregator applicants are CAC-registered companies; public applications and staff-initiated onboarding are supported, subject to KYB of directors, beneficial owners, authority, funding sources, accounts and relevant regulatory evidence.
- Aggregator network management, transaction rights and MonieNaija's legal role depend on the applicable CBN licensing framework and approved provider arrangements. Software roles do not confer a licence.
- Aggregator liquidity can comprise Aggregator-owned and MonieNaija-provided funds, tracked separately. Funding, return, recovery and redistribution require controls and audit; no unrestricted Agent-to-Agent transfer.
- Agents can request float; Aggregators may fund proactively, partially fulfill, decline or escalate. MonieNaija may fund Agents directly. Exceptions require controlled approval.
- Aggregator commissions can combine transaction earnings and liquidity compensation with configurable settlement schedules.
- Aggregator personnel may manage company branches and scoped staff accounts; maker-checker, MFA, step-up authentication, account recovery and independent MonieNaija oversight are required.
- Aggregator company identity, ownership, signatories, bank accounts and sensitive changes require risk-based verification and MonieNaija approval. KYB reverification, offboarding and reconciliation preserve Agent continuity.
- Agent assignment and reassignment, including bulk reassignment during Aggregator offboarding, require MonieNaija oversight, notices, historical attribution and settlement protection.
- Digital agreements are versioned, signed or accepted by authorized parties, and retained with effective dates; material amendments follow applicable notice/consent requirements.
- Aggregator web portal and permitted mobile capabilities, corporate branch liquidity, HQ replenishment and branch reporting are in scope for the eventual Aggregator phase.
- Source-recovery limitation: exact decision numbers, wording and selected option labels for decisions 05–43 were not available in the retrieved conversation context. The statements above are consolidated confirmed requirements, not invented numbered transcriptions.

## 44–53 | Commercial and financial decisions

- 44. Standard commission plans with controlled individual overrides; fixed, percentage, tiered, volume/performance and liquidity components; effective-dated history and approvals.
- 45. Real-time ledger-based calculation of Agent, Aggregator and MonieNaija allocations, with reversals, historical attribution and independent settlement schedules.
- 46. Structured commission disputes, automated verification, maker-checker adjustments, selective holds, compensating entries and audit.
- 47. Automated commission payouts with risk-based approvals, thresholds, verified beneficiaries, duplicate prevention, reconciliation and emergency suspension.
- 48. Controlled partial settlements on insufficient funds; priorities, escalation, unpaid liabilities and safe retries.
- 49. Real-time earnings dashboards and transaction-level reporting; PDF/Excel/CSV statements, branch/company views and scheduled delivery.
- 50. Configurable tax/statutory deduction rules, gross-to-net, exemptions, certificates, remittance liabilities and reconciliation; no assumed tax rates.
- 51. Monitor tax/regulatory changes; legally reviewed controlled activation, impact simulation, effective dating, maker-checker and history.
- 52. Recover commission reversals through future earnings, legally authorized balances or repayment; finance escalation; never seize protected or third-party funds.
- 53. Configurable Agent/Aggregator incentive campaigns, budgets, eligibility, milestones, tracking, fraud controls and controlled payouts.

## 54–62 | Risk, operations and network controls

- 54. Hierarchical transaction/float limits; regulatory, platform, tier, individual, Aggregator, branch, transaction and cumulative ceilings; most restrictive wins; missing limits never imply unlimited.
- 55. Risk-based fraud monitoring with rules, behavioural scoring, suspicious transaction/funding detection, automated restrictions, investigation and central resolution.
- 56. Unified Agent/Aggregator compliance lifecycle: KYC/KYB, document renewal, reverification, remediation, restrictions/reinstatement, reporting and oversight.
- 57. Training/certification: onboarding courses, assessments, responsibility-based expiry, refreshers, progress and activation restrictions.
- 58. Agent outlet management: lawful multiple outlets, verification, geography, terminals, limits, relocation/closure and reporting.
- 59. POS/device lifecycle: inventory, ownership, assignment, activation/suspension, security, lost-device handling, maintenance and audit.
- 60. Transaction dispute/reversal management: failure detection, provider reconciliation, controlled refunds, case tracking, deadlines, Aggregator-assisted support and audit.
- 61. Network intelligence dashboards: growth, retention, transactions, float, profitability, geography, compliance/fraud, KPIs, alerts and history.
- 62. Operational resilience: monitoring, incident severity/escalation, restrictions, provider failover, notices, reports, reconciliation and unknown-outcome verification before retry/refund.

## 63–72 | Final network decisions

- 63. Targeted multichannel communications, scheduling, mandatory acknowledgements, delivery tracking, Aggregator-to-Agent messages and emergency broadcasts; MonieNaija retains central authority.
- 64. Phased independently testable implementation with dependency management, backend corrections, financial/security validation and controlled rollout.
- 65. Audit and preserve sound existing functionality; selectively refactor defects; tested migrations, regression tests and change documentation.
- 66. Evidence-based milestone approval: traceability, unit/integration/E2E, security, ledger, migration/rollback, UI evidence, defects and explicit approval before next phase.
- 67. Master specification plus phase-specific implementation packages (requirements, dependencies, data/API models, controls and tests); detailed centralized RBAC matrix deferred.
- 68. Configurable Agent tiers: names, eligibility, KYC, training, limits, privileges, commissions and upgrade conditions; regulatory constraints and history.
- 69. Hybrid tier progression: automated eligibility, Agent-requested upgrades, controlled high-risk approvals, restrictions, notifications, appeals and effective-dated history.
- 70. Intelligent Agent-to-Aggregator assignment using preference, permitted referrals, geography, coverage, capacity, liquidity, performance and final MonieNaija approval; lawful direct-management fallback.
- 71. Connectivity-resilient Agent Mobile: offline drafts only, secure synchronization, unique references, idempotency, unknown-outcome checks, verified statuses and receipts only after success.
- 72. Controlled risk-based rollout: sandbox financial simulations; verified production pilot; geographic expansion; broader rollout only after operational, financial, security and regulatory gates, with feature flags, monitoring, incident response and rollback.

## Current delivery sequencing decision | V1 vs later expansion

- V1: prioritize ordinary Agents operating directly under MonieNaija; complete, repair, test and stabilize the existing Agent system first.
- Later expansion: Aggregator network, corporate branches, Aggregator-owned liquidity, portal, hierarchy, attribution and associated advanced operations are deferred—not cancelled.
- All 72 design decisions remain archived as intended future scope. V1 must not assume MonieNaija possesses a licence it has not obtained.

## Audit and governance notes

- Repository identity: https://github.com/shyne240/monienaija. This archive is exclusively MonieNaija; do not merge it with EcclesiaOne.
- Codex local audit identified existing Agent/Aggregator infrastructure and critical Agent funding permission/maker-checker gaps, plus high-priority session-role, funding-backing and concurrency risks. Verify against the current commit before implementation.
- Do not treat this archive as a verbatim transcript. Decisions 44–72 are numbered summaries from the preserved conversation; decisions 01–43 are consolidated themes because exact numbered wording was not recoverable.
- Regulatory requirements, CBN permissions, tax treatment and external provider arrangements require validation before production activation.
- Preserve the repository's authoritative platform roadmap and domain ownership (A5 Ledger, B1 Commercial, B2 Finance, B3 Treasury, B5 Merchant, B9 IAM, etc.).

## Arena retention instruction

Save this document verbatim in the MonieNaija project documentation, commit it to version control in a documentation-only change, and retain a second copy in Arena's own project knowledge or durable workspace if supported. Confirm exact storage locations and commit SHA. Do not silently rewrite scope or implement deferred Aggregator features. Never mix with EcclesiaOne.
