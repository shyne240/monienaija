# Reconciled Inventory & Arena Start Instructions — Arena 5 Response 2026-11-20

**Trigger:** Phase 1 audit at `0350563d` — immediate reconciliation + coordination tasks (keep financial engine frozen).
**Branch:** `arena/1f37a4f3-monienaija` @ `0350563d` → `arena/5-main-web-audit` + `arena/5-main-web-integration` @ `0350563d`
**Application candidate:** `e9e5651d` · 166 migrations · `dist/main.js` + `dist/config/data-source.js` (`migrationsRun:false`) verified

---

## 1) Corrected inventory totals — all documents now agree

Reconciled from `apps/admin-web/src/screens/authenticated/Layout.tsx` (`sections[]`) + `navigation-access.ts` (`AdminView` union + `LEGACY_VIEW_ALIASES`) + master matrix. Where other audit docs previously disagreed, the master matrix is source of truth.

| Dimension | Corrected count | How counted | Previous error |
|---|---|---|---|
| **Sections** | **8** | `Layout.tsx` `sections[]` ids: `home`, `servicing`, `institutions`, `money`, `finance`, `commercial`, `compliance`, `platform` (comment "Seven sections" in source is stale) | Docs said 7 — was 8 |
| **Menu items** | **32** | 2+4+1+4+3+6+5+7 across 8 sections | Varied |
| **Contextual routes** | **1** | `institutionWorkspace` — no menu entry, requires `institutionId` | Correct |
| **Routable destinations** | **33** | 32 + 1 — the 33 rows in the master matrix | Correct but inconsistently stated |
| **Legacy aliases** | **9** | `ledger→ledgerExplorer`, `transactions→transfers`, `commercial→feeRules`, `compliance→kycQueue`, `riskfraud→fraudCases`, `roles→roleGovernance`, `approvals→approvalsInbox`, `workforce→workforceAccess`, `system→systemHealth` | Docs said 8 or 11 — is 9 |
| **AdminView union** | **42** | 33 canonical + 9 legacy | Docs said 40 or 38 — is 42 |
| **COMPLETE** | **21** | 21 rows in master matrix | Docs said 18 |
| **PARTIAL** | **8** | 8 rows | Docs said 10 |
| **PLACEHOLDER** | **4** | `cashIn`/`cashOut` aliases + `rewardRules` + `productCatalogue` — governed-notice | Correct |
| **BROKEN** | **0** | No endpoint missing | Correct |
| **Conceptual missing (no route)** | **8 capabilities** — not routable, not counted | See §2 — reporting/analytics, automatic POS, wallet/VA admin, aggregator admin, disputes standalone, partner callbacks, SMS/email trigger rules, policy engines | Docs mixed conceptual missing into routable totals — now separated |

**Master matrix sums:** 21 + 8 + 4 + 0 = **33** — exactly the routable destinations. Each of the 33 has exactly one primary Arena owner (see §3).

Corrected files (all pushed):
- `MAIN-WEB-NAVIGATION-AUDIT.md` — header, alias list, status summary (21/8/4/0), institutions note
- `MAIN-WEB-AUDIT-DELIVERABLES-INDEX.md` — baseline HEAD `0350563d`, 8/33/9/42, reconciled table, branch model
- `MAIN-WEB-MASTER-FUNCTIONALITY-MATRIX.md` — source-of-truth header, Menu? column, single primary Arena per row, conceptual-gaps footer
- `MAIN-WEB-BACKEND-SERVICE-MAPPING.md` — header, §3 single-owner, §4 on-route gaps, §5 new 8-row uncovered-capabilities table
- `MAIN-WEB-ARENA-OWNERSHIP-AND-INTEGRATION-RULES.md` — baseline `0350563d`, single-owner table (§1), per-arena single-owner (§2), shared-files table (8 sections, `CountrySelect` added)
- `arena-prompts/ARENA-{1,2,3,4}.md` — baselines corrected to `0350563d`, no conflicting shared-file assignments

No menu reorganization — IA preserved as-is.

---

## 2) Existing routable views vs conceptual missing — distinguished

**Existing routable (33)** — every view is a `case 'view': return <Screen>` in `Layout.tsx` with a `canAccessAdminView` guard. Four prompts cover all 33 (100% of visible menu destinations):

- Arena 1: 8 views (customers, support, kycQueue, kycProviders, kycTierPolicies, complianceCases, fraudCases, limitAssignments)
- Arena 2: 2 views (agents, agentClasses)
- Arena 3: 12 views (transfers, cashIn, cashOut, cashToCashOps, ledgerExplorer, reconciliation, bankingOperations, feeRules, commissionRules, rewardRules, productCatalogue, limitCatalogue)
- Arena 4: 8 views (dashboardSettings, workforceAccess, roleGovernance, approvalsInbox, superAdminRecovery, notifications, systemHealth, auditEvents) + dashboard collaborator
- Arena 5: 3 views (dashboard primary, institutions, institutionWorkspace contextual)

**Conceptual missing (8 backend capabilities without a management interface)** — not routable, not counted, not assigned to Arenas 1–4 for this phase; tracked in backend mapping §5 as backlog (Arena 5 owns triage, approval required for any new menu):

| # | Backend capability | Controller/module | No admin UI for | Type |
|---|---|---|---|---|
| 1 | Reporting & analytics hub | `maturity: GET /internal/reports/*` (9 reports) + `GET /health-dashboard` + `OperationalReportService` | No dashboard hub consumes maturity reports | Reporting — read-only |
| 2 | Automatic POS / terminal provisioning | `outlet: OutletController + TerminalService` (`POST /outlets/:id/terminals`, lifecycle) | No auto-provisioning / hardware binding UI | Automatic POS |
| 3 | Wallet / virtual-account admin | `wallet: WalletController, WalletOwnership*`; `virtual-account: VirtualAccountController` | No wallet/VA admin workspace | Financial ops |
| 4 | Aggregator admin | `aggregator: AdminAggregatorController` | No aggregator management UI | Operational |
| 5 | Disputes standalone | `disputes: DisputesModule` (service-only) | No dedicated tab; nested under compliance/fraud | Support |
| 6 | Partner callbacks / external settlements | `partner: PartnerCallbackController, ExternalOperationService, ExternalSettlementService` | No inspector beyond banking readiness | Financial ops |
| 7 | SMS/Email automatic trigger rules | `notification: NotificationDispatcherService + NotificationWorkerService`; `policy: A7/B1/B2 engines` (25+ engines) | No trigger-rule editor — driven by policy engines | SMS/Email |
| 8 | Policy engines workbench | `policy: A7/B1/B2/B2F engines` (analytics, billing, campaign, etc.) | No analytics/finance-control workbench; surface is `product-governance` | Reporting/Finance |

**Verdict:** Four prompts cover all agreed main-web functionality (visible menu destinations). Uncovered areas above are explicitly tracked and not silently dropped — they are backlog, not implementation gaps in the 33.

---

## 3) Every existing route has exactly one primary status + one primary owner — verified

| # | View key | Status | Arena (primary) |
|---|---|---|---|
| 1 | dashboard | COMPLETE | 5 |
| 2 | dashboardSettings | COMPLETE | 4 |
| 3 | customers | COMPLETE | 1 |
| 4 | agents | PARTIAL | 2 |
| 5 | agentClasses | COMPLETE | 2 |
| 6 | support | COMPLETE | 1 |
| 7 | institutions | COMPLETE | 5 |
| 8 | institutionWorkspace | COMPLETE | 5 |
| 9 | transfers | PARTIAL | 3 |
| 10 | cashIn | PLACEHOLDER | 3 |
| 11 | cashOut | PLACEHOLDER | 3 |
| 12 | cashToCashOps | COMPLETE | 3 |
| 13 | ledgerExplorer | PARTIAL | 3 |
| 14 | reconciliation | PARTIAL | 3 |
| 15 | bankingOperations | PARTIAL | 3 |
| 16 | feeRules | PARTIAL | 3 |
| 17 | commissionRules | PARTIAL | 3 |
| 18 | rewardRules | PLACEHOLDER | 3 |
| 19 | productCatalogue | PLACEHOLDER | 3 |
| 20 | limitCatalogue | COMPLETE | 3 |
| 21 | limitAssignments | COMPLETE | 1 |
| 22 | kycQueue | COMPLETE | 1 |
| 23 | kycProviders | COMPLETE | 1 |
| 24 | kycTierPolicies | COMPLETE | 1 |
| 25 | complianceCases | COMPLETE | 1 |
| 26 | fraudCases | PARTIAL | 1 |
| 27 | workforceAccess | COMPLETE | 4 |
| 28 | roleGovernance | COMPLETE | 4 |
| 29 | approvalsInbox | COMPLETE | 4 |
| 30 | superAdminRecovery | COMPLETE | 4 |
| 31 | notifications | COMPLETE | 4 |
| 32 | systemHealth | COMPLETE | 4 |
| 33 | auditEvents | COMPLETE | 4 |

No dual-owner rows remain. `limitAssignments` is primary Arena 1 (catalogue contract from Arena 3, read-only). `kycProviders`/`kycTierPolicies` are primary Arena 1 (Arena 4 owns *notification* provider config, distinct). Dashboard is primary Arena 5 (settings are Arena 4). Collaborators read via typed API contracts — no file co-ownership.

---

## 4) Arena 1 & 2 prompts — verification

| Check | Arena 1 | Arena 2 | Result |
|---|---|---|---|
| **Integration baseline** | `arena/1f37a4f3-monienaija @ 0350563d → arena/5-main-web-audit + arena/5-main-web-integration @ 0350563d · e9e5651d` | Same | Corrected (was `98b067bc`) |
| **Branch from** | `arena/5-main-web-audit @ 0350563d` (exists — frozen audit) → `arena/5-a1-customers-kyc` | `arena/5-main-web-audit @ 0350563d` → `arena/5-a2-agents-pos` | Correct |
| **PR into** | `arena/5-main-web-integration @ 0350563d` | Same | Correct |
| **Views owned** | 8 (exact §3 rows) | 2 (exact §3 rows) | No overlap, no gap |
| **Shared files assigned** | `kyc-governance-api.ts` primary (correct — KYC routing is 1, notification provider is 4); `institution-admin-api.ts` read-only consumer (Arena 5 owned); `CountrySelect.tsx` removed from owned → prohibited | `ordinary-agent-admin-api.ts` primary; same read-only consumer note; `CountrySelect.tsx` prohibited in both | No conflict — verified via `git diff --name-only` guard in both prompts |
| **Prohibited lists** | Layout, navigation-access, api-client, auth-store, institution-admin-api, CountrySelect, config, tokens + Arena 2/3/4 screens + financial engine | Same plus Kyc*, LimitAssignment (Arena 1 primary), Ledger/Reconciliation/Commercial (Arena 3), Notification (Arena 4) | Disjoint owned sets |
| **All 33 covered** | Together with Arenas 3+4+5, 33/33 covered | Same | Verified — see §5 of backend mapping |

---

## 5) Four prompts cover all agreed main-web functionality — confirmed

- **Visible menu destinations:** 32 menu items + 1 contextual = 33 routable — 100% mapped to a primary Arena across the four prompts + Arena 5 shell.
- **Backend capabilities without UI (automatic POS, SMS, email, support, financial operations, reporting):** 8 capabilities listed in §2 above — all identified, documented in backend mapping §5, and flagged as backlog not omission. Arenas 1–4 are not to duplicate this work without Arena 5 approval and a new route.
- **Master functionality matrix remains source of truth** — reconciled 21/8/4/0, 33 rows, 8 sections, single-owner invariant enforced. Other docs defer to it.

---

## 6) Confirmed Arena 1 & 2 start instructions

**Arenas 1 & 2 may start immediately — no dependency. Do not duplicate each other's implementation work.**

```bash
# 1 — fetch and verify baseline
git fetch origin
git checkout arena/5-main-web-audit
git log --oneline -1  # must be 0350563d — reconciled audit with 8/33/9/42 and 21/8/4/0

# 2 — create arena branch
# Arena 1:
git checkout -b arena/5-a1-customers-kyc
# Arena 2:
git checkout -b arena/5-a2-agents-pos

# 3 — implement OWNED files only (see ARENA-1/2 prompt §3; prohibited in §4)
# Arena 1: 13 files (Customer*, SupportTickets, Compliance/Kyc*, RiskFraud, LimitAssignment + services)
# Arena 2: 7 files (AgentNetwork, AgentClasses, 5 Agent* panels + ordinary-agent-admin-api)

# 4 — acceptance: all screens COMPLETE (no mock money, real pagination/filters, loading/empty/error/permission states)
# See ARENA-* prompt §6 for per-view acceptance checklist

# 5 — verify before PR (must pass)
npm run --prefix apps/admin-web test -- --watchAll=false
# 87 suites 880 tests expected — plus your new __tests__/a1-*.test.tsx or a2-*.test.tsx
git diff --name-only origin/arena/5-main-web-audit | grep -E "^(apps/admin-web/src/screens/authenticated/Layout\.tsx|apps/admin-web/src/screens/authenticated/navigation-access\.ts|apps/admin-web/src/services/api-client\.ts|apps/admin-web/src/services/institution-admin-api\.ts|apps/admin-web/src/components/CountrySelect\.tsx|src/(ledger|reconciliation|commercial-accounting|banking|transfer)/)" && echo "BLOCKED — needs Arena 5 approval" || echo "OK — no violation"

# 6 — PR
gh pr create --base arena/5-main-web-integration --title "Arena 1: customers/KYC/support — COMPLETE" \
  --body "Files | Routes | Endpoints | Guards | Tests | Evidence | Regression — see ARENA-1 prompt §6"
# Arena 2 title: "Arena 2: agents/POS — COMPLETE"

# 7 — Arena 5 review gate
# Arena 5 reviews only when independent acceptance tests pass; verifies no menu reorganization, no financial-engine change, no frozen-branch mutation; integrates via controlled merge.
```

**Rules while Arenas 1 & 2 run:**
- Do not edit `Layout.tsx` sections, `navigation-access.ts` guards, `api-client.ts`, `auth-store.ts`, `institution-admin-api.ts`, `CountrySelect.tsx` — all Arena 5.
- Do not cross-edit the other Arena's owned screens — read via API contracts only.
- Do not merge into `main` or modify `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`.
- Keep financial engine frozen — funding reads are OK, ledger balance arithmetic is not.

Questions or blocked-by-shared-file → file issue against `arena/5-main-web-audit` for Arena 5 triage.
