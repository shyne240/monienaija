# ARENA 3 — Customer and Agent Commercial API Capability Audit

**Repository:** `shyne240/monienaija`
**Branch:** `arena/defdd0fd-monienaija`
**Audited commit:** `6816a760bd460df2a5347016d7d84f5c62cab642` (working tree clean at audit time)
**Audit date:** 2026-11-16
**Type:** read-only capability audit. **No application code, migration, configuration or navigation was changed. The only artefact produced is this document.**

---

## 0. Method, evidence rules and limits of this audit

### 0.1 What was inspected

| Surface | Volume inspected |
| --- | --- |
| TypeScript source | 1,286 files under `src/` |
| Controllers / routes | 114 controllers, **624 route handlers** (290 GET, 286 POST, 38 PATCH, 9 DELETE, 1 PUT) enumerated mechanically |
| Persistence | 161 timestamped migrations under `src/migrations/` |
| Tests | 462 `*.spec.ts`/`*.test.ts` files under `test/` (I ran a 3-suite, 35-test unit subset at HEAD; see §12.2) |
| Admin console | 80 TS/TSX files under `apps/admin-web/src/` — 58 TSX components, of which 38 are authenticated screens — navigation in `Layout.tsx` |
| Planning documents | `docs/**` (2,633 files) — read for intent only; **never** treated as proof of implementation |

### 0.2 Evidence rules used in this document

1. **Source-first.** Every implemented claim cites a file (and line where useful). A statement is only "implemented" if a controller/service/entity/query demonstrates it.
2. **Reachability matters.** A service that exists but is called by nothing (or only by its own controller/tests) is recorded as *defined*, not *operational*. Wiring was traced by import + call-site grep, not by module registration.
3. **Config-gated means off.** Several capabilities are complete but inert without an explicit environment flag; those are recorded as *implemented but not activated*, with the exact flag and default.
4. **Vocabulary is not capability.** A column, enum value or JSONB slot is recorded as *defined only* unless a code path reads it and a flow enforces it.
5. **Tests are corroboration, not proof** (§12.2). Passing unit tests prove arithmetic and branch behaviour, not end-to-end financial effect.

### 0.3 Verification performed

- Mechanical extraction of all 624 routes (`@Controller` prefix, method, path, line, handler) from every `*.controller.ts`.
- Import/call-site tracing for: `FeeEngine`, `LimitEngine`, `FeeRuleResolverService`, `FeeRuleCalculatorService`, `LimitEnforcementService`, `LimitProfileResolverService`, `CommissionEngine`, `RewardEngine`, `CommercialDecisionSnapshotService`, `CommercialAccountingService`, `CustomerEligibilityService`, `AgentServiceCapabilityService`, `BankingFeeBindingService`.
- Enum/CHECK-constraint/entity inventory for every commercial table.
- Route-policy inspection in `src/authorization/route-policy-registry.ts` for commercial families; function-code inspection in controllers and the governed-action registry.
- Admin-console endpoint inspection per screen (`apps/admin-web/src/**`), including which screens mutate vs read only.
- Targeted test execution at HEAD (3 suites / 35 tests — §12.2).

### 0.4 What this audit does **not** establish

- No PostgreSQL integration suite was executed for this audit (the environment has no disposable cluster available in-session); integration specs are cited as **existing evidence**, not as re-verified evidence.
- No request was made against a running deployment; no provider (Monnify, Dojah, NIBSS) sandbox was called.
- No claim is made about legal applicability of any tax, levy or regulatory ceiling. Code support for a computation is not a legal opinion.
- Admin-console coverage was assessed by reading source; the console was not driven in a browser for this audit.

---

## 1. Executive summary

### 1.1 What already exists (verified in source)

A genuinely layered commercial stack, built bottom-up and mostly **not yet switched on**:

- **A product identity catalogue** (`products`, 7 seeded V1 codes) — `src/product-catalog/`.
- **A limit catalogue** with 11 dimensions, 5 assignment scopes, precedence, effective windows, Lagos-anchored windows, atomic reservation/usage accounting, and **live enforcement** in six financial paths — `src/limit-catalog/`.
- **A KYC tier engine** with two-layer (regulatory + operator) all-of/any-of evidence rules per tier, verified-provider provenance, an evidence reader bound to consent/session/claim/identity-revision, maker-checker policy publishing, a background re-evaluation worker (upgrade *and* downgrade), and a transactional financial-eligibility gate — `src/kyc-verification/`.
- **An institution-scoped KYC-tier → limit-profile mapping** with maker/checker approval and a profile digest that invalidates the binding if the profile changes underneath it — `src/limit-catalog/institution-kyc-limit-policy.service.ts`.
- **A fee rule registry + resolver + calculator** (flat, percentage, flat+percentage, min/max clamps, optional VAT bps, effective windows, priority, fail-closed ambiguity) wired into four flows — `src/fee-rules/`.
- **A commission engine** (AGENT / AGGREGATOR / PLATFORM recipients; PRINCIPAL / FEE / NET bases; 7 calculation models including marginal TIERED; min/max caps; agent/agent-class/aggregator targeting) wired into four flows — `src/commission/`.
- **A reward/cashback rule registry + engine** (CUSTOMER / AGENT beneficiaries; CASHBACK / BONUS / PROMOTION grant types; KYC-level and campaign targeting) that is **deliberately not wired to any flow** — `src/reward/`.
- **Commercial decision snapshots** recording fee/commission/reward/limit evidence per financial transaction — `src/commercial-decision/`.
- **Commercial accounting posting** (fee revenue, VAT payable, commission expense, commission payable / agent-wallet netting) behind a master switch — `src/commercial-accounting/`.
- **Maker/checker governance** for fee, commission, reward and product rules (FINANCE_PREPARER → FINANCE_CONTROLLER, MFA, self-approval prohibited, fingerprint-bound, single consumption), plus separate proposal flows for KYC tier policy, KYC provider routing, institution tier-limit policy and notification provider configuration.
- **Agent classes** with `applicable_services` enforced as a capability gate, and a full agent funding/defunding maker-checker with limits.
- **An institution domain** (registration → evidence → approval lifecycle, agent affiliation, customer enrolment, wallet attribution, institution-scoped ledger accounts).

### 1.2 What works financially end to end today (default configuration)

Only two of the six commercial dimensions are financially live by default: **limits** (enforced, reserved, committed/released) and **commission/fee *evidence*** (computed and snapshotted). Concretely, with the shipped defaults:

| Dimension | Default posture (flag default in `src/config/environment.ts`) | Financial effect |
| --- | --- | --- |
| Limits | **ON** (no flag; always evaluated on wired paths) | Amounts are checked, reserved, committed; transactions are refused on breach |
| Fees | Computed, **not charged** — `COMMERCIAL_ACCOUNTING_ENABLED` defaults **false** (`environment.ts:113`) | `transfers.fee_minor` stays `0`; journals are principal-only |
| VAT | Computed as a fee component; **not charged** | Same gate as fees |
| Commissions | Computed, **not posted** | Snapshot evidence only |
| Rewards / cashback | **Not computed at all** (no flow calls the engine) | Nothing |
| Customer classes | **Do not exist** | Nothing |

So the honest statement is: **no customer fee, VAT amount or commission is currently collected or paid on any V1 flow under default configuration.** The machinery to do so is built and gated, not merely sketched.

### 1.3 What exists but is not activated

- **All** fee/VAT/commission ledger posting — one master switch (`COMMERCIAL_ACCOUNTING_ENABLED`), plus mandatory explicit VAT treatment and commission treatment/timing (`COMMERCIAL_ACCOUNTING_VAT_TREATMENT`, `COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT`, `COMMERCIAL_COMMISSION_RECOGNITION_TIMING`).
- **KYC tier-bound admission** — `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` defaults false; in the `production` profile a customer flow that requests tier policy enforcement **fails closed** until it is enabled (`limit-enforcement.service.ts:129-144`).
- **KYC provider live verification** — `KYC_CUSTOMER_VERIFICATION_ENABLED`, `KYC_PROVIDER_LIVE_CALLS_ENABLED`, `MONNIFY_VERIFICATION_ENABLED`, `DOJAH_VERIFICATION_ENABLED` all default false.
- **Reward/cashback engine** — built, never called by a flow.
- **Bank outbound fee binding** — built and tested, **no production call site** (§5.6).
- **A7 virtual-account inbound funding** — admission and execution authorities are registered as `Unavailable…` stubs, so the path fails closed by design (§10.10).

### 1.4 What is missing

- **Customer classes of service** in any form — no entity, table, service, route or migration (independently confirmed against source; see §3).
- **Any customer-specific, class-specific or institution-specific pricing** for fees — `fee_rules` is keyed on `(product_code, currency, effective_from)` only.
- **Tiered/progressive fees** — the fee calculator has four models and no brackets (commission and reward *do* have marginal tiers).
- **Aggregator commission at runtime** — rules can target `AGGREGATOR`, but every flow passes `aggregatorId: null` and accounting actively refuses AGGREGATOR allocations.
- **Tax beyond VAT**: no tax rule table, no jurisdiction/rate catalogue, no exemptions, no tax reporting, no filing or remittance workflow, no withholding/excise implementation.
- **Commission settlement rail** — accrual is recorded with `ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED`; nothing pays an agent commission out.
- **Cashback crediting, expiry, clawback and abuse controls** — none.
- **Bank transfer, bill payment, airtime, cards, POS transactions** — no flow exists (capability registry marks them `PLANNED`; no controller exists).
- **A general maker-checker approval inbox** — there is no list endpoint for pending approvals (§9.8).
- **Maker-checker for limit catalogue mutations** — deliberately ungoverned pending P1 (`governed-action.registry.ts:101-108`).
- **Customer class-based eligibility enforcement** — `customer_operating_permissions`, `customer_restrictions` and `customer_product_enrollments` are administrable but **read by no transaction path**.

### 1.5 What can be exposed through the admin console without rebuilding the backend

Everything in §15 (Deliverable D) marked *API-ready*. The high-value, zero-backend items:

1. **Rule authoring for fees, commissions, rewards and products** — the governed create/modify/execute endpoints exist; the console screen is **read-only** today (`CommercialRulesScreen.tsx:142` "The catalogue is read-only").
2. **Effective-configuration preview** — read-only resolver endpoints already exist: `GET /internal/fee-rules/resolve`, `GET /internal/commission-rules/resolve`, `GET /internal/reward-rules/resolve`, plus `POST /limits/evaluate` and `POST /fees/calculate`.
3. **Institution KYC-tier limit policy editor** — full propose/approve/view API (`/internal/institutions/:id/kyc-tier-limit-policy/*`), **no console screen**.
4. **Limit catalogue authoring** (profiles + rules) — API exists; console exposes a read-only tab plus a separate assignment screen.
5. **Commercial decision snapshot explorer** — `GET /internal/commercial-decision-snapshots` exists, no screen.
6. **KYC tier review queue** — `GET /internal/kyc/tier-reviews` exists and a "KYC reviews" nav item exists, but the review actions (approve/reject assessment) are not surfaced as a queue workflow in the commercial catalogue area.

### 1.6 What requires product-owner decisions

Consolidated in §14 (Deliverable E) and §16.8. The decision-critical ones: whether customer classes are needed as a real entity; whether class/institution-specific pricing is required (and therefore whether `fee_rules` needs new targeting dimensions); the VAT rate and treatment; whether commission is accrued or netted, and with what rail; whether rewards launch at all; whether limit edits become maker-checker governed; and how pending approvals are to be discovered.

---

## 2. Scope 1 — Customer KYC and eligibility

### 2.1 Tier model

Three assessed tiers plus an unassessed state (`src/kyc-verification/kyc-tier-decision.ts:15`):

```
TierLevel = 'NONE' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3'
TIER_EVIDENCE_TYPES = BVN, NIN, PHONE, BIOMETRIC, ADDRESS, ADDRESS_VERIFICATION,
  UTILITY_BILL, GPS, IDENTITY_DOCUMENT, DATE_OF_BIRTH, OCCUPATION, SOURCE_OF_FUNDS,
  SOURCE_OF_WEALTH, BUSINESS_PURPOSE, PEP_SCREENING, SANCTIONS_SCREENING,
  CUSTOMER_RISK_ASSESSMENT, ENHANCED_DUE_DILIGENCE          (kyc-tier-decision.ts:5-23)
```

Tiers are not "levels of a profile" — they are computed from evidence against an approved, effective policy.

### 2.2 Two-layer tier policy with a hard identity floor

`TierDecisionPolicy` carries **two independent requirement sets** per tier — `regulatory` and `operator` — each expressed as `{ all: EvidenceType[], any: EvidenceType[][] }`, plus a mandatory `regulatoryRequirementsConfirmed: true` sign-off (`kyc-tier-decision.ts:40-52`).

- **Composition:** a tier is met only if *both* layers' `all` lists are fully present and every `any` group has at least one member (`decideTier`, `kyc-tier-decision.ts:156-277`).
- **Hard floor outside policy:** `LEVEL_1` requires `BVN` **or** `NIN`; `LEVEL_2` requires **both** (`kyc-tier-decision.ts:249-252`). Policy cannot lower that.
- **Tier 3 extra-requirement rule:** a Tier 3 rule must require at least one non-BVN/NIN evidence item on *every* satisfying path (`tier3HasAdditionalRequirement`, `kyc-tier-decision.ts:126-140`). An `any` group that mixes BVN/NIN with an extra code does not qualify, because it could be satisfied by identity alone. Legacy two-tier policies normalise to empty Level 3 requirements, which leaves Level 3 **unavailable** until a policy with a real extra requirement is published.
- **Provenance:** evidence is `VERIFIED_PROVIDER | AUTHORIZED_REVIEW | SYNTHETIC`; `SYNTHETIC` items are filtered out of every decision (`kyc-tier-decision.ts:225-228`).
- **Contradiction handling:** a `REVIEW` item, or a `REJECTED` item of a type that also has usable verified evidence, forces `REVIEW` (`kyc-tier-decision.ts:230-236`). Invalid identity revision, expired evidence, or evidence bound to a different customer/revision forces `REVIEW`.
- **Decision statuses:** `NOT_CONFIGURED` (no approved/effective/in-window policy), `PENDING`, `REVIEW`, `ELIGIBLE` with `highestTier` and a deterministic minimal set of supporting evidence ids.

### 2.3 Policy publication and governance

`KycTierPolicyService` (`src/kyc-verification/kyc-tier-policy.service.ts`):

| Aspect | Implementation |
| --- | --- |
| Validation | `validateTierPolicyDefinition()` (L33-100): exact key set, canonical ISO timestamps, per-tier requirement validation, and a dry-run `decideTier` that must not return `NOT_CONFIGURED` |
| Lifecycle | proposals table, `state ∈ REQUESTED / APPROVED / REJECTED`, `expected_version` optimistic binding to the live head (L202-245) |
| Maker | function `kyc.policy.propose`, role `SUPER_ADMIN`, MFA, non-read-only session |
| Checker | function `kyc.policy.approve`, role `COMPLIANCE`, MFA; separate `kyc.policy.view` |
| Replay safety | proposal replay with identical definition returns `replay: true`; any drift raises `CONFLICT` |
| Effective window | per policy version (`effectiveFrom`, `effectiveUntil`); a policy not yet effective yields `NOT_CONFIGURED` at decision time |
| HTTP surface | `GET /internal/kyc/tier-policies`, `GET …/proposals`, `POST …/proposals`, `POST …/proposals/:id/approve` and `…/reject` |

### 2.4 Verified evidence read path

`KycTierEvidenceReader.read()` (`src/kyc-verification/kyc-tier-evidence.reader.ts:26-83`) admits only evidence that is simultaneously bound to:

- the customer's current monotonic `kyc_customer_identity_revisions` row (`FOR SHARE`),
- a live, non-withdrawn, unexpired `kyc_consents` row for the same actor/kind/provider/route version,
- an owning `authentication_sessions` row with audience `customer-api` or `customer-onboarding`,
- a `kyc_identity_claims` row for the same attempt,
- a provider in `('MONNIFY','DOJAH')` with a non-null `provider_route_version`.

Historical attempts without a revision, synthetic registration attempts, caller-supplied evidence and raw provider payloads are excluded by the SQL itself.

### 2.5 Customer verification (front door)

- Provider adapters exist for **Monnify** and **Dojah** (`monnify-kyc.provider.ts`, `dojah-kyc.provider.ts`, `dojah-assurance-kyc.provider.ts`), selected through `selectKycProvider()` which performs **no fallback** after failure or ambiguity (`kyc-provider-router.ts`).
- Routing is governed: `internal/kyc/providers` proposals (propose/approve/reject) + running history (`kyc-provider-governance.controller.ts`).
- Attempt lifecycle: `DISPATCHING → MATCH | REVIEW | UNKNOWN | CONSENT_WITHDRAWN | EXPIRED`; consents carry a validity window; attempts carry a policy snapshot and evidence validity.
- **Defaults are off:** `KYC_CUSTOMER_VERIFICATION_ENABLED=false`, `KYC_PROVIDER_LIVE_CALLS_ENABLED=false`, `MONNIFY_VERIFICATION_ENABLED=false`, `DOJAH_VERIFICATION_ENABLED=false` (`src/config/environment.ts:176-227`). A registration "simulation"/synthetic path exists for onboarding (`customers/registration-sessions/synthetic-*`) and is explicitly excluded from tier decisions.

### 2.6 Tier upgrades and downgrades

- **Automatic**: `KycTierWorker` (`kyc-tier-worker.service.ts`) runs on an interval (default 30s, `KYC_TIER_WORKER_ENABLED` on unless `NODE_ENV=test`), enqueues refreshes when evidence/consents/assessments expire, and enqueues re-evaluation whenever the **policy version changes** so a new policy re-decides every customer. It then calls `KycTierTransitionService.processBatch()`.
- **Transition planning** is a pure function: `planTierTransition()` (`kyc-tier-decision.ts:290-327`) returns `PROPOSE_TRANSITION` with `direction: UPGRADE | DOWNGRADE` (rank comparison), `NO_CHANGE`, or `HOLD_FOR_REVIEW` (legacy assessment, non-actionable decision, invalid candidate).
- **Downgrades are real**: a new assessment replaces the current one; expiry events re-evaluate and can lower the tier.
- **Manual/administrative**: `administrativeAssessment()` (`kyc-tier-transition.service.ts:82-197`) requires `kyc.approve` / `kyc.reject` / `kyc.review`, MFA, a non-read-only session, and writes an audit record; `kyc_tier_manual_holds` can block eligibility entirely.
- **Review surface**: `GET /internal/kyc/tier-reviews` lists held customers with reasons (`kyc-tier-transition.service.ts:35-63`).

### 2.7 Financial eligibility gate (transactional)

`CustomerFinancialEligibilityService.require()` (`src/kyc-verification/customer-financial-eligibility.service.ts:19-105`) — called *inside* the financial transaction for tier-bound admission — refuses unless **all** hold:

`customers.status = ACTIVE` (or DRAFT/ACTIVE/SUSPENDED when `requireActive=false`), not deleted, not synthetic; `kyc_status = APPROVED`; `kyc_level ∈ LEVEL_1..3`; an approved **effective** policy exists; no `kyc_tier_manual_holds`; no `kyc_identity_conflicts`; exactly one verified primary phone; a trusted evidence snapshot is available; `decideTier()` re-run in-transaction still reaches at least the approved level; exactly one current approved, unexpired `customer_kyc_assessments` row matching that level.

### 2.8 Customer account statuses and restrictions

| Dimension | Values | Source |
| --- | --- | --- |
| Customer lifecycle | `DRAFT, ACTIVE, SUSPENDED, CLOSED` | `src/customer/customer.enums.ts:6-11` |
| KYC status | `NOT_STARTED, PENDING, APPROVED, REJECTED` | same, L17-22 |
| KYC level | `NONE, LEVEL_1..3` | same, L13-18 |
| Eligibility record | `PENDING, ELIGIBLE, INELIGIBLE, SUSPENDED, REVOKED` | `src/customer-eligibility/customer-eligibility.enums.ts:1-7` |
| Operating permission types | `DEPOSIT, WITHDRAW, TRANSFER, PAYMENT, BILL_PAYMENT, AIRTIME, CARD, VIRTUAL_ACCOUNT, QR_PAYMENT, USSD, API` | same, L16-28 |
| Restriction types | `NONE, LIMITED, MANUAL_REVIEW, FROZEN, BLACKLISTED` | same, L30-36 |

**Important:** the eligibility/permission/restriction records are administrable via `POST /customers/:id/permission|restriction|eligibility` but are **not consulted by the transaction path**. Their only consumers are `CustomerWalletService` (eligibility status for wallet operations) and the A4 capability-policy evidence readers (`src/policy/capability-policy-source-readers.ts:88-260`). A `FROZEN` restriction does not block a transfer today. This is classified in §14 as *defined but not financially operational*.

### 2.9 Institution-specific policies

Two distinct institution mechanisms exist:

1. **Institution KYC tier → limit profile policy** (`institution-kyc-limit-policy.service.ts`): a maker/checker-governed, versioned, effective-dated mapping keyed on `(product, currency, serviceClass|null, tier)` → either a `profileCode` (bound to a **profile digest** over the profile and its product/currency rules) or an explicit `NOT_APPLICABLE` decision. `resolveWithManager()` (L422-500) is the runtime lookup used by `LimitEnforcementService`. If the underlying limit profile changes through the generic limit editor, the digest no longer matches and admission stops until a fresh policy is approved (documented in the class header, L86-95).
2. **Institution enrolment eligibility** (`CustomerInstitutionEnrolmentStatus`, `InstitutionFinancialEligibility = PENDING_KYC | ELIGIBLE | RESTRICTED`) — deliberately separate from global KYC level: "a globally verified customer is NOT automatically financially eligible at an institution" (`src/institution/institution.enums.ts`).

**No institution-specific pricing, fee, tax or commission dimension exists anywhere** (§5.5, §6.5, §7.9).

---

## 3. Scope 2 — Customer classes of service

### 3.1 Finding: customer classes do not exist

An exhaustive search returns **no** customer-class entity, table, service, controller, route, migration, DTO or enum:

```
grep -rin "customerclass|customer_class|classOfService|class-of-service" src  → 0 hits
grep -rn "@Entity" src/customer* ...                                          → no class entity
```

The only `*Class*` construct in the domain is `AgentClass` (`src/agent/agent-class.entity.ts`), which applies to **agents**, not customers.

### 3.2 The five things that resemble a class, and what each actually is

| Candidate | What it really is | Assignment | Enforced at runtime? | Pricing/limits effect |
| --- | --- | --- | --- | --- |
| **KYC tier** (`LEVEL_1..3`) | Evidence-derived verification level | Automatic (worker) + administrative | **Yes** — eligibility gate, tier-bound limits | Indirect: tier → limit profile via institution policy. No price effect. |
| **Limit profile + assignment** (`GLOBAL / SEGMENT / AGENT_CLASS / CUSTOMER / AGENT`) | Limit configuration targeting | Manual, per subject, with precedence + effective window | **Yes** (`enforceWithManager`) | Limits only |
| **Segment code** (`limit_assignments.segment_code`) | **Free-text string**, pattern `^[A-Z0-9_]{3,80}$`, with no catalogue table | Manual | **No** — see below | None today |
| **Customer product enrolment** (`customer_product_enrollments`) | CRUD product-entitlement record | Manual | **No** | None |
| **Operating permissions + restrictions** (`customer_operating_permissions`, `customer_restrictions`) | CRUD permission/restriction records | Manual | **No** (only wallet + policy evidence) | None |

**Segment matching is inert by construction.** `LimitProfileResolverService.resolve()` supports `SEGMENT` subjects only when the caller supplies `segmentCodes` (`limit-profile-resolver.service.ts:25-108`); `LimitEnforcementService` forwards `input.segmentCodes ?? []` (`limit-enforcement.service.ts:212`) and **no financial flow supplies it**:

```
grep -rn "segmentCodes" src | grep -v limit-catalog   → 0 call sites
```

A `SEGMENT` assignment therefore never matches at runtime. It is a defined-but-unreachable targeting dimension.

### 3.3 Answers to the specific sub-questions

| Question | Answer | Evidence |
| --- | --- | --- |
| Default classes | **None.** No default class exists because no class exists. | §3.1 |
| Custom classes | **None.** | §3.1 |
| Class eligibility | Model exists only for KYC tiers and product enrolment; neither is a class. | `kyc-tier-decision.ts`, `customer-product-enrollment.entity.ts` |
| Class assignment | Not applicable. Nearest: limit assignment (by customer id) and KYC tier. | `limit-assignment.service.ts` |
| Class switching | Not applicable. Tier changes are the only lifecycle that resembles switching (worker + administrative assessment). | `kyc-tier-transition.service.ts` |
| Class-based permissions | Not applicable. Operating permissions are per-customer flags, not class-derived, and are not enforced. | `customer-operating-permission.entity.ts` |
| Class-specific pricing | **Does not exist.** Fee rules are product+currency only. | `fee-rule.entity.ts:82-95` |
| Class-specific limits | Only **agent**-class limits (`AGENT_CLASS` assignment subject) and KYC-tier limits. No customer-class limits. | `limit-catalog.enums.ts:78-84` |
| Activation/deactivation | Profiles and rules have `is_active`/`status`/`effective_to`; assignments have `is_active`/effective windows. No class object to activate. | `limit-profile.entity.ts`, `limit-rule.entity.ts` |
| Versioning and governance | Limit profiles/rules/assignments are version-checked and audited but **not maker-checker governed**. KYC tier policy is proposal-governed. | §9 |

### 3.4 Corroboration (not relied upon as proof)

The repository's own administrative-blueprint documents reach the same conclusion from UI sources: "**A customer class editor is not established in current admin source**… Treat a unified customer-class editor as a proposed capability requiring business and backend review" (`docs/admin-one/restructuring/BLUEPRINT.md:10`), and "No operational Customer Class of Service system… was identified" (`docs/admin-one/customer-lifecycle/PRODUCT-OWNER-REPORT.md:34`). This audit confirms it independently from source, including the backend.

### 3.5 Practical consequence

Any "customer class" the product owner wants must be **designed**, not merely exposed. If classes are to carry **pricing** or **limits**, the current fee model cannot express it without new targeting dimensions on `fee_rules` (or a new pricing layer), because fee resolution keys on product + currency only. See §16.4 for the two design options.

---

## 4. Scope 3 — Agent classes and commercial configuration

### 4.1 Agent class definitions

`AgentClass` (`src/agent/agent-class.entity.ts`): `reference` (unique), `code` (unique), `name`, `description`, `is_active`, and four **operator-authored JSONB** fields with no schema:

| Field | Meaning per code comment | Read by runtime? |
| --- | --- | --- |
| `requirements` | Free-form class requirements | **No** |
| `required_information` | Required information set | **No** |
| `required_document_categories` | Required document categories | **No** |
| `applicable_services` | Canonical agent service codes | **Yes** — capability gate |
| `applicable_limits` | "Applicable limits" | **Returned as evidence only; never evaluated** |

The service is explicit that it invents no business defaults: "requirements/services/limits are configurable but have no business default… downstream policy must treat missing limits as 'no permission' rather than defaulting to an arbitrary limit" (`agent-class.service.ts:74-79`).

### 4.2 Default class

There is **no default agent class**. `agents.agent_class_id` is nullable (`agent.entity.ts:29`), `agent_applications.agent_class_id` is **NOT NULL** and the application service validates that the referenced class exists (`agent-application.service.ts:71-99`). In practice: an agent is always onboarded *through an application that names a class*, and activation copies it (`agent-application.service.ts:340`). Any agent row with a null class (legacy/manual) will fail every capability evaluation with `MISSING_AGENT_CLASS`.

### 4.3 Onboarding assignment and class changes

- **Assignment at onboarding:** `POST agents/applications` (public) and `PATCH agents/applications/:id` accept `agentClassId`; `POST internal/agents/applications/:id/approve` then `POST internal/agents/:id/activate` (or `activateFromApplication`) create the agent with that class.
- **Class change after activation: none.** No route or service mutates `agent_class_id` on an existing agent. `AgentClassAssignmentPanel.tsx` exists in the console but contains no network calls (it is a display/draft component over data supplied by its parent), and `grep` finds no `assignClass`/`updateClass` implementation. **Changing an agent's class currently requires no supported path** — this is a real gap for a commercial configuration programme.

### 4.4 Agent permissions and capabilities

`AgentServiceCapabilityService.evaluate()` (`src/agent/agent-service-capability.service.ts:36-330`) is a fail-closed gate with an explicit reason vocabulary:

`AGENT_NOT_FOUND, AGENT_DELETED, AGENT_PENDING, AGENT_SUSPENDED, AGENT_TERMINATED, AGENT_NOT_ACTIVE, MISSING_AGENT_CLASS, AGENT_CLASS_NOT_FOUND, AGENT_CLASS_DELETED, AGENT_CLASS_INACTIVE, EMPTY_APPLICABLE_SERVICES, MALFORMED_APPLICABLE_SERVICES, UNKNOWN_SERVICE, SERVICE_NOT_PERMITTED, PRINCIPAL_NOT_AGENT, PRINCIPAL_MISMATCH, WORKFORCE_NOT_PERMITTED, INVALID_AGENT_ID, INVALID_SERVICE`

Canonical agent service vocabulary (`src/agent/agent-service.enum.ts`): `CASH_IN, CASH_OUT, CASH_TO_CASH, AGENT_FUNDING, AGENT_DEFUNDING` with aliases (`CASH_TO_WALLET → CASH_IN`, `WALLET_TO_CASH → CASH_OUT`). That file's own header records that **no canonical agent-service vocabulary existed before it was added** — it is the authoritative one now.

Enforcement points actually wired: `agent-transaction-authorization.service.ts:60,151` (used by cash-in and cash-out), `agent-funding.service.ts:1641` (funding/defunding execution), `agent-cash-to-cash-claim.service.ts:1111-1180,1525-1545` (claim requires `applicable_services` to contain `CASH_TO_CASH`, re-read inside the claim transaction), and `agent-app.controller.ts:101` (agent-facing capability list).

### 4.5 Agent-specific limits

Agent limits use the same limit catalogue as customers:
`limit_assignments.subject_type = 'AGENT' | 'AGENT_CLASS'` (with `AGENT_CLASS` matching only when the principal is an agent), resolved by precedence (`limit-profile-resolver.service.ts:70-95`). Agent enforcement products/directions: `CASH_TO_WALLET`, `WALLET_TO_CASH`, `CASH_TO_CASH`, `AGENT_FUNDING`, `AGENT_DEFUNDING` (see §5.3). **`applicable_limits` on the class is not used**; the class is linked to limits only indirectly through an `AGENT_CLASS`-scoped assignment.

### 4.6 Agent-specific pricing and commission

- **Pricing:** no agent-specific fee exists (`fee_rules` has no agent/class column). The only agent-linked prices are `AGENT_FUNDING` / `AGENT_DEFUNDING` product rules — product-wide, not agent-specific.
- **Commission:** strong support. `commission_rules` can target `agent_id`, `agent_class_id` or `aggregator_id` (at most one non-null per rule, DB CHECK), with recipient types `AGENT | AGGREGATOR | PLATFORM`; the engine resolves per recipient group with highest-priority-wins and fails closed on ties. Flows supply `agentId` and `agentClassId` (read from `agents.agent_class_id` inside the transaction) at four call sites (`agent-financial-execution.service.ts:650-660`, `agent-cash-to-cash.service.ts:1101-1110`, `agent-funding.service.ts:1424-1433`, `transfer.service.ts:806-815`).
- **Aggregator commission at runtime:** not applied — every call site passes `aggregatorId: null` (verified at all four sites), and `CommercialAccountingService` throws `COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED` for any AGGREGATOR allocation (`commercial-accounting.service.ts:307-313`).

### 4.7 Agent funding and defunding

`src/agent/agent-funding.service.ts` + `agent-funding.controller.ts` implement a full commercial flow:

| Capability | Endpoint(s) |
| --- | --- |
| Agent-raised funding/defunding request | `POST /internal/agents/:agentId/fund-request`, `POST …/defund-request` |
| Approval decision | `POST /internal/agents/funding-requests/:requestId/execute` (consumes a governed approval), `POST …/reject` |
| Direct finance operation | `POST /internal/agents/:agentId/fund`, `POST …/defund` |
| Via aggregator | `POST /internal/aggregators/:aggregatorId/agents/:agentId/fund`, `…/defund` |
| Queues | `GET /internal/agents/funding-requests`, `GET /internal/agents/:agentId/funding-requests` |

Governance: `AGENT_FUNDING_ACTIONS.FUND/DEFUND` = maker `AGENT_NETWORK_MANAGER`, checker `FINANCE_CONTROLLER`, MFA both sides, minimum 1 approval, self-approval prohibited (`governed-action.registry.ts:65-99,193-200`). Limits are enforced with `requireConfiguration: true` (§5.3). Fees for `AGENT_FUNDING`/`AGENT_DEFUNDING` are resolved, computed and snapshotted, but **never posted** because the accounting service's fee scope excludes funding products (`commercial-accounting.service.ts:103-110,172-178`).

### 4.8 Outlets, terminals and POS controls

`agent_outlets` and `agent_terminals` are **identity + lifecycle only**: reference, name, status (`ACTIVE/SUSPENDED/TERMINATED`), address fields, serial number, version, audit columns. No fee, limit, commission or pricing field exists on either entity (`src/outlet/agent-outlet.entity.ts`, `agent-terminal.entity.ts`). There is no POS transaction processor in the codebase (`grep -ri "\bPOS\b" src` → 0 hits).

### 4.9 Aggregator domain

`aggregators` + `aggregator_agent_relationships` with lifecycle (`create/activate/suspend/reactivate/terminate`) and relationship controls (`assignAgent`, `suspend/reactivate/terminate` assignment) — `aggregator.controller.ts` (11 routes). Aggregator funding routes exist (§4.7). Aggregator **commercial** configuration exists only as commission-rule targeting that no flow exercises.

---

## 5. Scope 4 — Transaction and wallet limits

### 5.1 Every supported limit dimension

`LimitDimension` (`src/limit-catalog/limit-catalog.enums.ts:20-32`) — 11 dimensions, split into amount and count families:

| Dimension | Kind | Value column | Failure code |
| --- | --- | --- | --- |
| `MIN_AMOUNT_PER_TX` | amount | `limit_value_minor` | `LIMIT_MIN_AMOUNT_NOT_MET` |
| `MAX_AMOUNT_PER_TX` | amount | `limit_value_minor` | `LIMIT_MAX_AMOUNT_EXCEEDED` |
| `DAILY_AMOUNT` | amount (window) | `limit_value_minor` | `LIMIT_DAILY_AMOUNT_EXCEEDED` |
| `WEEKLY_AMOUNT` | amount (window) | `limit_value_minor` | `LIMIT_WEEKLY_AMOUNT_EXCEEDED` |
| `MONTHLY_AMOUNT` | amount (window) | `limit_value_minor` | `LIMIT_MONTHLY_AMOUNT_EXCEEDED` |
| `YEARLY_AMOUNT` | amount (window) | `limit_value_minor` | `LIMIT_YEARLY_AMOUNT_EXCEEDED` |
| `DAILY_COUNT` | count (window) | `limit_value_count` | `LIMIT_DAILY_COUNT_EXCEEDED` |
| `WEEKLY_COUNT` | count (window) | `limit_value_count` | `LIMIT_WEEKLY_COUNT_EXCEEDED` |
| `MONTHLY_COUNT` | count (window) | `limit_value_count` | `LIMIT_MONTHLY_COUNT_EXCEEDED` |
| `YEARLY_COUNT` | count (window) | `limit_value_count` | `LIMIT_YEARLY_COUNT_EXCEEDED` |
| `WALLET_BALANCE_MAX` | balance cap | `limit_value_minor` | `LIMIT_WALLET_BALANCE_EXCEEDED` |

Additional operational codes exist without a dimension: `LIMIT_PROFILE_MISSING`, `LIMIT_RULE_INVALID`, `LIMIT_CONFIGURATION_INVALID`, `LIMIT_RESERVATION_FAILED` (`limit-error.codes.ts`).

**Not supported:** `MIN_WALLET_BALANCE` (no dimension, no code), burst/velocity (per-minute/hour), per-counterparty or per-beneficiary limits, per-channel *counts* (channel is a rule filter, not a dimension), fee-inclusive limit accounting (limits are on principal only), and cross-product aggregate limits (each rule is product-scoped; there is no "all-outgoing" product).

### 5.2 Where each is defined, configured, resolved and enforced

| Stage | Location |
| --- | --- |
| **Defined** | `limit-catalog.enums.ts` (dimensions, directions `INCOMING/OUTGOING/BOTH`, profile kinds `CUSTOMER/AGENT/SYSTEM/UNIVERSAL`, statuses) |
| **Configured** | `limit_profiles` (`kind`, `status`, `enabled`, `configuration_status`, version) and `limit_rules` (`product`, `direction`, `channel`, `currency`, `dimension`, `limit_value_minor`/`limit_value_count`, `effective_from/to`, `is_active`, `priority`, version) — `POST/PATCH /internal/limit-profiles`, `/internal/limit-profiles/:code/rules`, `/internal/limit-rules/:id` |
| **Assigned** | `limit_assignments` (`subject_type`, `subject_id`, `segment_code`, `precedence`, effective window, `is_active`) — `POST/PATCH /internal/limit-assignments` |
| **Resolved** | `LimitProfileResolverService.resolve()`: candidates = `GLOBAL`, plus `CUSTOMER` / `AGENT` / `AGENT_CLASS` matches, plus supplied `SEGMENT` codes; **`ORDER BY precedence DESC, effective_from DESC, created_at DESC LIMIT 1`**; a disabled/missing profile resolves to *no limits* (permissive) |
| **Tier-resolved** | `InstitutionKycLimitPolicyService.resolveWithManager()` (product+currency+serviceClass+tier → profile or NOT_APPLICABLE), gated by `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` |
| **Enforced** | `LimitEnforcementService.enforceWithManager()` (`limit-enforcement.service.ts:159-777`) inside the flow's SERIALIZABLE transaction |
| **Counted** | `limit_usages` (used/reserved amount and count per window) + `limit_reservations` (idempotency key, request hash, status) — `LimitUsageService` |

### 5.3 Enforcement mechanics

1. **Non-windowed:** `MIN_AMOUNT_PER_TX` and `MAX_AMOUNT_PER_TX` compared directly to `amountMinor`.
2. **Balance cap:** `WALLET_BALANCE_MAX` is authoritative against `ledger_lines` balance + credit amount, **only for `INCOMING`** (outgoing reduces balance so it is not enforced) (`limit-enforcement.service.ts:340-417`).
3. **Windowed:** daily/weekly/monthly/yearly amount **and** count are evaluated together through a locked upsert into `limit_usages` (`FOR UPDATE`), checked as `used + reserved + delta > limit`, then `reserved` is incremented and a `limit_reservations` row is written under the flow's idempotency key — concurrent duplicates are treated as replays (`limit-enforcement.service.ts:418-777`).
4. **Commit/release:** the flow calls `commitReservationsWithManager` on success or `releaseReservationsWithManager` on failure/abort; a recovery service exists for stale reservations (`limit-reservation-recovery.service.ts`, `POST /internal/limit-reservation-recovery/release`).
5. **Windows:** Africa/Lagos UTC+1 with no DST; ISO-week anchoring; window keys/day boundaries computed in `limit-window.util.ts`.
6. **Fail-closed modes:** `requireConfiguration: true` refuses when no assignment/profile/rule exists; `requireKycTierPolicy: true` selects the institutional tier path. In the **`production` profile**, a request for tier policy while `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` is false throws `503` rather than degrading (`limit-enforcement.service.ts:129-144`).

### 5.4 Where limits are enforced (call-site map)

| Flow | Principal | Product | Direction(s) | Service | Flags |
| --- | --- | --- | --- | --- | --- |
| Wallet→wallet transfer | CUSTOMER (sender and recipient separately) | `WALLET_TRANSFER` | OUTGOING, INCOMING | `transfer.service.ts:521,541` | `requireConfiguration` + `requireKycTierPolicy` |
| Agent cash-in | CUSTOMER then AGENT | `CASH_TO_WALLET` | CUSTOMER OUTGOING? agent OUTGOING (see note) | `agent-financial-execution.service.ts:294,348` | customer: both flags; agent: configuration only |
| Agent cash-out | CUSTOMER then AGENT | `WALLET_TO_CASH` | customer INCOMING, agent INCOMING | same | same |
| Cash→cash | AGENT | `CASH_TO_CASH` | OUTGOING | `agent-cash-to-cash.service.ts:679` | configuration (+ institution) |
| Cash→cash claim | CUSTOMER or AGENT (`limitPrincipalType`) | `CASH_TO_CASH` | INCOMING | `agent-cash-to-cash-claim.service.ts:742` | configuration |
| Agent funding / defunding | AGENT | `AGENT_FUNDING` / `AGENT_DEFUNDING` | INCOMING / OUTGOING | `agent-funding.service.ts:1058` | `requireConfiguration` |
| Customer wallet funding | CUSTOMER | `CUSTOMER_FUNDING` | INCOMING | `customer-funding.service.ts:435` | both flags |
| Withdrawal commitment | CUSTOMER | `WITHDRAWAL` | OUTGOING | `financial-commitment.service.ts:238` | both flags |
| Deposit (settlement-account) | — | — | — | `deposit.service.ts` | **no limit enforcement** |
| Bank outbound / inbound | — | — | — | `banking-outbound/inbound.service.ts` | **no limit enforcement** |

Note on agent cash-in/out direction mapping: the agent's own direction is derived from the canonical service (`CASH_IN → OUTGOING`, `CASH_OUT → INCOMING`) at the agent funding-pool boundary (`agent-financial-execution.service.ts:340-347`); the customer-side direction is supplied by the calling service.

### 5.5 Overrides and institution/regulatory ceilings

| Override kind | Supported? | Mechanism |
| --- | --- | --- |
| Customer-specific | **Yes** | `limit_assignments.subject_type='CUSTOMER'` + precedence |
| Agent-specific | **Yes** | `subject_type='AGENT'` |
| Agent-class | **Yes** | `subject_type='AGENT_CLASS'` |
| Segment / customer-class | Targeting **defined**, **unreachable** (no caller supplies codes) | `subject_type='SEGMENT'` |
| Global | **Yes** | `subject_type='GLOBAL'` |
| Institution-specific | **Yes, indirectly** | Institution KYC-tier policy maps (product, currency, serviceClass, tier) → profile; plus `wallet_accounts.institution_id` scoping in admission |
| Regulatory ceiling | **Indirect only** | Expressed as the regulatory layer of the KYC tier policy, which maps a tier to a limit profile. There is no regulator-ceiling register, no per-transaction statutory cap, and no `limit_rules` column meaning "regulatory maximum". |
| Channel-specific | **Yes** | Rule filter `limit_rules.channel` (plus `direction`, `product`) — a filter, not an override row |
| Product-specific | **Yes** | Rule filter `limit_rules.product` |

### 5.6 Known behavioural wrinkles worth stating plainly

- A **disabled or missing profile resolves to no limits** in the legacy path. The fail-closed behaviour comes from `requireConfiguration`, which is set on all financial call sites listed above — but only where the call site sets it. Any future caller that omits it inherits the permissive contract.
- **No ambiguity failure for assignments**: ties on `precedence` are broken by `effective_from DESC, created_at DESC`, silently. Fee/commission/reward resolvers fail closed on ties; limits do not. This asymmetry is a governance gap, not a bug.
- `customer-eligibility`'s `CustomerLimitType` (`DAILY_TRANSACTION_COUNT`, `SINGLE_TRANSACTION_AMOUNT`, …) and `customer_limit_profiles` are a **separate, legacy** model that enforcement never reads.

---

## 6. Scope 5 — Fees and pricing

### 6.1 Two distinct fee implementations (do not conflate)

| | **Registry fee system** (authoritative, wired) | **Legacy `FeeEngine`** (stateless, mostly unwired) |
| --- | --- | --- |
| Code | `src/fee-rules/*` | `src/fee/fee.engine.ts`, `src/fee/fee.types.ts` |
| Models | FLAT, PERCENTAGE, FLAT_PLUS_PERCENTAGE, ZERO (`fee-rule-calculator.service.ts:19`) | flat + bps + min + max |
| VAT | `vat_bps` on the rule; `vat = fee * bps / 10000` on the **clamped** fee | `vatBps` on the rule; same formula |
| Rounding | FLOOR, emitted as evidence (`roundingApplied: 'FLOOR'`) | integer division (floor) |
| Storage | `fee_rules` table, versioned, audited, effective-dated, priority | none (caller-supplied rule object) |
| Callers | 4 financial flows + banking binding | `POST /fees/calculate`, `BankingFeeBindingService` |
| Status | Operational (evidence-by-default, posting gated) | Diagnostic endpoint + one unwired adapter |

### 6.2 Supported fee mechanics (registry system)

`FeeRuleDefinition` (`fee-rule.entity.ts`): `product_code`, `currency`, `flat_fee_minor`, `percentage_bps` (0..10000), `minimum_fee_minor`, `maximum_fee_minor`, `vat_bps` (0..10000), `effective_from`, `effective_to`, `priority`, `is_active`, `created_by/updated_by`, `version`, soft delete. Identity = `(product_code, currency, effective_from)` unique among live rows; identity fields cannot change on update.

| Capability | Status | Detail |
| --- | --- | --- |
| Fixed fee | **Yes** | `flat_fee_minor` |
| Percentage fee | **Yes** | `percentage_bps` of principal, floored |
| Minimum / maximum fee | **Yes** | Clamp after summing flat+percentage; `minimumApplied`/`maximumApplied` booleans emitted |
| Flat + percentage combined | **Yes** | Calculator sums both |
| **Tiered / bracketed pricing** | **No** | Not expressible; resolver returns a single row; capability registry marks `TIERED_FEE` as `PLANNED` |
| Progressive / volume / usage pricing | **No** | `PLANNED` in capability registry |
| Class-based pricing | **No** | No class dimension |
| Customer-specific pricing | **No** | No customer dimension in `fee_rules` |
| Agent-specific pricing | **No** | No agent dimension |
| Institution-specific pricing | **No** | No institution dimension |
| Product-specific pricing | **Yes** | `product_code` (7 seeded products) |
| Discounts / waivers | **No** | A zero-fee rule (`flat_fee_minor = 0`) is the only representable waiver: a distinct rule row, not a discount applied to another rule |
| Effective dates | **Yes** | `effective_from <= at < effective_to`, open-ended when null |
| Rule precedence | **Yes** | Highest `priority` wins; equal top priority ⇒ `AMBIGUOUS` listing conflicting ids, **no selection** (`fee-rule-resolver.service.ts:23-46`) |
| Versioning | **Yes** | Optimistic `version`, audit trail with previous/new values |
| Fee calculation | **Yes** | `FeeRuleCalculatorService.compute()` (L47-190), pure/deterministic |
| **Fee collection** | **Gated** | Posted to the ledger only when `COMMERCIAL_ACCOUNTING_ENABLED=true` **and** a VAT treatment is configured (§6.4) |
| Fee reversal | **Indirect only** | No fee-specific reversal. Finance can reverse the journal through the governed `LEDGER_JOURNAL_REVERSAL` flow (`POST /ledger/journals/:id/reversal-request` → `…/reversal`) |
| Fee accounting | **Yes (gated)** | DR payer wallet (fee + VAT) / CR `FINANCE-FEE_REVENUE-NGN` / CR `FINANCE-VAT_PAYABLE-NGN` |

### 6.3 Real fee collection today

`FeeRuleCalculatorService` computes and reports `posting: { journalLegsPosted: false, reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED' }` (calculator header, L39-46) — an artefact of the calculator predating the accounting task. The actual posting path is `CommercialAccountingService.postForCompletion()`, which is called only when `this.commercialAccountingService.isEnabled()`:

```ts
// transfer.service.ts:858-861 / agent-financial-execution.service.ts:687-690
// agent-cash-to-cash.service.ts:1139-1142
if (this.commercialAccountingService && this.commercialAccountingService.isEnabled()) { … }
```

Because `COMMERCIAL_ACCOUNTING_ENABLED` defaults to **false** (`environment.ts:113`), **no fee is collected on any flow out of the box**. With the flag on, a fee-bearing decision requires:

- a non-null `COMMERCIAL_ACCOUNTING_VAT_TREATMENT`, otherwise `COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED`;
- a non-null `vat_bps` on the resolved rule, otherwise `COMMERCIAL_VAT_RATE_NOT_CONFIGURED` (never treated as zero — DP-03=B);
- the product in `WALLET_TRANSFER | WALLET_TO_CASH | CASH_TO_WALLET | CASH_TO_CASH`, otherwise `COMMERCIAL_FEE_ACCOUNTING_PRODUCT_UNSUPPORTED`;
- a resolvable payer wallet, otherwise `COMMERCIAL_FEE_PAYER_WALLET_NOT_RESOLVABLE`;
- deterministic agreement between the decision's `vatMinor` and a recomputation, otherwise `COMMERCIAL_VAT_DECISION_MISMATCH`.

All of these throw inside the flow's transaction, so any blocker rolls back the principal movement too.

### 6.4 Where amounts live today (and where they do not)

| Storage | State | Meaning |
| --- | --- | --- |
| `commercial_decision_snapshots.fee_decision` | **Populated on every wired flow** | Authoritative computed fee + VAT + full calculation evidence + rule refs |
| `transfers.fee_minor` / `vat_minor` | Always `0` | "Fee actually applied"; written only when a fee is posted (customer projections read these columns) — `1785753600075-AddTransferFeeColumns.ts:6-13` |
| `cash_to_cash_transfers.fee_minor` / `vat_minor` / `total_minor` | Always `0` | Columns exist and are inserted with hardcoded zeros (`agent-cash-to-cash.service.ts:353-354,776-788`) |
| `payment_quotes.fee_minor` / `vat_minor` | **Caller-supplied** | Quote does not price anything: `CreateQuoteCommand` requires the caller to pass `feeMinor` and `vatMinor` (`quote.types.ts:3-13`), and the DB enforces `total = amount + fee + vat` |
| `external_operation_fee_bindings` (banking) | Written only by the unwired binding service | Frozen price for a committed bank operation |

**Quotes are not a pricing engine.** They persist whatever the caller supplies. Any commercial UI must not present them as authoritative pricing.

### 6.5 Fee-related endpoints

| Method | Route | Handler | Permission | Status |
| --- | --- | --- | --- | --- |
| GET | `/internal/fee-rules` | `FeeRuleRegistryController.list` | `fee_rule.view` (workforce) | Implemented |
| GET | `/internal/fee-rules/:id` | `getOne` | `fee_rule.view` | Implemented |
| POST | `/internal/fee-rules` | `create` → governed **request** (no write) | `fee_rule.create` | Implemented, maker only |
| POST | `/internal/fee-rules/changes/:approvalId/execute-create` | `executeCreate` | `fee_rule.create` + consumed approval | Implemented |
| PATCH | `/internal/fee-rules/:id` | `update` → governed request | `fee_rule.modify` | Implemented |
| POST | `/internal/fee-rules/changes/:approvalId/execute-modify` | `executeModify` | `fee_rule.modify` + approval | Implemented |
| GET | `/internal/fee-rules/resolve` | `FeeRuleResolverController.resolve` | workforce | Read-only preview |
| POST | `/fees/calculate` | `FeeController.calculate` | (legacy stateless) | Implemented, not flow-wired |

### 6.6 The bank-transfer fee binding (important nuance)

`BankingFeeBindingService` (`src/banking/banking-fee-binding.service.ts`) is the only production-grade use of the legacy `FeeEngine`, and it is unusually strict: it refuses to price when no approved active effective rule exists, refuses to *choose* when more than one product rule is effective for the currency, never adjusts a committed amount, is idempotent per operation, and persists `pricing_source ∈ APPROVED_RULE | TEST_POLICY` plus the exact `fee_rule_id/fee_rule_version` and `tax_minor`. **However**, its call sites are only its own module registration and two integration specs; no banking flow invokes it (`grep` for `bindForCommittedOperationInTransaction` outside the file and tests → none). It is *implemented and tested but not operational*. The reason is recorded in its own comment: "Which product prices an outbound bank transfer is a commercial decision that has no approved answer in this repository."

---

## 7. Scope 6 — Taxes

### 7.1 What actually exists: VAT, as a fee attribute

The only tax mechanism in the codebase is **VAT computed as a component of a fee**, in two places that use identical arithmetic:

- `FeeRuleCalculatorService`: `vatBps = rule.vatBps ?? 0; vat = fee * vatBps / 10000n` on the clamped fee; emits `vatApplied`, `vatRateBps`, `vatBasisMinor` (`fee-rule-calculator.service.ts:110-140`).
- `FeeEngine.calculate()`: `vatMinor = feeMinor * vatBps / 10000n` (`src/fee/fee.engine.ts:52-55`).

And **VAT accounting**, in `CommercialAccountingService` with two explicit treatments (`commercial-accounting.enums.ts:31-40`):

| Treatment | Formula | Legs |
| --- | --- | --- |
| `EXCLUSIVE_ADD_ON` | `vat = fee * bps / 10000`, payer debited `fee + vat` | DR payer (fee+vat) / CR fee revenue (fee) / CR VAT payable (vat) |
| `INCLUSIVE_IN_FEE` | `vat = fee * bps / (10000 + bps)`, revenue = fee − vat | DR payer (fee) / CR fee revenue (net) / CR VAT payable (vat); refuses if revenue would be ≤ 0 |

The `VAT_PAYABLE` account family is provisioned: `FINANCE-VAT_PAYABLE-NGN`, liability, credit-normal, deliberately "VAT-bearing shape; rate unset" (`1785753600076-ProvisionV1CommercialAccountingFamilies.ts:9,79-83`).

### 7.2 Complete VAT/tax capability table

| Capability | Status | Evidence |
| --- | --- | --- |
| VAT configuration (rate) | **Defined only, per fee rule** — `fee_rules.vat_bps` nullable, 0..10000, **no default and no seeded value** | `fee-rule.entity.ts:107-108` |
| VAT rates as a catalogue | **No** | No rate table, no jurisdiction, no effective-dated rate registry — the rate is a column on each fee rule (`fee-rule.entity.ts`) |
| VAT applicability | **Implicit only** | VAT exists iff a fee rule carries `vat_bps` and a fee is computed; there is no product/tier/jurisdiction applicability matrix |
| VAT exemptions | **No** | No exemption flag, reason, certificate or zero-rating model; a `vat_bps = 0` rule is the only representable "no VAT" |
| VAT calculation | **Yes** | Two formulas, both floor-rounded, cross-checked in accounting (`COMMERCIAL_VAT_DECISION_MISMATCH`) |
| VAT collection | **Gated** | Same master switch as fees; default off |
| VAT accounting | **Yes (gated)** | Credit to `FINANCE-VAT_PAYABLE-NGN`; both treatments supported |
| Tax liability accounts | **Yes** | One family, resolved through the accounting registry (not hardcoded) |
| Tax reporting | **No** | No endpoint, report or view aggregates VAT collected/payable; `GET /internal/reports/*` covers daily/ledger/wallets/transfers/deposits/withdrawals/reconciliation/outbox/audit only (`maturity.controller.ts`) |
| Tax remittance / filing workflow | **No** | Nothing moves VAT payable to a tax authority; no maker-checker remittance action, no return period |
| Withholding tax | **No** | Only a vocabulary constant (`WITHHOLDING_TAX`) inside the B1 revenue-recognition engine, which explicitly does not calculate or post tax (`src/policy/b1-revenue-recognition-engine.constants.ts:413-426`) |
| Excise / stamp duty / levies | **No** | `EXCISE_TAX` constant only; searches for levy / stamp-duty implementations → 0 hits |
| Tax on commissions | **No** | — |
| Tax on rewards/cashback | **No** | — |
| Tax in banking fee binding | **Stored only** — `tax_minor` on the binding row; the service is unwired | `banking-fee-binding.service.ts:27,306` |

### 7.3 The distinction the brief asked for

- **Configurable tax definition:** partial — a nullable basis-point field on fee rules, with no independent lifecycle.
- **Actual tax collection:** exists only behind `COMMERCIAL_ACCOUNTING_ENABLED` and an explicitly configured VAT treatment, and today no rate is set anywhere, so it collects **nothing**.
- **Actual tax remittance:** **does not exist at all**.

### 7.4 Legal applicability

Nothing in the code asserts that VAT applies to any product. The migration comment states it plainly: "No VAT/tax policy is decided: `vat_bps` is a column (existing FeeRule terminology) with no value" (`1785753600072-CreateFeeRules.ts:10`). Whether VAT is due, at what rate, on which products, and under which exemption regime is a product-owner/advisor decision, recorded as open in §16.8.

---

## 8. Scope 7 — Commissions

### 8.1 Entities and rule vocabulary

`commission_rules` (`src/commission/commission-rule.entity.ts`):

| Field | Values / constraints |
| --- | --- |
| `recipient_type` | **`AGENT` \| `AGGREGATOR` \| `PLATFORM`** (CHECK) — L30-38 |
| `calculation_basis` | `PRINCIPAL` \| `FEE` \| `NET` |
| `calculation_model` | `FIXED`, `PERCENTAGE`, `PERCENTAGE_MIN`, `PERCENTAGE_MAX`, `PERCENTAGE_MIN_MAX`, `FLAT_PLUS_PERCENTAGE`, **`TIERED`** |
| Parameters | `flat_commission_minor`, `percentage_bps`, `minimum_commission_minor`, `maximum_commission_minor`, `tiers` (JSONB marginal brackets with `upToMinor`, `bps`, `flatMinor`) |
| Targeting | `agent_class_id`, `agent_id`, `aggregator_id` — **at most one non-null** (DB convention); all nullable = product-wide |
| Window / precedence | `effective_from`, `effective_to`, `priority`, `is_active`, `version` |

### 8.2 Which recipients are genuinely supported

| Recipient type | Defined in rules | Resolved by engine | Supplied by any flow | Posted to ledger |
| --- | --- | --- | --- | --- |
| **Agent** | Yes | Yes (`agentId`, `agentClassId`) | **Yes** — 4 call sites | Yes, when accounting enabled: `EXPENSE_PAYABLE` (accrual) or `AGENT_WALLET_NETTING` (immediate wallet credit) |
| **Aggregator** | Yes | Engine can resolve AGGR rules | **No** — `aggregatorId: null` at every call site | **Refused** — `COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED` |
| **Platform** | Yes | Yes | n/a (no identity needed) | **Refused** — `COMMERCIAL_PLATFORM_ALLOCATION_POSTING_NOT_PROVISIONED` (D-C-010 open) |
| **Customer** | **No** — not a recipient type | — | — | — |
| **Referral participant / partner** | **No** in the commission engine. Referral *decision documents* exist in the non-operational B1 referral engine | — | — | — |

### 8.3 Calculation, allocation and caps

- **One winner per recipient group**: each of AGENT / AGGREGATOR / PLATFORM is resolved independently; within a group the highest `priority` wins; two applicable rules sharing the top priority produce `AMBIGUOUS` and **no amount** for that group (`commission-rule-resolver.service.ts:23-46`).
- **Bases**: `PRINCIPAL` always available; `FEE`/`NET` require fee evidence, otherwise `BASE_UNAVAILABLE` (fail-closed at the flow, which aborts the transaction before money commits).
- **Tiered** is **marginal** (per-slice `bps` plus a one-time `flatMinor` per bracket reached), not a flat rate on the whole base.
- **Caps**: `minimum_commission_minor` / `maximum_commission_minor` clamp the result. There is **no cumulative cap** (per day/month/lifetime), no per-recipient budget, and no "total commission ≤ X% of fee" constraint.
- **Splitting**: multi-recipient **across types** is supported (one AGENT + one PLATFORM allocation), but there is no *share/split percentage* within a recipient group — one rule, one recipient type, one amount. Splitting one commission between two agents is not expressible.

### 8.4 Accrual, payment, reversal, reconciliation, tax

| Stage | Status | Detail |
| --- | --- | --- |
| Calculation | **Yes** | `CommissionCalculator` (pure), `CommissionEngine.decideWithManager()` |
| Accrual (recorded) | **Yes** | Snapshot `commission_decision` on every wired flow |
| Accrual (ledger) | **Gated** | `EXPENSE_PAYABLE` + `ACCRUE_NOW_SETTLE_LATER` → DR commission expense / CR commission payable, with `settlementState: 'ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED'` |
| Payment | **Netting only** | `AGENT_WALLET_NETTING` + `AT_COMPLETION` credits the agent's wallet ledger account in the same journal (this *is* payment). For the accrual path there is **no payout rail at all** |
| Reversal | **No** | No commission-specific reversal; journal reversal is the only mechanism, and it is manual/governed |
| Reconciliation | **Evidence only** | Snapshots list allocations with `beneficiaryId`; there is no commission reconciliation report and no payable-to-agent sub-ledger. The payable is a **single pooled account** — per-beneficiary attribution lives in snapshots, not in accounts |
| Tax treatment | **No** | Nothing computes or withholds tax on a commission |

### 8.5 Commission endpoints

`GET/POST/PATCH /internal/commission-rules`, `POST …/changes/:approvalId/execute-create` and `…/execute-modify`, `GET /internal/commission-rules/resolve` (governed maker-checker, functions `commission_rule.view`, `.create`, `.modify`). Snapshots are observable at `GET /internal/commercial-decision-snapshots[/:id]`.

### 8.6 Honest reading of the runtime wiring

Commission is genuinely evaluated inside the money-moving transaction, and ambiguity/base-unavailability abort the transaction. But under default configuration **nothing is charged and nothing is paid**: the decision is computed, snapshotted, and its posting is gated. The one path that *would* pay instantly is `AGENT_WALLET_NETTING`, and it requires the operator to have deliberately configured that treatment plus a non-zero rule.

---

## 9. Scope 8 — Cashback and rewards

### 9.1 What exists

`reward_rules` (`src/reward/reward-rule.entity.ts`) + resolver + calculator + engine (`src/reward/`):

| Field | Values |
| --- | --- |
| `beneficiary_type` | **`CUSTOMER` \| `AGENT`** (L32) |
| `reward_type` | **`CASHBACK` \| `BONUS` \| `PROMOTION`** (L33) |
| `calculation_basis` | `PRINCIPAL` \| `FEE` \| `NET` |
| `calculation_model` | same 7 as commission, including marginal `TIERED` |
| Parameters | `flat_reward_minor`, `percentage_bps`, `minimum_reward_minor`, `maximum_reward_minor`, `tiers` |
| Targeting | `customer_id`, `customer_kyc_level` (`NONE/LEVEL_1..3`), `agent_class_id`, `agent_id`, `campaign_code` |
| Window | `effective_from`, `effective_to`, `is_active`, `priority`, `version` |

### 9.2 The decisive fact: it is deliberately unwired

`src/reward/reward.module.ts:14-26` states it without ambiguity:

> "Nothing here is wired into any financial flow: no flow calls `RewardEngine`, no reward is credited, no reward ledger entry is posted, all V1 snapshots keep reward status NONE. Production enablement awaits an explicitly-approved reward policy … AND a separate wiring task."

Verified: every wired flow passes `rewardDecision: rewardNone()` (`transfer.service.ts:892`, and the equivalent in the agent flows). There is no ledger family for rewards (only FEE_REVENUE, VAT_PAYABLE, COMMISSION_EXPENSE, COMMISSION_PAYABLE), and `CommercialAccountingService` has no reward posting branch.

### 9.3 Answers to the brief's questions

| Question | Answer |
| --- | --- |
| Does cashback exist as a distinct capability? | **As a rule vocabulary and calculation engine only.** It is a `reward_type` value, not a service or a ledger flow. |
| Is it implemented through commission or reward services? | **Reward services** (`RewardEngine`), explicitly *not* commission — the reward types file states a reward is not a negative fee, not fee discount, not commission. |
| Can customers earn cashback? | **No** — no crediting path exists. |
| Can agents earn cashback? | **No** — `AGENT` beneficiary is representable, never executed. |
| Can aggregators or partners receive incentives? | **No** — not a beneficiary type. |
| Eligibility and calculation rules | Defined per rule (product, currency, beneficiary targeting, KYC level, campaign, basis, model, min/max, window, priority). |
| Minimum/maximum rewards | **Per calculation**, via `minimum_reward_minor`/`maximum_reward_minor`. |
| Per-transaction and cumulative caps | Per-transaction: yes (min/max). **Cumulative: no** (no daily/monthly/lifetime budget). |
| Expiry and effective dates | Rule windows only. **No grant expiry** — there is no grant record to expire. |
| Wallet crediting or payout | **None.** |
| Reversal and clawback | **None.** |
| Fraud and abuse controls | **None** reward-specific. (Platform-wide rate limits/idempotency exist but are not reward controls; no per-customer frequency cap on rewards, no self-reward detection.) |
| Reporting and reconciliation | **None** reward-specific. `GET /internal/reward-rules` lists rules; nothing reports grants because none exist. |

### 9.4 Adjacent "promotion" machinery (not a reward system)

The B1 campaign/referral/billing engines (`src/policy/b1-*.ts`) hold decision-document schemas that *mention* cashback, loyalty, coupons and promotions. Their own headers are explicit that they **do not execute cashback, rewards, payouts, invoices or billing** (`b1-campaign-engine.service.ts:22-26,83`), they expose **no HTTP controller** (no controller exists under `src/policy/` except `a7-inbound.controller.ts`), and their only scope constant is `commercial.virtual-account.inbound-funding`. They are governance scaffolding, not a promotion system, and they must not be presented as cashback functionality.

### 9.5 Endpoints

`GET/POST/PATCH /internal/reward-rules`, `POST …/changes/:approvalId/execute-create|execute-modify`, `GET /internal/reward-rules/resolve` — all governed (`reward_rule.view|create|modify`), all definition-only.

---

## 10. Scope 9 — Configuration and governance

### 10.1 Admin API surface (configuration planes)

| Plane | Endpoints | Governance |
| --- | --- | --- |
| Product catalogue | `GET/POST /internal/products`, `GET /internal/products/:code`, `PATCH …/:code`, `POST …/changes/:approvalId/execute-create` and `…/execute-modify` | **Maker/checker** (`PRODUCT_MODIFY`) |
| Fee rules | §6.5 | **Maker/checker** (`FEE_RULE_CREATE/MODIFY`) |
| Commission rules | §8.5 | **Maker/checker** (`COMMISSION_RULE_CREATE/MODIFY`) |
| Reward rules | §9.5 | **Maker/checker** (`REWARD_RULE_CREATE/MODIFY`) |
| Limit profiles / rules | `POST/PATCH /internal/limit-profiles`, `…/:code/rules`, `PATCH /internal/limit-rules/:id` | **Direct write** + audit (`limit.modify`) — **no maker/checker** |
| Limit assignments | `POST/PATCH /internal/limit-assignments` | **Direct write** + audit (agent self-assignment scope has a narrower check) |
| KYC tier policy | §2.3 | **Own proposal flow** (SUPER_ADMIN propose → COMPLIANCE approve) |
| KYC provider routing | `POST /internal/kyc/providers/proposals`, then `/proposals/:id/approve` or `/reject` | **Own proposal flow** |
| Institution KYC tier-limit policy | `POST /internal/institutions/:id/kyc-tier-limit-policy/proposals`, then `/proposals/:pid/approve` or `/reject` | **Own proposal flow** |
| Notification provider config | `POST /internal/notifications/provider-config/proposals`, then `/approve`, `/reject`, `/activate` | **Own proposal flow** |
| Agent classes | `POST/PATCH /internal/agents/classes` | **Direct write** + audit — **no maker/checker** |
| Agent funding/defunding | §4.7 | **Maker/checker** (`AGENT_FUNDING_ACTIONS`) |
| Notification templates/registry | `POST /internal/notifications/changes` → `…/:approvalId/execute` | **Own proposal flow** |
| Institution lifecycle / affiliation / enrolment / attribution | `POST /internal/institutions/*` | **Maker/checker** (governed actions) |
| Ledger journal reversal | `POST /ledger/journals/:id/reversal-request`, `…/reversal` | **Maker/checker** |

### 10.2 Draft vs active

There is **no draft state machine** on commercial rules. The model is:

- **Future-dated activation:** `effective_from` in the future (rule is persisted but not yet applicable).
- **Toggle:** `is_active` (fee/commission/reward/limit rules and assignments), `enabled`/`status` (profiles, products).
- **Soft delete:** `deleted_at` (excluded from resolution).
- **Publish version:** KYC tier policy and institution tier-limit policy are the exception — they have real `REQUESTED → APPROVED → live version` transitions.

So "draft" for fee/commission/reward/product rules is a **convention** (create inactive, activate later), not an enforced lifecycle, and the activation step is a second governed change.

### 10.3 Maker-checker mechanics (commercial rules)

`CommercialRuleGovernanceService` (`src/authorization/commercial-rule-governance.service.ts`):

1. Maker calls the collection route (POST/PATCH) with a `reason`; the service computes `sha256(canonical({…payload, reason}))`, records a `PrivilegedActionApproval` in `REQUESTED`, and writes nothing to the rule table.
2. Checker (FINANCE_CONTROLLER) approves; separation of duties, minimum approvals (1), MFA and role checks come from the governed-action registry.
3. An executor calls the `execute-*` route with the same payload; `consume()` rejects replays (`CONSUMED`), tampering (`FINGERPRINT_MISMATCH`), resource mismatch and unentitled executors; only then is the write performed.

Governed definitions (`governed-action.registry.ts:110-150`): `FEE_RULE_CREATE/MODIFY`, `COMMISSION_RULE_CREATE/MODIFY`, `REWARD_RULE_CREATE/MODIFY`, `PRODUCT_MODIFY`, `PRODUCT_GOVERNANCE` — all maker `FINANCE_PREPARER`, checker `FINANCE_CONTROLLER`, `minimumApprovals: 1`, `selfApprovalProhibited: true`, `mfaRequired: true`, approval scope = the function code.

The file also records two deliberate exclusions: `agent.assign_limit` is "explicitly NOT maker/checker governed", and `limit.modify` is "outside the P0-A task scope … left ungoverned pending P1" (`governed-action.registry.ts:101-108`).

### 10.4 Effective dates

Every commercial rule carries an interval; resolution uses `effective_from <= at < effective_to` with `null` meaning open-ended, and historical resolution is first-class (resolvers accept an `at` timestamp, so past decisions are reproducible). The limit resolver's tie-break adds `effective_from DESC`.

### 10.5 Version history and historical preservation

- Rules: `@VersionColumn` optimistic locking + `audit` rows capturing previous/new values + the exact `ruleId`/`ruleVersion` in each snapshot.
- Snapshots: `commercial_decision_snapshots` stores the decision inputs (fee components, rule refs, limit rule refs and values, commission allocations, reservation/usage ids) per transaction, keyed by idempotency key.
- Policies: versioned proposals with fingerprints; the institution policy additionally binds a **profile digest** so later out-of-band edits are detectable.
- Append-only tables in the wider platform (audit, outbox, journals) are protected by DB triggers/privilege restrictions.

### 10.6 Policy overrides

There is no general "override" object. Overrides are expressed as additional higher-priority/precedence rows, or (for tier admission) as an explicit `NOT_APPLICABLE` mapping. Customer-level exceptions exist only for limits (customer-scoped assignment) — not for fees, taxes, commissions or rewards.

### 10.7 Role permissions (commercial function codes observed in code)

`fee_rule.view|create|modify`, `commission_rule.view|create|modify`, `reward_rule.view|create|modify`, `product.view|modify`, `product.governance`, `limit.view|modify`, `kyc.review`, `kyc.approve`, `kyc.reject`, `kyc.policy.view|propose|approve`, `agent.activate`, `agent.assign_limit`, `institution.view`, plus route-family workforce gating (`/internal/products`, `/internal/fee-rules`, `/internal/commission-rules`, `/internal/reward-rules` are `WORKFORCE_SESSION` resource-type policies; `customerAccess/agentAccess/aggregatorAccess: 'NONE'` — `route-policy-registry.ts:1429-1545`).

### 10.8 Institution scoping

Institution scoping is real for: wallet attribution, ledger account scope, agent affiliation, customer enrolment/eligibility, cash-out institution resolution, institution tier-limit policy, and institution pending-approvals. It is **absent** for fees, commissions, rewards, and limit rules/assignments (the institution reaches limits only through the tier mapping).

### 10.9 Conflict detection

| Resolver | Tie behaviour |
| --- | --- |
| Fee | `AMBIGUOUS` — no selection |
| Commission | `AMBIGUOUS` per recipient group — no amount |
| Reward | `AMBIGUOUS` per beneficiary group — no amount |
| Limit profile | **No ambiguity error** — highest `precedence`, then newest `effective_from`, then newest row |
| KYC tier policy | Single live version; overlapping windows are prevented by versioned head + effective window, not by interval arithmetic |
| Institution tier mapping | Key uniqueness on `(product,currency,serviceClass,tier)` within a policy version; duplicate keys rejected |

### 10.10 Activation and deactivation, and historical preservation

Deactivation = `is_active=false` / `enabled=false` / `effective_to` in the past / `status=DEPRECATED`. No rows are deleted (soft delete only), so historical reproducibility depends on snapshots having captured `ruleId` + `ruleVersion` + parameters — which they do for fees, commissions and limits.

### 10.11 The approvals-discovery gap

`PrivilegedActionApprovalService` exposes `getApproval(id)`, `request`, `approve`, `reject`, `cancel`, `consume` — **no list**. The workforce controller has `POST approvals/request|:id/approve|:id/reject` only. The single listing endpoint is institution-scoped: `GET /internal/institutions/:institutionId/pending-approvals`. The `approvals` counters that exist for institutions are not replicated for commercial rules.

**Consequence:** a FINANCE_CONTROLLER cannot discover a pending fee/commission/reward/product change through the API; the `approvalId` must be conveyed out-of-band. This is the single largest usability blocker for an administrative commercial-console programme, and it is a backend addition (a read-only listing) — not a redesign.

---

## 11. Scope 10 — Transaction flow coverage

### 11.1 Flows that exist (verified controllers + services)

| # | Flow | Front door | Service(s) | Ledger effect |
| --- | --- | --- | --- | --- |
| 1 | Wallet→wallet transfer | `POST /customers/me/transfers`, `POST /transfers` | `transfer.service.ts` | DEBIT source / CREDIT destination (principal only) |
| 2 | Cash→wallet (agent cash-in) | `POST /agents/cash-in` | `agent-cash-in.service.ts` → `agent-financial-execution.service.ts` | Agent funding pool → customer wallet |
| 3 | Wallet→cash (agent cash-out) | `POST /agents/cash-out` | `agent-cash-out.service.ts` → `agent-financial-execution.service.ts` | Customer wallet → agent pool |
| 4 | Cash→cash + claim | `POST /agents/cash-to-cash`, `…/claim`, `…/claim-by-number`, cancel/recover/expiry | `agent-cash-to-cash*.service.ts` | Agent pool → unclaimed/claim account → claimer |
| 5 | Agent funding / defunding | §4.7 | `agent-funding.service.ts` | Pool ⇄ agent wallet liability |
| 6 | Customer wallet funding | `POST /internal/customers/:id/funding-requests` → approve/reject | `customer-funding.service.ts` | Settlement/ops → customer wallet |
| 7 | Withdrawal | `POST /customers/me/withdrawal-commitments` (single route, `@Controller('customers/me/withdrawal-commitments')`), then `POST /withdrawals` and `POST /withdrawals/:id/process`, `/complete`, `/fail`, `/cancel` | `financial-commitment.service.ts`, `withdrawal.service.ts` | Customer wallet → settlement |
| 8 | Deposit | `POST /deposits`, `…/:id/complete`, `/fail`, `/cancel` | `deposit.service.ts` | Settlement account → wallet (2 legs) |
| 9 | Bank outbound / inbound (Monnify) | `POST /internal/banking/...`, `POST /webhooks/monnify`, `agents/me/banking/*`, `customers/me/banking/*` | `banking-outbound/inbound/webhook/*` | External operation + settlement/suspense |
| 10 | Virtual-account inbound funding (A7) | `POST /customers/me/inbound-funding/commands`, `…/lifecycles/:id/admission`, `…/execution` | `policy/a7-*` | **Blocked** — admission/execution authorities are `Unavailable…` stubs |
| 11 | Quotes | `POST /quotes`, `GET /quotes`, `POST /quotes/:id/use` | `quote.service.ts` | None (caller-priced record) |
| 12 | Bank transfer to external bank (NIP) | — | — | **Not implemented** (`WALLET_TO_BANK`, `NIBSS_INTEGRATION` = `PLANNED`) |
| 13 | Bill payment, airtime, cards, POS | — | — | **Not implemented** (no controller, no service) |

### 11.2 Per-flow commercial coverage

Legend: **N** not supported · **D** defined only (schema/vocabulary, nothing computed) · **C** calculated · **E** enforced (can refuse the transaction) · **L** posted to ledger · **S** settled/paid out · **R** reversed correctly

| Flow | Limits | Fees | VAT | Commissions | Cashback | Rewards |
| --- | --- | --- | --- | --- | --- | --- |
| Wallet→wallet | **E** (sender OUTGOING + recipient INCOMING; tier-gated) | **C** → **L** only if accounting enabled | **C** → **L** only if accounting enabled + VAT treatment/rate | **C** (no agent context ⇒ agent rules don't match; PLATFORM rules could) → **L** gated | **N** | **N** |
| Cash→wallet | **E** (customer + agent) | **C** → **L** gated | same | **C** with agent + class → **L/S** gated | **N** | **N** |
| Wallet→cash | **E** (customer + agent) | **C** → **L** gated | same | **C** with agent + class → **L/S** gated | **N** | **N** |
| Cash→cash | **E** (agent OUTGOING; claim INCOMING) | **C** (columns hardcoded `0`) → **L** gated | same | **C** on create only (claim deliberately does not re-allocate) → **L/S** gated | **N** | **N** |
| Agent funding/defunding | **E** (agent, configuration-required) | **C** → **never L** (funding products excluded from fee accounting) | **C** → **never L** | **C** (no agent context supplied for funding ⇒ only untargeted/PLATFORM rules) → **never L** (no accounting call) | **N** | **N** |
| Customer funding | **E** (customer INCOMING, tier-gated) | **C** → **never L** (product outside fee-accounting scope) | **C** → **never L** | **C** → snapshot only | **N** | **N** |
| Withdrawal | **E** (customer OUTGOING, tier-gated) | **N** — no fee resolution on the withdrawal path at all | **N** | **N** | **N** | **N** |
| Deposit | **N** — no limit enforcement | **N** | **N** | **N** | **N** | **N** |
| Bank outbound | **N** | **D/C only via unwired binding** | **D** (`tax_minor` slot) | **N** | **N** | **N** |
| Bank inbound (webhook) | **N** | **N** | **N** | **N** | **N** | **N** |
| A7 inbound funding | **N** (path blocked) | **N** | **N** | **N** | **N** | **N** |
| Quotes | Caller-supplied | Caller-supplied | Caller-supplied | **N** | **N** | **N** |

### 11.3 Reversal correctness

| Object | Reversal mechanism | Status |
| --- | --- | --- |
| Principal journal | `LEDGER_JOURNAL_REVERSAL` governed flow (`reversal-request` → `reversal`); transfers themselves are not reversible objects | Implemented, maker/checker, finance-only |
| Fee/VAT posting | Only through the journal reversal above (same journal contains the fee legs) | Implemented but requires accounting to have been enabled |
| Commission posting | Same journal reversal; no commission-specific reversal, no clawback of a netted wallet credit | Partial |
| Limit reservations | `releaseReservationsWithManager` on failure; recovery service for orphans | Implemented |
| Failed transfers | `markFailed` path releases reservations and writes a failure code | Implemented |
| Rewards | Nothing to reverse | n/a |

---

## 12. Cross-cutting verification notes

### 12.1 Flags that determine whether anything is commercial in production

| Flag | Default | Effect if off |
| --- | --- | --- |
| `COMMERCIAL_ACCOUNTING_ENABLED` | **false** | No fee, VAT or commission ever reaches the ledger |
| `COMMERCIAL_ACCOUNTING_VAT_TREATMENT` | **unset** | A fee-bearing decision throws `COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED` when accounting is on |
| `COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT` | **unset** | Non-zero commission throws `…TREATMENT_NOT_CONFIGURED` |
| `COMMERCIAL_COMMISSION_RECOGNITION_TIMING` | **unset** | Throws `…TIMING_NOT_CONFIGURED` |
| `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` | **false** | Financial orders requesting tier policy fail closed in `production`; caller-limited flows would otherwise fall to the legacy contract |
| `KYC_CUSTOMER_VERIFICATION_ENABLED` | **false** | No provider verification |
| `KYC_PROVIDER_LIVE_CALLS_ENABLED` | **false** | No live provider calls |
| `MONNIFY_VERIFICATION_ENABLED`, `DOJAH_VERIFICATION_ENABLED` | **false** | Adapters inert |
| `KYC_TIER_WORKER_ENABLED` | on unless `NODE_ENV=test` | No automatic re-evaluation |

### 12.2 Test evidence (existence, and the one subset I re-ran)

| Area | Spec file(s) | `it()` count |
| --- | --- | --- |
| Fee rules / resolver | `test/v1-commercial-03-fee-rule-schema.integration.spec.ts`, `test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` | 14 + 19 |
| Fee runtime wiring | `test/v1-fee-runtime-wiring.integration.spec.ts` | 14 |
| Commercial accounting | `test/v1-commercial-accounting-01.integration.spec.ts` | 33 |
| Commission engine / wiring / settlement | `test/v1-commission-01-commission-engine.integration.spec.ts`, `test/v1-commission-runtime-wiring.integration.spec.ts`, `test/v1-commission-settlement-01.integration.spec.ts` | 15 + 24 + 8 |
| Reward engine | `test/v1-reward-01-reward-engine.integration.spec.ts` | 16 |
| Limits | `test/v1-limit-01-limit-catalogue`, `-02-limit-assignment`, `-03-limit-usage`, `-04-limit-runtime`, `-05-diagnostics`, `-05-flow-matrix`, `-05-recovery` (all `.integration.spec.ts`) | 16, 18, 21, 28, 13, 2, 9 |
| Commercial governance | `test/v1-commercial-rule-governance.integration.spec.ts`, `test/commercial-rule-governance.service.spec.ts` | 8 + 10 |
| Scenario matrix | `test/v1-commercial-scenario-matrix-01.integration.spec.ts` | 27 |
| KYC tiers | `test/kyc-tier-decision.unit.spec.ts`, `test/kyc-tier-evidence-reader.unit.spec.ts`, `test/kyc-tier-policy.isolated-pg.test.ts`, `test/kyc-tier-transition.isolated-pg.test.ts`, `test/kyc-tier-limit-enforcement.isolated-pg.test.ts` | 16, 2, 6, 12, 21 |
| Decision snapshots | `test/v1-commercial-decision-0{1,2,3a..3e}*.integration.spec.ts` | 6 suites |
| Banking fee binding | `test/banking-fee-binding.integration.spec.ts`, `test/a6-settlement-lifecycle.integration.spec.ts` | 2 suites |
| Customer eligibility / limits view | `test/customer-eligibility.service.spec.ts`, `test/v1-customer-08-limits-view.integration.spec.ts` | 5 (plus the view spec) |

**Re-run at `6816a760` for this audit** (unit only, no PG):

```
node -r ./test/support/mission-25c-network-guard.cjs ./node_modules/jest/bin/jest.js \
  --runInBand test/kyc-tier-decision.unit.spec.ts \
  test/commercial-rule-governance.service.spec.ts test/customer-eligibility.service.spec.ts
→ Test Suites: 3 passed, 3 total · Tests: 35 passed, 35 total
```

The integration/isolated-PG suites above were **not** re-run here (no disposable cluster in session). They remain the strongest available evidence and they are the reason this audit can describe posting rules so precisely — but a passing suite is not evidence that a feature is *switched on*, which is the distinction §11 draws.

### 12.3 Capability-registry cross-check (claims vs source)

`src/capability-registry/capability.seed.ts` seeds **114 capabilities** with backend/API/UI status fields. It is a curated self-description and was treated as a *claim set*. Where it agrees with source, this audit cites the source, not the registry. Notable agreements: `FEE_ENGINE` = `DISABLED`; `AGENT_COMMISSION`/`AGGREGATOR_COMMISSION`/`CASHBACK`/`TIERED_FEE` = `PLANNED`; `LIMIT_ENGINE`/`LIMIT_PROFILE_CATALOGUE`/`LIMIT_ASSIGNMENT` = `FULLY_ENABLED` with `ADMIN_UI_READY`. One disagreement worth flagging: registry marks `COMMISSION_ENGINE` `BACKEND_IMPLEMENTED` **and** `AGENT_COMMISSION` `PLANNED` — the source shows agent commission is wired but not posted under default configuration, i.e. between those two labels.

---

## 13. Deliverable A — Complete API inventory (commercial scope)

**Route totals (mechanically counted):** 624 handlers across 114 controllers. The table below covers **every endpoint in commercial scope** (KYC/tier, limits, fees, commissions, rewards, products, snapshots, eligibility, agent classes/funding, institutions), plus counts for the non-commercial remainder so nothing is silently omitted.

### 13.1 KYC and tier (39 routes: 33 in `src/kyc-verification/*.controller.ts`, 6 in `src/customer-app/customer-kyc.controller.ts`; plus 2 admin assessment routes on `customer.controller.ts`)

| Method | Route | Controller | Handler / service | Permission | Scope | Status | Test evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/internal/kyc/tier-policies` | `kyc-tier-policy.controller` | `KycTierPolicyService.view` | `kyc.policy.view` + MFA | Workforce | Implemented | `kyc-tier-policy.isolated-pg` |
| GET | `/internal/kyc/tier-policies/proposals` | ″ | `proposals` | ″ | Workforce | Implemented | ″ |
| POST | `/internal/kyc/tier-policies/proposals` | ″ | `propose` | `kyc.policy.propose` (SUPER_ADMIN) | Workforce | Implemented | ″ |
| POST | `/internal/kyc/tier-policies/proposals/:id/approve` | ″ | `decide(true)` | `kyc.policy.approve` (COMPLIANCE) | Workforce | Implemented | ″ |
| POST | `/internal/kyc/tier-policies/proposals/:id/reject` | ″ | `decide(false)` | ″ | Workforce | Implemented | ″ |
| GET | `/internal/kyc/tier-reviews` | `kyc-tier-review.controller` | `reviews` | `kyc.review` | Workforce | Implemented | `kyc-tier-transition` |
| GET | `/internal/kyc/providers` (+ `/history`) | `kyc-provider-governance.controller` | governance run/history | workforce + MFA | Workforce | Implemented | `kyc-provider-governance.isolated-pg` |
| GET/POST | `/internal/kyc/providers/proposals` (+ `/approve`, `/reject`) | ″ | propose/decide | `kyc.provider.*` | Workforce | Implemented | ″ |
| GET | `/customers/me/kyc` | `customer-kyc.controller` | `CustomerKycViewService` | customer session | Customer self | Implemented | `arena4-customer-kyc-view` |
| POST | `/customers/me/kyc/status`, `/availability`, `/consent`, `/consent/withdraw`, `/verification` | ″ | verification lifecycle | customer session | Customer self | Implemented (provider flags off) | ″ |
| POST | `/customers/registration-sessions/…` (start, otp, otp/verify, synthetic-profile, synthetic-profile/status, synthetic-verification, consent, consent/withdraw, availability, verification, status, revoke, customer-kyc/…) | `kyc-registration-session.controller` | registration verification | unauthenticated + in-service authority | Customer pre-auth | Implemented (synthetic path only by default) | `kyc-registration-*` |
| POST | `/customers/registration-sessions/synthetic-complete`, `…/synthetic-credentials[/status]` | `kyc-registration-completion`, `kyc-synthetic-credentials` | synthetic onboarding | scoped token | Pre-auth | Implemented, **non-production** | ″ |
| POST | `/customers/:id/kyc-assessment`, `GET /customers/:id/kyc` | `customer.controller` | `KycTierTransitionService.administrativeAssessment` | `kyc.approve` / `kyc.reject` / `kyc.review` + MFA | Workforce/operator | Implemented | `v1-admin-authorization-kyc-01` |

### 13.2 Limits (26 routes in `src/limit-catalog/*.controller.ts`; plus 5 institution tier-policy routes, `GET /customers/me/limits` on `customer-app.controller.ts:322`, and legacy `POST /limits/evaluate`)

| Method | Route | Handler | Permission | Status |
| --- | --- | --- | --- | --- |
| POST/GET | `/internal/limit-profiles` | `createProfile` / `listProfiles` | `limit.modify` / `limit.view` | Implemented |
| GET/PATCH | `/internal/limit-profiles/:code` | `getProfile` / `updateProfile` | ″ | Implemented |
| POST/GET | `/internal/limit-profiles/:code/rules` | `createRule` / `listRulesByProfile` | ″ | Implemented |
| GET | `/internal/limit-rules`, `/internal/limit-rules/:id` | `listRules` / `getRule` | `limit.view` | Implemented |
| PATCH | `/internal/limit-rules/:id` | `updateRule` | `limit.modify` | Implemented |
| POST/GET | `/internal/limit-assignments` | `create` / `list` | `limit.modify` / `limit.view` | Implemented |
| GET | `/internal/limit-assignments/profile/:code`, `/customer/:id`, `/agent/:id`, `/agent-class/:id`, `/segment/:code` | list-by-subject | `limit.view` | Implemented (segment listing works; **runtime matching does not**) |
| GET/PATCH | `/internal/limit-assignments/:id` | `get` / `update` | ″ | Implemented |
| GET | `/internal/limit-usages`, `/internal/limit-reservations` | `LimitDiagnosticsService` | `limit.view` | Implemented |
| POST | `/internal/limit-reservation-recovery/release` | `LimitReservationRecoveryService` | `limit.modify` | Implemented (capability registry labels this `BLOCKED`; source is callable) |
| GET | `/internal/institutions/:institutionId/kyc-tier-limit-policy` (+ `/proposals`, POST propose/approve/reject) | `InstitutionKycLimitPolicyService` | institution + workforce | Implemented, **no console UI** |
| GET | `/customers/me/limits` | `CustomerLimitViewService` | customer session | Implemented (5 wired product/direction combos) |
| POST | `/limits/evaluate` | legacy `LimitEngine` | — | Implemented, stateless diagnostic |

### 13.3 Fees, commissions, rewards, products, snapshots (39 routes: fee-rules 7, legacy fee 1, commission 7, reward 7, products 6, product-governance 9, snapshots 2)

| Method | Route | Controller | Permission | Status |
| --- | --- | --- | --- | --- |
| GET | `/internal/fee-rules`, `/:id`, `/resolve` | `fee-rule-registry` / `fee-rule-resolver` | `fee_rule.view` | Implemented |
| POST | `/internal/fee-rules` (governed request) | registry | `fee_rule.create` | Implemented — writes nothing |
| POST | `/internal/fee-rules/changes/:approvalId/execute-create` | registry | `fee_rule.create` + approval | Implemented |
| PATCH | `/internal/fee-rules/:id` (governed request) | registry | `fee_rule.modify` | Implemented |
| POST | `/internal/fee-rules/changes/:approvalId/execute-modify` | registry | `fee_rule.modify` + approval | Implemented |
| POST | `/fees/calculate` | `fee.controller` | none (stateless) | Implemented, unwired |
| GET/POST/PATCH + 2 execute routes | `/internal/commission-rules…` | commission registry/resolver | `commission_rule.*` | Implemented |
| GET/POST/PATCH + 2 execute routes | `/internal/reward-rules…` | reward registry/resolver | `reward_rule.*` | Implemented |
| GET | `/internal/products`, `/internal/products/:code` | `product-catalog.controller` | `product.view` | Implemented |
| POST/PATCH + 2 execute routes | `/internal/products…` | ″ | `product.modify` + approval | Implemented |
| POST/GET/PATCH | `/internal/product-governance/records`, `…/report`, `…/readiness`, `…/configuration` | `product-governance.controller` | `product.governance` | Implemented |
| GET | `/internal/commercial-decision-snapshots`, `/:id` | snapshot controller | workforce | Implemented |

### 13.4 Customer eligibility (14 routes, `src/customer-eligibility/customer-eligibility.controller.ts`)

`POST/GET/PATCH /customers/:id/eligibility`, `…/limit-profile`, `…/product-enrollment[s]`, `…/permission[s]`, `…/restriction[s]`, `GET …/operating-status`. All implemented, audited, admin-scoped. **None is consulted by the transaction path** (§2.8).

### 13.5 Agent (commercial subset of 62 routes, `src/agent/*`, `src/admin/*`, `src/aggregator/*`)

| Group | Routes | Notes |
| --- | --- | --- |
| Agent classes | 4 (`POST/GET/GET :id/PATCH :id` on `/internal/agents/classes`) | Full CRUD, audit, version; **no class-assignment endpoint** |
| Agent applications | 9 (`agent-application-public.controller.ts` 4; `agent-application-admin.controller.ts` 5) | `agentClassId` required on create; approval/activate |
| Agent lifecycle | 5 (`internal/agents/:id/{activate,suspend,reactivate,terminate}`, applications activate) | Workforce functions `agent.*` |
| Agent funding | 10 (`agent-funding.controller.ts`, §4.7) | Maker/checker + limits |
| Cash flows | 15 (cash-in 1, cash-out 4, cash-to-cash 1, claim 4, cancellation 1, expiry-status 1, operations 1, handoff 1, recovery 1) | Limits + fee/commission evidence |
| Cash reconciliation | 5 (cash-out 2, cash-to-cash 3) | Read-only reconciliation evidence |
| Agent-facing | 9 (`agent-app.controller.ts`) + desk OTP 1, receiving number 2, recipient resolution 2 | Capability decisions surfaced |
| Aggregator | 11 (`aggregator.controller.ts`) | Lifecycle + relationships; **no aggregator commercial config** |

### 13.6 Institutions (35 routes, `src/institution/*`)

Lifecycle (`register`, `evidence`, `lifecycle/request`, `lifecycle`), affiliations (`aggregators` link/unlink, `workforce` grant/revoke/list), enrolments (`/internal/institutions/:id/enrolments[/execute]`), wallet attributions (`/wallet-attributions[/execute]`), ledger accounts (`/ledger-accounts`, `/platform-accounts`), coverage/queries (`unattributed`, `coverage`, `customers/:customerId`, `wallets/:walletId`, `validate`), directory + pending approvals, attribution gaps. All implemented; all maker/checker or read-only as applicable.

### 13.7 Non-commercial remainder (counts only)

customer-app 39 · customer-authentication 32 · admin 29 · outlet 19 · customer 19 · support 18 · banking 18 · notification 16 · authorization 15 · operations 13 · maturity 13 · customer-compliance 11 · customer-onboarding 10 · customer-funding 10 · agent-authentication 10 · product-governance 9 · customer-registration 9 · ledger 8 · dashboard 8 · withdrawal 7 · wallet 7 · customer-wallet 7 · proof-of-address 7 · funding-instrument 7 · customer-beneficiary 7 · deposit 6 · virtual-account 5 · reconciliation 5 · risk-profile 5 · beneficiary 5 · bank 5 · quote 4 · production 4 · policy 4 · recovery 3 · prefs 4 · transfer 3 · capability 3 · support-auth 2 · health 2 · partner 1 · local-admin-auth 1 · financial-commitment 1.

---

## 14. Deliverable B — Commercial capability matrix

Status vocabulary: **LIVE** (enforced/affects money) · **ACTIVE-EVIDENCE** (computed + recorded, posting gated) · **DEFINED** (schema/API, no runtime effect) · **UNWIRED** · **ABSENT**.

| Capability | Customer | Agent | Aggregator | Partner | Institution |
| --- | --- | --- | --- | --- | --- |
| Identity / KYC tier | **LIVE** (tier + eligibility gate) | Agent onboarding (no KYC tier) | Entity lifecycle only | Callback only | Registration → evidence → APPROVED lifecycle |
| Class concept | **ABSENT** | `AgentClass` **LIVE** (services gate) | **ABSENT** | **ABSENT** | **ABSENT** (service-class keys in tier policy only) |
| Service permissions | Operating permissions **DEFINED (unwired)** | `applicable_services` **LIVE** | — | — | — |
| Limits | **LIVE** (5 products/directions) | **LIVE** (5 products/directions) | **ABSENT** | **ABSENT** | Tier-mapped profiles **LIVE (gated)** |
| Fees | **ACTIVE-EVIDENCE** (4 products) | **ACTIVE-EVIDENCE** (funding: never posted) | **ABSENT** | **ABSENT** | **ABSENT** |
| VAT | **ACTIVE-EVIDENCE** | ″ | **ABSENT** | **ABSENT** | **ABSENT** |
| Commission | **ABSENT** (not a recipient) | **ACTIVE-EVIDENCE** (posting gated) | **DEFINED, refused by accounting** | **ABSENT** | **ABSENT** |
| Cashback / rewards | **DEFINED (engine unwired)** | **DEFINED (engine unwired)** | **ABSENT** | **ABSENT** | **ABSENT** |
| Funding / wallet operations | Funding requests **LIVE** | Fund/defund **LIVE**; float funding via aggregator/institution | Pass-through funding routes | — | Institution float funding (migration `0605`) |
| Statements / billing | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** (B1 billing engine is decision-documents only) |
| Governance of config | — | Limits direct; funding maker/checker | — | — | Lifecycle/enrolment/attribution maker/checker; tier policy own flow |

---

## 15. Deliverable C — Financial execution matrix

See §11.2 for the per-flow table (Limits / Fees / Taxes / Commissions / Cashback / Rewards, each marked N/D/C/E/L/S/R). Summary of the execution boundaries:

| Stage | Fees | VAT | Commissions | Rewards |
| --- | --- | --- | --- | --- |
| Definition | ✅ `fee_rules` | ✅ `vat_bps` on fee rule | ✅ `commission_rules` | ✅ `reward_rules` |
| Calculation | ✅ in-transaction | ✅ in-transaction | ✅ in-transaction | ⛔ engine never called |
| Enforcement (can abort) | ⛔ fees never abort a flow — only accounting blockers do | ⛔ same | ✅ AMBIGUOUS / BASE_UNAVAILABLE abort | ⛔ |
| Ledger posting | ⚠️ gated (`COMMERCIAL_ACCOUNTING_ENABLED`) | ⚠️ gated + treatment + rate required | ⚠️ gated | ⛔ no family |
| Settlement/paid | ⛔ (customer-paid at posting) | ⛔ | ⚠️ netting only; accrual has **no rail** | ⛔ |
| Reversal | ⚠️ journal reversal only | ⚠️ same journal | ⚠️ same journal; no clawback | ⛔ |

---

## 16. Deliverable D — Admin console coverage

### 16.1 Existing screens relevant to commercial configuration

| Screen | Endpoints used | Mutating? | Covers |
| --- | --- | --- | --- |
| `AgentClassesScreen.tsx` | `/internal/agents/classes` (GET/POST/PATCH) | **Yes** (create/update) | Agent class definitions incl. JSONB fields |
| `AgentClassAssignmentPanel.tsx` | none (props only) | No | Displays an agent's class; **no reassignment** |
| `LimitAssignmentScreen.tsx` | `/internal/limit-assignments*`, `/internal/limit-usages`, `/internal/limit-reservations`, `/internal/agents/classes` | **Yes** (create/update assignment) | Assignment + diagnostics |
| `CommercialRulesScreen.tsx` | `/internal/fee-rules`, `/internal/commission-rules`, `/internal/reward-rules`, `/internal/limit-profiles`, `/internal/limit-rules`, `/internal/products` | **No — read-only** (source comment: "The catalogue is read-only") | Fees, commissions, rewards, products, limit catalogue (review) |
| `KycTierPolicyManagementScreen.tsx` | `/internal/kyc/tier-policies*` | **Yes** (propose/approve) | Tier policy maker/checker with evidence pickers |
| `KycProviderManagementScreen.tsx` | `/internal/kyc/providers*` | **Yes** (propose/approve) | Provider routing governance |
| `CustomerTier3ReadinessPanel.tsx` | customer KYC view | No | Tier-3 evidence readiness |
| `InstitutionWorkspaceScreen.tsx`, `InstitutionRelationshipTabs.tsx` | `/internal/institutions*` incl. enrolments/attributions/workforce | **Yes** | Institution lifecycle/relationships |
| `AgentFundingPanel.tsx`, `PendingFundingApprovalsQueue.tsx` | `/internal/agents/:id/{fund,defund}`, `/internal/agents/funding-requests` | **Yes** | Fund/defund + queue |
| `ApprovalsScreen.tsx` | `/internal/a2/workforce/approvals/:id/approve` (and `/reject`) | **Yes** | Acts on an approval **id it must already know** |
| `Customer360Workspace.tsx` | customer/admin reads | Mixed | Customer facts incl. tier/limits |

### 16.2 Coverage classification

| Capability | Interface state |
| --- | --- |
| Agent class CRUD | **Full** |
| Limit profiles/rules authoring | **Partial** — read-only in catalogue; no create/edit form |
| Limit assignment | **Full** (create/update) |
| Limit usage/reservation diagnostics | **Full** (read) |
| KYC tier policy authoring/approval | **Full** |
| KYC provider governance | **Full** |
| KYC review queue | **Nav entry exists; review actions not surfaced as a commercial queue** |
| Fee / commission / reward rule authoring | **Missing** (read-only catalogue; governed APIs exist) |
| Product catalogue authoring | **Missing** (read-only list) |
| Institution KYC tier-limit policy | **Missing** (full API exists) |
| Commercial decision snapshots | **Missing** (read API exists) |
| Customer eligibility / permissions / restrictions | **Missing** in console (APIs exist) |
| Customer classes | **Not applicable** (no capability) |
| Commission payable / settlement | **Missing** (and no backend settlement rail) |
| Approvals discovery | **Broken as a workflow** — no listing endpoint |

---

## 17. Deliverable E — Gaps and dependency classification

### 17.1 Fully implemented and tested (safe to rely on)

1. Limit catalogue + assignment + usage/reservation + enforcement in 6 paths.
2. KYC tier decision, policy publishing, transition planning, automatic worker, eligibility gate.
3. Institution KYC tier → limit-profile governance with digest binding.
4. Fee rule registry + resolver + calculator + governed change.
5. Commission rule registry + resolver + calculator + engine wired into 4 flows.
6. Reward rule registry + resolver + calculator + engine (mechanics only).
7. Commercial decision snapshots across 6 flows.
8. Commercial accounting posting (gated).
9. Maker/checker for fee/commission/reward/product + agent funding + ledger reversal + institution actions.
10. Agent class CRUD + `applicable_services` capability gating.
11. Product catalogue + 7-product seed.
12. Institution lifecycle/enrolment/attribution/ledger scoping.

### 17.2 Implemented but not exposed in the admin console

1. Fee/commission/reward/product rule authoring (governed APIs).
2. Institution KYC tier-limit policy.
3. Commercial decision snapshot explorer.
4. Product create/update.
5. Limit profile/rule create/update.
6. Customer eligibility/permission/restriction administration.
7. KYC tier review actions.
8. Agent class reassignment (also **no API**).

### 17.3 Partially implemented

1. **Fees:** engine + registry + posting, but no fee on withdrawal/deposit/bank paths, no tiered pricing, no customer/class/institution targeting, no fee-specific reversal.
2. **Commission:** agent accrual/netting only; aggregator/platform refused; no settlement rail; no clawback; no reconciliation report; no cumulative caps.
3. **Rewards:** complete machinery, zero wiring.
4. **Limits:** no min-balance, no velocity, no ambiguity detection, SEGMENT unreachable, `applicable_limits` unused.
5. **Customer classes:** absent (§3).
6. **VAT:** calculation + posting, no rate catalogue, exemptions, reporting or remittance.
7. **Approvals:** mechanics complete, discovery missing.
8. **Agent class change:** no path.

### 17.4 Defined but not financially operational

1. `customer_eligibility`, `customer_operating_permissions`, `customer_restrictions`, `customer_product_enrollments`, `customer_limit_profiles` (legacy) — CRUD, not enforced.
2. `limit_assignments.SEGMENT` — resolver support, no producer of segment codes.
3. `agent_classes.applicable_limits`, `requirements`, `required_information`, `required_document_categories` — stored, not enforced.
4. `payment_quotes` fee/VAT — caller-supplied.
5. `transfers.fee_minor/vat_minor`, `cash_to_cash_transfers.fee_minor/vat_minor` — always zero.
6. `BankingFeeBindingService` — implemented, tested, uncalled.
7. B1/B2/B2F decision engines — loaded at boot, no HTTP surface, no flow wiring.
8. A7 virtual-account inbound funding — stub authorities.
9. Reward engine — as above.

### 17.5 Not implemented

1. Customer classes of service (any form).
2. Tiered/progressive/volume/usage-based **fees**.
3. Class-, customer- or institution-specific **pricing**.
4. Discounts, waivers, coupons as first-class objects.
5. Tax beyond fee-VAT: rate catalogue, exemptions, reporting, filing, remittance, withholding, excise.
6. Commission settlement rail; commission tax treatment; commission clawback; per-beneficiary payable sub-ledger.
7. Cashback crediting/expiry/clawback/abuse controls.
8. Bank transfers to external banks (NIP), bill payments, airtime, cards, POS.
9. Approval inbox/listing.
10. Maker/checker for limit catalogue mutations.
11. Min-wallet-balance, velocity/burst limits.
12. A general simulation/what-if engine (only per-resolver previews exist).

### 17.6 Intentionally blocked by policy or external dependency

1. `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=false` — waits on institution policy approval + provider/evidence sign-off; production **fails closed** rather than degrading.
2. `COMMERCIAL_ACCOUNTING_ENABLED=false` — waits on VAT treatment/rate and commission treatment/timing decisions.
3. KYC provider live calls — wait on contract review (`KYC_PROVIDER_CONTRACTS_REVIEWED=false`).
4. A7 inbound funding — waits on a real admission/execution authority implementation.
5. Aggregator & platform commission posting — waits on approved accounting families (D-C-009 / D-C-010).
6. `CONTRA_REVENUE` commission treatment — not technically supportable under normal-balance enforcement.
7. Banking outbound fee product choice — deliberately refused ("no approved answer").

---

## 18. Deliverable F — Proposed unified configuration design

> **Everything in §18.1 exists today. Everything in §18.2 is proposed and requires decisions. Nothing here was implemented.**

### 18.1 What can be composed immediately from existing primitives (no backend change)

A single **Commercial Configuration** workspace with ordered editors, each backed by an existing API:

| Module | Backed by | State |
| --- | --- | --- |
| **1. Products** | `/internal/products*` | List exists; authoring screens needed (governed) |
| **2. Limit catalogue** | `/internal/limit-profiles*`, `/internal/limit-rules*` | Create/edit screens needed |
| **3. Limit assignments** | `/internal/limit-assignments*` | **Exists** |
| **4. KYC tier policy** | `/internal/kyc/tier-policies*` | **Exists** |
| **5. Institution tier→limit policy** | `/internal/institutions/:id/kyc-tier-limit-policy*` | Editor needed |
| **6. Fee rules** | `/internal/fee-rules*` + `…/resolve` | Authoring + preview UI needed |
| **7. Commission rules** | `/internal/commission-rules*` + `…/resolve` | ″ |
| **8. Reward rules** | `/internal/reward-rules*` + `…/resolve` | ″ (with an explicit "engine not wired" banner) |
| **9. Effective preview** | `resolve` endpoints, `POST /limits/evaluate`, `POST /fees/calculate` | Assembled UI only |
| **10. Approvals** | ❌ **blocked** — no listing endpoint | Requires a read-only backend addition |
| **11. Decision audit** | `/internal/commercial-decision-snapshots` | Explorer needed |

Two design rules that follow from what the backend actually does:

- **Do not invent a "draft" toggle.** Rules activate by effective date + `is_active`; a second governed change is required to activate. The UI should present "scheduled / active / expired / disabled" computed from those fields rather than pretending a draft exists.
- **Do not present preview results as commitments.** Resolver endpoints answer "what would apply now"; posting depends on the accounting flags and, for limits, on the flow's own enforcement mode.

### 18.2 Proposed additions (each needs a product-owner decision)

| # | Proposal | Why it is not a rebuild | Decision required |
| --- | --- | --- | --- |
| F1 | **Approval discovery endpoint** `GET /internal/approvals?action=&status=&resource=` (read-only, workforce + MFA) | Reuses `PrivilegedActionApprovalService` storage; institution listing already proves the pattern | Approve backend addition |
| F2 | **Customer class entity** (if wanted): `customer_classes` + `customer_class_assignments` + audit/version | Fits beside `agent_classes`; reuses the audit/version conventions | Whether classes exist at all |
| F3 | **Class/institution pricing**: extend `fee_rules` with optional `customer_class_id` / `institution_id` targeting (nullable, at-most-one, like `commission_rules`) | The resolver/calculator already handle targeting precedence for commission; the fee resolver would gain the same rule and AMBIGUOUS semantics | Whether class/institution pricing is in scope |
| F4 | **Limit-governance parity**: route `limit.modify` through `CommercialRuleGovernanceService` | The governance service is rule-type agnostic; `limit.*` function codes already exist | Whether limits become maker/checker |
| F5 | **Tiered fees**: add a `tiers` JSONB to `fee_rules` and mirror `CommissionCalculator`'s marginal logic | Commission/reward already implement marginal tiers; the fee calculator is pure and small | Whether tiered pricing is needed |
| F6 | **VAT rate catalogue** (`tax_rates` with jurisdiction/product/exemption + effective dates) | Replaces a per-rule column with a governed catalogue; accounting already resolves families | Legal applicability, rate, exemptions |
| F7 | **Commission settlement rail** (payable → agent wallet/bank) | Payable family and per-agent attribution already exist; needs a governed payout action | Treatment/timing + rail choice |
| F8 | **Reward wiring**: call `RewardEngine` in the four flows + a reward ledger family + grant records with expiry/clawback | Engine and snapshot shape are done | Whether rewards launch; funding source |
| F9 | **Tax reporting view** | Pure aggregation over existing journals/families | Reporting requirements |
| F10 | **Customer-facing price disclosure** | `transfers.fee_minor/vat_minor` and snapshot fee decisions already exist to read | Disclosure requirements |

### 18.3 Recommended sequencing (configuration first, then pricing)

1. **Expose what exists** (read-only first): product catalogue, fee/commission/reward rule lists, effective preview, decision snapshots, institution tier-limit policy viewer.
2. **Add authoring** for the governed rule families, plus F1 (approval discovery) — else authoring is unusable end-to-end.
3. **Decide classes** (§3) before building any class editor or class pricing; if classes are required, do F2+F3 together so pricing and limits land on the same concept.
4. **Decide VAT/commission treatment** before enabling `COMMERCIAL_ACCOUNTING_ENABLED`; enabling it without a rate/treatment fails closed by design (and is the correct behaviour).
5. **Only then** consider F5/F7/F8 (new pricing shapes, settlement, rewards).

---

## 19. Deliverable G — Source evidence index

### 19.1 KYC

| Claim | Source |
| --- | --- |
| Tiers, evidence vocabulary, hard floor, Tier-3 rule | `src/kyc-verification/kyc-tier-decision.ts` |
| Policy shape, validation, two layers | `kyc-tier-decision.ts:40-52`, `kyc-tier-policy.service.ts:33-100` |
| Proposal lifecycle, roles, replay | `kyc-tier-policy.service.ts:196-323` |
| Evidence provenance binding | `kyc-tier-evidence.reader.ts:26-83` |
| Provider selection, no fallback | `kyc-provider-router.ts` |
| Provider adapters/flags | `monnify-kyc.provider.ts`, `dojah-kyc.provider.ts`, `config/environment.ts:176-227` |
| Automatic re-evaluation | `kyc-tier-worker.service.ts:19-97`, `kyc-tier-transition.service.ts:198-442` |
| Upgrade/downgrade planning | `kyc-tier-decision.ts:290-327` |
| Financial eligibility gate | `customer-financial-eligibility.service.ts:19-105` |
| Institution tier→limit policy | `limit-catalog/institution-kyc-limit-policy.service.ts:86-500` |

### 19.2 Limits

| Claim | Source |
| --- | --- |
| 11 dimensions, scopes, kinds | `limit-catalog/limit-catalog.enums.ts:1-90` |
| Failure codes | `limit-catalog/limit-error.codes.ts` |
| Profile/rule/assignment entities | `limit-profile.entity.ts`, `limit-rule.entity.ts`, `limit-assignment.entity.ts`, `limit-usage.entity.ts`, `limit-reservation.entity.ts` |
| Resolution + precedence | `limit-profile-resolver.service.ts:25-130` |
| Enforcement algorithm, tier mode | `limit-enforcement.service.ts:120-777`, `:129-144` |
| Windows (Lagos) | `limit-window.util.ts` |
| Usage/reservation accounting | `limit-usage.service.ts` (714 lines) |
| Recovery | `limit-reservation-recovery.service.ts` |
| Customer-visible view | `customer-limit-view.service.ts:1-120` |
| Segment inertness | `limit-enforcement.service.ts:27,212` + zero call sites for `segmentCodes` |

### 19.3 Fees / VAT / accounting

| Claim | Source |
| --- | --- |
| Fee rule schema + constraints | `fee-rules/fee-rule.entity.ts` |
| Resolution + ambiguity | `fee-rules/fee-rule-resolver.service.ts:1-221` |
| Calculation models, clamps, VAT, evidence | `fee-rules/fee-rule-calculator.service.ts:47-190` |
| Legacy engine | `fee/fee.engine.ts`, `fee/fee.types.ts` |
| Posting + VAT treatments + blockers | `commercial-accounting/commercial-accounting.service.ts:100-500` |
| Config flags + fail-closed reads | `commercial-accounting/commercial-accounting-config.service.ts` |
| VAT_PAYABLE family | `migrations/1785753600076-ProvisionV1CommercialAccountingFamilies.ts` |
| Fee columns always zero | `migrations/1785753600075-AddTransferFeeColumns.ts`, `agent-cash-to-cash.service.ts:353-354` |
| Caller-priced quotes | `quote/quote.types.ts:3-13`, `payment-quote.entity.ts` |
| Banking fee binding (unwired) | `banking/banking-fee-binding.service.ts:72-310` |

### 19.4 Commissions / rewards

| Claim | Source |
| --- | --- |
| Recipient types, models, tiers, targeting | `commission/commission-rule.entity.ts:27-160` |
| Resolution semantics | `commission/commission-rule-resolver.service.ts:1-264` |
| Engine | `commission/commission.engine.ts`, `commission.calculator.ts` |
| Call sites (agentId/classId, aggregatorId null) | `agent-financial-execution.service.ts:646-690`, `agent-cash-to-cash.service.ts:1097-1145`, `agent-funding.service.ts:1420-1470`, `transfer.service.ts:800-830` |
| Aggregator/platform refusal | `commercial-accounting.service.ts:307-320` |
| Settlement absence | `commercial-accounting.service.ts:380-392`; `test/v1-commission-settlement-01.integration.spec.ts:1-25` |
| Reward vocabulary | `reward/reward-rule.entity.ts:32-70` |
| Reward unwired | `reward/reward.module.ts:14-26` |
| Reward status always NONE | `commercial-decision/commercial-decision.defaults.ts`, `transfer.service.ts:892` |
| B1 engines don't execute cashback | `policy/b1-campaign-engine.service.ts:22-26,83`, `policy/b1-fee-engine.service.ts:1-70` |

### 19.5 Governance / admin / product

| Claim | Source |
| --- | --- |
| Governed actions, roles, MFA, limits ungoverned | `authorization/governed-action.registry.ts:65-200` |
| Maker/checker mechanics | `authorization/commercial-rule-governance.service.ts:1-120` |
| Approval service (no list) | `authorization/privileged-action-approval.service.ts:56-60` |
| Route policies for commercial families | `authorization/route-policy-registry.ts:1429-1545`, `:1673-1680` |
| Function codes per endpoint | `fee-rule-registry.controller.ts`, `commission-rule-registry.controller.ts`, `reward-rule-registry.controller.ts`, `product-catalog.controller.ts`, `limit-catalog.controller.ts` |
| Product catalogue + seed | `product-catalog/product.entity.ts`, `product-catalog.seed.ts` (7 codes) |
| Capability registry claims | `capability-registry/capability.seed.ts` (114 entries) |
| Admin screens/endpoints | `apps/admin-web/src/screens/authenticated/*.tsx`, `Layout.tsx:318-460`, `CommercialRulesScreen.tsx:142` |

---

## 20. Final statements

1. **No application code, migration, schedule, configuration or navigation was changed by this audit.** Only this document was added.
2. **Nothing here should be read as approval to enable any flag.** Enabling `COMMERCIAL_ACCOUNTING_ENABLED` or `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` without the corresponding approved rates, treatments and institution policies would either collect money on invented terms or refuse to serve customers — both fail-closed paths exist precisely to prevent that.
3. **No fee, rate, threshold, provider, tax rate or commission was invented** in this document. Where a number does not exist, the document says so.
4. **Customer classes remain absent.** Any plan that assumes they exist, or that assumes agent classes can stand in for them, is based on a misreading of the codebase.
5. **The commercial stack is further along than "nothing exists" and shorter than "it is ready".** Limits and KYC are genuinely operational; fee/VAT/commission are computed, governed and gated; rewards are machinery without a switch; taxes beyond VAT, customer classes, aggregator commission, settlement and reporting do not exist.
