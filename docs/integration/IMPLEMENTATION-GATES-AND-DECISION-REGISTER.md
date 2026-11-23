# Implementation Gates & Decision Register — P1–P5 Execution
**Branch** `arena/1f37a4f3-monienaija @ 36ebcba7` → `arena/5-main-web-audit` + `arena/5-main-web-integration @ 36ebcba7` · **App candidate** `e9e5651d` · 166 migrations
**Reconciled inventory:** 8 sections / 33 routable (32+1) / 21-8-4-0 · `MAIN-WEB-PRIORITY-PLAN-P2-P5.md` remains commercial audit
**Direction in this document:** strict KYC/limit enforcement in non-prod, automatic CoS assignment evidence, mobile self-registration plan, automatic-POS separation, fees/commissions spec to collection
**Financial engine:** frozen — no `src/ledger|reconciliation|commercial-accounting|banking|transfer` change without demonstrated defect

---

## 1. KYC & Limit Enforcement

### 1.1 Non-production: enable strict enforcement now
`KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=true` in every acceptance environment (`integration`, `staging`, `infra03` harness). Verified behaviour:

- `LimitEnforcementService.resolveTierEnforcement()` returns `ENFORCED` when `requireKycTierPolicy=true` and flag true — missing `customer-financial-eligibility` or `tierLimitPolicies` dependency throws configuration exception, never silently downgrades.
- `CustomerFinancialEligibilityService.require()` validates all 7 gates inside a single `FOR UPDATE`/`FOR SHARE` transaction: customer row `status=ACTIVE`, `kyc_status=APPROVED`, `kyc_level ∈ LEVEL_1-3`, policy `effective(now)` exists, no `kyc_tier_manual_holds`, no `kyc_identity_conflicts`, exactly one verified primary `PHONE`, trusted `KycTierEvidenceReader` source present, `decideTier()` returns `ELIGIBLE` at rank ≥ approved level, and one current non-expired `customer_kyc_assessments` row matches.
- `InstitutionKycLimitPolicyService.enforcementEnabled` is the flag getter; when true, any requested tier-bound admission that cannot resolve a mapping fails closed (`ServiceUnavailable` for missing policy, `ConflictException` for ineligible tier) — no legacy permissive fallback.

**Operational step (Arena 5):** commit `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=true` to `infra/portable-acceptance/.env.acceptance.example` and to `docker-compose.yml` `api` environment alongside existing `COMMERCIAL_ACCOUNTING_ENABLED=false` (still inert). No production `.env` change.

### 1.2 Production: backfill → diagnostics → migration → controlled enablement plan (do not enable yet)

Production today runs with flag `false` (default) → `resolveTierEnforcement()` returns `LEGACY_UNENFORCED` for any call that passes `requireKycTierPolicy=true`. That is intentionally permissive and **not the final design** — it exists only until backfill is proven. The plan:

| Step | Action | Owner | Evidence | Gate |
|---|---|---|---|---|
| **D-1 Diagnostics** | Extend `LimitDiagnosticsService` + `InstitutionKycLimitPolicyService.view()` to report: (a) every `customers` row with `status=ACTIVE` where `LimitProfileResolver.resolve(CUSTOMER)` returns `null` or disabled profile; (b) every `agents` row where `resolve(AGENT)` with `agentClassId` returns null/disabled; (c) every institution with zero `institution_kyc_limit_policy_heads` version or stale `profileDigest` after a generic limit edit; (d) any `kyc_level` with no tier mapping for `product=TRANSFER|DEPOSIT|WITHDRAWAL` × `currency=NGN` × `serviceClass=null`. Surface in `SystemHealthScreen` (Arena 4) or `LimitDiagnostics` endpoint, never block financial flows yet. | Arena 3 (diagnostics) + Arena 5 (institution policy view) | `GET /internal/limit-diagnostics` + `GET /internal/institutions/:id/kyc-tier-limit-policy` payloads | Backfill cannot start until diagnostics shows the exact scope of missing |
| **D-2 Backfill** | For every customer/agent already in `ACTIVE`/`DRAFT` with no assignment, rely on **existing resolver inheritance** — do not insert per-entity rows if a valid `GLOBAL` or `AGENT_CLASS` assignment already covers them (see §2). Where truly uncovered, create `GLOBAL` NGN profile `CUSTOMER_GLOBAL_NGN_V1` and `AGENT_GLOBAL_NGN_V1` with conservative `MIN/MAX` + `DAILY/WEEKLY/MONTHLY` rules matching current CBN tier guidance, approved via `FINANCE_PREPARER→CONTROLLER` maker/checker and recorded with `profileCode`+`version`+`profileDigest`. For institution tier mappings, draft one policy per live institution with `REGULATORY`+`OPERATOR` pairs per tier (LEVEL_1-3) via `POST /internal/institutions/:id/kyc-tier-limit-policy/proposals → approve` with `kyc.policy.propose/approve` MFA. | Arena 3 (catalogue/rules) + Arena 5 (tier policy) | Approved `limit_profiles` + `limit_rules` + `limit_assignments` rows + `institution_kyc_limit_policy_versions.version` + `profileDigest = sha256(canonical(profileCode+rules))` | Backfill complete only when D-1 diagnostics returns zero uncovered for critical `TRANSFER_NGN` paths |
| **D-3 Migration** | Run the backfill inside a single `SERIALIZABLE` transaction per institution that verifies the new policy digest matches the actual `limit_profiles` row at `effectiveFrom`; any mismatch aborts. Preserve audit trail: `kyc_tier_policy` decisions log `maker_id, checker_id, requestId, version, maker, definition` with canonical hash. | Arena 5 (with 3) | `audit.events` rows `KYC_TIER_POLICY_PROPOSED|APPROVED` | Migration replayable — re-run produces `CONFLICT` if already backfilled |
| **D-4 Controlled enablement** | Flip `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=true` in production only after D-1 shows zero critical uncovered **and** the acceptance harness has proven §6 gates 1/2/4/6/7 with flag true in integration. After enablement, the rule is: **a missing or invalid mandatory policy must prevent the affected financial operation** — `LimitEnforcementService.enforceWithManager()` throws `LimitFailureCode.MISSING_TIER_POLICY` (mapped to HTTP 409/422), never a permissive pass. `CustomerFinancialEligibilityService.require()` throws `ConflictException` for tier mismatch. `InstitutionKycLimitPolicyService` in production never returns `LEGACY_UNENFORCED` when tier enforcement was requested — it throws `configurationException` instead. | Arena 5 (flag) + all | Flag commit + runbook update + `maturity` acceptance report | Requires explicit owner authorization (see §7 decision 1) — do not enable via infra drift |

No financial flow is allowed to invent a permissive tier when no policy exists. The legacy path is explicitly a non-production tolerance, not a final design.

---

## 2. Automatic Class-of-Service Assignment — proven without per-entity rows where resolver is deterministic

**Product outcome required:** every newly onboarded customer and agent automatically resolves to the correct tier, class, permissions, fees and limits without an operator manually assigning each account.

**Does not require a dedicated `limit_assignments` row per customer/agent** if the existing resolver deterministically inherits an approved active policy. The proof must be explicit.

### 2.1 Resolver contract (existing, preserved)

`LimitProfileResolverService.resolve(manager, { principalType, principalId, agentClassId, segmentCodes, now })` evaluates against **all** `is_active=true AND deleted_at IS NULL AND effective_from ≤ now < effective_to` rows, then selects by `ORDER BY precedence DESC, effective_from DESC, created_at DESC LIMIT 1`. Candidates:

- `GLOBAL` — always candidate
- `CUSTOMER` where `principalType=CUSTOMER` AND `subjectId=principalId`
- `AGENT` where `principalType=AGENT` AND `subjectType=AGENT`
- `AGENT_CLASS` where `agentClassId` supplied AND `subjectType=AGENT_CLASS`
- `SEGMENT` where `segment_code IN (...segmentCodes)`

The chosen `limit_profile_code` must still map to an `enabled=true, status=ACTIVE, deleted_at IS NULL` `limit_profiles` row; otherwise treated as no assignment (see §1.2 diagnostics). Institution tier binding then selects via `InstitutionKycLimitPolicyService.effectiveTierMapping(institutionId, product, currency, serviceClass, tier) → profileCode (+ profileDigest)`.

### 2.2 Evidence contract (what Arenas 1/2 must record on every onboarding)

For each new customer/agent, the onboarding response (or an immediate follow-up `GET /internal/limit-diagnostics` / `GET /internal/institutions/:id/kyc-tier-limit-policy` read) must carry:

```
effectiveConfiguration: {
  customerId | agentId,
  kycTier: "LEVEL_1"|"LEVEL_2"|"LEVEL_3",           // from customers.kyc_level / KycTierDecision
  institutionId: "<uuid>",                         // from institution context
  serviceClass: null | "<code>",                   // agent: agentClass.code; customer: null
  limitProfileCode: "<code>",                      // from resolver
  limitProfileVersion: 7,
  profileDigest: "sha256:<hex>",                   // canonical hash of profileCode + active rules at effectiveFrom
  assignmentId: "<uuid>" | null,                   // null when inherited via GLOBAL/AGENT_CLASS — still valid
  subjectType: "GLOBAL"|"AGENT_CLASS"|"CUSTOMER"|"AGENT",
  ruleVersions: [                                  // snapshot of evaluated dimensions for this product/currency
    { dimension: "MAX_AMOUNT_PER_TX", limitValueMinor: "5000000", ruleId: "<uuid>", version: 3 },
    { dimension: "DAILY_AMOUNT", ... },
    { dimension: "WEEKLY_AMOUNT", ... },
    { dimension: "MONTHLY_AMOUNT", ... },
    // counts where applicable
  ],
  feeRuleId: "<uuid>" | null,                      // FeeRuleResolver RESOLVED/NOT_CONFIGURED (never invented)
  feeRuleVersion: number | null,
  commissionRuleId: "<uuid>" | null,               // CommissionRuleResolver ALLOCATED/NONE (evidence-only)
  resolvedAt: "2026-11-20T12:34:56.789Z",
  evaluatedAt: same,
}
```

The digest ties the snapshot to the exact `limit_profiles.version` and the set of `limit_rules` rows whose `effectiveFrom ≤ evaluatedAt`. A later generic limit edit changes the digest — the next `enforceWithManager` call must be re-evaluated, never cached.

### 2.3 Guard: GLOBAL/AGENT_CLASS fallback cannot bypass a more restrictive tier/institution policy

The fallback is only permissible when **no more specific, more restrictive mapping exists**. Verified behaviour:

- **Precedence** is the first ordering key — a `CUSTOMER`-specific assignment with `precedence=20` beats a `GLOBAL` with `precedence=0`. Operators must set precedence to reflect restrictiveness.
- **Tier separation** — a `LEVEL_1` customer never inherits a `LEVEL_3` profile's `DAILY_AMOUNT` even via `GLOBAL`: the institution tier mapping selects `profileCode` per `tier`; `GLOBAL` with `LEVEL_3` limits is invisible to a `LEVEL_1` query because `product|currency|serviceClass|tier` is an exact composite key (null is not a wildcard).
- **Institution scoping** — `institutionId` is passed to `InstitutionKycLimitPolicyService`; a policy for institution A never applies to institution B.
- **Effective window** — stale `limit_rules.effectiveTo` past `now` is excluded.
- **Diagnostics proof** — any account whose resolver falls back to `GLOBAL` while a more restrictive tier mapping exists but is `NOT_CONFIGURED` is flagged in §1.2 D-1 as "under-governed" — not silently approved.

Arena 3 proves the catalogue has a deterministic winner for every `product×currency×tier` combination. Arenas 1/2 prove each onboarding's evidence block contains the expected `profileCode+version+digest` for that winner.

---

## 3. Mobile Self-Service Registration & Account Claiming — implementation plan (using current architecture)

### 3.1 The blocker

`CustomerRegistrationService.completeRegistration()` is intentionally hardwired to `throw new ServiceUnavailableException('Customer registration is temporarily unavailable')` (line 350-364). The legacy phone-OTP gate is the **only** activation path, and it correctly refuses to consume the token or create any draft/credential/customer/wallet without a live identity-bound KYC evidence adapter. Workforce-assisted registration is not a substitute.

### 3.2 Architecture to use (no new system — wire existing services)

| Layer | Existing service (preserve) | Role |
|---|---|---|
| OTP request/verify | `CustomerRegistrationService.requestOtp` + `verifyRegistrationOtp` (rate-limited per IP/phone, PBKDF2 challenge, enumeration-safe no-op on verified phone) | Phone proof without number enumeration |
| Registration sessions | `KycRegistrationSessionService` (`kyc_registration_sessions` `status=VERIFIED`, `authorization_hash=sha256(token)`, `expires_at`) | Binds phone proof to a 15-min onboarding capability |
| Ownership key | `KYC_OWNERSHIP_KEY_BASE64 + KYC_OWNERSHIP_KEY_VERSION` + `kyc_ownership_key_state` singleton proof (`kyc-ownership-key-proof-v1` HMAC) | HMAC'd BVN/NIN identity matching without storing plaintext identifiers (`identifier_mac = HMAC(ownershipKey, 'kyc-identifier-v1\0'+kind+'\0'+identifier)`) |
| Identity evidence | `KycTierEvidenceReader` + strict-provenance `MobileAccountClaimService.evidence()` (revision-locked, non-synthetic provider attempt from `MONNIFY` or `PREMBLY` with `MATCH` outcome, live consent, `authentication_sessions audience='customer-api'`, no identity conflicts, live evidence window) | Only consented, conflict-free evidence from explicitly allowlisted providers qualifies |
| Account claim | `MobileAccountClaimService.match` (BVN/NIN HMAC compare with `constantTimeMacEqual`, rate-limited `mobile_claim_attempt_windows` 5/hr → LOCKED) + `setup` (passcode `^\d{6}$` ≠ pin, `hashMobileSecret`, credential + pin creation, `mobile_account_claims.consumed_at` + `customer_authentication_credentials`) + `MobileOnboardingAuthService.login` (passcode verification + session `audience='customer-onboarding'`) | Secure web→mobile claiming + self-registration completion with takeover prevention |
| KYC tier | `KycCustomerVerificationService` + `KycTierDecisionService.decideTier()` + `CustomerFinancialEligibilityService.require()` | Tier assignment after identity match |
| Limit/fee resolution | `LimitProfileResolverService.resolve()` + `InstitutionKycLimitPolicyService` + `FeeRuleResolverService` + `CommissionRuleResolverService` via `CommercialDecision` snapshot | Automatic tier/class → limits/fees evidence (see §2) |

### 3.3 Flow A — Web-registered customer claims existing account via mobile (OTP + BVN/identity + passcode + KYC)

1. Web: `POST /internal/admin/customers` (workforce creates `customers status=DRAFT` + `customer_contact_methods PHONE normalized_value`, `kyc_status=PENDING`, `kyc_level=NULL` — no wallet yet).
2. Mobile: `POST /mobile/onboarding/request-otp { phone }` → `CustomerRegistrationService.requestOtp` (enumeration-safe `OTP_REQUEST_ACCEPTED` even if number already bound but unverified).
3. Mobile: verifies OTP → receives `{ sessionId, authorization }` (`kyc_registration_sessions` `VERIFIED`).
4. Mobile: `POST /mobile/onboarding/claim/match { sessionId, authorization, kind=BVN|NIN, identifier }` → `MobileAccountClaimService.match()` checks `is_synthetic=false`, no existing credentials/pin, exactly one `kyc_identity_claims` evidence row with `identifier_mac` matching HMAC, no `kyc_identity_conflicts`, live consent, `revision` lock. Returns `MATCH|MISMATCH|PENDING|LOCKED` and audits `MOBILE_CLAIM_MATCH`.
5. On `MATCH`: `POST /mobile/onboarding/claim/setup { sessionId, authorization, passcode, passcodeConfirmation, pin, pinConfirmation }` → creates `customer_authentication_credentials` (PBKDF2 `hashMobileSecret`) + `customer_transaction_pins`, marks `mobile_account_claims.consumed_at`, audits.
6. Mobile: `POST /mobile/onboarding/login { sessionId, authorization, passcode }` → `MobileOnboardingAuthService.login` validates `customer_onboarding` audience, issues `authentication_sessions` with `onboarding_password_version`.
7. Mobile: `POST /customers/me/kyc` verifications per tier → `KycTierTransitionService` promotes `kyc_level` → automatic limit/fee resolution as in §2.2.

**Security controls preserved:** no plaintext BVN/NIN stored beyond HMAC; `constantTimeMacEqual` comparison; `FOR UPDATE OF c,p,l` locks on session+customer+claim rows; `mobile_claim_attempt_windows` rate limit; enumeration-safe OTP; single-consumption `consumed_at`; `is_synthetic` permanently non-financial; `kyc_identity_conflicts` blocks hijack.

### 3.4 Flow B — Unregistered customer registers via mobile (phone → identity → tier+CoS)

Same steps 2–7, but no pre-existing `customers` row exists. Step 4's `match()` with zero evidence rows returns `PENDING` — the phone proof alone is insufficient. The user must first complete `POST /customers/me/kyc` identity verifications (MONNIFY) to create `kyc_identity_claims` + `kyc_verification_attempts OUTCOME=MATCH` + `kyc_consents`, then `decideTier()` produces `LEVEL_1` and `customers` row is promoted to `ACTIVE` with `kyc_level`. Subsequent `match()` can then succeed as in Flow A step 4 — but only if the same `sessionId` is used before `expires_at`. This prevents an attacker from phone-verifying then claiming a different account.

### 3.5 What needs to be built (implementation plan, not a restart)

| Work | Where | Estimate | Owner |
|---|---|---|---|
| Un-stub `completeRegistration` to delegate to the existing `KycRegistrationSessionService → CustomerService.create → WalletService` path (currently only workforce path exists — reuse, not rewrite) | `customer-registration.service.ts` + `customer-registration.module.ts` (inject `CustomerService`, `KycTierModule`) | 1 PR | **Arena 1** (customer) + Arena 5 (auth) |
| Expose mobile self-service endpoints already in `MobileOnboardingAuthController` (`onboarding-route`, `onboarding-login`, `onboarding-session`, `onboarding-logout`) with correct `customer-onboarding` audience rate limits — add `RoutePolicyRegistry` entries if missing | `src/customer-registration/mobile-onboarding-auth.controller.ts` | 0.5 PR | Arena 1 |
| Wire `MobileAccountClaimService` into customer-mobile UI flow (OTP screen → BVN/NIN match screen → passcode/PIN screen → KYC tier screens) — no new backend service | `apps/customer-mobile` | 2 PRs | **Customer-mobile phase** (after Arena 1 backend ready) |
| Acceptance harness: two mobile-claim E2E specs per flow (A/B) including duplicate/locked/enumeration/expired-session negative cases | `__tests__/mobile-account-claim.e2e.spec.ts` | 1 PR | Arena 1 + Arena 5 QA |

**Ownership:** Arena 1 owns the backend un-stub + mobile-claim wiring; workforce-assisted registration stays but is not treated as a substitute — tracked separately. Customer-mobile implementation phase finishes the UI; this document is the backend contract it will consume.

**Do not:** invent a new OTP provider, store plaintext BVN/NIN, or relax the `is_synthetic` / conflict / single-consumption guards.

---

## 4. Automatic POS — supported scope vs blocked provisioning

### 4.1 Arena 2 completes supported outlet/terminal admin now (existing contracts)

| Capability | Backend contract (implemented, workforce-gated `agent.manage_outlets_terminals`) | Admin work |
|---|---|---|
| Agent outlets CRUD | `POST /internal/agents/:id/outlets`, `POST /internal/aggregators/:agg/agents/:id/outlets`, `GET /internal/agents/:id/outlets`, `GET /internal/outlets/:id`, lifecycle `POST .../suspend|reactivate|terminate` (+ metadata `PATCH`) via `OutletService` | `AgentNetworkScreen` outlet section — harden to full CRUD with approval |
| Terminals CRUD | `POST /internal/outlets/:id/terminals`, `POST /internal/agents/:id/terminals`, `POST /internal/aggregators/:agg/agents/:id/terminals`, `GET .../terminals`, lifecycle via `TerminalService` | Same screen — terminal section |
| Public locator | `GET /public/agents` via `PublicAgentLocatorController` | Read-only ops view (optional) |

All within Arena 2's current file ownership (`AgentNetworkScreen`, `Agent*Panel`s, `ordinary-agent-admin-api.ts`) — no shared-file conflict.

### 4.2 Precise meaning of "automatic POS" in original approved requirements

The approved scope (V1-ADMIN-ROLE-AND-PERMISSION-SPEC, V1-003, AGENT_NETWORK_MANAGER role) defines **outlet/terminal CRUD and agent-level limit assignment** as V1. **No approved requirement states that a vendor hardware serial should automatically create a `AgentTerminal` row without workforce authorization.** The term "automatic POS" in the P4 brief is therefore ambiguous — it can mean either:

- (a) **Automatic provisioning** — hardware vendor (e.g. POS terminal supplier) calls a callback like `POST /partner-callbacks/pos/provision { aggregatorId, agentId, serialNumber, reference }` and a terminal row + outlet binding is created atomically without a workforce operator.
- (b) **Automatic funding/settlement on POS transactions** — already implemented via `AgentFundingService` + `AgentFinancialExecutionService` (agent float ↔ wallet), not a provisioning concern.

Interpretation (a) is the only meaning that is not already satisfied by terminal CRUD. Terminal CRUD is **necessary but not sufficient** for (a).

### 4.3 Exactly what is blocked by vendor integration (not silently deferred)

| Blocked workflow | Why blocked | Proposed implementation (requires approval before any vendor work) |
|---|---|---|
| **Provision callback** `POST /internal/partner-callbacks/pos/provision` → `AgentTerminal` auto-create + `AgentOutlet` bind + audit | No callback endpoint exists; no HMAC/JWT verifier for POS vendor; no `PartnerConnection` + `PartnerCredentialsService` record for a POS vendor; `external-data-minimization` + `external-retention-classification` not configured for serial numbers | New controller `PosProvisionCallbackController` under `partner` module: `POST /api/v1/internal/partner-callbacks/pos/provision` verifies `X-Partner-Signature` via `PartnerCallbackAuthenticationService`, validates `aggregatorId→agentId` relationship (`AgentOutlet.aggregatorId`), creates `AgentTerminal` with `reference=serialNumber` inside a `SERIALIZABLE` txn with `pg_advisory_xact_lock(agentId)`, audits `AGENT_TERMINAL_AUTO_PROVISIONED`. Credentials stored via `PartnerCredentialsService` (encrypted), never plaintext. |
| **Telemetry / heartbeat** `POST /internal/partner-callbacks/pos/heartbeat` → terminal `lastSeenAt`, `firmwareVersion` | `AgentTerminal` has no heartbeat columns — only `reference, code, label, status, serialNumber` | Add nullable `last_seen_at`, `firmware_version`, `battery_level` columns + migration; terminal service upserts on callback |
| **Deprovision on hardware return** | No return workflow | Reuse existing `terminate` lifecycle via same callback `action=DEPROVISION` |

**Do not introduce** any of the above without explicit product approval — it creates a privileged external mutation surface with financial adjacency (agent lifecycle). Until approved:

- Mark P4 as **partially complete**: supported CRUD is done (Arena 2), automatic provisioning is **blocked — vendor integration required** (see §7 decisions 4a/4b).
- Never mark automatic POS complete solely because terminal CRUD screens exist.

---

## 5. Fees & Commissions — keep collection disabled, prepare spec to actual posting

### 5.1 Current state (preserved)

Calculation + governance are implemented; collection is intentionally inert. From capability registry + `commercial-accounting` comments:

- `FeeRuleResolverService.resolveWithManager()` is read-only and participates in the same txn as the financial flow — result is `evidence-only`, no `FeeEngine.calculate()` side effect yet in most flows (evidence comment "no fee is calculated or charged" in `AgentCashToCashClaimService`, etc.). `banking-fee-binding.service` + `banking-transfer-pricing.controller` are preview/evidence paths.
- `CommissionRuleRegistryService` + `CommissionRuleResolverService.decideWithManager()` run inside `SERIALIZABLE` boundaries for 6/7 financial products (C2C claim excluded by design: initiation is the single commission event) — decisions are `ALLOCATED` evidence-only (`payable=false`, `FEE base calculated-but-not-collected`, no `COMMISSION-EXPENSE/…-PAYABLE` or `FEE-REVENUE` account families provisioned, journals principal-only).
- Governance: maker `FINANCE_PREPARER` `POST .../proposals` → checker `FINANCE_CONTROLLER` `POST .../:id/approve` (self-approval 403), MFA where required, version-checked `PATCH`.

### 5.2 Why collection is still disabled (do not change ledger merely for a screen)

The ledger/accounting boundary is formal (DP-03=B, DP-15=A): `CommercialAccountingConfigService` is inert until `COMMERCIAL_ACCOUNTING_ENABLED=true` **and** `COMMERCIAL_ACCOUNTING_VAT_TREATMENT` + `COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT` are explicitly supplied — absent treatment never coerces to zero. Registry rows carry `familyCode, accountType, normalBalance, accountCode` and must be provisioned before any double-entry leg is added. Changing the ledger for a screen would violate the approval model.

### 5.3 Implementation specification to actual financial collection & commission accounting (approved proposal required)

**Prerequisites (finance + product approval):**
1. Approved chart-of-accounts families: `FEE_REVENUE`, `VAT_PAYABLE`, `COMMISSION_EXPENSE`, `COMMISSION_PAYABLE` (and where applicable `COMMISSION_REVERSAL`) provisioned via `commercial-accounting-registry.service` from `commercial_accounting_registry.family_code`.
2. Approved posting geometry per flow: whose `ledger_account_id` is debited/credited, which `familyCode` maps to which side, timing (`CommissionRecognitionTiming`: `ON_SETTLEMENT` vs `ON_COMPLETION`), VAT treatment (`EXCLUSIVE_ADD_ON` vs `INCLUSIVE_IN_FEE`).

**Specification (no new ledger engine — reuse `LedgerService.postJournalInTransaction`):**

| Step | Behaviour |
|---|---|
| **Fee posting** | Inside the existing `SERIALIZABLE` financial txn, after `FeeRuleResolverService.resolveWithManager()` returns `RESOLVED`, call `FeeEngine.calculate(amountMinor, currency, rule)` → `feeMinor+vatMinor+totalMinor` (already validated `flatFeeMinor/percentageBps/minimum/maximum/vatBps`). Add one double-entry `LedgerJournal` (same `idempotencyKey`) with lines: `DEBIT customer.wallet.ledger_account_id` (principal + fee + VAT) / `CREDIT FEE_REVENUE family account` (fee net of VAT) / `CREDIT VAT_PAYABLE family account` (VAT) — all `amount_minor` as `bigint` strings. If resolution is `AMBIGUOUS` or `NOT_CONFIGURED` (zero rules), produce no fee legs — same as today, but now audited as non-posting. |
| **Commission accrual** | After `CommissionRuleResolverService.decideWithManager()` returns `ALLOCATED` (`payable=true` only after accounting families approved), post `DEBIT COMMISSION_EXPENSE` / `CREDIT COMMISSION_PAYABLE` (per `recipientType` + `calculationModel` + `tiers` — recipient already resolved to `agentClassId|agentId|aggregatorId`). `C2C claim` remains excluded. Reversal compensates with matching debit/credit via `B2fFinanceControlService`. |
| **Reversals** | On `TransferService.reverse` / expiry / failed journal, fee and commission legs reverse atomically with principal legs (no automatic source repair per A7/A7-EXIT-CHECKLIST). `B2fAccountingTreatment` selects treatment. |
| **Reconciliation** | `ReconciliationController` + `CommercialDecision` snapshot already capture `feeRuleId+version, commissionRuleId+decisionId` — no new table, just add `feeMinor/vatMinor/commissionMinor` to snapshot payload when families are live. `OperationsController` `integrity`/`outbox` checks include new families. |

**Acceptance criteria for moving from evidence-only to posting (must pass before `COMMERCIAL_ACCOUNTING_ENABLED=true` in production):**

- [ ] One approved `fee_rules` row per covered `productCode×currency` resolves as `RESOLVED` with all `flatFeeMinor/percentageBps/minimum/maximum/vatBps` checked by `chk_fee_rules_*`; one approved `commission_rules` row per covered `productCode×recipientType` resolves as `ALLOCATED` — demonstrated in non-prod with flag ON.
- [ ] A `TRANSFER` + a `CASH_TO_CASH` + an `AGENT_FUND` flow each produce a journal whose `LedgerLine` count is principal legs + fee legs (+ commission accrual shadow journal where applicable) with `DEBIT total == CREDIT total` and correct family `ledger_account_id`s from registry.
- [ ] Reversal of each flow produces a compensating journal with matching legs and no double posting on idempotent retry.
- [ ] Self-approval of a fee/commission rule or accounting-family change is rejected (403); approval requires `FINANCE_CONTROLLER` + MFA.
- [ ] `OperationsController.integrity/history/last-passes` shows no failed commercial-accounting runs.

**Do not:** change `LedgerService` double-entry invariants, invent a new ledger table, or remove the `COMMERCIAL_ACCOUNTING_ENABLED` gate to satisfy a screen.

### 5.4 Rewards / product catalogue

Keep deferred per direction §6. Repository check: `reward_rules` + `product_catalog` exist and have CRUD, but **no financial flow consults them** unless explicitly wired via `B1BillingEngine`/`B2*` which are not V1 dependencies. Deferred is correct — do not implement unless evidence demonstrates they are dependencies for core onboarding/CoS/transaction processing (none found).

---

## 6. Acceptance — ten gates with six-layer distinction

The ten P5 gates (from `MAIN-WEB-PRIORITY-PLAN-P2-P5.md §6`) remain, but completeness is now reported per layer — a screen existing never equals workflow complete.

| # | Gate (from §6) | Layer 1: Component tests passing | Layer 2: Backend capability implemented | Layer 3: Admin interface implemented | Layer 4: Mobile integration implemented | Layer 5: E2E workflow verified (non-prod) | Layer 6: Production/provider readiness |
|---|---|---|---|---|---|---|---|
| 1 | Customer registration → correct tier+class | `__tests__/a1-*` + registration E2E spec pass | `CustomerRegistrationService` + `LimitProfileResolverService` + `InstitutionKycLimitPolicyService` exist | `CustomerRegistrationWizard` + `LimitAssignmentScreen` (Arena 1) | `apps/customer-mobile` OTP→KYC screens consume §2.2 evidence | §2.2 `effectiveConfiguration` snapshot recorded with digest on integration branch | Production has `GLOBAL`/`CUSTOMER` assignments for NGN `TRANSFER` × all tiers; flag ON per §1.2 |
| 2 | Agent onboarding → correct class+capabilities | `__tests__/a2-*` + `AgentFundingPanel` pass | `AgentApplicationService` + `AgentClass.applicable_services` + resolver with `agentClassId` | `AgentNetworkScreen` + `AgentClassesScreen` (Arena 2) | Agent mobile (future) consumes class | Same snapshot for `AGENT` principal | Production has `AGENT_CLASS` assignments per class |
| 3 | Account claiming secure (A+B) | `mobile-account-claim.e2e.spec` + enumeration/duplicate/locked cases | `MobileAccountClaimService.match/setup` + `MobileOnboardingAuthService` + `KYC_OWNERSHIP_KEY` HMAC + `kyc_identity_conflicts` guard | Admin shows `customers.kyc_status` only (no takeover UI) | Customer-mobile Flow A+B end-to-end | Both flows exercised with `ServiceUnavailable` stub removed; `CONFLICT`/`PENDING`/`LOCKED` all proven | `KYC_OWNERSHIP_KEY_BASE64/VERSION` provisioned, `kyc_ownership_key_state` proof verified |
| 4 | Tier upgrade → eligibility+limits rebound | `KycTierPolicyService` specs | `KycTierTransitionService` + `CustomerFinancialEligibilityService.require()` + tier-bound `enforceWithManager(requireKycTierPolicy=true)` | `ComplianceScreen(mode=kyc)` + `InstitutionWorkspace tier-policy` tab (1+5) | Mobile KYC upgrade screens | Promotion reuses binding digest, new window enforced in same SERIALIZABLE txn | Production tier mappings for all institutions × tiers with approved `profileDigest`s |
| 5 | Fees/commissions from active approved rules | `fee-rules` + `commission-rule-*` registry specs | Resolver + `FeeEngine` + `CommissionResolver` evidence-only today (see §5) | `CommercialRulesScreen` fees/commissions tabs (Arena 3) | Preview via `banking-transfer-pricing.controller` | Snapshot shows `RESOLVED`/`ALLOCATED` with `ruleId+version` on integration branch | Collection stays evidence-only until §5.3 families approved; gate is evidence, not posting |
| 6 | Per-tx / daily / weekly / monthly limits enforced | `limit-diagnostics-contract` + `limit-usage` specs | `LimitEnforcementService.enforceWithManager` + `LimitUsageService` | `LimitAssignmentScreen` + `LimitCatalogue` (1/3 split) | Mobile preview shows `remainingDailyMinor` | Each threshold breached → correct `LimitFailureCode` | Flag ON in prod after §1.2 D-4 |
| 7 | Concurrent txns cannot bypass limits | `limit-enforcement` concurrency specs | SERIALIZABLE + `LimitUsage` reservations + `LimitReservationRecoveryService` | N/A | N/A | N concurrent enforce calls → only up-to-limit succeed | Same as 6 |
| 8 | Unauthorized override / self-approval rejected | `PrivilegedActionApprovalService` + `CommercialRuleGovernanceService` specs | Maker≠checker enforced, role+MFA checked | `approvalsInbox` (4) | N/A | Self-approval returns 403 on integration branch | Prod roles match non-prod |
| 9 | Failed/reversed/retried per financial rules | Financial suite (10/10 journeys, 267p) | A7 suspense (no auto source repair) + `idempotencyKey+requestHash` replay | `LedgerOperationsScreen` reversal draft + `Reconciliation` runs (3) | Customer-mobile history | Reversal compensation + idempotent-retry proven | `OperationsController.integrity` green |
| 10 | Missing assignments identified + safely handled | `LimitDiagnosticsService` specs | D-1 diagnostics + `LEGACY_UNENFORCED` vs `ENFORCED` distinction | `SystemHealthScreen` or diagnostics endpoint (4+3) | N/A | Diagnostics shows zero uncovered for critical product before prod flag (see §1.2) | Prod diagnostics zero uncovered; otherwise `ENFORCED` would block |

**Never mark complete** when only layer 1 or 3 is green. Layer 5 is the gate for `arena/5-main-web-integration` merge; layer 6 is the gate for production.

---

## 7. Decisions requiring approval — unresolved only

| # | Decision | Options (no action is not an option — keep explicit) | Recommendation | Blocks |
|---|---|---|---|---|
| 1 | Enable `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` in production | A: now (fail closed immediately — may block existing flows); **B: after backfill + D-1 zero uncovered + gates 6/7 with flag ON in integration**; C: keep permissive as final design | **B** — already the plan in §1.2 | P2 complete, gate 6/10 |
| 2 | Unblock `completeRegistration` self-service | A: workforce-only (keep stub, operator creates via admin); **B: unblock to existing KYC-bound path per §3.3/3.4 (reuse `KycRegistrationSessionService→CustomerService`) with full security controls**; C: build a new registration system | **B** — same architecture, no new provider, preserves all guards | P3 (both flows), gate 1/3 |
| 3 | Auto-create default `GLOBAL` NGN assignments on onboarding | A: auto-create per-entity row; **B: keep manual assignments with `GLOBAL` fallback + diagnostics (§1.2) — add per-entity only if D-1 shows chronic missing** | **B** — auto-create risks precedence override of intended `SEGMENT`/`AGENT_CLASS` policies | P2 auto-CoS assignment |
| 4a | Automatic POS: provision callback endpoint | A: no auto-provision (supported CRUD is complete); **B: add `POST /internal/partner-callbacks/pos/provision` with `PartnerCallbackAuthenticationService` HMAC + `PartnerCredentialsService` encryption + `external-data-minimization` as specified in §4.3** | **A now, B only with new product decision** — current supported scope is complete; auto-provision is a new privileged surface | P4 |
| 4b | Telemetry/heartbeat columns | A: none; B: add `last_seen_at/firmware_version/battery_level` to `AgentTerminal` | A unless telemetry product requirement approved | P4 |
| 5 | Fee/commission collection (account families) | A: keep evidence-only; **B: provision `FEE_REVENUE/VAT_PAYABLE/COMMISSION_EXPENSE/COMMISSION_PAYABLE` families and `COMMERCIAL_ACCOUNTING_ENABLED=true` per §5.3 spec** | **A until finance approves chart-of-accounts + posting geometry** | Gate 5 (collection), §5 |
| 6 | Reward/product catalogue timing | A: deferred (current); B: implement | **A** — no dependency found on CoS/limits/tx | None |

No navigation reorganization, financial-engine change, production activation, real financial postings or merge to `main` is proposed in this document.

---

## 8. Next assignments — implementation sequence (what happens when)

| When | Who | What | Provenance |
|---|---|---|---|
| **Now — do not interrupt** | **Arenas 1 & 2** | Finish owned views at their current scope (P1). Arenas must not edit each other's files or shared files (`Layout.tsx`, `navigation-access.ts`, `api-client.ts`, `institution-admin-api.ts`, `CountrySelect.tsx`). | `arena/5-main-web-audit → arena/5-a1-customers-kyc / arena/5-a2-agents-pos → PR to arena/5-main-web-integration` |
| **Now — in parallel** | **Arena 3** | Commercial configuration + limit catalogue (§3): make `limitCatalogue` cover all required dimensions for NGN, create approved example `fee_rules`/`commission_rules` (evidence-only), expose `InstitutionKycLimitPolicy` view data for Arena 5. | `arena/5-a3-transactions-finance` — does not wait for 1/2 test IDs |
| **Next — contract** | **Arena 5** | Publish integration contracts for §2.2 `effectiveConfiguration` snapshot + §1.2 D-1 diagnostics schema; enable `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=true` in non-prod acceptance envs; add diagnostics to `SystemHealthScreen` or standalone endpoint. | This branch → `arena/5-main-web-audit` |
| **Next — mobile** | **Arena 1 + Arena 5** | Un-stub `completeRegistration` per §3.5, expose `MobileOnboardingAuthController` routes, author E2E harness for flows A/B (positive + duplicate/locked/enumeration/expired-session negatives). Customer-mobile phase consumes the contract after backend ready. | `arena/5-a1-*` follow-up PR |
| **Next — fees spec** | **Arena 5 (+ Arena 3)** | Land the §5.3 `FEE_REVENUE/VAT_PAYABLE/COMMISSION_*` proposal + acceptance harness skeleton (still `COMMERCIAL_ACCOUNTING_ENABLED=false` — evidence only) | Proposal doc + spec PR |
| **Later — only after D-1 zero uncovered + gates 6/7 passed with flag ON** | **Arena 5 (with finance)** | Controlled enablement of production flag per §1.2 D-4, with explicit owner authorization (decision 1). | Runbook + flag commit (not in this document) |

**Current blockers (no deploy until resolved):** D-1 diagnostics missing for critical NGN paths until Arena 3 backfills at least one GLOBAL profile; `completeRegistration` stub blocks Flow B self-registration E2E (decision 2); auto-provision callback does not exist until decision 4a approved; fee/commission collection blocked until decision 5 families approved. None block Arenas 1/2 P1 or Arena 3 catalogue work.

