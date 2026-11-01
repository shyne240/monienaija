# Mission 25G — preference API authorization matrix

**Scope:** 25E baseline versus the Mission 25G implementation. The full real-guard PostgreSQL matrix has passed. Integration-review readiness is conditional on the authorized checkpoint being pushed and its remote tip verified; this is not independent security reapproval or deployment authorization.

Paths are `/api/v1/customers/:id/preferences` and its `/history` child. Each four-item cell is ordered **GET current / GET history / POST / PATCH**. `A` means the authorization layer permits reaching the handler, not a guarantee of a successful business response: the customer/preference must exist as appropriate and the request must be valid. `D` means denied at authorization, normally HTTP 403 for an authenticated caller. `R/O` means the existing read-only guard denies the unsafe method before the handler. Each workforce row models a genuine, active, single-role A2 session with the seeded catalogue; the before column is derived from the 25E source except for the separately reproduced CUSTOMER_SERVICE GET. The current column was exercised against each role using the real guard and disposable PostgreSQL.

| Single-role session | Before 25G: GET / history / POST / PATCH | 25G implementation: GET / history / POST / PATCH |
| --- | --- | --- |
| SUPER_ADMIN | A / A / A / A | D / D / D / D |
| FINANCE_PREPARER | A / A / A / A | D / D / D / D |
| FINANCE_CONTROLLER | A / A / A / A | D / D / D / D |
| FINANCE_AUDITOR | A / A / R/O / R/O | D / D / D / D |
| OPERATIONS | A / A / A / A | D / D / D / D |
| AGENT_NETWORK_MANAGER | A / A / A / A | D / D / D / D |
| COMPLIANCE | A / A / A / A | D / D / D / D |
| RISK_FRAUD | A / A / A / A | D / D / D / D |
| CUSTOMER_SERVICE | A / A / A / A | D / D / D / D |
| TREASURY | A / A / A / A | D / D / D / D |
| ADMINISTRATOR | A / A / A / A | D / D / D / D |
| Authenticated CUSTOMER, own route ID | A / A / A / A | A / A / A / A |
| Authenticated CUSTOMER, another route ID | D / D / D / D | D / D / D / D |
| AGENT or SUPPORT session | D / D / D / D | D / D / D / D |
| Anonymous caller | 401 / 401 / 401 / 401 | 401 / 401 / 401 / 401 |

**Before:** generic customer routes admitted `CUSTOMER`, `OPERATOR`, `SERVICE` and `PRIVILEGED` and declared no preference-specific function. The generic `SELF` check compared IDs for a CUSTOMER, but did not constrain a non-customer principal after the principal-type gate. A2 workforce sessions resolve to OPERATOR or PRIVILEGED; `customer.view` was not required. FINANCE_AUDITOR is read-only as a single-role session; the existing guard derives read-only status from *all* recognized roles, so mixed-role outcomes depend on the actual resolved session rather than the row label alone. A real CUSTOMER_SERVICE GET returned 200 in the 25E reproduction. Matrix claims for other pre-fix roles are source-derived, not a claim of 11 independent pre-fix role probes.

**Current:** a validated CUSTOMER is allowed only its own route ID. The controller additionally requires a session, CUSTOMER type, SELF access and matching `principalId`, `customerId` and route ID. Workforce, AGENT and SUPPORT are denied even if they hold `customer.view`, `audit.view` or provider-oversight permissions. The existing read-only unsafe-method guard remains intact. A malformed or inconsistent route binding is denied. `/customers/me/preferences` is not an implemented self-service alias and is denied. HEAD receives the GET boundary, and percent-encoded static path segments and preference descendants are covered.

A self-service create or update may omit the legacy `actor` field; if supplied and valid it is ignored and the actual authenticated customer UUID is recorded. Historical actor values are not rewritten. Denied requests may create authorization-decision audit events, but do not mutate preference, preference history or corresponding business-audit records. Generic audit endpoints and the audit dashboard now hide preference records and preference-route decision metadata for all workforce roles; the underlying rows remain intact. The separate operational audit summary still returns aggregate counts by action/entity type, not per-customer values.

**Policy dependency:** workforce current-setting reads, history/audit oversight and writes each require an explicit product/security decision before any future grant. `customer.view`, principal type and UI visibility are not that authorization. The Admin Web still contains stale comments/copy about workforce visibility; Arena 2 must align the interface after policy review. No new role or permission was created.
