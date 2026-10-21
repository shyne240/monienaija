# B1 Commercial-Governance, Commercial Data-Classification, Commercial Idempotency, Commercial Audit, Commercial Approvals, and Commercial Feature-Flag Surface Contract

## 1. Purpose

This document is the canonical B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface contract (`B1-COMMERCIAL-GOVERNANCE-ENGINE` v1) for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01).

This document is frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10.

## 2. Contract identity

- **Contract name:** `B1-COMMERCIAL-GOVERNANCE-ENGINE`
- **Contract version:** `1`
- **Contract document:** `docs/B1-COMMERCIAL-GOVERNANCE-CONTRACT.md`
- **Scope key:** `commercial.virtual-account.inbound-funding`
- **Scope version:** `1`
- **Scope direction:** `inbound`
- **Scope currency:** `NGN`
- **Scope accounting unit:** `CUSTOMER_FUNDS`
- **Scope product dependency:** `VIRTUAL_ACCOUNT`
- **Scope product dependency version:** `1`
- **Scope partner dependency:** `NIBSS_NIP`
- **Period key:** `commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1`
- **Period version:** `1`
- **Reference prefix:** `b1-commercial-governance-decision`
- **Retention days:** `365`
- **Idempotency retention seconds:** `86_400` (24 hours)

## 3. Scope and authority

### 3.1 Authority

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface is the only B1 commercial-governance engine for commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface. The B1 commercial-governance engine is the only B1 commercial-governance authority.

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface does NOT introduce:

- A second Audit authority.
- A second Idempotency authority.
- A second Feature Flag authority.
- A second Classification authority.
- A second Approval authority.
- A second Notification authority.
- A second Policy authority.
- A second Ledger.

### 3.2 Read-only contract

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface is a GOVERNANCE LAYER ONLY. The B1 commercial-governance engine:

- Is a DECISION/ANALYSIS ENGINE ONLY.
- Runs in a REPEATABLE READ, read-only TypeORM transaction.
- Never takes any write lock.
- Never writes source records.
- Never auto-repairs discrepancies.
- Never rewrites history.
- Never posts a journal.
- Never mutates a balance.
- Never executes a settlement.
- Never executes a payout.
- Never dispatches a notification.
- Never communicates with external partners.
- Never executes any financial effect.
- Never executes any approval.
- Never enables any feature.
- Never modifies any classification.
- Never executes any commercial-decision or commercial-financial-effect.

### 3.3 Read-only consumer boundary surface

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface is a read-only contract against:

- A1 canonical identity.
- A2 authorization.
- A3 binding.
- A4 product-policy.
- A5 Ledger.
- A6 partner-adapter.
- A6T05 external-operation.
- A6T08 settlement / suspense / compensating.
- A6T09 external reconciliation.
- A6T09 external reconciliation snapshot.
- A6T10 data classification / consent / retention / legal-hold / secret / disclosure / support-trace / partner-payload validation.
- A7 product catalog.
- A7 product-policy profile.
- A7T04 product customer-binding.
- A7T05 product command / operation.
- A7T06 product notification delivery.
- A7T07 product lifecycle.
- A7T08 product financial effect.
- A7T09 product reconciliation.
- A7T10 product data minimization.
- B1T03 commercial catalog.
- B1T04 commercial decision.
- B1T05 billing document.
- B1T06 commercial-incentive decision.
- B1T07 commercial-rewards decision.
- B1T08 commercial-financial-recognition decision.
- B1T09 commercial-analytics decision.
- `CustomerPreference`.
- The shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, and `MetricsService` (read-write only for idempotency reservation, metrics increment, audit recording, and outbox event publishing — the B1 commercial-governance engine never writes to source records).

## 4. Decision kinds

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface produces five bounded decision kinds:

| Kind                             | Description                             | State vocabulary                                                          |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `COMMERCIAL_DATA_CLASSIFICATION` | Commercial data-classification decision | `DRAFT`, `CLASSIFIED`, `MINIMIZED`, `DISCLOSED`, `RETIRED`, `ARCHIVED`    |
| `COMMERCIAL_IDEMPOTENCY`         | Commercial idempotency decision         | `DRAFT`, `RESERVED`, `COMPLETED`, `EXPIRED`, `CONFLICTED`, `RETIRED`      |
| `COMMERCIAL_AUDIT`               | Commercial audit decision               | `DRAFT`, `RECORDED`, `CORRELATED`, `SEALED`, `RETIRED`, `ARCHIVED`        |
| `COMMERCIAL_APPROVAL`            | Commercial approval decision            | `DRAFT`, `PENDING`, `REQUIRED`, `GRANTED`, `DENIED`, `EXPIRED`, `RETIRED` |
| `COMMERCIAL_FEATURE_FLAG`        | Commercial feature-flag decision        | `DRAFT`, `REGISTERED`, `ROLLED_OUT`, `ENABLED`, `DISABLED`, `RETIRED`     |

The B1 commercial-governance engine decision outcome vocabulary is: `AVAILABLE`, `CLASSIFIED`, `AUDITED`, `APPROVED`, `REJECTED`, `ROLLED_OUT`, `DISCREPANCY`, `REPLAYED`.

## 5. Document kinds

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface produces 26 bounded document kinds:

- `COMMERCIAL_DATA_CLASSIFICATION`, `COMMERCIAL_DISCLOSURE_LEVEL`, `COMMERCIAL_SENSITIVITY`, `COMMERCIAL_RETENTION_CLASS`, `COMMERCIAL_EXPORT_RULES` (commercial data classification)
- `COMMERCIAL_IDEMPOTENCY_CONTRACT`, `COMMERCIAL_REPLAY_POLICY`, `COMMERCIAL_REPLAY_ELIGIBILITY`, `COMMERCIAL_IDEMPOTENCY_VALIDATION`, `COMMERCIAL_REQUEST_REPLAY_EVIDENCE` (commercial idempotency)
- `COMMERCIAL_AUDIT_EVIDENCE`, `COMMERCIAL_AUDIT_CORRELATION`, `COMMERCIAL_AUDIT_ACTOR_MAPPING`, `COMMERCIAL_AUDIT_ENTITY_MAPPING`, `COMMERCIAL_AUDIT_EVENT` (commercial audit)
- `COMMERCIAL_APPROVAL_REQUIREMENTS`, `COMMERCIAL_APPROVAL_POLICY`, `COMMERCIAL_APPROVAL_EVIDENCE`, `COMMERCIAL_APPROVAL_TRACE`, `COMMERCIAL_APPROVAL_DECISION` (commercial approvals)
- `COMMERCIAL_FEATURE_REGISTRATION`, `COMMERCIAL_ROLLOUT_STATE`, `COMMERCIAL_ENABLEMENT_RULES`, `COMMERCIAL_DEPENDENCY_RULES`, `COMMERCIAL_ACTIVATION_READINESS`, `COMMERCIAL_ROLLOUT_EVIDENCE` (commercial feature flag)

## 6. Commercial classification vocabulary

The B1 commercial-governance engine, commercial data-classification vocabulary (5): `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`, `HIGHLY_RESTRICTED`.

The B1 commercial-governance engine, commercial sensitivity vocabulary (8): `COMMERCIAL_PII`, `COMMERCIAL_BILLING`, `COMMERCIAL_FINANCIAL`, `COMMERCIAL_TAX`, `COMMERCIAL_COST`, `COMMERCIAL_PARTNER`, `COMMERCIAL_INTERNAL`, `COMMERCIAL_PUBLIC`.

The B1 commercial-governance engine, commercial disclosure level vocabulary (5): `COMMERCIAL_DISCLOSURE_NONE`, `COMMERCIAL_DISCLOSURE_INTERNAL`, `COMMERCIAL_DISCLOSURE_RESTRICTED`, `COMMERCIAL_DISCLOSURE_AUDIT`, `COMMERCIAL_DISCLOSURE_SUPPORT`.

The B1 commercial-governance engine, commercial retention class vocabulary (6): `COMMERCIAL_RETENTION_OPERATIONS_DEFAULT`, `COMMERCIAL_RETENTION_AUDIT`, `COMMERCIAL_RETENTION_REGULATORY`, `COMMERCIAL_RETENTION_TAX`, `COMMERCIAL_RETENTION_SUPPORT`, `COMMERCIAL_RETENTION_LEGAL_HOLD`.

The B1 commercial-governance engine, commercial export rule vocabulary (6): `COMMERCIAL_EXPORT_PROHIBITED`, `COMMERCIAL_EXPORT_INTERNAL_ONLY`, `COMMERCIAL_EXPORT_AUDIT_ONLY`, `COMMERCIAL_EXPORT_REDACTED`, `COMMERCIAL_EXPORT_MINIMIZED`, `COMMERCIAL_EXPORT_APPROVED`.

## 7. Commercial idempotency vocabulary

The B1 commercial-governance engine, commercial replay policy vocabulary (6): `COMMERCIAL_REPLAY_DENY`, `COMMERCIAL_REPLAY_ALLOW`, `COMMERCIAL_REPLAY_REQUIRE`, `COMMERCIAL_REPLAY_EXPIRE`, `COMMERCIAL_REPLAY_FORCE`, `COMMERCIAL_REPLAY_INHERIT`.

The B1 commercial-governance engine, commercial replay eligibility vocabulary (6): `COMMERCIAL_REPLAY_ELIGIBLE`, `COMMERCIAL_REPLAY_INELIGIBLE`, `COMMERCIAL_REPLAY_CONFLICTED`, `COMMERCIAL_REPLAY_EXPIRED`, `COMMERCIAL_REPLAY_IN_PROGRESS`, `COMMERCIAL_REPLAY_FORCED`.

## 8. Commercial audit vocabulary

The B1 commercial-governance engine, commercial audit event vocabulary (23): `COMMERCIAL_AUDIT_DECISION_RECORDED`, `COMMERCIAL_AUDIT_FINANCIAL_EFFECT_RECORDED`, `COMMERCIAL_AUDIT_BILLING_RECORDED`, `COMMERCIAL_AUDIT_INVOICE_RECORDED`, `COMMERCIAL_AUDIT_STATEMENT_RECORDED`, `COMMERCIAL_AUDIT_CAMPAIGN_RECORDED`, `COMMERCIAL_AUDIT_PROMOTION_RECORDED`, `COMMERCIAL_AUDIT_COUPON_RECORDED`, `COMMERCIAL_AUDIT_REFERRAL_RECORDED`, `COMMERCIAL_AUDIT_CASHBACK_RECORDED`, `COMMERCIAL_AUDIT_LOYALTY_RECORDED`, `COMMERCIAL_AUDIT_REVENUE_RECOGNITION_RECORDED`, `COMMERCIAL_AUDIT_TAX_RECORDED`, `COMMERCIAL_AUDIT_COST_ACCOUNTING_RECORDED`, `COMMERCIAL_AUDIT_PROFITABILITY_RECORDED`, `COMMERCIAL_AUDIT_ANALYTICS_RECORDED`, `COMMERCIAL_AUDIT_RECONCILIATION_RECORDED`, `COMMERCIAL_AUDIT_CLASSIFICATION_RECORDED`, `COMMERCIAL_AUDIT_IDEMPOTENCY_RECORDED`, `COMMERCIAL_AUDIT_APPROVAL_RECORDED`, `COMMERCIAL_AUDIT_FEATURE_FLAG_RECORDED`, `COMMERCIAL_AUDIT_REPLAY_RECORDED`, `COMMERCIAL_AUDIT_CONFLICT_RECORDED`.

## 9. Commercial approvals vocabulary

The B1 commercial-governance engine, commercial approval requirement vocabulary (6): `COMMERCIAL_APPROVAL_NOT_REQUIRED`, `COMMERCIAL_APPROVAL_PRINCIPAL`, `COMMERCIAL_APPROVAL_PRIVILEGED`, `COMMERCIAL_APPROVAL_STEP_UP`, `COMMERCIAL_APPROVAL_DUAL_CONTROL`, `COMMERCIAL_APPROVAL_INHERIT`.

The B1 commercial-governance engine, commercial approval policy vocabulary (5): `COMMERCIAL_APPROVAL_POLICY_ALLOW`, `COMMERCIAL_APPROVAL_POLICY_DENY`, `COMMERCIAL_APPROVAL_POLICY_REVIEW`, `COMMERCIAL_APPROVAL_POLICY_ESCALATE`, `COMMERCIAL_APPROVAL_POLICY_INHERIT`.

## 10. Commercial feature flag vocabulary

The B1 commercial-governance engine, commercial feature-flag rollout state vocabulary (7): `COMMERCIAL_FEATURE_FLAG_DRAFT`, `COMMERCIAL_FEATURE_FLAG_REGISTERED`, `COMMERCIAL_FEATURE_FLAG_CANARY`, `COMMERCIAL_FEATURE_FLAG_ROLLED_OUT`, `COMMERCIAL_FEATURE_FLAG_ENABLED`, `COMMERCIAL_FEATURE_FLAG_DISABLED`, `COMMERCIAL_FEATURE_FLAG_RETIRED`.

The B1 commercial-governance engine, commercial activation readiness vocabulary (5): `COMMERCIAL_ACTIVATION_NOT_READY`, `COMMERCIAL_ACTIVATION_PENDING`, `COMMERCIAL_ACTIVATION_READY`, `COMMERCIAL_ACTIVATION_BLOCKED`, `COMMERCIAL_ACTIVATION_INHERIT`.

## 11. Consumer ports

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface exposes eleven consumer ports:

| #   | Consumer port                                            | Description                                                     |
| --- | -------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `generateCommercialDataClassificationDecision`           | Generate B1 commercial data-classification decision             |
| 2   | `replaySafeGenerateCommercialDataClassificationDecision` | Replay-safe generate B1 commercial data-classification decision |
| 3   | `generateCommercialIdempotencyDecision`                  | Generate B1 commercial idempotency decision                     |
| 4   | `replaySafeGenerateCommercialIdempotencyDecision`        | Replay-safe generate B1 commercial idempotency decision         |
| 5   | `generateCommercialAuditDecision`                        | Generate B1 commercial audit decision                           |
| 6   | `replaySafeGenerateCommercialAuditDecision`              | Replay-safe generate B1 commercial audit decision               |
| 7   | `generateCommercialApprovalDecision`                     | Generate B1 commercial approval decision                        |
| 8   | `replaySafeGenerateCommercialApprovalDecision`           | Replay-safe generate B1 commercial approval decision            |
| 9   | `generateCommercialFeatureFlagDecision`                  | Generate B1 commercial feature-flag decision                    |
| 10  | `replaySafeGenerateCommercialFeatureFlagDecision`        | Replay-safe generate B1 commercial feature-flag decision        |
| 11  | `compatibilityCheck`                                     | B1 commercial-governance compatibility check                    |

## 12. Idempotency scopes

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface internal idempotency scopes:

| Scope                                                                           | Idempotency key                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `b1.commercial-governance-engine.commercial-data-classification.idempotency.v1` | B1 commercial data-classification request idempotency key (SHA-256) |
| `b1.commercial-governance-engine.commercial-idempotency.idempotency.v1`         | B1 commercial idempotency request idempotency key (SHA-256)         |
| `b1.commercial-governance-engine.commercial-audit.idempotency.v1`               | B1 commercial audit request idempotency key (SHA-256)               |
| `b1.commercial-governance-engine.commercial-approvals.idempotency.v1`           | B1 commercial approval request idempotency key (SHA-256)            |
| `b1.commercial-governance-engine.commercial-feature-flag.idempotency.v1`        | B1 commercial feature-flag request idempotency key (SHA-256)        |

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface internal idempotency retention is 86_400 seconds (24 hours).

## 13. Audit, outbox, and metrics identity

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface audit / outbox / metrics identity:

| Attribute                    | Value                                   |
| ---------------------------- | --------------------------------------- |
| Audit actor                  | `b1-commercial-governance-engine`       |
| Audit entity type            | `B1_COMMERCIAL_GOVERNANCE_DECISION`     |
| Outbox event type            | `B1CommercialGovernanceDecisionDecided` |
| Outbox event classification  | `INTERNAL_OPERATIONS`                   |
| Outbox event retention class | `OPERATIONS_DEFAULT`                    |
| Reference prefix             | `b1-commercial-governance-decision`     |

## 14. Data classification vocabulary

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface uses the A1 PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED / HIGHLY_RESTRICTED vocabulary (frozen by `docs/A1-IMPLEMENTATION-PLAN.md` §1 A1).

## 15. Failure code vocabulary

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface failure code vocabulary (28): `B1_COMMERCIAL_GOVERNANCE_ENGINE_INVALID_COMMAND`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_INCOMPATIBLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_QUERY_UNAVAILABLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_PROHIBITED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_NOT_FOUND`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_DECISION_INCOMPATIBLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_CATALOG_INCOMPATIBLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_CATALOG_MISSING`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_CLASSIFICATION_PROHIBITED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_CLASSIFICATION_NOT_FOUND`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_NOT_FOUND`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_AUDIT_INCOMPATIBLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_A4_POLICY_DENIED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_A3_BINDING_INVALID`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_A5_LEDGER_INVARIANT_BROKEN`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_A6_PARTNER_INCOMPATIBLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_A7_PRODUCT_INCOMPATIBLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_REPLAY_CONFLICT`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_REPLAY_EXPIRED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_IN_PROGRESS`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_NUMBER_CONFLICT`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_EXPIRED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_NOT_APPLICABLE`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_INSUFFICIENT_DATA`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_CLASSIFICATION_THRESHOLD_EXCEEDED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_FEATURE_FLAG_NOT_READY`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_APPROVAL_REQUIRED`, `B1_COMMERCIAL_GOVERNANCE_ENGINE_AUTO_REPAIR_ATTEMPTED`.

## 16. Prohibited dependencies

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface does NOT depend on (prohibited dependencies):

- `B1_COMMERCIAL_DATA_CLASSIFICATION_REGISTRY`
- `B1_COMMERCIAL_IDEMPOTENCY_AUTHORITY`
- `B1_COMMERCIAL_AUDIT_AUTHORITY`
- `B1_COMMERCIAL_APPROVAL_AUTHORITY`
- `B1_COMMERCIAL_FEATURE_FLAG_AUTHORITY`
- `B1_COMMERCIAL_RELEASE_GATE`
- `CASHBACK_REDEMPTION_AUTHORITY`
- `LOYALTY_BALANCE_AUTHORITY`
- `REFERRAL_REWARD_AUTHORITY`
- `REVENUE_RECOGNITION_POSTING_AUTHORITY`
- `TAX_VAT_POSTING_AUTHORITY`
- `COST_ACCOUNTING_POSTING_AUTHORITY`
- `A5_LEDGER_POSTING_AUTHORITY`
- `A5_LEDGER_JOURNAL_AUTHORITY`
- `A5_FINANCIAL_INVARIANTS_OVERRIDE_AUTHORITY`
- `A6T08_SETTLEMENT_AUTHORITY`
- `A6T08_SUSPENSE_AUTHORITY`
- `A6T08_COMPENSATING_AUTHORITY`
- `A6T09_RECONCILIATION_AUTHORITY` (auto-repair / clearing / posting only)
- `A7T06_NOTIFICATION_DISPATCH_AUTHORITY`
- `A7T08_PRODUCT_FINANCIAL_EFFECT_AUTHORITY`

## 17. Read-only invariant

The B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface enforces the following read-only invariant:

1. The B1 commercial-governance engine runs in a REPEATABLE READ, read-only TypeORM transaction.
2. The B1 commercial-governance engine never takes any write lock.
3. The B1 commercial-governance engine never calls `auditService.record`, `outboxService.publish`, or any write method on upstream services except the B1 commercial-governance engine's own idempotency reservation, metrics increment, and decision persistence.
4. The B1 commercial-governance engine never auto-repairs discrepancies.
5. The B1 commercial-governance engine never rewrites history.
6. The B1 commercial-governance engine never dispatches notifications, executes settlements, performs payouts, performs reconciliation, performs approval, performs feature enablement, or communicates with external partners.
7. The B1 commercial-governance engine never executes any financial effect.

## 18. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T10 — B1 Commercial Data Classification, Commercial Idempotency, Commercial Audit, Commercial Approvals, and Feature Flag Surface.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/B1-REFERRAL-ENGINE-CONTRACT.md` — B1 referral engine, cashback engine, and loyalty engine contract.
- `docs/B1-REVENUE-RECOGNITION-CONTRACT.md` — B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract.
- `docs/B1-COMMERCIAL-ANALYTICS-CONTRACT.md` — B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine contract.
- `docs/ADR/ADR-0024` — A1 data classification, retention, and legal-hold controls.
- `docs/ADR/ADR-0052` — A6T10 data classification, consent, retention, legal-hold, secret, disclosure, support-trace, and partner-payload validation.
- `docs/ADR/ADR-0069-B1-Commercial-Governance-Data-Classification-Idempotency-Audit-Approvals-Feature-Flag.md` — B1 commercial-governance engine, commercial data-classification, commercial idempotency, commercial audit, commercial approvals, and commercial feature-flag surface ADR.
- `src/policy/b1-commercial-governance-engine.types.ts` — B1 commercial-governance engine types.
- `src/policy/b1-commercial-governance-engine.constants.ts` — B1 commercial-governance engine constants.
- `src/policy/b1-commercial-governance-engine.entity.ts` — B1 commercial-governance decision persistence entity.
- `src/policy/b1-commercial-governance-engine.repository.ts` — B1 commercial-governance engine repository.
- `src/policy/b1-commercial-governance-engine.service.ts` — B1 commercial-governance engine service.
- `src/policy/b1-commercial-governance-engine.module.ts` — B1 commercial-governance engine NestJS module.
- `src/migrations/1785753600038-CreateB1CommercialGovernanceDecisionTables.ts` — B1 commercial-governance decision persistence migration.
- `test/b1-commercial-governance-engine.types.spec.ts` — B1 commercial-governance engine types tests.
- `test/b1-commercial-governance-engine.repository.spec.ts` — B1 commercial-governance engine repository tests.
- `test/b1-commercial-governance-engine.service.spec.ts` — B1 commercial-governance engine service tests.
- `test/b1-commercial-governance-engine.module.spec.ts` — B1 commercial-governance engine module tests.
