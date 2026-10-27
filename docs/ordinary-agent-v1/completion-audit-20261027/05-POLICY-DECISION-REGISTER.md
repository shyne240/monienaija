# 05 — Policy-Decision Register (reassessed for Ordinary Agent V1 completion)

**Audit SHA:** `b8a5b94ee55aad7407dd78068428b3e97236ce8e` · No policy is decided herein; each row states what exists in source, what the decision must answer, and its exact blocking classification per the mission's vocabulary: **[FUNC]** blocker to functional completion · **[DEPLOY]** blocker only to production deployment/UAT sign-off · **[FUTURE]** future-phase requirement · **[OUT]** outside Ordinary Agent V1 scope.

---

## The eight Sprint 3 decisions, reassessed

### D1 — Human cash handover (AGENT_CASH physical payout controls)
- **Source state:** AGENT_CASH payout requires Agent B PIN + current unexpired customer KYC assessment + lifecycle/class rechecks; provenance is recorded as SERVICE-approved, explicitly NOT human-supervisor inspection (ARENA 1 handoff §5; a16 tests). No physical-handover attestation exists.
- **Decision needed:** what approved physical controls/attestation (if any) must accompany a cash payout before real-money operation.
- **Classification:** **[DEPLOY]** — the electronic flow is functionally complete and safe within the ledger; this gates real-cash UAT/production sign-off only. Do not authorize physical-cash UAT without it.

### D2 — Expired Cash-to-Cash funds disposition
- **Source state:** expiry retains the unclaimed liability (verified); no refund/forfeiture path exists; claim-time enforcement is fail-closed. Separately, the status-transition sweep exists but is untriggered (OA-40 — an engineering gap, not policy).
- **Decision needed:** refund-to-sender vs forfeiture vs manual-ops path for EXPIRED transfers; who holds refund authority.
- **Classification:** **[DEPLOY]** for disposition (liability retention is safe indefinitely at ledger level); the OA-40 trigger wiring is **[FUNC]** and separable — it completes already-approved status/audit behaviour without deciding disposition.

### D3 — Fees and commissions (values, not mechanism)
- **Source state:** mechanism complete (fee/VAT fields, commercial snapshots, commission accrual + AGENT_WALLET_NETTING + fail-closed guards, history display). Values: C2C `feeMinor=0n`/`vatMinor=0n` hardcoded; cash-in/out have no fee concept; zero commission rules configured by design ("no invented rates").
- **Decision needed:** approved fee schedule (per flow), VAT treatment, commission plan values/overrides, and whether V1 launches with an explicit zero-fee posture.
- **Classification:** **[DEPLOY]** — V1 can function completely at zero fees (current behaviour is explicit and safe); commercial launch terms require the decision. If the owner ratifies "launch at zero", this closes with no engineering.

### D4 — Wallet-mode KYC assessment freshness
- **Source state:** cash mode requires a current unexpired assessment; wallet mode requires authoritative APPROVED customer status but does NOT check assessment expiry (ARENA 1 handoff §3 records the asymmetry and forbids inventing a freshness window).
- **Decision needed:** is assessment expiry mandatory for wallet redemption, and with what window?
- **Classification:** **[DEPLOY]** — both gates are implemented and tested as approved; harmonization is a small contained build after the decision.

### D5 — Agent class reassignment (reclassification)
- **Source state:** class bound at approval; backend reclassification route deliberately absent; admin panel visible+disabled with dependency note; the seven governance decisions are enumerated in `ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md` §4.1 (entitlement, maker-checker, in-flight transactions, limit migration, lifecycle semantics, invariants, audit).
- **Classification:** **[FUTURE]** for V1 launch (agents can be onboarded into correct classes; tiering/hybrid progression is 72D-68/69 archived scope). Becomes **[FUNC]** only if the owner declares reclassification in-scope for V1.

### D6 — Administrative PIN recovery/unlock
- **Source state:** no privileged bypass exists or was created; admin panel visible+disabled; agents can change a known PIN (`me/transaction-pin/change`) but a locked/forgotten PIN has NO recovery route short of the governance ceremony (seven decisions in S3R §4.2: entitled role+function, identity evidence, dual control, unlock-vs-reset semantics, cooldowns, audit, support wiring).
- **Classification:** **[DEPLOY]** — operationally unsustainable at real agent scale (every locked PIN becomes a dead agent until decided); must be resolved before production onboarding waves. Not a functional-completion blocker for the implemented flows.

### D7 — Aggregator read authorization gating
- **Source state:** aggregator reads are type-gated only; requiring `aggregator.view` would rewrite a22-pinned fixtures and needs an approved policy delta (S3R sweep follow-up). Aggregators are relationship-only in V1.
- **Classification:** **[OUT]** for Ordinary Agent V1 (aggregator domain), with a governance follow-up note. Does not block any ordinary-agent requirement.

### D8 — Beneficiary SMS delivery for the six-digit locator
- **Source state (contract §6, verbatim):** "The repository's initiation service does not currently emit that generic created notification. The approved immediate handoff is the authenticated initiation response/receipt presented by Agent A; ARENA 2 must surface the pair. If automated beneficiary SMS is required as a release gate, notification ownership must approve/wire the recipient/outbox workflow separately, using the public pair and never persisting the secret transfer code…" Mobile surfaces the pair (display-once + share text) — the approved handoff IS implemented.
- **Decision needed:** is automated beneficiary SMS a release gate?
- **Classification:** **[DEPLOY]** if YES (small wiring build on the existing template + outbox machinery, with recipient-mapping approval); **[OUT]** if NO (sender-mediated handoff is contract-sufficient today). Current state is contract-conformant either way.

## Additional decisions discovered/confirmed by this audit

### D9 — Agent lifecycle notifications (activated/suspended/terminated/reactivated/application approved/rejected)
- **Source state:** templates + event-map entries exist, annotated "future outbox events"; nothing enqueues them; the 2026-10-02 matrix's NOT-1 "✔ backend" claim is contradicted by source (00 §5.2). No authoritative V1 document mandates these SMS.
- **Decision needed:** ratify "no agent lifecycle notifications in V1" or approve wiring (contained build).
- **Classification:** **[FUNC]-low if approved for V1 / [OUT] if ratified absent** — needs a ruling to close the claim-vs-source inconsistency.

### D10 — Public agent-application UI
- **Source state:** applicant API complete incl. secured applicant-access tokens (`…095`); workforce-led path fully UI-wired; no applicant-facing frontend exists in the repository.
- **Decision needed:** does the 72D "may apply publicly" requirement obligate a public web form in V1, or is API + workforce-led registration the approved V1 channel?
- **Classification:** **[FUNC]** if YES (medium build: public form + status view) / **[OUT]** if ratified.

### D11 — Normal agent credential self-change (AUTH-8)
- **Source state:** route absent; founder decision recorded as pending in the mobile spec; workforce reissue workaround live.
- **Classification:** **[FUNC]-medium if decided YES / [DEPLOY]-acceptable if the workaround is ratified** as the V1 credential-recovery path.

### D12 — Operations reversal workflow (V1-017) and reconciliation-break governance (§25-1)
- **Source state:** reversal primitive production-grade; workflow absent ("provisional V2 by record, never formally ratified"); reconciliation reporting complete, break-resolution absent.
- **Classification:** **[FUTURE]** provisionally — both need formal ratification so they stop drifting between documents (scope-challenge §11-C items 2–3).

### D13 — Limits read surface for agents (AGENT_RUNTIME_LIMITS) and commission aggregates (AGENT_COMMISSION dashboards)
- **Source state:** registry BLOCKED/PLANNED with PRODUCT_DECISION blocker type; enforcement complete; history already exposes per-transaction commission read-only.
- **Classification:** **[FUTURE]/[OUT]** for V1 operation (agents discover limits through enforcement errors, which are handled UX-wise); **[FUNC]** only if the owner declares transparency surfaces in-scope.

### D14 — Receipt image export; screenshot guard (FLAG_SECURE); release assets pipeline
- **Source state:** no authoritative V1 requirement for image export; screenshot guard recommended-when-decided; assets deliberately omitted (customer-app precedent).
- **Classification:** **[DEPLOY]** (all three are pre-device-release decisions, not functional gaps).

---

## Register summary

| Decision | Blocks functional completion? | Blocks deployment/UAT sign-off? | Future-phase? | Outside OA-V1? |
|---|---|---|---|---|
| D1 handover | No | **Yes** (real-cash UAT) | — | — |
| D2 expired funds | No (trigger wiring OA-40 is engineering, not policy) | **Yes** | — | — |
| D3 fees/commissions | No (zero-posture explicit) | **Yes** (commercial terms) | — | — |
| D4 KYC freshness | No | **Yes** | — | — |
| D5 reclassification | Only if owner pulls it into V1 | — | **Yes** (72D-68/69) | — |
| D6 PIN recovery | No | **Yes** (operational sustainability) | — | — |
| D7 aggregator gating | No | No | — | **Yes** |
| D8 beneficiary SMS | No (contract-conformant today) | **Yes if declared a release gate** | — | If ruled NO |
| D9 lifecycle notifications | **Ruling needed** to close inconsistency | If approved | If ratified absent | — |
| D10 public application UI | **Ruling needed** | If YES | If ratified API-only | — |
| D11 credential self-change | **Ruling needed** | If ratified workaround, no | — | — |
| D12 reversal/break workflows | No | No | **Yes** (provisional) | — |
| D13 limits/commission surfaces | No | No | **Yes** | — |
| D14 image export/screenshot/assets | No | **Yes** (pre-device) | — | — |
