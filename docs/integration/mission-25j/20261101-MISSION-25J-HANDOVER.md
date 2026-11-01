# Mission 25J — Admin Web Customer-Preference Security Alignment Handover

**Prepared by:** Arena 2  
**Date:** 2026-11-01  
**Implementation Branch:** `arena/ea070127-monienaija` (session-bound Arena 2 working branch, directly parented on `5d034163b366a92e45397e261762df77ea56ea09`)  
**Parent Baseline:** `integration/mission-25h-customer-preference-security` @ `5d034163b366a92e45397e261762df77ea56ea09` (containing Mission 25G correction `0d6d567c8b6aba861f4350fcb07e0bbc96e3fc2b`)  
**Readiness Verdict:** **`READY`** (Ready for Arena 3 integration)

---

## 1. Summary of Remediated Findings

### F-25H-01 — Elimination of Unauthorized Workforce Preference Requests
- **Previous behavior:** `CustomerPersonalInformationPanel` issued `GET /customers/:id/preferences` and `GET /customers/:id/preferences/history` for `OPERATOR`/`PRIVILEGED` workforce roles holding `customer.view` (excluding `CUSTOMER_SERVICE`), generating 20 refused HTTP `403` responses across `SUPER_ADMIN`, `FINANCE_AUDITOR`, `ADMINISTRATOR`, `OPERATIONS`, and `COMPLIANCE`.
- **Correction:** Removed all workforce customer-preference `GET` requests, state, and value/history rendering branches from `CustomerPersonalInformationPanel.tsx`, replacing them with a static `Restricted` card (`data-testid="customer-preferences-card"` / `data-testid="customer-preferences-restricted"`). Zero workforce roles initiate `/customers/:id/preferences` or `/customers/:id/preferences/history` reads or mutations, zero preference values or history rows are displayed, and all authorized non-preference Customer 360 sections (`profile`, `addresses`, `contact-methods`, `identity-documents`) continue loading per established RBAC.

### F-25H-02 — Removal of Stale Policy Copy & Dead Workforce Preference Helpers
- **Previous behavior:** `CustomerPersonalInformationPanel` asserted that preference visibility belonged to *"authorized operational and privileged workforce roles with `customer.view`"* with a `"Read-only"` badge/header, and `NotificationManagementApi` carried dead `getCustomerPreferences()` and `listCustomerPreferenceHistory()` helpers with superseded `F-09` comments.
- **Correction:**
  - Updated `CustomerPersonalInformationPanel.tsx` header (`Communication & account preferences`), badge (`Restricted`), comments, and restricted copy to state the exact interim backend policy:
    > *"Customer preferences are restricted to authenticated customers accessing their own records. Workforce preference access is not authorized."*
  - Retired dead `NotificationManagementApi.getCustomerPreferences()` and `NotificationManagementApi.listCustomerPreferenceHistory()` helpers in `apps/admin-web/src/services/notification-management-api.ts` and removed unused `CustomerCommunicationPreferences` and `CustomerPreferenceHistoryRecord` interfaces from `apps/admin-web/src/services/notification-domain.ts`.
  - Updated `apps/admin-web/__tests__/customer-personal-information.test.tsx` to assert zero preference requests/mutations, zero rendered preference values, exact restricted policy copy across all 11 workforce roles, and absence of retired helpers on `NotificationManagementApi`.

---

## 2. Changed-File Inventory

1. `apps/admin-web/src/screens/authenticated/CustomerPersonalInformationPanel.tsx`
2. `apps/admin-web/src/services/notification-management-api.ts`
3. `apps/admin-web/src/services/notification-domain.ts`
4. `apps/admin-web/__tests__/customer-personal-information.test.tsx`
5. `docs/integration/mission-25j/20261101-MISSION-25J-HANDOVER.md`

**Backend, migration, role/permission, notification event/policy, and customer self-service files modified:** **`0`**.

---

## 3. Automated & Real-Browser Verification Evidence

| Verification Gate | Suites | Tests | Failures | Skipped | Exit Code |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Admin Web TypeScript (`npm run ts:check`) | — | — | 0 | 0 | `0` |
| Complete Admin Web Jest Suite (`npm test`) | `37 / 37` | `284 / 284` | 0 | 0 | `0` |
| Targeted Customer 360 Suites (`8` suites) | `8 / 8` | `69 / 69` | 0 | 0 | `0` |
| Admin Web Production Build (`vite build`) | — | — | 0 | 0 | `0` |
| Backend TypeScript (`npx tsc --noEmit`) | — | — | 0 | 0 | `0` |
| Mission 25G Customer Preference Policy Unit Suite | `1 / 1` | `12 / 12` | 0 | 0 | `0` |
| Real-Browser 11-Role + Live Backend Self-Service Matrix | — | `125 / 125` | 0 | 0 | `0` |

### Eleven-Role Real-Browser Results (Headless Chromium + Live Mission 25H Backend + Embedded PostgreSQL)

Seeded customer `m25j-cust-0001` verified live customer self-service (`POST /preferences` → `201`, `PATCH /preferences` → `200`, `GET /preferences` → `200`, `GET /preferences/history` → `200` with 2 history rows) and confirmed direct workforce `GET /preferences` remains denied (`403`). Across all 11 workforce browser sessions:

| Workforce Role | Notification Console | Customer 360 Status | Non-Pref Profile Rendered | Pref Requests | HTTP 403 | HTTP 400 / 5xx | Uncaught JS Errors |
| :--- | :--- | :--- | :---: | ---: | ---: | ---: | ---: |
| `SUPER_ADMIN` | `RENDERED_OVERVIEW` | `VERIFIED_RESTRICTED_NO_REQUESTS` | Yes | `0` | `0` | `0` | `0` |
| `FINANCE_PREPARER` | `NOT_EXPOSED` | `NO_CUSTOMERS_NAV` | N/A | `0` | `0` | `0` | `0` |
| `FINANCE_CONTROLLER` | `RENDERED_OVERVIEW` | `NO_CUSTOMERS_NAV` | N/A | `0` | `0` | `0` | `0` |
| `FINANCE_AUDITOR` | `RENDERED_OVERVIEW` | `VERIFIED_RESTRICTED_NO_REQUESTS` | Yes | `0` | `0` | `0` | `0` |
| `ADMINISTRATOR` | `NOT_EXPOSED` | `VERIFIED_RESTRICTED_NO_REQUESTS` | Yes | `0` | `0` | `0` | `0` |
| `OPERATIONS` | `RENDERED_OVERVIEW` | `VERIFIED_RESTRICTED_NO_REQUESTS` | Yes | `0` | `0` | `0` | `0` |
| `AGENT_NETWORK_MANAGER` | `NOT_EXPOSED` | `NO_CUSTOMERS_NAV` | N/A | `0` | `0` | `0` | `0` |
| `COMPLIANCE` | `NOT_EXPOSED` | `VERIFIED_RESTRICTED_NO_REQUESTS` | Yes | `0` | `0` | `0` | `0` |
| `RISK_FRAUD` | `NOT_EXPOSED` | `NO_CUSTOMERS_NAV` | N/A | `0` | `0` | `0` | `0` |
| `CUSTOMER_SERVICE` | `NOT_EXPOSED` | `VERIFIED_RESTRICTED_NO_REQUESTS` | Yes | `0` | `0` | `0` | `0` |
| `TREASURY` | `NOT_EXPOSED` | `NO_CUSTOMERS_NAV` | N/A | `0` | `0` | `0` | `0` |

---

## 4. Carried Backend & Policy Dependencies (Unchanged by Scope)

- **Workforce preference access policy:** Remains strictly denied unless and until a separate product/security policy is approved.
- **Carried items outside Mission 25J scope:** `H-04` (deposit/withdrawal notification event mappings), `H-06` (server-side trigger-lock divergence on three ordinary events), and `H-07` (`ENV_SECRET` exact credential byte binding) remain deliberately unchanged per Mission 25J scope restrictions.
- **Operational restrictions observed:** No backend security restriction modified; no production deployment; no external SMS/Email provider activation or live sends (`EMAIL=none`, `SMS=console`); no merge into `main` or any integration branch.
