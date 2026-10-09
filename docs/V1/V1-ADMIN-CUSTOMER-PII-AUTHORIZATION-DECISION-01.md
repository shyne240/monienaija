# V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01 — Customer PII Permission Decision Proposal

**Classification: PRODUCT OWNER DECISION PROPOSAL. NO CODE, MIGRATION, CATALOGUE, OR ROLE-ASSIGNMENT
CHANGES WERE MADE FOR THIS TASK.** Every function proposed below is a recommendation requiring
explicit Product Owner sign-off, not an already-approved decision. Where repository facts are
cited, they are marked **[REPOSITORY FACT]**; where this document proposes something, it is marked
**[PROPOSED — REQUIRES PRODUCT OWNER DECISION]**; external regulatory claims are not made anywhere
in this document.

## 1. Executive summary

`V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01` closed the OPERATOR-collapse gap for general customer
profile reads (`GET /customers`, `/customers/:id`, `/customers/:id/profile`) by requiring the
pre-existing `customer.view` catalogue function. It explicitly left three sub-resource GETs
unmigrated because no catalogue function's documented semantics covered them, and documented this
as an open gap rather than silently repurposing `customer.view`:

- `GET /customers/:id/addresses`
- `GET /customers/:id/contact-methods`
- `GET /customers/:id/identity-documents`

This task investigated those three endpoints plus the related `AdminCustomerController`
(`internal/customers/*`) investigation surface in detail, against the authoritative data
classification already on file (`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`)
and the ten-role specification/decision record. The central finding is:

**`GET /customers/:id/identity-documents` returns the raw, unmasked government document number
(`documentNumber`) to any workforce session of principal type `OPERATOR`/`SERVICE`/`PRIVILEGED` —
i.e. to all ten V1 roles indiscriminately, including five roles (`FINANCE_PREPARER`,
`FINANCE_CONTROLLER`, `AGENT_NETWORK_MANAGER`, `RISK_FRAUD`, `TREASURY`) that hold no customer-data
function at all today — with zero masking and zero function-based gate.** `ADR-0024` classifies
"Identity documents and KYC evidence" as **Highly Restricted**, requiring "approved personnel and
purpose only," a materially stricter bar than the **Restricted** tier `ADR-0024` assigns to general
"Customer identity and profile" (which it explicitly bundles with "contacts" and "addresses").
Addresses and contact methods are likewise ungated today, though at the lower Restricted tier.

This document proposes three new catalogue functions — `customer.view_address`,
`customer.view_contact_methods`, `customer.view_identity_documents` — and recommends the third be
assigned far more narrowly than the first two, reopening (rather than assuming) whether
`SUPER_ADMIN`'s blanket administrative-capability convention should extend to raw identity-document
numbers. No code, migration, or catalogue change is made here; §12 lists the exact decisions the
Product Owner must make before any implementation proceeds.

## 2. Baseline commit and clean-worktree verification

- Task baseline (required): `6b8d81ac6ecd22a86c61ccfd71b0fc27aa711cdd` (the completed
  `V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01` checkpoint).
- **Stale sandbox HEAD recovered this session** (the same recurring sandbox-restore defect
  documented in prior task reports): at the start of this task, local `git rev-parse HEAD`
  reported `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (a much older commit) while
  `origin/arena/01a10374-monienaija` was at `6b8d81ac6ecd22a86c61ccfd71b0fc27aa711cdd`, and
  `git status --porcelain` showed hundreds of files as modified/deleted — a diff artifact of
  comparing the stale HEAD pointer to the real tree, not actual data loss.
- **Forensic verification before any recovery action:** `sha256sum` of
  `src/customer/customer.controller.ts` was compared across three sources — the actual working
  tree, `git show origin/arena/01a10374-monienaija:...`, and `git show HEAD:...` (the stale
  pointer). The working tree hash (`f6fcdaa0...`) matched the `origin` tip exactly and did **not**
  match the stale local `HEAD` (`6595d4cd...`) — proving the working-tree files were already
  correct and only the `HEAD` pointer itself was stale.
- **Fix applied:** a plain `git reset 6b8d81ac6ecd22a86c61ccfd71b0fc27aa711cdd` (never `--hard`,
  since no working-tree file needed to change). After the reset: `git rev-parse HEAD` ==
  `6b8d81ac6ecd22a86c61ccfd71b0fc27aa711cdd` == `origin/arena/01a10374-monienaija`, and
  `git status --porcelain --untracked-files=no` returned zero lines (clean working tree).
- This document is written against that verified, correct baseline. No further commits were made
  to the repository before this task's own deliverable commit (see §13 for the commit this report
  will be published under).

## 3. Endpoint-by-endpoint data and authorization inventory

All three endpoints live on `CustomerController` (`@Controller('customers')`,
`src/customer/customer.controller.ts`) and share the identical generic route-policy branch in
`src/authorization/route-policy-registry.ts` (`path.startsWith('/api/v1/customers/')`):

```
allowedPrincipalTypes: ['CUSTOMER', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
customerAccess: 'SELF'
```

**[REPOSITORY FACT]** None of the three handlers below calls `AuthorizationService.requireFunction`
or any other in-controller check — confirmed by direct read of
`src/customer/customer.controller.ts` (current state, post-`CUSTOMER-READ-01`).

| Endpoint | Handler → service method | Entity/fields returned | In-controller check | Masking applied? |
|---|---|---|---|---|
| `GET /customers/:id/addresses` | `getAddresses()` → `CustomerService.listAddresses()` | `CustomerAddress[]`: `type`, `lineOne`, `lineTwo`, `city`, `state`, `country`, `postalCode`, timestamps | **None** | **None** — raw `TypeORM find()` result returned as-is (`src/customer/customer.service.ts:230-236`) |
| `GET /customers/:id/contact-methods` | `getContactMethods()` → `CustomerService.listContactMethods()` | `CustomerContactMethod[]`: `type`, `value`, `normalizedValue`, `isPrimary`, `verifiedAt`, timestamps | **None** | **None** — raw phone/email value and normalized value both returned unmasked (`customer.service.ts:279-285`) |
| `GET /customers/:id/identity-documents` | `getIdentityDocuments()` → `CustomerService.listIdentityDocuments()` | `CustomerIdentityDocument[]`: `type`, **`documentNumber`** (raw government document number), `issuingCountry`, `issuedAt`, `expiresAt`, timestamps | **None** | **None** — raw `documentNumber` returned unmasked (`customer.service.ts:329-335`) |

For contrast, two other controllers in the same codebase *do* apply display minimization to
comparable data, establishing that masking-on-display is an existing, known convention the three
endpoints above simply do not follow:

- `AdminCustomerController.getPhoneVerification()` (`src/admin/admin-customer.controller.ts`)
  returns only `maskedValue` (`+234*****XXXX`) for a customer's phone, never the raw value.
- `AdminCustomerCredentialsController` masks the destination phone (`+234••••••678`) in its
  delivery-result audit/response.

Neither of those two masking examples touches `addresses`, `contact-methods`, or
`identity-documents` as read surfaces — they are unrelated, narrower, write-adjacent endpoints
(§3.1).

### 3.1 Relevant `AdminCustomerController` endpoints (traced individually, not assumed identical)

`src/admin/admin-customer.controller.ts` (`@Controller('internal/customers')`) is gated entirely by
its own legacy `requireWorkforce()` deny-list (denies only `AGENT`/`CUSTOMER`/`AGGREGATOR`;
`SUPPORT` is **not** denied) — no catalogue function anywhere. Each endpoint was inspected
individually; they do **not** expose identical data:

| Endpoint | Data returned | Overlaps with the three PII endpoints above? |
|---|---|---|
| `GET /internal/customers` (list), `GET /internal/customers/:id` | `toSafeCustomer()` projection: `id, reference, type, status, kycLevel, kycStatus, version, createdAt, updatedAt, deletedAt` | **Partial, parallel overlap with `GET /customers/:id`** (same `Customer` entity fields `CustomerController.get()` now gates with `customer.view`) — but this controller's equivalent is **not** gated by `customer.view` at all, only by the type-only deny-list. No address, contact, or identity-document fields appear here. |
| `GET /internal/customers/:id/transactions` | Unified transaction history via `CustomerTransactionHistoryService` | No overlap — financial transaction data, not PII addressed by this task |
| `GET /internal/customers/:id/wallets`, `/wallets/:walletId/balance` | Wallet currency/status/balance (safe projection, no ledger IDs) | No overlap |
| `GET /internal/customers/:id/support-tickets` | Ticket metadata via `SupportService.listForInternal()` | No overlap |
| `GET /internal/customers/:id/phone-verification` | **Masked** phone (`maskedValue`) + `verifiedAt` + activation-gate boolean | **Narrow, already-masked overlap with `contact-methods`** — this is the only place `AdminCustomerController` touches `CustomerContactMethod` data at all, and it is already minimized by design (confirmed via direct code read of `maskPhone()`) |

**[REPOSITORY FACT]** `grep -n "address\|identity.document\|documentNumber" -i
src/admin/admin-customer.controller.ts` returns **zero matches**. `AdminCustomerController` does
**not** expose `CustomerAddress` or `CustomerIdentityDocument` data anywhere, in any form, masked
or otherwise. This directly answers the task's instruction not to assume uniform exposure across
`AdminCustomerController` — the controller's own design already keeps raw address and identity
document data away from its investigation surface, while `CustomerController`'s equivalent GETs do
not.

### 3.2 SUPPORT and other non-workforce principal consumption (traced explicitly)

- `SUPPORT` is **not** in `allowedPrincipalTypes` for any `CustomerController` route (including
  the three PII endpoints) — confirmed in `route-policy-registry.ts`'s generic
  `/api/v1/customers/*` branch, an explicit S-FIX-01/UAT-DEFECT-001 decision recorded in code
  comments. SUPPORT cannot reach `addresses`/`contact-methods`/`identity-documents` today at all.
- `SUPPORT` **is** a deliberately-tested consumer of `AdminCustomerController`'s
  `transactions`/`wallets`/`support-tickets` endpoints
  (`test/v1-hardening-06-admin-customer-investigation.integration.spec.ts`, test 1/2/4: "SUPPORT/
  OPERATOR/SERVICE/PRIVILEGED allowed") and of the masked `phone-verification` endpoint (reachable
  via the same `requireWorkforce()` gate; not independently asserted by name in that suite but
  reachable by the same deny-list logic).
- `AGENT` and `AGGREGATOR` are denied on both controllers' PII-adjacent surfaces.
- `CUSTOMER` reaches all three `CustomerController` PII endpoints, but only `SELF`-scoped (its own
  `customerId`), enforced entirely by the route-policy layer, unaffected by anything in this
  document (§9).

## 4. Current role/principal reachability

| Principal type | `addresses` | `contact-methods` | `identity-documents` (raw `documentNumber`) |
|---|---|---|---|
| `CUSTOMER` (self) | 200 | 200 | 200 |
| `CUSTOMER` (another customer's id) | 403 | 403 | 403 |
| `OPERATOR` — **any of the ten V1 roles, with no distinction whatsoever** | 200 | 200 | **200 — including `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `AGENT_NETWORK_MANAGER`, `RISK_FRAUD`, `TREASURY`, none of which hold any customer-data catalogue function today** |
| `SERVICE`, `PRIVILEGED` | 200 | 200 | 200 |
| `SUPPORT` | 401/403 (denied at route-policy layer) | same | same |
| `AGENT`, `AGGREGATOR` | 401/403 | same | same |
| Unauthenticated | 401 | 401 | 401 |

This is a confirmed, repository-verified fact (traced through `route-policy-registry.ts` →
`authorization.service.ts`'s `checkCustomerScope` no-op-for-non-CUSTOMER behavior →
`customer.controller.ts`'s absent in-handler check), not an inference.

## 5. Existing catalogue functions and why they do or do not fit

- **`customer.view`** (`src/authorization-catalogue/authorization-catalogue.seed.ts`): "View a
  customer profile and KYC tier." Already migrated by `CUSTOMER-READ-01` to gate
  `list`/`get`/`getProfile`. Its description is a literal match for the `Customer` and
  `CustomerProfile` entities only. It does **not** mention address, contact method, or identity
  document data, and silently stretching it to cover those would repeat exactly the "ambiguous
  repurposing" mistake `CUSTOMER-READ-01`'s own instructions forbade.
- **`kyc.view`**: gates `GET /customers/:id/kyc`, which returns the `CustomerKycAssessment`
  entity (`level`, `status`, `reason`, `assessedBy`, `isCurrent`, `expiresAt`) — confirmed by
  direct entity read (`src/customer/customer-kyc-assessment.entity.ts`). It contains **no**
  `documentNumber` or any raw identity-document field. `kyc.view` and
  `GET /customers/:id/identity-documents` are backed by two entirely separate entities/tables
  (`customer_kyc_assessments` vs `customer_identity_documents`) — `kyc.view` cannot be stretched
  to cover identity documents either, for the same reason `customer.view` cannot.
- **`customer.view_transactions`**, **`customer.view_wallets`**: scoped to transaction history
  and wallet data respectively (per their own catalogue descriptions); neither applies here.
- **No catalogue function of any kind** currently has a description referencing address, contact
  method, or identity document data. This was independently confirmed by grepping the full seed
  file for `address`, `contact`, and `identity` — no matches outside `customer.view`'s own
  general-profile description.

**Conclusion:** the catalogue genuinely has a gap, not merely an un-enforced existing function.
Any fix requires new catalogue entries — this document proposes them in §6, subject to Product
Owner approval.

## 6. Proposed function catalogue additions

**[PROPOSED — REQUIRES PRODUCT OWNER DECISION for every row below.]** Format follows the existing
catalogue convention (`src/authorization-catalogue/authorization-catalogue.seed.ts` /
`V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` §7). The `sensitivity` field uses the catalogue's
existing **action-type** taxonomy (`READ`/`OPERATIONAL`/`SENSITIVE`/`PRIVILEGED`/
`CRITICAL_FINANCIAL`), consistent with the existing precedent that `kyc.view` is tagged `READ`
despite the underlying data being classified `Highly Restricted` under `ADR-0024` — the two
taxonomies are not the same axis and this document does not conflate them. The `ADR-0024` data
classification is called out separately per function, since it is the actual argument for
differentiated role assignment (§7).

### 6.1 `customer.view_address`

| Field | Value |
|---|---|
| Function code | `customer.view_address` |
| Domain | `CUSTOMER` |
| Name | View customer address |
| Description | View a customer's registered physical address(es). |
| Governs | `GET /customers/:id/addresses` |
| Catalogue sensitivity | `READ` |
| `ADR-0024` data classification | **Restricted** ("Customer identity and profile" row explicitly bundles "contacts, addresses, and identity fields" at this tier) |
| V1 status (once wired) | `IMPLEMENTED` (endpoint and data already exist; only the authorization gate is new) |
| Assignable in V1? | Yes |
| Reveals sensitive PII? | Yes — physical address is direct customer PII, but at the same `ADR-0024` tier as general profile, not the higher tier |
| CUSTOMER self-service impact | None — CUSTOMER principals remain exempt from any function check on their own record, identical to the existing `customer.view`/`kyc.view` exemption pattern |
| SUPPORT needs a separate entitlement? | Not evidenced — `AdminCustomerController` does not expose address data today and no test or business requirement was found requesting it for SUPPORT |

### 6.2 `customer.view_contact_methods`

| Field | Value |
|---|---|
| Function code | `customer.view_contact_methods` |
| Domain | `CUSTOMER` |
| Name | View customer contact methods |
| Description | View a customer's registered phone/email contact methods (raw, unmasked values). |
| Governs | `GET /customers/:id/contact-methods` |
| Catalogue sensitivity | `READ` |
| `ADR-0024` data classification | **Restricted** (same "Customer identity and profile" row — "contacts" explicitly named) |
| V1 status (once wired) | `IMPLEMENTED` |
| Assignable in V1? | Yes |
| Reveals sensitive PII? | Yes — raw phone/email, same tier as address/profile |
| CUSTOMER self-service impact | None — identical exemption pattern |
| SUPPORT needs a separate entitlement? | The existing `AdminCustomerController.getPhoneVerification()` already gives SUPPORT a **masked-phone-only** view under its own (out-of-scope) authorization path. No business requirement was found for SUPPORT to see raw, unmasked contact values through this or any other surface. If SUPPORT's existing masked view is ever judged insufficient, that is itself a SUPPORT-governance question, explicitly out of scope here. |

### 6.3 `customer.view_identity_documents`

| Field | Value |
|---|---|
| Function code | `customer.view_identity_documents` |
| Domain | `CUSTOMER` |
| Name | View customer identity documents |
| Description | View a customer's identity documents, **including the raw government document number**. |
| Governs | `GET /customers/:id/identity-documents` |
| Catalogue sensitivity | `READ` (action-type only — see the explicit caution below) |
| `ADR-0024` data classification | **Highly Restricted** ("Identity documents and KYC evidence ... Approved personnel and purpose only; no raw document contents in generic logs/events/APIs" — one tier above `customer.view`/address/contact-methods) |
| V1 status (once wired) | `IMPLEMENTED` |
| Assignable in V1? | Yes, but to a **materially narrower** role set than the other three functions (§7) |
| Reveals sensitive PII? | **Yes — the single most sensitive field addressed by this document**: a raw government-issued identity document number (passport/NIN/driver's-licence-class value, per `CustomerIdentityDocument.documentNumber`) |
| CUSTOMER self-service impact | None — identical exemption pattern; a customer reading its own identity documents is unaffected |
| SUPPORT needs a separate entitlement? | No evidence of any existing or planned SUPPORT need; `AdminCustomerController` deliberately does not expose this data at all today |

**Explicit caution carried into §7:** tagging this function `sensitivity: READ` in the catalogue's
action-type taxonomy (consistent with `kyc.view`) must **not** be read as equivalent treatment to
`customer.view`/`customer.view_address`/`customer.view_contact_methods`. `ADR-0024`'s own
classification places it one tier higher, and this document recommends the role assignment reflect
that, not the catalogue's action-type tag.

## 7. Proposed ten-role assignment matrix

**[PROPOSED — REQUIRES PRODUCT OWNER DECISION.]** "Yes" means this document recommends the grant;
"OPEN" means this document deliberately does not pick a default and asks the Product Owner to
decide (§12); "No" means deny.

| Role | `customer.view` (existing, unchanged) | `customer.view_address` (proposed) | `customer.view_contact_methods` (proposed) | `customer.view_identity_documents` (proposed) |
|---|---|---|---|---|
| SUPER_ADMIN | Yes (existing) | Yes | Yes | **OPEN** — see §12 Decision 1 |
| FINANCE_PREPARER | No (existing) | No | No | No |
| FINANCE_CONTROLLER | No (existing) | No | No | No |
| FINANCE_AUDITOR | Yes (existing) | Yes | Yes | **OPEN** — see §12 Decision 2 |
| OPERATIONS | Yes (existing) | Yes | Yes | No (recommended) |
| AGENT_NETWORK_MANAGER | No (existing) | No | No | No |
| COMPLIANCE | Yes (existing) | Yes | Yes | Yes (recommended primary holder) |
| RISK_FRAUD | No (existing) | No | No | No |
| CUSTOMER_SERVICE | Yes (existing) | Yes | Yes | No (recommended) |
| TREASURY | No (existing) | No | No | No |

### Rationale by role

- **FINANCE_PREPARER, FINANCE_CONTROLLER, AGENT_NETWORK_MANAGER, TREASURY — No, across all three
  new functions.** None hold `customer.view` today (per the seed and the ten-role
  `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` §9 matrix); no business justification was found in any
  reviewed document for why these roles would need address/contact/identity-document visibility
  that they do not already have for general profile visibility. Recommending a new grant here
  without evidence would repeat the exact un-evidenced over-grant this document exists to close.
- **RISK_FRAUD — No, across all three.** `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md` Decisions 8
  and 9 are explicit, final Product Owner decisions that `RISK_FRAUD` "remains thin in V1" and is
  "restricted to FRAUD [compliance-case-category] cases only" — no blanket customer-PII grant was
  authorized by those decisions, and `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` §9's matrix marks
  `RISK_FRAUD`'s `customer.view` cell `CONDITIONAL (fraud-linked only)`, a conditional-access
  model V1 does not implement — consistent with denying it the new functions by default too.
- **OPERATIONS, CUSTOMER_SERVICE — Yes for address/contact-methods, recommended No for
  identity-documents.** Both already hold `customer.view` for day-to-day customer servicing
  (`V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` explicitly lists `CUSTOMER_SERVICE` as holding
  `customer.view_wallets`/`view_transactions` "view only," and `OPERATIONS` performs lifecycle
  actions that plausibly require seeing where/how to reach a customer). Address and contact
  information at the `ADR-0024` Restricted tier is consistent with that existing servicing
  mandate. Raw identity-document numbers are a different, higher tier
  ("approved personnel and purpose only") with no evidenced servicing need — customer service and
  operations work does not inherently require reading a raw passport/NIN number, only confirming a
  document *exists* and is *current* (which `kyc.view`'s assessment-level data already partially
  supports without exposing the number itself).
- **COMPLIANCE — Yes for all three, including identity-documents as the primary intended
  holder.** `ADR-0024` names "`customer`; Compliance/Risk" as the data owner for "Identity
  documents and KYC evidence." `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md` Decision 5 already
  establishes the precedent of keeping KYC-adjacent decision functions "exclusively Compliance
  functions" (`kyc.review`/`.approve`/`.reject`). Extending that same exclusivity principle to
  identity-document *viewing* is a direct continuation of an already-made decision, not a new
  policy direction.
- **SUPER_ADMIN, FINANCE_AUDITOR — address/contact-methods Yes (same reasoning as
  `customer.view`'s existing grant); identity-documents left OPEN.** See §12.

## 8. Specific treatment of raw identity-document numbers

This is the single highest-risk item in this document and is treated separately per the task's
explicit instruction.

- **Current state [REPOSITORY FACT]:** `GET /customers/:id/identity-documents` returns the raw,
  unmasked `documentNumber` field to any `OPERATOR`/`SERVICE`/`PRIVILEGED` principal, regardless of
  V1 role, with zero function-level gate and zero display masking. This is a stricter exposure
  than any other endpoint audited across this task and the prior `CUSTOMER-READ-01` task.
- **Authoritative classification [REPOSITORY FACT, `ADR-0024`]:** "Identity documents and KYC
  evidence" are classified **Highly Restricted** — the ADR's highest tier, reserved otherwise for
  "Credentials, ... investigative content, risk reasoning, or financial-control evidence." Its
  stated minimum controls are "Dedicated owner, strongest access controls, no plaintext or
  external disclosure by default, hold support," and its row-level note is explicit: "Approved
  personnel and purpose only; no raw document contents in generic logs/events/APIs."
- **Note on `ADR-0024`'s own status [REPOSITORY FACT]:** the ADR's header states "Status: Proposed
  for A1 architecture review" and "Implementation status: Decision input only; no privacy service,
  deletion job, API, migration, external integration, or runtime configuration is implemented." It
  is therefore an architecturally-adopted classification input, not itself a self-executing
  control — this document treats it as the authoritative **data classification basis** for the
  proposal, while recognizing the Product Owner may need to separately confirm it still governs.
- **This document's position:** `customer.view_identity_documents` should be assigned to
  meaningfully fewer roles than `customer.view`/`customer.view_address`/
  `customer.view_contact_methods`, reflecting the one-tier-higher classification. §7 recommends
  `COMPLIANCE` as the clear, decision-precedent-backed primary holder and explicitly leaves
  `SUPER_ADMIN` and `FINANCE_AUDITOR` as open questions rather than assuming either answer — see
  §12 Decisions 1 and 2.
- **A further option not adopted by default, raised for Product Owner awareness:** `ADR-0024`'s
  "no raw document contents in generic logs/events/APIs" language could be read as supporting a
  masked-by-default API response (e.g. last-4-digits only, mirroring the phone-masking convention
  already used elsewhere in this codebase) with a *separate*, even narrower function required to
  reveal the full number. This document does **not** propose that as the default recommendation
  (it would be a new display-masking feature, not pure authorization wiring, arguably adjacent to
  "business logic changes" this task is not authorized to make) but flags it as a lower-risk
  alternative the Product Owner may prefer over an all-or-nothing raw-number grant. See §12
  Decision 3.

## 9. CUSTOMER self-service implications

**No change is proposed or implied to CUSTOMER self-service anywhere in this document.** Every
proposed function, if implemented, would follow the exact exemption pattern already established by
`customer.view` (`CUSTOMER-READ-01`) and `kyc.view` (`KYC-01`): a `CUSTOMER` principal is exempted
from the new function check entirely and remains governed only by the pre-existing
`customerAccess: 'SELF'` route-policy check (its own `customerId` must match the resource). A
customer reading its own addresses, contact methods, and identity documents continues to work
exactly as today; a customer attempting to read another customer's data continues to be denied
with 403 exactly as today. This document does not propose broadening CUSTOMER access to another
customer's data, and does not propose narrowing a customer's access to its own data.

## 10. SUPPORT dependencies and outstanding governance decisions

- **SUPPORT has zero dependency on any of the three proposed functions as currently scoped.**
  `SUPPORT` is already excluded from `CustomerController`'s entire `/customers/*` surface
  (§3.2) and does not reach `addresses`/`contact-methods`/`identity-documents` today under any
  circumstance. Implementing the three proposed functions would not change SUPPORT's reachability
  of these specific endpoints at all.
- **A separate, adjacent concern exists but is explicitly not resolved here:** `AdminCustomerController`
  (where SUPPORT *is* a deliberately-tested consumer) exposes the same `Customer` entity fields as
  `GET /customers/:id` (now `customer.view`-gated) through its own `getOne()`/`list()` endpoints,
  gated only by the legacy type-only `requireWorkforce()` deny-list — meaning the identical data is
  reachable two ways with two different authorization models, one of which (the
  `AdminCustomerController` path) is not a catalogue-function check at all and does include
  SUPPORT. This document records the observation but does **not** propose resolving it, per the
  explicit task instruction that SUPPORT catalogue governance is out of scope.
- **Does SUPPORT need a dedicated, narrower "customer investigation" function for
  address/contact/identity-document data?** No existing test, controller, or decision document
  evidences such a requirement — `AdminCustomerController`'s design already keeps raw address and
  identity-document data out of SUPPORT's reach entirely, and masks the one piece of contact data
  (phone) it does expose. This document does not manufacture a requirement that is not evidenced in
  the repository. If a future product requirement emerges for SUPPORT to see customer-PII beyond
  its current masked phone-verification view, it should be scoped as its own explicit,
  independently-governed SUPPORT catalogue task (out of scope here, consistent with
  `CUSTOMER-READ-01`'s own treatment of `AdminCustomerController`).

## 11. Security risks if the existing behavior remains unchanged

1. **Raw government identity-document numbers are disclosed to roles with no documented
   relationship to identity/compliance work.** `FINANCE_PREPARER`, `FINANCE_CONTROLLER`,
   `AGENT_NETWORK_MANAGER`, `RISK_FRAUD`, and `TREASURY` can all read any customer's raw
   `documentNumber` today purely because their workforce session's `principal.type` is `OPERATOR`
   — none of the ten roles' own declared scopes/descriptions in
   `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` mention identity-document access, and `ADR-0024`
   classifies this data one tier above general profile data.
2. **No masking exists anywhere on this surface**, unlike the phone-masking convention already
   established elsewhere in the same codebase (`AdminCustomerController`,
   `AdminCustomerCredentialsController`) — meaning a compromised or over-broadly-scoped workforce
   session of *any* role immediately yields full, unredacted PII (address, phone/email, and
   government ID number), not a minimized or masked view.
3. **Blast radius is the full ten-role workforce population, not a defensible subset.** Because
   gating is by principal type (`OPERATOR`/`SERVICE`/`PRIVILEGED`) rather than by function, a
   single-purpose, narrowly-scoped role such as `TREASURY` (per Decision 6, launches with
   "exactly one function: `reconciliation.view`") or `RISK_FRAUD` (per Decisions 8/9, deliberately
   kept "thin") carries the exact same customer-PII read access as `SUPER_ADMIN` on this specific
   surface — directly contradicting each role's own documented, narrow intended scope.
4. **This is the same defect class already twice confirmed and twice closed elsewhere** (KYC
   functions by `KYC-01`; general profile by `CUSTOMER-READ-01`) — leaving it open here means the
   authorization model is internally inconsistent: a workforce role correctly denied general
   profile access via `customer.view` can still read that same customer's raw identity-document
   number through the unmigrated endpoint, which is a more sensitive field than the one it was
   just denied.
5. **No audit-trail distinction exists today between "someone viewed a customer's general profile"
   and "someone viewed a customer's raw identity document number."** `AuthorizationService.authorize()`
   records a decision only for function-gated routes; since none of the three endpoints are
   function-gated, no authorization-decision audit record is produced for any of these reads today,
   regardless of role.

## 12. Explicit Product Owner decisions required before implementation

Each decision below is independent and can be answered on its own.

**Decision 1 — Should `SUPER_ADMIN` receive `customer.view_identity_documents`?**
- Option (a): Yes — preserve the existing repository-wide convention that `SUPER_ADMIN` holds
  every catalogue function without exception (confirmed: every `nowAssign('SUPER_ADMIN', ...)`
  entry in the current seed covers the entire catalogue, with no prior carve-out of any field,
  including `ledger.post`, `kyc.approve`, and `workforce.user.suspend`).
- Option (b): No, or conditional — treat raw identity-document numbers as a new, narrower
  exception to that convention, on the basis that `ADR-0024` singles this data out as the
  platform's highest sensitivity tier and that "administrative visibility does not automatically
  justify unrestricted access to every sensitive field" (this task's own framing). This would be a
  new precedent, not a continuation of an existing one, and the Product Owner should decide it
  explicitly rather than have it default silently either way.

**Decision 2 — Should `FINANCE_AUDITOR` receive `customer.view_identity_documents`?**
- Option (a): Yes — `FINANCE_AUDITOR` already holds `kyc.view` (KYC decision/assessment data) and
  `customer.view` (general profile); if audit evidence sampling requires confirming the existence
  and correctness of underlying identity documents (not merely the KYC decision about them), the
  auditor role may need the same visibility.
- Option (b): No — `FINANCE_AUDITOR`'s declared purpose (`A2_FINANCE_ROLES_JSON`:
  "Read-oriented assurance role") does not itself establish a need for raw document numbers
  specifically (as opposed to document *existence*/*type*/*expiry*, which `kyc.view`'s
  existing assessment-level data already partially supports); `COMPLIANCE` alone may be
  sufficient, consistent with `Decision 5`'s precedent of keeping KYC-adjacent access
  Compliance-exclusive.

**Decision 3 — Should `GET /customers/:id/identity-documents` mask the document number by
default, with a separate, narrower function required to reveal it in full?**
- Option (a): No — keep a single function (`customer.view_identity_documents`) governing full,
  unmasked access, scoped to a small role set per Decisions 1–2.
- Option (b): Yes — return a masked projection (e.g. last 4 characters) under
  `customer.view_identity_documents`, and introduce a second, even narrower function (e.g.
  `customer.view_identity_document_number`) for the small number of roles that genuinely need the
  full raw value. This is a larger change (new response shape, not just an authorization gate) and
  was not assumed as the default recommendation in §8, but is offered here as an explicit,
  answerable option.

**Decision 4 — Should `customer.view_address` and `customer.view_contact_methods` be approved as
proposed in §7 (same role set as `customer.view`), or should the Product Owner specify a different
set?** This document's default recommendation mirrors `customer.view`'s existing role set exactly,
on the basis that `ADR-0024` classifies this data at the identical Restricted tier as general
profile data and no evidence was found suggesting a narrower set is warranted. The Product Owner
may still choose to diverge (e.g. deny `FINANCE_AUDITOR` address/contact visibility even though it
retains `customer.view`).

**Decision 5 — Should the parallel `AdminCustomerController` exposure of the same `Customer`
fields as `GET /customers/:id` (§10) be scoped as a follow-up task now, deferred, or left as a
documented but accepted inconsistency pending separate SUPPORT governance work?** This document
takes no position beyond recording the observation, per the explicit SUPPORT-governance
out-of-scope instruction for this task.

**Decision 6 — Should any of these three functions be `makerCheckerRequired`/`approvalRequired`?**
All existing READ-sensitivity functions in the catalogue (`customer.view`, `kyc.view`,
`agent.view`, etc.) are plain `VIEW`-type grants with no maker/checker step — this document
recommends consistency with that existing convention (no maker/checker for read-only PII
visibility) but flags it as a decision rather than assuming it, since `identity-documents`' higher
sensitivity tier is a plausible basis for divergence if the Product Owner wants one.

## 13. Recommended implementation sequence (not started; for Product Owner reference only)

1. Product Owner resolves Decisions 1–6 in §12.
2. Add the approved subset of `customer.view_address` / `customer.view_contact_methods` /
   `customer.view_identity_documents` (or the Decision-3 masked-projection alternative) to
   `src/authorization-catalogue/authorization-catalogue.seed.ts`, following the exact existing
   `nowAssign(...)` pattern, restricted to the approved role set per function.
3. Wire `CustomerController.getAddresses`/`getContactMethods`/`getIdentityDocuments` via a new
   private helper mirroring the established `requireKycFunction`/`requireCustomerViewFunction`
   pattern (CUSTOMER principal exempted, `AuthorizationService.requireFunction(...)` for all
   other principal types, no `deniedStatus` override since these are brand-new checks).
4. Update `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` §7's CUSTOMER domain catalogue table and §9's
   role/function matrix to add the newly-approved rows, keeping the document as the single
   authoritative source of the role/function matrix.
5. Write a focused real-Postgres/real-HTTP integration suite proving the same proof points
   established by `CUSTOMER-READ-01` and `KYC-01`: role-without-function → 403; entitled role →
   200; the narrowly-scoped role (e.g. `FINANCE_AUDITOR`, if Decision 2 denies it) does not gain
   access merely by principal type; CUSTOMER self-service unaffected; 401 for unauthenticated;
   unrelated roles not accidentally granted.
6. Run the full regression battery: the focused new suite, the `CUSTOMER-READ-01`/`KYC-01`/
   `READ-SURFACE-01`/`FOUNDATION-01`/`HARDENING-01`/`S-FIX-01`/`a26-customer-profile-hardening`/
   `v1-hardening-06-admin-customer-investigation` suites, the full unit suite
   (`npx jest --maxWorkers=2`), the full Postgres suite (`npm run test:pg`), `npm run build`, and
   `npx tsc --noEmit`.
7. Separately, and only as its own explicitly-scoped task, consider Decision 5's
   `AdminCustomerController` parallel-surface observation and any SUPPORT-specific investigation
   entitlement — both remain out of scope for the implementation sequence above.

## Appendix — sources consulted

- `src/customer/customer.controller.ts`, `src/customer/customer.service.ts`,
  `src/customer/customer-address.entity.ts`, `src/customer/customer-contact-method.entity.ts`,
  `src/customer/customer-identity-document.entity.ts`,
  `src/customer/customer-kyc-assessment.entity.ts` (direct code read, this task)
- `src/authorization/route-policy-registry.ts`, `src/authorization/authorization.service.ts`
  (direct code read, this task and carried forward from `CUSTOMER-READ-01`)
- `src/authorization-catalogue/authorization-catalogue.seed.ts`,
  `src/authorization-catalogue/authorization-catalogue.enums.ts` (direct code read, this task)
- `src/admin/admin-customer.controller.ts`, `src/admin/admin-customer-credentials.controller.ts`
  (direct code read, this task)
- `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` (direct read, this task)
- `docs/decisions/ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md` (direct
  read, this task)
- `docs/V1/V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01.md` (direct read, this task)
- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` (direct read, this task)
- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md` (direct read, this task)
- `docs/V1/V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01-REPORT.md` (direct read, this task)
