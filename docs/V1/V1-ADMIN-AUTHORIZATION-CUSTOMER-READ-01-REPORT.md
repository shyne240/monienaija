# V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01 — Customer Read-Surface Authorization Hardening

## 1. Executive summary

This task audited the customer-domain GET endpoints left unmigrated by
V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 due to blast-radius concerns, and closed by
V1-ADMIN-AUTHORIZATION-KYC-01 only for the KYC sub-surface (`/kyc`, `/kyc-assessment`). The
remaining six GET endpoints on `CustomerController` (`list`, `get`, `getProfile`,
`getAddresses`, `getContactMethods`, `getIdentityDocuments`) had **zero** controller-level
authorization check: any workforce principal of type `OPERATOR`/`SERVICE`/`PRIVILEGED` could
read any customer's record regardless of which specific V1 role it held (the same
"OPERATOR-collapse" defect class KYC-01 closed for the KYC surface).

Investigation of the real authorization catalogue found exactly **one** approved, dormant
function — `customer.view` ("View customer profile" / "View a customer profile and KYC tier") —
already seeded against five of the ten V1 roles (`SUPER_ADMIN`, `FINANCE_AUDITOR`, `OPERATIONS`,
`COMPLIANCE`, `CUSTOMER_SERVICE`) per the authoritative role/function matrix in
`V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md`, but never enforced anywhere in the codebase.

Applying the task's strict A/B/C authorization rule:

- **`GET /customers`, `GET /customers/:id`, `GET /customers/:id/profile`** — migrated to require
  `customer.view` (Case A: the function's own name/description is a literal, unambiguous match
  for exactly the data these three handlers return — the bare `Customer` record and the
  `CustomerProfile` record).
- **`GET /customers/:id/addresses`, `GET /customers/:id/contact-methods`,
  `GET /customers/:id/identity-documents`** — left unmigrated (Case B/C: no catalogue function's
  description covers address/contact/identity-document PII specifically; `customer.view`'s
  documented scope is narrower than these sub-resources, especially
  `identity-documents`, which exposes raw government document numbers). Documented as catalogue
  gaps below.
- **`src/admin/admin-customer.controller.ts`** (`internal/customers/*` investigation surface) —
  explicitly out of scope: its existing, deliberately-tested design
  (`test/v1-hardening-06-admin-customer-investigation.integration.spec.ts`) allows `SUPPORT` as a
  consumer alongside `OPERATOR/SERVICE/PRIVILEGED`. Any function-based migration there would
  require resolving SUPPORT's catalogue-function assignment, which is explicit task out-of-scope
  ("SUPPORT catalogue governance").

CUSTOMER self-service access to its own `/customers/:id` and `/customers/:id/profile` is
preserved exactly (CUSTOMER principal exempted from the new function check, same pattern as
KYC-01's `requireKycFunction`). No existing test broke. 46 new focused tests, 153 regression
tests, 1823 unit tests, and the full 99-file real-Postgres suite all pass. Build and typecheck
are clean.

## 2. Baseline commit

`3f1ee347a7d363d0dc0ffcee055650ad1d364627` — `feat(v1-admin-authz): enforce kyc function
authorization` (the completed V1-ADMIN-AUTHORIZATION-KYC-01 checkpoint).

## 3. Customer-domain GET endpoint inventory (repository truth, this task)

### 3.1 `src/customer/customer.controller.ts` (`@Controller('customers')`)

| Route | Handler | Service method | Data returned | Pre-existing in-controller check |
|---|---|---|---|---|
| `GET /customers` | `list()` | `customerService.list()` | Paginated `Customer[]` | none |
| `GET /customers/:id` | `get()` | `customerService.get()` | `Customer` (id, reference, type, status, kycLevel, kycStatus, …) | none |
| `GET /customers/:id/profile` | `getProfile()` | `customerService.getProfile()` | `CustomerProfile` (displayName, legalName, dateOfBirth, nationality, isActive) | none |
| `GET /customers/:id/addresses` | `getAddresses()` | `customerService.listAddresses()` | `CustomerAddress[]` (type, lineOne/Two, city, state, country, postalCode) | none |
| `GET /customers/:id/contact-methods` | `getContactMethods()` | `customerService.listContactMethods()` | `CustomerContactMethod[]` (type, value, normalizedValue, isPrimary, verifiedAt) | none |
| `GET /customers/:id/identity-documents` | `getIdentityDocuments()` | `customerService.listIdentityDocuments()` | `CustomerIdentityDocument[]` (type, **documentNumber**, issuingCountry, issuedAt, expiresAt) | none |
| `GET /customers/:id/kyc` | `getKyc()` | `customerService.getKyc()` | KYC assessment | `requireKycFunction` → `kyc.view` (closed by KYC-01, not reopened here) |

### 3.2 Route-policy-registry behavior (`src/authorization/route-policy-registry.ts`)

All seven routes above resolve through the single generic branch at
`path.startsWith('/api/v1/customers/')` / `path === '/api/v1/customers'`:

```
allowedPrincipalTypes: ['CUSTOMER', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
customerAccess: 'SELF'   // 'NONE' for the bare list/create path (no :id to scope)
```

`SUPPORT` and `AGENT`/`AGGREGATOR` are **not** in `allowedPrincipalTypes` for this branch
(explicit S-FIX-01/UAT-DEFECT-001 decision, confirmed in code comments) — they are already
denied at the route-policy layer before any controller code runs. This means migrating these six
GETs to a `customer.view` requirement cannot touch SUPPORT's access at all (it has none here to
begin with) — ruling out the SUPPORT-governance concern for this specific controller.

### 3.3 AuthorizationService behavior (`src/authorization/authorization.service.ts`)

`RuntimeAccessGuard` resolves the route policy for every request and calls
`AuthorizationService.evaluate()`/`authorize()` before the controller runs. For a
`customerAccess: 'SELF'` policy:

- `CUSTOMER` principal: allowed only if `principal.customerId === resource.customerId`, denied
  (`CUSTOMER_SCOPE_MISMATCH`, 403) otherwise.
- Any other principal type already permitted by `allowedPrincipalTypes` (`OPERATOR`, `SERVICE`,
  `PRIVILEGED`): the `SELF` scope check is a documented no-op for non-CUSTOMER principals (see
  `checkCustomerScope`'s comment, added by V1-ADMIN-FULL-SURFACE-AUDIT-01) — it does **not**
  additionally restrict them. This is exactly why, before this task, *any* workforce role of
  these three principal types could read *any* customer's record via these six routes, with no
  further distinction by actual V1 role.

`AuthorizationService.requireFunction(principal, functionCode, resourceType,
allowedPrincipalTypes)` is the existing, reusable mechanism (introduced by
V1-ADMIN-AUTHORIZATION-HARDENING-01, used again by KYC-01) that AND-combines a catalogue-function
check with a principal-type check — it narrows, never widens, decisions already made by
`allowedPrincipalTypes`.

### 3.4 Existing authorization function catalogue entries

From `src/authorization-catalogue/authorization-catalogue.seed.ts`:

```
{ functionCode: 'customer.view', domain: 'CUSTOMER', name: 'View customer profile',
  description: 'View a customer profile and KYC tier.', sensitivity: READ,
  v1Status: IMPLEMENTED, assignable: true }
```

No other seeded function's description references a customer address, contact method, or
identity document. `customer.view_transactions` and `customer.view_wallets` exist but are scoped
to transaction history and wallet data respectively (consumed, if at all, by
`AdminCustomerController`'s investigation endpoints — out of scope, §7) — neither applies to
`profile`/`addresses`/`contact-methods`/`identity-documents`.

`customer.view` was, before this task, seeded in the catalogue and spot-checked by
`test/v1-admin-authorization-foundation-01.integration.spec.ts` (catalogue-shape assertion only)
but **enforced by zero controllers anywhere in the codebase** — confirmed by
`grep -rln "'customer.view'" src/ test/` returning only that one catalogue-shape test.

### 3.5 Which roles hold `customer.view` (verified against the seed, matches
`V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` §9 matrix exactly)

| Role | Holds `customer.view`? |
|---|---|
| SUPER_ADMIN | **Yes** |
| FINANCE_PREPARER | No |
| FINANCE_CONTROLLER | No |
| FINANCE_AUDITOR | **Yes** |
| OPERATIONS | **Yes** |
| AGENT_NETWORK_MANAGER | No |
| COMPLIANCE | **Yes** |
| RISK_FRAUD | No (spec marks `CONDITIONAL (fraud-linked only)`; conditional/case-linked logic is not implemented in V1, so the seed correctly omits the assignment — deny-by-default, matching every other unimplemented-conditional in this codebase) |
| CUSTOMER_SERVICE | **Yes** |
| TREASURY | No |

### 3.6 CUSTOMER self-service behavior

Confirmed via direct code read of `authorization.service.ts`'s `checkCustomerScope`: a `CUSTOMER`
principal's SELF-scoped access to its own `/customers/:id` and `/customers/:id/profile` (and the
three non-migrated sub-resources) is enforced entirely at the `RuntimeAccessGuard`/route-policy
layer, independent of any catalogue function — catalogue functions are a workforce-only
authorization unit (`CUSTOMER` principals never carry any function code in `principal.scopes`).
This is identical to the exemption pattern KYC-01 already established for `getKyc`.

### 3.7 Existing tests covering these endpoints (before this task)

- `test/a26-customer-profile-hardening.integration.spec.ts` and all other customer-app tests
  exercise `/customers/me/profile` — a **different route and different controller**
  (`customer-app.controller.ts`, matched by the earlier, separate `/customers/me*` route-policy
  branch, strictly `CUSTOMER` `SELF`). Zero overlap with `CustomerController`'s
  `/customers/:id/profile`.
- `test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts` exercises
  `GET /customers` and `GET /customers/:id` — only ever with a `SUPER_ADMIN` session (which holds
  `customer.view`) or a `SUPPORT` session (already denied by `allowedPrincipalTypes`, unaffected).
- `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts` exercises
  `GET /customers/:id` with real `CUSTOMER` sessions (self and cross-customer) — unaffected,
  since `CUSTOMER` is exempted from the new check.
- `test/a7-agent-authentication-http.integration.spec.ts` exercises `GET /customers/:id` with a
  real `AGENT` session, expecting 403 — unaffected (`AGENT` is denied by `allowedPrincipalTypes`
  before the new function check is ever reached).
- **No existing test** exercised `GET /customers/:id/profile`, `/addresses`,
  `/contact-methods`, or `/identity-documents` (the non-`/me` routes) with any workforce role at
  all — confirmed by grep across `test/*.spec.ts`. Zero regression risk from migrating or not
  migrating any of them.

### 3.8 SUPPORT / non-workforce principal consumption

Confirmed `SUPPORT` is **not** in `allowedPrincipalTypes` for any route on
`CustomerController` (the generic `/customers*` branch explicitly excludes it, per the
S-FIX-01/UAT-DEFECT-001 comment in `route-policy-registry.ts`). SUPPORT's actual customer-reading
surface is the separate `AdminCustomerController` (`internal/customers/*`), which is out of
scope for this task (§7).

## 4. Endpoint-by-endpoint authorization assessment and rule classification

| Endpoint | Data | Rule | Decision |
|---|---|---|---|
| `GET /customers` | `Customer[]` (same shape as single-record GET) | **A** | Migrated → `customer.view` |
| `GET /customers/:id` | `Customer` — "a customer record/profile" (literal SPEC-01 wording) | **A** | Migrated → `customer.view` |
| `GET /customers/:id/profile` | `CustomerProfile` — displayName/legalName/DOB/nationality; function's own name is literally "View customer profile" | **A** | Migrated → `customer.view` |
| `GET /customers/:id/addresses` | `CustomerAddress[]` — physical address PII | **B** | Left unchanged — no function covers address PII; `customer.view`'s description does not extend here |
| `GET /customers/:id/contact-methods` | `CustomerContactMethod[]` — phone/email PII | **B** | Left unchanged — no function covers contact PII |
| `GET /customers/:id/identity-documents` | `CustomerIdentityDocument[]` — **government document numbers** | **B/C** | Left unchanged — more sensitive than `customer.view`'s documented scope; no dedicated function exists |

## 5. Existing function mapping

- `customer.view` → `GET /customers`, `GET /customers/:id`, `GET /customers/:id/profile`
  (migrated).
- No approved function exists for `/addresses`, `/contact-methods`, `/identity-documents`
  (left unmigrated, documented as catalogue gaps in §13).

## 6. Endpoints migrated

1. `GET /customers` (list)
2. `GET /customers/:id` (get)
3. `GET /customers/:id/profile` (getProfile)

Each now calls a new private helper, `CustomerController.requireCustomerViewFunction(req)`,
before delegating to the service — an exact structural copy of KYC-01's
`requireKycFunction` pattern:

```ts
private async requireCustomerViewFunction(req: AuthenticatedRequest): Promise<void> {
  const principal = req.authorizationPrincipal;
  if (!principal) throw new UnauthorizedException('Authentication required');
  if (principal.type === 'CUSTOMER') {
    return; // CUSTOMER self-service unaffected — scoped by route-policy SELF check only
  }
  await this.auth.requireFunction(principal, 'customer.view', 'customer', [
    'OPERATOR', 'SERVICE', 'PRIVILEGED',
  ]);
}
```

No `deniedStatus` override: these are brand-new checks with no pre-existing 401 convention to
preserve, so the default applies (unauthenticated → 401, under-entitled workforce → 403).

## 7. Endpoints deliberately left unchanged

1. `GET /customers/:id/addresses`
2. `GET /customers/:id/contact-methods`
3. `GET /customers/:id/identity-documents`
4. The entire `AdminCustomerController` (`internal/customers/*`) investigation surface —
   `list`, `getOne`, `listTransactions`, `listWallets`, `getWalletBalance`,
   `listSupportTickets`, `getPhoneVerification` — all gated only by the pre-existing
   `requireWorkforce()` deny-list (`AGENT`/`CUSTOMER`/`AGGREGATOR` denied, everyone else
   including `SUPPORT` allowed). This is a deliberately tested design
   (`test/v1-hardening-06-admin-customer-investigation.integration.spec.ts`,
   "SUPPORT/OPERATOR/SERVICE/PRIVILEGED allowed"). Migrating it to a catalogue-function
   requirement would necessarily decide SUPPORT's function entitlement — explicit task
   out-of-scope ("SUPPORT catalogue governance"). Not touched.

Each of the three non-migrated `CustomerController` GETs keeps its exact pre-existing behavior:
reachable by `CUSTOMER` (SELF only, route-policy-enforced), `OPERATOR`/`SERVICE`/`PRIVILEGED`
(any role, no function distinction), unreachable by `AGENT`/`AGGREGATOR`/`SUPPORT`, 401 if
unauthenticated. Proven unchanged by §11 test group D.

## 8. CUSTOMER self-service behavior (unaffected, proven)

A real `CUSTOMER` session (established via `POST /customers/sessions`) continues to read its own
`/customers/:id` and `/customers/:id/profile` with **no catalogue function required** — the new
helper returns immediately for `principal.type === 'CUSTOMER'`, exactly mirroring the existing
`requireKycFunction` exemption. Cross-customer access remains denied by the pre-existing
`customerAccess: 'SELF'` route-policy check, entirely unaffected by this task. Proven by test
group C (§11).

One pre-existing, **not newly introduced**, out-of-scope observation: the bare
`GET /customers` (list, no `:id`) route's policy sets `customerAccess: 'NONE'`, but
`checkCustomerScope` short-circuits with `undefined` whenever `resource.customerId` is absent
(true for this route) — meaning a real `CUSTOMER` principal is technically reachable on this
route today (it is in `allowedPrincipalTypes`). No customer-mobile code or test exercises this
path with a `CUSTOMER` session, and this task's helper now additionally exempts `CUSTOMER` from
the `customer.view` check the same as the other migrated routes — i.e. this observation's
behavior is **unchanged** by this task (not introduced, not fixed; it was already true the moment
this route's `allowedPrincipalTypes` included `CUSTOMER`, which predates this task). Fixing it
would require a `RoutePolicyRegistry` policy change, explicitly out of scope. Recorded as a gap in
§13.

## 9. Ten-role authorization results (migrated routes: `GET /customers`, `/:id`, `/:id/profile`)

All ten roles tested via real seeded catalogue + real Postgres + real HTTP
(`test/v1-admin-authorization-customer-read-01.integration.spec.ts`):

| Role | `customer.view`? | Result on migrated routes |
|---|---|---|
| SUPER_ADMIN | Yes | 200 |
| FINANCE_PREPARER | No | 403 |
| FINANCE_CONTROLLER | No | 403 |
| FINANCE_AUDITOR | Yes | 200 |
| OPERATIONS | Yes | 200 |
| AGENT_NETWORK_MANAGER | No | 403 |
| COMPLIANCE | Yes | 200 |
| RISK_FRAUD | No | 403 |
| CUSTOMER_SERVICE | Yes | 200 |
| TREASURY | No | 403 |

## 10. FINANCE_AUDITOR proof (not an OPERATOR-type collapse)

`FINANCE_AUDITOR` is `principal.type === 'OPERATOR'`, same as `FINANCE_PREPARER` and
`FINANCE_CONTROLLER`. Test group B proves FINANCE_AUDITOR succeeds (test B1, because it is
explicitly catalogue-assigned `customer.view`) while `FINANCE_CONTROLLER` — another `OPERATOR`
principal type, no catalogue assignment — is still denied with 403 on the identical route (test
B2). This demonstrates the decision is driven by the catalogue function, not the principal type.

## 11. 401/403 proof

- Unauthenticated → **401** on all three migrated routes (test group A, `A3` cases) and on the
  three non-migrated routes (test group D, `D2` cases — unaffected, pre-existing route-policy
  behavior).
- Workforce (`OPERATOR`) lacking `customer.view` → **403**, never 401 (test group A, `A2`/`A6`
  cases) — no `FUNCTION_MISSING`→401 collapse.
- Workforce holding `customer.view` → **200** (test group A, `A1`/`A5` cases).
- Real `AGENT` bearer token (wrong principal type) → 401/403 per the pre-existing
  `PRINCIPAL_TYPE_DENIED` convention, unaffected (test group A, `A4` cases).
- Real `CUSTOMER` session, own record → 200; different customer's record → 403 (test group C).

## 12. Test results

### 12.1 Focused task suite

`test/v1-admin-authorization-customer-read-01.integration.spec.ts` — **46/46 passed** (real
Postgres + real HTTP, no mocks for the authorization proof).

### 12.2 Regression suites (real Postgres + real HTTP)

Run together in one batch:

- `v1-admin-authorization-kyc-01.integration.spec.ts`
- `v1-admin-authorization-foundation-01.integration.spec.ts`
- `v1-admin-authorization-hardening-01.integration.spec.ts`
- `v1-admin-authorization-read-surface-01.integration.spec.ts`
- `s-fix-01-customer-lifecycle-authorization.integration.spec.ts`
- `a26-customer-profile-hardening.integration.spec.ts`
- `v1-hardening-06-admin-customer-investigation.integration.spec.ts`
- `v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts`
- `v1-harden-01-support-adversarial.integration.spec.ts`

**Result: 9 suites, 153/153 tests passed.**

### 12.3 Full unit suite

`npx jest --maxWorkers=2` — **174 suites, 1823/1823 tests passed.**

### 12.4 Full Postgres (real-DB) integration suite

`npm run test:pg` — **7 batches, 99 files, all passed (exit 0).** Includes the new focused suite
and all regression suites above as part of the full run.

### 12.5 Build

`npm run build` (`nest build`) — **exit 0, clean.**

### 12.6 Typecheck

`npx tsc --noEmit` — **exit 0, clean, zero errors.**

## 13. Remaining customer-domain authorization gaps (documented, not fixed here)

1. **`GET /customers/:id/addresses`, `/contact-methods`, `/identity-documents`** — no approved
   catalogue function covers these sub-resources. Any `OPERATOR`/`SERVICE`/`PRIVILEGED` workforce
   session can still read any customer's physical address, contact details, or (most
   sensitively) raw government identity-document numbers, regardless of its specific V1 role.
   Closing this would require a governance decision to either (a) extend `customer.view`'s
   documented scope explicitly to cover these fields (a semantics change, not an engineering
   change, requiring its own sign-off), or (b) mint new, dedicated functions (e.g.
   `customer.view_address`, `customer.view_identity_documents`) and decide which of the ten
   roles should hold them. This task deliberately does not make that governance call.
2. **`AdminCustomerController` (`internal/customers/*`)** — uses a legacy principal-type-only
   deny-list (`requireWorkforce`), not any catalogue function. Every `OPERATOR`/`SERVICE`/
   `PRIVILEGED`/`SUPPORT` session can read any customer's transactions, wallets, support tickets,
   and phone-verification evidence via this surface regardless of V1 role — a direct
   OPERATOR-collapse of the same class this task closes for `CustomerController`, but resolving
   it requires deciding SUPPORT's catalogue-function entitlement first (explicit task
   out-of-scope).
3. **Bare `GET /customers` CUSTOMER reachability** (pre-existing, not introduced by this task,
   see §8) — `CUSTOMER` is technically in `allowedPrincipalTypes` for a route that has no
   resource-level `customerId` to scope against, so the `SELF` concept cannot bind. No evidence
   any real client (`customer-mobile`) ever calls this bare route; a future task could tighten
   `RoutePolicyRegistry` to exclude `CUSTOMER` from this specific branch.
4. **`V1-ADMIN-AUTHORIZATION-AND-PORTAL-DECISION-01.md`** (pre-existing decision doc, line 183)
   independently flagged profile/identity-doc access via the generic `/customers/:id` branch as
   "questionable fit" for a Finance role and recommended deciding an intended owner (possibly
   Compliance) — still unresolved; consistent with gap #1 above.

## 14. Explicit out-of-scope items (per task instructions, not addressed here)

SUPPORT catalogue governance; `RoutePolicyRegistry` redesign; financial maker/checker; agent
funding governance; fee/commission/product/limit governance; KYC maker/checker (already closed by
KYC-01, not reopened); Admin Web UI; mobile apps; business logic changes; new customer features.

## 15. Security assessment

The three migrated endpoints (`list`, `get`, `getProfile`) close a genuine OPERATOR-collapse
authorization gap identical in shape to the one KYC-01 closed: five V1 roles
(`FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `AGENT_NETWORK_MANAGER`, `RISK_FRAUD`, `TREASURY`)
that should not, per the authoritative `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` matrix, be able
to read arbitrary customer profiles are now correctly denied with 403, while the five roles the
spec does authorize continue to succeed with 200. CUSTOMER self-service and all existing,
independently-tested behavior (including SUPPORT's existing, intentionally-scoped
`AdminCustomerController` access) are completely unaffected — proven by 153 regression tests, the
full 1823-test unit suite, and the full 99-file real-Postgres suite, all passing unchanged. The
change is intentionally narrow: it does not invent new catalogue functions, does not repurpose
`customer.view` beyond its documented scope, and does not touch any surface whose correct
resolution depends on a governance decision outside this task's authority (SUPPORT, identity
documents, addresses). Residual risk is limited to the three documented, left-unchanged
sub-resource GETs and the pre-existing `AdminCustomerController` surface, both carried forward
explicitly as gaps rather than silently accepted.

## 16. Final status

**COMPLETE.** Three endpoints migrated to the real, pre-existing `customer.view` catalogue
function with CUSTOMER self-service preserved exactly; three endpoints deliberately left
unmigrated with the reasoning documented; `AdminCustomerController` explicitly excluded as
SUPPORT-governance out-of-scope. All required test gates pass (focused: 46/46; regression:
153/153; unit: 1823/1823; Postgres: 99/99 files; build: clean; typecheck: clean). Changes
committed as `feat(v1-admin-authz): harden customer read authorization` and pushed to
`arena/01a10374-monienaija`.
