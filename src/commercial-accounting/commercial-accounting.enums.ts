/**
 * V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — accounting configuration vocabulary.
 *
 * Every value here maps one-to-one onto the approved human decisions recorded in
 * docs/V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 (the task brief) and the DP register they were
 * supplied against:
 *
 *  - CommercialVatTreatment: DP-03=B ("VAT-bearing V1 fee model; treatment configurable; rate
 *    never hard-coded; fail closed when configuration is absent").
 *      EXCLUSIVE_ADD_ON  — VAT is charged ON TOP of the fee (matches the existing
 *                          FeeRuleCalculatorService math: vat = fee * vatBps / 10000, floored).
 *      INCLUSIVE_IN_FEE  — the fee already contains VAT (vat = fee * vatBps / (10000+vatBps),
 *                          floored; revenue receives the remainder).
 *  - CommissionAccountingTreatment: DP-05=CONFIGURABLE (the three documented D-GL-004 fork
 *    options, runtime-selected, never hard-coded):
 *      EXPENSE_PAYABLE      — option A (DR commission expense / CR commission payable).
 *      AGENT_WALLET_NETTING — option B (DR commission expense / CR agent wallet, settled at once).
 *      CONTRA_REVENUE       — option C (configuration model only; NOT technically supportable
 *                             today: normal-balance enforcement forbids a contra-capable family,
 *                             and none is provisioned — posting fails closed with the precise
 *                             blocker rather than inventing accounting).
 *  - CommissionRecognitionTiming: DP-07=CONFIGURABLE (only the two register-supported modes):
 *      AT_COMPLETION            — recognize immediately at successful completion (required by
 *                                 AGENT_WALLET_NETTING).
 *      ACCRUE_NOW_SETTLE_LATER  — accrue the payable at completion; settlement execution is V2
 *                                 scope (required by EXPENSE_PAYABLE; no V1 settlement rail is
 *                                 implemented by this task).
 *
 * No timing/model beyond this vocabulary is representable; anything else fails closed.
 */
export enum CommercialVatTreatment {
  EXCLUSIVE_ADD_ON = 'EXCLUSIVE_ADD_ON',
  INCLUSIVE_IN_FEE = 'INCLUSIVE_IN_FEE',
}

export enum CommissionAccountingTreatment {
  EXPENSE_PAYABLE = 'EXPENSE_PAYABLE',
  AGENT_WALLET_NETTING = 'AGENT_WALLET_NETTING',
  CONTRA_REVENUE = 'CONTRA_REVENUE',
}

export enum CommissionRecognitionTiming {
  AT_COMPLETION = 'AT_COMPLETION',
  ACCRUE_NOW_SETTLE_LATER = 'ACCRUE_NOW_SETTLE_LATER',
}

/** Accounting-family roles the approved decisions require; resolved through the registry only. */
export enum CommercialAccountingFamilyRole {
  FEE_REVENUE = 'FEE_REVENUE',
  VAT_PAYABLE = 'VAT_PAYABLE',
  COMMISSION_EXPENSE = 'COMMISSION_EXPENSE',
  COMMISSION_PAYABLE = 'COMMISSION_PAYABLE',
}
