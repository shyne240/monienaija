# MonieNaija Documentation Index

**New to this repository?** Read the root [`README.md`](../README.md) first, then use this index to
go deeper. Everything linked below is a **current, authoritative** document. Historical development
artifacts live in [`archive/`](archive/README.md) and are *not* current requirements.

## V1 product / scope

| What | Where |
|---|---|
| V1 scope adjudication (what is in, what is deliberately out, decision-pending items) | [`V1/V1-SCOPE-CHALLENGE-01.md`](V1/V1-SCOPE-CHALLENGE-01.md) |
| V1 implementation-completion audit (22 gaps → closed) | [`V1/V1-PRODUCT-COMPLETION-AUDIT.md`](V1/V1-PRODUCT-COMPLETION-AUDIT.md) |
| V1 operational launch-gate audit ("operationally complete") | [`V1/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md`](V1/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md) |
| Runtime-backed capability surface | [`V1/V1-CAPABILITY-REGISTRY.md`](V1/V1-CAPABILITY-REGISTRY.md) |
| Documentation Architecture (audited org of this very tree) | [`V1/V1-DOCUMENTATION-AUDIT-01.md`](V1/V1-DOCUMENTATION-AUDIT-01.md) |

## Architecture

- Decision spine: [`decisions/ADR/`](decisions/ADR/) — 73 architecture decision records; baseline register [`decisions/ADR-INVENTORY.md`](decisions/ADR-INVENTORY.md)
- Platform sequencing & ownership: [`decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md`](decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md) (+ legacy-artifact register [`decisions/PLATFORM-ARTIFACT-CLASSIFICATION.md`](decisions/PLATFORM-ARTIFACT-CLASSIFICATION.md))
- Target logical domains: [`foundation/SYSTEM_ARCHITECTURE.md`](foundation/SYSTEM_ARCHITECTURE.md)

## Financial flows

- Route→service→ledger traces for all seven V1 products: [`V1/V1-END-TO-END-PROCESS-AUDIT.md`](V1/V1-END-TO-END-PROCESS-AUDIT.md)
- Key ADRs: ADR-0002 (money representation), ADR-0004 (wallet & ledger), ADR-0041–0045 (transfer command boundary, authorization, posting/correlation, idempotency/outbox/recovery, transaction states)

## Customer & Agent

- Customer app backend contract (OTP auth, session, PIN, history, profile): [`V1/A23-CUSTOMER-APP-CONTRACT.md`](V1/A23-CUSTOMER-APP-CONTRACT.md)
- Agent app backend contract (lifecycle, capabilities, receiving numbers, float): [`V1/A21-AGENT-APP-CONTRACT.md`](V1/A21-AGENT-APP-CONTRACT.md)
- UAT family cards (Customer 40 / Agent 20): [`uat/V1-UAT-MASTER-01.md`](uat/V1-UAT-MASTER-01.md)
- Agent onboarding decision lineage lives in [`archive/v1-implementation/`](archive/v1-implementation/)

## Authentication / security

- Current four-plane authentication architecture + production bootstrap posture: [`V1/V1-BOOTSTRAP-AUDIT-01.md`](V1/V1-BOOTSTRAP-AUDIT-01.md)
- Workforce & privileged authentication decision: [`decisions/ADR/ADR-0092-A2-Workforce-and-Privileged-Authentication.md`](decisions/ADR/ADR-0092-A2-Workforce-and-Privileged-Authentication.md)
- Security posture & guidelines: [`foundation/SECURITY_GUIDELINES.md`](foundation/SECURITY_GUIDELINES.md); A2 trust/threat-model contracts in [`archive/phases-a2-a7/`](archive/phases-a2-a7/)

## Commercial / fees / VAT / commission / rewards

- Authoritative decision surfaces: [`V1/V1-COMMERCIAL-POLICY-DECISION-PACK.md`](V1/V1-COMMERCIAL-POLICY-DECISION-PACK.md) (six-state vocabulary; **V1 pilot = fee-free**; VAT is configuration, no rate in code) and [`V1/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md`](V1/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md) (fee revenue + commission accounting decision register)
- ADRs 0061–0069, 0091 in [`decisions/ADR/`](decisions/ADR/); B1/B2F design contracts in [`archive/phases-b1-b2/`](archive/phases-b1-b2/)

## Limits

- Runtime enforcement + pilot admission control + emergency stop: [`deployment/V1-PILOT-READINESS-CHECKLIST-01.md`](deployment/V1-PILOT-READINESS-CHECKLIST-01.md) §B.4/§I
- Decisions: ADR-0037/0038 (precedence & enforcement), ADR-0046 (pilot limits, cohorts, rollback)
- Implementation lineage: [`archive/v1-implementation/`](archive/v1-implementation/) (`V1-LIMIT-*`)

## Deployment

- [`deployment/DEPLOYMENT.md`](deployment/DEPLOYMENT.md) · [`deployment/PRODUCTION-CHECKLIST.md`](deployment/PRODUCTION-CHECKLIST.md)

## Workforce bootstrap

- Ceremony runbook: [`deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`](deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md) + env template [`deployment/config/v1-workforce-bootstrap.env.template`](deployment/config/v1-workforce-bootstrap.env.template)

## Pilot readiness

- Human-operator configuration & retest checklist for the 5 deployment blockers: [`deployment/V1-PILOT-READINESS-CHECKLIST-01.md`](deployment/V1-PILOT-READINESS-CHECKLIST-01.md)

## UAT

- 191-item master catalogue: [`uat/V1-UAT-MASTER-01.md`](uat/V1-UAT-MASTER-01.md)
- Final report (**CONDITIONALLY PASSED**, 175/0/16): [`uat/V1-UAT-FINAL-01.md`](uat/V1-UAT-FINAL-01.md)
- Raw evidence & provenance notes: [`uat/evidence/`](uat/README.md)

## Operations

- [`operations/RUNBOOK.md`](operations/RUNBOOK.md) · [`operations/OPERATIONS-GUIDE.md`](operations/OPERATIONS-GUIDE.md) · [`operations/MAINTENANCE.md`](operations/MAINTENANCE.md) · [`operations/DISASTER-RECOVERY.md`](operations/DISASTER-RECOVERY.md) · [`operations/RETENTION-POLICY.md`](operations/RETENTION-POLICY.md) · [`operations/FINAL-ACCEPTANCE.md`](operations/FINAL-ACCEPTANCE.md) · [`operations/API-VERSION-GUIDE.md`](operations/API-VERSION-GUIDE.md)

## API

- Public-API OpenAPI contract: [`api/B2-OPENAPI-v1.yaml`](api/B2-OPENAPI-v1.yaml); global prefix `/api/v1`

## Engineering standards

- [`foundation/CODING_STANDARDS.md`](foundation/CODING_STANDARDS.md) · [`foundation/CONTRIBUTING.md`](foundation/CONTRIBUTING.md) · [`foundation/TESTING_STRATEGY.md`](foundation/TESTING_STRATEGY.md) · [`foundation/ENGINEERING_ROADMAP.md`](foundation/ENGINEERING_ROADMAP.md) (historical milestone-gate register) · [`foundation/PROJECT_VISION.md`](foundation/PROJECT_VISION.md)†
- † Aspirational vision document; its "current implementation" line predates the V1 build (audit C-4) — the current truth is this index + the V1 corpus.

## Historical archive

- 254 development-era documents (A1 consolidation, M/P1 milestones, A2–A7 and B1/B2/B2F phase packages, agent pre-build blockers, V1 implementation lineage): [`archive/`](archive/README.md). Archived documents are **historical; current truth is outside the archive.**

---
*Index created by V1-DOCS-CLEANUP-02 per [`V1/V1-DOCUMENTATION-AUDIT-01.md`](V1/V1-DOCUMENTATION-AUDIT-01.md).*
