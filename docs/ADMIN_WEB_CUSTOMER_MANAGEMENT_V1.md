# Admin Web Customer Management V1

**Date:** 2026-09-10  
**Branch:** arena/01a032f8-monienaija  
**Status:** Implemented

---

## Summary

Upgraded the Admin Web customer experience from a minimal 2-field CRUD screen to a comprehensive customer management interface using **only existing backend APIs**. Zero backend changes required.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/admin-web/src/screens/authenticated/CustomerDirectoryScreen.tsx` | **Complete rewrite** — New multi-step registration, tabbed customer detail, enhanced directory |
| `apps/admin-web/__tests__/customer-servicing.test.tsx` | **Updated** — Tests rewritten for new UI interactions |
| `apps/admin-web/jest.config.js` | **Fixed** — Test environment path corrected |

---

## Existing APIs Integrated

### Customer Registration (multi-step)
| Step | API Endpoint | Fields |
|------|-------------|--------|
| 1. Create | `POST /customers` | reference, type, status, actor |
| 2. Profile | `POST /customers/:id/profile` | displayName, legalName, dateOfBirth, nationality |
| 3. Phone | `POST /customers/:id/contact-method` | type=PHONE, value, isPrimary |
| 3. Email | `POST /customers/:id/contact-method` | type=EMAIL, value, isPrimary |
| 4. Address | `POST /customers/:id/address` | type, lineOne, city, state, country, postalCode, isPrimary |

### Customer Detail (tabbed view)
| Tab | API Endpoints Called | Data Displayed |
|-----|-------------------|----------------|
| Profile | `GET /customers/:id/profile`, `GET /customers/:id/contact-methods`, `GET /customers/:id/addresses` | Name, DOB, nationality, phone, email, address |
| Identity & KYC | `GET /customers/:id/identity-documents`, `GET /customers/:id/kyc` | Document types/numbers, KYC level/status |
| Onboarding | `GET /customers/:id/onboarding` | Onboarding status, lifecycle pipeline visualization |
| Risk | `GET /customers/:id/risk-profile` | Risk level, assessment date, review due date |
| Compliance | `GET /customers/:id/compliance-cases` | Case numbers, categories, severity, status |
| Eligibility | `GET /customers/:id/eligibility` | Eligibility status, reviewer, reason |
| Wallets | `GET /customers/:id/wallets` | Wallet type, currency, balance, status |
| Status | (uses customer record) | Status transitions (ACTIVATE/SUSPEND/REACTIVATE/CLOSE) |

### Customer Actions
| Action | API Endpoint |
|--------|-------------|
| Add Identity Document | `POST /customers/:id/identity-document` |
| Submit KYC Assessment | `POST /customers/:id/kyc-assessment` |
| Update Status | `PATCH /customers/:id` |

### Directory
| Feature | API Used |
|---------|----------|
| List customers | `GET /customers?status=&type=&limit=100` |
| Filter by status/type | Query parameters |
| Client-side search | Filter across loaded reference/ID/type/status |

---

## Customer Fields Exposed

### Registration Form
- **Customer Reference** (required) — maps to `reference`
- **Customer Segment** — maps to `type` (INDIVIDUAL/BUSINESS)
- **Display Name** (required) — maps to `profile.displayName`
- **Legal Name** (optional) — maps to `profile.legalName`
- **Date of Birth** (optional) — maps to `profile.dateOfBirth`
- **Nationality** (optional) — maps to `profile.nationality`
- **Phone Number** (optional, at least one contact required) — maps to `contactMethod.PHONE`
- **Email Address** (optional, at least one contact required) — maps to `contactMethod.EMAIL`
- **Street Address** (optional) — maps to `address.lineOne`
- **City** (conditional) — maps to `address.city`
- **State** (conditional) — maps to `address.state`
- **Country** (default: NG) — maps to `address.country`
- **Postal Code** (optional) — maps to `address.postalCode`

### Detail View
All fields listed above plus:
- Identity document type, number, issuing country, issue/expiry dates
- KYC level, status, reason, assessor, date
- Onboarding lifecycle state with visual pipeline
- Risk level, assessment method, review due date
- Compliance case number, category, severity, status
- Eligibility status and reviewer
- Wallet type, currency, balance (formatted as ₦N,NNN.NN), status

---

## Workflows Exposed

1. **Customer Registration** — Multi-step wizard (Identity → Contact → Address)
2. **Customer Lifecycle** — Status transitions with validation
3. **KYC Assessment** — Level/status recording with audit reason
4. **Identity Document Recording** — BVN, NIN, Passport, Driver's License, Voter's Card, Business Registration
5. **Onboarding Visibility** — View current onboarding state and pipeline

---

## Validation

- **Required fields** clearly marked with `*`
- **Phone validation** — E.164 format (regex: `^\+?[1-9]\d{7,14}$`)
- **Email validation** — Standard email pattern
- **Country validation** — 2-3 letter code, auto-uppercase
- **Date of birth** — HTML5 date input with ISO 8601 conversion
- **Contact requirement** — At least one of phone/email required
- **Address conditional** — City and state required when street is provided
- **Backend errors** — Displayed with user-friendly messages, preserving correlation IDs in console

---

## Authorization

- **FINANCE_PREPARER** and **FINANCE_ADMIN** can create customers, add documents, submit KYC
- All roles with valid workforce session can view customer directory and details
- Status transitions use the actor's `principalId`
- No authorization weakening — all operations go through existing authorization service

---

## Known Limitations

1. **No server-side search** — Backend `GET /customers` only supports filter by status/type. Client-side filtering is used across the loaded dataset (up to 100 customers). Documented as a backend product gap.

2. **No bulk operations** — Each customer must be registered individually.

3. **No profile editing** — Profile can be created but not updated (backend supports creation only via `POST /customers/:id/profile`).

4. **No contact method editing** — Contact methods can be created but not updated/deleted via the current admin UI.

5. **No address editing** — Same limitation as profile.

6. **No onboarding lifecycle management** — Can view onboarding state but cannot trigger state transitions (would require integrating with `POST /customers/:id/onboarding` and related endpoints).

7. **No risk assessment creation** — Can view risk profile but cannot create one from the admin UI (would require integrating `POST /customers/:id/risk-profile`).

8. **No compliance case creation** — Can view cases but cannot create new ones.

9. **No document image upload** — Only text-based document metadata is recorded.

10. **No transaction history** — Not integrated in the customer detail view (would require wallet transaction API).

---

## Backend Gaps Discovered

| Gap | Impact | Priority |
|-----|--------|----------|
| No text search endpoint for customers | Limits directory to client-side filtering | IMPORTANT |
| No `PATCH /customers/:id/profile` (update) | Cannot edit profile after creation | IMPORTANT |
| No `PATCH /customers/:id/contact-method/:id` | Cannot edit contacts | NICE TO HAVE |
| No `PATCH /customers/:id/address/:id` | Cannot edit addresses | NICE TO HAVE |
| Gender field missing from schema | Product gap | NICE TO HAVE |
| No document image storage | Cannot upload ID scans | IMPORTANT |
| No notification delivery service | Cannot send customer communications | NICE TO HAVE |

---

## Test Results

### TypeScript Check
```
✅ PASS — npx tsc --noEmit (0 errors)
```

### Build
```
✅ PASS — npx vite build (56 modules, 240KB bundle, built in 1.19s)
```

### Tests
```
✅ customer-servicing.test.tsx — 5/5 passed
   ✓ should load and render customer listing
   ✓ should open multi-step registration form and submit customer with profile
   ✓ should load customer detail with profile information
   ✓ should submit KYC assessment from identity tab
   ✓ should submit status lock updates when suspend button is clicked

✅ app.test.tsx — passed
✅ auth-store.test.ts — passed
✅ ledger-operations.test.tsx — passed
✅ reconciliation-observability.test.tsx — passed

⚠️ transaction-observability.test.tsx — 1 pre-existing failure
   (unrelated to customer management — "Trigger Sandbox Completion" test)

Overall: 21/22 tests passing (95.5%)
```

---

## Architecture Decision: Why a Single File

The `CustomerDirectoryScreen.tsx` is a single ~1050-line file containing all customer management components. This matches the existing admin-web pattern where each screen is a single self-contained file (e.g., `LedgerOperationsScreen.tsx`, `TransactionObservabilityScreen.tsx`). No framework dependencies were added.

The file is organized into clear sections:
1. **Types** — All TypeScript interfaces
2. **Helpers** — Formatting, status colors, reusable micro-components
3. **RegistrationForm** — Multi-step registration wizard
4. **CustomerDetail** — Tabbed detail view with all data sections
5. **CustomerDirectoryScreen** — Main screen composing list + detail
6. **Styles** — Centralized style dictionary
