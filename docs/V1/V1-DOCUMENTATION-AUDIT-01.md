# V1-DOCUMENTATION-AUDIT-01 — Documentation Inventory, Classification, and Proposed V1 Documentation Architecture

- **Task:** V1-DOCS-CLEANUP-01 (audit phase) — **AUDIT ONLY. Nothing was moved, renamed, deleted, or consolidated.**
- **Date:** 2026-10-01 (Africa/Lagos) · **Branch:** `arena/01a0d883-monienaija`
- **Baseline tree audited:** `0694f5bc1162ff627a6b776e62603cb16a00a65b` (pushed; local == origin; tracked tree clean)
- **Authoritative acceptance anchors (given by the task):** `docs/uat-evidence/V1-UAT-FINAL-01.md` (V1 UAT final report — CONDITIONALLY PASSED) and `docs/V1-PILOT-READINESS-CHECKLIST-01.md` (pilot readiness)
- **Method:** catalogued every documentation file in the repository (`git ls-files docs/` + untracked additions + root-level documents), read headers/content of every family and in full the acceptance-critical set, traced supersession chains via each document's own authority references, and classified each file per the task's A/B/C/D scheme. Classification is per-file and exhaustive: **362 docs/ files are enumerated in Appendix A (108 A / 254 B / 0 C / 0 D)**; plus 2 root documents assessed in §9. This audit introduces no requirements, no capabilities, and no editorial changes to any existing document.

---

## 1. Documentation profile at baseline

The repository accumulated documentation across four eras, each self-labeled:

| Era | Marker | Files | Nature |
|---|---|---|---|
| **Foundation (M0–M9 / P1.0–P1.10)** | `M*`, `P1.*`, guides/`STANDARDS` | ~33 | milestone specs, manual verifications, engineering guides |
| **A1 consolidation** | `A1-*` + synthesis baselines | 25 | pre-phase consolidation inventories, decision maps, process artifacts |
| **Phase packages A2–A7, B1, B2/B2F** | `A2-*`…, `B1*`, `B2*`, agent blockers | 148 | phase baselines/contracts + plans, checklists, review statuses, handoffs, route-exposure records, recovery runbooks |
| **V1 implementation cycle** | `A21/A23/A24/A25/A26`, `V1-*`, `S-FIX-01`, `SMS-V1`, UAT corpus | ~156 | app contracts, verification reports, hardening series, limit/commercial/reward series, decision packs, scope challenge, bootstrap runbook, UAT catalogue + evidence + final report, pilot readiness checklist |

Plus 73 ADRs (`docs/ADR/`) — the authoritative decision spine across all eras — and governance/index-grade top-level documents.

**Total documentation files: 364** = 356 tracked under `docs/` + 6 untracked under `docs/` (UAT artifacts) + `README.md` + root `roadmap.md`.
Documentation-adjacent non-docs flagged but excluded from classification: `test/tmp-uat-b0-01.integration.spec.ts`, `test/tmp-uat-exec-01.integration.spec.ts` (UAT harness — untracked), `uat-run-results.jsonl` (repo root, untracked — byte-identical ancestor of the RUN-01 ledger per `docs/V1-UAT-RECOVERY-01.md`).

## 2. Classification policy (A/B/C/D as mandated)

- **A — KEEP:** current authoritative document; remains on the primary documentation path.
- **B — MOVE:** useful historical/provenance material; relocated to a clearly-marked archive (contents preserved byte-for-byte) **or** to a dedicated UAT-evidence area.
- **C — CONSOLIDATE:** unique information merged into an authoritative document, original removed.
- **D — REMOVE:** redundant, zero unique information.

**Applied strictly:**
- **C = 0 files.** Every prior consolidation was already performed historically by later documents that quote/incorporate their predecessors verbatim (e.g. `V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01` layers over `V1-COMMERCIAL-ACCOUNTING-AUDIT-01`; both decision packs re-anchor the standing conclusions of `V1-HARDENING-02A-FEE-POLICY-DECISION` and `V1-HARDENING-03-LIMIT-POLICY-AUDIT` with explicit staleness reconciliation). Performing additional merges now would rewrite history and risk information loss, and the task forbids rewriting large documents — so the correct disposition for those predecessors is **B with the supersession relationship recorded**, not C.
- **D = 0 files.** No file was found to be a byte-duplicate or devoid of unique information. Deleting anything would violate "no information may be lost". (The root `uat-run-results.jsonl` is a redundant ancestor copy — but it is not a docs file, and its disposition is flagged for the execution task, not assumed here.)

## 3. Authoritative document per major V1 subject

| Subject | Authoritative document(s) (current paths) |
|---|---|
| **What is V1 / scope** | `docs/V1-SCOPE-CHALLENGE-01.md` (final deferral adjudication · 6/7 deferrals survive · #59 Agent History closed) + `docs/V1-PRODUCT-COMPLETION-AUDIT.md` (22-gap implementation completion audit) + final UAT §16 exclusion list |
| **Architecture** | `docs/ADR/` (73 records; esp. ADR-0001…0009, 0012–0024, 0031–0054, 0061–0069, 0074–0092) + `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md` (platform ownership) + `docs/SYSTEM_ARCHITECTURE.md` (target logical domains) |
| **Financial flows (money movement)** | `docs/V1-END-TO-END-PROCESS-AUDIT.md` (route→service→ledger traces of all 7 V1 products) + ADR-0041…0045 + A5 contracts in archive (provenance) |
| **Authentication / authorization (4 planes)** | `docs/V1-BOOTSTRAP-AUDIT-01.md` (current four-plane auth truth) + ADR-0092 + A2 contracts in archive |
| **Customer lifecycle / Agent lifecycle** | UAT catalogue families (`docs/V1-UAT-MASTER-01.md`) + `docs/A23-CUSTOMER-APP-CONTRACT.md` / `docs/A21-AGENT-APP-CONTRACT.md` + P1.* and a8–a11 blocker docs in archive |
| **Commercial / fees / VAT / commission / rewards** | `docs/V1-COMMERCIAL-POLICY-DECISION-PACK.md` (P-DEC-01 six-state vocabulary) + `docs/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md` + ADR-0061…0069, 0091 + B2F/B1 contracts in archive |
| **Limits** | ADR-0037/0038/0046 + P-DEC-01 limit registers + `docs/V1-PILOT-READINESS-CHECKLIST-01.md` §I (runtime verification); V1-LIMIT-* series in archive |
| **Deployment** | `docs/DEPLOYMENT.md` + `docs/PRODUCTION-CHECKLIST.md` + pilot readiness checklist §A–C |
| **Workforce bootstrap** | `docs/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md` + `docs/config/v1-workforce-bootstrap.env.template` + `docs/V1-BOOTSTRAP-AUDIT-01.md` |
| **Pilot readiness** | `docs/V1-PILOT-READINESS-CHECKLIST-01.md` |
| **UAT (acceptance)** | `docs/V1-UAT-MASTER-01.md` (191-item catalogue) + `docs/uat-evidence/V1-UAT-FINAL-01.md` (final report) + `docs/uat-evidence/` raw artifacts |
| **Operational procedures** | `docs/RUNBOOK.md`, `docs/OPERATIONS-GUIDE.md`, `docs/MAINTENANCE.md`, `docs/DISASTER-RECOVERY.md`, `docs/RETENTION-POLICY.md`, `docs/FINAL-ACCEPTANCE.md`, `docs/API-VERSION-GUIDE.md` (+ per-phase recovery runbooks in archive) |
| **Historical decisions / governance** | `docs/ADR-INVENTORY.md`, `docs/PLATFORM-ARTIFACT-CLASSIFICATION.md`, A1 consolidation set (archive), phase approval packages (archive) |
| **Launch-gate evidence (pre-UAT)** | `docs/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md` |
| **Capability surface** | `docs/V1-CAPABILITY-REGISTRY.md` (runtime-backed registry doc) |

## 4. Supersession and duplication analysis (findings)

1. **Roadmap lineage (4 documents, no deeds conflict):** `docs/ROADMAP.md`, `docs/ARCHITECTURE-PHASE-PLAN.md`, `docs/PHASES.md` each carry a self-applied 2026-08-09 reconciliation notice ceding authority to `AUTHORITATIVE-PLATFORM-ROADMAP.md` — **superseded interpretations already resolved by the repo itself** ⇒ keep authoritative roadmap on primary path; archive the three historical baselines (B). Root `roadmap.md` is a **different, non-overlapping artifact** (Arena task-governance register, W-series admin-frontend era; note it even spells "MoneyNaija") — see Conflict C-5.
2. **Phase packages (A2–A7, B1, B2/B2F):** each phase has the same 7–12 artifacts (baseline, contracts, implementation plan, ADR review status, approval package, entry/exit checklists, integration matrix, route-exposure-and-rollback, operational recovery runbook, handoff). Their *binding decisions* live on in the 73 ADRs and the V1 decision/audit corpus; the packages are process provenance. ⇒ All 148 ⇒ B (archive), zero D.
3. **Verification lineage:** every V1 feature task produced a verification report (V1-001/003/005/006/007/008; LIMIT-01…06; COMMERCIAL-02/03/04 + DECISION-01/02/03A–03E; COMMISSION-01; REWARD-01; CREDENTIALS-01; S-FIX-01; SMS-V1; HARDENING-01…09 (+02A, 03, 05, 08 policy audits); CAPABILITY-REGISTRY; ENGINE-CAPABILITY-REGISTRY audit; ACCOUNTING family audit/review/implementation; CUSTOMER-ONBOARDING 01/02/DECISION-01/DECISION-AUDIT-01; A24/A25/A26; POST-V1-001). Their terminal conclusions are re-anchored in `V1-HARDENING-10`, the process audit, the decision packs, and the final UAT report. ⇒ B (archive), zero D — they retain provenance value (e.g. the B0 incident's contemporaneous narrative; P-DEC-01 quoting H-02A/H-03 standing conclusions).
4. **Commercial/accounting decision chain:** P-DEC-01 (six-state vocabulary) → `V1-COMMERCIAL-ACCOUNTING-AUDIT-01` → `V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01` (+ DECISION-REVIEW-01 + IMPLEMENTATION-01). The two packs are the authoritative decision surfaces; the audit and review pass are provenance ⇒ keep packs (A), archive predecessors (B).
5. **Bootstrap pair:** `V1-BOOTSTRAP-AUDIT-01` (observational four-plane audit, current truth) vs `V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01` (operational procedure) — complementary, both A.
6. **App contracts:** `A21-AGENT-APP-CONTRACT` / `A23-CUSTOMER-APP-CONTRACT` are implemented V1 backend contracts (A). The a8–a11 blocker docs are their pre-build fail-closed design record (B). A24–A26 are their hardening verification reports (B).
7. **Operations guides (RUNBOOK/OPERATIONS-GUIDE/MAINTENANCE/DISASTER-RECOVERY/RETENTION-POLICY/FINAL-ACCEPTANCE/API-VERSION-GUIDE):** M-era vintage but procedures reference endpoints that still exist (`/internal/acceptance`, `/internal/health-dashboard`, `/internal/diagnostics`, maintenance preview/execute); no V1-era replacement exists. ⇒ A under `operations/`, flagged in §6 as "pre-V1 vintage, still-accurate" (links to archived phase runbooks will be repaired in the execution task's link pass).
8. **OpenAPI asset:** `docs/api/B2-OPENAPI-v1.yaml` is the only machine-readable API contract ⇒ A under `api/` as-is.
9. **ADR-INVENTORY (A1T01, 2026-08-04):** historical baseline of ADR state; superseded in coverage by the actual `docs/ADR/` it inventories, but it is the ADR-governance register ⇒ A in `decisions/` (index material), with its review-date noted.

## 5. Conflicts found (flagged — nothing silently resolved)

| # | Conflict | State |
|---|---|---|
| **C-1** | `docs/V1-UAT-MASTER-01.md` (header, line ~5) cites **`V1-FINAL-GAP-AUDIT-01` (V1 STATUS: COMPLETE · UAT STATUS: READY) — no such file exists in the repository.** Closest matches: `V1-PRODUCT-COMPLETION-AUDIT.md` (completion audit) and/or `V1-HARDENING-10` (launch-gate audit whose status line is "operationally complete"). | **OPEN — needs owner adjudication** (likely an alias used during catalogue authorship). Recommended action in execution task: add a one-line alias note in the UAT area README rather than editing the catalogue's historical text. |
| **C-2** | Final UAT report is **tracked**, but the raw evidence it cites by name — `V1-UAT-B0-REPORT.md`, `V1-UAT-B0-results.jsonl`, `V1-UAT-D1-RETEST-results.jsonl`, `V1-UAT-DEFECT-001-RETEST.md`, `V1-UAT-RUN-01-results.jsonl` — and its governance doc `V1-UAT-RECOVERY-01.md` are **untracked** (the final report itself states "UAT artifacts untracked under `docs/uat-evidence/`"). Anyone cloning today cannot obtain the substantiating evidence. | **OPEN — provenance gap.** Execution task should commit these six files into the UAT evidence area unchanged (byte-for-byte). |
| **C-3** | Root `README.md` is **materially stale**: it describes the pre-V1 milestone ("customer wallet accounts, double-entry ledger, internal transfers, controlled internal deposits/withdrawals… Identity, authentication, KYC, external payment rails… remain outside this milestone") and stops at M9/P1.0. V1 reality includes customer OTP auth + PIN, agent network (CASH_IN/CASH_OUT/CASH_TO_CASH), workforce IAM with MFA bootstrap, SMS notifications, commercial engines, funding, beneficiaries, and a passed UAT. | **OPEN — rewrite proposed (§8); no reader harm yet because nothing in V1 is mis-described, it is simply absent.** |
| **C-4** | `docs/PROJECT_VISION.md` §"Scope of the current implementation" is similarly pre-V1 (does not mention agents/auth/commercial). As an aspirational vision document this may be intentional. | **OPEN — flag for owner** (recommended: keep as vision, add no scope claim updates without product-owner sign-off). |
| **C-5** | Root `roadmap.md` ("MoneyNaija Roadmap & Governance Register", W-series admin-frontend governance, incl. rules like "automated verification does not substitute for human acceptance testing") vs `docs/AUTHORITATIVE-PLATFORM-ROADMAP.md` — two artifacts both styled "authoritative roadmap", different scopes and vintages. | **OPEN — disambiguation flag.** Proposed: keep root `roadmap.md` where it is (operational register) and have the documentation index state explicitly that it is the *tasking/governance* register, while platform sequencing lives in `decisions/AUTHORITATIVE-PLATFORM-ROADMAP.md`. No content change to either. |
| **C-6** | Repo-root `uat-run-results.jsonl` (untracked) is the byte-identical ancestor of `docs/uat-evidence/V1-UAT-RUN-01-results.jsonl` (per `V1-UAT-RECOVERY-01.md`: "checkpointed … byte-identical"). | **OPEN.** Once C-2 commits the evidence copy, the root duplicate becomes a D-candidate — owner decision in execution task (recommend removal *in that task only*, or gitignore; non-docs, so no action in this audit). |
| **C-7** | Archived-candidate documents contain historical HEAD SHAs, "pushed" claims, and inter-file links of past branch states (e.g. A24 cites `48b556e`; per-phase links reference sibling docs). After `git mv`, intra-family relative links mostly still resolve (families move together into per-family archive dirs); **cross-era links will not** (e.g. README → `docs/M8-*`; ops guides → phase runbooks; ADRs → phase contracts). | **OPEN — accepted-risk + link-fix list (§7.4).** Historical claims are not defects (documents are era-truthful); only the primary path's links get repaired. |

## 6. Missing documentation (gaps in the *set*, not in facts)

1. **No documentation index exists.** "Where do I start?" currently has no answer ⇒ execution task creates `docs/README.md` (index only; content = §3 table rendered for navigation).
2. **No archive notice.** Execution task creates `docs/archive/README.md` (one short paragraph: historical development artifacts, era-labeled, not current V1 requirements; contents preserved).
3. **Root README needs a V1 rewrite** (§8) — the single most visible documentation defect.
4. Nothing else is *missing*: scope, architecture, decisions, deployment, bootstrap, pilot readiness, UAT, and operations all exist and are authoritative. Notably there is deliberately **no "V1 release notes" doc proposed** — inventing one would exceed documentation authority; the UAT final report is the acceptance statement.

## 7. Proposed final documentation architecture

Rationale: the task's target skeleton (`V1/ deployment/ uat/ decisions/ archive/`) matches the reality above almost exactly; two evidence-driven additions are made: **`operations/`** (seven still-accurate ops guides has no home otherwise) and **`foundation/`** (living standards/vision docs that are neither V1-specific nor historical). `api/` keeps the OpenAPI contract where generators/find-it-fast users expect it. UAT gets `uat/` with `uat/evidence/` so the final report sits one click from the catalogue and the raw artifacts below that.

### 7.1 Proposed tree

```
README.md                         (rewritten — §8)
roadmap.md                        (UNCHANGED at root — Arena task-governance register; disambiguated by index, C-5)
docs/
├── README.md                     (NEW — documentation index, from §3)
├── V1/                           (10 files — authoritative V1 corpus)
├── deployment/
│   ├── … (4 guides + checklist)
│   └── config/v1-workforce-bootstrap.env.template
├── uat/
│   ├── V1-UAT-MASTER-01.md
│   ├── V1-UAT-FINAL-01.md
│   └── evidence/                 (6 files — 5 currently untracked + recovery report; commit verbatim, C-2)
├── decisions/
│   ├── ADR/                      (73)
│   ├── ADR-INVENTORY.md
│   ├── AUTHORITATIVE-PLATFORM-ROADMAP.md
│   └── PLATFORM-ARTIFACT-CLASSIFICATION.md
├── operations/                   (7 guides)
├── foundation/                   (7 standards/vision docs; PROJECT_VISION + ENGINEERING_ROADMAP carry flags C-4/§9.3)
├── api/B2-OPENAPI-v1.yaml
└── archive/
    ├── README.md                 (NEW — archive notice)
    ├── a1-consolidation/         (25)
    ├── m-milestones/             (8)
    ├── p1-customer-foundation/   (10)
    ├── phases-a2-a7/             (96)
    ├── phases-b1-b2/             (48)
    ├── agent-blockers/           (4)
    └── v1-implementation/        (57)
```

### 7.2 Move map
All 356 tracked moves via `git mv` (history preserved). Detailed per-file map is Appendix A (each group line reads `N files → destination`). Summary: 106 tracked files stay authoritative (renamed into the new primary path), 248 tracked files → archive, 6 untracked UAT artifacts → `uat/evidence/` and committed verbatim, 2 docs created (`docs/README.md`, `docs/archive/README.md`), 1 root file rewritten (README), 0 deletions.

### 7.3 Files proposed to archive
248 tracked files across 7 archive subtrees (full list: Appendix A, Class B groups except UAT evidence): A1 process+synthesis (25), M-era verifications (8), P1 foundation (10), A2–A7 packages (96), B1/B2/B2F packages (48), pre-build agent blockers (4), V1 implementation lineage (57 = 54 `V1-*`/`S-FIX-01`/`SMS-V1`/`POST-V1-001` + 3 `A24–A26`).

### 7.4 Link-fix list (execution task, minimal path-only edits on the primary path)
1. `docs/V1-PILOT-READINESS-CHECKLIST-01.md` reference `docs/uat-evidence/V1-UAT-FINAL-01.md` → `docs/uat/V1-UAT-FINAL-01.md`.
2. `docs/uat/V1-UAT-FINAL-01.md` internal evidence references (`docs/uat-evidence/…`, sibling filenames) → new `uat/evidence/` paths.
3. `uat/evidence/V1-UAT-RECOVERY-01.md` self-references (e.g. `docs/uat-evidence/…`) → same retargeting. (Path-only; no narrative edits.)
4. New `docs/README.md` + rewritten root `README.md` links point at new canonical paths; the current root README's M8/M9/P1.0 links die with the rewrite (replaced, not repaired).
5. Ops-guide links to per-phase runbooks (`A2-OPERATIONAL-RECOVERY-RUNBOOK` etc.) → repoint to `archive/…` **or** annotate "(archived phase context)" — execution task may choose the least invasive option; both preserve information.
6. Archive-internal cross-era links are intentionally **not** rewritten (historical documents remain intact; archive README states that relative links reference the historical tree).

### 7.5 Consolidations: **none** (see §2 — all useful consolidation already occurred historically; duplicates do not exist).
### 7.6 Removals: **none within docs/.** Only flagged non-doc candidate: root `uat-run-results.jsonl` (C-6, owner decision).

## 8. Root README assessment and proposed V1 outline

**Assessment (§6 of the task):** accurate for its era but its *era ended* — it is development-history oriented (sections: M4/M6/M7/M8/M9/P1.0 milestone notes) and omits the entire V1 product. It must be rewritten (not restyled). Proposed outline (fact-sourced only; no invented capabilities):

1. **What MonieNaija is** — NestJS 11 + Fastify + PostgreSQL/TypeORM double-entry wallet backend for the Nigerian pilot (in-house NGN wallet ecosystem; per `V1-PRODUCT-COMPLETION-AUDIT` scope).
2. **V1 scope (what exists / what's explicitly out)** — from `V1-SCOPE-CHALLENGE-01` + UAT final §16: in = W2W transfers w/ transaction PIN, agent float CASH_IN/CASH_OUT + agent-funded/fee-free flows, cash→cash, backend funding w/ maker-checker, beneficiaries, OTP/SMS auth, receiving numbers, workforce admin w/ MFA + bootstrap, limit enforcement, commercial engines (fee-free pilot policy), notifications/inbox, capability registry. out = NIBSS/bank rails (A6 frozen), push, cards/loans/savings, aggregator self-service + 2 deferred decisions.
3. **Major capabilities** — bullets mirroring UAT catalogue families (customer/agent/auth/security/financial/commercial/admin).
4. **Architecture at a glance** — double-entry ledger as sole balance truth, outbox+idempotency, 4 principal planes, modular monolith; link `decisions/ADR/`.
5. **Develop / run locally** — keep the current README's still-valid setup + quality + migrations sections verbatim-ish (Node 22, `npm ci`, embedded-PG/compose, ≤5-suite jest batches).
6. **Deploy / operate** — link `deployment/`, `operations/`.
7. **Workforce bootstrap** — link runbook + env template.
8. **UAT status** — CONDITIONALLY PASSED summary (175/175 executable PASS, 16 BLOCKED pending environment) + links.
9. **Pilot readiness** — link checklist.
10. **Documentation index** — link `docs/README.md`; note root `roadmap.md` is the task-governance register (C-5).

## 9. Information-preservation reasoning

1. **Nothing is deleted** — the task's D class is consciously empty; every byte of history survives somewhere retrievable.
2. **Moves use `git mv`** so file history follows content; archive subtrees mirror family boundaries so co-cited files travel together.
3. **Superseded predecessors are preserved because they are *cited evidence*:** P-DEC-01 quotes H-02A/H-03 conclusions with staleness reconciliation; the decision packs quote V1-COMMERCIAL-ACCOUNTING-AUDIT-01; the final UAT report quotes the contemporaneous B0 report and recovery doc; S-FIX-01 quotes process-audit contradiction IDs. Deleting or rewriting those predecessors would destroy the citations' targets and the B0-incident provenance recorded in final report §20.
4. **Archived documents are not edited** (no silent history revision); era-truthful "HEAD/pushed" statements stay as-is; the archive README tells readers these are historical artifacts.
5. **Raw evidence is never prettified** (task §8): JSONL ledgers and md5 assertions move verbatim; the RUN-01 ledger's immutable-checkpoint md5 (`3b75282b…` per final report/recovery doc) must remain true in its new home — the execution task must re-verify md5s after moving.
6. **Conflicts are adjudicated by the owner, not by the cleanup** (C-1…C-7 above).

## 10. Final report (per task §13)

- **Documentation files inspected:** 364 (all of `docs/` tracked + untracked, `README.md`, `roadmap.md`), plus 3 documentation-adjacent harness artifacts noted.
- **Total docs:** 356 tracked `docs/` + 6 untracked `docs/` + 2 root = 364.
- **Proposed authoritative set (A):** 108 docs/ files + root `README.md` (rewritten) + root `roadmap.md` (unchanged) — listed Appendix A.
- **Proposed archive set (B):** 254 files (248 tracked → `docs/archive/`; 6 untracked UAT artifacts → `docs/uat/evidence/` + commit).
- **Proposed removals (D):** none (docs); root `uat-run-results.jsonl` flagged C-6 only.
- **Proposed consolidations (C):** none (historical consolidations already embedded; verbatim preservation chosen).
- **Conflicts found:** C-1 dangling `V1-FINAL-GAP-AUDIT-01` reference in UAT catalogue; C-2 tracked-final/untracked-evidence provenance gap; C-3 stale root README; C-4 stale PROJECT_VISION scope line; C-5 two "authoritative roadmap" artifacts; C-6 root duplicate RUN-01 JSONL; C-7 archive link rot (accepted risk with fix list).
- **Missing documentation:** docs index (proposed), archive README (proposed), V1 README (proposed rewrite). No factual gaps.
- **Proposed final tree:** §7.1.
- **Exact files created by this task:** `docs/V1-DOCUMENTATION-AUDIT-01.md` (this file) — nothing else.
- **Repository HEAD:** `0694f5bc1162ff627a6b776e62603cb16a00a65b` — **Origin HEAD:** identical (verified via `git ls-remote`) — **Working tree:** tracked clean; untracked = the six UAT artifacts + 3 harness artifacts listed above.
- **No application changes:** zero source/migration/test/config/env/secret/auth/financial/commercial/UAT-behavior modifications; audit is documentation-only.
- **Commit:** `docs: audit V1 documentation structure` — **STOP** after commit; the cleanup itself awaits the next task.

---

## Appendix A — Complete inventory (362 docs/ files, exhaustive; each file appears exactly once)

Classes: **A** keep on primary path · **B** move to archive/UAT-evidence. No file is C or D.
Basis: tree at `0694f5b` before this audit document itself was added.

### ADR directory (authoritative decision records) — 73 files — Class A → `decisions/ADR/`
- docs/ADR/ADR-0001-Architecture.md
- docs/ADR/ADR-0002-Money-Representation.md
- docs/ADR/ADR-0003-Event-Driven-Architecture.md
- docs/ADR/ADR-0004-Wallet-and-Ledger.md
- docs/ADR/ADR-0005-Independent-Reconciliation.md
- docs/ADR/ADR-0006-Controlled-Internal-Payments.md
- docs/ADR/ADR-0007-Expanded-Financial-Product-Tooling.md
- docs/ADR/ADR-0008-Operational-Resilience.md
- docs/ADR/ADR-0009-Production-Launch.md
- docs/ADR/ADR-0010-Production-Maturity.md
- docs/ADR/ADR-0011-Product-Governance.md
- docs/ADR/ADR-0012-Customer-Foundation.md
- docs/ADR/ADR-0013-Customer-Onboarding.md
- docs/ADR/ADR-0014-Customer-Eligibility.md
- docs/ADR/ADR-0015-Customer-Wallet-Provisioning.md
- docs/ADR/ADR-0016-Customer-Funding-Instruments.md
- docs/ADR/ADR-0017-Customer-Beneficiaries.md
- docs/ADR/ADR-0018-Customer-Preferences.md
- docs/ADR/ADR-0019-Customer-Authentication.md
- docs/ADR/ADR-0020-Foundation-Closure-and-Scope-Boundary.md
- docs/ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md
- docs/ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md
- docs/ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md
- docs/ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md
- docs/ADR/ADR-0031-Customer-to-Financial-Account-Identity-Binding.md
- docs/ADR/ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md
- docs/ADR/ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md
- docs/ADR/ADR-0036-Customer-Capability-Policy-Authority.md
- docs/ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md
- docs/ADR/ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md
- docs/ADR/ADR-0039-Customer-Visible-Decision-Reasons.md
- docs/ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md
- docs/ADR/ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md
- docs/ADR/ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md
- docs/ADR/ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md
- docs/ADR/ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md
- docs/ADR/ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md
- docs/ADR/ADR-0046-Pilot-Limits-Cohorts-and-Rollback.md
- docs/ADR/ADR-0047-External-Partner-Adapter-Boundary.md
- docs/ADR/ADR-0048-NIBSS-and-Bank-Integration-Isolation.md
- docs/ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md
- docs/ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md
- docs/ADR/ADR-0051-External-Funding-Instrument-Use.md
- docs/ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md
- docs/ADR/ADR-0053-Independent-External-Reconciliation.md
- docs/ADR/ADR-0054-Virtual-Account-Product-Boundary.md
- docs/ADR/ADR-0061-Commercial-Plan-Boundary.md
- docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md
- docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md
- docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md
- docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md
- docs/ADR/ADR-0066-B1-Referral-Cashback-Loyalty-Engine.md
- docs/ADR/ADR-0067-B1-Revenue-Recognition-Tax-VAT-Cost-Accounting-Engine.md
- docs/ADR/ADR-0068-B1-Commercial-Analytics-Profitability-Commercial-Reconciliation.md
- docs/ADR/ADR-0069-B1-Commercial-Governance-Data-Classification-Idempotency-Audit-Approvals-Feature-Flag.md
- docs/ADR/ADR-0074-B2-Customer-Activation-Readiness.md
- docs/ADR/ADR-0075-B2-Merchant-Agent-Activation-Readiness.md
- docs/ADR/ADR-0076-B2-Activation-Workflow.md
- docs/ADR/ADR-0077-B2-Consent-Authority.md
- docs/ADR/ADR-0078-B2-OpenAPI-Documentation.md
- docs/ADR/ADR-0079-B2-Api-Consumer-Quota-RateLimit.md
- docs/ADR/ADR-0080-B2-Webhook-Authority.md
- docs/ADR/ADR-0082-B2-Public-Api-Authentication-and-B1-Exposure.md
- docs/ADR/ADR-0083-B2-Finance-Accounting-Model-Books-Basis-and-Fiscal-Calendar.md
- docs/ADR/ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md
- docs/ADR/ADR-0085-B2-Finance-Fiscal-Year-and-Accounting-Period-Runtime.md
- docs/ADR/ADR-0086-B2-Finance-Journal-Governance-and-Controlled-A5-Posting.md
- docs/ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md
- docs/ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md
- docs/ADR/ADR-0089-B2-Finance-to-A5-Account-Mapping-Runtime.md
- docs/ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md
- docs/ADR/ADR-0091-B1-Commercial-Payment-Term-and-Invoice-Due-Date-Extension.md
- docs/ADR/ADR-0092-A2-Workforce-and-Privileged-Authentication.md

### Top-level ADR/roadmap governance — 3 files — Class A → `decisions/`
- docs/ADR-INVENTORY.md
- docs/AUTHORITATIVE-PLATFORM-ROADMAP.md
- docs/PLATFORM-ARTIFACT-CLASSIFICATION.md

### Authoritative V1 corpus — 10 files — Class A → `V1/`
- docs/A21-AGENT-APP-CONTRACT.md
- docs/A23-CUSTOMER-APP-CONTRACT.md
- docs/V1-BOOTSTRAP-AUDIT-01.md
- docs/V1-CAPABILITY-REGISTRY.md
- docs/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md
- docs/V1-COMMERCIAL-POLICY-DECISION-PACK.md
- docs/V1-END-TO-END-PROCESS-AUDIT.md
- docs/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md
- docs/V1-PRODUCT-COMPLETION-AUDIT.md
- docs/V1-SCOPE-CHALLENGE-01.md

### Deployment / pilot / bootstrap — 5 files — Class A → `deployment/`
- docs/DEPLOYMENT.md
- docs/PRODUCTION-CHECKLIST.md
- docs/V1-PILOT-READINESS-CHECKLIST-01.md
- docs/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md
- docs/config/v1-workforce-bootstrap.env.template

### UAT catalogue + final report — 2 files — Class A → `uat/`
- docs/V1-UAT-MASTER-01.md
- docs/uat-evidence/V1-UAT-FINAL-01.md

### UAT evidence (raw) — 6 files — Class B → `uat/evidence/`
- docs/V1-UAT-RECOVERY-01.md
- docs/uat-evidence/V1-UAT-B0-REPORT.md
- docs/uat-evidence/V1-UAT-B0-results.jsonl
- docs/uat-evidence/V1-UAT-D1-RETEST-results.jsonl
- docs/uat-evidence/V1-UAT-DEFECT-001-RETEST.md
- docs/uat-evidence/V1-UAT-RUN-01-results.jsonl

### Operations guides — 7 files — Class A → `operations/`
- docs/API-VERSION-GUIDE.md
- docs/DISASTER-RECOVERY.md
- docs/FINAL-ACCEPTANCE.md
- docs/MAINTENANCE.md
- docs/OPERATIONS-GUIDE.md
- docs/RETENTION-POLICY.md
- docs/RUNBOOK.md

### Foundation / standards — 7 files — Class A → `foundation/`
- docs/CODING_STANDARDS.md
- docs/CONTRIBUTING.md
- docs/ENGINEERING_ROADMAP.md
- docs/PROJECT_VISION.md
- docs/SECURITY_GUIDELINES.md
- docs/SYSTEM_ARCHITECTURE.md
- docs/TESTING_STRATEGY.md

### Public API contract asset — 1 files — Class A → `api/`
- docs/api/B2-OPENAPI-v1.yaml

### A1 consolidation process artifacts — 11 files — Class B → `archive/a1-consolidation/`
- docs/A1-ADR-REVIEW-STATUS.md
- docs/A1-ARCHITECTURE-APPROVAL-PACKAGE.md
- docs/A1-BROKEN-LINK-CORRECTION-LIST.md
- docs/A1-CONSOLIDATED-ARCHITECTURE-DECISION-MAP.md
- docs/A1-CROSS-DOCUMENT-REFERENCE-MAP.md
- docs/A1-DECISION-APPROVAL-CHECKLIST.md
- docs/A1-DECISION-LOG.md
- docs/A1-EXIT-CHECKLIST.md
- docs/A1-IMPLEMENTATION-PLAN.md
- docs/A1-OPEN-RISK-REGISTER.md
- docs/A1-STALE-TERM-CORRECTION-LIST.md

### A1 synthesis baselines — 14 files — Class B → `archive/a1-consolidation/`
- docs/ARCHITECTURE-INVENTORY.md
- docs/ARCHITECTURE-PHASE-PLAN.md
- docs/CANONICAL-OWNERSHIP-MATRIX.md
- docs/CROSS-CUTTING-CONTRACTS.md
- docs/CUSTOMER-ADJACENT-OVERLAP-REVIEW.md
- docs/DATA-HANDLING-DECISION-MATRIX.md
- docs/DEPENDENCY-GRAPH.md
- docs/IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md
- docs/IMPLEMENTATION-ORDER.md
- docs/MODULE-SCHEMA-API-INVENTORY.md
- docs/PHASES.md
- docs/PLATFORM-CUSTOMER-INVENTORY.md
- docs/RISK-COMPLIANCE-AUTHORITY-REVIEW.md
- docs/ROADMAP.md

### Milestone M-era (M3..M9) — 8 files — Class B → `archive/m-milestones/`
- docs/M3-MANUAL-VERIFICATION.md
- docs/M4-FINANCE-VERIFICATION.md
- docs/M5-MANUAL-VERIFICATION.md
- docs/M6-MANUAL-VERIFICATION.md
- docs/M7-MANUAL-VERIFICATION.md
- docs/M8-PRODUCTION-LAUNCH.md
- docs/M9-MANUAL-VERIFICATION.md
- docs/M9-PRODUCTION-MATURITY.md

### P1 customer-foundation docs — 10 files — Class B → `archive/p1-customer-foundation/`
- docs/P1.0-PRODUCT-GOVERNANCE.md
- docs/P1.10-CUSTOMER-RISK-PROFILES.md
- docs/P1.2-CUSTOMER-ONBOARDING.md
- docs/P1.3-CUSTOMER-ELIGIBILITY.md
- docs/P1.4-CUSTOMER-WALLET-PROVISIONING.md
- docs/P1.5-CUSTOMER-FUNDING-INSTRUMENTS.md
- docs/P1.6-CUSTOMER-BENEFICIARIES.md
- docs/P1.7-CUSTOMER-PREFERENCES.md
- docs/P1.8-CUSTOMER-AUTHENTICATION.md
- docs/P1.9-CUSTOMER-COMPLIANCE-CASES.md

### A2-A7 phase packages — 96 files — Class B → `archive/phases-a2-a7/`
- docs/A2-A6-PRIVACY-INPUTS.md
- docs/A2-ADR-REVIEW-STATUS.md
- docs/A2-APPROVAL-PACKAGE.md
- docs/A2-B9-WORKFORCE-IAM-HANDOFF.md
- docs/A2-ENTRY-CHECKLIST.md
- docs/A2-EXIT-CHECKLIST.md
- docs/A2-FINANCE-ROLE-ENTITLEMENT-AND-BOOTSTRAP-CONTRACT.md
- docs/A2-IMPLEMENTATION-PLAN.md
- docs/A2-INTEGRATION-TEST-MATRIX.md
- docs/A2-INTERNAL-WORKFORCE-OPERATOR-INGRESS-CONTRACT.md
- docs/A2-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/A2-PRIVILEGED-WORKFORCE-AUTHENTICATION-ARCHITECTURE-PACKAGE.md
- docs/A2-PRIVILEGED-WORKFORCE-AUTHENTICATION-DECISION-PACKAGE.md
- docs/A2-ROUTE-EXPOSURE-AND-ROLLBACK.md
- docs/A2-SECURITY-DATA-PROTECTION-CHECKLIST.md
- docs/A2-SECURITY-PRIVACY-REVIEW-STATUS.md
- docs/A2-TRUST-BOUNDARY-THREAT-MODEL.md
- docs/A2-WORKFORCE-AUTHENTICATION-AND-SESSION-CONTRACT.md
- docs/A3-A4-HANDOFF-CHECKLIST.md
- docs/A3-A4-HANDOFF-PACKAGE.md
- docs/A3-ADR-REVIEW-STATUS.md
- docs/A3-APPROVAL-PACKAGE.md
- docs/A3-BINDING-BASELINE.md
- docs/A3-BINDING-OWNERSHIP-MATRIX.md
- docs/A3-EXIT-CHECKLIST.md
- docs/A3-IMPLEMENTATION-PLAN.md
- docs/A3-INTEGRATION-MATRIX.md
- docs/A3-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/A3-ROUTE-EXPOSURE-AND-ROLLBACK.md
- docs/A3-WALLET-LEDGER-MAPPING-CONTRACT.md
- docs/A4-A5-HANDOFF-PACKAGE.md
- docs/A4-ADR-REVIEW-STATUS.md
- docs/A4-APPROVAL-PACKAGE.md
- docs/A4-CAPABILITY-INVENTORY.md
- docs/A4-CAPABILITY-PROFILE-CONTRACT.md
- docs/A4-EXIT-CHECKLIST.md
- docs/A4-IMPLEMENTATION-PLAN.md
- docs/A4-INTEGRATION-MATRIX.md
- docs/A4-NORMALIZED-EVIDENCE-SNAPSHOT.md
- docs/A4-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/A4-POLICY-BASELINE.md
- docs/A4-POLICY-CONTRACT-INPUTS.md
- docs/A4-POLICY-PERSISTENCE-CONTRACT.md
- docs/A4-POLICY-PRECEDENCE-MATRIX.md
- docs/A4-POLICY-RECOVERY-RUNBOOK.md
- docs/A4-POLICY-REQUEST-RESULT-CONTRACT.md
- docs/A4-ROUTE-EXPOSURE-AND-ROLLBACK.md
- docs/A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md
- docs/A4-SOURCE-EVIDENCE-MATRIX.md
- docs/A5-A6-HANDOFF-PACKAGE.md
- docs/A5-ADR-REVIEW-STATUS.md
- docs/A5-APPROVAL-PACKAGE.md
- docs/A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md
- docs/A5-COMMAND-CORRELATION-INPUTS.md
- docs/A5-EXIT-CHECKLIST.md
- docs/A5-IMPLEMENTATION-PLAN.md
- docs/A5-INTEGRATION-MATRIX.md
- docs/A5-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/A5-PILOT-BASELINE.md
- docs/A5-ROUTE-EXPOSURE-AND-ROLLBACK.md
- docs/A5-TRANSFER-COMMAND-CONTRACT.md
- docs/A6-A7-HANDOFF-PACKAGE.md
- docs/A6-ADR-REVIEW-STATUS.md
- docs/A6-APPROVAL-PACKAGE.md
- docs/A6-CALLBACK-INGRESS-CONTRACT.md
- docs/A6-EXIT-CHECKLIST.md
- docs/A6-EXTERNAL-DATA-CLASSIFICATION-MATRIX.md
- docs/A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md
- docs/A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md
- docs/A6-EXTERNAL-OPERATION-CONTRACT.md
- docs/A6-EXTERNAL-OPERATION-LIFECYCLE-CONTRACT.md
- docs/A6-EXTERNAL-PARTNER-BASELINE.md
- docs/A6-EXTERNAL-RECONCILIATION-CONTRACT.md
- docs/A6-IMPLEMENTATION-PLAN.md
- docs/A6-INTEGRATION-MATRIX.md
- docs/A6-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/A6-PARTNER-ADAPTER-CONTRACT.md
- docs/A6-ROUTE-EXPOSURE-AND-ROLLBACK.md
- docs/A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md
- docs/A7-A8-HANDOFF-PACKAGE.md
- docs/A7-ADR-REVIEW-STATUS.md
- docs/A7-APPROVAL-PACKAGE.md
- docs/A7-EXIT-CHECKLIST.md
- docs/A7-IMPLEMENTATION-PLAN.md
- docs/A7-INTEGRATION-MATRIX.md
- docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md
- docs/A7-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/A7-PRODUCT-CATALOG-CONTRACT.md
- docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md
- docs/A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md
- docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md
- docs/A7-PRODUCT-EXPANSION-BASELINE.md
- docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md
- docs/A7-PRODUCT-POLICY-PROFILE-CONTRACT.md
- docs/A7-PRODUCT-RECONCILIATION-CONTRACT.md
- docs/A7-ROUTE-EXPOSURE-AND-ROLLBACK.md

### Agent app pre-build blockers — 4 files — Class B → `archive/agent-blockers/`
- docs/a10-agent-blockers.md
- docs/a11-agent-blockers.md
- docs/a8-agent-blockers.md
- docs/a9-agent-blockers.md

### A24-A26 app hardening reports — 3 files — Class B → `archive/v1-implementation/`
- docs/A24-VERIFICATION-REPORT.md
- docs/A25-VERIFICATION-REPORT.md
- docs/A26-VERIFICATION-REPORT.md

### B1 commercial platform docs — 18 files — Class B → `archive/phases-b1-b2/`
- docs/B1-ADR-REVIEW-STATUS.md
- docs/B1-APPROVAL-PACKAGE.md
- docs/B1-B2-HANDOFF-PACKAGE.md
- docs/B1-BILLING-ENGINE-CONTRACT.md
- docs/B1-CAMPAIGN-ENGINE-CONTRACT.md
- docs/B1-COMMERCIAL-ANALYTICS-CONTRACT.md
- docs/B1-COMMERCIAL-CATALOG-CONTRACT.md
- docs/B1-COMMERCIAL-GOVERNANCE-CONTRACT.md
- docs/B1-COMMERCIAL-PLATFORM-BASELINE.md
- docs/B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md
- docs/B1-EXIT-CHECKLIST.md
- docs/B1-FEE-ENGINE-CONTRACT.md
- docs/B1-IMPLEMENTATION-PLAN.md
- docs/B1-INTEGRATION-MATRIX.md
- docs/B1-OPERATIONAL-RECOVERY-RUNBOOK.md
- docs/B1-REFERRAL-ENGINE-CONTRACT.md
- docs/B1-REVENUE-RECOGNITION-CONTRACT.md
- docs/B1T12-ARCHITECTURE-DECISION-PACKAGE.md

### B2 public-API / finance docs — 17 files — Class B → `archive/phases-b1-b2/`
- docs/B2-ACTIVATION-BASELINE.md
- docs/B2-API-CONSUMER-SCHEMA-RECONCILIATION.md
- docs/B2-API-CREDENTIALS-CONTRACT.md
- docs/B2-API-DOCUMENTATION-CONTRACT.md
- docs/B2-COMMERCIAL-ACTIVATION-CONTRACT.md
- docs/B2-CONSENT-CONTRACT.md
- docs/B2-CUSTOMER-ONBOARDING-CONTRACT.md
- docs/B2-FINANCE-IMPLEMENTATION-PLAN.md
- docs/B2-FINANCE-PLATFORM-BOUNDARY.md
- docs/B2-IMPLEMENTATION-PLAN.md
- docs/B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md
- docs/B2-PUBLIC-API-AUTHENTICATION-CONTRACT.md
- docs/B2-PUBLIC-API-CATALOG-CONTRACT.md
- docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md
- docs/B2-ROADMAP-RECONCILIATION-HANDOFF.md
- docs/B2-WEBHOOK-CONTRACT.md
- docs/B2-WEBHOOK-SCHEMA-RECONCILIATION.md

### B2F finance-accounting contracts — 12 files — Class B → `archive/phases-b1-b2/`
- docs/B2F-ACCOUNTING-MODEL-CONTRACT.md
- docs/B2F-ACCOUNTING-TREATMENT-CONTRACT.md
- docs/B2F-ACCOUNTS-PAYABLE-AND-DISBURSEMENT-ACCOUNTING-CONTRACT.md
- docs/B2F-ACCOUNTS-RECEIVABLE-AND-INVOICE-ACCOUNTING-CONTRACT.md
- docs/B2F-CHART-CLASSIFICATION-CONTRACT.md
- docs/B2F-FINANCE-CONTROL-CONTRACT.md
- docs/B2F-FINANCE-INVENTORY.md
- docs/B2F-FISCAL-PERIOD-CONTRACT.md
- docs/B2F-JOURNAL-GOVERNANCE-CONTRACT.md
- docs/B2F-REVENUE-TAX-COST-AND-COMMERCIAL-EFFECT-ACCOUNTING-CONTRACT.md
- docs/B2F-TASK-SEQUENCE-RECONCILIATION.md
- docs/B2F07-PREREQUISITE-WORK-PACKAGES.md

### Future-allocation architecture input — 1 files — Class B → `archive/phases-b1-b2/`
- docs/MODULAR-PROVIDER-AND-CONFIGURATION-CAPABILITY-ALLOCATION.md

### V1 implementation lineage — 54 files — Class B → `archive/v1-implementation/`
- docs/POST-V1-001-DEPENDENCY-REVIEW.md
- docs/S-FIX-01-VERIFICATION-REPORT.md
- docs/SMS-V1-VERIFICATION-REPORT.md
- docs/V1-001-VERIFICATION-REPORT.md
- docs/V1-003-VERIFICATION-REPORT.md
- docs/V1-005-VERIFICATION-REPORT.md
- docs/V1-006-VERIFICATION-REPORT.md
- docs/V1-007-VERIFICATION-REPORT.md
- docs/V1-008-DEPENDENCY-RE-AUDIT.md
- docs/V1-AGENT-CREDENTIALS-01.md
- docs/V1-CAPABILITY-REGISTRY-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-02-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-03-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-04-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-ACCOUNTING-01-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-ACCOUNTING-AUDIT-01.md
- docs/V1-COMMERCIAL-ACCOUNTING-DECISION-REVIEW-01.md
- docs/V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01.md
- docs/V1-COMMERCIAL-DECISION-01-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-DECISION-02-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-DECISION-03A-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-DECISION-03B-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-DECISION-03C-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-DECISION-03D-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-DECISION-03E-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md
- docs/V1-COMMERCIAL-IMPLEMENTATION-01-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-IMPLEMENTATION-02-VERIFICATION-REPORT.md
- docs/V1-COMMERCIAL-IMPLEMENTATION-AUDIT.md
- docs/V1-COMMISSION-01-COMMISSION-ENGINE-ARCHITECTURE.md
- docs/V1-COMMISSION-01-VERIFICATION-REPORT.md
- docs/V1-CUSTOMER-ONBOARDING-01.md
- docs/V1-CUSTOMER-ONBOARDING-02.md
- docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md
- docs/V1-CUSTOMER-ONBOARDING-DECISION-AUDIT-01.md
- docs/V1-HARDENING-01-VERIFICATION-REPORT.md
- docs/V1-HARDENING-02-VERIFICATION-REPORT.md
- docs/V1-HARDENING-02A-FEE-POLICY-DECISION.md
- docs/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md
- docs/V1-HARDENING-04-VERIFICATION-REPORT.md
- docs/V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md
- docs/V1-HARDENING-06-VERIFICATION-REPORT.md
- docs/V1-HARDENING-07-VERIFICATION-REPORT.md
- docs/V1-HARDENING-08-REMAINING-OPERATIONAL-GAPS-AUDIT.md
- docs/V1-HARDENING-09-VERIFICATION-REPORT.md
- docs/V1-LIMIT-01-VERIFICATION-REPORT.md
- docs/V1-LIMIT-02-VERIFICATION-REPORT.md
- docs/V1-LIMIT-03-VERIFICATION-REPORT.md
- docs/V1-LIMIT-04-VERIFICATION-REPORT.md
- docs/V1-LIMIT-05-VERIFICATION-REPORT.md
- docs/V1-LIMIT-06-CORRELATION-RECOVERY-AUDIT.md
- docs/V1-LIMIT-ARCHITECTURE-AUDIT.md
- docs/V1-REWARD-01-REWARD-ENGINE-ARCHITECTURE.md
- docs/V1-REWARD-01-VERIFICATION-REPORT.md
