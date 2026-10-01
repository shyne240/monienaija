# A1 Decision Log

- **Task:** A1T14 — A1 Review Package and Exit Evidence
- **Review date:** 2026-08-05
- **Status:** Decisions recorded for approval; no runtime implementation
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Recorded decisions

| ID      | Decision                                                                                                         | Authority / owner                     | Evidence                               | Status                     | Target phase / date         |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------- | -------------------------- | --------------------------- |
| A1-D001 | `Customer.id` is canonical for customer-owned records; references do not replace internal identity               | Customer Engineering / Architecture   | ADR-0012, ADR-0021, ADR-0023           | Proposed; approval pending | A2/A3; 2026-08-05           |
| A1-D002 | Ledger owns financial accounts, posted journals/lines, balances, and monetary truth                              | Ledger / Finance                      | ADR-0004, ADR-0021, inventory          | Proposed; approval pending | A3/A5; 2026-08-05           |
| A1-D003 | `CustomerWallet` is provisioning metadata and requires an explicit A3 binding                                    | Customer Wallet / Wallet / Ledger     | ADR-0015, ADR-0021                     | Proposed disposition       | A3; before implementation   |
| A1-D004 | P1.6 `customer-beneficiary` is preferred customer-owned transfer authority; legacy data is compatibility/history | Payments Risk / Operations            | ADR-0017, ADR-0021                     | Proposed disposition       | A5; before transfer work    |
| A1-D005 | P1.10 owns preferred manual risk evidence; P1.3 owns current eligibility/restriction state until A4              | Risk / Compliance                     | Risk review, ADR-0022                  | Proposed authority         | A4; before policy work      |
| A1-D006 | Compliance cases are investigation evidence, not an AML, sanctions, fraud, PEP, or monitoring engine             | Compliance / Risk                     | Risk review, ADR-0022                  | Proposed boundary          | A4; before policy work      |
| A1-D007 | P1.8 authentication metadata remains separate from A2 runtime identity/access                                    | Security                              | ADR-0019, ADR-0021, ADR-0024           | Proposed boundary          | A2; before route protection |
| A1-D008 | Preferences own customer intent; notification delivery owns separate delivery state                              | Product / Operations                  | ADR-0018, ADR-0021                     | Proposed boundary          | A7; before delivery         |
| A1-D009 | Operations owns audit, idempotency, outbox, metrics, diagnostics; reconciliation remains independent             | Operations / Finance                  | Cross-cutting contracts, ADR-0005/0008 | Proposed invariant         | All phases                  |
| A1-D010 | Identifier scope, normalization, correlation, causation, and `(scope,key)` idempotency are explicit contracts    | Architecture / Security / Operations  | ADR-0023, A5 inputs                    | Proposed contract          | A2/A3/A5/A6                 |
| A1-D011 | Sensitive data is classified/minimized; plaintext secrets are prohibited; holds override cleanup                 | Security / Privacy/Legal / Compliance | ADR-0024, data matrix                  | Proposed control           | A2/A6                       |
| A1-D012 | A1 is documentation-only consolidation; A2-A8 remain future phases and P1.0-P1.15 remains unchanged              | Architecture / Product                | ADR-0020, roadmap, graph               | Proposed scope             | A1 exit; 2026-08-05         |

## 2. Decisions deliberately not made in A1

- Exact A4 policy precedence for every capability.
- Risk vocabulary mapping between onboarding-era `PROHIBITED` and P1.10 `CRITICAL`.
- A3 account-binding schema and repair implementation.
- A5 pilot command selection and financial activation behavior.
- A6 provider fields, consent/legal basis, callbacks, settlement, and partner retention.
- A2 principal/session/token/role implementation.
- Dataset-specific legal/regulatory retention durations beyond current operational defaults.
- A7/A8 product, notification, channel, scale, regional, or extraction implementation.

These remain open items in [`A1-OPEN-RISK-REGISTER.md`](A1-OPEN-RISK-REGISTER.md).

## 3. Decision-record rules

- A proposed decision is not an approved production gate.
- Changed authority requires an amending or superseding ADR; decision history is preserved.
- Every unresolved item has an owner, target phase, and target decision date.
- A1T14 records review state; it does not fabricate approval or implement a future phase.
