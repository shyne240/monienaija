# A1 Consolidated Architecture Decision Map

- **Task:** A1T13 — Consolidated Inventory and Cross-Document Consistency
- **Status:** Consolidated A1 decision map; formal approval remains A1T14
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Decision status

- **Current authority:** Existing source owner and writer.
- **Metadata:** Stored lifecycle, registration, configuration, security, or workflow information that is not financial truth.
- **Projection:** Derived/read-only view or decision output that cannot write to its source.
- **Planned:** Future Architecture phase responsibility; not implemented by A1.
- **Proposed ADR:** Decision draft requiring accountable-owner review before its relevant phase gate.

## 2. Consolidated decision map

| Decision area                                | Authority / owner                                      | Current state                | Non-negotiable rule                                                   | Future phase |
| -------------------------------------------- | ------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------- | ------------ |
| Customer identity and canonical UUID         | `customer`                                             | P1.1 source authority        | `Customer.id` is canonical; references/provider IDs do not replace it | A2/A3        |
| Customer profile, KYC, and identity evidence | `customer`; Compliance/Risk steward                    | P1.1 metadata/evidence       | No duplicate identity writers; external KYC is separate               | A2/A6        |
| Onboarding                                   | `customer-onboarding`                                  | P1.2 workflow evidence       | Completion is evidence, not authorization or financial execution      | A4           |
| Eligibility/restrictions/limits/enrollment   | `customer-eligibility` until A4                        | P1.3 source metadata         | Preserve source facts; no divergent financial-module checks           | A4/A5        |
| Customer wallet provisioning                 | `customer-wallet`                                      | P1.4 metadata                | No ledger account, balance, or journal authority                      | A3           |
| Financial wallet/account and ledger          | `wallet`/`ledger`                                      | Existing financial authority | Ledger owns balances, journals, lines, and posted truth               | A3/A5        |
| Funding instruments                          | `customer-funding-instrument`                          | P1.5 metadata                | Not provider ownership or settlement proof                            | A6           |
| Beneficiaries                                | `customer-beneficiary` preferred; legacy compatibility | P1.6 and legacy overlap      | One future transfer-facing writer                                     | A5/A6        |
| Preferences                                  | `customer-preference`                                  | P1.7 customer intent         | Delivery/provider state is separate                                   | A7           |
| Credential/recovery/MFA/device metadata      | `customer-authentication`                              | P1.8 security metadata       | No plaintext secrets or runtime sessions in metadata                  | A2           |
| Compliance cases                             | `customer-compliance`                                  | P1.9 case evidence           | Case creation is not automated screening output                       | A4           |
| Manual risk evidence                         | `customer-risk-profile`                                | P1.10 evidence               | Factors and assessments are not policy decisions                      | A4           |
| Policy decisions                             | Future A4 boundary                                     | Not implemented              | Versioned action-specific output cannot rewrite source evidence       | A4/A5        |
| Audit/idempotency/outbox/metrics/diagnostics | `operations`                                           | Shared primitives            | Use shared contracts; no module-local duplicates                      | All phases   |
| Reconciliation                               | `reconciliation` / Finance                             | Independent control          | Read-only source queries; never repair facts                          | A3-A7        |
| Identifiers/privacy/retention                | Source owners with Security/Compliance/Legal           | A1 control inputs            | Classification, holds, and retention follow source ownership          | A2/A6        |

## 3. ADR map

| ADR           | Decision                                                | Status                          | Primary phase |
| ------------- | ------------------------------------------------------- | ------------------------------- | ------------- |
| ADR-0001-0003 | Foundational architecture, money, and durable events    | Accepted                        | A1/A3/A5-A8   |
| ADR-0004-0011 | Financial, resilience, production, maturity, governance | Proposed for review             | A1/A2/A5-A8   |
| ADR-0012      | Customer identity/profile/KYC foundation                | Reconstructed                   | A1-A4         |
| ADR-0013-0019 | Customer Foundation decisions                           | Accepted with future boundaries | A1-A6         |
| ADR-0020-0021 | A1 scope and canonical ownership                        | Proposed drafts                 | A1            |
| ADR-0022-0023 | Risk/policy and identifier conventions                  | Proposed drafts                 | A4/A5         |
| ADR-0024      | Classification, retention, privacy                      | Proposed draft                  | A1/A2/A6      |

## 4. Phase dependency map

```text
A1 Foundation Consolidation
  +--> A2 Runtime Identity & Access
  +--> A3 Customer-to-Financial Account Binding
  +--> A4 Capability & Policy Engine
             |
             +--> A5 Internal Financial Pilot (requires A2 + A3 + A4)
                         |
                         +--> A6 External Partners & Settlement
                                     |
                                     +--> A7 Product Expansion Infrastructure
                                                 |
                                                 +--> A8 Scale & Selective Extraction
```

A2-A8 are future boundaries and are not claimed as implemented by A1.

## 5. Open decisions carried forward

- A1T14 approval status for ADR-0020 through ADR-0024 and A2 entry.
- A2 principal, role, session, token, privileged-access, and protected-route implementation.
- A3 customer-wallet to financial-account binding and repair.
- A4 policy vocabulary, precedence, risk mapping, and reproducibility.
- A5 internal financial command, recovery, outbox, and reconciliation evidence.
- A6 provider field maps, callbacks, settlement, retention, and partner rollback.
- A7/A8 product boundaries, events, jobs, SLOs, DR, regional strategy, and extraction criteria.
