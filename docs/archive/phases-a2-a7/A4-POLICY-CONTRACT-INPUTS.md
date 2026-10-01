# A4 Policy Contract Inputs

- **Task:** A1T11 — Draft ADR-0022 and ADR-0023
- **Status:** Future A4 contract input; not an implementation
- **Scope:** Source evidence, policy request, policy decision, versioning, and consumer boundaries
- **Application code, API, entity, migration, and configuration changes:** None
- **Authority decision:** [`ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md`](ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md)

## 1. Purpose

This package translates the A1 risk, eligibility, and compliance authority review into an input contract for A4 Capability & Policy Engine. It prevents a future policy evaluator from owning source records or forcing financial modules to query arbitrary tables.

A4 may implement a policy decision later. A1T11 only defines the information that A4 must receive, the source authority for each input, the minimum decision output, and the boundaries that must be reviewed before implementation.

## 2. Policy decision request

A future request should be equivalent to:

```text
PolicyDecisionRequest
  subject
    customerId                 # canonical Customer UUID
  capability                  # product/capability namespace
  action                      # requested action
  requestedAt
  actorContext                # A2 principal/service context
  correlationId
  requestId                   # where available
  sourceEvidence               # normalized, read-only evidence package
```

The request must not accept a customer reference, provider identifier, wallet alias, or case number as a substitute for `customerId`. A controlled lookup may resolve a reference before the policy boundary, but the decision records the canonical subject ID.

## 3. Source evidence package

A4 should receive a normalized package through approved read contracts. It should not issue unrestricted queries or write to the source domains.

| Evidence group       | Owner                                    | Minimum input                                                                  | Version/freshness requirement                      | A4 restriction                                                  |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------- |
| Customer             | `customer`                               | Customer UUID, lifecycle status, type, KYC status/level where relevant         | Customer record version and updated time           | No customer creation/status mutation                            |
| Onboarding           | `customer-onboarding`                    | Workflow status, completion/approval state, required evidence summary          | Workflow/version, completion/decision time         | No onboarding state mutation                                    |
| Eligibility          | `customer-eligibility`                   | Eligibility status and transition timestamp                                    | Eligibility version/status-changed time            | Remains source until A4; do not infer from risk alone           |
| Restrictions         | `customer-eligibility`                   | Active restriction type, reason code, status, version                          | Restriction version and activation time            | No silent override of blocking states                           |
| Limits               | `customer-eligibility` / limit authority | Configured count/amount/currency limits                                        | Profile version and effective time                 | Configuration is input, not transaction enforcement by A4 alone |
| Product enrollment   | `customer-eligibility`                   | Product identifier and enrollment state                                        | Enrollment version/effective time                  | Do not create products or accounts                              |
| Permissions          | `customer-eligibility`                   | Operating permission type, enabled state                                       | Permission version/time                            | Not a replacement for A2 principal authorization                |
| Manual risk          | `customer-risk-profile`                  | Assessment status/level, assessment date, review due date, factor references   | Assessment/profile version and freshness           | Do not make a factor an independent decision                    |
| Legacy risk evidence | Onboarding/eligibility history           | Legacy level and source decision context                                       | Original assessment/version/time                   | Explicit mapping required for `PROHIBITED` versus `CRITICAL`    |
| Compliance cases     | `customer-compliance`                    | Category, severity, status, assignment/resolution summary, evidence references | Case/version/updated time                          | Case creation is not automatic screening output                 |
| Account binding      | Future A3 / `wallet` / `ledger`          | Binding status, wallet/account reference, currency, account lifecycle          | Binding/account version and reconciliation time    | No balance mutation or binding repair in A4                     |
| Principal/access     | Future A2                                | Authenticated principal, roles/permissions, service identity, approval context | Principal/session/authorization decision freshness | A4 does not authenticate or authorize the caller                |

Source evidence should be minimized. A4 should carry IDs, versions, reason codes, and references rather than copying identity documents, credential hashes, raw device fingerprints, compliance comments, risk notes, or full financial records.

## 4. Policy decision output

A future output should be equivalent to:

```text
PolicyDecision
  decisionId
  customerId
  capability
  action
  decision                    # ALLOW / ALLOW_WITH_LIMITS / PENDING_REVIEW / DENY / SUSPEND
  policyVersion
  evaluatedAt
  expiresAt
  reasonCodes[]
  explanation
  sourceReferences[]
  obligations[]
  correlationId
```

The output is a derived action-specific result. It must not be represented as a replacement for eligibility, restriction, risk, compliance, onboarding, authorization, account-binding, or ledger state.

`sourceReferences[]` should identify the source owner, record ID, source version, and relevant evidence timestamp. A4 must retain enough information to reproduce the result under its approved retention policy without duplicating unnecessary sensitive payloads.

## 5. Precedence and state constraints

A4 implementation must explicitly decide, test, and version the following cases:

- Missing, deleted, or closed customer.
- Incomplete or rejected onboarding.
- Pending, ineligible, suspended, revoked, or stale eligibility.
- Active `BLACKLISTED`, `FROZEN`, `LIMITED`, or `MANUAL_REVIEW` restrictions.
- Expired or incomplete risk assessment.
- Conflicting `PROHIBITED`, `CRITICAL`, or other risk vocabularies.
- Open high/critical compliance case versus resolved case.
- Low-risk assessment with missing factors or stale evidence.
- Missing account binding, currency mismatch, closed account, or reconciliation warning.
- Missing or insufficient A2 principal authorization.

Conservative outcomes such as `PENDING_REVIEW` or `DENY` are inputs for policy review, not a universal implementation rule. A4 must record the approved policy version and reason whenever a state is not directly allowed.

## 6. Consumer contract

- Financial and product commands request a decision for a defined customer, capability, and action.
- Consumers validate that the decision is for the same subject, action, capability, policy version, and applicable time window.
- A decision cannot be replayed for a different customer, capability, or command without a new evaluation.
- A consumer must not interpret a missing policy result as `ALLOW`.
- A financial command still performs its own ledger, idempotency, account, amount, currency, and reconciliation invariants.
- A4 does not post journals, mutate balances, create beneficiaries, update risk/compliance evidence, or send provider callbacks.

## 7. Versioning and audit inputs

A4 outputs are a required input to the A5 customer-aware financial command. A5 must validate the decision subject, capability, action, policy version, and effective time before execution; A4 does not authorize or post the financial command.

A4 must define:

- Immutable policy version identifiers and effective intervals.
- Source evidence version/reference format.
- Decision expiry/review behavior.
- Reason-code ownership and customer/support explanation rules.
- Decision history and replay/reproduction retention.
- Correlation, request, causation, and command identifiers.
- Audit event ownership through Operations.
- Access control for sensitive risk/compliance evidence.

These decisions must remain consistent with [`ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md`](ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md), [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md), and the later ADR-0024 privacy decision.

## 8. A4 implementation prohibitions

A4 must not:

- Add automated AML, sanctions, fraud, PEP, transaction-monitoring, or machine-learning behavior without separate approved scope.
- Treat a compliance case or risk factor as a complete screening decision.
- Own or rewrite source eligibility, restriction, risk, compliance, onboarding, customer, credential, or financial records.
- Accept external identifiers as canonical internal identity.
- Post journals or mutate balances.
- Expose full sensitive evidence through generic financial APIs.
- Let financial modules embed a conflicting policy evaluator.

## 9. A4 entry checklist

Before A4 implementation begins, accountable owners must confirm:

- [ ] Evidence source ownership and read contracts are approved.
- [ ] A2 principal/authentication context is defined.
- [ ] A3 customer/account binding input is defined.
- [ ] Policy decision vocabulary, reason codes, and versioning are approved.
- [ ] Risk vocabulary mapping and stale-evidence rules are approved.
- [ ] Compliance-case interpretation is approved without implying an automated screening engine.
- [ ] Decision history, retention, legal-hold, and access controls are approved.
- [ ] Financial command consumers and fail-closed behavior are specified.
- [ ] No A4 implementation is introduced by this A1 document.
