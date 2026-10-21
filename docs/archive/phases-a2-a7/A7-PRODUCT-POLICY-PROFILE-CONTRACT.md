# A7T03 — A7 Product-Specific Policy Profile, Eligibility, and Limit Extension

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T03 — Product-Specific Policy Profile, Eligibility, and Limit Extension
- **Status:** A4 product-policy profile, eligibility, restriction, product-limit, and product-obligation contract designed; A4 product-policy re-evaluation trigger designed; no A7 product-policy runtime implementation introduced beyond the A4 registry extension
- **Contract:** A4 `CapabilityPolicyProfile` (reused) for the A7 product-policy profile shape; A4 `PolicyDecisionState` (reused) for the A7 product-policy decision vocabulary; A4 `PolicyReevaluationTrigger` (reused) for the A7 product-policy re-evaluation trigger
- **Selected A7 first product:** `VIRTUAL_ACCOUNT` v1 (per [A7T01](A7-PRODUCT-EXPANSION-BASELINE.md) and [A7T02](A7-PRODUCT-CATALOG-CONTRACT.md))
- **A4 extension point:** A4 `StaticCapabilityPolicyProfileRegistry` (constructor accepts an additional profile list); A4 `CapabilityPolicyEvaluationService` and `CapabilityPolicyRecoveryService` (constructed with a custom `PolicyProfileRegistry`); A4 `TypeOrmPolicyProfileVersionRepository`; A4 `TypeOrmPolicyDecisionRecordRepository`; A4 `TypeOrmPolicyEvidenceSnapshotAttachmentRepository`; A4 `TypeOrmPolicyIdempotencyAdapter`; A4 `TypeOrmPolicyAuditAdapter`; A4 `CapabilityPolicyHistoricalReplayService`; A4 `AuditService`; A4 `IdempotencyService`; A4 `DataSource`; A4 `AuthorizationService`
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, and A8 changes:** None (A7T03 is a documentation and A4-registry-extension artifact; the A4 `policy_profile_versions` table is reused; no new entity, no new migration, no new route, no new public surface)

This document defines the A4 product-policy profile, eligibility, restriction, product-limit, and product-obligation contract that the A7 first product (`VIRTUAL_ACCOUNT` v1) consumes. It defines the A4 re-evaluation trigger that fires when a partner-cleared virtual-account assignment becomes available. It reuses the A4 capability/policy authority, the A4 decision vocabulary, the A4 persistence, the A4 recovery, the A4 audit, the A4 idempotency, the A4 historical replay, the A2 authorization, the A3 binding, the A6 partner boundary, the A7 product catalog, the A7 product-state vocabulary, and the A7 product-boundary contract. It introduces no second policy evaluator, no second authorization system, no second customer-binding system, no second settlement authority, no second reconciliation engine, and no public surface.

## 1. Contract boundary

The A4 product-policy contract is an extension of the A4 `CapabilityPolicyProfile` contract. The A7 first product does not create a new policy evaluator; it reuses the A4 `CapabilityPolicyEvaluationService` with a composed `PolicyProfileRegistry` that contains both the A4 default profiles and the A7 product-policy profiles. The A4 decision vocabulary is reused without modification.

The A4 product-policy contract shape is:

```text
A7ProductPolicyProfileRegistration {
  profile: CapabilityPolicyProfile     (A4 contract; reused)
  productKey: A7ProductKey             (frozen; reused from A7 product catalog)
  capability: A4Capability            (reused from A4)
  action: A4Action                     (reused from A4)
  productPolicyVersion: A4PolicyVersion (reused from A4)
  productPolicyReevaluationTrigger: A4PolicyReevaluationTrigger (reused from A4)
  productLimitDimensions: A4PolicyLimitDimension[] (reused from A4)
  productEligibility: A4PolicyProductEligibilityRequirements (reused from A4)
  productObligations: A4PolicyObligationTemplate[] (reused from A4)
}

A7ProductPolicyEvaluationCommand {
  evaluation: A4PolicyEvaluationCommand  (reused from A4)
  productKey: A7ProductKey              (reused from A7 product catalog)
  productState: A7ProductState          (reused from A7 product-state vocabulary)
  partnerReference?: A6PartnerReference (reused from A6 partner boundary)
}

A7ProductPolicyEvaluationResult {
  decision: A4PolicyDecisionResult      (reused from A4)
  productKey: A7ProductKey
  productState: A7ProductState
  productObligations: A4PolicyObligation[] (reused from A4)
  productLimits: A4PolicyLimitOutput[]   (reused from A4)
  productReasonCodes: string[]          (reused from A4 reason codes)
}

A7ProductPolicyReevaluationCommand {
  productKey: A7ProductKey
  trigger: A4PolicyReevaluationTrigger
  evaluation: A4PolicyEvaluationCommand
  previousDecisionReference?: A4PolicyDecisionResult['decisionReference']
  idempotencyContext: A4PolicyIdempotencyContext
}

A7ProductPolicyReevaluationResult {
  result: A4PolicyReevaluationResult   (reused from A4)
  productKey: A7ProductKey
  productState: A7ProductState
  reevaluationReference: string
}
```

The A7 product-policy contract is A4-typed. The A7 product catalog provides the `productKey`; the A4 policy profile registry provides the A4 capability/action/profile; the A4 evaluator produces the A4 `PolicyDecisionResult`; the A4 recovery service produces the A4 `PolicyReevaluationResult`. The A7 product-policy service composes these A4 results with the A7 product-state and product-key context.

## 2. Selected first product policy profile (frozen)

The A7 first product is `VIRTUAL_ACCOUNT` v1 (per [A7T01](A7-PRODUCT-EXPANSION-BASELINE.md) and [A7T02](A7-PRODUCT-CATALOG-CONTRACT.md)). The first product has two capabilities:

```text
productKey:                VIRTUAL_ACCOUNT
capability1:               product.virtual-account
action1:                   assign
capability2:               product.virtual-account
action2:                   lifecycle
direction:                 inbound
currency:                  NGN
accountingUnit:            CUSTOMER_FUNDS
targetType:                BANK_ACCOUNT
partnerDependency:        NIBSS_NIP (A6 partner; planning rail)
```

The A4 product-policy profile registration for the A7 first product is:

```text
A7ProductPolicyProfileRegistration (VIRTUAL_ACCOUNT v1, product.virtual-account/assign) {
  profile: CapabilityPolicyProfile {
    profileReference: 'profile.product-virtual-account-assign.v1'
    profileKey: 'profile.product-virtual-account-assign'
    profileVersion: 1
    policyVersion: 'a4.profile.product-virtual-account-assign.v1'
    capability: 'product.virtual-account'
    actions: ['assign']
    subjectType: 'CUSTOMER'
    contractName: 'A4-CAPABILITY-POLICY'
    contractVersion: 1
    profileContractVersion: 1
    evidenceRequirements: A4-policy-source-requirements
    productEligibility: A4-policy-eligibility-requirements
    enrollmentRequirement: { mode: REQUIRED_ACTIVE, productKey: 'virtual-account' }
    permissionRequirement: { mode: NOT_REQUIRED }
    riskRequirement: { mode: NOT_REQUIRED }
    complianceRequirement: { mode: NOT_REQUIRED }
    accountBindingRequirement: { mode: REQUIRED_IF_CONTEXT }
    limitRequirement: { mode: CONFIGURATION_REQUIRED, dimensions: [SINGLE_TRANSACTION_AMOUNT], returnsLimits: true }
    allowedDecisions: [ALLOW, ALLOW_WITH_LIMITS, PENDING_REVIEW, DENY, SUSPEND]
    obligations: [RECHECK_A2_AUTHORIZATION, RECHECK_A3_BINDING, RECHECK_A6_PARTNER_REFERENCE, RECHECK_EXECUTION_LIMIT]
  }
  productKey: 'VIRTUAL_ACCOUNT'
  capability: 'product.virtual-account'
  action: 'assign'
  productPolicyVersion: 'a4.profile.product-virtual-account-assign.v1'
  productPolicyReevaluationTrigger: 'SOURCE_CHANGED'
  productLimitDimensions: [SINGLE_TRANSACTION_AMOUNT]
  productEligibility: A4-policy-eligibility-requirements
  productObligations: [RECHECK_A2_AUTHORIZATION, RECHECK_A3_BINDING, RECHECK_A6_PARTNER_REFERENCE, RECHECK_EXECUTION_LIMIT]
}

A7ProductPolicyProfileRegistration (VIRTUAL_ACCOUNT v1, product.virtual-account/lifecycle) {
  profile: CapabilityPolicyProfile {
    profileReference: 'profile.product-virtual-account-lifecycle.v1'
    profileKey: 'profile.product-virtual-account-lifecycle'
    profileVersion: 1
    policyVersion: 'a4.profile.product-virtual-account-lifecycle.v1'
    capability: 'product.virtual-account'
    actions: ['lifecycle']
    subjectType: 'CUSTOMER'
    contractName: 'A4-CAPABILITY-POLICY'
    contractVersion: 1
    profileContractVersion: 1
    evidenceRequirements: A4-policy-source-requirements
    productEligibility: A4-policy-eligibility-requirements
    enrollmentRequirement: { mode: REQUIRED_ACTIVE, productKey: 'virtual-account' }
    permissionRequirement: { mode: NOT_REQUIRED }
    riskRequirement: { mode: NOT_REQUIRED }
    complianceRequirement: { mode: NOT_REQUIRED }
    accountBindingRequirement: { mode: REQUIRED_IF_CONTEXT }
    limitRequirement: { mode: CONFIGURATION_AND_USAGE_REQUIRED,
                         dimensions: [SINGLE_TRANSACTION_AMOUNT, DAILY_TRANSACTION_COUNT,
                                      DAILY_TRANSACTION_AMOUNT, MONTHLY_TRANSACTION_AMOUNT,
                                      WALLET_BALANCE],
                         returnsLimits: true }
    allowedDecisions: [ALLOW, ALLOW_WITH_LIMITS, PENDING_REVIEW, DENY, SUSPEND]
    obligations: [RECHECK_A2_AUTHORIZATION, RECHECK_A3_BINDING, RECHECK_A6_PARTNER_REFERENCE, RECHECK_EXECUTION_LIMIT]
  }
  productKey: 'VIRTUAL_ACCOUNT'
  capability: 'product.virtual-account'
  action: 'lifecycle'
  productPolicyVersion: 'a4.profile.product-virtual-account-lifecycle.v1'
  productPolicyReevaluationTrigger: 'SOURCE_CHANGED'
  productLimitDimensions: [SINGLE_TRANSACTION_AMOUNT, DAILY_TRANSACTION_COUNT,
                            DAILY_TRANSACTION_AMOUNT, MONTHLY_TRANSACTION_AMOUNT, WALLET_BALANCE]
  productEligibility: A4-policy-eligibility-requirements
  productObligations: [RECHECK_A2_AUTHORIZATION, RECHECK_A3_BINDING, RECHECK_A6_PARTNER_REFERENCE, RECHECK_EXECUTION_LIMIT]
}
```

The A7 first product's product-policy profiles are A4 `CapabilityPolicyProfile` instances composed via the existing A4 `profile()` helper. They reuse the A4 decision vocabulary, the A4 source-requirement modes, the A4 product-eligibility requirements, the A4 obligation template shape, the A4 limit-dimension vocabulary, the A4 enrollment/permission/risk/compliance/binding requirement modes, and the A4 contract version. They do not introduce a new decision vocabulary, a new source-requirement mode, a new limit-dimension, a new obligation template, or a new contract version.

## 3. Product eligibility, restriction, product-limit, and product-obligation contract

The A7 product-policy contract defers precedence to A4. The A4 product-eligibility, restriction, limit, and obligation contract is reused without modification. The A4 `PolicyProductEligibilityRequirements` shape is reused:

```text
A4PolicyProductEligibilityRequirements {
  customerLifecycle: 'ACTIVE_REQUIRED' | 'CURRENT_REQUIRED' | 'NOT_REQUIRED'
  onboarding:       'COMPLETED_REQUIRED' | 'CURRENT_REQUIRED' | 'NOT_REQUIRED'
  eligibility:      'ELIGIBLE_REQUIRED' | 'CURRENT_REQUIRED' | 'NOT_REQUIRED'
  restrictions:     'NO_BLOCKING_RESTRICTION' | 'PROFILE_CONTROLLED' | 'NOT_REQUIRED'
  risk:             PolicyRiskRequirement    (reused from A4)
  compliance:       PolicyComplianceRequirement (reused from A4)
  accountState:     'ACTIVE_REQUIRED' | 'PROFILE_CONTROLLED' | 'NOT_REQUIRED'
}
```

The A7 first product's product-eligibility requirements are:

```text
A7ProductPolicyProductEligibility (VIRTUAL_ACCOUNT v1, product.virtual-account/assign):
  customerLifecycle: 'ACTIVE_REQUIRED'
  onboarding:       'COMPLETED_REQUIRED'
  eligibility:      'ELIGIBLE_REQUIRED'
  restrictions:     'NO_BLOCKING_RESTRICTION'
  risk:             PolicyRiskRequirement.PROFILE_CONTROLLED
  compliance:       PolicyComplianceRequirement.PROFILE_CONTROLLED
  accountState:     'PROFILE_CONTROLLED'

A7ProductPolicyProductEligibility (VIRTUAL_ACCOUNT v1, product.virtual-account/lifecycle):
  customerLifecycle: 'ACTIVE_REQUIRED'
  onboarding:       'COMPLETED_REQUIRED'
  eligibility:      'ELIGIBLE_REQUIRED'
  restrictions:     'NO_BLOCKING_RESTRICTION'
  risk:             PolicyRiskRequirement.PROFILE_CONTROLLED
  compliance:       PolicyComplianceRequirement.PROFILE_CONTROLLED
  accountState:     'PROFILE_CONTROLLED'
```

The A7 product-policy contract adds the following product-obligation template codes (reused as A4 `PolicyObligationTemplate.code`):

```text
RECHECK_A2_AUTHORIZATION          (reused from A4)
RECHECK_A3_BINDING                (reused from A4)
RECHECK_A6_PARTNER_REFERENCE       (A7T03 addition; recorded against A4 obligation template)
RECHECK_EXECUTION_LIMIT            (reused from A4)
```

The `RECHECK_A6_PARTNER_REFERENCE` obligation is an A7 product-policy extension. It is a product-obligation template code that the A7 product-policy service records against the A4 `PolicyObligationTemplate`. The A4 `CapabilityPolicyEvaluationService` already serializes the obligation template as part of the A4 `PolicyDecisionResult.obligations`. The A7 product-policy service does not modify the A4 evaluator; it only adds the obligation template to the A7 product-policy profile definition.

The A4 product-limit contract is reused. The A7 first product's product-limit dimensions are:

```text
A7 first product, product.virtual-account/assign:   [SINGLE_TRANSACTION_AMOUNT]
A7 first product, product.virtual-account/lifecycle: [SINGLE_TRANSACTION_AMOUNT, DAILY_TRANSACTION_COUNT,
                                                     DAILY_TRANSACTION_AMOUNT, MONTHLY_TRANSACTION_AMOUNT,
                                                     WALLET_BALANCE]
```

The A4 `PolicyLimitEvaluation` shape and the A4 `PolicyLimitOutput` shape are reused. The A7 product-policy service does not modify the A4 limit evaluator.

## 4. A4 re-evaluation trigger for product-level evidence

The A7 product-policy contract uses the A4 `PolicyReevaluationTrigger` enum to express the A7 product-level evidence trigger. The A7 first product's re-evaluation trigger is `SOURCE_CHANGED`, which fires when a partner-cleared virtual-account assignment becomes available (i.e., the A6 partner has cleared the assignment and the A6T05 external-operation evidence has been updated). The A4 `CapabilityPolicyRecoveryService.reevaluate()` consumes the A4 `PolicyReevaluationRequest` and reuses the A4 evaluator, persistence, idempotency, and audit.

```text
A7ProductPolicyReevaluationCommand {
  productKey: 'VIRTUAL_ACCOUNT'
  trigger: A4PolicyReevaluationTrigger.SOURCE_CHANGED
  evaluation: A4PolicyEvaluationCommand
  previousDecisionReference?: A4PolicyDecisionResult['decisionReference']
  idempotencyContext: {
    scope: 'policy.capability-decision.v1'
    key: string
  }
}
```

The A7 product-policy service delegates to the A4 `CapabilityPolicyRecoveryService.reevaluate()` with the composed `PolicyReevaluationRequest`. The A4 service owns the re-evaluation state machine, the retry policy, the diagnostics, the persistence, the idempotency, the audit, and the decision lifecycle. The A7 product-policy service does not duplicate the A4 re-evaluation engine.

The A4 re-evaluation triggers that the A7 product-policy contract reuses are:

```text
PolicyReevaluationTrigger.EXPIRED                    (reused from A4)
PolicyReevaluationTrigger.REVIEW_DUE                  (reused from A4)
PolicyReevaluationTrigger.SOURCE_CHANGED              (A7T03 default; reused from A4)
PolicyReevaluationTrigger.STALE_EVIDENCE              (reused from A4)
PolicyReevaluationTrigger.MISSING_EVIDENCE             (reused from A4)
PolicyReevaluationTrigger.CONFLICTING_EVIDENCE         (reused from A4)
PolicyReevaluationTrigger.UNAVAILABLE_EVIDENCE         (reused from A4)
PolicyReevaluationTrigger.POLICY_VERSION_SUPERSEDED   (reused from A4)
PolicyReevaluationTrigger.MANUAL                      (reused from A4)
```

## 5. Product policy version, profile hash, normalized input hash, expiry/review, and reason-code mapping

The A7 product-policy contract reuses the A4 product-policy version, profile hash, normalized input hash, expiry/review, and reason-code mapping without modification.

- The A4 `CapabilityPolicyProfile.definitionHash` is a SHA-256 hash of the canonical-JSON profile definition (excluding `effectiveFrom`, `effectiveTo`, and `lifecycleState`). The A7 product-policy service computes the A4 definition hash via the existing A4 `calculatePolicyProfileDefinitionHash()`.
- The A4 `CapabilityPolicyProfile.policyVersion` is a frozen, versioned identifier. The A7 first product's policy versions are `a4.profile.product-virtual-account-assign.v1` and `a4.profile.product-virtual-account-lifecycle.v1`.
- The A4 `PolicyDecisionRequest` and `PolicyEvaluationCommand` normalized input hash is the SHA-256 hash of the canonical-JSON request. The A7 product-policy service computes the A4 request hash via the existing A4 `calculatePolicyRequestHash()`.
- The A4 `PolicyEvidenceSnapshot.evidenceSummary.normalizedInputHash` is the SHA-256 hash of the canonical-JSON snapshot. The A7 product-policy service computes the A4 snapshot hash via the existing A4 `calculateSnapshotInputHash()`.
- The A4 `PolicyDecisionResult.expiresAt` and `PolicyDecisionResult.reviewAt` are the A4 decision-validity expiry and the A4 review-due date, respectively. The A4 `CapabilityPolicyProfile.decisionValidity.expiresInSeconds` is reused.
- The A4 reason-code catalogue is reused. The A7 product-policy service does not introduce a new reason code; it reuses the A4 `RESTRICTION_BLACKLISTED`, `RESTRICTION_FROZEN`, `RESTRICTION_LIMITED`, `ENROLLMENT_REQUIRED`, `ENROLLMENT_PENDING`, `RISK_CRITICAL_REVIEW`, `RISK_REVIEW_DUE`, `COMPLIANCE_REVIEW_OPEN`, `BINDING_PENDING`, `BINDING_REPAIR_REQUIRED`, `BINDING_CLOSED`, `BINDING_SUSPENDED`, `LIMIT_EXCEEDED`, `LIMIT_CONFIGURATION_MISSING`, `LIMIT_USAGE_UNAVAILABLE`, `LIMIT_OBLIGATION_UNAVAILABLE`, `LIMIT_CURRENCY_MISMATCH`, `EVIDENCE_COLLECTION_UNAVAILABLE`, `EVIDENCE_COLLECTION_INCOMPLETE`, `EVIDENCE_SNAPSHOT_INTEGRITY_MISMATCH`, `EVIDENCE_REEVALUATION_REQUIRED`, and the SOURCE_* / ENROLLMENT_* / IDENTITY_* codes already produced by the A4 evaluator.

## 6. A4 decision vocabulary

The A7 product-policy contract reuses the A4 `PolicyDecisionState` decision vocabulary without modification:

```text
PolicyDecisionState.ALLOW              (reused from A4)
PolicyDecisionState.ALLOW_WITH_LIMITS  (reused from A4)
PolicyDecisionState.PENDING_REVIEW     (reused from A4)
PolicyDecisionState.DENY                (reused from A4)
PolicyDecisionState.SUSPEND             (reused from A4)
```

A `PENDING_REVIEW`, `DENY`, or `SUSPEND` decision fails closed for product execution. An `ALLOW_WITH_LIMITS` decision carries explicit currency-labelled product limits and obligations. An `ALLOW` decision implies no amount or balance was approved; the A4 evaluator only returns `ALLOW_WITH_LIMITS` when the product-limit configuration is present and within bounds, and `ALLOW` when the product-limit requirement is `NOT_APPLICABLE`. The A7 product-policy contract does not introduce a new decision state.

## 7. A2 authorization, A3 binding, and A6 partner reference obligations

The A7 product-policy contract reuses the A2 authorization, the A3 binding-read, and the A6 partner-reference contracts without modification. The A4 `CapabilityPolicyEvaluationService` already integrates with the A2 `AuthorizationService` (via the A4 `PolicyAuthorizationPort`), the A3 binding evidence adapter (via the A4 `PolicySourceClass.ACCOUNT_BINDING`), and the A6 partner-reference contract is consumed at the A4 `PolicyEvidenceItem` level (the A6 partner reference is one of the A4 source-evidence items).

The A7 product-policy service does not introduce a new authorization system, a new binding system, or a new partner contract. It records the A6 partner reference as an A4 `PolicyObligationTemplate.code` (`RECHECK_A6_PARTNER_REFERENCE`) so that the A4 `PolicyDecisionResult.obligations` includes a deterministic obligation code that downstream A7/A8 commands can recheck.

## 8. A4 evidence-snapshot integrity and re-evaluation integrity

The A7 product-policy contract reuses the A4 `PolicyEvidenceSnapshot` shape, the A4 `calculateSnapshotInputHash()` function, the A4 `PolicyEvaluationCommand.snapshot` field, the A4 `PolicyDecisionResult.evidenceContext.snapshotReference` field, and the A4 `PolicyDecisionResult.evidenceContext.normalizedInputHash` field. The A4 `CapabilityPolicyEvaluationService.assertSnapshot()` already enforces the snapshot-reference / snapshot-hash invariant. The A7 product-policy service does not re-implement this invariant.

The A7 product-policy contract reuses the A4 `CapabilityPolicyRecoveryService.reevaluate()` re-evaluation integrity. The A4 service reuses the A4 `PolicyDecisionEvaluator` to evaluate the re-evaluation command, the A4 `PolicyDecisionStore` to find the durable result, the A4 `PolicyIdempotencyPort` to reserve/complete the re-evaluation idempotency, the A4 `PolicyAuditPort` to record the re-evaluation audit, and the A4 `PolicyProfileLifecyclePort` to verify the policy-version lifecycle. The A7 product-policy service does not re-implement the re-evaluation integrity.

## 9. A4 historical replay

The A7 product-policy contract reuses the A4 `CapabilityPolicyHistoricalReplayService.replay()` for the A7 first product's policy-decision historical replay. The A4 service consumes the A4 `PolicyHistoricalReplayEvaluator` (which delegates to `CapabilityPolicyEvaluationService.evaluateReadOnly()`), the A4 `PolicyDecisionRecordRepository` to reconstruct the durable decision, and the A4 historical-replay-bundle shape. The A7 product-policy service exposes a thin `replayProductPolicy(decisionReference, command)` that delegates to the A4 historical-replay service. The A7 product-policy service does not introduce a new historical-replay engine.

## 10. A4 audit

The A7 product-policy contract reuses the A4 `TypeOrmPolicyAuditAdapter` for the A4 `A4_POLICY_DECISION` audit. The A7 product-policy service records the A4 audit fact and adds the A7 product context (product key, product state, A6 partner reference) to the A4 audit `metadata` field. The A4 `TypeOrmPolicyAuditAdapter.record()` already serializes the audit metadata as part of the A4 `PolicyAuditFact.metadata`. The A7 product-policy service does not introduce a new audit entity type, a new audit store, or a new audit adapter. The A4 `A4_POLICY_DECISION` entity type is reused.

## 11. A4 persistence

The A7 product-policy contract reuses the A4 `policy_profile_versions` table and the A4 `TypeOrmPolicyProfileVersionRepository`. The A7 product-policy service records the A4 product-policy profile via the A4 `PolicyProfileVersionRepository.insertImmutable()` and reads the A4 product-policy profile via the A4 `PolicyProfileVersionRepository.getProfileAt()`. The A4 `policy_profile_versions` table is shared; no new table, no new entity, no new migration.

The A7 product-policy service reuses the A4 `policy_decision_records` table via the A4 `TypeOrmPolicyDecisionRecordRepository`. The A7 product-policy decision is the A4 `PolicyDecisionResult`; the A7 product-policy audit is the A4 `PolicyAuditFact`; the A7 product-policy re-evaluation idempotency is the A4 `PolicyIdempotencyPort`. No new decision-record table, no new audit table, no new idempotency table.

## 12. A4 idempotency

The A7 product-policy contract reuses the A4 `PolicyIdempotencyPort` and the A4 `policy.capability-decision.v1` idempotency scope. The A4 `CapabilityPolicyEvaluationService.reserveIdempotency()` already validates the idempotency scope and reserves a deterministic A4 idempotency key. The A7 product-policy service does not introduce a new idempotency scope or a new idempotency port.

## 13. A4 source-evidence and source-adapter integration

The A7 product-policy contract reuses the A4 `PolicySourceClass` enum and the A4 `PolicyEvidenceAdapter` integration. The A4 `CapabilityPolicyModule` already registers the A4 source-evidence readers and adapters (Customer, Onboarding, Eligibility, Restrictions, Limits, Enrollment, Permissions, Risk, Compliance, AccountBinding, A2RuntimeContext). The A7 product-policy service does not introduce a new source-evidence reader or a new source-evidence adapter.

The A7 first product's source-evidence requirements are:

```text
A4PolicySourceRequirements (VIRTUAL_ACCOUNT v1, product.virtual-account/assign) {
  CUSTOMER:        REQUIRED_CURRENT
  ONBOARDING:      REQUIRED_CURRENT
  ELIGIBILITY:     REQUIRED_CURRENT
  RESTRICTIONS:    REQUIRED_CURRENT
  LIMITS:          REQUIRED_CURRENT
  ENROLLMENT:      REQUIRED_CURRENT
  PERMISSIONS:     NOT_USED
  RISK:            OPTIONAL_REFERENCE
  COMPLIANCE:      OPTIONAL_REFERENCE
  ACCOUNT_BINDING: REQUIRED_IF_CONTEXT
  AUTHORIZATION:   REQUIRED_CURRENT
}

A4PolicySourceRequirements (VIRTUAL_ACCOUNT v1, product.virtual-account/lifecycle) {
  CUSTOMER:        REQUIRED_CURRENT
  ONBOARDING:      REQUIRED_CURRENT
  ELIGIBILITY:     REQUIRED_CURRENT
  RESTRICTIONS:    REQUIRED_CURRENT
  LIMITS:          REQUIRED_CURRENT
  ENROLLMENT:      REQUIRED_CURRENT
  PERMISSIONS:     NOT_USED
  RISK:            OPTIONAL_REFERENCE
  COMPLIANCE:      OPTIONAL_REFERENCE
  ACCOUNT_BINDING: REQUIRED_IF_CONTEXT
  AUTHORIZATION:   REQUIRED_CURRENT
}
```

The A4 `PolicySourceRequirements` shape is reused. The A4 `StaticCapabilityPolicyProfileRegistry` already evaluates source-requirement mode per source class. The A7 product-policy service does not introduce a new source-requirement mode or a new source-evidence reader.

## 14. A4 contract version compatibility

The A7 product-policy contract reuses the A4 `CapabilityPolicyProfile.contractName = 'A4-CAPABILITY-POLICY'` and `contractVersion = 1` without modification. The A4 `CapabilityPolicyEvaluationService.assertProfile()` already validates the A4 contract name and version. The A7 product-policy service does not introduce a new A4 contract name or version; the A4 contract is the only contract.

A new A4 product-policy profile (e.g. `profile.product-virtual-account-assign.v2`) requires a new A4 `profileVersion` and a new A4 `policyVersion`. The A4 `StaticCapabilityPolicyProfileRegistry.getProfileAt()` already enforces the active lifecycle state and the effective interval. A retired A4 product-policy profile MUST NOT be reactivated; a successor profile MUST be a new A4 profile entry under a new A4 `profileVersion`.

## 15. A4 profile-registry composition

The A7 product-policy service composes the A4 `PolicyProfileRegistry` with the A4 default profiles and the A7 product-policy profiles:

```text
PolicyProfileRegistry (A7 product-policy composed) {
  profiles: [
    ...DEFAULT_CAPABILITY_POLICY_PROFILES,    // A4 default profiles
    ...A7_PRODUCT_POLICY_PROFILES              // A7 product-policy profiles
  ]
  getProfile(capability, action, policyVersionHint?) -> CapabilityPolicyProfile | null
  getProfileAt(capability, action, evaluationAt, policyVersionHint?) -> CapabilityPolicyProfile | null
}
```

The composed registry is constructed once at the A7 module initialization and passed to the A4 `CapabilityPolicyEvaluationService` and the A4 `CapabilityPolicyRecoveryService`. The A4 `StaticCapabilityPolicyProfileRegistry` constructor already accepts the profile list. The A4 `CapabilityPolicyEvaluationService` constructor already accepts the `PolicyProfileRegistry` as a second argument. The A4 `CapabilityPolicyRecoveryService` constructor already accepts the `PolicyProfileRegistry` as a second argument. The A7 product-policy service composes a `StaticCapabilityPolicyProfileRegistry` with the A4 default profiles and the A7 product-policy profiles, and passes the composed registry to the A4 evaluator and recovery service.

## 16. Architecture overview

```text
A2 authorization                                A3 binding                        A4 product-policy profile (reused)
Customer/customer-preference/virtual-account    binding read                      A4 capability/action/policyVersion/definitionHash
+--+--+                                        +--+--+                          +--+--+
   |                                              |                                 |
   +-----------+----------------------------------+---------------------------------+
               |                                  |
               v                                  v
               +-------------+   +----------------+
                             |   |
                             v   v
                       A4 CapabilityPolicyEvaluationService (reused, single evaluator)
                       A4 PolicyProfileRegistry (composed: A4 default + A7 product-policy)
                       A4 PolicyEvidenceSnapshot (reused)
                       A4 PolicyIdempotencyPort (reused)
                       A4 PolicyAuditPort (reused)
                       A4 PolicyDecisionStore (reused)
                       A4 AuthorizationService (reused)
                             |
                             v
                       A4 PolicyDecisionResult (reused)
                       A4 PolicyObligation[] (reused, with A7 product-policy codes)
                       A4 PolicyLimitOutput[] (reused)
                       A4 PolicyDecisionState (reused)
                             |
                             v
                       A7ProductPolicyEvaluationResult {
                         decision: A4PolicyDecisionResult
                         productKey: 'VIRTUAL_ACCOUNT'
                         productState: <frozen product-state>
                         productObligations: A4PolicyObligation[]
                         productLimits: A4PolicyLimitOutput[]
                         productReasonCodes: string[]
                       }
                             |
                             v
                       Operations audit (reused A4_POLICY_DECISION entity)
                       Outbox (reused Operations)
                       A4 replay (reused A4 historical replay service)
                       A4 re-evaluation (reused A4 recovery service; A7 product-policy trigger maps to A4 SOURCE_CHANGED)
```

## 17. A4 ownership boundaries (reused)

| Concern                                  | Owner                                                                    | A7T03 responsibility                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Policy evaluator                         | A4 (CapabilityPolicyEvaluationService)                                   | A7T03 reuses; A4 is the only policy evaluator                                                       |
| Policy decision vocabulary               | A4 (PolicyDecisionState)                                                 | A7T03 reuses; A4 is the only decision vocabulary                                                     |
| Policy re-evaluation                     | A4 (CapabilityPolicyRecoveryService.reevaluate)                          | A7T03 reuses; A4 is the only re-evaluation engine                                                   |
| Policy historical replay                 | A4 (CapabilityPolicyHistoricalReplayService)                             | A7T03 reuses; A4 is the only replay engine                                                          |
| Policy persistence                       | A4 (policy_profile_versions table + TypeOrmPolicyProfileVersionRepository) | A7T03 reuses; A4 is the only persistence boundary; no new table or migration                       |
| Policy decision persistence              | A4 (policy_decision_records table + TypeOrmPolicyDecisionRecordRepository) | A7T03 reuses; A4 is the only decision persistence                                                   |
| Policy audit                            | A4 (TypeOrmPolicyAuditAdapter + AuditService)                            | A7T03 reuses; A4 is the only audit adapter                                                          |
| Policy idempotency                      | A4 (TypeOrmPolicyIdempotencyAdapter)                                    | A7T03 reuses; A4 is the only idempotency adapter                                                    |
| Authorization                            | A2 (AuthorizationService)                                                | A7T03 reuses; A2 is the only authorization boundary                                                 |
| Customer binding                          | A3 (CustomerFinancialAccountBinding)                                    | A7T03 reuses; A3 is the only binding boundary                                                        |
| Partner contract                          | A6 (PartnerConnectionService + PartnerAdapter)                          | A7T03 reuses; A6 is the only partner contract                                                       |
| Wallet / Ledger                           | Wallet / Ledger                                                          | A7T03 reuses; the A4 limit obligation (RECHECK_EXECUTION_LIMIT) re-validates at execution time        |
| Product catalog                           | A7 (A7T02 ProductCatalogContractV1)                                      | A7T03 depends on; product key is the A7 product-catalog registration key                            |
| Product state                             | A7 (A7T02 product-state vocabulary)                                     | A7T03 records the A4 decision alongside the A7 product state                                       |
| Settlement                                | A6T08 / Ledger / Finance                                                 | A7T03 does not implement; A7T08 is responsible                                                     |
| Reconciliation                            | A6T09                                                                    | A7T03 does not implement; A7T09 is responsible                                                     |
| Notification                              | A7T06                                                                    | A7T03 does not implement                                                                          |
| Public surface                            | A2 audience authorization                                                | A7T03 does not implement                                                                          |

## 18. A7T03 verification record

- [x] The A7 product-policy profile is a frozen A4 `CapabilityPolicyProfile` composition.
- [x] The A4 decision vocabulary (`ALLOW` / `ALLOW_WITH_LIMITS` / `PENDING_REVIEW` / `DENY` / `SUSPEND`) is reused without modification.
- [x] The A4 product-policy version, profile hash, normalized input hash, expiry/review, and reason-code mapping are reused without modification.
- [x] The A4 source-evidence and source-adapter integration is reused without modification.
- [x] The A4 `PolicyReevaluationTrigger` is reused for the A7 product-policy re-evaluation trigger; the A7 first product's default trigger is `SOURCE_CHANGED`.
- [x] The A4 `CapabilityPolicyRecoveryService.reevaluate()` is reused for the A7 product-policy re-evaluation.
- [x] The A4 `CapabilityPolicyHistoricalReplayService.replay()` is reused for the A7 product-policy historical replay.
- [x] The A4 `TypeOrmPolicyProfileVersionRepository` is reused for the A7 product-policy profile persistence; the A4 `policy_profile_versions` table is shared.
- [x] The A4 `TypeOrmPolicyDecisionRecordRepository` is reused for the A7 product-policy decision persistence; the A4 `policy_decision_records` table is shared.
- [x] The A4 `TypeOrmPolicyAuditAdapter` is reused for the A7 product-policy audit; the A4 `A4_POLICY_DECISION` entity type is reused.
- [x] The A4 `TypeOrmPolicyIdempotencyAdapter` is reused for the A7 product-policy idempotency; the A4 `policy.capability-decision.v1` scope is reused.
- [x] The A2 `AuthorizationService` is reused for the A2 authorization obligation.
- [x] The A3 binding-read evidence adapter is reused for the A3 binding obligation.
- [x] The A6 partner reference is recorded as an A4 `PolicyObligationTemplate.code` (`RECHECK_A6_PARTNER_REFERENCE`).
- [x] The A4 `PENDING_REVIEW`, `DENY`, and `SUSPEND` decisions fail closed for product execution.
- [x] The A4 `ALLOW_WITH_LIMITS` decision carries explicit currency-labelled product limits and obligations.
- [x] Missing, stale, expired, contradicted, or unavailable A4 product evidence produces a deterministic non-allow outcome.
- [x] The A4 profile reference, A4 profile version, A4 policy version, and A4 definition hash are deterministic and stable.
- [x] The A7 product-policy contract does not call a partner, dispatch a notification, expose a public surface, or begin A7T04.
- [x] No A7 runtime policy evaluator, re-evaluation engine, replay engine, persistence layer, audit store, or idempotency store is introduced; A4 is the only authority.

## 19. Implementation evidence

- `src/policy/a7-product-policy.constants.ts` — frozen A4 product-policy profile references, versions, and decision-vocabulary constants for the A7 first product.
- `src/policy/a7-product-policy.types.ts` — A7 product-policy types (profile registration, evaluation command/result, re-evaluation command/result, replay command/result, audit context).
- `src/policy/a7-product-policy.profiles.ts` — A4 product-policy profile registrations for the A7 first product (assign + lifecycle), composed via the existing A4 `profile()` helper, exported as a frozen `A7_PRODUCT_POLICY_PROFILES` constant.
- `src/policy/a7-product-policy.audit.adapter.ts` — A4 product-policy audit adapter that reuses the A4 `TypeOrmPolicyAuditAdapter` and records the A7 product context as A4 audit metadata.
- `src/policy/a7-product-policy.persistence.repository.ts` — A4 product-policy persistence repository that reuses the A4 `TypeOrmPolicyProfileVersionRepository` and the A4 `policy_profile_versions` table.
- `src/policy/a7-product-policy.replay.service.ts` — A4 product-policy historical replay service that reuses the A4 `CapabilityPolicyHistoricalReplayService`.
- `src/policy/a7-product-policy.service.ts` — A4 product-policy service that composes the A4 `PolicyProfileRegistry`, the A4 evaluator, the A4 recovery, the A4 replay, the A4 audit, and the A4 persistence, and exposes the A7 product-policy contract.
- `src/policy/a7-product-policy.module.ts` — A4 product-policy NestJS module that wires the A7 product-policy service to the A4 `CapabilityPolicyModule`.
- `src/app.module.ts` — registers the A4 product-policy module.
- `test/a7-product-policy.profiles.spec.ts` — A4 product-policy profile definition-hash and frozen-registration tests.
- `test/a7-product-policy.service.spec.ts` — A4 product-policy service tests (delegation to A4 evaluator, recovery, persistence, replay, audit).
- `test/a7-product-policy.audit.spec.ts` — A4 product-policy audit adapter tests.
- `test/a7-product-policy.persistence.spec.ts` — A4 product-policy persistence repository tests.
- `test/a7-product-policy.replay.spec.ts` — A4 product-policy historical replay tests.

## 20. A7T03 handoff to later A7 tasks

This contract is consumed later as follows:

- **A7T04:** consumes the A7 product-policy `productKey`, `capability`, `action`, and `productPolicyVersion` to define the A7 product customer-binding map.
- **A7T05:** consumes the A7 product-policy `productPolicyReevaluationTrigger` to trigger A4 re-evaluation when a product-level event becomes available.
- **A7T06:** does not consume the A7 product-policy contract; A7T06 reads `CustomerPreference.notifications` only.
- **A7T07:** consumes the A7 product-policy contract to evaluate the A7 product lifecycle states and to trigger A4 re-evaluation on lifecycle transitions.
- **A7T08:** consumes the A7 product-policy `ALLOW_WITH_LIMITS` decision and the A4 product-limit output to validate the A7 product financial effect.
- **A7T09:** consumes the A7 product-policy contract and the A4 historical-replay service to reconcile the A7 product-policy decisions.
- **A7T10:** does not consume the A7 product-policy contract directly; A7T10 extends the A6T10 data-classification matrix with the A7 product-policy decision metadata.
- **A7T11:** records the A7 product-policy evidence in the A7 release-gate package.

No later task may weaken the A4 evaluator, the A4 decision vocabulary, the A4 re-evaluation engine, the A4 historical replay, the A4 audit, the A4 persistence, the A4 idempotency, the A2 authorization, the A3 binding, or the A6 partner contract.

## 21. Authoring note

The A7 plan reserves the proposed A7 ADR range `ADR-0054` through `ADR-0060`. ADR-0054 records the A7T02 product-catalog freeze. The next A7 ADR (ADR-0055 or later) is reserved for the A7T03 product-policy profile freeze; A7T03 commits the A4 product-policy profile extensions without authoring the ADR. A7T11 will record the ADR-0055-or-later authoring evidence as part of the A7 release-gate package. A7T03 introduces no new ADR; the A7T03 product-policy profile is a frozen A4 `CapabilityPolicyProfile` composition that is part of the A4 product-policy authority.
