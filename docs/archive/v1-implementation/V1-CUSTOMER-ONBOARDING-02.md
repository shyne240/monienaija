# V1-CUSTOMER-ONBOARDING-02 — Workforce Review + Verified-Phone Activation

**Baseline:** `6fbed7ff369042ad3a87b01fde404deb3e8aa905`
**Authorities:** `docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md` (SUB-1: verified phone REQUIRED before ACTIVE), `docs/V1-CUSTOMER-ONBOARDING-01.md` (registration front door + OTP).
**Scope delivered:** the activation layer only — verified-phone hard gate, workforce review read, workforce-only boundary re-proof. No credentials/PIN/wallet/KYC-gating/readiness/retention were implemented.

---

## 1. What this implementation establishes

### IMPLEMENTED

| Capability | Evidence |
|---|---|
| **Verified-phone activation gate** | `CustomerService.updateStatus` now fails closed on every transition INTO `ACTIVE` (`DRAFT→ACTIVE`, `SUSPENDED→ACTIVE`) unless a live **primary** PHONE contact with `verified_at IS NOT NULL` exists. Runs inside the existing transaction, after the transition table (invalid transitions keep their existing error), before any save — on failure everything rolls back: status unchanged, no wallet/credential/PIN, no ledger. Error: HTTP 400 `Customer activation requires a verified primary phone` (existing `BadRequestException` convention, same class as invalid-transition rejection). |
| **Existing route/service reused** | No new activation route. `PATCH /api/v1/customers/:id` + `updateStatus` remain the single activation path (per task: reuse if architecturally correct — it is: workforce-mode route + controller assertion + transition machine + audit). |
| **Workforce-only boundary (S-FIX-01) preserved and re-proved** | Registry block/policy unchanged; guard cross-check matrix unchanged; no self-activation path created; default policy not loosened. Behavior matrix in §3. |
| **Gate outcome in activation audit** | `CUSTOMER/STATUS_UPDATED` on transitions to `ACTIVE` now carries `new_values.activationGate: { verifiedPrimaryPhone: true }` alongside the existing reference/type/status previous→after and actor/timestamp. Failed gate attempts persist **no** audit row — the same convention the codebase already uses for in-transaction rule rejections (invalid transitions): the rejection is transactional, HTTP-visible to the workforce-internal caller, and there is no billing/financial consequence to trail. Verified assertion: no passwords/PIN/OTP/verification-token material in the trail (test proof 13). |
| **Minimal workforce review read (Part 3 outcome)** | Existing admin Customer 360 already exposes core customer (`GET /internal/customers/:id`), transactions, wallets, balance, support-tickets (workforce-reachable via the `/internal/` WORKFORCE_SESSION block). The ONE piece of review evidence not reachable anywhere by an authenticated workforce request was the SUB-1 gate evidence itself (phone + `verified_at` — the generic `/customers/:id/contact-methods` block is default-guard-mode and workforce tokens cannot authenticate there). Per the task's narrow rule ("if a minimal missing backend read endpoint is genuinely necessary, implement only that"), exactly one read-only endpoint was added: **`GET /api/v1/internal/customers/:id/phone-verification`** → `{ customerId, customerStatus, phones: [{ isPrimary, maskedValue: '+234*****XXXX', verifiedAt }], activationGate: { verifiedPrimaryPhone } }`. Workforce-only (`requireWorkforce`), GET-only (no state, no audit), masked values, no admin UI built, no duplication of existing 360 surfaces. |
| **Existing lifecycle untouched** | Status vocabulary unchanged (`DRAFT/ACTIVE/SUSPENDED/CLOSED`); transition table unchanged; suspension/reactivation semantics unchanged (SUSPENDED→ACTIVE re-entry also passes the gate when the verified phone is present); no-op PATCH (ACTIVE→ACTIVE) returns early as before. |

### NOT YET IMPLEMENTED (deliberately, per task scope)

Customer credential issuance (SUB-2 temp credential + first-login rotation) · forced rotation gate on sessions · KYC-level gating of activation/transactions/limits (decision explicitly still open — §5) · wallet orchestration / starter bundle · transaction PIN · transaction-readiness enforcement · DRAFT retention/cleanup values · mobile-app migration to the real registration flow.

---

## 2. Exact activation route/service used

- **Route:** `PATCH /api/v1/customers/:id` (`CustomerController.update`, `requireWorkforce` assertion) — unchanged.
- **Authorization:** `RoutePolicyRegistry` lifecycle block — `WORKFORCE_SESSION` mode, `allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']` — unchanged.
- **Service:** `CustomerService.updateStatus` — one gate added (`assertVerifiedPrimaryPhone`), audit enriched with gate outcome. No refactor of unrelated behavior.

## 3. Workforce authorization behavior (verified by tests)

| Caller | Result | Mechanism (all pre-existing, unmodified) |
|---|---|---|
| No/invalid bearer | **401** | guard WORKFORCE_SESSION validation |
| Real CUSTOMER session (self or other) | **403** | guard customer-session cross-check (`Customer not allowed on workforce route`) |
| Real AGENT session | **403** | guard agent-session cross-check |
| Workforce-namespaced token whose principal class is not a workforce class (`workforce-CUSTOMER`/`workforce-AGGREGATOR`) | **401** | controller-level workforce assertion (`Privileged access required`) — the S-FIX-01-conformant convention |
| SUPPORT / OPERATOR / SERVICE / PRIVILEGED workforce session | **may activate** (subject to the phone gate) | policy allowlist, unchanged |

On the task's "unauthorized workforce role → 403" item, precisely: this platform's lifecycle policy vocabulary is **principal type**, not role; the PATCH allowlist contains exactly the four workforce classes (S-FIX-01 test-0 asserts this verbatim and it is intentionally unchanged here — narrowing *which* workforce classes may activate would be a separate policy decision). Non-workforce principal classes and masquerades are rejected with 403/401 per the pre-existing matrix above; no path lets an unauthorized actor reach `updateStatus`.

## 4. Review-surface state

Operator can review, *via existing surfaces*: customer core + status filter list (`GET /internal/customers[?status=DRAFT]`), detail (`:id`), transactions, wallets + balances, support-tickets (hardening-06 investigation set) — all workforce-session reached. **New (minimal):** `GET /internal/customers/:id/phone-verification` for the gate evidence (masked, read-only). Nothing else was duplicated; no UI was built (no admin-frontend pattern was established as required for this slice).

## 5. KYC behavior and the remaining (still-open) decision

- **New hard activation rule:** verified primary phone only. No KYC-level/document/risk gate was added, in line with the task and the decision doc's open §23-3.
- **Pre-existing KYC gates:** re-verified — none exist in the activation path today (`kycLevel/kycStatus` are recorded by the assessment machinery and gate nothing); nothing was removed or altered.
- **Remaining decision (verbatim open):** whether KYC level/status gates activation and/or transactions/limits, which readiness checks (profile/address/identity/agreements/tasks/risk) join the gate, and whether the readiness aggregate becomes enforcing. This must be decided before any enforcement is built; this task explicitly does not interpret the open decision as implemented.

## 6. Audit behavior

Success: `CUSTOMER/STATUS_UPDATED` with actor (from the workforce body, e.g. `workforce-activation`), `previous_values` (reference/type/status/kyc), `new_values` (+ `activationGate.verifiedPrimaryPhone: true` for ACTIVE entries), `occurred_at`. Failure: transactional rollback, no audit row (existing rule-rejection convention; request-level denial visible to the internal caller; no financial side effects). The registration-flow audits from ONBOARDING-01 remain untouched. No OTP/token/credential/PIN/secret material appears in audits (test-proofed).

## 7. Boundary confirmation (wallet/credential/PIN)

Failed activation creates nothing (test 2,3,4: zero `customer_authentication_credentials`, `customer_transaction_pins`, `wallet_accounts`, zero `ledger_journals/ledger_lines`). Successful activation itself creates nothing beyond the status change + audit (no Part-7 bundle was introduced; none existed). The intended order stays: ACTIVATION → (later) credential → (later) PIN → readiness.

## 8. Tests / results (real PostgreSQL 18.4, full migration chain)

- **New:** `test/v1-customer-onboarding-02.integration.spec.ts` — **9/9 pass** covering task proofs 1–13 + review endpoint auth/read-only behavior.
- **Registration/OTP:** `v1-customer-onboarding-01` — **PASS (15)**.
- **S-FIX-01 workforce lifecycle:** **PASS** — required one fixture update: its `createCustomer` helper now carries a verified primary phone (test data, switched in one place) because the suite's intended-operation test PATCHes `DRAFT→ACTIVE`; the AUTHORIZATION assertions are untouched. This is the mandated consequence of the decided invariant, not a loosening (it strengthens fixtures to the new invariant).
- **Customer 360/review:** `v1-hardening-06-admin-customer-investigation` — **PASS** after extending its latest-migration pin from ≤076 to also include `077` (agent rotation) and `078` (registration challenges); the suite had pinned ≤076 and was failing at baseline since the two earlier appends. (15 other suites pin the same ≤076 stamp and are stale at baseline from the same appends — flagged for a maintenance pass; only the task-mandated suite was updated here.)
- **Untouched-flow spot checks:** a23 customer-app login, a24 PIN — **PASS**; customer/b2-activation-readiness/auth unit specs — **36/36 PASS**.
- **tsc `--noEmit`:** clean. **`npm run build`:** clean. **ESLint:** new files clean; edited src files at exactly their baseline error counts (0 new); **Prettier:** clean.

## 9. Migration count

**0** — the gate reads `customer_contact_methods.verified_at` (existing column written by ONBOARDING-01); the review endpoint is a read over existing tables.

## 10. Remaining customer onboarding gaps

1. Customer credential issuance (SUB-2): server-generated temp credential + secure delivery + forced first-login rotation; rotation modeling on the customer credential store (schema decision).
2. KYC-level gating decision (§23-3 remainder) + review-surfaces decision once thresholds exist.
3. Starter-bundle/atomicity + wallet provisioning actor (§23-1 remainder).
4. Transaction PIN (lifecycle step; machinery exists and is session-gated).
5. Transaction-readiness: report → enforcement decision.
6. DRAFT retention values (operational decision; DRAFTs persist by design per SUB-3).
7. Mobile-app rebuild against the real flow.
8. Test-maintenance: 15 unpinned-at-baseline migration-stamp lists in non-DP suites (see §8).
