# B2F07 — Finance Accounting Treatment and Source Decision Adoption Contract

> **Non-destructive classification notice (2026-08-10):** This contract and implementation retain the historical **B2F07** label and all existing technical identities. For authoritative planning, the completed capability is classified as **B2F09-PRE — Finance Accounting Treatment and Source Decision Adoption Foundation**, shared by B2F07–B2F10. It does not complete authoritative B2F07 Accounts Receivable or the remaining authoritative B2F09 scope. See [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md).

- **Platform:** B2 — Finance Platform
- **Contract:** `B2F-ACCOUNTING-TREATMENT` v1
- **ADR:** [`ADR-0088 — B2 Finance Accounting Treatment and Source Decision Adoption`](ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md)
- **Status:** Internal runtime implemented
- **Migration:** `1785753600049-CreateB2FFinanceAccountingTreatments.ts`

## 1. Purpose

B2F07 adopts already-authoritative B1/A6/A7 source decisions into deterministic Finance accounting treatments. A source decision retains its business meaning and source ownership. A Finance treatment records how a verified source is classified for the primary Finance book, period, accounting date, account mappings, controls, and B2F05 journal governance.

B2F07 does not re-run commercial, billing, invoice, recognition, tax, cost, profitability, settlement, suspense, product, or reconciliation decision logic.

## 2. Runtime artifacts

- `src/policy/b2f-accounting-treatment.types.ts`
- `src/policy/b2f-accounting-treatment.entity.ts`
- `src/policy/b2f-accounting-treatment.service.ts`
- `src/policy/b2f-accounting-treatment.module.ts`
- migration `1785753600049-CreateB2FFinanceAccountingTreatments.ts`
- focused tests `test/b2f-accounting-treatment.*.spec.ts`

No controller, public API, partner client, posting engine, or frontend is introduced.

## 3. Source versus Finance treatment

A source reference contains owner/category/reference/version/hash/effective time and optional canonical lookup reference. The source remains authoritative for commercial/product/settlement meaning.

The Finance treatment contains:

- immutable source provenance and verification result;
- `finance.book.ng.primary` v1, accrual basis, NGN/customer funds;
- accounting period/date;
- Finance classification and B2F03 mapping references;
- deterministic request/decision hashes;
- B2F06 control decision reference;
- resulting B2F05 Finance journal-governance reference;
- rejection reasons where fail-closed.

A treatment is not an A5 journal, line, balance, or posting.

## 4. Source verification matrix

| Source category                            | Repository interface                                                 | Status                         | Adoption rule                                                  |
| ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| B1 fee/commission/revenue share            | `B1FeeEngineService.getPersistenceRecordByReference`                 | `VERIFIED_READ_ONLY`           | Reference/version/hash/currentness/dimensions must match       |
| B1 billing record/invoice                  | `B1BillingEngineService.getPersistenceRecordByReference`             | `VERIFIED_READ_ONLY`           | Durable B1 document is consumed, never regenerated             |
| B1 recognition/tax/cost                    | `B1RevenueRecognitionEngineService.getPersistenceRecordByReference`  | `VERIFIED_READ_ONLY`           | Durable decision consumed; state is not A5 posting proof       |
| B1 profitability/commercial reconciliation | `B1CommercialAnalyticsEngineService.getPersistenceRecordByReference` | `VERIFIED_READ_ONLY`           | Read-only commercial decision consumed                         |
| A6 settlement                              | `ExternalSettlementService.getByOperation`                           | `VERIFIED_READ_ONLY`           | Exact settlement ID/evidence hash and NGN/unit required        |
| A6 suspense                                | `ExternalSettlementService.getSuspenseForOperation`                  | `VERIFIED_READ_ONLY`           | Exact suspense ID/evidence hash required; no clearing/mutation |
| A7 product financial effect                | no canonical by-reference read interface verified                    | `NOT_VERIFIED_REQUIRES_REVIEW` | Runtime fails closed; no caller-supplied substitution accepted |

B1/A6 source services are used only through existing read methods. A7 adoption remains blocked until A7 exposes an authoritative immutable by-reference consumer port.

## 5. Currentness and compatibility

A source is rejected when missing, hash-mismatched, stale/not-effective, expired, unavailable, wrong owner/category/version, non-NGN, non-customer-funds, or unverifiable. B1 status words never imply Finance or A5 finality.

Source hashes are taken from canonical decision/document/evidence records. Request-provided hashes must match.

## 6. Classification and mapping

Treatment lines carry B2F03 classification and mapping references plus canonical A5 UUIDs. B2F07 does not map by code/name or create accounts. It delegates journal compatibility to B2F05, which rechecks A5 type/normal-balance/currency/unit/active state.

The durable B2F03 mapping registry is still not implemented. Therefore production adoption/posting remains blocked on that `NOT VERIFIED / REQUIRES REVIEW` item, exactly as documented by B2F05.

No split/percentage/many-to-many mapping is introduced.

## 7. Period and accounting date

B2F07 consumes B2F04 `checkAdmission()` for the exact period/accounting date and journal classification. It does not calculate or mutate period state. Locked, stale, missing, or date-incompatible periods reject treatment.

## 8. Finance controls

Before journal creation, B2F07 invokes B2F06 action `FINANCE_ACCOUNTING_TREATMENT_ADOPT` with total debit materiality, exact treatment reference/hash, maker/checker A2 approval provenance, and override evidence. Denial rejects adoption.

An active B2F06 policy must include that action. B2F07 creates no approval or role authority.

## 9. Journal governance and A5

An allowed treatment enters B2F05 through `createJournal()` and produces only a `DRAFT` Finance governance record. B2F07 never invokes `LedgerService` and never posts. Subsequent approval/control/posting stays B2F05/A5-owned. A5 journal ID/time and unknown outcome behavior remain B2F05 provenance.

## 10. Determinism, idempotency, and persistence

Scope:

```text
b2.finance.accounting-treatment.idempotency.v1
```

The semantic hash includes source identity/hash/effective date, book/period/date, classifications/mappings/A5 UUIDs, maker/approval evidence, and treatment inputs. Generated IDs/timestamps are excluded. Same key/hash replays; changed payload conflicts.

`b2f_finance_accounting_treatments` preserves one treatment version per source category/reference/version, deterministic decision, control/journal provenance, and audit correlation. It is not a source or value authority.

States:

- `ADOPTED`
- `JOURNAL_DRAFT_CREATED`
- `REJECTED`

## 11. Audit and consumer ports

Shared `AuditService` records adopted/rejected treatment, source verification status, control decision, journal reference, and reasons. Read-only ports expose treatment lookup, source lookup, and source verification for B2F08–B2F11.

## 12. Authority boundaries

- A5 remains sole account/journal/line/posting/value/balance/reversal authority.
- B1 remains commercial/billing/invoice/recognition/tax/cost/profitability/reconciliation authority.
- A6 remains partner/settlement/suspense/external-reconciliation authority.
- A7 remains product/financial-effect/reconciliation authority.
- B2F03/B2F04/B2F05/B2F06 remain mapping, period, governance, and control authorities respectively.
- No second source decision, reconciliation, approval, or public API authority exists.

## 13. Explicit non-goals

No AR/AP automation, tax calculation, allocation calculation, settlement execution, product mutation, direct A5 posting, reconciliation repair, Treasury, Reporting, Statements, IAM, Developer APIs, frontend, B2F08, or historical B2T11/B2T12 is implemented.

## 14. Verification

- [x] Verified B1 and A6 source adoption implemented read-only.
- [x] A7 adoption fails closed pending canonical read interface.
- [x] Source identity/hash/currentness/dimensions and provenance enforced.
- [x] B2F03 mapping constraints delegated to B2F05 validation without account creation.
- [x] B2F04 period admission consumed.
- [x] B2F06 control consumed.
- [x] B2F05 draft journal governance created; no A5 post occurs here.
- [x] Deterministic/idempotent/audited treatment persistence and read ports implemented.
- [x] No source or later-platform authority duplicated.

### B2F07 result

> **B1/A6 Finance treatment adoption implemented; A7 and durable mapping verification remain fail-closed review items, and B2F08 has not begun.**
