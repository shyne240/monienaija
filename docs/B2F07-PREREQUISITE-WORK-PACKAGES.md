# B2F07 Prerequisite Work Packages

- **Document type:** Architecture authorization package
- **Status:** PARTIALLY IMPLEMENTED — A5T11 RUNTIME COMPLETE; B1T12 NOT STARTED; B2F07 BLOCKED
- **Task numbers:** A5T11 and B1T12
- **ADR allocations:** ADR-0090 → A5T11; ADR-0091 → B1T12
- **Blocked task:** B2F07 — Accounts Receivable and Invoice-Accounting Boundary
- **Runtime, migration, schema, ADR, account, mapping, contract, and roadmap changes:** None
- **Authoritative roadmap:** [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- **Finance plan:** [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- **Sequence reconciliation:** [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)

## 1. Purpose and authorization boundary

This package formally defines and authorizes two bounded prerequisite work packages required before B2F07 may resume. It assigns A5T11/ADR-0090 and B1T12/ADR-0091 without changing the platform roadmap or implementing either prerequisite.

The prerequisites are owned by the platforms that own the missing authorities:

1. A5 owns the canonical receivable control account.
2. B1 owns the commercial payment term and invoice due-date evidence.

B2 Finance consumes the resulting approved evidence; it does not absorb either authority merely because both prerequisites enable B2F07.

## 2. Full architecture consistency result

The package is consistent with the authoritative platform boundaries:

| Platform/phase              | Consistency decision                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 Identity                 | Customer identity remains canonical and is only referenced by B1/B2 Finance.                                                                           |
| A2 Authorization            | Privileged account provisioning and commercial configuration approval consume A2; no approval vault is created.                                        |
| A3 Customer Binding         | Customer-wallet binding is not used to provision the platform AR control account.                                                                      |
| A4 Policy                   | No eligibility or commercial payment-term authority is moved into A4.                                                                                  |
| A5 Ledger                   | Owns the AR account UUID/properties and all journal/value behavior.                                                                                    |
| A6 External Partners        | No settlement, suspense, partner, or payment execution behavior is introduced.                                                                         |
| A7 Product Layer            | Product behavior remains unchanged.                                                                                                                    |
| B1 Commercial               | Owns payment-term definition, invoice binding, due-date evidence, and commercial obligation.                                                           |
| B2 Finance                  | B2F03 maps the approved A5 account; B2F07 later owns AR accounting/aging, not commercial terms.                                                        |
| B3 Treasury                 | No cash positioning, liquidity, or Treasury execution is introduced.                                                                                   |
| B4 Fraud & AML              | No fraud/AML authority is changed.                                                                                                                     |
| B5 Merchant                 | Merchant identity/lifecycle remains B5-owned.                                                                                                          |
| B6 Reporting                | No reporting platform work is introduced.                                                                                                              |
| B7 Statement                | No statement generation/delivery work is introduced.                                                                                                   |
| B8 Configuration            | No broad configuration platform is created; prerequisite definitions remain domain-owned.                                                              |
| B9 IAM Administration       | Future access administration remains B9-owned.                                                                                                         |
| B10 Developer & Integration | No public API, credential, webhook, sandbox, or developer surface is introduced.                                                                       |
| C1–C7                       | No infrastructure-platform ownership is pulled forward. Domain telemetry uses existing shared primitives only when implementation is later authorized. |
| Frontend                    | No frontend work is introduced.                                                                                                                        |
| D1                          | No extraction, scaling, multi-tenancy, or regional work is introduced.                                                                                 |
| E1–E6                       | No FX, cards, lending, savings/investment, insurance, or remittance work is introduced.                                                                |

Historical B2T01–B2T10 classification and the B2F09-PRE implementation remain unchanged. Historical B2T11/B2T12 remain prohibited.

---

# Work Package A — A5 AR Control Account Provisioning Prerequisite

## A.1 Proposed identifier

- **Title:** A5 AR Control Account Provisioning
- **Identifier:** A5T11
- **ADR allocation:** ADR-0090
- **Owning platform:** A5 Ledger & Internal Financial Core
- **Implementation status:** BOUNDED PROVISIONING RUNTIME IMPLEMENTED — ACCOUNT NOT AUTO-PROVISIONED; B2F03 MAPPING NOT CREATED
- **ADR:** [`ADR-0090`](ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md)
- **Contract:** [`A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md`](A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md)

## A.2 Purpose

Provision exactly one canonical A5 ledger account suitable for the first bounded B2 Finance accounts-receivable control role. The work package exists only to establish the A5-owned account identity/properties required for a later B2F03 mapping proposal.

It does not create a receivable, Finance mapping, invoice, journal, balance, or AR lifecycle.

## A.3 Authority and ownership

A5 remains authoritative for:

- `LedgerAccount.id` UUID;
- account code and name;
- account type and normal balance;
- currency and accounting unit;
- negative-balance policy;
- active state;
- account creation and canonical reads;
- journals, lines, posting, balances, invariants, and reversals.

B2 Finance may propose requirements and later classify/map the A5 UUID. B2 Finance cannot create or alter the canonical account.

The existing technical authority is `LedgerService.createAccount()`. Any alternative deployment/provisioning mechanism requires explicit architecture approval and must still persist through the A5 account authority rather than direct duplicate storage.

## A.4 Proposed account characteristics

The proposed bounded shape is:

```text
purpose:              first Finance accounts-receivable control account
account type:         ASSET
normal balance:       DEBIT
currency:             NGN
accounting unit:      CUSTOMER_FUNDS
active state:         ACTIVE after successful approved provisioning
negative balance:     FALSE
```

Authorized architectural target:

```text
account code:         FINANCE-ACCOUNTS_RECEIVABLE-NGN
account name:         Finance accounts receivable control NGN
```

A5T11 implementation must validate this target against existing A5 rules before provisioning. Authorization does not mean the account exists, and it must not be created outside A5T11's controlled execution.

Existing settlement, clearing, suspense, or wallet accounts are not candidates for repurposing.

## A.5 Proposed owner matrix

| Responsibility                                    | Owner                                |
| ------------------------------------------------- | ------------------------------------ |
| Account purpose and Finance requirement           | Finance + Architecture               |
| Canonical account identity/properties             | A5 Ledger                            |
| Account creation operation                        | A5 Ledger owner                      |
| Privileged authorization/approval                 | A2                                   |
| Finance control/materiality/segregation           | B2F06, where applicable              |
| Audit/idempotency/outbox/metrics                  | Shared Operations                    |
| Post-provision verification                       | A5 Ledger + Finance + Reconciliation |
| Finance classification/mapping after provisioning | B2F03                                |
| AR use after all entry gates                      | B2F07                                |

## A.6 Proposed inputs

A future authorized implementation must require:

- approved purpose statement;
- approved account code/name;
- `ASSET` / `DEBIT` dimensions;
- `NGN` / `CUSTOMER_FUNDS` dimensions;
- authorized `allowNegativeBalance = false` assertion;
- exact idempotency key and semantic request hash;
- A2 principal, request, correlation, causation, and privileged approval evidence;
- B2F06 control evidence if required by active Finance policy;
- owner approvals from Architecture, Finance, Ledger, Reconciliation, Security, Operations, and Audit.

## A.7 Determinism and idempotency requirements

The future task must reuse shared `IdempotencyService`; it must not create an A5-specific duplicate idempotency store.

The semantic request hash should include:

- approved code/name;
- type/normal balance;
- currency/accounting unit;
- negative-balance policy;
- account purpose/version;
- approval/control references where semantically required.

It must exclude:

- random UUID generated by A5;
- `createdAt`/`updatedAt`;
- audit/outbox IDs;
- replay flags.

Expected behavior:

- same scope/key/hash returns the original verified A5 account;
- same key with changed semantics fails closed;
- an existing account code is returned only after every canonical property matches;
- an existing code with different properties is a conflict, never silently reused.

The exact idempotency scope is not assigned by this package and requires architecture approval.

## A.8 Approval and security requirements

Provisioning must be privileged and maker-checker controlled:

- requester and final approver must be distinct;
- approval must bind exact account-definition hash and resource intent;
- expired, stale, mismatched, or reused approval fails closed;
- raw credentials, tokens, or unrestricted customer data are prohibited;
- no customer identity is required in a platform control-account record;
- account creation must not be exposed as a public API.

A2 remains authorization authority. B9 later administers access. The future task must not create users, roles, sessions, credentials, or approval records outside those authorities.

## A.9 Audit and operational evidence

The future task must reuse shared `AuditService`, `OutboxService`, and `MetricsService` where approved.

Required evidence includes:

- provisioning requested;
- approval granted/rejected;
- create attempted;
- duplicate/replay/conflict outcome;
- canonical A5 account created/verified;
- post-create compatibility result;
- failure/unknown outcome;
- handoff to B2F03.

No event may claim the account exists until `LedgerService.getAccount()` verifies the committed UUID and exact properties.

## A.10 Verification and acceptance criteria

A5T11 may exit only when:

1. The canonical A5 UUID exists and is returned by `LedgerService.getAccount()`.
2. Type is `ASSET`.
3. Normal balance is `DEBIT`.
4. Currency is `NGN`.
5. Accounting unit is `CUSTOMER_FUNDS`.
6. Active state is true.
7. Negative-balance setting equals the approved decision.
8. Code/name equal the approved definition.
9. Duplicate/replay/conflict behavior is deterministic.
10. A2/B2F06 approval evidence is valid.
11. Audit and support provenance are complete.
12. No journal, line, balance, or monetary value was created.
13. The account has no unapproved prior activity.
14. B2F03 can consume the canonical UUID for a separate mapping proposal.

Account creation alone does not authorize Finance use. B2F03 mapping remains a separate controlled lifecycle.

## A.11 Duplicate, failure, and recovery behavior

- Duplicate exact intent: replay and verify the existing A5 account.
- Duplicate code with changed definition: deterministic conflict.
- Timeout/unknown create result: query canonical A5 account by approved identifier through an approved A5 lookup; never blindly create a second account.
- Account created but B2F03 mapping not approved: leave the account unmapped and unusable by Finance; preserve evidence.
- Mapping rejection: do not delete or repurpose the A5 account automatically.
- Rollback: no destructive account deletion after any activity; use forward recovery and explicit A5 lifecycle controls if separately approved.

A5 currently has no general update/deactivation runtime verified by this package. Any required deactivation control must be explicitly approved rather than inferred.

## A.12 Outputs consumed by B2F03

The handoff must contain only verified A5 facts:

- A5 account UUID;
- code/name;
- type/normal balance;
- currency/accounting unit;
- active/negative-balance flags;
- canonical account snapshot hash;
- provisioning decision/version;
- approval/audit/idempotency/correlation references;
- verification timestamp.

B2F03 then independently proposes and verifies:

```text
finance.asset.receivable -> canonical A5 UUID
```

No mapping is created by Work Package A.

## A.13 Dependencies

- A5 `LedgerAccount` and `LedgerService.createAccount()` authority.
- A2 privileged authorization/approval.
- B2F06 Finance control policy where applicable.
- Shared Operations audit/idempotency/outbox/metrics.
- Finance/Ledger/Reconciliation chart approval.
- B2F03 runtime available for the later mapping proposal.

## A.14 Explicit non-goals

Work Package A must not:

- create a B2F03 mapping;
- activate a Finance mapping;
- implement AR/B2F07;
- create or modify B1 invoices/terms;
- post journals or lines;
- mutate balances;
- implement collections, settlement, AP, tax, cost, recognition, reporting, statements, Treasury, or public APIs;
- create another ledger/account authority;
- repurpose `PAYMENT-SETTLEMENT_ASSET-NGN`, `PAYMENT-SETTLEMENT_CLEARING-NGN`, `PAYMENT-SYSTEM_SUSPENSE-NGN`, or wallet accounts.

---

# Work Package B — B1 Commercial Payment-Term and Invoice Due-Date Extension

## B.1 Proposed identifier

- **Title:** B1 Commercial Payment-Term and Invoice Due-Date Extension
- **Identifier:** B1T12
- **ADR allocation:** ADR-0091
- **Owning platform:** B1 Commercial Platform
- **Implementation status:** AUTHORIZED — IMPLEMENTATION NOT STARTED

## B.2 Purpose

Define a canonical, versioned commercial payment-term authority and bind the selected term/deterministic due date into B1 invoice evidence so B2F07 can consume it read-only.

The payment term represents the customer's commercial payment obligation. B2 Finance must not invent or redefine it.

## B.3 Authority and relationship to existing B1 work

B1 owns:

- commercial catalog/plans/subscriptions;
- pricing and commercial decisions;
- billing records;
- invoice creation/content/amount/state;
- selected payment term and commercial due-date evidence.

The extension is semantically related to:

- B1T03 catalog/plan/subscription definitions;
- B1T05 billing/invoice generation and persistence.

Those tasks are historical completed work and must not be rewritten or reopened implicitly. The new work requires a separate B1 extension cycle and later ADR if architecture approves implementation.

B2F07 consumes the resulting invoice evidence and owns only AR accounting status, outstanding amount, aging, impairment inputs, close, and reconciliation treatment.

## B.4 Proposed payment-term definition

A future immutable `CommercialPaymentTermV1` should include at least:

```text
paymentTermReference
paymentTermVersion
definitionHash
termBasis
termValue
effectiveFrom
effectiveTo
commercialScopeKey/commercialScopeVersion
plan/subscription applicability
currency
accountingUnit
lifecycle status
classification/retention/legal-hold metadata
idempotency/replay metadata
audit/correlation provenance
```

No term basis or term value is approved by this package. In particular, no Net 7, Net 15, Net 30, or other convention may be seeded or inferred.

The future task must define a closed reviewed `termBasis` vocabulary. If business-day calculation is proposed, it also requires an authoritative business-calendar dependency; it cannot be approximated silently.

## B.5 Proposed invoice binding

A future B1 invoice version/extension should bind:

```text
paymentTermReference
paymentTermVersion
paymentTermDefinitionHash
paymentTermSelectedAt
issuedAt
dueAt / dueDate
dueDateCalculationHash
commercialScope/plan/subscription provenance
invoiceHash/replayHash
```

The due date must be a deterministic output of the authoritative selected term and invoice issuance facts. It must be covered by invoice hashing/versioning and returned by the canonical read interface:

```text
B1BillingEngineService.getPersistenceRecordByReference()
```

Caller-supplied due dates without canonical B1 evidence are prohibited.

## B.6 Effective dating and compatibility

A payment term is compatible only when:

- reference/version/hash exists and is active/effective at invoice issuance;
- commercial scope, plan, subscription, product/capability, customer/merchant/partner applicability match;
- currency is `NGN` for the first bounded scope;
- accounting unit is `CUSTOMER_FUNDS`;
- term basis/value is recognized by the contract;
- selected term is not expired/retired;
- invoice issuance timestamp is valid;
- resulting due date passes deterministic bounds/format rules.

Unknown, stale, missing, mismatched, unsupported, or ambiguous terms fail closed. No fallback term is allowed.

## B.7 Deterministic calculation

The future due-date calculator must:

- receive immutable term definition/version/hash;
- receive canonical invoice `issuedAt`;
- use an explicit time-zone/calendar rule;
- produce deterministic `dueAt`/date;
- hash canonical calculation inputs and result;
- exclude random IDs, persistence timestamps, audit IDs, and replay flags;
- reproduce the same due date during historical replay.

UTC versus applicable commercial civil time must be explicitly approved. It must not be inherited accidentally from Finance period behavior.

## B.8 Idempotency and replay

The extension must reuse shared `IdempotencyService` and existing B1 replay patterns.

Expected behavior:

- same payment-term create/version intent replays;
- same key with changed definition conflicts;
- invoice replay returns the original selected term and due date;
- changed selected term or due-date calculation changes the semantic hash and cannot replay as the original invoice;
- no second invoice is created merely to recover an uncertain result without reading durable B1 evidence.

Exact new scopes are not assigned by this package and require architecture review to avoid collision with existing B1 scopes.

## B.9 Audit and retention

The future task must reuse shared Operations primitives and existing B1 governance/data controls.

Audit evidence must include:

- payment term proposed/approved/activated/retired;
- selected term on invoice;
- due-date calculation inputs/hash/result;
- replay/conflict/rejection;
- correction/supersession;
- actor, request, correlation, causation, and approval references.

Payment terms and invoice due dates are commercial/financial data. Exact retention duration is **NOT VERIFIED / REQUIRES REVIEW** by Commercial, Finance, Tax, Legal, Privacy, Compliance, and Audit. Legal hold overrides disposal.

## B.10 Correction and supersession

An issued invoice's selected payment term and due date must not be silently edited in place.

The future task must choose and document an additive approach, such as:

- new invoice version;
- void-and-reissue under existing B1 state rules;
- explicit due-date amendment record linked to original invoice.

The correct mechanism is **NOT VERIFIED / REQUIRES REVIEW**. It must preserve original evidence, reasons, approval, hashes, and B2F07 correlation. B2 Finance must not repair B1 records.

## B.11 Consumer interface for B2F07

The B1 read-only output must provide enough evidence for B2F07 to verify:

- canonical invoice reference/version/hash/state;
- customer identity;
- invoice amount/currency/accounting unit;
- issued time;
- payment-term reference/version/hash;
- deterministic due date and calculation hash;
- term/source effective dates/currentness;
- commercial plan/subscription provenance;
- audit/idempotency/correlation/causation references.

B2F07 may copy the minimum immutable references/hash/due date into AR provenance. It must not mutate B1 or recalculate the customer's obligation.

## B.12 Proposed acceptance criteria

B1T12 may exit only when:

1. One bounded payment-term definition is approved without inventing an industry default.
2. The term is versioned, effective-dated, immutable, and hash-addressed.
3. Plan/subscription applicability is explicit.
4. B1 invoice binds exact term reference/version/hash.
5. B1 deterministically produces and persists due-date evidence.
6. Invoice hash/replay includes term/due-date semantics.
7. Same request replays exact original evidence; changed payload conflicts.
8. Stale/missing/incompatible terms fail closed.
9. Canonical by-reference invoice reads expose required evidence.
10. Audit, retention, legal-hold, and support evidence pass review.
11. Existing B1 pricing/billing/invoice authority remains canonical.
12. No Finance AR, A5 posting, statement delivery, public API, or payment execution is implemented.

## B.13 Dependencies

- B1 commercial catalog/plan/subscription authority.
- B1 billing/invoice authority and persistence.
- Existing B1 data classification/governance.
- A2 privileged approval where commercial configuration requires it.
- Shared Operations idempotency/audit/outbox/metrics.
- Commercial/Product/Finance/Legal/Tax/Privacy/Compliance/Audit approval.
- B2F07 read-only consumer requirements.

## B.14 Explicit non-goals

Work Package B must not:

- implement B2F07 AR;
- create A5 accounts/mappings/journals/balances;
- implement payment collection/execution;
- implement B2F08 AP;
- implement B2F09 recognition, tax accounting, or cost accounting;
- change B1 pricing, fees, commissions, or invoice amounts outside the term binding;
- generate B6 reports or B7 statements;
- create public APIs, frontend, webhooks, or notifications;
- define terms in B2 Finance;
- seed Net 7/15/30 or any unapproved term.

---

## 3. Dependency and sequencing model

Architecture review/design for Work Packages A and B may proceed in parallel because neither depends on the other's runtime output.

```text
A5T11 authorized                               B1T12 authorized
        |                                                |
A5 AR account target validated                 B1 payment-term model approved
        |                                                |
A5 account provisioned                          B1 term authority implemented
        |                                                |
A5 account verified                             Invoice binding/due evidence implemented
        |                                                |
B2F03 mapping proposed                          B1 read interface verified
        |
A2/B2F06 mapping approval
        |
B2F03 mapping ACTIVE/effective
        \                                                /
         +-------------- both tracks complete ----------+
                                |
                      B2F07 entry review rerun
                                |
                      B2F07 implementation only if GO
                                |
                              B2F08
                                |
                              B2F09
```

The B2F roadmap numbering does not change. These are cross-platform prerequisites, not inserted B2F task numbers.

## 4. B2F07 renewed entry gate

B2F07 remains blocked until all are true:

- canonical A5 AR account exists and passes canonical verification;
- approved B2F03 `finance.asset.receivable` mapping is `ACTIVE` and effective;
- authoritative B1 payment term/due-date evidence exists and is readable by reference;
- B2F04 period admission remains available;
- B2F05 journal governance and mapping verification remain available;
- B2F06 Finance controls and A2 approval remain available;
- no competing AR authority is introduced;
- Architecture records an explicit B2F07 `GO` decision.

## 5. Task and ADR allocation decision

No historical task is reopened or expanded:

- A5T01–A5T10 remain the completed internal financial-pilot sequence; A5T05 continues to exclude broader chart expansion.
- B1T01–B1T11 remain completed historical tasks; B1T03/B1T05 remain semantic predecessors only.

Architecture authorizes two new extension tasks:

| Task  | Title                                                     | Owner                               | ADR allocation | Status                                  |
| ----- | --------------------------------------------------------- | ----------------------------------- | -------------- | --------------------------------------- |
| A5T11 | A5 AR Control Account Provisioning                        | A5 Ledger & Internal Financial Core | ADR-0090       | AUTHORIZED — IMPLEMENTATION NOT STARTED |
| B1T12 | B1 Commercial Payment-Term and Invoice Due-Date Extension | B1 Commercial Platform              | ADR-0091       | AUTHORIZED — IMPLEMENTATION NOT STARTED |

No ADR file, migration, idempotency scope, runtime artifact, or release claim is created by this authorization gate.

## 6. Documentation and implementation non-claims

This package does not:

- modify the authoritative roadmap;
- implement either authorized work package;
- implement runtime behavior;
- create an A5 account or B2F03 mapping;
- modify B1 contracts or invoices;
- create an ADR/migration/task number;
- implement B2F07/B2F08/B2F09 or later work;
- revive B2T11/B2T12;
- alter B2F09-PRE or historical B2T01–B2T10 classification.
