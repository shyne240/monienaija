# B1 Commercial-Analytics, Profitability, and Commercial-Reconciliation Engine Contract

## 1. Purpose

This document is the canonical B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine contract (`B1-COMMERCIAL-ANALYTICS-ENGINE` v1) for the B1 first commercial scope (`commercial.virtual-account.inbound-funding` v1) established in `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01).

This document is frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09.

## 2. Contract identity

- **Contract name:** `B1-COMMERCIAL-ANALYTICS-ENGINE`
- **Contract version:** `1`
- **Contract document:** `docs/B1-COMMERCIAL-ANALYTICS-CONTRACT.md`
- **Scope key:** `commercial.virtual-account.inbound-funding`
- **Scope version:** `1`
- **Scope direction:** `inbound`
- **Scope currency:** `NGN`
- **Scope accounting unit:** `CUSTOMER_FUNDS`
- **Scope product dependency:** `VIRTUAL_ACCOUNT`
- **Scope product dependency version:** `1`
- **Scope partner dependency:** `NIBSS_NIP`
- **Period key:** `commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1`
- **Period version:** `1`
- **Reference prefix:** `b1-commercial-analytics-decision`
- **Retention days:** `365`
- **Idempotency retention seconds:** `86_400` (24 hours)

## 3. Scope and authority

### 3.1 Authority

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine is the only B1 commercial-analytics engine for commercial analytics, profitability, and commercial reconciliation. The B1 commercial-analytics engine is the only B1 commercial-analytics authority.

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine does NOT introduce:

- A second Reconciliation authority.
- A second Analytics authority outside B1.
- A second Finance authority.
- A second Ledger.
- A second B1T04 commercial decision engine.
- A second B1T05 billing engine.
- A second B1T06 commercial-incentive engine.
- A second B1T07 commercial-rewards engine.
- A second B1T08 commercial-financial-recognition engine.

### 3.2 Read-only contract

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine is a READ-ONLY ANALYTICS ENGINE ONLY. The B1 commercial-analytics engine:

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

### 3.3 Read-only consumer boundary surface

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine is a read-only contract against:

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
- A6T10 data classification.
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
- `CustomerPreference`.
- The shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, and `MetricsService` (read-write only for idempotency reservation, metrics increment, audit recording, and outbox event publishing — the B1 commercial-analytics engine never writes to source records).

## 4. Decision kinds

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine produces three bounded decision kinds:

| Kind | Description | State vocabulary |
|------|-------------|------------------|
| `COMMERCIAL_ANALYTICS` | Commercial analytics decision | `DRAFT`, `ACTIVE`, `SUSPENDED`, `RETIRED`, `ARCHIVED` |
| `PROFITABILITY` | Profitability decision | `DRAFT`, `ACTIVE`, `SUSPENDED`, `RETIRED`, `ARCHIVED` |
| `COMMERCIAL_RECONCILIATION` | Commercial-reconciliation decision | `DRAFT`, `PENDING`, `IN_PROGRESS`, `RECONCILED`, `DISCREPANCY`, `CLOSED` |

The B1 commercial-analytics engine decision outcome vocabulary is: `AVAILABLE`, `COMPLETED`, `RECONCILED`, `DISCREPANCY`, `REPLAYED`.

## 5. Document kinds

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine produces 23 bounded document kinds:

`COMMERCIAL_ANALYTICS`, `COMMERCIAL_KPI`, `COMMERCIAL_METRIC`, `TREND_ANALYSIS`, `PRODUCT_ANALYTICS`, `CUSTOMER_ANALYTICS`, `MERCHANT_ANALYTICS`, `PARTNER_ANALYTICS`, `PROFITABILITY`, `PRODUCT_PROFITABILITY`, `CUSTOMER_PROFITABILITY`, `MERCHANT_PROFITABILITY`, `CAMPAIGN_PROFITABILITY`, `FEE_PROFITABILITY`, `REVENUE_ATTRIBUTION`, `COST_ATTRIBUTION`, `PROFITABILITY_DECISION`, `COMMERCIAL_RECONCILIATION`, `COMMERCIAL_RECONCILIATION_REPORT`, `COMMERCIAL_RECONCILIATION_EVIDENCE`, `COMMERCIAL_RECONCILIATION_DECISION`, `COMMERCIAL_RECONCILIATION_TRACE`, `COMMERCIAL_RECONCILIATION_DISCREPANCY`.

## 6. Commercial KPI vocabulary

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine commercial KPI vocabulary (20): `GMV`, `NET_REVENUE`, `GROSS_PROFIT`, `NET_PROFIT`, `CUSTOMER_LIFETIME_VALUE`, `CUSTOMER_ACQUISITION_COST`, `FEE_VOLUME`, `COMMISSION_VOLUME`, `CAMPAIGN_UTILIZATION`, `COUPON_REDEMPTION_RATE`, `REFERRAL_CONVERSION_RATE`, `CASHBACK_UTILIZATION`, `LOYALTY_REDEMPTION_RATE`, `REVENUE_RECOGNITION_RATE`, `TAX_COMPLIANCE_RATE`, `COST_ALLOCATION_RATE`, `BILLING_ACCURACY`, `INVOICE_ACCURACY`, `STATEMENT_ACCURACY`, `RECONCILIATION_RATE`.

## 7. Commercial trend vocabulary

The B1 commercial-analytics engine commercial trend vocabulary (5): `INCREASING`, `STABLE`, `DECREASING`, `VOLATILE`, `INSUFFICIENT_DATA`.

## 8. Discrepancy classification

### 8.1 Discrepancy severity

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine discrepancy severity vocabulary (5): `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.

### 8.2 Discrepancy owner

The B1 commercial-analytics engine discrepancy owner vocabulary (10): `B1_COMMERCIAL_CATALOG_OWNER`, `B1_FEE_ENGINE_OWNER`, `B1_BILLING_ENGINE_OWNER`, `B1_CAMPAIGN_ENGINE_OWNER`, `B1_REFERRAL_ENGINE_OWNER`, `B1_REVENUE_RECOGNITION_ENGINE_OWNER`, `A5_LEDGER_OWNER`, `A6_PARTNER_OWNER`, `A7_PRODUCT_OWNER`, `OPERATIONS_OWNER`.

### 8.3 Discrepancy recovery state

The B1 commercial-analytics engine discrepancy recovery state vocabulary (8): `OPEN`, `ACKNOWLEDGED`, `INVESTIGATING`, `PENDING_REMEDIATION`, `PENDING_OWNER_REVIEW`, `CLOSED_RESOLVED`, `CLOSED_ACCEPTED`, `CLOSED_WONT_FIX`.

### 8.4 Discrepancy category

The B1 commercial-analytics engine discrepancy category vocabulary (16): `COMMERCIAL_DECISION_DISCREPANCY`, `COMMERCIAL_FINANCIAL_EFFECT_DISCREPANCY`, `COMMERCIAL_BILLING_DISCREPANCY`, `COMMERCIAL_INVOICE_DISCREPANCY`, `COMMERCIAL_STATEMENT_DISCREPANCY`, `COMMERCIAL_CAMPAIGN_DISCREPANCY`, `COMMERCIAL_PROMOTION_DISCREPANCY`, `COMMERCIAL_COUPON_DISCREPANCY`, `COMMERCIAL_REFERRAL_DISCREPANCY`, `COMMERCIAL_CASHBACK_DISCREPANCY`, `COMMERCIAL_LOYALTY_DISCREPANCY`, `COMMERCIAL_REVENUE_RECOGNITION_DISCREPANCY`, `COMMERCIAL_TAX_DISCREPANCY`, `COMMERCIAL_COST_ACCOUNTING_DISCREPANCY`, `COMMERCIAL_PROFITABILITY_DISCREPANCY`, `COMMERCIAL_ANALYTICS_DISCREPANCY`.

## 9. Profitability dimension vocabulary

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine profitability dimension vocabulary (8): `PRODUCT`, `CUSTOMER`, `MERCHANT`, `PARTNER`, `CAMPAIGN`, `FEE`, `REVENUE`, `COST`.

## 10. Consumer ports

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine exposes seven consumer ports:

| # | Consumer port | Description |
|---|---------------|-------------|
| 1 | `generateCommercialAnalyticsDecision` | Generate B1 commercial-analytics decision |
| 2 | `replaySafeGenerateCommercialAnalyticsDecision` | Replay-safe generate B1 commercial-analytics decision |
| 3 | `generateProfitabilityDecision` | Generate B1 profitability decision |
| 4 | `replaySafeGenerateProfitabilityDecision` | Replay-safe generate B1 profitability decision |
| 5 | `generateCommercialReconciliationDecision` | Generate B1 commercial-reconciliation decision |
| 6 | `replaySafeGenerateCommercialReconciliationDecision` | Replay-safe generate B1 commercial-reconciliation decision |
| 7 | `compatibilityCheck` | B1 commercial-analytics compatibility check |

## 11. Idempotency scopes

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine internal idempotency scopes:

| Scope | Idempotency key |
|-------|-----------------|
| `b1.commercial-analytics-engine.commercial-analytics.idempotency.v1` | B1 commercial-analytics request idempotency key (SHA-256) |
| `b1.commercial-analytics-engine.profitability.idempotency.v1` | B1 profitability request idempotency key (SHA-256) |
| `b1.commercial-analytics-engine.commercial-reconciliation.idempotency.v1` | B1 commercial-reconciliation request idempotency key (SHA-256) |

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine internal idempotency retention is 86_400 seconds (24 hours).

## 12. Audit, outbox, and metrics identity

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine audit / outbox / metrics identity:

| Attribute | Value |
|-----------|-------|
| Audit actor | `b1-commercial-analytics-engine` |
| Audit entity type | `B1_COMMERCIAL_ANALYTICS_DECISION` |
| Outbox event type | `B1CommercialAnalyticsDecisionDecided` |
| Outbox event classification | `INTERNAL_OPERATIONS` |
| Outbox event retention class | `OPERATIONS_DEFAULT` |
| Reference prefix | `b1-commercial-analytics-decision` |

## 13. Data classification vocabulary

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine uses the A1 PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED / HIGHLY_RESTRICTED vocabulary (frozen by `docs/A1-IMPLEMENTATION-PLAN.md` §1 A1).

## 14. Failure code vocabulary

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine failure code vocabulary (26): `B1_COMMERCIAL_ANALYTICS_ENGINE_INVALID_COMMAND`, `B1_COMMERCIAL_ANALYTICS_ENGINE_INCOMPATIBLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_QUERY_UNAVAILABLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED`, `B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_NOT_FOUND`, `B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_INCOMPATIBLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_CATALOG_INCOMPATIBLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_CATALOG_MISSING`, `B1_COMMERCIAL_ANALYTICS_ENGINE_BILLING_DOCUMENT_NOT_FOUND`, `B1_COMMERCIAL_ANALYTICS_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_A4_POLICY_DENIED`, `B1_COMMERCIAL_ANALYTICS_ENGINE_A3_BINDING_INVALID`, `B1_COMMERCIAL_ANALYTICS_ENGINE_A5_LEDGER_INVARIANT_BROKEN`, `B1_COMMERCIAL_ANALYTICS_ENGINE_A6_PARTNER_INCOMPATIBLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_A7_PRODUCT_INCOMPATIBLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_REPLAY_CONFLICT`, `B1_COMMERCIAL_ANALYTICS_ENGINE_REPLAY_EXPIRED`, `B1_COMMERCIAL_ANALYTICS_ENGINE_IN_PROGRESS`, `B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_CONFLICT`, `B1_COMMERCIAL_ANALYTICS_ENGINE_EXPIRED`, `B1_COMMERCIAL_ANALYTICS_ENGINE_NOT_APPLICABLE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_INSUFFICIENT_DATA`, `B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_THRESHOLD_EXCEEDED`, `B1_COMMERCIAL_ANALYTICS_ENGINE_SNAPSHOT_STALE`, `B1_COMMERCIAL_ANALYTICS_ENGINE_RECONCILIATION_SCOPE_VIOLATION`, `B1_COMMERCIAL_ANALYTICS_ENGINE_AUTO_REPAIR_ATTEMPTED`.

## 15. Prohibited dependencies

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine does NOT depend on (prohibited dependencies):

- `B1_COMMERCIAL_ANALYTICS_AUTO_REPAIR_AUTHORITY`
- `B1_COMMERCIAL_RECONCILIATION_AUTO_REPAIR_AUTHORITY`
- `B1_PROFITABILITY_AUTO_REPAIR_AUTHORITY`
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

## 16. Read-only invariant

The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine enforces the following read-only invariant:

1. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine runs in a REPEATABLE READ, read-only TypeORM transaction.
2. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine never takes any write lock.
3. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine never calls `auditService.record`, `outboxService.publish`, or any write method on upstream services except the B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine's own idempotency reservation, metrics increment, and decision persistence.
4. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine never auto-repairs discrepancies.
5. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine never rewrites history.
6. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine never dispatches notifications, executes settlements, performs payouts, performs reconciliation, or communicates with external partners.
7. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine never executes any financial effect.

## 17. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09 — B1 Commercial-Analytics, Profitability, and Commercial Reconciliation Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/B1-REFERRAL-ENGINE-CONTRACT.md` — B1 referral engine, cashback engine, and loyalty engine contract.
- `docs/B1-REVENUE-RECOGNITION-CONTRACT.md` — B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract.
- `docs/ADR/ADR-0068-B1-Commercial-Analytics-Profitability-Commercial-Reconciliation.md` — B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine ADR.
- `src/policy/b1-commercial-analytics-engine.types.ts` — B1 commercial-analytics engine types.
- `src/policy/b1-commercial-analytics-engine.constants.ts` — B1 commercial-analytics engine constants.
- `src/policy/b1-commercial-analytics-engine.entity.ts` — B1 commercial-analytics decision persistence entity.
- `src/policy/b1-commercial-analytics-engine.repository.ts` — B1 commercial-analytics engine repository.
- `src/policy/b1-commercial-analytics-engine.service.ts` — B1 commercial-analytics engine service.
- `src/policy/b1-commercial-analytics-engine.module.ts` — B1 commercial-analytics engine NestJS module.
- `src/migrations/1785753600037-CreateB1CommercialAnalyticsDecisionTables.ts` — B1 commercial-analytics decision persistence migration.
- `test/b1-commercial-analytics-engine.types.spec.ts` — B1 commercial-analytics engine types tests.
- `test/b1-commercial-analytics-engine.repository.spec.ts` — B1 commercial-analytics engine repository tests.
- `test/b1-commercial-analytics-engine.service.spec.ts` — B1 commercial-analytics engine service tests.
- `test/b1-commercial-analytics-engine.module.spec.ts` — B1 commercial-analytics engine module tests.
